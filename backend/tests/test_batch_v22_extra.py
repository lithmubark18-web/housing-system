"""اختبارات إضافية: حدود العمر من الإعدادات، رقم النموذج، بوابة المتعهد، تقييد بيانات الزوار."""
from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient

from app.core.state import store
from app.services.common import clean_str, today


def _login(client: TestClient, username: str) -> dict[str, str]:
    res = client.post("/api/auth/login", json={"username": username, "password": "123456"})
    assert res.status_code == 200, res.text
    body = res.json()
    token = body.get("token") or body.get("access_token")
    assert token, body
    return {"Authorization": f"Bearer {token}"}


def _uuid_digits() -> str:
    import uuid
    return uuid.uuid4().hex[:8]


def _contractor_id_for(data: dict, username: str) -> str:
    user = next(u for u in data.get("users", []) if u.get("username") == username)
    contractor_id = clean_str(user.get("contractorId"))
    assert contractor_id, f"لا يوجد متعهد مرتبط بالحساب {username}"
    return contractor_id


def _create_new_worker_request(
    client: TestClient,
    headers: dict[str, str],
    *,
    name: str,
    card: str,
    birth_date: str,
) -> dict:
    res = client.post(
        "/api/contractor-requests",
        json={
            "requestType": "new_worker",
            "workerName": name,
            "workerCardNumber": card,
            "workerBirthDate": birth_date,
            "workerBirthPlace": "صنعاء",
            "reason": "طلب اختبار",
        },
        headers=headers,
    )
    assert res.status_code == 201, res.text
    return res.json()


# ------------------------------------------------- حدود العمر من الإعدادات

def test_max_worker_age_reads_from_settings(client: TestClient):
    before = store.read()
    data = dict(before)
    data["settings"] = {**(data.get("settings") or {}), "maxWorkerAge": 50}
    store.replace(data)
    try:
        headers = _login(client, "ctr01")
        res = client.post(
            "/api/contractor-requests",
            json={
                "requestType": "new_worker",
                "workerName": "عامل فوق الخمسين " + _uuid_digits(),
                "workerCardNumber": "7" + _uuid_digits(),
                "workerBirthDate": (today() - timedelta(days=55 * 365)).isoformat(),
                "workerBirthPlace": "تعز",
                "reason": "طلب اختبار الإعدادات",
            },
            headers=headers,
        )
        assert res.status_code == 409, res.text
        assert "أكبر من 50" in res.json()["detail"]
    finally:
        store.replace(before)


def test_visitor_stage_enforces_max_age_setting(client: TestClient, admin_headers: dict[str, str]):
    headers = _login(client, "ctr01")
    created = _create_new_worker_request(
        client,
        headers,
        name="عامل لفحص مرحلة الزوار " + _uuid_digits(),
        card="6" + _uuid_digits(),
        birth_date=(today() - timedelta(days=30 * 365)).isoformat(),
    )
    rid = created["id"]

    before = store.read()
    data = dict(before)
    data["settings"] = {**(data.get("settings") or {}), "maxWorkerAge": 25}
    store.replace(data)
    try:
        for stage in ("department", "security"):
            step = client.post(f"/api/contractor-requests/{rid}/approve-{stage}", json={}, headers=admin_headers)
            assert step.status_code == 200, step.text
        res = client.post(
            f"/api/contractor-requests/{rid}/approve-visitor",
            json={"employeeCode": "EMP-" + _uuid_digits()},
            headers=admin_headers,
        )
        assert res.status_code == 409, res.text
        assert "أكبر من 25" in res.json()["detail"]
    finally:
        store.replace(before)


# ------------------------------------------------------ رقم النموذج الرسمي

def test_form_no_generated_when_request_completed(client: TestClient, admin_headers: dict[str, str]):
    headers = _login(client, "ctr01")
    created = _create_new_worker_request(
        client,
        headers,
        name="عامل اكتمال النموذج " + _uuid_digits(),
        card="5" + _uuid_digits(),
        birth_date=(today() - timedelta(days=32 * 365)).isoformat(),
    )
    rid = created["id"]
    contractor_id = clean_str(created.get("contractorId"))

    for stage in ("department", "security"):
        step = client.post(f"/api/contractor-requests/{rid}/approve-{stage}", json={}, headers=admin_headers)
        assert step.status_code == 200, step.text
    visitor = client.post(
        f"/api/contractor-requests/{rid}/approve-visitor",
        json={"employeeCode": "EMP-" + _uuid_digits()},
        headers=admin_headers,
    )
    assert visitor.status_code == 200, visitor.text

    beds = client.get(f"/api/contractors/{contractor_id}/free-beds", headers=admin_headers).json().get("items") or []
    assert beds, "لا توجد أسرّة متاحة للمتعهد"
    done = client.post(
        f"/api/contractor-requests/{rid}/approve-housing",
        json={"bedId": beds[0]["id"]},
        headers=admin_headers,
    )
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["stage"] == "done"
    assert clean_str(body.get("formNo")).startswith("FR-")


def test_form_no_generated_on_rejection(client: TestClient, admin_headers: dict[str, str]):
    headers = _login(client, "ctr01")
    created = _create_new_worker_request(
        client,
        headers,
        name="عامل رفض النموذج " + _uuid_digits(),
        card="4" + _uuid_digits(),
        birth_date=(today() - timedelta(days=33 * 365)).isoformat(),
    )
    res = client.post(
        f"/api/contractor-requests/{created['id']}/reject",
        json={"notes": "مستندات غير مكتملة"},
        headers=admin_headers,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["stage"] == "rejected"
    assert clean_str(body.get("formNo")).startswith("FR-")


# ------------------------------------------------------ بوابة المتعهد

def test_contractor_portal_hides_pending_removal_and_enriches_register(client: TestClient):
    import copy

    before = store.read()
    data = copy.deepcopy(before)
    contractor_id = _contractor_id_for(data, "ctr99")
    workers = [r for r in data.get("residents", []) if clean_str(r.get("contractorId")) == contractor_id]
    assert workers, "لا يوجد عمال مسكّنون للمتعهد في البيانات الأولية"
    resident = next((w for w in workers if w.get("bedId")), workers[0])
    resident["cardNumber"] = "T" + _uuid_digits()
    resident["birthDate"] = "1990-01-01"
    target = next(
        (w for w in workers if w.get("id") != resident.get("id") and clean_str(w.get("name"))),
        resident,
    )

    registered_id = "test-cw-" + _uuid_digits()
    data["contractorRequests"] = [
        {
            "id": "CR-test-remove-" + _uuid_digits(),
            "contractorId": contractor_id,
            "contractorName": "متعهد النظافة",
            "requestType": "remove_worker",
            "stage": "department",
            "workerName": target.get("name"),
            "workerCardNumber": clean_str(target.get("cardNumber")),
            "targetResidentId": target.get("id"),
            "status": "pending",
            "createdAt": today().isoformat() + "T08:00:00",
            "history": [],
        },
        *data.get("contractorRequests", []),
    ]
    data["contractorWorkers"] = [
        {
            "id": registered_id,
            "contractorId": contractor_id,
            "fullName": clean_str(resident.get("name")),
            "cardNumber": clean_str(resident.get("cardNumber")),
            "birthDate": resident.get("birthDate"),
            "status": "assigned",
        },
        *data.get("contractorWorkers", []),
    ]
    store.replace(data)
    try:
        headers = _login(client, "ctr99")
        res = client.get(f"/api/contractors/{contractor_id}/portal", headers=headers)
        assert res.status_code == 200, res.text
        body = res.json()

        visible_ids = {str(w.get("id")) for w in body.get("workers", [])}
        assert str(target.get("id")) not in visible_ids, "العامل ذو الاستدعاء المعلّق يجب ألا يظهر في العمال المسكّنين"

        registered = next(w for w in body.get("registeredWorkers", []) if w.get("id") == registered_id)
        assert clean_str(registered.get("employeeCode")) == clean_str(resident.get("employeeCode"))
        assert registered.get("residentId") == resident.get("id")
        assert registered.get("age") is not None
        if resident.get("bedId"):
            assert clean_str(registered.get("location")) not in {"", "غير مسكن"}
            assert clean_str((registered.get("housing") or {}).get("buildingName"))
        else:
            assert clean_str(registered.get("location")) == "غير مسكن"
    finally:
        store.replace(before)


# --------------------------------------------- بيانات الزوار لمدير النظام فقط

def test_guests_data_and_export_admin_only(client: TestClient, admin_headers: dict[str, str]):
    # المدير يرى ويصدّر
    assert client.get("/api/guests", headers=admin_headers).status_code == 200
    assert client.get("/api/reports/export/guests.csv", headers=admin_headers).status_code == 200

    # مراقب السكن يملك guests.manage للتسجيل فقط — بلا عرض أو تصدير
    monitor = _login(client, "himo")
    me = client.get("/api/auth/me", headers=monitor).json()
    permissions = set((me.get("user") or {}).get("permissions") or [])
    assert "guests.manage" in permissions
    assert "guests.view" not in permissions
    assert client.get("/api/guests", headers=monitor).status_code == 403
    assert client.get("/api/reports/export/guests.csv", headers=monitor).status_code == 403
