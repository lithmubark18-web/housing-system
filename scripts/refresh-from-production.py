# يجلب أحدث حالة من خادم الإنتاج ويجعلها بذرة المشروع.
#
# الاستخدام (من جذر housing-management-system):
#   python scripts/refresh-from-production.py
#   python scripts/refresh-from-production.py --reset-local
#
# --reset-local: يحذف backend/data.json حتى يُعاد إنشاؤه من البذرة الجديدة
#                (احتفظ بنسخة إن كان لديك بيانات محلية تريدها).
#
# المتغيرات الاختيارية:
#   HOUSING_PROD_API   (افتراضي: https://housing-mobile-project.onrender.com/api)
#   HOUSING_PROD_USER  (افتراضي: admin)
#   HOUSING_PROD_PASS  (افتراضي: 123456)

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = os.environ.get("HOUSING_PROD_API", "https://housing-system-api.onrender.com/api").rstrip("/")
USER = os.environ.get("HOUSING_PROD_USER", "admin")
PASSWORD = os.environ.get("HOUSING_PROD_PASS", "123456")

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
SEED = BACKEND / "seed.json"
DATA = BACKEND / "data.json"
SNAPSHOTS = ROOT / ".backups"


def call(method: str, path: str, body: dict | None = None, token: str | None = None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            return res.status, json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        return -1, str(exc)


def main() -> int:
    status, login = call("POST", "/auth/login", {"username": USER, "password": PASSWORD})
    if status != 200:
        print(f"فشل تسجيل الدخول ({status}): {login}")
        return 1

    status, state = call("GET", "/bootstrap", token=login["token"])
    if status != 200:
        print(f"فشل جلب الحالة ({status}): {state}")
        return 1

    state.pop("tokens", None)
    counts = {k: len(v) for k, v in state.items() if isinstance(v, list)}

    # bootstrap الإنتاجية لا تتضمن كلمات المرور لأسباب أمنية، لذا تُدمج كلمات
    # المرور من البذرة الحالية (نصية قديمة أو مجزأة scrypt) قبل الكتابة،
    # وإلا تعطّل تسجيل الدخول المحلي بعد كل سحب.
    try:
        previous = json.loads(SEED.read_text(encoding="utf-8")) if SEED.exists() else {}
        pwmap = {}
        for user in previous.get("users", []):
            username = str(user.get("username") or "").strip()
            if username:
                pwmap[username] = user.get("passwordHash") or user.get("password") or ""
        kept = 0
        for user in state.get("users", []):
            username = str(user.get("username") or "").strip()
            has_hash = bool(str(user.get("passwordHash") or "").strip())
            has_plain = bool(str(user.get("password") or "").strip())
            if username and not has_hash and not has_plain and pwmap.get(username):
                user["password"] = pwmap[username]
                kept += 1
        print(f"كلمات مرور محفوظة من البذرة السابقة: {kept}")
    except Exception as exc:  # noqa: BLE001
        print(f"تنبيه: تعذر دمج كلمات المرور ({exc})")

    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    snapshot = SNAPSHOTS / f"production-state-{stamp}.json"
    with snapshot.open("w", encoding="utf-8", newline="\n") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    if SEED.exists():
        backup = SNAPSHOTS / f"backend-seed-{stamp}.json"
        backup.write_bytes(SEED.read_bytes())
        print(f"نسخة احتياطية من البذرة: {backup}")

    with SEED.open("w", encoding="utf-8", newline="\n") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print(f"تم تحديث: {SEED}")
    print(f"لقطة محفوظة: {snapshot}")
    print("العدد:", {k: counts[k] for k in ("residents", "buildings", "beds", "contractors", "contractorRequests") if k in counts})

    if "--reset-local" in sys.argv:
        if DATA.exists():
            backup = SNAPSHOTS / f"backend-data-{stamp}.json"
            backup.write_bytes(DATA.read_bytes())
            DATA.unlink()
            print(f"حُذف data.json (نسخة: {backup}) — سيُعاد إنشاؤه من البذرة الجديدة.")
        else:
            print("data.json غير موجود أصلًا — لا شيء لإعادة ضبطه.")
    else:
        print("ملاحظة: backend/data.json لم يُمس. استخدم --reset-local لإعادة إنشائه من اللقطة.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
