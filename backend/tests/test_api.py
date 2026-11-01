from __future__ import annotations

import uuid
from datetime import date, timedelta

from fastapi.testclient import TestClient


def test_health(client: TestClient):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["counts"]["residents"] > 1000


def test_login_and_me(client: TestClient, admin_headers: dict[str, str]):
    me = client.get("/api/auth/me", headers=admin_headers)
    assert me.status_code == 200
    user = me.json()["user"]
    assert user["username"] == "admin"
    assert "admin.users" in user["permissions"]
    assert "passwordHash" not in user and "password" not in user


def test_login_rejects_wrong_password(client: TestClient):
    response = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert response.status_code == 401


def test_refresh_token(client: TestClient):
    login = client.post("/api/auth/login", json={"username": "admin", "password": "123456"})
    refresh = login.json()["refresh_token"]
    response = client.post("/api/auth/refresh", json={"refresh_token": refresh})
    assert response.status_code == 200
    assert response.json()["access_token"]


def test_bootstrap_shape_and_no_secrets(client: TestClient, admin_headers: dict[str, str]):
    response = client.get("/api/bootstrap", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    for key in ("buildings", "rooms", "beds", "residents", "contractors", "contractorRequests", "roles"):
        assert isinstance(body[key], list), key
    assert body["settings"]["orgName"]
    assert body["tree"]
    for account in body["users"]:
        assert "passwordHash" not in account
        assert "password" not in account


def test_residents_list_and_export(client: TestClient, admin_headers: dict[str, str]):
    response = client.get("/api/residents", params={"page": 2, "pageSize": 10}, headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert len(body["items"]) == 10
    assert body["total"] > 1000

    housing = client.get(
        "/api/residents",
        params={"page": 1, "pageSize": 20, "housingOnly": True},
        headers=admin_headers,
    )
    assert housing.status_code == 200
    assert all(item["attendanceStatus"] in {"حاضر", "إجازة"} for item in housing.json()["items"])

    csv_response = client.get("/api/residents/export.csv", headers=admin_headers)
    assert csv_response.status_code == 200
    assert csv_response.content.startswith("\ufeff".encode("utf-8"))


def test_resident_lifecycle(client: TestClient, admin_headers: dict[str, str]):
    buildings = client.get("/api/housing/tree", headers=admin_headers).json()["buildings"]
    bed = next(
        b for building in buildings for room in building["rooms"] for b in room["beds"] if not b["occupied"]
    )
    payload = {
        "name": "ساكن اختبار",
        "employeeCode": f"T-{uuid.uuid4().hex[:6]}",
        "company": "شركة الاختبار",
        "jobTitle": "فني",
        "serviceType": "سكن",
    }
    created = client.post("/api/residents", json=payload, headers=admin_headers)
    assert created.status_code == 201, created.text
    resident_id = created.json()["id"]

    assigned = client.post(
        f"/api/residents/{resident_id}/assign-bed",
        json={"bedId": bed["id"]},
        headers=admin_headers,
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["bedId"] == bed["id"]
    assert assigned.json()["attendanceStatus"] == "حاضر"

    on_leave = client.patch(
        f"/api/residents/{resident_id}",
        json={
            "dutyCycleStart": (date.today() - timedelta(days=1)).isoformat(),
            "dutyWorkDays": 1,
            "dutyRestDays": 1,
        },
        headers=admin_headers,
    )
    assert on_leave.status_code == 200, on_leave.text
    assert on_leave.json()["attendanceStatus"] == "إجازة"

    manual = client.post(
        f"/api/residents/{resident_id}/attendance",
        json={"status": "خارج السكن"},
        headers=admin_headers,
    )
    assert manual.status_code in {404, 405}

    unassigned = client.post(f"/api/residents/{resident_id}/unassign-bed", headers=admin_headers)
    assert unassigned.status_code == 200
    assert unassigned.json()["bedId"] is None

    deleted = client.delete(f"/api/residents/{resident_id}", headers=admin_headers)
    assert deleted.status_code == 200


def test_bulk_import(client: TestClient, admin_headers: dict[str, str]):
    unique = uuid.uuid4().hex[:8]
    response = client.post(
        "/api/residents/import",
        json={
            "residents": [
                {"name": "مستورد واحد", "employeeCode": f"IMP-{unique}-1", "company": "شركة"},
                {"name": "مستورد اثنان", "employeeCode": f"IMP-{unique}-2", "company": "شركة"},
            ]
        },
        headers=admin_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == 2


def _pick_contractor(client: TestClient, headers: dict[str, str]) -> dict:
    rows = client.get("/api/contractors", params={"pageSize": 200}, headers=headers).json()["items"]
    candidates = [
        r for r in rows
        if r["stats"]["freeQuota"] > 0 and r["stats"]["freePhysicalBeds"] > 0
    ]
    assert candidates, "no contractor with a free bed"
    return max(candidates, key=lambda r: r["stats"]["freeQuota"])


def test_contractor_request_workflow(client: TestClient, admin_headers: dict[str, str]):
    contractor = _pick_contractor(client, admin_headers)
    unique = uuid.uuid4().hex[:8]
    payload = {
        "contractorId": contractor["id"],
        "requestType": "new_worker",
        "workerName": f"عامل اختبار {unique}",
        "workerCardNumber": f"CARD-{unique}",
        "workerBirthDate": "1990-05-10",
        "workerBirthPlace": "الرياض",
        "jobTitle": "عامل",
    }
    created = client.post("/api/contractor-requests", json=payload, headers=admin_headers)
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]
    assert created.json()["stage"] == "department"

    approved = client.post(
        f"/api/contractor-requests/{request_id}/approve-department",
        json={"notes": "ok"},
        headers=admin_headers,
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["stage"] == "security"

    approved = client.post(
        f"/api/contractor-requests/{request_id}/approve-security",
        json={"notes": "ok"},
        headers=admin_headers,
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["stage"] == "visitor"

    approved = client.post(
        f"/api/contractor-requests/{request_id}/approve",
        json={"employeeCode": f"EMP-{unique}", "notes": "ok"},
        params={"stage": "visitor"},
        headers=admin_headers,
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["stage"] == "housing"

    beds = client.get(
        f"/api/contractors/{contractor['id']}/free-beds", headers=admin_headers
    ).json()["items"]
    assert beds, "لا توجد أسرّة متاحة للمتعهد"
    approved = client.post(
        f"/api/contractor-requests/{request_id}/approve-housing",
        json={"notes": "done", "bedId": beds[0]["id"]},
        headers=admin_headers,
    )
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["stage"] == "done"
    assert body["bedId"] == beds[0]["id"]

    found = client.get(
        "/api/residents",
        params={"contractorId": contractor["id"], "pageSize": 500},
        headers=admin_headers,
    ).json()["items"]
    assert any(r["employeeCode"] == f"EMP-{unique}" for r in found)


def test_contractor_portal_is_scoped(client: TestClient):
    login = client.post("/api/auth/login", json={"username": "ctr01", "password": "123456"})
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    bootstrap = client.get("/api/bootstrap", headers=headers)
    assert bootstrap.status_code == 200
    body = bootstrap.json()
    assert "residents" not in body
    assert body["meta"]["role"] == "contractor"
    assert body["contractorPortal"] is not None

    denied = client.get("/api/residents", headers=headers)
    assert denied.status_code == 403


def test_admin_roles_and_settings(client: TestClient, admin_headers: dict[str, str]):
    roles = client.get("/api/admin/roles", headers=admin_headers)
    assert roles.status_code == 200
    assert len(roles.json()["items"]) >= 5

    permissions = client.get("/api/admin/permissions", headers=admin_headers)
    assert permissions.status_code == 200
    assert len(permissions.json()["items"]) >= 18

    updated = client.put(
        "/api/admin/settings",
        json={"lowVacancyThreshold": 7, "orgName": "إدارة السكن"},
        headers=admin_headers,
    )
    assert updated.status_code == 200
    assert updated.json()["lowVacancyThreshold"] == 7


def test_reports_and_search(client: TestClient, admin_headers: dict[str, str]):
    dashboard = client.get("/api/reports/dashboard", headers=admin_headers)
    assert dashboard.status_code == 200
    body = dashboard.json()
    assert body["totals"]["beds"] > 600
    assert body["totals"]["housingResidents"] > 0

    search = client.get("/api/search", params={"q": "admin"}, headers=admin_headers)
    assert search.status_code == 200
    assert search.json()["total"] >= 1

    export = client.get("/api/reports/export", params={"kind": "buildings"}, headers=admin_headers)
    assert export.status_code == 200
    assert export.headers["content-disposition"].startswith("attachment")


def test_backup_shape(client: TestClient, admin_headers: dict[str, str]):
    response = client.get("/api/admin/backup", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["data"]["users"]
    assert body["meta"]["counts"]["residents"] > 1000

    invalid = client.post(
        "/api/admin/restore",
        json={"confirm": "no", "data": body["data"]},
        headers=admin_headers,
    )
    assert invalid.status_code == 400


def test_audit_log(client: TestClient, admin_headers: dict[str, str]):
    response = client.get("/api/admin/audit", params={"pageSize": 5}, headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["total"] >= 1
    assert response.json()["items"][0]["at"]


def _submit_new_worker(
    client: TestClient,
    headers: dict[str, str],
    contractor_id: str,
    name: str,
    code: str,
    card: str,
) -> str:
    created = client.post(
        "/api/contractor-requests",
        json={
            "contractorId": contractor_id,
            "requestType": "new_worker",
            "workerName": name,
            "workerCardNumber": card,
            "workerBirthDate": "1990-05-10",
            "workerBirthPlace": "الرياض",
            "jobTitle": "عامل",
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]
    beds = client.get(f"/api/contractors/{contractor_id}/free-beds", headers=headers).json()["items"]
    assert beds, "لا توجد أسرّة متاحة للمتعهد"
    for stage in ("department", "security", "visitor", "housing"):
        payload: dict = {"notes": "ok"}
        if stage == "visitor":
            payload["employeeCode"] = code
        if stage == "housing":
            payload["bedId"] = beds[0]["id"]
        approved = client.post(
            f"/api/contractor-requests/{request_id}/approve-{stage}",
            json=payload,
            headers=headers,
        )
        assert approved.status_code == 200, approved.text
    assert approved.json()["stage"] == "done"
    return request_id


def _residents_by_code(client: TestClient, headers: dict[str, str], code: str) -> list[dict]:
    response = client.get("/api/residents", params={"q": code, "pageSize": 50}, headers=headers)
    assert response.status_code == 200, response.text
    return [r for r in response.json()["items"] if r.get("employeeCode") == code]


def test_remove_worker_deletes_only_targeted_resident(client: TestClient, admin_headers: dict[str, str]):
    """استبعاد عامل يجب ألا يحذف عاملاً آخر أُضيف لاحقاً بنفس كود الموظف (حادثة 70023)."""
    rows = client.get("/api/contractors", params={"pageSize": 200}, headers=admin_headers).json()["items"]
    candidates = [
        r for r in rows
        if r["stats"]["freeQuota"] >= 2 and r["stats"]["freePhysicalBeds"] >= 2
    ]
    assert candidates, "no contractor with two free beds"
    contractor = max(candidates, key=lambda r: r["stats"]["freeQuota"])
    unique = uuid.uuid4().hex[:8]
    code = f"RM-{unique}"

    _submit_new_worker(
        client, admin_headers, contractor["id"],
        f"عامل مستبعد {unique}", code, f"CARD-A-{unique}",
    )
    original = _residents_by_code(client, admin_headers, code)
    assert len(original) == 1
    original_id = original[0]["id"]

    remove = client.post(
        "/api/contractor-requests",
        json={
            "contractorId": contractor["id"],
            "requestType": "remove_worker",
            "workerName": original[0]["name"],
            "employeeCode": code,
        },
        headers=admin_headers,
    )
    assert remove.status_code == 201, remove.text
    remove_body = remove.json()
    assert remove_body["stage"] == "department"
    assert remove_body["targetResidentId"] == original_id

    # عامل جديد بنفس كود الموظف يُضاف بعد إنشاء طلب الاستبعاد وقبل تنفيذه.
    _submit_new_worker(
        client, admin_headers, contractor["id"],
        f"عامل بديل {unique}", code, f"CARD-B-{unique}",
    )
    assert len(_residents_by_code(client, admin_headers, code)) == 2

    for stage in ("department", "security", "visitor"):
        approved = client.post(
            f"/api/contractor-requests/{remove_body['id']}/approve-{stage}",
            json={"notes": "ok"},
            headers=admin_headers,
        )
        assert approved.status_code == 200, approved.text
    assert approved.json()["stage"] == "done"

    remaining = _residents_by_code(client, admin_headers, code)
    assert len(remaining) == 1, "يجب حذف السجل المستهدف فقط"
    assert remaining[0]["id"] != original_id
    assert remaining[0]["name"].startswith("عامل بديل")
