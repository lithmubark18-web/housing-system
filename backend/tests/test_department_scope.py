"""عزل طلبات المتعهدين بحسب إدارة مدير الإدارة."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.security import hash_password
from app.core.state import CONTRACTOR_DEPARTMENTS, store

CONTRACTORS = [
    {"id": "c-affairs-1", "name": "متعهد مطعم", "department": "إدارة الشؤون"},
    {"id": "c-planning-1", "name": "متعهد دكة تحميل", "department": "إدارة التخطيط"},
    {"id": "c-packing-1", "name": "متعهد تعبئة", "department": "إدارة التعبئة"},
    {"id": "c-maint-1", "name": "متعهد صيانة", "department": "إدارة الصيانة"},
]

ACCOUNTS = {
    "إدارة الشؤون": "dept_affairs",
    "إدارة التخطيط": "dept_planning",
    "إدارة التعبئة": "dept_packing",
    "إدارة الصيانة": "dept_maintenance",
}


def _seed() -> dict:
    before = store.read()
    data = dict(before)
    data["contractors"] = list(CONTRACTORS)
    requests = []
    for index, contractor in enumerate(CONTRACTORS):
        for n in range(3):
            requests.append(
                {
                    "id": f"req-{contractor['id']}-{n}",
                    "contractorId": contractor["id"],
                    "contractorName": contractor["name"],
                    "requestType": "new_worker",
                    "stage": "department",
                    "workerName": f"عامل {contractor['id']} {n}",
                    "workerCardNumber": f"10{index}{n}000000",
                    "createdAt": f"2026-10-2{n}T10:00:00",
                }
            )
    data["contractorRequests"] = requests
    users = list(data.get("users", []))
    if not any(str(u.get("username")) == "security" for u in users):
        users.append(
            {
                "id": "demo-security-00000000000000001",
                "name": "مشرف الأمن",
                "username": "security",
                "passwordHash": hash_password("123456"),
                "role": "securitySupervisor",
                "roleId": "r_security",
                "isActive": True,
            }
        )
    data["users"] = users
    store.replace(data)
    return before


def _login(client: TestClient, username: str) -> dict[str, str]:
    res = client.post("/api/auth/login", json={"username": username, "password": "123456"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['token']}"}


def test_department_scope(client: TestClient) -> None:
    before = _seed()
    try:
        data = store.read()

        for dept, username in ACCOUNTS.items():
            assert dept in CONTRACTOR_DEPARTMENTS
            headers = _login(client, username)

            me = client.get("/api/auth/me", headers=headers).json()
            assert (me.get("user") or {}).get("department") == dept

            allowed = {c["id"] for c in CONTRACTORS if c["department"] == dept}

            payload = client.get("/api/contractor-requests?pageSize=500", headers=headers).json()
            rows = payload.get("data") or []
            assert len(rows) == 3, f"{username}: {len(rows)}"
            assert all(str(r.get("contractorId")) in allowed for r in rows), username
            assert (payload.get("counts") or {}).get("department") == 3

            pending = client.get("/api/contractor-requests/pending-counts", headers=headers).json()
            assert pending.get("department") == 3

            foreign = next(r for r in data["contractorRequests"] if str(r["contractorId"]) not in allowed)
            assert client.get(f"/api/contractor-requests/{foreign['id']}", headers=headers).status_code == 403
            assert client.post(
                f"/api/contractor-requests/{foreign['id']}/approve", headers=headers, json={}
            ).status_code == 403

            own = next(r for r in data["contractorRequests"] if str(r["contractorId"]) in allowed)
            assert client.post(
                f"/api/contractor-requests/{own['id']}/approve", headers=headers, json={}
            ).status_code == 200

            board = client.get("/api/operations/board", headers=headers)
            if board.status_code == 200:
                assert board.json()["totals"]["pendingContractorRequests"] <= 3

        security = _login(client, "security")
        all_rows = client.get("/api/contractor-requests?pageSize=500", headers=security).json().get("data") or []
        assert len(all_rows) == 12
    finally:
        store.replace(before)
