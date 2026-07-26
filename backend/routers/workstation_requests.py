"""Workstation Requests — request-then-approve flow for workstation allocation.

Scope
=====
Mirrors `workstation_bookings.py` but introduces an approval step:

  user submits a request   →   status = "Pending Approval"
                          ↓
       approver clicks Approve   →   a real workstation booking is created
                                      request status → "Approved"
                          ↓
       approver clicks Decline   →   request status → "Declined"
                                      workstation released

Locking
=======
While a request is in "Pending Approval":
  • the affected seat(s) cannot be selected in Workstation Booking
  • the affected seat(s) cannot receive another request
  • the affected employees cannot have another pending request on the same date

The lock is enforced by `_pending_seat_ids_for` / `_pending_emp_ids_for` helpers
and is also surfaced via the `pending_seat_ids` field in both
`/api/workstation-requests/availability` and
`/api/workstation-bookings/availability`.

Data model
==========
  workstation_requests:
    { id, seq_no,
      plan_id, plan_name,
      seat_id, seat_label,
      date,
      employee { id, name, email, emp_id },
      team_id?, team_name?, team_color?,
      group_id,                              # uuid grouping multi-seat requests
      status: "Pending Approval" | "Approved" | "Declined",
      requested_by { id, name, email },      # actor who submitted the request
      requested_on,                          # ISO timestamp when request was created
      decided_by?, decided_on?,              # who/when approved or declined
      approved_booking_id?,                  # set when approved → links to the created booking row
      created_at, updated_at }

Endpoints
=========
GET    /api/workstation-requests/floor-plans          — reuses live plans list
GET    /api/workstation-requests/availability         — seats + occupancy + pending locks
GET    /api/workstation-requests                      — list (filter by status, plan, etc.)
GET    /api/workstation-requests/{id}                 — single
POST   /api/workstation-requests                      — submit a new request
POST   /api/workstation-requests/{id}/approve         — approve → creates booking
POST   /api/workstation-requests/{id}/decline         — decline → release seat
DELETE /api/workstation-requests/{id}                 — cancel my own pending request

Access control
==============
For now everything is gated to Super Admin (matching workstation_bookings), and the
Permissions module will refine Member/Manager/Admin scopes later.
"""
from __future__ import annotations

import uuid
from datetime import date as date_cls
from typing import List, Optional, Dict, Any

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core import api_router, db, get_current_user, require_role, now_iso, log_audit, client as _mongo_client


# --------------------------------------------------------------------------- #
# Status constants                                                            #
# --------------------------------------------------------------------------- #

STATUS_PENDING = "Pending Approval"
STATUS_APPROVED = "Approved"
STATUS_DECLINED = "Declined"
STATUS_CANCELLED = "Cancelled"

ACTIVE_PENDING_STATUSES = [STATUS_PENDING]  # statuses that "lock" the seat


# --------------------------------------------------------------------------- #
# Models                                                                      #
# --------------------------------------------------------------------------- #

class WorkstationRequestCreate(BaseModel):
    plan_id: str
    date: str = Field(..., description="YYYY-MM-DD — single full day, no recurring")
    seat_ids: List[str] = Field(..., min_length=1)
    employee_id: Optional[str] = None              # single-seat case
    team_id: Optional[str] = None                  # multi-seat case
    team_employee_ids: Optional[List[str]] = None  # multi-seat case (length == seat count)
    # Duplicate-pending replacement: when the client hits an EMPLOYEE_PENDING
    # conflict (same employee has an existing pending request on this date)
    # and the user confirms in the dialog, they re-submit the payload with
    # `replace_request_id` set to the existing pending request's id. The
    # server then atomically cancels that request and creates the new one.
    replace_request_id: Optional[str] = None


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #

SEQ_KEY = "workstation_request_seq"
SEQ_START = 30000  # first request → 30001 (distinct from bookings' 20000s)


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


async def _auto_approve_request(request_id: str, actor: dict) -> Optional[dict]:
    """Server-side approval used by the auto-approval flow.

    Mirrors `approve_workstation_request` but is callable without going through
    the FastAPI dependency stack (so it can run inside `create_workstation_request`).
    Returns `{ "request": <fresh>, "booking": <booking> }` on success or None
    if the seat is no longer available (caller should log & leave request pending).
    """
    req = await db.workstation_requests.find_one({"id": request_id}, {"_id": 0})
    if not req or req.get("status") != STATUS_PENDING:
        return None
    # Re-check seat availability (could have been booked in the interim).
    seat_clash = await db.workstation_bookings.find_one(
        {"plan_id": req["plan_id"], "seat_id": req["seat_id"],
         "date": req["date"], "cancelled": False},
        {"_id": 0, "seat_label": 1},
    )
    if seat_clash:
        return None
    from routers.workstation_bookings import _next_seq as _booking_seq
    now = now_iso()
    booking = {
        "id": str(uuid.uuid4()),
        "seq_no": await _booking_seq(),
        "plan_id": req["plan_id"],
        "plan_name": req.get("plan_name"),
        "seat_id": req["seat_id"],
        "seat_label": req.get("seat_label"),
        "date": req["date"],
        "employee": req.get("employee"),
        "team_id": req.get("team_id"),
        "team_name": req.get("team_name"),
        "team_color": req.get("team_color"),
        "recurring": None,
        "series_id": None,
        "cancelled": False,
        "created_at": now,
        "updated_at": now,
        "created_by": {**actor, "auto_approved": True},
        "from_request_id": req["id"],
    }
    await db.workstation_bookings.insert_one(booking)
    booking.pop("_id", None)
    await db.workstation_requests.update_one(
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
        actor=actor, action="workstation_request.auto_approve",
        resource="workstation_request", resource_id=request_id,
        detail=f"Auto-approved request #{req.get('seq_no')} → booking #{booking.get('seq_no')}",
        metadata={"booking_id": booking["id"], "seat_label": req.get("seat_label"),
                  "date": req["date"], "auto": True},
    )
    fresh = await db.workstation_requests.find_one({"id": request_id}, {"_id": 0})
    return {"request": fresh, "booking": booking}


def _parse_date(s: str, field: str = "date") -> date_cls:
    try:
        return date_cls.fromisoformat(s)
    except Exception:
        raise HTTPException(400, f"Invalid date for '{field}' (expected YYYY-MM-DD)")


async def _get_live_plan(plan_id: str) -> Dict[str, Any]:
    plan = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(404, "Floor plan not found")
    if (plan.get("status_override") or "").lower() == "inactive":
        raise HTTPException(400, "Floor plan is not Live")
    if not plan.get("live_version_id"):
        raise HTTPException(400, "Floor plan has no Live version yet")
    version = await db.floor_plan_versions.find_one({"id": plan["live_version_id"]}, {"_id": 0})
    if not version:
        raise HTTPException(400, "Live version missing")
    return {"plan": plan, "version": version}


async def _employee_lookup(employee_ids: List[str]) -> Dict[str, dict]:
    if not employee_ids:
        return {}
    docs = await db.contacts.find(
        {"id": {"$in": list(set(employee_ids))}},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "emp_id": 1, "status": 1},
    ).to_list(2000)
    return {d["id"]: d for d in docs}


async def _team_lookup(team_id: str) -> Optional[dict]:
    if not team_id:
        return None
    return await db.teams.find_one({"id": team_id}, {"_id": 0})


async def pending_seat_ids_for(plan_id: str, date: str) -> List[str]:
    """Return the seat IDs locked by pending workstation requests for (plan, date).

    Public helper — also used by `workstation_bookings.availability` and
    `workstation_bookings.create` to honour the cross-module lock.
    """
    rows = await db.workstation_requests.find(
        {"plan_id": plan_id, "date": date, "status": {"$in": ACTIVE_PENDING_STATUSES}},
        {"_id": 0, "seat_id": 1},
    ).to_list(2000)
    return sorted({r["seat_id"] for r in rows})


async def pending_employee_ids_for(date: str, plan_id: Optional[str] = None) -> List[str]:
    q: Dict[str, Any] = {"date": date, "status": {"$in": ACTIVE_PENDING_STATUSES}}
    if plan_id:
        q["plan_id"] = plan_id
    rows = await db.workstation_requests.find(q, {"_id": 0, "employee": 1}).to_list(2000)
    return sorted({
        (r.get("employee") or {}).get("id")
        for r in rows
        if (r.get("employee") or {}).get("id")
    })


def _request_view(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


async def auto_decline_conflicting_requests(
    *,
    plan_id: str,
    seat_ids: List[str],
    employee_ids: List[str],
    dates: List[str],
    actor: dict,
    reason: str = "Auto-declined: another workstation was allotted on this date",
) -> List[dict]:
    """Decline every pending workstation request that clashes with a newly
    created workstation booking.

    A request is considered clashing if, for any of the given `dates`, it is
    still in Pending Approval AND matches EITHER:
      • the same seat on the same floor plan (seat is now taken), OR
      • the same employee (the employee has been placed elsewhere for the day).

    Returns the list of declined request docs (post-update snapshots).
    """
    if not dates:
        return []
    or_clauses: List[Dict[str, Any]] = []
    if seat_ids:
        or_clauses.append({"plan_id": plan_id, "seat_id": {"$in": seat_ids}})
    if employee_ids:
        or_clauses.append({"employee.id": {"$in": employee_ids}})
    if not or_clauses:
        return []
    query = {
        "date": {"$in": dates},
        "status": {"$in": ACTIVE_PENDING_STATUSES},
        "$or": or_clauses,
    }
    matches = await db.workstation_requests.find(query, {"_id": 0}).to_list(2000)
    if not matches:
        return []
    now = now_iso()
    declined_ids = [m["id"] for m in matches]
    await db.workstation_requests.update_many(
        {"id": {"$in": declined_ids}},
        {"$set": {
            "status": STATUS_DECLINED,
            "decided_by": {**actor, "auto_declined": True},
            "decided_on": now,
            "decision_note": reason,
            "updated_at": now,
        }},
    )
    # Best-effort in-app notifications + audit — never break booking creation.
    try:
        from inapp_notifications import notify_user_inapp
        for m in matches:
            emp = (m.get("employee") or {})
            emp_user_id = emp.get("id")
            if emp_user_id:
                try:
                    await notify_user_inapp(
                        db,
                        user_id=emp_user_id,
                        kind="workstation_request_declined",
                        variables={
                            "seat_label": m.get("seat_label"),
                            "date": m.get("date"),
                            "plan_name": m.get("plan_name"),
                            "decided_by": actor.get("name"),
                            "name": emp.get("name"),
                            "reason": reason,
                        },
                        related_id=m["id"],
                        related_type="workstation_request",
                        action_url="/workspace-manager/workstation-requests",
                    )
                except Exception:  # noqa: BLE001
                    pass
    except Exception:  # noqa: BLE001
        pass
    try:
        await log_audit(
            actor=actor, action="workstation_request.auto_decline",
            resource="workstation_request",
            detail=f"Auto-declined {len(declined_ids)} pending workstation request(s) after seat allotment",
            metadata={"request_ids": declined_ids, "reason": reason,
                      "dates": dates, "seat_ids": seat_ids,
                      "employee_ids": employee_ids},
        )
    except Exception:  # noqa: BLE001
        pass
    fresh = await db.workstation_requests.find({"id": {"$in": declined_ids}}, {"_id": 0}).to_list(2000)
    return fresh


# --------------------------------------------------------------------------- #
# Endpoints — read                                                            #
# --------------------------------------------------------------------------- #

@api_router.get("/workstation-requests/floor-plans")
async def list_request_floor_plans(user=Depends(get_current_user)):
    """Same shape as /workstation-bookings/floor-plans — live plans w/ workstations."""
    from routers.workstation_bookings import _list_live_plans_with_seats  # type: ignore
    return await _list_live_plans_with_seats()


@api_router.get("/workstation-requests/availability")
async def request_availability(
    plan_id: str = Query(...),
    date: str = Query(..., description="YYYY-MM-DD"),
    user=Depends(get_current_user),
):
    """Return seats + bookings + pending requests for (plan, date).

    Response shape adds `pending_seat_ids` and `pending_requests` to the standard
    workstation-bookings availability payload.
    """
    _parse_date(date)
    ctx = await _get_live_plan(plan_id)
    plan = ctx["plan"]
    version = ctx["version"]
    seats = version.get("seats") or []

    # ---- Active bookings on this date (excluding inactive employees, matching bookings logic)
    bookings = await db.workstation_bookings.find(
        {"plan_id": plan_id, "date": date, "cancelled": False},
        {"_id": 0},
    ).to_list(2000)
    if bookings:
        emp_ids = [(b.get("employee") or {}).get("id") for b in bookings]
        emp_map = await _employee_lookup([e for e in emp_ids if e])
        active = []
        for b in bookings:
            eid = (b.get("employee") or {}).get("id")
            emp = emp_map.get(eid) if eid else None
            if not emp:
                continue
            if (emp.get("status") or "").lower() == "inactive":
                continue
            active.append(b)
        bookings = active

    # ---- Pending requests on this date
    pending = await db.workstation_requests.find(
        {"plan_id": plan_id, "date": date, "status": {"$in": ACTIVE_PENDING_STATUSES}},
        {"_id": 0},
    ).to_list(2000)

    booked_seat_ids = sorted({b["seat_id"] for b in bookings})
    booked_employee_ids = sorted({(b.get("employee") or {}).get("id") for b in bookings if (b.get("employee") or {}).get("id")})
    pending_seat_ids = sorted({p["seat_id"] for p in pending})
    pending_employee_ids = sorted({(p.get("employee") or {}).get("id") for p in pending if (p.get("employee") or {}).get("id")})

    return {
        "plan": {
            "id": plan["id"],
            "name": plan.get("name") or version.get("name"),
            "pdfUrl": version.get("pdfUrl") or plan.get("pdfUrl"),
            "version_number": version.get("version_number"),
        },
        "seats": seats,
        "bookings": bookings,
        "booked_seat_ids": booked_seat_ids,
        "booked_employee_ids": booked_employee_ids,
        "pending_requests": pending,
        "pending_seat_ids": pending_seat_ids,
        "pending_employee_ids": pending_employee_ids,
    }


@api_router.get("/workstation-requests")
async def list_workstation_requests(
    user=Depends(get_current_user),
    status: Optional[str] = Query(None, description="Pending Approval | Approved | Declined | Cancelled"),
    plan_id: Optional[str] = Query(None),
    seat_id: Optional[str] = Query(None),
    employee_id: Optional[str] = Query(None),
    team_id: Optional[str] = Query(None),
    requested_by: Optional[str] = Query(None),
    date: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    # Filter on `requested_on` (submission timestamp) — used by the
    # "My Bookings" tab's "Requested On" date filter.
    requested_from: Optional[str] = Query(None),
    requested_to: Optional[str] = Query(None),
    include_hidden: bool = Query(True, description="Include requests soft-deleted by the requester"),
):
    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    if plan_id:
        q["plan_id"] = plan_id
    if seat_id:
        q["seat_id"] = seat_id
    if employee_id:
        q["employee.id"] = employee_id
    if team_id:
        q["team_id"] = team_id
    if requested_by:
        q["requested_by.id"] = requested_by
    if not include_hidden:
        q["hidden_by_requester"] = {"$ne": True}
    if date:
        _parse_date(date)
        q["date"] = date
    elif date_from or date_to:
        rng: Dict[str, str] = {}
        if date_from:
            _parse_date(date_from, "date_from")
            rng["$gte"] = date_from
        if date_to:
            _parse_date(date_to, "date_to")
            rng["$lte"] = date_to
        if rng:
            q["date"] = rng
    # Optional `requested_on` range (submission timestamp). `requested_on` is
    # stored as an ISO-8601 string ("2026-07-20T10:15:00+00:00") so range
    # comparisons on the raw string are safe as long as both endpoints get
    # inclusive full-day bounds.
    if requested_from or requested_to:
        rrng: Dict[str, str] = {}
        if requested_from:
            _parse_date(requested_from, "requested_from")
            rrng["$gte"] = f"{requested_from}T00:00:00"
        if requested_to:
            _parse_date(requested_to, "requested_to")
            rrng["$lte"] = f"{requested_to}T23:59:59.999999+00:00"
        if rrng:
            q["requested_on"] = rrng
    docs = await db.workstation_requests.find(q, {"_id": 0}).sort([
        ("status", 1), ("requested_on", -1), ("seat_label", 1),
    ]).to_list(2000)
    return docs


@api_router.get("/workstation-requests/{request_id}")
async def get_workstation_request(request_id: str, user=Depends(get_current_user)):
    doc = None
    if request_id.isdigit():
        doc = await db.workstation_requests.find_one({"seq_no": int(request_id)}, {"_id": 0})
    if not doc:
        doc = await db.workstation_requests.find_one({"id": request_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Workstation request not found")
    return doc


# --------------------------------------------------------------------------- #
# Endpoints — write                                                           #
# --------------------------------------------------------------------------- #

@api_router.post("/workstation-requests")
async def create_workstation_request(
    payload: WorkstationRequestCreate,
    user=Depends(require_role("Super Admin")),
):
    """Submit one or more workstation requests (no recurring).

    Validation mirrors workstation booking creation, with one extra cross-check:
    a seat cannot be requested if it is already locked by another pending request,
    and cannot be requested if it already has an active booking on the same date.
    """
    ctx = await _get_live_plan(payload.plan_id)
    plan = ctx["plan"]
    version = ctx["version"]
    seat_index = {s["id"]: s for s in (version.get("seats") or [])}

    # ---- Resolve seats
    seat_ids = list(dict.fromkeys(payload.seat_ids))
    if not seat_ids:
        raise HTTPException(400, "At least one workstation must be selected")
    missing = [sid for sid in seat_ids if sid not in seat_index]
    if missing:
        raise HTTPException(400, f"Workstation(s) not found in this floor plan: {', '.join(missing)}")

    # ---- Resolve employee(s)
    single = len(seat_ids) == 1
    if single:
        if not payload.employee_id:
            raise HTTPException(400, "employee_id is required when requesting a single workstation")
        if payload.team_id or payload.team_employee_ids:
            raise HTTPException(400, "team_id / team_employee_ids must be omitted for single-seat requests")
        seat_to_emp = {seat_ids[0]: payload.employee_id}
        team = None
    else:
        if not payload.team_id:
            raise HTTPException(400, "team_id is required when requesting multiple workstations")
        team = await _team_lookup(payload.team_id)
        if not team:
            raise HTTPException(404, "Team not found")
        emp_ids = payload.team_employee_ids or []
        if len(emp_ids) != len(seat_ids):
            raise HTTPException(400, f"team_employee_ids count ({len(emp_ids)}) must equal seat count ({len(seat_ids)})")
        allowed = set((team.get("member_ids") or []) + (team.get("manager_ids") or []))
        bad = [e for e in emp_ids if e not in allowed]
        if bad:
            raise HTTPException(400, "All assigned employees must be members or managers of the selected team")
        if len(set(emp_ids)) != len(emp_ids):
            raise HTTPException(400, "The same employee cannot be assigned to multiple workstations")
        seat_to_emp = {seat_ids[i]: emp_ids[i] for i in range(len(seat_ids))}

    # ---- Resolve employee docs (must be active)
    all_emp_ids = list(set(seat_to_emp.values()))
    emp_map = await _employee_lookup(all_emp_ids)
    for eid in all_emp_ids:
        emp = emp_map.get(eid)
        if not emp:
            raise HTTPException(404, f"Employee not found: {eid}")
        if (emp.get("status") or "").lower() != "active":
            raise HTTPException(400, f"Employee is not active: {emp.get('name') or eid}")

    target_date = _parse_date(payload.date).isoformat()

    # ---- Cross-check #1: any seat already booked?
    seat_conflict = await db.workstation_bookings.find_one(
        {"plan_id": payload.plan_id, "seat_id": {"$in": seat_ids}, "date": target_date, "cancelled": False},
        {"_id": 0, "seat_id": 1, "seat_label": 1, "date": 1, "employee": 1},
    )
    if seat_conflict:
        e = seat_conflict.get("employee") or {}
        emp_doc = (await _employee_lookup([e.get("id")])) if e.get("id") else {}
        if not e.get("id") or (emp_doc.get(e["id"]) or {}).get("status") != "Inactive":
            raise HTTPException(409, {
                "code": "WORKSTATION_OCCUPIED",
                "message": f"Workstation {seat_conflict['seat_label']} is already booked on {seat_conflict['date']}",
                "conflict": seat_conflict,
            })

    # ---- Cross-check #2: any seat already has a pending request?
    # If the client is replacing a specific pending request, exclude that
    # request from this check — otherwise a "replace with the same seat"
    # (or with a different seat) would spuriously trip the seat-pending lock
    # on the request being cancelled.
    pending_q = {
        "plan_id": payload.plan_id,
        "seat_id": {"$in": seat_ids},
        "date": target_date,
        "status": {"$in": ACTIVE_PENDING_STATUSES},
    }
    if payload.replace_request_id:
        pending_q["id"] = {"$ne": payload.replace_request_id}
    pending_conflict = await db.workstation_requests.find_one(
        pending_q,
        {"_id": 0, "seat_id": 1, "seat_label": 1, "date": 1, "employee": 1, "requested_by": 1},
    )
    if pending_conflict:
        raise HTTPException(409, {
            "code": "WORKSTATION_PENDING",
            "message": f"Workstation {pending_conflict['seat_label']} already has a pending request on {pending_conflict['date']}",
            "conflict": pending_conflict,
        })

    # ---- Cross-check #3: employee already booked / pending on this date?
    emp_booking_conflict = await db.workstation_bookings.find_one(
        {"employee.id": {"$in": all_emp_ids}, "date": target_date, "cancelled": False},
        {"_id": 0, "employee": 1, "date": 1, "seat_label": 1},
    )
    if emp_booking_conflict:
        eid = (emp_booking_conflict.get("employee") or {}).get("id")
        emp_doc = (await _employee_lookup([eid])) if eid else {}
        if not eid or (emp_doc.get(eid) or {}).get("status") != "Inactive":
            raise HTTPException(409, {
                "code": "EMPLOYEE_ALREADY_BOOKED",
                "message": f"{(emp_booking_conflict.get('employee') or {}).get('name')} already has a booking on {emp_booking_conflict['date']}",
                "conflict": emp_booking_conflict,
            })
    emp_pending_conflict = await db.workstation_requests.find_one(
        {"employee.id": {"$in": all_emp_ids}, "date": target_date, "status": {"$in": ACTIVE_PENDING_STATUSES}},
        {"_id": 0, "id": 1, "employee": 1, "date": 1, "seat_id": 1, "seat_label": 1,
         "status": 1, "requested_by": 1, "requested_on": 1, "plan_name": 1, "team_name": 1},
    )
    if emp_pending_conflict:
        # If the client is explicitly asking to REPLACE this pending request
        # (Duplicate Pending Approval Validation flow), skip the 409 and fall
        # through to the transactional replace below.
        if not (
            payload.replace_request_id
            and payload.replace_request_id == emp_pending_conflict.get("id")
        ):
            emp_name = (emp_pending_conflict.get("employee") or {}).get("name")
            raise HTTPException(409, {
                "code": "EMPLOYEE_PENDING",
                "message": f"{emp_name} already has a pending request on {emp_pending_conflict['date']}",
                # Rich context so the frontend can render the Duplicate Pending
                # confirmation dialog directly from this payload without an
                # extra round-trip.
                "conflict": {
                    "id": emp_pending_conflict.get("id"),
                    "employee": emp_pending_conflict.get("employee"),
                    "date": emp_pending_conflict.get("date"),
                    "seat_id": emp_pending_conflict.get("seat_id"),
                    "seat_label": emp_pending_conflict.get("seat_label"),
                    "status": emp_pending_conflict.get("status"),
                    "requested_by": emp_pending_conflict.get("requested_by"),
                    "requested_on": emp_pending_conflict.get("requested_on"),
                    "plan_name": emp_pending_conflict.get("plan_name"),
                    "team_name": emp_pending_conflict.get("team_name"),
                },
            })

    # ---- Insert one request per (seat) — grouped by group_id
    group_id = str(uuid.uuid4())
    now = now_iso()
    actor = _actor(user)
    inserted: List[dict] = []
    for sid in seat_ids:
        seat = seat_index[sid]
        eid = seat_to_emp[sid]
        emp = emp_map[eid]
        doc = {
            "id": str(uuid.uuid4()),
            "seq_no": await _next_seq(),
            "plan_id": payload.plan_id,
            "plan_name": plan.get("name") or version.get("name"),
            "seat_id": sid,
            "seat_label": seat.get("label") or sid,
            "date": target_date,
            "employee": {
                "id": emp["id"], "name": emp.get("name"), "email": emp.get("email"), "emp_id": emp.get("emp_id"),
            },
            "team_id": (team or {}).get("id") if team else None,
            "team_name": (team or {}).get("name") if team else None,
            "team_color": (team or {}).get("color") if team else None,
            "group_id": group_id,
            "status": STATUS_PENDING,
            "requested_by": actor,
            "requested_on": now,
            "decided_by": None,
            "decided_on": None,
            "approved_booking_id": None,
            "created_at": now,
            "updated_at": now,
        }
        inserted.append(doc)

    # ---- Duplicate-Pending Replace flow (transactional) --------------------
    # When the caller explicitly asks to replace their existing pending
    # request, we (a) revalidate that the target is still Pending Approval
    # (guards against a race where an approver has just acted on it), and
    # (b) atomically cancel-old + insert-new so the two operations either
    # both land or both roll back. Concurrent approval detection is handled
    # by including `status: STATUS_PENDING` in the update filter — if the
    # row has moved to Approved / Declined / Cancelled in the meantime, the
    # update matches 0 rows and we surface REPLACE_TARGET_NOT_PENDING.
    replaced_request_summary: Optional[dict] = None
    if payload.replace_request_id:
        existing = await db.workstation_requests.find_one(
            {"id": payload.replace_request_id},
            {"_id": 0, "id": 1, "status": 1, "employee": 1, "date": 1, "seat_label": 1},
        )
        if not existing:
            raise HTTPException(404, {
                "code": "REPLACE_TARGET_NOT_FOUND",
                "message": "The existing request could not be found. Please refresh the page and try again.",
            })
        if existing.get("status") != STATUS_PENDING:
            raise HTTPException(409, {
                "code": "REPLACE_TARGET_NOT_PENDING",
                "message": "The existing request has already been processed. Please refresh the page and try again.",
                "current_status": existing.get("status"),
            })
        async with await _mongo_client.start_session() as session:
            async with session.start_transaction():
                # Cancel old (with audit trail). status guard makes it a CAS.
                upd = await db.workstation_requests.update_one(
                    {"id": payload.replace_request_id, "status": STATUS_PENDING},
                    {"$set": {
                        "status": STATUS_CANCELLED,
                        "cancelled_by": actor,
                        "cancelled_on": now,
                        "cancellation_reason": "Replaced by a new booking request",
                        "replaced_by_group_id": group_id,
                        "updated_at": now,
                    }},
                    session=session,
                )
                if upd.modified_count == 0:
                    # Someone else moved it out of Pending in the tiny window
                    # between our pre-check and the CAS update — abort.
                    raise HTTPException(409, {
                        "code": "REPLACE_TARGET_NOT_PENDING",
                        "message": "The existing request has already been processed. Please refresh the page and try again.",
                    })
                # Insert the new request(s)
                if inserted:
                    await db.workstation_requests.insert_many(inserted, session=session)
        for d in inserted:
            d.pop("_id", None)
        replaced_request_summary = {
            "id": existing.get("id"),
            "seat_label": existing.get("seat_label"),
            "date": existing.get("date"),
            "employee": existing.get("employee"),
        }
        await log_audit(
            actor=actor, action="workstation_request.replace",
            resource="workstation_request",
            detail=f"Replaced pending request {existing.get('id')} with a new request on plan '{plan.get('name')}'",
            metadata={"plan_id": payload.plan_id, "seat_ids": seat_ids,
                      "date": target_date, "group_id": group_id,
                      "replaced_request_id": existing.get("id")},
        )
    else:
        # ---- Plain (non-replace) path: just insert
        if inserted:
            await db.workstation_requests.insert_many(inserted)
            for d in inserted:
                d.pop("_id", None)

        await log_audit(
            actor=actor, action="workstation_request.create",
            resource="workstation_request",
            detail=f"Submitted {len(inserted)} workstation request(s) on plan '{plan.get('name')}'",
            metadata={"plan_id": payload.plan_id, "seat_ids": seat_ids,
                      "date": target_date, "group_id": group_id,
                      "team_id": (team or {}).get("id") if team else None},
        )

    # ---- Auto-approval (phase 1: workstation only, single-day, non-recurring)
    # If the current settings match this submitter, immediately approve every
    # freshly-created request and return the resulting bookings alongside the
    # requests. Failures are non-fatal — the request stays in Pending Approval.
    auto_approved: List[dict] = []
    try:
        from routers.approval_settings import should_auto_approve_workstation
        if await should_auto_approve_workstation(
            actor, is_recurring=False, booking_date=target_date,
        ):
            for req in inserted:
                try:
                    result = await _auto_approve_request(req["id"], actor)
                    if result and result.get("booking"):
                        auto_approved.append(result["booking"])
                except Exception:
                    # Best-effort; leave the request Pending for manual review.
                    pass
    except Exception:
        pass

    return {
        "ok": True,
        "created": len(inserted),
        "group_id": group_id,
        "requests": inserted,
        "auto_approved": auto_approved,
        "replaced_request": replaced_request_summary,
    }


@api_router.post("/workstation-requests/{request_id}/approve")
async def approve_workstation_request(
    request_id: str,
    user=Depends(require_role("Super Admin")),
):
    """Approve a pending request → create a workstation booking + mark approved.

    The booking is created with the same plan/seat/employee/date as the request.
    If the seat has somehow been taken between submit and approve (e.g. a manual
    booking), we return 409 and leave the request in Pending Approval state.
    """
    req = await db.workstation_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Workstation request not found")
    if req.get("status") != STATUS_PENDING:
        raise HTTPException(400, f"Cannot approve a request with status '{req.get('status')}'")

    # Re-check seat availability at approval time
    seat_clash = await db.workstation_bookings.find_one(
        {"plan_id": req["plan_id"], "seat_id": req["seat_id"], "date": req["date"], "cancelled": False},
        {"_id": 0, "seat_label": 1, "date": 1, "employee": 1},
    )
    if seat_clash:
        raise HTTPException(409, {
            "code": "WORKSTATION_OCCUPIED",
            "message": f"Workstation {seat_clash['seat_label']} was booked by someone else.",
            "conflict": seat_clash,
        })

    # Create the booking row using bookings router's seq counter
    from routers.workstation_bookings import _next_seq as _booking_seq
    now = now_iso()
    actor = _actor(user)
    booking = {
        "id": str(uuid.uuid4()),
        "seq_no": await _booking_seq(),
        "plan_id": req["plan_id"],
        "plan_name": req.get("plan_name"),
        "seat_id": req["seat_id"],
        "seat_label": req.get("seat_label"),
        "date": req["date"],
        "employee": req.get("employee"),
        "team_id": req.get("team_id"),
        "team_name": req.get("team_name"),
        "team_color": req.get("team_color"),
        "recurring": None,
        "series_id": None,
        "cancelled": False,
        "created_at": now,
        "updated_at": now,
        "created_by": actor,
        "from_request_id": req["id"],
    }
    await db.workstation_bookings.insert_one(booking)
    booking.pop("_id", None)

    await db.workstation_requests.update_one(
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
        actor=actor, action="workstation_request.approve",
        resource="workstation_request", resource_id=request_id,
        detail=f"Approved workstation request #{req.get('seq_no')} → booking #{booking.get('seq_no')}",
        metadata={"booking_id": booking["id"], "seat_label": req.get("seat_label"), "date": req["date"]},
    )

    fresh = await db.workstation_requests.find_one({"id": request_id}, {"_id": 0})
    # Notify the requester in-app that their request was approved
    try:
        from inapp_notifications import notify_user_inapp
        emp = (req.get("employee") or {})
        # Prefer the employee's user id (bookings target employees, not contacts)
        emp_user_id = emp.get("id")
        if emp_user_id:
            await notify_user_inapp(
                db,
                user_id=emp_user_id,
                kind="workstation_request_approved",
                variables={
                    "seat_label": req.get("seat_label"),
                    "date": req.get("date"),
                    "plan_name": req.get("plan_name"),
                    "decided_by": actor.get("name"),
                    "name": emp.get("name"),
                },
                related_id=booking["id"],
                related_type="workstation_booking",
                action_url="/workspace-manager/bookings",
            )
    except Exception:  # noqa: BLE001 — never break the approval flow
        pass
    return {"ok": True, "request": fresh, "booking": booking}


@api_router.post("/workstation-requests/{request_id}/decline")
async def decline_workstation_request(
    request_id: str,
    user=Depends(require_role("Super Admin")),
):
    req = await db.workstation_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Workstation request not found")
    if req.get("status") != STATUS_PENDING:
        raise HTTPException(400, f"Cannot decline a request with status '{req.get('status')}'")

    now = now_iso()
    actor = _actor(user)
    await db.workstation_requests.update_one(
        {"id": request_id},
        {"$set": {
            "status": STATUS_DECLINED,
            "decided_by": actor,
            "decided_on": now,
            "updated_at": now,
        }},
    )
    await log_audit(
        actor=actor, action="workstation_request.decline",
        resource="workstation_request", resource_id=request_id,
        detail=f"Declined workstation request #{req.get('seq_no')}",
        metadata={"seat_label": req.get("seat_label"), "date": req["date"]},
    )
    fresh = await db.workstation_requests.find_one({"id": request_id}, {"_id": 0})
    # Notify the requester in-app that their request was declined
    try:
        from inapp_notifications import notify_user_inapp
        emp = (req.get("employee") or {})
        emp_user_id = emp.get("id")
        if emp_user_id:
            await notify_user_inapp(
                db,
                user_id=emp_user_id,
                kind="workstation_request_declined",
                variables={
                    "seat_label": req.get("seat_label"),
                    "date": req.get("date"),
                    "plan_name": req.get("plan_name"),
                    "decided_by": actor.get("name"),
                    "name": emp.get("name"),
                },
                related_id=request_id,
                related_type="workstation_request",
                action_url="/workspace-manager/workstation-requests",
            )
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "request": fresh}


@api_router.delete("/workstation-requests/{request_id}")
async def cancel_workstation_request(
    request_id: str,
    user=Depends(get_current_user),
):
    """Soft-delete a pending request (used by the My Bookings "Delete" button).

    Semantics:
      • Sets status → "Cancelled"
      • Marks `hidden_by_requester=True` so it disappears from BOTH the
        requester's My Bookings tab AND the admin's Workstation Requests
        table.
      • The row still lives in the DB and surfaces in the aggregated
        Bookings module with status "Cancelled".

    Allowed for the requester themselves OR any Super Admin, only while the
    request is still in Pending Approval.
    """
    req = await db.workstation_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Workstation request not found")
    is_owner = ((req.get("requested_by") or {}).get("id") == user.get("id"))
    is_super = user.get("role") == "Super Admin"
    if not (is_owner or is_super):
        raise HTTPException(403, "You can only cancel your own request")
    if req.get("status") != STATUS_PENDING:
        raise HTTPException(400, f"Cannot cancel a request with status '{req.get('status')}'")
    now = now_iso()
    actor = _actor(user)
    await db.workstation_requests.update_one(
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
        actor=actor, action="workstation_request.cancel",
        resource="workstation_request", resource_id=request_id,
        detail=f"Cancelled (soft-deleted) workstation request #{req.get('seq_no')}",
    )
    return {"ok": True}


# --------------------------------------------------------------------------- #
# PATCH — edit a pending request (date + seat within same plan)               #
# --------------------------------------------------------------------------- #

class WorkstationRequestPatch(BaseModel):
    date: Optional[str] = Field(None, description="YYYY-MM-DD — new booking date")
    seat_id: Optional[str] = Field(None, description="New seat id within the SAME floor plan")


@api_router.patch("/workstation-requests/{request_id}")
async def update_workstation_request(
    request_id: str,
    payload: WorkstationRequestPatch,
    user=Depends(get_current_user),
):
    """Edit a pending workstation request.

    Allowed fields: `date`, `seat_id` (must belong to the same floor plan).
    Only the original requester or a Super Admin can edit, and only while the
    request is in Pending Approval. Re-runs the same seat/employee conflict
    checks as creation.
    """
    req = await db.workstation_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Workstation request not found")
    is_owner = ((req.get("requested_by") or {}).get("id") == user.get("id"))
    is_super = user.get("role") == "Super Admin"
    if not (is_owner or is_super):
        raise HTTPException(403, "You can only edit your own request")
    if req.get("status") != STATUS_PENDING:
        raise HTTPException(400, f"Cannot edit a request with status '{req.get('status')}'")

    new_date = req["date"]
    new_seat_id = req["seat_id"]
    new_seat_label = req.get("seat_label")

    if payload.date and payload.date != req["date"]:
        new_date = _parse_date(payload.date).isoformat()

    if payload.seat_id and payload.seat_id != req["seat_id"]:
        # Ensure the seat belongs to the same live floor plan
        ctx = await _get_live_plan(req["plan_id"])
        version = ctx["version"]
        seat_index = {s["id"]: s for s in (version.get("seats") or [])}
        if payload.seat_id not in seat_index:
            raise HTTPException(400, "Selected workstation is not part of the same floor plan")
        new_seat_id = payload.seat_id
        new_seat_label = seat_index[payload.seat_id].get("label") or payload.seat_id

    # No-op guard
    if new_date == req["date"] and new_seat_id == req["seat_id"]:
        return {"ok": True, "request": req, "unchanged": True}

    # ---- Re-validate against bookings / other pending requests on new (seat, date)
    seat_booking_clash = await db.workstation_bookings.find_one(
        {"plan_id": req["plan_id"], "seat_id": new_seat_id, "date": new_date, "cancelled": False},
        {"_id": 0, "seat_label": 1, "date": 1, "employee": 1},
    )
    if seat_booking_clash:
        raise HTTPException(409, {
            "code": "WORKSTATION_OCCUPIED",
            "message": f"Workstation {seat_booking_clash['seat_label']} is already booked on {seat_booking_clash['date']}",
            "conflict": seat_booking_clash,
        })
    pending_seat_clash = await db.workstation_requests.find_one(
        {"plan_id": req["plan_id"], "seat_id": new_seat_id, "date": new_date,
         "id": {"$ne": request_id},
         "status": {"$in": ACTIVE_PENDING_STATUSES}},
        {"_id": 0, "seat_label": 1, "date": 1},
    )
    if pending_seat_clash:
        raise HTTPException(409, {
            "code": "WORKSTATION_PENDING",
            "message": f"Workstation {pending_seat_clash['seat_label']} already has a pending request on {pending_seat_clash['date']}",
            "conflict": pending_seat_clash,
        })

    # If the date is changing, also make sure the employee isn't already
    # booked or pending on the new date (excluding this same request).
    if new_date != req["date"]:
        emp_id = (req.get("employee") or {}).get("id")
        if emp_id:
            emp_booking_clash = await db.workstation_bookings.find_one(
                {"employee.id": emp_id, "date": new_date, "cancelled": False},
                {"_id": 0, "employee": 1, "date": 1, "seat_label": 1},
            )
            if emp_booking_clash:
                raise HTTPException(409, {
                    "code": "EMPLOYEE_ALREADY_BOOKED",
                    "message": f"{(emp_booking_clash.get('employee') or {}).get('name')} already has a booking on {emp_booking_clash['date']}",
                    "conflict": emp_booking_clash,
                })
            emp_pending_clash = await db.workstation_requests.find_one(
                {"employee.id": emp_id, "date": new_date,
                 "id": {"$ne": request_id},
                 "status": {"$in": ACTIVE_PENDING_STATUSES}},
                {"_id": 0, "employee": 1, "date": 1, "seat_label": 1},
            )
            if emp_pending_clash:
                raise HTTPException(409, {
                    "code": "EMPLOYEE_PENDING",
                    "message": f"{(emp_pending_clash.get('employee') or {}).get('name')} already has a pending request on {emp_pending_clash['date']}",
                    "conflict": emp_pending_clash,
                })

    now = now_iso()
    actor = _actor(user)
    changes: Dict[str, Any] = {"updated_at": now}
    if new_date != req["date"]:
        changes["date"] = new_date
    if new_seat_id != req["seat_id"]:
        changes["seat_id"] = new_seat_id
        changes["seat_label"] = new_seat_label
    await db.workstation_requests.update_one({"id": request_id}, {"$set": changes})
    await log_audit(
        actor=actor, action="workstation_request.update",
        resource="workstation_request", resource_id=request_id,
        detail=f"Edited workstation request #{req.get('seq_no')}",
        metadata={"before": {"date": req["date"], "seat_id": req["seat_id"],
                             "seat_label": req.get("seat_label")},
                  "after": {"date": new_date, "seat_id": new_seat_id,
                            "seat_label": new_seat_label}},
    )
    fresh = await db.workstation_requests.find_one({"id": request_id}, {"_id": 0})
    return {"ok": True, "request": fresh}


# --------------------------------------------------------------------------- #
# Bulk approve / decline                                                      #
# --------------------------------------------------------------------------- #

class BulkRequestIds(BaseModel):
    request_ids: List[str] = Field(..., min_length=1)


async def _approve_one(request_id: str, actor: dict) -> dict:
    """Approve a single request — same semantics as the single endpoint.
    Returns {ok: bool, request_id, seat_label?, reason?}."""
    req = await db.workstation_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        return {"ok": False, "request_id": request_id, "reason": "Request not found"}
    if req.get("status") != STATUS_PENDING:
        return {"ok": False, "request_id": request_id, "seat_label": req.get("seat_label"),
                "reason": f"Already {req.get('status')}"}
    seat_clash = await db.workstation_bookings.find_one(
        {"plan_id": req["plan_id"], "seat_id": req["seat_id"], "date": req["date"], "cancelled": False},
        {"_id": 0, "seat_label": 1, "date": 1, "employee": 1},
    )
    if seat_clash:
        return {"ok": False, "request_id": request_id, "seat_label": req.get("seat_label"),
                "reason": f"Workstation {seat_clash.get('seat_label')} was booked by someone else"}
    from routers.workstation_bookings import _next_seq as _booking_seq
    now = now_iso()
    booking = {
        "id": str(uuid.uuid4()),
        "seq_no": await _booking_seq(),
        "plan_id": req["plan_id"],
        "plan_name": req.get("plan_name"),
        "seat_id": req["seat_id"],
        "seat_label": req.get("seat_label"),
        "date": req["date"],
        "employee": req.get("employee"),
        "team_id": req.get("team_id"),
        "team_name": req.get("team_name"),
        "team_color": req.get("team_color"),
        "recurring": None,
        "series_id": None,
        "cancelled": False,
        "created_at": now,
        "updated_at": now,
        "created_by": actor,
        "from_request_id": req["id"],
    }
    await db.workstation_bookings.insert_one(booking)
    await db.workstation_requests.update_one(
        {"id": request_id},
        {"$set": {
            "status": STATUS_APPROVED,
            "decided_by": actor,
            "decided_on": now,
            "approved_booking_id": booking["id"],
            "updated_at": now,
        }},
    )
    return {"ok": True, "request_id": request_id, "seat_label": req.get("seat_label")}


async def _decline_one(request_id: str, actor: dict) -> dict:
    req = await db.workstation_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        return {"ok": False, "request_id": request_id, "reason": "Request not found"}
    if req.get("status") != STATUS_PENDING:
        return {"ok": False, "request_id": request_id, "seat_label": req.get("seat_label"),
                "reason": f"Already {req.get('status')}"}
    now = now_iso()
    await db.workstation_requests.update_one(
        {"id": request_id},
        {"$set": {"status": STATUS_DECLINED, "decided_by": actor, "decided_on": now, "updated_at": now}},
    )
    return {"ok": True, "request_id": request_id, "seat_label": req.get("seat_label")}


@api_router.post("/workstation-requests/bulk-approve")
async def bulk_approve_workstation_requests(
    payload: BulkRequestIds,
    user=Depends(require_role("Super Admin")),
):
    """Approve multiple requests. Successful ones are processed; failures are
    listed in the response. Never rolls back already-approved items."""
    actor = _actor(user)
    results = []
    for rid in payload.request_ids:
        results.append(await _approve_one(rid, actor))
    approved = [r for r in results if r["ok"]]
    failed = [r for r in results if not r["ok"]]
    await log_audit(
        actor=actor, action="workstation_request.bulk_approve",
        resource="workstation_request",
        detail=f"Bulk approve: {len(approved)} approved, {len(failed)} failed",
        metadata={"approved": len(approved), "failed": len(failed),
                  "approved_ids": [r["request_id"] for r in approved],
                  "failed_ids": [r["request_id"] for r in failed]},
        severity="info" if not failed else "warning",
    )
    return {
        "approved": len(approved),
        "failed": len(failed),
        "results": results,
        "summary": f"{len(approved)} approved" + (f", {len(failed)} failed" if failed else ""),
    }


@api_router.post("/workstation-requests/bulk-decline")
async def bulk_decline_workstation_requests(
    payload: BulkRequestIds,
    user=Depends(require_role("Super Admin")),
):
    actor = _actor(user)
    results = []
    for rid in payload.request_ids:
        results.append(await _decline_one(rid, actor))
    declined = [r for r in results if r["ok"]]
    failed = [r for r in results if not r["ok"]]
    await log_audit(
        actor=actor, action="workstation_request.bulk_decline",
        resource="workstation_request",
        detail=f"Bulk decline: {len(declined)} declined, {len(failed)} failed",
        metadata={"declined": len(declined), "failed": len(failed),
                  "declined_ids": [r["request_id"] for r in declined],
                  "failed_ids": [r["request_id"] for r in failed]},
        severity="info" if not failed else "warning",
    )
    return {
        "declined": len(declined),
        "failed": len(failed),
        "results": results,
        "summary": f"{len(declined)} declined" + (f", {len(failed)} failed" if failed else ""),
    }
