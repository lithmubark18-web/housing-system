from __future__ import annotations

from typing import Any

from app.core.permissions import (
    PERMISSION_IDS,
    ROLE_DEFAULT_BY_ROLE,
    ROLE_LABELS,
    SYSTEM_ROLES,
    default_role_id,
    effective_permissions,
    public_user,
)
from app.core.security import hash_password
from app.core.state import contractor_department_for_name
from app.services.common import (
    ServiceError,
    add_audit,
    add_notification,
    clean_str,
    int_value,
    new_id,
    now_iso,
)
from app.services.housing import (
    by_id,
    building_by_id,
    contractor_by_id,
    contractor_payload,
    residents_for_contractor,
)


def role_name_for_id(data: dict[str, Any], role_id: str) -> str:
    role = by_id(data.get("roles", []), role_id)
    perms = set((role or {}).get("permissionIds") or [])
    if role_id == "r_admin" or "admin.users" in perms:
        return "admin"
    if "contractor.portal" in perms:
        return "contractor"
    if "requests.supervise" in perms:
        return "housingSupervisor"
    if "requests.security" in perms:
        return "securitySupervisor"
    if "requests.visitor" in perms:
        return "visitorSupervisor"
    return "housingSupervisor"


def _username_taken(data: dict[str, Any], username: str, except_id: str | None = None) -> bool:
    target = username.strip().lower()
    return any(
        str(u.get("username", "")).strip().lower() == target and str(u.get("id")) != str(except_id or "")
        for u in data.get("users", [])
    )


def create_user(data: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    name = clean_str(payload.get("name"))
    username = clean_str(payload.get("username"))
    password = str(payload.get("password") or "")
    role_id = clean_str(payload.get("roleId")) or default_role_id(payload)
    if not name:
        raise ServiceError("يرجى إدخال الاسم")
    if not username:
        raise ServiceError("يرجى إدخال اسم المستخدم")
    if " " in username:
        raise ServiceError("اسم المستخدم لا يجب أن يحتوي مسافات")
    if _username_taken(data, username):
        raise ServiceError("اسم المستخدم مستخدم مسبقاً", 409)
    if len(password) < 6:
        raise ServiceError("كلمة المرور يجب أن تكون 6 أحرف على الأقل")
    if not by_id(data.get("roles", []), role_id):
        raise ServiceError("الدور المحدد غير موجود", 404)
    contractor_id = payload.get("contractorId") or None
    contractor = contractor_by_id(data, contractor_id) if contractor_id else None
    if role_id == "r_contractor" and not contractor:
        raise ServiceError("يجب ربط حساب المتعهد بمتعهد موجود")
    user = {
        "id": new_id("u_"),
        "name": name,
        "username": username,
        "passwordHash": hash_password(password),
        "role": role_name_for_id(data, role_id),
        "roleId": role_id,
        "phone": clean_str(payload.get("phone")),
        "contractorId": contractor.get("id") if contractor else None,
        "contractorName": clean_str((contractor or {}).get("name")),
        "companyName": clean_str(payload.get("companyName")),
        "permissionIds": [],
        "isActive": payload.get("isActive", True) is not False,
        "mustChangePassword": bool(payload.get("mustChangePassword")),
        "tokenVersion": 0,
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }
    data.setdefault("users", []).insert(0, user)
    add_audit(data, actor, "user_created", "user", user["id"], {"username": username, "roleId": role_id})
    return user


def update_user(data: dict[str, Any], user: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    actor_id = str((actor or {}).get("id"))
    if "name" in payload:
        if not clean_str(payload.get("name")):
            raise ServiceError("يرجى إدخال الاسم")
        user["name"] = clean_str(payload.get("name"))
    if "username" in payload:
        username = clean_str(payload.get("username"))
        if not username:
            raise ServiceError("يرجى إدخال اسم المستخدم")
        if _username_taken(data, username, str(user.get("id"))):
            raise ServiceError("اسم المستخدم مستخدم مسبقاً", 409)
        user["username"] = username
    if "roleId" in payload:
        role_id = clean_str(payload.get("roleId"))
        if not by_id(data.get("roles", []), role_id):
            raise ServiceError("الدور المحدد غير موجود", 404)
        user["roleId"] = role_id
        user["role"] = role_name_for_id(data, role_id)
    if "contractorId" in payload:
        contractor_id = payload.get("contractorId") or None
        contractor = contractor_by_id(data, contractor_id) if contractor_id else None
        user["contractorId"] = contractor.get("id") if contractor else None
        user["contractorName"] = clean_str((contractor or {}).get("name"))
    if "phone" in payload:
        user["phone"] = clean_str(payload.get("phone"))
    if "companyName" in payload:
        user["companyName"] = clean_str(payload.get("companyName"))
    if "isActive" in payload:
        active = payload.get("isActive") is not False
        if str(user.get("id")) == actor_id and not active:
            raise ServiceError("لا يمكنك تعطيل حسابك الحالي")
        if user.get("roleId") == "r_admin" and not active:
            _ensure_not_last_admin(data, user)
        user["isActive"] = active
    password = str(payload.get("password") or "")
    if password:
        if len(password) < 6:
            raise ServiceError("كلمة المرور يجب أن تكون 6 أحرف على الأقل")
        user["passwordHash"] = hash_password(password)
        user["tokenVersion"] = int_value(user.get("tokenVersion")) + 1
        user["mustChangePassword"] = bool(payload.get("mustChangePassword", False))
        user["passwordChangedAt"] = now_iso()
    if "mustChangePassword" in payload:
        user["mustChangePassword"] = bool(payload.get("mustChangePassword"))
    user["updatedAt"] = now_iso()
    add_audit(data, actor, "user_updated", "user", user.get("id"), {"username": user.get("username")})
    return user


def _ensure_not_last_admin(data: dict[str, Any], user: dict[str, Any]) -> None:
    admins = [
        u for u in data.get("users", [])
        if u.get("roleId") == "r_admin" and u.get("isActive", True) is not False
    ]
    if len(admins) <= 1 and str(admins[0].get("id")) == str(user.get("id")):
        raise ServiceError("لا يمكن إزالة أو تعطيل آخر مدير نظام نشط", 409)


def delete_user(data: dict[str, Any], user: dict[str, Any], actor: dict[str, Any] | None = None) -> None:
    if str(user.get("id")) == str((actor or {}).get("id")):
        raise ServiceError("لا يمكنك حذف حسابك الحالي", 409)
    if user.get("roleId") == "r_admin":
        _ensure_not_last_admin(data, user)
    data["users"] = [u for u in data.get("users", []) if str(u.get("id")) != str(user.get("id"))]
    add_audit(data, actor, "user_deleted", "user", user.get("id"), {"username": user.get("username")})


def reset_user_password(data: dict[str, Any], user: dict[str, Any], password: str, actor: dict[str, Any] | None = None) -> None:
    if len(password) < 6:
        raise ServiceError("كلمة المرور يجب أن تكون 6 أحرف على الأقل")
    user["passwordHash"] = hash_password(password)
    user["tokenVersion"] = int_value(user.get("tokenVersion")) + 1
    user["mustChangePassword"] = True
    user["passwordChangedAt"] = now_iso()
    add_audit(data, actor, "user_password_reset", "user", user.get("id"), {"username": user.get("username")})


def _sanitize_permissions(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    return [p for p in PERMISSION_IDS if p in {str(v) for v in values}]


def create_role(data: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    name = clean_str(payload.get("name"))
    if not name:
        raise ServiceError("يرجى إدخال اسم الدور")
    if any(clean_str(r.get("name")) == name for r in data.get("roles", [])):
        raise ServiceError("يوجد دور بنفس الاسم", 409)
    role = {
        "id": new_id("r_"),
        "name": name,
        "description": clean_str(payload.get("description")),
        "isSystem": False,
        "permissionIds": _sanitize_permissions(payload.get("permissionIds")),
        "createdAt": now_iso(),
    }
    data.setdefault("roles", []).append(role)
    add_audit(data, actor, "role_created", "role", role["id"], {"name": name})
    return role


def update_role(data: dict[str, Any], role: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    if "name" in payload:
        name = clean_str(payload.get("name"))
        if not name:
            raise ServiceError("يرجى إدخال اسم الدور")
        if any(clean_str(r.get("name")) == name and r.get("id") != role.get("id") for r in data.get("roles", [])):
            raise ServiceError("يوجد دور بنفس الاسم", 409)
        role["name"] = name
    if "description" in payload:
        role["description"] = clean_str(payload.get("description"))
    if "permissionIds" in payload:
        if role.get("id") == "r_admin":
            role["permissionIds"] = list(PERMISSION_IDS)
        else:
            role["permissionIds"] = _sanitize_permissions(payload.get("permissionIds"))
    role["updatedAt"] = now_iso()
    add_audit(data, actor, "role_updated", "role", role.get("id"), {"name": role.get("name")})
    return role


def delete_role(data: dict[str, Any], role: dict[str, Any], actor: dict[str, Any] | None = None) -> None:
    if role.get("isSystem") or str(role.get("id")) in {r["id"] for r in SYSTEM_ROLES}:
        raise ServiceError("لا يمكن حذف الأدوار النظامية", 409)
    if any(str(u.get("roleId")) == str(role.get("id")) for u in data.get("users", [])):
        raise ServiceError("لا يمكن حذف دور مرتبط بمستخدمين", 409)
    data["roles"] = [r for r in data.get("roles", []) if str(r.get("id")) != str(role.get("id"))]
    add_audit(data, actor, "role_deleted", "role", role.get("id"), {"name": role.get("name")})


def users_payload(data: dict[str, Any]) -> list[dict[str, Any]]:
    return [public_user(u, data.get("roles", [])) for u in data.get("users", [])]


# ---------------------------------------------------------------------------
# المتعهدون
# ---------------------------------------------------------------------------

def create_contractor(data: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    name = clean_str(payload.get("name"))
    if not name:
        raise ServiceError("يرجى إدخال اسم المتعهد/المقاول")
    if any(clean_str(c.get("name")) == name for c in data.get("contractors", [])):
        raise ServiceError("يوجد متعهد بنفس الاسم", 409)
    building_ids = [str(v) for v in (payload.get("buildingIds") or [])]
    if not building_ids:
        raise ServiceError("يرجى اختيار مبنى واحد على الأقل")
    for bid in building_ids:
        if not building_by_id(data, bid):
            raise ServiceError("أحد المباني المحددة غير موجود", 404)
    contractor = {
        "id": new_id("ctr_"),
        "name": name,
        "contractorType": clean_str(payload.get("contractorType")) or "general",
        "department": (
            clean_str(payload.get("department"))
            or contractor_department_for_name(name)
        ),
        "contactPhone": clean_str(payload.get("contactPhone")),
        "contactEmail": clean_str(payload.get("contactEmail")),
        "status": clean_str(payload.get("status")) or "active",
        "buildingIds": building_ids,
        "bedQuota": max(0, int_value(payload.get("bedQuota"))),
        "notes": clean_str(payload.get("notes")),
        "createdAt": now_iso(),
    }
    data.setdefault("contractors", []).append(contractor)
    add_audit(data, actor, "contractor_created", "contractor", contractor["id"], {"name": name})
    return contractor


def update_contractor(data: dict[str, Any], contractor: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    if "name" in payload:
        name = clean_str(payload.get("name"))
        if not name:
            raise ServiceError("يرجى إدخال اسم المتعهد/المقاول")
        if any(clean_str(c.get("name")) == name and c.get("id") != contractor.get("id") for c in data.get("contractors", [])):
            raise ServiceError("يوجد متعهد بنفس الاسم", 409)
        contractor["name"] = name
    if "buildingIds" in payload:
        building_ids = [str(v) for v in (payload.get("buildingIds") or [])]
        if not building_ids:
            raise ServiceError("يرجى اختيار مبنى واحد على الأقل")
        for bid in building_ids:
            if not building_by_id(data, bid):
                raise ServiceError("أحد المباني المحددة غير موجود", 404)
        removed = {str(v) for v in (contractor.get("buildingIds") or [])} - set(building_ids)
        workers = residents_for_contractor(data, contractor.get("id"))
        conflict = [w for w in workers if str(w.get("buildingId")) in removed]
        if conflict:
            raise ServiceError("لا يمكن إزالة مبنى يحتوي عمالاً مسكّنين لهذا المتعهد", 409)
        contractor["buildingIds"] = building_ids
    for field, default in (("contractorType", "general"), ("contactPhone", ""), ("contactEmail", ""), ("status", "active"), ("notes", "")):
        if field in payload:
            contractor[field] = clean_str(payload.get(field)) or default
    if "department" in payload:
        department = clean_str(payload.get("department"))
        contractor["department"] = department or contractor_department_for_name(str(contractor.get("name") or ""))
    if "bedQuota" in payload:
        contractor["bedQuota"] = max(0, int_value(payload.get("bedQuota")))
    contractor["updatedAt"] = now_iso()
    add_audit(data, actor, "contractor_updated", "contractor", contractor.get("id"), {"name": contractor.get("name")})
    return contractor


def delete_contractor(data: dict[str, Any], contractor: dict[str, Any], actor: dict[str, Any] | None = None) -> None:
    workers = residents_for_contractor(data, contractor.get("id"))
    if workers:
        raise ServiceError("لا يمكن حذف متعهد مرتبط بعمال مسكّنين", 409)
    if any(str(u.get("contractorId")) == str(contractor.get("id")) for u in data.get("users", [])):
        raise ServiceError("لا يمكن حذف متعهد مرتبط بمستخدم دخول", 409)
    data["contractors"] = [c for c in data.get("contractors", []) if str(c.get("id")) != str(contractor.get("id"))]
    add_audit(data, actor, "contractor_deleted", "contractor", contractor.get("id"), {"name": contractor.get("name")})


def link_residents(data: dict[str, Any], contractor: dict[str, Any], resident_ids: list[str], actor: dict[str, Any] | None = None) -> int:
    changed = 0
    ids = {str(v) for v in resident_ids}
    for resident in data.get("residents", []):
        if str(resident.get("id")) in ids:
            resident["contractorId"] = contractor.get("id")
            resident["company"] = clean_str(contractor.get("name"))
            resident["updatedAt"] = now_iso()
            changed += 1
    add_audit(data, actor, "contractor_workers_linked", "contractor", contractor.get("id"), {"count": changed})
    return changed


def unlink_resident(data: dict[str, Any], resident: dict[str, Any], actor: dict[str, Any] | None = None) -> None:
    resident["contractorId"] = None
    resident["updatedAt"] = now_iso()
    add_audit(data, actor, "resident_unlinked_from_contractor", "resident", resident.get("id"), {"name": resident.get("name")})


# ---------------------------------------------------------------------------
# الإعدادات
# ---------------------------------------------------------------------------

SETTING_KEYS = {
    "orgName", "orgSubtitle", "buildingLabel", "defaultPageSize",
    "lowVacancyThreshold", "notifyOnRequestStage", "notifyOnLowVacancy",
    "requireEmployeeCode", "minWorkerAge",
}


def update_settings(data: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    settings = data.setdefault("settings", {})
    for key in SETTING_KEYS:
        if key not in payload:
            continue
        value = payload.get(key)
        if key in {"defaultPageSize", "lowVacancyThreshold", "minWorkerAge"}:
            settings[key] = max(1, int_value(value, int_value(settings.get(key), 1)))
        elif key in {"notifyOnRequestStage", "notifyOnLowVacancy", "requireEmployeeCode"}:
            settings[key] = payload.get(key) is not False
        else:
            settings[key] = clean_str(value)
    if isinstance(payload.get("features"), dict):
        features = settings.setdefault("features", {})
        for key, value in payload["features"].items():
            features[str(key)] = value is not False
    add_audit(data, actor, "settings_updated", "settings", "global", {"keys": list(payload.keys())})
    return settings


def contractor_portal(data: dict[str, Any], contractor_id: Any) -> dict[str, Any]:
    contractor = contractor_by_id(data, contractor_id)
    if not contractor:
        raise ServiceError("لا يوجد متعهد مرتبط بالحساب", 404)
    workers = residents_for_contractor(data, contractor_id)
    requests = [
        r for r in data.get("contractorRequests", [])
        if str(r.get("contractorId")) == str(contractor_id)
    ]
    requests.sort(key=lambda r: str(r.get("createdAt") or ""), reverse=True)
    return {
        "contractor": contractor_payload(data, contractor),
        "workers": workers,
        "registeredWorkers": [
            w for w in data.get("contractorWorkers", [])
            if str(w.get("contractorId")) == str(contractor_id)
        ],
        "requests": requests,
    }
