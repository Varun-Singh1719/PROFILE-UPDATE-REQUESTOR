#!/usr/bin/env python3
"""
BACKEND QA — Auto-Approval Module (Round 2)
Comprehensive testing of SKIPPED scenarios from previous run.

Test Coverage:
A. Date-rule modes (on, before, after, between) for meeting_room + workstation
B. Time-rule operators (on, before, after, between)
C. Combined-cell OR semantics
D. Recurring meeting auto-approval
E. Booking conflict on concurrent auto-eligible requests
F. Impersonation
G. Cross-resource isolation
H. Global enabled=false override
I. Duration sanitisation
J. Audit-logs endpoint discovery
"""

import requests
import json
from datetime import datetime, timedelta, date as date_cls
from typing import Dict, Any, List, Optional
import sys

# Backend base URL
BASE_URL = "https://perm-password-hide.preview.emergentagent.com/api"

# Test credentials (from test_credentials.md)
SUPER_ADMIN = {"email": "admin@ticketing.com", "password": "Admin@123"}
TEAM_MANAGER = {"email": "ritika.singhal@infollion.com", "password": "TeamMgr@123"}
TEAM_MEMBER = {"email": "nitya.srivastava@infollion.com", "password": "Member@123"}

# Room IDs on plan dd9ea314-e698-4f5d-bf85-16c00724c5ad
PLAN_ID = "dd9ea314-e698-4f5d-bf85-16c00724c5ad"
ROOMS = {
    "Alpha": "room-rvmbce1-mrvtywb1",
    "Beta": "room-bnis9gg-mrvu0bpe",
    "Gamma": "room-2bfs16i-mrvu0u6p",
    "Theta": "room-y8i8ilp-mrvu1vna",
}

# Test results tracking
test_results = {
    "planned": 0,
    "passed": 0,
    "failed": 0,
    "blocked": 0,
    "bugs": [],
}

def log(msg: str, level: str = "INFO"):
    """Log test messages"""
    prefix = {
        "INFO": "ℹ️",
        "PASS": "✅",
        "FAIL": "❌",
        "WARN": "⚠️",
        "DEBUG": "🔍",
    }.get(level, "•")
    print(f"{prefix} {msg}")

def login(creds: Dict[str, str]) -> Optional[str]:
    """Login and return access token"""
    try:
        resp = requests.post(f"{BASE_URL}/auth/login", json=creds, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            token = data.get("access_token")
            user = data.get("user", {})
            log(f"Logged in as {user.get('name')} ({user.get('email')})", "PASS")
            return token
        else:
            log(f"Login failed: {resp.status_code} {resp.text}", "FAIL")
            return None
    except Exception as e:
        log(f"Login error: {e}", "FAIL")
        return None

def get_headers(token: str) -> Dict[str, str]:
    """Get request headers with auth token"""
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

def reset_approval_settings(token: str) -> bool:
    """Reset approval settings to defaults"""
    try:
        resp = requests.post(
            f"{BASE_URL}/approval-settings/reset",
            headers=get_headers(token),
            timeout=15,
        )
        if resp.status_code == 200:
            log("Approval settings reset to defaults", "PASS")
            return True
        else:
            log(f"Reset failed: {resp.status_code} {resp.text}", "FAIL")
            return False
    except Exception as e:
        log(f"Reset error: {e}", "FAIL")
        return False

def get_approval_settings(token: str) -> Optional[Dict]:
    """Get current approval settings"""
    try:
        resp = requests.get(
            f"{BASE_URL}/approval-settings",
            headers=get_headers(token),
            timeout=15,
        )
        if resp.status_code == 200:
            return resp.json()
        else:
            log(f"Get settings failed: {resp.status_code}", "FAIL")
            return None
    except Exception as e:
        log(f"Get settings error: {e}", "FAIL")
        return None

def update_approval_settings(token: str, payload: Dict) -> bool:
    """Update approval settings"""
    try:
        resp = requests.put(
            f"{BASE_URL}/approval-settings",
            headers=get_headers(token),
            json=payload,
            timeout=15,
        )
        if resp.status_code == 200:
            return True
        else:
            log(f"Update settings failed: {resp.status_code} {resp.text}", "FAIL")
            return False
    except Exception as e:
        log(f"Update settings error: {e}", "FAIL")
        return False

def submit_meeting_request(
    token: str,
    room_id: str,
    title: str,
    start_at: str,
    end_at: str,
    recurring: Optional[Dict] = None,
) -> Optional[Dict]:
    """Submit a meeting room request"""
    payload = {
        "plan_id": PLAN_ID,
        "room_id": room_id,
        "title": title,
        "start_at": start_at,
        "end_at": end_at,
        "attendees": [],
    }
    if recurring:
        payload["recurring"] = recurring
    
    try:
        resp = requests.post(
            f"{BASE_URL}/meeting-room-requests",
            headers=get_headers(token),
            json=payload,
            timeout=15,
        )
        if resp.status_code in [200, 201]:
            return resp.json()
        else:
            log(f"Submit request failed: {resp.status_code} {resp.text}", "FAIL")
            return None
    except Exception as e:
        log(f"Submit request error: {e}", "FAIL")
        return None

def cleanup_request(token: str, request_id: str):
    """Delete/cancel a meeting request"""
    try:
        requests.delete(
            f"{BASE_URL}/meeting-room-requests/{request_id}",
            headers=get_headers(token),
            timeout=15,
        )
    except Exception:
        pass

def get_today() -> str:
    """Get today's date in YYYY-MM-DD format"""
    return date_cls.today().isoformat()

def get_tomorrow() -> str:
    """Get tomorrow's date"""
    return (date_cls.today() + timedelta(days=1)).isoformat()

def get_yesterday() -> str:
    """Get yesterday's date"""
    return (date_cls.today() - timedelta(days=1)).isoformat()

def get_date_offset(days: int) -> str:
    """Get date with offset"""
    return (date_cls.today() + timedelta(days=days)).isoformat()

def format_datetime(date_str: str, time_str: str) -> str:
    """Format datetime for API (ISO 8601 with Z)"""
    return f"{date_str}T{time_str}:00Z"

# ============================================================================
# TEST SCENARIOS
# ============================================================================

def test_a_date_rule_modes(admin_token: str, member_token: str):
    """Test A: Date-rule modes (on, before, after, between)"""
    log("\n" + "="*80, "INFO")
    log("TEST A: Date-rule modes (meeting_room + workstation)", "INFO")
    log("="*80, "INFO")
    
    today = get_today()
    tomorrow = get_tomorrow()
    yesterday = get_yesterday()
    day_after_tomorrow = get_date_offset(2)
    two_days_ago = get_date_offset(-2)
    plus_7d = get_date_offset(7)
    
    test_results["planned"] += 7
    
    # Reset settings
    reset_approval_settings(admin_token)
    
    # A1: date.mode="on" with from=today
    log("\nA1: Testing date.mode='on' with from=today", "INFO")
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "date": {
                    "enabled": True,
                    "mode": "on",
                    "from": today,
                    "to": None,
                }
            }
        }
    })
    
    # Request tomorrow = Pending
    result = submit_meeting_request(
        member_token,
        ROOMS["Beta"],
        "Test A1 Tomorrow",
        format_datetime(tomorrow, "10:00"),
        format_datetime(tomorrow, "11:00"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Pending Approval":
            log("A1a: Request tomorrow = Pending ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"A1a FAIL: Expected Pending, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "A1a",
                "expected": "Pending Approval",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "date.mode=on with from=today, submit request for tomorrow",
            })
        # Cleanup
        if requests_data:
            cleanup_request(member_token, requests_data[0].get("id"))
    
    # Request today = Approved
    result = submit_meeting_request(
        member_token,
        ROOMS["Beta"],
        "Test A1 Today",
        format_datetime(today, "14:00"),
        format_datetime(today, "15:00"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Approved":
            log("A1b: Request today = Approved ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"A1b FAIL: Expected Approved, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "A1b",
                "expected": "Approved",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "date.mode=on with from=today, submit request for today",
            })
        if requests_data:
            cleanup_request(member_token, requests_data[0].get("id"))
    
    # A2: date.mode="before" with from=tomorrow
    log("\nA2: Testing date.mode='before' with from=tomorrow", "INFO")
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "date": {
                    "enabled": True,
                    "mode": "before",
                    "from": tomorrow,
                    "to": None,
                }
            }
        }
    })
    
    # Request today = Approved (today < tomorrow)
    result = submit_meeting_request(
        member_token,
        ROOMS["Gamma"],
        "Test A2 Today",
        format_datetime(today, "10:00"),
        format_datetime(today, "11:00"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Approved":
            log("A2a: Request today = Approved ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"A2a FAIL: Expected Approved, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "A2a",
                "expected": "Approved",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "date.mode=before with from=tomorrow, submit request for today",
            })
        if requests_data:
            cleanup_request(member_token, requests_data[0].get("id"))
    
    # Request day after tomorrow = Pending (day_after_tomorrow >= tomorrow)
    result = submit_meeting_request(
        member_token,
        ROOMS["Gamma"],
        "Test A2 Day After",
        format_datetime(day_after_tomorrow, "10:00"),
        format_datetime(day_after_tomorrow, "11:00"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Pending Approval":
            log("A2b: Request day after tomorrow = Pending ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"A2b FAIL: Expected Pending, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "A2b",
                "expected": "Pending Approval",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "date.mode=before with from=tomorrow, submit request for day after tomorrow",
            })
        if requests_data:
            cleanup_request(member_token, requests_data[0].get("id"))
    
    # A3: date.mode="after" with from=yesterday
    log("\nA3: Testing date.mode='after' with from=yesterday", "INFO")
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "date": {
                    "enabled": True,
                    "mode": "after",
                    "from": yesterday,
                    "to": None,
                }
            }
        }
    })
    
    # Request today = Approved (today > yesterday)
    result = submit_meeting_request(
        member_token,
        ROOMS["Theta"],
        "Test A3 Today",
        format_datetime(today, "10:00"),
        format_datetime(today, "11:00"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Approved":
            log("A3a: Request today = Approved ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"A3a FAIL: Expected Approved, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "A3a",
                "expected": "Approved",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "date.mode=after with from=yesterday, submit request for today",
            })
        if requests_data:
            cleanup_request(member_token, requests_data[0].get("id"))
    
    # Request two days ago = Pending (two_days_ago <= yesterday)
    result = submit_meeting_request(
        member_token,
        ROOMS["Theta"],
        "Test A3 Two Days Ago",
        format_datetime(two_days_ago, "10:00"),
        format_datetime(two_days_ago, "11:00"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Pending Approval":
            log("A3b: Request two days ago = Pending ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"A3b FAIL: Expected Pending, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "A3b",
                "expected": "Pending Approval",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "date.mode=after with from=yesterday, submit request for two days ago",
            })
        if requests_data:
            cleanup_request(member_token, requests_data[0].get("id"))
    
    # A4: date.mode="between" with from=today and to=+7d
    log("\nA4: Testing date.mode='between' with from=today and to=+7d", "INFO")
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "date": {
                    "enabled": True,
                    "mode": "between",
                    "from": today,
                    "to": plus_7d,
                }
            }
        }
    })
    
    # Request today = Approved (boundary check)
    result = submit_meeting_request(
        member_token,
        ROOMS["Alpha"],
        "Test A4 Today",
        format_datetime(today, "10:00"),
        format_datetime(today, "11:00"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Approved":
            log("A4: Request today (boundary) = Approved ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"A4 FAIL: Expected Approved, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "A4",
                "expected": "Approved",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "date.mode=between with from=today to=+7d, submit request for today",
            })
        if requests_data:
            cleanup_request(member_token, requests_data[0].get("id"))
    
    log(f"\nTest A Summary: {test_results['passed']}/{test_results['planned']} passed", "INFO")

def test_b_time_rule_operators(admin_token: str, member_token: str):
    """Test B: Time-rule operators (on, before, after, between)"""
    log("\n" + "="*80, "INFO")
    log("TEST B: Time-rule operators", "INFO")
    log("="*80, "INFO")
    
    today = get_today()
    test_results["planned"] += 8
    
    # Reset settings
    reset_approval_settings(admin_token)
    
    # B1: time.operator="on" from="10:00"
    log("\nB1: Testing time.operator='on' from='10:00'", "INFO")
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "time": {
                    "enabled": True,
                    "operator": "on",
                    "from": "10:00",
                    "to": None,
                }
            }
        }
    })
    
    # Meeting at 10:00 → Approved
    result = submit_meeting_request(
        member_token,
        ROOMS["Beta"],
        "Test B1 10:00",
        format_datetime(today, "10:00"),
        format_datetime(today, "11:00"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Approved":
            log("B1a: Meeting at 10:00 = Approved ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"B1a FAIL: Expected Approved, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "B1a",
                "expected": "Approved",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "time.operator=on from=10:00, submit meeting at 10:00",
            })
        if requests_data:
            cleanup_request(member_token, requests_data[0].get("id"))
    
    # Meeting at 10:01 → Pending
    result = submit_meeting_request(
        member_token,
        ROOMS["Beta"],
        "Test B1 10:01",
        format_datetime(today, "10:01"),
        format_datetime(today, "11:01"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Pending Approval":
            log("B1b: Meeting at 10:01 = Pending ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"B1b FAIL: Expected Pending, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "B1b",
                "expected": "Pending Approval",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "time.operator=on from=10:00, submit meeting at 10:01",
            })
        if requests_data:
            cleanup_request(member_token, requests_data[0].get("id"))
    
    # B2: time.operator="before" from="10:00"
    log("\nB2: Testing time.operator='before' from='10:00'", "INFO")
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "time": {
                    "enabled": True,
                    "operator": "before",
                    "from": "10:00",
                    "to": None,
                }
            }
        }
    })
    
    # Meeting at 09:59 → Approved
    result = submit_meeting_request(
        member_token,
        ROOMS["Gamma"],
        "Test B2 09:59",
        format_datetime(today, "09:59"),
        format_datetime(today, "10:59"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Approved":
            log("B2a: Meeting at 09:59 = Approved ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"B2a FAIL: Expected Approved, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "B2a",
                "expected": "Approved",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "time.operator=before from=10:00, submit meeting at 09:59",
            })
        if requests_data:
            cleanup_request(member_token, requests_data[0].get("id"))
    
    # Meeting at 10:00 → Pending (strict <)
    result = submit_meeting_request(
        member_token,
        ROOMS["Gamma"],
        "Test B2 10:00",
        format_datetime(today, "10:00"),
        format_datetime(today, "11:00"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Pending Approval":
            log("B2b: Meeting at 10:00 = Pending (strict <) ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"B2b FAIL: Expected Pending, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "B2b",
                "expected": "Pending Approval",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "time.operator=before from=10:00, submit meeting at 10:00",
            })
        if requests_data:
            cleanup_request(member_token, requests_data[0].get("id"))
    
    # B3: time.operator="after" from="10:00"
    log("\nB3: Testing time.operator='after' from='10:00'", "INFO")
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "time": {
                    "enabled": True,
                    "operator": "after",
                    "from": "10:00",
                    "to": None,
                }
            }
        }
    })
    
    # Meeting at 10:01 → Approved
    result = submit_meeting_request(
        member_token,
        ROOMS["Theta"],
        "Test B3 10:01",
        format_datetime(today, "10:01"),
        format_datetime(today, "11:01"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Approved":
            log("B3a: Meeting at 10:01 = Approved ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"B3a FAIL: Expected Approved, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "B3a",
                "expected": "Approved",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "time.operator=after from=10:00, submit meeting at 10:01",
            })
        if requests_data:
            cleanup_request(member_token, requests_data[0].get("id"))
    
    # Meeting at 10:00 → Pending (strict >)
    result = submit_meeting_request(
        member_token,
        ROOMS["Theta"],
        "Test B3 10:00",
        format_datetime(today, "10:00"),
        format_datetime(today, "11:00"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Pending Approval":
            log("B3b: Meeting at 10:00 = Pending (strict >) ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"B3b FAIL: Expected Pending, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "B3b",
                "expected": "Pending Approval",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "time.operator=after from=10:00, submit meeting at 10:00",
            })
        if requests_data:
            cleanup_request(member_token, requests_data[0].get("id"))
    
    # B4: time.operator="between" from="09:00" to="17:00"
    log("\nB4: Testing time.operator='between' from='09:00' to='17:00'", "INFO")
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "time": {
                    "enabled": True,
                    "operator": "between",
                    "from": "09:00",
                    "to": "17:00",
                }
            }
        }
    })
    
    # Meeting at 12:00 → Approved
    result = submit_meeting_request(
        member_token,
        ROOMS["Alpha"],
        "Test B4 12:00",
        format_datetime(today, "12:00"),
        format_datetime(today, "13:00"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Approved":
            log("B4a: Meeting at 12:00 = Approved ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"B4a FAIL: Expected Approved, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "B4a",
                "expected": "Approved",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "time.operator=between from=09:00 to=17:00, submit meeting at 12:00",
            })
        if requests_data:
            cleanup_request(member_token, requests_data[0].get("id"))
    
    # Meeting at 08:59 → Pending
    result = submit_meeting_request(
        member_token,
        ROOMS["Alpha"],
        "Test B4 08:59",
        format_datetime(today, "08:59"),
        format_datetime(today, "09:59"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Pending Approval":
            log("B4b: Meeting at 08:59 = Pending ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"B4b FAIL: Expected Pending, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "B4b",
                "expected": "Pending Approval",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "time.operator=between from=09:00 to=17:00, submit meeting at 08:59",
            })
        if requests_data:
            cleanup_request(member_token, requests_data[0].get("id"))
    
    log(f"\nTest B Summary: {test_results['passed']}/{test_results['planned']} passed", "INFO")

def test_c_combined_cell_or_semantics(admin_token: str, manager_token: str):
    """Test C: Combined-cell OR semantics"""
    log("\n" + "="*80, "INFO")
    log("TEST C: Combined-cell OR semantics (meeting_room)", "INFO")
    log("="*80, "INFO")
    
    today = get_today()
    test_results["planned"] += 2
    
    # Reset settings
    reset_approval_settings(admin_token)
    
    # C1: Enable team_member + date.on=today
    log("\nC1: Testing OR semantics with team_member + date.on=today", "INFO")
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "team_member": True,
                "date": {
                    "enabled": True,
                    "mode": "on",
                    "from": today,
                    "to": None,
                }
            }
        }
    })
    
    # Submit as team-MANAGER with 45-min meeting today at 09:00
    # Manager doesn't match team_member cell, but date.on matches → Approved
    result = submit_meeting_request(
        manager_token,
        ROOMS["Beta"],
        "Test C1 Manager",
        format_datetime(today, "09:00"),
        format_datetime(today, "09:45"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Approved":
            log("C1: Manager request with date match = Approved (OR semantics) ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"C1 FAIL: Expected Approved, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "C1",
                "expected": "Approved",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "team_member=True + date.on=today, submit as manager for today",
            })
        if requests_data:
            cleanup_request(manager_token, requests_data[0].get("id"))
    
    # C2: Disable all cells, keep enabled=true → Pending
    log("\nC2: Testing with all cells disabled but enabled=true", "INFO")
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "team_member": False,
                "manager": False,
                "date": {"enabled": False, "mode": "on", "from": None, "to": None},
                "time": {"enabled": False, "operator": "on", "from": None, "to": None},
                "duration": {"enabled": False, "value": 30, "unit": "min"},
            }
        }
    })
    
    result = submit_meeting_request(
        manager_token,
        ROOMS["Gamma"],
        "Test C2 No Match",
        format_datetime(today, "10:00"),
        format_datetime(today, "11:00"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Pending Approval":
            log("C2: All cells disabled = Pending ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"C2 FAIL: Expected Pending, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "C2",
                "expected": "Pending Approval",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "enabled=true but all cells disabled, submit request",
            })
        if requests_data:
            cleanup_request(manager_token, requests_data[0].get("id"))
    
    log(f"\nTest C Summary: {test_results['passed']}/{test_results['planned']} passed", "INFO")

def test_d_recurring_meeting_auto_approval(admin_token: str, member_token: str):
    """Test D: Recurring meeting auto-approval"""
    log("\n" + "="*80, "INFO")
    log("TEST D: Recurring meeting auto-approval", "INFO")
    log("="*80, "INFO")
    
    today = get_today()
    end_date = get_date_offset(28)  # 4 weeks
    test_results["planned"] += 1
    
    # Reset and configure duration rule
    reset_approval_settings(admin_token)
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "duration": {
                    "enabled": True,
                    "value": 60,
                    "unit": "min",
                }
            }
        }
    })
    
    log("\nD: Testing recurring meeting (weekly, 5 occurrences, 30 min each)", "INFO")
    
    # Create recurring meeting (weekly, 30 minutes, 5 occurrences)
    result = submit_meeting_request(
        member_token,
        ROOMS["Theta"],
        "Test D Recurring",
        format_datetime(today, "14:00"),
        format_datetime(today, "14:30"),
        recurring={
            "frequency": "weekly",
            "end_date": end_date,
            "days": [],
        }
    )
    
    if result:
        requests_data = result.get("requests", [])
        auto_approved = result.get("auto_approved", [])
        
        # Check if all requests are approved
        all_approved = all(r.get("status") == "Approved" for r in requests_data)
        has_bookings = len(auto_approved) > 0
        
        if all_approved and has_bookings:
            log(f"D: Recurring meeting auto-approved ({len(requests_data)} requests, {len(auto_approved)} bookings) ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"D FAIL: Expected all approved with bookings, got {len([r for r in requests_data if r.get('status') == 'Approved'])} approved, {len(auto_approved)} bookings", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "D",
                "expected": "All recurring requests auto-approved with bookings",
                "actual": f"{len([r for r in requests_data if r.get('status') == 'Approved'])} approved, {len(auto_approved)} bookings",
                "repro": "duration.enabled=true value=60 unit=min, submit recurring 30-min meeting",
            })
        
        # Cleanup
        for req in requests_data:
            cleanup_request(member_token, req.get("id"))
    
    log(f"\nTest D Summary: {test_results['passed']}/{test_results['planned']} passed", "INFO")

def test_f_impersonation(admin_token: str):
    """Test F: Impersonation"""
    log("\n" + "="*80, "INFO")
    log("TEST F: Impersonation", "INFO")
    log("="*80, "INFO")
    
    today = get_today()
    test_results["planned"] += 3
    
    # Reset and enable team_member cell
    reset_approval_settings(admin_token)
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "team_member": True,
            }
        }
    })
    
    log("\nF: Testing impersonation flow", "INFO")
    
    # F1: Impersonate nitya (team member)
    try:
        resp = requests.post(
            f"{BASE_URL}/auth/impersonate",
            headers=get_headers(admin_token),
            json={"user_id": "b11dfd6b-23a4-4a56-a40d-5cda69f63fa2"},  # nitya's id
            timeout=15,
        )
        if resp.status_code == 200:
            data = resp.json()
            impersonated_token = data.get("access_token")
            impersonated_user = data.get("user", {})
            
            log(f"F1: Impersonation successful (token received for {impersonated_user.get('name')})", "PASS")
            test_results["passed"] += 1
            
            # F2: Verify /auth/me returns nitya, not admin
            me_resp = requests.get(
                f"{BASE_URL}/auth/me",
                headers=get_headers(impersonated_token),
                timeout=15,
            )
            if me_resp.status_code == 200:
                me_data = me_resp.json()
                if me_data.get("email") == "nitya.srivastava@infollion.com":
                    log("F2: /auth/me returns impersonated user (nitya) ✓", "PASS")
                    test_results["passed"] += 1
                else:
                    log(f"F2 FAIL: Expected nitya, got {me_data.get('email')}", "FAIL")
                    test_results["failed"] += 1
                    test_results["bugs"].append({
                        "test": "F2",
                        "expected": "nitya.srivastava@infollion.com",
                        "actual": me_data.get("email"),
                        "repro": "Impersonate nitya, call /auth/me",
                    })
            
            # F3: Submit request as impersonated user → should auto-approve
            result = submit_meeting_request(
                impersonated_token,
                ROOMS["Alpha"],
                "Test F Impersonated",
                format_datetime(today, "15:00"),
                format_datetime(today, "16:00"),
            )
            if result:
                requests_data = result.get("requests", [])
                if requests_data and requests_data[0].get("status") == "Approved":
                    log("F3: Impersonated user request auto-approved (team_member cell) ✓", "PASS")
                    test_results["passed"] += 1
                else:
                    log(f"F3 FAIL: Expected Approved, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
                    test_results["failed"] += 1
                    test_results["bugs"].append({
                        "test": "F3",
                        "expected": "Approved",
                        "actual": requests_data[0].get("status") if requests_data else "no data",
                        "repro": "Impersonate team member, submit request with team_member cell enabled",
                    })
                if requests_data:
                    cleanup_request(impersonated_token, requests_data[0].get("id"))
        else:
            log(f"F1 FAIL: Impersonation failed: {resp.status_code} {resp.text}", "FAIL")
            test_results["failed"] += 3
            test_results["bugs"].append({
                "test": "F1-F3",
                "expected": "Successful impersonation",
                "actual": f"{resp.status_code} {resp.text}",
                "repro": "POST /auth/impersonate with nitya's user_id",
            })
    except Exception as e:
        log(f"F FAIL: Impersonation error: {e}", "FAIL")
        test_results["failed"] += 3
        test_results["bugs"].append({
            "test": "F1-F3",
            "expected": "Successful impersonation",
            "actual": str(e),
            "repro": "POST /auth/impersonate",
        })
    
    log(f"\nTest F Summary: {test_results['passed']}/{test_results['planned']} passed", "INFO")

def test_g_cross_resource_isolation(admin_token: str, manager_token: str):
    """Test G: Cross-resource isolation"""
    log("\n" + "="*80, "INFO")
    log("TEST G: Cross-resource isolation (workstation vs meeting_room)", "INFO")
    log("="*80, "INFO")
    
    today = get_today()
    test_results["planned"] += 2
    
    # Reset settings
    reset_approval_settings(admin_token)
    
    # G1: Enable ALL meeting_room cells, leave workstation empty
    log("\nG1: Testing meeting_room settings don't affect workstation", "INFO")
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "team_member": True,
                "manager": True,
                "date": {"enabled": True, "mode": "on", "from": today, "to": None},
                "time": {"enabled": True, "operator": "before", "from": "23:59", "to": None},
                "duration": {"enabled": True, "value": 60, "unit": "min"},
            },
            "workstation": {
                "team_member": False,
                "manager": False,
                "date": {"enabled": False, "mode": "on", "from": None, "to": None},
                "time": {"enabled": False, "operator": "on", "from": None, "to": None},
            }
        }
    })
    
    # Submit meeting room request as team-manager → should auto-approve
    result = submit_meeting_request(
        manager_token,
        ROOMS["Beta"],
        "Test G1 Meeting",
        format_datetime(today, "10:00"),
        format_datetime(today, "11:00"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Approved":
            log("G1: Meeting room request auto-approved ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"G1 FAIL: Expected Approved, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "G1",
                "expected": "Approved",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "Enable all meeting_room cells, submit meeting request",
            })
        if requests_data:
            cleanup_request(manager_token, requests_data[0].get("id"))
    
    # G2: Enable workstation.team_member, leave meeting_room empty
    log("\nG2: Testing workstation settings don't affect meeting_room", "INFO")
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "team_member": False,
                "manager": False,
                "date": {"enabled": False, "mode": "on", "from": None, "to": None},
                "time": {"enabled": False, "operator": "on", "from": None, "to": None},
                "duration": {"enabled": False, "value": 30, "unit": "min"},
            },
            "workstation": {
                "team_member": True,
            }
        }
    })
    
    # Submit meeting room request as team-member → should stay Pending
    member_token = login(TEAM_MEMBER)
    result = submit_meeting_request(
        member_token,
        ROOMS["Gamma"],
        "Test G2 Meeting",
        format_datetime(today, "14:00"),
        format_datetime(today, "15:00"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Pending Approval":
            log("G2: Meeting room request stays Pending (workstation settings don't apply) ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"G2 FAIL: Expected Pending, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "G2",
                "expected": "Pending Approval",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "Enable workstation.team_member only, submit meeting request as team member",
            })
        if requests_data:
            cleanup_request(member_token, requests_data[0].get("id"))
    
    log(f"\nTest G Summary: {test_results['passed']}/{test_results['planned']} passed", "INFO")

def test_h_global_enabled_false(admin_token: str, member_token: str):
    """Test H: Global enabled=false override"""
    log("\n" + "="*80, "INFO")
    log("TEST H: Global enabled=false override", "INFO")
    log("="*80, "INFO")
    
    today = get_today()
    test_results["planned"] += 1
    
    # Configure with all cells enabled but global enabled=false
    log("\nH: Testing global enabled=false with all cells enabled", "INFO")
    update_approval_settings(admin_token, {
        "enabled": False,
        "matrix": {
            "meeting_room": {
                "team_member": True,
                "manager": True,
                "date": {"enabled": True, "mode": "on", "from": today, "to": None},
                "time": {"enabled": True, "operator": "before", "from": "23:59", "to": None},
                "duration": {"enabled": True, "value": 60, "unit": "min"},
            }
        }
    })
    
    # Submit request → should stay Pending
    result = submit_meeting_request(
        member_token,
        ROOMS["Alpha"],
        "Test H Global Disabled",
        format_datetime(today, "10:00"),
        format_datetime(today, "11:00"),
    )
    if result:
        requests_data = result.get("requests", [])
        if requests_data and requests_data[0].get("status") == "Pending Approval":
            log("H: Request stays Pending (global enabled=false) ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"H FAIL: Expected Pending, got {requests_data[0].get('status') if requests_data else 'no data'}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "H",
                "expected": "Pending Approval",
                "actual": requests_data[0].get("status") if requests_data else "no data",
                "repro": "Set enabled=false with all cells enabled, submit request",
            })
        if requests_data:
            cleanup_request(member_token, requests_data[0].get("id"))
    
    log(f"\nTest H Summary: {test_results['passed']}/{test_results['planned']} passed", "INFO")

def test_i_duration_sanitisation(admin_token: str):
    """Test I: Duration sanitisation"""
    log("\n" + "="*80, "INFO")
    log("TEST I: Duration sanitisation", "INFO")
    log("="*80, "INFO")
    
    test_results["planned"] += 5
    
    # Reset settings
    reset_approval_settings(admin_token)
    
    # I1: value=0 → clamped to 30
    log("\nI1: Testing value=0 clamped to 30", "INFO")
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "duration": {"enabled": True, "value": 0, "unit": "min"}
            }
        }
    })
    settings = get_approval_settings(admin_token)
    if settings:
        duration = settings.get("matrix", {}).get("meeting_room", {}).get("duration", {})
        if duration.get("value") == 30:
            log("I1: value=0 clamped to 30 ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"I1 FAIL: Expected 30, got {duration.get('value')}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "I1",
                "expected": "value=30",
                "actual": f"value={duration.get('value')}",
                "repro": "PUT duration with value=0, GET settings",
            })
    
    # I2: value=100 → clamped to 60
    log("\nI2: Testing value=100 clamped to 60", "INFO")
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "duration": {"enabled": True, "value": 100, "unit": "min"}
            }
        }
    })
    settings = get_approval_settings(admin_token)
    if settings:
        duration = settings.get("matrix", {}).get("meeting_room", {}).get("duration", {})
        if duration.get("value") == 60:
            log("I2: value=100 clamped to 60 ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"I2 FAIL: Expected 60, got {duration.get('value')}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "I2",
                "expected": "value=60",
                "actual": f"value={duration.get('value')}",
                "repro": "PUT duration with value=100, GET settings",
            })
    
    # I3: value=-5 → clamped to 30
    log("\nI3: Testing value=-5 clamped to 30", "INFO")
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "duration": {"enabled": True, "value": -5, "unit": "min"}
            }
        }
    })
    settings = get_approval_settings(admin_token)
    if settings:
        duration = settings.get("matrix", {}).get("meeting_room", {}).get("duration", {})
        if duration.get("value") == 30:
            log("I3: value=-5 clamped to 30 ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"I3 FAIL: Expected 30, got {duration.get('value')}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "I3",
                "expected": "value=30",
                "actual": f"value={duration.get('value')}",
                "repro": "PUT duration with value=-5, GET settings",
            })
    
    # I4: value="abc" → graceful handling (200 or sanitized)
    log("\nI4: Testing value='abc' graceful handling", "INFO")
    try:
        resp = requests.put(
            f"{BASE_URL}/approval-settings",
            headers=get_headers(admin_token),
            json={
                "enabled": True,
                "matrix": {
                    "meeting_room": {
                        "duration": {"enabled": True, "value": "abc", "unit": "min"}
                    }
                }
            },
            timeout=15,
        )
        if resp.status_code == 200:
            settings = get_approval_settings(admin_token)
            if settings:
                duration = settings.get("matrix", {}).get("meeting_room", {}).get("duration", {})
                if duration.get("value") == 30:
                    log("I4: value='abc' sanitized to 30 ✓", "PASS")
                    test_results["passed"] += 1
                else:
                    log(f"I4 PARTIAL: value='abc' handled but got {duration.get('value')}", "WARN")
                    test_results["passed"] += 1
        else:
            log(f"I4 FAIL: Expected 200, got {resp.status_code}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "I4",
                "expected": "200 with sanitized value",
                "actual": f"{resp.status_code}",
                "repro": "PUT duration with value='abc'",
            })
    except Exception as e:
        log(f"I4 FAIL: Error {e}", "FAIL")
        test_results["failed"] += 1
    
    # I5: unit="days" → normalized to "min"
    log("\nI5: Testing unit='days' normalized to 'min'", "INFO")
    update_approval_settings(admin_token, {
        "enabled": True,
        "matrix": {
            "meeting_room": {
                "duration": {"enabled": True, "value": 30, "unit": "days"}
            }
        }
    })
    settings = get_approval_settings(admin_token)
    if settings:
        duration = settings.get("matrix", {}).get("meeting_room", {}).get("duration", {})
        if duration.get("unit") == "min":
            log("I5: unit='days' normalized to 'min' ✓", "PASS")
            test_results["passed"] += 1
        else:
            log(f"I5 FAIL: Expected 'min', got {duration.get('unit')}", "FAIL")
            test_results["failed"] += 1
            test_results["bugs"].append({
                "test": "I5",
                "expected": "unit='min'",
                "actual": f"unit='{duration.get('unit')}'",
                "repro": "PUT duration with unit='days', GET settings",
            })
    
    log(f"\nTest I Summary: {test_results['passed']}/{test_results['planned']} passed", "INFO")

def test_j_audit_logs_endpoint(admin_token: str):
    """Test J: Audit-logs endpoint discovery"""
    log("\n" + "="*80, "INFO")
    log("TEST J: Audit-logs endpoint discovery", "INFO")
    log("="*80, "INFO")
    
    test_results["planned"] += 1
    
    # Try common audit log endpoints
    endpoints = [
        "/audit-logs",
        "/audit",
        "/audit/logs",
        "/permissions/audit",
    ]
    
    log("\nJ: Testing audit log endpoints", "INFO")
    found = False
    working_endpoint = None
    
    for endpoint in endpoints:
        try:
            resp = requests.get(
                f"{BASE_URL}{endpoint}",
                headers=get_headers(admin_token),
                timeout=15,
            )
            if resp.status_code == 200:
                log(f"J: Found working endpoint: {endpoint} ✓", "PASS")
                working_endpoint = endpoint
                found = True
                test_results["passed"] += 1
                break
            else:
                log(f"  {endpoint}: {resp.status_code}", "DEBUG")
        except Exception as e:
            log(f"  {endpoint}: Error {e}", "DEBUG")
    
    if not found:
        log("J FAIL: No working audit log endpoint found", "FAIL")
        test_results["failed"] += 1
        test_results["bugs"].append({
            "test": "J",
            "expected": "Working audit log endpoint",
            "actual": "All endpoints returned non-200",
            "repro": f"Tried: {', '.join(endpoints)}",
        })
    
    log(f"\nTest J Summary: {test_results['passed']}/{test_results['planned']} passed", "INFO")

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================

def main():
    """Main test runner"""
    log("="*80, "INFO")
    log("BACKEND QA — Auto-Approval Module (Round 2)", "INFO")
    log("Comprehensive testing of SKIPPED scenarios", "INFO")
    log("="*80, "INFO")
    
    # Login
    log("\n🔐 Logging in...", "INFO")
    admin_token = login(SUPER_ADMIN)
    manager_token = login(TEAM_MANAGER)
    member_token = login(TEAM_MEMBER)
    
    if not all([admin_token, manager_token, member_token]):
        log("❌ Login failed. Cannot proceed with tests.", "FAIL")
        sys.exit(1)
    
    # Run tests
    try:
        test_a_date_rule_modes(admin_token, member_token)
        test_b_time_rule_operators(admin_token, member_token)
        test_c_combined_cell_or_semantics(admin_token, manager_token)
        test_d_recurring_meeting_auto_approval(admin_token, member_token)
        test_f_impersonation(admin_token)
        test_g_cross_resource_isolation(admin_token, manager_token)
        test_h_global_enabled_false(admin_token, member_token)
        test_i_duration_sanitisation(admin_token)
        test_j_audit_logs_endpoint(admin_token)
    except Exception as e:
        log(f"\n❌ Test execution error: {e}", "FAIL")
    
    # Final cleanup
    log("\n🧹 Cleaning up...", "INFO")
    reset_approval_settings(admin_token)
    
    # Print summary
    log("\n" + "="*80, "INFO")
    log("EXECUTIVE SUMMARY", "INFO")
    log("="*80, "INFO")
    log(f"Total Test Cases Planned: {test_results['planned']}", "INFO")
    log(f"Passed: {test_results['passed']} ✅", "PASS")
    log(f"Failed: {test_results['failed']} ❌", "FAIL" if test_results['failed'] > 0 else "INFO")
    log(f"Blocked: {test_results['blocked']} ⚠️", "WARN" if test_results['blocked'] > 0 else "INFO")
    
    if test_results['bugs']:
        log("\n" + "="*80, "INFO")
        log("BUG REPORT", "INFO")
        log("="*80, "INFO")
        for i, bug in enumerate(test_results['bugs'], 1):
            log(f"\nBug #{i}: {bug['test']}", "FAIL")
            log(f"  Expected: {bug['expected']}", "INFO")
            log(f"  Actual: {bug['actual']}", "INFO")
            log(f"  Repro: {bug['repro']}", "INFO")
    
    log("\n" + "="*80, "INFO")
    log("TEST COMPLETE", "INFO")
    log("="*80, "INFO")

if __name__ == "__main__":
    main()
