from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_user
from app.core.permissions import effective_permissions
from app.core.state import store
from app.core.housing_scope import scoped_data
from app.services.common import clean_str
from app.services.contractor_requests import request_payload

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/search")
def global_search(
    q: str = Query("", min_length=0),
    limit: int = Query(8, ge=1, le=25),
    user: dict[str, Any] = Depends(get_current_user),
):
    data = scoped_data(store.read(), user)
    permissions = set(effective_permissions(user, data.get("roles", [])))
    needle = clean_str(q).lower()
    if not needle:
        return {"query": "", "groups": {}, "total": 0}

    groups: dict[str, list[dict[str, Any]]] = {}

    if permissions & {"residents.view", "residents.manage"}:
        rows = []
        for resident in data.get("residents", []):
            haystack = " ".join(
                clean_str(resident.get(k)).lower()
                for k in ("name", "employeeCode", "cardNumber", "phone", "company", "department")
            )
            if needle in haystack:
                rows.append({
                    "id": resident.get("id"),
                    "title": resident.get("name"),
                    "subtitle": " • ".join(filter(None, [resident.get("employeeCode"), resident.get("company")])),
                    "href": f"/residents?highlight={resident.get('id')}",
                })
            if len(rows) >= limit:
                break
        if rows:
            groups["residents"] = rows

    if permissions & {"housing.view", "housing.manage"}:
        rows = []
        for building in data.get("buildings", []):
            if needle in clean_str(building.get("name")).lower() or needle in clean_str(building.get("location")).lower():
                rows.append({
                    "id": building.get("id"),
                    "title": building.get("name"),
                    "subtitle": clean_str(building.get("location")) or "مبنى",
                    "href": f"/housing?buildingId={building.get('id')}",
                })
        for room in data.get("rooms", []):
            if needle in clean_str(room.get("name")).lower():
                rows.append({
                    "id": room.get("id"),
                    "title": room.get("name"),
                    "subtitle": "غرفة",
                    "href": f"/housing?roomId={room.get('id')}",
                })
            if len(rows) >= limit:
                break
        if rows:
            groups["housing"] = rows[:limit]

    if permissions & {"contractors.manage", "housing.view", "reports.view"}:
        rows = [
            {
                "id": c.get("id"),
                "title": c.get("name"),
                "subtitle": clean_str(c.get("contactPhone")) or "متعهد",
                "href": f"/contractors?highlight={c.get('id')}",
            }
            for c in data.get("contractors", [])
            if needle in clean_str(c.get("name")).lower() or needle in clean_str(c.get("contactPhone")).lower()
        ]
        if rows:
            groups["contractors"] = rows[:limit]

    if permissions & {"requests.supervise", "requests.security", "requests.visitor"}:
        rows = [
            {
                "id": r.get("id"),
                "title": r.get("workerName"),
                "subtitle": f"{r.get('contractorName')} • {clean_str(r.get('stage'))}",
                "href": f"/requests?highlight={r.get('id')}",
            }
            for r in data.get("contractorRequests", [])
            if needle in " ".join(
                clean_str(r.get(k)).lower() for k in ("workerName", "workerCardNumber", "employeeCode", "contractorName")
            )
        ]
        if rows:
            groups["requests"] = rows[:limit]

    if permissions & {"admin.users"}:
        rows = [
            {
                "id": u.get("id"),
                "title": u.get("name"),
                "subtitle": clean_str(u.get("username")),
                "href": f"/admin?tab=users&highlight={u.get('id')}",
            }
            for u in data.get("users", [])
            if needle in clean_str(u.get("name")).lower() or needle in clean_str(u.get("username")).lower()
        ]
        if rows:
            groups["users"] = rows[:limit]

    return {"query": q, "groups": groups, "total": sum(len(v) for v in groups.values())}
