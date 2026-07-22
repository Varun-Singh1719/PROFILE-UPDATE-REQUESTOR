"""Meeting-Room Requests — request-then-approve flow for meeting-room bookings.

Mirrors `workstation_requests.py` but for meeting rooms:

    user submits a meeting request  →  status = "Pending Approval"
                                    ↓
      approver clicks Approve       →  a real room_booking is created
                                       request status → "Approved"
                                    ↓
      approver clicks Decline       →  request status → "Declined"
      user cancels their own req    →  request status → "Cancelled"

Data model — `meeting_room_requests` collection
==============================================
    { id, seq_no,
      plan_id, plan_name,
      room_id, room_name, room_capacity,
      title,
      start_at (ISO), end_at (ISO),
      attendees [ {type: 'user'|'team', id, name, email?} ],
      recurring? { frequency, end_date, days? },
      series_id,                             # groups recurring instances
      status: "Pending Approval" | "Approved" | "Declined" | "Cancelled",
      requested_by { id, name, email },
      requested_on,
      decided_by?, decided_on?, decision_note?,
      approved_booking_id?,                  # set on Approve — links to room_bookings row
      created_at, updated_at }

Endpoints
=========
POST    /api/meeting-room-requests                   — submit a new request (respects auto-approval)
GET     /api/meeting-room-requests                   — list (filter by status, plan, etc.)
POST    /api/meeting-room-requests/{id}/approve      — approve → creates booking
POST    /api/meeting-room-requests/{id}/decline      — decline
DELETE  /api/meeting-room-requests/{id}              — cancel my own pending request
"""
from __future__ import annotations

import uuid
from datetime import datetime, date as date_cls, timedelta
from typing import List, Optional, Dict, Any

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core import api_router, db, get_current_user, require_role, now_iso, log_audit


# --------------------------------------------------------------------------- #
# Status constants                                                            #
# --------------------------------------------------------------------------- #

STATUS_PENDING = "Pending Approval"
STATUS_APPROVED = "Approved"
STATUS_DECLINED = "Declined"
STATUS_CANCELLED = "Cancelled"

ACTIVE_PENDING_STATUSES = [STATUS_PENDING]


# --------------------------------------------------------------------------- #
# Models                                                                      #
# --------------------------------------------------------------------------- #

class Attendee(BaseModel):
    type: str  # 'user' | 'team'
    id: str
    name: str
    email: Optional[str] = None


class Recurring(BaseModel):
    frequency: str  # 'daily' | 'weekly' | 'fortnightly' | 'monthly'
    end_date: str
    days: List[str] = Field(default_factory=list)


class MeetingRoomRequestCreate(BaseModel):
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

SEQ_KEY = "meeting_room_request_seq"
SEQ_START = 40000  # first request → 40001 (distinct from workstation 30000s and bookings 20000s)


async def _next_seq() -> int:
    doc = await db.counters.find_one_and_update(
        {"_id": SEQ_KEY}, {"$inc": {"value": 1}},
        upsert=True, return_document=True,
    )
    if doc and doc.get("value", 0) < SEQ_START + 1:
        doc = await db.counters.find_one_and_update(
            {"_id": SEQ_KEY}, {"$set": {"value": SEQ_START + 1}}, return_document=True,
        )
    return int(doc["value"])


def _actor(user: dict) -> dict:
    return {"id": user.get("id"), "email": user.get("email"), "name": user.get("name")}


def _parse_iso(s: str, field: str = "datetime") -> datetime:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        raise HTTPException(400, f"Invalid ISO datetime for '{field}'")


async def _resolve_room(plan_id: str, room_id: str) -> Dict[str, Any]:
    """Reuse the same resolution logic as room_bookings."""
    from routers.room_bookings import _resolve_room as _rb_resolve
    return await _rb_resolve(plan_id, room_id)


def _expand_recurring(base_start: datetime, base_end: datetime, rec: Recurring) -> List:
    """Reuse the expansion helper from room_bookings."""
    from routers.room_bookings import _expand_recurring as _rb_expand
    return _rb_expand(base_start, base_end, rec)


async def _first_conflict(room_id: str, start: datetime, end: datetime) -> Optional[dict]:
    """Check for booking conflicts (existing bookings)."""
    from routers.room_bookings import _first_conflict as _rb_first_conflict
    return await _rb_first_conflict(room_id, start, end)


async def _first_pending_conflict(
    room_id: str, start: datetime, end: datetime,
    exclude_request_id: Optional[str] = None,
) -> Optional[dict]:
    """Check for pending-request conflicts on the same room + overlapping time."""
    q: Dict[str, Any] = {
        "room_id": room_id,
        "status": {"$in": ACTIVE_PENDING_STATUSES},
        "start_at": {"$lt": end.isoformat()},
        "end_at":   {"$gt": start.isoformat()},
    }
    if exclude_request_id:
        q["id"] = {"$ne": exclude_request_id}
    return await db.meeting_room_requests.find_one(q, {"_id": 0})


# --------------------------------------------------------------------------- #
# Internal approval used by auto-approval                                     #
# --------------------------------------------------------------------------- #

async def _create_booking_from_request(req: dict, actor: dict, *, auto: bool) -> dict:
    """Insert a room_bookings doc mirroring the approved request. Returns the
    inserted booking dict (no `_id`).

    Raises HTTPException(409, ...) if the room is already booked at that time.
    """
    from routers.room_bookings import _next_seq as _booking_seq
    start = _parse_iso(req["start_at"], "start_at")
    end = _parse_iso(req["end_at"], "end_at")
    conflict = await _first_conflict(req["room_id"], start, end)
    if conflict:
        raise HTTPException(409, {
            "code": "BOOKING_CONFLICT",
            "message": "This room is already booked for the requested time",
            "conflict": {
                "id": conflict.get("id"),
                "title": conflict.get("title"),
                "organizer": conflict.get("organizer"),
                "start_at": conflict.get("start_at"),
                "end_at": conflict.get("end_at"),
            },
            "room_name": req.get("room_name"),
        })
    now = now_iso()
    booking = {
        "id": str(uuid.uuid4()),
        "seq_no": await _booking_seq(),
        "plan_id": req["plan_id"],
        "plan_name": req.get("plan_name"),
        "room_id": req["room_id"],
        "room_name": req.get("room_name"),
        "room_capacity": int(req.get("room_capacity") or 1),
        "title": req["title"],
        "start_at": req["start_at"],
        "end_at": req["end_at"],
        "organizer": req.get("requested_by") or {},
        "attendees": req.get("attendees") or [],
        "recurring": req.get("recurring"),
        "series_id": req.get("series_id"),
        "created_at": now,
        "updated_at": now,
        "cancelled": False,
        "from_request_id": req["id"],
        "auto_approved": bool(auto),
    }
    await db.room_bookings.insert_one(booking)
    booking.pop("_id", None)
    return booking


async def _auto_approve_request(request_id: str, actor: dict) -> Optional[dict]:
    """Server-side approval used by auto-approval. Returns
    { request, booking } on success, None if it couldn't be approved
    (e.g. room got booked in the interim)."""
    req = await db.meeting_room_requests.find_one({"id": request_id}, {"_id": 0})
    if not req or req.get("status") != STATUS_PENDING:
        return None
    try:
        booking = await _create_booking_from_request(req, actor, auto=True)
    except HTTPException:
        return None
    now = now_iso()
    await db.meeting_room_requests.update_one(
        {"id": request_id},
        {"$set": {
            "status": STATUS_APPROVED,
            "decided_by": {**actor, "auto_approved": True},
            "decided_on": now,
            "approved_booking_id": booking["id"],
            "updated_at": now,
        }},
    )
    await log_audit(
        actor=actor, action="meeting_room_request.auto_approve",
        resource="meeting_room_request", resource_id=request_id,
        detail=f"Auto-approved meeting-room request #{req.get('seq_no')} → booking #{booking.get('seq_no')}",
        metadata={"booking_id": booking["id"], "room_name": req.get("room_name"),
                  "start_at": req.get("start_at"), "auto": True},
    )
    fresh = await db.meeting_room_requests.find_one({"id": request_id}, {"_id": 0})
    return {"request": fresh, "booking": booking}


# --------------------------------------------------------------------------- #
# POST — submit request                                                       #
# --------------------------------------------------------------------------- #

@api_router.post("/meeting-room-requests")
async def create_meeting_room_request(
    payload: MeetingRoomRequestCreate,
    user=Depends(get_current_user),
):
    """Submit a meeting-room request.

    Respects Auto-Approval settings: if the current user matches an enabled
    cell in the `meeting_room` matrix, the request is immediately approved
    and the corresponding `room_bookings` row is created in one step.
    Otherwise the request stays in `Pending Approval` and awaits action from
    an admin on the Pending Approvals page.
    """
    ctx = await _resolve_room(payload.plan_id, payload.room_id)
    room = ctx["room"]
    plan = ctx["plan"]
    start = _parse_iso(payload.start_at, "start_at")
    end = _parse_iso(payload.end_at, "end_at")
    if end <= start:
        raise HTTPException(400, "end_at must be after start_at")

    # Build occurrence list (single or recurring)
    occurrences = [(start, end)]
    if payload.recurring:
        occurrences = _expand_recurring(start, end, payload.recurring)

    # Conflict pre-check across ALL occurrences (bookings AND pending reqs)
    conflicts: List[dict] = []
    for occ_s, occ_e in occurrences:
        bconf = await _first_conflict(payload.room_id, occ_s, occ_e)
        if bconf:
            conflicts.append({
                "occurrence_start": occ_s.isoformat(),
                "occurrence_end": occ_e.isoformat(),
                "with": {
                    "id": bconf.get("id"),
                    "title": bconf.get("title"),
                    "organizer": bconf.get("organizer"),
                    "start_at": bconf.get("start_at"),
                    "end_at": bconf.get("end_at"),
                },
                "kind": "booking",
            })
            continue
        pconf = await _first_pending_conflict(payload.room_id, occ_s, occ_e)
        if pconf:
            conflicts.append({
                "occurrence_start": occ_s.isoformat(),
                "occurrence_end": occ_e.isoformat(),
                "with": {
                    "id": pconf.get("id"),
                    "title": pconf.get("title"),
                    "organizer": pconf.get("requested_by"),
                    "start_at": pconf.get("start_at"),
                    "end_at": pconf.get("end_at"),
                },
                "kind": "pending",
            })
    if conflicts:
        raise HTTPException(409, {
            "code": "BOOKING_CONFLICT",
            "message": "This room is already booked or has a pending request for one or more requested times",
            "conflicts": conflicts,
            "room_name": room.get("name"),
        })

    # Insert one request per occurrence
    series_id = str(uuid.uuid4()) if payload.recurring else None
    now = now_iso()
    actor = _actor(user)
    inserted: List[dict] = []
    for occ_s, occ_e in occurrences:
        doc = {
            "id": str(uuid.uuid4()),
            "seq_no": await _next_seq(),
            "plan_id": payload.plan_id,
            "plan_name": plan.get("name"),
            "room_id": payload.room_id,
            "room_name": room.get("name"),
            "room_capacity": int(room.get("capacity") or 1),
            "title": payload.title.strip(),
            "start_at": occ_s.isoformat(),
            "end_at": occ_e.isoformat(),
            "attendees": [a.model_dump() for a in payload.attendees],
            "recurring": payload.recurring.model_dump() if payload.recurring else None,
            "series_id": series_id,
            "status": STATUS_PENDING,
            "requested_by": actor,
            "requested_on": now,
            "decided_by": None,
            "decided_on": None,
            "decision_note": None,
            "approved_booking_id": None,
            "created_at": now,
            "updated_at": now,
        }
        inserted.append(doc)
    if inserted:
        await db.meeting_room_requests.insert_many(inserted)
        for d in inserted:
            d.pop("_id", None)

    await log_audit(
        actor=actor, action="meeting_room_request.create",
        resource="meeting_room_request",
        detail=f"Submitted {len(inserted)} meeting-room request(s) on room '{room.get('name')}'",
        metadata={"plan_id": payload.plan_id, "room_id": payload.room_id,
                  "series_id": series_id, "occurrences": len(inserted)},
    )

    # --- Auto-approval check ------------------------------------------------
    booking_time = None
    try:
        booking_time = f"{start.hour:02d}:{start.minute:02d}"
    except Exception:
        pass
    auto_approved_bookings: List[dict] = []
    try:
        from routers.approval_settings import should_auto_approve_meeting_room
        if await should_auto_approve_meeting_room(
            actor,
            booking_date=start.date().isoformat(),
            booking_time=booking_time,
        ):
            for req in inserted:
                try:
                    result = await _auto_approve_request(req["id"], actor)
                    if result and result.get("booking"):
                        auto_approved_bookings.append(result["booking"])
                except Exception:
                    pass
    except Exception:
        pass

    # Refresh requests to reflect any auto-approvals
    fresh_requests: List[dict] = []
    for r in inserted:
        got = await db.meeting_room_requests.find_one({"id": r["id"]}, {"_id": 0})
        if got:
            fresh_requests.append(got)

    return {
        "ok": True,
        "created": len(inserted),
        "series_id": series_id,
        "requests": fresh_requests,
        "auto_approved": auto_approved_bookings,
        # First booking is returned so the old frontend flow can display "Meeting booked"
        # message with a start time. Empty when the request is Pending Approval.
        "first": auto_approved_bookings[0] if auto_approved_bookings else None,
    }


# --------------------------------------------------------------------------- #
# GET — list                                                                  #
# --------------------------------------------------------------------------- #

@api_router.get("/meeting-room-requests")
async def list_meeting_room_requests(
    status: Optional[str] = Query(None),
    plan_id: Optional[str] = Query(None),
    room_id: Optional[str] = Query(None),
    requested_by: Optional[str] = Query(None, description="filter by requester id"),
    include_hidden: bool = Query(False),
    user=Depends(get_current_user),
):
    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    if plan_id:
        q["plan_id"] = plan_id
    if room_id:
        q["room_id"] = room_id
    if requested_by:
        q["requested_by.id"] = requested_by
    if not include_hidden:
        q["hidden_by_requester"] = {"$ne": True}
    out = []
    async for r in db.meeting_room_requests.find(q, {"_id": 0}).sort([("requested_on", -1)]):
        out.append(r)
    return out


# --------------------------------------------------------------------------- #
# POST — approve                                                              #
# --------------------------------------------------------------------------- #

@api_router.post("/meeting-room-requests/{request_id}/approve")
async def approve_meeting_room_request(
    request_id: str,
    user=Depends(require_role("Super Admin")),
):
    req = await db.meeting_room_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Meeting-room request not found")
    if req.get("status") != STATUS_PENDING:
        raise HTTPException(400, f"Cannot approve a request with status '{req.get('status')}'")

    now = now_iso()
    actor = _actor(user)
    booking = await _create_booking_from_request(req, actor, auto=False)

    await db.meeting_room_requests.update_one(
        {"id": request_id},
        {"$set": {
            "status": STATUS_APPROVED,
            "decided_by": actor,
            "decided_on": now,
            "approved_booking_id": booking["id"],
            "updated_at": now,
        }},
    )
    await log_audit(
        actor=actor, action="meeting_room_request.approve",
        resource="meeting_room_request", resource_id=request_id,
        detail=f"Approved meeting-room request #{req.get('seq_no')} → booking #{booking.get('seq_no')}",
        metadata={"booking_id": booking["id"], "room_name": req.get("room_name"),
                  "start_at": req.get("start_at")},
    )
    # Notify the requester in-app
    try:
        from inapp_notifications import notify_user_inapp
        requester = (req.get("requested_by") or {})
        rid = requester.get("id")
        if rid:
            await notify_user_inapp(
                db,
                user_id=rid,
                kind="meeting_room_request_approved",
                variables={
                    "room_name": req.get("room_name"),
                    "title": req.get("title"),
                    "start_at": req.get("start_at"),
                    "plan_name": req.get("plan_name"),
                    "decided_by": actor.get("name"),
                    "name": requester.get("name"),
                },
                related_id=booking["id"],
                related_type="room_booking",
                action_url="/workspace-manager/meeting-room-booking",
            )
    except Exception:
        pass
    fresh = await db.meeting_room_requests.find_one({"id": request_id}, {"_id": 0})
    return {"ok": True, "request": fresh, "booking": booking}


# --------------------------------------------------------------------------- #
# POST — decline                                                              #
# --------------------------------------------------------------------------- #

@api_router.post("/meeting-room-requests/{request_id}/decline")
async def decline_meeting_room_request(
    request_id: str,
    user=Depends(require_role("Super Admin")),
):
    req = await db.meeting_room_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Meeting-room request not found")
    if req.get("status") != STATUS_PENDING:
        raise HTTPException(400, f"Cannot decline a request with status '{req.get('status')}'")
    now = now_iso()
    actor = _actor(user)
    await db.meeting_room_requests.update_one(
        {"id": request_id},
        {"$set": {
            "status": STATUS_DECLINED,
            "decided_by": actor,
            "decided_on": now,
            "updated_at": now,
        }},
    )
    await log_audit(
        actor=actor, action="meeting_room_request.decline",
        resource="meeting_room_request", resource_id=request_id,
        detail=f"Declined meeting-room request #{req.get('seq_no')}",
        metadata={"room_name": req.get("room_name"), "start_at": req.get("start_at")},
    )
    try:
        from inapp_notifications import notify_user_inapp
        requester = (req.get("requested_by") or {})
        rid = requester.get("id")
        if rid:
            await notify_user_inapp(
                db,
                user_id=rid,
                kind="meeting_room_request_declined",
                variables={
                    "room_name": req.get("room_name"),
                    "title": req.get("title"),
                    "start_at": req.get("start_at"),
                    "plan_name": req.get("plan_name"),
                    "decided_by": actor.get("name"),
                    "name": requester.get("name"),
                },
                related_id=request_id,
                related_type="meeting_room_request",
                action_url="/workspace-manager/meeting-room-booking",
            )
    except Exception:
        pass
    fresh = await db.meeting_room_requests.find_one({"id": request_id}, {"_id": 0})
    return {"ok": True, "request": fresh}


# --------------------------------------------------------------------------- #
# DELETE — cancel own pending request                                         #
# --------------------------------------------------------------------------- #

@api_router.delete("/meeting-room-requests/{request_id}")
async def cancel_meeting_room_request(
    request_id: str,
    user=Depends(get_current_user),
):
    req = await db.meeting_room_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Meeting-room request not found")
    is_owner = ((req.get("requested_by") or {}).get("id") == user.get("id"))
    is_super = user.get("role") == "Super Admin"
    if not (is_owner or is_super):
        raise HTTPException(403, "You can only cancel your own request")
    if req.get("status") != STATUS_PENDING:
        raise HTTPException(400, f"Cannot cancel a request with status '{req.get('status')}'")
    now = now_iso()
    actor = _actor(user)
    await db.meeting_room_requests.update_one(
        {"id": request_id},
        {"$set": {
            "status": STATUS_CANCELLED,
            "decided_by": actor,
            "decided_on": now,
            "decision_note": "Cancelled by requester",
            "hidden_by_requester": True,
            "updated_at": now,
        }},
    )
    await log_audit(
        actor=actor, action="meeting_room_request.cancel",
        resource="meeting_room_request", resource_id=request_id,
        detail=f"Cancelled meeting-room request #{req.get('seq_no')}",
    )
    return {"ok": True}
