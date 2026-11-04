from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.services.common import (
    ServiceError,
    add_audit,
    add_notification,
    age_on,
    attendance_status,
    clean_str,
    date_only,
    duty_position,
    duty_status,
    int_value,
    is_housing_service,
    new_id,
    normalize_card,
    now_iso,
    parse_date,
    percent,
    today,
)


# ---------------------------------------------------------------------------
# فهارس وعلاقات
# ---------------------------------------------------------------------------

def by_id(items: list[dict[str, Any]], item_id: Any) -> dict[str, Any] | None:
    target = str(item_id or "")
    for item in items:
        if str(item.get("id")) == target:
            return item
    return None


def building_by_id(data: dict[str, Any], building_id: Any) -> dict[str, Any] | None:
    return by_id(data.get("buildings", []), building_id)


def room_by_id(data: dict[str, Any], room_id: Any) -> dict[str, Any] | None:
    return by_id(data.get("rooms", []), room_id)


def bed_by_id(data: dict[str, Any], bed_id: Any) -> dict[str, Any] | None:
    return by_id(data.get("beds", []), bed_id)


def resident_by_id(data: dict[str, Any], resident_id: Any) -> dict[str, Any] | None:
    return by_id(data.get("residents", []), resident_id)


def contractor_by_id(data: dict[str, Any], contractor_id: Any) -> dict[str, Any] | None:
    return by_id(data.get("contractors", []), contractor_id)


def used_bed_ids(data: dict[str, Any]) -> set[str]:
    return {str(r.get("bedId")) for r in data.get("residents", []) if r.get("bedId")}


def resident_on_bed(data: dict[str, Any], bed_id: str) -> dict[str, Any] | None:
    for resident in data.get("residents", []):
        if str(resident.get("bedId")) == str(bed_id):
            return resident
    return None


def residents_for_contractor(data: dict[str, Any], contractor_id: Any) -> list[dict[str, Any]]:
    contractor = contractor_by_id(data, contractor_id)
    if not contractor:
        return []
    cid = str(contractor.get("id"))
    direct = [r for r in data.get("residents", []) if str(r.get("contractorId")) == cid]
    if direct:
        return direct
    name = clean_str(contractor.get("name")).lower()
    if not name:
        return []
    exact = [r for r in data.get("residents", []) if clean_str(r.get("company")).lower() == name]
    if exact:
        return exact
    return [
        r for r in data.get("residents", [])
        if clean_str(r.get("company")).lower() and name in clean_str(r.get("company")).lower()
    ]


def beds_for_contractor(data: dict[str, Any], contractor_id: Any) -> list[dict[str, Any]]:
    contractor = contractor_by_id(data, contractor_id)
    if not contractor:
        return []
    building_ids = {str(v) for v in (contractor.get("buildingIds") or [])}
    room_ids = {str(r.get("id")) for r in data.get("rooms", []) if str(r.get("buildingId")) in building_ids}
    return [b for b in data.get("beds", []) if str(b.get("roomId")) in room_ids]


def free_beds_for_contractor(data: dict[str, Any], contractor_id: Any) -> list[dict[str, Any]]:
    used = used_bed_ids(data)
    return [b for b in beds_for_contractor(data, contractor_id) if str(b.get("id")) not in used]


def contractor_capacity(data: dict[str, Any], contractor_id: Any) -> int:
    contractor = contractor_by_id(data, contractor_id)
    return int_value(contractor.get("bedQuota")) if contractor else 0


def contractor_occupied(data: dict[str, Any], contractor_id: Any) -> int:
    return len(residents_for_contractor(data, contractor_id))


def contractor_free(data: dict[str, Any], contractor_id: Any) -> int:
    return max(0, contractor_capacity(data, contractor_id) - contractor_occupied(data, contractor_id))


def contractor_stats(data: dict[str, Any], contractor: dict[str, Any]) -> dict[str, Any]:
    cid = contractor.get("id")
    workers = residents_for_contractor(data, cid)
    capacity = int_value(contractor.get("bedQuota"))
    physical = free_beds_for_contractor(data, cid)
    used_beds = used_bed_ids(data)
    bed_total = len(beds_for_contractor(data, cid))
    occupied_beds = len([b for b in beds_for_contractor(data, cid) if str(b.get("id")) in used_beds])
    return {
        "workerCount": len(workers),
        "capacity": capacity,
        "freeQuota": max(0, capacity - len(workers)),
        "physicalBeds": bed_total,
        "occupiedBeds": occupied_beds,
        "freePhysicalBeds": len(physical),
        "occupancyPercent": percent(len(workers), capacity) if capacity else 0,
        "buildings": len(contractor.get("buildingIds") or []),
        "pendingRequests": len([
            r for r in data.get("contractorRequests", [])
            if str(r.get("contractorId")) == str(cid)
            and r.get("stage") not in {"done", "rejected"}
        ]),
    }


def contractors_report_rows(data: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for contractor in data.get("contractors", []):
        stats = contractor_stats(data, contractor)
        rows.append({
            "id": contractor.get("id"),
            "name": clean_str(contractor.get("name")),
            "type": contractor.get("contractorType", ""),
            "contactPhone": contractor.get("contactPhone", ""),
            "contactEmail": contractor.get("contactEmail", ""),
            "status": contractor.get("status", "active"),
            "buildingNames": " • ".join(
                clean_str((building_by_id(data, bid) or {}).get("name"))
                for bid in (contractor.get("buildingIds") or [])
                if building_by_id(data, bid)
            ),
            **stats,
        })
    rows.sort(key=lambda row: (-row["workerCount"], row["name"]))
    return rows


def contractor_payload(data: dict[str, Any], contractor: dict[str, Any]) -> dict[str, Any]:
    item = dict(contractor)
    item["stats"] = contractor_stats(data, contractor)
    item["buildingNames"] = [
        clean_str((building_by_id(data, bid) or {}).get("name"))
        for bid in (contractor.get("buildingIds") or [])
        if building_by_id(data, bid)
    ]
    return item


def resident_payload(data: dict[str, Any], resident: dict[str, Any], on: date | None = None) -> dict[str, Any]:
    item = dict(resident)
    building = building_by_id(data, resident.get("buildingId"))
    room = room_by_id(data, resident.get("roomId"))
    bed = bed_by_id(data, resident.get("bedId"))
    item["isAssigned"] = bool(resident.get("bedId"))
    item["attendanceStatus"] = attendance_status(resident, on)
    item["dutyStatus"] = duty_status(resident, on)
    item["dutyInfo"] = duty_position(resident, on)
    item["isHousingService"] = is_housing_service(resident)
    item["location"] = (
        f"{clean_str(building.get('name')) or 'سكن'} • {clean_str(room.get('name'))} • {clean_str(bed.get('label'))}"
        if resident.get("bedId") else "غير مسكن"
    )
    item["buildingName"] = clean_str((building or {}).get("name"))
    item["roomName"] = clean_str((room or {}).get("name"))
    item["bedLabel"] = clean_str((bed or {}).get("label"))
    item["age"] = age_on(resident.get("birthDate"), on)
    item["dutyLabel"] = (
        f"{int_value(resident.get('dutyWorkDays'))} / {int_value(resident.get('dutyRestDays'))}"
        if (int_value(resident.get("dutyWorkDays")) + int_value(resident.get("dutyRestDays"))) > 0 else ""
    )
    return item


def buildings_tree(data: dict[str, Any]) -> list[dict[str, Any]]:
    used = used_bed_ids(data)
    residents = data.get("residents", [])
    result: list[dict[str, Any]] = []
    for building in data.get("buildings", []):
        bid = building.get("id")
        rooms = [r for r in data.get("rooms", []) if str(r.get("buildingId")) == str(bid)]
        room_payloads = []
        total_beds = 0
        occupied_beds = 0
        for room in rooms:
            beds = [b for b in data.get("beds", []) if str(b.get("roomId")) == str(room.get("id"))]
            occupied = len([b for b in beds if str(b.get("id")) in used])
            total_beds += len(beds)
            occupied_beds += occupied
            bed_payloads = []
            for bed in beds:
                occupant = resident_on_bed(data, str(bed.get("id")))
                bed_payloads.append({
                    **bed,
                    "occupied": bool(occupant),
                    "residentId": (occupant or {}).get("id"),
                    "residentName": (occupant or {}).get("name", ""),
                    "employeeCode": (occupant or {}).get("employeeCode", ""),
                })
            room_payloads.append({
                **room,
                "beds": bed_payloads,
                "bedCount": len(beds),
                "occupiedCount": occupied,
                "freeCount": len(beds) - occupied,
            })
        result.append({
            **building,
            "rooms": room_payloads,
            "roomCount": len(rooms),
            "bedCount": total_beds,
            "occupiedCount": occupied_beds,
            "freeCount": total_beds - occupied_beds,
            "occupancyPercent": percent(occupied_beds, total_beds),
            "residentCount": len([r for r in residents if str(r.get("buildingId")) == str(bid)]),
        })
    return result


# ---------------------------------------------------------------------------
# الأسرّة والسكان
# ---------------------------------------------------------------------------

def assign_bed(data: dict[str, Any], resident: dict[str, Any], bed_id: Any) -> dict[str, Any]:
    bed = bed_by_id(data, bed_id)
    if not bed:
        raise ServiceError("السرير غير موجود", 404)
    occupant = resident_on_bed(data, str(bed.get("id")))
    if occupant and str(occupant.get("id")) != str(resident.get("id")):
        raise ServiceError("السرير مشغول بساكن آخر", 409)
    room = room_by_id(data, bed.get("roomId"))
    if not room:
        raise ServiceError("الغرفة المرتبطة بالسرير غير موجودة", 409)
    resident["buildingId"] = room.get("buildingId")
    resident["roomId"] = room.get("id")
    resident["bedId"] = bed.get("id")
    resident["baseStatus"] = "متواجد"
    resident["manualStatus"] = None
    resident["checkInDate"] = resident.get("checkInDate") or now_iso()
    resident["updatedAt"] = now_iso()
    return resident


def unassign_bed(data: dict[str, Any], resident: dict[str, Any]) -> dict[str, Any]:
    resident["buildingId"] = None
    resident["roomId"] = None
    resident["bedId"] = None
    resident["baseStatus"] = "غير مسكن"
    resident["manualStatus"] = None
    resident["updatedAt"] = now_iso()
    return resident


def _validate_contractor_worker(data: dict[str, Any], payload: dict[str, Any]) -> None:
    contractor_id = payload.get("contractorId")
    if not contractor_id:
        return
    if not contractor_by_id(data, contractor_id):
        raise ServiceError("المتعهد/المقاول غير موجود", 404)
    card = normalize_card(payload.get("cardNumber"))
    if not card:
        raise ServiceError("رقم البطاقة مطلوب لعمال المتعهدين")
    if not parse_date(payload.get("birthDate")):
        raise ServiceError("تاريخ الميلاد مطلوب لعمال المتعهدين")
    if not clean_str(payload.get("birthPlace")):
        raise ServiceError("مكان الميلاد مطلوب لعمال المتعهدين")
    age = age_on(payload.get("birthDate"))
    if age is not None and age < 18:
        raise ServiceError("لا يسمح بإضافة موظف أقل من 18 عاماً")
    for resident in data.get("residents", []):
        if str(resident.get("id")) == str(payload.get("id")):
            continue
        if normalize_card(resident.get("cardNumber")) == card:
            raise ServiceError("يوجد مقيم مسجّل بنفس رقم البطاقة مسبقاً", 409)


RESIDENT_FIELDS = (
    "employeeCode", "name", "jobTitle", "company", "department", "shift", "rotation",
    "serviceType", "baseStatus", "manualStatus", "buildingId", "roomId", "bedId",
    "checkInDate", "leaveUntil", "phone", "shiftTable", "dutyCycleStart",
    "dutyWorkDays", "dutyRestDays", "contractorId", "gender", "transportType",
    "departureTime", "cardNumber", "birthDate", "birthPlace", "notes",
)


def create_resident(data: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    name = clean_str(payload.get("name"))
    if not name:
        raise ServiceError("يرجى إدخال اسم الموظف")
    payload = dict(payload)
    payload["id"] = new_id("u")
    _validate_contractor_worker(data, payload)
    resident: dict[str, Any] = {field: payload.get(field) for field in RESIDENT_FIELDS}
    resident["id"] = payload["id"]
    resident["employeeCode"] = clean_str(payload.get("employeeCode"))
    resident["name"] = name
    for field, fallback in (("jobTitle", "غير محدد"), ("company", "غير محدد"), ("department", "غير محدد")):
        resident[field] = clean_str(payload.get(field)) or fallback
    resident["shift"] = clean_str(payload.get("shift"))
    resident["rotation"] = clean_str(payload.get("rotation"))
    resident["serviceType"] = clean_str(payload.get("serviceType"))
    resident["baseStatus"] = clean_str(payload.get("baseStatus")) or ("متواجد" if payload.get("bedId") else "غير مسكن")
    resident["manualStatus"] = None
    resident["phone"] = clean_str(payload.get("phone"))
    resident["shiftTable"] = clean_str(payload.get("shiftTable"))
    resident["dutyWorkDays"] = int_value(payload.get("dutyWorkDays"))
    resident["dutyRestDays"] = int_value(payload.get("dutyRestDays"))
    resident["contractorId"] = payload.get("contractorId") or None
    resident["gender"] = clean_str(payload.get("gender"))
    resident["transportType"] = clean_str(payload.get("transportType"))
    resident["departureTime"] = clean_str(payload.get("departureTime"))
    resident["cardNumber"] = clean_str(payload.get("cardNumber"))
    resident["birthPlace"] = clean_str(payload.get("birthPlace"))
    resident["buildingId"] = None
    resident["roomId"] = None
    resident["bedId"] = None
    resident["checkInDate"] = parse_date(payload.get("checkInDate")) and now_iso() or now_iso()
    resident["leaveUntil"] = payload.get("leaveUntil") or None
    resident["dutyCycleStart"] = payload.get("dutyCycleStart") or None
    resident["birthDate"] = payload.get("birthDate") or None
    resident["createdAt"] = now_iso()
    resident["updatedAt"] = now_iso()
    if payload.get("bedId"):
        assign_bed(data, resident, payload.get("bedId"))
    data.setdefault("residents", []).insert(0, resident)
    add_audit(data, actor, "resident_created", "resident", resident["id"], {"name": name})
    return resident


def update_resident(data: dict[str, Any], resident: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    merged = dict(resident)
    for field in RESIDENT_FIELDS:
        if field in payload:
            merged[field] = payload.get(field)
    merged["id"] = resident["id"]
    if not clean_str(merged.get("name")):
        raise ServiceError("يرجى إدخال اسم الموظف")
    _validate_contractor_worker(data, merged)
    for field in RESIDENT_FIELDS:
        if field in {"buildingId", "roomId", "bedId"}:
            continue
        if field in merged:
            if field in {"dutyWorkDays", "dutyRestDays"}:
                resident[field] = int_value(merged.get(field))
            elif field in {"name", "employeeCode", "jobTitle", "company", "department", "shift", "rotation", "serviceType", "baseStatus", "phone", "shiftTable", "gender", "transportType", "departureTime", "cardNumber", "birthPlace"}:
                resident[field] = clean_str(merged.get(field))
            elif field == "contractorId":
                resident[field] = merged.get(field) or None
            else:
                resident[field] = merged.get(field)
    if "bedId" in payload:
        bed_id = payload.get("bedId")
        if not bed_id:
            unassign_bed(data, resident)
        elif str(bed_id) != str(resident.get("bedId")):
            assign_bed(data, resident, bed_id)
    resident["updatedAt"] = now_iso()
    add_audit(data, actor, "resident_updated", "resident", resident["id"], {"name": resident.get("name")})
    return resident


def delete_resident(data: dict[str, Any], resident: dict[str, Any], actor: dict[str, Any] | None = None) -> None:
    data["residents"] = [r for r in data.get("residents", []) if str(r.get("id")) != str(resident.get("id"))]
    add_audit(data, actor, "resident_deleted", "resident", resident.get("id"), {"name": resident.get("name")})


# ---------------------------------------------------------------------------
# المباني والغرف والأسرّة
# ---------------------------------------------------------------------------

def create_building(data: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    name = clean_str(payload.get("name"))
    if not name:
        raise ServiceError("يرجى إدخال اسم المبنى")
    building = {
        "id": new_id("bld_"),
        "name": name,
        "location": clean_str(payload.get("location")),
        "roomIds": [],
        "notes": clean_str(payload.get("notes")),
        "createdAt": now_iso(),
    }
    data.setdefault("buildings", []).append(building)
    add_audit(data, actor, "building_created", "building", building["id"], {"name": name})
    return building


def update_building(data: dict[str, Any], building: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    if "name" in payload:
        if not clean_str(payload.get("name")):
            raise ServiceError("يرجى إدخال اسم المبنى")
        building["name"] = clean_str(payload.get("name"))
    if "location" in payload:
        building["location"] = clean_str(payload.get("location"))
    if "notes" in payload:
        building["notes"] = clean_str(payload.get("notes"))
    add_audit(data, actor, "building_updated", "building", building["id"], {"name": building.get("name")})
    return building


def delete_building(data: dict[str, Any], building: dict[str, Any], actor: dict[str, Any] | None = None) -> None:
    rooms = [r for r in data.get("rooms", []) if str(r.get("buildingId")) == str(building.get("id"))]
    if rooms:
        raise ServiceError("لا يمكن حذف مبنى يحتوي غرفاً — احذف الغرف أولاً", 409)
    data["buildings"] = [b for b in data.get("buildings", []) if str(b.get("id")) != str(building.get("id"))]
    for contractor in data.get("contractors", []):
        contractor["buildingIds"] = [b for b in (contractor.get("buildingIds") or []) if str(b) != str(building.get("id"))]
    add_audit(data, actor, "building_deleted", "building", building.get("id"), {"name": building.get("name")})


def create_room(data: dict[str, Any], building: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    name = clean_str(payload.get("name"))
    if not name:
        raise ServiceError("يرجى إدخال اسم الغرفة")
    room = {
        "id": new_id("room_"),
        "name": name,
        "buildingId": building.get("id"),
        "bedIds": [],
        "floor": clean_str(payload.get("floor")) or "الأرضي",
        "notes": clean_str(payload.get("notes")),
        "createdAt": now_iso(),
    }
    data.setdefault("rooms", []).append(room)
    building.setdefault("roomIds", []).append(room["id"])
    add_audit(data, actor, "room_created", "room", room["id"], {"name": name, "building": building.get("name")})
    return room


def update_room(data: dict[str, Any], room: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    if "name" in payload:
        if not clean_str(payload.get("name")):
            raise ServiceError("يرجى إدخال اسم الغرفة")
        room["name"] = clean_str(payload.get("name"))
    if "floor" in payload:
        room["floor"] = clean_str(payload.get("floor"))
    if "notes" in payload:
        room["notes"] = clean_str(payload.get("notes"))
    add_audit(data, actor, "room_updated", "room", room["id"], {"name": room.get("name")})
    return room


def delete_room(data: dict[str, Any], room: dict[str, Any], actor: dict[str, Any] | None = None) -> None:
    beds = [b for b in data.get("beds", []) if str(b.get("roomId")) == str(room.get("id"))]
    occupied = [b for b in beds if resident_on_bed(data, str(b.get("id")))]
    if occupied:
        raise ServiceError("لا يمكن حذف غرفة تحتوي أسرّة مشغولة", 409)
    if beds:
        raise ServiceError("لا يمكن حذف غرفة تحتوي أسرّة — احذف الأسرّة أولاً", 409)
    data["rooms"] = [r for r in data.get("rooms", []) if str(r.get("id")) != str(room.get("id"))]
    building = building_by_id(data, room.get("buildingId"))
    if building:
        building["roomIds"] = [rid for rid in (building.get("roomIds") or []) if str(rid) != str(room.get("id"))]
    add_audit(data, actor, "room_deleted", "room", room.get("id"), {"name": room.get("name")})


def create_beds(data: dict[str, Any], room: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    count = max(1, min(int_value(payload.get("count"), 1), 50))
    custom_labels = payload.get("labels")
    created: list[dict[str, Any]] = []
    existing = [b for b in data.get("beds", []) if str(b.get("roomId")) == str(room.get("id"))]
    start = len(existing) + 1
    for index in range(count):
        label = ""
        if isinstance(custom_labels, list) and index < len(custom_labels):
            label = clean_str(custom_labels[index])
        if not label:
            base = clean_str(payload.get("labelPrefix")) or "سرير"
            label = f"{base} {start + index}"
        bed = {"id": new_id("bed_"), "label": label, "roomId": room.get("id"), "createdAt": now_iso()}
        data.setdefault("beds", []).append(bed)
        room.setdefault("bedIds", []).append(bed["id"])
        created.append(bed)
    add_audit(data, actor, "beds_created", "room", room.get("id"), {"count": len(created), "room": room.get("name")})
    return created


def update_bed(data: dict[str, Any], bed: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    if "label" in payload:
        if not clean_str(payload.get("label")):
            raise ServiceError("يرجى إدخال اسم السرير")
        bed["label"] = clean_str(payload.get("label"))
    add_audit(data, actor, "bed_updated", "bed", bed.get("id"), {"label": bed.get("label")})
    return bed


def delete_bed(data: dict[str, Any], bed: dict[str, Any], actor: dict[str, Any] | None = None) -> None:
    if resident_on_bed(data, str(bed.get("id"))):
        raise ServiceError("لا يمكن حذف سرير مشغول — أخلِ السرير أولاً", 409)
    data["beds"] = [b for b in data.get("beds", []) if str(b.get("id")) != str(bed.get("id"))]
    room = room_by_id(data, bed.get("roomId"))
    if room:
        room["bedIds"] = [bid for bid in (room.get("bedIds") or []) if str(bid) != str(bed.get("id"))]
    add_audit(data, actor, "bed_deleted", "bed", bed.get("id"), {"label": bed.get("label")})


# ---------------------------------------------------------------------------
# طلبات السكن العامة
# ---------------------------------------------------------------------------

REQUEST_TYPES = ["تسكين جديد", "نقل سرير", "إخلاء سكن", "صيانة غرفة", "تمديد سكن", "طلب زيارة", "أخرى"]
REQUEST_STATUSES = ["قيد المراجعة", "معتمد", "مرفوض", "قيد التنفيذ", "مكتمل"]


def create_housing_request(data: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    resident = resident_by_id(data, payload.get("residentId")) if payload.get("residentId") else None
    request_type = clean_str(payload.get("requestType")) or "أخرى"
    details = clean_str(payload.get("details"))
    resident_name = clean_str(payload.get("residentName")) or clean_str((resident or {}).get("name"))
    if not resident_name:
        raise ServiceError("يرجى اختيار الساكن أو كتابة الاسم")
    if not details:
        raise ServiceError("يرجى كتابة تفاصيل الطلب")
    item = {
        "id": new_id("REQ-"),
        "requestType": request_type,
        "residentId": (resident or {}).get("id"),
        "residentName": resident_name,
        "employeeCode": clean_str(payload.get("employeeCode")) or clean_str((resident or {}).get("employeeCode")),
        "details": details,
        "priority": clean_str(payload.get("priority")) or "عادي",
        "createdAt": now_iso(),
        "createdBy": (actor or {}).get("name", ""),
        "status": "قيد المراجعة",
        "reviewedAt": None,
        "reviewNotes": "",
    }
    data.setdefault("requests", []).insert(0, item)
    add_audit(data, actor, "request_created", "housing_request", item["id"], {"type": request_type})
    add_notification(
        data,
        title="طلب سكن جديد",
        body=f"{request_type} — {resident_name}",
        kind="request",
        permission="requests.supervise",
        link="/operations",
        actor=actor,
    )
    return item


def set_request_status(
    data: dict[str, Any],
    request: dict[str, Any],
    status: str,
    notes: str = "",
    actor: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if status not in REQUEST_STATUSES:
        raise ServiceError("حالة الطلب غير معروفة")
    request["status"] = status
    request["reviewedAt"] = now_iso()
    request["reviewNotes"] = clean_str(notes)
    request["reviewedBy"] = clean_str((actor or {}).get("name"))
    add_audit(data, actor, "request_status_changed", "housing_request", request.get("id"), {"status": status})
    return request


# ---------------------------------------------------------------------------
# تناوب الأسرّة
# ---------------------------------------------------------------------------

def schedule_rotation(data: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    bed = bed_by_id(data, payload.get("bedId"))
    if not bed:
        raise ServiceError("السرير غير موجود", 404)
    outgoing = resident_by_id(data, payload.get("outgoingResidentId"))
    incoming = resident_by_id(data, payload.get("incomingResidentId"))
    if not outgoing or not incoming:
        raise ServiceError("يجب اختيار الساكن الحالي والساكن التالي")
    if str(outgoing.get("id")) == str(incoming.get("id")):
        raise ServiceError("لا يمكن جدولة تناوب لنفس الساكن")
    occupant = resident_on_bed(data, str(bed.get("id")))
    if not occupant or str(occupant.get("id")) != str(outgoing.get("id")):
        raise ServiceError("الساكن الحالي لا يشغل هذا السرير", 409)
    scheduled = parse_date(payload.get("scheduledFor"))
    if not scheduled:
        scheduled = datetime.now(timezone.utc) + timedelta(days=1)
    item = {
        "id": new_id("ROT-"),
        "bedId": bed.get("id"),
        "outgoingResidentId": outgoing.get("id"),
        "incomingResidentId": incoming.get("id"),
        "scheduledFor": scheduled.isoformat(timespec="milliseconds"),
        "status": "مجدول",
        "createdAt": now_iso(),
        "createdBy": (actor or {}).get("name", ""),
        "executedAt": None,
    }
    data.setdefault("rotations", []).insert(0, item)
    create_housing_request(
        data,
        {
            "requestType": "نقل سرير",
            "residentId": incoming.get("id"),
            "details": f"تناوب مجدول على {bed.get('label')} بتاريخ {date_only(scheduled)}",
        },
        actor,
    )
    add_audit(data, actor, "rotation_scheduled", "rotation", item["id"], {"bed": bed.get("label")})
    return item


def execute_rotation(data: dict[str, Any], rotation: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    if rotation.get("status") != "مجدول":
        raise ServiceError("التناوب ليس مجدولاً أو تم تنفيذه مسبقاً", 409)
    outgoing = resident_by_id(data, rotation.get("outgoingResidentId"))
    incoming = resident_by_id(data, rotation.get("incomingResidentId"))
    if not outgoing or not incoming:
        raise ServiceError("أحد الساكنين غير موجود", 409)
    bed_id = str(rotation.get("bedId"))
    # أخلِ السرير من الساكن الحالي أولاً حتى لا يُرفض تسكين القادم.
    if outgoing.get("bedId") and str(outgoing.get("bedId")) == bed_id:
        unassign_bed(data, outgoing)
    if incoming.get("bedId") and str(incoming.get("bedId")) != bed_id:
        unassign_bed(data, incoming)
    assign_bed(data, incoming, bed_id)
    rotation["status"] = "منفذ"
    rotation["executedAt"] = now_iso()
    add_audit(data, actor, "rotation_executed", "rotation", rotation.get("id"))
    return rotation


def cancel_rotation(data: dict[str, Any], rotation: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any]:
    if rotation.get("status") != "مجدول":
        raise ServiceError("لا يمكن إلغاء تناوب غير مجدول", 409)
    rotation["status"] = "ملغي"
    rotation["cancelledAt"] = now_iso()
    add_audit(data, actor, "rotation_cancelled", "rotation", rotation.get("id"))
    return rotation
