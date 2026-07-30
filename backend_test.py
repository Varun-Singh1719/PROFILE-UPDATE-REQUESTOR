#!/usr/bin/env python3
"""
COMPREHENSIVE BACKEND QA — Auto-Approval Module (Workstation + Meeting Room)
DO NOT FIX BUGS — only log defects with severity/repro/expected vs actual
"""

import requests
import json
import sys
from datetime import datetime, timedelta, date as date_cls
from typing import Dict, List, Optional, Any
import time

# Backend base URL
BASE_URL = "https://0ad9a6f7-907c-4a2f-853f-3fdca17a4659.preview.emergentagent.com/api"

# Test credentials
CREDENTIALS = {
    "super_admin": {"email": "admin@ticketing.com", "password": "Admin@123"},
    "manager": {"email": "manager@ticketing.com", "password": "Manager@123"},
    "employee": {"email": "employee@ticketing.com", "password": "Employee@123"},
}

# Global session storage
sessions = {}
test_results = []
bug_counter = 1


class TestResult:
    def __init__(self, test_id: str, category: str, description: str):
        self.test_id = test_id
        self.category = category
        self.description = description
        self.status = "PENDING"
        self.expected = ""
        self.actual = ""
        self.severity = ""
        self.notes = ""
        self.api_endpoint = ""
        self.repro_steps = []
        
    def pass_test(self, notes=""):
        self.status = "PASS"
        self.notes = notes
        
    def fail_test(self, severity: str, expected: str, actual: str, notes=""):
        global bug_counter
        self.status = "FAIL"
        self.severity = severity
        self.expected = expected
        self.actual = actual
        self.notes = f"BUG-{bug_counter:03d}: {notes}"
        bug_counter += 1
        
    def skip_test(self, reason: str):
        self.status = "SKIP"
        self.notes = reason


def log(msg: str, level="INFO"):
    """Log a message with timestamp"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] [{level}] {msg}")


def login(role: str) -> Optional[str]:
    """Login and return access token"""
    if role in sessions:
        return sessions[role]
    
    creds = CREDENTIALS.get(role)
    if not creds:
        log(f"No credentials for role: {role}", "ERROR")
        return None
    
    try:
        resp = requests.post(
            f"{BASE_URL}/auth/login",
            json=creds,
            timeout=30
        )
        if resp.status_code == 200:
            data = resp.json()
            token = data.get("access_token")
            sessions[role] = token
            log(f"Logged in as {role}: {creds['email']}")
            return token
        else:
            log(f"Login failed for {role}: {resp.status_code} {resp.text}", "ERROR")
            return None
    except Exception as e:
        log(f"Login exception for {role}: {e}", "ERROR")
        return None


def api_get(endpoint: str, token: str, params: Dict = None) -> requests.Response:
    """Make GET request with auth"""
    headers = {"Authorization": f"Bearer {token}"}
    return requests.get(f"{BASE_URL}{endpoint}", headers=headers, params=params, timeout=30)


def api_post(endpoint: str, token: str, data: Dict) -> requests.Response:
    """Make POST request with auth"""
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    return requests.post(f"{BASE_URL}{endpoint}", headers=headers, json=data, timeout=30)


def api_put(endpoint: str, token: str, data: Dict) -> requests.Response:
    """Make PUT request with auth"""
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    return requests.put(f"{BASE_URL}{endpoint}", headers=headers, json=data, timeout=30)


def api_delete(endpoint: str, token: str) -> requests.Response:
    """Make DELETE request with auth"""
    headers = {"Authorization": f"Bearer {token}"}
    return requests.delete(f"{BASE_URL}{endpoint}", headers=headers, timeout=30)


def get_approval_settings(token: str) -> Optional[Dict]:
    """Get current approval settings"""
    try:
        resp = api_get("/approval-settings", token)
        if resp.status_code == 200:
            return resp.json()
        return None
    except Exception as e:
        log(f"Failed to get approval settings: {e}", "ERROR")
        return None


def reset_approval_settings(token: str) -> bool:
    """Reset approval settings to defaults"""
    try:
        resp = api_post("/approval-settings/reset", token, {})
        return resp.status_code == 200
    except Exception as e:
        log(f"Failed to reset approval settings: {e}", "ERROR")
        return False


def update_approval_settings(token: str, enabled: bool = None, matrix: Dict = None) -> bool:
    """Update approval settings"""
    try:
        payload = {}
        if enabled is not None:
            payload["enabled"] = enabled
        if matrix is not None:
            payload["matrix"] = matrix
        resp = api_put("/approval-settings", token, payload)
        return resp.status_code == 200
    except Exception as e:
        log(f"Failed to update approval settings: {e}", "ERROR")
        return False


def get_user_info(token: str) -> Optional[Dict]:
    """Get current user info"""
    try:
        resp = api_get("/auth/me", token)
        if resp.status_code == 200:
            return resp.json()
        return None
    except Exception as e:
        log(f"Failed to get user info: {e}", "ERROR")
        return None


def get_teams(token: str) -> List[Dict]:
    """Get all teams"""
    try:
        resp = api_get("/teams", token)
        if resp.status_code == 200:
            return resp.json()
        return []
    except Exception as e:
        log(f"Failed to get teams: {e}", "ERROR")
        return []


def is_user_manager(user_id: str, teams: List[Dict]) -> bool:
    """Check if user is a manager in any team"""
    for team in teams:
        if user_id in team.get("manager_ids", []):
            return True
    return False


def get_floor_plans(token: str) -> List[Dict]:
    """Get floor plans for workstation requests"""
    try:
        resp = api_get("/workstation-requests/floor-plans", token)
        if resp.status_code == 200:
            return resp.json()
        return []
    except Exception as e:
        log(f"Failed to get floor plans: {e}", "ERROR")
        return []


def get_meeting_rooms(token: str) -> List[Dict]:
    """Get meeting rooms"""
    try:
        resp = api_get("/meeting-rooms", token)
        if resp.status_code == 200:
            return resp.json()
        return []
    except Exception as e:
        log(f"Failed to get meeting rooms: {e}", "ERROR")
        return []


def create_workstation_request(token: str, plan_id: str, seat_ids: List[str], 
                                employee_id: str, date: str) -> Optional[Dict]:
    """Create a workstation request"""
    try:
        payload = {
            "plan_id": plan_id,
            "date": date,
            "seat_ids": seat_ids,
            "employee_id": employee_id
        }
        resp = api_post("/workstation-requests", token, payload)
        if resp.status_code in [200, 201]:
            return resp.json()
        else:
            log(f"Workstation request failed: {resp.status_code} {resp.text}", "WARN")
            return {"error": resp.text, "status_code": resp.status_code}
    except Exception as e:
        log(f"Exception creating workstation request: {e}", "ERROR")
        return None


def create_meeting_room_request(token: str, plan_id: str, room_id: str, 
                                 title: str, start_at: str, end_at: str,
                                 attendees: List[Dict] = None) -> Optional[Dict]:
    """Create a meeting room request"""
    try:
        payload = {
            "plan_id": plan_id,
            "room_id": room_id,
            "title": title,
            "start_at": start_at,
            "end_at": end_at,
            "attendees": attendees or []
        }
        resp = api_post("/meeting-room-requests", token, payload)
        if resp.status_code in [200, 201]:
            return resp.json()
        else:
            log(f"Meeting room request failed: {resp.status_code} {resp.text}", "WARN")
            return {"error": resp.text, "status_code": resp.status_code}
    except Exception as e:
        log(f"Exception creating meeting room request: {e}", "ERROR")
        return None


def get_workstation_requests(token: str, status: str = None) -> List[Dict]:
    """Get workstation requests"""
    try:
        params = {}
        if status:
            params["status"] = status
        resp = api_get("/workstation-requests", token, params)
        if resp.status_code == 200:
            return resp.json()
        return []
    except Exception as e:
        log(f"Failed to get workstation requests: {e}", "ERROR")
        return []


def get_meeting_room_requests(token: str, status: str = None) -> List[Dict]:
    """Get meeting room requests"""
    try:
        params = {}
        if status:
            params["status"] = status
        resp = api_get("/meeting-room-requests", token, params)
        if resp.status_code == 200:
            return resp.json()
        return []
    except Exception as e:
        log(f"Failed to get meeting room requests: {e}", "ERROR")
        return []


# ============================================================================
# TEST SUITES
# ============================================================================

def test_requestor_type_workstation():
    """Test requestor-type rules for workstation"""
    log("=" * 80)
    log("TEST SUITE: Requestor Type - Workstation")
    log("=" * 80)
    
    admin_token = login("super_admin")
    manager_token = login("manager")
    employee_token = login("employee")
    
    if not all([admin_token, manager_token, employee_token]):
        log("Failed to login all users, skipping requestor type tests", "ERROR")
        return
    
    # Reset approval settings
    reset_approval_settings(admin_token)
    
    # Get user info
    admin_user = get_user_info(admin_token)
    manager_user = get_user_info(manager_token)
    employee_user = get_user_info(employee_token)
    
    # Get teams to determine manager status
    teams = get_teams(admin_token)
    
    # Get floor plans
    floor_plans = get_floor_plans(admin_token)
    if not floor_plans:
        log("No floor plans available, skipping workstation tests", "WARN")
        return
    
    plan = floor_plans[0]
    plan_id = plan.get("id")
    
    # Get available seats
    # We'll use a future date to avoid conflicts
    test_date = (date_cls.today() + timedelta(days=30)).isoformat()
    
    # Test 1: team_member=true → team-member submitter auto-approved
    test = TestResult("REQ-WS-01", "Requestor Type", 
                      "team_member=true → team-member submitter auto-approved")
    test.api_endpoint = "POST /workstation-requests"
    test.repro_steps = [
        "1. Set approval_settings.enabled=true, workstation.team_member=true",
        "2. Submit workstation request as employee (non-manager)",
        "3. Check if request status is 'Approved' and booking created"
    ]
    
    # Enable auto-approval for team members
    update_approval_settings(admin_token, enabled=True, matrix={
        "workstation": {"team_member": True, "manager": False}
    })
    
    # Submit request as employee
    result = create_workstation_request(
        employee_token, plan_id, [plan.get("seats", [{}])[0].get("id")],
        employee_user.get("id"), test_date
    )
    
    if result and not result.get("error"):
        requests_data = result.get("requests", [])
        auto_approved = result.get("auto_approved", [])
        
        if requests_data and requests_data[0].get("status") == "Approved":
            test.pass_test(f"Request auto-approved for team member. Request ID: {requests_data[0].get('id')}")
        elif auto_approved:
            test.pass_test(f"Request auto-approved (booking created). Booking ID: {auto_approved[0].get('id')}")
        else:
            test.fail_test("MAJOR", "Request status='Approved' or booking created",
                          f"Request status='{requests_data[0].get('status') if requests_data else 'N/A'}'",
                          "Team member request was not auto-approved")
    else:
        test.fail_test("CRITICAL", "Request created successfully",
                      f"Request failed: {result.get('error') if result else 'No response'}",
                      "Failed to create workstation request")
    
    test_results.append(test)
    
    # Test 2: manager=true → manager submitter auto-approved
    test = TestResult("REQ-WS-02", "Requestor Type",
                      "manager=true → manager submitter auto-approved")
    test.api_endpoint = "POST /workstation-requests"
    
    # Enable auto-approval for managers only
    update_approval_settings(admin_token, enabled=True, matrix={
        "workstation": {"team_member": False, "manager": True}
    })
    
    # Check if manager user is actually a manager
    is_mgr = is_user_manager(manager_user.get("id"), teams)
    
    if is_mgr:
        result = create_workstation_request(
            manager_token, plan_id, [plan.get("seats", [{}])[1].get("id") if len(plan.get("seats", [])) > 1 else plan.get("seats", [{}])[0].get("id")],
            manager_user.get("id"), test_date
        )
        
        if result and not result.get("error"):
            requests_data = result.get("requests", [])
            auto_approved = result.get("auto_approved", [])
            
            if requests_data and requests_data[0].get("status") == "Approved":
                test.pass_test(f"Manager request auto-approved. Request ID: {requests_data[0].get('id')}")
            elif auto_approved:
                test.pass_test(f"Manager request auto-approved (booking created). Booking ID: {auto_approved[0].get('id')}")
            else:
                test.fail_test("MAJOR", "Request status='Approved' or booking created",
                              f"Request status='{requests_data[0].get('status') if requests_data else 'N/A'}'",
                              "Manager request was not auto-approved")
        else:
            test.fail_test("CRITICAL", "Request created successfully",
                          f"Request failed: {result.get('error') if result else 'No response'}",
                          "Failed to create workstation request for manager")
    else:
        test.skip_test(f"Manager user {manager_user.get('email')} is not in any team's manager_ids")
    
    test_results.append(test)
    
    # Test 3: Both false → both remain Pending
    test = TestResult("REQ-WS-03", "Requestor Type",
                      "team_member=false AND manager=false → requests remain Pending")
    test.api_endpoint = "POST /workstation-requests"
    
    # Disable both
    update_approval_settings(admin_token, enabled=True, matrix={
        "workstation": {"team_member": False, "manager": False}
    })
    
    result = create_workstation_request(
        employee_token, plan_id, [plan.get("seats", [{}])[2].get("id") if len(plan.get("seats", [])) > 2 else plan.get("seats", [{}])[0].get("id")],
        employee_user.get("id"), (date_cls.today() + timedelta(days=31)).isoformat()
    )
    
    if result and not result.get("error"):
        requests_data = result.get("requests", [])
        auto_approved = result.get("auto_approved", [])
        
        if requests_data and requests_data[0].get("status") == "Pending Approval":
            test.pass_test(f"Request correctly stayed Pending. Request ID: {requests_data[0].get('id')}")
        elif auto_approved:
            test.fail_test("MAJOR", "Request status='Pending Approval'",
                          "Request was auto-approved",
                          "Request should NOT be auto-approved when both team_member and manager are false")
        else:
            test.fail_test("MINOR", "Request status='Pending Approval'",
                          f"Request status='{requests_data[0].get('status') if requests_data else 'N/A'}'",
                          "Unexpected request status")
    else:
        test.fail_test("CRITICAL", "Request created successfully",
                      f"Request failed: {result.get('error') if result else 'No response'}",
                      "Failed to create workstation request")
    
    test_results.append(test)


def test_date_rules_meeting_room():
    """Test date rules for meeting room"""
    log("=" * 80)
    log("TEST SUITE: Date Rules - Meeting Room")
    log("=" * 80)
    
    admin_token = login("super_admin")
    employee_token = login("employee")
    
    if not all([admin_token, employee_token]):
        log("Failed to login users, skipping date rule tests", "ERROR")
        return
    
    # Reset approval settings
    reset_approval_settings(admin_token)
    
    employee_user = get_user_info(employee_token)
    
    # Get meeting rooms
    meeting_rooms = get_meeting_rooms(admin_token)
    if not meeting_rooms:
        log("No meeting rooms available, skipping meeting room tests", "WARN")
        return
    
    room = meeting_rooms[0]
    room_id = room.get("id")
    plan_id = room.get("plan_id")
    
    # Test 1: mode=on with exact match date → should auto-approve
    test = TestResult("DATE-MR-01", "Date Rules",
                      "mode=on with exact-match date → should auto-approve")
    test.api_endpoint = "POST /meeting-room-requests"
    
    target_date = date_cls.today() + timedelta(days=10)
    target_date_str = target_date.isoformat()
    
    # Configure date rule: on specific date
    update_approval_settings(admin_token, enabled=True, matrix={
        "meeting_room": {
            "team_member": False,
            "manager": False,
            "date": {
                "enabled": True,
                "mode": "on",
                "from": target_date_str,
                "to": None
            }
        }
    })
    
    # Create meeting on that exact date
    start_time = datetime.combine(target_date, datetime.min.time().replace(hour=10, minute=0))
    end_time = start_time + timedelta(hours=1)
    
    result = create_meeting_room_request(
        employee_token, plan_id, room_id,
        "Date Rule Test - On Mode",
        start_time.isoformat() + "Z",
        end_time.isoformat() + "Z"
    )
    
    if result and not result.get("error"):
        requests_data = result.get("requests", [])
        auto_approved = result.get("auto_approved", [])
        
        if requests_data and requests_data[0].get("status") == "Approved":
            test.pass_test(f"Meeting auto-approved for exact date match. Request ID: {requests_data[0].get('id')}")
        elif auto_approved:
            test.pass_test(f"Meeting auto-approved (booking created). Booking ID: {auto_approved[0].get('id')}")
        else:
            test.fail_test("MAJOR", "Request status='Approved' or booking created",
                          f"Request status='{requests_data[0].get('status') if requests_data else 'N/A'}'",
                          "Date rule (mode=on) did not auto-approve on exact date match")
    else:
        test.fail_test("CRITICAL", "Request created successfully",
                      f"Request failed: {result.get('error') if result else 'No response'}",
                      "Failed to create meeting room request")
    
    test_results.append(test)
    
    # Test 2: mode=before with date before threshold → should auto-approve
    test = TestResult("DATE-MR-02", "Date Rules",
                      "mode=before with date before threshold → should auto-approve")
    test.api_endpoint = "POST /meeting-room-requests"
    
    threshold_date = date_cls.today() + timedelta(days=20)
    test_date = date_cls.today() + timedelta(days=15)  # before threshold
    
    update_approval_settings(admin_token, enabled=True, matrix={
        "meeting_room": {
            "team_member": False,
            "manager": False,
            "date": {
                "enabled": True,
                "mode": "before",
                "from": threshold_date.isoformat(),
                "to": None
            }
        }
    })
    
    start_time = datetime.combine(test_date, datetime.min.time().replace(hour=11, minute=0))
    end_time = start_time + timedelta(hours=1)
    
    result = create_meeting_room_request(
        employee_token, plan_id, room_id,
        "Date Rule Test - Before Mode",
        start_time.isoformat() + "Z",
        end_time.isoformat() + "Z"
    )
    
    if result and not result.get("error"):
        requests_data = result.get("requests", [])
        auto_approved = result.get("auto_approved", [])
        
        if requests_data and requests_data[0].get("status") == "Approved":
            test.pass_test(f"Meeting auto-approved for date before threshold. Request ID: {requests_data[0].get('id')}")
        elif auto_approved:
            test.pass_test(f"Meeting auto-approved (booking created). Booking ID: {auto_approved[0].get('id')}")
        else:
            test.fail_test("MAJOR", "Request status='Approved' or booking created",
                          f"Request status='{requests_data[0].get('status') if requests_data else 'N/A'}'",
                          "Date rule (mode=before) did not auto-approve for date before threshold")
    else:
        test.fail_test("CRITICAL", "Request created successfully",
                      f"Request failed: {result.get('error') if result else 'No response'}",
                      "Failed to create meeting room request")
    
    test_results.append(test)
    
    # Test 3: mode=between with date in range → should auto-approve
    test = TestResult("DATE-MR-03", "Date Rules",
                      "mode=between with date in range → should auto-approve")
    test.api_endpoint = "POST /meeting-room-requests"
    
    from_date = date_cls.today() + timedelta(days=25)
    to_date = date_cls.today() + timedelta(days=35)
    test_date = date_cls.today() + timedelta(days=30)  # in range
    
    update_approval_settings(admin_token, enabled=True, matrix={
        "meeting_room": {
            "team_member": False,
            "manager": False,
            "date": {
                "enabled": True,
                "mode": "between",
                "from": from_date.isoformat(),
                "to": to_date.isoformat()
            }
        }
    })
    
    start_time = datetime.combine(test_date, datetime.min.time().replace(hour=14, minute=0))
    end_time = start_time + timedelta(hours=1)
    
    result = create_meeting_room_request(
        employee_token, plan_id, room_id,
        "Date Rule Test - Between Mode",
        start_time.isoformat() + "Z",
        end_time.isoformat() + "Z"
    )
    
    if result and not result.get("error"):
        requests_data = result.get("requests", [])
        auto_approved = result.get("auto_approved", [])
        
        if requests_data and requests_data[0].get("status") == "Approved":
            test.pass_test(f"Meeting auto-approved for date in range. Request ID: {requests_data[0].get('id')}")
        elif auto_approved:
            test.pass_test(f"Meeting auto-approved (booking created). Booking ID: {auto_approved[0].get('id')}")
        else:
            test.fail_test("MAJOR", "Request status='Approved' or booking created",
                          f"Request status='{requests_data[0].get('status') if requests_data else 'N/A'}'",
                          "Date rule (mode=between) did not auto-approve for date in range")
    else:
        test.fail_test("CRITICAL", "Request created successfully",
                      f"Request failed: {result.get('error') if result else 'No response'}",
                      "Failed to create meeting room request")
    
    test_results.append(test)


def test_duration_rules_meeting_room():
    """Test duration rules for meeting room"""
    log("=" * 80)
    log("TEST SUITE: Duration Rules - Meeting Room")
    log("=" * 80)
    
    admin_token = login("super_admin")
    employee_token = login("employee")
    
    if not all([admin_token, employee_token]):
        log("Failed to login users, skipping duration rule tests", "ERROR")
        return
    
    # Reset approval settings
    reset_approval_settings(admin_token)
    
    employee_user = get_user_info(employee_token)
    
    # Get meeting rooms
    meeting_rooms = get_meeting_rooms(admin_token)
    if not meeting_rooms:
        log("No meeting rooms available, skipping meeting room tests", "WARN")
        return
    
    room = meeting_rooms[0]
    room_id = room.get("id")
    plan_id = room.get("plan_id")
    
    # Test 1: meeting length = threshold exactly → auto-approve (<=)
    test = TestResult("DUR-MR-01", "Duration Rules",
                      "meeting length = threshold exactly → auto-approve (<=)")
    test.api_endpoint = "POST /meeting-room-requests"
    
    # Set duration rule: 30 minutes
    update_approval_settings(admin_token, enabled=True, matrix={
        "meeting_room": {
            "team_member": False,
            "manager": False,
            "duration": {
                "enabled": True,
                "value": 30,
                "unit": "min"
            }
        }
    })
    
    # Create 30-minute meeting
    test_date = date_cls.today() + timedelta(days=40)
    start_time = datetime.combine(test_date, datetime.min.time().replace(hour=10, minute=0))
    end_time = start_time + timedelta(minutes=30)
    
    result = create_meeting_room_request(
        employee_token, plan_id, room_id,
        "Duration Test - 30 min",
        start_time.isoformat() + "Z",
        end_time.isoformat() + "Z"
    )
    
    if result and not result.get("error"):
        requests_data = result.get("requests", [])
        auto_approved = result.get("auto_approved", [])
        
        if requests_data and requests_data[0].get("status") == "Approved":
            test.pass_test(f"30-min meeting auto-approved (threshold=30min). Request ID: {requests_data[0].get('id')}")
        elif auto_approved:
            test.pass_test(f"30-min meeting auto-approved (booking created). Booking ID: {auto_approved[0].get('id')}")
        else:
            test.fail_test("MAJOR", "Request status='Approved' or booking created",
                          f"Request status='{requests_data[0].get('status') if requests_data else 'N/A'}'",
                          "Duration rule did not auto-approve meeting with length = threshold")
    else:
        test.fail_test("CRITICAL", "Request created successfully",
                      f"Request failed: {result.get('error') if result else 'No response'}",
                      "Failed to create meeting room request")
    
    test_results.append(test)
    
    # Test 2: meeting length = threshold + 1 min → NOT auto-approve
    test = TestResult("DUR-MR-02", "Duration Rules",
                      "meeting length = threshold + 1 min → NOT auto-approve")
    test.api_endpoint = "POST /meeting-room-requests"
    
    # Create 31-minute meeting (threshold is 30)
    test_date = date_cls.today() + timedelta(days=41)
    start_time = datetime.combine(test_date, datetime.min.time().replace(hour=11, minute=0))
    end_time = start_time + timedelta(minutes=31)
    
    result = create_meeting_room_request(
        employee_token, plan_id, room_id,
        "Duration Test - 31 min",
        start_time.isoformat() + "Z",
        end_time.isoformat() + "Z"
    )
    
    if result and not result.get("error"):
        requests_data = result.get("requests", [])
        auto_approved = result.get("auto_approved", [])
        
        if requests_data and requests_data[0].get("status") == "Pending Approval":
            test.pass_test(f"31-min meeting correctly stayed Pending (threshold=30min). Request ID: {requests_data[0].get('id')}")
        elif auto_approved:
            test.fail_test("MAJOR", "Request status='Pending Approval'",
                          "Request was auto-approved",
                          "Duration rule should NOT auto-approve meeting with length > threshold")
        else:
            test.fail_test("MINOR", "Request status='Pending Approval'",
                          f"Request status='{requests_data[0].get('status') if requests_data else 'N/A'}'",
                          "Unexpected request status")
    else:
        test.fail_test("CRITICAL", "Request created successfully",
                      f"Request failed: {result.get('error') if result else 'No response'}",
                      "Failed to create meeting room request")
    
    test_results.append(test)
    
    # Test 3: threshold in hours (1 hour) → meeting of 60 min = auto-approve
    test = TestResult("DUR-MR-03", "Duration Rules",
                      "threshold in hours (1 hour) → meeting of 60 min = auto-approve")
    test.api_endpoint = "POST /meeting-room-requests"
    
    # Set duration rule: 1 hour
    update_approval_settings(admin_token, enabled=True, matrix={
        "meeting_room": {
            "team_member": False,
            "manager": False,
            "duration": {
                "enabled": True,
                "value": 1,
                "unit": "hour"
            }
        }
    })
    
    # Create 60-minute meeting
    test_date = date_cls.today() + timedelta(days=42)
    start_time = datetime.combine(test_date, datetime.min.time().replace(hour=14, minute=0))
    end_time = start_time + timedelta(minutes=60)
    
    result = create_meeting_room_request(
        employee_token, plan_id, room_id,
        "Duration Test - 60 min (1 hour threshold)",
        start_time.isoformat() + "Z",
        end_time.isoformat() + "Z"
    )
    
    if result and not result.get("error"):
        requests_data = result.get("requests", [])
        auto_approved = result.get("auto_approved", [])
        
        if requests_data and requests_data[0].get("status") == "Approved":
            test.pass_test(f"60-min meeting auto-approved (threshold=1 hour). Request ID: {requests_data[0].get('id')}")
        elif auto_approved:
            test.pass_test(f"60-min meeting auto-approved (booking created). Booking ID: {auto_approved[0].get('id')}")
        else:
            test.fail_test("MAJOR", "Request status='Approved' or booking created",
                          f"Request status='{requests_data[0].get('status') if requests_data else 'N/A'}'",
                          "Duration rule (unit=hour) did not auto-approve 60-min meeting")
    else:
        test.fail_test("CRITICAL", "Request created successfully",
                      f"Request failed: {result.get('error') if result else 'No response'}",
                      "Failed to create meeting room request")
    
    test_results.append(test)


def test_regression_sanity():
    """Test regression sanity - ensure other endpoints still work"""
    log("=" * 80)
    log("TEST SUITE: Regression Sanity")
    log("=" * 80)
    
    admin_token = login("super_admin")
    
    if not admin_token:
        log("Failed to login admin, skipping regression tests", "ERROR")
        return
    
    endpoints = [
        ("/dashboard/stats", "Dashboard Stats"),
        ("/teams", "Teams List"),
        ("/contacts", "Contacts List"),
        ("/floor-plans", "Floor Plans"),
        ("/workstation-bookings", "Workstation Bookings"),
        ("/meeting-room-requests", "Meeting Room Requests"),
        ("/workstation-requests", "Workstation Requests"),
    ]
    
    for endpoint, name in endpoints:
        test = TestResult(f"REG-{endpoint.replace('/', '-')}", "Regression",
                          f"GET {endpoint} returns 200")
        test.api_endpoint = f"GET {endpoint}"
        
        try:
            resp = api_get(endpoint, admin_token)
            if resp.status_code == 200:
                test.pass_test(f"{name} endpoint working correctly")
            else:
                test.fail_test("MAJOR", "HTTP 200", f"HTTP {resp.status_code}",
                              f"{name} endpoint returned non-200 status")
        except Exception as e:
            test.fail_test("CRITICAL", "Successful API call", f"Exception: {e}",
                          f"{name} endpoint threw exception")
        
        test_results.append(test)


def test_global_enabled_flag():
    """Test global enabled flag"""
    log("=" * 80)
    log("TEST SUITE: Global Enabled Flag")
    log("=" * 80)
    
    admin_token = login("super_admin")
    employee_token = login("employee")
    
    if not all([admin_token, employee_token]):
        log("Failed to login users, skipping global enabled flag tests", "ERROR")
        return
    
    employee_user = get_user_info(employee_token)
    
    # Get meeting rooms
    meeting_rooms = get_meeting_rooms(admin_token)
    if not meeting_rooms:
        log("No meeting rooms available, skipping test", "WARN")
        return
    
    room = meeting_rooms[0]
    room_id = room.get("id")
    plan_id = room.get("plan_id")
    
    # Test: Global enabled=false + all cells configured → NEVER auto-approve
    test = TestResult("GLOBAL-01", "Global Enabled Flag",
                      "enabled=false + all cells configured → NEVER auto-approve")
    test.api_endpoint = "POST /meeting-room-requests"
    
    # Configure all cells but set enabled=false
    update_approval_settings(admin_token, enabled=False, matrix={
        "meeting_room": {
            "team_member": True,
            "manager": True,
            "date": {
                "enabled": True,
                "mode": "on",
                "from": (date_cls.today() + timedelta(days=50)).isoformat(),
                "to": None
            },
            "time": {
                "enabled": True,
                "operator": "on",
                "from": "10:00",
                "to": None
            },
            "duration": {
                "enabled": True,
                "value": 60,
                "unit": "min"
            }
        }
    })
    
    # Create meeting that would match all rules
    test_date = date_cls.today() + timedelta(days=50)
    start_time = datetime.combine(test_date, datetime.min.time().replace(hour=10, minute=0))
    end_time = start_time + timedelta(minutes=30)
    
    result = create_meeting_room_request(
        employee_token, plan_id, room_id,
        "Global Enabled Test",
        start_time.isoformat() + "Z",
        end_time.isoformat() + "Z"
    )
    
    if result and not result.get("error"):
        requests_data = result.get("requests", [])
        auto_approved = result.get("auto_approved", [])
        
        if requests_data and requests_data[0].get("status") == "Pending Approval":
            test.pass_test(f"Request correctly stayed Pending when global enabled=false. Request ID: {requests_data[0].get('id')}")
        elif auto_approved:
            test.fail_test("CRITICAL", "Request status='Pending Approval'",
                          "Request was auto-approved",
                          "Global enabled=false should prevent ALL auto-approvals")
        else:
            test.fail_test("MINOR", "Request status='Pending Approval'",
                          f"Request status='{requests_data[0].get('status') if requests_data else 'N/A'}'",
                          "Unexpected request status")
    else:
        test.fail_test("CRITICAL", "Request created successfully",
                      f"Request failed: {result.get('error') if result else 'No response'}",
                      "Failed to create meeting room request")
    
    test_results.append(test)


def generate_report():
    """Generate comprehensive test report"""
    log("=" * 80)
    log("GENERATING COMPREHENSIVE TEST REPORT")
    log("=" * 80)
    
    total = len(test_results)
    passed = len([t for t in test_results if t.status == "PASS"])
    failed = len([t for t in test_results if t.status == "FAIL"])
    skipped = len([t for t in test_results if t.status == "SKIP"])
    
    print("\n" + "=" * 80)
    print("EXECUTIVE SUMMARY")
    print("=" * 80)
    print(f"Total Test Cases: {total}")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print(f"Skipped: {skipped}")
    print(f"Pass Rate: {(passed/total*100) if total > 0 else 0:.1f}%")
    
    # Bug list
    bugs = [t for t in test_results if t.status == "FAIL"]
    if bugs:
        print("\n" + "=" * 80)
        print("BUG LIST")
        print("=" * 80)
        for bug in bugs:
            print(f"\n{bug.notes}")
            print(f"  Test ID: {bug.test_id}")
            print(f"  Category: {bug.category}")
            print(f"  Severity: {bug.severity}")
            print(f"  Description: {bug.description}")
            print(f"  API Endpoint: {bug.api_endpoint}")
            print(f"  Expected: {bug.expected}")
            print(f"  Actual: {bug.actual}")
            if bug.repro_steps:
                print(f"  Repro Steps:")
                for step in bug.repro_steps:
                    print(f"    {step}")
    
    # Detailed results by category
    print("\n" + "=" * 80)
    print("DETAILED RESULTS BY CATEGORY")
    print("=" * 80)
    
    categories = {}
    for test in test_results:
        if test.category not in categories:
            categories[test.category] = []
        categories[test.category].append(test)
    
    for category, tests in sorted(categories.items()):
        print(f"\n{category}:")
        print("-" * 80)
        for test in tests:
            status_symbol = "✅" if test.status == "PASS" else "❌" if test.status == "FAIL" else "⚠️"
            print(f"  {status_symbol} [{test.test_id}] {test.description}")
            if test.notes:
                print(f"     → {test.notes}")
    
    # Recommendations
    print("\n" + "=" * 80)
    print("RECOMMENDATIONS")
    print("=" * 80)
    print("1. Fix all CRITICAL severity bugs before production deployment")
    print("2. Review MAJOR severity bugs for business impact")
    print("3. Add integration tests for auto-approval edge cases")
    print("4. Consider adding rate limiting for request creation")
    print("5. Implement comprehensive audit logging for all auto-approval decisions")
    
    return {
        "total": total,
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "bugs": bugs
    }


def main():
    """Main test execution"""
    log("=" * 80)
    log("COMPREHENSIVE BACKEND QA — Auto-Approval Module")
    log("Backend URL: " + BASE_URL)
    log("=" * 80)
    
    try:
        # Run test suites
        test_requestor_type_workstation()
        test_date_rules_meeting_room()
        test_duration_rules_meeting_room()
        test_global_enabled_flag()
        test_regression_sanity()
        
        # Generate report
        report = generate_report()
        
        # Exit with appropriate code
        if report["failed"] > 0:
            log(f"Tests completed with {report['failed']} failures", "WARN")
            sys.exit(1)
        else:
            log("All tests passed!", "INFO")
            sys.exit(0)
            
    except Exception as e:
        log(f"Test execution failed with exception: {e}", "ERROR")
        import traceback
        traceback.print_exc()
        sys.exit(2)


if __name__ == "__main__":
    main()
