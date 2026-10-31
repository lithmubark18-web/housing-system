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

DIST_DIR = Path(__file__).resolve().parents[1] / "frontend" / "dist"


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
        raise RuntimeError("ط¥ط¹ط¯ط§ط¯ط§طھ ط£ظ…ط§ظ† ط؛ظٹط± طµط§ظ„ط­ط©: " + " ; ".join(errors))
    store.initialize()
    for warning in settings.runtime_warnings():
        logger.warning("SECURITY: %s", warning)
    data = store.read()
    if not data.get("users"):
        logger.error("ظ„ط§ ظٹظˆط¬ط¯ ظ…ط³طھط®ط¯ظ…ظˆظ† ظپظٹ ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ â€” طھط¹ط°ظ‘ط± طھط­ظ…ظٹظ„ ط§ظ„ط¨ط°ط±ط©")
    else:
        logger.info("ظ†ط¸ط§ظ… ط¥ط¯ط§ط±ط© ط§ظ„ط³ظƒظ† ط¬ط§ظ‡ط² â€” %s ظ…ط³طھط®ط¯ظ…طŒ %s ط³ط§ظƒظ†", len(data.get("users", [])), len(data.get("residents", [])))
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
    message = first.get("msg", "ط¨ظٹط§ظ†ط§طھ ط؛ظٹط± طµط§ظ„ط­ط©")
    detail = f"ط­ظ‚ظ„ آ«{field}آ»: {message}" if field else message
    return JSONResponse(status_code=422, content={"detail": detail, "errors": exc.errors()})


for module in (
    auth,
    bootstrap,
    residents,
    housing,
    housing_requests,
    contractor_requests,
    contractors,
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
def root():
    index = DIST_DIR / "index.html"
    if index.is_file():
        return FileResponse(index)
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "health": "/health",
        "docs": None if settings.is_production else "/docs",
    }


@app.get("/{path:path}", include_in_schema=False)
def static_site(path: str):
    """ظٹظ‚ط¯ظ‘ظ… ظˆط§ط¬ظ‡ط© Next.js ط§ظ„ظ…ط¨ظ†ظٹط© (ظ†ط´ط± ط®ط¯ظ…ط© ظˆط§ط­ط¯ط©)."""
    if path.startswith("api/"):
        return JSONResponse({"detail": "ط§ظ„ظ…ط³ط§ط± ط؛ظٹط± ظ…ظˆط¬ظˆط¯"}, status_code=404)
    if not DIST_DIR.is_dir():
        return JSONResponse({"detail": "ظˆط§ط¬ظ‡ط© ط§ظ„ظˆظٹط¨ ط؛ظٹط± ظ…ط¨ظ†ظٹط© ط¨ط¹ط¯"}, status_code=404)
    dist_root = DIST_DIR.resolve()
    target = (DIST_DIR / path).resolve()
    try:
        target.relative_to(dist_root)
    except ValueError:
        return JSONResponse({"detail": "forbidden"}, status_code=403)
    if path and target.is_file():
        return FileResponse(target)
    index = dist_root / "index.html"
    if index.is_file():
        return FileResponse(index)
    return JSONResponse({"detail": "not found"}, status_code=404)
