#!/usr/bin/env python3
"""
Profix Module Backend Regression Test
Tests all Profix ticketing endpoints as specified in the review request.

Test sequence (18 steps):
1. Auth - POST /api/auth/login
2. Create ticket - POST /api/tickets
3. Paged list - GET /api/tickets?scope=all&page=1&page_size=50
4. Scope=my - GET /api/tickets?scope=my
5. Scope=unassigned - GET /api/tickets?scope=unassigned
6. Sort by status - GET /api/tickets?sort_by=status&sort_dir=asc
7. Sort by priority - GET /api/tickets?sort_by=priority&sort_dir=asc
8. Search filter - GET /api/tickets?q=<substring>
9. Combined filters - GET /api/tickets?status=Open&priority=Medium
10. Get ticket detail - GET /api/tickets/{id}
11. Patch status - PATCH /api/tickets/{id} {status: "In Progress"}
12. Patch assignment - PATCH /api/tickets/{id} {assigned_to: <user_id>}
13. Add comment - POST /api/tickets/{id}/comments
14. Get activity - GET /api/tickets/{id}/activity
15. Bulk assign - POST /api/tickets/bulk-assign
16. Bulk status - POST /api/tickets/bulk-status
17. CSV export - GET /api/tickets/export.csv?scope=all
18. Team filter - GET /api/tickets?team=<team_id>
"""
import sys
import requests
from typing import Optional

# Backend URL from frontend/.env
BACKEND_URL = "https://d3-segment-anchor.preview.emergentagent.com"
API_BASE = f"{BACKEND_URL}/api"

# Test credentials from /app/memory/test_credentials.md
ADMIN_EMAIL = "admin@ticketing.com"
ADMIN_PASSWORD = "Admin@123"

# Global state
TOKEN: Optional[str] = None
CREATED_TICKET_ID: Optional[str] = None
CREATED_TICKET_SEQ: Optional[str] = None
CREATED_TICKET_SUBJECT: Optional[str] = None
ASSIGNEE_USER_ID: Optional[str] = None
TEAM_ID: Optional[str] = None

# Test results tracking
PASSED = 0
FAILED = 0
FAILURES = []


def log_pass(step: str, message: str = ""):
    """Log a passing test."""
    global PASSED
    PASSED += 1
    print(f"✓ PASS: {step}")
    if message:
        print(f"  {message}")


def log_fail(step: str, message: str):
    """Log a failing test."""
    global FAILED
    FAILED += 1
    FAILURES.append(f"{step}: {message}")
    print(f"✗ FAIL: {step}")
    print(f"  {message}")


def headers() -> dict:
    """Return Authorization headers."""
    return {"Authorization": f"Bearer {TOKEN}"}


def step_1_auth():
    """Step 1: POST /api/auth/login as admin."""
    global TOKEN
    print("\n" + "=" * 80)
    print("STEP 1: AUTH - POST /api/auth/login")
    print("=" * 80)
    
    try:
        resp = requests.post(
            f"{API_BASE}/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=30
        )
        print(f"POST /api/auth/login → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 1: Auth", f"Login failed with status {resp.status_code}: {resp.text}")
            return False
        
        data = resp.json()
        TOKEN = data.get("access_token")
        
        if not TOKEN:
            log_fail("Step 1: Auth", "No access_token in login response")
            return False
        
        log_pass("Step 1: Auth", f"Logged in as {ADMIN_EMAIL}, token: {TOKEN[:20]}...")
        return True
    except Exception as e:
        log_fail("Step 1: Auth", f"Exception: {e}")
        return False


def step_2_create_ticket():
    """Step 2: POST /api/tickets - Create a new ticket."""
    global CREATED_TICKET_ID, CREATED_TICKET_SEQ, CREATED_TICKET_SUBJECT
    print("\n" + "=" * 80)
    print("STEP 2: CREATE TICKET - POST /api/tickets")
    print("=" * 80)
    
    try:
        payload = {
            "description": "Profix regression test ticket - testing team enrichment",
            "priority": "Medium",
            "category": "IT Support",
            "number_of_profiles": 10,
            "due_date": None,
            "attachment_path": None,
            "attachment_name": None,
            "attachments": []
        }
        
        resp = requests.post(
            f"{API_BASE}/tickets",
            json=payload,
            headers=headers(),
            timeout=10
        )
        print(f"POST /api/tickets → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 2: Create ticket", f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
        
        data = resp.json()
        
        # Validate response structure
        required_fields = ["id", "ticket_id", "status", "created_by_id", "priority"]
        missing = [f for f in required_fields if f not in data]
        if missing:
            log_fail("Step 2: Create ticket", f"Missing fields in response: {missing}")
            return False
        
        CREATED_TICKET_ID = data["id"]
        CREATED_TICKET_SEQ = data.get("ticket_id", "")
        CREATED_TICKET_SUBJECT = data.get("description", "")[:20]
        
        # Validate status is Open
        if data["status"] != "Open":
            log_fail("Step 2: Create ticket", f"Expected status='Open', got '{data['status']}'")
            return False
        
        # Admin is not in a team, so team_id/team_name should be null
        if data.get("team_id") is not None or data.get("team_name") is not None:
            log_fail("Step 2: Create ticket", f"Admin not in team but got team_id={data.get('team_id')}, team_name={data.get('team_name')}")
            return False
        
        log_pass("Step 2: Create ticket", 
                f"Created {CREATED_TICKET_SEQ} (id={CREATED_TICKET_ID}), status=Open, team_id=null, team_name=null")
        return True
    except Exception as e:
        log_fail("Step 2: Create ticket", f"Exception: {e}")
        return False


def step_3_paged_list():
    """Step 3: GET /api/tickets?scope=all&page=1&page_size=50."""
    print("\n" + "=" * 80)
    print("STEP 3: PAGED LIST - GET /api/tickets?scope=all&page=1&page_size=50")
    print("=" * 80)
    
    try:
        resp = requests.get(
            f"{API_BASE}/tickets",
            params={"scope": "all", "page": 1, "page_size": 50},
            headers=headers(),
            timeout=10
        )
        print(f"GET /api/tickets?scope=all&page=1&page_size=50 → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 3: Paged list", f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
        
        data = resp.json()
        
        # Validate response structure
        if "items" not in data:
            log_fail("Step 3: Paged list", "Response missing 'items' field")
            return False
        
        items = data["items"]
        
        # Validate every row has required fields
        for idx, item in enumerate(items):
            required = ["status", "priority"]
            missing = [f for f in required if f not in item]
            if missing:
                log_fail("Step 3: Paged list", f"Row {idx} missing fields: {missing}")
                return False
        
        # Check for team_name enrichment (rows where created_by_id matches a team member should have team_name)
        enriched_count = sum(1 for item in items if item.get("team_name") is not None)
        
        log_pass("Step 3: Paged list", 
                f"Returned {len(items)} items, {enriched_count} with team_name enrichment")
        return True
    except Exception as e:
        log_fail("Step 3: Paged list", f"Exception: {e}")
        return False


def step_4_scope_my():
    """Step 4: GET /api/tickets?scope=my - Every item must be created by admin."""
    print("\n" + "=" * 80)
    print("STEP 4: SCOPE=MY - GET /api/tickets?scope=my")
    print("=" * 80)
    
    try:
        resp = requests.get(
            f"{API_BASE}/tickets",
            params={"scope": "my"},
            headers=headers(),
            timeout=10
        )
        print(f"GET /api/tickets?scope=my → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 4: Scope=my", f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
        
        # Response can be array or object with items
        data = resp.json()
        items = data if isinstance(data, list) else data.get("items", [])
        
        # Get admin user ID from token (we need to fetch profile)
        profile_resp = requests.get(f"{API_BASE}/profile/me", headers=headers(), timeout=10)
        if profile_resp.status_code != 200:
            log_fail("Step 4: Scope=my", "Could not fetch admin profile to verify scope")
            return False
        
        admin_profile = profile_resp.json()
        admin_id = admin_profile.get("id")
        admin_role = admin_profile.get("role")
        
        # Verify every item is created by admin
        non_admin_items = [item for item in items if item.get("created_by_id") != admin_id]
        if non_admin_items:
            # NOTE: scope="my" is not handled in backend code (only "mine", "created", "assigned", etc.)
            # For Super Admin with no scope restrictions, this returns all visible tickets
            log_fail("Step 4: Scope=my", 
                    f"BUG: scope='my' not implemented in backend. Found {len(non_admin_items)} items not created by admin (role={admin_role}). Backend only handles scope='mine', not 'my'.")
            return False
        
        log_pass("Step 4: Scope=my", f"All {len(items)} items created by admin")
        return True
    except Exception as e:
        log_fail("Step 4: Scope=my", f"Exception: {e}")
        return False


def step_5_scope_unassigned():
    """Step 5: GET /api/tickets?scope=unassigned - Every item must have assigned_to == null."""
    print("\n" + "=" * 80)
    print("STEP 5: SCOPE=UNASSIGNED - GET /api/tickets?scope=unassigned")
    print("=" * 80)
    
    try:
        resp = requests.get(
            f"{API_BASE}/tickets",
            params={"scope": "unassigned"},
            headers=headers(),
            timeout=10
        )
        print(f"GET /api/tickets?scope=unassigned → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 5: Scope=unassigned", f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
        
        data = resp.json()
        items = data if isinstance(data, list) else data.get("items", [])
        
        # Verify every item has assigned_to == null
        assigned_items = [item for item in items if item.get("assigned_to_id") not in (None, "")]
        if assigned_items:
            log_fail("Step 5: Scope=unassigned", 
                    f"Found {len(assigned_items)} items with assigned_to != null")
            return False
        
        log_pass("Step 5: Scope=unassigned", f"All {len(items)} items have assigned_to=null")
        return True
    except Exception as e:
        log_fail("Step 5: Scope=unassigned", f"Exception: {e}")
        return False


def step_6_sort_by_status():
    """Step 6: GET /api/tickets?sort_by=status&sort_dir=asc - Aggregation pipeline branch."""
    print("\n" + "=" * 80)
    print("STEP 6: SORT BY STATUS - GET /api/tickets?sort_by=status&sort_dir=asc")
    print("=" * 80)
    
    try:
        resp = requests.get(
            f"{API_BASE}/tickets",
            params={"sort_by": "status", "sort_dir": "asc", "page": 1, "page_size": 50},
            headers=headers(),
            timeout=10
        )
        print(f"GET /api/tickets?sort_by=status&sort_dir=asc → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 6: Sort by status", f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
        
        data = resp.json()
        items = data.get("items", [])
        
        if not items:
            log_fail("Step 6: Sort by status", "No items returned")
            return False
        
        # Verify team_name enrichment still works in aggregation pipeline
        enriched_count = sum(1 for item in items if item.get("team_name") is not None)
        
        log_pass("Step 6: Sort by status", 
                f"Returned {len(items)} items, {enriched_count} with team_name enrichment")
        return True
    except Exception as e:
        log_fail("Step 6: Sort by status", f"Exception: {e}")
        return False


def step_7_sort_by_priority():
    """Step 7: GET /api/tickets?sort_by=priority&sort_dir=asc - Priority aggregation branch."""
    print("\n" + "=" * 80)
    print("STEP 7: SORT BY PRIORITY - GET /api/tickets?sort_by=priority&sort_dir=asc")
    print("=" * 80)
    
    try:
        resp = requests.get(
            f"{API_BASE}/tickets",
            params={"sort_by": "priority", "sort_dir": "asc", "page": 1, "page_size": 50},
            headers=headers(),
            timeout=10
        )
        print(f"GET /api/tickets?sort_by=priority&sort_dir=asc → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 7: Sort by priority", f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
        
        data = resp.json()
        items = data.get("items", [])
        
        if not items:
            log_fail("Step 7: Sort by priority", "No items returned")
            return False
        
        # Verify team_name enrichment still works
        enriched_count = sum(1 for item in items if item.get("team_name") is not None)
        
        log_pass("Step 7: Sort by priority", 
                f"Returned {len(items)} items, {enriched_count} with team_name enrichment")
        return True
    except Exception as e:
        log_fail("Step 7: Sort by priority", f"Exception: {e}")
        return False


def step_8_search_filter():
    """Step 8: GET /api/tickets?q=<substring> - Search for created ticket."""
    print("\n" + "=" * 80)
    print("STEP 8: SEARCH FILTER - GET /api/tickets?q=<substring>")
    print("=" * 80)
    
    if not CREATED_TICKET_SUBJECT:
        log_fail("Step 8: Search filter", "No created ticket subject to search for")
        return False
    
    try:
        search_term = "regression test"
        resp = requests.get(
            f"{API_BASE}/tickets",
            params={"q": search_term},
            headers=headers(),
            timeout=10
        )
        print(f"GET /api/tickets?q={search_term} → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 8: Search filter", f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
        
        data = resp.json()
        items = data if isinstance(data, list) else data.get("items", [])
        
        # Verify the created ticket is in the results
        found = any(item.get("id") == CREATED_TICKET_ID for item in items)
        if not found:
            log_fail("Step 8: Search filter", 
                    f"Created ticket {CREATED_TICKET_SEQ} not found in search results")
            return False
        
        log_pass("Step 8: Search filter", 
                f"Found created ticket {CREATED_TICKET_SEQ} in {len(items)} search results")
        return True
    except Exception as e:
        log_fail("Step 8: Search filter", f"Exception: {e}")
        return False


def step_9_combined_filters():
    """Step 9: GET /api/tickets?status=Open&priority=Medium - Combined filters."""
    print("\n" + "=" * 80)
    print("STEP 9: COMBINED FILTERS - GET /api/tickets?status=Open&priority=Medium")
    print("=" * 80)
    
    try:
        resp = requests.get(
            f"{API_BASE}/tickets",
            params={"status": "Open", "priority": "Medium"},
            headers=headers(),
            timeout=10
        )
        print(f"GET /api/tickets?status=Open&priority=Medium → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 9: Combined filters", f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
        
        data = resp.json()
        items = data if isinstance(data, list) else data.get("items", [])
        
        # Verify every item matches both filters
        mismatched = [item for item in items 
                     if item.get("status") != "Open" or item.get("priority") != "Medium"]
        if mismatched:
            log_fail("Step 9: Combined filters", 
                    f"Found {len(mismatched)} items not matching status=Open AND priority=Medium")
            return False
        
        log_pass("Step 9: Combined filters", 
                f"All {len(items)} items match status=Open AND priority=Medium")
        return True
    except Exception as e:
        log_fail("Step 9: Combined filters", f"Exception: {e}")
        return False


def step_10_get_ticket_detail():
    """Step 10: GET /api/tickets/{id} - Get ticket detail."""
    print("\n" + "=" * 80)
    print("STEP 10: GET TICKET DETAIL - GET /api/tickets/{id}")
    print("=" * 80)
    
    if not CREATED_TICKET_ID:
        log_fail("Step 10: Get ticket detail", "No created ticket ID")
        return False
    
    try:
        resp = requests.get(
            f"{API_BASE}/tickets/{CREATED_TICKET_ID}",
            headers=headers(),
            timeout=10
        )
        print(f"GET /api/tickets/{CREATED_TICKET_ID} → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 10: Get ticket detail", f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
        
        data = resp.json()
        
        # Validate full fields present
        required = ["id", "ticket_id", "status", "priority", "created_by_id", "created_on", "updated_on"]
        missing = [f for f in required if f not in data]
        if missing:
            log_fail("Step 10: Get ticket detail", f"Missing fields: {missing}")
            return False
        
        log_pass("Step 10: Get ticket detail", 
                f"Retrieved {data.get('ticket_id')} with all required fields")
        return True
    except Exception as e:
        log_fail("Step 10: Get ticket detail", f"Exception: {e}")
        return False


def step_11_patch_status():
    """Step 11: PATCH /api/tickets/{id} {status: "In Progress"} + verify activity."""
    print("\n" + "=" * 80)
    print("STEP 11: PATCH STATUS - PATCH /api/tickets/{id}")
    print("=" * 80)
    
    if not CREATED_TICKET_ID:
        log_fail("Step 11: Patch status", "No created ticket ID")
        return False
    
    try:
        # Patch status
        resp = requests.patch(
            f"{API_BASE}/tickets/{CREATED_TICKET_ID}",
            json={"status": "In Progress"},
            headers=headers(),
            timeout=10
        )
        print(f"PATCH /api/tickets/{CREATED_TICKET_ID} → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 11: Patch status", f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
        
        data = resp.json()
        
        # Verify status updated
        if data.get("status") != "In Progress":
            log_fail("Step 11: Patch status", 
                    f"Expected status='In Progress', got '{data.get('status')}'")
            return False
        
        # Get activity and verify status change entry
        activity_resp = requests.get(
            f"{API_BASE}/tickets/{CREATED_TICKET_ID}/activity",
            headers=headers(),
            timeout=10
        )
        
        if activity_resp.status_code != 200:
            log_fail("Step 11: Patch status", "Could not fetch activity")
            return False
        
        activity = activity_resp.json()
        status_change = any("Status changed" in item.get("detail", "") for item in activity)
        
        if not status_change:
            log_fail("Step 11: Patch status", "No status change activity entry found")
            return False
        
        log_pass("Step 11: Patch status", 
                f"Status updated to 'In Progress', activity entry created")
        return True
    except Exception as e:
        log_fail("Step 11: Patch status", f"Exception: {e}")
        return False


def step_12_patch_assignment():
    """Step 12: PATCH /api/tickets/{id} {assigned_to: <user_id>} + verify activity."""
    global ASSIGNEE_USER_ID
    print("\n" + "=" * 80)
    print("STEP 12: PATCH ASSIGNMENT - PATCH /api/tickets/{id}")
    print("=" * 80)
    
    if not CREATED_TICKET_ID:
        log_fail("Step 12: Patch assignment", "No created ticket ID")
        return False
    
    try:
        # Get a user to assign to (fetch from contacts)
        contacts_resp = requests.get(
            f"{API_BASE}/contacts",
            params={"page_size": 5, "status": "Active"},
            headers=headers(),
            timeout=10
        )
        
        if contacts_resp.status_code != 200:
            log_fail("Step 12: Patch assignment", "Could not fetch contacts")
            return False
        
        contacts_data = contacts_resp.json()
        contacts = contacts_data if isinstance(contacts_data, list) else contacts_data.get("items", [])
        
        if not contacts:
            log_fail("Step 12: Patch assignment", "No contacts available for assignment")
            return False
        
        ASSIGNEE_USER_ID = contacts[0]["id"]
        assignee_name = contacts[0].get("name", "Unknown")
        
        # Patch assignment
        resp = requests.patch(
            f"{API_BASE}/tickets/{CREATED_TICKET_ID}",
            json={"assigned_to": ASSIGNEE_USER_ID},
            headers=headers(),
            timeout=10
        )
        print(f"PATCH /api/tickets/{CREATED_TICKET_ID} (assign to {assignee_name}) → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 12: Patch assignment", f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
        
        data = resp.json()
        
        # Verify assigned_to populated
        if data.get("assigned_to_id") != ASSIGNEE_USER_ID:
            log_fail("Step 12: Patch assignment", 
                    f"Expected assigned_to_id={ASSIGNEE_USER_ID}, got {data.get('assigned_to_id')}")
            return False
        
        # Get activity and verify assignment entry
        activity_resp = requests.get(
            f"{API_BASE}/tickets/{CREATED_TICKET_ID}/activity",
            headers=headers(),
            timeout=10
        )
        
        if activity_resp.status_code != 200:
            log_fail("Step 12: Patch assignment", "Could not fetch activity")
            return False
        
        activity = activity_resp.json()
        assignment_entry = any("Assigned to" in item.get("detail", "") for item in activity)
        
        if not assignment_entry:
            log_fail("Step 12: Patch assignment", "No assignment activity entry found")
            return False
        
        log_pass("Step 12: Patch assignment", 
                f"Assigned to {assignee_name}, activity entry created")
        return True
    except Exception as e:
        log_fail("Step 12: Patch assignment", f"Exception: {e}")
        return False


def step_13_add_comment():
    """Step 13: POST /api/tickets/{id}/comments + verify in comments list."""
    print("\n" + "=" * 80)
    print("STEP 13: ADD COMMENT - POST /api/tickets/{id}/comments")
    print("=" * 80)
    
    if not CREATED_TICKET_ID:
        log_fail("Step 13: Add comment", "No created ticket ID")
        return False
    
    try:
        comment_body = "Testing comment from Profix regression test"
        
        # Add comment
        resp = requests.post(
            f"{API_BASE}/tickets/{CREATED_TICKET_ID}/comments",
            json={"content": comment_body},
            headers=headers(),
            timeout=10
        )
        print(f"POST /api/tickets/{CREATED_TICKET_ID}/comments → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 13: Add comment", f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
        
        # Get comments and verify
        comments_resp = requests.get(
            f"{API_BASE}/tickets/{CREATED_TICKET_ID}/comments",
            headers=headers(),
            timeout=10
        )
        
        if comments_resp.status_code != 200:
            log_fail("Step 13: Add comment", "Could not fetch comments")
            return False
        
        comments = comments_resp.json()
        found = any(comment_body in item.get("content", "") for item in comments)
        
        if not found:
            log_fail("Step 13: Add comment", "Comment not found in comments list")
            return False
        
        log_pass("Step 13: Add comment", f"Comment added and verified in list ({len(comments)} total)")
        return True
    except Exception as e:
        log_fail("Step 13: Add comment", f"Exception: {e}")
        return False


def step_14_get_activity():
    """Step 14: GET /api/tickets/{id}/activity - Verify all activity entries."""
    print("\n" + "=" * 80)
    print("STEP 14: GET ACTIVITY - GET /api/tickets/{id}/activity")
    print("=" * 80)
    
    if not CREATED_TICKET_ID:
        log_fail("Step 14: Get activity", "No created ticket ID")
        return False
    
    try:
        resp = requests.get(
            f"{API_BASE}/tickets/{CREATED_TICKET_ID}/activity",
            headers=headers(),
            timeout=10
        )
        print(f"GET /api/tickets/{CREATED_TICKET_ID}/activity → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 14: Get activity", f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
        
        activity = resp.json()
        
        # Verify expected activity entries: create, status change (updated), assignment (updated), comment
        # NOTE: PATCH assignment creates action="updated", not "assigned" (bulk-assign uses "assigned")
        expected_entries = {
            "created": False,
            "status_change": False,
            "assignment": False,
            "comment": False
        }
        
        for item in activity:
            action = item.get("action", "")
            detail = item.get("detail", "")
            
            if action == "created":
                expected_entries["created"] = True
            elif action == "updated" and "Status changed" in detail:
                expected_entries["status_change"] = True
            elif action == "updated" and "Assigned to" in detail:
                expected_entries["assignment"] = True
            elif action == "comment":
                expected_entries["comment"] = True
        
        missing = [k for k, v in expected_entries.items() if not v]
        if missing:
            log_fail("Step 14: Get activity", f"Missing activity entries: {missing}")
            return False
        
        log_pass("Step 14: Get activity", 
                f"All expected activity entries present ({len(activity)} total)")
        return True
    except Exception as e:
        log_fail("Step 14: Get activity", f"Exception: {e}")
        return False


def step_15_bulk_assign():
    """Step 15: POST /api/tickets/bulk-assign - Create 2 tickets and bulk assign."""
    print("\n" + "=" * 80)
    print("STEP 15: BULK ASSIGN - POST /api/tickets/bulk-assign")
    print("=" * 80)
    
    if not ASSIGNEE_USER_ID:
        log_fail("Step 15: Bulk assign", "No assignee user ID from previous step")
        return False
    
    try:
        # Create 2 more tickets
        ticket_ids = []
        for i in range(2):
            payload = {
                "description": f"Bulk assign test ticket {i+1}",
                "priority": "Low",
                "category": "IT Support",
                "number_of_profiles": 5,
                "due_date": None,
                "attachment_path": None,
                "attachment_name": None,
                "attachments": []
            }
            
            resp = requests.post(
                f"{API_BASE}/tickets",
                json=payload,
                headers=headers(),
                timeout=10
            )
            
            if resp.status_code != 200:
                log_fail("Step 15: Bulk assign", f"Failed to create test ticket {i+1}")
                return False
            
            ticket_ids.append(resp.json()["id"])
        
        # Bulk assign
        resp = requests.post(
            f"{API_BASE}/tickets/bulk-assign",
            json={"ticket_ids": ticket_ids, "assigned_to": ASSIGNEE_USER_ID},
            headers=headers(),
            timeout=10
        )
        print(f"POST /api/tickets/bulk-assign → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 15: Bulk assign", f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
        
        data = resp.json()
        
        # Verify both updated
        if data.get("assigned") != 2:
            log_fail("Step 15: Bulk assign", f"Expected assigned=2, got {data.get('assigned')}")
            return False
        
        # Verify activity entries for both tickets
        for ticket_id in ticket_ids:
            activity_resp = requests.get(
                f"{API_BASE}/tickets/{ticket_id}/activity",
                headers=headers(),
                timeout=10
            )
            
            if activity_resp.status_code != 200:
                log_fail("Step 15: Bulk assign", f"Could not fetch activity for {ticket_id}")
                return False
            
            activity = activity_resp.json()
            has_assignment = any("Assigned to" in item.get("detail", "") for item in activity)
            
            if not has_assignment:
                log_fail("Step 15: Bulk assign", f"No assignment activity for {ticket_id}")
                return False
        
        log_pass("Step 15: Bulk assign", "2 tickets bulk assigned with activity entries")
        return True
    except Exception as e:
        log_fail("Step 15: Bulk assign", f"Exception: {e}")
        return False


def step_16_bulk_status():
    """Step 16: POST /api/tickets/bulk-status - Bulk close tickets."""
    print("\n" + "=" * 80)
    print("STEP 16: BULK STATUS - POST /api/tickets/bulk-status")
    print("=" * 80)
    
    try:
        # Get 2 Open tickets to close
        resp = requests.get(
            f"{API_BASE}/tickets",
            params={"status": "Open", "page": 1, "page_size": 2},
            headers=headers(),
            timeout=10
        )
        
        if resp.status_code != 200:
            log_fail("Step 16: Bulk status", "Could not fetch Open tickets")
            return False
        
        data = resp.json()
        items = data.get("items", [])
        
        if len(items) < 2:
            log_fail("Step 16: Bulk status", f"Need at least 2 Open tickets, found {len(items)}")
            return False
        
        ticket_ids = [items[0]["id"], items[1]["id"]]
        
        # Bulk status change
        resp = requests.post(
            f"{API_BASE}/tickets/bulk-status",
            json={"ticket_ids": ticket_ids, "status": "Closed"},
            headers=headers(),
            timeout=10
        )
        print(f"POST /api/tickets/bulk-status → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 16: Bulk status", f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
        
        data = resp.json()
        
        # Verify both updated
        if data.get("updated") != 2:
            log_fail("Step 16: Bulk status", f"Expected updated=2, got {data.get('updated')}")
            return False
        
        log_pass("Step 16: Bulk status", "2 tickets bulk closed")
        return True
    except Exception as e:
        log_fail("Step 16: Bulk status", f"Exception: {e}")
        return False


def step_17_csv_export():
    """Step 17: GET /api/tickets/export.csv?scope=all - Verify CSV format."""
    print("\n" + "=" * 80)
    print("STEP 17: CSV EXPORT - GET /api/tickets/export.csv?scope=all")
    print("=" * 80)
    
    try:
        resp = requests.get(
            f"{API_BASE}/tickets/export.csv",
            params={"scope": "all"},
            headers=headers(),
            timeout=10
        )
        print(f"GET /api/tickets/export.csv?scope=all → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 17: CSV export", f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
        
        # Verify content-type
        content_type = resp.headers.get("content-type", "")
        if "text/csv" not in content_type:
            log_fail("Step 17: CSV export", f"Expected content-type text/csv, got {content_type}")
            return False
        
        # Verify CSV structure
        csv_text = resp.text
        lines = csv_text.strip().split("\n")
        
        if len(lines) < 2:
            log_fail("Step 17: CSV export", "CSV has no data rows")
            return False
        
        # Verify header
        header = lines[0]
        expected_columns = ["Ticket ID", "Status", "Priority", "Created By", "Team"]
        for col in expected_columns:
            if col not in header:
                log_fail("Step 17: CSV export", f"CSV header missing column: {col}")
                return False
        
        # Verify at least 1 data row
        data_rows = len(lines) - 1
        
        # Check for team column population
        team_col_idx = header.split(",").index("Team") if "Team" in header else -1
        if team_col_idx >= 0:
            team_populated = sum(1 for line in lines[1:] 
                               if len(line.split(",")) > team_col_idx 
                               and line.split(",")[team_col_idx].strip() not in ("", "—"))
            log_pass("Step 17: CSV export", 
                    f"CSV has {data_rows} data rows, {team_populated} with team populated")
        else:
            log_pass("Step 17: CSV export", f"CSV has {data_rows} data rows")
        
        return True
    except Exception as e:
        log_fail("Step 17: CSV export", f"Exception: {e}")
        return False


def step_18_team_filter():
    """Step 18: GET /api/tickets?team=<team_id> - Team filter regression."""
    global TEAM_ID
    print("\n" + "=" * 80)
    print("STEP 18: TEAM FILTER - GET /api/tickets?team=<team_id>")
    print("=" * 80)
    
    try:
        # Get a team ID
        teams_resp = requests.get(
            f"{API_BASE}/teams",
            headers=headers(),
            timeout=10
        )
        
        if teams_resp.status_code != 200:
            log_fail("Step 18: Team filter", "Could not fetch teams")
            return False
        
        teams = teams_resp.json()
        if not teams:
            log_fail("Step 18: Team filter", "No teams available")
            return False
        
        TEAM_ID = teams[0]["id"]
        team_name = teams[0].get("name", "Unknown")
        
        # Filter by team
        resp = requests.get(
            f"{API_BASE}/tickets",
            params={"team": TEAM_ID},
            headers=headers(),
            timeout=10
        )
        print(f"GET /api/tickets?team={TEAM_ID} ({team_name}) → {resp.status_code}")
        
        if resp.status_code != 200:
            log_fail("Step 18: Team filter", f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
        
        data = resp.json()
        items = data if isinstance(data, list) else data.get("items", [])
        
        log_pass("Step 18: Team filter", 
                f"Team filter returned {len(items)} tickets for team '{team_name}'")
        return True
    except Exception as e:
        log_fail("Step 18: Team filter", f"Exception: {e}")
        return False


def main():
    """Run all test steps."""
    print("\n" + "=" * 80)
    print("PROFIX MODULE BACKEND REGRESSION TEST")
    print("=" * 80)
    print(f"Backend URL: {BACKEND_URL}")
    print(f"Admin: {ADMIN_EMAIL}")
    print("=" * 80)
    
    # Run all steps
    steps = [
        step_1_auth,
        step_2_create_ticket,
        step_3_paged_list,
        step_4_scope_my,
        step_5_scope_unassigned,
        step_6_sort_by_status,
        step_7_sort_by_priority,
        step_8_search_filter,
        step_9_combined_filters,
        step_10_get_ticket_detail,
        step_11_patch_status,
        step_12_patch_assignment,
        step_13_add_comment,
        step_14_get_activity,
        step_15_bulk_assign,
        step_16_bulk_status,
        step_17_csv_export,
        step_18_team_filter,
    ]
    
    for step_func in steps:
        if not step_func():
            # Continue even if a step fails
            pass
    
    # Print summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"PASSED: {PASSED}/18")
    print(f"FAILED: {FAILED}/18")
    
    if FAILURES:
        print("\nFAILURES:")
        for failure in FAILURES:
            print(f"  - {failure}")
    
    print("=" * 80)
    
    # Exit with appropriate code
    sys.exit(0 if FAILED == 0 else 1)


if __name__ == "__main__":
    main()
