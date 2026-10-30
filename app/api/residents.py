from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.api.deps import get_current_user, require_any_permission, require_permission
from app.core.state import store
from app.schemas.schemas import AssignBedRequest, BulkAssignRequest, BulkResidentsRequest
from app.services.common import (
    ServiceError,
    attendance_status,
    build_csv,
    clean_str,
    date_only,
    is_housing_service,
    normalize_card,
    paged,
)
from app.services.housing import (
    assign_bed,
    bed_by_id,
    building_by_id,
    create_resident,
    delete_resident,
    resident_by_id,
    resident_payload,
    room_by_id,
    unassign_bed,
    update_resident,
    used_bed_ids,
)

router = APIRouter(prefix="/api/residents", tags=["residents"])


def _matches(resident: dict[str, Any], data: dict[str, Any], query: str) -> bool:
    if not query:
        return True
    needle = query.strip().lower()
    building = building_by_id(data, resident.get("buildingId")) or {}
    room = room_by_id(data, resident.get("roomId")) or {}
    bed = bed_by_id(data, resident.get("bedId")) or {}
    haystack = " ".join(
        clean_str(value).lower()
        for value in (
            resident.get("name"),
            resident.get("employeeCode"),
            resident.get("cardNumber"),
            resident.get("phone"),
            resident.get("company"),
            resident.get("department"),
            resident.get("jobTitle"),
            resident.get("birthPlace"),
            building.get("name"),
            room.get("name"),
            bed.get("label"),
        )
    )
    return needle in haystack


def _filter_residents(
    data: dict[str, Any],
    *,
    q: str = "",
    building_id: str = "",
    room_id: str = "",
    contractor_id: str = "",
    status: str = "",
    service_type: str = "",
    assigned: bool | None = None,
    housing_only: bool = False,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for resident in data.get("residents", []):
        if building_id and str(resident.get("buildingId")) != str(building_id):
            continue
        if room_id and str(resident.get("roomId")) != str(room_id):
            continue
        if contractor_id and str(resident.get("contractorId")) != str(contractor_id):
            continue
        if service_type and clean_str(resident.get("serviceType")) != service_type:
            continue
        if housing_only and not is_housing_service(resident):
            continue
        if assigned is True and not resident.get("bedId"):
            continue
        if assigned is False and resident.get("bedId"):
            continue
        if status:
            wanted = clean_str(status)
            if wanted == "غير مسكن":
                if resident.get("bedId"):
                    continue
            elif wanted != attendance_status(resident):
                continue
        if not _matches(resident, data, q):
            continue
        rows.append(resident)
    return rows


@router.get("")
def list_residents(
    q: str = "",
    buildingId: str = "",
    roomId: str = "",
    contractorId: str = "",
    status: str = "",
    serviceType: str = "",
    assigned: bool | None = None,
    housingOnly: bool = False,
    page: int = Query(1, ge=1),
    pageSize: int = Query(50, ge=1, le=500),
    sort: str = "name",
    user: dict[str, Any] = Depends(require_permission("residents.view")),
):
    data = store.read()
    rows = _filter_residents(
        data,
        q=q,
        building_id=buildingId,
        room_id=roomId,
        contractor_id=contractorId,
        status=status,
        service_type=serviceType,
        assigned=assigned,
        housing_only=housingOnly,
    )
    reverse = sort.startswith("-")
    key = sort.lstrip("-")
    sorters = {
        "name": lambda r: clean_str(r.get("name")),
        "employeeCode": lambda r: clean_str(r.get("employeeCode")),
        "company": lambda r: clean_str(r.get("company")),
        "createdAt": lambda r: clean_str(r.get("createdAt")),
        "updatedAt": lambda r: clean_str(r.get("updatedAt")),
    }
    rows.sort(key=sorters.get(key, sorters["name"]), reverse=reverse)
    payload = paged([resident_payload(data, r) for r in rows], page, pageSize)
    payload["data"] = payload["items"]
    return payload


@router.get("/export.csv")
def export_residents(user: dict[str, Any] = Depends(require_any_permission("residents.import", "reports.export"))):
    data = store.read()
    headers = [
        "الرقم الوظيفي", "رقم البطاقة", "الاسم", "المسمى الوظيفي", "الشركة/المتعهد",
        "الإدارة", "نوع الخدمة", "نوع الدوام", "تصنيف النقل", "الجنس",
        "الحالة", "حالة الدوام", "الموقع",
        "تاريخ الميلاد", "مكان الميلاد", "الجوال", "مسكن",
    ]
    rows = [
        [
            item.get("employeeCode"), item.get("cardNumber"), item.get("name"),
            item.get("jobTitle"), item.get("company"), item.get("department"),
            item.get("serviceType"), item.get("shift"), item.get("transportType"),
            item.get("gender"), item.get("attendanceStatus"),
            item.get("dutyStatus"), item.get("location"), date_only(item.get("birthDate")),
            item.get("birthPlace"), item.get("phone"), "نعم" if item.get("isAssigned") else "لا",
        ]
        for item in (resident_payload(data, r) for r in data.get("residents", []))
    ]
    content = build_csv(headers, rows)
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="residents.csv"'},
    )


@router.get("/import-template.csv")
def import_template(user: dict[str, Any] = Depends(require_permission("residents.import"))):
    headers = [
        "employeeCode", "name", "jobTitle", "company", "department", "serviceType",
        "phone", "gender", "cardNumber", "birthDate", "birthPlace", "buildingId",
        "roomId", "bedId",
    ]
    sample = [
        ["10001", "محمد أحمد", "فني", "شركة المثال", "الصيانة", "سكن", "0500000000", "ذكر", "1234567890", "1990-01-01", "الرياض", "", "", ""],
    ]
    return Response(
        content=build_csv(headers, sample),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="residents-template.csv"'},
    )


@router.get("/{resident_id}")
def get_resident(resident_id: str, user: dict[str, Any] = Depends(require_permission("residents.view"))):
    data = store.read()
    resident = resident_by_id(data, resident_id)
    if not resident:
        raise HTTPException(status_code=404, detail="الساكن غير موجود")
    return resident_payload(data, resident)


@router.get("/{resident_id}/history")
def resident_history(resident_id: str, user: dict[str, Any] = Depends(require_permission("residents.view"))):
    data = store.read()
    if not resident_by_id(data, resident_id):
        raise HTTPException(status_code=404, detail="الساكن غير موجود")
    rows = [
        item for item in data.get("auditLog", [])
        if item.get("entity") == "resident" and str(item.get("entityId")) == str(resident_id)
    ]
    return {"items": rows, "total": len(rows)}


@router.post("", status_code=201)
def add_resident(payload: dict[str, Any], user: dict[str, Any] = Depends(require_permission("residents.manage"))):
    with store.atomic() as data:
        resident = create_resident(data, payload, user)
        return resident_payload(data, resident)


@router.put("/{resident_id}")
@router.patch("/{resident_id}")
def edit_resident(
    resident_id: str,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(require_permission("residents.manage")),
):
    with store.atomic() as data:
        resident = resident_by_id(data, resident_id)
        if not resident:
            raise HTTPException(status_code=404, detail="الساكن غير موجود")
        update_resident(data, resident, payload, user)
        return resident_payload(data, resident)


@router.delete("/{resident_id}")
def remove_resident(resident_id: str, user: dict[str, Any] = Depends(require_permission("residents.manage"))):
    with store.atomic() as data:
        resident = resident_by_id(data, resident_id)
        if not resident:
            raise HTTPException(status_code=404, detail="الساكن غير موجود")
        name = resident.get("name")
        delete_resident(data, resident, user)
        return {"ok": True, "message": f"تم حذف الساكن {name}"}


@router.post("/{resident_id}/assign-bed")
def assign_resident_bed(
    resident_id: str,
    payload: AssignBedRequest,
    user: dict[str, Any] = Depends(require_permission("housing.manage")),
):
    with store.atomic() as data:
        resident = resident_by_id(data, resident_id)
        if not resident:
            raise HTTPException(status_code=404, detail="الساكن غير موجود")
        assign_bed(data, resident, payload.bedId)
        # تسكين مباشر: إغلاق آلي لطلب إضافة عامل معلّق مطابق لهذا الساكن
        from app.services.contractor_requests import sync_direct_assignment

        try:
            sync_direct_assignment(data, resident, user)
        except Exception:  # noqa: BLE001 — لا نعطل التسكين إن فشل الإغلاق الآلي
            pass
        from app.services.common import add_audit

        add_audit(data, user, "bed_assigned", "resident", resident.get("id"), {"bedId": payload.bedId})
        return resident_payload(data, resident)


@router.post("/{resident_id}/unassign-bed")
def unassign_resident_bed(
    resident_id: str,
    user: dict[str, Any] = Depends(require_permission("housing.manage")),
):
    with store.atomic() as data:
        resident = resident_by_id(data, resident_id)
        if not resident:
            raise HTTPException(status_code=404, detail="الساكن غير موجود")
        unassign_bed(data, resident)
        from app.services.common import add_audit

        add_audit(data, user, "bed_unassigned", "resident", resident.get("id"))
        return resident_payload(data, resident)


@router.post("/bulk-assign")
def bulk_assign(
    payload: BulkAssignRequest,
    user: dict[str, Any] = Depends(require_permission("housing.manage")),
):
    if not payload.residentIds:
        raise ServiceError("يرجى اختيار ساكن واحد على الأقل")
    with store.atomic() as data:
        used = used_bed_ids(data)
        candidates: list[dict[str, Any]] = []
        if payload.bedId:
            bed = bed_by_id(data, payload.bedId)
            if not bed:
                raise ServiceError("السرير غير موجود", 404)
            if str(bed.get("id")) in used:
                raise ServiceError("السرير مشغول بالفعل", 409)
            candidates = [bed]
        elif payload.roomId:
            room = room_by_id(data, payload.roomId)
            if not room:
                raise ServiceError("الغرفة غير موجودة", 404)
            candidates = [b for b in data.get("beds", []) if str(b.get("roomId")) == str(room.get("id")) and str(b.get("id")) not in used]
        elif payload.buildingId:
            building = building_by_id(data, payload.buildingId)
            if not building:
                raise ServiceError("المبنى غير موجود", 404)
            room_ids = {str(r.get("id")) for r in data.get("rooms", []) if str(r.get("buildingId")) == str(building.get("id"))}
            candidates = [b for b in data.get("beds", []) if str(b.get("roomId")) in room_ids and str(b.get("id")) not in used]
        else:
            raise ServiceError("يرجى تحديد السرير أو الغرفة أو المبنى")

        assigned: list[dict[str, Any]] = []
        skipped: list[str] = []
        for resident_id in payload.residentIds:
            resident = resident_by_id(data, resident_id)
            if not resident:
                skipped.append(str(resident_id))
                continue
            if not candidates:
                skipped.append(str(resident_id))
                continue
            bed = candidates.pop(0)
            if resident.get("bedId"):
                unassign_bed(data, resident)
            assign_bed(data, resident, bed.get("id"))
            # تسكين مباشر: إغلاق آلي لطلب إضافة عامل معلّق مطابق لهذا الساكن
            from app.services.contractor_requests import sync_direct_assignment

            try:
                sync_direct_assignment(data, resident, user)
            except Exception:  # noqa: BLE001
                pass
            assigned.append({"residentId": resident.get("id"), "name": resident.get("name"), "bedId": bed.get("id"), "bedLabel": bed.get("label")})
        from app.services.common import add_audit

        add_audit(data, user, "beds_bulk_assigned", "resident", "", {"count": len(assigned), "skipped": len(skipped)})
        return {"ok": True, "assigned": assigned, "skipped": skipped, "count": len(assigned)}


@router.post("/import")
def import_residents(
    payload: BulkResidentsRequest,
    user: dict[str, Any] = Depends(require_permission("residents.import")),
):
    if not payload.residents:
        raise ServiceError("لا توجد بيانات للاستيراد")
    if len(payload.residents) > 5000:
        raise ServiceError("الحد الأقصى للاستيراد 5000 سجل في المرة الواحدة")

    with store.atomic() as data:
        created = 0
        updated = 0
        errors: list[dict[str, Any]] = []
        for index, raw in enumerate(payload.residents):
            if not isinstance(raw, dict):
                errors.append({"row": index + 1, "error": "سجل غير صالح"})
                continue
            row = dict(raw)
            existing = None
            if row.get("id"):
                existing = resident_by_id(data, row.get("id"))
            if not existing:
                code = clean_str(row.get("employeeCode"))
                card = normalize_card(row.get("cardNumber"))
                for candidate in data.get("residents", []):
                    if code and clean_str(candidate.get("employeeCode")) == code:
                        existing = candidate
                        break
                    if card and normalize_card(candidate.get("cardNumber")) == card:
                        existing = candidate
                        break
            try:
                if existing:
                    update_resident(data, existing, row, user)
                    updated += 1
                else:
                    create_resident(data, row, user)
                    created += 1
            except ServiceError as exc:
                errors.append({"row": index + 1, "name": clean_str(row.get("name")), "error": exc.message})
        return {
            "ok": True,
            "created": created,
            "updated": updated,
            "failed": len(errors),
            "errors": errors[:200],
            "total": len(payload.residents),
        }
