from __future__ import annotations

import base64
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from app.core.config import settings

ALGORITHM = "HS256"

MAX_N = 2**16
MAX_R = 16
MAX_P = 4


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)
    return "scrypt$16384$8$1$%s$%s" % (
        base64.urlsafe_b64encode(salt).decode().rstrip("="),
        base64.urlsafe_b64encode(digest).decode().rstrip("="),
    )


def verify_password(password: str, stored: str) -> bool:
    if not stored:
        return False
    try:
        scheme, n, r, p, salt_b64, digest_b64 = stored.split("$", 5)
        if scheme != "scrypt":
            return False
        padding_salt = "=" * (-len(salt_b64) % 4)
        padding_digest = "=" * (-len(digest_b64) % 4)
        salt = base64.urlsafe_b64decode(salt_b64 + padding_salt)
        expected = base64.urlsafe_b64decode(digest_b64 + padding_digest)
        n = max(1, min(int(n), MAX_N))
        r = max(1, min(int(r), MAX_R))
        p = max(1, min(int(p), MAX_P))
        actual = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def verify_legacy_password(password: str, stored: str) -> bool:
    if not stored:
        return False
    return hmac.compare_digest(password.encode("utf-8"), str(stored).encode("utf-8"))


def create_token(subject: str, token_type: str, expires_delta: timedelta, token_version: int = 0) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "pv": token_version,
        "iat": now,
        "exp": now + expires_delta,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def create_access_token(user_id: str, token_version: int = 0) -> str:
    return create_token(
        user_id,
        "access",
        timedelta(minutes=settings.access_token_expire_minutes),
        token_version,
    )


def create_refresh_token(user_id: str, token_version: int = 0) -> str:
    return create_token(
        user_id,
        "refresh",
        timedelta(days=settings.refresh_token_expire_days),
        token_version,
    )


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
