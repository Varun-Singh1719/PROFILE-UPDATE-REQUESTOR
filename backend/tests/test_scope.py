"""Scope-aware permission set tests.

Covers the v3 scope feature: Respective / Team / All for ProfiX
view/edit/assign/approve actions, scope-aware effective merge, and the
enforcement layered on the tickets API.
"""
import os
import uuid

import pytest
import requests

# Discover backend URL from frontend/.env
here = os.path.dirname(os.path.abspath(__file__))
BASE_URL = None
with open(os.path.join(here, "..", "..", "frontend", ".env"), encoding="utf-8") as fh:
    for line in fh:
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip()
            break
API = f"{BASE_URL}/api"


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _h(t): return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def super_token():
    return _login("admin@ticketing.com", "Admin@123")


@pytest.fixture(scope="module")
def mgr_token():
    return _login("manager@ticketing.com", "Test@123")


@pytest.fixture(scope="module")
def manager_id(super_token):
    contacts = requests.get(f"{API}/contacts", headers=_h(super_token)).json()
    return [c for c in contacts if c["email"] == "manager@ticketing.com"][0]["id"]


@pytest.fixture(scope="module")
def ra_id(super_token):
    contacts = requests.get(f"{API}/contacts", headers=_h(super_token)).json()
    return [c for c in contacts if c["email"] == "ra@ticketing.com"][0]["id"]


@pytest.fixture
def clean_mgr_sets(super_token, manager_id):
    """Always start with the manager having NO sets assigned, restore after."""
    before = requests.get(f"{API}/contacts/{manager_id}", headers=_h(super_token)).json()
    before_ids = list(before.get("permission_set_ids") or [])
    requests.patch(f"{API}/contacts/{manager_id}", headers=_h(super_token),
                   json={"permission_set_ids": []})
    yield
    requests.patch(f"{API}/contacts/{manager_id}", headers=_h(super_token),
                   json={"permission_set_ids": before_ids})


@pytest.fixture
def pset_factory(super_token):
    created = []

    def _make(modules, name=None):
        name = name or f"scope-test-{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/permission-sets", headers=_h(super_token),
                          json={"name": name, "modules": modules})
        assert r.status_code == 200, r.text
        created.append(r.json()["id"])
        return r.json()

    yield _make
    for sid in created:
        requests.delete(f"{API}/permission-sets/{sid}", headers=_h(super_token))


def _assign(super_token, contact_id, *set_ids):
    r = requests.patch(f"{API}/contacts/{contact_id}", headers=_h(super_token),
                       json={"permission_set_ids": list(set_ids)})
    assert r.status_code == 200, r.text


class TestSchema:
    def test_schema_advertises_scoped_actions(self, super_token):
        r = requests.get(f"{API}/permissions/schema", headers=_h(super_token))
        assert r.status_code == 200
        body = r.json()
        assert body["scope_values"] == ["respective", "team", "all"]
        assert "profix" in body["scoped_modules"]
        # Find profix.ticket → all 4 scoped actions must be listed
        profix = [m for m in body["modules"] if m["key"] == "profix"][0]
        ticket = None
        for g in profix["groups"]:
            for f in g["features"]:
                if f["key"] == "ticket":
                    ticket = f
        assert ticket and set(ticket["scoped_actions"]) >= {"view", "edit", "assign", "approve"}


class TestStorage:
    def test_scope_strings_persisted(self, pset_factory):
        s = pset_factory({"profix": {"ticket": {
            "view": "team", "edit": "respective", "assign": "all",
            "approve": "respective", "create": True, "delete": False,
        }}})
        assert s["modules"]["profix"]["ticket"]["view"] == "team"
        assert s["modules"]["profix"]["ticket"]["edit"] == "respective"
        assert s["modules"]["profix"]["ticket"]["assign"] == "all"
        assert s["modules"]["profix"]["ticket"]["approve"] == "respective"
        assert s["modules"]["profix"]["ticket"]["create"] is True
        assert s["modules"]["profix"]["ticket"]["delete"] is False

    def test_legacy_true_migrates_to_all(self, pset_factory):
        # Sending bare `true` on a scoped action should be stored as "all".
        s = pset_factory({"profix": {"ticket": {"view": True}}})
        assert s["modules"]["profix"]["ticket"]["view"] == "all"

    def test_desk_booking_stays_boolean(self, pset_factory):
        # Even if the client sends a scope string, desk_booking is not in SCOPED_MODULES.
        s = pset_factory({"desk_booking": {"seat_request": {"view": "team", "create": True}}})
        # "team" coerced to bool True (because is_scoped(desk_booking, view) is False).
        assert s["modules"]["desk_booking"]["seat_request"]["view"] is True
        assert s["modules"]["desk_booking"]["seat_request"]["create"] is True


class TestScopeOrMerge:
    def test_or_merge_picks_broader_scope(self, super_token, mgr_token, manager_id, pset_factory, clean_mgr_sets):
        narrow = pset_factory({"profix": {"ticket": {"view": "respective"}}})
        wide = pset_factory({"profix": {"ticket": {"view": "team"}}})
        _assign(super_token, manager_id, narrow["id"], wide["id"])

        eff = requests.get(f"{API}/permissions/me/effective", headers=_h(mgr_token)).json()
        assert eff["effective"]["profix"]["ticket"]["view"] == "team"  # broader wins

    def test_all_beats_team(self, super_token, mgr_token, manager_id, pset_factory, clean_mgr_sets):
        a = pset_factory({"profix": {"ticket": {"view": "team"}}})
        b = pset_factory({"profix": {"ticket": {"view": "all"}}})
        _assign(super_token, manager_id, a["id"], b["id"])
        eff = requests.get(f"{API}/permissions/me/effective", headers=_h(mgr_token)).json()
        assert eff["effective"]["profix"]["ticket"]["view"] == "all"

    def test_super_admin_full_scope(self, super_token):
        eff = requests.get(f"{API}/permissions/me/effective", headers=_h(super_token)).json()
        assert eff["sources"]["super_admin"] is True
        assert eff["effective"]["profix"]["ticket"]["view"] == "all"


class TestTicketViewScope:
    def _create_ticket_assigned_to(self, super_token, target_id):
        r = requests.post(f"{API}/tickets", headers=_h(super_token), json={
            "subject": f"scope-{uuid.uuid4().hex[:6]}", "priority": "Low", "number_of_profiles": 1
        })
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        if target_id:
            requests.patch(f"{API}/tickets/{tid}", headers=_h(super_token),
                           json={"assigned_to": target_id})
        return tid

    def test_respective_blocks_others(self, super_token, mgr_token, manager_id, ra_id, pset_factory, clean_mgr_sets):
        s = pset_factory({"profix": {"ticket": {"view": "respective"}}})
        _assign(super_token, manager_id, s["id"])
        ticket = self._create_ticket_assigned_to(super_token, ra_id)
        try:
            # Direct GET → 404 (no scope match)
            r = requests.get(f"{API}/tickets/{ticket}", headers=_h(mgr_token))
            assert r.status_code == 404
            # List → ticket not present
            listing = requests.get(f"{API}/tickets", headers=_h(mgr_token)).json()
            assert all(t["id"] != ticket for t in listing)
        finally:
            requests.delete(f"{API}/tickets/{ticket}", headers=_h(super_token))  # might 404 if no delete route

    def test_all_scope_sees_everything(self, super_token, mgr_token, manager_id, ra_id, pset_factory, clean_mgr_sets):
        s = pset_factory({"profix": {"ticket": {"view": "all"}}})
        _assign(super_token, manager_id, s["id"])
        ticket = self._create_ticket_assigned_to(super_token, ra_id)
        listing = requests.get(f"{API}/tickets", headers=_h(mgr_token)).json()
        ids = [t["id"] for t in listing]
        assert ticket in ids

    def test_no_view_grant_returns_nothing(self, super_token, mgr_token, manager_id, pset_factory, clean_mgr_sets):
        # Empty set means the user has zero effective access.
        s = pset_factory({"profix": {"ticket": {"view": False, "create": False, "edit": False, "assign": False, "approve": False, "delete": False}}})
        _assign(super_token, manager_id, s["id"])
        listing = requests.get(f"{API}/tickets", headers=_h(mgr_token)).json()
        assert listing == []


class TestTicketEditScope:
    def test_admin_with_respective_cannot_edit_others_ticket(self, super_token, mgr_token, manager_id, ra_id, pset_factory, clean_mgr_sets):
        # View=all so the manager can see it, but edit=respective so they can't update.
        s = pset_factory({"profix": {"ticket": {"view": "all", "edit": "respective"}}})
        _assign(super_token, manager_id, s["id"])
        # Ticket created by admin, assigned to RA — out of manager's "respective" scope.
        t = requests.post(f"{API}/tickets", headers=_h(super_token),
                          json={"subject": "edit-blocked", "priority": "Low", "number_of_profiles": 1}).json()
        requests.patch(f"{API}/tickets/{t['id']}", headers=_h(super_token), json={"assigned_to": ra_id})
        r = requests.patch(f"{API}/tickets/{t['id']}", headers=_h(mgr_token),
                           json={"status": "Closed"})
        assert r.status_code == 403

    def test_admin_with_all_can_edit(self, super_token, mgr_token, manager_id, ra_id, pset_factory, clean_mgr_sets):
        s = pset_factory({"profix": {"ticket": {"view": "all", "edit": "all"}}})
        _assign(super_token, manager_id, s["id"])
        t = requests.post(f"{API}/tickets", headers=_h(super_token),
                          json={"subject": "edit-ok", "priority": "Low", "number_of_profiles": 1}).json()
        requests.patch(f"{API}/tickets/{t['id']}", headers=_h(super_token), json={"assigned_to": ra_id})
        r = requests.patch(f"{API}/tickets/{t['id']}", headers=_h(mgr_token), json={"status": "Closed"})
        assert r.status_code == 200
