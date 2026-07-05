"""My Workspace — personal dashboard aggregation endpoints.

The Workspace Manager dashboard tab renders a per-user view (My Seat Today,
Upcoming Meetings, This Week timeline, Team on floor, Recent activity). To
keep the frontend snappy we expose two aggregation endpoints instead of
having the UI fan out to five different modules.

  GET /api/my-workspace/dashboard?date=YYYY-MM-DD
      Returns: my_seat, upcoming_meetings, team_on_floor, recent_activity

  GET /api/my-workspace/week?start=YYYY-MM-DD
      Returns 7 daily entries for the ISO week that contains `start` with
      per-day status: assigned | requested | none, plus optional seat_label
      for the day.

Additionally:

  GET /api/my-workspace/floor?date=YYYY-MM-DD
      Returns the full floor plan + seats coloured for the popup:
      user_seat, team_seats, occupied_seats, available_seats.
"""

from __future__ import annotations

import datetime as _dt
from typing import Any, Dict, List, Optional

from fastapi import Depends, Query, HTTPException

from core import api_router, db, get_current_user


# --------------------------------------------------------------------------- #
# Helpers                                                                      #
# --------------------------------------------------------------------------- #

def _today_iso() -> str:
    return _dt.date.today().isoformat()


def _iso_week_start(date_iso: str) -> _dt.date:
    """Return the Monday of the ISO week containing date_iso."""
    d = _dt.date.fromisoformat(date_iso)
    return d - _dt.timedelta(days=d.weekday())


async def _user_team_ids(user: dict) -> List[str]:
    uid = user.get("id")
    uemail = (user.get("email") or "").lower()
    if not uid and not uemail:
        return []
    cursor = db.teams.find(
        {"members": {"$elemMatch": {"$or": [{"id": uid}, {"email": uemail}]}}},
        {"_id": 0, "id": 1},
    )
    docs = await cursor.to_list(200)
    return [t["id"] for t in docs if t.get("id")]


async def _load_team_meta(team_ids: List[str]) -> Dict[str, dict]:
    if not team_ids:
        return {}
    ids = list({t for t in team_ids if t})
    if not ids:
        return {}
    docs = await db.teams.find(
        {"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1, "color": 1, "members": 1},
    ).to_list(500)
    return {d["id"]: d for d in docs}


# --------------------------------------------------------------------------- #
# GET /my-workspace/dashboard                                                  #
# --------------------------------------------------------------------------- #

@api_router.get("/my-workspace/dashboard")
async def my_workspace_dashboard(
    date: Optional[str] = Query(None, description="YYYY-MM-DD (default: today)"),
    user=Depends(get_current_user),
):
    the_date = date or _today_iso()
    try:
        _dt.date.fromisoformat(the_date)
    except Exception:
        raise HTTPException(400, "date must be YYYY-MM-DD")
    uid = user.get("id")

    # ---- My Seat Today (workstation booking for `the_date` where employee=me)
    my_booking = await db.workstation_bookings.find_one(
        {"employee.id": uid, "date": the_date, "cancelled": False}, {"_id": 0},
    )

    my_request = None
    if not my_booking:
        # Fall back to any pending request the user has for `the_date`
        my_request = await db.workstation_requests.find_one(
            {"employee.id": uid, "date": the_date, "status": "Pending Approval"},
            {"_id": 0},
        )

    # Pull the floor plan a bit — resolve plan name for display
    plan_id_for_map: Optional[str] = None
    plan_name: Optional[str] = None
    seat_coords: Optional[dict] = None

    ctx_source = my_booking or my_request
    if ctx_source and ctx_source.get("plan_id"):
        try:
            plan_id_for_map = ctx_source["plan_id"]
            plan_doc = await db.floor_plans.find_one({"id": plan_id_for_map}, {"_id": 0, "name": 1, "live_version_id": 1})
            if plan_doc and plan_doc.get("live_version_id"):
                version = await db.floor_plan_versions.find_one(
                    {"id": plan_doc["live_version_id"]}, {"_id": 0},
                )
                if version:
                    plan_name = plan_doc.get("name") or version.get("name")
                    seats = version.get("seats") or []
                    seat_id = ctx_source.get("seat_id")
                    seat_coords = next((s for s in seats if s.get("id") == seat_id), None)
        except Exception:
            pass

    my_seat_payload: Optional[dict] = None
    if my_booking or my_request:
        src = my_booking or my_request
        my_seat_payload = {
            "status": "assigned" if my_booking else "requested",
            "date": the_date,
            "plan_id": src.get("plan_id"),
            "plan_name": plan_name,
            "seat_id": src.get("seat_id"),
            "seat_label": src.get("seat_label"),
            "team_id": src.get("team_id"),
            "team_name": src.get("team_name"),
            "team_color": src.get("team_color"),
            "seat": seat_coords,
            "booking_id": (my_booking or {}).get("id"),
            "request_id": (my_request or {}).get("id"),
        }

    # ---- Upcoming Meetings (room bookings from `the_date` onward — user is
    #      organizer OR attendee OR in an attendee team; limit 6)
    team_ids = await _user_team_ids(user)
    or_clauses: List[dict] = [
        {"organizer.id": uid},
        {"attendees": {"$elemMatch": {"type": "user", "id": uid}}},
    ]
    if team_ids:
        or_clauses.append({"attendees": {"$elemMatch": {"type": "team", "id": {"$in": team_ids}}}})

    now_iso = _dt.datetime.now().isoformat()
    day_end_iso = _dt.datetime.combine(_dt.date.fromisoformat(the_date), _dt.time(23, 59, 59)).isoformat()
    meetings = await db.room_bookings.find(
        {"$or": or_clauses, "cancelled": False, "end_at": {"$gte": now_iso}},
        {"_id": 0},
    ).sort("start_at", 1).limit(6).to_list(6)

    # ---- Team on floor (colleagues who ALSO have a booking on `the_date` on
    #      the same plan, if we know it)
    team_on_floor: List[dict] = []
    if plan_id_for_map:
        colleague_docs = await db.workstation_bookings.find(
            {"plan_id": plan_id_for_map, "date": the_date, "cancelled": False, "employee.id": {"$ne": uid}},
            {"_id": 0, "employee": 1, "seat_label": 1, "team_id": 1, "team_name": 1, "team_color": 1},
        ).limit(24).to_list(24)
        for c in colleague_docs:
            emp = c.get("employee") or {}
            team_on_floor.append({
                "id": emp.get("id"),
                "name": emp.get("name"),
                "email": emp.get("email"),
                "seat_label": c.get("seat_label"),
                "team_id": c.get("team_id"),
                "team_name": c.get("team_name"),
                "team_color": c.get("team_color"),
            })

    # ---- Recent activity (last 5 audit entries for this user)
    recent = await db.audit_log.find(
        {"actor.id": uid},
        {"_id": 0, "action": 1, "detail": 1, "created_at": 1, "resource": 1, "resource_id": 1},
    ).sort("created_at", -1).limit(6).to_list(6)

    return {
        "date": the_date,
        "my_seat": my_seat_payload,
        "upcoming_meetings": meetings,
        "team_on_floor": team_on_floor,
        "recent_activity": recent,
    }


# --------------------------------------------------------------------------- #
# GET /my-workspace/week                                                       #
# --------------------------------------------------------------------------- #

@api_router.get("/my-workspace/week")
async def my_workspace_week(
    start: Optional[str] = Query(None, description="Any date within the desired ISO week (default: today)"),
    user=Depends(get_current_user),
):
    """Return 7 entries (Mon..Sun) of {date, status, seat_label}.

    status is one of:
        assigned  — user has a confirmed workstation booking
        requested — user has a pending workstation request
        none      — nothing on that day
    """
    ref = start or _today_iso()
    try:
        _dt.date.fromisoformat(ref)
    except Exception:
        raise HTTPException(400, "start must be YYYY-MM-DD")
    monday = _iso_week_start(ref)
    dates = [(monday + _dt.timedelta(days=i)).isoformat() for i in range(7)]
    uid = user.get("id")

    bookings = await db.workstation_bookings.find(
        {"employee.id": uid, "cancelled": False, "date": {"$in": dates}},
        {"_id": 0, "date": 1, "seat_label": 1, "plan_id": 1, "team_color": 1, "team_name": 1},
    ).to_list(20)
    booking_by_date = {b["date"]: b for b in bookings}

    requests = await db.workstation_requests.find(
        {"employee.id": uid, "status": "Pending Approval", "date": {"$in": dates}},
        {"_id": 0, "date": 1, "seat_label": 1, "plan_id": 1, "team_color": 1, "team_name": 1},
    ).to_list(20)
    request_by_date = {r["date"]: r for r in requests}

    days = []
    for d in dates:
        if d in booking_by_date:
            b = booking_by_date[d]
            days.append({"date": d, "status": "assigned", "seat_label": b.get("seat_label"),
                         "team_color": b.get("team_color"), "team_name": b.get("team_name")})
        elif d in request_by_date:
            r = request_by_date[d]
            days.append({"date": d, "status": "requested", "seat_label": r.get("seat_label"),
                         "team_color": r.get("team_color"), "team_name": r.get("team_name")})
        else:
            days.append({"date": d, "status": "none", "seat_label": None,
                         "team_color": None, "team_name": None})
    return {"week_start": monday.isoformat(), "days": days}


# --------------------------------------------------------------------------- #
# GET /my-workspace/floor                                                      #
# --------------------------------------------------------------------------- #

@api_router.get("/my-workspace/floor")
async def my_workspace_floor(
    date: Optional[str] = Query(None, description="YYYY-MM-DD (default: today)"),
    plan_id: Optional[str] = Query(None, description="If omitted, inferred from user's current seat/request"),
    user=Depends(get_current_user),
):
    """Return the floor plan + coloured seats for the popup view.

    Response:
      {
        plan: {id, name, pdfUrl, version_number},
        seats: [{id, label, x, y, size, rotation}],
        user_seat_id: str | null,
        team_seat_ids: [str],
        occupied_seat_ids: [str],
        available_seat_ids: [str],
        team_color: str | null,
        team_name:  str | null,
        seat_meta:  { seat_id: {employee_name, team_name, team_color, seat_label} }
      }
    """
    the_date = date or _today_iso()
    try:
        _dt.date.fromisoformat(the_date)
    except Exception:
        raise HTTPException(400, "date must be YYYY-MM-DD")
    uid = user.get("id")

    resolved_plan_id = plan_id
    my_booking = await db.workstation_bookings.find_one(
        {"employee.id": uid, "date": the_date, "cancelled": False}, {"_id": 0},
    )
    my_request = None
    if not my_booking:
        my_request = await db.workstation_requests.find_one(
            {"employee.id": uid, "date": the_date, "status": "Pending Approval"}, {"_id": 0},
        )
    if not resolved_plan_id and (my_booking or my_request):
        resolved_plan_id = (my_booking or my_request).get("plan_id")

    if not resolved_plan_id:
        # Fall back to the first live floor plan
        p = await db.floor_plans.find_one(
            {"live_version_id": {"$ne": None}}, {"_id": 0, "id": 1},
            sort=[("last_published_at", -1)],
        )
        if not p:
            raise HTTPException(404, "No live floor plan available")
        resolved_plan_id = p["id"]

    from routers.floor_plans import _get_version  # type: ignore

    plan_doc = await db.floor_plans.find_one({"id": resolved_plan_id}, {"_id": 0, "name": 1, "live_version_id": 1})
    if not plan_doc or not plan_doc.get("live_version_id"):
        raise HTTPException(404, "Floor plan has no live version")
    version = await _get_version(plan_doc["live_version_id"])
    if not version:
        raise HTTPException(404, "Floor plan has no live version")
    plan_name = plan_doc.get("name") or version.get("name")
    seats = version.get("seats") or []

    # All non-cancelled bookings on that date, this plan
    all_bookings = await db.workstation_bookings.find(
        {"plan_id": resolved_plan_id, "date": the_date, "cancelled": False}, {"_id": 0},
    ).to_list(2000)

    my_team_id = None
    if my_booking:
        my_team_id = my_booking.get("team_id")
    elif my_request:
        my_team_id = my_request.get("team_id")

    my_seat_id: Optional[str] = None
    team_seat_ids: List[str] = []
    occupied_seat_ids: List[str] = []
    seat_meta: Dict[str, dict] = {}
    team_color = None
    team_name = None

    for b in all_bookings:
        sid = b.get("seat_id")
        emp = (b.get("employee") or {})
        meta = {
            "employee_name": emp.get("name"),
            "team_name": b.get("team_name"),
            "team_color": b.get("team_color"),
            "seat_label": b.get("seat_label"),
        }
        seat_meta[sid] = meta
        if emp.get("id") == uid:
            my_seat_id = sid
            team_color = b.get("team_color")
            team_name = b.get("team_name")
        elif my_team_id and b.get("team_id") == my_team_id:
            team_seat_ids.append(sid)
        else:
            occupied_seat_ids.append(sid)

    all_seat_ids = [s.get("id") for s in seats if s.get("id")]
    identified = set(occupied_seat_ids) | set(team_seat_ids) | ({my_seat_id} if my_seat_id else set())
    available_seat_ids = [s for s in all_seat_ids if s not in identified]

    return {
        "plan": {
            "id": resolved_plan_id,
            "name": plan_name,
            "pdfUrl": version.get("pdfUrl") or (plan_doc or {}).get("pdfUrl"),
            "version_number": version.get("version_number"),
        },
        "seats": seats,
        "user_seat_id": my_seat_id,
        "team_seat_ids": team_seat_ids,
        "occupied_seat_ids": occupied_seat_ids,
        "available_seat_ids": available_seat_ids,
        "team_color": team_color,
        "team_name": team_name,
        "seat_meta": seat_meta,
    }
