from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_current_user, require_any_permission
from app.core.permissions import effective_permissions
from app.core.state import store
from app.core.housing_scope import scoped_data
from app.core.housing_scope import (
    ensure_monitor_bed_scope,
    ensure_monitor_contractor_scope,
    is_housing_monitor,
    monitor_permission,
    monitor_request_visible,
)
from app.schemas.schemas import ApproveRequest, RejectRequest
from app.services.common import clean_str, is_staff, paged
from app.services.housing import contractor_by_id
from app.services.contractor_requests import (
    STAGE_LABELS,
    STAGE_PERMISSION,
    approve_request,
    create_request,
    pending_counts,
    reject_request,
    request_payload,
)

router = APIRouter(prefix="/api/contractor-requests", tags=["contractor-requests"])

ANY_STAGE = ("requests.supervise", "requests.housing_internal", "requests.housing_external", "requests.security", "requests.visitor", "requests.department")


def _user_department(data: dict[str, Any], user: dict[str, Any]) -> str:
    """إدارة مدير الإدارة (فارغ = يرى كل الإدارات)."""
    permissions = set(effective_permissions(user, data.get("roles", [])))
    if "requests.department" not in permissions:
        return ""
    return clean_str(user.get("department"))


def _scope(data: dict[str, Any], user: dict[str, Any]) -> dict[str, Any] | None:
    """يرجع قيد العرض: مدير الإدارة (إدارته فقط) أو حساب متعهد (طلباته فقط) أو None للمشرفين العامين."""
    permissions = set(effective_permissions(user, data.get("roles", [])))
    department = _user_department(data, user)
    if department:
        return {"department": department}
    if is_staff(user, data.get("roles", [])):
        return None
    if "contractor.portal" in permissions:
        return {"contractorId": user.get("contractorId")}
    raise HTTPException(status_code=403, detail="لا تملك صلاحية هذا الإجراء")


def _filter_department(
    data: dict[str, Any],
    rows: list[dict[str, Any]],
    department: str,
) -> list[dict[str, Any]]:
    if not department:
        return rows
    departments = {
        str(c.get("id")): clean_str(c.get("department"))
        for c in data.get("contractors", [])
        if isinstance(c, dict)
    }
    return [r for r in rows if departments.get(str(r.get("contractorId"))) == department]


def _guard_department(data: dict[str, Any], user: dict[str, Any], item: dict[str, Any]) -> None:
    """مدير الإدارة لا يتلاعب بطلبات خارج إدارته."""
    scope = _scope(data, user)
    if scope and scope.get("department"):
        contractor = contractor_by_id(data, item.get("contractorId"))
        if clean_str((contractor or {}).get("department")) != scope["department"]:
            raise HTTPException(status_code=403, detail="الطلب خارج نطاق إدارتك")


def _find(data: dict[str, Any], request_id: str) -> dict[str, Any]:
    item = next((r for r in data.get("contractorRequests", []) if str(r.get("id")) == str(request_id)), None)
    if not item:
        raise HTTPException(status_code=404, detail="الطلب غير موجود")
    return item


def _require_stage(
    user: dict[str, Any],
    data: dict[str, Any],
    stage: str,
    item: dict[str, Any] | None = None,
    bed_id: str = "",
) -> None:
    permission = STAGE_PERMISSION.get(stage)
    if not permission:
        raise HTTPException(status_code=400, detail="مرحلة الاعتماد غير معروفة")
    permissions = set(effective_permissions(user, data.get("roles", [])))
    if stage == "housing" and is_housing_monitor(user):
        required = monitor_permission(user)
        if not required or required not in permissions:
            raise HTTPException(status_code=403, detail="لا تملك صلاحية اعتماد هذا النوع من السكن")
        if item:
            contractor = contractor_by_id(data, item.get("contractorId"))
            ensure_monitor_contractor_scope(data, user, contractor)
            if bed_id:
                ensure_monitor_bed_scope(data, user, bed_id, contractor)
        return
    if permission not in permissions:
        raise HTTPException(status_code=403, detail=f"لا تملك صلاحية اعتماد مرحلة {STAGE_LABELS.get(stage, stage)}")


@router.get("")
def list_requests(
    stage: str = "",
    contractorId: str = "",
    requestType: str = "",
    q: str = "",
    page: int = Query(1, ge=1),
    pageSize: int = Query(50, ge=1, le=500),
    user: dict[str, Any] = Depends(get_current_user),
):
    data = scoped_data(store.read(), user)
    scope = _scope(data, user)
    rows = list(data.get("contractorRequests", []))
    if is_housing_monitor(user):
        rows = [r for r in rows if monitor_request_visible(data, user, r)]
    if scope and scope.get("contractorId"):
        rows = [r for r in rows if str(r.get("contractorId")) == str(scope["contractorId"])]
    elif scope and scope.get("department"):
        rows = _filter_department(data, rows, str(scope["department"]))
    elif contractorId:
        rows = [r for r in rows if str(r.get("contractorId")) == str(contractorId)]
    if stage == "pending":
        rows = [r for r in rows if r.get("stage") not in {"done", "rejected"}]
    elif stage:
        rows = [r for r in rows if str(r.get("stage")) == stage]
    if requestType:
        rows = [r for r in rows if str(r.get("requestType")) == requestType]
    if q:
        needle = clean_str(q).lower()
        rows = [
            r for r in rows
            if needle in " ".join(
                clean_str(v).lower()
                for v in (r.get("workerName"), r.get("workerCardNumber"), r.get("employeeCode"), r.get("contractorName"))
            )
        ]
    rows.sort(key=lambda r: clean_str(r.get("createdAt")), reverse=True)
    payload = paged([request_payload(data, r) for r in rows], page, pageSize)
    payload["data"] = payload["items"]
    if is_housing_monitor(user) or (scope and scope.get("department")):
        payload["counts"] = pending_counts({"contractorRequests": rows})
    else:
        payload["counts"] = pending_counts(data)
    payload["stages"] = STAGE_LABELS
    return payload


@router.get("/pending-counts")
def pending(user: dict[str, Any] = Depends(get_current_user)):
    data = scoped_data(store.read(), user)
    scope = _scope(data, user)
    if is_housing_monitor(user):
        own = [r for r in data.get("contractorRequests", []) if monitor_request_visible(data, user, r)]
        return pending_counts({"contractorRequests": own})
    if scope and scope.get("contractorId"):
        own = [
            r for r in data.get("contractorRequests", [])
            if str(r.get("contractorId")) == str(scope["contractorId"])
        ]
        scoped = {"contractorRequests": own}
        return {
            "total": len([r for r in own if r.get("stage") not in {"done", "rejected"}]),
            "done": len([r for r in own if r.get("stage") == "done"]),
            "rejected": len([r for r in own if r.get("stage") == "rejected"]),
            **pending_counts(scoped),
        }
    if scope and scope.get("department"):
        own = _filter_department(data, list(data.get("contractorRequests", [])), str(scope["department"]))
        return pending_counts({"contractorRequests": own})
    return pending_counts(data)


@router.get("/{request_id}")
def get_request(request_id: str, user: dict[str, Any] = Depends(get_current_user)):
    data = scoped_data(store.read(), user)
    scope = _scope(data, user)
    item = _find(data, request_id)
    if is_housing_monitor(user) and not monitor_request_visible(data, user, item):
        raise HTTPException(status_code=404, detail="الطلب غير موجود ضمن نطاق نوع السكن المخصص لحسابك")
    if scope and scope.get("contractorId") and str(item.get("contractorId")) != str(scope["contractorId"]):
        raise HTTPException(status_code=403, detail="لا تملك صلاحية عرض هذا الطلب")
    _guard_department(data, user, item)
    return request_payload(data, item)


@router.post("", status_code=201)
def add_request(payload: dict[str, Any], user: dict[str, Any] = Depends(get_current_user)):
    data = scoped_data(store.read(), user)
    scope = _scope(data, user)
    forced = scope.get("contractorId") if scope else None
    if not forced and not (set(effective_permissions(user, data.get("roles", []))) & {"contractors.manage", "housing.manage"}):
        raise HTTPException(status_code=403, detail="لا تملك صلاحية إنشاء طلب متعهد")
    with store.atomic() as state:
        item = create_request(state, payload, user, forced_contractor_id=forced)
        return request_payload(state, item)


@router.post("/{request_id}/approve")
def approve(
    request_id: str,
    payload: ApproveRequest,
    stage: str = "",
    user: dict[str, Any] = Depends(require_any_permission(*ANY_STAGE)),
):
    with store.atomic() as data:
        item = _find(data, request_id)
        _guard_department(data, user, item)
        target_stage = clean_str(stage) or str(item.get("stage"))
        _require_stage(user, data, target_stage, item, payload.bedId or item.get("bedId") or "")
        approve_request(
            data,
            item,
            target_stage,
            user,
            employee_code=payload.employeeCode,
            notes=payload.notes,
            bed_id=payload.bedId,
        )
        return request_payload(data, item)


@router.post("/{request_id}/approve-{stage}")
def approve_legacy(
    request_id: str,
    stage: str,
    payload: ApproveRequest | None = None,
    user: dict[str, Any] = Depends(require_any_permission(*ANY_STAGE)),
):
    """توافق مع المسارات القديمة approve-housing / approve-security / approve-visitor."""
    payload = payload or ApproveRequest()
    with store.atomic() as data:
        item = _find(data, request_id)
        _guard_department(data, user, item)
        _require_stage(user, data, stage, item, payload.bedId or item.get("bedId") or "")
        approve_request(
            data,
            item,
            stage,
            user,
            employee_code=payload.employeeCode,
            notes=payload.notes,
            bed_id=payload.bedId,
        )
        return request_payload(data, item)


@router.post("/{request_id}/reject")
def reject(
    request_id: str,
    payload: RejectRequest | None = None,
    user: dict[str, Any] = Depends(require_any_permission(*ANY_STAGE)),
):
    payload = payload or RejectRequest()
    with store.atomic() as data:
        item = _find(data, request_id)
        _guard_department(data, user, item)
        _require_stage(user, data, str(item.get("stage") or ""), item)
        reject_request(data, item, user, payload.notes)
        return request_payload(data, item)
