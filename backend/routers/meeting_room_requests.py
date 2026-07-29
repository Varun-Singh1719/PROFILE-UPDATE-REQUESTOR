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
from datetime import datetime, date as date_cls, timedelta, timezone
from typing import List, Optional, Dict, Any

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core import api_router, db, get_current_user, require_role, now_iso, log_audit
from routers.permissions_v3 import require_any_v3_page_view


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
    """Parse an ISO 8601 datetime into a NAIVE UTC datetime.

    - Accepts `...Z`, `...+00:00`, `...+05:30`, and legacy naive strings.
    - TZ-aware inputs are converted to UTC before the tzinfo is stripped.
    - Legacy naive strings (no tz suffix) are treated as already-UTC
      (matches how records were stored prior to the Aug 2026 fix).

    Returning a NAIVE UTC datetime preserves compatibility with the existing
    conflict-detection logic which stringifies via `.isoformat()` and
    compares lexicographically against stored strings.
    """
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        raise HTTPException(400, f"Invalid ISO datetime for '{field}'")


def _iso_utc(dt: datetime) -> str:
    """Serialise a datetime to UTC ISO 8601 WITH a trailing `Z` so the
    frontend `new Date(...)` parses it as UTC (not as local time).

    Aug 2026 timezone-storage fix: before this, values were stored via
    `datetime.isoformat()` which drops the timezone suffix for naive
    datetimes — the browser then interpreted them as LOCAL time and
    displayed a 5:30h offset for IST users. Standardising on `Z`-tagged
    strings fixes the round-trip.
    """
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.isoformat(timespec="seconds") + "Z"


async def _resolve_room(plan_id: str, room_id: str) -> Dict[str, Any]:
    """Reuse the same resolution logic as room_bookings."""
    from routers.room_bookings import _resolve_room as _rb_resolve
    return await _rb_resolve(plan_id, room_id)


def _expand_recurring(base_start: datetime, base_end: datetime, rec: Recurring) -> List:
    """Reuse the expansion helper from room_bookings."""
    from routers.room_bookings import _expand_recurring as _rb_expand
    return _rb_expand(base_start, base_end, rec)


async def _first_conflict(
    room_id: str,
    start: datetime,
    end: datetime,
    exclude_booking_id: Optional[str] = None,
) -> Optional[dict]:
    """Check for booking conflicts (existing approved bookings)."""
    from routers.room_bookings import _first_conflict as _rb_first_conflict
    return await _rb_first_conflict(room_id, start, end, exclude_booking_id=exclude_booking_id)


async def _first_pending_conflict(
    room_id: str, start: datetime, end: datetime,
    exclude_request_id: Optional[str] = None,
) -> Optional[dict]:
    """Check for pending-request conflicts on the same room + overlapping time."""
    q: Dict[str, Any] = {
        "room_id": room_id,
        "status": {"$in": ACTIVE_PENDING_STATUSES},
        "start_at": {"$lt": _iso_utc(end)},
        "end_at":   {"$gt": _iso_utc(start)},
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
            "message": "This room is already booked at the selected time. Please choose another time slot or meeting room.",
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
            "message": "This room is already booked at the selected time. Please choose another time slot or meeting room.",
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
            "start_at": _iso_utc(occ_s),
            "end_at": _iso_utc(occ_e),
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

    # ---- Notify approvers of the new pending-approval request(s).
    # Fires the "Pending Approval — Meeting Room Requested" in-app
    # notification for every active Super Admin. Best-effort; a
    # notification hiccup never breaks the request-submit flow.
    try:
        from inapp_notifications import notify_user_inapp
        approvers = [
            u async for u in db.contacts.find(
                {"role": "Super Admin", "status": {"$ne": "Inactive"}},
                {"_id": 0, "id": 1, "name": 1, "email": 1},
            )
        ]
        if approvers:
            for req in inserted:
                reqby = req.get("requested_by") or actor or {}
                variables = {
                    "meeting_title": req.get("title") or "",
                    "room_name": req.get("room_name") or "",
                    "plan_name": req.get("plan_name") or "",
                    "start_at": req.get("start_at") or "",
                    "end_at": req.get("end_at") or "",
                    "requested_by_name": reqby.get("name") or reqby.get("email") or "—",
                    "requested_by_email": reqby.get("email") or "",
                }
                for approver in approvers:
                    aid = approver.get("id")
                    if not aid:
                        continue
                    try:
                        await notify_user_inapp(
                            db,
                            user_id=aid,
                            kind="meeting_room_request_submitted",
                            variables=variables,
                            related_id=req.get("id"),
                            related_type="meeting_room_request",
                            # Deep-link into Pending Approvals with this specific
                            # meeting-room request auto-focused.
                            action_url=f"/workspace-manager/pending-approvals?requestId={req.get('id')}",
                        )
                    except Exception:  # noqa: BLE001
                        pass
    except Exception:  # noqa: BLE001 — never break submit
        pass

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
    status: Optional[str] = Query(None, description="Single status OR comma-separated list"),
    plan_id: Optional[str] = Query(None),
    room_id: Optional[str] = Query(None),
    requested_by: Optional[str] = Query(None, description="filter by requester id"),
    mine: bool = Query(False, description="Return rows where the caller is the requester OR a direct/team attendee"),
    include_hidden: bool = Query(False),
    include_booking: bool = Query(True, description="Enrich Approved rows with the linked room_bookings row under `booking`"),
    user=Depends(require_any_v3_page_view(
        ("desk_booking", "pending_approvals"),
        ("desk_booking", "meeting_room_bookings"),
    )),
):
    """List meeting-room requests.

    New in Jul-2026: this is the primary endpoint the Book Meeting Room page
    reads from — it returns pending, approved, declined AND cancelled rows
    together, enriched with the linked `booking` doc when the row is
    Approved. The front-end uses this to render the user's list with a
    single fetch (previously it had to hit `/room-bookings` AND
    `/meeting-room-requests` separately).
    """
    q: Dict[str, Any] = {}
    # `status` accepts a single value ("Pending Approval") or a comma-separated
    # list ("Pending Approval,Approved") so the UI can drive filtering.
    if status:
        parts = [s.strip() for s in str(status).split(",") if s.strip()]
        q["status"] = {"$in": parts} if len(parts) > 1 else parts[0]
    if plan_id:
        q["plan_id"] = plan_id
    if room_id:
        q["room_id"] = room_id
    if requested_by:
        q["requested_by.id"] = requested_by
    if not include_hidden:
        q["hidden_by_requester"] = {"$ne": True}
    if mine:
        uid = user.get("id")
        uemail = (user.get("email") or "").lower()
        # Teams the user belongs to → so meetings that invite the user's team also surface.
        team_ids: List[str] = []
        try:
            cursor = db.teams.find(
                {"members": {"$elemMatch": {"$or": [{"id": uid}, {"email": uemail}]}}},
                {"id": 1, "_id": 0},
            )
            tdocs = await cursor.to_list(200)
            team_ids = [t.get("id") for t in tdocs if t.get("id")]
        except Exception:
            team_ids = []
        or_clauses: List[Dict[str, Any]] = [
            {"requested_by.id": uid},
            {"attendees": {"$elemMatch": {"type": "user", "id": uid}}},
        ]
        if team_ids:
            or_clauses.append({"attendees": {"$elemMatch": {"type": "team", "id": {"$in": team_ids}}}})
        q["$or"] = or_clauses

    out: List[dict] = []
    async for r in db.meeting_room_requests.find(q, {"_id": 0}).sort([("start_at", 1)]):
        out.append(r)

    # Enrich Approved rows with their booking snapshot so the UI can show
    # Booking ID / cancelled state without a second round-trip.
    if include_booking and out:
        booking_ids = [r.get("approved_booking_id") for r in out if r.get("approved_booking_id")]
        if booking_ids:
            b_cursor = db.room_bookings.find({"id": {"$in": booking_ids}}, {"_id": 0})
            b_docs = await b_cursor.to_list(len(booking_ids))
            b_map = {b["id"]: b for b in b_docs}
            for r in out:
                bid = r.get("approved_booking_id")
                if bid and bid in b_map:
                    r["booking"] = b_map[bid]
    return out


# --------------------------------------------------------------------------- #
# POST — reschedule (Pending or Approved)                                     #
# --------------------------------------------------------------------------- #

class MeetingRoomRequestReschedule(BaseModel):
    """Body for the reschedule endpoint. Recurring is intentionally NOT
    accepted — reschedule always targets a single occurrence."""
    plan_id: str
    room_id: str
    title: str = Field(..., min_length=1, max_length=120)
    start_at: str
    end_at: str
    attendees: List[Attendee] = Field(default_factory=list)


@api_router.post("/meeting-room-requests/{request_id}/reschedule")
async def reschedule_meeting_room_request(
    request_id: str,
    payload: MeetingRoomRequestReschedule,
    user=Depends(get_current_user),
):
    """Reschedule an existing meeting-room request.

    Allowed source statuses:
        • Pending Approval — the request row is updated in place.
        • Approved         — the linked room_bookings row is cancelled,
                             pushed into `reschedule_history`, and the
                             request row is reset to Pending Approval with
                             the new fields.

    Conflict validation excludes:
        • the request's own row (so a pending reschedule doesn't collide
          with itself).
        • the request's currently-approved booking (so an approved reschedule
          keeping the same time doesn't collide with itself).

    Auto-approval re-runs after the reschedule — if the requester matches
    an enabled cell in the matrix, a fresh booking is created immediately
    and the response carries it in `booking`.
    """
    req = await db.meeting_room_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Meeting-room request not found")
    is_owner = ((req.get("requested_by") or {}).get("id") == user.get("id"))
    is_super = user.get("role") == "Super Admin"
    if not (is_owner or is_super):
        raise HTTPException(403, "You can only reschedule your own request")
    if req.get("status") not in (STATUS_PENDING, STATUS_APPROVED):
        raise HTTPException(400, f"Cannot reschedule a request with status '{req.get('status')}'")

    ctx = await _resolve_room(payload.plan_id, payload.room_id)
    room = ctx["room"]
    plan = ctx["plan"]
    start = _parse_iso(payload.start_at, "start_at")
    end = _parse_iso(payload.end_at, "end_at")
    if end <= start:
        raise HTTPException(400, "end_at must be after start_at")

    # Conflict check — exclude the request's own booking AND its own pending row.
    exclude_bid = req.get("approved_booking_id") if req.get("status") == STATUS_APPROVED else None
    bconf = await _first_conflict(payload.room_id, start, end, exclude_booking_id=exclude_bid)
    if bconf:
        raise HTTPException(409, {
            "code": "BOOKING_CONFLICT",
            "message": "This room is already booked at the selected time. Please choose another time slot or meeting room.",
            "conflict": {
                "id": bconf.get("id"), "title": bconf.get("title"),
                "organizer": bconf.get("organizer"),
                "start_at": bconf.get("start_at"), "end_at": bconf.get("end_at"),
            },
            "room_name": room.get("name"),
        })
    pconf = await _first_pending_conflict(payload.room_id, start, end, exclude_request_id=request_id)
    if pconf:
        raise HTTPException(409, {
            "code": "BOOKING_CONFLICT",
            "message": "This room is already booked at the selected time. Please choose another time slot or meeting room.",
            "conflict": {
                "id": pconf.get("id"), "title": pconf.get("title"),
                "organizer": pconf.get("requested_by"),
                "start_at": pconf.get("start_at"), "end_at": pconf.get("end_at"),
            },
            "room_name": room.get("name"),
        })

    now = now_iso()
    actor = _actor(user)
    was_approved = (req.get("status") == STATUS_APPROVED)

    # If this was an approved booking, cancel the existing room_bookings row
    # and push it onto the request's reschedule_history so the audit trail
    # survives the transition.
    reschedule_history_entry: Optional[dict] = None
    if was_approved and req.get("approved_booking_id"):
        old_bid = req["approved_booking_id"]
        await db.room_bookings.update_one(
            {"id": old_bid},
            {"$set": {
                "cancelled": True,
                "cancelled_at": now,
                "cancelled_by": actor,
                "cancellation_reason": "rescheduled",
                "updated_at": now,
            }},
        )
        reschedule_history_entry = {
            "booking_id": old_bid,
            "old_plan_id": req.get("plan_id"),
            "old_plan_name": req.get("plan_name"),
            "old_room_id": req.get("room_id"),
            "old_room_name": req.get("room_name"),
            "old_start_at": req.get("start_at"),
            "old_end_at": req.get("end_at"),
            "old_title": req.get("title"),
            "rescheduled_at": now,
            "rescheduled_by": actor,
        }

    # Build the update. New room may change plan_id/plan_name/room_name/capacity.
    update_set: Dict[str, Any] = {
        "plan_id": payload.plan_id,
        "plan_name": plan.get("name"),
        "room_id": payload.room_id,
        "room_name": room.get("name"),
        "room_capacity": int(room.get("capacity") or 1),
        "title": payload.title,
        "start_at": _iso_utc(start),
        "end_at": _iso_utc(end),
        "attendees": [a.model_dump() for a in payload.attendees],
        "status": STATUS_PENDING,
        # Clear approval bookkeeping — we're starting the approval cycle over.
        "approved_booking_id": None,
        "decided_by": None,
        "decided_on": None,
        "decision_note": None,
        "updated_at": now,
    }
    update_ops: Dict[str, Any] = {"$set": update_set}
    if reschedule_history_entry:
        update_ops["$push"] = {"reschedule_history": reschedule_history_entry}
    await db.meeting_room_requests.update_one({"id": request_id}, update_ops)
    await log_audit(
        actor=actor,
        action="meeting_room_request.reschedule",
        resource="meeting_room_request",
        resource_id=request_id,
        detail=(f"Rescheduled request #{req.get('seq_no')} "
                f"({'was Approved → cancelled booking, back to Pending' if was_approved else 'still Pending Approval'})"),
        metadata={
            "was_approved": was_approved,
            "old_booking_id": (reschedule_history_entry or {}).get("booking_id"),
            "new_room_id": payload.room_id,
            "new_start_at": payload.start_at,
            "new_end_at": payload.end_at,
        },
    )

    # Re-run auto-approval — same policy as a brand-new submission.
    booking = None
    try:
        from routers.approval_settings import should_auto_approve_meeting_room
        fresh = await db.meeting_room_requests.find_one({"id": request_id}, {"_id": 0})
        if await should_auto_approve_meeting_room(
            actor=fresh.get("requested_by") or {},
            plan_id=fresh.get("plan_id"),
            plan_name=fresh.get("plan_name"),
        ):
            result = await _auto_approve_request(request_id, actor)
            if result:
                booking = result.get("booking")
    except Exception:
        pass

    fresh = await db.meeting_room_requests.find_one({"id": request_id}, {"_id": 0})
    return {"ok": True, "request": fresh, "booking": booking}


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
                # Deep-link into Meeting Room Booking with this booking auto-opened.
                action_url=f"/workspace-manager/meeting-room-booking?bookingId={booking['id']}",
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
                # Deep-link into Meeting Room Booking with the declined request
                # auto-opened in the detail modal.
                action_url=f"/workspace-manager/meeting-room-booking?requestId={request_id}",
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
    """Cancel a meeting-room request.

    Allowed source statuses:
        • Pending Approval  → status flips to `Cancelled`.
        • Approved          → linked room_bookings row is soft-cancelled
                              (`cancelled = True`) AND the request row
                              status flips to `Cancelled`. Historical
                              records survive in both tables — nothing is
                              deleted.

    Requesters cancel their own row; Super Admins can cancel anyone's.
    """
    req = await db.meeting_room_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Meeting-room request not found")
    is_owner = ((req.get("requested_by") or {}).get("id") == user.get("id"))
    is_super = user.get("role") == "Super Admin"
    if not (is_owner or is_super):
        raise HTTPException(403, "You can only cancel your own request")
    if req.get("status") not in (STATUS_PENDING, STATUS_APPROVED):
        raise HTTPException(400, f"Cannot cancel a request with status '{req.get('status')}'")
    now = now_iso()
    actor = _actor(user)
    was_approved = (req.get("status") == STATUS_APPROVED)
    booking_id = req.get("approved_booking_id")

    # If the booking exists, mark it cancelled first — never delete it.
    if was_approved and booking_id:
        await db.room_bookings.update_one(
            {"id": booking_id},
            {"$set": {
                "cancelled": True,
                "cancelled_at": now,
                "cancelled_by": actor,
                "cancellation_reason": "cancelled_by_requester",
                "updated_at": now,
            }},
        )

    await db.meeting_room_requests.update_one(
        {"id": request_id},
        {"$set": {
            "status": STATUS_CANCELLED,
            "decided_by": actor,
            "decided_on": now,
            "decision_note": "Cancelled by requester",
            # Only hide from the requester's list when it was still pending —
            # for an approved (already-happened) meeting we keep it visible
            # so the user can still see the "Cancelled" audit row.
            "hidden_by_requester": not was_approved,
            "updated_at": now,
        }},
    )
    await log_audit(
        actor=actor, action="meeting_room_request.cancel",
        resource="meeting_room_request", resource_id=request_id,
        detail=(f"Cancelled meeting-room request #{req.get('seq_no')} "
                f"({'was Approved → booking cancelled too' if was_approved else 'was Pending'})"),
        metadata={"was_approved": was_approved, "booking_id": booking_id},
    )
    return {"ok": True, "was_approved": was_approved, "booking_id": booking_id}
