from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.api.deps import require_permission
from app.core.state import store
from app.core.housing_scope import scoped_data
from app.core.housing_scope import is_housing_monitor
from app.services.common import build_csv, clean_str, date_only, parse_date, today
from app.services.reports import (
    BUILDING_HEADERS,
    EMPLOYEE_HEADERS,
    attendance_report,
    building_rows,
    contractors_report,
    dashboard,
    duty_report,
    employees_rows,
    occupancy_report,
    requests_report,
)

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _date_or_today(value: str = ""):
    return parse_date(value).date() if parse_date(value) else today()


@router.get("/dashboard")
def get_dashboard(date: str = "", user: dict[str, Any] = Depends(require_permission("dashboard.view"))):
    data = scoped_data(store.read(), user)
    return dashboard(data, _date_or_today(date))


@router.get("/attendance")
def get_attendance(
    groupBy: str = "company",
    date: str = "",
    user: dict[str, Any] = Depends(require_permission("reports.view")),
):
    data = scoped_data(store.read(), user)
    return attendance_report(data, groupBy, _date_or_today(date))


@router.get("/occupancy")
def get_occupancy(user: dict[str, Any] = Depends(require_permission("reports.view"))):
    data = scoped_data(store.read(), user)
    return occupancy_report(data)


@router.get("/contractors")
def get_contractors(user: dict[str, Any] = Depends(require_permission("reports.view"))):
    if is_housing_monitor(user):
        raise HTTPException(status_code=403, detail="تقرير المتعهدين مخصص لمدير النظام")
    data = scoped_data(store.read(), user)
    return contractors_report(data)


@router.get("/requests")
def get_requests(user: dict[str, Any] = Depends(require_permission("reports.view"))):
    data = scoped_data(store.read(), user)
    return requests_report(data)


@router.get("/duty")
def get_duty(date: str = "", user: dict[str, Any] = Depends(require_permission("reports.view"))):
    data = scoped_data(store.read(), user)
    return duty_report(data, _date_or_today(date))


CONTRACTOR_HEADERS = [
    "المتعهد", "النوع", "الحالة", "الجوال", "البريد", "المباني",
    "السعة", "المسكنون", "الشاغر", "الأسرّة الفعلية", "الشاغر الفعلي", "نسبة الإشغال %",
]
REQUEST_HEADERS = ["رقم الطلب", "المتعهد", "العامل", "النوع", "المرحلة", "تاريخ الإنشاء", "ملاحظات"]
DUTY_HEADERS = ["الاسم", "الرقم الوظيفي", "الشركة", "الإدارة", "المبنى", "الغرفة", "الحالة", "أيام العمل", "أيام الراحة"]


def _export_rows(data: dict[str, Any], kind: str, on) -> tuple[list[str], list[list[Any]], str]:
    if kind == "employees":
        return EMPLOYEE_HEADERS, employees_rows(data, on), "employees"
    if kind == "buildings":
        return BUILDING_HEADERS, building_rows(data), "buildings"
    if kind == "contractors":
        report = contractors_report(data)
        rows = [
            [
                r.get("name"), r.get("type"), r.get("status"), r.get("contactPhone"), r.get("contactEmail"),
                r.get("buildingNames"), r.get("capacity"), r.get("workerCount"), r.get("freeQuota"),
                r.get("physicalBeds"), r.get("freePhysicalBeds"), r.get("occupancyPercent"),
            ]
            for r in report.get("rows", [])
        ]
        return CONTRACTOR_HEADERS, rows, "contractors"
    if kind == "requests":
        rows = [
            [
                r.get("id"), r.get("contractorName"), r.get("workerName"),
                "إضافة" if r.get("requestType") == "new_worker" else "استبعاد",
                r.get("stage"), date_only(r.get("createdAt")), r.get("reviewNotes"),
            ]
            for r in data.get("contractorRequests", [])
        ]
        return REQUEST_HEADERS, rows, "contractor-requests"
    if kind == "duty":
        report = duty_report(data, on)
        rows = [
            [
                r.get("name"), r.get("employeeCode"), r.get("company"), r.get("department"),
                r.get("building"), r.get("room"), r.get("status"), r.get("workDays"), r.get("restDays"),
            ]
            for r in report.get("rows", [])
        ]
        return DUTY_HEADERS, rows, "duty"
    raise HTTPException(status_code=400, detail="نوع التصدير غير معروف")


@router.get("/export")
def export_report(
    kind: str = "employees",
    date: str = "",
    user: dict[str, Any] = Depends(require_permission("reports.export")),
):
    data = scoped_data(store.read(), user)
    export_kind = clean_str(kind)
    if is_housing_monitor(user) and export_kind in {"buildings", "contractors", "requests"}:
        raise HTTPException(status_code=403, detail="هذا النوع من التصدير مخصص لمدير النظام")
    on = _date_or_today(date)
    headers, rows, name = _export_rows(data, export_kind, on)
    content = build_csv(headers, rows)
    filename = f"{name}-{on.isoformat()}.csv"
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/{kind}.csv")
def export_report_named(
    kind: str,
    date: str = "",
    user: dict[str, Any] = Depends(require_permission("reports.export")),
):
    return export_report(kind=kind, date=date, user=user)
