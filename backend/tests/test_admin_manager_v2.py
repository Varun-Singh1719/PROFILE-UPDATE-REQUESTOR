"""Backend API tests for new Admin/Manager features in this iteration:
- Forgot/Reset password + Notifications outbox
- Email Templates module (CRUD + Inactive suppression)
- Contacts pagination + CSV + bulk-status/bulk-role + emp_id/doj required + reset-password email
- Tickets pagination + CSV
- Teams /colors + auto-assign
- Permissions v2 scope-aware actions (Respective/All) + precedence merge
- Role refactor verification
"""
import os
import time
import uuid
import pytest
import requests

def _read_frontend_url():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        return None
    return None

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_url() or "").rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL not configured"
API = f"{BASE}/api"

CREDS = {
    "admin": ("admin@ticketing.com", "Admin@123"),
    "manager": ("manager@ticketing.com", "Test@123"),
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


def H(t):
    return {"Authorization": f"Bearer {t}"}


# ---------- session-scoped tokens ----------
@pytest.fixture(scope="session")
def admin():
    t, u = login("admin"); return {"t": t, "u": u}

@pytest.fixture(scope="session")
def manager():
    t, u = login("manager"); return {"t": t, "u": u}

@pytest.fixture(scope="session")
def ra():
    t, u = login("ra"); return {"t": t, "u": u}

@pytest.fixture(scope="session")
def dq2():
    t, u = login("dq2"); return {"t": t, "u": u}


# ---------- Role refactor ----------
class TestRoleRefactor:
    def test_ra_role_is_research(self, ra):
        # Note: previous code may store as 'type' but new login uses role
        u = ra["u"]
        # accept either role or type fields (server returns role)
        val = u.get("role") or u.get("type")
        assert val == "Research", f"expected Research, got {val}"

    def test_dq_still_works(self):
        t, u = login("dq1")
        val = u.get("role") or u.get("type")
        assert val == "DQ Team"


# ---------- Forgot/Reset password + Outbox ----------
class TestForgotReset:
    def test_forgot_unknown_email_200(self):
        r = requests.post(f"{API}/auth/forgot-password", json={"email": "nobody@nowhere.zzz"})
        assert r.status_code == 200

    def test_forgot_writes_outbox_and_reset_succeeds(self, admin):
        # Pick dq2 (we'll restore at the end of class)
        email = "dq2@ticketing.com"
        # Count outbox before
        before = requests.get(f"{API}/notifications/outbox?kind=forgot_password", headers=H(admin["t"]))
        assert before.status_code == 200
        before_count = len(before.json())

        # Trigger forgot password
        r = requests.post(f"{API}/auth/forgot-password", json={"email": email})
        assert r.status_code == 200
        time.sleep(0.5)

        # Outbox must have new entry with reset_link
        after = requests.get(f"{API}/notifications/outbox?kind=forgot_password", headers=H(admin["t"]))
        assert after.status_code == 200
        items = after.json()
        assert len(items) > before_count, "no new forgot_password outbox entry"
        latest = items[0]
        assert latest["kind"] == "forgot_password"
        meta = latest.get("metadata") or {}
        reset_link = meta.get("reset_link") or ""
        # token may be in metadata.reset_link or body
        token = ""
        if "token=" in reset_link:
            token = reset_link.split("token=", 1)[1].split("&", 1)[0]
        if not token:
            body = latest.get("body", "")
            if "token=" in body:
                token = body.split("token=", 1)[1].split('"', 1)[0].split("&", 1)[0]
        TestForgotReset._token = token
        TestForgotReset._email = email
        assert token, f"no token in outbox entry: meta={meta}"

    def test_reset_password_works_and_relogin(self):
        token = getattr(TestForgotReset, "_token", None)
        assert token
        new_pw = "Test@123"  # restore back to original
        r = requests.post(f"{API}/auth/reset-password", json={"token": token, "new_password": new_pw})
        assert r.status_code == 200, r.text
        # login with new pw
        r2 = requests.post(f"{API}/auth/login", json={"email": "dq2@ticketing.com", "password": new_pw})
        assert r2.status_code == 200

    def test_reset_password_reused_token_rejected(self):
        token = getattr(TestForgotReset, "_token", None)
        assert token
        r = requests.post(f"{API}/auth/reset-password", json={"token": token, "new_password": "Whatever1!"})
        assert r.status_code == 400


# ---------- Outbox RBAC ----------
class TestOutboxRBAC:
    def test_admin_can_list(self, admin):
        r = requests.get(f"{API}/notifications/outbox", headers=H(admin["t"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_manager_403(self, manager):
        r = requests.get(f"{API}/notifications/outbox", headers=H(manager["t"]))
        assert r.status_code == 403

    def test_admin_delete_entry(self, admin):
        # create a forgot-password trigger to get an entry, then delete it
        requests.post(f"{API}/auth/forgot-password", json={"email": "admin@ticketing.com"})
        time.sleep(0.3)
        r = requests.get(f"{API}/notifications/outbox?kind=forgot_password&limit=5", headers=H(admin["t"]))
        if r.json():
            nid = r.json()[0]["id"]
            d = requests.delete(f"{API}/notifications/outbox/{nid}", headers=H(admin["t"]))
            assert d.status_code == 200


# ---------- Contacts: emp_id/doj, new-employee outbox, paginate, csv, bulk ----------
class TestContacts:
    @pytest.fixture(scope="class")
    def created_contact(self, admin):
        email = f"TEST_emp_{uuid.uuid4().hex[:6]}@x.com"
        emp_id = f"TEST{uuid.uuid4().hex[:6].upper()}"
        body = {"email": email, "name": "Test EMP", "role": "Member",
                "emp_id": emp_id, "doj": "2026-01-15"}
        r = requests.post(f"{API}/contacts", headers=H(admin["t"]), json=body)
        assert r.status_code == 200, r.text
        return r.json()

    def test_emp_id_required(self, admin):
        r = requests.post(f"{API}/contacts", headers=H(admin["t"]),
                          json={"email": f"x{uuid.uuid4().hex[:5]}@x.com", "name": "n",
                                "role": "Member", "doj": "2026-01-01"})
        assert r.status_code in (400, 422)

    def test_doj_required(self, admin):
        r = requests.post(f"{API}/contacts", headers=H(admin["t"]),
                          json={"email": f"x{uuid.uuid4().hex[:5]}@x.com", "name": "n",
                                "role": "Member", "emp_id": f"E{uuid.uuid4().hex[:5]}"})
        assert r.status_code in (400, 422)

    def test_create_triggers_outbox_with_password(self, admin, created_contact):
        time.sleep(0.5)
        r = requests.get(f"{API}/notifications/outbox?kind=new_employee&limit=20", headers=H(admin["t"]))
        assert r.status_code == 200
        items = r.json()
        match = next((n for n in items if n.get("to_email") == created_contact["email"]), None)
        assert match, f"no new_employee outbox entry for {created_contact['email']}"
        # generated_password should appear in body via template substitution
        body = match.get("body", "")
        gp = created_contact.get("generated_password", "")
        assert gp and gp in body, "generated_password not found in outbox body"

    def test_admin_reset_password_outbox(self, admin, created_contact):
        r = requests.post(f"{API}/contacts/{created_contact['id']}/reset-password", headers=H(admin["t"]))
        assert r.status_code == 200
        time.sleep(0.4)
        out = requests.get(f"{API}/notifications/outbox?kind=admin_password_reset&limit=20", headers=H(admin["t"]))
        assert out.status_code == 200
        match = next((n for n in out.json() if n.get("to_email") == created_contact["email"]), None)
        assert match, "no admin_password_reset entry for target email"

    def test_contacts_pagination_shape(self, admin):
        r = requests.get(f"{API}/contacts?page=1&page_size=25&sort_by=name&sort_dir=asc", headers=H(admin["t"]))
        assert r.status_code == 200
        j = r.json()
        for k in ("items", "total", "page", "page_size"):
            assert k in j
        assert j["page"] == 1 and j["page_size"] == 25
        # sort asc by name: names should be sorted (case-sensitive at db, just check monotonic non-strict)
        names = [c["name"] for c in j["items"]]
        assert names == sorted(names, key=lambda x: (x or "").lower()) or names == sorted(names)

    def test_contacts_no_page_param_returns_array(self, admin):
        r = requests.get(f"{API}/contacts", headers=H(admin["t"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_contacts_export_csv_admin(self, admin):
        r = requests.get(f"{API}/contacts/export.csv", headers=H(admin["t"]))
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        assert "Name" in r.text.splitlines()[0]
        assert len(r.text.splitlines()) >= 2

    def test_contacts_export_csv_manager_403(self, manager):
        r = requests.get(f"{API}/contacts/export.csv", headers=H(manager["t"]))
        assert r.status_code == 403

    def test_bulk_status_deactivate_then_restore(self, admin):
        # Use dq2 (we'll restore)
        # find dq2 contact id
        r = requests.get(f"{API}/contacts", headers=H(admin["t"]))
        dq2c = next(c for c in r.json() if c["email"] == "dq2@ticketing.com")
        cid = dq2c["id"]
        rsp = requests.post(f"{API}/contacts/bulk-status", headers=H(admin["t"]),
                            json={"contact_ids": [cid], "status": "Inactive"})
        assert rsp.status_code == 200
        assert rsp.json()["updated"] == 1
        # verify
        v = requests.get(f"{API}/contacts/{cid}", headers=H(admin["t"]))
        assert v.json()["status"] == "Inactive"
        # restore
        restore = requests.post(f"{API}/contacts/bulk-status", headers=H(admin["t"]),
                                json={"contact_ids": [cid], "status": "Active"})
        assert restore.status_code == 200

    def test_bulk_status_self_rejects(self, admin):
        r = requests.post(f"{API}/contacts/bulk-status", headers=H(admin["t"]),
                          json={"contact_ids": [admin["u"]["id"]], "status": "Inactive"})
        assert r.status_code == 400

    def test_bulk_role(self, admin, created_contact):
        r = requests.post(f"{API}/contacts/bulk-role", headers=H(admin["t"]),
                          json={"contact_ids": [created_contact["id"]], "role": "Delivery"})
        assert r.status_code == 200
        v = requests.get(f"{API}/contacts/{created_contact['id']}", headers=H(admin["t"]))
        assert v.json()["role"] == "Delivery"


# ---------- Tickets pagination + CSV ----------
class TestTicketsListing:
    def test_paginated_shape(self, admin):
        r = requests.get(f"{API}/tickets?page=1&page_size=25", headers=H(admin["t"]))
        assert r.status_code == 200
        j = r.json()
        for k in ("items", "total", "page", "page_size"):
            assert k in j

    def test_plain_array_no_page(self, admin):
        r = requests.get(f"{API}/tickets", headers=H(admin["t"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_export_csv(self, admin):
        r = requests.get(f"{API}/tickets/export.csv", headers=H(admin["t"]))
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        lines = r.text.splitlines()
        assert "Ticket ID" in lines[0]
        assert len(lines) >= 2


# ---------- Teams colors / auto-assign ----------
class TestTeamColors:
    def test_palette_30_with_suggested(self, admin):
        r = requests.get(f"{API}/teams/colors", headers=H(admin["t"]))
        assert r.status_code == 200
        j = r.json()
        assert len(j["palette"]) == 30
        assert "used" in j and "suggested" in j
        assert j["suggested"] in j["palette"]
        assert j["suggested"] not in j["used"]

    def test_create_team_auto_assigns_unique_color(self, admin):
        # get suggested color before
        pre = requests.get(f"{API}/teams/colors", headers=H(admin["t"])).json()
        suggested = pre["suggested"]
        used_before = set(pre["used"])
        # create team without color
        name = f"TEST_team_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/teams", headers=H(admin["t"]), json={"name": name})
        assert r.status_code == 200, r.text
        team = r.json()
        assert team["color"] not in used_before
        # cleanup
        requests.delete(f"{API}/teams/{team['id']}", headers=H(admin["t"]))


# ---------- Email Templates ----------
class TestEmailTemplates:
    def test_admin_lists_seeded(self, admin):
        r = requests.get(f"{API}/email-templates", headers=H(admin["t"]))
        assert r.status_code == 200
        kinds = {t["kind"] for t in r.json()}
        for k in ("new_employee", "admin_password_reset", "forgot_password"):
            assert k in kinds, f"missing seeded template {k}"

    def test_manager_lists(self, manager):
        r = requests.get(f"{API}/email-templates", headers=H(manager["t"]))
        assert r.status_code == 200

    def test_manager_can_only_toggle_status(self, manager, admin):
        # find forgot_password template
        r = requests.get(f"{API}/email-templates", headers=H(admin["t"]))
        tpl = next(t for t in r.json() if t["kind"] == "forgot_password")
        # Manager edit subject => 403
        e = requests.patch(f"{API}/email-templates/{tpl['id']}", headers=H(manager["t"]),
                           json={"subject": "Hacked"})
        assert e.status_code == 403
        # Manager toggle status => OK
        # NOTE: do not leave inactive — restore right after
        original_status = tpl.get("status", "Active")
        s = requests.patch(f"{API}/email-templates/{tpl['id']}", headers=H(manager["t"]),
                           json={"status": "Active"})
        assert s.status_code == 200
        # restore explicitly
        requests.patch(f"{API}/email-templates/{tpl['id']}", headers=H(admin["t"]),
                       json={"status": original_status})

    def test_admin_full_edit_and_create_and_dup_and_delete(self, admin):
        # Create custom template
        body = {"name": f"TEST_custom_{uuid.uuid4().hex[:5]}",
                "kind": f"custom_{uuid.uuid4().hex[:5]}",
                "category": "transactional",
                "subject": "Hello {{name}}", "body": "<p>Hi {{name}}</p>",
                "status": "Active"}
        c = requests.post(f"{API}/email-templates", headers=H(admin["t"]), json=body)
        assert c.status_code == 200, c.text
        tid = c.json()["id"]
        # patch subject
        p = requests.patch(f"{API}/email-templates/{tid}", headers=H(admin["t"]),
                           json={"subject": "Updated"})
        assert p.status_code == 200
        assert p.json()["subject"] == "Updated"
        # duplicate
        d = requests.post(f"{API}/email-templates/{tid}/duplicate", headers=H(admin["t"]))
        assert d.status_code == 200
        dup_id = d.json()["id"]
        assert "(copy)" in d.json()["name"]
        # delete custom OK
        rm1 = requests.delete(f"{API}/email-templates/{tid}", headers=H(admin["t"]))
        assert rm1.status_code == 200
        rm2 = requests.delete(f"{API}/email-templates/{dup_id}", headers=H(admin["t"]))
        assert rm2.status_code == 200

    def test_manager_create_403(self, manager):
        r = requests.post(f"{API}/email-templates", headers=H(manager["t"]),
                          json={"name": "x", "kind": "x", "subject": "x", "body": "x"})
        assert r.status_code == 403

    def test_delete_system_template_forbidden(self, admin):
        r = requests.get(f"{API}/email-templates", headers=H(admin["t"]))
        sys_tpl = next((t for t in r.json() if t.get("system")), None)
        if sys_tpl:
            d = requests.delete(f"{API}/email-templates/{sys_tpl['id']}", headers=H(admin["t"]))
            assert d.status_code == 400

    def test_inactive_forgot_password_suppresses_outbox(self, admin):
        # find forgot_password tpl
        r = requests.get(f"{API}/email-templates", headers=H(admin["t"]))
        tpl = next(t for t in r.json() if t["kind"] == "forgot_password")
        original_status = tpl.get("status", "Active")
        try:
            # set Inactive
            patch = requests.patch(f"{API}/email-templates/{tpl['id']}", headers=H(admin["t"]),
                                   json={"status": "Inactive"})
            assert patch.status_code == 200
            before = requests.get(f"{API}/notifications/outbox?kind=forgot_password",
                                  headers=H(admin["t"])).json()
            before_n = len(before)
            # trigger
            requests.post(f"{API}/auth/forgot-password", json={"email": "admin@ticketing.com"})
            time.sleep(0.5)
            after = requests.get(f"{API}/notifications/outbox?kind=forgot_password",
                                 headers=H(admin["t"])).json()
            after_n = len(after)
            # either no new entry, OR new entry marked skipped/suppressed
            if after_n > before_n:
                latest = after[0]
                st = (latest.get("status") or "").lower()
                assert st in ("skipped", "suppressed", "no_template", "inactive"), \
                    f"Inactive template still wrote normal outbox entry: status={st}"
        finally:
            # restore
            requests.patch(f"{API}/email-templates/{tpl['id']}", headers=H(admin["t"]),
                           json={"status": original_status or "Active"})


# ---------- Permissions v2 scope-aware ----------
class TestPermissionsV2:
    def test_schema_has_scoped_actions(self, admin):
        r = requests.get(f"{API}/permissions/schema", headers=H(admin["t"]))
        assert r.status_code == 200
        j = r.json()
        sa = j.get("scoped_actions", [])
        for k in ("view", "edit", "assign"):
            assert k in sa, f"missing {k} in scoped_actions"

    def test_bulk_save_with_mixed_values(self, admin):
        # Save a rule for Research role on tickets.list with mixed values
        existing = requests.get(f"{API}/permissions/v2", headers=H(admin["t"])).json()
        # Find a valid module/feature
        sch = requests.get(f"{API}/permissions/schema", headers=H(admin["t"])).json()
        mod = sch["modules"][0]
        # modules contain groups -> features
        groups = mod.get("groups") or []
        if groups:
            feat = groups[0]["features"][0]
        else:
            feat = mod["features"][0]
        actions = {a: False for a in feat["actions"]}
        if "view" in actions: actions["view"] = "respective"
        if "assign" in actions: actions["assign"] = "all"
        if "create" in actions: actions["create"] = True
        rule = {"module": mod["key"], "feature": feat["key"],
                "subject_type": "role", "subject_id": "Research",
                "actions": actions, "note": "TEST"}
        # save: bulk replaces all rules — combine with existing
        combined = existing + [rule]
        # strip ids/meta from existing
        slim = [{"module": e["module"], "feature": e["feature"],
                 "subject_type": e["subject_type"], "subject_id": e["subject_id"],
                 "actions": e["actions"], "note": e.get("note", "")} for e in existing]
        slim.append(rule)
        r = requests.put(f"{API}/permissions/v2/bulk", headers=H(admin["t"]),
                         json={"rules": slim})
        assert r.status_code == 200, r.text
        # re-read
        rd = requests.get(f"{API}/permissions/v2", headers=H(admin["t"]))
        found = next((x for x in rd.json() if x["subject_id"] == "Research"
                      and x["module"] == mod["key"] and x["feature"] == feat["key"]
                      and x.get("note") == "TEST"), None)
        assert found, "saved rule not found"
        if "view" in feat["actions"]:
            assert found["actions"]["view"] == "respective"
        if "assign" in feat["actions"]:
            assert found["actions"]["assign"] == "all"
        if "create" in feat["actions"]:
            assert found["actions"]["create"] is True

    def test_effective_precedence(self, admin, ra):
        r = requests.get(f"{API}/permissions/effective/{ra['u']['id']}", headers=H(admin["t"]))
        assert r.status_code == 200
        j = r.json()
        assert "effective" in j
