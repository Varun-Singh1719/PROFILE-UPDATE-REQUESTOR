"""Workstation Bookings — full-day seat booking against Live Floor Layouts.

Scope
=====
This module is strictly for workstations (seats) drawn on the Floor Layout.
Meeting rooms live in `room_bookings.py` and are intentionally not mixed in here.

Data model
==========
  workstation_bookings:
    { id, seq_no,
      plan_id, plan_name,
      seat_id, seat_label,                 # from floor plan live version
      date (YYYY-MM-DD, IST local date),    # full-day booking, no time component
      employee { id, name, email, emp_id },
      team_id?, team_name?, team_color?,    # filled when booked as part of a team allocation
      recurring? { end_date, days[] },      # weekly recurrence, days = ['Su','M','T','W','Th','F','S']
      series_id?,                           # uuid grouping recurring instances
      cancelled: bool,
      created_at, updated_at,
      created_by { id, name, email } }

Endpoints
=========
GET    /api/workstation-bookings/floor-plans               — live plans with workstations
GET    /api/workstation-bookings/availability              — seats + occupancy for a (plan, date)
GET    /api/workstation-bookings                           — list bookings (filterable)
GET    /api/workstation-bookings/{id}                      — single booking detail
POST   /api/workstation-bookings                           — create (single + team-allocation + recurring)
PATCH  /api/workstation-bookings/{id}                      — update
DELETE /api/workstation-bookings/{id}                      — cancel
POST   /api/workstation-bookings/release-inactive          — admin helper to release seats of inactive employees

Access control
==============
Only **Super Admin** can create / update / delete. Listing / availability are
open to any authenticated user (so users can see the live floor map). This
matches the v3 collapsed role model where Admin = no workstation rights.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, date as date_cls
from typing import List, Optional, Dict, Any

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core import api_router, db, get_current_user, require_role, now_iso, log_audit, client as _mongo_client
from routers.permissions_v3 import require_any_v3_page_view


# --------------------------------------------------------------------------- #
# Models                                                                      #
# --------------------------------------------------------------------------- #

# Weekday codes used by the recurring config. We use 'Su' (not 'S') for Sunday
# and 'S' for Saturday, matching the spec's UI labels: Su M T W Th F S.
WEEKDAY_CODES = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S']

# Map weekday code → Python date.weekday() value (Mon=0..Sun=6)
WEEKDAY_TO_INT = {'M': 0, 'T': 1, 'W': 2, 'Th': 3, 'F': 4, 'S': 5, 'Su': 6}


class Recurring(BaseModel):
    end_date: str = Field(..., description="YYYY-MM-DD inclusive")
    days: List[str] = Field(default_factory=list, description="Subset of ['Su','M','T','W','Th','F','S']")


class WorkstationBookingCreate(BaseModel):
    plan_id: str
    date: str = Field(..., description="YYYY-MM-DD — full-day, IST local")
    seat_ids: List[str] = Field(..., min_length=1)
    # When exactly 1 seat is selected: employee_id is required.
    employee_id: Optional[str] = None
    # When N (>1) seats are selected: team_id + team_employee_ids (length N) are required.
    team_id: Optional[str] = None
    team_employee_ids: Optional[List[str]] = None
    recurring: Optional[Recurring] = None
    # Pending-Approval conflict flow: when the client hits a
    # PENDING_REQUESTS_WILL_BE_DECLINED 409 and the user confirms in the
    # dialog, they re-submit with this flag set. The backend then wraps
    # (decline pending) + (insert bookings) in a single transaction.
    confirm_auto_decline_pending: bool = False


class WorkstationBookingUpdate(BaseModel):
    date: Optional[str] = None
    seat_id: Optional[str] = None
    employee_id: Optional[str] = None


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #

SEQ_KEY = "workstation_booking_seq"
SEQ_START = 20000  # first booking → 20001 (kept distinct from MR bookings' 10000s)


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


async def _list_live_plans_with_seats() -> List[Dict[str, Any]]:
    plans = await db.floor_plans.find(
        {"live_version_id": {"$ne": None}, "status_override": {"$ne": "inactive"}},
        {"_id": 0},
    ).sort("created_at", 1).to_list(500)
    out = []
    for p in plans:
        v = await db.floor_plan_versions.find_one({"id": p["live_version_id"]}, {"_id": 0})
        if not v:
            continue
        seats = v.get("seats") or []
        if not seats:
            # Skip live plans that have no calibrated workstations
            continue
        out.append({
            "id": p["id"],
            "name": p.get("name") or v.get("name"),
            "pdfUrl": v.get("pdfUrl") or p.get("pdfUrl"),
            "seat_count": len(seats),
            "last_published_at": v.get("created_at"),
            "version_number": v.get("version_number"),
        })
    return out


async def _employee_lookup(employee_ids: List[str]) -> Dict[str, dict]:
    """Bulk-fetch active employees keyed by id. Inactive employees are returned too, but flagged."""
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


def _expand_recurring(start: date_cls, recurring: Recurring) -> List[date_cls]:
    """Return a list of dates (inclusive of start) matching the recurring spec."""
    end = _parse_date(recurring.end_date, "recurring.end_date")
    if end < start:
        raise HTTPException(400, "recurring.end_date must be on or after the booking date")
    days = recurring.days or [WEEKDAY_CODES[(start.weekday() + 1) % 7 if start.weekday() == 6 else start.weekday()]]
    # Normalise: dedupe + drop unknown codes
    target_weekdays = {WEEKDAY_TO_INT[d] for d in days if d in WEEKDAY_TO_INT}
    if not target_weekdays:
        raise HTTPException(400, "recurring.days must include at least one day")
    out: List[date_cls] = []
    cur = start
    while cur <= end:
        if cur.weekday() in target_weekdays:
            out.append(cur)
        cur = cur + timedelta(days=1)
    if not out:
        raise HTTPException(400, "Recurring rule produced no occurrences in the date range")
    return out


async def _seat_in_live_plan(plan_id: str, seat_id: str) -> Optional[dict]:
    ctx = await _get_live_plan(plan_id)
    for s in (ctx["version"].get("seats") or []):
        if s.get("id") == seat_id:
            return s
    return None


async def _booking_view(doc: dict) -> dict:
    """Strip _id and pass through. Already enriched at write time."""
    doc.pop("_id", None)
    return doc


# --------------------------------------------------------------------------- #
# Endpoints — read                                                            #
# --------------------------------------------------------------------------- #

@api_router.get("/workstation-bookings/floor-plans")
async def list_workstation_floor_plans(user=Depends(get_current_user)):
    """Return live floor plans that have at least one calibrated workstation."""
    return await _list_live_plans_with_seats()


@api_router.get("/workstation-bookings/availability")
async def workstation_availability(
    plan_id: str = Query(...),
    date: str = Query(..., description="YYYY-MM-DD"),
    user=Depends(get_current_user),
):
    """Return the floor plan's workstations together with occupancy info for `date`.

    Response shape:
      {
        plan: {id, name, pdfUrl, version_number},
        seats: [{id, label, x, y, size, rotation}],
        bookings: [<workstation_booking with team enrichment>],
        booked_seat_ids: [...],
        booked_employee_ids: [...]
      }
    """
    _parse_date(date)
    ctx = await _get_live_plan(plan_id)
    plan = ctx["plan"]
    version = ctx["version"]
    seats = version.get("seats") or []

    bookings = await db.workstation_bookings.find(
        {"plan_id": plan_id, "date": date, "cancelled": False},
        {"_id": 0},
    ).to_list(2000)

    # Filter out bookings whose employee has been deactivated — auto-release behaviour.
    if bookings:
        emp_ids = [(b.get("employee") or {}).get("id") for b in bookings]
        emp_map = await _employee_lookup([e for e in emp_ids if e])
        active_bookings = []
        for b in bookings:
            eid = (b.get("employee") or {}).get("id")
            emp = emp_map.get(eid) if eid else None
            if not emp:
                continue
            if (emp.get("status") or "").lower() == "inactive":
                continue
            active_bookings.append(b)
        bookings = active_bookings

    booked_seat_ids = sorted({b["seat_id"] for b in bookings})
    booked_employee_ids = sorted({(b.get("employee") or {}).get("id") for b in bookings if (b.get("employee") or {}).get("id")})

    # Cross-module: seats locked by pending workstation requests
    from routers.workstation_requests import pending_seat_ids_for, pending_employee_ids_for  # type: ignore
    pending_seat_ids = await pending_seat_ids_for(plan_id, date)
    pending_employee_ids = await pending_employee_ids_for(date, plan_id)

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
        "pending_seat_ids": pending_seat_ids,
        "pending_employee_ids": pending_employee_ids,
    }


@api_router.get("/workstation-bookings")
async def list_workstation_bookings(
    user=Depends(get_current_user),
    plan_id: Optional[str] = Query(None),
    seat_id: Optional[str] = Query(None),
    employee_id: Optional[str] = Query(None),
    team_id: Optional[str] = Query(None),
    date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    include_cancelled: bool = Query(False),
):
    q: Dict[str, Any] = {}
    if plan_id:
        q["plan_id"] = plan_id
    if seat_id:
        q["seat_id"] = seat_id
    if employee_id:
        q["employee.id"] = employee_id
    if team_id:
        q["team_id"] = team_id
    if not include_cancelled:
        q["cancelled"] = False
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
    docs = await db.workstation_bookings.find(q, {"_id": 0}).sort([("date", 1), ("seat_label", 1)]).to_list(2000)
    return docs


@api_router.get("/workstation-bookings/{booking_id}")
async def get_workstation_booking(booking_id: str, user=Depends(get_current_user)):
    doc = None
    if booking_id.isdigit():
        doc = await db.workstation_bookings.find_one({"seq_no": int(booking_id)}, {"_id": 0})
    if not doc:
        doc = await db.workstation_bookings.find_one({"id": booking_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Workstation booking not found")
    return doc


# --------------------------------------------------------------------------- #
# Endpoints — write                                                           #
# --------------------------------------------------------------------------- #

@api_router.post("/workstation-bookings")
async def create_workstation_booking(
    payload: WorkstationBookingCreate,
    user=Depends(require_role("Super Admin")),
):
    """Create one or many workstation bookings.

    Validation rules
    ----------------
    1) Seats must belong to the plan's Live version.
    2) Exactly 1 seat → `employee_id` required, `team_id`/`team_employee_ids` forbidden.
       N (>1) seats → `team_id` + `team_employee_ids` (length == N) required.
    3) No seat can be double-booked for the same date (across the dates the recurrence
       expands to). No employee can be double-booked for the same date.
    4) Recurring expands `start_date` → list of dates via weekday filter.
    """
    ctx = await _get_live_plan(payload.plan_id)
    plan = ctx["plan"]
    version = ctx["version"]
    seat_index = {s["id"]: s for s in (version.get("seats") or [])}

    # ---- Resolve seats
    seat_ids = list(dict.fromkeys(payload.seat_ids))  # dedupe, preserve order
    if not seat_ids:
        raise HTTPException(400, "At least one workstation must be selected")
    missing = [sid for sid in seat_ids if sid not in seat_index]
    if missing:
        raise HTTPException(400, f"Workstation(s) not found in this floor plan: {', '.join(missing)}")

    # ---- Resolve employee(s)
    single = len(seat_ids) == 1
    if single:
        if not payload.employee_id:
            raise HTTPException(400, "employee_id is required when booking a single workstation")
        if payload.team_id or payload.team_employee_ids:
            raise HTTPException(400, "team_id / team_employee_ids must be omitted for single-seat bookings")
        seat_to_emp = {seat_ids[0]: payload.employee_id}
        team = None
    else:
        if not payload.team_id:
            raise HTTPException(400, "team_id is required when booking multiple workstations")
        team = await _team_lookup(payload.team_id)
        if not team:
            raise HTTPException(404, "Team not found")
        emp_ids = payload.team_employee_ids or []
        if len(emp_ids) != len(seat_ids):
            raise HTTPException(400, f"team_employee_ids count ({len(emp_ids)}) must equal seat count ({len(seat_ids)})")
        # All employees must be members of the team (or its managers)
        allowed = set((team.get("member_ids") or []) + (team.get("manager_ids") or []))
        bad = [e for e in emp_ids if e not in allowed]
        if bad:
            raise HTTPException(400, "All assigned employees must be members or managers of the selected team")
        if len(set(emp_ids)) != len(emp_ids):
            raise HTTPException(400, "The same employee cannot be assigned to multiple workstations")
        seat_to_emp = {seat_ids[i]: emp_ids[i] for i in range(len(seat_ids))}

    # ---- Resolve employee docs
    all_emp_ids = list(set(seat_to_emp.values()))
    emp_map = await _employee_lookup(all_emp_ids)
    for eid in all_emp_ids:
        emp = emp_map.get(eid)
        if not emp:
            raise HTTPException(404, f"Employee not found: {eid}")
        if (emp.get("status") or "").lower() != "active":
            raise HTTPException(400, f"Employee is not active: {emp.get('name') or eid}")

    # ---- Compute target dates (recurring expansion)
    start_date = _parse_date(payload.date)
    if payload.recurring:
        dates = _expand_recurring(start_date, payload.recurring)
        series_id = str(uuid.uuid4())
    else:
        dates = [start_date]
        series_id = None

    # ---- Pre-check: no double-booking
    iso_dates = [d.isoformat() for d in dates]
    # Existing seat bookings on these dates
    seat_conflict = await db.workstation_bookings.find_one(
        {"plan_id": payload.plan_id, "seat_id": {"$in": seat_ids}, "date": {"$in": iso_dates}, "cancelled": False},
        {"_id": 0, "seat_id": 1, "seat_label": 1, "date": 1, "employee": 1},
    )
    if seat_conflict:
        # Filter against an inactive employee — that booking is effectively released
        e = seat_conflict.get("employee") or {}
        emp_doc = (await _employee_lookup([e.get("id")])) if e.get("id") else {}
        if not e.get("id") or (emp_doc.get(e["id"]) or {}).get("status") != "Inactive":
            raise HTTPException(409, {
                "code": "WORKSTATION_OCCUPIED",
                "message": f"Workstation {seat_conflict['seat_label']} is already booked on {seat_conflict['date']}",
                "conflict": seat_conflict,
            })
    emp_conflict = await db.workstation_bookings.find_one(
        {"employee.id": {"$in": all_emp_ids}, "date": {"$in": iso_dates}, "cancelled": False},
        {"_id": 0, "employee": 1, "date": 1, "seat_label": 1},
    )
    if emp_conflict:
        eid = (emp_conflict.get("employee") or {}).get("id")
        emp_doc = (await _employee_lookup([eid])) if eid else {}
        if not eid or (emp_doc.get(eid) or {}).get("status") != "Inactive":
            raise HTTPException(409, {
                "code": "EMPLOYEE_ALREADY_BOOKED",
                "message": f"{(emp_conflict.get('employee') or {}).get('name')} already has a booking on {emp_conflict['date']}",
                "conflict": emp_conflict,
            })

    # ---- Cross-module: pending workstation requests that clash with this
    # allotment. Behaviour depends on `confirm_auto_decline_pending`:
    #   • False (default) — return 409 PENDING_REQUESTS_WILL_BE_DECLINED
    #     with the full list of conflicting pending requests so the client
    #     can show the "N Pending Approval request(s) will be automatically
    #     declined and M workstation booking(s) will be created" dialog.
    #   • True — proceed. The decline of every pending row + the insert of
    #     the new bookings is wrapped in a Mongo transaction so the two
    #     halves succeed-or-fail together (concurrent-approval CAS built
    #     into the update filter).
    from routers.workstation_requests import ACTIVE_PENDING_STATUSES, auto_decline_conflicting_requests  # type: ignore
    pending_query = {
        "date": {"$in": iso_dates},
        "status": {"$in": ACTIVE_PENDING_STATUSES},
        "$or": [
            {"plan_id": payload.plan_id, "seat_id": {"$in": seat_ids}},
            {"employee.id": {"$in": all_emp_ids}},
        ],
    }
    pending_matches = await db.workstation_requests.find(
        pending_query,
        {"_id": 0, "id": 1, "date": 1, "seat_id": 1, "seat_label": 1,
         "status": 1, "employee": 1, "requested_by": 1, "requested_on": 1,
         "plan_name": 1, "team_name": 1},
    ).to_list(2000)

    if pending_matches and not payload.confirm_auto_decline_pending:
        # Build (employee_id -> proposed seat label) mapping so the UI can
        # show "Requested Workstation" vs "Proposed Workstation" columns.
        proposed_by_emp = {}
        for sid in seat_ids:
            eid = seat_to_emp.get(sid)
            if eid:
                proposed_by_emp[eid] = {
                    "seat_id": sid,
                    "seat_label": (seat_index[sid].get("label") or sid),
                }
        enriched = []
        for m in pending_matches:
            eid = (m.get("employee") or {}).get("id")
            enriched.append({
                **m,
                "proposed_seat": proposed_by_emp.get(eid),
            })
        proposed_count = len(seat_ids) * len(iso_dates)
        raise HTTPException(409, {
            "code": "PENDING_REQUESTS_WILL_BE_DECLINED",
            "message": (
                f"{len(pending_matches)} Pending Approval request(s) will be automatically "
                f"declined and {proposed_count} workstation booking(s) will be created."
            ),
            "pending_count": len(pending_matches),
            "proposed_count": proposed_count,
            "pending_requests": enriched,
        })

    # ---- Insert all bookings (date × seat combinations)
    now = now_iso()
    actor = _actor(user)
    inserted: List[dict] = []
    for d_iso in iso_dates:
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
                "date": d_iso,
                "employee": {
                    "id": emp["id"], "name": emp.get("name"), "email": emp.get("email"), "emp_id": emp.get("emp_id"),
                },
                "team_id": (team or {}).get("id") if team else None,
                "team_name": (team or {}).get("name") if team else None,
                "team_color": (team or {}).get("color") if team else None,
                "recurring": payload.recurring.model_dump() if payload.recurring else None,
                "series_id": series_id,
                "cancelled": False,
                "created_at": now,
                "updated_at": now,
                "created_by": actor,
            }
            inserted.append(doc)
    if inserted:
        if payload.confirm_auto_decline_pending and pending_matches:
            # ---- Transactional path: decline pending + insert bookings as
            # a single atomic unit. Concurrent-approval detection uses a CAS
            # on `status == Pending Approval` in the update filter.
            pending_ids = [m["id"] for m in pending_matches]
            reason = "Automatically declined due to workstation allocation through Workstation Booking"
            now_dec = now_iso()
            async with await _mongo_client.start_session() as session:
                async with session.start_transaction():
                    res = await db.workstation_requests.update_many(
                        {"id": {"$in": pending_ids},
                         "status": {"$in": list(ACTIVE_PENDING_STATUSES)}},
                        {"$set": {
                            "status": "Declined",
                            "decided_by": {**actor, "auto_declined": True},
                            "decided_on": now_dec,
                            "decision_note": reason,
                            "updated_at": now_dec,
                        }},
                        session=session,
                    )
                    if res.modified_count != len(pending_ids):
                        # A concurrent approver acted on at least one row —
                        # abort so we never end up with partially-declined
                        # state or duplicate bookings.
                        raise HTTPException(409, {
                            "code": "PENDING_STATE_CHANGED",
                            "message": "One or more requests have already been processed. Please refresh the page and try again.",
                        })
                    await db.workstation_bookings.insert_many(inserted, session=session)
            for d in inserted:
                d.pop("_id", None)
        else:
            await db.workstation_bookings.insert_many(inserted)
            for d in inserted:
                d.pop("_id", None)

    # ---- Auto-decline pending workstation_requests
    # After transactional path we already declined them (skip). Otherwise
    # keep legacy behaviour (best-effort, non-blocking).
    auto_declined: List[dict] = []
    if payload.confirm_auto_decline_pending and pending_matches:
        # Return the declined rows for the response payload
        try:
            declined_ids = [m["id"] for m in pending_matches]
            auto_declined = await db.workstation_requests.find(
                {"id": {"$in": declined_ids}}, {"_id": 0}
            ).to_list(2000)
            # In-app notifications to each declined-request requester
            try:
                from inapp_notifications import notify_user_inapp
                for m in pending_matches:
                    emp = (m.get("employee") or {})
                    eid = emp.get("id")
                    if not eid:
                        continue
                    try:
                        await notify_user_inapp(
                            db,
                            user_id=eid,
                            kind="workstation_request_declined",
                            variables={
                                "seat_label": m.get("seat_label"),
                                "date": m.get("date"),
                                "plan_name": m.get("plan_name"),
                                "decided_by": actor.get("name"),
                                "name": emp.get("name"),
                                "reason": "Automatically declined due to workstation allocation through Workstation Booking",
                            },
                            related_id=m["id"],
                            related_type="workstation_request",
                            # Deep-link into "My Bookings" tab with the declined request auto-opened.
                            action_url=f"/workspace-manager/request-workstation?requestId={m['id']}",
                        )
                    except Exception:  # noqa: BLE001
                        pass
            except Exception:  # noqa: BLE001
                pass
            try:
                await log_audit(
                    actor=actor, action="workstation_request.auto_decline",
                    resource="workstation_request",
                    detail=f"Auto-declined {len(declined_ids)} pending workstation request(s) via Workstation Booking confirm-flow",
                    metadata={"request_ids": declined_ids,
                              "reason": "Automatically declined due to workstation allocation through Workstation Booking",
                              "dates": iso_dates, "seat_ids": seat_ids,
                              "employee_ids": all_emp_ids},
                )
            except Exception:  # noqa: BLE001
                pass
        except Exception:  # noqa: BLE001
            auto_declined = []
    else:
        try:
            auto_declined = await auto_decline_conflicting_requests(
                plan_id=payload.plan_id,
                seat_ids=seat_ids,
                employee_ids=all_emp_ids,
                dates=iso_dates,
                actor=actor,
            )
        except Exception:  # noqa: BLE001 — never fail the booking on this
            auto_declined = []

    await log_audit(
        actor=actor, action="workstation_booking.create",
        resource="workstation_booking",
        detail=f"Created {len(inserted)} workstation booking(s) on plan '{plan.get('name')}'",
        metadata={
            "plan_id": payload.plan_id, "seat_ids": seat_ids,
            "dates": iso_dates, "team_id": (team or {}).get("id") if team else None,
            "series_id": series_id,
        },
    )

    # Notify each assigned employee in-app that a workstation was allocated.
    try:
        from inapp_notifications import notify_user_inapp
        # Dedupe (employee_id, date, seat) so an employee only gets one alert
        # per booking row.
        for bk in inserted:
            emp_id = ((bk.get("employee") or {}).get("id"))
            if not emp_id:
                continue
            await notify_user_inapp(
                db,
                user_id=emp_id,
                kind="workstation_assigned",
                variables={
                    "seat_label": bk.get("seat_label"),
                    "date": bk.get("date"),
                    "plan_name": bk.get("plan_name"),
                    "assigned_by": actor.get("name"),
                    "name": (bk.get("employee") or {}).get("name"),
                },
                related_id=bk["id"],
                related_type="workstation_booking",
                # Deep-link directly into the newly-created booking's detail drawer.
                action_url=f"/workspace-manager/bookings?bookingId={bk['id']}",
            )
    except Exception:  # noqa: BLE001
        pass

    return {
        "ok": True,
        "created": len(inserted),
        "series_id": series_id,
        "bookings": inserted,
        "auto_declined_requests": auto_declined,
        "auto_declined_count": len(auto_declined),
    }


@api_router.patch("/workstation-bookings/{booking_id}")
async def update_workstation_booking(
    booking_id: str,
    payload: WorkstationBookingUpdate,
    user=Depends(require_role("Super Admin")),
):
    """Reschedule / reassign a single booking. Validates against duplicates."""
    doc = await db.workstation_bookings.find_one({"id": booking_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Workstation booking not found")
    if doc.get("cancelled"):
        raise HTTPException(400, "Cancelled bookings cannot be edited")

    update: Dict[str, Any] = {"updated_at": now_iso()}

    target_date = payload.date or doc["date"]
    _parse_date(target_date)
    target_seat_id = payload.seat_id or doc["seat_id"]
    target_emp_id = payload.employee_id or (doc.get("employee") or {}).get("id")

    # Validate seat exists in plan
    if payload.seat_id and payload.seat_id != doc["seat_id"]:
        seat = await _seat_in_live_plan(doc["plan_id"], payload.seat_id)
        if not seat:
            raise HTTPException(400, "Workstation not found in this floor plan")
        update["seat_id"] = seat["id"]
        update["seat_label"] = seat.get("label") or seat["id"]

    # Validate employee exists + active
    if payload.employee_id and payload.employee_id != (doc.get("employee") or {}).get("id"):
        emp_map = await _employee_lookup([payload.employee_id])
        emp = emp_map.get(payload.employee_id)
        if not emp:
            raise HTTPException(404, "Employee not found")
        if (emp.get("status") or "").lower() != "active":
            raise HTTPException(400, "Employee is not active")
        update["employee"] = {"id": emp["id"], "name": emp.get("name"), "email": emp.get("email"), "emp_id": emp.get("emp_id")}

    if payload.date and payload.date != doc["date"]:
        update["date"] = target_date

    # Conflict checks (excluding this booking)
    seat_clash = await db.workstation_bookings.find_one(
        {"plan_id": doc["plan_id"], "seat_id": target_seat_id, "date": target_date, "cancelled": False, "id": {"$ne": booking_id}},
        {"_id": 0, "seat_label": 1, "date": 1, "employee": 1},
    )
    if seat_clash:
        raise HTTPException(409, {"code": "WORKSTATION_OCCUPIED", "conflict": seat_clash})
    emp_clash = await db.workstation_bookings.find_one(
        {"employee.id": target_emp_id, "date": target_date, "cancelled": False, "id": {"$ne": booking_id}},
        {"_id": 0, "employee": 1, "date": 1, "seat_label": 1},
    )
    if emp_clash:
        raise HTTPException(409, {"code": "EMPLOYEE_ALREADY_BOOKED", "conflict": emp_clash})

    await db.workstation_bookings.update_one({"id": booking_id}, {"$set": update})
    fresh = await db.workstation_bookings.find_one({"id": booking_id}, {"_id": 0})
    await log_audit(
        actor=_actor(user), action="workstation_booking.update",
        resource="workstation_booking", resource_id=booking_id,
        detail=f"Updated workstation booking #{fresh.get('seq_no')}",
        metadata={"before": {k: doc.get(k) for k in ("date", "seat_id", "employee")},
                  "after": {k: fresh.get(k) for k in ("date", "seat_id", "employee")}},
    )
    return {"ok": True, "booking": fresh}


@api_router.delete("/workstation-bookings/{booking_id}")
async def cancel_workstation_booking(
    booking_id: str,
    series: bool = Query(False, description="Cancel the entire recurring series"),
    user=Depends(require_role("Super Admin")),
):
    doc = await db.workstation_bookings.find_one({"id": booking_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Workstation booking not found")
    if series and doc.get("series_id"):
        # Cancel all future (>= this booking's date) in the same series
        await db.workstation_bookings.update_many(
            {"series_id": doc["series_id"], "cancelled": False, "date": {"$gte": doc["date"]}},
            {"$set": {"cancelled": True, "updated_at": now_iso(), "cancelled_by": _actor(user)}},
        )
    else:
        await db.workstation_bookings.update_one(
            {"id": booking_id},
            {"$set": {"cancelled": True, "updated_at": now_iso(), "cancelled_by": _actor(user)}},
        )
    await log_audit(
        actor=_actor(user), action="workstation_booking.cancel",
        resource="workstation_booking", resource_id=booking_id,
        detail=f"Cancelled workstation booking #{doc.get('seq_no')}",
        metadata={"series": bool(series), "series_id": doc.get("series_id")},
    )
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Auto-release seats of inactive employees                                    #
# --------------------------------------------------------------------------- #

@api_router.post("/workstation-bookings/release-inactive")
async def release_inactive(user=Depends(require_role("Super Admin"))):
    """Cancel future workstation bookings owned by employees whose status is Inactive.
    Idempotent — safe to call repeatedly."""
    inactive_docs = await db.contacts.find({"status": "Inactive"}, {"_id": 0, "id": 1}).to_list(5000)
    ids = [d["id"] for d in inactive_docs]
    if not ids:
        return {"ok": True, "released": 0}
    today = date_cls.today().isoformat()
    res = await db.workstation_bookings.update_many(
        {"employee.id": {"$in": ids}, "cancelled": False, "date": {"$gte": today}},
        {"$set": {"cancelled": True, "updated_at": now_iso(), "cancelled_by": _actor(user),
                  "cancel_reason": "employee_deactivated"}},
    )
    return {"ok": True, "released": res.modified_count}


# --------------------------------------------------------------------------- #
# Helper used by contacts router when an employee becomes Inactive            #
# --------------------------------------------------------------------------- #

async def auto_release_for_employee(employee_id: str, actor: dict) -> int:
    """Cancel all future bookings of an employee. Returns count cancelled."""
    if not employee_id:
        return 0
    today = date_cls.today().isoformat()
    res = await db.workstation_bookings.update_many(
        {"employee.id": employee_id, "cancelled": False, "date": {"$gte": today}},
        {"$set": {"cancelled": True, "updated_at": now_iso(), "cancelled_by": actor,
                  "cancel_reason": "employee_deactivated"}},
    )
    return res.modified_count
