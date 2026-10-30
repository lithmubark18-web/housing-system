from __future__ import annotations

from typing import Any, Iterable

# ---------------------------------------------------------------------------
# كتالوج الصلاحيات — نفس معرّفات التطبيق الحالي مع صلاحيات إضافية للنسخة الجديدة.
# ---------------------------------------------------------------------------

PERMISSIONS: list[dict[str, str]] = [
    {"id": "dashboard.view", "label": "عرض لوحة المعلومات", "group": "الشاشات"},
    {"id": "residents.view", "label": "عرض السكان", "group": "الشاشات"},
    {"id": "housing.view", "label": "عرض السكن والأسرّة", "group": "الشاشات"},
    {"id": "operations.view", "label": "عرض المتابعة والحضور", "group": "الشاشات"},
    {"id": "reports.view", "label": "عرض التقارير", "group": "الشاشات"},
    {"id": "residents.manage", "label": "إدارة السكان (إضافة/تعديل/حذف)", "group": "العمليات"},
    {"id": "housing.manage", "label": "إدارة المباني والغرف والأسرّة والتنقلات", "group": "العمليات"},
    {"id": "requests.supervise", "label": "اعتماد طلبات المتعهدين (مراقب السكن)", "group": "الاعتماد"},
    {"id": "requests.security", "label": "الاعتماد الأمني (مشرف الأمن)", "group": "الاعتماد"},
    {"id": "requests.visitor", "label": "اعتماد مراقب الزوار (كود الموظف والعمر)", "group": "الاعتماد"},
    {"id": "requests.department", "label": "ادارة المتعهد/المقاول (اعتماد مدير الإدارة قبل مشرف الأمن)", "group": "الاعتماد"},
    {"id": "contractor.portal", "label": "بوابة المتعهد/المقاول", "group": "خاص"},
    {"id": "admin.users", "label": "إدارة المستخدمين والأدوار", "group": "الإدارة"},
    # صلاحيات جديدة
    {"id": "residents.import", "label": "استيراد وتصدير بيانات السكان", "group": "العمليات"},
    {"id": "reports.export", "label": "تصدير التقارير (Excel/CSV/PDF)", "group": "التقارير"},
    {"id": "contractors.manage", "label": "إدارة المتعهدين والكوادر", "group": "العمليات"},
    {"id": "audit.view", "label": "عرض سجل العمليات (Audit Log)", "group": "الإدارة"},
    {"id": "admin.settings", "label": "إعدادات النظام", "group": "الإدارة"},
    {"id": "admin.backup", "label": "النسخ الاحتياطي والاستعادة", "group": "الإدارة"},
]

PERMISSION_IDS: tuple[str, ...] = tuple(p["id"] for p in PERMISSIONS)
PERMISSION_LABELS: dict[str, str] = {p["id"]: p["label"] for p in PERMISSIONS}

ROLE_DEFAULT_PERMISSIONS: dict[str, list[str]] = {
    "r_housing": [
        "dashboard.view",
        "residents.view",
        "housing.view",
        "operations.view",
        "reports.view",
        "residents.manage",
        "residents.import",
        "reports.export",
        "housing.manage",
        "contractors.manage",
        "requests.supervise",
    ],
    "r_security": ["operations.view", "requests.security"],
    "r_visitor": ["operations.view", "requests.visitor"],
    "r_contractor": ["contractor.portal"],
    "r_admin": list(PERMISSION_IDS),
    "r_dept_manager": [
        "dashboard.view",
        "operations.view",
        "requests.department",
    ],
}

SYSTEM_ROLES: list[dict[str, Any]] = [
    {
        "id": "r_housing",
        "name": "مراقب السكن",
        "description": "يشرف على السكن والسكان ويعتمد طلبات المتعهدين أولياً",
        "isSystem": True,
        "permissionIds": ROLE_DEFAULT_PERMISSIONS["r_housing"],
    },
    {
        "id": "r_security",
        "name": "مشرف الأمن",
        "description": "يعتمد الطلبات أمنياً (المرحلة الأمنية)",
        "isSystem": True,
        "permissionIds": ROLE_DEFAULT_PERMISSIONS["r_security"],
    },
    {
        "id": "r_visitor",
        "name": "مراقب الزوار",
        "description": "يدقّق بيانات العامل (كود الموظف والعمر) ويعتمد الطلبات",
        "isSystem": True,
        "permissionIds": ROLE_DEFAULT_PERMISSIONS["r_visitor"],
    },
    {
        "id": "r_contractor",
        "name": "متعهد/مقاول",
        "description": "بوابة المتعهد لإدارة عمالته وتقديم الطلبات",
        "isSystem": True,
        "permissionIds": ROLE_DEFAULT_PERMISSIONS["r_contractor"],
    },
    {
        "id": "r_admin",
        "name": "مدير النظام",
        "description": "كامل الصلاحيات بما فيها إدارة المستخدمين والأدوار والنسخ الاحتياطي",
        "isSystem": True,
        "permissionIds": ROLE_DEFAULT_PERMISSIONS["r_admin"],
    },
    {
        "id": "r_dept_manager",
        "name": "مدير إدارة المتعهد/المقاول",
        "description": "ادارة المتعهد/المقاول — اعتماد طلباته قبل مشرف الأمن",
        "isSystem": True,
        "permissionIds": ROLE_DEFAULT_PERMISSIONS["r_dept_manager"],
    },
]

ROLE_DEFAULT_BY_ROLE: dict[str, str] = {
    "admin": "r_admin",
    "contractor": "r_contractor",
    "securitySupervisor": "r_security",
    "visitorSupervisor": "r_visitor",
    "housingSupervisor": "r_housing",
    "deptManager": "r_dept_manager",
}

ROLE_LABELS: dict[str, str] = {
    "admin": "مدير النظام",
    "housingSupervisor": "مراقب السكن",
    "securitySupervisor": "مشرف الأمن",
    "visitorSupervisor": "مراقب الزوار",
    "contractor": "متعهد/مقاول",
    "deptManager": "مدير إدارة المتعهد/المقاول",
}


def default_role_id(user: dict[str, Any]) -> str:
    role_id = str(user.get("roleId") or "").strip()
    if role_id:
        return role_id
    return ROLE_DEFAULT_BY_ROLE.get(str(user.get("role") or ""), "r_housing")


def role_for(user: dict[str, Any], roles: Iterable[dict[str, Any]]) -> dict[str, Any] | None:
    role_id = default_role_id(user)
    for role in roles:
        if role.get("id") == role_id:
            return role
    return None


def permissions_for_role(role: dict[str, Any] | None) -> set[str]:
    if not role:
        return set()
    values = role.get("permissionIds") or []
    return {str(v) for v in values if str(v) in PERMISSION_LABELS}


def effective_permissions(user: dict[str, Any], roles: Iterable[dict[str, Any]]) -> list[str]:
    role = role_for(user, roles)
    role_id = role.get("id") if role else default_role_id(user)
    if role_id == "r_admin":
        return list(PERMISSION_IDS)
    perms = permissions_for_role(role)
    # صلاحية صريحة على مستوى المستخدم (اختيارية) تُضاف فوق صلاحيات الدور.
    extra = user.get("permissionIds") or []
    if isinstance(extra, list):
        perms.update(str(v) for v in extra if str(v) in PERMISSION_LABELS)
    return [p for p in PERMISSION_IDS if p in perms]


def has_permission(user: dict[str, Any], roles: Iterable[dict[str, Any]], permission: str) -> bool:
    return permission in effective_permissions(user, roles)


def public_user(user: dict[str, Any], roles: Iterable[dict[str, Any]]) -> dict[str, Any]:
    role = role_for(user, roles)
    perms = effective_permissions(user, roles)
    data = {
        "id": user.get("id"),
        "name": user.get("name", ""),
        "username": user.get("username", ""),
        "role": user.get("role", "housingSupervisor"),
        "roleId": role.get("id") if role else default_role_id(user),
        "roleName": role.get("name") if role else ROLE_LABELS.get(str(user.get("role")), "مستخدم"),
        "phone": user.get("phone", ""),
        "contractorId": user.get("contractorId"),
        "contractorName": user.get("contractorName", ""),
        "companyName": user.get("companyName", ""),
        "isActive": user.get("isActive", True) is not False,
        "mustChangePassword": bool(user.get("mustChangePassword")),
        "permissions": perms,
        "permissionMap": {p: True for p in perms},
    }
    return data
