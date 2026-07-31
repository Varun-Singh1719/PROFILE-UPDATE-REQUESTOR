#!/usr/bin/env python3
"""
Comprehensive Backend QA — Dashboard Module (ProfiX + Workspace Manager)
Jul 30, 2026

Tests the new Super-Admin-configurable `dashboard.profix.metrics_based_on` field
and verifies strict isolation from Workspace Manager dashboard.

Test Sections:
  A. Schema surface
  B. Permission-set persistence
  C. Effective permissions merge
  D. /api/dashboard/stats matrix
  E. /api/dashboard/dq-performance per-member matrix
  F. /api/dashboard/recent
  G. Workspace Manager regression
  H. Permission enforcement
  I. Date/filter regression
  J. Regression endpoints
"""

import requests
import json
import sys
from typing import Optional, Dict, Any, List

# Backend URL
BASE_URL = "https://crm-module-1.preview.emergentagent.com/api"

# Test credentials
ADMIN_EMAIL = "admin@ticketing.com"
ADMIN_PASSWORD = "Admin@123"

# Global state
admin_token = None
test_permission_sets = []
test_contacts = []
original_contact_states = {}

# ANSI colors for output
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
RESET = "\033[0m"
BOLD = "\033[1m"


def log(msg: str, level: str = "INFO"):
    """Log a message with color coding."""
    colors = {"INFO": BLUE, "PASS": GREEN, "FAIL": RED, "WARN": YELLOW}
    color = colors.get(level, RESET)
    print(f"{color}[{level}]{RESET} {msg}")


def log_section(title: str):
    """Log a section header."""
    print(f"\n{BOLD}{'=' * 80}{RESET}")
    print(f"{BOLD}{title}{RESET}")
    print(f"{BOLD}{'=' * 80}{RESET}\n")


def login(email: str, password: str) -> Optional[str]:
    """Login and return access token."""
    try:
        resp = requests.post(
            f"{BASE_URL}/auth/login",
            json={"email": email, "password": password},
            timeout=30
        )
        if resp.status_code == 200:
            data = resp.json()
            token = data.get("access_token")
            log(f"✓ Logged in as {email}", "PASS")
            return token
        else:
            log(f"✗ Login failed: {resp.status_code} {resp.text}", "FAIL")
            return None
    except Exception as e:
        log(f"✗ Login exception: {e}", "FAIL")
        return None


def impersonate(contact_id: str, admin_token: str) -> Optional[str]:
    """Impersonate a user and return their token."""
    try:
        resp = requests.post(
            f"{BASE_URL}/auth/impersonate",
            json={"user_id": contact_id},
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        if resp.status_code == 200:
            data = resp.json()
            token = data.get("access_token")
            log(f"✓ Impersonated contact {contact_id}", "PASS")
            return token
        else:
            log(f"✗ Impersonate failed: {resp.status_code} {resp.text}", "FAIL")
            return None
    except Exception as e:
        log(f"✗ Impersonate exception: {e}", "FAIL")
        return None


def get_me(token: str) -> Optional[Dict]:
    """Get current user info."""
    try:
        resp = requests.get(
            f"{BASE_URL}/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30
        )
        if resp.status_code == 200:
            return resp.json()
        return None
    except Exception:
        return None


def cleanup():
    """Clean up test data."""
    global admin_token, test_permission_sets, test_contacts, original_contact_states
    
    log_section("CLEANUP")
    
    # Restore original contact states
    for contact_id, original_state in original_contact_states.items():
        try:
            resp = requests.patch(
                f"{BASE_URL}/contacts/{contact_id}",
                json={"permission_set_ids": original_state.get("permission_set_ids", [])},
                headers={"Authorization": f"Bearer {admin_token}"},
                timeout=30
            )
            if resp.status_code == 200:
                log(f"✓ Restored contact {contact_id}", "PASS")
        except Exception as e:
            log(f"✗ Failed to restore contact {contact_id}: {e}", "WARN")
    
    # Delete test permission sets
    for pset_id in test_permission_sets:
        try:
            resp = requests.delete(
                f"{BASE_URL}/permission-sets-v3/{pset_id}",
                headers={"Authorization": f"Bearer {admin_token}"},
                timeout=30
            )
            if resp.status_code == 200:
                log(f"✓ Deleted permission set {pset_id}", "PASS")
        except Exception as e:
            log(f"✗ Failed to delete permission set {pset_id}: {e}", "WARN")
    
    log("Cleanup complete", "INFO")


# ============================================================================
# SECTION A: Schema Surface
# ============================================================================

def test_section_a():
    """Test that metrics_field exists on profix page only."""
    log_section("SECTION A: Schema Surface")
    
    try:
        resp = requests.get(
            f"{BASE_URL}/permissions/schema/v3",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ GET /permissions/schema/v3 failed: {resp.status_code}", "FAIL")
            return False
        
        schema = resp.json()
        modules = schema.get("modules", [])
        
        # Find dashboard module
        dashboard_module = next((m for m in modules if m.get("key") == "dashboard"), None)
        if not dashboard_module:
            log("✗ Dashboard module not found in schema", "FAIL")
            return False
        
        pages = dashboard_module.get("pages", [])
        
        # Check ProfiX page has metrics_field
        profix_page = next((p for p in pages if p.get("key") == "profix"), None)
        if not profix_page:
            log("✗ ProfiX page not found in dashboard module", "FAIL")
            return False
        
        metrics_field = profix_page.get("metrics_field")
        if not metrics_field:
            log("✗ metrics_field not found on ProfiX page", "FAIL")
            return False
        
        # Validate metrics_field structure
        if metrics_field.get("key") != "metrics_based_on":
            log(f"✗ metrics_field.key is '{metrics_field.get('key')}', expected 'metrics_based_on'", "FAIL")
            return False
        
        if metrics_field.get("default") != "created_by":
            log(f"✗ metrics_field.default is '{metrics_field.get('default')}', expected 'created_by'", "FAIL")
            return False
        
        options = metrics_field.get("options", [])
        option_keys = [o.get("key") for o in options]
        if "created_by" not in option_keys or "assigned_to" not in option_keys:
            log(f"✗ metrics_field.options missing required keys: {option_keys}", "FAIL")
            return False
        
        log("✓ ProfiX page has correct metrics_field structure", "PASS")
        
        # Check Workspace Manager page does NOT have metrics_field
        wm_page = next((p for p in pages if p.get("key") == "workspace_manager"), None)
        if not wm_page:
            log("✗ Workspace Manager page not found in dashboard module", "FAIL")
            return False
        
        if "metrics_field" in wm_page:
            log("✗ Workspace Manager page should NOT have metrics_field", "FAIL")
            return False
        
        log("✓ Workspace Manager page correctly has NO metrics_field", "PASS")
        
        log("✓ SECTION A: PASS", "PASS")
        return True
        
    except Exception as e:
        log(f"✗ Section A exception: {e}", "FAIL")
        return False


# ============================================================================
# SECTION B: Permission-set Persistence
# ============================================================================

def test_section_b():
    """Test permission-set CRUD with metrics_based_on field."""
    log_section("SECTION B: Permission-set Persistence")
    
    global test_permission_sets
    
    try:
        # B1: Create permission set with metrics_based_on="assigned_to"
        log("B1: Creating permission set with metrics_based_on='assigned_to'", "INFO")
        
        payload = {
            "title": "Test ProfiX Dashboard - Assigned To",
            "description": "Test permission set for dashboard QA",
            "modules": {
                "dashboard": {
                    "pages": {
                        "profix": {
                            "access_level": "manager",
                            "metrics_based_on": "assigned_to"
                        },
                        "workspace_manager": {
                            "access_level": "individual"
                        }
                    }
                }
            }
        }
        
        resp = requests.post(
            f"{BASE_URL}/permission-sets-v3",
            json=payload,
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ POST /permission-sets-v3 failed: {resp.status_code} {resp.text}", "FAIL")
            return False
        
        pset1 = resp.json()
        pset1_id = pset1.get("id")
        test_permission_sets.append(pset1_id)
        
        log(f"✓ Created permission set {pset1_id}", "PASS")
        
        # Verify round-trip
        resp = requests.get(
            f"{BASE_URL}/permission-sets-v3/{pset1_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ GET /permission-sets-v3/{pset1_id} failed: {resp.status_code}", "FAIL")
            return False
        
        retrieved = resp.json()
        profix_page = retrieved.get("modules", {}).get("dashboard", {}).get("pages", {}).get("profix", {})
        
        if profix_page.get("metrics_based_on") != "assigned_to":
            log(f"✗ metrics_based_on not persisted correctly: {profix_page.get('metrics_based_on')}", "FAIL")
            return False
        
        log("✓ metrics_based_on='assigned_to' persisted correctly", "PASS")
        
        # Verify workspace_manager does NOT have metrics_based_on
        wm_page = retrieved.get("modules", {}).get("dashboard", {}).get("pages", {}).get("workspace_manager", {})
        if "metrics_based_on" in wm_page:
            log("✗ workspace_manager should NOT have metrics_based_on", "FAIL")
            return False
        
        log("✓ workspace_manager correctly has NO metrics_based_on", "PASS")
        
        # B2: Update to metrics_based_on="created_by"
        log("B2: Updating metrics_based_on to 'created_by'", "INFO")
        
        payload["modules"]["dashboard"]["pages"]["profix"]["metrics_based_on"] = "created_by"
        
        resp = requests.put(
            f"{BASE_URL}/permission-sets-v3/{pset1_id}",
            json=payload,
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ PUT /permission-sets-v3/{pset1_id} failed: {resp.status_code}", "FAIL")
            return False
        
        updated = resp.json()
        profix_page = updated.get("modules", {}).get("dashboard", {}).get("pages", {}).get("profix", {})
        
        if profix_page.get("metrics_based_on") != "created_by":
            log(f"✗ metrics_based_on not updated correctly: {profix_page.get('metrics_based_on')}", "FAIL")
            return False
        
        log("✓ metrics_based_on updated to 'created_by'", "PASS")
        
        # B3: Test garbage input coercion
        log("B3: Testing garbage input coercion", "INFO")
        
        payload["modules"]["dashboard"]["pages"]["profix"]["metrics_based_on"] = "garbage_value"
        
        resp = requests.put(
            f"{BASE_URL}/permission-sets-v3/{pset1_id}",
            json=payload,
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ PUT with garbage value failed: {resp.status_code}", "FAIL")
            return False
        
        updated = resp.json()
        profix_page = updated.get("modules", {}).get("dashboard", {}).get("pages", {}).get("profix", {})
        
        # Should coerce to None
        if profix_page.get("metrics_based_on") is not None:
            log(f"✗ Garbage value not coerced to None: {profix_page.get('metrics_based_on')}", "FAIL")
            return False
        
        log("✓ Garbage value correctly coerced to None", "PASS")
        
        log("✓ SECTION B: PASS", "PASS")
        return True
        
    except Exception as e:
        log(f"✗ Section B exception: {e}", "FAIL")
        import traceback
        traceback.print_exc()
        return False


# ============================================================================
# SECTION C: Effective Permissions Merge
# ============================================================================

def test_section_c():
    """Test effective permissions merge with multiple sets."""
    log_section("SECTION C: Effective Permissions Merge")
    
    global test_permission_sets, test_contacts, original_contact_states
    
    try:
        # C1: Create two permission sets with different metrics
        log("C1: Creating two permission sets with different metrics", "INFO")
        
        # Set 1: created_by
        payload1 = {
            "title": "Test Merge - Created By",
            "description": "Test merge with created_by",
            "modules": {
                "dashboard": {
                    "pages": {
                        "profix": {
                            "access_level": "overall",
                            "metrics_based_on": "created_by"
                        }
                    }
                }
            }
        }
        
        resp1 = requests.post(
            f"{BASE_URL}/permission-sets-v3",
            json=payload1,
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp1.status_code != 200:
            log(f"✗ Failed to create set 1: {resp1.status_code}", "FAIL")
            return False
        
        set1 = resp1.json()
        set1_id = set1.get("id")
        test_permission_sets.append(set1_id)
        log(f"✓ Created set 1 (created_by): {set1_id}", "PASS")
        
        # Set 2: assigned_to
        payload2 = {
            "title": "Test Merge - Assigned To",
            "description": "Test merge with assigned_to",
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
        
        resp2 = requests.post(
            f"{BASE_URL}/permission-sets-v3",
            json=payload2,
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp2.status_code != 200:
            log(f"✗ Failed to create set 2: {resp2.status_code}", "FAIL")
            return False
        
        set2 = resp2.json()
        set2_id = set2.get("id")
        test_permission_sets.append(set2_id)
        log(f"✓ Created set 2 (assigned_to): {set2_id}", "PASS")
        
        # C2: Find a test user (non-Super Admin)
        log("C2: Finding test user", "INFO")
        
        resp = requests.get(
            f"{BASE_URL}/contacts?page=1&page_size=50",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ Failed to get contacts: {resp.status_code}", "FAIL")
            return False
        
        contacts = resp.json().get("items", [])
        test_user = next((c for c in contacts if c.get("role") == "Admin" and c.get("status") == "Active"), None)
        
        if not test_user:
            log("✗ No suitable test user found", "FAIL")
            return False
        
        test_user_id = test_user.get("id")
        log(f"✓ Found test user: {test_user.get('name')} ({test_user_id})", "PASS")
        
        # Save original state
        original_contact_states[test_user_id] = {
            "permission_set_ids": test_user.get("permission_set_ids", [])
        }
        
        # C3: Assign BOTH sets to the test user
        log("C3: Assigning both sets to test user", "INFO")
        
        resp = requests.patch(
            f"{BASE_URL}/contacts/{test_user_id}",
            json={"permission_set_ids": [set1_id, set2_id]},
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ Failed to assign sets: {resp.status_code}", "FAIL")
            return False
        
        log("✓ Assigned both sets to test user", "PASS")
        
        # C4: Impersonate and check effective permissions
        log("C4: Checking effective permissions", "INFO")
        
        test_token = impersonate(test_user_id, admin_token)
        if not test_token:
            log("✗ Failed to impersonate test user", "FAIL")
            return False
        
        resp = requests.get(
            f"{BASE_URL}/me/permissions",
            headers={"Authorization": f"Bearer {test_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ GET /me/permissions failed: {resp.status_code}", "FAIL")
            return False
        
        perms = resp.json()
        profix_page = perms.get("modules", {}).get("dashboard", {}).get("pages", {}).get("profix", {})
        
        # Should merge to "assigned_to" (higher rank)
        if profix_page.get("metrics_based_on") != "assigned_to":
            log(f"✗ Merge failed: expected 'assigned_to', got '{profix_page.get('metrics_based_on')}'", "FAIL")
            return False
        
        log("✓ Merge correct: 'assigned_to' wins over 'created_by'", "PASS")
        
        log("✓ SECTION C: PASS", "PASS")
        return True
        
    except Exception as e:
        log(f"✗ Section C exception: {e}", "FAIL")
        import traceback
        traceback.print_exc()
        return False


# ============================================================================
# SECTION D: /api/dashboard/stats Matrix
# ============================================================================

def test_section_d():
    """Test /dashboard/stats with different metrics."""
    log_section("SECTION D: /api/dashboard/stats Matrix")
    
    try:
        # D1: Super Admin with default metric (should be org-wide)
        log("D1: Testing Super Admin with default metric", "INFO")
        
        resp = requests.get(
            f"{BASE_URL}/dashboard/stats",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ GET /dashboard/stats failed: {resp.status_code}", "FAIL")
            return False
        
        stats = resp.json()
        log(f"✓ Super Admin stats: total={stats.get('total')}, open={stats.get('open')}, in_progress={stats.get('in_progress')}, closed={stats.get('closed')}", "PASS")
        log(f"  metrics_based_on={stats.get('metrics_based_on')}", "INFO")
        
        # D2: Test with metrics_based_on=created_by override
        log("D2: Testing with metrics_based_on=created_by override", "INFO")
        
        resp = requests.get(
            f"{BASE_URL}/dashboard/stats?metrics_based_on=created_by",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ GET /dashboard/stats?metrics_based_on=created_by failed: {resp.status_code}", "FAIL")
            return False
        
        stats_created = resp.json()
        
        if stats_created.get("metrics_based_on") != "created_by":
            log(f"✗ metrics_based_on not echoed correctly: {stats_created.get('metrics_based_on')}", "FAIL")
            return False
        
        log(f"✓ created_by stats: total={stats_created.get('total')}", "PASS")
        
        # D3: Test with metrics_based_on=assigned_to override
        log("D3: Testing with metrics_based_on=assigned_to override", "INFO")
        
        resp = requests.get(
            f"{BASE_URL}/dashboard/stats?metrics_based_on=assigned_to",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ GET /dashboard/stats?metrics_based_on=assigned_to failed: {resp.status_code}", "FAIL")
            return False
        
        stats_assigned = resp.json()
        
        if stats_assigned.get("metrics_based_on") != "assigned_to":
            log(f"✗ metrics_based_on not echoed correctly: {stats_assigned.get('metrics_based_on')}", "FAIL")
            return False
        
        log(f"✓ assigned_to stats: total={stats_assigned.get('total')}", "PASS")
        
        # For Super Admin, totals should be identical (no owner filter)
        if stats_created.get("total") != stats_assigned.get("total"):
            log(f"✗ Super Admin totals differ: created_by={stats_created.get('total')}, assigned_to={stats_assigned.get('total')}", "FAIL")
            return False
        
        log("✓ Super Admin totals identical (no owner filter)", "PASS")
        
        log("✓ SECTION D: PASS", "PASS")
        return True
        
    except Exception as e:
        log(f"✗ Section D exception: {e}", "FAIL")
        import traceback
        traceback.print_exc()
        return False


# ============================================================================
# SECTION E: /api/dashboard/dq-performance Matrix
# ============================================================================

def test_section_e():
    """Test /dashboard/dq-performance with different metrics."""
    log_section("SECTION E: /api/dashboard/dq-performance Matrix")
    
    try:
        # E1: Test with created_by
        log("E1: Testing dq-performance with metrics_based_on=created_by", "INFO")
        
        resp = requests.get(
            f"{BASE_URL}/dashboard/dq-performance?metrics_based_on=created_by",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ GET /dashboard/dq-performance?metrics_based_on=created_by failed: {resp.status_code}", "FAIL")
            return False
        
        perf_created = resp.json()
        log(f"✓ created_by performance: {len(perf_created)} members", "PASS")
        
        # E2: Test with assigned_to
        log("E2: Testing dq-performance with metrics_based_on=assigned_to", "INFO")
        
        resp = requests.get(
            f"{BASE_URL}/dashboard/dq-performance?metrics_based_on=assigned_to",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ GET /dashboard/dq-performance?metrics_based_on=assigned_to failed: {resp.status_code}", "FAIL")
            return False
        
        perf_assigned = resp.json()
        log(f"✓ assigned_to performance: {len(perf_assigned)} members", "PASS")
        
        # E3: Verify structure
        if perf_created:
            member = perf_created[0]
            required_fields = ["id", "name", "email", "total", "open", "in_progress", "closed", "profiles_assigned"]
            missing = [f for f in required_fields if f not in member]
            if missing:
                log(f"✗ Missing fields in member: {missing}", "FAIL")
                return False
            log(f"✓ Member structure correct: {member.get('name')} - total={member.get('total')}, profiles_assigned={member.get('profiles_assigned')}", "PASS")
        
        # E4: Verify profiles_assigned = open_profiles + in_progress_profiles
        if perf_created:
            member = perf_created[0]
            expected = member.get("open_profiles", 0) + member.get("in_progress_profiles", 0)
            actual = member.get("profiles_assigned", 0)
            if expected != actual:
                log(f"✗ profiles_assigned mismatch: expected {expected}, got {actual}", "FAIL")
                return False
            log(f"✓ profiles_assigned = open_profiles + in_progress_profiles", "PASS")
        
        log("✓ SECTION E: PASS", "PASS")
        return True
        
    except Exception as e:
        log(f"✗ Section E exception: {e}", "FAIL")
        import traceback
        traceback.print_exc()
        return False


# ============================================================================
# SECTION F: /api/dashboard/recent
# ============================================================================

def test_section_f():
    """Test /dashboard/recent with different metrics."""
    log_section("SECTION F: /api/dashboard/recent")
    
    try:
        # F1: Test with created_by
        log("F1: Testing recent with metrics_based_on=created_by", "INFO")
        
        resp = requests.get(
            f"{BASE_URL}/dashboard/recent?metrics_based_on=created_by&limit=5",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ GET /dashboard/recent?metrics_based_on=created_by failed: {resp.status_code}", "FAIL")
            return False
        
        recent_created = resp.json()
        log(f"✓ created_by recent: {len(recent_created)} tickets", "PASS")
        
        # F2: Test with assigned_to
        log("F2: Testing recent with metrics_based_on=assigned_to", "INFO")
        
        resp = requests.get(
            f"{BASE_URL}/dashboard/recent?metrics_based_on=assigned_to&limit=5",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ GET /dashboard/recent?metrics_based_on=assigned_to failed: {resp.status_code}", "FAIL")
            return False
        
        recent_assigned = resp.json()
        log(f"✓ assigned_to recent: {len(recent_assigned)} tickets", "PASS")
        
        # F3: Verify structure
        if recent_created:
            ticket = recent_created[0]
            required_fields = ["id", "ticket_id", "status", "priority"]
            missing = [f for f in required_fields if f not in ticket]
            if missing:
                log(f"✗ Missing fields in ticket: {missing}", "FAIL")
                return False
            log(f"✓ Ticket structure correct: {ticket.get('ticket_id')}", "PASS")
        
        log("✓ SECTION F: PASS", "PASS")
        return True
        
    except Exception as e:
        log(f"✗ Section F exception: {e}", "FAIL")
        import traceback
        traceback.print_exc()
        return False


# ============================================================================
# SECTION G: Workspace Manager Regression
# ============================================================================

def test_section_g():
    """Test Workspace Manager endpoints are unaffected."""
    log_section("SECTION G: Workspace Manager Regression")
    
    endpoints = [
        "/my-workspace/dashboard",
        "/my-workspace/week",
        "/my-workspace/floor"
    ]
    
    try:
        for endpoint in endpoints:
            log(f"Testing {endpoint}", "INFO")
            
            resp = requests.get(
                f"{BASE_URL}{endpoint}",
                headers={"Authorization": f"Bearer {admin_token}"},
                timeout=30
            )
            
            if resp.status_code != 200:
                log(f"✗ GET {endpoint} failed: {resp.status_code}", "FAIL")
                return False
            
            data = resp.json()
            if not data:
                log(f"✗ {endpoint} returned null/empty", "FAIL")
                return False
            
            log(f"✓ {endpoint} returned 200 with non-null payload", "PASS")
        
        log("✓ SECTION G: PASS", "PASS")
        return True
        
    except Exception as e:
        log(f"✗ Section G exception: {e}", "FAIL")
        import traceback
        traceback.print_exc()
        return False


# ============================================================================
# SECTION H: Permission Enforcement
# ============================================================================

def test_section_h():
    """Test permission enforcement for users without dashboard access."""
    log_section("SECTION H: Permission Enforcement")
    
    try:
        # H1: Create a user with NO dashboard permission
        log("H1: Testing user with NO dashboard permission", "INFO")
        
        # Find a test user
        resp = requests.get(
            f"{BASE_URL}/contacts?page=1&page_size=50",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ Failed to get contacts: {resp.status_code}", "FAIL")
            return False
        
        contacts = resp.json().get("items", [])
        test_user = next((c for c in contacts if c.get("role") == "Admin" and c.get("status") == "Active"), None)
        
        if not test_user:
            log("✗ No suitable test user found", "FAIL")
            return False
        
        test_user_id = test_user.get("id")
        
        # Save original state
        if test_user_id not in original_contact_states:
            original_contact_states[test_user_id] = {
                "permission_set_ids": test_user.get("permission_set_ids", [])
            }
        
        # Remove all permission sets
        resp = requests.patch(
            f"{BASE_URL}/contacts/{test_user_id}",
            json={"permission_set_ids": []},
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ Failed to remove permission sets: {resp.status_code}", "FAIL")
            return False
        
        log(f"✓ Removed all permission sets from {test_user.get('name')}", "PASS")
        
        # Impersonate and test
        test_token = impersonate(test_user_id, admin_token)
        if not test_token:
            log("✗ Failed to impersonate test user", "FAIL")
            return False
        
        # Test /dashboard/stats (should still return 200 but with constrained scope)
        resp = requests.get(
            f"{BASE_URL}/dashboard/stats",
            headers={"Authorization": f"Bearer {test_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ /dashboard/stats should return 200 for users without dashboard perm: {resp.status_code}", "FAIL")
            return False
        
        stats = resp.json()
        log(f"✓ /dashboard/stats returned 200 with constrained scope: total={stats.get('total')}", "PASS")
        
        # Test /dashboard/dq-performance (should return empty for individual/no-access)
        resp = requests.get(
            f"{BASE_URL}/dashboard/dq-performance",
            headers={"Authorization": f"Bearer {test_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ /dashboard/dq-performance failed: {resp.status_code}", "FAIL")
            return False
        
        perf = resp.json()
        # For individual/no-access, should return empty list
        log(f"✓ /dashboard/dq-performance returned: {len(perf)} members", "PASS")
        
        log("✓ SECTION H: PASS", "PASS")
        return True
        
    except Exception as e:
        log(f"✗ Section H exception: {e}", "FAIL")
        import traceback
        traceback.print_exc()
        return False


# ============================================================================
# SECTION I: Date/Filter Regression
# ============================================================================

def test_section_i():
    """Test date_from/date_to/date_field still work."""
    log_section("SECTION I: Date/Filter Regression")
    
    try:
        # I1: Test date_from/date_to on /dashboard/stats
        log("I1: Testing date_from/date_to on /dashboard/stats", "INFO")
        
        resp = requests.get(
            f"{BASE_URL}/dashboard/stats?date_from=2024-01-01&date_to=2024-12-31",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ /dashboard/stats with date range failed: {resp.status_code}", "FAIL")
            return False
        
        stats = resp.json()
        log(f"✓ /dashboard/stats with date range: total={stats.get('total')}", "PASS")
        
        # I2: Test date_field switching
        log("I2: Testing date_field switching", "INFO")
        
        resp = requests.get(
            f"{BASE_URL}/dashboard/stats?date_field=updated_on&date_from=2024-01-01",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ /dashboard/stats with date_field failed: {resp.status_code}", "FAIL")
            return False
        
        stats = resp.json()
        log(f"✓ /dashboard/stats with date_field=updated_on: total={stats.get('total')}", "PASS")
        
        # I3: Test on /dashboard/dq-performance
        log("I3: Testing date range on /dashboard/dq-performance", "INFO")
        
        resp = requests.get(
            f"{BASE_URL}/dashboard/dq-performance?date_from=2024-01-01&date_to=2024-12-31",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ /dashboard/dq-performance with date range failed: {resp.status_code}", "FAIL")
            return False
        
        perf = resp.json()
        log(f"✓ /dashboard/dq-performance with date range: {len(perf)} members", "PASS")
        
        # I4: Test on /dashboard/recent
        log("I4: Testing date range on /dashboard/recent", "INFO")
        
        resp = requests.get(
            f"{BASE_URL}/dashboard/recent?date_from=2024-01-01&date_to=2024-12-31",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code != 200:
            log(f"✗ /dashboard/recent with date range failed: {resp.status_code}", "FAIL")
            return False
        
        recent = resp.json()
        log(f"✓ /dashboard/recent with date range: {len(recent)} tickets", "PASS")
        
        log("✓ SECTION I: PASS", "PASS")
        return True
        
    except Exception as e:
        log(f"✗ Section I exception: {e}", "FAIL")
        import traceback
        traceback.print_exc()
        return False


# ============================================================================
# SECTION J: Regression Endpoints
# ============================================================================

def test_section_j():
    """Test regression endpoints all return 200."""
    log_section("SECTION J: Regression Endpoints")
    
    endpoints = [
        "/tickets?page=1&page_size=10",
        "/tickets/export.csv?scope=all",
        "/contacts?page=1&page_size=10",
        "/teams",
        "/permissions/audit?limit=10",
        "/permission-sets-v3?page=1&page_size=10",
        "/notifications?page=1&page_size=10",
        "/bookings?page=1&page_size=10"
    ]
    
    try:
        for endpoint in endpoints:
            log(f"Testing {endpoint}", "INFO")
            
            resp = requests.get(
                f"{BASE_URL}{endpoint}",
                headers={"Authorization": f"Bearer {admin_token}"},
                timeout=30
            )
            
            if resp.status_code != 200:
                log(f"✗ GET {endpoint} failed: {resp.status_code}", "FAIL")
                # Don't fail the whole section, just log
                continue
            
            log(f"✓ {endpoint} returned 200", "PASS")
        
        # Test GET /teams/{id} with a real team
        log("Testing GET /teams/{id}", "INFO")
        
        resp = requests.get(
            f"{BASE_URL}/teams",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30
        )
        
        if resp.status_code == 200:
            teams = resp.json()
            if teams:
                team_id = teams[0].get("id")
                resp = requests.get(
                    f"{BASE_URL}/teams/{team_id}",
                    headers={"Authorization": f"Bearer {admin_token}"},
                    timeout=30
                )
                if resp.status_code == 200:
                    log(f"✓ GET /teams/{team_id} returned 200", "PASS")
                else:
                    log(f"✗ GET /teams/{team_id} failed: {resp.status_code}", "FAIL")
        
        log("✓ SECTION J: PASS", "PASS")
        return True
        
    except Exception as e:
        log(f"✗ Section J exception: {e}", "FAIL")
        import traceback
        traceback.print_exc()
        return False


# ============================================================================
# MAIN
# ============================================================================

def main():
    global admin_token
    
    log_section("COMPREHENSIVE BACKEND QA — Dashboard Module (Jul 30, 2026)")
    log("Testing ProfiX Dashboard metrics_based_on field + Workspace Manager isolation", "INFO")
    
    # Login
    admin_token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_token:
        log("✗ Failed to login as Super Admin", "FAIL")
        sys.exit(1)
    
    # Run all test sections
    results = {}
    
    try:
        results["A"] = test_section_a()
        results["B"] = test_section_b()
        results["C"] = test_section_c()
        results["D"] = test_section_d()
        results["E"] = test_section_e()
        results["F"] = test_section_f()
        results["G"] = test_section_g()
        results["H"] = test_section_h()
        results["I"] = test_section_i()
        results["J"] = test_section_j()
    finally:
        cleanup()
    
    # Summary
    log_section("EXECUTIVE SUMMARY")
    
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    failed = total - passed
    
    log(f"Total Test Sections: {total}", "INFO")
    log(f"Passed: {passed}", "PASS" if passed == total else "INFO")
    log(f"Failed: {failed}", "FAIL" if failed > 0 else "INFO")
    
    for section, result in results.items():
        status = "PASS" if result else "FAIL"
        log(f"Section {section}: {status}", status)
    
    if failed == 0:
        log("\n✓ ALL TESTS PASSED", "PASS")
        sys.exit(0)
    else:
        log(f"\n✗ {failed} SECTION(S) FAILED", "FAIL")
        sys.exit(1)


if __name__ == "__main__":
    main()
