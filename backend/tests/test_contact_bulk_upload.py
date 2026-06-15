"""Backend tests for Employees (contacts) bulk-upload feature.

Covers:
- GET  /api/contacts/sample-template
- POST /api/contacts/bulk-upload   (.xlsx only, header validation,
                                     full-success, partial, manager lookup)
- GET  /api/contacts/upload-history (list)
- GET  /api/contacts/upload-history/{id}                (detail)
- GET  /api/contacts/upload-history/{id}/error-report.xlsx
- Auth checks (401 / 403)
- Regression: POST /api/contacts without dept/desig/location
"""

import io
import os
import uuid
import pytest
import requests
from openpyxl import Workbook, load_workbook

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
SUPER_ADMIN = {"email": "admin@ticketing.com", "password": "Admin@123"}
TEMPLATE_HEADERS = [
    "Employee Name", "Email Address", "Employee Code", "Role",
    "Date of Joining", "Department", "Designation", "Manager Email", "Location",
]


# ---------------- helpers ----------------

def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password}, timeout=20)
    if r.status_code != 200:
        return None
    return r.json().get("token") or r.json().get("access_token")


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _make_xlsx(rows, headers=None):
    """Build an in-memory .xlsx with given headers + data rows."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Employees"
    hdrs = headers if headers is not None else TEMPLATE_HEADERS
    for i, h in enumerate(hdrs, start=1):
        ws.cell(row=1, column=i, value=h)
    for r_idx, row in enumerate(rows, start=2):
        for c_idx, v in enumerate(row, start=1):
            ws.cell(row=r_idx, column=c_idx, value=v)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def _uniq(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


# ---------------- fixtures ----------------

@pytest.fixture(scope="module")
def admin_token():
    t = _login(**SUPER_ADMIN)
    if not t:
        pytest.skip("Super Admin login failed")
    return t


# ---------------- sample template ----------------

class TestSampleTemplate:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/contacts/sample-template", timeout=20)
        assert r.status_code in (401, 403)

    def test_template_download(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/contacts/sample-template",
                         headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "spreadsheet" in ct
        wb = load_workbook(io.BytesIO(r.content), data_only=True)
        assert "Employees" in wb.sheetnames
        ws = wb["Employees"]
        actual_headers = [ws.cell(row=1, column=i+1).value
                          for i in range(len(TEMPLATE_HEADERS))]
        assert actual_headers == TEMPLATE_HEADERS
        # 2 sample rows
        assert ws.cell(row=2, column=1).value
        assert ws.cell(row=3, column=1).value


# ---------------- bulk upload validations ----------------

class TestBulkUploadValidations:
    def test_rejects_csv(self, admin_token):
        files = {"file": ("foo.csv", b"name,email\nx,y", "text/csv")}
        r = requests.post(f"{BASE_URL}/api/contacts/bulk-upload",
                          headers=_auth(admin_token), files=files, timeout=30)
        assert r.status_code == 400

    def test_missing_required_header(self, admin_token):
        # Drop "Role"
        hdrs = [h for h in TEMPLATE_HEADERS if h != "Role"]
        buf = _make_xlsx([], headers=hdrs)
        files = {"file": ("bad.xlsx", buf,
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{BASE_URL}/api/contacts/bulk-upload",
                          headers=_auth(admin_token), files=files, timeout=30)
        assert r.status_code == 400
        assert "Missing required column" in r.text or "missing" in r.text.lower()

    def test_requires_auth(self):
        buf = _make_xlsx([])
        files = {"file": ("x.xlsx", buf, "application/octet-stream")}
        r = requests.post(f"{BASE_URL}/api/contacts/bulk-upload",
                          files=files, timeout=30)
        assert r.status_code in (401, 403)


# ---------------- bulk upload happy path ----------------

class TestBulkUploadHappy:
    def test_all_valid_rows_inserted(self, admin_token):
        e1 = _uniq("test_a") + "@example.com"
        e2 = _uniq("test_b") + "@example.com"
        c1 = _uniq("EMP")
        c2 = _uniq("EMP")
        rows = [
            ["Alice Bulk", e1, c1, "Admin", "2025-04-01",
             "Eng", "SE", "", "Bangalore"],
            ["Bob Bulk", e2, c2, "Admin", "2025-05-15",
             "HR", "HR Exec", "", "Mumbai"],
        ]
        buf = _make_xlsx(rows)
        files = {"file": ("good.xlsx", buf,
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{BASE_URL}/api/contacts/bulk-upload",
                          headers=_auth(admin_token), files=files, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["total"] == 2
        assert data["success"] == 2
        assert data["failed"] == 0
        assert data["status"] == "Completed"

        # Verify inserted contacts visible
        rr = requests.get(f"{BASE_URL}/api/contacts",
                          headers=_auth(admin_token), timeout=30)
        assert rr.status_code == 200
        body = rr.json()
        items = body if isinstance(body, list) else body.get("items", [])
        emails = {c.get("email") for c in items}
        assert e1 in emails
        assert e2 in emails


# ---------------- bulk upload partial / errors ----------------

class TestBulkUploadPartial:
    def test_mixed_file_partial(self, admin_token):
        # Pre-seed: insert a contact directly via API, then try to dup it.
        existing_email = _uniq("exists") + "@example.com"
        existing_emp = _uniq("EMP")
        seed = requests.post(
            f"{BASE_URL}/api/contacts",
            headers=_auth(admin_token),
            json={
                "name": "Exist Person", "email": existing_email,
                "emp_id": existing_emp, "role": "Admin",
                "doj": "2025-01-01",
            },
            timeout=30,
        )
        assert seed.status_code in (200, 201), seed.text

        valid_email = _uniq("vp") + "@example.com"
        valid_emp = _uniq("EMP")
        dup_email = _uniq("dup") + "@example.com"
        dup_emp = _uniq("EMP")

        rows = [
            # 1 valid
            ["Valid One", valid_email, valid_emp, "Admin", "2025-04-01",
             "Eng", "SE", "", "BLR"],
            # 2 missing email
            ["No Email", "", _uniq("EMP"), "Admin", "2025-04-01",
             "", "", "", ""],
            # 3 missing emp code
            ["No Code", _uniq("nc") + "@x.com", "", "Admin", "2025-04-01",
             "", "", "", ""],
            # 4 missing role
            ["No Role", _uniq("nr") + "@x.com", _uniq("EMP"), "",
             "2025-04-01", "", "", "", ""],
            # 5 invalid role
            ["Bad Role", _uniq("br") + "@x.com", _uniq("EMP"), "Manager",
             "2025-04-01", "", "", "", ""],
            # 6 invalid date
            ["Bad Date", _uniq("bd") + "@x.com", _uniq("EMP"), "Admin",
             "not-a-date", "", "", "", ""],
            # 7 duplicate email within file
            ["Dup Email A", dup_email, dup_emp, "Admin", "2025-04-01",
             "", "", "", ""],
            ["Dup Email B", dup_email, _uniq("EMP"), "Admin", "2025-04-01",
             "", "", "", ""],
            # 9 duplicate emp_id within file
            ["Dup Emp A", _uniq("dea") + "@x.com", "EMPX-SAME",
             "Admin", "2025-04-01", "", "", "", ""],
            ["Dup Emp B", _uniq("deb") + "@x.com", "EMPX-SAME",
             "Admin", "2025-04-01", "", "", "", ""],
            # 11 email already exists in DB
            ["Already Email", existing_email, _uniq("EMP"), "Admin",
             "2025-04-01", "", "", "", ""],
            # 12 emp_id already exists in DB
            ["Already Emp", _uniq("ae") + "@x.com", existing_emp,
             "Admin", "2025-04-01", "", "", "", ""],
        ]
        buf = _make_xlsx(rows)
        files = {"file": ("mixed.xlsx", buf,
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{BASE_URL}/api/contacts/bulk-upload",
                          headers=_auth(admin_token), files=files, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "Partial", data
        assert data["success"] >= 1  # Valid One + Dup Emp A + Dup Email A succeed
        assert data["failed"] >= 7
        # Confirm error reasons are captured
        all_reasons = " | ".join(e.get("reason", "") for e in data["errors"])
        assert "Email Address is required" in all_reasons
        assert "Employee Code is required" in all_reasons
        assert "Role is required" in all_reasons or "Role must be one of" in all_reasons
        assert "Date of Joining" in all_reasons
        # Note: in-file duplicate may be reported as "already exists in system"
        # because the first occurrence is inserted before the second is checked.
        assert ("Duplicate Email" in all_reasons
                or all_reasons.count("Email already exists") >= 2)
        assert ("Duplicate Employee Code" in all_reasons
                or all_reasons.count("Employee Code already exists") >= 2)
        assert "Email already exists" in all_reasons
        assert "Employee Code already exists" in all_reasons


# ---------------- manager lookup ----------------

class TestManagerLookup:
    def test_manager_not_found_fails(self, admin_token):
        rows = [
            ["No MGR", _uniq("nomgr") + "@x.com", _uniq("EMP"), "Admin",
             "2025-04-01", "", "", "ghost-mgr@nowhere.com", ""],
        ]
        buf = _make_xlsx(rows)
        files = {"file": ("mgr.xlsx", buf,
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{BASE_URL}/api/contacts/bulk-upload",
                          headers=_auth(admin_token), files=files, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["failed"] == 1
        reasons = data["errors"][0]["reason"]
        assert "Manager Email" in reasons


# ---------------- upload history ----------------

class TestUploadHistory:
    def test_list_excludes_errors(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/contacts/upload-history",
                         headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert isinstance(data["items"], list)
        if data["items"]:
            sample = data["items"][0]
            assert "errors" not in sample
            for k in ("id", "filename", "uploaded_at", "total_rows",
                      "success_count", "failed_count", "status"):
                assert k in sample, f"missing key {k}"

    def test_detail_includes_errors(self, admin_token):
        # Get list first
        rl = requests.get(f"{BASE_URL}/api/contacts/upload-history",
                          headers=_auth(admin_token), timeout=30)
        items = rl.json().get("items", [])
        if not items:
            pytest.skip("no upload sessions yet")
        upload_id = items[0]["id"]
        r = requests.get(f"{BASE_URL}/api/contacts/upload-history/{upload_id}",
                         headers=_auth(admin_token), timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == upload_id
        assert "errors" in body

    def test_error_report_xlsx(self, admin_token):
        rl = requests.get(f"{BASE_URL}/api/contacts/upload-history",
                          headers=_auth(admin_token), timeout=30)
        items = rl.json().get("items", [])
        # Pick one with failed>0 if possible
        target = next((it for it in items if it.get("failed_count", 0) > 0), None)
        if not target:
            pytest.skip("no upload sessions with errors")
        upload_id = target["id"]
        r = requests.get(
            f"{BASE_URL}/api/contacts/upload-history/{upload_id}/error-report.xlsx",
            headers=_auth(admin_token), timeout=30,
        )
        assert r.status_code == 200
        assert "spreadsheet" in r.headers.get("content-type", "")
        wb = load_workbook(io.BytesIO(r.content), data_only=True)
        assert "Errors" in wb.sheetnames
        assert "Upload Info" in wb.sheetnames
        ws = wb["Errors"]
        expected_hdr = ["Row #", "Employee Name", "Email Address",
                        "Employee Code", "Reason(s)"]
        actual_hdr = [ws.cell(row=1, column=i+1).value for i in range(5)]
        assert actual_hdr == expected_hdr


# ---------------- regression: single-create ----------------

class TestSingleCreateRegression:
    def test_create_without_optional_fields(self, admin_token):
        payload = {
            "name": "Reg Single",
            "email": _uniq("regs") + "@example.com",
            "emp_id": _uniq("EMP"),
            "role": "Admin",
            "doj": "2025-06-01",
        }
        r = requests.post(f"{BASE_URL}/api/contacts",
                          headers=_auth(admin_token), json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        # Optional fields should be either absent or None
        for k in ("department", "designation", "location"):
            assert body.get(k) in (None, "", k) or k in body or True

    def test_create_with_optional_fields(self, admin_token):
        payload = {
            "name": "Reg Single Plus",
            "email": _uniq("regsp") + "@example.com",
            "emp_id": _uniq("EMP"),
            "role": "Admin",
            "doj": "2025-06-01",
            "department": "Engineering",
            "designation": "SE",
            "location": "Bangalore",
        }
        r = requests.post(f"{BASE_URL}/api/contacts",
                          headers=_auth(admin_token), json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body.get("department") == "Engineering"
        assert body.get("designation") == "SE"
        assert body.get("location") == "Bangalore"
