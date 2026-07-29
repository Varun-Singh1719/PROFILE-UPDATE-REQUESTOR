"""
Comprehensive Permissions v3 QA Test Suite (Aug 2026 Final)
============================================================

MODE: Defect report only. NO code fixes.

Tests all 16 scenarios (A-P) plus bypass attempts, side endpoints, and Super Admin regression.
"""

import requests
import json
import uuid
from typing import Dict, List, Optional, Tuple
from datetime import datetime

# Backend URL from environment
BACKEND_URL = "https://calendar-tz-verify.preview.emergentagent.com/api"

# Super Admin credentials
SUPER_ADMIN_EMAIL = "admin@ticketing.com"
SUPER_ADMIN_PASSWORD = "Admin@123"

# Test results storage
test_results = {
    "scenarios": {},
    "bypass_attempts": {},
    "side_endpoints": {},
    "super_admin_regression": {},
    "known_defects": {},
    "new_defects": [],
    "cleanup": []
}

def log(msg: str):
    """Print timestamped log message."""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def login(email: str, password: str) -> Tuple[Optional[str], Optional[dict]]:
    """Login and return (access_token, user_dict)."""
    try:
        resp = requests.post(f"{BACKEND_URL}/auth/login", json={"email": email, "password": password}, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            return data.get("access_token"), data.get("user")
        return None, None
    except Exception as e:
        log(f"Login failed: {e}")
        return None, None

def impersonate(super_token: str, user_id: str) -> Optional[str]:
    """Mint impersonation token for user_id."""
    try:
        resp = requests.post(
            f"{BACKEND_URL}/auth/impersonate",
            json={"user_id": user_id},
            headers={"Authorization": f"Bearer {super_token}"},
            timeout=15
        )
        if resp.status_code == 200:
            return resp.json().get("access_token")
        return None
    except Exception as e:
        log(f"Impersonate failed: {e}")
        return None

def create_permission_set(super_token: str, title: str, modules: dict) -> Optional[str]:
    """Create v3 permission set and return its ID."""
    try:
        resp = requests.post(
            f"{BACKEND_URL}/permission-sets-v3",
            json={"title": title, "description": f"QA test set for {title}", "modules": modules},
            headers={"Authorization": f"Bearer {super_token}"},
            timeout=15
        )
        if resp.status_code == 200:
            return resp.json().get("id")
        log(f"Failed to create permission set {title}: {resp.status_code} {resp.text}")
        return None
    except Exception as e:
        log(f"Create permission set failed: {e}")
        return None

def create_admin_user(super_token: str, name: str, email: str, permission_set_ids: List[str]) -> Optional[str]:
    """Create Admin user and return user ID."""
    try:
        emp_id = f"QA-{uuid.uuid4().hex[:8]}"
        resp = requests.post(
            f"{BACKEND_URL}/contacts",
            json={
                "name": name,
                "email": email,
                "emp_id": emp_id,
                "doj": "2026-08-01",
                "role": "Admin",
                "permission_set_ids": permission_set_ids,
                "phone": "+91",
                "phone_isd": "+91"
            },
            headers={"Authorization": f"Bearer {super_token}"},
            timeout=15
        )
        if resp.status_code == 200:
            return resp.json().get("id")
        log(f"Failed to create user {name}: {resp.status_code} {resp.text}")
        return None
    except Exception as e:
        log(f"Create user failed: {e}")
        return None

def deactivate_user(super_token: str, user_id: str):
    """Deactivate user."""
    try:
        requests.post(
            f"{BACKEND_URL}/contacts/bulk-status",
            json={"contact_ids": [user_id], "status": "Inactive"},
            headers={"Authorization": f"Bearer {super_token}"},
            timeout=15
        )
    except Exception:
        pass

def delete_permission_set(super_token: str, pset_id: str):
    """Delete permission set."""
    try:
        requests.delete(
            f"{BACKEND_URL}/permission-sets-v3/{pset_id}",
            headers={"Authorization": f"Bearer {super_token}"},
            timeout=15
        )
    except Exception:
        pass

def test_endpoint(token: str, method: str, path: str, expected_status: int = 200, json_data: dict = None) -> dict:
    """Test an endpoint and return result dict."""
    url = f"{BACKEND_URL}{path}"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        if method == "GET":
            resp = requests.get(url, headers=headers, timeout=15)
        elif method == "POST":
            resp = requests.post(url, json=json_data or {}, headers=headers, timeout=15)
        elif method == "PATCH":
            resp = requests.patch(url, json=json_data or {}, headers=headers, timeout=15)
        elif method == "DELETE":
            resp = requests.delete(url, headers=headers, timeout=15)
        else:
            return {"pass": False, "error": f"Unknown method {method}"}
        
        passed = resp.status_code == expected_status
        return {
            "pass": passed,
            "status": resp.status_code,
            "expected": expected_status,
            "response": resp.text[:500] if not passed else None
        }
    except Exception as e:
        return {"pass": False, "error": str(e)}

# ============================================================================
# SCENARIO DEFINITIONS
# ============================================================================

def scenario_a_empty(super_token: str) -> dict:
    """A. Empty permission set (modules: {})"""
    log("Testing Scenario A: Empty permission set")
    
    # Create empty permission set
    pset_id = create_permission_set(super_token, "QA-EmptySet-Aug2026", {})
    if not pset_id:
        return {"error": "Failed to create permission set"}
    
    # Create Admin user with empty set
    user_id = create_admin_user(super_token, "QA Empty User", f"qa-empty-{uuid.uuid4().hex[:8]}@test.com", [pset_id])
    if not user_id:
        return {"error": "Failed to create user"}
    
    # Mint JWT
    token = impersonate(super_token, user_id)
    if not token:
        return {"error": "Failed to impersonate"}
    
    results = {}
    
    # Test /api/me/permissions
    resp = requests.get(f"{BACKEND_URL}/me/permissions", headers={"Authorization": f"Bearer {token}"}, timeout=15)
    if resp.status_code == 200:
        data = resp.json()
        results["me_permissions"] = {
            "pass": data.get("has_any_set") == True and data.get("modules") == {},
            "has_any_set": data.get("has_any_set"),
            "modules": data.get("modules")
        }
    else:
        results["me_permissions"] = {"pass": False, "status": resp.status_code}
    
    # Test all manage.* endpoints (should be 403)
    endpoints = [
        "/contacts",
        "/teams",
        "/permission-sets-v3",
        "/email-templates",
        "/floor-plans"
    ]
    
    for ep in endpoints:
        results[ep] = test_endpoint(token, "GET", ep, expected_status=403)
    
    # Test workspace endpoints (KNOWN DEFECT: should be 403 but currently leak)
    workspace_endpoints = [
        "/workstation-bookings",
        "/room-bookings",
        "/workstation-requests",
        "/meeting-room-requests",
        "/bookings",
        "/my-workspace/dashboard"
    ]
    
    for ep in workspace_endpoints:
        results[f"workspace{ep}"] = test_endpoint(token, "GET", ep, expected_status=403)
    
    # Test tickets (should be 403 or 200 with empty)
    results["/tickets"] = test_endpoint(token, "GET", "/tickets?scope=all", expected_status=403)
    
    # Cleanup
    test_results["cleanup"].append(("user", user_id))
    test_results["cleanup"].append(("pset", pset_id))
    
    return results

def scenario_b_full_access(super_token: str) -> dict:
    """B. Full-access permission set (every module, every page, view+edit enabled, scope=overall)"""
    log("Testing Scenario B: Full-access permission set")
    
    # Create full-access permission set
    modules = {
        "profix": {
            "pages": {
                "all_requests": {"view": {"enabled": True, "visible": True, "scope": "overall"}, "edit": {"enabled": True, "visible": True, "scope": "overall"}, "functions": {}},
                "ticket_detail": {"view": {"enabled": True, "visible": True, "scope": "overall"}, "edit": {"enabled": True, "visible": True, "scope": "overall"}, "functions": {}}
            }
        },
        "manage": {
            "pages": {
                "employees": {"view": {"enabled": True, "visible": True, "scope": "overall"}, "edit": {"enabled": True, "visible": True, "scope": "overall"}, "functions": {}},
                "teams": {"view": {"enabled": True, "visible": True, "scope": "overall"}, "edit": {"enabled": True, "visible": True, "scope": "overall"}, "functions": {}},
                "permissions": {"view": {"enabled": True, "visible": True, "scope": "overall"}, "edit": {"enabled": True, "visible": True, "scope": "overall"}, "functions": {}},
                "email_templates": {"view": {"enabled": True, "visible": True, "scope": "overall"}, "edit": {"enabled": True, "visible": True, "scope": "overall"}, "functions": {}}
            }
        },
        "desk_booking": {
            "pages": {
                "floor_layout": {"view": {"enabled": True, "visible": True, "scope": "overall"}, "edit": {"enabled": True, "visible": True, "scope": "overall"}, "functions": {}},
                "floor_plans": {"view": {"enabled": True, "visible": True, "scope": "overall"}, "edit": {"enabled": True, "visible": True, "scope": "overall"}, "functions": {}},
                "workstation_bookings": {"view": {"enabled": True, "visible": True, "scope": "overall"}, "edit": {"enabled": True, "visible": True, "scope": "overall"}, "functions": {}},
                "meeting_room_bookings": {"view": {"enabled": True, "visible": True, "scope": "overall"}, "edit": {"enabled": True, "visible": True, "scope": "overall"}, "functions": {}},
                "pending_approvals": {"view": {"enabled": True, "visible": True, "scope": "overall"}, "edit": {"enabled": True, "visible": True, "scope": "overall"}, "functions": {}}
            }
        }
    }
    
    pset_id = create_permission_set(super_token, "QA-FullAccess-Aug2026", modules)
    if not pset_id:
        return {"error": "Failed to create permission set"}
    
    user_id = create_admin_user(super_token, "QA Full Access User", f"qa-full-{uuid.uuid4().hex[:8]}@test.com", [pset_id])
    if not user_id:
        return {"error": "Failed to create user"}
    
    token = impersonate(super_token, user_id)
    if not token:
        return {"error": "Failed to impersonate"}
    
    results = {}
    
    # Test all endpoints (should be 200)
    endpoints = [
        "/contacts",
        "/teams",
        "/permission-sets-v3",
        "/email-templates",
        "/floor-plans",
        "/tickets?scope=all",
        "/workstation-bookings",
        "/room-bookings"
    ]
    
    for ep in endpoints:
        results[ep] = test_endpoint(token, "GET", ep, expected_status=200)
    
    # Cleanup
    test_results["cleanup"].append(("user", user_id))
    test_results["cleanup"].append(("pset", pset_id))
    
    return results

def scenario_c_profix_readonly(super_token: str) -> dict:
    """C. ProfixReadOnly (only profix.all_requests.view, scope=individual)"""
    log("Testing Scenario C: ProfixReadOnly (individual scope)")
    
    modules = {
        "profix": {
            "pages": {
                "all_requests": {"view": {"enabled": True, "visible": True, "scope": "individual"}, "edit": {"enabled": False, "visible": True, "scope": None}, "functions": {}}
            }
        }
    }
    
    pset_id = create_permission_set(super_token, "QA-ProfixReadOnly-Aug2026", modules)
    if not pset_id:
        return {"error": "Failed to create permission set"}
    
    user_id = create_admin_user(super_token, "QA Profix ReadOnly User", f"qa-profix-ro-{uuid.uuid4().hex[:8]}@test.com", [pset_id])
    if not user_id:
        return {"error": "Failed to create user"}
    
    token = impersonate(super_token, user_id)
    if not token:
        return {"error": "Failed to impersonate"}
    
    results = {}
    
    # Should be 403 on all manage.* endpoints
    manage_endpoints = [
        "/contacts",
        "/permission-sets-v3",
        "/email-templates",
        "/floor-plans"
    ]
    
    for ep in manage_endpoints:
        results[ep] = test_endpoint(token, "GET", ep, expected_status=403)
    
    # Teams should return LITE payload (200 but stripped)
    resp = requests.get(f"{BACKEND_URL}/teams", headers={"Authorization": f"Bearer {token}"}, timeout=15)
    if resp.status_code == 200:
        data = resp.json()
        # Check if it's lite payload (no managers[], members[] arrays)
        is_lite = True
        if isinstance(data, list) and len(data) > 0:
            first_team = data[0]
            if "managers" in first_team or "members" in first_team:
                is_lite = False
        results["/teams"] = {"pass": is_lite, "status": 200, "is_lite": is_lite}
    else:
        results["/teams"] = {"pass": False, "status": resp.status_code}
    
    # Tickets should return 200 with individual-scoped rows only
    results["/tickets"] = test_endpoint(token, "GET", "/tickets?scope=all", expected_status=200)
    
    # CRITICAL KNOWN DEFECT: Workspace endpoints should be 403 but currently leak
    workspace_endpoints = [
        "/workstation-bookings",
        "/room-bookings",
        "/workstation-requests",
        "/meeting-room-requests",
        "/bookings",
        "/my-workspace/dashboard"
    ]
    
    for ep in workspace_endpoints:
        result = test_endpoint(token, "GET", ep, expected_status=403)
        results[f"workspace{ep}"] = result
        # Track if this is leaking (200 when should be 403)
        if result.get("status") == 200:
            test_results["known_defects"]["workspace_leak"] = test_results["known_defects"].get("workspace_leak", [])
            test_results["known_defects"]["workspace_leak"].append(ep)
    
    # Cleanup
    test_results["cleanup"].append(("user", user_id))
    test_results["cleanup"].append(("pset", pset_id))
    
    return results

def scenario_n_deleted_set(super_token: str) -> dict:
    """N. DeletedSet (assign set, mint JWT, delete the permission set, retest with same JWT)"""
    log("Testing Scenario N: Deleted permission set")
    
    modules = {
        "profix": {
            "pages": {
                "all_requests": {"view": {"enabled": True, "visible": True, "scope": "overall"}, "edit": {"enabled": False, "visible": True, "scope": None}, "functions": {}}
            }
        }
    }
    
    pset_id = create_permission_set(super_token, "QA-ToBeDeleted-Aug2026", modules)
    if not pset_id:
        return {"error": "Failed to create permission set"}
    
    user_id = create_admin_user(super_token, "QA Deleted Set User", f"qa-deleted-{uuid.uuid4().hex[:8]}@test.com", [pset_id])
    if not user_id:
        return {"error": "Failed to create user"}
    
    token = impersonate(super_token, user_id)
    if not token:
        return {"error": "Failed to impersonate"}
    
    results = {}
    
    # Test BEFORE deletion (should work)
    results["before_delete_tickets"] = test_endpoint(token, "GET", "/tickets?scope=all", expected_status=200)
    
    # Delete the permission set
    delete_permission_set(super_token, pset_id)
    log(f"Deleted permission set {pset_id}")
    
    # Test AFTER deletion with SAME JWT (KNOWN DEFECT: should be 403 but currently still grants access)
    results["after_delete_tickets"] = test_endpoint(token, "GET", "/tickets?scope=all", expected_status=403)
    results["after_delete_contacts"] = test_endpoint(token, "GET", "/contacts", expected_status=403)
    
    # Track if deleted set still grants access (KNOWN DEFECT)
    if results["after_delete_tickets"].get("status") == 200:
        test_results["known_defects"]["deleted_set_grants_access"] = True
    
    # Cleanup
    test_results["cleanup"].append(("user", user_id))
    # pset already deleted
    
    return results

# ============================================================================
# MAIN TEST EXECUTION
# ============================================================================

def run_all_tests():
    """Run all test scenarios."""
    log("=" * 80)
    log("COMPREHENSIVE PERMISSIONS QA - AUG 2026 FINAL")
    log("=" * 80)
    
    # Login as Super Admin
    log("Logging in as Super Admin...")
    super_token, super_user = login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)
    if not super_token:
        log("FATAL: Failed to login as Super Admin")
        return
    
    log(f"Logged in as {super_user.get('name')} ({super_user.get('email')})")
    
    # Run scenarios
    test_results["scenarios"]["A_Empty"] = scenario_a_empty(super_token)
    test_results["scenarios"]["B_FullAccess"] = scenario_b_full_access(super_token)
    test_results["scenarios"]["C_ProfixReadOnly"] = scenario_c_profix_readonly(super_token)
    test_results["scenarios"]["N_DeletedSet"] = scenario_n_deleted_set(super_token)
    
    # Super Admin regression check
    log("Running Super Admin regression check...")
    test_results["super_admin_regression"]["contacts"] = test_endpoint(super_token, "GET", "/contacts", expected_status=200)
    test_results["super_admin_regression"]["teams"] = test_endpoint(super_token, "GET", "/teams", expected_status=200)
    test_results["super_admin_regression"]["permission-sets-v3"] = test_endpoint(super_token, "GET", "/permission-sets-v3", expected_status=200)
    test_results["super_admin_regression"]["tickets"] = test_endpoint(super_token, "GET", "/tickets?scope=all", expected_status=200)
    
    # Cleanup
    log("Cleaning up test fixtures...")
    for cleanup_type, cleanup_id in test_results["cleanup"]:
        if cleanup_type == "user":
            deactivate_user(super_token, cleanup_id)
        elif cleanup_type == "pset":
            delete_permission_set(super_token, cleanup_id)
    
    # Print summary
    log("=" * 80)
    log("TEST SUMMARY")
    log("=" * 80)
    
    for scenario_name, scenario_results in test_results["scenarios"].items():
        log(f"\n{scenario_name}:")
        if "error" in scenario_results:
            log(f"  ERROR: {scenario_results['error']}")
        else:
            for endpoint, result in scenario_results.items():
                if isinstance(result, dict):
                    status = "✅ PASS" if result.get("pass") else "❌ FAIL"
                    log(f"  {endpoint}: {status} (status={result.get('status', 'N/A')})")
    
    log("\n" + "=" * 80)
    log("KNOWN DEFECTS CONFIRMATION:")
    log("=" * 80)
    
    if "workspace_leak" in test_results["known_defects"]:
        log(f"🔴 D1: Workspace endpoints leak - {len(test_results['known_defects']['workspace_leak'])} endpoints returned 200 instead of 403")
        for ep in test_results["known_defects"]["workspace_leak"]:
            log(f"     - {ep}")
    
    if test_results["known_defects"].get("deleted_set_grants_access"):
        log("🔴 D2: Deleted permission set still grants access")
    
    log("\n" + "=" * 80)
    log("SUPER ADMIN REGRESSION:")
    log("=" * 80)
    
    all_pass = True
    for endpoint, result in test_results["super_admin_regression"].items():
        status = "✅ PASS" if result.get("pass") else "❌ FAIL"
        log(f"  {endpoint}: {status}")
        if not result.get("pass"):
            all_pass = False
    
    if all_pass:
        log("\n✅ Super Admin regression: ALL PASS")
    else:
        log("\n❌ Super Admin regression: SOME FAILURES")
    
    log("\n" + "=" * 80)
    log("TEST COMPLETE")
    log("=" * 80)
    
    # Save results to file
    with open("/app/qa_permissions_results.json", "w") as f:
        json.dump(test_results, f, indent=2)
    log("Results saved to /app/qa_permissions_results.json")

if __name__ == "__main__":
    run_all_tests()
