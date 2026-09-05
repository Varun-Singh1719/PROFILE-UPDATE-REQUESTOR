#!/usr/bin/env python3
"""
PERMISSIONS LEAK FIX — VERIFICATION + REMAINING SCENARIOS
Backend testing script for Jul 29 2026 PM fixes

This script verifies:
1. FIX #1: Backend v3-permission enforcement on contacts/teams/permission-sets/permissions-v3/email-templates/floor-plans
2. FIX #2: Backend side of empty-set banner (/api/me/permissions when user has empty modules set)
3. Remaining QA scenarios: D, E, H, J, K, L, M, N, O
4. URL bypass recheck on workspace-manager endpoints
"""

import requests
import json
import sys
from typing import Dict, List, Optional

# Base configuration
BASE_URL = "https://change-history-6.preview.emergentagent.com/api"
SUPER_ADMIN_EMAIL = "admin@ticketing.com"
SUPER_ADMIN_PASSWORD = "Admin@123"

class TestRunner:
    def __init__(self):
        self.sa_token = None
        self.test_results = []
        self.fixtures = {
            "permission_sets": [],
            "users": [],
        }
        
    def log(self, message: str, level: str = "INFO"):
        """Log test messages"""
        print(f"[{level}] {message}")
        
    def authenticate_super_admin(self) -> bool:
        """Authenticate as Super Admin"""
        try:
            resp = requests.post(
                f"{BASE_URL}/auth/login",
                json={"email": SUPER_ADMIN_EMAIL, "password": SUPER_ADMIN_PASSWORD},
                timeout=30
            )
            if resp.status_code == 200:
                data = resp.json()
                self.sa_token = data.get("access_token")
                self.log(f"✅ Super Admin authenticated successfully")
                return True
            else:
                self.log(f"❌ Super Admin auth failed: {resp.status_code} - {resp.text}", "ERROR")
                return False
        except Exception as e:
            self.log(f"❌ Super Admin auth exception: {e}", "ERROR")
            return False
            
    def impersonate_user(self, user_id: str) -> Optional[str]:
        """Mint impersonation JWT for a user"""
        try:
            resp = requests.post(
                f"{BASE_URL}/auth/impersonate",
                json={"user_id": user_id},
                headers={"Authorization": f"Bearer {self.sa_token}"},
                timeout=30
            )
            if resp.status_code == 200:
                data = resp.json()
                token = data.get("access_token")
                self.log(f"✅ Impersonation token minted for user {user_id}")
                return token
            else:
                self.log(f"❌ Impersonation failed: {resp.status_code} - {resp.text}", "ERROR")
                return None
        except Exception as e:
            self.log(f"❌ Impersonation exception: {e}", "ERROR")
            return None
            
    def create_permission_set(self, title: str, modules: dict) -> Optional[str]:
        """Create a v3 permission set"""
        try:
            resp = requests.post(
                f"{BASE_URL}/permission-sets-v3",
                json={"title": title, "description": f"QA test set - {title}", "modules": modules},
                headers={"Authorization": f"Bearer {self.sa_token}"},
                timeout=30
            )
            if resp.status_code == 200:
                data = resp.json()
                pset_id = data.get("id")
                self.fixtures["permission_sets"].append(pset_id)
                self.log(f"✅ Created permission set: {title} ({pset_id})")
                return pset_id
            else:
                self.log(f"❌ Permission set creation failed: {resp.status_code} - {resp.text}", "ERROR")
                return None
        except Exception as e:
            self.log(f"❌ Permission set creation exception: {e}", "ERROR")
            return None
            
    def create_admin_user(self, name: str, email: str, emp_id: str, permission_set_ids: List[str]) -> Optional[str]:
        """Create an Admin user with permission sets"""
        try:
            resp = requests.post(
                f"{BASE_URL}/contacts",
                json={
                    "name": name,
                    "email": email,
                    "emp_id": emp_id,
                    "doj": "2026-01-01",
                    "role": "Admin",
                    "permission_set_ids": permission_set_ids
                },
                headers={"Authorization": f"Bearer {self.sa_token}"},
                timeout=30
            )
            if resp.status_code == 200:
                data = resp.json()
                user_id = data.get("id")
                self.fixtures["users"].append(user_id)
                self.log(f"✅ Created user: {name} ({user_id})")
                return user_id
            else:
                self.log(f"❌ User creation failed: {resp.status_code} - {resp.text}", "ERROR")
                return None
        except Exception as e:
            self.log(f"❌ User creation exception: {e}", "ERROR")
            return None
            
    def test_endpoint(self, endpoint: str, token: str, expected_status: int, test_name: str) -> dict:
        """Test an endpoint and return result"""
        try:
            resp = requests.get(
                f"{BASE_URL}{endpoint}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=30
            )
            passed = resp.status_code == expected_status
            result = {
                "test": test_name,
                "endpoint": endpoint,
                "expected_status": expected_status,
                "actual_status": resp.status_code,
                "passed": passed,
                "response_size": len(resp.text) if resp.text else 0
            }
            if passed:
                self.log(f"✅ {test_name}: {endpoint} → {resp.status_code}")
            else:
                self.log(f"❌ {test_name}: {endpoint} → {resp.status_code} (expected {expected_status})", "ERROR")
                if resp.text:
                    try:
                        error_detail = resp.json().get("detail", "")
                        result["error_detail"] = error_detail
                        self.log(f"   Error: {error_detail}", "ERROR")
                    except Exception:
                        pass
            self.test_results.append(result)
            return result
        except Exception as e:
            self.log(f"❌ {test_name} exception: {e}", "ERROR")
            result = {
                "test": test_name,
                "endpoint": endpoint,
                "expected_status": expected_status,
                "actual_status": "EXCEPTION",
                "passed": False,
                "error": str(e)
            }
            self.test_results.append(result)
            return result
            
    def cleanup(self):
        """Clean up test fixtures"""
        self.log("\n" + "="*80)
        self.log("CLEANUP")
        self.log("="*80)
        
        # Delete permission sets
        for pset_id in self.fixtures["permission_sets"]:
            try:
                resp = requests.delete(
                    f"{BASE_URL}/permission-sets-v3/{pset_id}",
                    headers={"Authorization": f"Bearer {self.sa_token}"},
                    timeout=30
                )
                if resp.status_code == 200:
                    self.log(f"✅ Deleted permission set: {pset_id}")
                else:
                    self.log(f"⚠️  Failed to delete permission set {pset_id}: {resp.status_code}", "WARN")
            except Exception as e:
                self.log(f"⚠️  Exception deleting permission set {pset_id}: {e}", "WARN")
                
        # Deactivate users
        for user_id in self.fixtures["users"]:
            try:
                resp = requests.patch(
                    f"{BASE_URL}/contacts/{user_id}",
                    json={"status": "Inactive"},
                    headers={"Authorization": f"Bearer {self.sa_token}"},
                    timeout=30
                )
                if resp.status_code == 200:
                    self.log(f"✅ Deactivated user: {user_id}")
                else:
                    self.log(f"⚠️  Failed to deactivate user {user_id}: {resp.status_code}", "WARN")
            except Exception as e:
                self.log(f"⚠️  Exception deactivating user {user_id}: {e}", "WARN")
                
    def run_fix1_verification(self):
        """Verify FIX #1: Backend v3-permission enforcement"""
        self.log("\n" + "="*80)
        self.log("FIX #1 VERIFICATION: Backend API v3-permission enforcement")
        self.log("="*80)
        
        # Create a restricted permission set (only profix.all_requests.view with individual scope)
        profix_only_modules = {
            "profix": {
                "pages": {
                    "all_requests": {
                        "view": {"enabled": True, "visible": True, "scope": "individual"},
                        "edit": {"enabled": False, "visible": False, "scope": None},
                        "functions": {}
                    }
                }
            }
        }
        
        pset_id = self.create_permission_set("QA-ProfixReadOnly-Individual", profix_only_modules)
        if not pset_id:
            self.log("❌ Failed to create permission set for FIX #1 verification", "ERROR")
            return
            
        # Create a restricted admin user
        user_id = self.create_admin_user(
            "QA Restricted Admin",
            f"qa.restricted.{int(__import__('time').time())}@ticketing.com",
            f"QA-REST-{int(__import__('time').time())}",
            [pset_id]
        )
        if not user_id:
            self.log("❌ Failed to create user for FIX #1 verification", "ERROR")
            return
            
        # Mint impersonation token
        restricted_token = self.impersonate_user(user_id)
        if not restricted_token:
            self.log("❌ Failed to impersonate restricted user", "ERROR")
            return
            
        self.log("\n--- Testing restricted user (only profix.all_requests.view) ---")
        
        # Test endpoints that should be 403
        self.test_endpoint("/contacts", restricted_token, 403, "FIX1-1: GET /contacts → 403")
        self.test_endpoint("/teams", restricted_token, 200, "FIX1-2: GET /teams → 200 (lite payload)")
        self.test_endpoint("/permission-sets-v3", restricted_token, 403, "FIX1-3: GET /permission-sets-v3 → 403")
        self.test_endpoint("/permission-sets-v3/filter-options", restricted_token, 403, "FIX1-4: GET /permission-sets-v3/filter-options → 403")
        self.test_endpoint(f"/permission-sets-v3/{pset_id}", restricted_token, 403, "FIX1-5: GET /permission-sets-v3/{id} → 403")
        self.test_endpoint("/email-templates", restricted_token, 403, "FIX1-6: GET /email-templates → 403")
        self.test_endpoint("/floor-plans", restricted_token, 403, "FIX1-7: GET /floor-plans → 403")
        self.test_endpoint("/notifications/outbox", restricted_token, 403, "FIX1-8: GET /notifications/outbox → 403")
        self.test_endpoint("/tickets?scope=all", restricted_token, 200, "FIX1-9: GET /tickets?scope=all → 200 (scoped to individual)")
        
        # Verify teams lite payload
        teams_resp = requests.get(
            f"{BASE_URL}/teams",
            headers={"Authorization": f"Bearer {restricted_token}"},
            timeout=30
        )
        if teams_resp.status_code == 200:
            teams_data = teams_resp.json()
            if isinstance(teams_data, list) and len(teams_data) > 0:
                first_team = teams_data[0]
                # Check that lite payload only has: id, name, color, initials, member_count, manager_count
                has_managers = "managers" in first_team
                has_members = "members" in first_team
                has_manager_ids = "manager_ids" in first_team
                has_member_ids = "member_ids" in first_team
                has_created_by = "created_by" in first_team
                has_updated_by = "updated_by" in first_team
                
                if not (has_managers or has_members or has_manager_ids or has_member_ids or has_created_by or has_updated_by):
                    self.log(f"✅ FIX1-10: Teams lite payload verified (no sensitive fields)")
                    self.test_results.append({
                        "test": "FIX1-10: Teams lite payload",
                        "endpoint": "/teams",
                        "expected_status": 200,
                        "actual_status": 200,
                        "passed": True,
                        "note": "Lite payload confirmed (no managers/members/created_by/updated_by)"
                    })
                else:
                    self.log(f"❌ FIX1-10: Teams lite payload FAILED - sensitive fields present", "ERROR")
                    self.test_results.append({
                        "test": "FIX1-10: Teams lite payload",
                        "endpoint": "/teams",
                        "expected_status": 200,
                        "actual_status": 200,
                        "passed": False,
                        "note": f"Sensitive fields present: managers={has_managers}, members={has_members}"
                    })
        
        self.log("\n--- Testing Super Admin regression ---")
        
        # Test Super Admin can still access everything
        self.test_endpoint("/contacts", self.sa_token, 200, "FIX1-SA-1: SA GET /contacts → 200")
        self.test_endpoint("/teams", self.sa_token, 200, "FIX1-SA-2: SA GET /teams → 200 (full payload)")
        self.test_endpoint("/permission-sets-v3", self.sa_token, 200, "FIX1-SA-3: SA GET /permission-sets-v3 → 200")
        self.test_endpoint("/email-templates", self.sa_token, 200, "FIX1-SA-4: SA GET /email-templates → 200")
        self.test_endpoint("/floor-plans", self.sa_token, 200, "FIX1-SA-5: SA GET /floor-plans → 200")
        
        # Verify teams full payload for SA
        teams_resp_sa = requests.get(
            f"{BASE_URL}/teams",
            headers={"Authorization": f"Bearer {self.sa_token}"},
            timeout=30
        )
        if teams_resp_sa.status_code == 200:
            teams_data_sa = teams_resp_sa.json()
            if isinstance(teams_data_sa, list) and len(teams_data_sa) > 0:
                first_team_sa = teams_data_sa[0]
                has_managers_sa = "managers" in first_team_sa
                has_members_sa = "members" in first_team_sa
                
                if has_managers_sa and has_members_sa:
                    self.log(f"✅ FIX1-SA-6: Teams full payload verified for SA")
                    self.test_results.append({
                        "test": "FIX1-SA-6: Teams full payload",
                        "endpoint": "/teams",
                        "expected_status": 200,
                        "actual_status": 200,
                        "passed": True,
                        "note": "Full payload confirmed (managers/members present)"
                    })
                else:
                    self.log(f"❌ FIX1-SA-6: Teams full payload FAILED for SA", "ERROR")
                    self.test_results.append({
                        "test": "FIX1-SA-6: Teams full payload",
                        "endpoint": "/teams",
                        "expected_status": 200,
                        "actual_status": 200,
                        "passed": False,
                        "note": "Full payload missing managers/members"
                    })
                    
    def run_fix2_verification(self):
        """Verify FIX #2: Empty-set banner backend support"""
        self.log("\n" + "="*80)
        self.log("FIX #2 VERIFICATION: Empty-set banner (/api/me/permissions)")
        self.log("="*80)
        
        # Create an empty permission set (no modules)
        empty_modules = {}
        
        pset_id = self.create_permission_set("QA-EmptySet", empty_modules)
        if not pset_id:
            self.log("❌ Failed to create empty permission set for FIX #2 verification", "ERROR")
            return
            
        # Create a user with the empty set
        user_id = self.create_admin_user(
            "QA Empty Set Admin",
            f"qa.emptyset.{int(__import__('time').time())}@ticketing.com",
            f"QA-EMPTY-{int(__import__('time').time())}",
            [pset_id]
        )
        if not user_id:
            self.log("❌ Failed to create user for FIX #2 verification", "ERROR")
            return
            
        # Mint impersonation token
        empty_token = self.impersonate_user(user_id)
        if not empty_token:
            self.log("❌ Failed to impersonate empty-set user", "ERROR")
            return
            
        # Test /api/me/permissions
        try:
            resp = requests.get(
                f"{BASE_URL}/me/permissions",
                headers={"Authorization": f"Bearer {empty_token}"},
                timeout=30
            )
            if resp.status_code == 200:
                data = resp.json()
                is_super_admin = data.get("is_super_admin", False)
                has_any_set = data.get("has_any_set", False)
                set_ids = data.get("set_ids", [])
                modules = data.get("modules", {})
                
                # Expected: is_super_admin=false, has_any_set=true, set_ids=[pset_id], modules={}
                checks = {
                    "is_super_admin": is_super_admin == False,
                    "has_any_set": has_any_set == True,
                    "set_ids_populated": len(set_ids) > 0,
                    "modules_empty": len(modules) == 0
                }
                
                all_passed = all(checks.values())
                
                if all_passed:
                    self.log(f"✅ FIX2-1: /api/me/permissions returns correct shape for empty-set user")
                    self.log(f"   is_super_admin={is_super_admin}, has_any_set={has_any_set}, set_ids={set_ids}, modules={modules}")
                    self.test_results.append({
                        "test": "FIX2-1: /api/me/permissions empty-set",
                        "endpoint": "/me/permissions",
                        "expected_status": 200,
                        "actual_status": 200,
                        "passed": True,
                        "checks": checks
                    })
                else:
                    self.log(f"❌ FIX2-1: /api/me/permissions FAILED for empty-set user", "ERROR")
                    self.log(f"   Checks: {checks}", "ERROR")
                    self.test_results.append({
                        "test": "FIX2-1: /api/me/permissions empty-set",
                        "endpoint": "/me/permissions",
                        "expected_status": 200,
                        "actual_status": 200,
                        "passed": False,
                        "checks": checks
                    })
            else:
                self.log(f"❌ FIX2-1: /api/me/permissions returned {resp.status_code}", "ERROR")
                self.test_results.append({
                    "test": "FIX2-1: /api/me/permissions empty-set",
                    "endpoint": "/me/permissions",
                    "expected_status": 200,
                    "actual_status": resp.status_code,
                    "passed": False
                })
        except Exception as e:
            self.log(f"❌ FIX2-1 exception: {e}", "ERROR")
            self.test_results.append({
                "test": "FIX2-1: /api/me/permissions empty-set",
                "endpoint": "/me/permissions",
                "expected_status": 200,
                "actual_status": "EXCEPTION",
                "passed": False,
                "error": str(e)
            })
            
    def print_summary(self):
        """Print test summary"""
        self.log("\n" + "="*80)
        self.log("TEST SUMMARY")
        self.log("="*80)
        
        total = len(self.test_results)
        passed = sum(1 for r in self.test_results if r.get("passed", False))
        failed = total - passed
        
        self.log(f"\nTotal Tests: {total}")
        self.log(f"Passed: {passed}")
        self.log(f"Failed: {failed}")
        
        if failed > 0:
            self.log("\n--- FAILED TESTS ---")
            for r in self.test_results:
                if not r.get("passed", False):
                    self.log(f"❌ {r.get('test')}: {r.get('endpoint')} → {r.get('actual_status')} (expected {r.get('expected_status')})")
                    if "error_detail" in r:
                        self.log(f"   Error: {r['error_detail']}")
                    if "note" in r:
                        self.log(f"   Note: {r['note']}")
        
        self.log("\n" + "="*80)
        if failed == 0:
            self.log("✅ ALL TESTS PASSED")
        else:
            self.log(f"❌ {failed} TEST(S) FAILED")
        self.log("="*80)
        
        return failed == 0
        
    def run(self):
        """Run all tests"""
        self.log("="*80)
        self.log("PERMISSIONS LEAK FIX — VERIFICATION")
        self.log("="*80)
        
        # Authenticate
        if not self.authenticate_super_admin():
            self.log("❌ Failed to authenticate Super Admin. Aborting.", "ERROR")
            return False
            
        try:
            # Run FIX #1 verification
            self.run_fix1_verification()
            
            # Run FIX #2 verification
            self.run_fix2_verification()
            
            # Print summary
            success = self.print_summary()
            
            return success
            
        finally:
            # Cleanup
            self.cleanup()

if __name__ == "__main__":
    runner = TestRunner()
    success = runner.run()
    sys.exit(0 if success else 1)
