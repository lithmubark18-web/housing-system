from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import require_any_permission, require_permission
from app.core.state import store
from app.core.housing_scope import scoped_data
from app.core.housing_scope import (
    ensure_monitor_bed_scope,
    ensure_monitor_guest_scope,
    is_housing_monitor,
)
from app.services.guests import (
    create_guest,
    delete_guest,
    end_guest,
    extend_guest,
    guest_payload,
    guests_report_rows,
)
from app.services.common import clean_str, paged

router = APIRouter(prefix="/api/guests", tags=["guests"])


class GuestCreate(BaseModel):
    name: str = ""
    cardNumber: str = ""
    birthDate: str = ""
    birthPlace: str = ""
    fromPlace: str = ""
    department: str = ""
    approvalBy: str = ""
    visitPurpose: str = ""
    startDate: str = ""
    days: int = Field(default=1, ge=1, le=90)
    bedId: str = ""
    notes: str = ""


class GuestExtend(BaseModel):
    days: int = Field(default=1, ge=1, le=90)
    reason: str = ""
    approvalBy: str = ""
    sameHousing: bool = True
    newBedId: str = ""


class GuestEnd(BaseModel):
    reason: str = ""


@router.get("")
def list_guests(
    status: str = "",
    q: str = "",
    page: int = 1,
    pageSize: int = 50,
    user: dict[str, Any] = Depends(require_any_permission("guests.view", "guests.manage")),
):
    data = scoped_data(store.read(), user)
    rows = guests_report_rows(data, status=clean_str(status), q=q)
    return paged(rows, page, pageSize)


@router.post("")
def add_guest(
    payload: GuestCreate,
    user: dict[str, Any] = Depends(require_any_permission("guests.manage", "housing.manage")),
):
    with store.atomic() as data:
        if is_housing_monitor(user):
            ensure_monitor_bed_scope(data, user, payload.bedId)
        guest = create_guest(data, payload.model_dump(), user)
        return guest_payload(data, guest)


@router.post("/{guest_id}/extend")
def extend(
    guest_id: str,
    payload: GuestExtend,
    user: dict[str, Any] = Depends(require_any_permission("guests.manage", "housing.manage")),
):
    with store.atomic() as data:
        if is_housing_monitor(user):
            current = next((g for g in data.get("guests", []) if str(g.get("id")) == str(guest_id)), None)
            ensure_monitor_guest_scope(data, user, current)
            selected_bed = current.get("bedId") if payload.sameHousing else payload.newBedId
            ensure_monitor_bed_scope(data, user, selected_bed)
        guest = extend_guest(data, guest_id, payload.model_dump(), user)
        return guest_payload(data, guest)


@router.post("/{guest_id}/end")
def end(
    guest_id: str,
    payload: GuestEnd,
    user: dict[str, Any] = Depends(require_any_permission("guests.manage", "housing.manage")),
):
    with store.atomic() as data:
        if is_housing_monitor(user):
            current = next((g for g in data.get("guests", []) if str(g.get("id")) == str(guest_id)), None)
            ensure_monitor_guest_scope(data, user, current)
        guest = end_guest(data, guest_id, payload.model_dump(), user)
        return guest_payload(data, guest)


@router.delete("/{guest_id}")
def remove_guest(
    guest_id: str,
    user: dict[str, Any] = Depends(require_permission("guests.manage")),
):
    data = scoped_data(store.read(), user)
    from app.core.permissions import effective_permissions

    perms = set(effective_permissions(user, data.get("roles", [])))
    if perms & {"residents.manage", "housing.manage"} and not perms & {"guests.manage"}:
        raise HTTPException(status_code=403, detail="الحذف لمدير النظام فقط")
    if "guests.manage" not in perms:
        raise HTTPException(status_code=403, detail="لا تملك صلاحية حذف الزوار")
    with store.atomic() as data:
        if is_housing_monitor(user):
            current = next((g for g in data.get("guests", []) if str(g.get("id")) == str(guest_id)), None)
            ensure_monitor_guest_scope(data, user, current)
        delete_guest(data, guest_id, user)
        return {"ok": True}
