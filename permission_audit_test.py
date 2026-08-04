"""
COMPREHENSIVE PERMISSION-ENFORCEMENT AUDIT
Tests page-level + function-level permissions (buttons, filters, actions)
via synthetic permission sets and impersonation.
"""

import asyncio
import json
import uuid
from datetime import datetime
from playwright.async_api import async_playwright, Page, expect

# Configuration
FRONTEND_URL = "https://crm-segment-link.preview.emergentagent.com"
BACKEND_URL = f"{FRONTEND_URL}/api"
SUPER_ADMIN_EMAIL = "admin@ticketing.com"
SUPER_ADMIN_PASSWORD = "Admin@123"

# Test data storage
test_data = {
    "permission_sets": [],
    "users": [],
    "token": None
}

async def login_super_admin(page: Page):
    """Login as Super Admin and return bearer token"""
    print("\n=== LOGGING IN AS SUPER ADMIN ===")
    await page.goto(f"{FRONTEND_URL}/login")
    await page.wait_for_timeout(1000)
    await page.fill('input[type="email"]', SUPER_ADMIN_EMAIL)
    await page.fill('input[type="password"]', SUPER_ADMIN_PASSWORD)
    await page.click('button[type="submit"]')
    
    # Wait for navigation
    try:
        await page.wait_for_url(f"{FRONTEND_URL}/admin", timeout=15000)
    except Exception:
        # May redirect to different page
        await page.wait_for_timeout(3000)
    
    # Extract token from sessionStorage
    token = await page.evaluate("() => sessionStorage.getItem('access_token')")
    
    if not token:
        # Try localStorage
        token = await page.evaluate("() => localStorage.getItem('access_token')")
    
    if not token:
        # Try to get from cookies or other storage
        print("⚠ Token not found in sessionStorage or localStorage")
        print(f"Current URL: {page.url}")
        # Take screenshot for debugging
        await page.screenshot(path="/app/login_debug.png")
        raise Exception("Failed to retrieve access token after login")
    
    print(f"✓ Logged in successfully, token: {token[:20]}...")
    return token

async def get_permission_schema(token: str):
    """Fetch permission schema v3"""
    print("\n=== FETCHING PERMISSION SCHEMA ===")
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        page = await context.new_page()
        
        response = await page.request.get(
            f"{BACKEND_URL}/permissions/schema/v3",
            headers={"Authorization": f"Bearer {token}"}
        )
        schema = await response.json()
        print(f"✓ Schema fetched: {len(schema.get('modules', {}))} modules")
        await browser.close()
        return schema

async def get_existing_permission_set(token: str):
    """Get an existing permission set to understand the structure"""
    print("\n=== FETCHING EXISTING PERMISSION SET ===")
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        page = await context.new_page()
        
        response = await page.request.get(
            f"{BACKEND_URL}/permission-sets",
            headers={"Authorization": f"Bearer {token}"}
        )
        sets = await response.json()
        if sets and len(sets) > 0:
            # Get detailed view of first set
            first_set_id = sets[0].get('id')
            detail_response = await page.request.get(
                f"{BACKEND_URL}/permission-sets/{first_set_id}",
                headers={"Authorization": f"Bearer {token}"}
            )
            detail = await detail_response.json()
            print(f"✓ Sample set fetched: {detail.get('title')}")
            await browser.close()
            return detail
        await browser.close()
        return None

def build_permission_set_a():
    """SET A — Profix All-Requests Read+Filter"""
    return {
        "name": "TEMP AUDIT — Profix All-Requests Read+Filter",
        "title": "TEMP AUDIT — Profix All-Requests Read+Filter",
        "description": "Temporary test set for permission audit",
        "numeric_id": 100,
        "modules": {
            "profix": {
                "all_requests": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"},
                    "edit": {"enabled": False, "visible": False},
                    "functions": {
                        "search": {"enabled": True, "visible": True},
                        "filter_status": {"enabled": True, "visible": True},
                        "filter_priority": {"enabled": True, "visible": True},
                        "refresh_list": {"enabled": True, "visible": True},
                        "create_ticket": {"enabled": False, "visible": False},
                        "export_tickets": {"enabled": False, "visible": False},
                        "filter_assignee": {"enabled": False, "visible": False},
                        "filter_date": {"enabled": False, "visible": False},
                        "bulk_assign": {"enabled": False, "visible": False}
                    }
                },
                "create_request": {
                    "view": {"enabled": False, "visible": False},
                    "functions": {}
                },
                "open_requests": {
                    "view": {"enabled": False, "visible": False},
                    "functions": {}
                },
                "unassigned": {
                    "view": {"enabled": False, "visible": False},
                    "functions": {}
                }
            },
            "desk_booking": {
                "floor_layout": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "workstation_booking": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "request_workstation": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "meeting_room_booking": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "pending_approvals": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "floor_calibration": {"view": {"enabled": False, "visible": False}, "functions": {}}
            },
            "manage": {
                "employees": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "teams": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "permissions": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "email_templates": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "notifications": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "outbox": {"view": {"enabled": False, "visible": False}, "functions": {}}
            },
            "dashboard": {
                "workspace_manager": {"access_level": None},
                "profix": {"access_level": "overall"}
            }
        }
    }

def build_permission_set_b():
    """SET B — Profix Creator + Priority Filter"""
    return {
        "name": "TEMP AUDIT — Profix Creator + Priority Filter",
        "title": "TEMP AUDIT — Profix Creator + Priority Filter",
        "description": "Temporary test set for permission audit",
        "numeric_id": 101,
        "modules": {
            "profix": {
                "all_requests": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"},
                    "edit": {"enabled": False, "visible": False},
                    "functions": {
                        "create_ticket": {"enabled": True, "visible": True},
                        "filter_priority": {"enabled": True, "visible": True},
                        "search": {"enabled": True, "visible": True},
                        "filter_status": {"enabled": False, "visible": False},
                        "refresh_list": {"enabled": False, "visible": False},
                        "export_tickets": {"enabled": False, "visible": False},
                        "filter_assignee": {"enabled": False, "visible": False},
                        "filter_date": {"enabled": False, "visible": False},
                        "bulk_assign": {"enabled": False, "visible": False}
                    }
                },
                "create_request": {
                    "view": {"enabled": True, "visible": True},
                    "functions": {
                        "submit": {"enabled": True, "visible": True},
                        "upload_attach": {"enabled": True, "visible": True},
                        "save_draft": {"enabled": False, "visible": True}  # visible but disabled
                    }
                },
                "open_requests": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "unassigned": {"view": {"enabled": False, "visible": False}, "functions": {}}
            },
            "desk_booking": {
                "floor_layout": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "workstation_booking": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "request_workstation": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "meeting_room_booking": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "pending_approvals": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "floor_calibration": {"view": {"enabled": False, "visible": False}, "functions": {}}
            },
            "manage": {
                "employees": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "teams": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "permissions": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "email_templates": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "notifications": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "outbox": {"view": {"enabled": False, "visible": False}, "functions": {}}
            },
            "dashboard": {
                "workspace_manager": {"access_level": None},
                "profix": {"access_level": "individual"}
            }
        }
    }

def build_permission_set_c():
    """SET C — Workspace Approver"""
    return {
        "name": "TEMP AUDIT — Workspace Approver",
        "title": "TEMP AUDIT — Workspace Approver",
        "description": "Temporary test set for permission audit",
        "numeric_id": 102,
        "modules": {
            "profix": {
                "all_requests": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "create_request": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "open_requests": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "unassigned": {"view": {"enabled": False, "visible": False}, "functions": {}}
            },
            "desk_booking": {
                "pending_approvals": {
                    "view": {"enabled": True, "visible": True, "scope": "overall"},
                    "functions": {
                        "approve": {"enabled": True, "visible": True},
                        "reject": {"enabled": True, "visible": True},
                        "search": {"enabled": True, "visible": True},
                        "refresh": {"enabled": True, "visible": True},
                        "bulk_approve": {"enabled": False, "visible": True},  # visible but disabled
                        "bulk_reject": {"enabled": False, "visible": True},   # visible but disabled
                        "configure_auto_approval": {"enabled": False, "visible": False},
                        "filter_type": {"enabled": False, "visible": False},
                        "filter_date": {"enabled": False, "visible": False}
                    }
                },
                "floor_layout": {
                    "view": {"enabled": True, "visible": True},
                    "functions": {}
                },
                "workstation_booking": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "request_workstation": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "meeting_room_booking": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "floor_calibration": {"view": {"enabled": False, "visible": False}, "functions": {}}
            },
            "manage": {
                "employees": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "teams": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "permissions": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "email_templates": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "notifications": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "outbox": {"view": {"enabled": False, "visible": False}, "functions": {}}
            },
            "dashboard": {
                "workspace_manager": {"access_level": "manager"},
                "profix": {"access_level": None}
            }
        }
    }

def build_permission_set_d():
    """SET D — Employees Search Only"""
    return {
        "name": "TEMP AUDIT — Employees Search Only",
        "title": "TEMP AUDIT — Employees Search Only",
        "description": "Temporary test set for permission audit",
        "numeric_id": 103,
        "modules": {
            "profix": {
                "all_requests": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "create_request": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "open_requests": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "unassigned": {"view": {"enabled": False, "visible": False}, "functions": {}}
            },
            "desk_booking": {
                "floor_layout": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "workstation_booking": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "request_workstation": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "meeting_room_booking": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "pending_approvals": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "floor_calibration": {"view": {"enabled": False, "visible": False}, "functions": {}}
            },
            "manage": {
                "employees": {
                    "view": {"enabled": True, "visible": True},
                    "functions": {
                        "search": {"enabled": True, "visible": True},
                        "filter_role": {"enabled": True, "visible": True},
                        "create": {"enabled": False, "visible": False},
                        "edit": {"enabled": False, "visible": False},
                        "delete": {"enabled": False, "visible": False},
                        "invite": {"enabled": False, "visible": False},
                        "import": {"enabled": False, "visible": False},
                        "export": {"enabled": False, "visible": False},
                        "bulk_activate": {"enabled": False, "visible": False},
                        "bulk_deactivate": {"enabled": False, "visible": False},
                        "bulk_change_role": {"enabled": False, "visible": False},
                        "copy_password": {"enabled": False, "visible": False},
                        "reset_password": {"enabled": False, "visible": False},
                        "login_as": {"enabled": False, "visible": False},
                        "filter_status": {"enabled": False, "visible": False},
                        "filter_team": {"enabled": False, "visible": False},
                        "download_sample": {"enabled": False, "visible": False}
                    }
                },
                "teams": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "permissions": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "email_templates": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "notifications": {"view": {"enabled": False, "visible": False}, "functions": {}},
                "outbox": {"view": {"enabled": False, "visible": False}, "functions": {}}
            },
            "dashboard": {
                "workspace_manager": {"access_level": None},
                "profix": {"access_level": None}
            }
        }
    }

async def create_permission_sets(token: str):
    """Create 4 temporary permission sets"""
    print("\n=== CREATING PERMISSION SETS ===")
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        page = await context.new_page()
        
        sets = [
            build_permission_set_a(),
            build_permission_set_b(),
            build_permission_set_c(),
            build_permission_set_d()
        ]
        
        created_sets = []
        for i, perm_set in enumerate(sets, 1):
            print(f"\nCreating Set {chr(64+i)}: {perm_set['title']}")
            response = await page.request.post(
                f"{BACKEND_URL}/permission-sets",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"
                },
                data=json.dumps(perm_set)
            )
            
            if response.ok:
                result = await response.json()
                created_sets.append(result)
                print(f"✓ Created: {result.get('id')} - {result.get('title')}")
            else:
                error_text = await response.text()
                print(f"✗ Failed to create set {chr(64+i)}: {response.status} - {error_text}")
        
        await browser.close()
        return created_sets

async def create_test_users(token: str, permission_sets: list):
    """Create 4 test users and assign permission sets"""
    print("\n=== CREATING TEST USERS ===")
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        page = await context.new_page()
        
        users_data = [
            {
                "name": "Perm Audit User A",
                "email": "perm.audit.a@ticketing.com",
                "emp_id": "TMP-A",
                "role": "Admin",
                "password": "Audit@123",
                "doj": "2026-01-01",
                "permission_set_ids": [permission_sets[0]['id']]
            },
            {
                "name": "Perm Audit User B",
                "email": "perm.audit.b@ticketing.com",
                "emp_id": "TMP-B",
                "role": "Admin",
                "password": "Audit@123",
                "doj": "2026-01-01",
                "permission_set_ids": [permission_sets[1]['id']]
            },
            {
                "name": "Perm Audit User C",
                "email": "perm.audit.c@ticketing.com",
                "emp_id": "TMP-C",
                "role": "Admin",
                "password": "Audit@123",
                "doj": "2026-01-01",
                "permission_set_ids": [permission_sets[2]['id']]
            },
            {
                "name": "Perm Audit User D",
                "email": "perm.audit.d@ticketing.com",
                "emp_id": "TMP-D",
                "role": "Admin",
                "password": "Audit@123",
                "doj": "2026-01-01",
                "permission_set_ids": [permission_sets[3]['id']]
            }
        ]
        
        created_users = []
        for user_data in users_data:
            print(f"\nCreating user: {user_data['email']}")
            response = await page.request.post(
                f"{BACKEND_URL}/contacts",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"
                },
                data=json.dumps(user_data)
            )
            
            if response.ok:
                result = await response.json()
                created_users.append(result)
                print(f"✓ Created: {result.get('id')} - {result.get('email')}")
            else:
                error_text = await response.text()
                print(f"✗ Failed to create user: {response.status} - {error_text}")
        
        await browser.close()
        return created_users

async def impersonate_user(page: Page, token: str, user_id: str):
    """Fast-path impersonation"""
    print(f"\n=== IMPERSONATING USER {user_id} ===")
    
    # Call impersonate API
    response = await page.request.post(
        f"{BACKEND_URL}/auth/impersonate",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        },
        data=json.dumps({"user_id": user_id})
    )
    
    if not response.ok:
        error_text = await response.text()
        print(f"✗ Impersonation failed: {response.status} - {error_text}")
        return False
    
    result = await response.json()
    impersonate_token = result.get('access_token')
    
    # Navigate to impersonate callback
    await page.goto(f"{FRONTEND_URL}/impersonate/callback#token={impersonate_token}")
    await page.wait_for_url(f"{FRONTEND_URL}/admin", timeout=10000)
    
    print(f"✓ Impersonation successful")
    return True

async def test_scenario_a(page: Page, token: str, user: dict):
    """Scenario A — Read+Filter set"""
    print("\n" + "="*80)
    print("SCENARIO A — Profix All-Requests Read+Filter")
    print("="*80)
    
    results = []
    
    # Impersonate user A
    if not await impersonate_user(page, token, user['id']):
        return results
    
    # Navigate to All Requests page
    await page.goto(f"{FRONTEND_URL}/admin/open-tickets")
    await page.wait_for_timeout(2000)
    
    # Check sidebar
    sidebar_text = await page.locator('[data-testid="sidebar"]').inner_text() if await page.locator('[data-testid="sidebar"]').count() > 0 else ""
    has_all_requests = "All Requests" in sidebar_text or "Open Tickets" in sidebar_text
    results.append(("Sidebar contains 'All Requests'", "Present", "Present" if has_all_requests else "Absent", "PASS" if has_all_requests else "FAIL"))
    
    # Check page renders (not empty state)
    empty_state = await page.locator('text=/No Module Assigned|No Dashboard Shared/i').count()
    results.append(("Page renders (not empty state)", "Renders", "Renders" if empty_state == 0 else "Empty state", "PASS" if empty_state == 0 else "FAIL"))
    
    # Check PRESENT + ENABLED elements
    search_input = await page.locator('input[placeholder*="Search" i]').count()
    results.append(("Search input", "Present + Enabled", "Present" if search_input > 0 else "Absent", "PASS" if search_input > 0 else "FAIL"))
    
    status_filter = await page.locator('button:has-text("Status"), select:has-text("Status"), [aria-label*="Status" i]').count()
    results.append(("Status filter", "Present + Enabled", "Present" if status_filter > 0 else "Absent", "PASS" if status_filter > 0 else "FAIL"))
    
    priority_filter = await page.locator('button:has-text("Priority"), select:has-text("Priority"), [aria-label*="Priority" i]').count()
    results.append(("Priority filter", "Present + Enabled", "Present" if priority_filter > 0 else "Absent", "PASS" if priority_filter > 0 else "FAIL"))
    
    refresh_btn = await page.locator('[data-testid="refresh-btn"], button:has-text("Refresh")').count()
    results.append(("Refresh button", "Present + Enabled", "Present" if refresh_btn > 0 else "Absent", "PASS" if refresh_btn > 0 else "FAIL"))
    
    # Check ABSENT elements
    create_btn = await page.locator('[data-testid="create-ticket-btn"], button:has-text("New Ticket"), button:has-text("New Request"), button:has-text("Create Ticket")').count()
    results.append(("Create Ticket button", "Absent", "Absent" if create_btn == 0 else "Present", "PASS" if create_btn == 0 else "FAIL"))
    
    export_btn = await page.locator('[data-testid="export-tickets-csv"], button:has-text("Export")').count()
    results.append(("Export button", "Absent", "Absent" if export_btn == 0 else "Present", "PASS" if export_btn == 0 else "FAIL"))
    
    bulk_assign = await page.locator('button:has-text("Bulk Assign")').count()
    results.append(("Bulk Assign button", "Absent", "Absent" if bulk_assign == 0 else "Present", "PASS" if bulk_assign == 0 else "FAIL"))
    
    # Screenshot
    await page.screenshot(path="/app/scenario_a_all_requests.png", full_page=True)
    print("✓ Screenshot saved: scenario_a_all_requests.png")
    
    return results

async def test_scenario_b(page: Page, token: str, user: dict):
    """Scenario B — Creator + Priority Filter"""
    print("\n" + "="*80)
    print("SCENARIO B — Profix Creator + Priority Filter")
    print("="*80)
    
    results = []
    
    # Impersonate user B
    if not await impersonate_user(page, token, user['id']):
        return results
    
    # Check sidebar
    await page.goto(f"{FRONTEND_URL}/admin")
    await page.wait_for_timeout(2000)
    
    sidebar_text = await page.locator('[data-testid="sidebar"]').inner_text() if await page.locator('[data-testid="sidebar"]').count() > 0 else ""
    has_all_requests = "All Requests" in sidebar_text or "Open Tickets" in sidebar_text
    has_create = "New Request" in sidebar_text or "Create Ticket" in sidebar_text
    results.append(("Sidebar has 'All Requests'", "Present", "Present" if has_all_requests else "Absent", "PASS" if has_all_requests else "FAIL"))
    results.append(("Sidebar has 'New Request'", "Present", "Present" if has_create else "Absent", "PASS" if has_create else "FAIL"))
    
    # Navigate to All Requests
    await page.goto(f"{FRONTEND_URL}/admin/open-tickets")
    await page.wait_for_timeout(2000)
    
    create_btn = await page.locator('[data-testid="create-ticket-btn"], button:has-text("New Ticket"), button:has-text("New Request"), button:has-text("Create Ticket")').count()
    results.append(("Create Ticket button on page", "Present + Enabled", "Present" if create_btn > 0 else "Absent", "PASS" if create_btn > 0 else "FAIL"))
    
    search_input = await page.locator('input[placeholder*="Search" i]').count()
    results.append(("Search input", "Present", "Present" if search_input > 0 else "Absent", "PASS" if search_input > 0 else "FAIL"))
    
    priority_filter = await page.locator('button:has-text("Priority"), select:has-text("Priority")').count()
    results.append(("Priority filter", "Present", "Present" if priority_filter > 0 else "Absent", "PASS" if priority_filter > 0 else "FAIL"))
    
    status_filter = await page.locator('button:has-text("Status"), select:has-text("Status")').count()
    results.append(("Status filter", "Absent", "Absent" if status_filter == 0 else "Present", "PASS" if status_filter == 0 else "FAIL"))
    
    export_btn = await page.locator('[data-testid="export-tickets-csv"], button:has-text("Export")').count()
    results.append(("Export button", "Absent", "Absent" if export_btn == 0 else "Present", "PASS" if export_btn == 0 else "FAIL"))
    
    await page.screenshot(path="/app/scenario_b_all_requests.png", full_page=True)
    
    # Navigate to Create Request page
    await page.goto(f"{FRONTEND_URL}/admin/create-ticket")
    await page.wait_for_timeout(2000)
    
    submit_btn = await page.locator('button[type="submit"]:has-text("Submit"), button:has-text("Submit")').count()
    submit_disabled = await page.locator('button[type="submit"]:has-text("Submit")[disabled], button:has-text("Submit")[disabled]').count()
    results.append(("Submit button", "Present + Enabled", f"Present ({'Disabled' if submit_disabled > 0 else 'Enabled'})" if submit_btn > 0 else "Absent", "PASS" if submit_btn > 0 and submit_disabled == 0 else "FAIL"))
    
    draft_btn = await page.locator('button:has-text("Save Draft"), button:has-text("Draft")').count()
    draft_disabled = await page.locator('button:has-text("Save Draft")[disabled], button:has-text("Draft")[disabled]').count()
    results.append(("Save Draft button", "Present but Disabled", f"Present ({'Disabled' if draft_disabled > 0 else 'Enabled'})" if draft_btn > 0 else "Absent", "PASS" if draft_btn > 0 and draft_disabled > 0 else "FAIL"))
    
    await page.screenshot(path="/app/scenario_b_create_request.png", full_page=True)
    print("✓ Screenshots saved: scenario_b_*.png")
    
    return results

async def test_scenario_c(page: Page, token: str, user: dict):
    """Scenario C — Workspace Approver"""
    print("\n" + "="*80)
    print("SCENARIO C — Workspace Approver")
    print("="*80)
    
    results = []
    
    # Impersonate user C
    if not await impersonate_user(page, token, user['id']):
        return results
    
    await page.goto(f"{FRONTEND_URL}/admin")
    await page.wait_for_timeout(2000)
    
    # Check sidebar
    sidebar_text = await page.locator('[data-testid="sidebar"]').inner_text() if await page.locator('[data-testid="sidebar"]').count() > 0 else ""
    has_workspace = "Workspace Manager" in sidebar_text
    has_floor_layout = "Floor Layout" in sidebar_text
    has_pending = "Pending Approvals" in sidebar_text
    results.append(("Sidebar has 'Workspace Manager'", "Present", "Present" if has_workspace else "Absent", "PASS" if has_workspace else "FAIL"))
    results.append(("Sidebar has 'Floor Layout'", "Present", "Present" if has_floor_layout else "Absent", "PASS" if has_floor_layout else "FAIL"))
    results.append(("Sidebar has 'Pending Approvals'", "Present", "Present" if has_pending else "Absent", "PASS" if has_pending else "FAIL"))
    
    # Check dashboard tabs
    dashboard_tabs = await page.locator('[data-testid="dashboard-tabs"]').count()
    if dashboard_tabs > 0:
        tabs_text = await page.locator('[data-testid="dashboard-tabs"]').inner_text()
        has_wm_tab = "Workspace Manager" in tabs_text
        has_profix_tab = "Profix" in tabs_text
        results.append(("Dashboard has 'Workspace Manager' tab", "Present", "Present" if has_wm_tab else "Absent", "PASS" if has_wm_tab else "FAIL"))
        results.append(("Dashboard has 'Profix' tab", "Absent", "Absent" if not has_profix_tab else "Present", "PASS" if not has_profix_tab else "FAIL"))
    else:
        results.append(("Dashboard tabs", "Only Workspace Manager", "No tabs found", "FAIL"))
    
    # Navigate to Pending Approvals
    await page.goto(f"{FRONTEND_URL}/workspace-manager/pending-approvals")
    await page.wait_for_timeout(2000)
    
    approve_btn = await page.locator('button:has-text("Approve"), [data-testid*="approve" i]').count()
    results.append(("Approve button", "Present + Enabled", "Present" if approve_btn > 0 else "Absent", "PASS" if approve_btn > 0 else "FAIL"))
    
    reject_btn = await page.locator('button:has-text("Reject"), [data-testid*="reject" i]').count()
    results.append(("Reject button", "Present + Enabled", "Present" if reject_btn > 0 else "Absent", "PASS" if reject_btn > 0 else "FAIL"))
    
    bulk_approve = await page.locator('button:has-text("Bulk Approve")').count()
    bulk_approve_disabled = await page.locator('button:has-text("Bulk Approve")[disabled]').count()
    results.append(("Bulk Approve button", "Present but Disabled", f"Present ({'Disabled' if bulk_approve_disabled > 0 else 'Enabled'})" if bulk_approve > 0 else "Absent", "PASS" if bulk_approve > 0 and bulk_approve_disabled > 0 else "FAIL"))
    
    bulk_reject = await page.locator('button:has-text("Bulk Reject")').count()
    bulk_reject_disabled = await page.locator('button:has-text("Bulk Reject")[disabled]').count()
    results.append(("Bulk Reject button", "Present but Disabled", f"Present ({'Disabled' if bulk_reject_disabled > 0 else 'Enabled'})" if bulk_reject > 0 else "Absent", "PASS" if bulk_reject > 0 and bulk_reject_disabled > 0 else "FAIL"))
    
    auto_approval = await page.locator('button:has-text("Configure Auto-Approval"), button:has-text("Auto Approval")').count()
    results.append(("Configure Auto-Approval", "Absent", "Absent" if auto_approval == 0 else "Present", "PASS" if auto_approval == 0 else "FAIL"))
    
    search_input = await page.locator('input[placeholder*="Search" i]').count()
    results.append(("Search input", "Present + Enabled", "Present" if search_input > 0 else "Absent", "PASS" if search_input > 0 else "FAIL"))
    
    await page.screenshot(path="/app/scenario_c_pending_approvals.png", full_page=True)
    print("✓ Screenshot saved: scenario_c_pending_approvals.png")
    
    return results

async def test_scenario_d(page: Page, token: str, user: dict):
    """Scenario D — Employees Search Only"""
    print("\n" + "="*80)
    print("SCENARIO D — Employees Search Only")
    print("="*80)
    
    results = []
    
    # Impersonate user D
    if not await impersonate_user(page, token, user['id']):
        return results
    
    # Direct navigate to /admin/contacts (Manage group is superAdminOnly)
    await page.goto(f"{FRONTEND_URL}/admin/contacts")
    await page.wait_for_timeout(2000)
    
    # Check page renders
    empty_state = await page.locator('text=/No Module Assigned|No Dashboard Shared/i').count()
    results.append(("Page renders (not empty state)", "Renders", "Renders" if empty_state == 0 else "Empty state", "PASS" if empty_state == 0 else "FAIL"))
    
    # Check PRESENT elements
    search_input = await page.locator('input[placeholder*="Search" i]').count()
    results.append(("Search input", "Present + Enabled", "Present" if search_input > 0 else "Absent", "PASS" if search_input > 0 else "FAIL"))
    
    role_filter = await page.locator('button:has-text("Role"), select:has-text("Role"), [aria-label*="Role" i]').count()
    results.append(("Role filter", "Present + Enabled", "Present" if role_filter > 0 else "Absent", "PASS" if role_filter > 0 else "FAIL"))
    
    # Check ABSENT elements
    add_btn = await page.locator('button:has-text("Add Employee"), button:has-text("Create Employee"), button:has-text("New Employee")').count()
    results.append(("Add Employee button", "Absent", "Absent" if add_btn == 0 else "Present", "PASS" if add_btn == 0 else "FAIL"))
    
    invite_btn = await page.locator('button:has-text("Invite")').count()
    results.append(("Invite button", "Absent", "Absent" if invite_btn == 0 else "Present", "PASS" if invite_btn == 0 else "FAIL"))
    
    import_btn = await page.locator('button:has-text("Import")').count()
    results.append(("Import button", "Absent", "Absent" if import_btn == 0 else "Present", "PASS" if import_btn == 0 else "FAIL"))
    
    export_btn = await page.locator('button:has-text("Export")').count()
    results.append(("Export button", "Absent", "Absent" if export_btn == 0 else "Present", "PASS" if export_btn == 0 else "FAIL"))
    
    await page.screenshot(path="/app/scenario_d_employees.png", full_page=True)
    print("✓ Screenshot saved: scenario_d_employees.png")
    
    return results

async def test_super_admin_regression(page: Page):
    """Regression — Super Admin can still see everything"""
    print("\n" + "="*80)
    print("REGRESSION — Super Admin Full Access")
    print("="*80)
    
    results = []
    
    # Login as Super Admin
    await page.goto(f"{FRONTEND_URL}/login")
    await page.fill('input[type="email"]', SUPER_ADMIN_EMAIL)
    await page.fill('input[type="password"]', SUPER_ADMIN_PASSWORD)
    await page.click('button[type="submit"]')
    await page.wait_for_url(f"{FRONTEND_URL}/admin", timeout=10000)
    
    # Check /admin/open-tickets
    await page.goto(f"{FRONTEND_URL}/admin/open-tickets")
    await page.wait_for_timeout(2000)
    
    create_btn = await page.locator('[data-testid="create-ticket-btn"], button:has-text("New Ticket"), button:has-text("Create Ticket")').count()
    export_btn = await page.locator('[data-testid="export-tickets-csv"], button:has-text("Export")').count()
    results.append(("All Requests - Create button", "Present", "Present" if create_btn > 0 else "Absent", "PASS" if create_btn > 0 else "FAIL"))
    results.append(("All Requests - Export button", "Present", "Present" if export_btn > 0 else "Absent", "PASS" if export_btn > 0 else "FAIL"))
    
    # Check /admin/contacts
    await page.goto(f"{FRONTEND_URL}/admin/contacts")
    await page.wait_for_timeout(2000)
    
    add_btn = await page.locator('button:has-text("Add Employee"), button:has-text("Create Employee")').count()
    results.append(("Employees - Add button", "Present", "Present" if add_btn > 0 else "Absent", "PASS" if add_btn > 0 else "FAIL"))
    
    # Check sidebar
    sidebar_text = await page.locator('[data-testid="sidebar"]').inner_text() if await page.locator('[data-testid="sidebar"]').count() > 0 else ""
    has_dashboard = "Dashboard" in sidebar_text
    has_manage = "Manage" in sidebar_text
    results.append(("Sidebar - Dashboard link", "Present", "Present" if has_dashboard else "Absent", "PASS" if has_dashboard else "FAIL"))
    results.append(("Sidebar - Manage group", "Present", "Present" if has_manage else "Absent", "PASS" if has_manage else "FAIL"))
    
    # Check dashboard tabs
    await page.goto(f"{FRONTEND_URL}/admin")
    await page.wait_for_timeout(2000)
    
    dashboard_tabs = await page.locator('[data-testid="dashboard-tabs"]').count()
    if dashboard_tabs > 0:
        tabs_text = await page.locator('[data-testid="dashboard-tabs"]').inner_text()
        has_wm_tab = "Workspace Manager" in tabs_text
        has_profix_tab = "Profix" in tabs_text
        results.append(("Dashboard - Workspace Manager tab", "Present", "Present" if has_wm_tab else "Absent", "PASS" if has_wm_tab else "FAIL"))
        results.append(("Dashboard - Profix tab", "Present", "Present" if has_profix_tab else "Absent", "PASS" if has_profix_tab else "FAIL"))
    
    await page.screenshot(path="/app/scenario_regression_super_admin.png", full_page=True)
    print("✓ Screenshot saved: scenario_regression_super_admin.png")
    
    return results

async def cleanup(token: str, permission_sets: list, users: list):
    """Delete test users and permission sets"""
    print("\n" + "="*80)
    print("CLEANUP")
    print("="*80)
    
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        page = await context.new_page()
        
        # Delete users
        print("\nDeleting test users...")
        for user in users:
            user_id = user.get('id')
            response = await page.request.delete(
                f"{BACKEND_URL}/contacts/{user_id}",
                headers={"Authorization": f"Bearer {token}"}
            )
            if response.ok:
                print(f"✓ Deleted user: {user.get('email')}")
            else:
                print(f"✗ Failed to delete user {user_id}: {response.status}")
        
        # Delete permission sets
        print("\nDeleting permission sets...")
        for perm_set in permission_sets:
            set_id = perm_set.get('id')
            response = await page.request.delete(
                f"{BACKEND_URL}/permission-sets/{set_id}",
                headers={"Authorization": f"Bearer {token}"}
            )
            if response.ok:
                print(f"✓ Deleted set: {perm_set.get('title')}")
            else:
                print(f"✗ Failed to delete set {set_id}: {response.status}")
        
        # Verify cleanup
        print("\nVerifying cleanup...")
        response = await page.request.get(
            f"{BACKEND_URL}/permission-sets",
            headers={"Authorization": f"Bearer {token}"}
        )
        sets = await response.json()
        temp_sets = [s for s in sets if s.get('title', '').startswith('TEMP AUDIT —')]
        if len(temp_sets) == 0:
            print("✓ All temporary permission sets removed")
        else:
            print(f"✗ Warning: {len(temp_sets)} temporary sets still exist")
        
        await browser.close()

def print_results_table(scenario_name: str, results: list):
    """Print results in table format"""
    print(f"\n{'='*100}")
    print(f"{scenario_name}")
    print(f"{'='*100}")
    print(f"{'Assertion':<50} {'Expected':<20} {'Actual':<20} {'Result':<10}")
    print(f"{'-'*100}")
    for assertion, expected, actual, result in results:
        print(f"{assertion:<50} {expected:<20} {actual:<20} {result:<10}")
    
    passed = sum(1 for r in results if r[3] == "PASS")
    total = len(results)
    print(f"{'-'*100}")
    print(f"TOTAL: {passed}/{total} PASSED")

async def main():
    """Main test execution"""
    print("\n" + "="*80)
    print("COMPREHENSIVE PERMISSION-ENFORCEMENT AUDIT")
    print("="*80)
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1400, "height": 900})
        page = await context.new_page()
        
        try:
            # Setup
            token = await login_super_admin(page)
            test_data['token'] = token
            
            # Get schema (for reference)
            schema = await get_permission_schema(token)
            
            # Get existing set structure (for reference)
            sample_set = await get_existing_permission_set(token)
            
            # Create permission sets
            permission_sets = await create_permission_sets(token)
            test_data['permission_sets'] = permission_sets
            
            if len(permission_sets) != 4:
                print(f"\n✗ ERROR: Expected 4 permission sets, got {len(permission_sets)}")
                return
            
            # Create test users
            users = await create_test_users(token, permission_sets)
            test_data['users'] = users
            
            if len(users) != 4:
                print(f"\n✗ ERROR: Expected 4 users, got {len(users)}")
                return
            
            # Run test scenarios
            results_a = await test_scenario_a(page, token, users[0])
            print_results_table("SCENARIO A — Profix All-Requests Read+Filter", results_a)
            
            results_b = await test_scenario_b(page, token, users[1])
            print_results_table("SCENARIO B — Profix Creator + Priority Filter", results_b)
            
            results_c = await test_scenario_c(page, token, users[2])
            print_results_table("SCENARIO C — Workspace Approver", results_c)
            
            results_d = await test_scenario_d(page, token, users[3])
            print_results_table("SCENARIO D — Employees Search Only", results_d)
            
            results_regression = await test_super_admin_regression(page)
            print_results_table("REGRESSION — Super Admin Full Access", results_regression)
            
            # Cleanup
            await cleanup(token, permission_sets, users)
            
            # Final summary
            all_results = results_a + results_b + results_c + results_d + results_regression
            total_passed = sum(1 for r in all_results if r[3] == "PASS")
            total_tests = len(all_results)
            
            print("\n" + "="*80)
            print("FINAL SUMMARY")
            print("="*80)
            print(f"Total Tests: {total_tests}")
            print(f"Passed: {total_passed}")
            print(f"Failed: {total_tests - total_passed}")
            print(f"Success Rate: {(total_passed/total_tests)*100:.1f}%")
            
            print("\nScreenshots saved:")
            print("- scenario_a_all_requests.png")
            print("- scenario_b_all_requests.png")
            print("- scenario_b_create_request.png")
            print("- scenario_c_pending_approvals.png")
            print("- scenario_d_employees.png")
            print("- scenario_regression_super_admin.png")
            
        except Exception as e:
            print(f"\n✗ ERROR: {str(e)}")
            import traceback
            traceback.print_exc()
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
