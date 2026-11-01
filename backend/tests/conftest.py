from __future__ import annotations

import os
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_DATA = BACKEND_DIR / "test_data.json"

# عزل بيئة الاختبار: تخزين ملف محلي ولا مساس بقاعدة بيانات أو ملفات الإنتاج.
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-pytest-only-32-characters")
os.environ["DATA_FILE"] = TEST_DATA.name
os.environ.setdefault("SEED_FILE", "seed.json")
os.environ["DATABASE_URL"] = ""
os.environ["FORCE_PASSWORD_CHANGE"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.main import app  # noqa: E402

# حماية: منع تشغيل الاختبارات مع قاعدة بيانات إنتاجية مضبوطة عبر DATABASE_URL.
if settings.database_url.strip():
    raise RuntimeError(
        "قاعدة بيانات مضبوطة عبر DATABASE_URL — اختبارات pytest تعمل على تخزين الملفات فقط، أفرغ DATABASE_URL أولاً."
    )


@pytest.fixture(scope="session")
def client():
    """عميل FastAPI على ملف بيانات اختباري (يُحذف قبل وبعد الجلسة)."""
    if TEST_DATA.exists():
        TEST_DATA.unlink()
    with TestClient(app) as test_client:
        yield test_client
    if TEST_DATA.exists():
        TEST_DATA.unlink()


@pytest.fixture(scope="session")
def admin_token(client) -> str:
    response = client.post("/api/auth/login", json={"username": "admin", "password": "123456"})
    assert response.status_code == 200
    token = response.json().get("access_token")
    assert token
    return token


@pytest.fixture(scope="session")
def admin_headers(admin_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {admin_token}"}
