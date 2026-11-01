from __future__ import annotations

import json
import os
import tempfile
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.api.deps import require_permission
from app.core.config import settings
from app.core.permissions import PERMISSION_IDS, PERMISSION_LABELS
from app.core.state import LIST_KEYS, counts, normalize_state, store
from app.schemas.schemas import ResetPasswordRequest, RestoreRequest
from app.services.admin import (
    create_role,
    create_user,
    delete_role,
    delete_user,
    reset_user_password,
    update_role,
    update_settings,
    update_user,
    users_payload,
)
from app.services.common import ServiceError, add_audit, build_csv, clean_str, new_id, now_iso, paged

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _find(items: list[dict[str, Any]], item_id: str) -> dict[str, Any]:
    for item in items:
        if str(item.get("id")) == str(item_id):
            return item
    raise HTTPException(status_code=404, detail="العنصر غير موجود")


# ---------------------------------------------------------------------------
# المستخدمون
# ---------------------------------------------------------------------------

@router.get("/users")
def list_users(
    q: str = "",
    user: dict[str, Any] = Depends(require_permission("admin.users")),
):
    data = store.read()
    rows = users_payload(data)
    source_by_id = {
        str(item.get("id")): item
        for item in data.get("users", [])
    }
    source_by_username = {
        str(item.get("username", "")).lower(): item
        for item in data.get("users", [])
    }
    for row in rows:
        source = source_by_id.get(str(row.get("id")))
        if source is None:
            source = source_by_username.get(str(row.get("username", "")).lower())
        row["housingType"] = source.get("housingType") if source else None
    if q:
        needle = clean_str(q).lower()
        rows = [
            r for r in rows
            if needle in " ".join(clean_str(r.get(k)).lower() for k in ("name", "username", "phone", "roleName", "contractorName"))
        ]
    return {"items": rows, "total": len(rows)}


@router.post("/users", status_code=201)
def add_user(payload: dict[str, Any], user: dict[str, Any] = Depends(require_permission("admin.users"))):
    with store.atomic() as data:
        record = create_user(data, payload, user)
        from app.core.permissions import public_user

        return public_user(record, data.get("roles", []))


@router.put("/users/{user_id}")
@router.patch("/users/{user_id}")
def edit_user(
    user_id: str,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(require_permission("admin.users")),
):
    with store.atomic() as data:
        target = _find(data.get("users", []), user_id)
        update_user(data, target, payload, user)
        from app.core.permissions import public_user

        return public_user(target, data.get("roles", []))


@router.delete("/users/{user_id}")
def remove_user(user_id: str, user: dict[str, Any] = Depends(require_permission("admin.users"))):
    with store.atomic() as data:
        target = _find(data.get("users", []), user_id)
        username = target.get("username")
        delete_user(data, target, user)
        return {"ok": True, "message": f"تم حذف المستخدم {username}"}


@router.post("/users/{user_id}/reset-password")
def reset_password(
    user_id: str,
    payload: ResetPasswordRequest,
    user: dict[str, Any] = Depends(require_permission("admin.users")),
):
    with store.atomic() as data:
        target = _find(data.get("users", []), user_id)
        reset_user_password(data, target, payload.new_password, user)
        return {"ok": True, "message": "تم إعادة تعيين كلمة المرور — سيُطلب من المستخدم تغييرها عند الدخول"}


# ---------------------------------------------------------------------------
# الأدوار والصلاحيات
# ---------------------------------------------------------------------------

@router.get("/permissions")
def permissions(user: dict[str, Any] = Depends(require_permission("admin.users"))):
    return {
        "items": [{"id": pid, "label": PERMISSION_LABELS[pid]} for pid in PERMISSION_IDS],
        "total": len(PERMISSION_IDS),
    }


@router.get("/roles")
def list_roles(user: dict[str, Any] = Depends(require_permission("admin.users"))):
    data = store.read()
    roles = data.get("roles", [])
    usage = {str(role.get("id")): 0 for role in roles}
    for account in data.get("users", []):
        role_id = str(account.get("roleId"))
        if role_id in usage:
            usage[role_id] += 1
    rows = [{**role, "userCount": usage.get(str(role.get("id")), 0)} for role in roles]
    return {"items": rows, "total": len(rows)}


@router.post("/roles", status_code=201)
def add_role(payload: dict[str, Any], user: dict[str, Any] = Depends(require_permission("admin.users"))):
    with store.atomic() as data:
        return create_role(data, payload, user)


@router.put("/roles/{role_id}")
@router.patch("/roles/{role_id}")
def edit_role(
    role_id: str,
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(require_permission("admin.users")),
):
    with store.atomic() as data:
        role = _find(data.get("roles", []), role_id)
        return update_role(data, role, payload, user)


@router.delete("/roles/{role_id}")
def remove_role(role_id: str, user: dict[str, Any] = Depends(require_permission("admin.users"))):
    with store.atomic() as data:
        role = _find(data.get("roles", []), role_id)
        delete_role(data, role, user)
        return {"ok": True, "message": "تم حذف الدور"}


# ---------------------------------------------------------------------------
# الإعدادات
# ---------------------------------------------------------------------------

@router.get("/settings")
def get_settings(user: dict[str, Any] = Depends(require_permission("admin.settings"))):
    data = store.read()
    return data.get("settings", {})


@router.put("/settings")
@router.patch("/settings")
def save_settings(payload: dict[str, Any], user: dict[str, Any] = Depends(require_permission("admin.settings"))):
    with store.atomic() as data:
        return update_settings(data, payload, user)


# ---------------------------------------------------------------------------
# سجل العمليات
# ---------------------------------------------------------------------------

@router.get("/audit")
def audit_log(
    entity: str = "",
    action: str = "",
    actorId: str = "",
    q: str = "",
    page: int = Query(1, ge=1),
    pageSize: int = Query(100, ge=1, le=500),
    user: dict[str, Any] = Depends(require_permission("audit.view")),
):
    data = store.read()
    rows = list(data.get("auditLog", []))
    if entity:
        rows = [r for r in rows if clean_str(r.get("entity")) == entity]
    if action:
        rows = [r for r in rows if clean_str(r.get("action")).startswith(action)]
    if actorId:
        rows = [r for r in rows if str(r.get("actorId")) == str(actorId)]
    if q:
        needle = clean_str(q).lower()
        rows = [
            r for r in rows
            if needle in " ".join(
                clean_str(v).lower()
                for v in (r.get("actorName"), r.get("actorUsername"), r.get("action"), r.get("entity"), r.get("entityId"))
            )
        ]
    payload = paged(rows, page, pageSize)
    payload["data"] = payload["items"]
    return payload


@router.delete("/audit")
def clear_audit(user: dict[str, Any] = Depends(require_permission("audit.view"))):
    with store.atomic() as data:
        count = len(data.get("auditLog", []))
        data["auditLog"] = []
        add_audit(data, user, "audit_cleared", "audit", "", {"count": count})
        return {"ok": True, "deleted": count}


# ---------------------------------------------------------------------------
# النسخ الاحتياطي والاستعادة
# ---------------------------------------------------------------------------

@router.get("/backup")
def backup(
    download: bool = False,
    user: dict[str, Any] = Depends(require_permission("admin.backup")),
):
    data = store.snapshot()
    payload = {
        "meta": {
            "app": settings.app_name,
            "version": settings.app_version,
            "exportedAt": now_iso(),
            "schemaVersion": data.get("schemaVersion", 3),
            "counts": counts(data),
            "mode": store.mode,
        },
        "data": data,
    }
    if download:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        filename = f"housing-backup-{now_iso()[:10]}.json"
        return Response(
            content=body,
            media_type="application/json; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    return payload


@router.post("/restore")
def restore(payload: RestoreRequest, user: dict[str, Any] = Depends(require_permission("admin.backup"))):
    if clean_str(payload.confirm).upper() not in {"RESTORE", "استعادة"}:
        raise ServiceError("لتأكيد الاستعادة اكتب كلمة RESTORE")
    incoming = payload.data.get("data") if isinstance(payload.data.get("data"), dict) else payload.data
    if not isinstance(incoming, dict):
        raise ServiceError("ملف النسخة الاحتياطية غير صالح")
    missing = [key for key in ("users", "residents", "buildings") if not isinstance(incoming.get(key), list)]
    if missing:
        raise ServiceError("النسخة الاحتياطية ناقصة: " + ", ".join(missing))
    candidate = json.loads(json.dumps(incoming, ensure_ascii=False))
    normalize_state(candidate)
    active_admins = [
        u for u in candidate.get("users", [])
        if u.get("roleId") == "r_admin" and u.get("isActive", True) is not False
    ]
    if not active_admins:
        raise ServiceError("النسخة الاحتياطية لا تحتوي مدير نظام نشطاً")
    before = counts(store.read())
    store.replace(candidate)
    with store.atomic() as data:
        add_audit(
            data,
            user,
            "state_restored",
            "system",
            "",
            {"before": before, "after": counts(data)},
        )
    return {"ok": True, "message": "تمت استعادة النسخة الاحتياطية", "counts": counts(store.read())}


@router.get("/diagnostics")
def diagnostics(user: dict[str, Any] = Depends(require_permission("admin.settings"))):
    data = store.read()
    return {
        "app": settings.app_name,
        "version": settings.app_version,
        "environment": settings.environment,
        "serverTime": now_iso(),
        "store": store.diagnostics(),
        "securityWarnings": settings.runtime_warnings(),
        "settings": data.get("settings", {}),
        "counts": counts(data),
        "features": data.get("settings", {}).get("features", {}),
    }


@router.post("/import-state")
def import_state(payload: dict[str, Any], user: dict[str, Any] = Depends(require_permission("admin.backup"))):
    """استيراد ملف seed/state خام (بدون غلاف meta)."""
    incoming = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    if not isinstance(incoming, dict):
        raise ServiceError("البيانات غير صالحة")
    unknown = [key for key in incoming if key not in LIST_KEYS and key not in {"settings", "schemaVersion"}]
    candidate = json.loads(json.dumps(incoming, ensure_ascii=False))
    normalize_state(candidate)
    if not any(u.get("roleId") == "r_admin" and u.get("isActive", True) is not False for u in candidate.get("users", [])):
        raise ServiceError("البيانات لا تحتوي مدير نظام نشطاً")
    store.replace(candidate)
    with store.atomic() as data:
        add_audit(data, user, "state_imported", "system", "", {"ignoredKeys": unknown})
    return {"ok": True, "counts": counts(store.read())}


@router.get("/export/users.csv")
def export_users(user: dict[str, Any] = Depends(require_permission("admin.users"))):
    data = store.read()
    roles = {str(r.get("id")): clean_str(r.get("name")) for r in data.get("roles", [])}
    rows = [
        [r.get("name"), r.get("username"), r.get("roleName"), roles.get(str(r.get("roleId")), ""), r.get("phone"), "نعم" if r.get("isActive") else "لا"]
        for r in users_payload(data)
    ]
    content = build_csv(["الاسم", "اسم المستخدم", "الدور", "معرف الدور", "الجوال", "نشط"], rows)
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="users.csv"'},
    )
