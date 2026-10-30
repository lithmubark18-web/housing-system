from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.permissions import PERMISSION_IDS, PERMISSION_LABELS, effective_permissions, public_user
from app.core.state import counts, store
from app.services.admin import contractor_portal
from app.services.common import clean_str, is_staff, now_iso, notifications_for
from app.services.contractor_requests import pending_counts, request_payload
from app.services.housing import buildings_tree, contractor_payload, resident_payload

router = APIRouter(prefix="/api", tags=["bootstrap"])


def _permission_catalog() -> list[dict[str, str]]:
    return [{"id": pid, "label": PERMISSION_LABELS[pid]} for pid in PERMISSION_IDS]


def _contractor_bootstrap(data: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    portal = contractor_portal(data, user.get("contractorId")) if user.get("contractorId") else None
    if portal:
        portal["requests"] = [request_payload(data, r) for r in portal.get("requests", [])]
    return {
        "schemaVersion": data.get("schemaVersion", 3),
        "generatedAt": now_iso(),
        "user": public_user(user, data.get("roles", [])),
        "settings": data.get("settings", {}),
        "permissions": _permission_catalog(),
        "contractorPortal": portal,
        "notifications": notifications_for(data, user, data.get("roles", [])),
        "meta": {
            "mode": store.mode,
            "serverTime": now_iso(),
            "version": settings.app_version,
            "counts": counts(data),
            "pendingCounts": pending_counts(data),
            "role": "contractor",
        },
    }


@router.get("/bootstrap")
def bootstrap(user: dict[str, Any] = Depends(get_current_user)):
    data = store.read()
    roles = data.get("roles", [])
    permissions = set(effective_permissions(user, roles))
    staff = is_staff(user, roles)

    if not staff:
        return _contractor_bootstrap(data, user)

    residents = [resident_payload(data, r) for r in data.get("residents", [])]
    contractors = [contractor_payload(data, c) for c in data.get("contractors", [])]
    contractor_requests = [request_payload(data, r) for r in data.get("contractorRequests", [])]

    payload: dict[str, Any] = {
        "schemaVersion": data.get("schemaVersion", 3),
        "generatedAt": now_iso(),
        "user": public_user(user, roles),
        "buildings": data.get("buildings", []),
        "rooms": data.get("rooms", []),
        "beds": data.get("beds", []),
        "residents": residents,
        "requests": data.get("requests", []),
        "users": [public_user(u, roles) for u in data.get("users", [])],
        "contractors": contractors,
        "contractorWorkers": data.get("contractorWorkers", []),
        "contractorRequests": contractor_requests,
        "roles": roles,
        "rotations": data.get("rotations", []),
        "settings": data.get("settings", {}),
        "permissions": _permission_catalog(),
        "notifications": notifications_for(data, user, roles),
        "meta": {
            "mode": store.mode,
            "serverTime": now_iso(),
            "version": settings.app_version,
            "counts": counts(data),
            "pendingCounts": pending_counts(data),
            "role": "staff",
            "canViewAudit": "audit.view" in permissions,
            "canManageUsers": "admin.users" in permissions,
            "canManageSettings": "admin.settings" in permissions,
        },
    }
    if "audit.view" in permissions:
        payload["auditLog"] = data.get("auditLog", [])[:300]
    if "housing.view" in permissions:
        payload["tree"] = buildings_tree(data)
    return payload


@router.get("/bootstrap/version")
def version():
    data = store.read()
    return {
        "version": settings.app_version,
        "schemaVersion": data.get("schemaVersion", 3),
        "serverTime": now_iso(),
        "counts": counts(data),
        "pendingCounts": pending_counts(data),
        "mode": store.mode,
    }
