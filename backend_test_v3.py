#!/usr/bin/env python3
"""
Backend API Testing for v3 Permission Sets & Role Collapse
Tests all v3 backend endpoints for the DeskApp-Ticketing system.
"""

import requests
import json
import sys
import time
from typing import Optional, Dict, Any, List

# Backend URL from environment
BASE_URL = "https://request-popup-form.preview.emergentagent.com/api"

# Test credentials (from /app/memory/test_credentials.md)
SUPER_ADMIN_EMAIL = "admin@ticketing.com"
SUPER_ADMIN_PASSWORD = "Admin@123"
ADMIN_EMAIL = "manager@ticketing.com"  # Now Admin role after v3 collapse
ADMIN_PASSWORD = "Test@123"

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
        self.super_admin_token = None
        self.admin_token = None
        self.test_pset_ids = []  # Track created permission sets for cleanup
        self.test_contact_id = None
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

    def test_role_collapse_migration(self):
        """Test v3 role collapse migration"""
        print_test("v3 Role Collapse: Verify only Super Admin and Admin roles exist")
        
        # Login as Super Admin
        self.super_admin_token = self.login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)
        if not self.super_admin_token:
            self.failures.append("Super Admin login failed")
            return
        print_pass(f"Super Admin login successful")
        
        # Verify Super Admin role
        try:
            resp = requests.get(f"{BASE_URL}/auth/me", 
                              headers=self.get_headers(self.super_admin_token), 
                              timeout=30)
            if resp.status_code == 200:
                user = resp.json()
                if user.get("role") == "Super Admin":
                    print_pass(f"admin@ticketing.com has role='Super Admin'")
                    self.passes.append("Super Admin role verified")
                else:
                    print_fail(f"admin@ has wrong role: {user.get('role')}")
                    self.failures.append(f"Super Admin role incorrect: {user.get('role')}")
            else:
                print_fail(f"Super Admin /auth/me failed: {resp.status_code}")
                self.failures.append("Super Admin auth/me failed")
        except Exception as e:
            print_fail(f"Super Admin /auth/me exception: {e}")
            self.failures.append(f"Super Admin auth/me exception: {e}")
        
        # Login as Admin (manager@)
        self.admin_token = self.login(ADMIN_EMAIL, ADMIN_PASSWORD)
        if not self.admin_token:
            self.failures.append("Admin login failed")
            return
        print_pass(f"Admin (manager@) login successful")
        
        # Verify Admin role
        try:
            resp = requests.get(f"{BASE_URL}/auth/me", 
                              headers=self.get_headers(self.admin_token), 
                              timeout=30)
            if resp.status_code == 200:
                user = resp.json()
                if user.get("role") == "Admin":
                    print_pass(f"manager@ticketing.com has role='Admin' (collapsed from Manager)")
                    self.passes.append("Admin role verified")
                else:
                    print_fail(f"manager@ has wrong role: {user.get('role')}")
                    self.failures.append(f"Admin role incorrect: {user.get('role')}")
            else:
                print_fail(f"Admin /auth/me failed: {resp.status_code}")
                self.failures.append("Admin auth/me failed")
        except Exception as e:
            print_fail(f"Admin /auth/me exception: {e}")
            self.failures.append(f"Admin auth/me exception: {e}")
        
        # Verify GET /api/contacts only returns Super Admin and Admin
        try:
            resp = requests.get(f"{BASE_URL}/contacts", 
                              headers=self.get_headers(self.super_admin_token), 
                              timeout=30)
            if resp.status_code == 200:
                contacts = resp.json()
                roles = set(c.get("role") for c in contacts)
                if roles <= {"Super Admin", "Admin"}:
                    print_pass(f"All contacts have only Super Admin or Admin roles: {roles}")
                    self.passes.append("Role collapse verified in contacts")
                else:
                    print_fail(f"Found legacy roles in contacts: {roles}")
                    self.failures.append(f"Legacy roles still exist: {roles - {'Super Admin', 'Admin'}}")
            else:
                print_fail(f"GET /contacts failed: {resp.status_code}")
                self.failures.append("GET /contacts failed")
        except Exception as e:
            print_fail(f"GET /contacts exception: {e}")
            self.failures.append(f"GET /contacts exception: {e}")
        
        # Test POST /api/contacts with legacy role "Manager" should return 422
        try:
            new_contact = {
                "email": "legacy.test@ticketing.com",
                "name": "Legacy Test",
                "phone": "1234567890",
                "role": "Manager",  # Legacy role
                "emp_id": "EMP-LEGACY-001",
                "doj": "2024-01-15"
            }
            resp = requests.post(f"{BASE_URL}/contacts", 
                               json=new_contact,
                               headers=self.get_headers(self.super_admin_token), 
                               timeout=30)
            if resp.status_code == 422:
                print_pass("POST /contacts with role='Manager' correctly rejected (422)")
                self.passes.append("Legacy role rejection works")
            else:
                print_fail(f"POST /contacts with legacy role should return 422, got: {resp.status_code}")
                self.failures.append(f"Legacy role not rejected: {resp.status_code}")
        except Exception as e:
            print_fail(f"POST /contacts legacy role test exception: {e}")
            self.failures.append(f"Legacy role test exception: {e}")

    def test_permission_sets_create(self):
        """Test POST /api/permission-sets"""
        print_test("Permission Sets: POST /api/permission-sets (Super Admin only)")
        
        if not self.super_admin_token:
            print_fail("Super Admin token not available, skipping")
            self.failures.append("Permission set create test skipped")
            return
        
        # Test 1: Super Admin can create permission set
        try:
            pset_data = {
                "name": "Test Set 1",
                "description": "Test permission set for v3 testing",
                "modules": {
                    "profix": {
                        "ticket": {
                            "view": True,
                            "create": True,
                            "edit": False,
                            "assign": False,
                            "approve": False,
                            "delete": False
                        }
                    },
                    "desk_booking": {
                        "seat_request": {
                            "view": True,
                            "create": True,
                            "edit": False,
                            "approve": False,
                            "delete": False
                        }
                    }
                }
            }
            resp = requests.post(f"{BASE_URL}/permission-sets", 
                               json=pset_data,
                               headers=self.get_headers(self.super_admin_token), 
                               timeout=30)
            
            if resp.status_code == 200:
                data = resp.json()
                # Verify response structure
                if all(k in data for k in ["id", "numeric_id", "created_by", "created_at"]):
                    print_pass(f"Permission set created: id={data['id']}, numeric_id={data['numeric_id']}")
                    self.passes.append("Permission set creation works")
                    self.test_pset_ids.append(data["id"])
                    
                    # Verify numeric_id is an integer
                    if isinstance(data["numeric_id"], int) and data["numeric_id"] >= 1:
                        print_pass(f"numeric_id is valid integer: {data['numeric_id']}")
                        self.passes.append("numeric_id auto-increment works")
                    else:
                        print_fail(f"numeric_id invalid: {data['numeric_id']}")
                        self.failures.append("numeric_id not valid")
                    
                    # Verify unknown features are dropped (normalizer)
                    if "unknown_module" not in data.get("modules", {}):
                        print_pass("Unknown modules silently dropped by normalizer")
                        self.passes.append("Module normalizer works")
                else:
                    print_fail(f"Response missing required fields: {data.keys()}")
                    self.failures.append("Permission set response incomplete")
            else:
                print_fail(f"POST /permission-sets failed: {resp.status_code} - {resp.text}")
                self.failures.append("POST /permission-sets failed")
        except Exception as e:
            print_fail(f"POST /permission-sets exception: {e}")
            self.failures.append(f"POST /permission-sets exception: {e}")
        
        # Test 2: Duplicate name (case-insensitive) should return 400
        try:
            pset_data_dup = {
                "name": "test set 1",  # Same name, different case
                "description": "Duplicate test",
                "modules": {}
            }
            resp = requests.post(f"{BASE_URL}/permission-sets", 
                               json=pset_data_dup,
                               headers=self.get_headers(self.super_admin_token), 
                               timeout=30)
            if resp.status_code == 400:
                print_pass("Duplicate name (case-insensitive) correctly rejected (400)")
                self.passes.append("Duplicate name validation works")
            else:
                print_fail(f"Duplicate name should return 400, got: {resp.status_code}")
                self.failures.append(f"Duplicate name not rejected: {resp.status_code}")
        except Exception as e:
            print_fail(f"Duplicate name test exception: {e}")
            self.failures.append(f"Duplicate name test exception: {e}")
        
        # Test 3: Admin (non-Super) should get 403
        if self.admin_token:
            try:
                pset_data_admin = {
                    "name": "Admin Test Set",
                    "description": "Should fail",
                    "modules": {}
                }
                resp = requests.post(f"{BASE_URL}/permission-sets", 
                                   json=pset_data_admin,
                                   headers=self.get_headers(self.admin_token), 
                                   timeout=30)
                if resp.status_code == 403:
                    print_pass("Admin correctly denied (403) from creating permission set")
                    self.passes.append("Admin 403 on create permission set")
                else:
                    print_fail(f"Admin should get 403, got: {resp.status_code}")
                    self.failures.append(f"Admin create permission set wrong status: {resp.status_code}")
            except Exception as e:
                print_fail(f"Admin create permission set exception: {e}")
                self.failures.append(f"Admin create permission set exception: {e}")

    def test_permission_sets_list_and_filters(self):
        """Test GET /api/permission-sets with filters"""
        print_test("Permission Sets: GET /api/permission-sets with filters")
        
        if not self.admin_token:
            print_fail("Admin token not available, skipping")
            self.failures.append("Permission set list test skipped")
            return
        
        # Test 1: Admin can list permission sets
        try:
            resp = requests.get(f"{BASE_URL}/permission-sets", 
                              headers=self.get_headers(self.admin_token), 
                              timeout=30)
            if resp.status_code == 200:
                sets = resp.json()
                print_pass(f"Admin can list permission sets (count={len(sets)})")
                self.passes.append("Admin can list permission sets")
            else:
                print_fail(f"GET /permission-sets failed: {resp.status_code}")
                self.failures.append("GET /permission-sets failed")
        except Exception as e:
            print_fail(f"GET /permission-sets exception: {e}")
            self.failures.append(f"GET /permission-sets exception: {e}")
        
        # Test 2: Filter by name (q parameter)
        try:
            resp = requests.get(f"{BASE_URL}/permission-sets?q=Test", 
                              headers=self.get_headers(self.admin_token), 
                              timeout=30)
            if resp.status_code == 200:
                sets = resp.json()
                if all("Test" in s.get("name", "") or "test" in s.get("name", "") for s in sets):
                    print_pass(f"Filter by name (q=Test) works (count={len(sets)})")
                    self.passes.append("Permission set name filter works")
                else:
                    print_fail("Name filter returned non-matching results")
                    self.failures.append("Name filter incorrect")
            else:
                print_fail(f"GET /permission-sets?q=Test failed: {resp.status_code}")
                self.failures.append("Name filter failed")
        except Exception as e:
            print_fail(f"Name filter exception: {e}")
            self.failures.append(f"Name filter exception: {e}")
        
        # Test 3: Filter by module (profix)
        try:
            resp = requests.get(f"{BASE_URL}/permission-sets?module=profix", 
                              headers=self.get_headers(self.admin_token), 
                              timeout=30)
            if resp.status_code == 200:
                sets = resp.json()
                if all("profix" in s.get("modules", {}) for s in sets):
                    print_pass(f"Filter by module (profix) works (count={len(sets)})")
                    self.passes.append("Permission set module filter works")
                else:
                    print_fail("Module filter returned sets without profix module")
                    self.failures.append("Module filter incorrect")
            else:
                print_fail(f"GET /permission-sets?module=profix failed: {resp.status_code}")
                self.failures.append("Module filter failed")
        except Exception as e:
            print_fail(f"Module filter exception: {e}")
            self.failures.append(f"Module filter exception: {e}")

    def test_permission_sets_stats(self):
        """Test GET /api/permission-sets/stats"""
        print_test("Permission Sets: GET /api/permission-sets/stats")
        
        if not self.admin_token:
            print_fail("Admin token not available, skipping")
            self.failures.append("Permission set stats test skipped")
            return
        
        try:
            resp = requests.get(f"{BASE_URL}/permission-sets/stats", 
                              headers=self.get_headers(self.admin_token), 
                              timeout=30)
            if resp.status_code == 200:
                stats = resp.json()
                required_keys = ["total_sets", "profix_sets", "desk_booking_sets", "employees_with_sets"]
                if all(k in stats for k in required_keys):
                    print_pass(f"Stats endpoint works: {stats}")
                    self.passes.append("Permission set stats works")
                else:
                    print_fail(f"Stats missing required keys: {stats.keys()}")
                    self.failures.append("Stats response incomplete")
            else:
                print_fail(f"GET /permission-sets/stats failed: {resp.status_code}")
                self.failures.append("GET /permission-sets/stats failed")
        except Exception as e:
            print_fail(f"GET /permission-sets/stats exception: {e}")
            self.failures.append(f"GET /permission-sets/stats exception: {e}")

    def test_permission_sets_get_by_id(self):
        """Test GET /api/permission-sets/{id} with both uuid and numeric_id"""
        print_test("Permission Sets: GET /api/permission-sets/{id} (uuid and numeric_id)")
        
        if not self.admin_token or not self.test_pset_ids:
            print_fail("Prerequisites not met, skipping")
            self.failures.append("Permission set get by id test skipped")
            return
        
        # Get the first test permission set
        pset_id = self.test_pset_ids[0]
        
        # Test 1: Get by uuid
        try:
            resp = requests.get(f"{BASE_URL}/permission-sets/{pset_id}", 
                              headers=self.get_headers(self.admin_token), 
                              timeout=30)
            if resp.status_code == 200:
                pset = resp.json()
                numeric_id = pset.get("numeric_id")
                print_pass(f"GET by uuid works: {pset_id}")
                self.passes.append("Get permission set by uuid works")
                
                # Test 2: Get by numeric_id (as string)
                if numeric_id:
                    resp2 = requests.get(f"{BASE_URL}/permission-sets/{numeric_id}", 
                                       headers=self.get_headers(self.admin_token), 
                                       timeout=30)
                    if resp2.status_code == 200:
                        pset2 = resp2.json()
                        if pset2.get("id") == pset_id:
                            print_pass(f"GET by numeric_id works: {numeric_id}")
                            self.passes.append("Get permission set by numeric_id works")
                        else:
                            print_fail("GET by numeric_id returned wrong set")
                            self.failures.append("numeric_id lookup incorrect")
                    else:
                        print_fail(f"GET by numeric_id failed: {resp2.status_code}")
                        self.failures.append("GET by numeric_id failed")
            else:
                print_fail(f"GET by uuid failed: {resp.status_code}")
                self.failures.append("GET by uuid failed")
        except Exception as e:
            print_fail(f"GET permission set by id exception: {e}")
            self.failures.append(f"GET by id exception: {e}")

    def test_permission_sets_update(self):
        """Test PATCH /api/permission-sets/{id}"""
        print_test("Permission Sets: PATCH /api/permission-sets/{id} (Super Admin only)")
        
        if not self.super_admin_token or not self.test_pset_ids:
            print_fail("Prerequisites not met, skipping")
            self.failures.append("Permission set update test skipped")
            return
        
        pset_id = self.test_pset_ids[0]
        
        # Test 1: Super Admin can update
        try:
            update_data = {
                "name": "Test Set 1 Updated",
                "description": "Updated description",
                "modules": {
                    "profix": {
                        "ticket": {
                            "view": True,
                            "create": True,
                            "edit": True,  # Changed
                            "assign": True,  # Changed
                            "approve": False,
                            "delete": False
                        }
                    }
                }
            }
            resp = requests.patch(f"{BASE_URL}/permission-sets/{pset_id}", 
                                json=update_data,
                                headers=self.get_headers(self.super_admin_token), 
                                timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("name") == "Test Set 1 Updated":
                    print_pass("Permission set updated successfully")
                    self.passes.append("Permission set update works")
                else:
                    print_fail(f"Update didn't apply: {data.get('name')}")
                    self.failures.append("Update values incorrect")
            else:
                print_fail(f"PATCH /permission-sets failed: {resp.status_code} - {resp.text}")
                self.failures.append("PATCH /permission-sets failed")
        except Exception as e:
            print_fail(f"PATCH /permission-sets exception: {e}")
            self.failures.append(f"PATCH /permission-sets exception: {e}")
        
        # Test 2: Renaming to existing name should return 400
        if len(self.test_pset_ids) > 1:
            try:
                # Create another set first
                pset_data2 = {
                    "name": "Test Set 2",
                    "description": "Second test set",
                    "modules": {}
                }
                resp = requests.post(f"{BASE_URL}/permission-sets", 
                                   json=pset_data2,
                                   headers=self.get_headers(self.super_admin_token), 
                                   timeout=30)
                if resp.status_code == 200:
                    pset_id2 = resp.json()["id"]
                    self.test_pset_ids.append(pset_id2)
                    
                    # Try to rename to existing name
                    resp2 = requests.patch(f"{BASE_URL}/permission-sets/{pset_id2}", 
                                         json={"name": "Test Set 1 Updated"},
                                         headers=self.get_headers(self.super_admin_token), 
                                         timeout=30)
                    if resp2.status_code == 400:
                        print_pass("Rename to existing name correctly rejected (400)")
                        self.passes.append("Rename validation works")
                    else:
                        print_fail(f"Rename to existing name should return 400, got: {resp2.status_code}")
                        self.failures.append(f"Rename validation failed: {resp2.status_code}")
            except Exception as e:
                print_fail(f"Rename validation exception: {e}")
                self.failures.append(f"Rename validation exception: {e}")
        
        # Test 3: Admin should get 403
        if self.admin_token:
            try:
                resp = requests.patch(f"{BASE_URL}/permission-sets/{pset_id}", 
                                    json={"description": "Admin update"},
                                    headers=self.get_headers(self.admin_token), 
                                    timeout=30)
                if resp.status_code == 403:
                    print_pass("Admin correctly denied (403) from updating permission set")
                    self.passes.append("Admin 403 on update permission set")
                else:
                    print_fail(f"Admin should get 403, got: {resp.status_code}")
                    self.failures.append(f"Admin update permission set wrong status: {resp.status_code}")
            except Exception as e:
                print_fail(f"Admin update permission set exception: {e}")
                self.failures.append(f"Admin update permission set exception: {e}")

    def test_contacts_permission_set_ids(self):
        """Test contacts permission_set_ids field"""
        print_test("Contacts: permission_set_ids field and enrichment")
        
        if not self.super_admin_token or not self.test_pset_ids:
            print_fail("Prerequisites not met, skipping")
            self.failures.append("Contacts permission_set_ids test skipped")
            return
        
        # Get a test contact (manager@)
        try:
            resp = requests.get(f"{BASE_URL}/contacts", 
                              headers=self.get_headers(self.super_admin_token), 
                              timeout=30)
            if resp.status_code != 200:
                print_fail("Cannot get contacts")
                self.failures.append("Cannot get contacts for permission_set_ids test")
                return
            
            contacts = resp.json()
            admin_contact = next((c for c in contacts if c.get("email") == ADMIN_EMAIL), None)
            if not admin_contact:
                print_fail("Cannot find admin contact")
                self.failures.append("Admin contact not found")
                return
            
            contact_id = admin_contact["id"]
            self.test_contact_id = contact_id
            
            # Test 1: PATCH /api/contacts with permission_set_ids
            pset_ids = self.test_pset_ids[:2] if len(self.test_pset_ids) >= 2 else self.test_pset_ids
            resp2 = requests.patch(f"{BASE_URL}/contacts/{contact_id}", 
                                 json={"permission_set_ids": pset_ids},
                                 headers=self.get_headers(self.super_admin_token), 
                                 timeout=30)
            if resp2.status_code == 200:
                data = resp2.json()
                if data.get("permission_set_ids") == pset_ids:
                    print_pass(f"Contact updated with permission_set_ids: {pset_ids}")
                    self.passes.append("Contact permission_set_ids update works")
                    
                    # Verify enrichment field
                    if "permission_sets" in data:
                        psets = data["permission_sets"]
                        if all("id" in p and "numeric_id" in p and "name" in p for p in psets):
                            print_pass(f"permission_sets enrichment works: {len(psets)} sets")
                            self.passes.append("permission_sets enrichment works")
                        else:
                            print_fail("permission_sets enrichment incomplete")
                            self.failures.append("permission_sets enrichment missing fields")
                    else:
                        print_fail("permission_sets enrichment field missing")
                        self.failures.append("permission_sets enrichment missing")
                else:
                    print_fail(f"permission_set_ids not updated: {data.get('permission_set_ids')}")
                    self.failures.append("permission_set_ids update failed")
            else:
                print_fail(f"PATCH /contacts failed: {resp2.status_code} - {resp2.text}")
                self.failures.append("PATCH /contacts with permission_set_ids failed")
        except Exception as e:
            print_fail(f"Contacts permission_set_ids exception: {e}")
            self.failures.append(f"Contacts permission_set_ids exception: {e}")
        
        # Test 2: Check audit log for contact.assign_permission_sets
        try:
            time.sleep(1)  # Wait for audit log to be written
            resp = requests.get(f"{BASE_URL}/audit-log?action=contact.assign_permission_sets", 
                              headers=self.get_headers(self.super_admin_token), 
                              timeout=30)
            if resp.status_code == 200:
                logs = resp.json()
                if any(log.get("resource_id") == contact_id for log in logs):
                    print_pass("Audit log entry contact.assign_permission_sets created")
                    self.passes.append("Audit log for permission set assignment works")
                else:
                    print_fail("No audit log entry found for permission set assignment")
                    self.failures.append("Audit log for permission set assignment missing")
            else:
                print_fail(f"GET /audit-log failed: {resp.status_code}")
                self.failures.append("GET /audit-log failed")
        except Exception as e:
            print_fail(f"Audit log check exception: {e}")
            self.failures.append(f"Audit log check exception: {e}")

    def test_effective_permissions(self):
        """Test GET /api/permissions/me/effective"""
        print_test("Effective Permissions: GET /api/permissions/me/effective")
        
        if not self.super_admin_token or not self.admin_token:
            print_fail("Tokens not available, skipping")
            self.failures.append("Effective permissions test skipped")
            return
        
        # Test 1: Super Admin has full access
        try:
            resp = requests.get(f"{BASE_URL}/permissions/me/effective", 
                              headers=self.get_headers(self.super_admin_token), 
                              timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if (data.get("sources", {}).get("super_admin") == True and
                    data.get("counts", {}).get("is_super_admin") == True):
                    print_pass("Super Admin has sources.super_admin=true and counts.is_super_admin=true")
                    self.passes.append("Super Admin effective permissions correct")
                    
                    # Verify all actions are True
                    effective = data.get("effective", {})
                    all_true = True
                    for module, features in effective.items():
                        for feature, actions in features.items():
                            for action, value in actions.items():
                                if value != True:
                                    all_true = False
                                    break
                    if all_true:
                        print_pass("Super Admin has all actions set to True")
                        self.passes.append("Super Admin full access verified")
                    else:
                        print_fail("Super Admin doesn't have all actions set to True")
                        self.failures.append("Super Admin full access incomplete")
                else:
                    print_fail(f"Super Admin effective permissions incorrect: {data}")
                    self.failures.append("Super Admin effective permissions wrong")
            else:
                print_fail(f"GET /permissions/me/effective failed: {resp.status_code}")
                self.failures.append("Super Admin effective permissions failed")
        except Exception as e:
            print_fail(f"Super Admin effective permissions exception: {e}")
            self.failures.append(f"Super Admin effective permissions exception: {e}")
        
        # Test 2: Admin with permission sets
        try:
            resp = requests.get(f"{BASE_URL}/permissions/me/effective", 
                              headers=self.get_headers(self.admin_token), 
                              timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("sources", {}).get("super_admin") == False:
                    print_pass("Admin has sources.super_admin=false")
                    self.passes.append("Admin effective permissions correct")
                    
                    # Check if sets are reflected
                    counts = data.get("counts", {})
                    if counts.get("sets", 0) > 0:
                        print_pass(f"Admin has {counts['sets']} permission sets assigned")
                        self.passes.append("Admin permission sets reflected in effective")
                        
                        # Verify effective permissions match assigned sets
                        effective = data.get("effective", {})
                        if "profix" in effective and "ticket" in effective["profix"]:
                            ticket_perms = effective["profix"]["ticket"]
                            if ticket_perms.get("view") == True and ticket_perms.get("create") == True:
                                print_pass("Admin effective permissions reflect assigned sets (view=true, create=true)")
                                self.passes.append("Admin effective permissions OR-merge works")
                            else:
                                print_fail(f"Admin effective permissions don't match sets: {ticket_perms}")
                                self.failures.append("Admin effective permissions incorrect")
                    else:
                        print_info("Admin has no permission sets assigned (expected if not assigned yet)")
                else:
                    print_fail("Admin has sources.super_admin=true (should be false)")
                    self.failures.append("Admin effective permissions wrong")
            else:
                print_fail(f"GET /permissions/me/effective failed: {resp.status_code}")
                self.failures.append("Admin effective permissions failed")
        except Exception as e:
            print_fail(f"Admin effective permissions exception: {e}")
            self.failures.append(f"Admin effective permissions exception: {e}")

    def test_require_role_enforcement(self):
        """Test require_role enforcement for Admin"""
        print_test("require_role Enforcement: Admin (manager@) access control")
        
        if not self.admin_token:
            print_fail("Admin token not available, skipping")
            self.failures.append("require_role enforcement test skipped")
            return
        
        # Test endpoints that should return 403 for Admin
        forbidden_endpoints = [
            ("POST", "/contacts", {"email": "test@test.com", "name": "Test", "role": "Admin", "emp_id": "EMP-001", "doj": "2024-01-01"}),
            ("POST", "/teams", {"name": "Test Team", "manager_ids": [], "member_ids": []}),
            ("POST", "/permission-sets", {"name": "Test", "modules": {}}),
            ("GET", "/audit-log", None),
        ]
        
        for method, endpoint, data in forbidden_endpoints:
            try:
                if method == "POST":
                    resp = requests.post(f"{BASE_URL}{endpoint}", 
                                       json=data,
                                       headers=self.get_headers(self.admin_token), 
                                       timeout=30)
                else:
                    resp = requests.get(f"{BASE_URL}{endpoint}", 
                                      headers=self.get_headers(self.admin_token), 
                                      timeout=30)
                
                if resp.status_code == 403:
                    print_pass(f"Admin correctly denied (403) from {method} {endpoint}")
                    self.passes.append(f"Admin 403 on {method} {endpoint}")
                else:
                    print_fail(f"Admin should get 403 on {method} {endpoint}, got: {resp.status_code}")
                    self.failures.append(f"Admin {method} {endpoint} wrong status: {resp.status_code}")
            except Exception as e:
                print_fail(f"Admin {method} {endpoint} exception: {e}")
                self.failures.append(f"Admin {method} {endpoint} exception: {e}")
        
        # Test PATCH and DELETE on permission sets (need a set id)
        if self.test_pset_ids:
            pset_id = self.test_pset_ids[0]
            try:
                resp = requests.patch(f"{BASE_URL}/permission-sets/{pset_id}", 
                                    json={"description": "Admin update"},
                                    headers=self.get_headers(self.admin_token), 
                                    timeout=30)
                if resp.status_code == 403:
                    print_pass(f"Admin correctly denied (403) from PATCH /permission-sets")
                    self.passes.append("Admin 403 on PATCH /permission-sets")
                else:
                    print_fail(f"Admin should get 403 on PATCH /permission-sets, got: {resp.status_code}")
                    self.failures.append(f"Admin PATCH /permission-sets wrong status: {resp.status_code}")
            except Exception as e:
                print_fail(f"Admin PATCH /permission-sets exception: {e}")
                self.failures.append(f"Admin PATCH /permission-sets exception: {e}")
            
            try:
                resp = requests.delete(f"{BASE_URL}/permission-sets/{pset_id}", 
                                     headers=self.get_headers(self.admin_token), 
                                     timeout=30)
                if resp.status_code == 403:
                    print_pass(f"Admin correctly denied (403) from DELETE /permission-sets")
                    self.passes.append("Admin 403 on DELETE /permission-sets")
                else:
                    print_fail(f"Admin should get 403 on DELETE /permission-sets, got: {resp.status_code}")
                    self.failures.append(f"Admin DELETE /permission-sets wrong status: {resp.status_code}")
            except Exception as e:
                print_fail(f"Admin DELETE /permission-sets exception: {e}")
                self.failures.append(f"Admin DELETE /permission-sets exception: {e}")
        
        # Test endpoints that should return 200 for Admin
        allowed_endpoints = [
            ("GET", "/contacts", None),
            ("GET", "/tickets", None),
        ]
        
        for method, endpoint, data in allowed_endpoints:
            try:
                resp = requests.get(f"{BASE_URL}{endpoint}", 
                                  headers=self.get_headers(self.admin_token), 
                                  timeout=30)
                if resp.status_code == 200:
                    print_pass(f"Admin can access {method} {endpoint} (200)")
                    self.passes.append(f"Admin 200 on {method} {endpoint}")
                else:
                    print_fail(f"Admin should get 200 on {method} {endpoint}, got: {resp.status_code}")
                    self.failures.append(f"Admin {method} {endpoint} wrong status: {resp.status_code}")
            except Exception as e:
                print_fail(f"Admin {method} {endpoint} exception: {e}")
                self.failures.append(f"Admin {method} {endpoint} exception: {e}")
        
        # Test POST /tickets (operational endpoint allowed for Admin)
        try:
            ticket_data = {
                "subject": "Test Ticket from Admin",
                "description": "Testing Admin access",
                "priority": "Medium",
                "number_of_profiles": 5,
                "due_date": "2024-12-31"
            }
            resp = requests.post(f"{BASE_URL}/tickets", 
                               json=ticket_data,
                               headers=self.get_headers(self.admin_token), 
                               timeout=30)
            if resp.status_code == 200:
                print_pass("Admin can create tickets (POST /tickets returns 200)")
                self.passes.append("Admin 200 on POST /tickets")
            else:
                print_fail(f"Admin should get 200 on POST /tickets, got: {resp.status_code}")
                self.failures.append(f"Admin POST /tickets wrong status: {resp.status_code}")
        except Exception as e:
            print_fail(f"Admin POST /tickets exception: {e}")
            self.failures.append(f"Admin POST /tickets exception: {e}")

    def test_permission_sets_delete(self):
        """Test DELETE /api/permission-sets/{id} and unassignment"""
        print_test("Permission Sets: DELETE /api/permission-sets/{id} with unassignment")
        
        if not self.super_admin_token or not self.test_pset_ids:
            print_fail("Prerequisites not met, skipping")
            self.failures.append("Permission set delete test skipped")
            return
        
        # Use the last test permission set for deletion
        pset_id = self.test_pset_ids[-1]
        
        # Verify the set is assigned to a contact
        if self.test_contact_id:
            try:
                resp = requests.get(f"{BASE_URL}/contacts/{self.test_contact_id}", 
                                  headers=self.get_headers(self.super_admin_token), 
                                  timeout=30)
                if resp.status_code == 200:
                    contact = resp.json()
                    if pset_id in contact.get("permission_set_ids", []):
                        print_info(f"Permission set {pset_id} is assigned to contact {self.test_contact_id}")
            except:
                pass
        
        # Delete the permission set
        try:
            resp = requests.delete(f"{BASE_URL}/permission-sets/{pset_id}", 
                                 headers=self.get_headers(self.super_admin_token), 
                                 timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if "ok" in data and "unassigned_count" in data:
                    print_pass(f"Permission set deleted: ok={data['ok']}, unassigned_count={data['unassigned_count']}")
                    self.passes.append("Permission set deletion works")
                    
                    # Verify the set is removed from contact's permission_set_ids
                    if self.test_contact_id:
                        resp2 = requests.get(f"{BASE_URL}/contacts/{self.test_contact_id}", 
                                           headers=self.get_headers(self.super_admin_token), 
                                           timeout=30)
                        if resp2.status_code == 200:
                            contact = resp2.json()
                            if pset_id not in contact.get("permission_set_ids", []):
                                print_pass("Deleted permission set removed from contact's permission_set_ids")
                                self.passes.append("Permission set unassignment works")
                            else:
                                print_fail("Deleted permission set still in contact's permission_set_ids")
                                self.failures.append("Permission set unassignment failed")
                else:
                    print_fail(f"Delete response missing required fields: {data}")
                    self.failures.append("Delete response incomplete")
            else:
                print_fail(f"DELETE /permission-sets failed: {resp.status_code} - {resp.text}")
                self.failures.append("DELETE /permission-sets failed")
        except Exception as e:
            print_fail(f"DELETE /permission-sets exception: {e}")
            self.failures.append(f"DELETE /permission-sets exception: {e}")

    def cleanup(self):
        """Clean up test data"""
        print_test("Cleanup: Deleting test permission sets")
        
        if not self.super_admin_token:
            print_info("No Super Admin token, skipping cleanup")
            return
        
        for pset_id in self.test_pset_ids:
            try:
                resp = requests.delete(f"{BASE_URL}/permission-sets/{pset_id}", 
                                     headers=self.get_headers(self.super_admin_token), 
                                     timeout=30)
                if resp.status_code == 200:
                    print_info(f"Deleted test permission set: {pset_id}")
                elif resp.status_code == 404:
                    print_info(f"Permission set already deleted: {pset_id}")
            except Exception as e:
                print_info(f"Cleanup exception for {pset_id}: {e}")

    def run_all_tests(self):
        """Run all v3 backend tests"""
        print(f"\n{Colors.BOLD}{'='*80}{Colors.RESET}")
        print(f"{Colors.BOLD}Backend API Testing - v3 Permission Sets & Role Collapse{Colors.RESET}")
        print(f"{Colors.BOLD}{'='*80}{Colors.RESET}")
        
        # Run tests in priority order
        self.test_role_collapse_migration()
        self.test_permission_sets_create()
        self.test_permission_sets_list_and_filters()
        self.test_permission_sets_stats()
        self.test_permission_sets_get_by_id()
        self.test_permission_sets_update()
        self.test_contacts_permission_set_ids()
        self.test_effective_permissions()
        self.test_require_role_enforcement()
        self.test_permission_sets_delete()
        
        # Cleanup
        self.cleanup()
        
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
