#!/usr/bin/env python3
"""
Backend API Testing Script for SESSION 2026-08-16 (rev-5)
Tests 3 backend changes for ticketing/workspace app.
"""

import requests
import json
import sys
from typing import Optional

# Configuration
BACKEND_URL = "https://checkbox-orange.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@ticketing.com"
ADMIN_PASSWORD = "Admin@123"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'

def log_info(msg):
    print(f"{Colors.BLUE}ℹ {msg}{Colors.RESET}")

def log_success(msg):
    print(f"{Colors.GREEN}✓ {msg}{Colors.RESET}")

def log_error(msg):
    print(f"{Colors.RED}✗ {msg}{Colors.RESET}")

def log_warning(msg):
    print(f"{Colors.YELLOW}⚠ {msg}{Colors.RESET}")

class BackendTester:
    def __init__(self):
        self.token: Optional[str] = None
        self.headers = {}
        self.results = {
            "task1": {"name": "Recent Updates filters by UPDATE date", "passed": False, "details": []},
            "task2": {"name": "ProfiX Dashboard Metric required (400 guard)", "passed": False, "details": []},
            "task3": {"name": "filter_team catalog", "passed": False, "details": []},
        }
        self.created_sets = []  # Track created permission sets for cleanup

    def login(self):
        """Authenticate and get access token"""
        log_info("Logging in as Super Admin...")
        try:
            response = requests.post(
                f"{BACKEND_URL}/auth/login",
                json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                timeout=30
            )
            if response.status_code == 200:
                data = response.json()
                self.token = data.get("access_token")
                self.headers = {"Authorization": f"Bearer {self.token}"}
                log_success(f"Login successful. Token: {self.token[:20]}...")
                return True
            else:
                log_error(f"Login failed: {response.status_code} - {response.text}")
                return False
        except Exception as e:
            log_error(f"Login exception: {e}")
            return False

    def test_task1_recent_updates_filter(self):
        """
        TASK 1: Recent Updates filters by UPDATE date, not creation date
        - Call GET /api/dashboard/recent?kind=updated&limit=6&date_field=created_at&date_from=2026-08-01&date_to=2026-08-31
        - EXPECT: TKT-1120 IS present (created 2026-07-29, updated 2026-08-16)
        - Results sorted by updated_on desc
        - Also check kind=new filters by creation date
        """
        log_info("\n" + "="*80)
        log_info("TASK 1: Testing Recent Updates filter by UPDATE date")
        log_info("="*80)
        
        task = self.results["task1"]
        
        # Test 1.1: kind=updated should filter by updated_on and include TKT-1120
        log_info("\n[1.1] Testing kind=updated with August 2026 window...")
        try:
            response = requests.get(
                f"{BACKEND_URL}/dashboard/recent",
                headers=self.headers,
                params={
                    "kind": "updated",
                    "limit": 6,
                    "date_field": "created_at",  # Should be overridden to updated_at
                    "date_from": "2026-08-01",
                    "date_to": "2026-08-31"
                },
                timeout=30
            )
            
            if response.status_code != 200:
                log_error(f"HTTP {response.status_code}: {response.text}")
                task["details"].append(f"❌ 1.1 FAIL: HTTP {response.status_code}")
                return
            
            tickets = response.json()
            log_success(f"Returned {len(tickets)} tickets")
            
            # Check if TKT-1120 is present
            tkt_1120 = None
            for t in tickets:
                ticket_id = t.get("ticket_id", "")
                log_info(f"  - {ticket_id}: created_on={t.get('created_on', 'N/A')[:10]}, updated_on={t.get('updated_on', 'N/A')[:10]}")
                if ticket_id == "TKT-1120":
                    tkt_1120 = t
            
            if tkt_1120:
                log_success(f"✓ TKT-1120 IS PRESENT in results")
                log_info(f"  TKT-1120 details: created_on={tkt_1120.get('created_on', 'N/A')}, updated_on={tkt_1120.get('updated_on', 'N/A')}")
                task["details"].append("✓ 1.1 PASS: TKT-1120 present in August updated window")
                
                # Verify it was created in July but updated in August
                created_on = tkt_1120.get("created_on", "")
                updated_on = tkt_1120.get("updated_on", "")
                if "2026-07" in created_on and "2026-08" in updated_on:
                    log_success("✓ TKT-1120 created in July 2026, updated in August 2026 (correct)")
                    task["details"].append("✓ TKT-1120 dates verified: created July, updated August")
                else:
                    log_warning(f"⚠ TKT-1120 dates: created={created_on}, updated={updated_on}")
                    task["details"].append(f"⚠ TKT-1120 dates: created={created_on}, updated={updated_on}")
            else:
                log_error("✗ TKT-1120 NOT FOUND in results (BUG)")
                task["details"].append("❌ 1.1 FAIL: TKT-1120 missing from August updated window")
                return
            
            # Verify sorting by updated_on desc
            if len(tickets) > 1:
                sorted_correctly = True
                for i in range(len(tickets) - 1):
                    curr_updated = tickets[i].get("updated_on", "")
                    next_updated = tickets[i+1].get("updated_on", "")
                    if curr_updated < next_updated:
                        sorted_correctly = False
                        break
                
                if sorted_correctly:
                    log_success("✓ Results sorted by updated_on desc (correct)")
                    task["details"].append("✓ Sorting by updated_on desc verified")
                else:
                    log_error("✗ Results NOT sorted by updated_on desc")
                    task["details"].append("❌ Sorting incorrect")
            
        except Exception as e:
            log_error(f"Exception in 1.1: {e}")
            task["details"].append(f"❌ 1.1 FAIL: Exception - {e}")
            return
        
        # Test 1.2: kind=new should filter by created_on (sanity check)
        log_info("\n[1.2] Testing kind=new with August 2026 window (sanity check)...")
        try:
            response = requests.get(
                f"{BACKEND_URL}/dashboard/recent",
                headers=self.headers,
                params={
                    "kind": "new",
                    "limit": 6,
                    "date_field": "created_at",
                    "date_from": "2026-08-01",
                    "date_to": "2026-08-31"
                },
                timeout=30
            )
            
            if response.status_code != 200:
                log_error(f"HTTP {response.status_code}: {response.text}")
                task["details"].append(f"❌ 1.2 FAIL: HTTP {response.status_code}")
                return
            
            tickets = response.json()
            log_success(f"Returned {len(tickets)} tickets")
            
            # TKT-1120 should NOT appear (created in July)
            tkt_1120_found = any(t.get("ticket_id") == "TKT-1120" for t in tickets)
            
            if not tkt_1120_found:
                log_success("✓ TKT-1120 NOT present in August 'new' window (correct - created in July)")
                task["details"].append("✓ 1.2 PASS: TKT-1120 correctly excluded from August 'new' window")
            else:
                log_error("✗ TKT-1120 found in August 'new' window (should be excluded)")
                task["details"].append("❌ 1.2 FAIL: TKT-1120 incorrectly included in 'new' window")
                return
            
            # Verify all returned tickets were created in August
            all_august = True
            for t in tickets:
                created_on = t.get("created_on", "")
                if "2026-08" not in created_on:
                    all_august = False
                    log_warning(f"⚠ {t.get('ticket_id')} created on {created_on} (not August)")
            
            if all_august:
                log_success("✓ All 'new' tickets created in August 2026 (correct)")
                task["details"].append("✓ All 'new' tickets created in August")
            
        except Exception as e:
            log_error(f"Exception in 1.2: {e}")
            task["details"].append(f"❌ 1.2 FAIL: Exception - {e}")
            return
        
        # Mark task as passed
        task["passed"] = True
        log_success("\n✓✓✓ TASK 1 PASSED ✓✓✓")

    def test_task2_profix_dashboard_metric_required(self):
        """
        TASK 2: ProfiX Dashboard Metric required (400 guard)
        - POST /api/permission-sets-v3 with profix dashboard access but no metric -> 400
        - POST with metric -> 200
        - PUT without metric -> 400
        - Cleanup all created sets
        """
        log_info("\n" + "="*80)
        log_info("TASK 2: Testing ProfiX Dashboard Metric required validation")
        log_info("="*80)
        
        task = self.results["task2"]
        
        # Test 2.1: POST without metric should return 400
        log_info("\n[2.1] Testing POST without metric (expect 400)...")
        try:
            payload = {
                "title": "__tmp_test_a",
                "modules": {
                    "dashboard": {
                        "pages": {
                            "profix": {
                                "access_level": "individual"
                            }
                        }
                    }
                }
            }
            
            response = requests.post(
                f"{BACKEND_URL}/permission-sets-v3",
                headers=self.headers,
                json=payload,
                timeout=30
            )
            
            if response.status_code == 400:
                log_success(f"✓ HTTP 400 returned (correct)")
                error_msg = response.json().get("detail", "")
                log_info(f"  Error message: {error_msg}")
                if "metric" in error_msg.lower() or "dashboard" in error_msg.lower():
                    log_success("✓ Error message mentions metric/dashboard requirement")
                    task["details"].append("✓ 2.1 PASS: POST without metric returns 400 with correct error")
                else:
                    log_warning(f"⚠ Error message doesn't mention metric: {error_msg}")
                    task["details"].append(f"⚠ 2.1 PASS: 400 returned but error message unclear: {error_msg}")
            else:
                log_error(f"✗ HTTP {response.status_code} (expected 400)")
                log_error(f"  Response: {response.text}")
                task["details"].append(f"❌ 2.1 FAIL: Expected 400, got {response.status_code}")
                return
            
        except Exception as e:
            log_error(f"Exception in 2.1: {e}")
            task["details"].append(f"❌ 2.1 FAIL: Exception - {e}")
            return
        
        # Test 2.2: POST with metric should return 200
        log_info("\n[2.2] Testing POST with metric (expect 200)...")
        try:
            payload = {
                "title": "__tmp_test_b",
                "modules": {
                    "dashboard": {
                        "pages": {
                            "profix": {
                                "access_level": "individual",
                                "metrics_based_on": "created_by"
                            }
                        }
                    }
                }
            }
            
            response = requests.post(
                f"{BACKEND_URL}/permission-sets-v3",
                headers=self.headers,
                json=payload,
                timeout=30
            )
            
            if response.status_code == 200:
                data = response.json()
                set_id = data.get("id")
                self.created_sets.append(set_id)
                log_success(f"✓ HTTP 200 returned (correct)")
                log_info(f"  Created set ID: {set_id}")
                
                # Verify metrics_based_on is echoed back
                metrics = data.get("modules", {}).get("dashboard", {}).get("pages", {}).get("profix", {}).get("metrics_based_on")
                if metrics == "created_by":
                    log_success(f"✓ metrics_based_on='created_by' echoed back correctly")
                    task["details"].append("✓ 2.2 PASS: POST with metric returns 200, metric echoed correctly")
                else:
                    log_error(f"✗ metrics_based_on={metrics} (expected 'created_by')")
                    task["details"].append(f"❌ 2.2 FAIL: metrics_based_on={metrics}")
                    return
            else:
                log_error(f"✗ HTTP {response.status_code} (expected 200)")
                log_error(f"  Response: {response.text}")
                task["details"].append(f"❌ 2.2 FAIL: Expected 200, got {response.status_code}")
                return
            
        except Exception as e:
            log_error(f"Exception in 2.2: {e}")
            task["details"].append(f"❌ 2.2 FAIL: Exception - {e}")
            return
        
        # Test 2.3: Create a valid set, then PUT without metric should return 400
        log_info("\n[2.3] Testing PUT without metric (expect 400)...")
        try:
            # First create a valid set
            payload_create = {
                "title": "__tmp_test_c",
                "modules": {
                    "dashboard": {
                        "pages": {
                            "profix": {
                                "access_level": "individual",
                                "metrics_based_on": "assigned_to"
                            }
                        }
                    }
                }
            }
            
            response_create = requests.post(
                f"{BACKEND_URL}/permission-sets-v3",
                headers=self.headers,
                json=payload_create,
                timeout=30
            )
            
            if response_create.status_code != 200:
                log_error(f"Failed to create set for PUT test: {response_create.status_code}")
                task["details"].append(f"❌ 2.3 FAIL: Could not create set for PUT test")
                return
            
            set_id = response_create.json().get("id")
            self.created_sets.append(set_id)
            log_info(f"  Created set {set_id} for PUT test")
            
            # Now try to PUT with access_level but no metric
            payload_update = {
                "title": "__tmp_test_c",
                "modules": {
                    "dashboard": {
                        "pages": {
                            "profix": {
                                "access_level": "manager"
                                # metrics_based_on intentionally omitted
                            }
                        }
                    }
                }
            }
            
            response_update = requests.put(
                f"{BACKEND_URL}/permission-sets-v3/{set_id}",
                headers=self.headers,
                json=payload_update,
                timeout=30
            )
            
            if response_update.status_code == 400:
                log_success(f"✓ HTTP 400 returned (correct)")
                error_msg = response_update.json().get("detail", "")
                log_info(f"  Error message: {error_msg}")
                if "metric" in error_msg.lower() or "dashboard" in error_msg.lower():
                    log_success("✓ Error message mentions metric/dashboard requirement")
                    task["details"].append("✓ 2.3 PASS: PUT without metric returns 400 with correct error")
                else:
                    log_warning(f"⚠ Error message doesn't mention metric: {error_msg}")
                    task["details"].append(f"⚠ 2.3 PASS: 400 returned but error message unclear: {error_msg}")
            else:
                log_error(f"✗ HTTP {response_update.status_code} (expected 400)")
                log_error(f"  Response: {response_update.text}")
                task["details"].append(f"❌ 2.3 FAIL: Expected 400, got {response_update.status_code}")
                return
            
        except Exception as e:
            log_error(f"Exception in 2.3: {e}")
            task["details"].append(f"❌ 2.3 FAIL: Exception - {e}")
            return
        
        # Test 2.4: Verify we can PUT with metric (sanity check)
        log_info("\n[2.4] Testing PUT with metric (expect 200, sanity check)...")
        try:
            # Use the same set from 2.3
            if not self.created_sets:
                log_error("No sets created for PUT sanity check")
                task["details"].append("❌ 2.4 FAIL: No sets available")
                return
            
            set_id = self.created_sets[-1]  # Use last created set
            
            payload_update = {
                "title": "__tmp_test_c_updated",
                "modules": {
                    "dashboard": {
                        "pages": {
                            "profix": {
                                "access_level": "overall",
                                "metrics_based_on": "assigned_to"
                            }
                        }
                    }
                }
            }
            
            response = requests.put(
                f"{BACKEND_URL}/permission-sets-v3/{set_id}",
                headers=self.headers,
                json=payload_update,
                timeout=30
            )
            
            if response.status_code == 200:
                log_success(f"✓ HTTP 200 returned (correct)")
                data = response.json()
                metrics = data.get("modules", {}).get("dashboard", {}).get("pages", {}).get("profix", {}).get("metrics_based_on")
                if metrics == "assigned_to":
                    log_success(f"✓ PUT with metric successful, metrics_based_on='assigned_to'")
                    task["details"].append("✓ 2.4 PASS: PUT with metric returns 200")
                else:
                    log_warning(f"⚠ metrics_based_on={metrics}")
            else:
                log_error(f"✗ HTTP {response.status_code} (expected 200)")
                task["details"].append(f"❌ 2.4 FAIL: Expected 200, got {response.status_code}")
                return
            
        except Exception as e:
            log_error(f"Exception in 2.4: {e}")
            task["details"].append(f"❌ 2.4 FAIL: Exception - {e}")
            return
        
        # Mark task as passed
        task["passed"] = True
        log_success("\n✓✓✓ TASK 2 PASSED ✓✓✓")

    def test_task3_filter_team_catalog(self):
        """
        TASK 3: filter_team added to desk_booking.floor_layout catalog
        - GET /api/permissions/schema/v3
        - Find module 'desk_booking' -> page 'floor_layout' -> functions
        - Verify 'filter_team' exists with category 'filter'
        - Also verify search/filter_floor/filter_zone still present
        """
        log_info("\n" + "="*80)
        log_info("TASK 3: Testing filter_team in desk_booking.floor_layout catalog")
        log_info("="*80)
        
        task = self.results["task3"]
        
        log_info("\n[3.1] Fetching permissions schema v3...")
        try:
            response = requests.get(
                f"{BACKEND_URL}/permissions/schema/v3",
                headers=self.headers,
                timeout=30
            )
            
            if response.status_code != 200:
                log_error(f"HTTP {response.status_code}: {response.text}")
                task["details"].append(f"❌ 3.1 FAIL: HTTP {response.status_code}")
                return
            
            schema = response.json()
            log_success("✓ Schema fetched successfully")
            
            # Navigate to desk_booking module
            modules = schema.get("modules", [])
            desk_booking = None
            for m in modules:
                if m.get("key") == "desk_booking":
                    desk_booking = m
                    break
            
            if not desk_booking:
                log_error("✗ desk_booking module not found in schema")
                task["details"].append("❌ 3.1 FAIL: desk_booking module not found")
                return
            
            log_success("✓ desk_booking module found")
            
            # Navigate to floor_layout page
            pages = desk_booking.get("pages", [])
            floor_layout = None
            for p in pages:
                if p.get("key") == "floor_layout":
                    floor_layout = p
                    break
            
            if not floor_layout:
                log_error("✗ floor_layout page not found in desk_booking")
                task["details"].append("❌ 3.1 FAIL: floor_layout page not found")
                return
            
            log_success("✓ floor_layout page found")
            
            # Check functions list
            functions = floor_layout.get("functions", [])
            log_info(f"  floor_layout has {len(functions)} functions")
            
            # Find filter_team
            filter_team = None
            for f in functions:
                if f.get("key") == "filter_team":
                    filter_team = f
                    break
            
            if not filter_team:
                log_error("✗ filter_team function NOT FOUND in floor_layout.functions")
                log_info("  Available functions:")
                for f in functions:
                    log_info(f"    - {f.get('key')}: {f.get('label')}")
                task["details"].append("❌ 3.1 FAIL: filter_team not found in floor_layout.functions")
                return
            
            log_success(f"✓ filter_team function FOUND")
            log_info(f"  filter_team details: {json.dumps(filter_team, indent=2)}")
            
            # Verify category is 'filter'
            category = filter_team.get("category")
            if category == "filter":
                log_success(f"✓ filter_team category='filter' (correct)")
                task["details"].append("✓ 3.1 PASS: filter_team found with category='filter'")
            else:
                log_error(f"✗ filter_team category='{category}' (expected 'filter')")
                task["details"].append(f"❌ 3.1 FAIL: filter_team category='{category}'")
                return
            
            # Verify label
            label = filter_team.get("label")
            if label:
                log_success(f"✓ filter_team label='{label}'")
            
            # Verify other filter functions still present (regression check)
            log_info("\n[3.2] Verifying other filter functions (regression check)...")
            required_functions = ["search", "filter_floor", "filter_zone"]
            all_present = True
            
            for req_fn in required_functions:
                found = any(f.get("key") == req_fn for f in functions)
                if found:
                    log_success(f"✓ {req_fn} present")
                else:
                    log_error(f"✗ {req_fn} MISSING")
                    all_present = False
            
            if all_present:
                log_success("✓ All expected functions present (no regression)")
                task["details"].append("✓ 3.2 PASS: search/filter_floor/filter_zone still present")
            else:
                log_error("✗ Some expected functions missing")
                task["details"].append("❌ 3.2 FAIL: Some functions missing")
                return
            
        except Exception as e:
            log_error(f"Exception in task 3: {e}")
            task["details"].append(f"❌ 3.1 FAIL: Exception - {e}")
            return
        
        # Mark task as passed
        task["passed"] = True
        log_success("\n✓✓✓ TASK 3 PASSED ✓✓✓")

    def cleanup_permission_sets(self):
        """Delete all permission sets created during testing"""
        if not self.created_sets:
            log_info("\nNo permission sets to clean up")
            return
        
        log_info(f"\n{'='*80}")
        log_info(f"CLEANUP: Deleting {len(self.created_sets)} created permission sets")
        log_info(f"{'='*80}")
        
        for set_id in self.created_sets:
            try:
                log_info(f"Deleting {set_id}...")
                response = requests.delete(
                    f"{BACKEND_URL}/permission-sets-v3/{set_id}",
                    headers=self.headers,
                    timeout=30
                )
                
                if response.status_code in (200, 204):
                    log_success(f"✓ Deleted {set_id}")
                else:
                    log_warning(f"⚠ Failed to delete {set_id}: HTTP {response.status_code}")
            except Exception as e:
                log_warning(f"⚠ Exception deleting {set_id}: {e}")
        
        log_success("Cleanup complete")

    def print_summary(self):
        """Print test summary"""
        print("\n" + "="*80)
        print("TEST SUMMARY")
        print("="*80)
        
        all_passed = True
        for task_key, task_data in self.results.items():
            status = "✓ PASS" if task_data["passed"] else "✗ FAIL"
            color = Colors.GREEN if task_data["passed"] else Colors.RED
            print(f"\n{color}{status}{Colors.RESET} - {task_data['name']}")
            
            for detail in task_data["details"]:
                print(f"  {detail}")
            
            if not task_data["passed"]:
                all_passed = False
        
        print("\n" + "="*80)
        if all_passed:
            print(f"{Colors.GREEN}✓✓✓ ALL TESTS PASSED ✓✓✓{Colors.RESET}")
        else:
            print(f"{Colors.RED}✗✗✗ SOME TESTS FAILED ✗✗✗{Colors.RESET}")
        print("="*80 + "\n")
        
        return all_passed

    def run_all_tests(self):
        """Run all backend tests"""
        if not self.login():
            log_error("Login failed. Cannot proceed with tests.")
            return False
        
        try:
            # Run all three tasks
            self.test_task1_recent_updates_filter()
            self.test_task2_profix_dashboard_metric_required()
            self.test_task3_filter_team_catalog()
            
            # Cleanup
            self.cleanup_permission_sets()
            
            # Print summary
            return self.print_summary()
            
        except KeyboardInterrupt:
            log_warning("\n\nTests interrupted by user")
            self.cleanup_permission_sets()
            return False
        except Exception as e:
            log_error(f"\n\nUnexpected error: {e}")
            import traceback
            traceback.print_exc()
            self.cleanup_permission_sets()
            return False

def main():
    print(f"\n{'='*80}")
    print("BACKEND API TESTING - SESSION 2026-08-16 (rev-5)")
    print(f"{'='*80}")
    print(f"Backend URL: {BACKEND_URL}")
    print(f"Admin Email: {ADMIN_EMAIL}")
    print(f"{'='*80}\n")
    
    tester = BackendTester()
    success = tester.run_all_tests()
    
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
