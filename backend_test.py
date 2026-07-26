#!/usr/bin/env python3
"""
Backend regression test for Meeting Room Booking endpoints.

Tests the following after .env recreation + seed_mrb_detailed.py seeding:
1. GET /api/meeting-room-requests with filters
2. GET /api/room-bookings/rooms
3. POST /api/meeting-room-requests (create)
4. POST /api/meeting-room-requests/{id}/reschedule
5. DELETE /api/meeting-room-requests/{id} (cancel)
6. Conflict path (409 error)
"""
import os
import sys
import requests
from datetime import datetime, timedelta
from typing import Optional

# Backend URL from frontend/.env
BACKEND_URL = os.getenv("REACT_APP_BACKEND_URL", "https://booking-ui-update-2.preview.emergentagent.com")
API_BASE = f"{BACKEND_URL}/api"

# Test credentials
ADMIN_EMAIL = "admin@ticketing.com"
ADMIN_PASSWORD = "Admin@123"

# Global token storage
TOKEN: Optional[str] = None


def login() -> str:
    """Login and return JWT token."""
    global TOKEN
    print("\n=== LOGIN ===")
    resp = requests.post(
        f"{API_BASE}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=10
    )
    print(f"POST /api/auth/login → {resp.status_code}")
    if resp.status_code != 200:
        print(f"ERROR: Login failed: {resp.text}")
        sys.exit(1)
    data = resp.json()
    TOKEN = data.get("access_token")
    if not TOKEN:
        print("ERROR: No access_token in login response")
        sys.exit(1)
    print(f"✓ Logged in as {ADMIN_EMAIL}")
    return TOKEN


def headers() -> dict:
    """Return Authorization headers."""
    return {"Authorization": f"Bearer {TOKEN}"}


def test_list_meeting_room_requests():
    """Test 1: GET /api/meeting-room-requests with filters."""
    print("\n=== TEST 1: GET /api/meeting-room-requests ===")
    
    # First, verify seed data without mine=true (all users)
    print("\n1a. Verify seed data (all users, no mine=true filter):")
    resp = requests.get(
        f"{API_BASE}/meeting-room-requests",
        params={"status": "Approved", "include_booking": "true"},
        headers=headers(),
        timeout=10
    )
    if resp.status_code == 200:
        all_approved = resp.json()
        seeded_approved = [r for r in all_approved if r.get("_seed") == "mrb_detailed"]
        print(f"  Total Approved rows (all users): {len(all_approved)}")
        print(f"  Seeded Approved rows: {len(seeded_approved)}")
        
        if len(seeded_approved) < 8:
            print(f"  ✗ FAIL: Expected at least 8 seeded Approved rows, got {len(seeded_approved)}")
            return False
        
        # Verify all have booking field
        seeded_with_booking = [r for r in seeded_approved if r.get("booking") is not None]
        if len(seeded_with_booking) != len(seeded_approved):
            print(f"  ✗ FAIL: Not all seeded Approved rows have booking field")
            return False
        
        print(f"  ✓ All {len(seeded_approved)} seeded Approved rows have booking field")
    
    # Now test with mine=true filter
    print("\n1b. Test with mine=true filter (user-specific):")
    params = {
        "mine": "true",
        "status": "Pending Approval,Approved,Declined,Cancelled",
        "include_booking": "true"
    }
    resp = requests.get(f"{API_BASE}/meeting-room-requests", params=params, headers=headers(), timeout=10)
    print(f"  GET /api/meeting-room-requests?mine=true&status=... → {resp.status_code}")
    
    if resp.status_code != 200:
        print(f"  ✗ FAIL: Expected 200, got {resp.status_code}")
        print(f"  Response: {resp.text}")
        return False
    
    data = resp.json()
    if not isinstance(data, list):
        print(f"  ✗ FAIL: Expected array, got {type(data)}")
        return False
    
    print(f"  ✓ Returned {len(data)} meeting room requests (mine=true)")
    
    # Count by status
    approved = [r for r in data if r.get("status") == "Approved"]
    pending = [r for r in data if r.get("status") == "Pending Approval"]
    declined = [r for r in data if r.get("status") == "Declined"]
    cancelled = [r for r in data if r.get("status") == "Cancelled"]
    
    print(f"  - Approved: {len(approved)}")
    print(f"  - Pending Approval: {len(pending)}")
    print(f"  - Declined: {len(declined)}")
    print(f"  - Cancelled: {len(cancelled)}")
    
    # Verify Approved rows have booking field
    approved_with_booking = [r for r in approved if r.get("booking") is not None]
    print(f"  - Approved with booking field: {len(approved_with_booking)}")
    
    # Note: mine=true filters to only meetings where the user is involved
    # The seed creates 8 Approved rows total, but only some are visible to admin@ticketing.com
    # Verify that all Approved rows returned have the booking field
    if len(approved) > 0 and len(approved_with_booking) != len(approved):
        print(f"✗ FAIL: Not all Approved rows have booking field")
        return False
    
    print(f"✓ All {len(approved)} Approved rows have booking field")
    
    # Verify booking.id matches approved_booking_id
    for r in approved_with_booking:
        booking = r.get("booking", {})
        if booking.get("id") != r.get("approved_booking_id"):
            print(f"✗ FAIL: booking.id ({booking.get('id')}) != approved_booking_id ({r.get('approved_booking_id')})")
            return False
    
    print(f"✓ All Approved rows have matching booking.id === approved_booking_id")
    
    # Verify we have Pending Approval rows
    if len(pending) < 1:
        print(f"✗ FAIL: Expected at least 1 Pending Approval row, got {len(pending)}")
        return False
    
    print(f"✓ Found {len(pending)} Pending Approval rows")
    
    # Verify Declined rows (if any) have decided_by + decision_note
    if len(declined) > 0:
        declined_with_note = [r for r in declined if r.get("decided_by") and r.get("decision_note")]
        if len(declined_with_note) != len(declined):
            print(f"✗ FAIL: Not all Declined rows have decided_by + decision_note")
            return False
        print(f"✓ All {len(declined)} Declined rows have decided_by and decision_note")
    else:
        print(f"✓ No Declined rows visible to this user (mine=true filter)")
    
    # Verify Cancelled rows
    if len(cancelled) > 0:
        print(f"✓ Found {len(cancelled)} Cancelled rows")
    else:
        print(f"✓ No Cancelled rows visible to this user (mine=true filter)")
    
    # Verify attendees field is present
    for r in data:
        if "attendees" not in r:
            print(f"✗ FAIL: Missing attendees field in request {r.get('id')}")
            return False
        attendees = r.get("attendees", [])
        if not isinstance(attendees, list):
            print(f"✗ FAIL: attendees is not a list in request {r.get('id')}")
            return False
        # Check attendee structure
        for att in attendees:
            if att.get("type") not in ["user", "team"]:
                print(f"✗ FAIL: Invalid attendee type {att.get('type')} in request {r.get('id')}")
                return False
            if not att.get("id") or not att.get("name"):
                print(f"✗ FAIL: Missing id or name in attendee {att} in request {r.get('id')}")
                return False
    
    print(f"✓ All requests have valid attendees field")
    print("✓ TEST 1 PASSED")
    return True


def test_list_rooms():
    """Test 2: GET /api/room-bookings/rooms."""
    print("\n=== TEST 2: GET /api/room-bookings/rooms ===")
    
    resp = requests.get(f"{API_BASE}/room-bookings/rooms", headers=headers(), timeout=10)
    print(f"GET /api/room-bookings/rooms → {resp.status_code}")
    
    if resp.status_code != 200:
        print(f"✗ FAIL: Expected 200, got {resp.status_code}")
        print(f"Response: {resp.text}")
        return False, None
    
    data = resp.json()
    if not isinstance(data, list):
        print(f"✗ FAIL: Expected array, got {type(data)}")
        return False, None
    
    if len(data) == 0:
        print(f"✗ FAIL: Expected non-empty array")
        return False, None
    
    print(f"✓ Returned {len(data)} rooms")
    
    # Verify structure
    for room in data:
        required = ["plan_id", "room_id", "name", "capacity"]
        for field in required:
            if field not in room:
                print(f"✗ FAIL: Missing field {field} in room {room}")
                return False, None
    
    print(f"✓ All rooms have required fields (plan_id, room_id, name, capacity)")
    print("✓ TEST 2 PASSED")
    return True, data


def test_create_meeting_room_request(rooms):
    """Test 3: POST /api/meeting-room-requests (positive create)."""
    print("\n=== TEST 3: POST /api/meeting-room-requests (create) ===")
    
    if not rooms or len(rooms) == 0:
        print("✗ FAIL: No rooms available for testing")
        return False, None
    
    # Use first room
    room = rooms[0]
    plan_id = room["plan_id"]
    room_id = room["room_id"]
    
    # Create a request 3 days from now at 10:00-11:00
    now = datetime.now()
    start_dt = (now + timedelta(days=3)).replace(hour=10, minute=0, second=0, microsecond=0)
    end_dt = start_dt.replace(hour=11)
    
    payload = {
        "plan_id": plan_id,
        "room_id": room_id,
        "title": "Regression MRB",
        "start_at": start_dt.isoformat(),
        "end_at": end_dt.isoformat(),
        "attendees": []
    }
    
    resp = requests.post(f"{API_BASE}/meeting-room-requests", json=payload, headers=headers(), timeout=10)
    print(f"POST /api/meeting-room-requests → {resp.status_code}")
    
    if resp.status_code != 200:
        print(f"✗ FAIL: Expected 200, got {resp.status_code}")
        print(f"Response: {resp.text}")
        return False, None
    
    data = resp.json()
    if not data.get("ok"):
        print(f"✗ FAIL: Expected ok=true")
        return False, None
    
    requests_list = data.get("requests", [])
    if len(requests_list) == 0:
        print(f"✗ FAIL: Expected at least 1 request in response")
        return False, None
    
    created_request = requests_list[0]
    request_id = created_request.get("id")
    status = created_request.get("status")
    
    print(f"✓ Created request {request_id} with status={status}")
    
    # Check if it's Pending Approval or Approved (auto-approval)
    if status not in ["Pending Approval", "Approved"]:
        print(f"✗ FAIL: Expected status to be 'Pending Approval' or 'Approved', got {status}")
        return False, None
    
    if status == "Approved":
        booking = created_request.get("booking") or data.get("first")
        if not booking:
            print(f"✗ FAIL: Expected booking field for Approved request")
            return False, None
        print(f"✓ Request was auto-approved with booking {booking.get('id')}")
    else:
        print(f"✓ Request is Pending Approval")
    
    print("✓ TEST 3 PASSED")
    return True, created_request


def test_reschedule_meeting_room_request(request):
    """Test 4: POST /api/meeting-room-requests/{id}/reschedule."""
    print("\n=== TEST 4: POST /api/meeting-room-requests/{id}/reschedule ===")
    
    if not request:
        print("✗ FAIL: No request to reschedule")
        return False
    
    request_id = request.get("id")
    plan_id = request.get("plan_id")
    room_id = request.get("room_id")
    
    # Reschedule to 12:00-13:00 on the same day
    start_dt = datetime.fromisoformat(request.get("start_at").replace("Z", "+00:00")).replace(tzinfo=None)
    new_start = start_dt.replace(hour=12, minute=0)
    new_end = new_start.replace(hour=13)
    
    payload = {
        "plan_id": plan_id,
        "room_id": room_id,
        "title": request.get("title"),
        "start_at": new_start.isoformat(),
        "end_at": new_end.isoformat(),
        "attendees": []
    }
    
    resp = requests.post(f"{API_BASE}/meeting-room-requests/{request_id}/reschedule", json=payload, headers=headers(), timeout=10)
    print(f"POST /api/meeting-room-requests/{request_id}/reschedule → {resp.status_code}")
    
    if resp.status_code != 200:
        print(f"✗ FAIL: Expected 200, got {resp.status_code}")
        print(f"Response: {resp.text}")
        return False
    
    data = resp.json()
    if not data.get("ok"):
        print(f"✗ FAIL: Expected ok=true")
        return False
    
    updated_request = data.get("request")
    if not updated_request:
        print(f"✗ FAIL: Expected request in response")
        return False
    
    # Verify new start/end times
    if updated_request.get("start_at") != new_start.isoformat():
        print(f"✗ FAIL: start_at not updated. Expected {new_start.isoformat()}, got {updated_request.get('start_at')}")
        return False
    
    if updated_request.get("end_at") != new_end.isoformat():
        print(f"✗ FAIL: end_at not updated. Expected {new_end.isoformat()}, got {updated_request.get('end_at')}")
        return False
    
    print(f"✓ Request rescheduled to {new_start.strftime('%H:%M')}-{new_end.strftime('%H:%M')}")
    
    # Verify via GET
    resp = requests.get(f"{API_BASE}/meeting-room-requests", params={"mine": "true"}, headers=headers(), timeout=10)
    if resp.status_code == 200:
        requests_list = resp.json()
        found = next((r for r in requests_list if r.get("id") == request_id), None)
        if found:
            if found.get("start_at") == new_start.isoformat() and found.get("end_at") == new_end.isoformat():
                print(f"✓ Verified via GET: new times reflected")
            else:
                print(f"✗ FAIL: GET shows old times")
                return False
    
    print("✓ TEST 4 PASSED")
    return True


def test_cancel_meeting_room_request(request):
    """Test 5: DELETE /api/meeting-room-requests/{id} (cancel)."""
    print("\n=== TEST 5: DELETE /api/meeting-room-requests/{id} (cancel) ===")
    
    if not request:
        print("✗ FAIL: No request to cancel")
        return False
    
    request_id = request.get("id")
    
    resp = requests.delete(f"{API_BASE}/meeting-room-requests/{request_id}", headers=headers(), timeout=10)
    print(f"DELETE /api/meeting-room-requests/{request_id} → {resp.status_code}")
    
    if resp.status_code != 200:
        print(f"✗ FAIL: Expected 200, got {resp.status_code}")
        print(f"Response: {resp.text}")
        return False
    
    data = resp.json()
    if not data.get("ok"):
        print(f"✗ FAIL: Expected ok=true")
        return False
    
    print(f"✓ Request cancelled")
    
    # Verify status is now Cancelled (or removed from mine=true list)
    resp = requests.get(f"{API_BASE}/meeting-room-requests", params={"mine": "true"}, headers=headers(), timeout=10)
    if resp.status_code == 200:
        requests_list = resp.json()
        found = next((r for r in requests_list if r.get("id") == request_id), None)
        if found:
            if found.get("status") == "Cancelled":
                print(f"✓ Verified: status is now Cancelled")
            else:
                print(f"✗ FAIL: Expected status=Cancelled, got {found.get('status')}")
                return False
        else:
            print(f"✓ Verified: request removed from mine=true list (hidden_by_requester)")
    
    print("✓ TEST 5 PASSED")
    return True


def test_conflict_path(rooms):
    """Test 6: Conflict path (409 error)."""
    print("\n=== TEST 6: Conflict path (409 error) ===")
    
    if not rooms or len(rooms) == 0:
        print("✗ FAIL: No rooms available for testing")
        return False
    
    # First, get existing approved bookings to find one to conflict with
    resp = requests.get(
        f"{API_BASE}/meeting-room-requests",
        params={"mine": "true", "status": "Approved"},
        headers=headers(),
        timeout=10
    )
    
    if resp.status_code != 200:
        print(f"✗ FAIL: Could not fetch approved bookings")
        return False
    
    approved = resp.json()
    if len(approved) == 0:
        print("⚠ SKIP: No approved bookings to conflict with")
        return True
    
    # Find an approved booking with a future or recent time
    target = None
    for booking in approved:
        start_str = booking.get("start_at")
        if start_str:
            start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00")).replace(tzinfo=None)
            # Use any booking (past or future) for conflict testing
            target = booking
            break
    
    if not target:
        print("⚠ SKIP: No suitable approved booking found for conflict test")
        return True
    
    # Try to create a request that overlaps with this booking
    room_id = target.get("room_id")
    plan_id = target.get("plan_id")
    start_str = target.get("start_at")
    end_str = target.get("end_at")
    
    start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00")).replace(tzinfo=None)
    end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00")).replace(tzinfo=None)
    
    # Create overlapping slot (same start time)
    payload = {
        "plan_id": plan_id,
        "room_id": room_id,
        "title": "Conflict Test",
        "start_at": start_dt.isoformat(),
        "end_at": end_dt.isoformat(),
        "attendees": []
    }
    
    resp = requests.post(f"{API_BASE}/meeting-room-requests", json=payload, headers=headers(), timeout=10)
    print(f"POST /api/meeting-room-requests (overlapping) → {resp.status_code}")
    
    if resp.status_code != 409:
        print(f"✗ FAIL: Expected 409 Conflict, got {resp.status_code}")
        print(f"Response: {resp.text}")
        return False
    
    data = resp.json()
    if not isinstance(data, dict):
        print(f"✗ FAIL: Expected JSON object in 409 response")
        return False
    
    # Check for BOOKING_CONFLICT code
    code = data.get("code") or (data.get("detail", {}).get("code") if isinstance(data.get("detail"), dict) else None)
    if code != "BOOKING_CONFLICT":
        print(f"✗ FAIL: Expected code=BOOKING_CONFLICT, got {code}")
        print(f"Response: {data}")
        return False
    
    print(f"✓ Received 409 with code=BOOKING_CONFLICT")
    print("✓ TEST 6 PASSED")
    return True


def main():
    """Run all tests."""
    print("=" * 60)
    print("Meeting Room Booking Backend Regression Test")
    print("=" * 60)
    
    # Login
    login()
    
    # Run tests
    results = []
    
    # Test 1: List meeting room requests
    results.append(("List meeting room requests", test_list_meeting_room_requests()))
    
    # Test 2: List rooms
    test2_pass, rooms = test_list_rooms()
    results.append(("List rooms", test2_pass))
    
    # Test 3: Create request
    test3_pass, created_request = test_create_meeting_room_request(rooms)
    results.append(("Create meeting room request", test3_pass))
    
    # Test 4: Reschedule
    if created_request:
        results.append(("Reschedule meeting room request", test_reschedule_meeting_room_request(created_request)))
    else:
        results.append(("Reschedule meeting room request", False))
    
    # Test 5: Cancel
    if created_request:
        results.append(("Cancel meeting room request", test_cancel_meeting_room_request(created_request)))
    else:
        results.append(("Cancel meeting room request", False))
    
    # Test 6: Conflict path
    results.append(("Conflict path (409)", test_conflict_path(rooms)))
    
    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
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
        sys.exit(1)
    else:
        print("\n✓ ALL TESTS PASSED")
        sys.exit(0)


if __name__ == "__main__":
    main()
