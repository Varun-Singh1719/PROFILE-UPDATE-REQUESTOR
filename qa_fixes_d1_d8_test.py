"""
QA Fixes Verification Test Suite (Aug 2026)
============================================

Verifies fixes for defects D1, D2, D4, D6, D7, D8 as specified in the review request.

Test Credentials:
- Super Admin: admin@ticketing.com / Admin@123
- Backend URL: from frontend/.env REACT_APP_BACKEND_URL

Deliverables:
1. Pass/fail table for each fix (D1, D2, D4, D6, D7, D8) with actual HTTP codes vs expected
2. Any regressions on Super Admin
3. Cleanup: delete all dummy permission sets, deactivate all dummy Admin users
"""

import requests
import json
import uuid
from typing import Dict, List, Optional, Tuple
from datetime import datetime

# Backend URL
BACKEND_URL = "https://client-hub-system-2.preview.emergentagent.com/api"

# Super Admin credentials
SUPER_ADMIN_EMAIL = "admin@ticketing.com"
SUPER_ADMIN_PASSWORD = "Admin@123"

# Test results storage
test_results = {
    "D1": {},
    "D2": {},
    "D4": {},
    "D6": {},
    "D7": {},
    "D8": {},
    "super_admin_regression": {},
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
        log(f"Login failed: {resp.status_code} {resp.text[:200]}")
        return None, None
    except Exception as e:
        log(f"Login exception: {e}")
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
        log(f"Impersonate failed: {resp.status_code} {resp.text[:200]}")
        return None
    except Exception as e:
        log(f"Impersonate exception: {e}")
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
        log(f"Failed to create permission set {title}: {resp.status_code} {resp.text[:200]}")
        return None
    except Exception as e:
        log(f"Create permission set exception: {e}")
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
        log(f"Failed to create user {name}: {resp.status_code} {resp.text[:200]}")
        return None
    except Exception as e:
        log(f"Create user exception: {e}")
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
            "response": resp.json() if resp.status_code == 200 and resp.text else None,
            "error": resp.text[:300] if not passed else None
        }
    except Exception as e:
        return {"pass": False, "error": str(e)}

# ============================================================================
# FIX D1: 8 workspace endpoints require v3 desk_booking permissions
# ============================================================================

def test_d1(super_token: str):
    """Test D1: 8 workspace endpoints now require v3 desk_booking page permissions."""
    log("\n" + "="*80)
    log("TESTING D1: Workspace endpoints require desk_booking permissions")
    log("="*80)
    
    results = {}
    
    # 8 endpoints to test
    workspace_endpoints = [
        "/workstation-bookings",
        "/room-bookings",
        "/workstation-requests",
        "/meeting-room-requests",
        "/bookings",
        "/my-workspace/dashboard",
        "/my-workspace/week",
        "/my-workspace/floor"
    ]
    
    # Test a) Empty set user → all 8 endpoints should return 403
    log("\nD1-a) Testing empty permission set user...")
    empty_modules = {}
    pset_empty = create_permission_set(super_token, "QA-EmptySet-D1", empty_modules)
    if pset_empty:
        user_empty = create_admin_user(super_token, "QA Empty D1", f"qa-empty-d1-{uuid.uuid4().hex[:6]}@test.com", [pset_empty])
        if user_empty:
            token_empty = impersonate(super_token, user_empty)
            if token_empty:
                results["a_empty_set"] = {}
                for ep in workspace_endpoints:
                    result = test_endpoint(token_empty, "GET", ep, expected_status=403)
                    results["a_empty_set"][ep] = result
                    status_icon = "✅" if result["pass"] else "❌"
                    log(f"  {status_icon} {ep}: {result['status']} (expected 403)")
            test_results["cleanup"].append(("user", user_empty))
        test_results["cleanup"].append(("pset", pset_empty))
    
    # Test b) Profix-only user → all 8 endpoints should return 403
    log("\nD1-b) Testing profix-only user...")
    profix_modules = {
        "profix": {
            "pages": {
                "all_requests": {
                    "view": {"enabled": True, "visible": True, "scope": "individual"},
                    "edit": {"enabled": False, "visible": True, "scope": None},
                    "functions": {}
                }
            }
        }
    }
    pset_profix = create_permission_set(super_token, "QA-ProfixOnly-D1", profix_modules)
    if pset_profix:
        user_profix = create_admin_user(super_token, "QA Profix D1", f"qa-profix-d1-{uuid.uuid4().hex[:6]}@test.com", [pset_profix])
        if user_profix:
            token_profix = impersonate(super_token, user_profix)
            if token_profix:
                results["b_profix_only"] = {}
                for ep in workspace_endpoints:
                    result = test_endpoint(token_profix, "GET", ep, expected_status=403)
                    results["b_profix_only"][ep] = result
                    status_icon = "✅" if result["pass"] else "❌"
                    log(f"  {status_icon} {ep}: {result['status']} (expected 403)")
            test_results["cleanup"].append(("user", user_profix))
        test_results["cleanup"].append(("pset", pset_profix))
    
    # Test c) Desk booking viewer → workstation-bookings 200, others 403
    log("\nD1-c) Testing desk_booking viewer user...")
    desk_modules = {
        "desk_booking": {
            "pages": {
                "workstation_bookings": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"},
                    "edit": {"enabled": False, "visible": True, "scope": None},
                    "functions": {}
                }
            }
        }
    }
    pset_desk = create_permission_set(super_token, "QA-DeskBookingViewer", desk_modules)
    if pset_desk:
        user_desk = create_admin_user(super_token, "QA Desk D1", f"qa-desk-d1-{uuid.uuid4().hex[:6]}@test.com", [pset_desk])
        if user_desk:
            token_desk = impersonate(super_token, user_desk)
            if token_desk:
                results["c_desk_viewer"] = {}
                # /workstation-bookings should be 200
                result = test_endpoint(token_desk, "GET", "/workstation-bookings", expected_status=200)
                results["c_desk_viewer"]["/workstation-bookings"] = result
                status_icon = "✅" if result["pass"] else "❌"
                log(f"  {status_icon} /workstation-bookings: {result['status']} (expected 200)")
                
                # Others should be 403
                for ep in ["/room-bookings", "/workstation-requests", "/meeting-room-requests", "/bookings", "/my-workspace/dashboard", "/my-workspace/week", "/my-workspace/floor"]:
                    result = test_endpoint(token_desk, "GET", ep, expected_status=403)
                    results["c_desk_viewer"][ep] = result
                    status_icon = "✅" if result["pass"] else "❌"
                    log(f"  {status_icon} {ep}: {result['status']} (expected 403)")
            test_results["cleanup"].append(("user", user_desk))
        test_results["cleanup"].append(("pset", pset_desk))
    
    # Test d) Super Admin regression → all 200
    log("\nD1-d) Testing Super Admin regression...")
    results["d_super_admin"] = {}
    for ep in workspace_endpoints:
        result = test_endpoint(super_token, "GET", ep, expected_status=200)
        results["d_super_admin"][ep] = result
        status_icon = "✅" if result["pass"] else "❌"
        log(f"  {status_icon} {ep}: {result['status']} (expected 200)")
    
    test_results["D1"] = results
    return results

# ============================================================================
# FIX D2: Deleted permission sets stop granting access immediately
# ============================================================================

def test_d2(super_token: str):
    """Test D2: Deleted permission sets stop granting access immediately."""
    log("\n" + "="*80)
    log("TESTING D2: Deleted permission sets stop granting access")
    log("="*80)
    
    results = {}
    
    # Create permission set with profix access
    log("\nD2-a) Creating permission set with profix access...")
    modules = {
        "profix": {
            "pages": {
                "all_requests": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"},
                    "edit": {"enabled": False, "visible": True, "scope": None},
                    "functions": {}
                }
            }
        }
    }
    pset_id = create_permission_set(super_token, "QA-DeletedSetTest", modules)
    if not pset_id:
        return {"error": "Failed to create permission set"}
    
    # Create user and assign the set
    log("D2-b) Creating user and assigning permission set...")
    user_id = create_admin_user(super_token, "QA Deleted Set Test", f"qa-deleted-d2-{uuid.uuid4().hex[:6]}@test.com", [pset_id])
    if not user_id:
        return {"error": "Failed to create user"}
    
    # Impersonate and mint JWT
    log("D2-c) Impersonating user and minting JWT...")
    token = impersonate(super_token, user_id)
    if not token:
        return {"error": "Failed to impersonate"}
    
    # Verify JWT works before deletion
    log("D2-d) Verifying JWT works before deletion...")
    result_before = test_endpoint(token, "GET", "/tickets?scope=all", expected_status=200)
    results["before_deletion"] = result_before
    log(f"  GET /tickets before deletion: {result_before['status']} (expected 200) {'✅' if result_before['pass'] else '❌'}")
    
    # Delete the permission set
    log("D2-e) Deleting permission set...")
    delete_permission_set(super_token, pset_id)
    
    # Retry with SAME JWT → should get 403
    log("D2-f) Retrying with SAME JWT after deletion...")
    result_after_tickets = test_endpoint(token, "GET", "/tickets?scope=all", expected_status=403)
    results["after_deletion_tickets"] = result_after_tickets
    log(f"  GET /tickets after deletion: {result_after_tickets['status']} (expected 403) {'✅' if result_after_tickets['pass'] else '❌'}")
    
    # Test /api/me/permissions with same JWT
    log("D2-g) Testing /api/me/permissions after deletion...")
    resp = requests.get(f"{BACKEND_URL}/me/permissions", headers={"Authorization": f"Bearer {token}"}, timeout=15)
    if resp.status_code == 200:
        data = resp.json()
        has_any_set = data.get("has_any_set")
        set_ids = data.get("set_ids")
        modules_data = data.get("modules")
        
        # Expected: has_any_set=false, set_ids=[], modules={}
        passed = has_any_set == False and set_ids == [] and modules_data == {}
        results["me_permissions_after_deletion"] = {
            "pass": passed,
            "has_any_set": has_any_set,
            "set_ids": set_ids,
            "modules": modules_data
        }
        log(f"  /me/permissions: has_any_set={has_any_set} (expected False), set_ids={set_ids} (expected []), modules={modules_data} (expected {{}}) {'✅' if passed else '❌'}")
    else:
        results["me_permissions_after_deletion"] = {"pass": False, "status": resp.status_code}
        log(f"  /me/permissions: {resp.status_code} ❌")
    
    # Test other endpoints with same JWT
    log("D2-h) Testing other endpoints after deletion...")
    other_endpoints = ["/contacts", "/workstation-bookings", "/permission-sets-v3"]
    for ep in other_endpoints:
        result = test_endpoint(token, "GET", ep, expected_status=403)
        results[f"after_deletion{ep}"] = result
        status_icon = "✅" if result["pass"] else "❌"
        log(f"  {status_icon} {ep}: {result['status']} (expected 403)")
    
    test_results["cleanup"].append(("user", user_id))
    # pset already deleted
    
    test_results["D2"] = results
    return results

# ============================================================================
# FIX D4: Tickets endpoint returns 403 for users lacking profix
# ============================================================================

def test_d4(super_token: str):
    """Test D4: Tickets endpoint returns 403 (not 200-empty) for users lacking profix."""
    log("\n" + "="*80)
    log("TESTING D4: Tickets endpoint returns 403 for users lacking profix")
    log("="*80)
    
    results = {}
    
    # Test a) Desk booking only user → GET /tickets should return 403
    log("\nD4-a) Testing desk_booking-only user...")
    desk_modules = {
        "desk_booking": {
            "pages": {
                "workstation_bookings": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"},
                    "edit": {"enabled": False, "visible": True, "scope": None},
                    "functions": {}
                }
            }
        }
    }
    pset_desk = create_permission_set(super_token, "QA-DeskBookingOnly", desk_modules)
    if pset_desk:
        user_desk = create_admin_user(super_token, "QA Desk Only D4", f"qa-desk-d4-{uuid.uuid4().hex[:6]}@test.com", [pset_desk])
        if user_desk:
            token_desk = impersonate(super_token, user_desk)
            if token_desk:
                result_tickets = test_endpoint(token_desk, "GET", "/tickets?scope=all", expected_status=403)
                results["a_desk_only_tickets"] = result_tickets
                log(f"  GET /tickets: {result_tickets['status']} (expected 403) {'✅' if result_tickets['pass'] else '❌'}")
                
                result_export = test_endpoint(token_desk, "GET", "/tickets/export.csv?scope=all", expected_status=403)
                results["a_desk_only_export"] = result_export
                log(f"  GET /tickets/export.csv: {result_export['status']} (expected 403) {'✅' if result_export['pass'] else '❌'}")
            test_results["cleanup"].append(("user", user_desk))
        test_results["cleanup"].append(("pset", pset_desk))
    
    # Test b) Super Admin regression → 200
    log("\nD4-b) Testing Super Admin regression...")
    result_sa = test_endpoint(super_token, "GET", "/tickets?scope=all", expected_status=200)
    results["b_super_admin"] = result_sa
    log(f"  GET /tickets: {result_sa['status']} (expected 200) {'✅' if result_sa['pass'] else '❌'}")
    
    # Test c) User with profix → 200
    log("\nD4-c) Testing user with profix access...")
    profix_modules = {
        "profix": {
            "pages": {
                "all_requests": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"},
                    "edit": {"enabled": False, "visible": True, "scope": None},
                    "functions": {}
                }
            }
        }
    }
    pset_profix = create_permission_set(super_token, "QA-ProfixUser-D4", profix_modules)
    if pset_profix:
        user_profix = create_admin_user(super_token, "QA Profix D4", f"qa-profix-d4-{uuid.uuid4().hex[:6]}@test.com", [pset_profix])
        if user_profix:
            token_profix = impersonate(super_token, user_profix)
            if token_profix:
                result_profix = test_endpoint(token_profix, "GET", "/tickets?scope=all", expected_status=200)
                results["c_profix_user"] = result_profix
                log(f"  GET /tickets: {result_profix['status']} (expected 200) {'✅' if result_profix['pass'] else '❌'}")
            test_results["cleanup"].append(("user", user_profix))
        test_results["cleanup"].append(("pset", pset_profix))
    
    test_results["D4"] = results
    return results

# ============================================================================
# FIX D6: Teams lite payload only for users needing cross-module access
# ============================================================================

def test_d6(super_token: str):
    """Test D6: Teams lite payload only served to users who need it."""
    log("\n" + "="*80)
    log("TESTING D6: Teams lite payload for cross-module users")
    log("="*80)
    
    results = {}
    
    # Test a) Empty set user → 403
    log("\nD6-a) Testing empty set user...")
    empty_modules = {}
    pset_empty = create_permission_set(super_token, "QA-EmptySet-D6", empty_modules)
    if pset_empty:
        user_empty = create_admin_user(super_token, "QA Empty D6", f"qa-empty-d6-{uuid.uuid4().hex[:6]}@test.com", [pset_empty])
        if user_empty:
            token_empty = impersonate(super_token, user_empty)
            if token_empty:
                result = test_endpoint(token_empty, "GET", "/teams", expected_status=403)
                results["a_empty_set"] = result
                log(f"  GET /teams: {result['status']} (expected 403) {'✅' if result['pass'] else '❌'}")
            test_results["cleanup"].append(("user", user_empty))
        test_results["cleanup"].append(("pset", pset_empty))
    
    # Test b) Manage.teams.view user → 200 with FULL payload
    log("\nD6-b) Testing manage.teams.view user...")
    manage_modules = {
        "manage": {
            "pages": {
                "teams": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"},
                    "edit": {"enabled": False, "visible": True, "scope": None},
                    "functions": {}
                }
            }
        }
    }
    pset_manage = create_permission_set(super_token, "QA-ManageTeamsOnly", manage_modules)
    if pset_manage:
        user_manage = create_admin_user(super_token, "QA Manage Teams D6", f"qa-manage-d6-{uuid.uuid4().hex[:6]}@test.com", [pset_manage])
        if user_manage:
            token_manage = impersonate(super_token, user_manage)
            if token_manage:
                result = test_endpoint(token_manage, "GET", "/teams", expected_status=200)
                if result["pass"] and result["response"]:
                    # Check for FULL payload (managers[], members[] arrays present)
                    teams = result["response"]
                    if isinstance(teams, list) and len(teams) > 0:
                        first_team = teams[0]
                        has_full = "managers" in first_team and "members" in first_team
                        result["payload_type"] = "FULL" if has_full else "LITE"
                        result["pass"] = has_full
                        log(f"  GET /teams: {result['status']} with {'FULL' if has_full else 'LITE'} payload (expected FULL) {'✅' if has_full else '❌'}")
                    else:
                        result["payload_type"] = "UNKNOWN"
                        log(f"  GET /teams: {result['status']} but empty response ❌")
                else:
                    log(f"  GET /teams: {result['status']} (expected 200) ❌")
                results["b_manage_teams"] = result
            test_results["cleanup"].append(("user", user_manage))
        test_results["cleanup"].append(("pset", pset_manage))
    
    # Test c) Profix-only user → 200 with LITE payload
    log("\nD6-c) Testing profix-only user...")
    profix_modules = {
        "profix": {
            "pages": {
                "all_requests": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"},
                    "edit": {"enabled": False, "visible": True, "scope": None},
                    "functions": {}
                }
            }
        }
    }
    pset_profix = create_permission_set(super_token, "QA-ProfixOnly-D6", profix_modules)
    if pset_profix:
        user_profix = create_admin_user(super_token, "QA Profix D6", f"qa-profix-d6-{uuid.uuid4().hex[:6]}@test.com", [pset_profix])
        if user_profix:
            token_profix = impersonate(super_token, user_profix)
            if token_profix:
                result = test_endpoint(token_profix, "GET", "/teams", expected_status=200)
                if result["pass"] and result["response"]:
                    teams = result["response"]
                    if isinstance(teams, list) and len(teams) > 0:
                        first_team = teams[0]
                        # LITE payload: only id, name, color, initials, member_count, manager_count
                        has_lite = "id" in first_team and "name" in first_team and "managers" not in first_team and "members" not in first_team
                        result["payload_type"] = "LITE" if has_lite else "FULL"
                        result["pass"] = has_lite
                        log(f"  GET /teams: {result['status']} with {'LITE' if has_lite else 'FULL'} payload (expected LITE) {'✅' if has_lite else '❌'}")
                    else:
                        result["payload_type"] = "UNKNOWN"
                        log(f"  GET /teams: {result['status']} but empty response ❌")
                else:
                    log(f"  GET /teams: {result['status']} (expected 200) ❌")
                results["c_profix_only"] = result
            test_results["cleanup"].append(("user", user_profix))
        test_results["cleanup"].append(("pset", pset_profix))
    
    # Test d) Desk booking only user → 200 with LITE payload
    log("\nD6-d) Testing desk_booking-only user...")
    desk_modules = {
        "desk_booking": {
            "pages": {
                "workstation_bookings": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"},
                    "edit": {"enabled": False, "visible": True, "scope": None},
                    "functions": {}
                }
            }
        }
    }
    pset_desk = create_permission_set(super_token, "QA-DeskBookingOnly-D6", desk_modules)
    if pset_desk:
        user_desk = create_admin_user(super_token, "QA Desk D6", f"qa-desk-d6-{uuid.uuid4().hex[:6]}@test.com", [pset_desk])
        if user_desk:
            token_desk = impersonate(super_token, user_desk)
            if token_desk:
                result = test_endpoint(token_desk, "GET", "/teams", expected_status=200)
                if result["pass"] and result["response"]:
                    teams = result["response"]
                    if isinstance(teams, list) and len(teams) > 0:
                        first_team = teams[0]
                        has_lite = "id" in first_team and "name" in first_team and "managers" not in first_team and "members" not in first_team
                        result["payload_type"] = "LITE" if has_lite else "FULL"
                        result["pass"] = has_lite
                        log(f"  GET /teams: {result['status']} with {'LITE' if has_lite else 'FULL'} payload (expected LITE) {'✅' if has_lite else '❌'}")
                    else:
                        result["payload_type"] = "UNKNOWN"
                        log(f"  GET /teams: {result['status']} but empty response ❌")
                else:
                    log(f"  GET /teams: {result['status']} (expected 200) ❌")
                results["d_desk_only"] = result
            test_results["cleanup"].append(("user", user_desk))
        test_results["cleanup"].append(("pset", pset_desk))
    
    # Test e) Super Admin → 200 with FULL payload
    log("\nD6-e) Testing Super Admin...")
    result = test_endpoint(super_token, "GET", "/teams", expected_status=200)
    if result["pass"] and result["response"]:
        teams = result["response"]
        if isinstance(teams, list) and len(teams) > 0:
            first_team = teams[0]
            has_full = "managers" in first_team and "members" in first_team
            result["payload_type"] = "FULL" if has_full else "LITE"
            result["pass"] = has_full
            log(f"  GET /teams: {result['status']} with {'FULL' if has_full else 'LITE'} payload (expected FULL) {'✅' if has_full else '❌'}")
        else:
            result["payload_type"] = "UNKNOWN"
            log(f"  GET /teams: {result['status']} but empty response ❌")
    else:
        log(f"  GET /teams: {result['status']} (expected 200) ❌")
    results["e_super_admin"] = result
    
    test_results["D6"] = results
    return results

# ============================================================================
# FIX D7: manage.employees.edit enforced on PATCH /contacts/{id}
# ============================================================================

def test_d7(super_token: str):
    """Test D7: manage.employees.edit permission enforced on PATCH /contacts/{id}."""
    log("\n" + "="*80)
    log("TESTING D7: manage.employees.edit enforced on PATCH /contacts/{id}")
    log("="*80)
    
    results = {}
    
    # Get a real contact ID to test with
    resp = requests.get(f"{BACKEND_URL}/contacts?page=1&page_size=1", headers={"Authorization": f"Bearer {super_token}"}, timeout=15)
    contact_id = None
    if resp.status_code == 200:
        data = resp.json()
        items = data.get("items", [])
        if items:
            contact_id = items[0].get("id")
    
    if not contact_id:
        log("  ❌ Failed to get contact ID for testing")
        return {"error": "No contact ID available"}
    
    log(f"  Using contact ID: {contact_id}")
    
    # Test a) View-only user → GET 200, PATCH 403
    log("\nD7-a) Testing view-only user...")
    view_modules = {
        "manage": {
            "pages": {
                "employees": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"},
                    "edit": {"enabled": False, "visible": True, "scope": None},
                    "functions": {}
                }
            }
        }
    }
    pset_view = create_permission_set(super_token, "QA-EmployeesViewOnly", view_modules)
    if pset_view:
        user_view = create_admin_user(super_token, "QA View Only D7", f"qa-view-d7-{uuid.uuid4().hex[:6]}@test.com", [pset_view])
        if user_view:
            token_view = impersonate(super_token, user_view)
            if token_view:
                result_list = test_endpoint(token_view, "GET", "/contacts", expected_status=200)
                results["a_view_list"] = result_list
                log(f"  GET /contacts: {result_list['status']} (expected 200) {'✅' if result_list['pass'] else '❌'}")
                
                result_get = test_endpoint(token_view, "GET", f"/contacts/{contact_id}", expected_status=200)
                results["a_view_get"] = result_get
                log(f"  GET /contacts/{{id}}: {result_get['status']} (expected 200) {'✅' if result_get['pass'] else '❌'}")
                
                result_patch = test_endpoint(token_view, "PATCH", f"/contacts/{contact_id}", expected_status=403, json_data={"phone": "9999999999"})
                results["a_view_patch"] = result_patch
                log(f"  PATCH /contacts/{{id}}: {result_patch['status']} (expected 403) {'✅' if result_patch['pass'] else '❌'}")
            test_results["cleanup"].append(("user", user_view))
        test_results["cleanup"].append(("pset", pset_view))
    
    # Test b) View+Edit user → GET 200, PATCH 200
    log("\nD7-b) Testing view+edit user...")
    edit_modules = {
        "manage": {
            "pages": {
                "employees": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"},
                    "edit": {"enabled": True, "visible": True, "scope": "overall"},
                    "functions": {}
                }
            }
        }
    }
    pset_edit = create_permission_set(super_token, "QA-EmployeesEditor", edit_modules)
    if pset_edit:
        user_edit = create_admin_user(super_token, "QA Editor D7", f"qa-edit-d7-{uuid.uuid4().hex[:6]}@test.com", [pset_edit])
        if user_edit:
            token_edit = impersonate(super_token, user_edit)
            if token_edit:
                result_list = test_endpoint(token_edit, "GET", "/contacts", expected_status=200)
                results["b_edit_list"] = result_list
                log(f"  GET /contacts: {result_list['status']} (expected 200) {'✅' if result_list['pass'] else '❌'}")
                
                result_patch = test_endpoint(token_edit, "PATCH", f"/contacts/{contact_id}", expected_status=200, json_data={"phone": "8888888888"})
                results["b_edit_patch"] = result_patch
                log(f"  PATCH /contacts/{{id}}: {result_patch['status']} (expected 200) {'✅' if result_patch['pass'] else '❌'}")
            test_results["cleanup"].append(("user", user_edit))
        test_results["cleanup"].append(("pset", pset_edit))
    
    # Test c) Empty set user → GET 403
    log("\nD7-c) Testing empty set user...")
    empty_modules = {}
    pset_empty = create_permission_set(super_token, "QA-EmptySet-D7", empty_modules)
    if pset_empty:
        user_empty = create_admin_user(super_token, "QA Empty D7", f"qa-empty-d7-{uuid.uuid4().hex[:6]}@test.com", [pset_empty])
        if user_empty:
            token_empty = impersonate(super_token, user_empty)
            if token_empty:
                result_get = test_endpoint(token_empty, "GET", f"/contacts/{contact_id}", expected_status=403)
                results["c_empty_get"] = result_get
                log(f"  GET /contacts/{{id}}: {result_get['status']} (expected 403) {'✅' if result_get['pass'] else '❌'}")
            test_results["cleanup"].append(("user", user_empty))
        test_results["cleanup"].append(("pset", pset_empty))
    
    # Test d) Super Admin regression → all 200
    log("\nD7-d) Testing Super Admin regression...")
    result_list = test_endpoint(super_token, "GET", "/contacts", expected_status=200)
    results["d_super_list"] = result_list
    log(f"  GET /contacts: {result_list['status']} (expected 200) {'✅' if result_list['pass'] else '❌'}")
    
    result_get = test_endpoint(super_token, "GET", f"/contacts/{contact_id}", expected_status=200)
    results["d_super_get"] = result_get
    log(f"  GET /contacts/{{id}}: {result_get['status']} (expected 200) {'✅' if result_get['pass'] else '❌'}")
    
    result_patch = test_endpoint(super_token, "PATCH", f"/contacts/{contact_id}", expected_status=200, json_data={"phone": "7777777777"})
    results["d_super_patch"] = result_patch
    log(f"  PATCH /contacts/{{id}}: {result_patch['status']} (expected 200) {'✅' if result_patch['pass'] else '❌'}")
    
    test_results["D7"] = results
    return results

# ============================================================================
# FIX D8: Hidden flag enforced on GET /api/teams
# ============================================================================

def test_d8(super_token: str):
    """Test D8: Hidden flag enforced on GET /api/teams."""
    log("\n" + "="*80)
    log("TESTING D8: Hidden flag enforced on GET /api/teams")
    log("="*80)
    
    results = {}
    
    # Test a) Hidden teams + profix user → 200 with LITE payload
    log("\nD8-a) Testing hidden teams with profix user...")
    hidden_profix_modules = {
        "manage": {
            "pages": {
                "teams": {
                    "view": {"enabled": True, "visible": False, "scope": "overall"},  # Hidden
                    "edit": {"enabled": False, "visible": True, "scope": None},
                    "functions": {}
                }
            }
        },
        "profix": {
            "pages": {
                "all_requests": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"},
                    "edit": {"enabled": False, "visible": True, "scope": None},
                    "functions": {}
                }
            }
        }
    }
    pset_hidden_profix = create_permission_set(super_token, "QA-HiddenTeams", hidden_profix_modules)
    if pset_hidden_profix:
        user_hidden_profix = create_admin_user(super_token, "QA Hidden Profix D8", f"qa-hidden-d8-{uuid.uuid4().hex[:6]}@test.com", [pset_hidden_profix])
        if user_hidden_profix:
            token_hidden_profix = impersonate(super_token, user_hidden_profix)
            if token_hidden_profix:
                result = test_endpoint(token_hidden_profix, "GET", "/teams", expected_status=200)
                if result["pass"] and result["response"]:
                    teams = result["response"]
                    if isinstance(teams, list) and len(teams) > 0:
                        first_team = teams[0]
                        # Should be LITE payload (Hidden means no full manage payload)
                        has_lite = "id" in first_team and "name" in first_team and "managers" not in first_team and "members" not in first_team
                        result["payload_type"] = "LITE" if has_lite else "FULL"
                        result["pass"] = has_lite
                        log(f"  GET /teams: {result['status']} with {'LITE' if has_lite else 'FULL'} payload (expected LITE) {'✅' if has_lite else '❌'}")
                    else:
                        result["payload_type"] = "UNKNOWN"
                        log(f"  GET /teams: {result['status']} but empty response ❌")
                else:
                    log(f"  GET /teams: {result['status']} (expected 200) ❌")
                results["a_hidden_profix"] = result
            test_results["cleanup"].append(("user", user_hidden_profix))
        test_results["cleanup"].append(("pset", pset_hidden_profix))
    
    # Test b) Hidden teams + no cross-module → 403
    log("\nD8-b) Testing hidden teams with no cross-module access...")
    hidden_no_cross_modules = {
        "manage": {
            "pages": {
                "teams": {
                    "view": {"enabled": True, "visible": False, "scope": "overall"},  # Hidden
                    "edit": {"enabled": False, "visible": True, "scope": None},
                    "functions": {}
                }
            }
        }
    }
    pset_hidden_no_cross = create_permission_set(super_token, "QA-HiddenTeamsNoCross", hidden_no_cross_modules)
    if pset_hidden_no_cross:
        user_hidden_no_cross = create_admin_user(super_token, "QA Hidden No Cross D8", f"qa-hidden-nocross-d8-{uuid.uuid4().hex[:6]}@test.com", [pset_hidden_no_cross])
        if user_hidden_no_cross:
            token_hidden_no_cross = impersonate(super_token, user_hidden_no_cross)
            if token_hidden_no_cross:
                result = test_endpoint(token_hidden_no_cross, "GET", "/teams", expected_status=403)
                results["b_hidden_no_cross"] = result
                log(f"  GET /teams: {result['status']} (expected 403) {'✅' if result['pass'] else '❌'}")
            test_results["cleanup"].append(("user", user_hidden_no_cross))
        test_results["cleanup"].append(("pset", pset_hidden_no_cross))
    
    test_results["D8"] = results
    return results

# ============================================================================
# SUPER ADMIN REGRESSION
# ============================================================================

def test_super_admin_regression(super_token: str):
    """Test Super Admin regression - all endpoints should return 200."""
    log("\n" + "="*80)
    log("TESTING SUPER ADMIN REGRESSION")
    log("="*80)
    
    results = {}
    
    # Get a contact ID for PATCH test
    resp = requests.get(f"{BACKEND_URL}/contacts?page=1&page_size=1", headers={"Authorization": f"Bearer {super_token}"}, timeout=15)
    contact_id = None
    if resp.status_code == 200:
        data = resp.json()
        items = data.get("items", [])
        if items:
            contact_id = items[0].get("id")
    
    endpoints = [
        ("GET", "/tickets?scope=all"),
        ("GET", "/tickets/export.csv?scope=all"),
        ("GET", "/teams"),
        ("GET", "/contacts"),
        ("GET", "/permission-sets-v3"),
        ("GET", "/email-templates"),
        ("GET", "/floor-plans"),
        ("GET", "/workstation-bookings"),
        ("GET", "/room-bookings"),
        ("GET", "/workstation-requests"),
        ("GET", "/meeting-room-requests"),
        ("GET", "/bookings"),
        ("GET", "/my-workspace/dashboard"),
        ("GET", "/my-workspace/week"),
        ("GET", "/my-workspace/floor"),
        ("GET", "/permissions/audit"),
        ("GET", "/me/permissions"),
        ("GET", "/profile/me")
    ]
    
    if contact_id:
        endpoints.append(("GET", f"/contacts/{contact_id}"))
        endpoints.append(("PATCH", f"/contacts/{contact_id}"))
    
    for method, path in endpoints:
        if method == "PATCH":
            result = test_endpoint(super_token, method, path, expected_status=200, json_data={"phone": "6666666666"})
        else:
            result = test_endpoint(super_token, method, path, expected_status=200)
        results[f"{method} {path}"] = result
        status_icon = "✅" if result.get("pass") else "❌"
        status_code = result.get("status", "ERROR")
        log(f"  {status_icon} {method} {path}: {status_code} (expected 200)")
    
    test_results["super_admin_regression"] = results
    return results

# ============================================================================
# CLEANUP
# ============================================================================

def cleanup(super_token: str):
    """Cleanup all test fixtures."""
    log("\n" + "="*80)
    log("CLEANUP: Deactivating users and deleting permission sets")
    log("="*80)
    
    for item_type, item_id in test_results["cleanup"]:
        if item_type == "user":
            deactivate_user(super_token, item_id)
            log(f"  Deactivated user: {item_id}")
        elif item_type == "pset":
            delete_permission_set(super_token, item_id)
            log(f"  Deleted permission set: {item_id}")

# ============================================================================
# MAIN
# ============================================================================

def print_summary():
    """Print test summary."""
    log("\n" + "="*80)
    log("TEST SUMMARY")
    log("="*80)
    
    def count_results(results_dict):
        passed = 0
        failed = 0
        for key, value in results_dict.items():
            if isinstance(value, dict):
                if "pass" in value:
                    if value["pass"]:
                        passed += 1
                    else:
                        failed += 1
                else:
                    # Nested dict, recurse
                    p, f = count_results(value)
                    passed += p
                    failed += f
        return passed, failed
    
    for fix in ["D1", "D2", "D4", "D6", "D7", "D8"]:
        if fix in test_results:
            passed, failed = count_results(test_results[fix])
            total = passed + failed
            status = "✅ PASS" if failed == 0 else f"❌ FAIL ({failed}/{total} failed)"
            log(f"{fix}: {status}")
    
    if "super_admin_regression" in test_results:
        passed, failed = count_results(test_results["super_admin_regression"])
        total = passed + failed
        status = "✅ PASS" if failed == 0 else f"❌ FAIL ({failed}/{total} failed)"
        log(f"Super Admin Regression: {status}")
    
    log("\n" + "="*80)
    log("DETAILED RESULTS")
    log("="*80)
    print(json.dumps(test_results, indent=2))

def main():
    """Main test runner."""
    log("="*80)
    log("QA FIXES VERIFICATION TEST SUITE (D1-D8)")
    log("="*80)
    
    # Login as Super Admin
    log("\nLogging in as Super Admin...")
    super_token, super_user = login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)
    if not super_token:
        log("❌ Failed to login as Super Admin")
        return
    
    log(f"✅ Logged in as {super_user.get('name')} ({super_user.get('email')})")
    
    try:
        # Run all tests
        test_d1(super_token)
        test_d2(super_token)
        test_d4(super_token)
        test_d6(super_token)
        test_d7(super_token)
        test_d8(super_token)
        test_super_admin_regression(super_token)
        
        # Cleanup
        cleanup(super_token)
        
        # Print summary
        print_summary()
        
    except Exception as e:
        log(f"\n❌ Test suite failed with exception: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
