from __future__ import annotations

from datetime import timedelta
from typing import Any

from app.services.common import (
    ServiceError,
    add_audit,
    add_notification,
    clean_str,
    new_id,
    now_iso,
    parse_date,
    today,
)
from app.services.housing import (
    bed_by_id,
    building_by_id,
    guest_active_on_bed,
    normalize_housing_type,
    room_by_id,
    used_bed_ids,
)

GUEST_STATUSES = ("staying", "extended", "ended")
STATUS_LABELS = {"staying": "مقيم", "extended": "مُمدَّد", "ended": "منتهٍ"}


def _date_text(value: Any) -> str:
    parsed = parse_date(value)
    return parsed.date().isoformat() if parsed else ""


def guest_payload(data: dict[str, Any], guest: dict[str, Any]) -> dict[str, Any]:
    bed = bed_by_id(data, guest.get("bedId"))
    room = room_by_id(data, bed.get("roomId")) if bed else None
    building = building_by_id(data, room.get("buildingId")) if room else None
    return {
        "id": guest.get("id"),
        "name": clean_str(guest.get("name")),
        "cardNumber": clean_str(guest.get("cardNumber")),
        "birthDate": clean_str(guest.get("birthDate")),
        "birthPlace": clean_str(guest.get("birthPlace")),
        "fromPlace": clean_str(guest.get("fromPlace")),
        "department": clean_str(guest.get("department")),
        "approvalBy": clean_str(guest.get("approvalBy")),
        "visitPurpose": clean_str(guest.get("visitPurpose")),
        "startDate": clean_str(guest.get("startDate")),
        "days": guest.get("days"),
        "endDate": clean_str(guest.get("endDate")),
        "status": clean_str(guest.get("status")) or "staying",
        "statusLabel": STATUS_LABELS.get(clean_str(guest.get("status")) or "staying", "مقيم"),
        "formNo": clean_str(guest.get("formNo")),
        "notes": clean_str(guest.get("notes")),
        "extensions": guest.get("extensions") or [],
        "createdAt": guest.get("createdAt"),
        "createdBy": clean_str(guest.get("createdBy")),
        "endedAt": clean_str(guest.get("endedAt")),
        "endedBy": clean_str(guest.get("endedBy")),
        "housing": {
            "bedId": guest.get("bedId"),
            "bedLabel": clean_str((bed or {}).get("label")),
            "roomId": (room or {}).get("id"),
            "roomName": clean_str((room or {}).get("name")),
            "buildingId": (room or {}).get("buildingId"),
            "buildingName": clean_str((building or {}).get("name")),
            "housingType": normalize_housing_type((building or {}).get("housingType")),
        },
    }


def _assign_form_no(data: dict[str, Any], guest: dict[str, Any]) -> None:
    if guest.get("formNo"):
        return
    today_text = (today()).strftime("%Y%m%d")
    seq = 1
    for other in data.get("guests", []):
        other_no = clean_str(other.get("formNo"))
        if not other_no:
            continue
        parts = other_no.split("-")
        if len(parts) == 3 and parts[1] == today_text:
            try:
                seq = max(seq, int(parts[2]) + 1)
            except ValueError:
                pass
    guest["formNo"] = f"GH-{today_text}-{seq:02d}"


def _validate_bed(data: dict[str, Any], bed_id: Any, ignore_guest_id: str = "") -> dict[str, Any]:
    bed = bed_by_id(data, bed_id)
    if not bed:
        raise ServiceError("السرير غير موجود", 404)
    used = used_bed_ids(data)
    if ignore_guest_id:
        # التمديد/النقل: سرير الزائر نفسه لا يعتبر مشغولاً ضده.
        for guest in data.get("guests", []):
            if str(guest.get("id")) == str(ignore_guest_id) and guest_active_on_bed(guest):
                used.discard(str(guest.get("bedId")))
                break
    for guest in data.get("guests", []):
        if guest.get("id") == ignore_guest_id:
            continue
        if str(guest.get("bedId")) == str(bed_id) and guest.get("status") != "ended":
            used.add(str(bed_id))
            break
    if str(bed_id) in used:
        raise ServiceError("السرير مشغول — اختر سريراً شاغراً", 409)
    return bed


def create_guest(data: dict[str, Any], payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    name = clean_str(payload.get("name"))
    if not name:
        raise ServiceError("يرجى إدخال اسم الزائر")
    if not clean_str(payload.get("cardNumber")):
        raise ServiceError("يرجى إدخال رقم البطاقة")
    if not _date_text(payload.get("birthDate")):
        raise ServiceError("يرجى تحديد تاريخ الميلاد")
    if not clean_str(payload.get("birthPlace")):
        raise ServiceError("يرجى إدخال محل الميلاد")
    if not clean_str(payload.get("fromPlace")):
        raise ServiceError("يرجى إدخال الجهة القادم منها")
    if not clean_str(payload.get("department")):
        raise ServiceError("يرجى إدخال الإدارة التابع لها في الشركة")
    approval = clean_str(payload.get("approvalBy"))
    if approval not in {"الإدارة العليا", "مدير الشؤون الإدارية", "مشرف السكن"}:
        raise ServiceError("جهة الاعتماد يجب أن تكون: الإدارة العليا أو مدير الشؤون الإدارية أو مشرف السكن")
    if not clean_str(payload.get("visitPurpose")):
        raise ServiceError("يرجى إدخال غرض الزيارة")

    startDate = _date_text(payload.get("startDate")) or today().isoformat()
    try:
        days = int(payload.get("days") or 1)
    except (TypeError, ValueError):
        days = 1
    if days < 1 or days > 90:
        raise ServiceError("عدد أيام التسكين يجب أن يكون بين 1 و 90")

    bed_id = clean_str(payload.get("bedId"))
    bed = _validate_bed(data, bed_id)
    end = (parse_date(startDate).date() + timedelta(days=days - 1)).isoformat()

    guest = {
        "id": new_id("GH-"),
        "name": name,
        "cardNumber": clean_str(payload.get("cardNumber")),
        "birthDate": _date_text(payload.get("birthDate")),
        "birthPlace": clean_str(payload.get("birthPlace")),
        "fromPlace": clean_str(payload.get("fromPlace")),
        "department": clean_str(payload.get("department")),
        "approvalBy": approval,
        "visitPurpose": clean_str(payload.get("visitPurpose")),
        "startDate": startDate,
        "days": days,
        "endDate": end,
        "bedId": bed.get("id"),
        "status": "staying",
        "extensions": [],
        "formNo": None,
        "notes": clean_str(payload.get("notes")),
        "createdAt": now_iso(),
        "createdBy": clean_str(actor.get("name")) or clean_str(actor.get("username")),
    }
    data.setdefault("guests", []).insert(0, guest)
    _assign_form_no(data, guest)
    add_audit(data, actor, "guest_created", "guest", guest["id"], {"name": name, "bed": bed.get("label")})
    add_notification(
        data,
        title="تسكين زائر جديد",
        body=f"{name} — {clean_str(guest['formNo'])} — من {startDate} إلى {end}",
        kind="guest",
        permission="guests.view",
        actor=actor,
    )
    return guest


def extend_guest(data: dict[str, Any], guest_id: Any, payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    guest = _find(data, guest_id)
    if guest.get("status") == "ended":
        raise ServiceError("لا يمكن تمديد زائر منتهٍ", 409)
    try:
        days = int(payload.get("days") or 0)
    except (TypeError, ValueError):
        days = 0
    if days < 1 or days > 90:
        raise ServiceError("عدد أيام التمديد يجب أن يكون بين 1 و 90")
    reason = clean_str(payload.get("reason"))
    if not reason:
        raise ServiceError("يرجى إدخال سبب التمديد")
    approval = clean_str(payload.get("approvalBy"))
    if approval not in {"الإدارة العليا", "مدير الشؤون الإدارية", "مشرف السكن"}:
        raise ServiceError("جهة الاعتماد يجب أن تكون: الإدارة العليا أو مدير الشؤون الإدارية أو مشرف السكن")
    same_housing = bool(payload.get("sameHousing", True))
    new_bed_id = clean_str(payload.get("newBedId")) if not same_housing else clean_str(guest.get("bedId"))
    if not same_housing and not new_bed_id:
        raise ServiceError("يرجى تحديد السكن الجديد")
    bed = _validate_bed(data, new_bed_id, ignore_guest_id=str(guest.get("id")))

    base = guest.get("endDate") or guest.get("startDate") or today().isoformat()
    base_date = parse_date(base).date() if parse_date(base) else today()
    if base_date < today():
        base_date = today()
    guest["endDate"] = (base_date + timedelta(days=days)).isoformat()
    extension = {
        "at": now_iso(),
        "days": days,
        "reason": reason,
        "approvalBy": approval,
        "sameHousing": same_housing,
        "newBedId": bed.get("id") if not same_housing else guest.get("bedId"),
        "newBedLabel": clean_str((bed or {}).get("label")),
        "by": clean_str(actor.get("name")) or clean_str(actor.get("username")),
    }
    guest.setdefault("extensions", []).append(extension)
    guest["days"] = int(guest.get("days") or 0) + days
    if not same_housing:
        guest["bedId"] = bed.get("id")
    guest["status"] = "extended"
    add_audit(data, actor, "guest_extended", "guest", guest["id"], {"days": days, "reason": reason})
    add_notification(
        data,
        title="تمديد إقامة زائر",
        body=f"{guest.get('name')} — تمديد {days} يوم — حتى {guest['endDate']}",
        kind="guest",
        permission="guests.view",
        actor=actor,
    )
    return guest


def end_guest(data: dict[str, Any], guest_id: Any, payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    guest = _find(data, guest_id)
    if guest.get("status") == "ended":
        raise ServiceError("الزائر منتهٍ مسبقاً", 409)
    guest["status"] = "ended"
    guest["endedAt"] = now_iso()
    guest["endedBy"] = clean_str(actor.get("name")) or clean_str(actor.get("username"))
    guest["endReason"] = clean_str(payload.get("reason")) or "إنهاء إقامة الزائر"
    add_audit(data, actor, "guest_ended", "guest", guest["id"], {"name": guest.get("name")})
    return guest


def delete_guest(data: dict[str, Any], guest_id: Any, actor: dict[str, Any]) -> None:
    guest = _find(data, guest_id)
    data["guests"] = [g for g in data.get("guests", []) if g.get("id") != guest.get("id")]
    add_audit(data, actor, "guest_deleted", "guest", guest.get("id"), {"name": guest.get("name")})


def guests_report_rows(data: dict[str, Any], status: str = "", q: str = "") -> list[dict[str, Any]]:
    rows = [guest_payload(data, g) for g in data.get("guests", [])]
    status = clean_str(status)
    if status:
        rows = [r for r in rows if r.get("status") == status]
    q = clean_str(q).lower()
    if q:
        rows = [r for r in rows if q in str(r.get("name") or "").lower() or q in str(r.get("cardNumber") or "").lower()]
    rows.sort(key=lambda r: str(r.get("createdAt") or ""), reverse=True)
    return rows


def _find(data: dict[str, Any], guest_id: Any) -> dict[str, Any]:
    for guest in data.get("guests", []):
        if str(guest.get("id")) == str(guest_id):
            return guest
    raise ServiceError("الزائر غير موجود", 404)
