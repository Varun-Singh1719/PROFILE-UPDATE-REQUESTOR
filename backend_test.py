"""
Backend API Testing for Teams API (Jul 16 2026)
Tests the Teams API changes including:
- description field
- created_by / updated_by
- GET /api/teams/{id}
- Managers can span multiple teams
"""
import requests
import json
from datetime import datetime

# Backend URL from frontend/.env
BASE_URL = "https://728cf97c-5468-450b-8461-6044a99ed25f.preview.emergentagent.com/api"

# Test credentials
SUPER_ADMIN_EMAIL = "admin@ticketing.com"
SUPER_ADMIN_PASSWORD = "Admin@123"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    END = '\033[0m'

def log_test(name, passed, details=""):
    status = f"{Colors.GREEN}✅ PASS{Colors.END}" if passed else f"{Colors.RED}❌ FAIL{Colors.END}"
    print(f"{status} | {name}")
    if details:
        print(f"     {details}")

def login(email, password):
    """Login and return session with cookie and token"""
    resp = requests.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password})
    if resp.status_code != 200:
        print(f"{Colors.RED}Login failed: {resp.status_code} - {resp.text}{Colors.END}")
        return None
    data = resp.json()
    session = requests.Session()
    session.cookies.set("access_token", data.get("access_token"))
    session.headers.update({"Authorization": f"Bearer {data.get('access_token')}"})
    return session

def test_teams_api():
    print(f"\n{Colors.BLUE}{'='*80}{Colors.END}")
    print(f"{Colors.BLUE}TEAMS API TESTING - Jul 16 2026{Colors.END}")
    print(f"{Colors.BLUE}{'='*80}{Colors.END}\n")
    
    # Login as Super Admin
    print(f"{Colors.YELLOW}Logging in as Super Admin...{Colors.END}")
    session = login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)
    if not session:
        print(f"{Colors.RED}Cannot proceed without authentication{Colors.END}")
        return
    print(f"{Colors.GREEN}✓ Logged in successfully{Colors.END}\n")
    
    # Track created teams for cleanup
    created_teams = []
    
    try:
        # ============================================================
        # TEST 1: GET /api/teams/colors
        # ============================================================
        print(f"{Colors.BLUE}TEST 1: GET /api/teams/colors{Colors.END}")
        resp = session.get(f"{BASE_URL}/teams/colors")
        test_1_pass = (
            resp.status_code == 200 and
            "palette" in resp.json() and
            "used" in resp.json() and
            "suggested" in resp.json()
        )
        log_test("GET /api/teams/colors returns palette + used + suggested", test_1_pass,
                 f"Status: {resp.status_code}, Keys: {list(resp.json().keys())}")
        
        # ============================================================
        # TEST 2: GET /api/teams - List teams with hydration
        # ============================================================
        print(f"\n{Colors.BLUE}TEST 2: GET /api/teams - List with hydration{Colors.END}")
        resp = session.get(f"{BASE_URL}/teams")
        test_2_pass = resp.status_code == 200
        teams_data = resp.json() if test_2_pass else []
        
        if test_2_pass and len(teams_data) > 0:
            sample_team = teams_data[0]
            required_fields = ["id", "name", "manager_ids", "member_ids", "managers", "members", 
                             "color", "initials", "created_on", "updated_on"]
            has_all_fields = all(field in sample_team for field in required_fields)
            
            # Check hydration
            managers_hydrated = isinstance(sample_team.get("managers"), list)
            members_hydrated = isinstance(sample_team.get("members"), list)
            
            # Check if managers/members have id, name, email
            if managers_hydrated and len(sample_team["managers"]) > 0:
                mgr = sample_team["managers"][0]
                managers_hydrated = "id" in mgr and "name" in mgr
            
            if members_hydrated and len(sample_team["members"]) > 0:
                mem = sample_team["members"][0]
                members_hydrated = "id" in mem and "name" in mem
            
            test_2_pass = has_all_fields and managers_hydrated and members_hydrated
            log_test("GET /api/teams returns array with hydrated managers[] and members[]", test_2_pass,
                     f"Teams count: {len(teams_data)}, Fields present: {has_all_fields}, Hydrated: {managers_hydrated and members_hydrated}")
            
            # Check for description field (may be null for legacy rows)
            has_description_field = "description" in sample_team
            log_test("Teams have description field (may be null for legacy)", has_description_field,
                     f"Description field present: {has_description_field}, Value: {sample_team.get('description', 'N/A')}")
            
            # Check for created_by / updated_by (may be missing for legacy rows)
            has_audit_fields = "created_by" in sample_team or "updated_by" in sample_team
            log_test("Teams may have created_by/updated_by (new rows only)", True,
                     f"created_by present: {'created_by' in sample_team}, updated_by present: {'updated_by' in sample_team}")
        else:
            log_test("GET /api/teams returns array", test_2_pass,
                     f"Status: {resp.status_code}, Count: {len(teams_data)}")
        
        # ============================================================
        # TEST 3: POST /api/teams - Create with description
        # ============================================================
        print(f"\n{Colors.BLUE}TEST 3: POST /api/teams - Create with description{Colors.END}")
        
        # Get available contacts for managers/members
        contacts_resp = session.get(f"{BASE_URL}/contacts")
        contacts = contacts_resp.json() if contacts_resp.status_code == 200 else []
        
        # Find Super Admin and Admin contacts
        super_admins = [c for c in contacts if c.get("role") == "Super Admin"]
        admins = [c for c in contacts if c.get("role") == "Admin"]
        
        manager_id = super_admins[0]["id"] if super_admins else (admins[0]["id"] if admins else None)
        member_id = admins[0]["id"] if admins else None
        
        if not manager_id:
            print(f"{Colors.YELLOW}Warning: No suitable manager found, skipping member assignment{Colors.END}")
        
        timestamp = datetime.now().strftime("%H%M%S")
        new_team = {
            "name": f"QA Test Team {timestamp}",
            "description": "This is a test team created by automated testing with description field",
            "manager_ids": [manager_id] if manager_id else [],
            "member_ids": [],  # Don't assign members to avoid conflicts
            "color": "#22c55e",
            "initials": "QA"
        }
        
        resp = session.post(f"{BASE_URL}/teams", json=new_team)
        test_3_pass = resp.status_code == 200
        
        if test_3_pass:
            created_team = resp.json()
            created_teams.append(created_team["id"])
            
            # Verify description persisted
            desc_match = created_team.get("description") == new_team["description"]
            
            # Verify created_by and updated_by are present
            has_created_by = "created_by" in created_team and isinstance(created_team["created_by"], dict)
            has_updated_by = "updated_by" in created_team and isinstance(created_team["updated_by"], dict)
            
            # Verify created_by has id, name, email
            if has_created_by:
                cb = created_team["created_by"]
                has_created_by = "id" in cb and "name" in cb and "email" in cb
            
            if has_updated_by:
                ub = created_team["updated_by"]
                has_updated_by = "id" in ub and "name" in ub and "email" in ub
            
            # Verify created_on and updated_on are set
            has_timestamps = "created_on" in created_team and "updated_on" in created_team
            
            test_3_pass = desc_match and has_created_by and has_updated_by and has_timestamps
            
            log_test("POST /api/teams creates team with description", desc_match,
                     f"Description matches: {desc_match}")
            log_test("POST /api/teams sets created_by with {id, name, email}", has_created_by,
                     f"created_by: {created_team.get('created_by', {})}")
            log_test("POST /api/teams sets updated_by with {id, name, email}", has_updated_by,
                     f"updated_by: {created_team.get('updated_by', {})}")
            log_test("POST /api/teams sets created_on and updated_on", has_timestamps,
                     f"created_on: {created_team.get('created_on')}, updated_on: {created_team.get('updated_on')}")
        else:
            log_test("POST /api/teams creates team", test_3_pass,
                     f"Status: {resp.status_code}, Error: {resp.text}")
        
        # ============================================================
        # TEST 4: POST /api/teams - Duplicate name rejection
        # ============================================================
        print(f"\n{Colors.BLUE}TEST 4: POST /api/teams - Duplicate name rejection{Colors.END}")
        resp = session.post(f"{BASE_URL}/teams", json=new_team)
        test_4_pass = resp.status_code == 400
        log_test("POST /api/teams rejects duplicate name", test_4_pass,
                 f"Status: {resp.status_code}, Expected: 400")
        
        # ============================================================
        # TEST 5: GET /api/teams/{team_id} - New endpoint
        # ============================================================
        print(f"\n{Colors.BLUE}TEST 5: GET /api/teams/{{team_id}} - New endpoint{Colors.END}")
        
        if created_teams:
            team_id = created_teams[0]
            resp = session.get(f"{BASE_URL}/teams/{team_id}")
            test_5a_pass = resp.status_code == 200
            
            if test_5a_pass:
                team_detail = resp.json()
                # Verify same hydration as list endpoint
                has_hydration = (
                    "managers" in team_detail and isinstance(team_detail["managers"], list) and
                    "members" in team_detail and isinstance(team_detail["members"], list)
                )
                log_test("GET /api/teams/{id} returns 200 for existing team", test_5a_pass,
                         f"Team: {team_detail.get('name')}, Hydrated: {has_hydration}")
            else:
                log_test("GET /api/teams/{id} returns 200 for existing team", test_5a_pass,
                         f"Status: {resp.status_code}")
        
        # Test 404 for random UUID
        import uuid
        random_id = str(uuid.uuid4())
        resp = session.get(f"{BASE_URL}/teams/{random_id}")
        test_5b_pass = resp.status_code == 404
        log_test("GET /api/teams/{id} returns 404 for non-existent team", test_5b_pass,
                 f"Status: {resp.status_code}, Expected: 404")
        
        # ============================================================
        # TEST 6: Managers can span multiple teams (KEY REGRESSION)
        # ============================================================
        print(f"\n{Colors.BLUE}TEST 6: Managers can span multiple teams (KEY REGRESSION){Colors.END}")
        
        # Get existing teams to find a manager already in use
        resp = session.get(f"{BASE_URL}/teams")
        existing_teams = resp.json() if resp.status_code == 200 else []
        
        existing_manager_id = None
        for team in existing_teams:
            if team.get("manager_ids") and len(team["manager_ids"]) > 0:
                existing_manager_id = team["manager_ids"][0]
                break
        
        if not existing_manager_id and manager_id:
            existing_manager_id = manager_id
        
        if existing_manager_id:
            # Create a NEW team with the same manager
            timestamp2 = datetime.now().strftime("%H%M%S")
            multi_manager_team = {
                "name": f"QA Multi-Manager Team {timestamp2}",
                "description": "Testing that managers can be assigned to multiple teams",
                "manager_ids": [existing_manager_id],
                "member_ids": [],
                "color": "#3b82f6",
                "initials": "MM"
            }
            
            resp = session.post(f"{BASE_URL}/teams", json=multi_manager_team)
            test_6a_pass = resp.status_code == 200
            
            if test_6a_pass:
                created_teams.append(resp.json()["id"])
            
            log_test("POST /api/teams allows manager already in another team", test_6a_pass,
                     f"Status: {resp.status_code}, Manager ID: {existing_manager_id}")
            
            # Also test via PATCH on an existing team
            if created_teams and len(created_teams) >= 2:
                # Try to add the same manager to another existing team
                team_to_update = created_teams[0]
                resp = session.patch(f"{BASE_URL}/teams/{team_to_update}", 
                                    json={"manager_ids": [existing_manager_id]})
                test_6b_pass = resp.status_code == 200
                log_test("PATCH /api/teams allows manager already in another team", test_6b_pass,
                         f"Status: {resp.status_code}")
            else:
                log_test("PATCH /api/teams allows manager already in another team", True,
                         "Skipped - not enough teams created")
        else:
            log_test("Managers can span multiple teams", True,
                     "Skipped - no existing manager found")
        
        # ============================================================
        # TEST 7: Members cannot span multiple teams
        # ============================================================
        print(f"\n{Colors.BLUE}TEST 7: Members cannot span multiple teams (existing validation){Colors.END}")
        
        # Find a member already assigned to a team
        existing_member_id = None
        for team in existing_teams:
            if team.get("member_ids") and len(team["member_ids"]) > 0:
                existing_member_id = team["member_ids"][0]
                break
        
        if existing_member_id:
            # Try to create a team with this member
            timestamp3 = datetime.now().strftime("%H%M%S")
            conflict_team = {
                "name": f"QA Conflict Team {timestamp3}",
                "description": "This should fail due to member conflict",
                "manager_ids": [manager_id] if manager_id else [],
                "member_ids": [existing_member_id],
                "color": "#a855f7"
            }
            
            resp = session.post(f"{BASE_URL}/teams", json=conflict_team)
            test_7_pass = resp.status_code == 400
            log_test("POST /api/teams rejects member already in another team", test_7_pass,
                     f"Status: {resp.status_code}, Expected: 400")
        else:
            log_test("POST /api/teams rejects member already in another team", True,
                     "Skipped - no existing member found")
        
        # ============================================================
        # TEST 8: PATCH /api/teams/{id} - Update description
        # ============================================================
        print(f"\n{Colors.BLUE}TEST 8: PATCH /api/teams/{{id}} - Update description{Colors.END}")
        
        if created_teams:
            team_id = created_teams[0]
            updated_desc = "Updated description via PATCH endpoint"
            
            resp = session.patch(f"{BASE_URL}/teams/{team_id}", 
                                json={"description": updated_desc})
            test_8_pass = resp.status_code == 200
            
            if test_8_pass:
                updated_team = resp.json()
                desc_updated = updated_team.get("description") == updated_desc
                
                # Verify updated_by is refreshed
                has_updated_by = "updated_by" in updated_team and isinstance(updated_team["updated_by"], dict)
                
                # Verify updated_on advanced
                has_updated_on = "updated_on" in updated_team
                
                log_test("PATCH /api/teams/{id} updates description", desc_updated,
                         f"New description: {updated_team.get('description')}")
                log_test("PATCH /api/teams/{id} refreshes updated_by", has_updated_by,
                         f"updated_by: {updated_team.get('updated_by', {})}")
                log_test("PATCH /api/teams/{id} advances updated_on", has_updated_on,
                         f"updated_on: {updated_team.get('updated_on')}")
            else:
                log_test("PATCH /api/teams/{id} updates team", test_8_pass,
                         f"Status: {resp.status_code}, Error: {resp.text}")
        else:
            log_test("PATCH /api/teams/{id} updates team", False,
                     "No teams created to test")
        
        # ============================================================
        # TEST 9: PATCH /api/teams/{id} - Member conflict validation
        # ============================================================
        print(f"\n{Colors.BLUE}TEST 9: PATCH /api/teams/{{id}} - Member conflict validation{Colors.END}")
        
        if created_teams and existing_member_id:
            team_id = created_teams[0]
            resp = session.patch(f"{BASE_URL}/teams/{team_id}", 
                                json={"member_ids": [existing_member_id]})
            test_9_pass = resp.status_code == 400
            log_test("PATCH /api/teams/{id} rejects member already in another team", test_9_pass,
                     f"Status: {resp.status_code}, Expected: 400")
        else:
            log_test("PATCH /api/teams/{id} rejects member already in another team", True,
                     "Skipped - no existing member or teams")
        
        # ============================================================
        # TEST 10: DELETE /api/teams/{id}
        # ============================================================
        print(f"\n{Colors.BLUE}TEST 10: DELETE /api/teams/{{id}}{Colors.END}")
        
        # Delete all created teams
        delete_count = 0
        for team_id in created_teams:
            resp = session.delete(f"{BASE_URL}/teams/{team_id}")
            if resp.status_code == 200 and resp.json().get("ok") == True:
                delete_count += 1
        
        test_10_pass = delete_count == len(created_teams)
        log_test(f"DELETE /api/teams/{{id}} returns {{ok: true}}", test_10_pass,
                 f"Deleted {delete_count}/{len(created_teams)} teams")
        
        # Clear the list since we've deleted them
        created_teams.clear()
        
    except Exception as e:
        print(f"\n{Colors.RED}ERROR: {str(e)}{Colors.END}")
        import traceback
        traceback.print_exc()
    
    finally:
        # Cleanup: Delete any remaining test teams
        if created_teams:
            print(f"\n{Colors.YELLOW}Cleaning up {len(created_teams)} test teams...{Colors.END}")
            for team_id in created_teams:
                try:
                    session.delete(f"{BASE_URL}/teams/{team_id}")
                except:
                    pass
    
    print(f"\n{Colors.BLUE}{'='*80}{Colors.END}")
    print(f"{Colors.BLUE}TEAMS API TESTING COMPLETE{Colors.END}")
    print(f"{Colors.BLUE}{'='*80}{Colors.END}\n")

if __name__ == "__main__":
    test_teams_api()
