from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

from app.services.common import (
    age_on,
    attendance_status,
    clean_str,
    date_only,
    duty_status,
    int_value,
    is_housing_service,
    parse_date,
    percent,
    today,
)
from app.services.contractor_requests import STAGE_LABELS, pending_counts
from app.services.housing import (
    contractor_occupied,
    contractor_stats,
    contractor_capacity,
    contractors_report_rows,
    buildings_tree,
    resident_payload,
    used_bed_ids,
)
from app.services.housing import beds_for_contractor, contractor_by_id


def _housing_residents(data: dict[str, Any]) -> list[dict[str, Any]]:
    return [r for r in data.get("residents", []) if is_housing_service(r)]


def _group_stats(
    residents: list[dict[str, Any]],
    key_of: Callable[[dict[str, Any]], str],
    on: date | None = None,
) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for resident in residents:
        key = key_of(resident) or "غير محدد"
        groups[key].append(resident)
    rows = []
    for label, items in groups.items():
        present = len([r for r in items if attendance_status(r, on) == "حاضر"])
        leave = len([r for r in items if attendance_status(r, on) == "إجازة"])
        assigned = len([r for r in items if r.get("bedId")])
        rows.append({
            "label": label,
            "total": len(items),
            "present": present,
            "away": 0,
            "leave": leave,
            "absent": 0,
            "assigned": assigned,
            "unassigned": len(items) - assigned,
            "percent": percent(present, len(items)),
        })
    rows.sort(key=lambda row: (-row["total"], row["label"]))
    return rows


def dashboard(data: dict[str, Any], on: date | None = None) -> dict[str, Any]:
    on = on or today()
    residents = data.get("residents", [])
    housing = _housing_residents(data)
    beds = data.get("beds", [])
    used = used_bed_ids(data)
    occupied = len(used)
    total_beds = len(beds)
    present = len([r for r in housing if attendance_status(r, on) == "حاضر"])
    on_leave = len([r for r in housing if attendance_status(r, on) == "إجازة"])
    unassigned = len([r for r in housing if not r.get("bedId")])
    on_duty = len([r for r in housing if duty_status(r, on) == "مداوم"])
    duty_leave = len([r for r in housing if duty_status(r, on) == "إجازة"])
    contractors = data.get("contractors", [])
    contractor_capacity_total = sum(int_value(c.get("bedQuota")) for c in contractors)
    contractor_occupied_total = sum(contractor_occupied(data, c.get("id")) for c in contractors)
    building_rows = buildings_tree(data)
    contractor_rows = sorted(
        (
            {
                "id": c.get("id"),
                "name": clean_str(c.get("name")),
                "type": c.get("contractorType", ""),
                **contractor_stats(data, c),
            }
            for c in contractors
        ),
        key=lambda row: (-row["workerCount"], row["name"]),
    )
    stages = pending_counts(data)
    request_status = Counter(str(r.get("status")) for r in data.get("requests", []))
    contractor_request_stages = Counter(str(r.get("stage")) for r in data.get("contractorRequests", []))
    monthly = Counter()
    for request in data.get("contractorRequests", []):
        parsed = parse_date(request.get("createdAt"))
        if parsed:
            monthly[f"{parsed.year}-{parsed.month:02d}"] += 1
    audit = data.get("auditLog", [])[:8]
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "date": on.isoformat(),
        "totals": {
            "residents": len(residents),
            "housingResidents": len(housing),
            "nonHousingResidents": len(residents) - len(housing),
            "buildings": len(data.get("buildings", [])),
            "rooms": len(data.get("rooms", [])),
            "beds": total_beds,
            "occupiedBeds": occupied,
            "availableBeds": max(0, total_beds - occupied),
            "occupancyPercent": percent(occupied, total_beds),
            "present": present,
            "away": 0,
            "onLeave": on_leave,
            "absent": 0,
            "unassigned": unassigned,
            "onDuty": on_duty,
            "dutyLeave": duty_leave,
            "contractors": len(contractors),
            "activeContractors": len([c for c in contractors if c.get("status", "active") == "active"]),
            "contractorCapacity": contractor_capacity_total,
            "contractorOccupied": contractor_occupied_total,
            "contractorFree": max(0, contractor_capacity_total - contractor_occupied_total),
            "pendingContractorRequests": stages["total"],
            "pendingHousingRequests": request_status.get("قيد المراجعة", 0),
            "users": len(data.get("users", [])),
        },
        "requestStages": stages,
        "contractorRequestStages": dict(contractor_request_stages),
        "housingRequestStatuses": dict(request_status),
        "requestStagesLabels": STAGE_LABELS,
        "monthlyRequests": [{"month": k, "count": v} for k, v in sorted(monthly.items())[-12:]],
        "buildings": building_rows,
        "contractors": contractor_rows,
        "attendance": {
            "byCompany": _group_stats(housing, lambda r: clean_str(r.get("company")), on),
            "byBuilding": _group_stats(housing, lambda r: clean_str(r.get("buildingName")), on),
            "byDepartment": _group_stats(housing, lambda r: clean_str(r.get("department")), on),
            "byService": _group_stats(housing, lambda r: clean_str(r.get("serviceType")), on),
            "byGender": _group_stats(housing, lambda r: clean_str(r.get("gender")), on),
        },
        "recentActivity": audit,
    }


def attendance_report(data: dict[str, Any], group_by: str = "company", on: date | None = None) -> dict[str, Any]:
    on = on or today()
    housing = _housing_residents(data)
    key_map: dict[str, Callable[[dict[str, Any]], str]] = {
        "company": lambda r: clean_str(r.get("company")),
        "building": lambda r: clean_str(r.get("buildingName")),
        "department": lambda r: clean_str(r.get("department")),
        "service": lambda r: clean_str(r.get("serviceType")),
        "gender": lambda r: clean_str(r.get("gender")),
        "duty": lambda r: clean_str(r.get("shift")),
    }
    key_of = key_map.get(group_by, key_map["company"])
    # أضف اسم المبنى للتقارير.
    for resident in housing:
        if not resident.get("buildingName"):
            building = next((b for b in data.get("buildings", []) if str(b.get("id")) == str(resident.get("buildingId"))), None)
            resident["buildingName"] = clean_str((building or {}).get("name"))
    rows = _group_stats(housing, key_of, on)
    return {
        "date": on.isoformat(),
        "groupBy": group_by,
        "total": len(housing),
        "rows": rows,
        "summary": {
            "present": sum(r["present"] for r in rows),
            "away": 0,
            "leave": sum(r["leave"] for r in rows),
            "absent": 0,
            "assigned": sum(r["assigned"] for r in rows),
            "unassigned": sum(r["unassigned"] for r in rows),
        },
    }


def occupancy_report(data: dict[str, Any]) -> dict[str, Any]:
    tree = buildings_tree(data)
    rows = []
    for building in tree:
        rows.append({
            "id": building.get("id"),
            "name": building.get("name"),
            "location": building.get("location", ""),
            "rooms": building.get("roomCount", 0),
            "beds": building.get("bedCount", 0),
            "occupied": building.get("occupiedCount", 0),
            "free": building.get("freeCount", 0),
            "percent": building.get("occupancyPercent", 0),
        })
    totals = {
        "beds": sum(r["beds"] for r in rows),
        "occupied": sum(r["occupied"] for r in rows),
        "free": sum(r["free"] for r in rows),
    }
    totals["percent"] = percent(totals["occupied"], totals["beds"])
    return {"rows": rows, "totals": totals, "buildings": tree}


def contractors_report(data: dict[str, Any]) -> dict[str, Any]:
    rows = contractors_report_rows(data)
    return {
        "rows": rows,
        "summary": {
            "contractors": len(rows),
            "capacity": sum(r["capacity"] for r in rows),
            "occupied": sum(r["workerCount"] for r in rows),
            "free": sum(r["freeQuota"] for r in rows),
            "physicalBeds": sum(r["physicalBeds"] for r in rows),
            "freePhysicalBeds": sum(r["freePhysicalBeds"] for r in rows),
        },
    }


def requests_report(data: dict[str, Any]) -> dict[str, Any]:
    contractor_requests = data.get("contractorRequests", [])
    housing_requests = data.get("requests", [])
    stages = Counter(str(r.get("stage")) for r in contractor_requests)
    types = Counter(str(r.get("requestType")) for r in contractor_requests)
    statuses = Counter(str(r.get("status")) for r in housing_requests)
    housing_types = Counter(str(r.get("requestType")) for r in housing_requests)

    def group(requests: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
        bucket: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for item in requests:
            bucket[str(item.get(key) or "غير محدد")].append(item)
        return [
            {
                "label": label,
                "total": len(items),
                "pending": len([i for i in items if i.get("stage") not in {"done", "rejected"}]),
                "done": len([i for i in items if i.get("stage") == "done"]),
                "rejected": len([i for i in items if i.get("stage") == "rejected"]),
            }
            for label, items in sorted(bucket.items(), key=lambda kv: -len(kv[1]))
        ]

    return {
        "contractorRequests": {
            "total": len(contractor_requests),
            "pending": stages.get("department", 0) + stages.get("security", 0) + stages.get("visitor", 0) + stages.get("housing", 0),
            "done": stages.get("done", 0),
            "rejected": stages.get("rejected", 0),
            "stages": dict(stages),
            "types": dict(types),
            "byContractor": group(contractor_requests, "contractorName"),
        },
        "housingRequests": {
            "total": len(housing_requests),
            "statuses": dict(statuses),
            "types": dict(housing_types),
            "byType": [
                {"label": label, "total": count}
                for label, count in sorted(housing_types.items(), key=lambda kv: -kv[1])
            ],
        },
    }


def duty_report(data: dict[str, Any], on: date | None = None) -> dict[str, Any]:
    on = on or today()
    housing = _housing_residents(data)
    rows = []
    for resident in housing:
        status = duty_status(resident, on)
        if not status:
            continue
        building = next((b for b in data.get("buildings", []) if str(b.get("id")) == str(resident.get("buildingId"))), None)
        room = next((r for r in data.get("rooms", []) if str(r.get("id")) == str(resident.get("roomId"))), None)
        rows.append({
            "id": resident.get("id"),
            "name": resident.get("name"),
            "employeeCode": resident.get("employeeCode"),
            "company": resident.get("company"),
            "department": resident.get("department"),
            "shift": resident.get("shift"),
            "building": clean_str((building or {}).get("name")),
            "room": clean_str((room or {}).get("name")),
            "status": status,
            "workDays": int_value(resident.get("dutyWorkDays")),
            "restDays": int_value(resident.get("dutyRestDays")),
            "cycleStart": date_only(resident.get("dutyCycleStart")),
        })
    on_duty = [r for r in rows if r["status"] == "مداوم"]
    leave = [r for r in rows if r["status"] == "إجازة"]
    return {
        "date": on.isoformat(),
        "rows": rows,
        "onDuty": on_duty,
        "onLeave": leave,
        "summary": {
            "withSchedule": len(rows),
            "onDuty": len(on_duty),
            "onLeave": len(leave),
            "withoutSchedule": len(housing) - len(rows),
        },
    }


def employees_rows(data: dict[str, Any], on: date | None = None) -> list[list[Any]]:
    on = on or today()
    rows = []
    for resident in data.get("residents", []):
        item = resident_payload(data, resident, on)
        rows.append([
            item.get("employeeCode"), item.get("cardNumber"), item.get("name"),
            item.get("jobTitle"), item.get("company"), item.get("department"),
            item.get("serviceType"), item.get("shift"), item.get("transportType"),
            item.get("gender"), item.get("attendanceStatus"),
            item.get("dutyStatus"), item.get("location"), date_only(item.get("birthDate")),
            item.get("birthPlace"), item.get("phone"), "نعم" if item.get("isAssigned") else "لا",
        ])
    return rows


EMPLOYEE_HEADERS = [
    "الرقم الوظيفي", "رقم البطاقة", "الاسم", "المسمى الوظيفي", "الشركة/المتعهد",
    "الإدارة", "نوع الخدمة", "نوع الدوام", "تصنيف النقل", "الجنس",
    "الحالة", "حالة الدوام", "الموقع",
    "تاريخ الميلاد", "مكان الميلاد", "الجوال", "مسكن",
]


def building_rows(data: dict[str, Any]) -> list[list[Any]]:
    return [
        [
            row.get("name"), row.get("location"), row.get("roomCount"), row.get("bedCount"),
            row.get("occupiedCount"), row.get("freeCount"), row.get("occupancyPercent"),
        ]
        for row in buildings_tree(data)
    ]


BUILDING_HEADERS = ["المبنى", "الموقع", "الغرف", "الأسرّة", "المشغول", "المتاح", "نسبة الإشغال %"]
