#!/usr/bin/env python3
"""
Backend test for Bookings module bug fix verification.
Tests that workstation bookings route to /api/workstation-bookings/:id
and meeting room bookings route to /api/room-bookings/:id
"""

import requests
import json
import sys
from typing import Dict, Any, Optional
import uuid

# Backend URL from frontend/.env
BASE_URL = "https://manage-ui-update.preview.emergentagent.com/api"

# Test credentials
ADMIN_EMAIL = "admin@ticketing.com"
ADMIN_PASSWORD = "Admin@123"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'
    BOLD = '\033[1m'

def log_test(message: str):
    print(f"\n{Colors.BLUE}{'='*80}{Colors.RESET}")
    print(f"{Colors.BOLD}{message}{Colors.RESET}")
    print(f"{Colors.BLUE}{'='*80}{Colors.RESET}")

def log_success(message: str):
    print(f"{Colors.GREEN}✓ {message}{Colors.RESET}")

def log_error(message: str):
    print(f"{Colors.RED}✗ {message}{Colors.RESET}")

def log_info(message: str):
    print(f"{Colors.YELLOW}ℹ {message}{Colors.RESET}")

def login() -> Optional[str]:
    """Login and return access token"""
    log_test("TEST 1: Login as admin@ticketing.com")
    
    url = f"{BASE_URL}/auth/login"
    payload = {
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    }
    
    try:
        response = requests.post(url, json=payload)
        log_info(f"POST {url}")
        log_info(f"Request: {json.dumps(payload, indent=2)}")
        log_info(f"Status: {response.status_code}")
        log_info(f"Response: {response.text[:500]}")
        
        if response.status_code == 200:
            data = response.json()
            token = data.get("access_token")
            if token:
                log_success(f"Login successful, token obtained")
                return token
            else:
                log_error("No access_token in response")
                return None
        else:
            log_error(f"Login failed with status {response.status_code}")
            return None
    except Exception as e:
        log_error(f"Login exception: {str(e)}")
        return None

def get_bookings(token: str) -> Optional[Dict[str, Any]]:
    """Get all bookings and verify type field exists"""
    log_test("TEST 2: GET /api/bookings - Verify type field exists")
    
    url = f"{BASE_URL}/bookings"
    headers = {"Authorization": f"Bearer {token}"}
    
    try:
        response = requests.get(url, headers=headers)
        log_info(f"GET {url}")
        log_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            bookings = data.get("bookings", [])
            log_info(f"Total bookings: {len(bookings)}")
            
            # Check for type field
            workstation_count = 0
            meeting_room_count = 0
            
            for booking in bookings:
                if "type" not in booking:
                    log_error(f"Booking {booking.get('id')} missing 'type' field")
                    return None
                
                if booking["type"] == "Workstation":
                    workstation_count += 1
                elif booking["type"] == "Meeting Room":
                    meeting_room_count += 1
            
            log_success(f"All bookings have 'type' field")
            log_info(f"Workstation bookings: {workstation_count}")
            log_info(f"Meeting Room bookings: {meeting_room_count}")
            
            if workstation_count == 0:
                log_error("No workstation bookings found - cannot test workstation cancel")
                return None
            
            if meeting_room_count == 0:
                log_info("No meeting room bookings found - will skip meeting room cancel test")
            
            return data
        else:
            log_error(f"GET /api/bookings failed with status {response.status_code}")
            log_info(f"Response: {response.text[:500]}")
            return None
    except Exception as e:
        log_error(f"Exception: {str(e)}")
        return None

def test_workstation_cancel_bug(token: str, workstation_id: str):
    """Test that DELETE /api/room-bookings/{workstation_id} returns 404 (the bug)"""
    log_test("TEST 3a: DELETE /api/room-bookings/{workstation_id} - Expect 404 (bug behavior)")
    
    url = f"{BASE_URL}/room-bookings/{workstation_id}"
    headers = {"Authorization": f"Bearer {token}"}
    
    try:
        response = requests.delete(url, headers=headers)
        log_info(f"DELETE {url}")
        log_info(f"Status: {response.status_code}")
        log_info(f"Response: {response.text[:500]}")
        
        if response.status_code == 404:
            log_success("Correctly returns 404 'Booking not found' (confirms bug root cause)")
            return True
        else:
            log_error(f"Expected 404, got {response.status_code}")
            return False
    except Exception as e:
        log_error(f"Exception: {str(e)}")
        return False

def test_workstation_cancel_fix(token: str, workstation_id: str):
    """Test that DELETE /api/workstation-bookings/{workstation_id} returns 200/204 (the fix)"""
    log_test("TEST 3b: DELETE /api/workstation-bookings/{workstation_id} - Expect 200/204 (fixed behavior)")
    
    url = f"{BASE_URL}/workstation-bookings/{workstation_id}"
    headers = {"Authorization": f"Bearer {token}"}
    
    try:
        response = requests.delete(url, headers=headers)
        log_info(f"DELETE {url}")
        log_info(f"Status: {response.status_code}")
        log_info(f"Response: {response.text[:500]}")
        
        if response.status_code in [200, 204]:
            log_success(f"Successfully cancelled workstation booking (status {response.status_code})")
            return True
        else:
            log_error(f"Expected 200/204, got {response.status_code}")
            return False
    except Exception as e:
        log_error(f"Exception: {str(e)}")
        return False

def verify_booking_cancelled(token: str, booking_id: str):
    """Verify booking status is now Cancelled"""
    log_test("TEST 3c: GET /api/bookings/{id} - Verify status is Cancelled")
    
    url = f"{BASE_URL}/bookings/{booking_id}"
    headers = {"Authorization": f"Bearer {token}"}
    
    try:
        response = requests.get(url, headers=headers)
        log_info(f"GET {url}")
        log_info(f"Status: {response.status_code}")
        log_info(f"Response: {response.text[:500]}")
        
        if response.status_code == 200:
            data = response.json()
            status = data.get("status")
            cancelled = data.get("cancelled")
            
            if status == "Cancelled" or cancelled == True:
                log_success(f"Booking status confirmed as Cancelled (status={status}, cancelled={cancelled})")
                return True
            else:
                log_error(f"Booking not cancelled: status={status}, cancelled={cancelled}")
                return False
        else:
            log_error(f"GET /api/bookings/{booking_id} failed with status {response.status_code}")
            return False
    except Exception as e:
        log_error(f"Exception: {str(e)}")
        return False

def test_meeting_room_cancel(token: str, meeting_room_id: str):
    """Test that DELETE /api/room-bookings/{meeting_room_id} still works (regression check)"""
    log_test("TEST 4: DELETE /api/room-bookings/{meeting_room_id} - Expect 200 (regression check)")
    
    url = f"{BASE_URL}/room-bookings/{meeting_room_id}"
    headers = {"Authorization": f"Bearer {token}"}
    
    try:
        response = requests.delete(url, headers=headers)
        log_info(f"DELETE {url}")
        log_info(f"Status: {response.status_code}")
        log_info(f"Response: {response.text[:500]}")
        
        if response.status_code in [200, 204]:
            log_success(f"Meeting room cancel still works (status {response.status_code})")
            return True
        else:
            log_error(f"Expected 200/204, got {response.status_code}")
            return False
    except Exception as e:
        log_error(f"Exception: {str(e)}")
        return False

def test_invalid_workstation_id(token: str):
    """Sanity check: DELETE /api/workstation-bookings/{random-uuid} should return 404"""
    log_test("TEST 5: DELETE /api/workstation-bookings/{random-uuid} - Expect 404 (sanity check)")
    
    random_id = str(uuid.uuid4())
    url = f"{BASE_URL}/workstation-bookings/{random_id}"
    headers = {"Authorization": f"Bearer {token}"}
    
    try:
        response = requests.delete(url, headers=headers)
        log_info(f"DELETE {url}")
        log_info(f"Status: {response.status_code}")
        log_info(f"Response: {response.text[:500]}")
        
        if response.status_code == 404:
            log_success("Correctly returns 404 for non-existent workstation booking")
            return True
        else:
            log_error(f"Expected 404, got {response.status_code}")
            return False
    except Exception as e:
        log_error(f"Exception: {str(e)}")
        return False

def main():
    print(f"\n{Colors.BOLD}{'='*80}")
    print("BOOKINGS MODULE BUG FIX VERIFICATION")
    print(f"{'='*80}{Colors.RESET}\n")
    
    results = {
        "total": 0,
        "passed": 0,
        "failed": 0
    }
    
    # Step 1: Login
    token = login()
    if not token:
        log_error("Cannot proceed without authentication token")
        sys.exit(1)
    results["total"] += 1
    results["passed"] += 1
    
    # Step 2: Get bookings
    bookings_data = get_bookings(token)
    if not bookings_data:
        log_error("Cannot proceed without bookings data")
        sys.exit(1)
    results["total"] += 1
    results["passed"] += 1
    
    bookings = bookings_data.get("bookings", [])
    
    # Find an active workstation booking
    workstation_booking = None
    for booking in bookings:
        if booking.get("type") == "Workstation" and booking.get("status") == "Active":
            workstation_booking = booking
            break
    
    if not workstation_booking:
        log_error("No active workstation booking found for testing")
        sys.exit(1)
    
    workstation_id = workstation_booking.get("id")
    log_info(f"Selected workstation booking ID: {workstation_id}")
    
    # Step 3a: Test the bug (DELETE via room-bookings endpoint)
    results["total"] += 1
    if test_workstation_cancel_bug(token, workstation_id):
        results["passed"] += 1
    else:
        results["failed"] += 1
    
    # Step 3b: Test the fix (DELETE via workstation-bookings endpoint)
    results["total"] += 1
    if test_workstation_cancel_fix(token, workstation_id):
        results["passed"] += 1
    else:
        results["failed"] += 1
    
    # Step 3c: Verify booking is cancelled
    results["total"] += 1
    if verify_booking_cancelled(token, workstation_id):
        results["passed"] += 1
    else:
        results["failed"] += 1
    
    # Step 4: Test meeting room cancel (if available)
    meeting_room_booking = None
    for booking in bookings:
        if booking.get("type") == "Meeting Room" and booking.get("status") == "Active":
            meeting_room_booking = booking
            break
    
    if meeting_room_booking:
        meeting_room_id = meeting_room_booking.get("id")
        log_info(f"Selected meeting room booking ID: {meeting_room_id}")
        results["total"] += 1
        if test_meeting_room_cancel(token, meeting_room_id):
            results["passed"] += 1
        else:
            results["failed"] += 1
    else:
        log_info("Skipping meeting room cancel test (no active meeting room bookings)")
    
    # Step 5: Sanity check with random UUID
    results["total"] += 1
    if test_invalid_workstation_id(token):
        results["passed"] += 1
    else:
        results["failed"] += 1
    
    # Summary
    print(f"\n{Colors.BOLD}{'='*80}")
    print("TEST SUMMARY")
    print(f"{'='*80}{Colors.RESET}")
    print(f"Total tests: {results['total']}")
    print(f"{Colors.GREEN}Passed: {results['passed']}{Colors.RESET}")
    print(f"{Colors.RED}Failed: {results['failed']}{Colors.RESET}")
    
    if results['failed'] == 0:
        print(f"\n{Colors.GREEN}{Colors.BOLD}✓ ALL TESTS PASSED{Colors.RESET}\n")
        sys.exit(0)
    else:
        print(f"\n{Colors.RED}{Colors.BOLD}✗ SOME TESTS FAILED{Colors.RESET}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
