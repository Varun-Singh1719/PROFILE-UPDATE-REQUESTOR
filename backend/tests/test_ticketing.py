"""Backend API tests for Ticketing System."""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://capsule-status-sync.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

CREDS = {
    "admin": ("admin@ticketing.com", "Admin@123"),
    "ra": ("ra@ticketing.com", "Test@123"),
    "dq1": ("dq1@ticketing.com", "Test@123"),
    "dq2": ("dq2@ticketing.com", "Test@123"),
}


def login(role):
    email, pw = CREDS[role]
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    r.raise_for_status()
    j = r.json()
    return j["access_token"], j["user"]


def H(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def admin():
    t, u = login("admin"); return {"t": t, "u": u}

@pytest.fixture(scope="session")
def ra():
    t, u = login("ra"); return {"t": t, "u": u}

@pytest.fixture(scope="session")
def dq1():
    t, u = login("dq1"); return {"t": t, "u": u}

@pytest.fixture(scope="session")
def dq2():
    t, u = login("dq2"); return {"t": t, "u": u}


# ---- Auth ----
class TestAuth:
    def test_login_admin(self):
        r = requests.post(f"{API}/auth/login", json={"email": "admin@ticketing.com", "password": "Admin@123"})
        assert r.status_code == 200
        j = r.json()
        assert j["user"]["type"] == "Admin"
        assert j["access_token"]
        assert "access_token" in r.cookies

    def test_login_ra(self, ra):
        assert ra["u"]["type"] == "Research Associate"

    def test_login_dq(self, dq1):
        assert dq1["u"]["type"] == "DQ Team"

    def test_invalid_credentials(self):
        r = requests.post(f"{API}/auth/login", json={"email": "admin@ticketing.com", "password": "wrong"})
        assert r.status_code == 401

    def test_me(self, admin):
        r = requests.get(f"{API}/auth/me", headers=H(admin["t"]))
        assert r.status_code == 200
        assert r.json()["email"] == "admin@ticketing.com"

    def test_logout(self, admin):
        r = requests.post(f"{API}/auth/logout", headers=H(admin["t"]))
        assert r.status_code == 200


# ---- Contacts ----
class TestContacts:
    def test_admin_lists_all(self, admin):
        r = requests.get(f"{API}/contacts", headers=H(admin["t"]))
        assert r.status_code == 200
        emails = [c["email"] for c in r.json()]
        assert "ra@ticketing.com" in emails

    def test_create_and_toggle_status(self, admin):
        import uuid
        email = f"test_{uuid.uuid4().hex[:8]}@x.com"
        r = requests.post(f"{API}/contacts", headers=H(admin["t"]),
                          json={"email": email, "name": "T", "type": "DQ Team", "password": "Test@123"})
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        # toggle
        r2 = requests.patch(f"{API}/contacts/{cid}", headers=H(admin["t"]), json={"status": "Inactive"})
        assert r2.status_code == 200
        assert r2.json()["status"] == "Inactive"
        # inactive cannot login
        r3 = requests.post(f"{API}/auth/login", json={"email": email, "password": "Test@123"})
        assert r3.status_code == 403

    def test_ra_cannot_create_contact(self, ra):
        r = requests.post(f"{API}/contacts", headers=H(ra["t"]),
                          json={"email": "x@y.com", "name": "n", "type": "DQ Team", "password": "x"})
        assert r.status_code == 403


# ---- Tickets ----
class TestTickets:
    @pytest.fixture(scope="class")
    def ticket(self, ra):
        r = requests.post(f"{API}/tickets", headers=H(ra["t"]),
                          json={"subject": "TEST sub", "priority": "High", "number_of_profiles": 5, "due_date": "2026-02-01"})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["status"] == "Open"
        assert j["ticket_id"].startswith("TKT-")
        assert j["assigned_to_id"] is None
        return j

    def test_create_ticket(self, ticket):
        assert ticket["created_by_name"]

    def test_dq_cannot_create(self, dq1):
        r = requests.post(f"{API}/tickets", headers=H(dq1["t"]),
                          json={"subject": "x", "priority": "Low"})
        assert r.status_code == 403

    def test_ra_cannot_set_status(self, ra, ticket):
        r = requests.patch(f"{API}/tickets/{ticket['id']}", headers=H(ra["t"]),
                           json={"status": "Closed"})
        assert r.status_code == 403

    def test_scope_mine_ra(self, ra, ticket):
        r = requests.get(f"{API}/tickets?scope=mine", headers=H(ra["t"]))
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()]
        assert ticket["id"] in ids

    def test_scope_unassigned(self, dq1, ticket):
        r = requests.get(f"{API}/tickets?scope=unassigned", headers=H(dq1["t"]))
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()]
        assert ticket["id"] in ids

    def test_dq_self_assign_then_status(self, dq1, ticket):
        r = requests.patch(f"{API}/tickets/{ticket['id']}", headers=H(dq1["t"]),
                           json={"assigned_to": dq1["u"]["id"]})
        assert r.status_code == 200
        assert r.json()["assigned_to_id"] == dq1["u"]["id"]
        # status update
        r2 = requests.patch(f"{API}/tickets/{ticket['id']}", headers=H(dq1["t"]),
                            json={"status": "In Progress"})
        assert r2.status_code == 200
        assert r2.json()["status"] == "In Progress"

    def test_dq_cannot_assign_other(self, dq2, ra):
        # create new unassigned
        rc = requests.post(f"{API}/tickets", headers=H(ra["t"]),
                           json={"subject": "T2", "priority": "Low"})
        tid = rc.json()["id"]
        r = requests.patch(f"{API}/tickets/{tid}", headers=H(dq2["t"]),
                           json={"assigned_to": "some-other-id"})
        assert r.status_code == 403

    def test_dq_cannot_status_others(self, dq2, ticket):
        # ticket is assigned to dq1
        r = requests.patch(f"{API}/tickets/{ticket['id']}", headers=H(dq2["t"]),
                           json={"status": "Closed"})
        assert r.status_code == 403

    def test_scope_assigned_dq(self, dq1, ticket):
        r = requests.get(f"{API}/tickets?scope=assigned", headers=H(dq1["t"]))
        assert r.status_code == 200
        assert ticket["id"] in [t["id"] for t in r.json()]

    def test_admin_reassign(self, admin, ticket, dq2):
        r = requests.patch(f"{API}/tickets/{ticket['id']}", headers=H(admin["t"]),
                           json={"assigned_to": dq2["u"]["id"], "status": "Closed"})
        assert r.status_code == 200
        j = r.json()
        assert j["assigned_to_id"] == dq2["u"]["id"]
        assert j["status"] == "Closed"

    def test_bulk_assign_dq_self(self, dq1, ra):
        ids = []
        for i in range(2):
            rc = requests.post(f"{API}/tickets", headers=H(ra["t"]),
                               json={"subject": f"BULK{i}", "priority": "Low"})
            ids.append(rc.json()["id"])
        r = requests.post(f"{API}/tickets/bulk-assign", headers=H(dq1["t"]),
                          json={"ticket_ids": ids})
        assert r.status_code == 200
        assert r.json()["assigned"] == 2

    def test_bulk_assign_admin(self, admin, ra, dq2):
        rc = requests.post(f"{API}/tickets", headers=H(ra["t"]),
                           json={"subject": "BULKA", "priority": "Medium"})
        r = requests.post(f"{API}/tickets/bulk-assign", headers=H(admin["t"]),
                          json={"ticket_ids": [rc.json()["id"]], "assigned_to": dq2["u"]["id"]})
        assert r.status_code == 200
        assert r.json()["assigned"] == 1


# ---- Dashboard ----
class TestDashboard:
    def test_stats_admin(self, admin):
        r = requests.get(f"{API}/dashboard/stats", headers=H(admin["t"]))
        assert r.status_code == 200
        d = r.json()
        for k in ["total", "open", "in_progress", "closed"]:
            assert k in d

    def test_dq_perf_admin_only(self, admin, ra):
        r1 = requests.get(f"{API}/dashboard/dq-performance", headers=H(admin["t"]))
        assert r1.status_code == 200
        assert isinstance(r1.json(), list)
        r2 = requests.get(f"{API}/dashboard/dq-performance", headers=H(ra["t"]))
        assert r2.status_code == 403

    def test_recent(self, admin):
        r = requests.get(f"{API}/dashboard/recent", headers=H(admin["t"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---- Comments & Activity ----
class TestCommentsActivity:
    def test_comment_and_activity(self, ra, admin):
        rc = requests.post(f"{API}/tickets", headers=H(ra["t"]),
                           json={"subject": "Comm", "priority": "Low"})
        tid = rc.json()["id"]
        rcm = requests.post(f"{API}/tickets/{tid}/comments", headers=H(admin["t"]),
                            json={"content": "Hello"})
        assert rcm.status_code == 200
        rgc = requests.get(f"{API}/tickets/{tid}/comments", headers=H(ra["t"]))
        assert rgc.status_code == 200
        assert any(c["content"] == "Hello" for c in rgc.json())
        rga = requests.get(f"{API}/tickets/{tid}/activity", headers=H(ra["t"]))
        assert rga.status_code == 200
        actions = [a["action"] for a in rga.json()]
        assert "created" in actions and "comment" in actions
