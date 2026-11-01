from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.api import (
    admin,
    auth,
    bootstrap,
    contractor_requests,
    contractors,
    guests,
    housing,
    notifications,
    operations,
    reports,
    requests as housing_requests,
    residents,
    search,
)
from app.core.config import settings
from app.core.state import counts, store
from app.services.common import ServiceError, now_iso

logger = logging.getLogger("uvicorn.error")

DIST_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response


@asynccontextmanager
async def lifespan(_: FastAPI):
    errors = settings.runtime_errors()
    if errors:
        raise RuntimeError("إعدادات أمان غير صالحة: " + " ; ".join(errors))
    store.initialize()
    for warning in settings.runtime_warnings():
        logger.warning("SECURITY: %s", warning)
    data = store.read()
    if not data.get("users"):
        logger.error("لا يوجد مستخدمون في قاعدة البيانات — تعذّر تحميل البذرة")
    else:
        logger.info("نظام إدارة السكن جاهز — %s مستخدم، %s ساكن", len(data.get("users", [])), len(data.get("residents", [])))
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Must-Change-Password"],
)


@app.exception_handler(ServiceError)
async def service_error_handler(_: Request, exc: ServiceError):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(part) for part in first.get("loc", []) if part not in ("body", "query"))
    message = first.get("msg", "بيانات غير صالحة")
    detail = f"حقل «{field}»: {message}" if field else message
    return JSONResponse(status_code=422, content={"detail": detail, "errors": exc.errors()})


for module in (
    auth,
    bootstrap,
    residents,
    housing,
    housing_requests,
    contractor_requests,
    contractors,
    guests,
    operations,
    reports,
    notifications,
    admin,
    search,
):
    app.include_router(module.router)


@app.get("/api/health", tags=["health"])
def api_health():
    data = store.read()
    return {
        "ok": True,
        "status": "ok",
        "service": settings.app_name,
        "version": settings.app_version,
        "environment": settings.environment,
        "time": now_iso(),
        "counts": counts(data),
        "store": store.mode,
    }


@app.get("/health", tags=["health"])
def health():
    return api_health()


@app.get("/", include_in_schema=False)
def backend_root_status():
    return {
        "ok": True,
        "status": "ok",
        "service": settings.app_name,
        "version": settings.app_version,
        "message": "Backend API is running",
        "health": "/health",
        "api": "/api",
    }

