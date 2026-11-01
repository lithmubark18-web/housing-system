from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_current_user
from app.core.state import store
from app.core.housing_scope import scoped_data
from app.services.common import mark_notification_read, notifications_for

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
def list_notifications(unreadOnly: bool = False, user: dict[str, Any] = Depends(get_current_user)):
    data = scoped_data(store.read(), user)
    items = notifications_for(data, user, data.get("roles", []))
    unread = [item for item in items if not item.get("read")]
    if unreadOnly:
        items = unread
    return {"items": items, "total": len(items), "unread": len(unread)}


@router.get("/unread-count")
def unread_count(user: dict[str, Any] = Depends(get_current_user)):
    data = scoped_data(store.read(), user)
    items = notifications_for(data, user, data.get("roles", []))
    return {"unread": len([item for item in items if not item.get("read")])}


@router.post("/read-all")
def read_all(user: dict[str, Any] = Depends(get_current_user)):
    with store.atomic() as data:
        changed = mark_notification_read(data, user, None)
        return {"ok": True, "read": changed}


@router.post("/{notification_id}/read")
def read_one(notification_id: str, user: dict[str, Any] = Depends(get_current_user)):
    with store.atomic() as data:
        exists = any(str(n.get("id")) == str(notification_id) for n in data.get("notifications", []))
        if not exists:
            raise HTTPException(status_code=404, detail="الإشعار غير موجود")
        mark_notification_read(data, user, notification_id)
        return {"ok": True}
