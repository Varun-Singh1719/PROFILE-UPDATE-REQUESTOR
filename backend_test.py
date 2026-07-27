#!/usr/bin/env python3
"""
Backend test for Ticket Reopen Flow (Jul 27 2026)
Tests ONLY the newly added POST /api/tickets/{id}/reopen endpoint
"""
import requests
import json
import sys
from datetime import datetime

# Backend URL from frontend/.env
BASE_URL = "https://45a791e5-04ad-496c-960e-53a2e2bbd58e.preview.emergentagent.com/api"

# Test credentials
ADMIN_EMAIL = "admin@ticketing.com"
ADMIN_PASSWORD = "Admin@123"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    END = '\033[0m'

def log(msg, color=None):
    if color:
        print(f"{color}{msg}{Colors.END}")
    else:
        print(msg)

def login(email, password):
    """Login and return access token"""
    resp = requests.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password})
    if resp.status_code != 200:
        log(f"❌ Login failed: {resp.status_code} {resp.text}", Colors.RED)
        return None
    data = resp.json()
    return data.get("access_token")

def create_ticket(token, description="Test ticket for reopen flow", priority="Medium", number_of_profiles=5):
    """Create a new ticket"""
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "description": description,
        "priority": priority,
        "number_of_profiles": number_of_profiles
    }
    resp = requests.post(f"{BASE_URL}/tickets", json=payload, headers=headers)
    if resp.status_code != 200:
        log(f"❌ Create ticket failed: {resp.status_code} {resp.text}", Colors.RED)
        return None
    return resp.json()

def close_ticket(token, ticket_id):
    """Close a ticket by updating status to Closed"""
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"status": "Closed"}
    resp = requests.patch(f"{BASE_URL}/tickets/{ticket_id}", json=payload, headers=headers)
    if resp.status_code != 200:
        log(f"❌ Close ticket failed: {resp.status_code} {resp.text}", Colors.RED)
        return None
    return resp.json()

def reopen_ticket(token, ticket_id, reason):
    """Reopen a closed ticket"""
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"reason": reason}
    resp = requests.post(f"{BASE_URL}/tickets/{ticket_id}/reopen", json=payload, headers=headers)
    return resp

def get_activity(token, ticket_id):
    """Get activity log for a ticket"""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/tickets/{ticket_id}/activity", headers=headers)
    if resp.status_code != 200:
        log(f"❌ Get activity failed: {resp.status_code} {resp.text}", Colors.RED)
        return None
    return resp.json()

def run_tests():
    """Run all reopen endpoint tests"""
    log("\n" + "="*80, Colors.BLUE)
    log("TICKET REOPEN FLOW - BACKEND TESTING", Colors.BLUE)
    log("="*80 + "\n", Colors.BLUE)
    
    # Login as admin
    log("🔐 Logging in as admin...", Colors.YELLOW)
    token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not token:
        log("❌ FATAL: Cannot proceed without authentication", Colors.RED)
        return False
    log("✅ Login successful\n", Colors.GREEN)
    
    all_passed = True
    test_results = []
    
    # ========================================================================
    # SCENARIO 1: Setup - Create ticket and close it
    # ========================================================================
    log("📋 SCENARIO 1: Setup - Create and close a ticket", Colors.YELLOW)
    ticket = create_ticket(token, "Issue re-appeared after redeploy", "Medium", 5)
    if not ticket:
        log("❌ FAIL: Could not create ticket", Colors.RED)
        return False
    
    ticket_id = ticket["id"]
    log(f"✅ Created ticket: {ticket.get('ticket_id')} (UUID: {ticket_id})", Colors.GREEN)
    
    closed = close_ticket(token, ticket_id)
    if not closed or closed.get("status") != "Closed":
        log("❌ FAIL: Could not close ticket", Colors.RED)
        return False
    log(f"✅ Closed ticket: {ticket.get('ticket_id')}\n", Colors.GREEN)
    
    # ========================================================================
    # SCENARIO 2: Happy Path - Reopen with valid reason
    # ========================================================================
    log("📋 SCENARIO 2: Happy Path - Reopen with valid reason", Colors.YELLOW)
    reason = "Issue re-appeared after redeploy"
    resp = reopen_ticket(token, ticket_id, reason)
    
    if resp.status_code != 200:
        log(f"❌ FAIL: Expected 200, got {resp.status_code}", Colors.RED)
        log(f"   Response: {resp.text}", Colors.RED)
        test_results.append(("Happy Path Reopen", False))
        all_passed = False
    else:
        data = resp.json()
        checks = []
        
        # Check status
        if data.get("status") == "Open":
            checks.append("✅ status = Open")
        else:
            checks.append(f"❌ status = {data.get('status')} (expected Open)")
            all_passed = False
        
        # Check reopen_count
        if data.get("reopen_count") == 1:
            checks.append("✅ reopen_count = 1")
        else:
            checks.append(f"❌ reopen_count = {data.get('reopen_count')} (expected 1)")
            all_passed = False
        
        # Check reopen_reason
        if data.get("reopen_reason") == reason:
            checks.append("✅ reopen_reason matches")
        else:
            checks.append(f"❌ reopen_reason = {data.get('reopen_reason')} (expected '{reason}')")
            all_passed = False
        
        # Check reopened_by_id
        if data.get("reopened_by_id"):
            checks.append(f"✅ reopened_by_id = {data.get('reopened_by_id')}")
        else:
            checks.append("❌ reopened_by_id is missing")
            all_passed = False
        
        # Check reopened_by_name
        if data.get("reopened_by_name") == "Admin User":
            checks.append("✅ reopened_by_name = Admin User")
        else:
            checks.append(f"❌ reopened_by_name = {data.get('reopened_by_name')} (expected 'Admin User')")
            all_passed = False
        
        # Check reopened_on
        if data.get("reopened_on"):
            checks.append(f"✅ reopened_on = {data.get('reopened_on')}")
        else:
            checks.append("❌ reopened_on is missing")
            all_passed = False
        
        # Check updated_on
        if data.get("updated_on"):
            checks.append(f"✅ updated_on = {data.get('updated_on')}")
        else:
            checks.append("❌ updated_on is missing")
            all_passed = False
        
        for check in checks:
            log(f"   {check}")
        
        test_results.append(("Happy Path Reopen", all(c.startswith("✅") for c in checks)))
    
    log("")
    
    # ========================================================================
    # SCENARIO 3: Activity Log - Verify reopened action
    # ========================================================================
    log("📋 SCENARIO 3: Activity Log - Verify reopened action", Colors.YELLOW)
    activity = get_activity(token, ticket_id)
    if not activity:
        log("❌ FAIL: Could not fetch activity log", Colors.RED)
        test_results.append(("Activity Log", False))
        all_passed = False
    else:
        # First row should be the reopened action (sorted by 'at' desc)
        if len(activity) > 0:
            first = activity[0]
            if first.get("action") == "reopened":
                log(f"   ✅ First activity action = 'reopened'", Colors.GREEN)
                if reason in first.get("detail", ""):
                    log(f"   ✅ Activity detail contains reason: '{first.get('detail')}'", Colors.GREEN)
                    test_results.append(("Activity Log", True))
                else:
                    log(f"   ❌ Activity detail missing reason: '{first.get('detail')}'", Colors.RED)
                    test_results.append(("Activity Log", False))
                    all_passed = False
            else:
                log(f"   ❌ First activity action = '{first.get('action')}' (expected 'reopened')", Colors.RED)
                test_results.append(("Activity Log", False))
                all_passed = False
        else:
            log("   ❌ Activity log is empty", Colors.RED)
            test_results.append(("Activity Log", False))
            all_passed = False
    
    log("")
    
    # ========================================================================
    # SCENARIO 4: Guard - Already Open (Idempotency)
    # ========================================================================
    log("📋 SCENARIO 4: Guard - Attempt reopen on already Open ticket", Colors.YELLOW)
    resp = reopen_ticket(token, ticket_id, "Another reason")
    
    if resp.status_code == 400:
        detail = resp.json().get("detail", "")
        if "Only Closed requests can be reopened" in detail:
            log(f"   ✅ Got 400 with correct message: '{detail}'", Colors.GREEN)
            test_results.append(("Guard - Already Open", True))
        else:
            log(f"   ❌ Got 400 but wrong message: '{detail}'", Colors.RED)
            test_results.append(("Guard - Already Open", False))
            all_passed = False
    else:
        log(f"   ❌ Expected 400, got {resp.status_code}", Colors.RED)
        test_results.append(("Guard - Already Open", False))
        all_passed = False
    
    log("")
    
    # ========================================================================
    # SCENARIO 5: Reason Validation
    # ========================================================================
    log("📋 SCENARIO 5: Reason Validation", Colors.YELLOW)
    
    # Close the ticket again for validation tests
    closed = close_ticket(token, ticket_id)
    if not closed or closed.get("status") != "Closed":
        log("   ❌ Could not close ticket for validation tests", Colors.RED)
        return False
    log("   ✅ Ticket closed again for validation tests", Colors.GREEN)
    
    validation_tests = [
        ("a) Empty reason", "", 400),
        ("b) 3 chars", "abc", 400),
        ("c) 501 chars", "a" * 501, 400),
        ("d) Whitespace only (trims to 2)", "   ok ", 400),
        ("e) Valid reason (5+ chars)", "Valid reason five+ chars", 200),
    ]
    
    for test_name, test_reason, expected_status in validation_tests:
        resp = reopen_ticket(token, ticket_id, test_reason)
        if resp.status_code == expected_status:
            log(f"   ✅ {test_name}: Got {expected_status} as expected", Colors.GREEN)
            test_results.append((f"Validation {test_name}", True))
        else:
            log(f"   ❌ {test_name}: Expected {expected_status}, got {resp.status_code}", Colors.RED)
            log(f"      Response: {resp.text}", Colors.RED)
            test_results.append((f"Validation {test_name}", False))
            all_passed = False
        
        # If the valid reason test passed, close the ticket again for next test
        if test_name == "e) Valid reason (5+ chars)" and resp.status_code == 200:
            # Don't close again, we'll use this for reopen count test
            pass
    
    log("")
    
    # ========================================================================
    # SCENARIO 6: Not Found
    # ========================================================================
    log("📋 SCENARIO 6: Not Found - Random UUID", Colors.YELLOW)
    random_uuid = "deadbeef-dead-dead-dead-deadbeefdead"
    resp = reopen_ticket(token, random_uuid, "Valid reason")
    
    if resp.status_code == 404:
        log(f"   ✅ Got 404 for non-existent ticket", Colors.GREEN)
        test_results.append(("Not Found", True))
    else:
        log(f"   ❌ Expected 404, got {resp.status_code}", Colors.RED)
        test_results.append(("Not Found", False))
        all_passed = False
    
    log("")
    
    # ========================================================================
    # SCENARIO 7: Reopen Count Increments
    # ========================================================================
    log("📋 SCENARIO 7: Reopen Count - Verify increment to 3", Colors.YELLOW)
    log("   ℹ️  After scenario 2 (count=1) and scenario 5e (count=2), this is the 3rd reopen", Colors.BLUE)
    
    # Close the ticket again
    closed = close_ticket(token, ticket_id)
    if not closed or closed.get("status") != "Closed":
        log("   ❌ Could not close ticket for reopen count test", Colors.RED)
        test_results.append(("Reopen Count", False))
        all_passed = False
    else:
        # Reopen again (3rd time overall)
        resp = reopen_ticket(token, ticket_id, "Third reopen for count test")
        if resp.status_code == 200:
            data = resp.json()
            if data.get("reopen_count") == 3:
                log(f"   ✅ reopen_count = 3 (correctly incremented from 2)", Colors.GREEN)
                test_results.append(("Reopen Count", True))
            else:
                log(f"   ❌ reopen_count = {data.get('reopen_count')} (expected 3)", Colors.RED)
                test_results.append(("Reopen Count", False))
                all_passed = False
        else:
            log(f"   ❌ Reopen failed with {resp.status_code}", Colors.RED)
            test_results.append(("Reopen Count", False))
            all_passed = False
    
    log("")
    
    # ========================================================================
    # SCENARIO 8: Access Control (Best Effort)
    # ========================================================================
    log("📋 SCENARIO 8: Access Control - Skipped (requires additional user setup)", Colors.YELLOW)
    log("   ℹ️  This test requires creating a second user with different role/id", Colors.BLUE)
    log("   ℹ️  Skipping as per review request instructions", Colors.BLUE)
    test_results.append(("Access Control", "SKIPPED"))
    
    log("")
    
    # ========================================================================
    # SUMMARY
    # ========================================================================
    log("="*80, Colors.BLUE)
    log("TEST SUMMARY", Colors.BLUE)
    log("="*80, Colors.BLUE)
    
    passed = sum(1 for _, result in test_results if result is True)
    failed = sum(1 for _, result in test_results if result is False)
    skipped = sum(1 for _, result in test_results if result == "SKIPPED")
    total = len(test_results)
    
    for test_name, result in test_results:
        if result is True:
            log(f"✅ PASS: {test_name}", Colors.GREEN)
        elif result is False:
            log(f"❌ FAIL: {test_name}", Colors.RED)
        else:
            log(f"⏭️  SKIP: {test_name}", Colors.YELLOW)
    
    log("")
    log(f"Total: {total} | Passed: {passed} | Failed: {failed} | Skipped: {skipped}", Colors.BLUE)
    
    if all_passed and failed == 0:
        log("\n🎉 ALL TESTS PASSED!", Colors.GREEN)
        return True
    else:
        log(f"\n❌ {failed} TEST(S) FAILED", Colors.RED)
        return False

if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
