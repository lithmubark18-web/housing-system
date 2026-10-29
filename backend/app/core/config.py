from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SECRET_KEY = "change-me-in-production"
KNOWN_WEAK_KEYS = {
    "",
    "change-me",
    "secret",
    "secret-key",
    "replace-with-a-secret-key",
    "replace-with-a-long-random-production-secret",
    "replace-with-a-long-random-inbound-key",
    DEFAULT_SECRET_KEY,
}

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "نظام إدارة السكن"
    app_version: str = "2.0.0"
    environment: str = "development"
    secret_key: str = DEFAULT_SECRET_KEY
    access_token_expire_minutes: int = 720
    refresh_token_expire_days: int = 30

    # عند ترك DATABASE_URL فارغاً يعمل التخزين على ملف JSON محلي.
    # عند ضبطه على Supabase/PostgreSQL يُستخدم جدول kv_store بنفس المفتاح
    # الذي يستخدمه التطبيق الحالي (housing_state_v1) للحفاظ على البيانات.
    database_url: str = ""
    state_key: str = "housing_state_v1"
    data_file: str = "data.json"
    seed_file: str = "seed.json"

    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3444,http://127.0.0.1:3444"
    force_password_change: bool = False
    max_upload_mb: int = 25
    audit_limit: int = 8000

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def sqlalchemy_database_url(self) -> str:
        url = self.database_url.strip()
        if url.startswith("postgres://"):
            return "postgresql+psycopg://" + url[len("postgres://"):]
        if url.startswith("postgresql://"):
            return "postgresql+psycopg://" + url[len("postgresql://"):]
        return url

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    @property
    def secure_secret(self) -> bool:
        key = self.secret_key.strip()
        return bool(key) and key.lower() not in KNOWN_WEAK_KEYS and len(key) >= 32

    @property
    def data_path(self) -> Path:
        path = Path(self.data_file)
        return path if path.is_absolute() else BACKEND_DIR / path

    @property
    def seed_path(self) -> Path:
        path = Path(self.seed_file)
        return path if path.is_absolute() else BACKEND_DIR / path

    def runtime_warnings(self) -> list[str]:
        warnings: list[str] = []
        if not self.secure_secret:
            warnings.append("SECRET_KEY ضعيف: استخدم مفتاحاً عشوائياً بطول 32 حرفاً على الأقل في الإنتاج.")
        if not self.database_url.strip():
            warnings.append("DATABASE_URL غير مضبوط — يتم استخدام ملف data.json المحلي.")
        return warnings

    def runtime_errors(self) -> list[str]:
        errors: list[str] = []
        if self.is_production and not self.secure_secret:
            errors.append("SECRET_KEY إلزامي وقوي (32+ حرفاً عشوائياً) في بيئة الإنتاج.")
        return errors


settings = Settings()
