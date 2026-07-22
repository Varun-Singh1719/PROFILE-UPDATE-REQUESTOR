"""Seed 10 room bookings with a mix of statuses (past/ongoing/upcoming/cancelled)
across today, past days and future days.

Idempotent: re-runs delete any bookings tagged with `_seed=mrb_variety` before
inserting again, so it's safe to call multiple times.

Run:  python3 /app/scripts/seed_mrb_variety.py
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
    """Local-time datetime rounded to the minute for the given hour/minute/day-offset.

    Uses local `datetime.now()` (no tz) to match how the calendar reads and
    displays times in the UI (both are treated as local wall-clock times).
    """
    base = datetime.now().replace(second=0, microsecond=0) + timedelta(days=day_offset)
    return base.replace(hour=h, minute=m)


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

    def user(email: str):
        c = by_email.get(email)
        if not c:
            return None
        return {"id": c["id"], "name": c["name"], "email": c["email"]}

    def room(name_or_first: str):
        return room_by_name.get(name_or_first) or rooms[0]

    # Wipe previous "variety" seed
    deleted = await db.room_bookings.delete_many({"_seed": "mrb_variety"})
    print(f"Cleaned previous seeds: {deleted.deleted_count}")

    # 10 bookings — variety of statuses
    # Legend:
    #   PAST      — start_at & end_at are in the past → shows as "Completed"
    #   ONGOING   — start_at < now < end_at            → shows the NOW badge / occupied-now
    #   UPCOMING  — start_at > now                    → shows in Upcoming Bookings
    #   CANCELLED — cancelled=True                    → hidden from map but visible in outbox
    specs = [
        # (organizer_email, room_name, title, start, end, cancelled, kind)
        ("dq1@ticketing.com",     "Alpha",   "Q3 Roadmap Review",       today_at(9, 0,  -2), today_at(10, 0, -2), False, "PAST"),
        ("manager@ticketing.com", "Gamma",   "Design Retro",            today_at(15, 30, -1), today_at(16, 30, -1), False, "PAST"),
        ("admin@ticketing.com",   "Beta",    "All-Hands Standup",       today_at(9, 30, 0),  today_at(10, 0, 0),  False, "PAST/ONGOING (depends on run time)"),
        # Ongoing "right now" — spans a 2-hour window centred around current time.
        ("yamini@ticketing.com",  "Alpha",   "Client Onboarding Call",
            datetime.now().replace(second=0, microsecond=0) - timedelta(minutes=30),
            datetime.now().replace(second=0, microsecond=0) + timedelta(minutes=90),
            False, "ONGOING"),
        ("arjun@ticketing.com",   "Theta",   "Interview — Senior FE",   today_at(11, 0, 0),  today_at(12, 0, 0),  False, "TODAY-UPCOMING"),
        ("priya@ticketing.com",   "Zeta",    "1:1 with Manager",        today_at(14, 30, 0), today_at(15, 0, 0),  False, "TODAY-UPCOMING"),
        ("manager@ticketing.com", "Milky Way","Sprint Planning",         today_at(10, 0, 1),  today_at(11, 30, 1), False, "TOMORROW-UPCOMING"),
        ("dq2@ticketing.com",     "Galaxy",  "Data Quality Sync",       today_at(16, 0, 2),  today_at(17, 0, 2),  False, "UPCOMING (+2d)"),
        ("ra@ticketing.com",      "Apollo",  "Research Debrief",        today_at(11, 30, 3), today_at(12, 30, 3), False, "UPCOMING (+3d)"),
        ("admin@ticketing.com",   "Odyssey", "Vendor Demo (cancelled)", today_at(15, 0, 1),  today_at(16, 0, 1),  True,  "CANCELLED"),
    ]

    inserted = 0
    for email, room_name, title, sdt, edt, cancelled, kind in specs:
        organizer = user(email)
        if not organizer:
            print(f"  skip (no user):  {email}")
            continue
        r = room(room_name)
        doc = {
            "id": str(uuid.uuid4()),
            "plan_id": plan_id,
            "plan_name": plan_name,
            "room_id": r["id"],
            "room_name": r["name"],
            "room_capacity": int(r["capacity"]),
            "title": title,
            "start_at": iso(sdt),
            "end_at": iso(edt),
            "organizer": organizer,
            "attendees": [],
            "recurring": None,
            "series_id": None,
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "cancelled": bool(cancelled),
            "_seed": "mrb_variety",
        }
        await db.room_bookings.insert_one(doc)
        inserted += 1
        print(f"  + [{kind:>28}] {sdt.strftime('%d %b %H:%M')}–{edt.strftime('%H:%M')}  {r['name']:<10} {title}")

    print(f"\nInserted {inserted} bookings.")
    print(f"Total active bookings now: {await db.room_bookings.count_documents({'cancelled': False})}")
    print(f"Total cancelled bookings : {await db.room_bookings.count_documents({'cancelled': True})}")


if __name__ == "__main__":
    asyncio.run(main())
