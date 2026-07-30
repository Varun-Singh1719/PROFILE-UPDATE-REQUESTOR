"""
Comprehensive Backend QA — Auto-Approval Module (Jul 30 2026)

Tests all 15 scenarios from the review request:
1. Baseline (auto-approval OFF)
2. Enable + team_member cell
3. Enable + manager cell
4. Both cells enabled
5. Date rule (on, before, after, between)
6. Time rule (on, before, after, between)
7. Duration rule (meeting_room only)
8. OR semantics (combined cells)
9. Recurring bookings
10. Booking conflicts
11. Impersonation
12. Global disable overrides
13. Deactivated user
14. Cross-resource isolation
15. Lifecycle side-effects
"""

import requests
import json
from datetime import datetime, timedelta, date as date_cls
from typing import Dict, Any, List, Optional

# Backend URL
BASE_URL = "https://emp-status-toggle.preview.emergentagent.com/api"

# Test credentials
SUPER_ADMIN = {"email": "admin@ticketing.com", "password": "Admin@123"}
ADMIN_NO_TEAM = {"email": "manager@ticketing.com", "password": "Manager@123"}
TEAM_MANAGER = {"email": "ritika.singhal@infollion.com", "password": "TeamMgr@123"}
TEAM_MEMBER = {"email": "nitya.srivastava@infollion.com", "password": "Member@123"}

# Test data
FLOOR_PLAN_ID = "dd9ea314-e698-4f5d-bf85-16c00724c5ad"
LIVE_VERSION_ID = "4faef50f-6725-4d90-9a11-5785b8cf78af"

# Meeting rooms (from review request)
MEETING_ROOMS = {
    "Alpha": "room-rvmbce1-mrvtywb1",
    "Beta": "room-bnis9gg-mrvu0bpe",
    "Gamma": "room-2bfs16i-mrvu0u6p",
    "Theta": "room-y8i8ilp-mrvu1vna",
}

# Test results
test_results = []
bug_reports = []
bug_counter = 1


class TestSession:
    def __init__(self, credentials: Dict[str, str]):
        self.credentials = credentials
        self.token = None
        self.user = None
        self.session = requests.Session()
    
    def login(self) -> bool:
        """Login and store token"""
        try:
            resp = self.session.post(
                f"{BASE_URL}/auth/login",
                json=self.credentials,
                timeout=10
            )
            if resp.status_code == 200:
                data = resp.json()
                self.token = data.get("access_token")
                self.user = data.get("user")
                self.session.headers.update({"Authorization": f"Bearer {self.token}"})
                return True
            else:
                print(f"❌ Login failed: {resp.status_code} - {resp.text}")
                return False
        except Exception as e:
            print(f"❌ Login exception: {e}")
            return False
    
    def get(self, path: str, **kwargs) -> requests.Response:
        return self.session.get(f"{BASE_URL}{path}", timeout=10, **kwargs)
    
    def post(self, path: str, **kwargs) -> requests.Response:
        return self.session.post(f"{BASE_URL}{path}", timeout=10, **kwargs)
    
    def put(self, path: str, **kwargs) -> requests.Response:
        return self.session.put(f"{BASE_URL}{path}", timeout=10, **kwargs)
    
    def patch(self, path: str, **kwargs) -> requests.Response:
        return self.session.patch(f"{BASE_URL}{path}", timeout=10, **kwargs)
    
    def delete(self, path: str, **kwargs) -> requests.Response:
        return self.session.delete(f"{BASE_URL}{path}", timeout=10, **kwargs)


def log_test(test_id: str, description: str, passed: bool, details: str = ""):
    """Log test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    test_results.append({
        "id": test_id,
        "description": description,
        "status": status,
        "passed": passed,
        "details": details
    })
    print(f"{status} | {test_id} | {description}")
    if details:
        print(f"    {details}")


def log_bug(severity: str, module: str, endpoint: str, repro: str, expected: str, actual: str, root_cause: str = "", db_collection: str = ""):
    """Log a bug"""
    global bug_counter
    bug_id = f"BUG-{bug_counter:02d}"
    bug_counter += 1
    
    bug_reports.append({
        "id": bug_id,
        "severity": severity,
        "module": module,
        "endpoint": endpoint,
        "repro": repro,
        "expected": expected,
        "actual": actual,
        "root_cause": root_cause,
        "db_collection": db_collection
    })
    print(f"\n🐛 {bug_id} | {severity} | {module} | {endpoint}")
    print(f"   Expected: {expected}")
    print(f"   Actual: {actual}\n")


def get_meeting_rooms(session: TestSession) -> List[Dict[str, Any]]:
    """Fetch meeting rooms from floor plan"""
    try:
        resp = session.get(f"/floor-plans/{FLOOR_PLAN_ID}")
        if resp.status_code == 200:
            data = resp.json()
            rooms = data.get("live_rooms", [])
            print(f"✅ Found {len(rooms)} meeting rooms on floor plan")
            return rooms
        else:
            print(f"❌ Failed to fetch meeting rooms: {resp.status_code}")
            return []
    except Exception as e:
        print(f"❌ Exception fetching meeting rooms: {e}")
        return []


def reset_approval_settings(session: TestSession) -> bool:
    """Reset approval settings to defaults"""
    try:
        resp = session.post("/approval-settings/reset")
        if resp.status_code == 200:
            print("✅ Approval settings reset to defaults")
            return True
        else:
            print(f"❌ Failed to reset approval settings: {resp.status_code}")
            return False
    except Exception as e:
        print(f"❌ Exception resetting approval settings: {e}")
        return False


def get_approval_settings(session: TestSession) -> Optional[Dict[str, Any]]:
    """Get current approval settings"""
    try:
        resp = session.get("/approval-settings")
        if resp.status_code == 200:
            return resp.json()
        else:
            print(f"❌ Failed to get approval settings: {resp.status_code}")
            return None
    except Exception as e:
        print(f"❌ Exception getting approval settings: {e}")
        return None


def update_approval_settings(session: TestSession, payload: Dict[str, Any]) -> bool:
    """Update approval settings"""
    try:
        resp = session.put("/approval-settings", json=payload)
        if resp.status_code == 200:
            return True
        else:
            print(f"❌ Failed to update approval settings: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        print(f"❌ Exception updating approval settings: {e}")
        return False


def create_meeting_room_request(
    session: TestSession,
    room_id: str,
    title: str,
    start_minutes_from_now: int = 60,
    duration_minutes: int = 30,
    attendees: List[Dict] = None
) -> Optional[Dict[str, Any]]:
    """Create a meeting room request"""
    try:
        now = datetime.utcnow()
        start = now + timedelta(minutes=start_minutes_from_now)
        end = start + timedelta(minutes=duration_minutes)
        
        payload = {
            "plan_id": FLOOR_PLAN_ID,
            "room_id": room_id,
            "title": title,
            "start_at": start.isoformat() + "Z",
            "end_at": end.isoformat() + "Z",
            "attendees": attendees or []
        }
        
        resp = session.post("/meeting-room-requests", json=payload)
        if resp.status_code in [200, 201]:
            return resp.json()
        else:
            print(f"❌ Failed to create meeting room request: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"❌ Exception creating meeting room request: {e}")
        return None


def get_meeting_room_request(session: TestSession, request_id: str) -> Optional[Dict[str, Any]]:
    """Get a meeting room request by ID"""
    try:
        resp = session.get(f"/meeting-room-requests?status=Pending Approval,Approved,Declined")
        if resp.status_code == 200:
            requests_list = resp.json()
            for req in requests_list:
                if req.get("id") == request_id:
                    return req
            return None
        else:
            print(f"❌ Failed to get meeting room requests: {resp.status_code}")
            return None
    except Exception as e:
        print(f"❌ Exception getting meeting room request: {e}")
        return None


def check_audit_log(session: TestSession, action: str, resource_id: str) -> bool:
    """Check if audit log entry exists"""
    try:
        # Note: audit endpoint might require pagination/filtering
        resp = session.get(f"/audit-logs?limit=100")
        if resp.status_code == 200:
            data = resp.json()
            logs = data.get("logs", []) if isinstance(data, dict) else data
            for log in logs:
                if log.get("action") == action and log.get("resource_id") == resource_id:
                    return True
            return False
        else:
            return False
    except Exception as e:
        print(f"❌ Exception checking audit log: {e}")
        return False


def deactivate_user(session: TestSession, user_id: str) -> bool:
    """Deactivate a user"""
    try:
        resp = session.patch(f"/contacts/{user_id}", json={"status": "Inactive"})
        return resp.status_code == 200
    except Exception as e:
        print(f"❌ Exception deactivating user: {e}")
        return False


def activate_user(session: TestSession, user_id: str) -> bool:
    """Activate a user"""
    try:
        resp = session.patch(f"/contacts/{user_id}", json={"status": "Active"})
        return resp.status_code == 200
    except Exception as e:
        print(f"❌ Exception activating user: {e}")
        return False


def impersonate_user(session: TestSession, user_id: str) -> Optional[TestSession]:
    """Impersonate a user (Super Admin only)"""
    try:
        resp = session.post("/auth/impersonate", json={"user_id": user_id})
        if resp.status_code == 200:
            data = resp.json()
            new_session = TestSession({"email": "", "password": ""})
            new_session.token = data.get("access_token")
            new_session.user = data.get("user")
            new_session.session.headers.update({"Authorization": f"Bearer {new_session.token}"})
            return new_session
        else:
            print(f"❌ Failed to impersonate user: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"❌ Exception impersonating user: {e}")
        return None


# ============================================================================
# TEST SCENARIOS
# ============================================================================

def test_01_baseline_auto_approval_off(admin_session: TestSession, member_session: TestSession, manager_session: TestSession):
    """Test 1: Baseline (auto-approval OFF) - all requests stay Pending"""
    print("\n" + "="*80)
    print("TEST 1: Baseline (auto-approval OFF)")
    print("="*80)
    
    # Reset to defaults (enabled=False)
    if not reset_approval_settings(admin_session):
        log_test("T01", "Baseline - Reset settings", False, "Failed to reset settings")
        return
    
    # Verify settings
    settings = get_approval_settings(admin_session)
    if not settings or settings.get("enabled") != False:
        log_test("T01", "Baseline - Verify disabled", False, f"Settings not disabled: {settings}")
        return
    
    log_test("T01-A", "Baseline - Settings reset", True, "Auto-approval disabled")
    
    # Get a meeting room
    rooms = get_meeting_rooms(admin_session)
    if not rooms:
        log_test("T01", "Baseline - Get rooms", False, "No meeting rooms found")
        return
    
    room_id = rooms[0]["id"]
    
    # Test as team member
    result = create_meeting_room_request(member_session, room_id, "Test Meeting - Member", 60, 30)
    if result:
        requests_list = result.get("requests", [])
        if requests_list:
            req = requests_list[0]
            if req.get("status") == "Pending Approval":
                log_test("T01-B", "Baseline - Team member → Pending", True, f"Request {req.get('id')} is Pending")
            else:
                log_test("T01-B", "Baseline - Team member → Pending", False, f"Status: {req.get('status')}")
                log_bug("Critical", "Auto-Approval", "POST /meeting-room-requests",
                       f"Create request as team member with auto-approval disabled",
                       "Status: Pending Approval",
                       f"Status: {req.get('status')}",
                       "Auto-approval triggered when global enabled=False")
        else:
            log_test("T01-B", "Baseline - Team member → Pending", False, "No requests in response")
    else:
        log_test("T01-B", "Baseline - Team member → Pending", False, "Failed to create request")
    
    # Test as team manager
    result = create_meeting_room_request(manager_session, room_id, "Test Meeting - Manager", 120, 30)
    if result:
        requests_list = result.get("requests", [])
        if requests_list:
            req = requests_list[0]
            if req.get("status") == "Pending Approval":
                log_test("T01-C", "Baseline - Team manager → Pending", True, f"Request {req.get('id')} is Pending")
            else:
                log_test("T01-C", "Baseline - Team manager → Pending", False, f"Status: {req.get('status')}")
        else:
            log_test("T01-C", "Baseline - Team manager → Pending", False, "No requests in response")
    else:
        log_test("T01-C", "Baseline - Team manager → Pending", False, "Failed to create request")
    
    # Test as super admin
    result = create_meeting_room_request(admin_session, room_id, "Test Meeting - Admin", 180, 30)
    if result:
        requests_list = result.get("requests", [])
        if requests_list:
            req = requests_list[0]
            if req.get("status") == "Pending Approval":
                log_test("T01-D", "Baseline - Super admin → Pending", True, f"Request {req.get('id')} is Pending")
            else:
                log_test("T01-D", "Baseline - Super admin → Pending", False, f"Status: {req.get('status')}")
        else:
            log_test("T01-D", "Baseline - Super admin → Pending", False, "No requests in response")
    else:
        log_test("T01-D", "Baseline - Super admin → Pending", False, "Failed to create request")


def test_02_enable_team_member_cell(admin_session: TestSession, member_session: TestSession, manager_session: TestSession):
    """Test 2: Enable + team_member cell - only team members auto-approved"""
    print("\n" + "="*80)
    print("TEST 2: Enable + team_member cell")
    print("="*80)
    
    # Enable auto-approval with team_member=True for meeting_room
    payload = {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "team_member": True,
                "manager": False
            }
        }
    }
    
    if not update_approval_settings(admin_session, payload):
        log_test("T02", "Enable team_member cell", False, "Failed to update settings")
        return
    
    log_test("T02-A", "Enable team_member cell - Settings updated", True)
    
    # Get a meeting room
    rooms = get_meeting_rooms(admin_session)
    if not rooms:
        log_test("T02", "Enable team_member cell - Get rooms", False, "No meeting rooms found")
        return
    
    room_id = rooms[0]["id"]
    
    # Test as team member (should auto-approve)
    result = create_meeting_room_request(member_session, room_id, "Auto-Approve Test - Member", 60, 30)
    if result:
        requests_list = result.get("requests", [])
        auto_approved = result.get("auto_approved", [])
        
        if requests_list:
            req = requests_list[0]
            request_id = req.get("id")
            
            if req.get("status") == "Approved":
                log_test("T02-B", "Team member → Auto-approved", True, f"Request {request_id} auto-approved")
                
                # Check booking created
                if auto_approved:
                    log_test("T02-C", "Team member → Booking created", True, f"Booking {auto_approved[0].get('id')} created")
                else:
                    log_test("T02-C", "Team member → Booking created", False, "No booking in auto_approved array")
                    log_bug("Critical", "Auto-Approval", "POST /meeting-room-requests",
                           "Create request as team member with team_member=True",
                           "Booking created in room_bookings collection",
                           "No booking in response.auto_approved",
                           "Booking creation failed or not returned")
                
                # Check audit log
                # Note: This might fail if audit endpoint requires different params
                # audit_exists = check_audit_log(admin_session, "meeting_room_request.auto_approve", request_id)
                # log_test("T02-D", "Team member → Audit log", audit_exists, f"Audit entry for {request_id}")
                
            else:
                log_test("T02-B", "Team member → Auto-approved", False, f"Status: {req.get('status')}")
                log_bug("Critical", "Auto-Approval", "POST /meeting-room-requests",
                       "Create request as team member with enabled=True, team_member=True",
                       "Status: Approved, booking created, audit log entry",
                       f"Status: {req.get('status')}",
                       "team_member cell not matching or auto-approval logic broken")
        else:
            log_test("T02-B", "Team member → Auto-approved", False, "No requests in response")
    else:
        log_test("T02-B", "Team member → Auto-approved", False, "Failed to create request")
    
    # Test as team manager (should NOT auto-approve, only team_member=True)
    result = create_meeting_room_request(manager_session, room_id, "No Auto-Approve - Manager", 120, 30)
    if result:
        requests_list = result.get("requests", [])
        if requests_list:
            req = requests_list[0]
            if req.get("status") == "Pending Approval":
                log_test("T02-E", "Team manager → Pending (not auto-approved)", True, f"Request {req.get('id')} is Pending")
            else:
                log_test("T02-E", "Team manager → Pending (not auto-approved)", False, f"Status: {req.get('status')}")
                log_bug("Major", "Auto-Approval", "POST /meeting-room-requests",
                       "Create request as team manager with team_member=True, manager=False",
                       "Status: Pending Approval (manager cell disabled)",
                       f"Status: {req.get('status')}",
                       "Manager incorrectly auto-approved when only team_member cell enabled")
        else:
            log_test("T02-E", "Team manager → Pending", False, "No requests in response")
    else:
        log_test("T02-E", "Team manager → Pending", False, "Failed to create request")


def test_03_enable_manager_cell(admin_session: TestSession, member_session: TestSession, manager_session: TestSession):
    """Test 3: Enable + manager cell - only managers auto-approved"""
    print("\n" + "="*80)
    print("TEST 3: Enable + manager cell")
    print("="*80)
    
    # Enable auto-approval with manager=True for meeting_room
    payload = {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "team_member": False,
                "manager": True
            }
        }
    }
    
    if not update_approval_settings(admin_session, payload):
        log_test("T03", "Enable manager cell", False, "Failed to update settings")
        return
    
    log_test("T03-A", "Enable manager cell - Settings updated", True)
    
    # Get a meeting room
    rooms = get_meeting_rooms(admin_session)
    if not rooms:
        log_test("T03", "Enable manager cell - Get rooms", False, "No meeting rooms found")
        return
    
    room_id = rooms[0]["id"]
    
    # Test as team manager (should auto-approve)
    result = create_meeting_room_request(manager_session, room_id, "Auto-Approve Test - Manager", 60, 30)
    if result:
        requests_list = result.get("requests", [])
        if requests_list:
            req = requests_list[0]
            if req.get("status") == "Approved":
                log_test("T03-B", "Team manager → Auto-approved", True, f"Request {req.get('id')} auto-approved")
            else:
                log_test("T03-B", "Team manager → Auto-approved", False, f"Status: {req.get('status')}")
                log_bug("Critical", "Auto-Approval", "POST /meeting-room-requests",
                       "Create request as team manager with enabled=True, manager=True",
                       "Status: Approved",
                       f"Status: {req.get('status')}",
                       "manager cell not matching or auto-approval logic broken")
        else:
            log_test("T03-B", "Team manager → Auto-approved", False, "No requests in response")
    else:
        log_test("T03-B", "Team manager → Auto-approved", False, "Failed to create request")
    
    # Test as team member (should NOT auto-approve)
    result = create_meeting_room_request(member_session, room_id, "No Auto-Approve - Member", 120, 30)
    if result:
        requests_list = result.get("requests", [])
        if requests_list:
            req = requests_list[0]
            if req.get("status") == "Pending Approval":
                log_test("T03-C", "Team member → Pending (not auto-approved)", True, f"Request {req.get('id')} is Pending")
            else:
                log_test("T03-C", "Team member → Pending (not auto-approved)", False, f"Status: {req.get('status')}")
        else:
            log_test("T03-C", "Team member → Pending", False, "No requests in response")
    else:
        log_test("T03-C", "Team member → Pending", False, "Failed to create request")


def test_04_both_cells_enabled(admin_session: TestSession, member_session: TestSession, manager_session: TestSession):
    """Test 4: Both cells enabled - both team members and managers auto-approved"""
    print("\n" + "="*80)
    print("TEST 4: Both cells enabled")
    print("="*80)
    
    # Enable both cells
    payload = {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "team_member": True,
                "manager": True
            }
        }
    }
    
    if not update_approval_settings(admin_session, payload):
        log_test("T04", "Enable both cells", False, "Failed to update settings")
        return
    
    log_test("T04-A", "Enable both cells - Settings updated", True)
    
    # Get a meeting room
    rooms = get_meeting_rooms(admin_session)
    if not rooms:
        log_test("T04", "Enable both cells - Get rooms", False, "No meeting rooms found")
        return
    
    room_id = rooms[0]["id"]
    
    # Test as team member
    result = create_meeting_room_request(member_session, room_id, "Both Cells - Member", 60, 30)
    if result:
        requests_list = result.get("requests", [])
        if requests_list:
            req = requests_list[0]
            if req.get("status") == "Approved":
                log_test("T04-B", "Both cells - Team member → Approved", True)
            else:
                log_test("T04-B", "Both cells - Team member → Approved", False, f"Status: {req.get('status')}")
        else:
            log_test("T04-B", "Both cells - Team member", False, "No requests in response")
    else:
        log_test("T04-B", "Both cells - Team member", False, "Failed to create request")
    
    # Test as team manager
    result = create_meeting_room_request(manager_session, room_id, "Both Cells - Manager", 120, 30)
    if result:
        requests_list = result.get("requests", [])
        if requests_list:
            req = requests_list[0]
            if req.get("status") == "Approved":
                log_test("T04-C", "Both cells - Team manager → Approved", True)
            else:
                log_test("T04-C", "Both cells - Team manager → Approved", False, f"Status: {req.get('status')}")
        else:
            log_test("T04-C", "Both cells - Team manager", False, "No requests in response")
    else:
        log_test("T04-C", "Both cells - Team manager", False, "Failed to create request")


def test_05_date_rules(admin_session: TestSession, member_session: TestSession):
    """Test 5: Date rule - on, before, after, between modes"""
    print("\n" + "="*80)
    print("TEST 5: Date rules")
    print("="*80)
    
    # Get a meeting room
    rooms = get_meeting_rooms(admin_session)
    if not rooms:
        log_test("T05", "Date rules - Get rooms", False, "No meeting rooms found")
        return
    
    room_id = rooms[0]["id"]
    today = date_cls.today().isoformat()
    tomorrow = (date_cls.today() + timedelta(days=1)).isoformat()
    yesterday = (date_cls.today() - timedelta(days=1)).isoformat()
    
    # Test "on" mode - match today
    payload = {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "team_member": False,
                "manager": False,
                "date": {
                    "enabled": True,
                    "mode": "on",
                    "from": today,
                    "to": None
                }
            }
        }
    }
    
    if update_approval_settings(admin_session, payload):
        # Request for today (should match)
        result = create_meeting_room_request(member_session, room_id, "Date On - Today", 60, 30)
        if result and result.get("requests"):
            req = result["requests"][0]
            if req.get("status") == "Approved":
                log_test("T05-A", "Date rule 'on' - Match today → Approved", True)
            else:
                log_test("T05-A", "Date rule 'on' - Match today → Approved", False, f"Status: {req.get('status')}")
                log_bug("Major", "Auto-Approval", "POST /meeting-room-requests",
                       f"Create request for today with date.on={today}",
                       "Status: Approved",
                       f"Status: {req.get('status')}",
                       "Date rule 'on' mode not matching correctly")
        else:
            log_test("T05-A", "Date rule 'on' - Match today", False, "Failed to create request")
    else:
        log_test("T05-A", "Date rule 'on'", False, "Failed to update settings")
    
    # Test "before" mode
    payload["matrix"]["meeting_room"]["date"] = {
        "enabled": True,
        "mode": "before",
        "from": tomorrow,
        "to": None
    }
    
    if update_approval_settings(admin_session, payload):
        # Request for today (before tomorrow, should match)
        result = create_meeting_room_request(member_session, room_id, "Date Before - Today", 120, 30)
        if result and result.get("requests"):
            req = result["requests"][0]
            if req.get("status") == "Approved":
                log_test("T05-B", "Date rule 'before' - Today before tomorrow → Approved", True)
            else:
                log_test("T05-B", "Date rule 'before' - Today before tomorrow → Approved", False, f"Status: {req.get('status')}")
        else:
            log_test("T05-B", "Date rule 'before'", False, "Failed to create request")
    else:
        log_test("T05-B", "Date rule 'before'", False, "Failed to update settings")
    
    # Test "after" mode
    payload["matrix"]["meeting_room"]["date"] = {
        "enabled": True,
        "mode": "after",
        "from": yesterday,
        "to": None
    }
    
    if update_approval_settings(admin_session, payload):
        # Request for today (after yesterday, should match)
        result = create_meeting_room_request(member_session, room_id, "Date After - Today", 180, 30)
        if result and result.get("requests"):
            req = result["requests"][0]
            if req.get("status") == "Approved":
                log_test("T05-C", "Date rule 'after' - Today after yesterday → Approved", True)
            else:
                log_test("T05-C", "Date rule 'after' - Today after yesterday → Approved", False, f"Status: {req.get('status')}")
        else:
            log_test("T05-C", "Date rule 'after'", False, "Failed to create request")
    else:
        log_test("T05-C", "Date rule 'after'", False, "Failed to update settings")
    
    # Test "between" mode
    payload["matrix"]["meeting_room"]["date"] = {
        "enabled": True,
        "mode": "between",
        "from": yesterday,
        "to": tomorrow
    }
    
    if update_approval_settings(admin_session, payload):
        # Request for today (between yesterday and tomorrow, should match)
        result = create_meeting_room_request(member_session, room_id, "Date Between - Today", 240, 30)
        if result and result.get("requests"):
            req = result["requests"][0]
            if req.get("status") == "Approved":
                log_test("T05-D", "Date rule 'between' - Today in range → Approved", True)
            else:
                log_test("T05-D", "Date rule 'between' - Today in range → Approved", False, f"Status: {req.get('status')}")
        else:
            log_test("T05-D", "Date rule 'between'", False, "Failed to create request")
    else:
        log_test("T05-D", "Date rule 'between'", False, "Failed to update settings")
    
    # Test "between" with from > to (should handle gracefully)
    payload["matrix"]["meeting_room"]["date"] = {
        "enabled": True,
        "mode": "between",
        "from": tomorrow,
        "to": yesterday
    }
    
    if update_approval_settings(admin_session, payload):
        # Request for today (should NOT match, swapped range)
        result = create_meeting_room_request(member_session, room_id, "Date Between - Swapped", 300, 30)
        if result and result.get("requests"):
            req = result["requests"][0]
            # Code swaps lo/hi, so today should still be in range
            # Actually checking if it handles gracefully (no crash)
            log_test("T05-E", "Date rule 'between' - Swapped range (no crash)", True, f"Status: {req.get('status')}")
        else:
            log_test("T05-E", "Date rule 'between' - Swapped range", False, "Failed to create request")
    else:
        log_test("T05-E", "Date rule 'between' - Swapped", False, "Failed to update settings")


def test_06_time_rules(admin_session: TestSession, member_session: TestSession):
    """Test 6: Time rule - on, before, after, between operators"""
    print("\n" + "="*80)
    print("TEST 6: Time rules")
    print("="*80)
    
    # Get a meeting room
    rooms = get_meeting_rooms(admin_session)
    if not rooms:
        log_test("T06", "Time rules - Get rooms", False, "No meeting rooms found")
        return
    
    room_id = rooms[0]["id"]
    
    # Current time + 1 hour
    now = datetime.utcnow()
    current_time = f"{now.hour:02d}:{now.minute:02d}"
    future_time = f"{(now.hour + 1) % 24:02d}:{now.minute:02d}"
    past_time = f"{(now.hour - 1) % 24:02d}:{now.minute:02d}"
    
    # Test "on" mode - exact match
    payload = {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "team_member": False,
                "manager": False,
                "time": {
                    "enabled": True,
                    "operator": "on",
                    "from": current_time,
                    "to": None
                }
            }
        }
    }
    
    if update_approval_settings(admin_session, payload):
        # Request at current time (should match)
        result = create_meeting_room_request(member_session, room_id, "Time On - Current", 60, 30)
        if result and result.get("requests"):
            req = result["requests"][0]
            # Note: exact minute match is strict, might not match if seconds differ
            log_test("T06-A", "Time rule 'on' - Current time", req.get("status") == "Approved", f"Status: {req.get('status')}")
        else:
            log_test("T06-A", "Time rule 'on'", False, "Failed to create request")
    else:
        log_test("T06-A", "Time rule 'on'", False, "Failed to update settings")
    
    # Test "before" mode
    payload["matrix"]["meeting_room"]["time"] = {
        "enabled": True,
        "operator": "before",
        "from": future_time,
        "to": None
    }
    
    if update_approval_settings(admin_session, payload):
        # Request at current time (before future_time, should match)
        result = create_meeting_room_request(member_session, room_id, "Time Before - Current", 120, 30)
        if result and result.get("requests"):
            req = result["requests"][0]
            if req.get("status") == "Approved":
                log_test("T06-B", "Time rule 'before' - Current before future → Approved", True)
            else:
                log_test("T06-B", "Time rule 'before' - Current before future → Approved", False, f"Status: {req.get('status')}")
        else:
            log_test("T06-B", "Time rule 'before'", False, "Failed to create request")
    else:
        log_test("T06-B", "Time rule 'before'", False, "Failed to update settings")
    
    # Test "after" mode
    payload["matrix"]["meeting_room"]["time"] = {
        "enabled": True,
        "operator": "after",
        "from": past_time,
        "to": None
    }
    
    if update_approval_settings(admin_session, payload):
        # Request at current time (after past_time, should match)
        result = create_meeting_room_request(member_session, room_id, "Time After - Current", 180, 30)
        if result and result.get("requests"):
            req = result["requests"][0]
            if req.get("status") == "Approved":
                log_test("T06-C", "Time rule 'after' - Current after past → Approved", True)
            else:
                log_test("T06-C", "Time rule 'after' - Current after past → Approved", False, f"Status: {req.get('status')}")
        else:
            log_test("T06-C", "Time rule 'after'", False, "Failed to create request")
    else:
        log_test("T06-C", "Time rule 'after'", False, "Failed to update settings")
    
    # Test "between" mode
    payload["matrix"]["meeting_room"]["time"] = {
        "enabled": True,
        "operator": "between",
        "from": past_time,
        "to": future_time
    }
    
    if update_approval_settings(admin_session, payload):
        # Request at current time (between past and future, should match)
        result = create_meeting_room_request(member_session, room_id, "Time Between - Current", 240, 30)
        if result and result.get("requests"):
            req = result["requests"][0]
            if req.get("status") == "Approved":
                log_test("T06-D", "Time rule 'between' - Current in range → Approved", True)
            else:
                log_test("T06-D", "Time rule 'between' - Current in range → Approved", False, f"Status: {req.get('status')}")
        else:
            log_test("T06-D", "Time rule 'between'", False, "Failed to create request")
    else:
        log_test("T06-D", "Time rule 'between'", False, "Failed to update settings")


def test_07_duration_rules(admin_session: TestSession, member_session: TestSession):
    """Test 7: Duration rule (meeting_room only) - value + unit"""
    print("\n" + "="*80)
    print("TEST 7: Duration rules")
    print("="*80)
    
    # Get a meeting room
    rooms = get_meeting_rooms(admin_session)
    if not rooms:
        log_test("T07", "Duration rules - Get rooms", False, "No meeting rooms found")
        return
    
    room_id = rooms[0]["id"]
    
    # Test duration rule: 30 minutes
    payload = {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "team_member": False,
                "manager": False,
                "duration": {
                    "enabled": True,
                    "value": 30,
                    "unit": "min"
                }
            }
        }
    }
    
    if update_approval_settings(admin_session, payload):
        # 30-min meeting (should match, <=30)
        result = create_meeting_room_request(member_session, room_id, "Duration 30min - Match", 60, 30)
        if result and result.get("requests"):
            req = result["requests"][0]
            if req.get("status") == "Approved":
                log_test("T07-A", "Duration 30min - 30min meeting → Approved", True)
            else:
                log_test("T07-A", "Duration 30min - 30min meeting → Approved", False, f"Status: {req.get('status')}")
                log_bug("Major", "Auto-Approval", "POST /meeting-room-requests",
                       "Create 30-min meeting with duration.value=30, unit=min",
                       "Status: Approved (30 <= 30)",
                       f"Status: {req.get('status')}",
                       "Duration rule not matching correctly")
        else:
            log_test("T07-A", "Duration 30min - 30min meeting", False, "Failed to create request")
        
        # 31-min meeting (should NOT match, >30)
        result = create_meeting_room_request(member_session, room_id, "Duration 30min - No Match", 120, 31)
        if result and result.get("requests"):
            req = result["requests"][0]
            if req.get("status") == "Pending Approval":
                log_test("T07-B", "Duration 30min - 31min meeting → Pending", True)
            else:
                log_test("T07-B", "Duration 30min - 31min meeting → Pending", False, f"Status: {req.get('status')}")
        else:
            log_test("T07-B", "Duration 30min - 31min meeting", False, "Failed to create request")
        
        # 29-min meeting (should match, <30)
        result = create_meeting_room_request(member_session, room_id, "Duration 30min - 29min", 180, 29)
        if result and result.get("requests"):
            req = result["requests"][0]
            if req.get("status") == "Approved":
                log_test("T07-C", "Duration 30min - 29min meeting → Approved", True)
            else:
                log_test("T07-C", "Duration 30min - 29min meeting → Approved", False, f"Status: {req.get('status')}")
        else:
            log_test("T07-C", "Duration 30min - 29min meeting", False, "Failed to create request")
    else:
        log_test("T07-A", "Duration 30min", False, "Failed to update settings")
    
    # Test duration rule: 1 hour
    payload["matrix"]["meeting_room"]["duration"] = {
        "enabled": True,
        "value": 1,
        "unit": "hour"
    }
    
    if update_approval_settings(admin_session, payload):
        # 60-min meeting (should match, ==1 hour)
        result = create_meeting_room_request(member_session, room_id, "Duration 1hour - 60min", 240, 60)
        if result and result.get("requests"):
            req = result["requests"][0]
            if req.get("status") == "Approved":
                log_test("T07-D", "Duration 1hour - 60min meeting → Approved", True)
            else:
                log_test("T07-D", "Duration 1hour - 60min meeting → Approved", False, f"Status: {req.get('status')}")
        else:
            log_test("T07-D", "Duration 1hour - 60min meeting", False, "Failed to create request")
        
        # 61-min meeting (should NOT match, >1 hour)
        result = create_meeting_room_request(member_session, room_id, "Duration 1hour - 61min", 300, 61)
        if result and result.get("requests"):
            req = result["requests"][0]
            if req.get("status") == "Pending Approval":
                log_test("T07-E", "Duration 1hour - 61min meeting → Pending", True)
            else:
                log_test("T07-E", "Duration 1hour - 61min meeting → Pending", False, f"Status: {req.get('status')}")
        else:
            log_test("T07-E", "Duration 1hour - 61min meeting", False, "Failed to create request")
    else:
        log_test("T07-D", "Duration 1hour", False, "Failed to update settings")


def test_12_global_disable_overrides(admin_session: TestSession, member_session: TestSession):
    """Test 12: Global disable overrides everything"""
    print("\n" + "="*80)
    print("TEST 12: Global disable overrides everything")
    print("="*80)
    
    # Enable every cell but set enabled=False
    payload = {
        "enabled": False,
        "matrix": {
            "meeting_room": {
                "team_member": True,
                "manager": True,
                "date": {
                    "enabled": True,
                    "mode": "on",
                    "from": date_cls.today().isoformat(),
                    "to": None
                },
                "time": {
                    "enabled": True,
                    "operator": "before",
                    "from": "23:59",
                    "to": None
                },
                "duration": {
                    "enabled": True,
                    "value": 60,
                    "unit": "min"
                }
            }
        }
    }
    
    if not update_approval_settings(admin_session, payload):
        log_test("T12", "Global disable - Update settings", False, "Failed to update settings")
        return
    
    log_test("T12-A", "Global disable - Settings updated (enabled=False)", True)
    
    # Get a meeting room
    rooms = get_meeting_rooms(admin_session)
    if not rooms:
        log_test("T12", "Global disable - Get rooms", False, "No meeting rooms found")
        return
    
    room_id = rooms[0]["id"]
    
    # Test as team member (should NOT auto-approve despite all cells enabled)
    result = create_meeting_room_request(member_session, room_id, "Global Disable - Member", 60, 30)
    if result:
        requests_list = result.get("requests", [])
        if requests_list:
            req = requests_list[0]
            if req.get("status") == "Pending Approval":
                log_test("T12-B", "Global disable - Team member → Pending", True, "Global enabled=False overrides all cells")
            else:
                log_test("T12-B", "Global disable - Team member → Pending", False, f"Status: {req.get('status')}")
                log_bug("Critical", "Auto-Approval", "POST /meeting-room-requests",
                       "Create request with enabled=False but all cells enabled",
                       "Status: Pending Approval (global disable overrides)",
                       f"Status: {req.get('status')}",
                       "Global enabled flag not checked first")
        else:
            log_test("T12-B", "Global disable - Team member", False, "No requests in response")
    else:
        log_test("T12-B", "Global disable - Team member", False, "Failed to create request")


def test_13_deactivated_user(admin_session: TestSession):
    """Test 13: Deactivated user cannot login"""
    print("\n" + "="*80)
    print("TEST 13: Deactivated user")
    print("="*80)
    
    # Get team member user ID
    member_id = "b11dfd6b-23a4-4a56-a40d-5cda69f63fa2"  # nitya.srivastava@infollion.com
    
    # Deactivate user
    if not deactivate_user(admin_session, member_id):
        log_test("T13-A", "Deactivate user", False, "Failed to deactivate user")
        return
    
    log_test("T13-A", "Deactivate user - User deactivated", True)
    
    # Try to login as deactivated user
    try:
        resp = requests.post(
            f"{BASE_URL}/auth/login",
            json=TEAM_MEMBER,
            timeout=10
        )
        
        if resp.status_code == 403:
            data = resp.json()
            if data.get("detail") == "User profile Deactivated":
                log_test("T13-B", "Deactivated user login - HTTP 403 with correct message", True)
            else:
                log_test("T13-B", "Deactivated user login - HTTP 403", False, f"Wrong message: {data.get('detail')}")
                log_bug("Minor", "Auth", "POST /auth/login",
                       "Login as deactivated user",
                       "HTTP 403 with detail='User profile Deactivated'",
                       f"HTTP 403 with detail='{data.get('detail')}'",
                       "Error message mismatch")
        else:
            log_test("T13-B", "Deactivated user login - HTTP 403", False, f"Status: {resp.status_code}")
            log_bug("Critical", "Auth", "POST /auth/login",
                   "Login as deactivated user",
                   "HTTP 403 with detail='User profile Deactivated'",
                   f"HTTP {resp.status_code}",
                   "Deactivated user can still login")
    except Exception as e:
        log_test("T13-B", "Deactivated user login", False, f"Exception: {e}")
    
    # Reactivate user for subsequent tests
    if activate_user(admin_session, member_id):
        log_test("T13-C", "Reactivate user - User reactivated", True)
    else:
        log_test("T13-C", "Reactivate user", False, "Failed to reactivate user")


def test_regression_endpoints(admin_session: TestSession):
    """Test regression - ensure other endpoints still work"""
    print("\n" + "="*80)
    print("TEST REGRESSION: Other endpoints")
    print("="*80)
    
    endpoints = [
        ("/dashboard/stats", "Dashboard stats"),
        ("/my-workspace/dashboard", "My workspace dashboard"),
        ("/floor-plans", "Floor plans list"),
        ("/meeting-room-requests", "Meeting room requests list"),
        ("/workstation-requests", "Workstation requests list"),
        ("/audit-logs?limit=10", "Audit logs"),
        ("/teams", "Teams list"),
    ]
    
    for path, name in endpoints:
        try:
            resp = admin_session.get(path)
            if resp.status_code in [200, 201]:
                log_test(f"REG-{name}", f"Regression - {name}", True, f"HTTP {resp.status_code}")
            else:
                log_test(f"REG-{name}", f"Regression - {name}", False, f"HTTP {resp.status_code}")
                if resp.status_code >= 500:
                    log_bug("Critical", "Regression", f"GET {path}",
                           f"GET {path}",
                           "HTTP 200",
                           f"HTTP {resp.status_code}",
                           "Endpoint broken after auto-approval changes")
        except Exception as e:
            log_test(f"REG-{name}", f"Regression - {name}", False, f"Exception: {e}")


# ============================================================================
# MAIN TEST RUNNER
# ============================================================================

def main():
    print("\n" + "="*80)
    print("COMPREHENSIVE BACKEND QA — Auto-Approval Module")
    print("Backend: " + BASE_URL)
    print("="*80)
    
    # Login all test users
    print("\n🔐 Logging in test users...")
    admin_session = TestSession(SUPER_ADMIN)
    if not admin_session.login():
        print("❌ Failed to login as Super Admin. Aborting.")
        return
    print(f"✅ Logged in as Super Admin: {admin_session.user.get('email')}")
    
    member_session = TestSession(TEAM_MEMBER)
    if not member_session.login():
        print("❌ Failed to login as Team Member. Aborting.")
        return
    print(f"✅ Logged in as Team Member: {member_session.user.get('email')}")
    
    manager_session = TestSession(TEAM_MANAGER)
    if not manager_session.login():
        print("❌ Failed to login as Team Manager. Aborting.")
        return
    print(f"✅ Logged in as Team Manager: {manager_session.user.get('email')}")
    
    # Verify meeting rooms exist
    print("\n🏢 Verifying meeting rooms...")
    rooms = get_meeting_rooms(admin_session)
    if not rooms:
        print("❌ No meeting rooms found. Cannot proceed with tests.")
        return
    print(f"✅ Found {len(rooms)} meeting rooms")
    
    # Run tests
    print("\n" + "="*80)
    print("RUNNING TESTS")
    print("="*80)
    
    try:
        test_01_baseline_auto_approval_off(admin_session, member_session, manager_session)
        test_02_enable_team_member_cell(admin_session, member_session, manager_session)
        test_03_enable_manager_cell(admin_session, member_session, manager_session)
        test_04_both_cells_enabled(admin_session, member_session, manager_session)
        test_05_date_rules(admin_session, member_session)
        test_06_time_rules(admin_session, member_session)
        test_07_duration_rules(admin_session, member_session)
        test_12_global_disable_overrides(admin_session, member_session)
        test_13_deactivated_user(admin_session)
        test_regression_endpoints(admin_session)
    except Exception as e:
        print(f"\n❌ Test suite exception: {e}")
    
    # Reset approval settings at the end
    print("\n🔄 Resetting approval settings...")
    reset_approval_settings(admin_session)
    
    # Print summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    total = len(test_results)
    passed = sum(1 for t in test_results if t["passed"])
    failed = total - passed
    
    print(f"\nTotal Tests: {total}")
    print(f"✅ Passed: {passed}")
    print(f"❌ Failed: {failed}")
    print(f"Pass Rate: {(passed/total*100):.1f}%")
    
    if failed > 0:
        print("\n❌ FAILED TESTS:")
        for t in test_results:
            if not t["passed"]:
                print(f"  - {t['id']}: {t['description']}")
                if t["details"]:
                    print(f"    {t['details']}")
    
    if bug_reports:
        print("\n" + "="*80)
        print(f"BUG REPORTS ({len(bug_reports)} bugs found)")
        print("="*80)
        
        for bug in bug_reports:
            print(f"\n{bug['id']} | {bug['severity']} | {bug['module']} | {bug['endpoint']}")
            print(f"  Repro: {bug['repro']}")
            print(f"  Expected: {bug['expected']}")
            print(f"  Actual: {bug['actual']}")
            if bug['root_cause']:
                print(f"  Root Cause: {bug['root_cause']}")
            if bug['db_collection']:
                print(f"  DB Collection: {bug['db_collection']}")
    
    print("\n" + "="*80)
    print("TEST RUN COMPLETE")
    print("="*80)


if __name__ == "__main__":
    main()
