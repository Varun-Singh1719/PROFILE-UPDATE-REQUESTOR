#!/usr/bin/env python3
"""
Backend API Testing for CRM Features
- Feature 1: Client Key Account Manager (key_account_manager_ids + resolved key_account_managers)
- Feature 2: Client Contact Type field + conditional Industry requirement
"""
import requests
import json
import sys
from typing import Optional, List, Dict, Any

# Backend URL from frontend/.env
BASE_URL = "https://contact-format-sync.preview.emergentagent.com/api"

# Test credentials
ADMIN_EMAIL = "admin@ticketing.com"
ADMIN_PASSWORD = "Admin@123"

# Global token storage
AUTH_TOKEN: Optional[str] = None

# Test tracking
TESTS_RUN = 0
TESTS_PASSED = 0
TESTS_FAILED = 0
CREATED_CLIENTS = []
CREATED_CONTACTS = []


def log(msg: str, level: str = "INFO"):
    """Log test messages"""
    prefix = {
        "INFO": "ℹ️ ",
        "PASS": "✅",
        "FAIL": "❌",
        "WARN": "⚠️ ",
    }.get(level, "  ")
    print(f"{prefix} {msg}")


def track_test(name: str, passed: bool, details: str = ""):
    """Track test results"""
    global TESTS_RUN, TESTS_PASSED, TESTS_FAILED
    TESTS_RUN += 1
    if passed:
        TESTS_PASSED += 1
        log(f"PASS: {name}", "PASS")
        if details:
            log(f"  Details: {details}", "INFO")
    else:
        TESTS_FAILED += 1
        log(f"FAIL: {name}", "FAIL")
        if details:
            log(f"  Details: {details}", "FAIL")


def login() -> bool:
    """Authenticate and get Bearer token"""
    global AUTH_TOKEN
    log("Authenticating as admin@ticketing.com...")
    try:
        resp = requests.post(
            f"{BASE_URL}/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            AUTH_TOKEN = data.get("access_token")
            if AUTH_TOKEN:
                log("Authentication successful", "PASS")
                return True
        log(f"Authentication failed: {resp.status_code} {resp.text}", "FAIL")
        return False
    except Exception as e:
        log(f"Authentication error: {e}", "FAIL")
        return False


def headers() -> dict:
    """Return auth headers"""
    return {"Authorization": f"Bearer {AUTH_TOKEN}"}


def cleanup():
    """Delete all created test resources"""
    log("\n=== CLEANUP ===")
    for client_id in CREATED_CLIENTS:
        try:
            resp = requests.delete(f"{BASE_URL}/clients/{client_id}", headers=headers(), timeout=10)
            if resp.status_code == 200:
                log(f"Deleted client {client_id}", "INFO")
        except Exception as e:
            log(f"Failed to delete client {client_id}: {e}", "WARN")
    
    for contact_id in CREATED_CONTACTS:
        try:
            resp = requests.delete(f"{BASE_URL}/client-contacts/{contact_id}", headers=headers(), timeout=10)
            if resp.status_code == 200:
                log(f"Deleted contact {contact_id}", "INFO")
        except Exception as e:
            log(f"Failed to delete contact {contact_id}: {e}", "WARN")


# ============================================================================
# FEATURE 1: Client Key Account Manager Tests
# ============================================================================

def test_feature1_get_employees():
    """Get employee list to use real employee IDs"""
    log("\n=== FEATURE 1: Client Key Account Manager ===")
    log("Test 1.0: GET /api/contacts to fetch real employee IDs")
    try:
        resp = requests.get(f"{BASE_URL}/contacts?page=1&page_size=10", headers=headers(), timeout=10)
        if resp.status_code != 200:
            track_test("1.0 - Get employees", False, f"HTTP {resp.status_code}: {resp.text}")
            return []
        
        data = resp.json()
        # API returns "items" not "rows"
        employees = data.get("items", [])
        active_employees = [e for e in employees if e.get("status") == "Active"]
        
        if len(active_employees) < 2:
            track_test("1.0 - Get employees", False, f"Need at least 2 active employees, found {len(active_employees)}")
            return []
        
        track_test("1.0 - Get employees", True, f"Found {len(active_employees)} active employees")
        return active_employees[:3]  # Return first 3 for testing
    except Exception as e:
        track_test("1.0 - Get employees", False, str(e))
        return []


def test_feature1_create_with_kams(employee_ids: List[str]):
    """Test 1.1: POST /api/clients with key_account_manager_ids"""
    log("\nTest 1.1: POST /api/clients with key_account_manager_ids")
    try:
        payload = {
            "name": f"Test Client KAM {TESTS_RUN}",
            "type": "Venture Capital/Private Equity",
            "key_account_manager_ids": employee_ids[:2]  # Use first 2 employees
        }
        resp = requests.post(f"{BASE_URL}/clients", json=payload, headers=headers(), timeout=10)
        
        if resp.status_code != 200:
            track_test("1.1 - Create client with KAMs", False, f"HTTP {resp.status_code}: {resp.text}")
            return None
        
        data = resp.json()
        client_id = data.get("id")
        CREATED_CLIENTS.append(client_id)
        
        # Verify response includes both key_account_manager_ids and key_account_managers
        kam_ids = data.get("key_account_manager_ids", [])
        kam_resolved = data.get("key_account_managers", [])
        
        checks = []
        checks.append(("key_account_manager_ids present", kam_ids is not None))
        checks.append(("key_account_manager_ids matches input", kam_ids == employee_ids[:2]))
        checks.append(("key_account_managers present", kam_resolved is not None))
        checks.append(("key_account_managers is array", isinstance(kam_resolved, list)))
        checks.append(("key_account_managers length matches", len(kam_resolved) == len(employee_ids[:2])))
        
        # Check order preservation
        if len(kam_resolved) == len(employee_ids[:2]):
            for i, emp_id in enumerate(employee_ids[:2]):
                if i < len(kam_resolved):
                    checks.append((f"KAM {i} id matches", kam_resolved[i].get("id") == emp_id))
                    checks.append((f"KAM {i} has name", bool(kam_resolved[i].get("name"))))
                    checks.append((f"KAM {i} has emp_id", kam_resolved[i].get("emp_id") is not None))
        
        all_passed = all(check[1] for check in checks)
        details = "; ".join([f"{check[0]}: {check[1]}" for check in checks])
        
        track_test("1.1 - Create client with KAMs", all_passed, details)
        return client_id
    except Exception as e:
        track_test("1.1 - Create client with KAMs", False, str(e))
        return None


def test_feature1_get_list(client_id: str):
    """Test 1.2: GET /api/clients (list) includes key_account_manager_ids and key_account_managers"""
    log("\nTest 1.2: GET /api/clients (list)")
    try:
        resp = requests.get(f"{BASE_URL}/clients", headers=headers(), timeout=10)
        
        if resp.status_code != 200:
            track_test("1.2 - GET clients list", False, f"HTTP {resp.status_code}: {resp.text}")
            return
        
        data = resp.json()
        rows = data.get("rows", [])
        
        # Find our created client
        client = next((c for c in rows if c.get("id") == client_id), None)
        
        if not client:
            track_test("1.2 - GET clients list", False, "Created client not found in list")
            return
        
        checks = []
        checks.append(("key_account_manager_ids present", "key_account_manager_ids" in client))
        checks.append(("key_account_managers present", "key_account_managers" in client))
        checks.append(("key_account_managers is array", isinstance(client.get("key_account_managers", []), list)))
        
        all_passed = all(check[1] for check in checks)
        details = "; ".join([f"{check[0]}: {check[1]}" for check in checks])
        
        track_test("1.2 - GET clients list", all_passed, details)
    except Exception as e:
        track_test("1.2 - GET clients list", False, str(e))


def test_feature1_get_detail(client_id: str):
    """Test 1.3: GET /api/clients/{id} includes both fields"""
    log("\nTest 1.3: GET /api/clients/{id} (detail)")
    try:
        resp = requests.get(f"{BASE_URL}/clients/{client_id}", headers=headers(), timeout=10)
        
        if resp.status_code != 200:
            track_test("1.3 - GET client detail", False, f"HTTP {resp.status_code}: {resp.text}")
            return
        
        data = resp.json()
        
        checks = []
        checks.append(("key_account_manager_ids present", "key_account_manager_ids" in data))
        checks.append(("key_account_managers present", "key_account_managers" in data))
        checks.append(("key_account_managers is array", isinstance(data.get("key_account_managers", []), list)))
        
        all_passed = all(check[1] for check in checks)
        details = "; ".join([f"{check[0]}: {check[1]}" for check in checks])
        
        track_test("1.3 - GET client detail", all_passed, details)
    except Exception as e:
        track_test("1.3 - GET client detail", False, str(e))


def test_feature1_patch_kams(client_id: str, new_employee_ids: List[str]):
    """Test 1.4: PATCH /api/clients/{id} with changed key_account_manager_ids"""
    log("\nTest 1.4: PATCH /api/clients/{id} with changed key_account_manager_ids")
    try:
        # Test with empty list first
        payload = {"key_account_manager_ids": []}
        resp = requests.patch(f"{BASE_URL}/clients/{client_id}", json=payload, headers=headers(), timeout=10)
        
        if resp.status_code != 200:
            track_test("1.4 - PATCH client KAMs (empty)", False, f"HTTP {resp.status_code}: {resp.text}")
            return
        
        data = resp.json()
        checks = []
        checks.append(("Empty KAM IDs accepted", data.get("key_account_manager_ids") == []))
        checks.append(("Empty KAM resolved to []", data.get("key_account_managers") == []))
        
        # Now test with a different employee
        if len(new_employee_ids) > 2:
            payload = {"key_account_manager_ids": [new_employee_ids[2]]}
            resp = requests.patch(f"{BASE_URL}/clients/{client_id}", json=payload, headers=headers(), timeout=10)
            
            if resp.status_code != 200:
                track_test("1.4 - PATCH client KAMs (change)", False, f"HTTP {resp.status_code}: {resp.text}")
                return
            
            data = resp.json()
            checks.append(("Changed KAM IDs accepted", data.get("key_account_manager_ids") == [new_employee_ids[2]]))
            checks.append(("Changed KAM resolved", len(data.get("key_account_managers", [])) == 1))
            if len(data.get("key_account_managers", [])) == 1:
                checks.append(("Resolved KAM has correct id", data["key_account_managers"][0].get("id") == new_employee_ids[2]))
        
        all_passed = all(check[1] for check in checks)
        details = "; ".join([f"{check[0]}: {check[1]}" for check in checks])
        
        track_test("1.4 - PATCH client KAMs", all_passed, details)
    except Exception as e:
        track_test("1.4 - PATCH client KAMs", False, str(e))


def test_feature1_create_without_kams():
    """Test 1.5: POST /api/clients without key_account_manager_ids defaults to []"""
    log("\nTest 1.5: POST /api/clients without key_account_manager_ids")
    try:
        payload = {
            "name": f"Test Client No KAM {TESTS_RUN}",
            "type": "Hedge funds/Public Markets"
        }
        resp = requests.post(f"{BASE_URL}/clients", json=payload, headers=headers(), timeout=10)
        
        if resp.status_code != 200:
            track_test("1.5 - Create client without KAMs", False, f"HTTP {resp.status_code}: {resp.text}")
            return
        
        data = resp.json()
        CREATED_CLIENTS.append(data.get("id"))
        
        checks = []
        checks.append(("key_account_manager_ids defaults to []", data.get("key_account_manager_ids") == []))
        checks.append(("key_account_managers defaults to []", data.get("key_account_managers") == []))
        
        all_passed = all(check[1] for check in checks)
        details = "; ".join([f"{check[0]}: {check[1]}" for check in checks])
        
        track_test("1.5 - Create client without KAMs", all_passed, details)
    except Exception as e:
        track_test("1.5 - Create client without KAMs", False, str(e))


# ============================================================================
# FEATURE 2: Client Contact Type + Conditional Industry Tests
# ============================================================================

def test_feature2_get_countries():
    """Get a country ID for testing - using hardcoded value since country_id is just stored, not validated"""
    log("\n=== FEATURE 2: Client Contact Type + Conditional Industry ===")
    log("Test 2.0: Using country_id=1 (field is stored but not validated)")
    # country_id is just an integer field that's stored but not validated against any country list
    track_test("2.0 - Get country ID", True, "Using country_id=1")
    return 1


def test_feature2_create_domain_agnostic(country_id: int):
    """Test 2.1: POST /api/client-contacts with type='Domain Agnostic' (no industries required)"""
    log("\nTest 2.1: POST /api/client-contacts with type='Domain Agnostic'")
    try:
        payload = {
            "name": f"Test Contact Agnostic {TESTS_RUN}",
            "designation": "VP Sales",
            "email": f"test.agnostic.{TESTS_RUN}@example.com",
            "phone": f"555010{TESTS_RUN:04d}",
            "client_name": "Test Client Corp",
            "country_id": country_id,
            "type": "Domain Agnostic"
        }
        resp = requests.post(f"{BASE_URL}/client-contacts", json=payload, headers=headers(), timeout=10)
        
        if resp.status_code != 200:
            track_test("2.1 - Create Domain Agnostic contact", False, f"HTTP {resp.status_code}: {resp.text}")
            return None
        
        data = resp.json()
        contact_id = data.get("id")
        CREATED_CONTACTS.append(contact_id)
        
        checks = []
        checks.append(("Contact created", contact_id is not None))
        checks.append(("Type persisted", data.get("type") == "Domain Agnostic"))
        
        all_passed = all(check[1] for check in checks)
        details = "; ".join([f"{check[0]}: {check[1]}" for check in checks])
        
        track_test("2.1 - Create Domain Agnostic contact", all_passed, details)
        return contact_id
    except Exception as e:
        track_test("2.1 - Create Domain Agnostic contact", False, str(e))
        return None


def test_feature2_create_domain_specific_no_industry(country_id: int):
    """Test 2.2: POST /api/client-contacts with type='Domain Specific' and NO industries (must FAIL 400)"""
    log("\nTest 2.2: POST /api/client-contacts with type='Domain Specific' and NO industries (expect 400)")
    try:
        payload = {
            "name": f"Test Contact Specific No Industry {TESTS_RUN}",
            "designation": "Director",
            "email": f"test.specific.noindustry.{TESTS_RUN}@example.com",
            "phone": f"555020{TESTS_RUN:04d}",
            "client_name": "Test Client Corp",
            "country_id": country_id,
            "type": "Domain Specific"
            # NO industries field
        }
        resp = requests.post(f"{BASE_URL}/client-contacts", json=payload, headers=headers(), timeout=10)
        
        # Should fail with 400
        if resp.status_code == 400:
            error_msg = resp.text.lower()
            industry_mentioned = "industry" in error_msg
            track_test("2.2 - Domain Specific without industries fails 400", True, 
                      f"Correctly rejected with 400. Error mentions industry: {industry_mentioned}")
        else:
            track_test("2.2 - Domain Specific without industries fails 400", False, 
                      f"Expected 400, got {resp.status_code}: {resp.text}")
    except Exception as e:
        track_test("2.2 - Domain Specific without industries fails 400", False, str(e))


def test_feature2_create_domain_specific_with_industry(country_id: int):
    """Test 2.3: POST /api/client-contacts with type='Domain Specific' WITH industries (must succeed)"""
    log("\nTest 2.3: POST /api/client-contacts with type='Domain Specific' WITH industries")
    try:
        payload = {
            "name": f"Test Contact Specific With Industry {TESTS_RUN}",
            "designation": "Manager",
            "email": f"test.specific.withindustry.{TESTS_RUN}@example.com",
            "phone": f"555030{TESTS_RUN:04d}",
            "client_name": "Test Client Corp",
            "country_id": country_id,
            "type": "Domain Specific",
            "industries": ["Technology", "Finance"]
        }
        resp = requests.post(f"{BASE_URL}/client-contacts", json=payload, headers=headers(), timeout=10)
        
        if resp.status_code != 200:
            track_test("2.3 - Create Domain Specific with industries", False, f"HTTP {resp.status_code}: {resp.text}")
            return None
        
        data = resp.json()
        contact_id = data.get("id")
        CREATED_CONTACTS.append(contact_id)
        
        checks = []
        checks.append(("Contact created", contact_id is not None))
        checks.append(("Type persisted", data.get("type") == "Domain Specific"))
        checks.append(("Industries persisted", data.get("industries") == ["Technology", "Finance"]))
        
        all_passed = all(check[1] for check in checks)
        details = "; ".join([f"{check[0]}: {check[1]}" for check in checks])
        
        track_test("2.3 - Create Domain Specific with industries", all_passed, details)
        return contact_id
    except Exception as e:
        track_test("2.3 - Create Domain Specific with industries", False, str(e))
        return None


def test_feature2_create_invalid_type(country_id: int):
    """Test 2.4: POST /api/client-contacts with invalid type (must fail 422)"""
    log("\nTest 2.4: POST /api/client-contacts with invalid type='Foo' (expect 422)")
    try:
        payload = {
            "name": f"Test Contact Invalid Type {TESTS_RUN}",
            "designation": "CEO",
            "email": f"test.invalid.{TESTS_RUN}@example.com",
            "phone": f"555040{TESTS_RUN:04d}",
            "client_name": "Test Client Corp",
            "country_id": country_id,
            "type": "Foo"
        }
        resp = requests.post(f"{BASE_URL}/client-contacts", json=payload, headers=headers(), timeout=10)
        
        # Should fail with 422 (validation error)
        if resp.status_code == 422:
            track_test("2.4 - Invalid type fails 422", True, "Correctly rejected with 422")
        else:
            track_test("2.4 - Invalid type fails 422", False, 
                      f"Expected 422, got {resp.status_code}: {resp.text}")
    except Exception as e:
        track_test("2.4 - Invalid type fails 422", False, str(e))


def test_feature2_patch_domain_specific_no_industries(contact_id: str):
    """Test 2.5: PATCH contact to type='Domain Specific' with NO industries stored (must fail 400)"""
    log("\nTest 2.5: PATCH contact to type='Domain Specific' with NO industries (expect 400)")
    try:
        # First, get the contact to check if it has industries
        resp = requests.get(f"{BASE_URL}/client-contacts/{contact_id}", headers=headers(), timeout=10)
        if resp.status_code != 200:
            track_test("2.5 - PATCH Domain Specific without industries", False, "Failed to get contact")
            return
        
        contact = resp.json()
        current_industries = contact.get("industries", [])
        
        # If contact already has industries, clear them first
        if current_industries:
            clear_payload = {"industries": []}
            resp = requests.patch(f"{BASE_URL}/client-contacts/{contact_id}", json=clear_payload, headers=headers(), timeout=10)
            if resp.status_code != 200:
                track_test("2.5 - PATCH Domain Specific without industries", False, "Failed to clear industries")
                return
        
        # Now try to set type to Domain Specific without industries
        payload = {"type": "Domain Specific"}
        resp = requests.patch(f"{BASE_URL}/client-contacts/{contact_id}", json=payload, headers=headers(), timeout=10)
        
        # Should fail with 400
        if resp.status_code == 400:
            error_msg = resp.text.lower()
            industry_mentioned = "industry" in error_msg
            track_test("2.5 - PATCH Domain Specific without industries fails 400", True, 
                      f"Correctly rejected with 400. Error mentions industry: {industry_mentioned}")
        else:
            track_test("2.5 - PATCH Domain Specific without industries fails 400", False, 
                      f"Expected 400, got {resp.status_code}: {resp.text}")
    except Exception as e:
        track_test("2.5 - PATCH Domain Specific without industries fails 400", False, str(e))


def test_feature2_patch_domain_specific_with_industries(contact_id: str):
    """Test 2.5b: PATCH contact to type='Domain Specific' when industries already stored (must succeed)"""
    log("\nTest 2.5b: PATCH contact to type='Domain Specific' with industries already stored")
    try:
        # First, ensure contact has industries
        set_industries_payload = {"industries": ["Healthcare", "Retail"]}
        resp = requests.patch(f"{BASE_URL}/client-contacts/{contact_id}", json=set_industries_payload, headers=headers(), timeout=10)
        if resp.status_code != 200:
            track_test("2.5b - PATCH Domain Specific with stored industries", False, "Failed to set industries")
            return
        
        # Now set type to Domain Specific (without sending industries in patch)
        payload = {"type": "Domain Specific"}
        resp = requests.patch(f"{BASE_URL}/client-contacts/{contact_id}", json=payload, headers=headers(), timeout=10)
        
        if resp.status_code != 200:
            track_test("2.5b - PATCH Domain Specific with stored industries", False, 
                      f"HTTP {resp.status_code}: {resp.text}")
            return
        
        data = resp.json()
        checks = []
        checks.append(("Type updated", data.get("type") == "Domain Specific"))
        checks.append(("Industries preserved", len(data.get("industries", [])) > 0))
        
        all_passed = all(check[1] for check in checks)
        details = "; ".join([f"{check[0]}: {check[1]}" for check in checks])
        
        track_test("2.5b - PATCH Domain Specific with stored industries", all_passed, details)
    except Exception as e:
        track_test("2.5b - PATCH Domain Specific with stored industries", False, str(e))


def test_feature2_get_list_includes_type():
    """Test 2.6: GET /api/client-contacts returns type field"""
    log("\nTest 2.6: GET /api/client-contacts (list) includes type field")
    try:
        resp = requests.get(f"{BASE_URL}/client-contacts", headers=headers(), timeout=10)
        
        if resp.status_code != 200:
            track_test("2.6 - GET contacts list includes type", False, f"HTTP {resp.status_code}: {resp.text}")
            return
        
        data = resp.json()
        rows = data.get("rows", [])
        
        if not rows:
            track_test("2.6 - GET contacts list includes type", False, "No contacts in list")
            return
        
        # Check if any of our created contacts are in the list
        our_contacts = [c for c in rows if c.get("id") in CREATED_CONTACTS]
        
        checks = []
        if our_contacts:
            for contact in our_contacts:
                checks.append((f"Contact {contact.get('name')} has type field", "type" in contact))
        else:
            # Just check that type field exists in general
            checks.append(("Type field present in contacts", any("type" in c for c in rows)))
        
        all_passed = all(check[1] for check in checks) if checks else True
        details = "; ".join([f"{check[0]}: {check[1]}" for check in checks]) if checks else "Type field available"
        
        track_test("2.6 - GET contacts list includes type", all_passed, details)
    except Exception as e:
        track_test("2.6 - GET contacts list includes type", False, str(e))


def test_feature2_get_detail_includes_type(contact_id: str):
    """Test 2.7: GET /api/client-contacts/{id} returns type field"""
    log("\nTest 2.7: GET /api/client-contacts/{id} (detail) includes type field")
    try:
        resp = requests.get(f"{BASE_URL}/client-contacts/{contact_id}", headers=headers(), timeout=10)
        
        if resp.status_code != 200:
            track_test("2.7 - GET contact detail includes type", False, f"HTTP {resp.status_code}: {resp.text}")
            return
        
        data = resp.json()
        
        checks = []
        checks.append(("Type field present", "type" in data))
        
        all_passed = all(check[1] for check in checks)
        details = "; ".join([f"{check[0]}: {check[1]}" for check in checks])
        
        track_test("2.7 - GET contact detail includes type", all_passed, details)
    except Exception as e:
        track_test("2.7 - GET contact detail includes type", False, str(e))


# ============================================================================
# Main Test Runner
# ============================================================================

def main():
    """Run all tests"""
    log("=" * 80)
    log("CRM Backend API Testing - Feature 1 & 2")
    log("=" * 80)
    
    # Authenticate
    if not login():
        log("Authentication failed. Exiting.", "FAIL")
        sys.exit(1)
    
    try:
        # FEATURE 1 Tests
        employees = test_feature1_get_employees()
        if len(employees) >= 2:
            employee_ids = [e.get("id") for e in employees]
            client_id = test_feature1_create_with_kams(employee_ids)
            if client_id:
                test_feature1_get_list(client_id)
                test_feature1_get_detail(client_id)
                test_feature1_patch_kams(client_id, employee_ids)
        test_feature1_create_without_kams()
        
        # FEATURE 2 Tests
        country_id = test_feature2_get_countries()
        if country_id:
            contact1 = test_feature2_create_domain_agnostic(country_id)
            test_feature2_create_domain_specific_no_industry(country_id)
            contact2 = test_feature2_create_domain_specific_with_industry(country_id)
            test_feature2_create_invalid_type(country_id)
            
            if contact1:
                test_feature2_patch_domain_specific_no_industries(contact1)
                test_feature2_patch_domain_specific_with_industries(contact1)
            
            test_feature2_get_list_includes_type()
            
            if contact2:
                test_feature2_get_detail_includes_type(contact2)
        
    finally:
        # Cleanup
        cleanup()
    
    # Summary
    log("\n" + "=" * 80)
    log("TEST SUMMARY")
    log("=" * 80)
    log(f"Total Tests: {TESTS_RUN}")
    log(f"Passed: {TESTS_PASSED}", "PASS")
    log(f"Failed: {TESTS_FAILED}", "FAIL" if TESTS_FAILED > 0 else "INFO")
    log("=" * 80)
    
    sys.exit(0 if TESTS_FAILED == 0 else 1)


if __name__ == "__main__":
    main()
