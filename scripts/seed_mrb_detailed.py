"""Seed 12 meeting-room-requests covering ALL statuses + varied attendees.

Populates BOTH the `meeting_room_requests` and `room_bookings` collections
in lock-step (for Approved rows) so the Upcoming Bookings panel + detail
popup show real, cross-referenced data.

Attendee variety:
  - No attendees
  - Single user attendee
  - Multiple user attendees
  - Single team attendee
  - Multiple teams
  - Mix of users + teams

Statuses covered:
  - Approved  (with linked room_bookings row)
  - Pending Approval
  - Declined
  - Cancelled

Idempotent: previous rows tagged _seed="mrb_detailed" are wiped before insert.

Run:  python3 /app/scripts/seed_mrb_detailed.py
"""
from __future__ import annotations
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def now_iso() -> str:
    return datetime.utcnow().isoformat()


def iso(dt: datetime) -> str:
    return dt.isoformat()


def today_at(h: int, m: int = 0, day_offset: int = 0) -> datetime:
    base = datetime.now().replace(second=0, microsecond=0) + timedelta(days=day_offset)
    return base.replace(hour=h, minute=m)


async def _next_seq(db, key: str, start: int) -> int:
    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"value": 1}},
        upsert=True, return_document=True,
    )
    if doc and doc.get("value", 0) < start + 1:
        doc = await db.counters.find_one_and_update(
            {"_id": key}, {"$set": {"value": start + 1}}, return_document=True,
        )
    return int(doc["value"])


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    # Live floor plan → its published version → rooms
    plan = await db.floor_plans.find_one({"live_version_id": {"$ne": None}})
    if not plan or not plan.get("live_version_id"):
        print("ERROR: no live floor plan found. Publish a floor plan first.")
        return
    version = await db.floor_plan_versions.find_one({"id": plan["live_version_id"]})
    rooms = version.get("rooms") or []
    if not rooms:
        print("ERROR: live floor plan has no rooms.")
        return
    plan_id = plan["id"]
    plan_name = version.get("name") or plan.get("name") or "Live Plan"
    room_by_name = {r["name"]: r for r in rooms}
    print(f"Using plan={plan_name!r} with {len(rooms)} rooms")

    # Contacts by email
    contacts = await db.contacts.find({}, {"_id": 0}).to_list(500)
    by_email = {c["email"]: c for c in contacts}

    # Teams by name
    teams = await db.teams.find({}, {"_id": 0}).to_list(200)
    by_team_name = {t["name"]: t for t in teams}
    if not teams:
        print("WARN: no teams found — team-attendee entries will be skipped.")

    def user_ref(email: str):
        c = by_email.get(email)
        if not c:
            return None
        return {"type": "user", "id": c["id"], "name": c["name"], "email": c["email"]}

    def user_org(email: str):
        c = by_email.get(email)
        if not c:
            return None
        return {"id": c["id"], "name": c["name"], "email": c["email"]}

    def team_ref(name: str):
        t = by_team_name.get(name)
        if not t:
            return None
        return {"type": "team", "id": t["id"], "name": t["name"]}

    def room(name_or_first: str):
        return room_by_name.get(name_or_first) or rooms[0]

    # Wipe previous "detailed" seed rows (both collections)
    d1 = await db.meeting_room_requests.delete_many({"_seed": "mrb_detailed"})
    d2 = await db.room_bookings.delete_many({"_seed": "mrb_detailed"})
    print(f"Cleaned previous seeds — requests={d1.deleted_count}, bookings={d2.deleted_count}")

    # Attendee builders — safe fallbacks when a name/email is missing.
    def pick_users(*emails):
        return [u for u in (user_ref(e) for e in emails) if u]

    def pick_teams(*names):
        return [t for t in (team_ref(n) for n in names) if t]

    # ------------------------------------------------------------------
    # 12 meetings — variety of statuses, dates, attendee shapes.
    # ------------------------------------------------------------------
    specs = [
        # 1. Approved — no attendees, past
        {
            "kind": "Approved · No attendees",
            "organizer": "admin@ticketing.com",
            "room": "Alpha", "title": "Weekly Ops Review",
            "start": today_at(9, 0, -2), "end": today_at(10, 0, -2),
            "attendees": [],
            "status": "Approved",
        },
        # 2. Approved — single user attendee, today
        {
            "kind": "Approved · 1 user",
            "organizer": "manager@ticketing.com",
            "room": "Beta", "title": "1:1 with Direct Report",
            "start": today_at(11, 0, 0), "end": today_at(11, 30, 0),
            "attendees": pick_users("dq1@ticketing.com"),
            "status": "Approved",
        },
        # 3. Approved — multiple users, tomorrow
        {
            "kind": "Approved · multiple users",
            "organizer": "admin@ticketing.com",
            "room": "Gamma", "title": "Sprint Planning",
            "start": today_at(10, 0, 1), "end": today_at(11, 30, 1),
            "attendees": pick_users("manager@ticketing.com", "dq1@ticketing.com",
                                    "dq2@ticketing.com", "arjun@ticketing.com"),
            "status": "Approved",
        },
        # 4. Approved — single team, +2d
        {
            "kind": "Approved · 1 team",
            "organizer": "manager@ticketing.com",
            "room": "Theta", "title": "Data Quality Team Sync",
            "start": today_at(14, 0, 2), "end": today_at(15, 0, 2),
            "attendees": pick_teams(teams[0]["name"]) if teams else [],
            "status": "Approved",
        },
        # 5. Approved — multiple teams, +3d
        {
            "kind": "Approved · multiple teams",
            "organizer": "admin@ticketing.com",
            "room": "Zeta", "title": "Cross-Team Coordination",
            "start": today_at(15, 0, 3), "end": today_at(16, 0, 3),
            "attendees": pick_teams(*[t["name"] for t in teams[:3]]) if teams else [],
            "status": "Approved",
        },
        # 6. Approved — users + teams mix, +4d
        {
            "kind": "Approved · users + teams",
            "organizer": "manager@ticketing.com",
            "room": "Alpha", "title": "Quarterly All-Hands",
            "start": today_at(11, 0, 4), "end": today_at(12, 30, 4),
            "attendees": (
                pick_users("admin@ticketing.com", "arjun@ticketing.com", "priya@ticketing.com")
                + (pick_teams(*[t["name"] for t in teams[:2]]) if teams else [])
            ),
            "status": "Approved",
        },
        # 7. Pending Approval — single user, +1d
        {
            "kind": "Pending · 1 user",
            "organizer": "arjun@ticketing.com",
            "room": "Beta", "title": "Vendor Intro Call",
            "start": today_at(16, 0, 1), "end": today_at(17, 0, 1),
            "attendees": pick_users("admin@ticketing.com"),
            "status": "Pending Approval",
        },
        # 8. Pending Approval — multi user + team, +2d
        {
            "kind": "Pending · users + team",
            "organizer": "priya@ticketing.com",
            "room": "Gamma", "title": "Design Review — Homepage v2",
            "start": today_at(10, 30, 2), "end": today_at(12, 0, 2),
            "attendees": (
                pick_users("manager@ticketing.com", "yamini@ticketing.com")
                + (pick_teams(teams[1]["name"]) if len(teams) > 1 else [])
            ),
            "status": "Pending Approval",
        },
        # 9. Pending Approval — no attendees, +5d
        {
            "kind": "Pending · no attendees",
            "organizer": "yamini@ticketing.com",
            "room": "Theta", "title": "Focus Block — Deep Work",
            "start": today_at(9, 0, 5), "end": today_at(11, 0, 5),
            "attendees": [],
            "status": "Pending Approval",
        },
        # 10. Declined — with decision note
        {
            "kind": "Declined",
            "organizer": "dq2@ticketing.com",
            "room": "Zeta", "title": "Ad-hoc Analytics Chat",
            "start": today_at(13, 0, -1), "end": today_at(14, 0, -1),
            "attendees": pick_users("dq1@ticketing.com"),
            "status": "Declined",
            "decision_note": "Room already booked for exec review — please rebook another slot.",
        },
        # 11. Cancelled — user withdrew
        {
            "kind": "Cancelled",
            "organizer": "admin@ticketing.com",
            "room": "Alpha", "title": "Cancelled Kickoff Meeting",
            "start": today_at(14, 0, 2), "end": today_at(15, 0, 2),
            "attendees": pick_users("manager@ticketing.com", "arjun@ticketing.com"),
            "status": "Cancelled",
        },
        # 12. Approved — recurring weekly (single-occurrence seed, but flagged)
        {
            "kind": "Approved · recurring",
            "organizer": "manager@ticketing.com",
            "room": "Beta", "title": "Weekly Team Standup",
            "start": today_at(9, 30, 1), "end": today_at(10, 0, 1),
            "attendees": (
                pick_users("dq1@ticketing.com", "arjun@ticketing.com", "yamini@ticketing.com")
                + (pick_teams(teams[0]["name"]) if teams else [])
            ),
            "status": "Approved",
            "recurring": {"frequency": "weekly", "end_date": (datetime.now() + timedelta(days=42)).date().isoformat(), "days": ["Mo"]},
        },
        # 13. Approved — small quick 1:1, +6d
        {
            "kind": "Approved · quick 1:1",
            "organizer": "dq1@ticketing.com",
            "room": "Zeta", "title": "Skip-level Sync",
            "start": today_at(15, 30, 6), "end": today_at(16, 0, 6),
            "attendees": pick_users("admin@ticketing.com"),
            "status": "Approved",
        },
        # 14. Pending — recurring proposal
        {
            "kind": "Pending · recurring proposal",
            "organizer": "arjun@ticketing.com",
            "room": "Theta", "title": "Recurring Grooming Session",
            "start": today_at(15, 0, 3), "end": today_at(16, 0, 3),
            "attendees": pick_users("manager@ticketing.com", "priya@ticketing.com"),
            "status": "Pending Approval",
            "recurring": {"frequency": "weekly", "end_date": (datetime.now() + timedelta(days=28)).date().isoformat(), "days": ["We"]},
        },
    ]

    inserted_req = 0
    inserted_bk = 0
    for s in specs:
        organizer = user_org(s["organizer"])
        if not organizer:
            print(f"  skip (no organizer): {s['organizer']}")
            continue
        r = room(s["room"])
        req_id = str(uuid.uuid4())
        req_seq = await _next_seq(db, "meeting_room_request_seq", 40000)
        req = {
            "id": req_id,
            "seq_no": req_seq,
            "plan_id": plan_id,
            "plan_name": plan_name,
            "room_id": r["id"],
            "room_name": r["name"],
            "room_capacity": int(r["capacity"]),
            "title": s["title"],
            "start_at": iso(s["start"]),
            "end_at": iso(s["end"]),
            "attendees": s["attendees"] or [],
            "recurring": s.get("recurring"),
            "series_id": None,
            "status": s["status"],
            "requested_by": organizer,
            "requested_on": now_iso(),
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "hidden_by_requester": False,
            "_seed": "mrb_detailed",
        }
        booking = None
        if s["status"] == "Approved":
            bk_id = str(uuid.uuid4())
            bk_seq = await _next_seq(db, "room_booking_seq", 20000)
            booking = {
                "id": bk_id,
                "seq_no": bk_seq,
                "plan_id": plan_id,
                "plan_name": plan_name,
                "room_id": r["id"],
                "room_name": r["name"],
                "room_capacity": int(r["capacity"]),
                "title": s["title"],
                "start_at": iso(s["start"]),
                "end_at": iso(s["end"]),
                "organizer": organizer,
                "attendees": s["attendees"] or [],
                "recurring": s.get("recurring"),
                "series_id": None,
                "created_at": now_iso(),
                "updated_at": now_iso(),
                "cancelled": False,
                "from_request_id": req_id,
                "auto_approved": True,
                "_seed": "mrb_detailed",
            }
            await db.room_bookings.insert_one(booking)
            inserted_bk += 1
            req["approved_booking_id"] = bk_id
            req["decided_by"] = {**organizer, "auto_approved": True}
            req["decided_on"] = now_iso()
        elif s["status"] == "Declined":
            req["decided_by"] = user_org("admin@ticketing.com") or organizer
            req["decided_on"] = now_iso()
            req["decision_note"] = s.get("decision_note", "Declined by approver.")
        elif s["status"] == "Cancelled":
            req["cancelled_by"] = organizer
            req["cancelled_on"] = now_iso()

        await db.meeting_room_requests.insert_one(req)
        inserted_req += 1
        att_desc = f"{sum(1 for a in (s['attendees'] or []) if a.get('type')=='user')}u/{sum(1 for a in (s['attendees'] or []) if a.get('type')=='team')}t"
        print(f"  + [{s['status']:>17}] {s['start'].strftime('%d %b %H:%M')}-{s['end'].strftime('%H:%M')} {r['name']:<9} {att_desc}  {s['title']}")

    print(f"\nInserted requests: {inserted_req}")
    print(f"Inserted bookings: {inserted_bk}")
    print(f"Total meeting_room_requests: {await db.meeting_room_requests.count_documents({})}")
    print(f"Total room_bookings         : {await db.room_bookings.count_documents({})}")


if __name__ == "__main__":
    asyncio.run(main())
