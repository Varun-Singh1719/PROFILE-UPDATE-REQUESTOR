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

    # ---- Team data: fetch teams where user is a member OR manager
    # (Dashboard type is now driven by permission-set, not team-manager role.
    # We still populate team data so the frontend can render "My Team Today"
    # when the user's permission grants Manager-level dashboard.)
    user_teams = await db.teams.find(
        {"$or": [{"manager_ids": {"$in": [uid]}}, {"member_ids": {"$in": [uid]}}]},
        {"_id": 0, "id": 1, "name": 1, "color": 1, "member_ids": 1, "manager_ids": 1},
    ).to_list(50)
    # Retain `is_manager` field for backwards compatibility, but its meaning is
    # now "user is listed as a manager on ≥ 1 team". It NO LONGER drives which
    # dashboard is shown — that's determined by the assigned Permission Set.
    is_manager_flag = any(uid in (t.get("manager_ids") or []) for t in user_teams)
    managed_teams = user_teams
    my_team_today: List[dict] = []
    if user_teams:
        # collect all member+manager ids across the user's teams (excluding self)
        member_ids: List[str] = []
        team_by_member: Dict[str, dict] = {}
        for t in user_teams:
            for mid in ((t.get("member_ids") or []) + (t.get("manager_ids") or [])):
                if mid and mid != uid:
                    member_ids.append(mid)
                    team_by_member.setdefault(mid, t)
        member_ids = list(dict.fromkeys(member_ids))  # dedupe, preserve order

        if member_ids:
            # Contacts info
            contacts = await db.contacts.find(
                {"id": {"$in": member_ids}},
                {"_id": 0, "id": 1, "name": 1, "email": 1, "emp_id": 1, "role": 1, "avatar_kind": 1, "avatar_image": 1, "avatar_color": 1, "avatar_preset": 1, "status": 1},
            ).to_list(500)
            contact_by_id = {c["id"]: c for c in contacts}

            # Bookings for today
            bookings = await db.workstation_bookings.find(
                {"employee.id": {"$in": member_ids}, "date": the_date, "cancelled": False},
                {"_id": 0, "employee": 1, "seat_label": 1, "plan_id": 1, "team_id": 1, "team_name": 1, "team_color": 1},
            ).to_list(500)
            booking_by_emp = {(b.get("employee") or {}).get("id"): b for b in bookings if (b.get("employee") or {}).get("id")}

            # Pending requests for today
            pending = await db.workstation_requests.find(
                {"employee.id": {"$in": member_ids}, "date": the_date, "status": "Pending Approval"},
                {"_id": 0, "employee": 1, "seat_label": 1, "team_id": 1, "team_name": 1, "team_color": 1},
            ).to_list(500)
            pending_by_emp = {(p.get("employee") or {}).get("id"): p for p in pending if (p.get("employee") or {}).get("id")}

            for mid in member_ids:
                c = contact_by_id.get(mid) or {"id": mid, "name": "Unknown"}
                if (c.get("status") or "").lower() == "inactive":
                    continue
                t = team_by_member.get(mid) or {}
                b = booking_by_emp.get(mid)
                p = pending_by_emp.get(mid)
                if b:
                    status = "assigned"
                    seat_label = b.get("seat_label")
                elif p:
                    status = "requested"
                    seat_label = p.get("seat_label")
                else:
                    status = "off"
                    seat_label = None
                my_team_today.append({
                    "id": mid,
                    "name": c.get("name"),
                    "email": c.get("email"),
                    "role": c.get("role"),
                    "emp_id": c.get("emp_id"),
                    "avatar_kind": c.get("avatar_kind"),
                    "avatar_image": c.get("avatar_image"),
                    "avatar_color": c.get("avatar_color"),
                    "avatar_preset": c.get("avatar_preset"),
                    "team_id": t.get("id"),
                    "team_name": t.get("name"),
                    "team_color": t.get("color"),
                    "status": status,
                    "seat_label": seat_label,
                })
            # sort: assigned first, then requested, then off — alphabetical inside
            order = {"assigned": 0, "requested": 1, "off": 2}
            my_team_today.sort(key=lambda x: (order.get(x["status"], 9), (x.get("name") or "").lower()))

    return {
        "date": the_date,
        "my_seat": my_seat_payload,
        "upcoming_meetings": meetings,
        "team_on_floor": team_on_floor,
        "recent_activity": recent,
        "is_manager": is_manager_flag,
        "managed_teams": [{"id": t["id"], "name": t.get("name"), "color": t.get("color")} for t in managed_teams],
        "my_team_today": my_team_today,
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



# --------------------------------------------------------------------------- #
#  OVERALL (organisation-wide) dashboard endpoint                              #
# --------------------------------------------------------------------------- #

def _seat_label_key(lbl: str):
    """Sortable key for seat labels like 'A1', 'AA9', 'G12'."""
    import re
    m = re.match(r"^([A-Za-z]+)(\d+)$", str(lbl or ""))
    if not m:
        return (str(lbl or ""), 0)
    letters, number = m.group(1), int(m.group(2))
    # left-pad letters so 'A' < 'AA' < 'B'
    return (len(letters), letters.upper(), number)


def _fmt_ago(ts) -> str:
    """Return a compact "X m/h/d ago" string from ISO ts."""
    if not ts:
        return ""
    try:
        if isinstance(ts, str):
            # strip trailing timezone info naïvely
            dt = _dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
        else:
            dt = ts
        if dt.tzinfo is not None:
            dt = dt.astimezone(_dt.timezone.utc).replace(tzinfo=None)
        delta = _dt.datetime.utcnow() - dt
        secs = int(delta.total_seconds())
        if secs < 60:   return f"{secs}s ago"
        if secs < 3600: return f"{secs // 60}m ago"
        if secs < 86400:return f"{secs // 3600}h ago"
        return f"{secs // 86400}d ago"
    except Exception:
        return ""


@api_router.get("/my-workspace/overall-dashboard")
async def my_workspace_overall_dashboard(
    date: Optional[str] = Query(None, description="YYYY-MM-DD (default: today)"),
    user=Depends(get_current_user),
):
    """Organisation-wide workspace dashboard.

    Aggregates:
      * my_seat            – same shape as `/my-workspace/dashboard`
      * org_occupancy      – total seats vs. present today
      * org_week           – 7-day rolling attendance counts
      * meeting_rooms_today– top rooms booked today
      * all_teams          – every team with its seat range
      * recent_activity    – latest bookings/cancellations org-wide
    """
    the_date = date or _today_iso()
    try:
        _dt.date.fromisoformat(the_date)
    except Exception:
        raise HTTPException(400, "date must be YYYY-MM-DD")

    uid = user.get("id")

    # ── My seat today (reuse the same logic block from /dashboard) ──────────
    my_booking = await db.workstation_bookings.find_one(
        {"employee.id": uid, "date": the_date, "cancelled": False}, {"_id": 0},
    )
    my_request = None
    if not my_booking:
        my_request = await db.workstation_requests.find_one(
            {"employee.id": uid, "date": the_date, "status": "Pending Approval"},
            {"_id": 0},
        )
    my_seat_payload: Optional[dict] = None
    ctx_source = my_booking or my_request
    plan_name: Optional[str] = None
    if ctx_source and ctx_source.get("plan_id"):
        plan_doc = await db.floor_plans.find_one(
            {"id": ctx_source["plan_id"]}, {"_id": 0, "name": 1},
        )
        plan_name = (plan_doc or {}).get("name")
    if ctx_source:
        my_seat_payload = {
            "status": "assigned" if my_booking else "requested",
            "date": the_date,
            "plan_id": ctx_source.get("plan_id"),
            "plan_name": plan_name,
            "seat_id": ctx_source.get("seat_id"),
            "seat_label": ctx_source.get("seat_label"),
            "team_id": ctx_source.get("team_id"),
            "team_name": ctx_source.get("team_name"),
            "team_color": ctx_source.get("team_color"),
            "booking_id": (my_booking or {}).get("id"),
            "request_id": (my_request or {}).get("id"),
        }

    # ── Total seats from all live floor plans ───────────────────────────────
    total_seats = 0
    plans = await db.floor_plans.find(
        {}, {"_id": 0, "id": 1, "name": 1, "live_version_id": 1},
    ).to_list(50)
    for p in plans:
        vid = p.get("live_version_id")
        if not vid:
            continue
        v = await db.floor_plan_versions.find_one({"id": vid}, {"_id": 0, "seats": 1})
        total_seats += len(((v or {}).get("seats") or []))

    # ── Present today = number of confirmed bookings today ──────────────────
    present_today = await db.workstation_bookings.count_documents(
        {"date": the_date, "cancelled": False},
    )
    free_today = max(0, total_seats - present_today)
    occ_pct = int(round((present_today / total_seats) * 100)) if total_seats else 0

    # ── 7-day rolling attendance ────────────────────────────────────────────
    the_date_obj = _dt.date.fromisoformat(the_date)
    start = the_date_obj - _dt.timedelta(days=6)
    date_strs = [(start + _dt.timedelta(days=i)).isoformat() for i in range(7)]
    counts_map = {ds: 0 for ds in date_strs}
    cur = db.workstation_bookings.aggregate([
        {"$match": {"date": {"$in": date_strs}, "cancelled": False}},
        {"$group": {"_id": "$date", "n": {"$sum": 1}}},
    ])
    async for row in cur:
        counts_map[row["_id"]] = row["n"]
    day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    org_week: List[dict] = []
    for ds in date_strs:
        d = _dt.date.fromisoformat(ds)
        org_week.append({
            "date": ds,
            "day": day_names[d.weekday()],
            "n": d.day,
            "count": counts_map[ds],
            "today": ds == the_date,
        })

    # ── Meeting rooms today (aggregate room_bookings by room) ───────────────
    day_start = _dt.datetime.combine(the_date_obj, _dt.time.min).isoformat()
    day_end   = _dt.datetime.combine(the_date_obj, _dt.time.max).isoformat()
    rooms_agg: Dict[str, dict] = {}
    total_room_bookings_today = 0
    async for rb in db.room_bookings.find(
        {"cancelled": False, "start_at": {"$lte": day_end}, "end_at": {"$gte": day_start}},
        {"_id": 0, "room_id": 1, "room_name": 1, "plan_id": 1, "plan_name": 1,
         "start_at": 1, "end_at": 1},
    ):
        total_room_bookings_today += 1
        key = rb.get("room_id") or rb.get("room_name")
        if not key:
            continue
        try:
            start_dt = max(_dt.datetime.fromisoformat(rb["start_at"].replace("Z", "+00:00")),
                           _dt.datetime.combine(the_date_obj, _dt.time.min))
            end_dt   = min(_dt.datetime.fromisoformat(rb["end_at"].replace("Z", "+00:00")),
                           _dt.datetime.combine(the_date_obj, _dt.time.max))
            minutes = max(0, int((end_dt - start_dt).total_seconds() // 60))
        except Exception:
            minutes = 0
        entry = rooms_agg.setdefault(key, {
            "room_id": rb.get("room_id"),
            "room_name": rb.get("room_name"),
            "plan_name": rb.get("plan_name"),
            "minutes_used": 0,
            "bookings": 0,
        })
        entry["minutes_used"] += minutes
        entry["bookings"] += 1
    total_rooms = await db.floor_plan_versions.aggregate([
        {"$project": {"rooms": {"$ifNull": ["$rooms", []]}}},
        {"$project": {"count": {"$size": "$rooms"}}},
        {"$group": {"_id": None, "total": {"$sum": "$count"}}},
    ]).to_list(1)
    total_rooms_count = (total_rooms[0]["total"] if total_rooms else 0) or len(rooms_agg)
    meeting_rooms_today = sorted(
        rooms_agg.values(), key=lambda r: r["minutes_used"], reverse=True,
    )[:6]
    # Format used time as "Xh Ym" and pct of 8h
    day_capacity_min = 8 * 60
    for r in meeting_rooms_today:
        m = r.pop("minutes_used", 0)
        h, mm = divmod(m, 60)
        r["used"] = (f"{h}h {mm:02d}m" if h else f"{mm}m")
        r["pct"] = min(100, int(round((m / day_capacity_min) * 100)))

    # ── All teams: seat range derived from ALL bookings (any date) ──────────
    seats_per_team: Dict[str, List[str]] = {}
    async for b in db.workstation_bookings.find(
        {"cancelled": False, "team_id": {"$ne": None}},
        {"_id": 0, "team_id": 1, "seat_label": 1},
    ):
        tid = b.get("team_id")
        seat = b.get("seat_label")
        if not tid or not seat:
            continue
        seats_per_team.setdefault(tid, []).append(seat)

    team_docs = await db.teams.find(
        {}, {"_id": 0, "id": 1, "name": 1, "color": 1, "member_ids": 1},
    ).to_list(200)
    all_teams: List[dict] = []
    for t in team_docs:
        tid = t["id"]
        seats = sorted(set(seats_per_team.get(tid, [])), key=_seat_label_key)
        all_teams.append({
            "id": tid,
            "name": t.get("name"),
            "color": t.get("color") or "tp1",
            "member_count": len(t.get("member_ids") or []),
            "seat_count": len(seats),
            "seat_from": seats[0]  if seats else None,
            "seat_to":   seats[-1] if seats else None,
        })
    # Show teams with real seat assignments first
    all_teams.sort(key=lambda x: (0 if x["seat_count"] else 1, -x["seat_count"], x["name"] or ""))

    # ── Recent activity (last 6 org-wide booking events) ────────────────────
    recent_activity: List[dict] = []
    async for b in db.workstation_bookings.find(
        {}, {"_id": 0, "employee": 1, "seat_label": 1, "team_name": 1, "date": 1,
             "cancelled": 1, "updated_at": 1, "created_at": 1},
    ).sort("updated_at", -1).limit(6):
        emp = (b.get("employee") or {})
        who = emp.get("name") or emp.get("email") or "Someone"
        verb = "cancelled" if b.get("cancelled") else "booked"
        seat = b.get("seat_label") or "a seat"
        team = b.get("team_name")
        target = f"{seat}" + (f" · {team}" if team else "")
        recent_activity.append({
            "who":    who,
            "what":   verb,
            "target": target,
            "when":   _fmt_ago(b.get("updated_at") or b.get("created_at")),
        })

    return {
        "date": the_date,
        "my_seat": my_seat_payload,
        "org_occupancy": {
            "total_seats": total_seats,
            "present":     present_today,
            "free":        free_today,
            "occupancy_pct": occ_pct,
        },
        "org_week": org_week,
        "meeting_rooms_today": meeting_rooms_today,
        "meeting_rooms_total": total_rooms_count,
        "meeting_rooms_bookings_today": total_room_bookings_today,
        "all_teams": all_teams,
        "recent_activity": recent_activity,
    }



@api_router.get("/my-workspace/meeting-rooms-all")
async def my_workspace_meeting_rooms_all(
    date: Optional[str] = Query(None, description="YYYY-MM-DD (default: today)"),
    user=Depends(get_current_user),
):
    """List **every** meeting room across all live floor plans with each
    room's usage for the given day.

    Used by the "View all meeting rooms" modal on the Workspace Manager
    dashboard. Unlike `overall-dashboard.meeting_rooms_today` (which is
    capped at the top-6 booked rooms) this endpoint returns booked +
    unbooked rooms so the modal can list them all in one shot.
    """
    the_date = date or _today_iso()
    try:
        the_date_obj = _dt.date.fromisoformat(the_date)
    except ValueError:
        raise HTTPException(400, "Invalid date")

    day_start = _dt.datetime.combine(the_date_obj, _dt.time.min).isoformat()
    day_end   = _dt.datetime.combine(the_date_obj, _dt.time.max).isoformat()

    # 1) Aggregate today's bookings by room
    rooms_agg: Dict[str, dict] = {}
    total_bookings = 0
    async for rb in db.room_bookings.find(
        {"cancelled": False, "start_at": {"$lte": day_end}, "end_at": {"$gte": day_start}},
        {"_id": 0, "room_id": 1, "room_name": 1, "plan_id": 1, "plan_name": 1,
         "start_at": 1, "end_at": 1},
    ):
        total_bookings += 1
        key = rb.get("room_id") or rb.get("room_name")
        if not key:
            continue
        try:
            s = max(_dt.datetime.fromisoformat(rb["start_at"].replace("Z", "+00:00")),
                    _dt.datetime.combine(the_date_obj, _dt.time.min))
            e = min(_dt.datetime.fromisoformat(rb["end_at"].replace("Z", "+00:00")),
                    _dt.datetime.combine(the_date_obj, _dt.time.max))
            minutes = max(0, int((e - s).total_seconds() // 60))
        except Exception:
            minutes = 0
        entry = rooms_agg.setdefault(key, {
            "room_id": rb.get("room_id"),
            "room_name": rb.get("room_name"),
            "plan_name": rb.get("plan_name"),
            "minutes_used": 0,
            "bookings": 0,
        })
        entry["minutes_used"] += minutes
        entry["bookings"] += 1

    # 2) Enumerate every room on every live floor plan (source of truth)
    live_rooms: List[dict] = []
    async for fp in db.floor_plans.find(
        {"live_version_id": {"$ne": None}},
        {"_id": 0, "id": 1, "name": 1, "live_version_id": 1},
    ):
        v = await db.floor_plan_versions.find_one(
            {"id": fp["live_version_id"]},
            {"_id": 0, "rooms": 1, "name": 1},
        )
        if not v:
            continue
        plan_name = v.get("name") or fp.get("name")
        for r in (v.get("rooms") or []):
            live_rooms.append({
                "room_id": r.get("id"),
                "room_name": r.get("name"),
                "plan_name": plan_name,
                "capacity": r.get("capacity"),
            })

    # 3) Merge live-plan rooms with today's usage (unbooked rooms surface too)
    merged: List[dict] = []
    for lr in live_rooms:
        key = lr["room_id"] or lr["room_name"]
        agg = rooms_agg.pop(key, None)
        merged.append({
            "room_id":     lr["room_id"],
            "room_name":   lr["room_name"],
            "plan_name":   lr["plan_name"],
            "capacity":    lr.get("capacity"),
            "minutes_used": (agg or {}).get("minutes_used", 0),
            "bookings":     (agg or {}).get("bookings", 0),
        })
    for orphan in rooms_agg.values():  # bookings pointing to non-live rooms
        merged.append({
            "room_id":     orphan.get("room_id"),
            "room_name":   orphan.get("room_name"),
            "plan_name":   orphan.get("plan_name"),
            "capacity":    None,
            "minutes_used": orphan.get("minutes_used", 0),
            "bookings":     orphan.get("bookings", 0),
        })
    # Booked first (most-used desc), then unbooked alphabetically
    merged.sort(key=lambda r: (
        0 if r["minutes_used"] > 0 else 1,
        -r["minutes_used"],
        (r.get("room_name") or "").lower(),
    ))

    # 4) Format usage
    day_capacity_min = 8 * 60
    for r in merged:
        m = r.pop("minutes_used", 0)
        h, mm = divmod(m, 60)
        r["used"] = (f"{h}h {mm:02d}m" if h else f"{mm}m")
        r["pct"] = min(100, int(round((m / day_capacity_min) * 100)))

    return {
        "date": the_date,
        "rooms": merged,
        "total_rooms": len(merged),
        "total_bookings": total_bookings,
        "booked_count": sum(1 for r in merged if r["bookings"] > 0),
    }
