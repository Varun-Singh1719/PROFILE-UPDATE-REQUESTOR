"""Backend tests for Floor Plans thumbnail endpoint + regression on
draft / publish / clone / set-default / versions / rollback / audit /
delete.

Run:
    pytest /app/backend/tests/test_floor_plans_thumbnail.py -v \
        --junitxml=/app/test_reports/pytest/floor_plans.xml
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back to frontend/.env (tests are run from container shell)
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
    except FileNotFoundError:
        pass
assert BASE_URL, "REACT_APP_BACKEND_URL not set"

API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@ticketing.com"
ADMIN_PASS = "Admin@123"
NON_ADMIN_EMAIL = "dq1@ticketing.com"
NON_ADMIN_PASS = "Test@123"

PDF_URL = "https://customer-assets.emergentagent.com/job_workspace-manager-19/artifacts/m9mpuhb8_Without%20seat%20floor%20map.pdf"

# Tiny 1x1 transparent PNG data URL.
SMALL_PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
)


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def non_admin_token():
    try:
        return _login(NON_ADMIN_EMAIL, NON_ADMIN_PASS)
    except AssertionError:
        return None


@pytest.fixture(scope="session")
def non_admin_headers(non_admin_token):
    if not non_admin_token:
        pytest.skip("non-admin user not available")
    return {"Authorization": f"Bearer {non_admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def created_plan_id(admin_headers):
    """Create a fresh plan for the test module and clean it up at the end."""
    name = f"TEST_thumb_plan_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/floor-plans", json={"name": name, "pdfUrl": PDF_URL}, headers=admin_headers, timeout=20)
    assert r.status_code in (200, 201), f"Create plan failed: {r.status_code} {r.text}"
    pid = r.json()["id"]
    yield pid
    # cleanup
    try:
        requests.delete(f"{API}/floor-plans/{pid}", headers=admin_headers, timeout=10)
    except Exception:
        pass


# ---------- AUTH/SANITY ---------- #
def test_health():
    # /api/auth/me with admin token should work
    tok = _login(ADMIN_EMAIL, ADMIN_PASS)
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
    assert r.status_code == 200
    assert r.json().get("email") == ADMIN_EMAIL


# ---------- THUMBNAIL ENDPOINT (NEW) ---------- #
class TestThumbnail:
    def test_put_thumbnail_valid(self, admin_headers, created_plan_id):
        r = requests.put(
            f"{API}/floor-plans/{created_plan_id}/thumbnail",
            json={"thumbnail": SMALL_PNG_DATA_URL},
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

    def test_thumbnail_returned_in_get_detail(self, admin_headers, created_plan_id):
        r = requests.get(f"{API}/floor-plans/{created_plan_id}", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("thumbnail", "").startswith("data:image/")
        assert data["thumbnail"] == SMALL_PNG_DATA_URL

    def test_thumbnail_returned_in_list(self, admin_headers, created_plan_id):
        r = requests.get(f"{API}/floor-plans", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        plans = r.json()
        match = next((p for p in plans if p["id"] == created_plan_id), None)
        assert match is not None, "created plan missing from list"
        assert match.get("thumbnail", "").startswith("data:image/")

    def test_invalid_thumbnail_prefix_rejected(self, admin_headers, created_plan_id):
        r = requests.put(
            f"{API}/floor-plans/{created_plan_id}/thumbnail",
            json={"thumbnail": "notadataurl"},
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_oversized_thumbnail_rejected(self, admin_headers, created_plan_id):
        big = "data:image/png;base64," + ("A" * 800_001)
        r = requests.put(
            f"{API}/floor-plans/{created_plan_id}/thumbnail",
            json={"thumbnail": big},
            headers=admin_headers,
            timeout=20,
        )
        assert r.status_code == 400, r.text

    def test_thumbnail_requires_admin(self, non_admin_headers, created_plan_id):
        r = requests.put(
            f"{API}/floor-plans/{created_plan_id}/thumbnail",
            json={"thumbnail": SMALL_PNG_DATA_URL},
            headers=non_admin_headers,
            timeout=15,
        )
        assert r.status_code == 403, f"Non-admin should get 403, got {r.status_code}: {r.text}"

    def test_thumbnail_no_auth(self, created_plan_id):
        r = requests.put(
            f"{API}/floor-plans/{created_plan_id}/thumbnail",
            json={"thumbnail": SMALL_PNG_DATA_URL},
            timeout=15,
        )
        assert r.status_code in (401, 403)

    def test_thumbnail_unknown_plan(self, admin_headers):
        r = requests.put(
            f"{API}/floor-plans/{uuid.uuid4()}/thumbnail",
            json={"thumbnail": SMALL_PNG_DATA_URL},
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 404


# ---------- REGRESSION: full draft -> publish -> versions -> rollback -> clone ---------- #
class TestFloorPlanWorkflowRegression:
    def test_full_workflow(self, admin_headers):
        # CREATE
        name = f"TEST_wf_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/floor-plans", json={"name": name, "pdfUrl": PDF_URL}, headers=admin_headers, timeout=15)
        assert r.status_code in (200, 201), r.text
        pid = r.json()["id"]

        try:
            # SAVE DRAFT v1
            seats_v1 = [
                {"id": "A1", "label": "A1", "x": 10, "y": 10, "size": 10, "rotation": 0, "status": "available"},
                {"id": "A2", "label": "A2", "x": 20, "y": 10, "size": 10, "rotation": 0, "status": "available"},
            ]
            r = requests.put(
                f"{API}/floor-plans/{pid}/draft",
                json={"name": name, "pdfUrl": PDF_URL, "seats": seats_v1},
                headers=admin_headers, timeout=15,
            )
            assert r.status_code == 200, r.text

            # PUBLISH v1
            r = requests.post(f"{API}/floor-plans/{pid}/publish", json={"comments": "v1"}, headers=admin_headers, timeout=15)
            assert r.status_code == 200, r.text
            v1 = r.json()
            assert v1["version_number"] == 1
            v1_id = v1["version_id"]

            # SAVE DRAFT v2 with more seats
            seats_v2 = seats_v1 + [{"id": "A3", "label": "A3", "x": 30, "y": 10, "size": 10, "rotation": 0, "status": "available"}]
            r = requests.put(
                f"{API}/floor-plans/{pid}/draft",
                json={"name": name, "pdfUrl": PDF_URL, "seats": seats_v2},
                headers=admin_headers, timeout=15,
            )
            assert r.status_code == 200

            # PUBLISH v2
            r = requests.post(f"{API}/floor-plans/{pid}/publish", json={"comments": "v2"}, headers=admin_headers, timeout=15)
            assert r.status_code == 200, r.text
            assert r.json()["version_number"] == 2

            # LIST VERSIONS
            r = requests.get(f"{API}/floor-plans/{pid}/versions", headers=admin_headers, timeout=15)
            assert r.status_code == 200
            versions = r.json()
            assert len(versions) >= 2

            # ROLLBACK to v1 -> creates a new version
            r = requests.post(
                f"{API}/floor-plans/{pid}/versions/{v1_id}/rollback",
                json={"comments": "rb"},
                headers=admin_headers, timeout=15,
            )
            assert r.status_code == 200, r.text
            assert r.json()["version_number"] >= 3

            # SET DEFAULT (idempotent)
            r = requests.post(f"{API}/floor-plans/{pid}/set-default", headers=admin_headers, timeout=15)
            assert r.status_code == 200

            # CLONE
            r = requests.post(
                f"{API}/floor-plans/{pid}/clone",
                json={"name": f"{name}_clone"},
                headers=admin_headers, timeout=15,
            )
            assert r.status_code in (200, 201), r.text
            cloned_id = r.json()["id"]
            assert cloned_id != pid

            # AUDIT
            r = requests.get(f"{API}/floor-plans/{pid}/audit", headers=admin_headers, timeout=15)
            assert r.status_code == 200
            assert isinstance(r.json(), list)
            actions = {a["action"] for a in r.json()}
            assert "floor_plan.publish" in actions

            # SET A THUMBNAIL AFTER PUBLISH (the publish flow itself is FE-driven)
            r = requests.put(
                f"{API}/floor-plans/{pid}/thumbnail",
                json={"thumbnail": SMALL_PNG_DATA_URL},
                headers=admin_headers, timeout=15,
            )
            assert r.status_code == 200

            # GET DETAIL — thumbnail present after rollback/publish cycle
            r = requests.get(f"{API}/floor-plans/{pid}", headers=admin_headers, timeout=15)
            assert r.status_code == 200
            assert r.json().get("thumbnail", "").startswith("data:image/")

            # cleanup clone
            requests.delete(f"{API}/floor-plans/{cloned_id}", headers=admin_headers, timeout=10)
        finally:
            requests.delete(f"{API}/floor-plans/{pid}", headers=admin_headers, timeout=10)
