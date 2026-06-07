"""Meeting Room Bookings — strictly scoped to meeting rooms (no workstation overlap).

Data model
==========
  room_bookings:
    { id, plan_id, plan_name,
      room_id, room_name, room_capacity,
      title, attendees_count,
      start_at (ISO), end_at (ISO),
      organizer { id, name, email },
      created_at, updated_at,
      cancelled: bool }

Conflict rule
=============
  Two bookings overlap when (a.start < b.end) AND (a.end > b.start). Active
  bookings (cancelled=False) for the same room must never overlap.

This module deliberately does NOT consult the workstation seats array — meeting
room availability is calculated only from this collection.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional, Dict, Any

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core import api_router, db, get_current_user, now_iso


# --------------------------------------------------------------------------- #
# Models                                                                      #
# --------------------------------------------------------------------------- #

class BookingCreate(BaseModel):
    plan_id: str
    room_id: str
    title: str = Field(..., min_length=1, max_length=120)
    attendees_count: int = Field(..., ge=1, le=200)
    start_at: str  # ISO 8601
    end_at: str    # ISO 8601


class BookingOut(BaseModel):
    id: str
    plan_id: str
    plan_name: str
    room_id: str
    room_name: str
    room_capacity: int
    title: str
    attendees_count: int
    start_at: str
    end_at: str
    organizer: Dict[str, Any]
    created_at: str
    cancelled: bool = False


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #

def _actor(user: dict) -> dict:
    return {"id": user.get("id"), "email": user.get("email"), "name": user.get("name")}


def _parse_iso(s: str, field: str) -> datetime:
    try:
        # Accept both "Z" and offset-style ISO strings
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, f"Invalid datetime for '{field}'")


async def _resolve_room(plan_id: str, room_id: str) -> Dict[str, Any]:
    """Look up the meeting room from the plan's live published version."""
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


async def _has_conflict(room_id: str, start: datetime, end: datetime, exclude_id: Optional[str] = None) -> bool:
    """A booking overlaps if start < other.end AND end > other.start."""
    q: Dict[str, Any] = {"room_id": room_id, "cancelled": False}
    if exclude_id:
        q["id"] = {"$ne": exclude_id}
    # Compare as ISO strings — they're directly comparable when normalized
    s_iso = start.isoformat()
    e_iso = end.isoformat()
    cursor = db.room_bookings.find({**q, "start_at": {"$lt": e_iso}, "end_at": {"$gt": s_iso}}, {"_id": 0}).limit(1)
    docs = await cursor.to_list(1)
    return len(docs) > 0


# --------------------------------------------------------------------------- #
# Endpoints                                                                   #
# --------------------------------------------------------------------------- #

@api_router.get("/room-bookings/rooms")
async def list_available_rooms(user=Depends(get_current_user)):
    """List meeting rooms across all Live floor plans (used by booking UI).

    Strictly excludes workstations.
    """
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
                "room_id": r["id"],
                "name": r.get("name"),
                "capacity": int(r.get("capacity") or 1),
            })
    return out


@api_router.post("/room-bookings", response_model=BookingOut)
async def create_room_booking(payload: BookingCreate, user=Depends(get_current_user)):
    ctx = await _resolve_room(payload.plan_id, payload.room_id)
    room = ctx["room"]
    plan = ctx["plan"]
    capacity = int(room.get("capacity") or 1)
    if payload.attendees_count > capacity:
        raise HTTPException(400, f"Attendees ({payload.attendees_count}) exceed room capacity ({capacity})")
    start = _parse_iso(payload.start_at, "start_at")
    end = _parse_iso(payload.end_at, "end_at")
    if end <= start:
        raise HTTPException(400, "end_at must be after start_at")
    if await _has_conflict(payload.room_id, start, end):
        raise HTTPException(409, "This room is already booked for the selected time window")

    booking_id = str(uuid.uuid4())
    now = now_iso()
    doc = {
        "id": booking_id,
        "plan_id": payload.plan_id,
        "plan_name": plan.get("name"),
        "room_id": payload.room_id,
        "room_name": room.get("name"),
        "room_capacity": capacity,
        "title": payload.title.strip(),
        "attendees_count": payload.attendees_count,
        "start_at": start.isoformat(),
        "end_at": end.isoformat(),
        "organizer": _actor(user),
        "created_at": now,
        "updated_at": now,
        "cancelled": False,
    }
    await db.room_bookings.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/room-bookings")
async def list_room_bookings(
    user=Depends(get_current_user),
    plan_id: Optional[str] = Query(None),
    room_id: Optional[str] = Query(None),
    date: Optional[str] = Query(None, description="YYYY-MM-DD; returns bookings overlapping this date"),
    mine: bool = Query(False, description="If true, only the current user's bookings"),
    include_past: bool = Query(False),
    include_cancelled: bool = Query(False),
):
    q: Dict[str, Any] = {}
    if plan_id: q["plan_id"] = plan_id
    if room_id: q["room_id"] = room_id
    if not include_cancelled: q["cancelled"] = False
    if mine: q["organizer.id"] = user.get("id")
    if date:
        # Compare ISO date range: [date 00:00, date+1 00:00)
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
async def cancel_room_booking(booking_id: str, user=Depends(get_current_user)):
    doc = await db.room_bookings.find_one({"id": booking_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Booking not found")
    is_owner = doc.get("organizer", {}).get("id") == user.get("id")
    is_admin = user.get("role") in ("Super Admin", "Admin")
    if not (is_owner or is_admin):
        raise HTTPException(403, "You can only cancel your own bookings")
    await db.room_bookings.update_one(
        {"id": booking_id},
        {"$set": {"cancelled": True, "updated_at": now_iso(), "cancelled_by": _actor(user)}},
    )
    return {"ok": True}
