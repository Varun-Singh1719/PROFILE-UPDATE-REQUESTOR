"""Smoke regression tests for the v3 router-split refactor.

Each test exercises one router module's endpoints to confirm the move from
server.py -> routers/* didn't break routing, dependencies, or models.
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("API_BASE_URL")
if not BASE_URL:
    # Read from the frontend .env so we hit the same external URL the UI hits.
    here = os.path.dirname(os.path.abspath(__file__))
    fe_env = os.path.join(here, "..", "..", "frontend", ".env")
    with open(fe_env, encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip()
                break

API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@ticketing.com"
ADMIN_PASS = "Admin@123"
USER_EMAIL = "manager@ticketing.com"
USER_PASS = "Test@123"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def super_token():
    return _login(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module")
def admin_token():
    return _login(USER_EMAIL, USER_PASS)


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


class TestAuthRouter:
    def test_login_returns_token(self, super_token):
        assert super_token

    def test_me(self, super_token):
        r = requests.get(f"{API}/auth/me", headers=_h(super_token))
        assert r.status_code == 200
        assert r.json()["role"] == "Super Admin"

    def test_invalid_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"})
        assert r.status_code == 401


class TestContactsRouter:
    def test_list_contacts(self, super_token):
        r = requests.get(f"{API}/contacts", headers=_h(super_token))
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 1

    def test_filter_by_permission_set_numeric_id(self, super_token):
        # Should not 500 even if no employees assigned to set 99
        r = requests.get(f"{API}/contacts?permission_set_id=99", headers=_h(super_token))
        assert r.status_code == 200
        assert r.json() == [] or isinstance(r.json(), list)

    def test_admin_cannot_create_contact(self, admin_token):
        r = requests.post(f"{API}/contacts", headers=_h(admin_token), json={
            "email": "x@x.com", "name": "x", "role": "Admin", "emp_id": "E", "doj": "2024-01-01"
        })
        assert r.status_code == 403


class TestTeamsRouter:
    def test_list_teams(self, super_token):
        r = requests.get(f"{API}/teams", headers=_h(super_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_team_colors(self, super_token):
        r = requests.get(f"{API}/teams/colors", headers=_h(super_token))
        assert r.status_code == 200
        body = r.json()
        assert "palette" in body and "used" in body and "suggested" in body


class TestPermissionsRouter:
    def test_schema(self, super_token):
        r = requests.get(f"{API}/permissions/schema", headers=_h(super_token))
        assert r.status_code == 200
        assert len(r.json()["modules"]) == 2  # profix + desk_booking

    def test_presets(self, super_token):
        r = requests.get(f"{API}/permissions/presets", headers=_h(super_token))
        assert r.status_code == 200
        assert len(r.json()) >= 7

    def test_effective_super_admin_full_access(self, super_token):
        r = requests.get(f"{API}/permissions/me/effective", headers=_h(super_token))
        assert r.status_code == 200
        body = r.json()
        assert body["sources"]["super_admin"] is True
        assert body["counts"]["is_super_admin"] is True

    def test_effective_admin(self, admin_token):
        r = requests.get(f"{API}/permissions/me/effective", headers=_h(admin_token))
        assert r.status_code == 200
        body = r.json()
        assert body["sources"]["super_admin"] is False

    def test_stats(self, super_token):
        r = requests.get(f"{API}/permissions/stats", headers=_h(super_token))
        assert r.status_code == 200
        body = r.json()
        for k in ("total_roles", "total_rules", "employees_with_overrides", "restricted_actions", "compound_rules"):
            assert k in body


class TestPermissionSetsRouter:
    @pytest.fixture
    def temp_set_id(self, super_token):
        name = f"refactor-smoke-{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/permission-sets", headers=_h(super_token), json={
            "name": name, "modules": {"profix": {"ticket": {"view": True}}}
        })
        assert r.status_code == 200
        sid = r.json()["id"]
        yield sid
        requests.delete(f"{API}/permission-sets/{sid}", headers=_h(super_token))

    def test_list_with_filters(self, super_token):
        r = requests.get(f"{API}/permission-sets?module=profix", headers=_h(super_token))
        assert r.status_code == 200

    def test_stats(self, super_token):
        r = requests.get(f"{API}/permission-sets/stats", headers=_h(super_token))
        assert r.status_code == 200
        body = r.json()
        assert "total_sets" in body and "profix_sets" in body and "desk_booking_sets" in body

    def test_duplicate(self, super_token, temp_set_id):
        r = requests.post(f"{API}/permission-sets/{temp_set_id}/duplicate", headers=_h(super_token))
        assert r.status_code == 200
        copy = r.json()
        try:
            assert copy["name"].endswith("(Copy)")
            assert copy["modules"] == {"profix": {"ticket": {"view": True, "create": False, "edit": False, "assign": False, "approve": False, "delete": False}}}
        finally:
            requests.delete(f"{API}/permission-sets/{copy['id']}", headers=_h(super_token))

    def test_admin_cannot_create(self, admin_token):
        r = requests.post(f"{API}/permission-sets", headers=_h(admin_token), json={"name": "no"})
        assert r.status_code == 403


class TestTicketsRouter:
    def test_list_tickets(self, super_token):
        r = requests.get(f"{API}/tickets", headers=_h(super_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_pagination(self, super_token):
        r = requests.get(f"{API}/tickets?page=1&page_size=5", headers=_h(super_token))
        assert r.status_code == 200
        body = r.json()
        assert "items" in body and "total" in body and "page" in body


class TestDashboardRouter:
    def test_stats(self, super_token):
        r = requests.get(f"{API}/dashboard/stats", headers=_h(super_token))
        assert r.status_code == 200
        body = r.json()
        for k in ("total", "open", "in_progress", "closed"):
            assert k in body

    def test_recent(self, super_token):
        r = requests.get(f"{API}/dashboard/recent", headers=_h(super_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)


class TestAuditRouter:
    def test_super_admin_can_read(self, super_token):
        r = requests.get(f"{API}/audit-log?limit=5", headers=_h(super_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_cannot_read(self, admin_token):
        r = requests.get(f"{API}/audit-log", headers=_h(admin_token))
        assert r.status_code == 403


class TestNotificationsAndEmailTemplatesRouter:
    def test_outbox_super_admin(self, super_token):
        r = requests.get(f"{API}/notifications/outbox?limit=3", headers=_h(super_token))
        assert r.status_code == 200

    def test_outbox_admin_forbidden(self, admin_token):
        r = requests.get(f"{API}/notifications/outbox", headers=_h(admin_token))
        assert r.status_code == 403

    def test_templates_list_admin_allowed(self, admin_token):
        r = requests.get(f"{API}/email-templates", headers=_h(admin_token))
        assert r.status_code == 200
        assert len(r.json()) >= 3  # 3 system templates
