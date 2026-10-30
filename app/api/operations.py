from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, require_any_permission, require_permission
from app.api.contractor_requests import _filter_department, _user_department
from app.core.state import store
from app.services.common import attendance_status, clean_str, is_housing_service, parse_date, today
from app.services.contractor_requests import pending_counts, request_payload
from app.services.housing import buildings_tree, resident_payload
from app.services.reports import attendance_report, duty_report

router = APIRouter(prefix="/api/operations", tags=["operations"])


def _date_or_today(value: str = ""):
    return parse_date(value).date() if parse_date(value) else today()


@router.get("/board")
def board(date: str = "", user: dict[str, Any] = Depends(require_permission("operations.view"))):
    data = store.read()
    on = _date_or_today(date)
    housing = [r for r in data.get("residents", []) if is_housing_service(r)]
    statuses: dict[str, int] = {}
    groups: dict[str, list[dict[str, Any]]] = {}
    for resident in housing:
        status = attendance_status(resident, on) or "غير محدد"
        statuses[status] = statuses.get(status, 0) + 1
        groups.setdefault(status, []).append(resident_payload(data, resident, on))
    # مدير الإدارة يرى طلبات متعهدَي إدارته فقط
    department = _user_department(data, user)
    if department:
        scoped_requests = _filter_department(data, list(data.get("contractorRequests", [])), department)
    else:
        scoped_requests = list(data.get("contractorRequests", []))
    pending_requests = [request_payload(data, r) for r in scoped_requests if r.get("stage") not in {"done", "rejected"}]
    housing_requests = [r for r in data.get("requests", []) if r.get("status") == "قيد المراجعة"]
    return {
        "date": on.isoformat(),
        "totals": {
            "housingResidents": len(housing),
            "byStatus": statuses,
            "pendingContractorRequests": len(pending_requests),
            "pendingHousingRequests": len(housing_requests),
        },
        "groups": groups,
        "stages": pending_counts({"contractorRequests": scoped_requests}),
        "pendingContractorRequests": pending_requests[:50],
        "pendingHousingRequests": housing_requests[:50],
        "buildings": buildings_tree(data),
        "recentActivity": data.get("auditLog", [])[:12],
    }


@router.get("/attendance")
def attendance(
    groupBy: str = "company",
    date: str = "",
    user: dict[str, Any] = Depends(require_permission("operations.view")),
):
    data = store.read()
    return attendance_report(data, groupBy, _date_or_today(date))


@router.get("/duty")
def duty(date: str = "", user: dict[str, Any] = Depends(require_permission("operations.view"))):
    data = store.read()
    return duty_report(data, _date_or_today(date))


@router.get("/residents")
def residents_by_status(
    status: str = "",
    q: str = "",
    user: dict[str, Any] = Depends(require_any_permission("operations.view", "residents.view")),
):
    data = store.read()
    on = today()
    needle = clean_str(q).lower()
    rows: list[dict[str, Any]] = []
    for resident in data.get("residents", []):
        if not is_housing_service(resident):
            continue
        current = attendance_status(resident, on)
        if status and current != clean_str(status):
            continue
        item = resident_payload(data, resident, on)
        if needle and needle not in " ".join(
            clean_str(item.get(k)).lower() for k in ("name", "employeeCode", "company", "location")
        ):
            continue
        rows.append(item)
    rows.sort(key=lambda r: (clean_str(r.get("buildingName")), clean_str(r.get("roomName")), clean_str(r.get("bedLabel"))))
    return {"items": rows, "total": len(rows)}
