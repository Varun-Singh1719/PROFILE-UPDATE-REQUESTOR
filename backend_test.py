#!/usr/bin/env python3
"""
Backend API Testing for Admin/Manager Module Enhancements
Tests all backend endpoints for the ticketing system.
"""

import requests
import json
import sys
from typing import Optional, Dict, Any

# Backend URL from environment
BASE_URL = "https://workstation-hub-6.preview.emergentagent.com/api"

# Test credentials
ADMIN_EMAIL = "admin@ticketing.com"
ADMIN_PASSWORD = "Admin@123"
MANAGER_EMAIL = "manager@ticketing.com"
MANAGER_PASSWORD = "Test@123"
DQ_EMAIL = "dq1@ticketing.com"
DQ_PASSWORD = "Test@123"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'
    BOLD = '\033[1m'

def print_test(name: str):
    print(f"\n{Colors.BLUE}{Colors.BOLD}Testing: {name}{Colors.RESET}")

def print_pass(msg: str):
    print(f"{Colors.GREEN}✓ PASS: {msg}{Colors.RESET}")

def print_fail(msg: str):
    print(f"{Colors.RED}✗ FAIL: {msg}{Colors.RESET}")

def print_info(msg: str):
    print(f"{Colors.YELLOW}ℹ INFO: {msg}{Colors.RESET}")

class TestSession:
    def __init__(self):
        self.admin_token = None
        self.manager_token = None
        self.dq_token = None
        self.test_contact_id = None
        self.test_team_id = None
        self.test_ticket_id = None
        self.failures = []
        self.passes = []

    def login(self, email: str, password: str) -> Optional[str]:
        """Login and return access token"""
        try:
            resp = requests.post(f"{BASE_URL}/auth/login", json={
                "email": email,
                "password": password
            }, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                return data.get("access_token")
            else:
                print_fail(f"Login failed for {email}: {resp.status_code} - {resp.text}")
                return None
        except Exception as e:
            print_fail(f"Login exception for {email}: {e}")
            return None

    def get_headers(self, token: str) -> Dict[str, str]:
        """Get authorization headers"""
        return {"Authorization": f"Bearer {token}"}

    def test_auth_migration(self):
        """Test 1: Auth migration - login and verify role field"""
        print_test("Auth Migration: Login as Admin and Manager, verify role field")
        
        # Login as Admin
        self.admin_token = self.login(ADMIN_EMAIL, ADMIN_PASSWORD)
        if not self.admin_token:
            self.failures.append("Admin login failed")
            return
        print_pass(f"Admin login successful")
        
        # Verify /api/auth/me returns role field
        try:
            resp = requests.get(f"{BASE_URL}/auth/me", 
                              headers=self.get_headers(self.admin_token), 
                              timeout=30)
            if resp.status_code == 200:
                user = resp.json()
                if "role" in user and user["role"] == "Admin":
                    print_pass(f"Admin /auth/me returns role='Admin' (not 'type')")
                    self.passes.append("Admin auth/me has role field")
                else:
                    print_fail(f"Admin /auth/me missing 'role' field or wrong value: {user}")
                    self.failures.append("Admin auth/me role field issue")
                
                # Check that 'type' field is NOT present
                if "type" in user:
                    print_fail(f"Admin /auth/me still has 'type' field (should be migrated to 'role')")
                    self.failures.append("Admin auth/me has legacy 'type' field")
                else:
                    print_pass("Admin /auth/me does not have legacy 'type' field")
            else:
                print_fail(f"Admin /auth/me failed: {resp.status_code}")
                self.failures.append("Admin auth/me endpoint failed")
        except Exception as e:
            print_fail(f"Admin /auth/me exception: {e}")
            self.failures.append(f"Admin auth/me exception: {e}")
        
        # Login as Manager
        self.manager_token = self.login(MANAGER_EMAIL, MANAGER_PASSWORD)
        if not self.manager_token:
            self.failures.append("Manager login failed")
            return
        print_pass(f"Manager login successful")
        
        # Verify Manager has role="Manager"
        try:
            resp = requests.get(f"{BASE_URL}/auth/me", 
                              headers=self.get_headers(self.manager_token), 
                              timeout=30)
            if resp.status_code == 200:
                user = resp.json()
                if "role" in user and user["role"] == "Manager":
                    print_pass(f"Manager /auth/me returns role='Manager'")
                    self.passes.append("Manager auth/me has role=Manager")
                else:
                    print_fail(f"Manager /auth/me wrong role: {user.get('role')}")
                    self.failures.append("Manager role not set correctly")
            else:
                print_fail(f"Manager /auth/me failed: {resp.status_code}")
                self.failures.append("Manager auth/me endpoint failed")
        except Exception as e:
            print_fail(f"Manager /auth/me exception: {e}")
            self.failures.append(f"Manager auth/me exception: {e}")

    def test_contacts_enriched_fields(self):
        """Test 2: GET /api/contacts returns enriched fields"""
        print_test("Contacts: GET /api/contacts with enriched fields")
        
        if not self.admin_token:
            print_fail("Admin token not available, skipping")
            self.failures.append("Contacts test skipped - no admin token")
            return
        
        try:
            resp = requests.get(f"{BASE_URL}/contacts", 
                              headers=self.get_headers(self.admin_token), 
                              timeout=30)
            if resp.status_code == 200:
                contacts = resp.json()
                if len(contacts) > 0:
                    contact = contacts[0]
                    # Check for new enriched fields
                    required_fields = ["team_id", "team_name", "team_color", "manager_names", "emp_id", "doj"]
                    missing = [f for f in required_fields if f not in contact]
                    if not missing:
                        print_pass(f"Contact has all enriched fields: {required_fields}")
                        self.passes.append("Contacts have enriched fields")
                        print_info(f"Sample contact enrichment: team_name={contact.get('team_name')}, emp_id={contact.get('emp_id')}, doj={contact.get('doj')}")
                    else:
                        print_fail(f"Contact missing enriched fields: {missing}")
                        self.failures.append(f"Contacts missing fields: {missing}")
                else:
                    print_info("No contacts found to verify enrichment")
            else:
                print_fail(f"GET /contacts failed: {resp.status_code} - {resp.text}")
                self.failures.append("GET /contacts failed")
        except Exception as e:
            print_fail(f"GET /contacts exception: {e}")
            self.failures.append(f"GET /contacts exception: {e}")

    def test_create_contact_with_password(self):
        """Test 3: POST /api/contacts with auto-generated password"""
        print_test("Contacts: POST /api/contacts with auto-generated password")
        
        if not self.admin_token:
            print_fail("Admin token not available, skipping")
            self.failures.append("Create contact test skipped - no admin token")
            return
        
        try:
            # Create a new contact
            new_contact = {
                "email": f"test.user.{requests.utils.quote('test')}@ticketing.com",
                "name": "Test User",
                "phone": "1234567890",
                "role": "DQ Team",
                "emp_id": "EMP-TEST-001",
                "doj": "2024-01-15"
            }
            
            resp = requests.post(f"{BASE_URL}/contacts", 
                               json=new_contact,
                               headers=self.get_headers(self.admin_token), 
                               timeout=30)
            
            if resp.status_code == 200:
                data = resp.json()
                # Check for generated_password
                if "generated_password" in data:
                    pwd = data["generated_password"]
                    if len(pwd) >= 12:
                        print_pass(f"Contact created with generated password (length={len(pwd)})")
                        self.passes.append("Contact creation with auto-generated password")
                        self.test_contact_id = data.get("id")
                        print_info(f"Generated password: {pwd}")
                        
                        # Verify password_hash and password_encrypted are NOT in response
                        if "password_hash" in data or "password_encrypted" in data:
                            print_fail("Response contains password_hash or password_encrypted (should be hidden)")
                            self.failures.append("Password fields exposed in response")
                        else:
                            print_pass("password_hash and password_encrypted not exposed in response")
                    else:
                        print_fail(f"Generated password too short: {len(pwd)} chars")
                        self.failures.append("Generated password too short")
                else:
                    print_fail("No generated_password in response")
                    self.failures.append("No generated_password returned")
            else:
                print_fail(f"POST /contacts failed: {resp.status_code} - {resp.text}")
                self.failures.append("POST /contacts failed")
        except Exception as e:
            print_fail(f"POST /contacts exception: {e}")
            self.failures.append(f"POST /contacts exception: {e}")

    def test_get_contact_password(self):
        """Test 4: GET /api/contacts/{id}/password (Admin only)"""
        print_test("Contacts: GET /api/contacts/{id}/password (Admin vs Manager)")
        
        if not self.admin_token or not self.manager_token:
            print_fail("Tokens not available, skipping")
            self.failures.append("Get password test skipped - no tokens")
            return
        
        if not self.test_contact_id:
            print_info("No test contact created, using admin contact")
            # Get admin contact ID
            try:
                resp = requests.get(f"{BASE_URL}/contacts?role=Admin", 
                                  headers=self.get_headers(self.admin_token), 
                                  timeout=30)
                if resp.status_code == 200:
                    contacts = resp.json()
                    if contacts:
                        self.test_contact_id = contacts[0]["id"]
            except:
                pass
        
        if not self.test_contact_id:
            print_fail("No contact ID available for testing")
            self.failures.append("No contact ID for password test")
            return
        
        # Test Admin can get password
        try:
            resp = requests.get(f"{BASE_URL}/contacts/{self.test_contact_id}/password", 
                              headers=self.get_headers(self.admin_token), 
                              timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if "password" in data:
                    print_pass(f"Admin can retrieve decrypted password")
                    self.passes.append("Admin can get contact password")
                else:
                    print_fail("No password in response")
                    self.failures.append("No password in Admin get password response")
            else:
                print_fail(f"Admin GET password failed: {resp.status_code} - {resp.text}")
                self.failures.append("Admin GET password failed")
        except Exception as e:
            print_fail(f"Admin GET password exception: {e}")
            self.failures.append(f"Admin GET password exception: {e}")
        
        # Test Manager gets 403
        try:
            resp = requests.get(f"{BASE_URL}/contacts/{self.test_contact_id}/password", 
                              headers=self.get_headers(self.manager_token), 
                              timeout=30)
            if resp.status_code == 403:
                print_pass(f"Manager correctly denied (403) from getting password")
                self.passes.append("Manager 403 on get password")
            else:
                print_fail(f"Manager should get 403, got: {resp.status_code}")
                self.failures.append(f"Manager get password wrong status: {resp.status_code}")
        except Exception as e:
            print_fail(f"Manager GET password exception: {e}")
            self.failures.append(f"Manager GET password exception: {e}")

    def test_reset_contact_password(self):
        """Test 5: POST /api/contacts/{id}/reset-password"""
        print_test("Contacts: POST /api/contacts/{id}/reset-password")
        
        if not self.admin_token or not self.test_contact_id:
            print_fail("Prerequisites not met, skipping")
            self.failures.append("Reset password test skipped")
            return
        
        try:
            resp = requests.post(f"{BASE_URL}/contacts/{self.test_contact_id}/reset-password", 
                               headers=self.get_headers(self.admin_token), 
                               timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if "password" in data:
                    new_pwd = data["password"]
                    print_pass(f"Password reset successful, new password generated (length={len(new_pwd)})")
                    self.passes.append("Password reset works")
                    
                    # Verify we can retrieve the new password
                    resp2 = requests.get(f"{BASE_URL}/contacts/{self.test_contact_id}/password", 
                                       headers=self.get_headers(self.admin_token), 
                                       timeout=30)
                    if resp2.status_code == 200:
                        retrieved = resp2.json().get("password")
                        if retrieved == new_pwd:
                            print_pass("Retrieved password matches reset password")
                            self.passes.append("Password retrieval after reset works")
                        else:
                            print_fail(f"Retrieved password doesn't match: {retrieved} != {new_pwd}")
                            self.failures.append("Password mismatch after reset")
                else:
                    print_fail("No password in reset response")
                    self.failures.append("No password in reset response")
            else:
                print_fail(f"POST reset-password failed: {resp.status_code} - {resp.text}")
                self.failures.append("POST reset-password failed")
        except Exception as e:
            print_fail(f"POST reset-password exception: {e}")
            self.failures.append(f"POST reset-password exception: {e}")

    def test_update_contact(self):
        """Test 6: PATCH /api/contacts/{id}"""
        print_test("Contacts: PATCH /api/contacts/{id} updating role/emp_id/doj")
        
        if not self.admin_token or not self.test_contact_id:
            print_fail("Prerequisites not met, skipping")
            self.failures.append("Update contact test skipped")
            return
        
        try:
            update_data = {
                "role": "Research Associate",
                "emp_id": "EMP-UPDATED-001",
                "doj": "2024-02-01"
            }
            resp = requests.patch(f"{BASE_URL}/contacts/{self.test_contact_id}", 
                                json=update_data,
                                headers=self.get_headers(self.admin_token), 
                                timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if (data.get("role") == "Research Associate" and 
                    data.get("emp_id") == "EMP-UPDATED-001" and 
                    data.get("doj") == "2024-02-01"):
                    print_pass("Contact updated successfully with new role/emp_id/doj")
                    self.passes.append("Contact update works")
                else:
                    print_fail(f"Contact update didn't apply correctly: {data}")
                    self.failures.append("Contact update values incorrect")
            else:
                print_fail(f"PATCH /contacts failed: {resp.status_code} - {resp.text}")
                self.failures.append("PATCH /contacts failed")
        except Exception as e:
            print_fail(f"PATCH /contacts exception: {e}")
            self.failures.append(f"PATCH /contacts exception: {e}")

    def test_manager_cannot_create_contact(self):
        """Test 7: Manager cannot create contacts (403)"""
        print_test("Contacts: Manager POST /api/contacts should return 403")
        
        if not self.manager_token:
            print_fail("Manager token not available, skipping")
            self.failures.append("Manager create contact test skipped")
            return
        
        try:
            new_contact = {
                "email": "manager.test@ticketing.com",
                "name": "Manager Test",
                "phone": "9999999999",
                "role": "DQ Team",
                "emp_id": "EMP-MGR-001",
                "doj": "2024-03-01"
            }
            resp = requests.post(f"{BASE_URL}/contacts", 
                               json=new_contact,
                               headers=self.get_headers(self.manager_token), 
                               timeout=30)
            if resp.status_code == 403:
                print_pass("Manager correctly denied (403) from creating contact")
                self.passes.append("Manager 403 on create contact")
            else:
                print_fail(f"Manager should get 403, got: {resp.status_code}")
                self.failures.append(f"Manager create contact wrong status: {resp.status_code}")
        except Exception as e:
            print_fail(f"Manager POST /contacts exception: {e}")
            self.failures.append(f"Manager POST /contacts exception: {e}")

    def test_create_team(self):
        """Test 8: POST /api/teams with validation"""
        print_test("Teams: POST /api/teams with manager_ids/member_ids/color")
        
        if not self.admin_token:
            print_fail("Admin token not available, skipping")
            self.failures.append("Create team test skipped")
            return
        
        # Get some contact IDs for managers and members
        try:
            resp = requests.get(f"{BASE_URL}/contacts", 
                              headers=self.get_headers(self.admin_token), 
                              timeout=30)
            if resp.status_code != 200:
                print_fail("Cannot get contacts for team creation")
                self.failures.append("Cannot get contacts for team test")
                return
            
            contacts = resp.json()
            manager_ids = [c["id"] for c in contacts if c.get("role") == "Manager"][:1]
            member_ids = [c["id"] for c in contacts if c.get("role") == "DQ Team"][:2]
            
            if not manager_ids or not member_ids:
                print_info("Not enough contacts for team creation test")
                return
            
            # Create a team
            team_data = {
                "name": "Test Team Alpha",
                "manager_ids": manager_ids,
                "member_ids": member_ids,
                "color": "#FF5733"
            }
            
            resp = requests.post(f"{BASE_URL}/teams", 
                               json=team_data,
                               headers=self.get_headers(self.admin_token), 
                               timeout=30)
            
            if resp.status_code == 200:
                data = resp.json()
                self.test_team_id = data.get("id")
                print_pass(f"Team created successfully: {data.get('name')}")
                self.passes.append("Team creation works")
                
                # Test duplicate name validation
                resp2 = requests.post(f"{BASE_URL}/teams", 
                                    json=team_data,
                                    headers=self.get_headers(self.admin_token), 
                                    timeout=30)
                if resp2.status_code == 400:
                    print_pass("Duplicate team name correctly rejected (400)")
                    self.passes.append("Team duplicate name validation works")
                else:
                    print_fail(f"Duplicate team name should return 400, got: {resp2.status_code}")
                    self.failures.append("Team duplicate name validation failed")
                
                # Test member conflict validation (member in two teams)
                team_data2 = {
                    "name": "Test Team Beta",
                    "manager_ids": manager_ids,
                    "member_ids": member_ids,  # Same members
                    "color": "#33FF57"
                }
                resp3 = requests.post(f"{BASE_URL}/teams", 
                                    json=team_data2,
                                    headers=self.get_headers(self.admin_token), 
                                    timeout=30)
                if resp3.status_code == 400:
                    print_pass("Member conflict correctly rejected (400)")
                    self.passes.append("Team member conflict validation works")
                else:
                    print_fail(f"Member conflict should return 400, got: {resp3.status_code}")
                    self.failures.append("Team member conflict validation failed")
            else:
                print_fail(f"POST /teams failed: {resp.status_code} - {resp.text}")
                self.failures.append("POST /teams failed")
        except Exception as e:
            print_fail(f"POST /teams exception: {e}")
            self.failures.append(f"POST /teams exception: {e}")

    def test_get_teams_enriched(self):
        """Test 9: GET /api/teams returns enriched managers/members"""
        print_test("Teams: GET /api/teams with enriched managers/members")
        
        if not self.admin_token:
            print_fail("Admin token not available, skipping")
            self.failures.append("Get teams test skipped")
            return
        
        try:
            resp = requests.get(f"{BASE_URL}/teams", 
                              headers=self.get_headers(self.admin_token), 
                              timeout=30)
            if resp.status_code == 200:
                teams = resp.json()
                if len(teams) > 0:
                    team = teams[0]
                    if "managers" in team and "members" in team:
                        print_pass("Teams have enriched managers and members arrays")
                        self.passes.append("Teams enrichment works")
                        
                        # Check structure of managers/members
                        if len(team["managers"]) > 0:
                            mgr = team["managers"][0]
                            if "id" in mgr and "name" in mgr and "email" in mgr:
                                print_pass("Manager objects have id/name/email")
                            else:
                                print_fail(f"Manager object missing fields: {mgr}")
                                self.failures.append("Manager enrichment incomplete")
                    else:
                        print_fail("Teams missing managers or members arrays")
                        self.failures.append("Teams enrichment missing")
                else:
                    print_info("No teams found to verify enrichment")
            else:
                print_fail(f"GET /teams failed: {resp.status_code} - {resp.text}")
                self.failures.append("GET /teams failed")
        except Exception as e:
            print_fail(f"GET /teams exception: {e}")
            self.failures.append(f"GET /teams exception: {e}")

    def test_update_team(self):
        """Test 10: PATCH /api/teams/{id}"""
        print_test("Teams: PATCH /api/teams/{id}")
        
        if not self.admin_token or not self.test_team_id:
            print_fail("Prerequisites not met, skipping")
            self.failures.append("Update team test skipped")
            return
        
        try:
            update_data = {
                "name": "Test Team Alpha Updated",
                "color": "#0000FF"
            }
            resp = requests.patch(f"{BASE_URL}/teams/{self.test_team_id}", 
                                json=update_data,
                                headers=self.get_headers(self.admin_token), 
                                timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("name") == "Test Team Alpha Updated" and data.get("color") == "#0000FF":
                    print_pass("Team updated successfully")
                    self.passes.append("Team update works")
                else:
                    print_fail(f"Team update didn't apply correctly: {data}")
                    self.failures.append("Team update values incorrect")
            else:
                print_fail(f"PATCH /teams failed: {resp.status_code} - {resp.text}")
                self.failures.append("PATCH /teams failed")
        except Exception as e:
            print_fail(f"PATCH /teams exception: {e}")
            self.failures.append(f"PATCH /teams exception: {e}")

    def test_contacts_team_enrichment_after_assignment(self):
        """Test 11: After team assignment, GET /api/contacts shows team info"""
        print_test("Contacts: Team enrichment after member assignment")
        
        if not self.admin_token or not self.test_team_id:
            print_fail("Prerequisites not met, skipping")
            self.failures.append("Contact team enrichment test skipped")
            return
        
        try:
            # Get team details to find a member
            resp = requests.get(f"{BASE_URL}/teams", 
                              headers=self.get_headers(self.admin_token), 
                              timeout=30)
            if resp.status_code != 200:
                print_fail("Cannot get teams")
                return
            
            teams = resp.json()
            test_team = next((t for t in teams if t["id"] == self.test_team_id), None)
            if not test_team or not test_team.get("member_ids"):
                print_info("No members in test team to verify")
                return
            
            member_id = test_team["member_ids"][0]
            
            # Get contact details
            resp2 = requests.get(f"{BASE_URL}/contacts/{member_id}", 
                               headers=self.get_headers(self.admin_token), 
                               timeout=30)
            if resp2.status_code == 200:
                contact = resp2.json()
                if (contact.get("team_name") == test_team["name"] and 
                    contact.get("team_color") == test_team["color"] and
                    "manager_names" in contact):
                    print_pass(f"Contact enriched with team_name={contact['team_name']}, team_color={contact['team_color']}, manager_names={contact['manager_names']}")
                    self.passes.append("Contact team enrichment works")
                else:
                    print_fail(f"Contact team enrichment incomplete: {contact}")
                    self.failures.append("Contact team enrichment incomplete")
            else:
                print_fail(f"GET /contacts/{member_id} failed: {resp2.status_code}")
                self.failures.append("GET contact for team enrichment failed")
        except Exception as e:
            print_fail(f"Contact team enrichment exception: {e}")
            self.failures.append(f"Contact team enrichment exception: {e}")

    def test_delete_team(self):
        """Test 12: DELETE /api/teams/{id}"""
        print_test("Teams: DELETE /api/teams/{id}")
        
        if not self.admin_token or not self.test_team_id:
            print_fail("Prerequisites not met, skipping")
            self.failures.append("Delete team test skipped")
            return
        
        try:
            resp = requests.delete(f"{BASE_URL}/teams/{self.test_team_id}", 
                                 headers=self.get_headers(self.admin_token), 
                                 timeout=30)
            if resp.status_code == 200:
                print_pass("Team deleted successfully")
                self.passes.append("Team deletion works")
            else:
                print_fail(f"DELETE /teams failed: {resp.status_code} - {resp.text}")
                self.failures.append("DELETE /teams failed")
        except Exception as e:
            print_fail(f"DELETE /teams exception: {e}")
            self.failures.append(f"DELETE /teams exception: {e}")

    def test_manager_cannot_create_team(self):
        """Test 13: Manager cannot create teams (403)"""
        print_test("Teams: Manager POST /api/teams should return 403")
        
        if not self.manager_token:
            print_fail("Manager token not available, skipping")
            self.failures.append("Manager create team test skipped")
            return
        
        try:
            team_data = {
                "name": "Manager Test Team",
                "manager_ids": [],
                "member_ids": [],
                "color": "#AAAAAA"
            }
            resp = requests.post(f"{BASE_URL}/teams", 
                               json=team_data,
                               headers=self.get_headers(self.manager_token), 
                               timeout=30)
            if resp.status_code == 403:
                print_pass("Manager correctly denied (403) from creating team")
                self.passes.append("Manager 403 on create team")
            else:
                print_fail(f"Manager should get 403, got: {resp.status_code}")
                self.failures.append(f"Manager create team wrong status: {resp.status_code}")
        except Exception as e:
            print_fail(f"Manager POST /teams exception: {e}")
            self.failures.append(f"Manager POST /teams exception: {e}")

    def test_permissions_get(self):
        """Test 14: GET /api/permissions"""
        print_test("Permissions: GET /api/permissions")
        
        if not self.admin_token:
            print_fail("Admin token not available, skipping")
            self.failures.append("Get permissions test skipped")
            return
        
        try:
            resp = requests.get(f"{BASE_URL}/permissions", 
                              headers=self.get_headers(self.admin_token), 
                              timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if "rules" in data:
                    print_pass(f"GET /permissions returns rules array (count={len(data['rules'])})")
                    self.passes.append("GET permissions works")
                else:
                    print_fail("GET /permissions missing 'rules' field")
                    self.failures.append("GET permissions missing rules")
            else:
                print_fail(f"GET /permissions failed: {resp.status_code} - {resp.text}")
                self.failures.append("GET /permissions failed")
        except Exception as e:
            print_fail(f"GET /permissions exception: {e}")
            self.failures.append(f"GET /permissions exception: {e}")

    def test_permissions_put(self):
        """Test 15: PUT /api/permissions"""
        print_test("Permissions: PUT /api/permissions")
        
        if not self.admin_token:
            print_fail("Admin token not available, skipping")
            self.failures.append("Put permissions test skipped")
            return
        
        try:
            rules_data = {
                "rules": [
                    {
                        "subject_type": "Role",
                        "subject_value": "DQ Team",
                        "table": "tickets",
                        "actions": {
                            "view": True,
                            "request": False,
                            "edit": False
                        }
                    }
                ]
            }
            resp = requests.put(f"{BASE_URL}/permissions", 
                              json=rules_data,
                              headers=self.get_headers(self.admin_token), 
                              timeout=30)
            if resp.status_code == 200:
                print_pass("PUT /permissions successful")
                self.passes.append("PUT permissions works")
                
                # Verify the update
                resp2 = requests.get(f"{BASE_URL}/permissions", 
                                   headers=self.get_headers(self.admin_token), 
                                   timeout=30)
                if resp2.status_code == 200:
                    data = resp2.json()
                    if len(data.get("rules", [])) > 0:
                        print_pass("GET /permissions reflects the update")
                        self.passes.append("Permissions persistence works")
                    else:
                        print_fail("GET /permissions doesn't show saved rules")
                        self.failures.append("Permissions not persisted")
            else:
                print_fail(f"PUT /permissions failed: {resp.status_code} - {resp.text}")
                self.failures.append("PUT /permissions failed")
        except Exception as e:
            print_fail(f"PUT /permissions exception: {e}")
            self.failures.append(f"PUT /permissions exception: {e}")

    def test_manager_permissions_403(self):
        """Test 16: Manager gets 403 on permissions endpoints"""
        print_test("Permissions: Manager should get 403 on GET and PUT")
        
        if not self.manager_token:
            print_fail("Manager token not available, skipping")
            self.failures.append("Manager permissions test skipped")
            return
        
        # Test GET
        try:
            resp = requests.get(f"{BASE_URL}/permissions", 
                              headers=self.get_headers(self.manager_token), 
                              timeout=30)
            if resp.status_code == 403:
                print_pass("Manager correctly denied (403) from GET /permissions")
                self.passes.append("Manager 403 on GET permissions")
            else:
                print_fail(f"Manager GET /permissions should return 403, got: {resp.status_code}")
                self.failures.append(f"Manager GET permissions wrong status: {resp.status_code}")
        except Exception as e:
            print_fail(f"Manager GET /permissions exception: {e}")
            self.failures.append(f"Manager GET /permissions exception: {e}")
        
        # Test PUT
        try:
            resp = requests.put(f"{BASE_URL}/permissions", 
                              json={"rules": []},
                              headers=self.get_headers(self.manager_token), 
                              timeout=30)
            if resp.status_code == 403:
                print_pass("Manager correctly denied (403) from PUT /permissions")
                self.passes.append("Manager 403 on PUT permissions")
            else:
                print_fail(f"Manager PUT /permissions should return 403, got: {resp.status_code}")
                self.failures.append(f"Manager PUT permissions wrong status: {resp.status_code}")
        except Exception as e:
            print_fail(f"Manager PUT /permissions exception: {e}")
            self.failures.append(f"Manager PUT /permissions exception: {e}")

    def test_manager_profix_access(self):
        """Test 17: Manager ProfiX access (same as Admin)"""
        print_test("Manager ProfiX: GET /api/tickets returns all tickets")
        
        if not self.manager_token:
            print_fail("Manager token not available, skipping")
            self.failures.append("Manager ProfiX test skipped")
            return
        
        # First, create a ticket as admin to ensure there's data
        if self.admin_token:
            try:
                ticket_data = {
                    "subject": "Test Ticket for Manager Access",
                    "description": "Testing manager access",
                    "priority": "Medium",
                    "number_of_profiles": 10,
                    "due_date": "2024-12-31"
                }
                resp = requests.post(f"{BASE_URL}/tickets", 
                                   json=ticket_data,
                                   headers=self.get_headers(self.admin_token), 
                                   timeout=30)
                if resp.status_code == 200:
                    self.test_ticket_id = resp.json().get("id")
                    print_info("Test ticket created for Manager access test")
            except:
                pass
        
        # Test Manager can see all tickets
        try:
            resp = requests.get(f"{BASE_URL}/tickets", 
                              headers=self.get_headers(self.manager_token), 
                              timeout=30)
            if resp.status_code == 200:
                tickets = resp.json()
                print_pass(f"Manager can GET /tickets (count={len(tickets)})")
                self.passes.append("Manager can list all tickets")
            else:
                print_fail(f"Manager GET /tickets failed: {resp.status_code} - {resp.text}")
                self.failures.append("Manager GET /tickets failed")
        except Exception as e:
            print_fail(f"Manager GET /tickets exception: {e}")
            self.failures.append(f"Manager GET /tickets exception: {e}")

    def test_manager_assign_ticket(self):
        """Test 18: Manager can assign tickets"""
        print_test("Manager ProfiX: PATCH /api/tickets/{id} to assign")
        
        if not self.manager_token or not self.test_ticket_id:
            print_fail("Prerequisites not met, skipping")
            self.failures.append("Manager assign ticket test skipped")
            return
        
        # Get a DQ user to assign to
        try:
            resp = requests.get(f"{BASE_URL}/contacts?role=DQ Team", 
                              headers=self.get_headers(self.manager_token), 
                              timeout=30)
            if resp.status_code != 200 or not resp.json():
                print_info("No DQ users available for assignment test")
                return
            
            dq_user_id = resp.json()[0]["id"]
            
            # Assign ticket
            resp2 = requests.patch(f"{BASE_URL}/tickets/{self.test_ticket_id}", 
                                 json={"assigned_to": dq_user_id},
                                 headers=self.get_headers(self.manager_token), 
                                 timeout=30)
            if resp2.status_code == 200:
                data = resp2.json()
                if data.get("assigned_to_id") == dq_user_id:
                    print_pass("Manager can assign tickets to DQ users")
                    self.passes.append("Manager can assign tickets")
                else:
                    print_fail(f"Ticket assignment didn't work: {data}")
                    self.failures.append("Manager ticket assignment failed")
            else:
                print_fail(f"Manager PATCH /tickets failed: {resp2.status_code} - {resp2.text}")
                self.failures.append("Manager PATCH /tickets failed")
        except Exception as e:
            print_fail(f"Manager assign ticket exception: {e}")
            self.failures.append(f"Manager assign ticket exception: {e}")

    def test_manager_bulk_operations(self):
        """Test 19: Manager can use bulk-assign and bulk-status"""
        print_test("Manager ProfiX: POST /api/tickets/bulk-assign and bulk-status")
        
        if not self.manager_token or not self.test_ticket_id:
            print_fail("Prerequisites not met, skipping")
            self.failures.append("Manager bulk operations test skipped")
            return
        
        # Get a DQ user
        try:
            resp = requests.get(f"{BASE_URL}/contacts?role=DQ Team", 
                              headers=self.get_headers(self.manager_token), 
                              timeout=30)
            if resp.status_code != 200 or not resp.json():
                print_info("No DQ users available for bulk operations test")
                return
            
            dq_user_id = resp.json()[0]["id"]
            
            # Test bulk-assign
            resp2 = requests.post(f"{BASE_URL}/tickets/bulk-assign", 
                                json={
                                    "ticket_ids": [self.test_ticket_id],
                                    "assigned_to": dq_user_id
                                },
                                headers=self.get_headers(self.manager_token), 
                                timeout=30)
            if resp2.status_code == 200:
                print_pass("Manager can use bulk-assign")
                self.passes.append("Manager bulk-assign works")
            else:
                print_fail(f"Manager bulk-assign failed: {resp2.status_code} - {resp2.text}")
                self.failures.append("Manager bulk-assign failed")
            
            # Test bulk-status
            resp3 = requests.post(f"{BASE_URL}/tickets/bulk-status", 
                                json={
                                    "ticket_ids": [self.test_ticket_id],
                                    "status": "In Progress"
                                },
                                headers=self.get_headers(self.manager_token), 
                                timeout=30)
            if resp3.status_code == 200:
                print_pass("Manager can use bulk-status")
                self.passes.append("Manager bulk-status works")
            else:
                print_fail(f"Manager bulk-status failed: {resp3.status_code} - {resp3.text}")
                self.failures.append("Manager bulk-status failed")
        except Exception as e:
            print_fail(f"Manager bulk operations exception: {e}")
            self.failures.append(f"Manager bulk operations exception: {e}")

    def run_all_tests(self):
        """Run all backend tests"""
        print(f"\n{Colors.BOLD}{'='*80}{Colors.RESET}")
        print(f"{Colors.BOLD}Backend API Testing - Admin/Manager Module Enhancements{Colors.RESET}")
        print(f"{Colors.BOLD}{'='*80}{Colors.RESET}")
        
        # Run tests in order
        self.test_auth_migration()
        self.test_contacts_enriched_fields()
        self.test_create_contact_with_password()
        self.test_get_contact_password()
        self.test_reset_contact_password()
        self.test_update_contact()
        self.test_manager_cannot_create_contact()
        self.test_create_team()
        self.test_get_teams_enriched()
        self.test_update_team()
        self.test_contacts_team_enrichment_after_assignment()
        self.test_delete_team()
        self.test_manager_cannot_create_team()
        self.test_permissions_get()
        self.test_permissions_put()
        self.test_manager_permissions_403()
        self.test_manager_profix_access()
        self.test_manager_assign_ticket()
        self.test_manager_bulk_operations()
        
        # Summary
        print(f"\n{Colors.BOLD}{'='*80}{Colors.RESET}")
        print(f"{Colors.BOLD}Test Summary{Colors.RESET}")
        print(f"{Colors.BOLD}{'='*80}{Colors.RESET}")
        print(f"{Colors.GREEN}Passed: {len(self.passes)}{Colors.RESET}")
        print(f"{Colors.RED}Failed: {len(self.failures)}{Colors.RESET}")
        
        if self.failures:
            print(f"\n{Colors.RED}{Colors.BOLD}Failed Tests:{Colors.RESET}")
            for i, failure in enumerate(self.failures, 1):
                print(f"{Colors.RED}{i}. {failure}{Colors.RESET}")
        
        return len(self.failures) == 0

if __name__ == "__main__":
    session = TestSession()
    success = session.run_all_tests()
    sys.exit(0 if success else 1)
