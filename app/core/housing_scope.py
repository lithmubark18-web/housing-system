from __future__ import annotations

from typing import Any
from fastapi import HTTPException


def canonical_housing_type(value: Any) -> str | None:
    key = " ".join(str(value or "").strip().casefold().split())
    if key in {"internal", "inside", "داخلي", "داخل", "سكن داخلي"}:
        return "internal"
    if key in {"external", "outside", "خارجي", "خارج", "سكن خارجي"}:
        return "external"
    return None


def is_housing_monitor(user: dict[str, Any]) -> bool:
    role_id = str(user.get("roleId") or "").strip()
    if not role_id:
        role = str(user.get("role") or "")
        role_id = "r_housing" if role == "housingSupervisor" else ""
    return role_id == "r_housing"


def monitor_housing_type(user: dict[str, Any]) -> str | None:
    if not is_housing_monitor(user):
        return None
    return canonical_housing_type(user.get("housingType"))


def monitor_permission(user: dict[str, Any]) -> str | None:
    kind = monitor_housing_type(user)
    if kind == "internal":
        return "requests.housing_internal"
    if kind == "external":
        return "requests.housing_external"
    return None


def building_type(data: dict[str, Any], building_id: Any) -> str | None:
    building = next(
        (b for b in data.get("buildings", []) if str(b.get("id")) == str(building_id)),
        None,
    )
    if not building:
        return None
    # يتوافق مع سلوك الشجرة الحالية التي تعتبر النوع غير المحدد داخلياً.
    return canonical_housing_type(building.get("housingType")) or "internal"


def room_building_id(data: dict[str, Any], room_id: Any) -> str | None:
    room = next((r for r in data.get("rooms", []) if str(r.get("id")) == str(room_id)), None)
    return str(room.get("buildingId")) if room and room.get("buildingId") is not None else None


def bed_building_id(data: dict[str, Any], bed_id: Any) -> str | None:
    bed = next((b for b in data.get("beds", []) if str(b.get("id")) == str(bed_id)), None)
    if not bed:
        return None
    return room_building_id(data, bed.get("roomId"))


def resident_building_id(data: dict[str, Any], resident: dict[str, Any]) -> str | None:
    if resident.get("buildingId"):
        return str(resident.get("buildingId"))
    if resident.get("roomId"):
        return room_building_id(data, resident.get("roomId"))
    if resident.get("bedId"):
        return bed_building_id(data, resident.get("bedId"))
    return None


def contractor_building_ids(contractor: dict[str, Any]) -> set[str]:
    return {str(v) for v in (contractor.get("buildingIds") or []) if v is not None}


def contractor_matches_monitor(data: dict[str, Any], user: dict[str, Any], contractor: dict[str, Any] | None) -> bool:
    if not is_housing_monitor(user):
        return True
    kind = monitor_housing_type(user)
    if not kind or not contractor:
        return False
    ids = contractor_building_ids(contractor)
    kinds = {building_type(data, bid) for bid in ids}
    kinds.discard(None)
    # المتعهد المرتبط بالنوعين معاً لا يُسند إلى مراقب واحد؛ يتطلب فصلاً إدارياً.
    return kinds == {kind}


def ensure_monitor_contractor_scope(data: dict[str, Any], user: dict[str, Any], contractor: dict[str, Any] | None) -> None:
    if is_housing_monitor(user) and not contractor_matches_monitor(data, user, contractor):
        raise HTTPException(status_code=403, detail="المتعهد خارج نطاق نوع السكن المخصص لحسابك")


def monitor_bed_matches(data: dict[str, Any], user: dict[str, Any], bed: dict[str, Any], contractor: dict[str, Any] | None = None) -> bool:
    if not is_housing_monitor(user):
        return True
    kind = monitor_housing_type(user)
    building_id = bed_building_id(data, bed.get("id"))
    if not kind or not building_id or building_type(data, building_id) != kind:
        return False
    if contractor is not None and building_id not in contractor_building_ids(contractor):
        return False
    return True


def ensure_monitor_bed_scope(
    data: dict[str, Any],
    user: dict[str, Any],
    bed_id: Any,
    contractor: dict[str, Any] | None = None,
) -> None:
    if not is_housing_monitor(user):
        return
    bed = next((b for b in data.get("beds", []) if str(b.get("id")) == str(bed_id)), None)
    if not bed or not monitor_bed_matches(data, user, bed, contractor):
        raise HTTPException(status_code=403, detail="السرير المحدد خارج نطاق نوع السكن المخصص لحسابك")


def guest_matches_monitor(data: dict[str, Any], user: dict[str, Any], guest: dict[str, Any] | None) -> bool:
    if not is_housing_monitor(user):
        return True
    if not guest:
        return False
    bed_id = guest.get("bedId")
    bed = next((b for b in data.get("beds", []) if str(b.get("id")) == str(bed_id)), None)
    return bool(bed and monitor_bed_matches(data, user, bed))


def ensure_monitor_guest_scope(data: dict[str, Any], user: dict[str, Any], guest: dict[str, Any] | None) -> None:
    if is_housing_monitor(user) and not guest_matches_monitor(data, user, guest):
        raise HTTPException(status_code=404, detail="الزائر غير موجود ضمن نطاق نوع السكن المخصص لحسابك")


def monitor_request_visible(data: dict[str, Any], user: dict[str, Any], request: dict[str, Any]) -> bool:
    if not is_housing_monitor(user):
        return True
    contractor = next(
        (c for c in data.get("contractors", []) if str(c.get("id")) == str(request.get("contractorId"))),
        None,
    )
    if not contractor_matches_monitor(data, user, contractor):
        return False
    history = request.get("history") or []
    housing_was_involved = any(str(h.get("stage") or "") == "housing" for h in history if isinstance(h, dict))
    housing_was_involved = housing_was_involved or bool(request.get("housingApprover"))
    return str(request.get("stage") or "") == "housing" or housing_was_involved


def monitor_guest_tree(data: dict[str, Any], tree: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """شجرة مصغرة لغرض اختيار سرير زائر فقط؛ الأسرّة المشغولة وبيانات شاغليها لا تُرسل."""
    result: list[dict[str, Any]] = []
    for building in tree:
        rooms_out = []
        for room in building.get("rooms", []) or []:
            free = [
                {"id": bed.get("id"), "label": bed.get("label"), "occupied": False}
                for bed in (room.get("beds", []) or [])
                if not bed.get("occupied")
            ]
            if free:
                rooms_out.append({"id": room.get("id"), "name": room.get("name"), "beds": free})
        if rooms_out:
            result.append({
                "id": building.get("id"),
                "name": building.get("name"),
                "housingType": building.get("housingType"),
                "rooms": rooms_out,
            })
    return result


def scoped_data(data: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    """نسخة قراءة مقيّدة للمراقب؛ لا تغيّر الحالة الأصلية أو تخزن بيانات مفلترة."""
    if not is_housing_monitor(user):
        return data
    kind = monitor_housing_type(user)
    scoped = dict(data)
    if not kind:
        for key in (
            "buildings", "rooms", "beds", "residents", "contractors", "contractorWorkers",
            "contractorRequests", "guests", "requests", "rotations", "attendance",
            "dutyRecords", "dutyLogs", "movements",
        ):
            if isinstance(data.get(key), list):
                scoped[key] = []
        return scoped

    buildings = [b for b in data.get("buildings", []) if building_type(data, b.get("id")) == kind]
    building_ids = {str(b.get("id")) for b in buildings}
    rooms = [r for r in data.get("rooms", []) if str(r.get("buildingId")) in building_ids]
    room_ids = {str(r.get("id")) for r in rooms}
    beds = [b for b in data.get("beds", []) if str(b.get("roomId")) in room_ids]
    bed_ids = {str(b.get("id")) for b in beds}

    residents = [r for r in data.get("residents", []) if resident_building_id(data, r) in building_ids]
    resident_ids = {str(r.get("id")) for r in residents}
    employee_codes = {str(r.get("employeeCode")) for r in residents if r.get("employeeCode")}

    contractors = [
        c for c in data.get("contractors", [])
        if contractor_matches_monitor(data, user, c)
    ]
    contractor_ids = {str(c.get("id")) for c in contractors}
    guests = [
        g for g in data.get("guests", [])
        if str(g.get("bedId")) in bed_ids
    ]
    requests = [
        r for r in data.get("requests", [])
        if r.get("residentId") is not None and str(r.get("residentId")) in resident_ids
    ]
    contractor_requests = [
        r for r in data.get("contractorRequests", [])
        if str(r.get("contractorId")) in contractor_ids
    ]

    scoped.update({
        "buildings": buildings,
        "rooms": rooms,
        "beds": beds,
        "residents": residents,
        "contractors": contractors,
        "guests": guests,
        "requests": requests,
        "contractorRequests": contractor_requests,
    })

    if isinstance(data.get("contractorWorkers"), list):
        scoped["contractorWorkers"] = [
            w for w in data.get("contractorWorkers", [])
            if (w.get("buildingId") is not None and str(w.get("buildingId")) in building_ids)
            or (w.get("contractorId") is not None and str(w.get("contractorId")) in contractor_ids and not w.get("buildingId"))
        ]
    if isinstance(data.get("rotations"), list):
        scoped["rotations"] = [
            r for r in data.get("rotations", [])
            if (r.get("buildingId") is not None and str(r.get("buildingId")) in building_ids)
            or (r.get("roomId") is not None and str(r.get("roomId")) in room_ids)
            or (r.get("bedId") is not None and str(r.get("bedId")) in bed_ids)
        ]
    for key in ("attendance", "dutyRecords", "dutyLogs", "movements"):
        if isinstance(data.get(key), list):
            scoped[key] = [
                row for row in data.get(key, [])
                if (row.get("residentId") is not None and str(row.get("residentId")) in resident_ids)
                or (row.get("employeeCode") is not None and str(row.get("employeeCode")) in employee_codes)
            ]
    return scoped
