from __future__ import annotations

import hashlib
import json
import os
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/app", tags=["app-updates"])

# الواجهة المبنية (Next.js static export) ضمن المستودع — تُحدَّث تلقائياً مع كل نشر.
# app/api/app_updates.py -> app/api (0), app (1), backend (2), جذر المستودع (3).
DIST_DIR = Path(__file__).resolve().parents[3] / "frontend" / "dist"


def _dist_fingerprint() -> str:
    """بصمة ثابتة لمحتوى الواجهة (أسماء الملفات وأحجامها)."""
    if not DIST_DIR.is_dir():
        return ""
    digest = hashlib.sha1()
    for path in sorted(DIST_DIR.rglob("*")):
        if not path.is_file():
            continue
        digest.update(path.relative_to(DIST_DIR).as_posix().encode("utf-8"))
        digest.update(str(path.stat().st_size).encode("ascii"))
    return digest.hexdigest()[:8]


def _version_info() -> dict[str, Any]:
    path = DIST_DIR / "app-version.json"
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _bundle_version() -> str:
    fingerprint = _dist_fingerprint()
    if not fingerprint:
        return ""
    base = str(_version_info().get("version") or _version_info().get("appVersion") or "app").strip()
    return f"{base}.{fingerprint}"


def _build_zip(target: Path) -> None:
    tmp = target.with_suffix(target.suffix + ".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(DIST_DIR.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(DIST_DIR).as_posix())
    os.replace(tmp, target)


@router.get("/manifest")
def update_manifest():
    """بيان آخر حزمة واجهة للتطبيق — يقرأه التطبيق عند الإقلاع لتحديث نفسه تلقائياً.

    يُعاد مسار الحزمة نسبياً (/api/app/bundle) والتطبيق يضيفه إلى عنوان الخادم
    الذي يتعامل معه، تفادياً لاختلاف المخطط (http/https) خلف الوكيل العكسي.
    """
    version = _bundle_version()
    if not version:
        raise HTTPException(status_code=404, detail="لا توجد حزمة تحديث متاحة")
    return {
        "version": version,
        "url": "/api/app/bundle",
        "appVersion": str(_version_info().get("appVersion") or ""),
        "builtAt": str(_version_info().get("builtAt") or ""),
    }


@router.get("/bundle")
def update_bundle():
    """حزمة الواجهة مضغوطة — يحمّلها تطبيق الجوال ويطبّقها عند الإقلاع التالي."""
    version = _bundle_version()
    if not version:
        raise HTTPException(status_code=404, detail="لا توجد حزمة تحديث متاحة")
    fingerprint = _dist_fingerprint()
    target = Path(tempfile.gettempdir()) / f"housing-web-bundle-{fingerprint}.zip"
    if not (target.is_file() and target.stat().st_size > 0):
        _build_zip(target)
    return FileResponse(
        target,
        media_type="application/zip",
        filename=f"housing-web-bundle-{version}.zip",
    )
