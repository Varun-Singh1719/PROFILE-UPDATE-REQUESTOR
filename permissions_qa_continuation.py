#!/usr/bin/env python3
"""
Permissions QA Continuation - Scenarios D, E, H, J, K, L, M, N, O + URL Bypass Recheck
Testing comprehensive permission enforcement across various configurations
"""

import requests
import json
import sys
import time
from datetime import datetime
from typing import Dict, List, Optional

# Configuration
BASE_URL = "http://localhost:8001/api"
ADMIN_EMAIL = "admin@ticketing.com"
ADMIN_PASSWORD = "Admin@123"

# Test state
session = requests.Session()
test_results = []
created_psets = []
created_users = []


class TestResult:
    def __init__(self, scenario: str, endpoint: str, expected: str, actual: str, status: str, details: str = ""):
        self.scenario = scenario
        self.endpoint = endpoint
        self.expected = expected
        self.actual = actual
        self.status = status
        self.details = details


def log_test(result: TestResult):
    """Log test result"""
    test_results.append(result)
    status_icon = "✅" if result.status == "PASS" else "❌"
    print(f"{status_icon} {result.scenario} | {result.endpoint}")
    print(f"   Expected: {result.expected}")
    print(f"   Actual: {result.actual}")
    if result.details:
        print(f"   Details: {result.details}")


def login() -> bool:
    """Login as Super Admin"""
    print("\n=== LOGIN AS SUPER ADMIN ===")
    resp = session.post(f"{BASE_URL}/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    
    if resp.status_code == 200:
        data = resp.json()
        token = data.get("access_token")
        if token:
            session.headers.update({"Authorization": f"Bearer {token}"})
            print(f"✅ Logged in as {ADMIN_EMAIL}")
            return True
        else:
            print(f"❌ No access_token in response")
            return False
    else:
        print(f"❌ Login failed: {resp.status_code} - {resp.text}")
        return False


def create_permission_set(title: str, modules: dict) -> Optional[str]:
    """Create a permission set and return its ID"""
    print(f"\n--- Creating permission set: {title} ---")
    
    payload = {
        "title": title,
        "description": f"QA test set for {title}",
        "modules": modules
    }
    
    resp = session.post(f"{BASE_URL}/permission-sets-v3", json=payload)
    
    if resp.status_code == 200:
        data = resp.json()
        pset_id = data.get("id")
        print(f"✅ Created permission set: {pset_id}")
        created_psets.append(pset_id)
        return pset_id
    else:
        print(f"❌ Failed to create permission set: {resp.status_code} - {resp.text}")
        return None


def create_dummy_admin(email: str, emp_id: str, permission_set_ids: List[str]) -> Optional[str]:
    """Create a dummy admin user and return user ID"""
    print(f"\n--- Creating dummy admin: {email} ---")
    
    payload = {
        "name": f"QA {email.split('.')[1].title()} Admin",
        "email": email,
        "emp_id": emp_id,
        "role": "Admin",
        "status": "Active",
        "doj": "2026-01-01",  # Required field
        "permission_set_ids": permission_set_ids
    }
    
    resp = session.post(f"{BASE_URL}/contacts", json=payload)
    
    if resp.status_code == 200:
        data = resp.json()
        user_id = data.get("id")
        print(f"✅ Created user: {user_id}")
        created_users.append(user_id)
        return user_id
    else:
        print(f"❌ Failed to create user: {resp.status_code} - {resp.text}")
        return None


def impersonate(user_id: str) -> Optional[str]:
    """Impersonate a user and return JWT token"""
    resp = session.post(f"{BASE_URL}/auth/impersonate", json={"user_id": user_id})
    
    if resp.status_code == 200:
        data = resp.json()
        token = data.get("access_token")
        print(f"✅ Impersonated user {user_id}")
        return token
    else:
        print(f"❌ Failed to impersonate: {resp.status_code} - {resp.text}")
        return None


def get_teams() -> List[dict]:
    """Get all teams"""
    resp = session.get(f"{BASE_URL}/teams")
    if resp.status_code == 200:
        return resp.json()
    return []


def add_user_to_team(team_id: str, user_id: str, as_member: bool = True):
    """Add user to a team"""
    # Get current team
    resp = session.get(f"{BASE_URL}/teams/{team_id}")
    if resp.status_code != 200:
        print(f"❌ Failed to get team: {resp.status_code}")
        return False
    
    team = resp.json()
    member_ids = team.get("member_ids", [])
    manager_ids = team.get("manager_ids", [])
    
    if as_member:
        if user_id not in member_ids:
            member_ids.append(user_id)
    else:
        if user_id not in manager_ids:
            manager_ids.append(user_id)
    
    # Update team
    resp = session.patch(f"{BASE_URL}/teams/{team_id}", json={
        "member_ids": member_ids,
        "manager_ids": manager_ids
    })
    
    if resp.status_code == 200:
        print(f"✅ Added user to team {team_id}")
        return True
    else:
        print(f"❌ Failed to add user to team: {resp.status_code} - {resp.text}")
        return False


def test_with_token(token: str, endpoint: str, expected_status: int, scenario: str, expected_desc: str) -> TestResult:
    """Test an endpoint with a given token"""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}{endpoint}", headers=headers)
    
    actual_status = resp.status_code
    status = "PASS" if actual_status == expected_status else "FAIL"
    
    details = ""
    if resp.status_code == 200:
        try:
            data = resp.json()
            if isinstance(data, list):
                details = f"Returned {len(data)} rows"
            elif isinstance(data, dict):
                if "rows" in data:
                    details = f"Returned {len(data['rows'])} rows"
                elif "total" in data:
                    details = f"Total: {data.get('total')}"
        except Exception:
            pass
    
    return TestResult(
        scenario=scenario,
        endpoint=endpoint,
        expected=f"{expected_status} - {expected_desc}",
        actual=f"{actual_status} - {details}",
        status=status,
        details=resp.text[:200] if status == "FAIL" else ""
    )


# ============================================================
# SCENARIO D — QA-ProfixTeamCreator
# ============================================================
def scenario_d():
    print("\n" + "="*80)
    print("SCENARIO D — QA-ProfixTeamCreator")
    print("="*80)
    
    # Create permission set
    modules = {
        "profix": {
            "pages": {
                "create_request": {
                    "view": {"enabled": True, "visible": True},
                    "edit": {"enabled": True},
                    "functions": {
                        "create": {"enabled": True},
                        "edit": {"enabled": True}
                    },
                    "scope": "individual"
                },
                "all_requests": {
                    "view": {"enabled": True, "visible": True},
                    "scope": "team"
                },
                "open_requests": {
                    "view": {"enabled": True, "visible": True},
                    "scope": "team"
                }
            }
        },
        "dashboard": {
            "pages": {
                "profix": {
                    "access_level": "team"
                }
            }
        }
    }
    
    pset_id = create_permission_set("QA-ProfixTeamCreator", modules)
    if not pset_id:
        return
    
    # Create user
    epoch = int(time.time())
    email = f"qa.profixteamcreator.{epoch}@ticketing.com"
    emp_id = f"QA-PTC-{epoch}"
    user_id = create_dummy_admin(email, emp_id, [pset_id])
    if not user_id:
        return
    
    # Add user to a team
    teams = get_teams()
    if teams:
        team_id = teams[0].get("id")
        add_user_to_team(team_id, user_id, as_member=True)
    
    # Impersonate
    token = impersonate(user_id)
    if not token:
        return
    
    # Test endpoints
    log_test(test_with_token(token, "/tickets?scope=all", 200, "Scenario D", "Team-scoped tickets"))
    log_test(test_with_token(token, "/contacts", 403, "Scenario D", "No manage.employees"))
    log_test(test_with_token(token, "/permission-sets-v3", 403, "Scenario D", "No manage.permissions"))
    log_test(test_with_token(token, "/floor-plans", 403, "Scenario D", "No desk_booking"))


# ============================================================
# SCENARIO E — QA-WorkspaceOverallApprover
# ============================================================
def scenario_e():
    print("\n" + "="*80)
    print("SCENARIO E — QA-WorkspaceOverallApprover")
    print("="*80)
    
    # Create permission set
    modules = {
        "desk_booking": {
            "pages": {
                "pending_approvals": {
                    "view": {"enabled": True, "visible": True},
                    "edit": {"enabled": True},
                    "functions": {
                        "approve": {"enabled": True},
                        "reject": {"enabled": True},
                        "bulk_approve": {"enabled": True},
                        "bulk_reject": {"enabled": True}
                    },
                    "scope": "overall"
                },
                "floor_layout": {
                    "view": {"enabled": True, "visible": True},
                    "scope": "overall"
                }
            }
        },
        "dashboard": {
            "pages": {
                "workspace_manager": {
                    "access_level": "overall"
                }
            }
        }
    }
    
    pset_id = create_permission_set("QA-WorkspaceOverallApprover", modules)
    if not pset_id:
        return
    
    # Create user
    epoch = int(time.time())
    email = f"qa.workspaceapprover.{epoch}@ticketing.com"
    emp_id = f"QA-WOA-{epoch}"
    user_id = create_dummy_admin(email, emp_id, [pset_id])
    if not user_id:
        return
    
    # Impersonate
    token = impersonate(user_id)
    if not token:
        return
    
    # Test endpoints
    log_test(test_with_token(token, "/floor-plans", 200, "Scenario E", "Has floor_layout.view"))
    log_test(test_with_token(token, "/workstation-requests?status=pending", 200, "Scenario E", "Pending workstation requests"))
    log_test(test_with_token(token, "/meeting-room-requests?status=pending", 200, "Scenario E", "Pending meeting room requests"))
    log_test(test_with_token(token, "/tickets?scope=all", 403, "Scenario E", "No profix.all_requests"))
    log_test(test_with_token(token, "/contacts", 403, "Scenario E", "No manage.employees"))
    log_test(test_with_token(token, "/permission-sets-v3", 403, "Scenario E", "No manage.permissions"))
    log_test(test_with_token(token, "/email-templates", 403, "Scenario E", "No manage.email_templates"))


# ============================================================
# SCENARIO H — QA-EditWithoutView
# ============================================================
def scenario_h():
    print("\n" + "="*80)
    print("SCENARIO H — QA-EditWithoutView")
    print("="*80)
    
    # Create permission set
    modules = {
        "profix": {
            "pages": {
                "ticket_detail": {
                    "view": {"enabled": False, "visible": False},
                    "edit": {"enabled": True},
                    "functions": {
                        "edit": {"enabled": True}
                    }
                },
                "all_requests": {
                    "view": {"enabled": True, "visible": True},
                    "scope": "individual"
                }
            }
        }
    }
    
    pset_id = create_permission_set("QA-EditWithoutView", modules)
    if not pset_id:
        return
    
    # Create user
    epoch = int(time.time())
    email = f"qa.editwithoutview.{epoch}@ticketing.com"
    emp_id = f"QA-EWV-{epoch}"
    user_id = create_dummy_admin(email, emp_id, [pset_id])
    if not user_id:
        return
    
    # Impersonate
    token = impersonate(user_id)
    if not token:
        return
    
    # Test endpoints
    result_list = test_with_token(token, "/tickets?scope=all", 200, "Scenario H", "all_requests granted")
    log_test(result_list)
    
    # Try to get a specific ticket (if any exist)
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/tickets?scope=all", headers=headers)
    if resp.status_code == 200:
        tickets = resp.json()
        if tickets:
            ticket_id = tickets[0].get("id")
            result_detail = test_with_token(token, f"/tickets/{ticket_id}", 403, "Scenario H", "ticket_detail.view disabled")
            log_test(result_detail)


# ============================================================
# SCENARIO J — QA-MultiTeamUser
# ============================================================
def scenario_j():
    print("\n" + "="*80)
    print("SCENARIO J — QA-MultiTeamUser")
    print("="*80)
    
    # Create permission set
    modules = {
        "profix": {
            "pages": {
                "all_requests": {
                    "view": {"enabled": True, "visible": True},
                    "scope": "team"
                }
            }
        }
    }
    
    pset_id = create_permission_set("QA-MultiTeamUser", modules)
    if not pset_id:
        return
    
    # Create user
    epoch = int(time.time())
    email = f"qa.multiteam.{epoch}@ticketing.com"
    emp_id = f"QA-MTU-{epoch}"
    user_id = create_dummy_admin(email, emp_id, [pset_id])
    if not user_id:
        return
    
    # Add user to TWO teams
    teams = get_teams()
    if len(teams) >= 2:
        add_user_to_team(teams[0].get("id"), user_id, as_member=True)
        add_user_to_team(teams[1].get("id"), user_id, as_member=True)
    
    # Impersonate
    token = impersonate(user_id)
    if not token:
        return
    
    # Test endpoints
    log_test(test_with_token(token, "/tickets?scope=all", 200, "Scenario J", "Union of both teams' tickets"))


# ============================================================
# SCENARIO K — QA-NoTeamUser
# ============================================================
def scenario_k():
    print("\n" + "="*80)
    print("SCENARIO K — QA-NoTeamUser")
    print("="*80)
    
    # Create permission set
    modules = {
        "profix": {
            "pages": {
                "all_requests": {
                    "view": {"enabled": True, "visible": True},
                    "scope": "team"
                }
            }
        }
    }
    
    pset_id = create_permission_set("QA-NoTeamUser", modules)
    if not pset_id:
        return
    
    # Create user (NOT added to any team)
    epoch = int(time.time())
    email = f"qa.noteam.{epoch}@ticketing.com"
    emp_id = f"QA-NTU-{epoch}"
    user_id = create_dummy_admin(email, emp_id, [pset_id])
    if not user_id:
        return
    
    # Impersonate
    token = impersonate(user_id)
    if not token:
        return
    
    # Test endpoints
    log_test(test_with_token(token, "/tickets?scope=all", 200, "Scenario K", "0 or only own tickets"))


# ============================================================
# SCENARIO L — QA-DeletedSet
# ============================================================
def scenario_l():
    print("\n" + "="*80)
    print("SCENARIO L — QA-DeletedSet")
    print("="*80)
    
    # Create permission set
    modules = {
        "manage": {
            "pages": {
                "employees": {
                    "view": {"enabled": True, "visible": True}
                }
            }
        }
    }
    
    pset_id = create_permission_set("QA-DeletedSet", modules)
    if not pset_id:
        return
    
    # Create user
    epoch = int(time.time())
    email = f"qa.deletedset.{epoch}@ticketing.com"
    emp_id = f"QA-DS-{epoch}"
    user_id = create_dummy_admin(email, emp_id, [pset_id])
    if not user_id:
        return
    
    # Impersonate and test BEFORE deletion
    token_before = impersonate(user_id)
    if not token_before:
        return
    
    result_before = test_with_token(token_before, "/contacts", 200, "Scenario L (before delete)", "Has manage.employees")
    log_test(result_before)
    
    # Delete the permission set
    print(f"\n--- Deleting permission set {pset_id} ---")
    resp = session.delete(f"{BASE_URL}/permission-sets-v3/{pset_id}")
    if resp.status_code == 200:
        print(f"✅ Deleted permission set")
        created_psets.remove(pset_id)  # Don't try to delete again in cleanup
    else:
        print(f"❌ Failed to delete: {resp.status_code}")
        return
    
    time.sleep(1)
    
    # Mint FRESH token after deletion
    token_after = impersonate(user_id)
    if not token_after:
        return
    
    result_after = test_with_token(token_after, "/contacts", 403, "Scenario L (after delete, fresh token)", "Set deleted, should be 403")
    log_test(result_after)
    
    # Test with STALE token
    result_stale = test_with_token(token_before, "/contacts", 403, "Scenario L (after delete, stale token)", "Stale token should also be 403")
    log_test(result_stale)


# ============================================================
# SCENARIO M — QA-UpdatedSet-LiveChange
# ============================================================
def scenario_m():
    print("\n" + "="*80)
    print("SCENARIO M — QA-UpdatedSet-LiveChange")
    print("="*80)
    
    # Create permission set with manage.employees
    modules = {
        "manage": {
            "pages": {
                "employees": {
                    "view": {"enabled": True, "visible": True}
                }
            }
        }
    }
    
    pset_id = create_permission_set("QA-UpdatedSet", modules)
    if not pset_id:
        return
    
    # Create user
    epoch = int(time.time())
    email = f"qa.updatedset.{epoch}@ticketing.com"
    emp_id = f"QA-US-{epoch}"
    user_id = create_dummy_admin(email, emp_id, [pset_id])
    if not user_id:
        return
    
    # Impersonate
    token = impersonate(user_id)
    if not token:
        return
    
    # Test BEFORE update
    result_before = test_with_token(token, "/contacts", 200, "Scenario M (before update)", "Has manage.employees")
    log_test(result_before)
    
    # Update permission set to REMOVE manage.employees
    print(f"\n--- Updating permission set to remove manage.employees ---")
    updated_modules = {}  # Empty modules
    resp = session.put(f"{BASE_URL}/permission-sets-v3/{pset_id}", json={
        "title": "QA-UpdatedSet",
        "modules": updated_modules
    })
    
    if resp.status_code == 200:
        print(f"✅ Updated permission set")
    else:
        print(f"❌ Failed to update: {resp.status_code}")
        return
    
    time.sleep(1)
    
    # Test with SAME token after update
    result_after = test_with_token(token, "/contacts", 403, "Scenario M (after update, same token)", "Should re-evaluate and return 403")
    log_test(result_after)


# ============================================================
# SCENARIO N — QA-DashboardScopes
# ============================================================
def scenario_n():
    print("\n" + "="*80)
    print("SCENARIO N — QA-DashboardScopes")
    print("="*80)
    
    # Create three permission sets
    scenarios = [
        ("QA-Dashboard-Individual", "individual"),
        ("QA-Dashboard-Team", "team"),
        ("QA-Dashboard-Overall", "overall")
    ]
    
    for title, access_level in scenarios:
        modules = {
            "dashboard": {
                "pages": {
                    "workspace_manager": {
                        "access_level": access_level
                    }
                }
            }
        }
        
        pset_id = create_permission_set(title, modules)
        if not pset_id:
            continue
        
        # Create user
        epoch = int(time.time())
        email = f"qa.dashboard.{access_level}.{epoch}@ticketing.com"
        emp_id = f"QA-D-{access_level.upper()[:3]}-{epoch}"
        user_id = create_dummy_admin(email, emp_id, [pset_id])
        if not user_id:
            continue
        
        # Impersonate
        token = impersonate(user_id)
        if not token:
            continue
        
        # Test /api/me/permissions
        headers = {"Authorization": f"Bearer {token}"}
        resp = requests.get(f"{BASE_URL}/me/permissions", headers=headers)
        
        if resp.status_code == 200:
            data = resp.json()
            actual_level = data.get("modules", {}).get("dashboard", {}).get("pages", {}).get("workspace_manager", {}).get("access_level")
            
            status = "PASS" if actual_level == access_level else "FAIL"
            result = TestResult(
                scenario=f"Scenario N ({access_level})",
                endpoint="/me/permissions",
                expected=f"access_level={access_level}",
                actual=f"access_level={actual_level}",
                status=status
            )
            log_test(result)
        
        time.sleep(0.5)


# ============================================================
# SCENARIO O — QA-Notifications+Reports
# ============================================================
def scenario_o():
    print("\n" + "="*80)
    print("SCENARIO O — QA-Notifications+Reports")
    print("="*80)
    
    # Create permission set
    modules = {
        "manage": {
            "pages": {
                "notifications": {
                    "view": {"enabled": True, "visible": True}
                },
                "reports": {
                    "view": {"enabled": True, "visible": True}
                }
            }
        }
    }
    
    pset_id = create_permission_set("QA-Notifications+Reports", modules)
    if not pset_id:
        return
    
    # Create user
    epoch = int(time.time())
    email = f"qa.notifications.{epoch}@ticketing.com"
    emp_id = f"QA-NR-{epoch}"
    user_id = create_dummy_admin(email, emp_id, [pset_id])
    if not user_id:
        return
    
    # Impersonate
    token = impersonate(user_id)
    if not token:
        return
    
    # Test endpoints
    result = test_with_token(token, "/notifications/outbox", 403, "Scenario O", "Still gated by role='Super Admin' - MISMATCH")
    log_test(result)
    
    # Note this as a defect
    print("\n⚠️  DEFECT: manage.notifications.view v3 permission not enforced")
    print("   Backend still gates /api/notifications/outbox on role='Super Admin'")
    print("   Severity: Medium")


# ============================================================
# URL BYPASS RECHECK
# ============================================================
def url_bypass_recheck():
    print("\n" + "="*80)
    print("URL BYPASS RECHECK — Workspace Manager Endpoints")
    print("="*80)
    
    # Create a Profix-only user
    modules = {
        "profix": {
            "pages": {
                "all_requests": {
                    "view": {"enabled": True, "visible": True},
                    "scope": "individual"
                }
            }
        }
    }
    
    pset_id = create_permission_set("QA-ProfixReadOnly-URLBypass", modules)
    if not pset_id:
        return
    
    # Create user
    epoch = int(time.time())
    email = f"qa.profixreadonly.{epoch}@ticketing.com"
    emp_id = f"QA-PRO-{epoch}"
    user_id = create_dummy_admin(email, emp_id, [pset_id])
    if not user_id:
        return
    
    # Impersonate
    token = impersonate(user_id)
    if not token:
        return
    
    # Test workspace-manager endpoints
    endpoints = [
        "/floor-plans",
        "/workstations",
        "/meeting-rooms",
        "/workstation-bookings",
        "/room-bookings",
        "/workstation-requests",
        "/meeting-room-requests",
        "/bookings",
        "/dashboard",
        "/my-workspace/dashboard"
    ]
    
    for endpoint in endpoints:
        result = test_with_token(token, endpoint, 403, "URL Bypass", f"Profix-only user should not access {endpoint}")
        log_test(result)
        time.sleep(0.2)


# ============================================================
# CLEANUP
# ============================================================
def cleanup():
    print("\n" + "="*80)
    print("CLEANUP")
    print("="*80)
    
    # Deactivate users
    for user_id in created_users:
        print(f"Deactivating user {user_id}...")
        resp = session.patch(f"{BASE_URL}/contacts/{user_id}", json={"status": "Inactive"})
        if resp.status_code == 200:
            print(f"✅ Deactivated {user_id}")
        else:
            print(f"❌ Failed to deactivate {user_id}: {resp.status_code}")
    
    # Delete permission sets
    for pset_id in created_psets:
        print(f"Deleting permission set {pset_id}...")
        resp = session.delete(f"{BASE_URL}/permission-sets-v3/{pset_id}")
        if resp.status_code == 200:
            print(f"✅ Deleted {pset_id}")
        else:
            print(f"❌ Failed to delete {pset_id}: {resp.status_code}")
    
    print(f"\n✅ Cleanup complete: {len(created_users)} users deactivated, {len(created_psets)} permission sets deleted")


# ============================================================
# MAIN
# ============================================================
def main():
    print("="*80)
    print("PERMISSIONS QA CONTINUATION")
    print("Scenarios D, E, H, J, K, L, M, N, O + URL Bypass Recheck")
    print("="*80)
    
    if not login():
        print("❌ Login failed. Exiting.")
        sys.exit(1)
    
    try:
        # Run all scenarios
        scenario_d()
        scenario_e()
        scenario_h()
        scenario_j()
        scenario_k()
        scenario_l()
        scenario_m()
        scenario_n()
        scenario_o()
        url_bypass_recheck()
        
    finally:
        # Always cleanup
        cleanup()
    
    # Print summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for r in test_results if r.status == "PASS")
    failed = sum(1 for r in test_results if r.status == "FAIL")
    total = len(test_results)
    
    print(f"\nTotal Tests: {total}")
    print(f"✅ Passed: {passed}")
    print(f"❌ Failed: {failed}")
    if total > 0:
        print(f"Pass Rate: {passed/total*100:.1f}%")
    else:
        print("Pass Rate: N/A (no tests run)")
    
    # Print failed tests
    if failed > 0:
        print("\n" + "="*80)
        print("FAILED TESTS")
        print("="*80)
        for r in test_results:
            if r.status == "FAIL":
                print(f"\n❌ {r.scenario} | {r.endpoint}")
                print(f"   Expected: {r.expected}")
                print(f"   Actual: {r.actual}")
                if r.details:
                    print(f"   Details: {r.details}")
    
    # Save results to file
    with open("/app/qa_permissions_continuation_results.json", "w") as f:
        json.dump([{
            "scenario": r.scenario,
            "endpoint": r.endpoint,
            "expected": r.expected,
            "actual": r.actual,
            "status": r.status,
            "details": r.details
        } for r in test_results], f, indent=2)
    
    print(f"\n✅ Results saved to /app/qa_permissions_continuation_results.json")
    
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
