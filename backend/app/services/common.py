from __future__ import annotations

import math
import re
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable

from app.core.permissions import effective_permissions, has_permission

class ServiceError(Exception):
    """خطأ عمل متوقع يُترجم إلى استجابة HTTP مفهومة للمستخدم."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


ARABIC_MONTHS = {
    1: "يناير", 2: "فبراير", 3: "مارس", 4: "أبريل", 5: "مايو", 6: "يونيو",
    7: "يوليو", 8: "أغسطس", 9: "سبتمبر", 10: "أكتوبر", 11: "نوفمبر", 12: "ديسمبر",
}


def new_id(prefix: str = "") -> str:
    value = uuid.uuid4().hex
    return f"{prefix}{value}" if prefix else value


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def today() -> date:
    return datetime.now(timezone.utc).date()


def parse_date(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    text = str(value).strip()
    if not text:
        return None
    try:
        if len(text) == 10:
            return datetime.strptime(text, "%Y-%m-%d")
        cleaned = text.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(cleaned)
        return parsed
    except (ValueError, TypeError):
        return None


def date_only(value: Any) -> str:
    parsed = parse_date(value)
    return parsed.strftime("%Y-%m-%d") if parsed else ""


def age_on(birth: Any, on: date | None = None) -> int | None:
    parsed = parse_date(birth)
    if not parsed:
        return None
    ref = on or today()
    years = ref.year - parsed.year
    if (ref.month, ref.day) < (parsed.month, parsed.day):
        years -= 1
    return max(0, years)


def normalize_card(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "")).strip().upper()


def bool_value(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on", "نعم"}


def int_value(value: Any, default: int = 0) -> int:
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return default


def clean_str(value: Any) -> str:
    return str(value or "").strip()


def is_housing_service(resident: dict[str, Any]) -> bool:
    return "سكن" in clean_str(resident.get("serviceType"))


def duty_status(resident: dict[str, Any], on: date | None = None) -> str:
    start = parse_date(resident.get("dutyCycleStart"))
    work = int_value(resident.get("dutyWorkDays"))
    rest = int_value(resident.get("dutyRestDays"))
    cycle = work + rest
    if not start or cycle <= 0:
        return ""
    ref = on or today()
    position = (ref - start.date()).days % cycle
    return "مداوم" if 0 <= position < work else "إجازة"


def duty_position(resident: dict[str, Any], on: date | None = None) -> dict[str, Any]:
    start = parse_date(resident.get("dutyCycleStart"))
    work = int_value(resident.get("dutyWorkDays"))
    rest = int_value(resident.get("dutyRestDays"))
    cycle = work + rest
    if not start or cycle <= 0:
        return {"status": "", "day": None, "cycle": 0}
    ref = on or today()
    position = (ref - start.date()).days % cycle
    return {"status": "مداوم" if position < work else "إجازة", "day": position + 1, "cycle": cycle}


def attendance_status(resident: dict[str, Any], on: date | None = None) -> str:
    """حالات الحضور: حاضر أو إجازة فقط، محسوبة ديناميكياً من دورة الدوام."""
    if not is_housing_service(resident):
        return ""
    if duty_status(resident, on) == "إجازة":
        return "إجازة"
    return "حاضر"


def percent(part: int, total: int) -> float:
    return round((part / total) * 100, 1) if total else 0.0


def human_date(value: Any) -> str:
    parsed = parse_date(value)
    return f"{parsed.day} {ARABIC_MONTHS.get(parsed.month, '')} {parsed.year}" if parsed else ""


def is_online_iso(value: Any) -> bool:
    return bool(parse_date(value))


def _permission_set(user: dict[str, Any], roles: Iterable[dict[str, Any]]) -> set[str]:
    return set(effective_permissions(user, roles))


def is_staff(user: dict[str, Any], roles: Iterable[dict[str, Any]]) -> bool:
    perms = _permission_set(user, roles)
    return bool(perms & {
        "dashboard.view", "residents.view", "housing.view", "operations.view",
        "reports.view", "requests.supervise", "requests.security", "requests.visitor",
        "admin.users",
    })


def can(user: dict[str, Any], roles: Iterable[dict[str, Any]], permission: str) -> bool:
    return has_permission(user, roles, permission)


def add_audit(
    data: dict[str, Any],
    user: dict[str, Any] | None,
    action: str,
    entity: str,
    entity_id: str = "",
    details: dict[str, Any] | None = None,
) -> None:
    entry = {
        "id": new_id("AUD-"),
        "at": now_iso(),
        "actorId": (user or {}).get("id"),
        "actorName": clean_str((user or {}).get("name")) or "النظام",
        "actorUsername": (user or {}).get("username", "system"),
        "action": action,
        "entity": entity,
        "entityId": str(entity_id or ""),
        "details": details or {},
    }
    logs = data.setdefault("auditLog", [])
    logs.insert(0, entry)
    limit = 8000
    if len(logs) > limit:
        del logs[limit:]


def add_notification(
    data: dict[str, Any],
    *,
    title: str,
    body: str = "",
    kind: str = "info",
    permission: str | None = None,
    user_ids: Iterable[str] | None = None,
    link: str = "",
    actor: dict[str, Any] | None = None,
) -> dict[str, Any]:
    item = {
        "id": new_id("NTF-"),
        "title": title,
        "body": body,
        "kind": kind,
        "permission": permission,
        "userIds": [str(v) for v in (user_ids or [])],
        "link": link,
        "createdAt": now_iso(),
        "actorId": (actor or {}).get("id"),
        "actorName": clean_str((actor or {}).get("name")) or "النظام",
        "readBy": [],
    }
    notes = data.setdefault("notifications", [])
    notes.insert(0, item)
    if len(notes) > 3000:
        del notes[3000:]
    return item


def notifications_for(
    data: dict[str, Any],
    user: dict[str, Any],
    roles: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    perms = _permission_set(user, roles)
    user_id = str(user.get("id") or "")
    result: list[dict[str, Any]] = []
    for note in data.get("notifications", []):
        audience = note.get("userIds") or []
        permission = note.get("permission")
        if audience and user_id not in {str(v) for v in audience}:
            continue
        if not audience and permission and permission not in perms:
            continue
        item = dict(note)
        item["read"] = user_id in {str(v) for v in (note.get("readBy") or [])}
        item.pop("readBy", None)
        result.append(item)
    return result


def mark_notification_read(data: dict[str, Any], user: dict[str, Any], notification_id: str | None = None) -> int:
    user_id = str(user.get("id") or "")
    changed = 0
    for note in data.get("notifications", []):
        if notification_id and note.get("id") != notification_id:
            continue
        read_by = note.setdefault("readBy", [])
        if user_id not in read_by:
            read_by.append(user_id)
            changed += 1
    return changed


def paged(items: list[Any], page: int, page_size: int) -> dict[str, Any]:
    page = max(1, page)
    page_size = max(1, min(page_size, 500))
    total = len(items)
    start = (page - 1) * page_size
    return {
        "items": items[start:start + page_size],
        "total": total,
        "page": page,
        "pageSize": page_size,
        "pages": max(1, math.ceil(total / page_size)) if total else 0,
    }


def csv_safe(value: Any) -> str:
    text = str(value if value is not None else "")
    if any(ch in text for ch in [",", '"', "\n", "\r"]):
        return '"' + text.replace('"', '""') + '"'
    return text


def build_csv(headers: list[str], rows: list[list[Any]]) -> bytes:
    lines = [",".join(csv_safe(h) for h in headers)]
    for row in rows:
        lines.append(",".join(csv_safe(v) for v in row))
    return ("\ufeff" + "\r\n".join(lines)).encode("utf-8")
