#!/usr/bin/env python3
"""
Backend regression test for Profix Edit + Reopen + Status-Lock work.
Tests the new backend behavior without touching frontend.
"""
import requests
import json
import sys
from datetime import datetime

# Environment
BASE_URL = "https://45a791e5-04ad-496c-960e-53a2e2bbd58e.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@ticketing.com"
ADMIN_PASSWORD = "Admin@123"

# Test state
session = requests.Session()
admin_token = None
test_ticket_id = None
test_pset_id = None

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def fail(msg):
    print(f"❌ FAIL: {msg}")
    sys.exit(1)

def login():
    global admin_token
    log("Logging in as Super Admin...")
    resp = session.post(f"{BASE_URL}/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    if resp.status_code != 200:
        fail(f"Login failed: {resp.status_code} {resp.text}")
    data = resp.json()
    admin_token = data.get("access_token")
    if not admin_token:
        fail("No access_token in login response")
    session.headers.update({"Authorization": f"Bearer {admin_token}"})
    log(f"✅ Logged in successfully")

def test_1_catalog_check():
    """Test 1: Catalog check - GET /api/permissions/schema/v3"""
    log("\n=== TEST 1: Catalog Check ===")
    resp = session.get(f"{BASE_URL}/permissions/schema/v3")
    if resp.status_code != 200:
        fail(f"Catalog fetch failed: {resp.status_code}")
    
    data = resp.json()
    modules = data.get("modules", [])
    
    # Find profix module
    profix = None
    for m in modules:
        if m.get("key") == "profix":
            profix = m
            break
    
    if not profix:
        fail("profix module not found in catalog")
    
    # Find ticket_detail page
    ticket_detail = None
    for page in profix.get("pages", []):
        if page.get("key") == "ticket_detail":
            ticket_detail = page
            break
    
    if not ticket_detail:
        fail("ticket_detail page not found in profix module")
    
    functions = ticket_detail.get("functions", [])
    
    # Check for reopen function
    reopen_fn = None
    edit_fn = None
    for fn in functions:
        if fn.get("key") == "reopen":
            reopen_fn = fn
        if fn.get("key") == "edit":
            edit_fn = fn
    
    if not reopen_fn:
        fail("reopen function not found in ticket_detail.functions")
    
    if not reopen_fn.get("scoped"):
        fail("reopen function should have scoped=true")
    
    log(f"✅ reopen function found with scoped={reopen_fn.get('scoped')}")
    
    # Check edit function
    if not edit_fn:
        fail("edit function not found in ticket_detail.functions")
    
    if not edit_fn.get("has_status_lock"):
        fail("edit function should have has_status_lock=true")
    
    status_lock_options = edit_fn.get("status_lock_options", [])
    if len(status_lock_options) != 3:
        fail(f"edit function should have exactly 3 status_lock_options, got {len(status_lock_options)}")
    
    values = [opt.get("value") for opt in status_lock_options]
    expected_values = {"open", "in_progress", "closed"}
    if set(values) != expected_values:
        fail(f"status_lock_options values should be {expected_values}, got {set(values)}")
    
    default = edit_fn.get("status_lock_default")
    if default != "in_progress":
        fail(f"status_lock_default should be 'in_progress', got '{default}'")
    
    log(f"✅ edit function has has_status_lock=true, 3 status_lock_options (open, in_progress, closed), default='in_progress'")
    log("✅ TEST 1 PASSED: Catalog check complete")

def test_2_field_edit_super_admin():
    """Test 2: Field edit as Super Admin (bypasses lock)"""
    global test_ticket_id
    log("\n=== TEST 2: Field Edit as Super Admin (bypasses lock) ===")
    
    # a) Create ticket
    log("Creating test ticket...")
    resp = session.post(f"{BASE_URL}/tickets", json={
        "description": "lock test",
        "priority": "Medium",
        "number_of_profiles": 1
    })
    if resp.status_code != 200:
        fail(f"Ticket creation failed: {resp.status_code} {resp.text}")
    
    ticket = resp.json()
    test_ticket_id = ticket.get("id")
    log(f"✅ Created ticket {ticket.get('ticket_id')} (id={test_ticket_id})")
    
    # b) PATCH status to Closed
    log("Closing ticket...")
    resp = session.patch(f"{BASE_URL}/tickets/{test_ticket_id}", json={
        "status": "Closed"
    })
    if resp.status_code != 200:
        fail(f"Status update failed: {resp.status_code} {resp.text}")
    log("✅ Ticket closed")
    
    # c) PATCH fields after close (Super Admin bypasses lock)
    log("Editing fields on closed ticket (Super Admin bypass)...")
    resp = session.patch(f"{BASE_URL}/tickets/{test_ticket_id}", json={
        "description": "edited after close",
        "priority": "High",
        "due_date": "2026-12-31",
        "number_of_profiles": 7
    })
    if resp.status_code != 200:
        fail(f"Field edit failed: {resp.status_code} {resp.text}")
    
    updated = resp.json()
    log("✅ Field edit succeeded (200)")
    
    # d) GET ticket and verify fields
    log("Verifying updated fields...")
    resp = session.get(f"{BASE_URL}/tickets/{test_ticket_id}")
    if resp.status_code != 200:
        fail(f"Ticket fetch failed: {resp.status_code}")
    
    ticket = resp.json()
    if ticket.get("description") != "edited after close":
        fail(f"description not updated: {ticket.get('description')}")
    if ticket.get("priority") != "High":
        fail(f"priority not updated: {ticket.get('priority')}")
    if ticket.get("due_date") != "2026-12-31":
        fail(f"due_date not updated: {ticket.get('due_date')}")
    if ticket.get("number_of_profiles") != 7:
        fail(f"number_of_profiles not updated: {ticket.get('number_of_profiles')}")
    
    log("✅ All 4 fields updated correctly")
    
    # e) GET activity and verify 4 activity rows
    log("Verifying activity log...")
    resp = session.get(f"{BASE_URL}/tickets/{test_ticket_id}/activity")
    if resp.status_code != 200:
        fail(f"Activity fetch failed: {resp.status_code}")
    
    activities = resp.json()
    # Look for the 4 field-edit activities (newest first)
    expected_details = [
        "Description updated",
        "Priority changed from",
        "Due Date changed from",
        "No. of Records changed from"
    ]
    
    found = []
    for act in activities[:10]:  # Check recent activities
        detail = act.get("detail", "")
        for exp in expected_details:
            if exp in detail and exp not in found:
                found.append(exp)
                break
    
    if len(found) != 4:
        fail(f"Expected 4 activity rows, found {len(found)}: {found}")
    
    log(f"✅ Found all 4 activity rows: {found}")
    log("✅ TEST 2 PASSED: Field edit as Super Admin (bypasses lock)")

def test_3_field_edit_validation():
    """Test 3: Field-edit validation"""
    log("\n=== TEST 3: Field-edit Validation ===")
    
    # a) number_of_profiles = 0
    log("Testing number_of_profiles = 0...")
    resp = session.patch(f"{BASE_URL}/tickets/{test_ticket_id}", json={
        "number_of_profiles": 0
    })
    if resp.status_code != 400:
        fail(f"Expected 400 for number_of_profiles=0, got {resp.status_code}")
    log("✅ number_of_profiles=0 rejected with 400")
    
    # b) number_of_profiles = -3
    log("Testing number_of_profiles = -3...")
    resp = session.patch(f"{BASE_URL}/tickets/{test_ticket_id}", json={
        "number_of_profiles": -3
    })
    if resp.status_code != 400:
        fail(f"Expected 400 for number_of_profiles=-3, got {resp.status_code}")
    log("✅ number_of_profiles=-3 rejected with 400")
    
    # c) Unchanged description (optional test - either 200 or 400 acceptable)
    log("Testing unchanged description...")
    current_desc = "edited after close"
    resp = session.patch(f"{BASE_URL}/tickets/{test_ticket_id}", json={
        "description": current_desc
    })
    if resp.status_code == 200:
        log("✅ Unchanged description returned 200 (no activity added)")
    elif resp.status_code == 400:
        log("✅ Unchanged description returned 400 (Nothing to update)")
    else:
        fail(f"Unexpected status {resp.status_code} for unchanged description")
    
    log("✅ TEST 3 PASSED: Field-edit validation")

def test_4_attachments_edit():
    """Test 4: Attachments edit"""
    log("\n=== TEST 4: Attachments Edit ===")
    
    log("Editing attachments...")
    resp = session.patch(f"{BASE_URL}/tickets/{test_ticket_id}", json={
        "attachments": [{"path": "x/y", "filename": "foo.pdf"}]
    })
    if resp.status_code != 200:
        fail(f"Attachments edit failed: {resp.status_code} {resp.text}")
    
    ticket = resp.json()
    if ticket.get("attachment_path") != "x/y":
        fail(f"attachment_path not synced: {ticket.get('attachment_path')}")
    if ticket.get("attachment_name") != "foo.pdf":
        fail(f"attachment_name not synced: {ticket.get('attachment_name')}")
    
    log("✅ attachment_path and attachment_name synced correctly")
    
    # Check activity
    resp = session.get(f"{BASE_URL}/tickets/{test_ticket_id}/activity")
    if resp.status_code != 200:
        fail(f"Activity fetch failed: {resp.status_code}")
    
    activities = resp.json()
    found = False
    for act in activities[:5]:
        if "Attachments updated (1 file(s))" in act.get("detail", ""):
            found = True
            break
    
    if not found:
        fail("Activity 'Attachments updated (1 file(s))' not found")
    
    log("✅ Activity contains 'Attachments updated (1 file(s))'")
    log("✅ TEST 4 PASSED: Attachments edit")

def test_5_permission_set_round_trip():
    """Test 5: Permission-set round-trip (max_editable_status)"""
    global test_pset_id
    log("\n=== TEST 5: Permission-set Round-trip (max_editable_status) ===")
    
    # a) Create v3 permission set
    log("Creating v3 permission set with max_editable_status='open'...")
    resp = session.post(f"{BASE_URL}/permission-sets-v3", json={
        "title": "QA MaxEditable Test",
        "description": "tmp",
        "modules": {
            "profix": {
                "pages": {
                    "ticket_detail": {
                        "view": {"enabled": True, "visible": True, "scope": "team"},
                        "edit": {"enabled": True, "visible": True, "scope": "team"},
                        "functions": {
                            "edit": {
                                "enabled": True,
                                "visible": True,
                                "scope": "team",
                                "max_editable_status": "open"
                            },
                            "reopen": {
                                "enabled": True,
                                "visible": True,
                                "scope": "team"
                            }
                        }
                    }
                }
            }
        }
    })
    if resp.status_code != 200:
        fail(f"Permission set creation failed: {resp.status_code} {resp.text}")
    
    pset = resp.json()
    test_pset_id = pset.get("id")
    log(f"✅ Created permission set {test_pset_id}")
    
    # b) GET the set back
    log("Fetching permission set...")
    resp = session.get(f"{BASE_URL}/permission-sets-v3/{test_pset_id}")
    if resp.status_code != 200:
        fail(f"Permission set fetch failed: {resp.status_code}")
    
    pset = resp.json()
    
    # c) Assert max_editable_status === "open"
    try:
        max_editable = pset["modules"]["profix"]["pages"]["ticket_detail"]["functions"]["edit"]["max_editable_status"]
    except KeyError as e:
        fail(f"max_editable_status not found in response: {e}")
    
    if max_editable != "open":
        fail(f"max_editable_status should be 'open', got '{max_editable}'")
    
    log("✅ max_editable_status='open' survived round-trip")
    
    # d) Assign to user and check /api/me/permissions (optional - skip if too heavy)
    log("⏭️  Skipping step (d) - assigning to user and checking /api/me/permissions (setup too heavy)")
    
    log("✅ TEST 5 PASSED: Permission-set round-trip")

def test_6_reopen_permission_gate():
    """Test 6: Reopen permission gate"""
    log("\n=== TEST 6: Reopen Permission Gate ===")
    
    # Create a closed ticket for reopen test
    log("Creating and closing a ticket for reopen test...")
    resp = session.post(f"{BASE_URL}/tickets", json={
        "description": "reopen test",
        "priority": "Low",
        "number_of_profiles": 1
    })
    if resp.status_code != 200:
        fail(f"Ticket creation failed: {resp.status_code}")
    
    ticket = resp.json()
    closed_id = ticket.get("id")
    
    # Close it
    resp = session.patch(f"{BASE_URL}/tickets/{closed_id}", json={
        "status": "Closed"
    })
    if resp.status_code != 200:
        fail(f"Status update failed: {resp.status_code}")
    
    log(f"✅ Created and closed ticket {ticket.get('ticket_id')}")
    
    # As Super Admin: reopen should work
    log("Testing reopen as Super Admin...")
    resp = session.post(f"{BASE_URL}/tickets/{closed_id}/reopen", json={
        "reason": "Testing reopen as Super Admin"
    })
    if resp.status_code != 200:
        fail(f"Reopen as Super Admin failed: {resp.status_code} {resp.text}")
    
    log("✅ Reopen as Super Admin succeeded (200)")
    
    # Skip second-user path as per review request
    log("⏭️  Skipping second-user reopen test (setup too heavy)")
    
    log("✅ TEST 6 PASSED: Reopen permission gate")

def test_7_regression_smoke():
    """Test 7: Regression smoke tests"""
    log("\n=== TEST 7: Regression Smoke Tests ===")
    
    # GET /api/tickets?scope=all&page=1&page_size=5
    log("Testing GET /api/tickets (paged)...")
    resp = session.get(f"{BASE_URL}/tickets", params={
        "scope": "all",
        "page": 1,
        "page_size": 5
    })
    if resp.status_code != 200:
        fail(f"GET /api/tickets failed: {resp.status_code}")
    log("✅ GET /api/tickets (paged) - 200")
    
    # GET /api/tickets/{id}
    log("Testing GET /api/tickets/{id}...")
    resp = session.get(f"{BASE_URL}/tickets/{test_ticket_id}")
    if resp.status_code != 200:
        fail(f"GET /api/tickets/{{id}} failed: {resp.status_code}")
    log("✅ GET /api/tickets/{id} - 200")
    
    # PATCH status change
    log("Testing PATCH status change...")
    resp = session.patch(f"{BASE_URL}/tickets/{test_ticket_id}", json={
        "status": "Open"
    })
    if resp.status_code != 200:
        fail(f"PATCH status failed: {resp.status_code}")
    log("✅ PATCH status change - 200")
    
    # POST bulk-status
    log("Testing POST /api/tickets/bulk-status...")
    resp = session.post(f"{BASE_URL}/tickets/bulk-status", json={
        "ticket_ids": [test_ticket_id],
        "status": "In Progress"
    })
    if resp.status_code != 200:
        fail(f"POST bulk-status failed: {resp.status_code}")
    log("✅ POST /api/tickets/bulk-status - 200")
    
    # POST bulk-assign (get admin user ID first)
    log("Testing POST /api/tickets/bulk-assign...")
    # Get admin user ID
    me_resp = session.get(f"{BASE_URL}/profile/me")
    if me_resp.status_code != 200:
        fail(f"GET /api/profile/me failed: {me_resp.status_code}")
    admin_id = me_resp.json().get("id")
    
    resp = session.post(f"{BASE_URL}/tickets/bulk-assign", json={
        "ticket_ids": [test_ticket_id],
        "assigned_to": admin_id
    })
    if resp.status_code != 200:
        fail(f"POST bulk-assign failed: {resp.status_code}")
    log("✅ POST /api/tickets/bulk-assign - 200")
    
    # GET /api/tickets/export.csv
    log("Testing GET /api/tickets/export.csv...")
    resp = session.get(f"{BASE_URL}/tickets/export.csv", params={
        "scope": "all"
    })
    if resp.status_code != 200:
        fail(f"GET /api/tickets/export.csv failed: {resp.status_code}")
    log("✅ GET /api/tickets/export.csv - 200")
    
    log("✅ TEST 7 PASSED: Regression smoke tests")

def main():
    try:
        login()
        test_1_catalog_check()
        test_2_field_edit_super_admin()
        test_3_field_edit_validation()
        test_4_attachments_edit()
        test_5_permission_set_round_trip()
        test_6_reopen_permission_gate()
        test_7_regression_smoke()
        
        log("\n" + "="*60)
        log("✅ ALL TESTS PASSED (7/7)")
        log("="*60)
        
    except Exception as e:
        log(f"\n❌ UNEXPECTED ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
