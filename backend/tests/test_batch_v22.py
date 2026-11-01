"""اختبارات دفعة v2.2: العمر، سجل الاستبعاد، الزوار، فصل اعتماد السكن داخلي/خارجي، عزل الإدارات."""
from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient

from app.core.security import hash_password
from app.core.state import store
from app.services.common import today


def _login(client: TestClient, username: str) -> dict[str, str]:
    res = client.post("/api/auth/login", json={"username": username, "password": "123456"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['token']}"}


def _free_bed(client: TestClient, admin_headers: dict[str, str]) -> dict:
    tree = client.get("/api/housing/tree", headers=admin_headers).json()["buildings"]
    for building in tree:
        for room in building["rooms"]:
            for bed in room["beds"]:
                if not bed["occupied"]:
                    return bed
    raise AssertionError("لا يوجد سرير شاغر في البيانات الأولية")


# --------------------------------------------------------------------- العمر

def test_new_worker_age_max_60(client: TestClient, admin_headers: dict[str, str]):
    headers = _login(client, "ctr01")
    payload = {
        "requestType": "new_worker",
        "workerName": "عامل عجوز " + uuid_hex(),
        "workerCardNumber": "1" + uuid_digits(),
        "workerBirthDate": (today() - timedelta(days=63 * 365)).isoformat(),
        "workerBirthPlace": "صنعاء",
        "reason": "طلب إضافة",
    }
    res = client.post("/api/contractor-requests", json=payload, headers=headers)
    assert res.status_code == 409, res.text
    assert "أكبر من 60" in res.json()["detail"]


def test_new_worker_age_under_18(client: TestClient):
    headers = _login(client, "ctr01")
    payload = {
        "requestType": "new_worker",
        "workerName": "عامل صغير " + uuid_hex(),
        "workerCardNumber": "2" + uuid_digits(),
        "workerBirthDate": (today() - timedelta(days=17 * 365)).isoformat(),
        "workerBirthPlace": "عدن",
        "reason": "طلب إضافة",
    }
    res = client.post("/api/contractor-requests", json=payload, headers=headers)
    assert res.status_code == 409, res.text
    assert "أقل من 18" in res.json()["detail"]


# ------------------------------------------------------------ استبعاد سابق

def test_previous_exclusions_shown_to_approvers(client: TestClient):
    headers = _login(client, "ctr01")
    card = "9" + uuid_digits()
    # طلب استبعاد مكتمل لنفس البطاقة (مثل استبعاد قديم من متعهد آخر)
    done = {
        "id": "CR-old-done-" + uuid_digits(),
        "contractorName": "متعهد سابق",
        "contractorId": "old-contractor",
        "requestType": "remove_worker",
        "workerName": "عامل مستبعد سابقاً",
        "workerCardNumber": card,
        "stage": "done",
        "status": "done",
        "createdAt": "2025-01-15T08:00:00",
        "reviewedAt": "2025-01-20T08:00:00",
        "reviewNotes": "تكرار الغياب دون إذن",
        "history": [],
    }
    before = store.read()
    data = dict(before)
    data["contractorRequests"] = [done, *data.get("contractorRequests", [])]
    store.replace(data)
    try:
        payload = {
            "requestType": "new_worker",
            "workerName": "عامل مستبعد سابقاً",
            "workerCardNumber": card,
            "workerBirthDate": (today() - timedelta(days=9000)).isoformat(),
            "workerBirthPlace": "تعز",
            "reason": "طلب إضافة جديد",
        }
        res = client.post("/api/contractor-requests", json=payload, headers=headers)
        assert res.status_code == 201, res.text
        exclusions = res.json().get("previousExclusions")
        assert isinstance(exclusions, list) and len(exclusions) >= 1
        assert exclusions[0]["contractor"] == "متعهد سابق"
        assert "الغياب" in exclusions[0]["reason"]
    finally:
        store.replace(before)


# ---------------------------------------------------------------- الزوار

def test_guest_lifecycle_bed_conflict_and_permissions(client: TestClient, admin_headers: dict[str, str]):
    bed = _free_bed(client, admin_headers)
    guest_payload = {
        "name": "زائر تجريبي",
        "cardNumber": uuid_digits(),
        "birthDate": "1990-05-10",
        "birthPlace": "إب",
        "fromPlace": "حضرموت",
        "department": "الشؤون الإدارية",
        "approvalBy": "مدير الشؤون الإدارية",
        "visitPurpose": "زيارة عائلية",
        "startDate": today().isoformat(),
        "days": 3,
        "bedId": bed["id"],
    }
    created = client.post("/api/guests", json=guest_payload, headers=admin_headers)
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["formNo"].startswith("GH-")
    assert body["housing"]["bedLabel"]

    # نفس السرير مشغول بزائر → 409
    conflict = client.post("/api/guests", json={**guest_payload, "cardNumber": "8" + uuid_digits()}, headers=admin_headers)
    assert conflict.status_code == 409, conflict.text

    # التمديد
    extended = client.post(
        f"/api/guests/{body['id']}/extend",
        json={"days": 2, "reason": "ظروف سفر", "approvalBy": "مشرف السكن"},
        headers=admin_headers,
    )
    assert extended.status_code == 200, extended.text
    assert extended.json()["statusLabel"] == "مُمدَّد"

    # القائمة للمدير فقط (زوار)
    listed = client.get("/api/guests", headers=admin_headers)
    assert listed.status_code == 200
    assert any(g["id"] == body["id"] for g in listed.json()["items"])

    # من دون صلاحية الزوار → 403
    ctr = _login(client, "ctr01")
    denied = client.get("/api/guests", headers=ctr)
    assert denied.status_code == 403

    # CSV الزوار
    csv_res = client.get("/api/reports/export/guests.csv", headers=admin_headers)
    assert csv_res.status_code == 200
    assert csv_res.content.startswith("\ufeff".encode())

    # الإنهاء يفرغ السرير
    ended = client.post(f"/api/guests/{body['id']}/end", json={"reason": "نهاية الزيارة"}, headers=admin_headers)
    assert ended.status_code == 200
    freed = client.post("/api/guests", json={**guest_payload, "name": "زائر ثانٍ"}, headers=admin_headers)
    assert freed.status_code == 200, freed.text
    client.post(f"/api/guests/{freed.json()['id']}/end", json={}, headers=admin_headers)


# ------------------------------------------------ فصل اعتماد السكن داخلي/خارجي

def _seed_housing_scope() -> tuple[dict, str]:
    """مراقبان مرتبطان بنوع السكن: داخلي/خارجي + طلب في مرحلة السكن بسرير متاح للمتعهد."""
    from app.services.housing import free_beds_for_contractor

    before = store.read()
    data = dict(before)
    roles = list(data.get("roles", []))
    roles.append({"id": "r_housing_int", "label": "مراقب سكن داخلي", "isSystem": False, "permissionIds": ["operations.view", "requests.supervise", "requests.housing_internal"]})
    roles.append({"id": "r_housing_ext", "label": "مراقب سكن خارجي", "isSystem": False, "permissionIds": ["operations.view", "requests.supervise", "requests.housing_external"]})
    data["roles"] = roles
    users = list(data.get("users", []))
    users.append({
        "id": "test-housing-int-officer",
        "name": "مراقب داخلي",
        "username": "int_officer",
        "passwordHash": hash_password("123456"),
        "roleId": "r_housing_int",
        "isActive": True,
    })
    users.append({
        "id": "test-housing-ext-officer",
        "name": "مراقب خارجي",
        "username": "ext_officer",
        "passwordHash": hash_password("123456"),
        "roleId": "r_housing_ext",
        "isActive": True,
    })
    data["users"] = users

    contractor = next(c for c in data.get("contractors", []) if free_beds_for_contractor(data, c.get("id")))
    bed = free_beds_for_contractor(data, contractor.get("id"))[0]
    room = next(r for r in data.get("rooms", []) if str(r.get("id")) == str(bed.get("roomId")))
    building = next(b for b in data.get("buildings", []) if str(b.get("id")) == str(room.get("buildingId")))
    building["housingType"] = "internal"
    req_int = {
        "id": "CR-scope-internal",
        "contractorId": contractor.get("id"),
        "contractorName": clean_str(contractor.get("name")),
        "requestType": "new_worker",
        "stage": "housing",
        "workerName": "عامل داخلي",
        "workerCardNumber": "555000111",
        "workerBirthDate": "1990-01-01",
        "employeeCode": "E-5001",
        "status": "pending",
        "reviewedAt": None,
        "reviewNotes": "",
        "history": [],
    }
    data["contractorRequests"] = [req_int, *data.get("contractorRequests", [])]
    store.replace(data)
    return before, str(bed["id"])


def clean_str(value: object) -> str:
    return str(value or "").strip()


def test_housing_scope_split_internal_external(client: TestClient):
    before, internal_bed_id = _seed_housing_scope()
    try:
        int_headers = _login(client, "int_officer")
        ext_headers = _login(client, "ext_officer")

        req_int = "CR-scope-internal"
        # مراقب خارجي على طلب داخلي → 403 (محصور بنوعه)
        wrong = client.post(f"/api/contractor-requests/{req_int}/approve?stage=housing",
                            json={"bedId": internal_bed_id, "employeeCode": "E-1"}, headers=ext_headers)
        assert wrong.status_code == 403, wrong.text
        # مراقب داخلي على طلب داخلي → ينجح
        right = client.post(f"/api/contractor-requests/{req_int}/approve?stage=housing",
                            json={"bedId": internal_bed_id, "employeeCode": "E-1"}, headers=int_headers)
        assert right.status_code == 200, right.text
        assert right.json().get("stage") == "done"
    finally:
        store.replace(before)


def clean(data: dict, key: str, index: int) -> str:
    rows = data.get(key, [])
    return str(rows[index].get("name")) if len(rows) > index else ""


def uuid_hex() -> str:
    import uuid
    return uuid.uuid4().hex[:6]


def uuid_digits() -> str:
    import uuid
    return uuid.uuid4().hex[:8]



# ------------------------------------------------------- عزل إدارة المتعدين

def test_dept_manager_contractors_view_scoped(client: TestClient):
    headers = _login(client, "dept_affairs")
    me = client.get("/api/auth/me", headers=headers).json()
    my_dept = (me.get("user") or {}).get("department")
    listing = client.get("/api/contractors", headers=headers)
    assert listing.status_code == 200, listing.text
    rows = listing.json()["items"]
    assert rows
    departments = {r.get("department") for r in rows}
    assert departments == {my_dept}

    # لا إضافة لصاحب الإدارة
    denied = client.post("/api/contractors", json={"name": "متعهد جديد"}, headers=headers)
    assert denied.status_code == 403

    other = client.get("/api/contractors", headers=_login(client, "admin"))
    other_rows = other.json()["items"]
    assert len(other_rows) > len(rows)


def test_dashboard_scoped_for_dept_manager(client: TestClient):
    headers = _login(client, "dept_affairs")
    dash = client.get("/api/reports/dashboard", headers=headers)
    assert dash.status_code == 200, dash.text
    body = dash.json()
    contractors = body.get("contractors") if isinstance(body.get("contractors"), list) else (body.get("rows") or [])
    if contractors:
        assert all(c.get("department") in (None, "", "الشؤون الإدارية") for c in contractors)
