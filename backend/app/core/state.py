from __future__ import annotations

import copy
import json
import logging
import os
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app.core.config import settings
from app.core.permissions import (
    PERMISSION_IDS,
    ROLE_DEFAULT_BY_ROLE,
    SYSTEM_ROLES,
    default_role_id,
)
from app.core.security import hash_password

logger = logging.getLogger("uvicorn.error")

LIST_KEYS = (
    "buildings",
    "rooms",
    "beds",
    "residents",
    "requests",
    "users",
    "contractors",
    "contractorWorkers",
    "contractorRequests",
    "roles",
    "rotations",
    "notifications",
    "auditLog",
)

DEFAULT_SETTINGS: dict[str, Any] = {
    "orgName": "إدارة السكن",
    "orgSubtitle": "نظام إسكان الموظفين والمتعهدين",
    "buildingLabel": "مبنى",
    "defaultPageSize": 50,
    "lowVacancyThreshold": 5,
    "notifyOnRequestStage": True,
    "notifyOnLowVacancy": True,
    "requireEmployeeCode": True,
    "minWorkerAge": 18,
    "features": {
        "bedRotations": True,
        "auditLog": True,
        "notifications": True,
        "bulkImport": True,
        "contractorPortal": True,
    },
}

SYSTEM_USERS: list[dict[str, Any]] = [
    {
        "id": "demo-visitor-00000000000000000001",
        "name": "مراقب الزوار",
        "username": "visitor",
        "password": "123456",
        "role": "visitorSupervisor",
        "roleId": "r_visitor",
    },
    {
        "id": "demo-dept-manager-0000000000000001",
        "name": "مدير إدارة المتعهد/المقاول",
        "username": "dept_manager",
        "password": "123456",
        "role": "deptManager",
        "roleId": "r_dept_manager",
    },
]


def now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _seed_state() -> dict[str, Any]:
    path: Path = settings.seed_path
    if not path.is_file():
        logger.warning("seed.json غير موجود في %s — سيبدأ النظام ببيانات فارغة", path)
        return {key: [] for key in LIST_KEYS}
    with path.open("r", encoding="utf-8") as fh:
        seed = json.load(fh)
    data: dict[str, Any] = {key: seed.get(key) or [] for key in LIST_KEYS}
    return data


def _ensure_roles(data: dict[str, Any]) -> bool:
    changed = False
    roles = data.setdefault("roles", [])
    if not isinstance(roles, list):
        data["roles"] = roles = []
        changed = True
    by_id = {str(r.get("id")): r for r in roles if isinstance(r, dict)}
    for system_role in SYSTEM_ROLES:
        existing = by_id.get(system_role["id"])
        if not existing:
            roles.append(copy.deepcopy(system_role))
            changed = True
            continue
        # الأدوار النظامية تحصل دائماً على صلاحياتها الأساسية والصلاحيات الجديدة.
        perms = existing.get("permissionIds")
        if not isinstance(perms, list):
            perms = []
            existing["permissionIds"] = perms
            changed = True
        if existing.get("id") == "r_admin":
            target = list(PERMISSION_IDS)
        else:
            target = list(system_role["permissionIds"])
        for permission in target:
            if permission not in perms:
                perms.append(permission)
                changed = True
        if existing.get("isSystem") is not True:
            existing["isSystem"] = True
            changed = True
    # ضمان أن كل مستخدم له دور فعلي موجود.
    for user in data.get("users", []):
        if not isinstance(user, dict):
            continue
        role_id = default_role_id(user)
        if role_id not in by_id:
            fallback = SYSTEM_ROLES[0]["id"]
            if user.get("roleId") != fallback:
                user["roleId"] = fallback
                changed = True
    return changed


def _ensure_users(data: dict[str, Any]) -> bool:
    changed = False
    users = data.setdefault("users", [])
    if not isinstance(users, list):
        data["users"] = users = []
        changed = True
    usernames = {str(u.get("username", "")).strip().lower() for u in users if isinstance(u, dict)}
    for demo in SYSTEM_USERS:
        if demo["username"].lower() not in usernames:
            users.append(copy.deepcopy(demo))
            changed = True
    return changed


def _migrate_passwords(data: dict[str, Any]) -> bool:
    """يحوّل كلمات المرور النصية القديمة إلى scrypt دون فقدان الحسابات."""
    changed = False
    for user in data.get("users", []):
        if not isinstance(user, dict):
            continue
        stored_hash = str(user.get("passwordHash") or "").strip()
        legacy = str(user.get("password") or "")
        if legacy:
            if not stored_hash:
                user["passwordHash"] = hash_password(legacy)
            user.pop("password", None)
            changed = True
        elif stored_hash:
            user.pop("password", None)
    return changed


def _normalize_users(data: dict[str, Any]) -> bool:
    changed = False
    for user in data.get("users", []):
        if not isinstance(user, dict):
            continue
        defaults: dict[str, Any] = {
            "name": "",
            "username": "",
            "phone": "",
            "role": "housingSupervisor",
            "roleId": None,
            "contractorId": None,
            "contractorName": "",
            "companyName": "",
            "isActive": True,
            "mustChangePassword": False,
            "tokenVersion": 0,
            "permissionIds": [],
        }
        for key, value in defaults.items():
            if key not in user:
                user[key] = copy.deepcopy(value)
                changed = True
        if not user.get("roleId"):
            user["roleId"] = ROLE_DEFAULT_BY_ROLE.get(str(user.get("role")), "r_housing")
            changed = True
        if not isinstance(user.get("permissionIds"), list):
            user["permissionIds"] = []
            changed = True
    return changed


# ---------------------------------------------------------------------------
# إدارات المتعهدين — تُحدد تلقائياً من اسم المتعهد عند غيابها فقط
# (لا تتجاوز تعديل المدير اليدوي).
# ---------------------------------------------------------------------------
CONTRACTOR_DEPARTMENTS: tuple[str, ...] = (
    "إدارة الشؤون",
    "إدارة التخطيط",
    "إدارة التعبئة",
    "إدارة الصيانة",
)

DEPARTMENT_KEYWORDS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("مطعم", "بوفية", "بوفيه", "زراع", "نظاف", "حلاق", "حلاقة", "صالون"), "إدارة الشؤون"),
    (("دكة تحميل", "دكّة", "دكة", "تحميل"), "إدارة التخطيط"),
    (("تعبئة", "تعبئ"), "إدارة التعبئة"),
)


def contractor_department_for_name(name: str) -> str:
    text = str(name or "").strip()
    for keywords, department in DEPARTMENT_KEYWORDS:
        if any(keyword in text for keyword in keywords):
            return department
    return "إدارة الصيانة"


def _ensure_contractors_departments(data: dict[str, Any]) -> bool:
    changed = False
    departments = set(CONTRACTOR_DEPARTMENTS)
    for contractor in data.get("contractors", []):
        if not isinstance(contractor, dict):
            continue
        current = str(contractor.get("department") or "").strip()
        if current in departments:
            continue
        if current:
            contractor["department"] = current
        else:
            contractor["department"] = contractor_department_for_name(str(contractor.get("name") or ""))
        changed = True
    return changed


def normalize_state(data: dict[str, Any]) -> bool:
    changed = False
    if not isinstance(data, dict):
        raise ValueError("حالة البيانات يجب أن تكون كائناً JSON")
    for key in LIST_KEYS:
        value = data.get(key)
        if not isinstance(value, list):
            data[key] = []
            changed = True
    if data.get("schemaVersion") != 3:
        data["schemaVersion"] = 3
        changed = True
    if not isinstance(data.get("settings"), dict):
        data["settings"] = copy.deepcopy(DEFAULT_SETTINGS)
        changed = True
    else:
        for key, value in DEFAULT_SETTINGS.items():
            if key not in data["settings"]:
                data["settings"][key] = copy.deepcopy(value)
                changed = True
        if not isinstance(data["settings"].get("features"), dict):
            data["settings"]["features"] = copy.deepcopy(DEFAULT_SETTINGS["features"])
            changed = True
    if data.pop("tokens", None) is not None:
        changed = True
    changed = _ensure_roles(data) or changed
    changed = _ensure_users(data) or changed
    changed = _migrate_passwords(data) or changed
    changed = _normalize_users(data) or changed
    changed = _ensure_contractors_departments(data) or changed
    return changed


def counts(data: dict[str, Any]) -> dict[str, int]:
    return {
        "buildings": len(data.get("buildings") or []),
        "rooms": len(data.get("rooms") or []),
        "beds": len(data.get("beds") or []),
        "residents": len(data.get("residents") or []),
        "requests": len(data.get("requests") or []),
        "users": len(data.get("users") or []),
        "contractors": len(data.get("contractors") or []),
        "contractorWorkers": len(data.get("contractorWorkers") or []),
        "contractorRequests": len(data.get("contractorRequests") or []),
        "roles": len(data.get("roles") or []),
        "rotations": len(data.get("rotations") or []),
        "notifications": len(data.get("notifications") or []),
        "auditLog": len(data.get("auditLog") or []),
    }


class StateStore:
    """مخزن الحالة الموحّد: ملف JSON محلي أو جدول kv_store في PostgreSQL.

    المفتاح الافتراضي هو housing_state_v1 نفسه المستخدم في النسخة الحالية،
    لذلك تبقى بيانات الإنتاج كما هي عند تشغيل الخادم الجديد.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._data: dict[str, Any] = {}
        self.mode = "postgres" if settings.database_url.strip() else "file"
        self._engine: Engine | None = None

    # ------------------------------------------------------------------ setup
    def initialize(self) -> None:
        with self._lock:
            if self.mode == "postgres":
                self._init_pg()
                data, exists = self._read_pg()
            else:
                data, exists = self._read_file()
            if not exists:
                data = _seed_state()
            changed = normalize_state(data)
            self._data = data
            if not exists or changed:
                self._save_locked()
            logger.info(
                "التخزين: %s — %s",
                "PostgreSQL kv_store" if self.mode == "postgres" else str(settings.data_path),
                counts(self._data),
            )

    # ---------------------------------------------------------------- postgres
    def _connect_engine(self) -> Engine:
        if self._engine is None:
            self._engine = create_engine(
                settings.sqlalchemy_database_url,
                pool_pre_ping=True,
                pool_size=3,
                max_overflow=5,
                pool_recycle=1800,
            )
        return self._engine

    def _init_pg(self) -> None:
        engine = self._connect_engine()
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS kv_store ("
                    "key TEXT PRIMARY KEY, "
                    "value JSONB NOT NULL, "
                    "updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"
                )
            )

    def _read_pg(self) -> tuple[dict[str, Any], bool]:
        engine = self._connect_engine()
        with engine.begin() as conn:
            row = conn.execute(
                text("SELECT value FROM kv_store WHERE key = :key"),
                {"key": settings.state_key},
            ).fetchone()
        if not row:
            return {}, False
        value = row[0]
        if isinstance(value, str):
            value = json.loads(value)
        if not isinstance(value, dict):
            raise RuntimeError("قيمة kv_store ليست كائن JSON صالحاً")
        return value, True

    def _save_pg(self, data: dict[str, Any]) -> None:
        engine = self._connect_engine()
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO kv_store (key, value, updated_at) "
                    "VALUES (:key, CAST(:value AS JSONB), now()) "
                    "ON CONFLICT (key) DO UPDATE "
                    "SET value = EXCLUDED.value, updated_at = now()"
                ),
                {"key": settings.state_key, "value": payload},
            )

    # -------------------------------------------------------------------- file
    def _read_file(self) -> tuple[dict[str, Any], bool]:
        path = settings.data_path
        if not path.is_file():
            return {}, False
        try:
            with path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                return data, True
            logger.error("data.json ليس كائناً JSON — سيتم تجاهله")
        except (OSError, ValueError) as exc:
            logger.error("تعذر قراءة data.json: %s", exc)
        return {}, False

    def _save_file(self, data: dict[str, Any]) -> None:
        path = settings.data_path
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, path)

    # ------------------------------------------------------------------- core
    def _save_locked(self) -> None:
        if self.mode == "postgres":
            self._save_pg(self._data)
        else:
            self._save_file(self._data)

    def save(self) -> None:
        with self._lock:
            self._save_locked()

    def read(self) -> dict[str, Any]:
        """قراءة مرجعية للبيانات. لا تُعدّل النتيجة خارج transaction."""
        with self._lock:
            return self._data

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._data)

    @contextmanager
    def transaction(self) -> Iterator[dict[str, Any]]:
        with self._lock:
            yield self._data
            self._save_locked()

    @contextmanager
    def atomic(self) -> Iterator[dict[str, Any]]:
        """معاملة ذرّية: تُطبّق التعديلات على نسخة، ولا تُحفظ عند حدوث خطأ."""
        with self._lock:
            draft = copy.deepcopy(self._data)
            yield draft
            self._data = draft
            self._save_locked()

    def replace(self, data: dict[str, Any]) -> None:
        with self._lock:
            normalize_state(data)
            self._data = data
            self._save_locked()

    def diagnostics(self) -> dict[str, Any]:
        with self._lock:
            return {
                "mode": self.mode,
                "stateKey": settings.state_key if self.mode == "postgres" else str(settings.data_path),
                "counts": counts(self._data),
                "schemaVersion": self._data.get("schemaVersion", 3),
            }


store = StateStore()
