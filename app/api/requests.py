from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import require_any_permission, require_permission
from app.core.state import store
from app.core.housing_scope import scoped_data
from app.core.housing_scope import canonical_housing_type, is_housing_monitor
from app.schemas.schemas import RequestStatusRequest
from app.services.common import clean_str, paged
from app.services.housing import (
    REQUEST_STATUSES,
    REQUEST_TYPES,
    create_housing_request,
    resident_by_id,
    set_request_status,
)

router = APIRouter(prefix="/api/requests", tags=["requests"])


def _ensure_monitor_request_scope(data: dict[str, Any], user: dict[str, Any], item: dict[str, Any]) -> None:
    if not is_housing_monitor(user, data.get("roles")):
        return

    expected = canonical_housing_type(user.get("housingType"))
    if not expected:
        raise HTTPException(status_code=404, detail="الطلب غير موجود ضمن نطاقك")

    resident_id = item.get("residentId")
    resident = next(
        (
            r for r in data.get("residents", [])
            if resident_id is not None and str(r.get("id")) == str(resident_id)
        ),
        None,
    )

    if resident is None and item.get("employeeCode"):
        code = str(item.get("employeeCode"))
        resident = next(
            (
                r for r in data.get("residents", [])
                if str(r.get("employeeCode") or "") == code
            ),
            None,
        )

    if not resident:
        raise HTTPException(status_code=404, detail="الطلب غير موجود ضمن نطاق نوع السكن المخصص لحسابك")

    building_id = resident.get("buildingId")
    building = next(
        (
            b for b in data.get("buildings", [])
            if building_id is not None and str(b.get("id")) == str(building_id)
        ),
        None,
    )

    actual = canonical_housing_type((building or {}).get("housingType"))
    if not actual or actual != expected:
        raise HTTPException(status_code=404, detail="الطلب غير موجود ضمن نطاق نوع السكن المخصص لحسابك")




@router.get("")
def list_requests(
    status: str = "",
    requestType: str = "",
    q: str = "",
    page: int = Query(1, ge=1),
    pageSize: int = Query(50, ge=1, le=500),
    user: dict[str, Any] = Depends(require_any_permission("requests.supervise", "residents.view", "operations.view")),
):
    data = scoped_data(store.read(), user)
    rows = list(data.get("requests", []))
    if status:
        rows = [r for r in rows if clean_str(r.get("status")) == status]
    if requestType:
        rows = [r for r in rows if clean_str(r.get("requestType")) == requestType]
    if q:
        needle = clean_str(q).lower()
        rows = [
            r for r in rows
            if needle in " ".join(
                clean_str(v).lower()
                for v in (r.get("residentName"), r.get("employeeCode"), r.get("details"), r.get("requestType"), r.get("createdBy"))
            )
        ]
    payload = paged(rows, page, pageSize)
    payload["data"] = payload["items"]
    payload["types"] = REQUEST_TYPES
    payload["statuses"] = REQUEST_STATUSES
    payload["summary"] = {
        "total": len(data.get("requests", [])),
        "pending": len([r for r in data.get("requests", []) if r.get("status") == "قيد المراجعة"]),
    }
    return payload


@router.get("/{request_id}")
def get_request(
    request_id: str,
    user: dict[str, Any] = Depends(require_any_permission("requests.supervise", "residents.view", "operations.view")),
):
    data = scoped_data(store.read(), user)
    item = next((r for r in data.get("requests", []) if str(r.get("id")) == str(request_id)), None)
    if not item:
        raise HTTPException(status_code=404, detail="الطلب غير موجود")
    resident = resident_by_id(data, item.get("residentId"))
    return {**item, "resident": resident}


@router.post("", status_code=201)
def add_request(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(require_permission("residents.manage")),
):
    with store.atomic() as data:
        return create_housing_request(data, payload, user)


@router.patch("/{request_id}/status")
@router.post("/{request_id}/status")
def change_status(
    request_id: str,
    payload: RequestStatusRequest,
    user: dict[str, Any] = Depends(require_any_permission("requests.supervise", "requests.housing_internal", "requests.housing_external")),
):
    with store.atomic() as data:
        item = next((r for r in data.get("requests", []) if str(r.get("id")) == str(request_id)), None)
        if not item:
            raise HTTPException(status_code=404, detail="الطلب غير موجود")
        _ensure_monitor_request_scope(data, user, item)
        return set_request_status(data, item, payload.status, payload.notes, user)


@router.delete("/{request_id}")
def delete_request(
    request_id: str,
    user: dict[str, Any] = Depends(require_permission("requests.supervise")),
):
    with store.atomic() as data:
        before = len(data.get("requests", []))
        data["requests"] = [r for r in data.get("requests", []) if str(r.get("id")) != str(request_id)]
        if len(data["requests"]) == before:
            raise HTTPException(status_code=404, detail="الطلب غير موجود")
        from app.services.common import add_audit

        add_audit(data, user, "request_deleted", "housing_request", request_id)
        return {"ok": True, "message": "تم حذف الطلب"}
