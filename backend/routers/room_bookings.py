"""Meeting Room Bookings — strictly scoped to meeting rooms (no workstation overlap).

Data model
==========
  room_bookings:
    { id, plan_id, plan_name,
      room_id, room_name, room_capacity,
      title,
      start_at (ISO), end_at (ISO),
      organizer { id, name, email },
      attendees [ {type: 'user'|'team', id, name, email?} ],
      recurring? { frequency: 'daily'|'weekly'|'monthly', end_date: 'YYYY-MM-DD', days?: ['Mo','Tu',...] },
      series_id (uuid grouping recurring instances),
      created_at, updated_at,
      cancelled: bool }

Conflict rule
=============
  Two bookings overlap when (a.start < b.end) AND (a.end > b.start). Active
  bookings (cancelled=False) for the same room must never overlap. Conflict
  response includes the conflicting booking's title/organizer/times so the
  client can render a rich error.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, date as date_cls
from typing import List, Optional, Dict, Any

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core import api_router, db, get_current_user, now_iso


# --------------------------------------------------------------------------- #
# Models                                                                      #
# --------------------------------------------------------------------------- #

class Attendee(BaseModel):
    type: str  # 'user' | 'team'
    id: str
    name: str
    email: Optional[str] = None


class Recurring(BaseModel):
    frequency: str  # 'daily' | 'weekly' | 'monthly'
    end_date: str   # YYYY-MM-DD inclusive
    days: List[str] = Field(default_factory=list)  # for weekly: ['Mo','Tu','We','Th','Fr','Sa','Su']


class BookingCreate(BaseModel):
    plan_id: str
    room_id: str
    title: str = Field(..., min_length=1, max_length=120)
    start_at: str
    end_at: str
    attendees: List[Attendee] = Field(default_factory=list)
    recurring: Optional[Recurring] = None


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #

WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']  # Monday=0..Sunday=6


def _actor(user: dict) -> dict:
    return {"id": user.get("id"), "email": user.get("email"), "name": user.get("name")}


def _parse_iso(s: str, field: str) -> datetime:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, f"Invalid datetime for '{field}'")


async def _resolve_room(plan_id: str, room_id: str) -> Dict[str, Any]:
    plan = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(404, "Floor plan not found")
    if not plan.get("live_version_id"):
        raise HTTPException(400, "Floor plan has no Live version yet")
    version = await db.floor_plan_versions.find_one({"id": plan["live_version_id"]}, {"_id": 0})
    if not version:
        raise HTTPException(400, "Live version missing")
    rooms = version.get("rooms") or []
    room = next((r for r in rooms if r.get("id") == room_id), None)
    if not room:
        raise HTTPException(404, "Meeting room not found in this floor plan")
    return {"plan": plan, "version": version, "room": room}


async def _first_conflict(room_id: str, start: datetime, end: datetime, exclude_series: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Return the first overlapping active booking (or None)."""
    q: Dict[str, Any] = {"room_id": room_id, "cancelled": False}
    if exclude_series:
        q["series_id"] = {"$ne": exclude_series}
    s_iso = start.isoformat()
    e_iso = end.isoformat()
    doc = await db.room_bookings.find_one(
        {**q, "start_at": {"$lt": e_iso}, "end_at": {"$gt": s_iso}},
        {"_id": 0},
    )
    return doc


def _expand_recurring(start: datetime, end: datetime, recurring: Recurring) -> List[tuple]:
    """Expand a recurring spec into a list of (start, end) datetime tuples (inclusive of base)."""
    try:
        end_date = datetime.fromisoformat(recurring.end_date + "T23:59:59")
    except Exception:
        raise HTTPException(400, "Invalid recurring.end_date (use YYYY-MM-DD)")
    if end_date.date() < start.date():
        raise HTTPException(400, "Recurring end_date must be on or after the booking start date")

    occurrences: List[tuple] = []
    duration = end - start
    cur = start

    if recurring.frequency == 'daily':
        while cur.date() <= end_date.date():
            occurrences.append((cur, cur + duration))
            cur = cur + timedelta(days=1)
    elif recurring.frequency == 'weekly':
        # If `days` provided, use it; otherwise use the weekday of the start date.
        target = set(recurring.days or [WEEKDAYS[start.weekday()]])
        while cur.date() <= end_date.date():
            if WEEKDAYS[cur.weekday()] in target:
                occurrences.append((cur, cur + duration))
            cur = cur + timedelta(days=1)
    elif recurring.frequency == 'monthly':
        while cur.date() <= end_date.date():
            occurrences.append((cur, cur + duration))
            # add one month (approx — same day next month, clamp if needed)
            m = cur.month + 1
            y = cur.year + (1 if m > 12 else 0)
            m = ((m - 1) % 12) + 1
            try:
                cur = cur.replace(year=y, month=m)
            except ValueError:
                # day 31 in shorter month — fall back to last day
                if m == 12:
                    cur = cur.replace(year=y, month=m, day=31)
                else:
                    last = (datetime(y, m + 1, 1) - timedelta(days=1)).day
                    cur = cur.replace(year=y, month=m, day=last)
    else:
        raise HTTPException(400, "recurring.frequency must be daily, weekly or monthly")

    if not occurrences:
        raise HTTPException(400, "Recurring rule produced no occurrences in the date range")
    return occurrences


# --------------------------------------------------------------------------- #
# Endpoints                                                                   #
# --------------------------------------------------------------------------- #

@api_router.get("/room-bookings/rooms")
async def list_available_rooms(user=Depends(get_current_user)):
    plans = await db.floor_plans.find(
        {"live_version_id": {"$ne": None}, "status_override": {"$ne": "inactive"}},
        {"_id": 0},
    ).sort("created_at", 1).to_list(500)
    out = []
    for p in plans:
        v = await db.floor_plan_versions.find_one({"id": p["live_version_id"]}, {"_id": 0})
        if not v:
            continue
        for r in (v.get("rooms") or []):
            out.append({
                "plan_id": p["id"],
                "plan_name": p.get("name") or v.get("name"),
                "pdfUrl": v.get("pdfUrl") or p.get("pdfUrl"),
                "room_id": r["id"],
                "name": r.get("name"),
                "capacity": int(r.get("capacity") or 1),
                "x": r.get("x"), "y": r.get("y"), "w": r.get("w"), "h": r.get("h"),
            })
    return out


@api_router.post("/room-bookings")
async def create_room_booking(payload: BookingCreate, user=Depends(get_current_user)):
    ctx = await _resolve_room(payload.plan_id, payload.room_id)
    room = ctx["room"]
    plan = ctx["plan"]
    start = _parse_iso(payload.start_at, "start_at")
    end = _parse_iso(payload.end_at, "end_at")
    if end <= start:
        raise HTTPException(400, "end_at must be after start_at")

    # Build occurrence list
    occurrences = [(start, end)]
    if payload.recurring:
        occurrences = _expand_recurring(start, end, payload.recurring)

    # Pre-check: collect all conflicts across occurrences
    conflicts = []
    for occ_s, occ_e in occurrences:
        conflict = await _first_conflict(payload.room_id, occ_s, occ_e)
        if conflict:
            conflicts.append({
                "occurrence_start": occ_s.isoformat(),
                "occurrence_end": occ_e.isoformat(),
                "with": {
                    "id": conflict.get("id"),
                    "title": conflict.get("title"),
                    "organizer": conflict.get("organizer"),
                    "start_at": conflict.get("start_at"),
                    "end_at": conflict.get("end_at"),
                },
            })
    if conflicts:
        raise HTTPException(409, {
            "code": "BOOKING_CONFLICT",
            "message": "This room is already booked for one or more requested times",
            "conflicts": conflicts,
            "room_name": room.get("name"),
        })

    # Insert
    series_id = str(uuid.uuid4()) if payload.recurring else None
    now = now_iso()
    actor = _actor(user)
    docs = []
    for occ_s, occ_e in occurrences:
        bid = str(uuid.uuid4())
        docs.append({
            "id": bid,
            "plan_id": payload.plan_id,
            "plan_name": plan.get("name"),
            "room_id": payload.room_id,
            "room_name": room.get("name"),
            "room_capacity": int(room.get("capacity") or 1),
            "title": payload.title.strip(),
            "start_at": occ_s.isoformat(),
            "end_at": occ_e.isoformat(),
            "organizer": actor,
            "attendees": [a.model_dump() for a in payload.attendees],
            "recurring": payload.recurring.model_dump() if payload.recurring else None,
            "series_id": series_id,
            "created_at": now,
            "updated_at": now,
            "cancelled": False,
        })
    if docs:
        await db.room_bookings.insert_many(docs)
    for d in docs:
        d.pop("_id", None)

    # TODO(email): notify organizer + each attendee with the booking details
    # using existing notifications router. Templates: meeting.booked,
    # meeting.cancelled (kept TBD per spec).

    return {"ok": True, "created": len(docs), "series_id": series_id, "first": docs[0] if docs else None}


@api_router.get("/room-bookings")
async def list_room_bookings(
    user=Depends(get_current_user),
    plan_id: Optional[str] = Query(None),
    room_id: Optional[str] = Query(None),
    date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    mine: bool = Query(False, description="Bookings where the user is organizer OR an attendee (or member of an attendee team)"),
    include_past: bool = Query(False),
    include_cancelled: bool = Query(False),
):
    q: Dict[str, Any] = {}
    if plan_id: q["plan_id"] = plan_id
    if room_id: q["room_id"] = room_id
    if not include_cancelled: q["cancelled"] = False
    if mine:
        # bookings where user is organizer OR direct attendee OR member of an attendee team
        uid = user.get("id")
        team_ids: List[str] = []
        try:
            uemail = (user.get("email") or "").lower()
            # find teams the user is part of
            cursor = db.teams.find({"members": {"$elemMatch": {"$or": [{"id": uid}, {"email": uemail}]}}}, {"id": 1, "_id": 0})
            tdocs = await cursor.to_list(200)
            team_ids = [t.get("id") for t in tdocs if t.get("id")]
        except Exception:
            team_ids = []
        q["$or"] = [
            {"organizer.id": uid},
            {"attendees": {"$elemMatch": {"type": "user", "id": uid}}},
        ]
        if team_ids:
            q["$or"].append({"attendees": {"$elemMatch": {"type": "team", "id": {"$in": team_ids}}}})
    if date:
        try:
            d_start = datetime.fromisoformat(date)
            d_end = d_start.replace(hour=23, minute=59, second=59, microsecond=999999)
        except Exception:
            raise HTTPException(400, "date must be YYYY-MM-DD")
        q["start_at"] = {"$lte": d_end.isoformat()}
        q["end_at"] = {"$gte": d_start.isoformat()}
    if not include_past:
        q.setdefault("end_at", {})
        if isinstance(q["end_at"], dict):
            q["end_at"]["$gte"] = datetime.now().isoformat()
        else:
            q["end_at"] = {"$gte": datetime.now().isoformat()}

    docs = await db.room_bookings.find(q, {"_id": 0}).sort("start_at", 1).to_list(500)
    return docs


@api_router.delete("/room-bookings/{booking_id}")
async def cancel_room_booking(
    booking_id: str,
    user=Depends(get_current_user),
    series: bool = Query(False, description="Cancel the entire recurring series"),
):
    doc = await db.room_bookings.find_one({"id": booking_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Booking not found")
    is_owner = doc.get("organizer", {}).get("id") == user.get("id")
    is_admin = user.get("role") in ("Super Admin", "Admin")
    if not (is_owner or is_admin):
        raise HTTPException(403, "You can only cancel your own bookings")

    if series and doc.get("series_id"):
        await db.room_bookings.update_many(
            {"series_id": doc["series_id"], "cancelled": False, "end_at": {"$gte": datetime.now().isoformat()}},
            {"$set": {"cancelled": True, "updated_at": now_iso(), "cancelled_by": _actor(user)}},
        )
    else:
        await db.room_bookings.update_one(
            {"id": booking_id},
            {"$set": {"cancelled": True, "updated_at": now_iso(), "cancelled_by": _actor(user)}},
        )
    return {"ok": True}
