#!/usr/bin/env python3
"""
Backend verification test for Notification Templates bug fix.

Tests that test notifications from /api/notification-templates route to REAL
destination pages (not back to /admin/notification-templates).

Test sequence:
1. POST /api/auth/login → get access_token
2. POST /api/notification-templates/send-test-all → expect 200, {ok: true, count: 8, notifications: [8 items]}
3. GET /api/notifications/inapp → verify 8 test rows with correct action_urls
4. Dedup check - send-test-all again, verify still only 8 rows (not 16)
5. Per-template test - pick one template, send individual test
6. Auth check - send-test-all without Authorization should return 401/403
"""
import os
import sys
import requests
from typing import Optional

# Backend URL from frontend/.env
BACKEND_URL = "https://profix-qa-run.preview.emergentagent.com"
API_BASE = f"{BACKEND_URL}/api"

# Test credentials
ADMIN_EMAIL = "admin@ticketing.com"
ADMIN_PASSWORD = "Admin@123"

# Global token storage
TOKEN: Optional[str] = None

# Expected action_url mapping per kind
EXPECTED_ACTION_URLS = {
    "workstation_request_submitted": "/workspace-manager/pending-approvals",
    "workstation_request_approved": "/workspace-manager/bookings",
    "workstation_request_declined": "/workspace-manager/request-workstation",
    "workstation_assigned": "/workspace-manager/bookings",
    "meeting_room_request_submitted": "/workspace-manager/pending-approvals",
    "meeting_room_request_approved": "/workspace-manager/meeting-room-booking",
    "meeting_room_request_declined": "/workspace-manager/meeting-room-booking",
    "request_closed": "/admin/open-requests"
}


def login() -> str:
    """Step 1: Login and return JWT token."""
    global TOKEN
    print("\n" + "=" * 80)
    print("STEP 1: LOGIN")
    print("=" * 80)
    
    resp = requests.post(
        f"{API_BASE}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=10
    )
    print(f"POST /api/auth/login → {resp.status_code}")
    
    if resp.status_code != 200:
        print(f"✗ FAIL: Login failed with status {resp.status_code}")
        print(f"Response: {resp.text}")
        sys.exit(1)
    
    data = resp.json()
    TOKEN = data.get("access_token")
    
    if not TOKEN:
        print("✗ FAIL: No access_token in login response")
        sys.exit(1)
    
    print(f"✓ PASS: Logged in as {ADMIN_EMAIL}")
    print(f"✓ Access token received: {TOKEN[:20]}...")
    return TOKEN


def headers() -> dict:
    """Return Authorization headers."""
    return {"Authorization": f"Bearer {TOKEN}"}


def test_send_test_all():
    """Step 2: POST /api/notification-templates/send-test-all."""
    print("\n" + "=" * 80)
    print("STEP 2: POST /api/notification-templates/send-test-all")
    print("=" * 80)
    
    resp = requests.post(
        f"{API_BASE}/notification-templates/send-test-all",
        headers=headers(),
        timeout=10
    )
    print(f"POST /api/notification-templates/send-test-all → {resp.status_code}")
    
    if resp.status_code != 200:
        print(f"✗ FAIL: Expected 200, got {resp.status_code}")
        print(f"Response: {resp.text}")
        return False
    
    data = resp.json()
    
    # Verify response structure
    if not data.get("ok"):
        print(f"✗ FAIL: Expected ok=true, got {data.get('ok')}")
        return False
    
    count = data.get("count")
    notifications = data.get("notifications", [])
    
    print(f"✓ Response: ok={data.get('ok')}, count={count}")
    print(f"✓ Notifications array length: {len(notifications)}")
    
    if count != 8:
        print(f"✗ FAIL: Expected count=8, got {count}")
        return False
    
    if len(notifications) != 8:
        print(f"✗ FAIL: Expected 8 notifications in array, got {len(notifications)}")
        return False
    
    print(f"✓ PASS: Received 8 test notifications")
    return True


def test_verify_action_urls():
    """Step 3: GET /api/notifications/inapp and verify action_urls."""
    print("\n" + "=" * 80)
    print("STEP 3: GET /api/notifications/inapp - Verify action_urls")
    print("=" * 80)
    
    resp = requests.get(
        f"{API_BASE}/notifications/inapp",
        headers=headers(),
        timeout=10
    )
    print(f"GET /api/notifications/inapp → {resp.status_code}")
    
    if resp.status_code != 200:
        print(f"✗ FAIL: Expected 200, got {resp.status_code}")
        print(f"Response: {resp.text}")
        return False
    
    data = resp.json()
    
    # Filter for test notifications
    test_notifications = [n for n in data if n.get("related_type") == "notification_template_test"]
    
    print(f"✓ Total notifications: {len(data)}")
    print(f"✓ Test notifications (related_type='notification_template_test'): {len(test_notifications)}")
    
    if len(test_notifications) != 8:
        print(f"✗ FAIL: Expected EXACTLY 8 test notifications, got {len(test_notifications)}")
        return False
    
    print(f"✓ PASS: Found exactly 8 test notifications")
    
    # Verify each kind has correct action_url
    print("\n" + "-" * 80)
    print("Verifying action_urls for each kind:")
    print("-" * 80)
    
    all_pass = True
    kinds_found = set()
    
    for notif in test_notifications:
        kind = notif.get("kind")
        action_url = notif.get("action_url")
        title = notif.get("title", "")
        body = notif.get("body", "")
        
        kinds_found.add(kind)
        
        expected_url = EXPECTED_ACTION_URLS.get(kind)
        
        if expected_url is None:
            print(f"⚠ WARNING: Unknown kind '{kind}' - no expected URL defined")
            continue
        
        # Check action_url matches expected
        if action_url != expected_url:
            print(f"✗ FAIL: {kind}")
            print(f"  Expected: {expected_url}")
            print(f"  Got:      {action_url}")
            all_pass = False
        else:
            print(f"✓ PASS: {kind} → {action_url}")
        
        # Check action_url does NOT start with /admin/notification-templates
        if action_url and action_url.startswith("/admin/notification-templates"):
            print(f"✗ FAIL: {kind} action_url still points to notification-templates page!")
            all_pass = False
        
        # Check placeholders are resolved (no literal '{name}' etc.)
        if "{name}" in title or "{name}" in body:
            print(f"✗ FAIL: {kind} has unresolved {{name}} placeholder")
            all_pass = False
        
        # For workstation_request_submitted, verify specific placeholders
        if kind == "workstation_request_submitted":
            if "Aarushi Bhatia" not in body:
                print(f"✗ FAIL: {kind} body missing 'Aarushi Bhatia'")
                all_pass = False
            if "A-101" not in body:
                print(f"✗ FAIL: {kind} body missing 'A-101'")
                all_pass = False
            if "20 Aug 2026" not in body:
                print(f"✗ FAIL: {kind} body missing '20 Aug 2026'")
                all_pass = False
    
    # Verify all 8 kinds are present
    expected_kinds = set(EXPECTED_ACTION_URLS.keys())
    if kinds_found != expected_kinds:
        print(f"\n✗ FAIL: Missing kinds: {expected_kinds - kinds_found}")
        all_pass = False
    
    if all_pass:
        print("\n✓ PASS: All action_urls are correct and placeholders are resolved")
    
    return all_pass


def test_dedup_check():
    """Step 4: Dedup check - send-test-all again, verify still only 8 rows."""
    print("\n" + "=" * 80)
    print("STEP 4: DEDUP CHECK - Send test-all again")
    print("=" * 80)
    
    # Send test-all again
    resp = requests.post(
        f"{API_BASE}/notification-templates/send-test-all",
        headers=headers(),
        timeout=10
    )
    print(f"POST /api/notification-templates/send-test-all (2nd time) → {resp.status_code}")
    
    if resp.status_code != 200:
        print(f"✗ FAIL: Expected 200, got {resp.status_code}")
        return False
    
    data = resp.json()
    print(f"✓ Response: ok={data.get('ok')}, count={data.get('count')}")
    
    # Now check GET /api/notifications/inapp
    resp = requests.get(
        f"{API_BASE}/notifications/inapp",
        headers=headers(),
        timeout=10
    )
    print(f"GET /api/notifications/inapp → {resp.status_code}")
    
    if resp.status_code != 200:
        print(f"✗ FAIL: Expected 200, got {resp.status_code}")
        return False
    
    data = resp.json()
    test_notifications = [n for n in data if n.get("related_type") == "notification_template_test"]
    
    print(f"✓ Test notifications count: {len(test_notifications)}")
    
    if len(test_notifications) != 8:
        print(f"✗ FAIL: Expected EXACTLY 8 test notifications (not 16), got {len(test_notifications)}")
        print(f"  Prior test rows should be wiped before creation")
        return False
    
    print(f"✓ PASS: Dedup working - still exactly 8 test notifications (not 16)")
    return True


def test_per_template():
    """Step 5: Per-template test - pick one template and send individual test."""
    print("\n" + "=" * 80)
    print("STEP 5: PER-TEMPLATE TEST - Send individual template test")
    print("=" * 80)
    
    # First, get list of templates
    resp = requests.get(
        f"{API_BASE}/notification-templates",
        headers=headers(),
        timeout=10
    )
    print(f"GET /api/notification-templates → {resp.status_code}")
    
    if resp.status_code != 200:
        print(f"✗ FAIL: Could not fetch templates")
        return False
    
    templates = resp.json()
    
    if not templates or len(templates) == 0:
        print(f"✗ FAIL: No templates found")
        return False
    
    # Pick first template
    template = templates[0]
    template_id = template.get("id")
    template_kind = template.get("kind")
    
    print(f"✓ Picked template: id={template_id}, kind={template_kind}")
    
    # Send individual test
    resp = requests.post(
        f"{API_BASE}/notification-templates/{template_id}/send-test",
        headers=headers(),
        timeout=10
    )
    print(f"POST /api/notification-templates/{template_id}/send-test → {resp.status_code}")
    
    if resp.status_code != 200:
        print(f"✗ FAIL: Expected 200, got {resp.status_code}")
        print(f"Response: {resp.text}")
        return False
    
    data = resp.json()
    
    if not data.get("ok"):
        print(f"✗ FAIL: Expected ok=true")
        return False
    
    notification = data.get("notification")
    if not notification:
        print(f"✗ FAIL: Expected notification object in response")
        return False
    
    print(f"✓ Response: ok=true, notification.id={notification.get('id')}")
    
    # Verify the new row appears in GET /api/notifications/inapp
    resp = requests.get(
        f"{API_BASE}/notifications/inapp",
        headers=headers(),
        timeout=10
    )
    
    if resp.status_code != 200:
        print(f"✗ FAIL: Could not fetch notifications")
        return False
    
    data = resp.json()
    test_notifications = [n for n in data if n.get("related_type") == "notification_template_test"]
    
    # Find the notification for this kind
    kind_notifications = [n for n in test_notifications if n.get("kind") == template_kind]
    
    if len(kind_notifications) == 0:
        print(f"✗ FAIL: No test notification found for kind={template_kind}")
        return False
    
    # Get the newest one (should be the one we just created)
    newest = max(kind_notifications, key=lambda n: n.get("created_at", ""))
    action_url = newest.get("action_url")
    expected_url = EXPECTED_ACTION_URLS.get(template_kind)
    
    print(f"✓ Found test notification for kind={template_kind}")
    print(f"  action_url: {action_url}")
    print(f"  expected:   {expected_url}")
    
    if action_url != expected_url:
        print(f"✗ FAIL: action_url does not match expected")
        return False
    
    print(f"✓ PASS: Per-template test notification has correct action_url")
    return True


def test_auth_check():
    """Step 6: Auth check - send-test-all without Authorization should return 401/403."""
    print("\n" + "=" * 80)
    print("STEP 6: AUTH CHECK - Send test-all without Authorization")
    print("=" * 80)
    
    resp = requests.post(
        f"{API_BASE}/notification-templates/send-test-all",
        timeout=10
    )
    print(f"POST /api/notification-templates/send-test-all (no auth) → {resp.status_code}")
    
    if resp.status_code not in [401, 403]:
        print(f"✗ FAIL: Expected 401 or 403, got {resp.status_code}")
        print(f"Response: {resp.text}")
        return False
    
    print(f"✓ PASS: Correctly returned {resp.status_code} (unauthorized)")
    return True


def main():
    """Run all tests."""
    print("=" * 80)
    print("NOTIFICATION TEMPLATES BACKEND VERIFICATION TEST")
    print("Bug fix: Test notifications must route to REAL destination pages")
    print("=" * 80)
    
    # Step 1: Login
    login()
    
    # Run tests
    results = []
    
    # Step 2: Send test-all
    results.append(("Step 2: POST send-test-all", test_send_test_all()))
    
    # Step 3: Verify action_urls
    results.append(("Step 3: Verify action_urls", test_verify_action_urls()))
    
    # Step 4: Dedup check
    results.append(("Step 4: Dedup check", test_dedup_check()))
    
    # Step 5: Per-template test
    results.append(("Step 5: Per-template test", test_per_template()))
    
    # Step 6: Auth check
    results.append(("Step 6: Auth check", test_auth_check()))
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    passed = 0
    failed = 0
    
    for name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status}: {name}")
        if result:
            passed += 1
        else:
            failed += 1
    
    print(f"\nTotal: {passed} passed, {failed} failed")
    
    if failed > 0:
        print("\n✗ SOME TESTS FAILED")
        sys.exit(1)
    else:
        print("\n✓ ALL TESTS PASSED")
        sys.exit(0)


if __name__ == "__main__":
    main()
