from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import require_any_permission, require_permission
from app.core.permissions import effective_permissions
from app.core.state import store
from app.schemas.schemas import LinkWorkersRequest
from app.services.admin import (
    contractor_portal,
    create_contractor,
    delete_contractor,
    link_residents,
    unlink_resident,
    update_contractor,
)
from app.services.common import ServiceError, clean_str, paged
from app.services.contractor_requests import request_payload
from app.services.housing import (
    building_by_id,
    contractor_by_id,
    contractor_payload,
    contractor_stats,
    residents_for_contractor,
    room_by_id,
)

router = APIRouter(prefix="/api/contractors", tags=["contractors"])


def _require_portal_access(data: dict[str, Any], user: dict[str, Any], contractor_id: str) -> None:
    permissions = set(effective_permissions(user, data.get("roles", [])))
    if "contractors.manage" in permissions or "housing.view" in permissions or "residents.view" in permissions:
        return
    if "contractor.portal" in permissions and str(user.get("contractorId")) == str(contractor_id):
        return
    raise HTTPException(status_code=403, detail="لا تملك صلاحية عرض هذا المتعهد")


@router.get("")
def list_contractors(
    q: str = "",
    status: str = "",
    page: int = 1,
    pageSize: int = 100,
    user: dict[str, Any] = Depends(require_any_permission("contractors.manage", "housing.view", "residents.view")),
):
    data = store.read()
    rows = [contractor_payload(data, c) for c in data.get("contractors", [])]
    if status:
        rows = [r for r in rows if clean_str(r.get("status")) == status]
    if q:
        needle = clean_str(q).lower()
        rows = [
            r for r in rows
            if needle in " ".join(
                clean_str(v).lower()
                for v in (r.get("name"), r.get("contactPhone"), r.get("contactEmail"), " ".join(r.get("buildingNames") or []))
            )
        ]
    return paged(rows, page, pageSize)


@router.get("/{contractor_id}")
def get_contractor(
    contractor_id: str,
    user: dict[str, Any] = Depends(require_any_permission("contractors.manage", "housing.view", "residents.view")),
):
    data = store.read()
    contractor = contractor_by_id(data, contractor_id)
    if not contractor:
        raise HTTPException(status_code=404, detail="المتعهد غير موجود")
    return contractor_payload(data, contractor)


@router.get("/{contractor_id}/stats")
def get_stats(
    contractor_id: str,
    user: dict[str, Any] = Depends(require_any_permission("contractors.manage", "housing.view", "reports.view")),
):
    data = store.read()
    contractor = contractor_by_id(data, contractor_id)
    if not contractor:
        raise HTTPException(status_code=404, detail="المتعهد غير موجود")
    return contractor_stats(data, contractor)


@router.get("/{contractor_id}/workers")
def get_workers(
    contractor_id: str,
    user: dict[str, Any] = Depends(require_any_permission("contractors.manage", "housing.view")),
):
    data = store.read()
    contractor = contractor_by_id(data, contractor_id)
    if not contractor:
        raise HTTPException(status_code=404, detail="المتعهد غير موجود")
    from app.services.housing import resident_payload

    workers = [resident_payload(data, r) for r in residents_for_contractor(data, contractor_id)]
    return {"items": workers, "total": len(workers)}


@router.post("", status_code=201)
def add_contractor(payload: dict[str, Any], user: dict[str, Any] = Depends(require_permission("contractors.manage"))):
    with store.atomic() as data:
        contractor = create_contractor(data, payload, user)
        return contractor_payload(data, contractor)


@router.put("/{contractor_id}")
@router.patch("/{contractor_id}")
def edit_contractor(
    contractor_id: str,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(require_permission("contractors.manage")),
):
    with store.atomic() as data:
        contractor = contractor_by_id(data, contractor_id)
        if not contractor:
            raise HTTPException(status_code=404, detail="المتعهد غير موجود")
        update_contractor(data, contractor, payload, user)
        return contractor_payload(data, contractor)


@router.delete("/{contractor_id}")
def remove_contractor(contractor_id: str, user: dict[str, Any] = Depends(require_permission("contractors.manage"))):
    with store.atomic() as data:
        contractor = contractor_by_id(data, contractor_id)
        if not contractor:
            raise HTTPException(status_code=404, detail="المتعهد غير موجود")
        name = contractor.get("name")
        delete_contractor(data, contractor, user)
        return {"ok": True, "message": f"تم حذف المتعهد {name}"}


@router.post("/{contractor_id}/link-workers")
def link_workers(
    contractor_id: str,
    payload: LinkWorkersRequest,
    user: dict[str, Any] = Depends(require_permission("contractors.manage")),
):
    if not payload.residentIds:
        raise ServiceError("يرجى اختيار ساكن واحد على الأقل")
    with store.atomic() as data:
        contractor = contractor_by_id(data, contractor_id)
        if not contractor:
            raise HTTPException(status_code=404, detail="المتعهد غير موجود")
        changed = link_residents(data, contractor, payload.residentIds, user)
        return {"ok": True, "linked": changed}


@router.delete("/{contractor_id}/workers/{resident_id}")
def unlink_worker(
    contractor_id: str,
    resident_id: str,
    user: dict[str, Any] = Depends(require_permission("contractors.manage")),
):
    with store.atomic() as data:
        from app.services.housing import resident_by_id

        contractor = contractor_by_id(data, contractor_id)
        if not contractor:
            raise HTTPException(status_code=404, detail="المتعهد غير موجود")
        resident = resident_by_id(data, resident_id)
        if not resident or str(resident.get("contractorId")) != str(contractor_id):
            raise HTTPException(status_code=404, detail="العامل غير مرتبط بهذا المتعهد")
        unlink_resident(data, resident, user)
        return {"ok": True, "message": "تم فصل العامل عن المتعهد"}


@router.get("/{contractor_id}/free-beds")
def get_free_beds(
    contractor_id: str,
    user: dict[str, Any] = Depends(require_any_permission("requests.supervise", "housing.manage")),
):
    """الأسرّة الفعلية المتاحة لدى المتعهد — يستخدمها مشرف السكن لتحديد الغرفة/السرير."""
    data = store.read()
    contractor = contractor_by_id(data, contractor_id)
    if not contractor:
        raise HTTPException(status_code=404, detail="المتعهد غير موجود")
    from app.services.housing import free_beds_for_contractor

    beds = []
    for bed in free_beds_for_contractor(data, contractor_id):
        room = room_by_id(data, bed.get("roomId"))
        building = building_by_id(data, (room or {}).get("buildingId"))
        beds.append({
            "id": bed.get("id"),
            "label": clean_str(bed.get("label")),
            "roomId": (room or {}).get("id"),
            "roomName": clean_str((room or {}).get("name")),
            "buildingId": (building or {}).get("id"),
            "buildingName": clean_str((building or {}).get("name")),
        })
    return {"items": beds, "total": len(beds)}


@router.get("/{contractor_id}/portal")
def portal(contractor_id: str, user: dict[str, Any] = Depends(require_any_permission("contractor.portal", "contractors.manage"))):
    data = store.read()
    _require_portal_access(data, user, contractor_id)
    result = contractor_portal(data, contractor_id)
    result["requests"] = [request_payload(data, r) for r in result.get("requests", [])]
    return result
