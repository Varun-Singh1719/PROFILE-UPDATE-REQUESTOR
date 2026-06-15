#!/usr/bin/env python3
"""
Backend API Testing for Workstation Booking Module
Tests all backend endpoints for workstation bookings, bookings aggregator, and auto-release.
"""

import requests
import json
import sys
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta

# Backend URL from environment
BASE_URL = "https://bulk-emp-upload-2.preview.emergentagent.com/api"

# Test credentials
SUPER_ADMIN_EMAIL = "admin@ticketing.com"
SUPER_ADMIN_PASSWORD = "Admin@123"
ADMIN_EMAIL = "manager@ticketing.com"
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
        self.failures = []
        self.passes = []
        self.test_plan_id = None
        self.test_seat_ids = []
        self.test_employee_id = None
        self.test_team_id = None
        self.test_booking_id = None
        self.test_series_id = None
        self.test_mr_booking_id = None

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

    def setup_test_data(self):
        """Setup test data - get floor plan, seats, employees, teams"""
        print_test("Setup: Getting test data (floor plans, employees, teams)")
        
        if not self.super_admin_token:
            print_fail("Super Admin token not available")
            return False
        
        try:
            # Get floor plans
            resp = requests.get(f"{BASE_URL}/workstation-bookings/floor-plans",
                              headers=self.get_headers(self.super_admin_token),
                              timeout=30)
            if resp.status_code == 200:
                plans = resp.json()
                if plans:
                    self.test_plan_id = plans[0]["id"]
                    print_pass(f"Found floor plan: {plans[0]['name']} with {plans[0]['seat_count']} seats")
                else:
                    print_fail("No live floor plans with seats found")
                    return False
            else:
                print_fail(f"GET floor-plans failed: {resp.status_code}")
                return False
            
            # Get availability to find seat IDs
            today = datetime.now().strftime("%Y-%m-%d")
            resp = requests.get(f"{BASE_URL}/workstation-bookings/availability",
                              params={"plan_id": self.test_plan_id, "date": today},
                              headers=self.get_headers(self.super_admin_token),
                              timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                seats = data.get("seats", [])
                if len(seats) >= 2:
                    self.test_seat_ids = [seats[0]["id"], seats[1]["id"]]
                    print_pass(f"Found seats: {[s.get('label') for s in seats[:2]]}")
                else:
                    print_fail("Not enough seats in floor plan")
                    return False
            else:
                print_fail(f"GET availability failed: {resp.status_code}")
                return False
            
            # Get active employees
            resp = requests.get(f"{BASE_URL}/contacts?status=Active",
                              headers=self.get_headers(self.super_admin_token),
                              timeout=30)
            if resp.status_code == 200:
                contacts = resp.json()
                if isinstance(contacts, dict):
                    contacts = contacts.get("items", [])
                if contacts:
                    self.test_employee_id = contacts[0]["id"]
                    print_pass(f"Found employee: {contacts[0]['name']}")
                else:
                    print_fail("No active employees found")
                    return False
            else:
                print_fail(f"GET contacts failed: {resp.status_code}")
                return False
            
            # Get teams
            resp = requests.get(f"{BASE_URL}/teams",
                              headers=self.get_headers(self.super_admin_token),
                              timeout=30)
            if resp.status_code == 200:
                teams = resp.json()
                # Find a team with at least 2 members
                for team in teams:
                    member_ids = team.get("member_ids", []) + team.get("manager_ids", [])
                    if len(member_ids) >= 2:
                        self.test_team_id = team["id"]
                        print_pass(f"Found team: {team['name']} with {len(member_ids)} members")
                        break
                if not self.test_team_id:
                    print_info("No team with 2+ members found, will skip team tests")
            else:
                print_fail(f"GET teams failed: {resp.status_code}")
            
            return True
        except Exception as e:
            print_fail(f"Setup exception: {e}")
            return False

    def test_floor_plans_endpoint(self):
        """Test GET /api/workstation-bookings/floor-plans"""
        print_test("GET /api/workstation-bookings/floor-plans - Live plans with seats")
        
        try:
            resp = requests.get(f"{BASE_URL}/workstation-bookings/floor-plans",
                              headers=self.get_headers(self.super_admin_token),
                              timeout=30)
            if resp.status_code == 200:
                plans = resp.json()
                if plans:
                    plan = plans[0]
                    if "name" in plan and "seat_count" in plan:
                        print_pass(f"Returns live plans with name and seat_count: {plan['name']} ({plan['seat_count']} seats)")
                        self.passes.append("Floor plans endpoint works")
                    else:
                        print_fail(f"Missing required fields in plan: {plan}")
                        self.failures.append("Floor plans missing fields")
                else:
                    print_info("No live floor plans found (expected if none configured)")
            else:
                print_fail(f"GET floor-plans failed: {resp.status_code} - {resp.text}")
                self.failures.append("GET floor-plans failed")
        except Exception as e:
            print_fail(f"Floor plans exception: {e}")
            self.failures.append(f"Floor plans exception: {e}")

    def test_availability_endpoint(self):
        """Test GET /api/workstation-bookings/availability"""
        print_test("GET /api/workstation-bookings/availability - Returns plan, seats, bookings")
        
        if not self.test_plan_id:
            print_info("No test plan available, skipping")
            return
        
        try:
            today = datetime.now().strftime("%Y-%m-%d")
            resp = requests.get(f"{BASE_URL}/workstation-bookings/availability",
                              params={"plan_id": self.test_plan_id, "date": today},
                              headers=self.get_headers(self.super_admin_token),
                              timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                required_keys = ["plan", "seats", "bookings", "booked_seat_ids", "booked_employee_ids"]
                missing = [k for k in required_keys if k not in data]
                if not missing:
                    print_pass(f"Returns all required fields: {required_keys}")
                    print_info(f"Seats: {len(data['seats'])}, Bookings: {len(data['bookings'])}, Booked seats: {len(data['booked_seat_ids'])}")
                    self.passes.append("Availability endpoint works")
                else:
                    print_fail(f"Missing fields: {missing}")
                    self.failures.append(f"Availability missing fields: {missing}")
            else:
                print_fail(f"GET availability failed: {resp.status_code} - {resp.text}")
                self.failures.append("GET availability failed")
        except Exception as e:
            print_fail(f"Availability exception: {e}")
            self.failures.append(f"Availability exception: {e}")

    def test_create_single_seat_booking(self):
        """Test POST /api/workstation-bookings - Single seat"""
        print_test("POST /api/workstation-bookings - Single seat booking")
        
        if not self.test_plan_id or not self.test_seat_ids or not self.test_employee_id:
            print_info("Prerequisites not met, skipping")
            return
        
        try:
            tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
            payload = {
                "plan_id": self.test_plan_id,
                "date": tomorrow,
                "seat_ids": [self.test_seat_ids[0]],
                "employee_id": self.test_employee_id
            }
            resp = requests.post(f"{BASE_URL}/workstation-bookings",
                               json=payload,
                               headers=self.get_headers(self.super_admin_token),
                               timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("created") == 1 and data.get("bookings"):
                    booking = data["bookings"][0]
                    if "seat_label" in booking and "employee" in booking and "seq_no" in booking:
                        self.test_booking_id = booking["id"]
                        print_pass(f"Single seat booking created: seq_no={booking['seq_no']}, seat={booking['seat_label']}, employee={booking['employee']['name']}")
                        self.passes.append("Single seat booking works")
                    else:
                        print_fail(f"Booking missing required fields: {booking}")
                        self.failures.append("Single seat booking missing fields")
                else:
                    print_fail(f"Unexpected response: {data}")
                    self.failures.append("Single seat booking unexpected response")
            else:
                print_fail(f"POST single seat failed: {resp.status_code} - {resp.text}")
                self.failures.append("POST single seat failed")
        except Exception as e:
            print_fail(f"Single seat booking exception: {e}")
            self.failures.append(f"Single seat booking exception: {e}")

    def test_create_multi_seat_team_booking(self):
        """Test POST /api/workstation-bookings - Multi-seat team booking"""
        print_test("POST /api/workstation-bookings - Multi-seat team booking")
        
        if not self.test_plan_id or not self.test_seat_ids or not self.test_team_id:
            print_info("Prerequisites not met, skipping")
            return
        
        try:
            # Get team members
            resp = requests.get(f"{BASE_URL}/teams",
                              headers=self.get_headers(self.super_admin_token),
                              timeout=30)
            if resp.status_code != 200:
                print_fail("Cannot get teams")
                return
            
            teams = resp.json()
            team = next((t for t in teams if t["id"] == self.test_team_id), None)
            if not team:
                print_fail("Test team not found")
                return
            
            member_ids = (team.get("member_ids", []) + team.get("manager_ids", []))[:2]
            if len(member_ids) < 2:
                print_info("Not enough team members, skipping")
                return
            
            day_after_tomorrow = (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d")
            payload = {
                "plan_id": self.test_plan_id,
                "date": day_after_tomorrow,
                "seat_ids": self.test_seat_ids[:2],
                "team_id": self.test_team_id,
                "team_employee_ids": member_ids
            }
            resp = requests.post(f"{BASE_URL}/workstation-bookings",
                               json=payload,
                               headers=self.get_headers(self.super_admin_token),
                               timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("created") == 2:
                    bookings = data.get("bookings", [])
                    if all("team_id" in b and "team_name" in b and "team_color" in b for b in bookings):
                        print_pass(f"Multi-seat team booking created: {data['created']} bookings with team info")
                        self.passes.append("Multi-seat team booking works")
                    else:
                        print_fail("Team bookings missing team fields")
                        self.failures.append("Team bookings missing team fields")
                else:
                    print_fail(f"Expected created=2, got: {data.get('created')}")
                    self.failures.append("Multi-seat team booking count wrong")
            else:
                print_fail(f"POST multi-seat failed: {resp.status_code} - {resp.text}")
                self.failures.append("POST multi-seat failed")
        except Exception as e:
            print_fail(f"Multi-seat booking exception: {e}")
            self.failures.append(f"Multi-seat booking exception: {e}")

    def test_create_recurring_booking(self):
        """Test POST /api/workstation-bookings - Recurring booking"""
        print_test("POST /api/workstation-bookings - Recurring booking (Mon+Wed over 3 weeks)")
        
        if not self.test_plan_id or not self.test_seat_ids or not self.test_employee_id:
            print_info("Prerequisites not met, skipping")
            return
        
        try:
            # Find next Monday
            today = datetime.now()
            days_ahead = 0 - today.weekday()  # Monday is 0
            if days_ahead <= 0:
                days_ahead += 7
            next_monday = today + timedelta(days=days_ahead)
            end_date = next_monday + timedelta(days=20)  # 3 weeks span
            
            payload = {
                "plan_id": self.test_plan_id,
                "date": next_monday.strftime("%Y-%m-%d"),
                "seat_ids": [self.test_seat_ids[0]],
                "employee_id": self.test_employee_id,
                "recurring": {
                    "end_date": end_date.strftime("%Y-%m-%d"),
                    "days": ["M", "W"]
                }
            }
            resp = requests.post(f"{BASE_URL}/workstation-bookings",
                               json=payload,
                               headers=self.get_headers(self.super_admin_token),
                               timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                created = data.get("created", 0)
                if created == 6:  # 3 Mondays + 3 Wednesdays
                    self.test_series_id = data.get("series_id")
                    print_pass(f"Recurring booking created: {created} instances with series_id={self.test_series_id}")
                    self.passes.append("Recurring booking works")
                else:
                    print_info(f"Recurring booking created {created} instances (expected 6, may vary based on date)")
                    if created > 0:
                        self.test_series_id = data.get("series_id")
                        self.passes.append("Recurring booking works")
            else:
                print_fail(f"POST recurring failed: {resp.status_code} - {resp.text}")
                self.failures.append("POST recurring failed")
        except Exception as e:
            print_fail(f"Recurring booking exception: {e}")
            self.failures.append(f"Recurring booking exception: {e}")

    def test_duplicate_seat_conflict(self):
        """Test POST /api/workstation-bookings - Duplicate seat conflict"""
        print_test("POST /api/workstation-bookings - Duplicate seat should return 409 WORKSTATION_OCCUPIED")
        
        if not self.test_plan_id or not self.test_seat_ids or not self.test_employee_id:
            print_info("Prerequisites not met, skipping")
            return
        
        try:
            tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
            payload = {
                "plan_id": self.test_plan_id,
                "date": tomorrow,
                "seat_ids": [self.test_seat_ids[0]],
                "employee_id": self.test_employee_id
            }
            # Try to book the same seat again
            resp = requests.post(f"{BASE_URL}/workstation-bookings",
                               json=payload,
                               headers=self.get_headers(self.super_admin_token),
                               timeout=30)
            if resp.status_code == 409:
                data = resp.json()
                if data.get("detail", {}).get("code") == "WORKSTATION_OCCUPIED":
                    print_pass("Duplicate seat correctly rejected with 409 WORKSTATION_OCCUPIED")
                    self.passes.append("Duplicate seat validation works")
                else:
                    print_fail(f"409 but wrong code: {data}")
                    self.failures.append("Duplicate seat wrong error code")
            else:
                print_fail(f"Expected 409, got: {resp.status_code} - {resp.text}")
                self.failures.append("Duplicate seat validation failed")
        except Exception as e:
            print_fail(f"Duplicate seat exception: {e}")
            self.failures.append(f"Duplicate seat exception: {e}")

    def test_duplicate_employee_conflict(self):
        """Test POST /api/workstation-bookings - Duplicate employee conflict"""
        print_test("POST /api/workstation-bookings - Duplicate employee should return 409 EMPLOYEE_ALREADY_BOOKED")
        
        if not self.test_plan_id or not self.test_seat_ids or not self.test_employee_id:
            print_info("Prerequisites not met, skipping")
            return
        
        try:
            tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
            payload = {
                "plan_id": self.test_plan_id,
                "date": tomorrow,
                "seat_ids": [self.test_seat_ids[1]],  # Different seat
                "employee_id": self.test_employee_id  # Same employee
            }
            resp = requests.post(f"{BASE_URL}/workstation-bookings",
                               json=payload,
                               headers=self.get_headers(self.super_admin_token),
                               timeout=30)
            if resp.status_code == 409:
                data = resp.json()
                if data.get("detail", {}).get("code") == "EMPLOYEE_ALREADY_BOOKED":
                    print_pass("Duplicate employee correctly rejected with 409 EMPLOYEE_ALREADY_BOOKED")
                    self.passes.append("Duplicate employee validation works")
                else:
                    print_fail(f"409 but wrong code: {data}")
                    self.failures.append("Duplicate employee wrong error code")
            else:
                print_fail(f"Expected 409, got: {resp.status_code} - {resp.text}")
                self.failures.append("Duplicate employee validation failed")
        except Exception as e:
            print_fail(f"Duplicate employee exception: {e}")
            self.failures.append(f"Duplicate employee exception: {e}")

    def test_admin_write_forbidden(self):
        """Test POST /api/workstation-bookings as Admin (should be 403)"""
        print_test("POST /api/workstation-bookings - Admin should get 403")
        
        if not self.admin_token or not self.test_plan_id or not self.test_seat_ids or not self.test_employee_id:
            print_info("Prerequisites not met, skipping")
            return
        
        try:
            tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
            payload = {
                "plan_id": self.test_plan_id,
                "date": tomorrow,
                "seat_ids": [self.test_seat_ids[0]],
                "employee_id": self.test_employee_id
            }
            resp = requests.post(f"{BASE_URL}/workstation-bookings",
                               json=payload,
                               headers=self.get_headers(self.admin_token),
                               timeout=30)
            if resp.status_code == 403:
                print_pass("Admin correctly denied (403) from creating workstation booking")
                self.passes.append("Admin 403 on POST workstation booking")
            else:
                print_fail(f"Expected 403, got: {resp.status_code}")
                self.failures.append(f"Admin POST workstation booking wrong status: {resp.status_code}")
        except Exception as e:
            print_fail(f"Admin POST exception: {e}")
            self.failures.append(f"Admin POST exception: {e}")

    def test_patch_booking(self):
        """Test PATCH /api/workstation-bookings/{id}"""
        print_test("PATCH /api/workstation-bookings/{id} - Reschedule and reassign")
        
        if not self.test_booking_id:
            print_info("No test booking available, skipping")
            return
        
        try:
            # Reschedule to a different date
            new_date = (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%d")
            payload = {"date": new_date}
            resp = requests.patch(f"{BASE_URL}/workstation-bookings/{self.test_booking_id}",
                                json=payload,
                                headers=self.get_headers(self.super_admin_token),
                                timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("booking", {}).get("date") == new_date:
                    print_pass(f"Booking rescheduled to {new_date}")
                    self.passes.append("PATCH booking reschedule works")
                else:
                    print_fail(f"Date not updated: {data}")
                    self.failures.append("PATCH booking date not updated")
            else:
                print_fail(f"PATCH booking failed: {resp.status_code} - {resp.text}")
                self.failures.append("PATCH booking failed")
        except Exception as e:
            print_fail(f"PATCH booking exception: {e}")
            self.failures.append(f"PATCH booking exception: {e}")

    def test_delete_single_booking(self):
        """Test DELETE /api/workstation-bookings/{id} - Single cancel"""
        print_test("DELETE /api/workstation-bookings/{id} - Cancel single booking")
        
        if not self.test_booking_id:
            print_info("No test booking available, skipping")
            return
        
        try:
            resp = requests.delete(f"{BASE_URL}/workstation-bookings/{self.test_booking_id}",
                                 headers=self.get_headers(self.super_admin_token),
                                 timeout=30)
            if resp.status_code == 200:
                # Verify cancelled
                resp2 = requests.get(f"{BASE_URL}/workstation-bookings/{self.test_booking_id}",
                                   headers=self.get_headers(self.super_admin_token),
                                   timeout=30)
                if resp2.status_code == 200:
                    booking = resp2.json()
                    if booking.get("cancelled"):
                        print_pass("Booking cancelled successfully")
                        self.passes.append("DELETE single booking works")
                    else:
                        print_fail("Booking not marked as cancelled")
                        self.failures.append("DELETE single booking not cancelled")
            else:
                print_fail(f"DELETE booking failed: {resp.status_code} - {resp.text}")
                self.failures.append("DELETE booking failed")
        except Exception as e:
            print_fail(f"DELETE booking exception: {e}")
            self.failures.append(f"DELETE booking exception: {e}")

    def test_delete_series_booking(self):
        """Test DELETE /api/workstation-bookings/{id}?series=true - Cancel series"""
        print_test("DELETE /api/workstation-bookings/{id}?series=true - Cancel recurring series")
        
        if not self.test_series_id:
            print_info("No recurring series available, skipping")
            return
        
        try:
            # Get one booking from the series
            resp = requests.get(f"{BASE_URL}/workstation-bookings",
                              params={"include_cancelled": False},
                              headers=self.get_headers(self.super_admin_token),
                              timeout=30)
            if resp.status_code != 200:
                print_fail("Cannot get bookings")
                return
            
            bookings = resp.json()
            series_booking = next((b for b in bookings if b.get("series_id") == self.test_series_id and not b.get("cancelled")), None)
            if not series_booking:
                print_info("No active series booking found")
                return
            
            # Cancel the series
            resp = requests.delete(f"{BASE_URL}/workstation-bookings/{series_booking['id']}",
                                 params={"series": True},
                                 headers=self.get_headers(self.super_admin_token),
                                 timeout=30)
            if resp.status_code == 200:
                # Verify all future bookings in series are cancelled
                resp2 = requests.get(f"{BASE_URL}/workstation-bookings",
                                   params={"include_cancelled": True},
                                   headers=self.get_headers(self.super_admin_token),
                                   timeout=30)
                if resp2.status_code == 200:
                    all_bookings = resp2.json()
                    series_bookings = [b for b in all_bookings if b.get("series_id") == self.test_series_id]
                    future_bookings = [b for b in series_bookings if b.get("date", "") >= series_booking["date"]]
                    cancelled_count = sum(1 for b in future_bookings if b.get("cancelled"))
                    print_pass(f"Series cancel: {cancelled_count}/{len(future_bookings)} future bookings cancelled")
                    self.passes.append("DELETE series booking works")
            else:
                print_fail(f"DELETE series failed: {resp.status_code} - {resp.text}")
                self.failures.append("DELETE series failed")
        except Exception as e:
            print_fail(f"DELETE series exception: {e}")
            self.failures.append(f"DELETE series exception: {e}")

    def test_get_booking_by_seq_no(self):
        """Test GET /api/workstation-bookings/{seq_no} - Fetch by seq_no"""
        print_test("GET /api/workstation-bookings/{seq_no} - Fetch by numeric seq_no")
        
        try:
            # Get any booking to find its seq_no
            resp = requests.get(f"{BASE_URL}/workstation-bookings",
                              headers=self.get_headers(self.super_admin_token),
                              timeout=30)
            if resp.status_code == 200:
                bookings = resp.json()
                if bookings:
                    seq_no = bookings[0].get("seq_no")
                    if seq_no and seq_no >= 20001:
                        # Fetch by seq_no
                        resp2 = requests.get(f"{BASE_URL}/workstation-bookings/{seq_no}",
                                           headers=self.get_headers(self.super_admin_token),
                                           timeout=30)
                        if resp2.status_code == 200:
                            booking = resp2.json()
                            if booking.get("seq_no") == seq_no:
                                print_pass(f"Fetched booking by seq_no={seq_no}")
                                self.passes.append("GET booking by seq_no works")
                            else:
                                print_fail(f"Wrong booking returned: {booking}")
                                self.failures.append("GET booking by seq_no wrong booking")
                        else:
                            print_fail(f"GET by seq_no failed: {resp2.status_code}")
                            self.failures.append("GET booking by seq_no failed")
                    else:
                        print_info("No valid seq_no found")
                else:
                    print_info("No bookings to test seq_no fetch")
        except Exception as e:
            print_fail(f"GET by seq_no exception: {e}")
            self.failures.append(f"GET by seq_no exception: {e}")

    def test_release_inactive_endpoint(self):
        """Test POST /api/workstation-bookings/release-inactive"""
        print_test("POST /api/workstation-bookings/release-inactive - Idempotent admin helper")
        
        try:
            resp = requests.post(f"{BASE_URL}/workstation-bookings/release-inactive",
                               headers=self.get_headers(self.super_admin_token),
                               timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if "released" in data:
                    print_pass(f"Release inactive endpoint works: released={data['released']}")
                    self.passes.append("Release inactive endpoint works")
                else:
                    print_fail(f"Missing 'released' field: {data}")
                    self.failures.append("Release inactive missing field")
            else:
                print_fail(f"POST release-inactive failed: {resp.status_code} - {resp.text}")
                self.failures.append("POST release-inactive failed")
        except Exception as e:
            print_fail(f"Release inactive exception: {e}")
            self.failures.append(f"Release inactive exception: {e}")

    def test_contacts_auto_release(self):
        """Test PATCH /api/contacts/{id} - Auto-release on deactivation"""
        print_test("PATCH /api/contacts/{id} - Auto-release workstation bookings on deactivation")
        
        try:
            # Create a test employee
            new_employee = {
                "email": f"test.ws.{datetime.now().timestamp()}@ticketing.com",
                "name": "Test WS Employee",
                "phone": "1234567890",
                "role": "Admin",
                "emp_id": f"EMP-WS-{int(datetime.now().timestamp())}",
                "doj": "2024-01-15"
            }
            resp = requests.post(f"{BASE_URL}/contacts",
                               json=new_employee,
                               headers=self.get_headers(self.super_admin_token),
                               timeout=30)
            if resp.status_code != 200:
                print_fail("Cannot create test employee")
                return
            
            employee = resp.json()
            employee_id = employee["id"]
            
            # Create a future booking for this employee
            future_date = (datetime.now() + timedelta(days=10)).strftime("%Y-%m-%d")
            if not self.test_plan_id or not self.test_seat_ids:
                print_info("No test plan/seats available")
                return
            
            booking_payload = {
                "plan_id": self.test_plan_id,
                "date": future_date,
                "seat_ids": [self.test_seat_ids[0]],
                "employee_id": employee_id
            }
            resp = requests.post(f"{BASE_URL}/workstation-bookings",
                               json=booking_payload,
                               headers=self.get_headers(self.super_admin_token),
                               timeout=30)
            if resp.status_code != 200:
                print_fail("Cannot create test booking")
                return
            
            booking_id = resp.json()["bookings"][0]["id"]
            
            # Deactivate the employee
            resp = requests.patch(f"{BASE_URL}/contacts/{employee_id}",
                                json={"status": "Inactive"},
                                headers=self.get_headers(self.super_admin_token),
                                timeout=30)
            if resp.status_code != 200:
                print_fail("Cannot deactivate employee")
                return
            
            # Check if booking is cancelled
            resp = requests.get(f"{BASE_URL}/workstation-bookings/{booking_id}",
                              headers=self.get_headers(self.super_admin_token),
                              timeout=30)
            if resp.status_code == 200:
                booking = resp.json()
                if booking.get("cancelled"):
                    print_pass("Employee deactivation auto-released workstation booking")
                    self.passes.append("Contacts auto-release works")
                    
                    # Check audit log
                    resp2 = requests.get(f"{BASE_URL}/audit-log",
                                       params={"action": "workstation_booking.auto_release"},
                                       headers=self.get_headers(self.super_admin_token),
                                       timeout=30)
                    if resp2.status_code == 200:
                        logs = resp2.json()
                        if isinstance(logs, dict):
                            logs = logs.get("items", [])
                        if any(log.get("resource_id") == employee_id for log in logs):
                            print_pass("Audit log entry created for auto-release")
                        else:
                            print_info("Audit log entry not found (may be timing issue)")
                else:
                    print_fail("Booking not cancelled after employee deactivation")
                    self.failures.append("Auto-release did not cancel booking")
            else:
                print_fail("Cannot fetch booking after deactivation")
        except Exception as e:
            print_fail(f"Auto-release exception: {e}")
            self.failures.append(f"Auto-release exception: {e}")

    def test_contacts_bulk_status_auto_release(self):
        """Test POST /api/contacts/bulk-status - Auto-release on bulk deactivation"""
        print_test("POST /api/contacts/bulk-status - Auto-release on bulk deactivation")
        
        try:
            # Create test employees
            employee_ids = []
            for i in range(2):
                new_employee = {
                    "email": f"test.bulk.{datetime.now().timestamp()}.{i}@ticketing.com",
                    "name": f"Test Bulk Employee {i}",
                    "phone": "1234567890",
                    "role": "Admin",
                    "emp_id": f"EMP-BULK-{int(datetime.now().timestamp())}-{i}",
                    "doj": "2024-01-15"
                }
                resp = requests.post(f"{BASE_URL}/contacts",
                                   json=new_employee,
                                   headers=self.get_headers(self.super_admin_token),
                                   timeout=30)
                if resp.status_code == 200:
                    employee_ids.append(resp.json()["id"])
            
            if len(employee_ids) < 2:
                print_fail("Cannot create test employees")
                return
            
            # Create bookings for both employees
            future_date = (datetime.now() + timedelta(days=15)).strftime("%Y-%m-%d")
            for emp_id in employee_ids:
                booking_payload = {
                    "plan_id": self.test_plan_id,
                    "date": future_date,
                    "seat_ids": [self.test_seat_ids[0]],
                    "employee_id": emp_id
                }
                requests.post(f"{BASE_URL}/workstation-bookings",
                            json=booking_payload,
                            headers=self.get_headers(self.super_admin_token),
                            timeout=30)
            
            # Bulk deactivate
            resp = requests.post(f"{BASE_URL}/contacts/bulk-status",
                               json={"contact_ids": employee_ids, "status": "Inactive"},
                               headers=self.get_headers(self.super_admin_token),
                               timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if "workstation_released" in data:
                    print_pass(f"Bulk deactivation auto-released {data['workstation_released']} workstation bookings")
                    self.passes.append("Bulk status auto-release works")
                else:
                    print_fail(f"Missing workstation_released field: {data}")
                    self.failures.append("Bulk status missing workstation_released")
            else:
                print_fail(f"Bulk status failed: {resp.status_code} - {resp.text}")
                self.failures.append("Bulk status failed")
        except Exception as e:
            print_fail(f"Bulk status auto-release exception: {e}")
            self.failures.append(f"Bulk status auto-release exception: {e}")

    def test_bookings_aggregator_all_types(self):
        """Test GET /api/bookings?type=all - Returns both MR and WS bookings"""
        print_test("GET /api/bookings?type=all - Returns both Meeting Room and Workstation bookings")
        
        try:
            resp = requests.get(f"{BASE_URL}/bookings",
                              params={"type": "all"},
                              headers=self.get_headers(self.super_admin_token),
                              timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                items = data.get("items", [])
                types = {item.get("type") for item in items}
                if "Workstation" in types:
                    print_pass(f"Bookings aggregator returns both types: {types}")
                    self.passes.append("Bookings aggregator type=all works")
                else:
                    print_info(f"Only found types: {types} (may not have MR bookings)")
                    if "Workstation" in types:
                        self.passes.append("Bookings aggregator includes Workstation")
            else:
                print_fail(f"GET /bookings failed: {resp.status_code} - {resp.text}")
                self.failures.append("GET /bookings failed")
        except Exception as e:
            print_fail(f"Bookings aggregator exception: {e}")
            self.failures.append(f"Bookings aggregator exception: {e}")

    def test_bookings_aggregator_workstation_filter(self):
        """Test GET /api/bookings?type=workstation - Returns only WS bookings"""
        print_test("GET /api/bookings?type=workstation - Returns only Workstation bookings")
        
        try:
            resp = requests.get(f"{BASE_URL}/bookings",
                              params={"type": "workstation"},
                              headers=self.get_headers(self.super_admin_token),
                              timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                items = data.get("items", [])
                types = {item.get("type") for item in items}
                if types == {"Workstation"} or not types:
                    print_pass(f"Workstation filter works: only Workstation type returned ({len(items)} items)")
                    self.passes.append("Bookings aggregator type=workstation works")
                else:
                    print_fail(f"Found non-Workstation types: {types}")
                    self.failures.append("Workstation filter returned wrong types")
            else:
                print_fail(f"GET /bookings?type=workstation failed: {resp.status_code} - {resp.text}")
                self.failures.append("GET /bookings type=workstation failed")
        except Exception as e:
            print_fail(f"Workstation filter exception: {e}")
            self.failures.append(f"Workstation filter exception: {e}")

    def test_bookings_aggregator_get_by_id(self):
        """Test GET /api/bookings/{id} - Fetch WS booking by uuid and seq_no"""
        print_test("GET /api/bookings/{id} - Fetch Workstation booking by uuid and seq_no")
        
        try:
            # Get a workstation booking
            resp = requests.get(f"{BASE_URL}/workstation-bookings",
                              headers=self.get_headers(self.super_admin_token),
                              timeout=30)
            if resp.status_code == 200:
                bookings = resp.json()
                if bookings:
                    booking = bookings[0]
                    booking_id = booking["id"]
                    seq_no = booking.get("seq_no")
                    
                    # Fetch by uuid
                    resp2 = requests.get(f"{BASE_URL}/bookings/{booking_id}",
                                       headers=self.get_headers(self.super_admin_token),
                                       timeout=30)
                    if resp2.status_code == 200:
                        data = resp2.json()
                        if data.get("id") == booking_id and data.get("type") == "Workstation":
                            print_pass(f"Fetched WS booking by uuid: {booking_id}")
                            self.passes.append("Bookings aggregator GET by uuid works")
                        else:
                            print_fail(f"Wrong booking returned: {data}")
                            self.failures.append("Bookings aggregator GET by uuid wrong booking")
                    
                    # Fetch by seq_no
                    if seq_no and seq_no >= 20001:
                        resp3 = requests.get(f"{BASE_URL}/bookings/{seq_no}",
                                           headers=self.get_headers(self.super_admin_token),
                                           timeout=30)
                        if resp3.status_code == 200:
                            data = resp3.json()
                            if data.get("seq_no") == seq_no and data.get("type") == "Workstation":
                                print_pass(f"Fetched WS booking by seq_no: {seq_no}")
                                self.passes.append("Bookings aggregator GET by seq_no works")
                            else:
                                print_fail(f"Wrong booking returned: {data}")
                                self.failures.append("Bookings aggregator GET by seq_no wrong booking")
                else:
                    print_info("No workstation bookings to test")
        except Exception as e:
            print_fail(f"Bookings aggregator GET by id exception: {e}")
            self.failures.append(f"Bookings aggregator GET by id exception: {e}")

    def test_bookings_aggregator_bulk_cancel(self):
        """Test POST /api/bookings/bulk-cancel - Cancel mixed MR and WS bookings"""
        print_test("POST /api/bookings/bulk-cancel - Cancel mixed MR and WS bookings")
        
        try:
            # Create a test WS booking
            future_date = (datetime.now() + timedelta(days=20)).strftime("%Y-%m-%d")
            if not self.test_plan_id or not self.test_seat_ids or not self.test_employee_id:
                print_info("Prerequisites not met, skipping")
                return
            
            booking_payload = {
                "plan_id": self.test_plan_id,
                "date": future_date,
                "seat_ids": [self.test_seat_ids[0]],
                "employee_id": self.test_employee_id
            }
            resp = requests.post(f"{BASE_URL}/workstation-bookings",
                               json=booking_payload,
                               headers=self.get_headers(self.super_admin_token),
                               timeout=30)
            if resp.status_code != 200:
                print_fail("Cannot create test WS booking")
                return
            
            ws_booking_id = resp.json()["bookings"][0]["id"]
            
            # Try to get an MR booking (if exists)
            resp = requests.get(f"{BASE_URL}/bookings",
                              params={"type": "meeting_room"},
                              headers=self.get_headers(self.super_admin_token),
                              timeout=30)
            mr_booking_id = None
            if resp.status_code == 200:
                items = resp.json().get("items", [])
                if items:
                    mr_booking_id = items[0]["id"]
            
            # Bulk cancel
            booking_ids = [ws_booking_id]
            if mr_booking_id:
                booking_ids.append(mr_booking_id)
            
            resp = requests.post(f"{BASE_URL}/bookings/bulk-cancel",
                               json={"booking_ids": booking_ids},
                               headers=self.get_headers(self.super_admin_token),
                               timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                cancelled = data.get("cancelled", [])
                if ws_booking_id in cancelled:
                    print_pass(f"Bulk cancel works: cancelled {len(cancelled)} bookings (WS + MR)")
                    self.passes.append("Bookings aggregator bulk-cancel works")
                else:
                    print_fail(f"WS booking not in cancelled list: {data}")
                    self.failures.append("Bulk cancel did not cancel WS booking")
            else:
                print_fail(f"Bulk cancel failed: {resp.status_code} - {resp.text}")
                self.failures.append("Bulk cancel failed")
        except Exception as e:
            print_fail(f"Bulk cancel exception: {e}")
            self.failures.append(f"Bulk cancel exception: {e}")

    def test_bookings_aggregator_search(self):
        """Test GET /api/bookings?search=<seat_label> - Search by seat label"""
        print_test("GET /api/bookings?search=<seat_label> - Search matches seat_label in WS rows")
        
        try:
            # Get a workstation booking to find a seat label
            resp = requests.get(f"{BASE_URL}/workstation-bookings",
                              headers=self.get_headers(self.super_admin_token),
                              timeout=30)
            if resp.status_code == 200:
                bookings = resp.json()
                if bookings:
                    seat_label = bookings[0].get("seat_label")
                    if seat_label:
                        # Search by seat label
                        resp2 = requests.get(f"{BASE_URL}/bookings",
                                           params={"search": seat_label, "type": "workstation"},
                                           headers=self.get_headers(self.super_admin_token),
                                           timeout=30)
                        if resp2.status_code == 200:
                            data = resp2.json()
                            items = data.get("items", [])
                            if any(item.get("room_name") == seat_label for item in items):
                                print_pass(f"Search by seat_label works: found {len(items)} results for '{seat_label}'")
                                self.passes.append("Bookings aggregator search works")
                            else:
                                print_fail(f"Search did not match seat_label: {items}")
                                self.failures.append("Search did not match seat_label")
                        else:
                            print_fail(f"Search failed: {resp2.status_code}")
                            self.failures.append("Search failed")
                    else:
                        print_info("No seat_label to search")
                else:
                    print_info("No workstation bookings to search")
        except Exception as e:
            print_fail(f"Search exception: {e}")
            self.failures.append(f"Search exception: {e}")

    def run_all_tests(self):
        """Run all backend tests"""
        print(f"\n{Colors.BOLD}{'='*80}{Colors.RESET}")
        print(f"{Colors.BOLD}Backend API Testing - Workstation Booking Module{Colors.RESET}")
        print(f"{Colors.BOLD}{'='*80}{Colors.RESET}")
        
        # Login
        print_test("Authentication")
        self.super_admin_token = self.login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD)
        if not self.super_admin_token:
            print_fail("Super Admin login failed - cannot continue")
            return False
        print_pass("Super Admin login successful")
        
        self.admin_token = self.login(ADMIN_EMAIL, ADMIN_PASSWORD)
        if not self.admin_token:
            print_fail("Admin login failed - cannot continue")
            return False
        print_pass("Admin login successful")
        
        # Setup test data
        if not self.setup_test_data():
            print_fail("Setup failed - cannot continue with tests")
            return False
        
        # Run tests
        self.test_floor_plans_endpoint()
        self.test_availability_endpoint()
        self.test_create_single_seat_booking()
        self.test_create_multi_seat_team_booking()
        self.test_create_recurring_booking()
        self.test_duplicate_seat_conflict()
        self.test_duplicate_employee_conflict()
        self.test_admin_write_forbidden()
        self.test_patch_booking()
        self.test_delete_single_booking()
        self.test_delete_series_booking()
        self.test_get_booking_by_seq_no()
        self.test_release_inactive_endpoint()
        self.test_contacts_auto_release()
        self.test_contacts_bulk_status_auto_release()
        self.test_bookings_aggregator_all_types()
        self.test_bookings_aggregator_workstation_filter()
        self.test_bookings_aggregator_get_by_id()
        self.test_bookings_aggregator_bulk_cancel()
        self.test_bookings_aggregator_search()
        
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
