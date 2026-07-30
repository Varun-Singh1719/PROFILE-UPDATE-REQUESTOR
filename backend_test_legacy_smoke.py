#!/usr/bin/env python3
"""
Quick smoke check for legacy permission endpoints
"""

import requests
import sys

BASE_URL = "https://emp-status-toggle.preview.emergentagent.com/api"
SUPER_ADMIN_EMAIL = "admin@ticketing.com"
SUPER_ADMIN_PASSWORD = "Admin@123"

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

def main():
    print(f"\n{Colors.BOLD}{'='*80}{Colors.RESET}")
    print(f"{Colors.BOLD}Legacy Endpoints Smoke Check{Colors.RESET}")
    print(f"{Colors.BOLD}{'='*80}{Colors.RESET}")
    
    # Login
    resp = requests.post(f"{BASE_URL}/auth/login", json={
        "email": SUPER_ADMIN_EMAIL,
        "password": SUPER_ADMIN_PASSWORD
    }, timeout=30)
    
    if resp.status_code != 200:
        print_fail("Login failed")
        return False
    
    token = resp.json().get("access_token")
    headers = {"Authorization": f"Bearer {token}"}
    
    failures = []
    
    # Test legacy endpoints
    print_test("Legacy: GET /api/permissions/schema")
    try:
        resp = requests.get(f"{BASE_URL}/permissions/schema", headers=headers, timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            if "modules" in data and "actions" in data:
                print_pass("Schema endpoint works")
            else:
                print_fail("Schema response incomplete")
                failures.append("Schema incomplete")
        else:
            print_fail(f"Schema endpoint failed: {resp.status_code}")
            failures.append("Schema failed")
    except Exception as e:
        print_fail(f"Schema exception: {e}")
        failures.append(f"Schema exception: {e}")
    
    print_test("Legacy: GET /api/permissions/v2")
    try:
        resp = requests.get(f"{BASE_URL}/permissions/v2", headers=headers, timeout=30)
        if resp.status_code == 200:
            print_pass("v2 list endpoint works")
        else:
            print_fail(f"v2 list failed: {resp.status_code}")
            failures.append("v2 list failed")
    except Exception as e:
        print_fail(f"v2 list exception: {e}")
        failures.append(f"v2 list exception: {e}")
    
    print_test("Legacy: GET /api/permissions/presets")
    try:
        resp = requests.get(f"{BASE_URL}/permissions/presets", headers=headers, timeout=30)
        if resp.status_code == 200:
            presets = resp.json()
            print_pass(f"Presets endpoint works (count={len(presets)})")
        else:
            print_fail(f"Presets failed: {resp.status_code}")
            failures.append("Presets failed")
    except Exception as e:
        print_fail(f"Presets exception: {e}")
        failures.append(f"Presets exception: {e}")
    
    print_test("Legacy: GET /api/permissions/stats")
    try:
        resp = requests.get(f"{BASE_URL}/permissions/stats", headers=headers, timeout=30)
        if resp.status_code == 200:
            stats = resp.json()
            print_pass(f"Stats endpoint works: {stats}")
        else:
            print_fail(f"Stats failed: {resp.status_code}")
            failures.append("Stats failed")
    except Exception as e:
        print_fail(f"Stats exception: {e}")
        failures.append(f"Stats exception: {e}")
    
    # Summary
    print(f"\n{Colors.BOLD}{'='*80}{Colors.RESET}")
    print(f"{Colors.BOLD}Smoke Check Summary{Colors.RESET}")
    print(f"{Colors.BOLD}{'='*80}{Colors.RESET}")
    if failures:
        print(f"{Colors.RED}Failed: {len(failures)}{Colors.RESET}")
        for f in failures:
            print(f"{Colors.RED}- {f}{Colors.RESET}")
        return False
    else:
        print(f"{Colors.GREEN}All legacy endpoints working{Colors.RESET}")
        return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
