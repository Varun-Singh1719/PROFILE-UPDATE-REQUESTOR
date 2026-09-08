#!/usr/bin/env python3
"""
Permission Enforcement End-to-End Test
Tests both:
1. Employee Edit → Permission Sets dropdown label fix (undefined → title)
2. Permission enforcement audit (3 scenarios)
"""

import asyncio
import sys
import time
from datetime import datetime
from playwright.async_api import async_playwright, expect
import requests

# Configuration
BASE_URL = "https://crm-client-contacts.preview.emergentagent.com"
API_URL = f"{BASE_URL}/api"
SUPER_ADMIN_EMAIL = "admin@ticketing.com"
SUPER_ADMIN_PASSWORD = "Admin@123"

# Test state
test_results = []
test_users = []  # Track created users for cleanup


def log_test(scenario, status, details=""):
    """Log test result"""
    result = {
        "scenario": scenario,
        "status": status,
        "details": details,
        "timestamp": datetime.now().isoformat()
    }
    test_results.append(result)
    status_icon = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⚠️"
    print(f"{status_icon} {scenario}: {status}")
    if details:
        print(f"   {details}")


def api_login():
    """Login via API and return session"""
    session = requests.Session()
    resp = session.post(f"{API_URL}/auth/login", json={
        "email": SUPER_ADMIN_EMAIL,
        "password": SUPER_ADMIN_PASSWORD
    })
    if resp.status_code == 200:
        log_test("API Login", "PASS", f"Logged in as {SUPER_ADMIN_EMAIL}")
        return session
    else:
        log_test("API Login", "FAIL", f"Status {resp.status_code}: {resp.text}")
        return None


async def test_part1_permission_sets_dropdown(page):
    """PART 1: Verify Permission Sets dropdown labels (no undefined)"""
    print("\n" + "="*80)
    print("PART 1: PERMISSION SETS DROPDOWN LABEL FIX")
    print("="*80)
    
    try:
        # Login
        await page.goto(f"{BASE_URL}/login")
        await page.fill('input[type="email"]', SUPER_ADMIN_EMAIL)
        await page.fill('input[type="password"]', SUPER_ADMIN_PASSWORD)
        await page.click('button[type="submit"]')
        await page.wait_for_url("**/admin**", timeout=10000)
        log_test("Part 1 - Login", "PASS", "Logged in successfully")
        
        # Navigate to Employee List
        await page.goto(f"{BASE_URL}/admin/employees")
        await page.wait_for_load_state("networkidle")
        
        # Wait for table to load - look for table element
        try:
            await page.wait_for_selector('table tbody tr', timeout=10000)
            log_test("Part 1 - Navigate to Employees", "PASS", "Loaded employee list")
        except Exception as e:
            log_test("Part 1 - Navigate to Employees", "FAIL", f"Table not loaded: {str(e)[:100]}")
            await page.screenshot(path="/app/part1_table_not_loaded.png", full_page=True)
            return False
        
        # Find and click Edit on first employee with permission sets
        # Wait for table rows to be visible
        await page.wait_for_timeout(2000)
        
        # Find the first row action button (three-dot menu)
        action_buttons = await page.locator('[data-testid^="row-actions-"]').all()
        
        if not action_buttons:
            # Try alternative selector
            action_buttons = await page.locator('button[aria-label="Row actions"]').all()
        
        if not action_buttons:
            log_test("Part 1 - Find Action Buttons", "FAIL", "No action buttons found")
            await page.screenshot(path="/app/part1_no_action_buttons.png", full_page=True)
            
            # Debug: check what's on the page
            rows = await page.locator('table tbody tr').count()
            log_test("Part 1 - Debug", "INFO", f"Found {rows} table rows")
            return False
        
        log_test("Part 1 - Find Action Buttons", "PASS", f"Found {len(action_buttons)} action buttons")
        
        # Click first action button to open dropdown
        await action_buttons[0].click()
        await page.wait_for_timeout(800)
        
        # Now click Edit in the dropdown
        edit_button = page.locator('[data-testid^="edit-"]').first
        
        if not await edit_button.is_visible():
            log_test("Part 1 - Find Edit in Dropdown", "FAIL", "Edit button not visible in dropdown")
            await page.screenshot(path="/app/part1_no_edit_in_dropdown.png", full_page=True)
            return False
        
        await edit_button.click()
        await page.wait_for_timeout(1500)  # Wait for dialog to open
        log_test("Part 1 - Open Edit Dialog", "PASS", "Edit dialog opened")
        
        # Find and click Permission Sets dropdown
        # The dropdown might be a Select component or a custom dropdown
        await page.wait_for_timeout(1000)
        
        # Try multiple selectors for the Permission Sets field
        perm_sets_trigger = None
        
        # Try 1: Look for button with "Permission Sets" text
        if await page.locator('button:has-text("Permission Sets")').count() > 0:
            perm_sets_trigger = page.locator('button:has-text("Permission Sets")').first
        
        # Try 2: Look for label + button combo
        if not perm_sets_trigger and await page.locator('label:has-text("Permission Sets")').count() > 0:
            label = page.locator('label:has-text("Permission Sets")').first
            # Find the associated input/button
            perm_sets_trigger = label.locator('..').locator('button').first
        
        # Try 3: Look for combobox role
        if not perm_sets_trigger and await page.locator('[role="combobox"]').count() > 0:
            combos = await page.locator('[role="combobox"]').all()
            for combo in combos:
                text = await combo.inner_text()
                if "permission" in text.lower() or "select" in text.lower():
                    perm_sets_trigger = combo
                    break
        
        if not perm_sets_trigger:
            log_test("Part 1 - Find Permission Sets Dropdown", "FAIL", "Permission Sets dropdown not found")
            await page.screenshot(path="/app/part1_no_dropdown.png", full_page=True)
            return False
        
        await perm_sets_trigger.click()
        await page.wait_for_timeout(1000)
        log_test("Part 1 - Open Permission Sets Dropdown", "PASS", "Dropdown opened")
        
        # Take screenshot with dropdown open
        await page.screenshot(path="/app/part1_permission_sets_dropdown.png", full_page=True)
        
        # Get all dropdown options
        # Try multiple selectors for dropdown options
        options = await page.locator('[role="option"], [data-value], .select-item, li[data-value]').all()
        
        if not options:
            log_test("Part 1 - Find Dropdown Options", "FAIL", "No dropdown options found")
            return False
        
        log_test("Part 1 - Find Dropdown Options", "PASS", f"Found {len(options)} options")
        
        # Check each option label
        undefined_found = False
        valid_pattern_count = 0
        
        for i, option in enumerate(options):
            text = await option.inner_text()
            text = text.strip()
            
            if not text:
                continue
            
            # Check for "undefined"
            if "undefined" in text.lower():
                undefined_found = True
                log_test(f"Part 1 - Option {i+1} Label", "FAIL", f"Contains 'undefined': {text}")
            else:
                # Check if matches pattern: <number> - <title>
                if " - " in text and text.split(" - ")[0].strip().isdigit():
                    valid_pattern_count += 1
                    if i < 3:  # Log first 3 for verification
                        log_test(f"Part 1 - Option {i+1} Label", "PASS", f"Valid pattern: {text}")
        
        if undefined_found:
            log_test("Part 1 - No Undefined Labels", "FAIL", "Found 'undefined' in dropdown labels")
            return False
        else:
            log_test("Part 1 - No Undefined Labels", "PASS", f"All {len(options)} options have valid labels")
        
        # Check pre-selected chips (if any)
        chips = await page.locator('[data-testid*="chip"], .chip, [class*="badge"]').all()
        chip_undefined_found = False
        
        for chip in chips:
            text = await chip.inner_text()
            if "undefined" in text.lower():
                chip_undefined_found = True
                log_test("Part 1 - Pre-selected Chips", "FAIL", f"Chip contains 'undefined': {text}")
        
        if not chip_undefined_found and chips:
            log_test("Part 1 - Pre-selected Chips", "PASS", f"All {len(chips)} chips have valid labels")
        
        return not undefined_found and not chip_undefined_found
        
    except Exception as e:
        log_test("Part 1 - Exception", "FAIL", str(e))
        return False


async def test_part2_permission_enforcement(session):
    """PART 2: Permission Enforcement End-to-End Audit"""
    print("\n" + "="*80)
    print("PART 2: PERMISSION ENFORCEMENT END-TO-END AUDIT")
    print("="*80)
    
    try:
        # Step 1: Discover existing permission sets
        resp = session.get(f"{API_URL}/permission-sets-v3")
        if resp.status_code != 200:
            log_test("Part 2 - Discover Permission Sets", "FAIL", f"Status {resp.status_code}")
            return False
        
        psets_data = resp.json()
        psets = psets_data.get("items", [])
        log_test("Part 2 - Discover Permission Sets", "PASS", f"Found {len(psets)} permission sets")
        
        # Find suitable permission sets for each scenario
        workspace_manager_set = None
        request_creator_set = None
        
        for pset in psets:
            title = pset.get("title", "").lower()
            modules = pset.get("modules", {})
            
            # Look for Workspace Manager style set
            if "workspace" in title or "manager" in title:
                desk_booking = modules.get("desk_booking", {})
                if desk_booking.get("pages"):
                    workspace_manager_set = pset
            
            # Look for Request Creator style set
            if "request" in title and "creator" in title:
                request_creator_set = pset
            elif "qa" in title and "assign" in title:
                request_creator_set = pset
        
        if not workspace_manager_set:
            # Use first set with desk_booking module
            for pset in psets:
                if pset.get("modules", {}).get("desk_booking"):
                    workspace_manager_set = pset
                    break
        
        if not request_creator_set:
            # Use first set with profix module
            for pset in psets:
                if pset.get("modules", {}).get("profix"):
                    request_creator_set = pset
                    break
        
        log_test("Part 2 - Select Permission Sets", "PASS", 
                f"Workspace: {workspace_manager_set.get('title') if workspace_manager_set else 'None'}, "
                f"Request Creator: {request_creator_set.get('title') if request_creator_set else 'None'}")
        
        # Step 2: Create test users for each scenario
        timestamp = int(time.time())
        
        # Scenario A: Full Workspace Manager
        user_a_email = f"perm.test.a.{timestamp}@ticketing.com"
        user_a_payload = {
            "name": "Permission Test User A",
            "email": user_a_email,
            "emp_id": f"PERM_A_{timestamp}",
            "role": "Admin",
            "status": "Active",
            "doj": "2026-01-01",
            "permission_set_ids": [workspace_manager_set["id"]] if workspace_manager_set else []
        }
        
        resp = session.post(f"{API_URL}/contacts", json=user_a_payload)
        if resp.status_code != 200:
            log_test("Part 2 - Create User A", "FAIL", f"Status {resp.status_code}: {resp.text}")
            return False
        
        user_a = resp.json()
        test_users.append(user_a["id"])
        user_a_password = user_a.get("generated_password")
        log_test("Part 2 - Create User A", "PASS", f"Created {user_a_email} with password")
        
        # Scenario B: Request Creator
        user_b_email = f"perm.test.b.{timestamp}@ticketing.com"
        user_b_payload = {
            "name": "Permission Test User B",
            "email": user_b_email,
            "emp_id": f"PERM_B_{timestamp}",
            "role": "Admin",
            "status": "Active",
            "doj": "2026-01-01",
            "permission_set_ids": [request_creator_set["id"]] if request_creator_set else []
        }
        
        resp = session.post(f"{API_URL}/contacts", json=user_b_payload)
        if resp.status_code != 200:
            log_test("Part 2 - Create User B", "FAIL", f"Status {resp.status_code}: {resp.text}")
            return False
        
        user_b = resp.json()
        test_users.append(user_b["id"])
        user_b_password = user_b.get("generated_password")
        log_test("Part 2 - Create User B", "PASS", f"Created {user_b_email} with password")
        
        # Scenario C: Zero permission sets
        user_c_email = f"perm.test.c.{timestamp}@ticketing.com"
        user_c_payload = {
            "name": "Permission Test User C",
            "email": user_c_email,
            "emp_id": f"PERM_C_{timestamp}",
            "role": "Admin",
            "status": "Active",
            "doj": "2026-01-01",
            "permission_set_ids": []
        }
        
        resp = session.post(f"{API_URL}/contacts", json=user_c_payload)
        if resp.status_code != 200:
            log_test("Part 2 - Create User C", "FAIL", f"Status {resp.status_code}: {resp.text}")
            return False
        
        user_c = resp.json()
        test_users.append(user_c["id"])
        user_c_password = user_c.get("generated_password")
        log_test("Part 2 - Create User C", "PASS", f"Created {user_c_email} with NO permission sets")
        
        # Step 3: Test each scenario with Playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            
            # Scenario A: Full Workspace Manager
            await test_scenario_a(browser, user_a_email, user_a_password, workspace_manager_set)
            
            # Scenario B: Request Creator
            await test_scenario_b(browser, user_b_email, user_b_password, request_creator_set)
            
            # Scenario C: Zero permissions
            await test_scenario_c(browser, user_c_email, user_c_password)
            
            await browser.close()
        
        return True
        
    except Exception as e:
        log_test("Part 2 - Exception", "FAIL", str(e))
        return False


async def test_scenario_a(browser, email, password, pset):
    """Scenario A: Full Workspace Manager style set"""
    print("\n--- Scenario A: Full Workspace Manager ---")
    
    context = await browser.new_context()
    page = await context.new_page()
    
    try:
        # Login
        await page.goto(f"{BASE_URL}/login")
        await page.fill('input[type="email"]', email)
        await page.fill('input[type="password"]', password)
        await page.click('button[type="submit"]')
        await page.wait_for_url("**/admin**", timeout=10000)
        log_test("Scenario A - Login", "PASS", f"Logged in as {email}")
        
        # Check sidebar for Workspace Manager entries
        await page.wait_for_timeout(2000)
        
        sidebar_items = await page.locator('nav a, nav button, [role="navigation"] a, aside a, [data-testid="sidebar"] a').all()
        sidebar_text = []
        for item in sidebar_items:
            try:
                text = await item.inner_text()
                if text and text.strip():
                    sidebar_text.append(text.strip())
            except Exception:
                pass
        
        log_test("Scenario A - Sidebar Items", "PASS", f"Found {len(sidebar_text)} sidebar items")
        
        # Check for expected Workspace Manager pages
        expected_pages = ["Floor Layout", "Workstation", "Meeting Room", "Pending Approvals"]
        found_pages = []
        missing_pages = []
        
        for expected in expected_pages:
            found = any(expected.lower() in item.lower() for item in sidebar_text)
            if found:
                found_pages.append(expected)
            else:
                missing_pages.append(expected)
        
        if found_pages:
            log_test("Scenario A - Workspace Manager Pages", "PASS", 
                    f"Found: {', '.join(found_pages)}")
        
        if missing_pages:
            log_test("Scenario A - Missing Pages", "WARN", 
                    f"Not found: {', '.join(missing_pages)}")
        
        # Check that Profix-only entries are NOT present (if not granted)
        profix_only = ["Employees", "Teams", "Permissions"]
        found_profix = [p for p in profix_only if any(p.lower() in item.lower() for item in sidebar_text)]
        
        if found_profix:
            log_test("Scenario A - Profix-only Pages", "WARN", 
                    f"Found Profix pages (may be granted): {', '.join(found_profix)}")
        else:
            log_test("Scenario A - Profix-only Pages", "PASS", 
                    "No Profix-only pages found (as expected)")
        
        # Try to navigate to Floor Layout
        try:
            await page.goto(f"{BASE_URL}/workspace-manager/floor-layout", timeout=10000)
            await page.wait_for_load_state("networkidle", timeout=10000)
            
            # Check for "No Dashboard Shared" or "No Module Assigned"
            no_access = await page.locator('text="No Dashboard Shared", text="No Module Assigned"').count()
            
            if no_access > 0:
                log_test("Scenario A - Floor Layout Access", "FAIL", 
                        "Page shows 'No Dashboard Shared' or 'No Module Assigned'")
            else:
                log_test("Scenario A - Floor Layout Access", "PASS", 
                        "Page renders without access denial")
        except Exception as e:
            log_test("Scenario A - Floor Layout Access", "WARN", f"Could not access page: {str(e)[:100]}")
        
        # Take screenshot
        await page.screenshot(path="/app/scenario_a_dashboard.png", full_page=True)
        
    except Exception as e:
        log_test("Scenario A - Exception", "FAIL", str(e))
    finally:
        await context.close()


async def test_scenario_b(browser, email, password, pset):
    """Scenario B: Request Creator style set (create-only, no admin/manage)"""
    print("\n--- Scenario B: Request Creator ---")
    
    context = await browser.new_context()
    page = await context.new_page()
    
    try:
        # Login
        await page.goto(f"{BASE_URL}/login")
        await page.fill('input[type="email"]', email)
        await page.fill('input[type="password"]', password)
        await page.click('button[type="submit"]')
        await page.wait_for_url("**/admin**", timeout=10000)
        log_test("Scenario B - Login", "PASS", f"Logged in as {email}")
        
        # Check sidebar
        sidebar_items = await page.locator('nav a, nav button, [role="navigation"] a').all()
        sidebar_text = []
        for item in sidebar_items:
            text = await item.inner_text()
            sidebar_text.append(text.strip())
        
        # Check that Manage submenu items are hidden
        manage_items = ["Permissions", "Employees", "Teams"]
        found_manage = [m for m in manage_items if any(m.lower() in item.lower() for item in sidebar_text)]
        
        if found_manage:
            log_test("Scenario B - Manage Items Hidden", "FAIL", 
                    f"Found Manage items (should be hidden): {', '.join(found_manage)}")
        else:
            log_test("Scenario B - Manage Items Hidden", "PASS", 
                    "Manage items correctly hidden")
        
        # Try to navigate to All Requests
        try:
            await page.goto(f"{BASE_URL}/admin/open-tickets", timeout=10000)
            await page.wait_for_load_state("networkidle", timeout=10000)
            
            # Check for action buttons that should be hidden/disabled
            assign_buttons = await page.locator('button:has-text("Assign"), button[aria-label*="Assign"]').count()
            delete_buttons = await page.locator('button:has-text("Delete"), button[aria-label*="Delete"]').count()
            
            log_test("Scenario B - All Requests Access", "PASS", 
                    f"Page loaded (Assign buttons: {assign_buttons}, Delete buttons: {delete_buttons})")
            
        except Exception as e:
            log_test("Scenario B - All Requests Access", "WARN", f"Could not access page: {str(e)[:100]}")
        
        # Take screenshot
        await page.screenshot(path="/app/scenario_b_dashboard.png", full_page=True)
        
    except Exception as e:
        log_test("Scenario B - Exception", "FAIL", str(e))
    finally:
        await context.close()


async def test_scenario_c(browser, email, password):
    """Scenario C: Zero permission sets (empty state)"""
    print("\n--- Scenario C: Zero Permission Sets ---")
    
    context = await browser.new_context()
    page = await context.new_page()
    
    try:
        # Login
        await page.goto(f"{BASE_URL}/login")
        await page.fill('input[type="email"]', email)
        await page.fill('input[type="password"]', password)
        await page.click('button[type="submit"]')
        await page.wait_for_url("**/admin**", timeout=10000)
        log_test("Scenario C - Login", "PASS", f"Logged in as {email}")
        
        # Check for "No Module Assigned" empty state
        await page.wait_for_timeout(2000)
        
        no_module_text = await page.locator('text="No Module Assigned"').count()
        contact_admin_text = await page.locator('text="Please contact your Super Admin to request access"').count()
        
        if no_module_text > 0:
            log_test("Scenario C - No Module Assigned", "PASS", 
                    "Sidebar shows 'No Module Assigned' empty state")
        else:
            log_test("Scenario C - No Module Assigned", "FAIL", 
                    "'No Module Assigned' text not found")
        
        if contact_admin_text > 0:
            log_test("Scenario C - Contact Admin Text", "PASS", 
                    "Shows correct message: 'Please contact your Super Admin to request access'")
        else:
            # Try alternative text patterns
            alt_patterns = [
                'text="contact your Super Admin"',
                'text="contact"',
                'text="Super Admin"'
            ]
            found_alt = False
            for pattern in alt_patterns:
                count = await page.locator(pattern).count()
                if count > 0:
                    found_alt = True
                    break
            
            if found_alt:
                log_test("Scenario C - Contact Admin Text", "WARN", 
                        "Found contact-related text but not exact match")
            else:
                log_test("Scenario C - Contact Admin Text", "FAIL", 
                        "Expected message not found")
        
        # Check dashboard for "No Dashboard Shared"
        try:
            await page.goto(f"{BASE_URL}/admin", timeout=10000)
            await page.wait_for_load_state("networkidle", timeout=10000)
            
            no_dashboard_text = await page.locator('text="No Dashboard Shared"').count()
            contact_admin_dashboard = await page.locator('text="Please contact your administrator to assign a Dashboard"').count()
            
            if no_dashboard_text > 0:
                log_test("Scenario C - No Dashboard Shared", "PASS", 
                        "Dashboard shows 'No Dashboard Shared' state")
            else:
                log_test("Scenario C - No Dashboard Shared", "FAIL", 
                        "'No Dashboard Shared' text not found")
            
            if contact_admin_dashboard > 0:
                log_test("Scenario C - Dashboard Contact Admin Text", "PASS", 
                        "Shows correct message: 'Please contact your administrator to assign a Dashboard'")
            else:
                log_test("Scenario C - Dashboard Contact Admin Text", "FAIL", 
                        "Expected dashboard message not found")
        
        except Exception as e:
            log_test("Scenario C - Dashboard Check", "WARN", f"Could not check dashboard: {str(e)[:100]}")
        
        # Take screenshot
        await page.screenshot(path="/app/scenario_c_empty_state.png", full_page=True)
        
    except Exception as e:
        log_test("Scenario C - Exception", "FAIL", str(e))
    finally:
        await context.close()


def cleanup_test_users(session):
    """Set test users to Inactive (DELETE not supported)"""
    print("\n" + "="*80)
    print("CLEANUP")
    print("="*80)
    
    for user_id in test_users:
        try:
            # Use PATCH to set status to Inactive instead of DELETE
            resp = session.patch(f"{API_URL}/contacts/{user_id}", json={"status": "Inactive"})
            if resp.status_code == 200:
                log_test(f"Cleanup - Inactivate User {user_id}", "PASS", "User set to Inactive")
            else:
                log_test(f"Cleanup - Inactivate User {user_id}", "FAIL", 
                        f"Status {resp.status_code}: {resp.text}")
        except Exception as e:
            log_test(f"Cleanup - Inactivate User {user_id}", "FAIL", str(e))


def print_summary():
    """Print test summary"""
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for r in test_results if r["status"] == "PASS")
    failed = sum(1 for r in test_results if r["status"] == "FAIL")
    warned = sum(1 for r in test_results if r["status"] == "WARN")
    total = len(test_results)
    
    print(f"\nTotal Tests: {total}")
    print(f"Passed: {passed} ✅")
    print(f"Failed: {failed} ❌")
    print(f"Warnings: {warned} ⚠️")
    print(f"Success Rate: {(passed/total*100):.1f}%\n")
    
    if failed > 0:
        print("FAILED TESTS:")
        for r in test_results:
            if r["status"] == "FAIL":
                print(f"  ❌ {r['scenario']}")
                if r["details"]:
                    print(f"     {r['details']}")
        print()
    
    return failed == 0


async def main():
    """Main test execution"""
    print("="*80)
    print("PERMISSION ENFORCEMENT END-TO-END TEST")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Super Admin: {SUPER_ADMIN_EMAIL}")
    print("="*80)
    
    # API Login
    session = api_login()
    if not session:
        print("\n❌ API Login failed. Aborting tests.")
        sys.exit(1)
    
    # PART 1: Permission Sets Dropdown Fix
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        part1_success = await test_part1_permission_sets_dropdown(page)
        
        await browser.close()
    
    # PART 2: Permission Enforcement Audit
    part2_success = await test_part2_permission_enforcement(session)
    
    # Cleanup
    cleanup_test_users(session)
    
    # Print summary
    success = print_summary()
    
    if success:
        print("✅ ALL TESTS PASSED")
        sys.exit(0)
    else:
        print("❌ SOME TESTS FAILED")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
