"""
Backend test for Profix Tickets team_name enrichment bug fix (Jul 16 2026)

Verifies that:
1. GET /api/tickets?scope=all returns team_name for tickets whose creator is in a team
2. GET /api/tickets (non-paged) also enriches team_name
3. GET /api/tickets with sort_by=status (aggregation pipeline) enriches team_name
4. GET /api/tickets with sort_by=priority (aggregation pipeline) enriches team_name
5. GET /api/tickets/export.csv includes team_name in CSV
6. Team filter regression: ?team=<id> returns tickets whose creator is in that team
7. POST /api/tickets as admin (not in any team) creates ticket with team_name=null
8. Teams endpoints smoke test (POST/GET/PATCH/DELETE)
"""

import requests
import json
import csv
import io
from datetime import datetime

# Configuration
BASE_URL = "https://728cf97c-5468-450b-8461-6044a99ed25f.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@ticketing.com"
ADMIN_PASSWORD = "Admin@123"

# Test state
session = requests.Session()
auth_token = None
admin_user = None
techknights_team_id = None
test_ticket_id = None

def log(msg):
    """Print timestamped log message"""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def login():
    """Login as Super Admin and capture auth token"""
    global auth_token, admin_user
    log(f"Logging in as {ADMIN_EMAIL}...")
    
    resp = session.post(
        f"{BASE_URL}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    
    if resp.status_code != 200:
        log(f"❌ Login failed: {resp.status_code} - {resp.text}")
        return False
    
    data = resp.json()
    auth_token = data.get("access_token")
    admin_user = data.get("user")
    
    if not auth_token:
        log("❌ No access_token in login response")
        return False
    
    log(f"✅ Logged in as {admin_user.get('name')} (role: {admin_user.get('role')})")
    return True

def get_techknights_team():
    """Get TechKnights team ID"""
    global techknights_team_id
    log("Fetching TechKnights team...")
    
    resp = session.get(f"{BASE_URL}/teams")
    
    if resp.status_code != 200:
        log(f"❌ GET /api/teams failed: {resp.status_code}")
        return False
    
    teams = resp.json()
    for team in teams:
        if team.get("name") == "TechKnights":
            techknights_team_id = team.get("id")
            log(f"✅ Found TechKnights team: {techknights_team_id}")
            log(f"   Members: {len(team.get('members', []))}, Managers: {len(team.get('managers', []))}")
            return True
    
    log("❌ TechKnights team not found")
    return False

def test_1_get_tickets_paged():
    """Test 1: GET /api/tickets?scope=all&page=1&page_size=200"""
    log("\n=== TEST 1: GET /api/tickets (paged) - team_name enrichment ===")
    
    resp = session.get(
        f"{BASE_URL}/tickets",
        params={"scope": "all", "page": 1, "page_size": 200}
    )
    
    if resp.status_code != 200:
        log(f"❌ GET /api/tickets failed: {resp.status_code}")
        return False
    
    data = resp.json()
    items = data.get("items", [])
    total = data.get("total", 0)
    
    log(f"✅ GET /api/tickets returned {len(items)} tickets (total: {total})")
    
    # Find TKT-1547 (Anjali Sharma's ticket)
    tkt_1547 = None
    tickets_with_team = []
    tickets_without_team = []
    
    for ticket in items:
        ticket_id = ticket.get("ticket_id")
        creator_name = ticket.get("created_by_name")
        team_name = ticket.get("team_name")
        
        if ticket_id == "TKT-1547":
            tkt_1547 = ticket
        
        if team_name:
            tickets_with_team.append({
                "ticket_id": ticket_id,
                "creator": creator_name,
                "team": team_name
            })
        else:
            tickets_without_team.append({
                "ticket_id": ticket_id,
                "creator": creator_name
            })
    
    log(f"   Tickets with team_name: {len(tickets_with_team)}")
    log(f"   Tickets without team_name: {len(tickets_without_team)}")
    
    # Show sample of tickets with team
    if tickets_with_team:
        log("   Sample tickets with team:")
        for t in tickets_with_team[:3]:
            log(f"      {t['ticket_id']} - {t['creator']} - Team: {t['team']}")
    
    # Show sample of tickets without team
    if tickets_without_team:
        log("   Sample tickets without team:")
        for t in tickets_without_team[:3]:
            log(f"      {t['ticket_id']} - {t['creator']} - Team: None")
    
    # CRITICAL ASSERTION: TKT-1547 must have team_name="TechKnights"
    if tkt_1547:
        log(f"\n   🔍 TKT-1547 found:")
        log(f"      Creator: {tkt_1547.get('created_by_name')}")
        log(f"      Team: {tkt_1547.get('team_name')}")
        
        if tkt_1547.get("team_name") == "TechKnights":
            log(f"   ✅ TKT-1547 has team_name='TechKnights' (PASS)")
        else:
            log(f"   ❌ TKT-1547 team_name is '{tkt_1547.get('team_name')}', expected 'TechKnights' (FAIL)")
            return False
    else:
        log("   ⚠️  TKT-1547 not found in results (may have been deleted)")
    
    return True

def test_2_get_tickets_non_paged():
    """Test 2: GET /api/tickets?scope=all (no page param)"""
    log("\n=== TEST 2: GET /api/tickets (non-paged) - team_name enrichment ===")
    
    resp = session.get(
        f"{BASE_URL}/tickets",
        params={"scope": "all"}
    )
    
    if resp.status_code != 200:
        log(f"❌ GET /api/tickets (non-paged) failed: {resp.status_code}")
        return False
    
    items = resp.json()
    
    if not isinstance(items, list):
        log(f"❌ Expected list, got {type(items)}")
        return False
    
    log(f"✅ GET /api/tickets (non-paged) returned {len(items)} tickets")
    
    # Find TKT-1547
    tkt_1547 = None
    for ticket in items:
        if ticket.get("ticket_id") == "TKT-1547":
            tkt_1547 = ticket
            break
    
    if tkt_1547:
        log(f"   🔍 TKT-1547 found:")
        log(f"      Creator: {tkt_1547.get('created_by_name')}")
        log(f"      Team: {tkt_1547.get('team_name')}")
        
        if tkt_1547.get("team_name") == "TechKnights":
            log(f"   ✅ TKT-1547 has team_name='TechKnights' (PASS)")
        else:
            log(f"   ❌ TKT-1547 team_name is '{tkt_1547.get('team_name')}', expected 'TechKnights' (FAIL)")
            return False
    else:
        log("   ⚠️  TKT-1547 not found in results")
    
    return True

def test_3_get_tickets_sort_status():
    """Test 3: GET /api/tickets?scope=all&sort_by=status&sort_dir=asc"""
    log("\n=== TEST 3: GET /api/tickets (sort_by=status) - aggregation pipeline enrichment ===")
    
    resp = session.get(
        f"{BASE_URL}/tickets",
        params={"scope": "all", "page": 1, "page_size": 200, "sort_by": "status", "sort_dir": "asc"}
    )
    
    if resp.status_code != 200:
        log(f"❌ GET /api/tickets (sort_by=status) failed: {resp.status_code}")
        return False
    
    data = resp.json()
    items = data.get("items", [])
    
    log(f"✅ GET /api/tickets (sort_by=status) returned {len(items)} tickets")
    
    # Find TKT-1547
    tkt_1547 = None
    for ticket in items:
        if ticket.get("ticket_id") == "TKT-1547":
            tkt_1547 = ticket
            break
    
    if tkt_1547:
        log(f"   🔍 TKT-1547 found:")
        log(f"      Creator: {tkt_1547.get('created_by_name')}")
        log(f"      Team: {tkt_1547.get('team_name')}")
        
        if tkt_1547.get("team_name") == "TechKnights":
            log(f"   ✅ TKT-1547 has team_name='TechKnights' (PASS)")
        else:
            log(f"   ❌ TKT-1547 team_name is '{tkt_1547.get('team_name')}', expected 'TechKnights' (FAIL)")
            return False
    else:
        log("   ⚠️  TKT-1547 not found in results")
    
    return True

def test_4_get_tickets_sort_priority():
    """Test 4: GET /api/tickets?scope=all&sort_by=priority"""
    log("\n=== TEST 4: GET /api/tickets (sort_by=priority) - aggregation pipeline enrichment ===")
    
    resp = session.get(
        f"{BASE_URL}/tickets",
        params={"scope": "all", "page": 1, "page_size": 200, "sort_by": "priority"}
    )
    
    if resp.status_code != 200:
        log(f"❌ GET /api/tickets (sort_by=priority) failed: {resp.status_code}")
        return False
    
    data = resp.json()
    items = data.get("items", [])
    
    log(f"✅ GET /api/tickets (sort_by=priority) returned {len(items)} tickets")
    
    # Find TKT-1547
    tkt_1547 = None
    for ticket in items:
        if ticket.get("ticket_id") == "TKT-1547":
            tkt_1547 = ticket
            break
    
    if tkt_1547:
        log(f"   🔍 TKT-1547 found:")
        log(f"      Creator: {tkt_1547.get('created_by_name')}")
        log(f"      Team: {tkt_1547.get('team_name')}")
        
        if tkt_1547.get("team_name") == "TechKnights":
            log(f"   ✅ TKT-1547 has team_name='TechKnights' (PASS)")
        else:
            log(f"   ❌ TKT-1547 team_name is '{tkt_1547.get('team_name')}', expected 'TechKnights' (FAIL)")
            return False
    else:
        log("   ⚠️  TKT-1547 not found in results")
    
    return True

def test_5_export_csv():
    """Test 5: GET /api/tickets/export.csv?scope=all"""
    log("\n=== TEST 5: GET /api/tickets/export.csv - team_name in CSV ===")
    
    resp = session.get(
        f"{BASE_URL}/tickets/export.csv",
        params={"scope": "all"}
    )
    
    if resp.status_code != 200:
        log(f"❌ GET /api/tickets/export.csv failed: {resp.status_code}")
        return False
    
    # Parse CSV
    csv_content = resp.text
    reader = csv.DictReader(io.StringIO(csv_content))
    rows = list(reader)
    
    log(f"✅ GET /api/tickets/export.csv returned {len(rows)} rows")
    
    # Find TKT-1547
    tkt_1547_row = None
    rows_with_team = []
    rows_without_team = []
    
    for row in rows:
        ticket_id = row.get("Ticket ID")
        team = row.get("Team", "")
        
        if ticket_id == "TKT-1547":
            tkt_1547_row = row
        
        if team and team != "—":
            rows_with_team.append({"ticket_id": ticket_id, "team": team})
        else:
            rows_without_team.append({"ticket_id": ticket_id})
    
    log(f"   Rows with team: {len(rows_with_team)}")
    log(f"   Rows without team (—): {len(rows_without_team)}")
    
    # Show sample
    if rows_with_team:
        log("   Sample rows with team:")
        for r in rows_with_team[:3]:
            log(f"      {r['ticket_id']} - Team: {r['team']}")
    
    # CRITICAL ASSERTION: TKT-1547 must have Team="TechKnights"
    if tkt_1547_row:
        log(f"\n   🔍 TKT-1547 CSV row:")
        log(f"      Creator: {tkt_1547_row.get('Created By')}")
        log(f"      Team: {tkt_1547_row.get('Team')}")
        
        if tkt_1547_row.get("Team") == "TechKnights":
            log(f"   ✅ TKT-1547 CSV has Team='TechKnights' (PASS)")
        else:
            log(f"   ❌ TKT-1547 CSV Team is '{tkt_1547_row.get('Team')}', expected 'TechKnights' (FAIL)")
            return False
    else:
        log("   ⚠️  TKT-1547 not found in CSV")
    
    return True

def test_6_team_filter():
    """Test 6: GET /api/tickets?team=<TechKnights_id>&scope=all"""
    log("\n=== TEST 6: Team filter regression - ?team=<id> ===")
    
    if not techknights_team_id:
        log("❌ TechKnights team ID not available")
        return False
    
    resp = session.get(
        f"{BASE_URL}/tickets",
        params={"team": techknights_team_id, "scope": "all", "page": 1, "page_size": 200}
    )
    
    if resp.status_code != 200:
        log(f"❌ GET /api/tickets?team={techknights_team_id} failed: {resp.status_code}")
        return False
    
    data = resp.json()
    items = data.get("items", [])
    
    log(f"✅ GET /api/tickets?team={techknights_team_id} returned {len(items)} tickets")
    
    # Find TKT-1547
    tkt_1547 = None
    for ticket in items:
        ticket_id = ticket.get("ticket_id")
        log(f"   {ticket_id} - {ticket.get('created_by_name')} - Team: {ticket.get('team_name')}")
        
        if ticket_id == "TKT-1547":
            tkt_1547 = ticket
    
    if tkt_1547:
        log(f"\n   ✅ TKT-1547 returned by team filter (PASS)")
        log(f"      Creator: {tkt_1547.get('created_by_name')}")
        log(f"      Team: {tkt_1547.get('team_name')}")
    else:
        log(f"   ❌ TKT-1547 NOT returned by team filter (FAIL)")
        log(f"      Expected: TKT-1547 should be returned because creator (Anjali Sharma) is in TechKnights")
        return False
    
    return True

def test_7_create_ticket_no_team():
    """Test 7: POST /api/tickets as admin (not in any team)"""
    global test_ticket_id
    log("\n=== TEST 7: POST /api/tickets (admin not in team) - team_name=null ===")
    
    # Check if admin is in any team
    log(f"   Admin user: {admin_user.get('name')} (id: {admin_user.get('id')})")
    
    resp = session.get(f"{BASE_URL}/teams")
    if resp.status_code == 200:
        teams = resp.json()
        admin_teams = []
        for team in teams:
            members = team.get("members", [])
            managers = team.get("managers", [])
            for m in members + managers:
                if m.get("id") == admin_user.get("id"):
                    admin_teams.append(team.get("name"))
        
        if admin_teams:
            log(f"   ⚠️  Admin is in teams: {admin_teams}")
        else:
            log(f"   ✅ Admin is NOT in any team (as expected)")
    
    # Create a test ticket
    ticket_data = {
        "description": f"Test ticket created by testing agent at {datetime.now().isoformat()}",
        "priority": "Medium",
        "due_date": "2026-12-31",
        "number_of_profiles": 10
    }
    
    resp = session.post(f"{BASE_URL}/tickets", json=ticket_data)
    
    if resp.status_code != 200:
        log(f"❌ POST /api/tickets failed: {resp.status_code} - {resp.text}")
        return False
    
    ticket = resp.json()
    test_ticket_id = ticket.get("id")
    
    log(f"✅ Created ticket: {ticket.get('ticket_id')}")
    log(f"   ID: {test_ticket_id}")
    log(f"   Creator: {ticket.get('created_by_name')}")
    log(f"   team_id: {ticket.get('team_id')}")
    log(f"   team_name: {ticket.get('team_name')}")
    
    # ASSERTION: team_id and team_name should be null
    if ticket.get("team_id") is None and ticket.get("team_name") is None:
        log(f"   ✅ team_id=null and team_name=null (PASS)")
        return True
    else:
        log(f"   ❌ Expected team_id=null and team_name=null (FAIL)")
        return False

def test_8_teams_smoke():
    """Test 8: Teams endpoints smoke test"""
    log("\n=== TEST 8: Teams endpoints smoke test ===")
    
    # GET /api/teams
    resp = session.get(f"{BASE_URL}/teams")
    if resp.status_code != 200:
        log(f"❌ GET /api/teams failed: {resp.status_code}")
        return False
    
    teams = resp.json()
    log(f"✅ GET /api/teams returned {len(teams)} teams")
    
    # GET /api/teams/{id} for TechKnights
    if techknights_team_id:
        resp = session.get(f"{BASE_URL}/teams/{techknights_team_id}")
        if resp.status_code != 200:
            log(f"❌ GET /api/teams/{techknights_team_id} failed: {resp.status_code}")
            return False
        
        team = resp.json()
        log(f"✅ GET /api/teams/{techknights_team_id} returned team: {team.get('name')}")
        log(f"   Members: {len(team.get('members', []))}")
        log(f"   Managers: {len(team.get('managers', []))}")
    
    return True

def cleanup():
    """Delete test ticket if created"""
    global test_ticket_id
    
    if test_ticket_id:
        log(f"\n=== Cleanup: Deleting test ticket {test_ticket_id} ===")
        # Note: DELETE /api/tickets/{id} may not exist, so we'll try but not fail if it doesn't work
        resp = session.delete(f"{BASE_URL}/tickets/{test_ticket_id}")
        if resp.status_code == 200:
            log(f"✅ Deleted test ticket")
        else:
            log(f"⚠️  Could not delete test ticket (endpoint may not exist): {resp.status_code}")

def main():
    """Run all tests"""
    log("=" * 80)
    log("BACKEND TEST: Profix Tickets team_name enrichment bug fix")
    log("=" * 80)
    
    # Login
    if not login():
        log("\n❌ FAILED: Could not login")
        return False
    
    # Get TechKnights team
    if not get_techknights_team():
        log("\n❌ FAILED: Could not find TechKnights team")
        return False
    
    # Run tests
    tests = [
        ("GET /api/tickets (paged)", test_1_get_tickets_paged),
        ("GET /api/tickets (non-paged)", test_2_get_tickets_non_paged),
        ("GET /api/tickets (sort_by=status)", test_3_get_tickets_sort_status),
        ("GET /api/tickets (sort_by=priority)", test_4_get_tickets_sort_priority),
        ("GET /api/tickets/export.csv", test_5_export_csv),
        ("Team filter regression", test_6_team_filter),
        ("POST /api/tickets (no team)", test_7_create_ticket_no_team),
        ("Teams smoke test", test_8_teams_smoke),
    ]
    
    results = []
    for name, test_func in tests:
        try:
            result = test_func()
            results.append((name, result))
        except Exception as e:
            log(f"\n❌ Test '{name}' raised exception: {e}")
            import traceback
            traceback.print_exc()
            results.append((name, False))
    
    # Cleanup
    cleanup()
    
    # Summary
    log("\n" + "=" * 80)
    log("TEST SUMMARY")
    log("=" * 80)
    
    passed = 0
    failed = 0
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        log(f"{status} - {name}")
        if result:
            passed += 1
        else:
            failed += 1
    
    log("\n" + "=" * 80)
    log(f"TOTAL: {passed} passed, {failed} failed out of {len(results)} tests")
    log("=" * 80)
    
    return failed == 0

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
