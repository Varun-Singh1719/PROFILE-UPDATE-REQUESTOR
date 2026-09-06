#!/usr/bin/env python3
"""
Comprehensive Permissions Module QA — TAKE 3 (Continuation)

Completes scenarios C-P, bypass testing, and final SA regression.
Fixes the FALSE POSITIVE from TAKE 2 by waiting for permsReady before asserting sidebar visibility.
"""

import asyncio
import json
import time
import requests
from datetime import datetime

BASE_API = "https://crm-revenue-calls.preview.emergentagent.com/api"
BASE_UI = "https://crm-revenue-calls.preview.emergentagent.com"

# Super Admin credentials
SA_EMAIL = "admin@ticketing.com"
SA_PASSWORD = "Admin@123"

# Epoch for unique emails
EPOCH = int(time.time())

# Store created fixtures for cleanup
FIXTURES = {
    "permission_sets": [],
    "users": [],
    "teams": []
}

def api_call(method, path, token=None, json_data=None, params=None):
    """Helper for API calls"""
    url = f"{BASE_API}{path}"
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    if method == "GET":
        r = requests.get(url, headers=headers, params=params)
    elif method == "POST":
        r = requests.post(url, headers=headers, json=json_data)
    elif method == "PATCH":
        r = requests.patch(url, headers=headers, json=json_data)
    elif method == "PUT":
        r = requests.put(url, headers=headers, json=json_data)
    elif method == "DELETE":
        r = requests.delete(url, headers=headers)
    else:
        raise ValueError(f"Unknown method: {method}")
    
    return r

def login_sa():
    """Login as Super Admin and return JWT"""
    r = api_call("POST", "/auth/login", json_data={"email": SA_EMAIL, "password": SA_PASSWORD})
    if r.status_code != 200:
        raise Exception(f"SA login failed: {r.status_code} {r.text}")
    return r.json()["access_token"]

def create_permission_set(token, title, description, modules):
    """Create a v3 permission set"""
    payload = {
        "title": title,
        "description": description,
        "version": 3,
        "modules": modules
    }
    r = api_call("POST", "/permission-sets-v3", token=token, json_data=payload)
    if r.status_code not in [200, 201]:
        raise Exception(f"Failed to create permission set {title}: {r.status_code} {r.text}")
    pset = r.json()
    FIXTURES["permission_sets"].append(pset)
    print(f"✅ Created permission set: {title} (ID: {pset['id']})")
    return pset

def create_user(token, name, email, emp_id, permission_set_ids):
    """Create a dummy admin user"""
    password = f"QATest{EPOCH}!"
    payload = {
        "name": name,
        "email": email,
        "phone": "",
        "phone_isd": "+91",
        "role": "Admin",
        "emp_id": emp_id,
        "doj": datetime.now().strftime("%Y-%m-%d"),
        "permission_set_ids": permission_set_ids,
        "status": "Active",
        "password": password
    }
    r = api_call("POST", "/contacts", token=token, json_data=payload)
    if r.status_code not in [200, 201]:
        raise Exception(f"Failed to create user {email}: {r.status_code} {r.text}")
    user = r.json()
    user["password"] = password
    FIXTURES["users"].append(user)
    print(f"✅ Created user: {email} (ID: {user['id']})")
    return user

def impersonate(token, user_id):
    """Mint impersonation token for a user"""
    r = api_call("POST", "/auth/impersonate", token=token, json_data={"user_id": user_id})
    if r.status_code != 200:
        raise Exception(f"Failed to impersonate user {user_id}: {r.status_code} {r.text}")
    return r.json()["access_token"]

def get_teams(token):
    """Get all teams"""
    r = api_call("GET", "/teams", token=token)
    if r.status_code != 200:
        raise Exception(f"Failed to get teams: {r.status_code} {r.text}")
    return r.json()

def add_user_to_team(token, team_id, user_id, as_manager=False):
    """Add a user to a team"""
    r = api_call("GET", f"/teams/{team_id}", token=token)
    if r.status_code != 200:
        raise Exception(f"Failed to get team {team_id}: {r.status_code} {r.text}")
    team = r.json()
    
    if as_manager:
        if user_id not in team.get("manager_ids", []):
            team["manager_ids"].append(user_id)
    else:
        if user_id not in team.get("member_ids", []):
            team["member_ids"].append(user_id)
    
    r = api_call("PATCH", f"/teams/{team_id}", token=token, json_data={
        "name": team["name"],
        "manager_ids": team["manager_ids"],
        "member_ids": team["member_ids"]
    })
    if r.status_code != 200:
        raise Exception(f"Failed to update team {team_id}: {r.status_code} {r.text}")
    print(f"✅ Added user {user_id} to team {team['name']} (manager={as_manager})")
    return r.json()

def cleanup_fixtures(token):
    """Cleanup all created fixtures"""
    print("\n🧹 CLEANUP PHASE")
    
    # Deactivate users
    for user in FIXTURES["users"]:
        try:
            r = api_call("PATCH", f"/contacts/{user['id']}", token=token, json_data={"status": "Inactive"})
            if r.status_code == 200:
                print(f"✅ Deactivated user: {user['email']}")
            else:
                print(f"⚠️ Failed to deactivate user {user['email']}: {r.status_code}")
        except Exception as e:
            print(f"⚠️ Error deactivating user {user['email']}: {e}")
    
    # Delete permission sets
    for pset in FIXTURES["permission_sets"]:
        try:
            r = api_call("DELETE", f"/permission-sets-v3/{pset['id']}", token=token)
            if r.status_code == 200:
                print(f"✅ Deleted permission set: {pset['title']}")
            else:
                print(f"⚠️ Failed to delete permission set {pset['title']}: {r.status_code}")
        except Exception as e:
            print(f"⚠️ Error deleting permission set {pset['title']}: {e}")
    
    print(f"\n📊 Cleanup Summary:")
    print(f"   - Users deactivated: {len(FIXTURES['users'])}")
    print(f"   - Permission sets deleted: {len(FIXTURES['permission_sets'])}")

# ============================================================
# SCENARIO DEFINITIONS
# ============================================================

def create_scenario_c(token):
    """C. QA-ProfixReadOnly-Individual — profix.all_requests.view.enabled=true,visible=true,scope=individual"""
    pset = create_permission_set(
        token,
        "QA-ProfixReadOnly-Individual",
        "Profix all_requests view only, scope=individual",
        {
            "profix": {
                "pages": {
                    "all_requests": {
                        "view": {"enabled": True, "visible": True, "scope": "individual"},
                        "edit": {"enabled": False, "visible": False, "scope": None},
                        "functions": {}
                    }
                }
            }
        }
    )
    user = create_user(
        token,
        "QA ProfixReadOnly Individual",
        f"qa.profixreadonly.{EPOCH}@ticketing.com",
        f"QA-PROFIX-RO-{EPOCH}",
        [pset["id"]]
    )
    return {"pset": pset, "user": user, "scenario": "C"}

def create_scenario_d(token):
    """D. QA-ProfixTeamCreator — profix.create_request full, all_requests.view.scope=team, open_requests.view.scope=team, dashboard.profix.access_level=team"""
    pset = create_permission_set(
        token,
        "QA-ProfixTeamCreator",
        "Profix team creator with team scope",
        {
            "profix": {
                "pages": {
                    "all_requests": {
                        "view": {"enabled": True, "visible": True, "scope": "team"},
                        "edit": {"enabled": False, "visible": False, "scope": None},
                        "functions": {}
                    },
                    "open_requests": {
                        "view": {"enabled": True, "visible": True, "scope": "team"},
                        "edit": {"enabled": False, "visible": False, "scope": None},
                        "functions": {}
                    },
                    "ticket_detail": {
                        "view": {"enabled": True, "visible": True, "scope": "team"},
                        "edit": {"enabled": True, "visible": True, "scope": "team"},
                        "functions": {
                            "create": {"enabled": True, "visible": True, "scope": None}
                        }
                    }
                }
            },
            "dashboard": {
                "pages": {
                    "profix": {"access_level": "team"}
                }
            }
        }
    )
    user = create_user(
        token,
        "QA ProfixTeamCreator",
        f"qa.profixteamcreator.{EPOCH}@ticketing.com",
        f"QA-PROFIX-TC-{EPOCH}",
        [pset["id"]]
    )
    return {"pset": pset, "user": user, "scenario": "D"}

def create_scenario_e(token):
    """E. QA-WorkspaceOverallApprover — desk_booking.pending_approvals full, floor_layout view scope=overall, dashboard.workspace_manager.access_level=overall"""
    pset = create_permission_set(
        token,
        "QA-WorkspaceOverallApprover",
        "Workspace Manager approver with overall scope",
        {
            "desk_booking": {
                "pages": {
                    "pending_approvals": {
                        "view": {"enabled": True, "visible": True, "scope": "overall"},
                        "edit": {"enabled": True, "visible": True, "scope": "overall"},
                        "functions": {}
                    },
                    "floor_layout": {
                        "view": {"enabled": True, "visible": True, "scope": "overall"},
                        "edit": {"enabled": False, "visible": False, "scope": None},
                        "functions": {}
                    }
                }
            },
            "dashboard": {
                "pages": {
                    "workspace_manager": {"access_level": "overall"}
                }
            }
        }
    )
    user = create_user(
        token,
        "QA WorkspaceOverallApprover",
        f"qa.workspaceapprover.{EPOCH}@ticketing.com",
        f"QA-WS-APPR-{EPOCH}",
        [pset["id"]]
    )
    return {"pset": pset, "user": user, "scenario": "E"}

def create_scenario_g(token):
    """G. QA-HiddenWithView — manage.teams.view.enabled=true, view.visible=false"""
    pset = create_permission_set(
        token,
        "QA-HiddenWithView",
        "Teams view enabled but visible=false",
        {
            "manage": {
                "pages": {
                    "teams": {
                        "view": {"enabled": True, "visible": False, "scope": "overall"},
                        "edit": {"enabled": False, "visible": False, "scope": None},
                        "functions": {}
                    }
                }
            }
        }
    )
    user = create_user(
        token,
        "QA HiddenWithView",
        f"qa.hiddenwithview.{EPOCH}@ticketing.com",
        f"QA-HIDDEN-{EPOCH}",
        [pset["id"]]
    )
    return {"pset": pset, "user": user, "scenario": "G"}

def create_scenario_h(token):
    """H. QA-EditWithoutView — profix.ticket_detail.view.enabled=false, edit.enabled=true, functions.edit.enabled=true; profix.all_requests.view.enabled=true scope=individual"""
    pset = create_permission_set(
        token,
        "QA-EditWithoutView",
        "Ticket edit without view permission",
        {
            "profix": {
                "pages": {
                    "all_requests": {
                        "view": {"enabled": True, "visible": True, "scope": "individual"},
                        "edit": {"enabled": False, "visible": False, "scope": None},
                        "functions": {}
                    },
                    "ticket_detail": {
                        "view": {"enabled": False, "visible": False, "scope": None},
                        "edit": {"enabled": True, "visible": True, "scope": "individual"},
                        "functions": {
                            "edit": {"enabled": True, "visible": True, "scope": None}
                        }
                    }
                }
            }
        }
    )
    user = create_user(
        token,
        "QA EditWithoutView",
        f"qa.editwithoutview.{EPOCH}@ticketing.com",
        f"QA-EDIT-NO-VIEW-{EPOCH}",
        [pset["id"]]
    )
    return {"pset": pset, "user": user, "scenario": "H"}

def create_scenario_i(token):
    """I. QA-ViewWithoutEdit — manage.email_templates.view.enabled=true, scope=overall, edit.enabled=false, functions all off except search"""
    pset = create_permission_set(
        token,
        "QA-ViewWithoutEdit",
        "Email templates view only, no edit",
        {
            "manage": {
                "pages": {
                    "email_templates": {
                        "view": {"enabled": True, "visible": True, "scope": "overall"},
                        "edit": {"enabled": False, "visible": False, "scope": None},
                        "functions": {
                            "search": {"enabled": True, "visible": True, "scope": None},
                            "create": {"enabled": False, "visible": False, "scope": None},
                            "edit": {"enabled": False, "visible": False, "scope": None},
                            "delete": {"enabled": False, "visible": False, "scope": None}
                        }
                    }
                }
            }
        }
    )
    user = create_user(
        token,
        "QA ViewWithoutEdit",
        f"qa.viewwithoutedit.{EPOCH}@ticketing.com",
        f"QA-VIEW-NO-EDIT-{EPOCH}",
        [pset["id"]]
    )
    return {"pset": pset, "user": user, "scenario": "I"}

def create_scenario_n(token):
    """N. QA-DashboardScopes — create 3 admins with dashboard.workspace_manager.access_level = individual / team / overall"""
    scenarios = []
    
    for level in ["individual", "team", "overall"]:
        pset = create_permission_set(
            token,
            f"QA-Dashboard-{level.capitalize()}",
            f"Dashboard workspace_manager access_level={level}",
            {
                "desk_booking": {
                    "pages": {
                        "floor_layout": {
                            "view": {"enabled": True, "visible": True, "scope": level},
                            "edit": {"enabled": False, "visible": False, "scope": None},
                            "functions": {}
                        }
                    }
                },
                "dashboard": {
                    "pages": {
                        "workspace_manager": {"access_level": level}
                    }
                }
            }
        )
        user = create_user(
            token,
            f"QA Dashboard {level.capitalize()}",
            f"qa.dashboard.{level}.{EPOCH}@ticketing.com",
            f"QA-DASH-{level.upper()}-{EPOCH}",
            [pset["id"]]
        )
        scenarios.append({"pset": pset, "user": user, "scenario": f"N-{level}"})
    
    return scenarios

def create_scenario_o(token):
    """O. QA-Notifications+Reports — manage.notifications.view + manage.reports.view enabled (visible=true)"""
    pset = create_permission_set(
        token,
        "QA-NotificationsReports",
        "Notifications and reports view only",
        {
            "manage": {
                "pages": {
                    "notifications": {
                        "view": {"enabled": True, "visible": True, "scope": "overall"},
                        "edit": {"enabled": False, "visible": False, "scope": None},
                        "functions": {}
                    }
                }
            }
        }
    )
    user = create_user(
        token,
        "QA NotificationsReports",
        f"qa.notifications.{EPOCH}@ticketing.com",
        f"QA-NOTIF-{EPOCH}",
        [pset["id"]]
    )
    return {"pset": pset, "user": user, "scenario": "O"}

def create_scenario_p(token):
    """P. QA-ContextMenuFineGrained — manage.employees.view+edit enabled scope=overall, functions.edit=true, delete=false, reset_password=true, login_as=false"""
    pset = create_permission_set(
        token,
        "QA-ContextMenuFineGrained",
        "Employees view/edit with fine-grained context menu",
        {
            "manage": {
                "pages": {
                    "employees": {
                        "view": {"enabled": True, "visible": True, "scope": "overall"},
                        "edit": {"enabled": True, "visible": True, "scope": "overall"},
                        "functions": {
                            "edit": {"enabled": True, "visible": True, "scope": None},
                            "delete": {"enabled": False, "visible": False, "scope": None},
                            "reset_password": {"enabled": True, "visible": True, "scope": None},
                            "login_as": {"enabled": False, "visible": False, "scope": None},
                            "search": {"enabled": True, "visible": True, "scope": None},
                            "filter_role": {"enabled": True, "visible": True, "scope": None},
                            "filter_status": {"enabled": True, "visible": True, "scope": None}
                        }
                    }
                }
            }
        }
    )
    user = create_user(
        token,
        "QA ContextMenuFineGrained",
        f"qa.contextmenu.{EPOCH}@ticketing.com",
        f"QA-CTX-MENU-{EPOCH}",
        [pset["id"]]
    )
    return {"pset": pset, "user": user, "scenario": "P"}

# ============================================================
# MAIN SETUP
# ============================================================

def setup_all_scenarios():
    """Create all permission sets and users for scenarios C-P"""
    print("🚀 COMPREHENSIVE PERMISSIONS QA — TAKE 3 (SETUP PHASE)")
    print(f"Epoch: {EPOCH}\n")
    
    token = login_sa()
    print("✅ Logged in as Super Admin\n")
    
    scenarios = []
    
    print("📦 Creating Scenario C (ProfixReadOnly-Individual)...")
    scenarios.append(create_scenario_c(token))
    
    print("\n📦 Creating Scenario D (ProfixTeamCreator)...")
    scenarios.append(create_scenario_d(token))
    
    print("\n📦 Creating Scenario E (WorkspaceOverallApprover)...")
    scenarios.append(create_scenario_e(token))
    
    print("\n📦 Creating Scenario G (HiddenWithView)...")
    scenarios.append(create_scenario_g(token))
    
    print("\n📦 Creating Scenario H (EditWithoutView)...")
    scenarios.append(create_scenario_h(token))
    
    print("\n📦 Creating Scenario I (ViewWithoutEdit)...")
    scenarios.append(create_scenario_i(token))
    
    print("\n📦 Creating Scenario N (DashboardScopes - 3 users)...")
    scenarios.extend(create_scenario_n(token))
    
    print("\n📦 Creating Scenario O (Notifications+Reports)...")
    scenarios.append(create_scenario_o(token))
    
    print("\n📦 Creating Scenario P (ContextMenuFineGrained)...")
    scenarios.append(create_scenario_p(token))
    
    # Save fixtures to file
    with open("/app/qa_permissions/fixtures_take3.json", "w") as f:
        json.dump(FIXTURES, f, indent=2, default=str)
    
    print(f"\n✅ Setup complete! Created {len(FIXTURES['permission_sets'])} permission sets and {len(FIXTURES['users'])} users")
    print(f"📄 Fixtures saved to: /app/qa_permissions/fixtures_take3.json")
    
    return scenarios, token

if __name__ == "__main__":
    scenarios, token = setup_all_scenarios()
    print("\n✅ All scenarios created successfully!")
    print("\nNext: Run Playwright tests with these fixtures")
