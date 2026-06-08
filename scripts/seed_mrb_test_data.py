"""Seed test data for Meeting Room Booking UI verification.

Creates:
  - 3 extra test users (contacts) so we have variety
  - 3 teams with members assigned so `organizer_team_name` enrichment surfaces them
  - 1 floor plan with a published version that contains 3 meeting rooms
  - 7 upcoming room bookings spanning today/tomorrow/next week with different organizers and titles
    (one of them recurring fortnightly so the "Fortnightly" frequency is exercised end-to-end)

Run:  python3 /app/scripts/seed_mrb_test_data.py
"""
from __future__ import annotations
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

# Reuse the backend's env loading + db connection by importing from there
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from motor.motor_asyncio import AsyncIOMotorClient
import bcrypt

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def iso(dt: datetime) -> str:
    return dt.isoformat()


def today_at(h: int, m: int = 0, day_offset: int = 0) -> datetime:
    base = datetime.now().replace(second=0, microsecond=0)
    base = base + timedelta(days=day_offset)
    return base.replace(hour=h, minute=m)


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    print(f"Connected to {DB_NAME}")

    # ------------------------------------------------------------------------
    # 1) Extra test users
    # ------------------------------------------------------------------------
    extra_users = [
        {"name": "Yamini Bakshi", "email": "yamini@ticketing.com", "phone": "+919900000001"},
        {"name": "Arjun Mehra",   "email": "arjun@ticketing.com",  "phone": "+919900000002"},
        {"name": "Priya Kapur",   "email": "priya@ticketing.com",  "phone": "+919900000003"},
    ]
    created_users = []
    for u in extra_users:
        existing = await db.contacts.find_one({"email": u["email"]})
        if existing:
            print(f"  user exists  : {u['email']} (id={existing['id'][:8]})")
            created_users.append(existing)
            continue
        uid = str(uuid.uuid4())
        # next emp_id
        n = await db.contacts.count_documents({})
        emp_id = f"EMP-{str(n + 1).zfill(4)}"
        doc = {
            "id": uid,
            "name": u["name"],
            "email": u["email"],
            "phone": u["phone"],
            "role": "Admin",
            "status": "Active",
            "emp_id": emp_id,
            "doj": "2024-06-01",
            "type": "Internal",
            "permission_set_ids": [],
            "password_hash": hash_password("Test@123"),
            "password_enc": None,
            "created_on": now_iso(),
            "last_login": None,
        }
        await db.contacts.insert_one(doc)
        created_users.append(doc)
        print(f"  user created : {u['email']} (id={uid[:8]})")

    # Pull every contact for cross-referencing
    contacts_all = await db.contacts.find({}, {"_id": 0}).to_list(500)
    by_email = {c["email"]: c for c in contacts_all}

    # ------------------------------------------------------------------------
    # 2) Teams — link the same users that booking organizers will use
    # ------------------------------------------------------------------------
    teams_spec = [
        {
            "name": "DQ Team",
            "color": "#10b981",
            "members": ["dq1@ticketing.com", "dq2@ticketing.com", "yamini@ticketing.com"],
            "managers": ["manager@ticketing.com"],
        },
        {
            "name": "Research Team",
            "color": "#3b82f6",
            "members": ["ra@ticketing.com", "arjun@ticketing.com"],
            "managers": ["manager@ticketing.com"],
        },
        {
            "name": "Design Squad",
            "color": "#a855f7",
            "members": ["priya@ticketing.com"],
            "managers": [],
        },
    ]
    for t in teams_spec:
        existing = await db.teams.find_one({"name": t["name"]})
        member_ids = [by_email[e]["id"] for e in t["members"] if e in by_email]
        manager_ids = [by_email[e]["id"] for e in t["managers"] if e in by_email]
        members = [
            {"id": by_email[e]["id"], "name": by_email[e]["name"], "email": by_email[e]["email"]}
            for e in t["members"] if e in by_email
        ]
        if existing:
            await db.teams.update_one(
                {"id": existing["id"]},
                {"$set": {
                    "color": t["color"],
                    "member_ids": member_ids,
                    "manager_ids": manager_ids,
                    "members": members,
                }},
            )
            print(f"  team updated : {t['name']} (members={len(member_ids)})")
            continue
        tid = str(uuid.uuid4())
        doc = {
            "id": tid,
            "name": t["name"],
            "color": t["color"],
            "member_ids": member_ids,
            "manager_ids": manager_ids,
            "members": members,
            "created_on": now_iso(),
        }
        await db.teams.insert_one(doc)
        print(f"  team created : {t['name']} (id={tid[:8]}, members={len(member_ids)})")

    # ------------------------------------------------------------------------
    # 3) Floor plan + published version with 3 meeting rooms
    # ------------------------------------------------------------------------
    PLAN_NAME = "HQ — Ground Floor"
    plan = await db.floor_plans.find_one({"name": PLAN_NAME})
    if plan and plan.get("live_version_id"):
        print(f"  plan exists  : {PLAN_NAME} (id={plan['id'][:8]}, live={plan['live_version_id'][:8]})")
        live_version_id = plan["live_version_id"]
        version = await db.floor_plan_versions.find_one({"id": live_version_id})
        plan_id = plan["id"]
    else:
        plan_id = str(uuid.uuid4())
        version_id = str(uuid.uuid4())
        actor = {"id": by_email["admin@ticketing.com"]["id"], "name": "Admin User", "email": "admin@ticketing.com"}
        # Three meeting rooms with normalized x/y/w/h in percentages.
        rooms = [
            {"id": str(uuid.uuid4()), "name": "Maple Room",   "capacity": 8,  "x": 10, "y": 10, "w": 22, "h": 18},
            {"id": str(uuid.uuid4()), "name": "Cedar Room",   "capacity": 12, "x": 40, "y": 12, "w": 26, "h": 20},
            {"id": str(uuid.uuid4()), "name": "Willow Pod",   "capacity": 4,  "x": 72, "y": 14, "w": 16, "h": 14},
        ]
        # The PDF URL field is required but the booking flow only uses room ids — any value works
        # for the booking API. The floor map preview won't render the PDF without a real file though.
        dummy_pdf = "/uploads/floor_plans/placeholder.pdf"
        await db.floor_plan_versions.insert_one({
            "id": version_id,
            "plan_id": plan_id,
            "version_number": 1,
            "state": "published",
            "seats": [],
            "rooms": rooms,
            "pdfUrl": dummy_pdf,
            "name": PLAN_NAME,
            "comments": "Seeded for MRB UI verification",
            "diff_summary": {"counts": {"added": 0, "removed": 0, "modified": 0}, "added": [], "removed": [], "modified": []},
            "created_at": now_iso(),
            "created_by": actor,
        })
        await db.floor_plans.insert_one({
            "id": plan_id,
            "name": PLAN_NAME,
            "pdfUrl": dummy_pdf,
            "status_override": None,
            "live_version_id": version_id,
            "draft": None,
            "draft_updated_at": None,
            "created_at": now_iso(), "created_by": actor,
            "updated_at": now_iso(), "updated_by": actor,
        })
        version = await db.floor_plan_versions.find_one({"id": version_id})
        live_version_id = version_id
        print(f"  plan created : {PLAN_NAME} (id={plan_id[:8]}, rooms={len(rooms)})")

    rooms = version.get("rooms") or []
    room_by_name = {r["name"]: r for r in rooms}

    # ------------------------------------------------------------------------
    # 4) Bookings (idempotent: delete any seeded bookings first)
    # ------------------------------------------------------------------------
    await db.room_bookings.delete_many({"_seed": "mrb_demo"})
    bookings_spec = [
        # (organizer_email, room_name, title, start_dt, end_dt, recurring?)
        ("yamini@ticketing.com",  "Maple Room", "Sprint Planning",      today_at(10, 0, 0), today_at(11, 0, 0), None),
        ("dq1@ticketing.com",     "Cedar Room", "DQ Standup",           today_at(11, 30, 0), today_at(12, 0, 0), None),
        ("arjun@ticketing.com",   "Willow Pod", "Research Sync",        today_at(14, 0, 0), today_at(15, 0, 0), None),
        ("manager@ticketing.com", "Maple Room", "Quarterly Review",     today_at(9, 0, 1),  today_at(10, 30, 1), None),
        ("priya@ticketing.com",   "Cedar Room", "Design Critique",      today_at(15, 0, 1), today_at(16, 0, 1), None),
        ("admin@ticketing.com",   "Willow Pod", "Leadership 1:1",       today_at(10, 0, 2), today_at(10, 30, 2), None),
        ("ra@ticketing.com",      "Maple Room", "Biweekly Town Hall",   today_at(16, 0, 0), today_at(17, 0, 0),
            {"frequency": "fortnightly", "end_date": (datetime.now() + timedelta(days=28)).strftime("%Y-%m-%d"), "days": []}),
    ]
    inserted = 0
    series_for_fortnightly = None
    for email, room_name, title, sdt, edt, rec in bookings_spec:
        organizer_contact = by_email.get(email)
        if not organizer_contact:
            print(f"  ! skipping (no user): {email}")
            continue
        room = room_by_name.get(room_name)
        if not room:
            print(f"  ! skipping (no room): {room_name}")
            continue
        organizer = {"id": organizer_contact["id"], "name": organizer_contact["name"], "email": organizer_contact["email"]}

        # Compute occurrences for fortnightly: today, +14d, +28d
        occurrences = [(sdt, edt)]
        sid = None
        if rec and rec["frequency"] == "fortnightly":
            sid = str(uuid.uuid4())
            series_for_fortnightly = sid
            occurrences = []
            duration = edt - sdt
            end_date_dt = datetime.fromisoformat(rec["end_date"] + "T23:59:59")
            cur = sdt
            while cur.date() <= end_date_dt.date():
                occurrences.append((cur, cur + duration))
                cur = cur + timedelta(days=14)

        for occ_s, occ_e in occurrences:
            doc = {
                "id": str(uuid.uuid4()),
                "plan_id": plan_id,
                "plan_name": PLAN_NAME,
                "room_id": room["id"],
                "room_name": room["name"],
                "room_capacity": int(room["capacity"]),
                "title": title,
                "start_at": iso(occ_s),
                "end_at": iso(occ_e),
                "organizer": organizer,
                "attendees": [],
                "recurring": rec,
                "series_id": sid,
                "created_at": now_iso(),
                "updated_at": now_iso(),
                "cancelled": False,
                "_seed": "mrb_demo",
            }
            await db.room_bookings.insert_one(doc)
            inserted += 1
    print(f"  bookings     : {inserted} inserted (fortnightly series_id={series_for_fortnightly})")

    # ------------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------------
    print("\n=== SUMMARY ===")
    print(f"contacts: {await db.contacts.count_documents({})}")
    print(f"teams   : {await db.teams.count_documents({})}")
    print(f"plans   : {await db.floor_plans.count_documents({})}")
    print(f"rooms   : {len(rooms)} on \"{PLAN_NAME}\"")
    print(f"bookings: {await db.room_bookings.count_documents({'cancelled': False})}")
    print("\nlogin: admin@ticketing.com / Admin@123  (or manager@/yamini@/arjun@ — all use Test@123)")


if __name__ == "__main__":
    asyncio.run(main())
