from __future__ import annotations

from typing import Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWTError

from app.core.permissions import effective_permissions, has_permission
from app.core.security import decode_token
from app.core.state import store

bearer = HTTPBearer(auto_error=False)

ALLOWED_UNLESS_CHANGED = {"/api/auth/change-password", "/api/auth/me", "/api/auth/logout"}


def _user_by_id(user_id: str) -> dict[str, Any] | None:
    data = store.read()
    for user in data.get("users", []):
        if str(user.get("id")) == str(user_id):
            return user
    return None


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict[str, Any]:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="غير مصادق — سجّل الدخول أولاً")
    try:
        payload = decode_token(credentials.credentials)
        if payload.get("type") != "access" or not payload.get("sub"):
            raise HTTPException(status_code=401, detail="جلسة غير صالحة")
    except PyJWTError:
        raise HTTPException(status_code=401, detail="جلسة منتهية أو غير صالحة")
    user = _user_by_id(str(payload["sub"]))
    if not user or user.get("isActive", True) is False:
        raise HTTPException(status_code=401, detail="الحساب غير موجود أو موقوف")
    if int(payload.get("pv") or 0) != int(user.get("tokenVersion") or 0):
        raise HTTPException(status_code=401, detail="انتهت الجلسة — سجّل الدخول مجدداً")
    if user.get("mustChangePassword") and request.url.path not in ALLOWED_UNLESS_CHANGED:
        raise HTTPException(
            status_code=403,
            detail="يجب تغيير كلمة المرور قبل المتابعة",
            headers={"X-Must-Change-Password": "true"},
        )
    return user


def user_permissions(user: dict[str, Any]) -> list[str]:
    data = store.read()
    return effective_permissions(user, data.get("roles", []))


def require_permission(permission: str):
    def checker(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        data = store.read()
        if not has_permission(user, data.get("roles", []), permission):
            raise HTTPException(status_code=403, detail="لا تملك صلاحية هذا الإجراء")
        return user

    return checker


def require_any_permission(*permissions: str):
    def checker(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        data = store.read()
        perms = set(effective_permissions(user, data.get("roles", [])))
        if not perms.intersection(permissions):
            raise HTTPException(status_code=403, detail="لا تملك صلاحية هذا الإجراء")
        return user

    return checker


def require_staff(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    data = store.read()
    perms = set(effective_permissions(user, data.get("roles", [])))
    if perms == {"contractor.portal"}:
        raise HTTPException(status_code=403, detail="هذه الشاشة غير متاحة لحساب المتعهد")
    return user


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"
