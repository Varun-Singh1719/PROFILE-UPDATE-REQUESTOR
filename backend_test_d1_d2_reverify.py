#!/usr/bin/env python3
"""
RE-VERIFY QA FIXES D1 (WORKSPACE ENDPOINT LEAKS) AND D2 (DELETED PERMISSION SETS) — Aug 2026

Tests the additional fixes applied by main agent:
- FIX 1 (D1): Tightened OR logic on workspace endpoints
- FIX 2 (D2): Keep orphan set IDs on delete, filter by deleted_at:null
"""

import requests
import json
import time
from typing import Dict, List, Tuple, Optional

# Configuration
BASE_URL = "https://client-segmentation.preview.emergentagent.com/api"
SUPER_ADMIN_EMAIL = "admin@ticketing.com"
SUPER_ADMIN_PASSWORD = "Admin@123"

# Test results storage
test_results = {
    "d1_matrix": [],
    "d2_before_after": {},
    "super_admin_regression": [],
    "cleanup": [],
    "summary": {}
}

def log(msg: str, level: str = "INFO"):
    """Log message with timestamp"""
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] [{level}] {msg}")

def login(email: str, password: str) -> Optional[str]:
    """Login and return JWT token"""
    try:
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "email": email,
            "password": password
        }, timeout=10)
        if resp.status_code == 200:
            token = resp.json().get("access_token")
            log(f"✅ Login successful: {email}")
            return token
        else:
            log(f"❌ Login failed: {email} - {resp.status_code}", "ERROR")
            return None
    except Exception as e:
        log(f"❌ Login exception: {email} - {str(e)}", "ERROR")
        return None

def impersonate(super_admin_token: str, target_user_id: str, target_email: str = "") -> Optional[str]:
    """Impersonate user and return impersonation token"""
    try:
        resp = requests.post(f"{BASE_URL}/auth/impersonate", json={
            "user_id": target_user_id
        }, headers={"Authorization": f"Bearer {super_admin_token}"}, timeout=10)
        if resp.status_code == 200:
            token = resp.json().get("access_token")
            log(f"✅ Impersonation successful: {target_email or target_user_id}")
            return token
        else:
            log(f"❌ Impersonation failed: {target_email or target_user_id} - {resp.status_code} - {resp.text}", "ERROR")
            return None
    except Exception as e:
        log(f"❌ Impersonation exception: {target_email or target_user_id} - {str(e)}", "ERROR")
        return None

def create_permission_set(token: str, title: str, modules: dict) -> Optional[str]:
    """Create permission set and return ID"""
    try:
        resp = requests.post(f"{BASE_URL}/permission-sets-v3", json={
            "title": title,
            "description": f"QA test set for D1/D2 verification",
            "modules": modules
        }, headers={"Authorization": f"Bearer {token}"}, timeout=10)
        if resp.status_code == 200:
            set_id = resp.json().get("id")
            log(f"✅ Created permission set: {title} (ID: {set_id})")
            return set_id
        else:
            log(f"❌ Failed to create permission set: {title} - {resp.status_code} - {resp.text}", "ERROR")
            return None
    except Exception as e:
        log(f"❌ Create permission set exception: {title} - {str(e)}", "ERROR")
        return None

def create_dummy_admin(token: str, email: str, name: str, permission_set_ids: List[str]) -> Optional[str]:
    """Create dummy Admin user and return ID"""
    try:
        # Generate unique emp_id based on timestamp
        emp_id = f"QA{int(time.time() * 1000) % 1000000}"
        resp = requests.post(f"{BASE_URL}/contacts", json={
            "name": name,
            "email": email,
            "role": "Admin",
            "status": "Active",
            "emp_id": emp_id,
            "doj": "2026-08-01",
            "permission_set_ids": permission_set_ids
        }, headers={"Authorization": f"Bearer {token}"}, timeout=10)
        if resp.status_code == 200:
            user_id = resp.json().get("id")
            log(f"✅ Created dummy admin: {email} (ID: {user_id})")
            return user_id
        else:
            log(f"❌ Failed to create dummy admin: {email} - {resp.status_code} - {resp.text}", "ERROR")
            return None
    except Exception as e:
        log(f"❌ Create dummy admin exception: {email} - {str(e)}", "ERROR")
        return None

def deactivate_user(token: str, user_id: str) -> bool:
    """Deactivate user"""
    try:
        resp = requests.patch(f"{BASE_URL}/contacts/{user_id}", json={
            "status": "Inactive"
        }, headers={"Authorization": f"Bearer {token}"}, timeout=10)
        if resp.status_code == 200:
            log(f"✅ Deactivated user: {user_id}")
            return True
        else:
            log(f"❌ Failed to deactivate user: {user_id} - {resp.status_code}", "ERROR")
            return False
    except Exception as e:
        log(f"❌ Deactivate user exception: {user_id} - {str(e)}", "ERROR")
        return False

def delete_permission_set(token: str, set_id: str) -> bool:
    """Delete permission set"""
    try:
        resp = requests.delete(f"{BASE_URL}/permission-sets-v3/{set_id}", 
                             headers={"Authorization": f"Bearer {token}"}, timeout=10)
        if resp.status_code == 200:
            log(f"✅ Deleted permission set: {set_id}")
            return True
        else:
            log(f"❌ Failed to delete permission set: {set_id} - {resp.status_code}", "ERROR")
            return False
    except Exception as e:
        log(f"❌ Delete permission set exception: {set_id} - {str(e)}", "ERROR")
        return False

def test_endpoint(token: str, endpoint: str, expected_status: int) -> Tuple[bool, int, str]:
    """Test endpoint and return (pass, actual_status, details)"""
    try:
        resp = requests.get(f"{BASE_URL}{endpoint}", 
                          headers={"Authorization": f"Bearer {token}"}, timeout=10)
        actual_status = resp.status_code
        passed = (actual_status == expected_status)
        
        status_emoji = "✅" if passed else "❌"
        log(f"{status_emoji} {endpoint}: {actual_status} (expected {expected_status})")
        
        return passed, actual_status, resp.text[:200] if not passed else ""
    except Exception as e:
        log(f"❌ Test endpoint exception: {endpoint} - {str(e)}", "ERROR")
        return False, 0, str(e)

def test_d1_scenario(super_admin_token: str, scenario_name: str, user_email_base: str, 
                     permission_modules: dict, expected_results: dict) -> dict:
    """Test D1 scenario with specific permission set"""
    log(f"\n{'='*80}")
    log(f"D1 SCENARIO: {scenario_name}")
    log(f"{'='*80}")
    
    # Make email unique with timestamp
    timestamp = int(time.time() * 1000) % 1000000
    user_email = user_email_base.replace("@", f"+{timestamp}@")
    
    # Create permission set
    set_id = create_permission_set(super_admin_token, f"QA-D1-{scenario_name}", permission_modules)
    if not set_id:
        return {"scenario": scenario_name, "error": "Failed to create permission set"}
    
    # Create dummy admin
    user_id = create_dummy_admin(super_admin_token, user_email, f"QA D1 {scenario_name}", [set_id])
    if not user_id:
        delete_permission_set(super_admin_token, set_id)
        return {"scenario": scenario_name, "error": "Failed to create user"}
    
    # Impersonate user
    user_token = impersonate(super_admin_token, user_id, user_email)
    if not user_token:
        deactivate_user(super_admin_token, user_id)
        delete_permission_set(super_admin_token, set_id)
        return {"scenario": scenario_name, "error": "Failed to impersonate"}
    
    # Test all 8 endpoints
    endpoints = [
        "/workstation-bookings",
        "/room-bookings",
        "/workstation-requests",
        "/meeting-room-requests",
        "/bookings",
        "/my-workspace/dashboard",
        "/my-workspace/week",
        "/my-workspace/floor"
    ]
    
    results = {
        "scenario": scenario_name,
        "user_email": user_email,
        "permission_modules": permission_modules,
        "tests": []
    }
    
    for endpoint in endpoints:
        expected_status = expected_results.get(endpoint, 403)
        passed, actual_status, details = test_endpoint(user_token, endpoint, expected_status)
        results["tests"].append({
            "endpoint": endpoint,
            "expected": expected_status,
            "actual": actual_status,
            "passed": passed,
            "details": details if not passed else ""
        })
    
    # Cleanup
    deactivate_user(super_admin_token, user_id)
    delete_permission_set(super_admin_token, set_id)
    
    # Calculate pass rate
    passed_count = sum(1 for t in results["tests"] if t["passed"])
    results["pass_rate"] = f"{passed_count}/{len(results['tests'])}"
    results["all_passed"] = (passed_count == len(results["tests"]))
    
    return results

def test_d2_deleted_set(super_admin_token: str) -> dict:
    """Test D2: Deleted permission set revokes access immediately"""
    log(f"\n{'='*80}")
    log(f"D2 SCENARIO: Deleted Permission Set")
    log(f"{'='*80}")
    
    # Make email unique with timestamp
    timestamp = int(time.time() * 1000) % 1000000
    user_email = f"qa-d2-test+{timestamp}@ticketing.com"
    
    # Create permission set with profix + manage permissions
    modules = {
        "profix": {
            "pages": {
                "all_requests": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"}
                }
            }
        },
        "manage": {
            "pages": {
                "employees": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"}
                }
            }
        }
    }
    
    set_id = create_permission_set(super_admin_token, "QA-D2-Retest", modules)
    if not set_id:
        return {"error": "Failed to create permission set"}
    
    # Create dummy admin
    user_id = create_dummy_admin(super_admin_token, user_email, "QA D2 Test User", [set_id])
    if not user_id:
        delete_permission_set(super_admin_token, set_id)
        return {"error": "Failed to create user"}
    
    # Impersonate to mint JWT
    user_token = impersonate(super_admin_token, user_id, user_email)
    if not user_token:
        deactivate_user(super_admin_token, user_id)
        delete_permission_set(super_admin_token, set_id)
        return {"error": "Failed to impersonate"}
    
    log("\n--- BEFORE DELETE ---")
    
    # Test endpoints BEFORE delete
    before_results = []
    test_endpoints = [
        ("/tickets", 200),
        ("/contacts", 200),
        ("/me/permissions", 200)
    ]
    
    for endpoint, expected in test_endpoints:
        passed, actual, details = test_endpoint(user_token, endpoint, expected)
        before_results.append({
            "endpoint": endpoint,
            "expected": expected,
            "actual": actual,
            "passed": passed
        })
    
    # Check /me/permissions response
    try:
        resp = requests.get(f"{BASE_URL}/me/permissions", 
                          headers={"Authorization": f"Bearer {user_token}"}, timeout=10)
        if resp.status_code == 200:
            perms = resp.json()
            log(f"📊 /me/permissions BEFORE: has_any_set={perms.get('has_any_set')}, "
                f"set_ids={len(perms.get('set_ids', []))}, "
                f"modules={list(perms.get('modules', {}).keys())}")
    except Exception as e:
        log(f"❌ Failed to check /me/permissions: {str(e)}", "ERROR")
    
    # DELETE permission set as Super Admin
    log("\n--- DELETING PERMISSION SET ---")
    delete_success = delete_permission_set(super_admin_token, set_id)
    if not delete_success:
        deactivate_user(super_admin_token, user_id)
        return {"error": "Failed to delete permission set"}
    
    # Wait a moment for propagation
    time.sleep(1)
    
    log("\n--- AFTER DELETE (SAME JWT) ---")
    
    # Test endpoints AFTER delete with SAME JWT
    after_results = []
    test_endpoints_after = [
        ("/tickets", 403),
        ("/contacts", 403),
        ("/workstation-bookings", 403),
        ("/bookings", 403),
        ("/permission-sets-v3", 403),
        ("/me/permissions", 200)  # This should still work but show has_any_set=false
    ]
    
    for endpoint, expected in test_endpoints_after:
        passed, actual, details = test_endpoint(user_token, endpoint, expected)
        after_results.append({
            "endpoint": endpoint,
            "expected": expected,
            "actual": actual,
            "passed": passed,
            "details": details if not passed else ""
        })
    
    # Check /me/permissions response after delete
    try:
        resp = requests.get(f"{BASE_URL}/me/permissions", 
                          headers={"Authorization": f"Bearer {user_token}"}, timeout=10)
        if resp.status_code == 200:
            perms = resp.json()
            has_any_set = perms.get('has_any_set')
            set_ids = perms.get('set_ids', [])
            modules = perms.get('modules', {})
            
            log(f"📊 /me/permissions AFTER: has_any_set={has_any_set}, "
                f"set_ids={set_ids}, modules={modules}")
            
            # Verify expected values
            expected_has_any_set = False
            expected_set_ids = []
            expected_modules = {}
            
            if has_any_set != expected_has_any_set:
                log(f"❌ has_any_set mismatch: expected {expected_has_any_set}, got {has_any_set}", "ERROR")
            else:
                log(f"✅ has_any_set correct: {has_any_set}")
            
            if set_ids != expected_set_ids:
                log(f"❌ set_ids mismatch: expected {expected_set_ids}, got {set_ids}", "ERROR")
            else:
                log(f"✅ set_ids correct: {set_ids}")
            
            if modules != expected_modules:
                log(f"❌ modules mismatch: expected {expected_modules}, got {modules}", "ERROR")
            else:
                log(f"✅ modules correct: {modules}")
    except Exception as e:
        log(f"❌ Failed to check /me/permissions after delete: {str(e)}", "ERROR")
    
    # Cleanup
    deactivate_user(super_admin_token, user_id)
    
    # Calculate results
    before_passed = sum(1 for r in before_results if r["passed"])
    after_passed = sum(1 for r in after_results if r["passed"])
    
    return {
        "before_delete": {
            "results": before_results,
            "pass_rate": f"{before_passed}/{len(before_results)}"
        },
        "after_delete": {
            "results": after_results,
            "pass_rate": f"{after_passed}/{len(after_results)}"
        },
        "all_passed": (before_passed == len(before_results) and after_passed == len(after_results))
    }

def test_super_admin_regression(super_admin_token: str) -> dict:
    """Test Super Admin regression - all endpoints should return 200"""
    log(f"\n{'='*80}")
    log(f"SUPER ADMIN REGRESSION")
    log(f"{'='*80}")
    
    endpoints = [
        "/tickets",
        "/teams",
        "/contacts",
        "/permission-sets-v3",
        "/email-templates",
        "/floor-plans",
        "/workstation-bookings",
        "/room-bookings",
        "/workstation-requests",
        "/meeting-room-requests",
        "/bookings",
        "/my-workspace/dashboard",
        "/my-workspace/week",
        "/my-workspace/floor",
        "/approval-settings",
        "/audit",
        "/notifications/outbox",
        "/me/permissions"
    ]
    
    results = []
    for endpoint in endpoints:
        passed, actual, details = test_endpoint(super_admin_token, endpoint, 200)
        results.append({
            "endpoint": endpoint,
            "expected": 200,
            "actual": actual,
            "passed": passed,
            "details": details if not passed else ""
        })
    
    passed_count = sum(1 for r in results if r["passed"])
    
    return {
        "results": results,
        "pass_rate": f"{passed_count}/{len(results)}",
        "all_passed": (passed_count == len(results))
    }

def main():
    """Main test execution"""
    log("="*80)
    log("RE-VERIFY QA FIXES D1 (WORKSPACE ENDPOINT LEAKS) AND D2 (DELETED PERMISSION SETS)")
    log("="*80)
    
    # Login as Super Admin
    super_admin_token = login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)
    if not super_admin_token:
        log("❌ FATAL: Cannot login as Super Admin", "ERROR")
        return
    
    # ========== D1 TESTS ==========
    log("\n" + "="*80)
    log("D1: WORKSPACE ENDPOINT PERMISSION MATRIX")
    log("="*80)
    
    # User-A: only desk_booking.workstation_bookings.view scope=overall
    user_a_modules = {
        "desk_booking": {
            "pages": {
                "workstation_bookings": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"}
                }
            }
        }
    }
    user_a_expected = {
        "/workstation-bookings": 200,
        "/room-bookings": 403,
        "/workstation-requests": 403,
        "/meeting-room-requests": 403,
        "/bookings": 403,
        "/my-workspace/dashboard": 403,
        "/my-workspace/week": 403,
        "/my-workspace/floor": 403
    }
    result_a = test_d1_scenario(super_admin_token, "User-A", "qa-d1-user-a@ticketing.com", 
                               user_a_modules, user_a_expected)
    test_results["d1_matrix"].append(result_a)
    
    # User-B: only desk_booking.floor_layout.view scope=overall
    user_b_modules = {
        "desk_booking": {
            "pages": {
                "floor_layout": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"}
                }
            }
        }
    }
    user_b_expected = {
        "/workstation-bookings": 200,
        "/room-bookings": 200,
        "/workstation-requests": 403,
        "/meeting-room-requests": 403,
        "/bookings": 403,
        "/my-workspace/dashboard": 200,
        "/my-workspace/week": 200,
        "/my-workspace/floor": 200
    }
    result_b = test_d1_scenario(super_admin_token, "User-B", "qa-d1-user-b@ticketing.com",
                               user_b_modules, user_b_expected)
    test_results["d1_matrix"].append(result_b)
    
    # User-C: only desk_booking.bookings_history.view scope=overall
    user_c_modules = {
        "desk_booking": {
            "pages": {
                "bookings_history": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"}
                }
            }
        }
    }
    user_c_expected = {
        "/workstation-bookings": 200,
        "/room-bookings": 200,
        "/workstation-requests": 403,
        "/meeting-room-requests": 403,
        "/bookings": 200,
        "/my-workspace/dashboard": 200,
        "/my-workspace/week": 200,
        "/my-workspace/floor": 403
    }
    result_c = test_d1_scenario(super_admin_token, "User-C", "qa-d1-user-c@ticketing.com",
                               user_c_modules, user_c_expected)
    test_results["d1_matrix"].append(result_c)
    
    # User-D: empty permission set (modules: {})
    user_d_modules = {}
    user_d_expected = {
        "/workstation-bookings": 403,
        "/room-bookings": 403,
        "/workstation-requests": 403,
        "/meeting-room-requests": 403,
        "/bookings": 403,
        "/my-workspace/dashboard": 403,
        "/my-workspace/week": 403,
        "/my-workspace/floor": 403
    }
    result_d = test_d1_scenario(super_admin_token, "User-D", "qa-d1-user-d@ticketing.com",
                               user_d_modules, user_d_expected)
    test_results["d1_matrix"].append(result_d)
    
    # User-E: only profix.all_requests.view
    user_e_modules = {
        "profix": {
            "pages": {
                "all_requests": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"}
                }
            }
        }
    }
    user_e_expected = {
        "/workstation-bookings": 403,
        "/room-bookings": 403,
        "/workstation-requests": 403,
        "/meeting-room-requests": 403,
        "/bookings": 403,
        "/my-workspace/dashboard": 403,
        "/my-workspace/week": 403,
        "/my-workspace/floor": 403
    }
    result_e = test_d1_scenario(super_admin_token, "User-E", "qa-d1-user-e@ticketing.com",
                               user_e_modules, user_e_expected)
    test_results["d1_matrix"].append(result_e)
    
    # ========== D2 TEST ==========
    test_results["d2_before_after"] = test_d2_deleted_set(super_admin_token)
    
    # ========== SUPER ADMIN REGRESSION ==========
    test_results["super_admin_regression"] = test_super_admin_regression(super_admin_token)
    
    # ========== SUMMARY ==========
    log("\n" + "="*80)
    log("TEST SUMMARY")
    log("="*80)
    
    # D1 Summary
    d1_all_passed = all(r.get("all_passed", False) for r in test_results["d1_matrix"])
    d1_status = "✅ PASS" if d1_all_passed else "❌ FAIL"
    log(f"\nD1 (Workspace Endpoints): {d1_status}")
    for result in test_results["d1_matrix"]:
        status = "✅" if result.get("all_passed", False) else "❌"
        log(f"  {status} {result['scenario']}: {result.get('pass_rate', 'N/A')}")
    
    # D2 Summary
    d2_all_passed = test_results["d2_before_after"].get("all_passed", False)
    d2_status = "✅ PASS" if d2_all_passed else "❌ FAIL"
    log(f"\nD2 (Deleted Permission Set): {d2_status}")
    if "before_delete" in test_results["d2_before_after"]:
        log(f"  Before Delete: {test_results['d2_before_after']['before_delete']['pass_rate']}")
        log(f"  After Delete: {test_results['d2_before_after']['after_delete']['pass_rate']}")
    else:
        log(f"  Error: {test_results['d2_before_after'].get('error', 'Unknown error')}")
    
    # Super Admin Regression Summary
    sa_all_passed = test_results["super_admin_regression"].get("all_passed", False)
    sa_status = "✅ PASS" if sa_all_passed else "❌ FAIL"
    log(f"\nSuper Admin Regression: {sa_status}")
    log(f"  Pass Rate: {test_results['super_admin_regression']['pass_rate']}")
    
    # Overall Summary
    overall_pass = d1_all_passed and d2_all_passed and sa_all_passed
    overall_status = "✅ ALL TESTS PASSED" if overall_pass else "❌ SOME TESTS FAILED"
    log(f"\n{'='*80}")
    log(f"OVERALL: {overall_status}")
    log(f"{'='*80}")
    
    # Save detailed results to JSON
    with open("/app/qa_d1_d2_reverify_results.json", "w") as f:
        json.dump(test_results, f, indent=2)
    log("\n📄 Detailed results saved to: /app/qa_d1_d2_reverify_results.json")

if __name__ == "__main__":
    main()
