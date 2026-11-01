from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from jwt import PyJWTError

from app.api.deps import client_ip, get_current_user, require_permission
from app.core.config import settings
from app.core.permissions import PERMISSION_LABELS, public_user
from app.core.ratelimit import enforce, login_ip_limiter, login_user_limiter, refresh_limiter
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_legacy_password,
    verify_password,
)
from app.core.state import store
from app.schemas.schemas import ChangePasswordRequest, LoginRequest, RefreshRequest
from app.services.common import clean_str, int_value, now_iso

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _find_user(data: dict[str, Any], username: str) -> dict[str, Any] | None:
    target = clean_str(username).lower()
    if not target:
        return None
    for user in data.get("users", []):
        if clean_str(user.get("username")).lower() == target:
            return user
    return None


def _user_by_id(data: dict[str, Any], user_id: str) -> dict[str, Any] | None:
    for user in data.get("users", []):
        if str(user.get("id")) == str(user_id):
            return user
    return None


def _public_for(user: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    return public_user(user, data.get("roles", []))


def _token_payload(user: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    version = int_value(user.get("tokenVersion"))
    access = create_access_token(str(user.get("id")), version)
    refresh = create_refresh_token(str(user.get("id")), version)
    return {
        "access_token": access,
        "refresh_token": refresh,
        # توافق مع التطبيقات القديمة التي تتوقع مفتاح token.
        "token": access,
        "token_type": "bearer",
        "expires_in": settings.access_token_expire_minutes * 60,
        "user": _public_for(user, data),
    }


@router.post("/login")
def login(payload: LoginRequest, request: Request):
    ip = client_ip(request)
    enforce(login_ip_limiter, f"login-ip:{ip}")
    user_key = f"login-user:{ip}:{clean_str(payload.username).lower()}"
    enforce(login_user_limiter, user_key)

    data = store.read()
    user = _find_user(data, payload.username)
    stored_hash = str((user or {}).get("passwordHash") or "")
    legacy = str((user or {}).get("password") or "")

    valid = False
    if user is not None:
        if stored_hash and verify_password(payload.password, stored_hash):
            valid = True
        elif legacy and verify_legacy_password(payload.password, legacy):
            valid = True

    if not valid or user is None or user.get("isActive", True) is False:
        login_user_limiter.record(user_key)
        login_ip_limiter.record(f"login-ip:{ip}")
        raise HTTPException(status_code=401, detail="اسم المستخدم أو كلمة المرور غير صحيحة")

    login_user_limiter.reset(user_key)
    login_ip_limiter.reset(f"login-ip:{ip}")

    with store.transaction() as state:
        target = _user_by_id(state, str(user.get("id")))
        if not target:
            raise HTTPException(status_code=401, detail="الحساب غير موجود")
        # ترقية كلمة المرور القديمة النصية عند أول دخول ناجح.
        if target.get("password") and not target.get("passwordHash"):
            target["passwordHash"] = hash_password(payload.password)
            target.pop("password", None)
        target["lastLoginAt"] = now_iso()
        if settings.force_password_change and not target.get("mustChangePassword"):
            target["mustChangePassword"] = True
        return _token_payload(target, state)


@router.post("/refresh")
def refresh(payload: RefreshRequest, request: Request):
    enforce(refresh_limiter, f"refresh-ip:{client_ip(request)}")
    try:
        token = decode_token(payload.refresh_token)
        if token.get("type") != "refresh" or not token.get("sub"):
            raise HTTPException(status_code=401, detail="رمز التحديث غير صالح")
    except PyJWTError:
        raise HTTPException(status_code=401, detail="رمز التحديث غير صالح")

    data = store.read()
    user = _user_by_id(data, str(token["sub"]))
    if not user or user.get("isActive", True) is False:
        raise HTTPException(status_code=401, detail="المستخدم غير موجود أو موقوف")
    if int_value(token.get("pv")) != int_value(user.get("tokenVersion")):
        raise HTTPException(status_code=401, detail="انتهت الجلسة — سجّل الدخول مجدداً")
    return _token_payload(user, data)


@router.get("/me")
def me(user: dict[str, Any] = Depends(get_current_user)):
    data = store.read()
    return {"user": _public_for(user, data)}


@router.post("/change-password")
def change_password(payload: ChangePasswordRequest, user: dict[str, Any] = Depends(get_current_user)):
    if not verify_password(payload.current_password, str(user.get("passwordHash") or "")):
        raise HTTPException(status_code=400, detail="كلمة المرور الحالية غير صحيحة")
    if payload.new_password == payload.current_password:
        raise HTTPException(status_code=400, detail="كلمة المرور الجديدة مطابقة للحالية")
    if len(payload.new_password.strip()) < 6:
        raise HTTPException(status_code=400, detail="كلمة المرور يجب أن تكون 6 أحرف على الأقل")

    with store.transaction() as data:
        target = _user_by_id(data, str(user.get("id")))
        if not target:
            raise HTTPException(status_code=404, detail="المستخدم غير موجود")
        target["passwordHash"] = hash_password(payload.new_password)
        target["mustChangePassword"] = False
        target["passwordChangedAt"] = now_iso()
        target["tokenVersion"] = int_value(target.get("tokenVersion")) + 1
        target["updatedAt"] = now_iso()
        result = _token_payload(target, data)
        result["ok"] = True
        result["message"] = "تم تغيير كلمة المرور بنجاح"
        return result


@router.post("/logout")
def logout(
    payload: dict[str, Any] | None = None,
    user: dict[str, Any] = Depends(get_current_user),
):
    """تسجيل الخروج. عند إرسال allDevices=true تُلغى كل الجلسات الأخرى."""
    if payload and payload.get("allDevices"):
        with store.transaction() as data:
            target = _user_by_id(data, str(user.get("id")))
            if target:
                target["tokenVersion"] = int_value(target.get("tokenVersion")) + 1
                target["updatedAt"] = now_iso()
    return {"ok": True, "message": "تم تسجيل الخروج"}


@router.get("/session")
def session(user: dict[str, Any] = Depends(get_current_user)):
    data = store.read()
    return {
        "user": _public_for(user, data),
        "settings": data.get("settings", {}),
        "permissionsCatalog": [{"id": pid, "label": label} for pid, label in PERMISSION_LABELS.items()],
    }


@router.get("/users/check")
def username_exists(
    username: str = "",
    _: dict[str, Any] = Depends(require_permission("admin.users")),
):
    """فحص توفر اسم المستخدم — يُستخدم في نموذج إنشاء الحساب."""
    data = store.read()
    return {"available": _find_user(data, username) is None, "username": clean_str(username)}


__all__ = ["router"]
