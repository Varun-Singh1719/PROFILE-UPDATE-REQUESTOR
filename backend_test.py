#!/usr/bin/env python3
"""
Backend Test Script for Profix Assign-To Eligibility Rule
Tests the new assign_to_self / assign_to_others permission flags
"""

import requests
import json
import sys
from datetime import datetime

# Configuration
BASE_URL = "https://admin-perms-fix-1.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@ticketing.com"
ADMIN_PASSWORD = "Admin@123"

# Test state
session = requests.Session()
test_results = []
test_pset_id = None
test_user_id = None
test_user_email = None


def log_test(scenario, status, details=""):
    """Log test result"""
    result = {
        "scenario": scenario,
        "status": status,
        "details": details,
        "timestamp": datetime.now().isoformat()
    }
    test_results.append(result)
    status_icon = "✅" if status == "PASS" else "❌"
    print(f"{status_icon} {scenario}: {status}")
    if details:
        print(f"   {details}")


def login():
    """Login as Super Admin"""
    print("\n=== LOGIN ===")
    resp = session.post(f"{BASE_URL}/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    
    if resp.status_code == 200:
        log_test("Login", "PASS", f"Logged in as {ADMIN_EMAIL}")
        return True
    else:
        log_test("Login", "FAIL", f"Status {resp.status_code}: {resp.text}")
        return False


def test_catalog():
    """Test 1: Catalog check - verify assign_to_self and assign_to_others exist, receive_assignment removed"""
    print("\n=== TEST 1: CATALOG CHECK ===")
    
    resp = session.get(f"{BASE_URL}/permissions/schema/v3")
    
    if resp.status_code != 200:
        log_test("Catalog - GET /api/permissions/schema/v3", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    data = resp.json()
    
    # Find profix module
    profix_module = None
    for module in data.get("modules", []):
        if module.get("key") == "profix":
            profix_module = module
            break
    
    if not profix_module:
        log_test("Catalog - Find profix module", "FAIL", "profix module not found")
        return False
    
    # Find ticket_detail page
    ticket_detail_page = None
    for page in profix_module.get("pages", []):
        if page.get("key") == "ticket_detail":
            ticket_detail_page = page
            break
    
    if not ticket_detail_page:
        log_test("Catalog - Find ticket_detail page", "FAIL", "ticket_detail page not found")
        return False
    
    functions = ticket_detail_page.get("functions", [])
    function_keys = {f.get("key"): f for f in functions}
    
    # Check assign_to_self exists
    if "assign_to_self" not in function_keys:
        log_test("Catalog - assign_to_self exists", "FAIL", "assign_to_self not found in functions")
        return False
    
    assign_to_self = function_keys["assign_to_self"]
    if assign_to_self.get("label") != "Assign Requests to Self":
        log_test("Catalog - assign_to_self label", "FAIL", 
                f"Expected 'Assign Requests to Self', got '{assign_to_self.get('label')}'")
        return False
    
    if assign_to_self.get("scoped") != False:
        log_test("Catalog - assign_to_self scoped", "FAIL", 
                f"Expected scoped=False, got {assign_to_self.get('scoped')}")
        return False
    
    log_test("Catalog - assign_to_self", "PASS", 
            f"Found with label '{assign_to_self.get('label')}', scoped=False")
    
    # Check assign_to_others exists
    if "assign_to_others" not in function_keys:
        log_test("Catalog - assign_to_others exists", "FAIL", "assign_to_others not found in functions")
        return False
    
    assign_to_others = function_keys["assign_to_others"]
    if assign_to_others.get("label") != "Assign Requests to Others":
        log_test("Catalog - assign_to_others label", "FAIL", 
                f"Expected 'Assign Requests to Others', got '{assign_to_others.get('label')}'")
        return False
    
    if assign_to_others.get("scoped") != False:
        log_test("Catalog - assign_to_others scoped", "FAIL", 
                f"Expected scoped=False, got {assign_to_others.get('scoped')}")
        return False
    
    log_test("Catalog - assign_to_others", "PASS", 
            f"Found with label '{assign_to_others.get('label')}', scoped=False")
    
    # Check receive_assignment does NOT exist
    if "receive_assignment" in function_keys:
        log_test("Catalog - receive_assignment removed", "FAIL", 
                "receive_assignment still exists in catalog (should be removed)")
        return False
    
    log_test("Catalog - receive_assignment removed", "PASS", "receive_assignment not in catalog")
    
    return True


def test_assignable_default_empty():
    """Test 2: /api/contacts/assignable should be empty by default (Super Admin not included)"""
    print("\n=== TEST 2: ASSIGNABLE ENDPOINT DEFAULT EMPTY ===")
    
    resp = session.get(f"{BASE_URL}/contacts/assignable")
    
    if resp.status_code != 200:
        log_test("Assignable - GET /api/contacts/assignable", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    data = resp.json()
    
    if not isinstance(data, list):
        log_test("Assignable - Response is array", "FAIL", 
                f"Expected array, got {type(data)}")
        return False
    
    log_test("Assignable - Response is array", "PASS", f"Returned {len(data)} users")
    
    # Check if Super Admin is in the list
    super_admin_in_list = any(u.get("email") == ADMIN_EMAIL for u in data)
    
    if super_admin_in_list:
        log_test("Assignable - Super Admin NOT in list", "FAIL", 
                "Super Admin appears in assignable list (should not be there without permission set)")
        return False
    
    log_test("Assignable - Super Admin NOT in list", "PASS", 
            "Super Admin correctly excluded (no permission set assigned)")
    
    # For each user in the list, verify they have permission sets with the required flags
    if len(data) > 0:
        # Get all permission sets
        psets_resp = session.get(f"{BASE_URL}/permission-sets-v3")
        if psets_resp.status_code != 200:
            log_test("Assignable - Verify user permissions", "FAIL", 
                    f"Could not fetch permission sets: {psets_resp.status_code}")
            return False
        
        psets_data = psets_resp.json()
        psets = {p["id"]: p for p in psets_data.get("items", [])}
        
        for user in data:
            user_pset_ids = user.get("permission_set_ids", [])
            has_required_flag = False
            
            for pset_id in user_pset_ids:
                pset = psets.get(pset_id)
                if not pset:
                    continue
                
                # Check if this pset has either flag enabled
                modules = pset.get("modules", {})
                profix = modules.get("profix", {})
                pages = profix.get("pages", {})
                ticket_detail = pages.get("ticket_detail", {})
                functions = ticket_detail.get("functions", {})
                
                assign_to_self = functions.get("assign_to_self", {})
                assign_to_others = functions.get("assign_to_others", {})
                
                if assign_to_self.get("enabled") or assign_to_others.get("enabled"):
                    has_required_flag = True
                    break
            
            if not has_required_flag:
                log_test("Assignable - User has required permission", "FAIL", 
                        f"User {user.get('email')} in list but has no assign_to_self or assign_to_others enabled")
                return False
        
        log_test("Assignable - All users have required permissions", "PASS", 
                f"Verified {len(data)} users have assign_to_self or assign_to_others enabled")
    
    return True


def test_round_trip():
    """Test 3: Full round-trip - create permission set, create user, test eligibility with flag toggles"""
    global test_pset_id, test_user_id, test_user_email
    
    print("\n=== TEST 3: FULL ROUND-TRIP ===")
    
    # 3a. Create permission set with assign_to_self enabled
    print("\n--- 3a. Create permission set with assign_to_self enabled ---")
    
    pset_payload = {
        "title": "QA Assign-Self",
        "description": "Test permission set for assign-to eligibility testing",
        "modules": {
            "profix": {
                "pages": {
                    "ticket_detail": {
                        "view": {"enabled": True, "visible": True, "scope": "team"},
                        "edit": {"enabled": True, "visible": True, "scope": "team"},
                        "functions": {
                            "assign_to_self": {"enabled": True, "visible": True},
                            "assign_to_others": {"enabled": False, "visible": True}
                        }
                    }
                }
            }
        }
    }
    
    resp = session.post(f"{BASE_URL}/permission-sets-v3", json=pset_payload)
    
    if resp.status_code != 200:
        log_test("Round-trip 3a - Create permission set", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    pset_data = resp.json()
    test_pset_id = pset_data.get("id")
    
    log_test("Round-trip 3a - Create permission set", "PASS", 
            f"Created permission set ID: {test_pset_id}")
    
    # 3b. Create new Admin user with this permission set
    print("\n--- 3b. Create new Admin user with permission set ---")
    
    test_user_email = f"qa_assign_test_{datetime.now().timestamp()}@ticketing.com"
    
    user_payload = {
        "name": "QA Assign Test User",
        "email": test_user_email,
        "emp_id": f"QA{int(datetime.now().timestamp())}",
        "role": "Admin",
        "status": "Active",
        "doj": "2026-01-01",
        "permission_set_ids": [test_pset_id]
    }
    
    resp = session.post(f"{BASE_URL}/contacts", json=user_payload)
    
    if resp.status_code != 200:
        log_test("Round-trip 3b - Create user", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    user_data = resp.json()
    test_user_id = user_data.get("id")
    
    # If permission_set_ids not accepted at creation, PATCH it
    if not user_data.get("permission_set_ids") or test_pset_id not in user_data.get("permission_set_ids", []):
        print("   Permission set not assigned at creation, patching...")
        patch_resp = session.patch(f"{BASE_URL}/contacts/{test_user_id}", json={
            "permission_set_ids": [test_pset_id]
        })
        
        if patch_resp.status_code != 200:
            log_test("Round-trip 3b - Assign permission set via PATCH", "FAIL", 
                    f"Status {patch_resp.status_code}: {patch_resp.text}")
            return False
        
        log_test("Round-trip 3b - Assign permission set via PATCH", "PASS", 
                f"Assigned permission set {test_pset_id} to user {test_user_id}")
    
    log_test("Round-trip 3b - Create user", "PASS", 
            f"Created user ID: {test_user_id}, email: {test_user_email}")
    
    # 3c. Verify user appears in /assignable
    print("\n--- 3c. Verify user appears in /assignable ---")
    
    resp = session.get(f"{BASE_URL}/contacts/assignable")
    
    if resp.status_code != 200:
        log_test("Round-trip 3c - GET /assignable", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    assignable_users = resp.json()
    user_in_list = any(u.get("id") == test_user_id for u in assignable_users)
    
    if not user_in_list:
        log_test("Round-trip 3c - User appears in assignable", "FAIL", 
                f"User {test_user_id} not found in assignable list")
        return False
    
    log_test("Round-trip 3c - User appears in assignable", "PASS", 
            f"User {test_user_email} found in assignable list")
    
    # 3d. Toggle flags: turn off assign_to_self, turn on assign_to_others
    print("\n--- 3d. Toggle flags (assign_to_self OFF, assign_to_others ON) ---")
    
    pset_payload["modules"]["profix"]["pages"]["ticket_detail"]["functions"]["assign_to_self"]["enabled"] = False
    pset_payload["modules"]["profix"]["pages"]["ticket_detail"]["functions"]["assign_to_others"]["enabled"] = True
    
    resp = session.put(f"{BASE_URL}/permission-sets-v3/{test_pset_id}", json=pset_payload)
    
    if resp.status_code != 200:
        log_test("Round-trip 3d - Update permission set", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    log_test("Round-trip 3d - Update permission set", "PASS", 
            "Toggled assign_to_self OFF, assign_to_others ON")
    
    # Re-fetch /assignable - user should STILL appear (OR rule)
    resp = session.get(f"{BASE_URL}/contacts/assignable")
    
    if resp.status_code != 200:
        log_test("Round-trip 3d - GET /assignable after toggle", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    assignable_users = resp.json()
    user_in_list = any(u.get("id") == test_user_id for u in assignable_users)
    
    if not user_in_list:
        log_test("Round-trip 3d - User STILL appears (OR rule)", "FAIL", 
                f"User {test_user_id} not found after toggle (should still be there due to OR rule)")
        return False
    
    log_test("Round-trip 3d - User STILL appears (OR rule)", "PASS", 
            f"User {test_user_email} still in assignable list (assign_to_others enabled)")
    
    # 3e. Turn BOTH flags off
    print("\n--- 3e. Turn BOTH flags OFF ---")
    
    pset_payload["modules"]["profix"]["pages"]["ticket_detail"]["functions"]["assign_to_self"]["enabled"] = False
    pset_payload["modules"]["profix"]["pages"]["ticket_detail"]["functions"]["assign_to_others"]["enabled"] = False
    
    resp = session.put(f"{BASE_URL}/permission-sets-v3/{test_pset_id}", json=pset_payload)
    
    if resp.status_code != 200:
        log_test("Round-trip 3e - Update permission set (both OFF)", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    log_test("Round-trip 3e - Update permission set (both OFF)", "PASS", 
            "Turned both assign_to_self and assign_to_others OFF")
    
    # Re-fetch /assignable - user should NO LONGER appear
    resp = session.get(f"{BASE_URL}/contacts/assignable")
    
    if resp.status_code != 200:
        log_test("Round-trip 3e - GET /assignable after both OFF", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    assignable_users = resp.json()
    user_in_list = any(u.get("id") == test_user_id for u in assignable_users)
    
    if user_in_list:
        log_test("Round-trip 3e - User NO LONGER appears", "FAIL", 
                f"User {test_user_id} still in list (should be removed when both flags OFF)")
        return False
    
    log_test("Round-trip 3e - User NO LONGER appears", "PASS", 
            f"User {test_user_email} correctly removed from assignable list")
    
    return True


def test_patch_assign_guardrail():
    """Test 4: PATCH /api/tickets/{id} assign guardrail"""
    global test_pset_id, test_user_id
    
    print("\n=== TEST 4: PATCH SINGLE ASSIGN GUARDRAIL ===")
    
    # Get a ticket to test with
    resp = session.get(f"{BASE_URL}/tickets?scope=all&page_size=1")
    
    if resp.status_code != 200:
        log_test("PATCH assign 4 - Get test ticket", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    tickets_data = resp.json()
    # Handle both list and dict response formats
    if isinstance(tickets_data, list):
        tickets = tickets_data
    else:
        tickets = tickets_data.get("tickets", [])
    
    if len(tickets) == 0:
        log_test("PATCH assign 4 - Get test ticket", "FAIL", "No tickets found in database")
        return False
    
    test_ticket_id = tickets[0].get("id")
    log_test("PATCH assign 4 - Get test ticket", "PASS", f"Using ticket ID: {test_ticket_id}")
    
    # Get Super Admin ID
    resp = session.get(f"{BASE_URL}/profile/me")
    if resp.status_code != 200:
        log_test("PATCH assign 4a - Get Super Admin ID", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    super_admin_id = resp.json().get("id")
    
    # 4a. Try to assign to Super Admin (ineligible)
    print("\n--- 4a. Try to assign to Super Admin (ineligible) ---")
    
    resp = session.patch(f"{BASE_URL}/tickets/{test_ticket_id}", json={
        "assigned_to": super_admin_id
    })
    
    if resp.status_code != 400:
        log_test("PATCH assign 4a - Reject ineligible Super Admin", "FAIL", 
                f"Expected 400, got {resp.status_code}: {resp.text}")
        return False
    
    error_detail = resp.json().get("detail", "")
    if "not eligible for assignment" not in error_detail.lower():
        log_test("PATCH assign 4a - Error message contains 'not eligible'", "FAIL", 
                f"Expected 'not eligible for assignment' in error, got: {error_detail}")
        return False
    
    log_test("PATCH assign 4a - Reject ineligible Super Admin", "PASS", 
            f"Correctly rejected with 400: {error_detail}")
    
    # 4b. Make test user eligible again and assign
    print("\n--- 4b. Make test user eligible and assign ---")
    
    # Turn on assign_to_others flag
    pset_payload = {
        "title": "QA Assign-Self",
        "description": "Test permission set for assign-to eligibility testing",
        "modules": {
            "profix": {
                "pages": {
                    "ticket_detail": {
                        "view": {"enabled": True, "visible": True, "scope": "team"},
                        "edit": {"enabled": True, "visible": True, "scope": "team"},
                        "functions": {
                            "assign_to_self": {"enabled": False, "visible": True},
                            "assign_to_others": {"enabled": True, "visible": True}
                        }
                    }
                }
            }
        }
    }
    
    resp = session.put(f"{BASE_URL}/permission-sets-v3/{test_pset_id}", json=pset_payload)
    
    if resp.status_code != 200:
        log_test("PATCH assign 4b - Re-enable user eligibility", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    log_test("PATCH assign 4b - Re-enable user eligibility", "PASS", 
            "Enabled assign_to_others flag")
    
    # Now assign to the eligible user
    resp = session.patch(f"{BASE_URL}/tickets/{test_ticket_id}", json={
        "assigned_to": test_user_id
    })
    
    if resp.status_code != 200:
        log_test("PATCH assign 4b - Assign to eligible user", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    ticket_data = resp.json()
    assigned_to_id = ticket_data.get("assigned_to_id")
    
    if assigned_to_id != test_user_id:
        log_test("PATCH assign 4b - Verify assigned_to_id", "FAIL", 
                f"Expected assigned_to_id={test_user_id}, got {assigned_to_id}")
        return False
    
    log_test("PATCH assign 4b - Assign to eligible user", "PASS", 
            f"Successfully assigned ticket to user {test_user_id}")
    
    # Verify activity log
    resp = session.get(f"{BASE_URL}/tickets/{test_ticket_id}/activity")
    
    if resp.status_code != 200:
        log_test("PATCH assign 4b - Get activity log", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    activity_data = resp.json()
    
    # Look for "Assigned to" activity
    assigned_activity = None
    for activity in activity_data:
        if "assigned to" in activity.get("detail", "").lower():
            assigned_activity = activity
            break
    
    if not assigned_activity:
        log_test("PATCH assign 4b - Verify activity log", "FAIL", 
                "No 'Assigned to' activity found in log")
        return False
    
    log_test("PATCH assign 4b - Verify activity log", "PASS", 
            f"Activity log contains: {assigned_activity.get('detail')}")
    
    return True


def test_bulk_assign_guardrail():
    """Test 5: POST /api/tickets/bulk-assign guardrail"""
    global test_user_id
    
    print("\n=== TEST 5: BULK ASSIGN GUARDRAIL ===")
    
    # Get a ticket to test with
    resp = session.get(f"{BASE_URL}/tickets?scope=all&page_size=1")
    
    if resp.status_code != 200:
        log_test("Bulk assign 5 - Get test ticket", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    tickets_data = resp.json()
    # Handle both list and dict response formats
    if isinstance(tickets_data, list):
        tickets = tickets_data
    else:
        tickets = tickets_data.get("tickets", [])
    
    if len(tickets) == 0:
        log_test("Bulk assign 5 - Get test ticket", "FAIL", "No tickets found in database")
        return False
    
    test_ticket_id = tickets[0].get("id")
    log_test("Bulk assign 5 - Get test ticket", "PASS", f"Using ticket ID: {test_ticket_id}")
    
    # Get Super Admin ID
    resp = session.get(f"{BASE_URL}/profile/me")
    if resp.status_code != 200:
        log_test("Bulk assign 5a - Get Super Admin ID", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    super_admin_id = resp.json().get("id")
    
    # 5a. Try bulk-assign to Super Admin (ineligible)
    print("\n--- 5a. Try bulk-assign to Super Admin (ineligible) ---")
    
    resp = session.post(f"{BASE_URL}/tickets/bulk-assign", json={
        "ticket_ids": [test_ticket_id],
        "assigned_to": super_admin_id
    })
    
    if resp.status_code != 400:
        log_test("Bulk assign 5a - Reject ineligible Super Admin", "FAIL", 
                f"Expected 400, got {resp.status_code}: {resp.text}")
        return False
    
    error_detail = resp.json().get("detail", "")
    if "not eligible for assignment" not in error_detail.lower():
        log_test("Bulk assign 5a - Error message contains 'not eligible'", "FAIL", 
                f"Expected 'not eligible for assignment' in error, got: {error_detail}")
        return False
    
    log_test("Bulk assign 5a - Reject ineligible Super Admin", "PASS", 
            f"Correctly rejected with 400: {error_detail}")
    
    # 5b. Bulk-assign to eligible user
    print("\n--- 5b. Bulk-assign to eligible user ---")
    
    resp = session.post(f"{BASE_URL}/tickets/bulk-assign", json={
        "ticket_ids": [test_ticket_id],
        "assigned_to": test_user_id
    })
    
    if resp.status_code != 200:
        log_test("Bulk assign 5b - Assign to eligible user", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    result_data = resp.json()
    assigned_count = result_data.get("assigned", 0)
    
    if assigned_count != 1:
        log_test("Bulk assign 5b - Verify assigned count", "FAIL", 
                f"Expected assigned=1, got {assigned_count}")
        return False
    
    log_test("Bulk assign 5b - Assign to eligible user", "PASS", 
            f"Successfully bulk-assigned {assigned_count} ticket(s)")
    
    return True


def test_cleanup():
    """Test 6: Cleanup - delete test permission set and user"""
    global test_pset_id, test_user_id
    
    print("\n=== TEST 6: CLEANUP ===")
    
    # Delete permission set
    if test_pset_id:
        resp = session.delete(f"{BASE_URL}/permission-sets-v3/{test_pset_id}")
        
        if resp.status_code in [200, 204]:
            log_test("Cleanup - Delete permission set", "PASS", 
                    f"Deleted permission set {test_pset_id}")
        else:
            log_test("Cleanup - Delete permission set", "FAIL", 
                    f"Status {resp.status_code}: {resp.text}")
    
    # Delete user (or set to Inactive)
    if test_user_id:
        # Try to delete first
        resp = session.delete(f"{BASE_URL}/contacts/{test_user_id}")
        
        if resp.status_code in [200, 204]:
            log_test("Cleanup - Delete user", "PASS", 
                    f"Deleted user {test_user_id}")
        else:
            # If delete not supported, set to Inactive
            resp = session.patch(f"{BASE_URL}/contacts/{test_user_id}", json={
                "status": "Inactive"
            })
            
            if resp.status_code == 200:
                log_test("Cleanup - Set user Inactive", "PASS", 
                        f"Set user {test_user_id} to Inactive")
            else:
                log_test("Cleanup - Delete/Inactivate user", "FAIL", 
                        f"Status {resp.status_code}: {resp.text}")
    
    return True


def test_regression_smoke():
    """Test 7: Regression smoke - verify basic ticket endpoints still work"""
    print("\n=== TEST 7: REGRESSION SMOKE ===")
    
    # GET /api/tickets?scope=all&page_size=5
    resp = session.get(f"{BASE_URL}/tickets?scope=all&page_size=5")
    
    if resp.status_code != 200:
        log_test("Regression - GET /api/tickets?scope=all", "FAIL", 
                f"Status {resp.status_code}: {resp.text}")
        return False
    
    tickets_data = resp.json()
    # Handle both list and dict response formats
    if isinstance(tickets_data, list):
        tickets = tickets_data
    else:
        tickets = tickets_data.get("tickets", [])
    
    log_test("Regression - GET /api/tickets?scope=all", "PASS", 
            f"Returned {len(tickets)} tickets")
    
    # GET /api/tickets/{id}
    if len(tickets) > 0:
        ticket_id = tickets[0].get("id")
        resp = session.get(f"{BASE_URL}/tickets/{ticket_id}")
        
        if resp.status_code != 200:
            log_test("Regression - GET /api/tickets/{id}", "FAIL", 
                    f"Status {resp.status_code}: {resp.text}")
            return False
        
        log_test("Regression - GET /api/tickets/{id}", "PASS", 
                f"Retrieved ticket {ticket_id}")
    
    # GET /api/tickets/export.csv?scope=all
    resp = session.get(f"{BASE_URL}/tickets/export.csv?scope=all")
    
    if resp.status_code != 200:
        log_test("Regression - GET /api/tickets/export.csv", "FAIL", 
                f"Status {resp.status_code}")
        return False
    
    log_test("Regression - GET /api/tickets/export.csv", "PASS", 
            f"CSV export successful ({len(resp.content)} bytes)")
    
    return True


def print_summary():
    """Print test summary"""
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for r in test_results if r["status"] == "PASS")
    failed = sum(1 for r in test_results if r["status"] == "FAIL")
    total = len(test_results)
    
    print(f"\nTotal Tests: {total}")
    print(f"Passed: {passed} ✅")
    print(f"Failed: {failed} ❌")
    print(f"Success Rate: {(passed/total*100):.1f}%\n")
    
    if failed > 0:
        print("FAILED TESTS:")
        for r in test_results:
            if r["status"] == "FAIL":
                print(f"  ❌ {r['scenario']}")
                if r["details"]:
                    print(f"     {r['details']}")
        print()
    
    return failed == 0


def main():
    """Main test execution"""
    print("="*80)
    print("PROFIX ASSIGN-TO ELIGIBILITY RULE - BACKEND REGRESSION TEST")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Admin: {ADMIN_EMAIL}")
    print("="*80)
    
    # Login
    if not login():
        print("\n❌ Login failed. Aborting tests.")
        sys.exit(1)
    
    # Run tests
    all_passed = True
    
    all_passed &= test_catalog()
    all_passed &= test_assignable_default_empty()
    all_passed &= test_round_trip()
    all_passed &= test_patch_assign_guardrail()
    all_passed &= test_bulk_assign_guardrail()
    all_passed &= test_cleanup()
    all_passed &= test_regression_smoke()
    
    # Print summary
    success = print_summary()
    
    if success:
        print("✅ ALL TESTS PASSED")
        sys.exit(0)
    else:
        print("❌ SOME TESTS FAILED")
        sys.exit(1)


if __name__ == "__main__":
    main()
