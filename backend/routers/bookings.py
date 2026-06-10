"""Bookings aggregator — unified read-only view across booking sources.

Aggregates both `room_bookings` (Meeting Room) and `workstation_bookings`
into a single type-agnostic shape so the centralised Bookings table can list,
filter, sort, paginate, search, export, detail and bulk-cancel uniformly.

Endpoints
=========
GET  /api/bookings                     — paginated, filtered, sorted list (with derived status, team)
GET  /api/bookings/filters             — distinct values used to populate filter dropdowns
GET  /api/bookings/{booking_id}        — single booking with the same enriched shape
POST /api/bookings/bulk-cancel         — body: {booking_ids: [...]} → sets cancelled=True on each
GET  /api/bookings/export              — CSV/XLSX; respects the same filter params as the list

Status (derived, not persisted)
===============================
  Cancelled — if `cancelled` flag is True
  Completed — not cancelled AND end_at <= now (Meeting Room) OR date < today (Workstation)
  Active    — otherwise
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, date, timezone
from typing import List, Optional, Dict, Any, Tuple

from fastapi import Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from core import api_router, db, get_current_user, now_iso
from routers.room_bookings import _enrich_bookings_with_team


# --------------------------------------------------------------------------- #
# Constants                                                                   #
# --------------------------------------------------------------------------- #

VALID_STATUSES = {"all", "active", "cancelled", "completed"}
VALID_TYPES = {"all", "meeting_room", "workstation"}
DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 200

DEFAULT_SORT = ("date", "desc")  # field, direction
VALID_SORTS = {
    "seq_no", "date", "title", "room_name", "organizer", "status", "created_at",
}


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #

def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _compute_status(doc: dict) -> str:
    if doc.get("cancelled"):
        return "Cancelled"
    # Workstation bookings carry a `date` (YYYY-MM-DD) only — full-day.
    if doc.get("date") and not doc.get("end_at"):
        try:
            d = date.fromisoformat(doc["date"])
            return "Completed" if d < date.today() else "Active"
        except Exception:
            return "Active"
    end_at = doc.get("end_at")
    try:
        end_dt = datetime.fromisoformat((end_at or "").replace("Z", "+00:00"))
    except Exception:
        return "Active"
    now = datetime.now(end_dt.tzinfo) if end_dt.tzinfo else datetime.now()
    return "Completed" if end_dt <= now else "Active"


def _booking_view(doc: dict) -> dict:
    """Project a room_bookings doc into the unified Bookings table shape."""
    return {
        "id": doc.get("id"),
        "seq_no": doc.get("seq_no"),
        "type": "Meeting Room",
        "title": doc.get("title"),
        "room_id": doc.get("room_id"),
        "room_name": doc.get("room_name"),
        "room_capacity": doc.get("room_capacity"),
        "plan_id": doc.get("plan_id"),
        "plan_name": doc.get("plan_name"),
        "start_at": doc.get("start_at"),
        "end_at": doc.get("end_at"),
        "organizer": doc.get("organizer"),
        "organizer_team_name": doc.get("organizer_team_name"),
        "attendees": doc.get("attendees") or [],
        "recurring": doc.get("recurring"),
        "series_id": doc.get("series_id"),
        "status": _compute_status(doc),
        "cancelled": bool(doc.get("cancelled")),
        # In room_bookings the organizer IS the creator, so created_by mirrors organizer.
        "created_by": doc.get("organizer"),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


def _workstation_booking_view(doc: dict, team_map: Optional[Dict[str, dict]] = None) -> dict:
    """Project a workstation_bookings doc into the unified Bookings table shape."""
    team_map = team_map or {}
    emp = doc.get("employee") or {}
    team_name = doc.get("team_name")
    if not team_name and doc.get("team_id") and doc["team_id"] in team_map:
        team_name = team_map[doc["team_id"]].get("name")
    return {
        "id": doc.get("id"),
        "seq_no": doc.get("seq_no"),
        "type": "Workstation",
        "title": f"Workstation {doc.get('seat_label')}",
        "room_id": doc.get("seat_id"),
        "room_name": doc.get("seat_label"),
        "room_capacity": 1,
        "plan_id": doc.get("plan_id"),
        "plan_name": doc.get("plan_name"),
        # No time component for workstations — surface `date` field and leave start_at/end_at empty.
        "start_at": doc.get("date"),
        "end_at": doc.get("date"),
        "date": doc.get("date"),
        "seat_id": doc.get("seat_id"),
        "seat_label": doc.get("seat_label"),
        "organizer": emp,
        "organizer_team_name": team_name,
        "team_id": doc.get("team_id"),
        "team_color": doc.get("team_color"),
        "attendees": [],
        "recurring": doc.get("recurring"),
        "series_id": doc.get("series_id"),
        "status": _compute_status(doc),
        "cancelled": bool(doc.get("cancelled")),
        "created_by": doc.get("created_by") or emp,
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


async def _enrich_workstation_with_team(docs: List[dict]) -> List[dict]:
    if not docs:
        return docs
    team_ids = list({d["team_id"] for d in docs if d.get("team_id")})
    team_map: Dict[str, dict] = {}
    if team_ids:
        team_docs = await db.teams.find({"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
        team_map = {t["id"]: t for t in team_docs}
    return [_workstation_booking_view(d, team_map) for d in docs]


def _parse_date(s: Optional[str], field: str) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except Exception:
        raise HTTPException(400, f"Invalid date for '{field}' (expected YYYY-MM-DD)")


async def _build_query(
    *,
    type_: str,
    status: str,
    date_from: Optional[date],
    date_to: Optional[date],
    team_id: Optional[str],
    employee_id: Optional[str],
    created_by_id: Optional[str],
    search: Optional[str],
) -> Dict[str, Any]:
    """Build the room_bookings query (MR side). Workstation side is handled separately."""
    q: Dict[str, Any] = {}

    # Date range — uses start_at; date_to is INCLUSIVE so we add a day in iso form
    if date_from or date_to:
        rng: Dict[str, str] = {}
        if date_from:
            rng["$gte"] = datetime.combine(date_from, datetime.min.time()).isoformat()
        if date_to:
            rng["$lte"] = datetime.combine(date_to, datetime.max.time()).isoformat()
        q["start_at"] = rng

    # Status
    if status == "cancelled":
        q["cancelled"] = True
    elif status == "active":
        q["cancelled"] = False
        q["end_at"] = {"$gt": _now_utc_iso()}
    elif status == "completed":
        q["cancelled"] = False
        # merge with existing end_at clause if any
        end_q = q.get("end_at", {})
        end_q["$lte"] = _now_utc_iso()
        q["end_at"] = end_q

    # Employee (organizer) — direct id match
    if employee_id:
        q["organizer.id"] = employee_id

    # Created-by maps to organizer.id (in MR bookings the organizer IS the creator)
    if created_by_id:
        q["organizer.id"] = created_by_id

    # Team — pull all member ids for the team, then match organizer.id ∈ members
    if team_id:
        team = await db.teams.find_one({"id": team_id}, {"_id": 0, "member_ids": 1})
        member_ids = (team or {}).get("member_ids") or []
        if not member_ids:
            q["__none__"] = True
            return q
        # If employee/created_by already constrained, intersect; otherwise just $in.
        existing = q.get("organizer.id")
        if isinstance(existing, str):
            if existing not in member_ids:
                q["__none__"] = True
                return q
        else:
            q["organizer.id"] = {"$in": member_ids}

    # Search — case-insensitive partial on room_name OR title
    if search:
        s = search.strip()
        if s:
            import re
            esc = re.escape(s)
            q["$or"] = [
                {"room_name": {"$regex": esc, "$options": "i"}},
                {"title": {"$regex": esc, "$options": "i"}},
            ]

    return q


async def _build_workstation_query(
    *,
    status: str,
    date_from: Optional[date],
    date_to: Optional[date],
    team_id: Optional[str],
    employee_id: Optional[str],
    created_by_id: Optional[str],
    search: Optional[str],
) -> Dict[str, Any]:
    """Build the workstation_bookings query. Dates are stored as 'YYYY-MM-DD' strings."""
    q: Dict[str, Any] = {}
    today_iso = date.today().isoformat()
    if date_from or date_to:
        rng: Dict[str, str] = {}
        if date_from:
            rng["$gte"] = date_from.isoformat()
        if date_to:
            rng["$lte"] = date_to.isoformat()
        q["date"] = rng
    if status == "cancelled":
        q["cancelled"] = True
    elif status == "active":
        q["cancelled"] = False
        existing = q.get("date", {})
        existing["$gte"] = max(existing.get("$gte", ""), today_iso) if existing.get("$gte") else today_iso
        q["date"] = existing
    elif status == "completed":
        q["cancelled"] = False
        existing = q.get("date", {})
        existing["$lt"] = min(existing.get("$lt", "9999-12-31"), today_iso) if existing.get("$lt") else today_iso
        q["date"] = existing
    if employee_id:
        q["employee.id"] = employee_id
    if created_by_id:
        q["created_by.id"] = created_by_id
    if team_id:
        q["team_id"] = team_id
    if search:
        s = search.strip()
        if s:
            import re
            esc = re.escape(s)
            q["$or"] = [
                {"seat_label": {"$regex": esc, "$options": "i"}},
                {"plan_name": {"$regex": esc, "$options": "i"}},
                {"employee.name": {"$regex": esc, "$options": "i"}},
            ]
    return q


def _sort_tuple(sort: str, direction: str) -> List[Tuple[str, int]]:
    direction_int = -1 if (direction or "").lower() == "desc" else 1
    if sort == "date":
        return [("start_at", direction_int)]
    if sort == "title":
        return [("title", direction_int)]
    if sort == "room_name":
        return [("room_name", direction_int)]
    if sort == "organizer":
        return [("organizer.name", direction_int)]
    if sort == "status":
        # We can't easily sort on derived status; fall back to cancelled then start_at
        return [("cancelled", direction_int), ("start_at", direction_int)]
    if sort == "created_at":
        return [("created_at", direction_int)]
    if sort == "seq_no":
        return [("seq_no", direction_int)]
    return [("start_at", direction_int)]


# --------------------------------------------------------------------------- #
# Endpoints                                                                   #
# --------------------------------------------------------------------------- #

@api_router.get("/bookings")
async def list_bookings(
    user=Depends(get_current_user),
    type: str = Query("all", description="all | meeting_room | workstation"),
    status: str = Query("all", description="all | active | cancelled | completed"),
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD inclusive"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD inclusive"),
    team_id: Optional[str] = Query(None),
    employee_id: Optional[str] = Query(None),
    created_by_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort: str = Query("date", description=f"one of {sorted(VALID_SORTS)}"),
    direction: str = Query("desc", description="asc | desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
):
    type_ = (type or "all").lower()
    status_ = (status or "all").lower()
    if type_ not in VALID_TYPES:
        raise HTTPException(400, f"Invalid type. Use one of: {sorted(VALID_TYPES)}")
    if status_ not in VALID_STATUSES:
        raise HTTPException(400, f"Invalid status. Use one of: {sorted(VALID_STATUSES)}")
    if sort not in VALID_SORTS:
        raise HTTPException(400, f"Invalid sort. Use one of: {sorted(VALID_SORTS)}")

    df = _parse_date(date_from, "date_from")
    dt = _parse_date(date_to, "date_to")

    # Collect rows from each enabled source, project to unified shape, then
    # merge / sort / paginate in memory. The data set is small enough (admin
    # tool) that this is acceptable — caps at 5k per source.
    rows: List[dict] = []

    if type_ in ("all", "meeting_room"):
        q_mr = await _build_query(
            type_=type_, status=status_,
            date_from=df, date_to=dt,
            team_id=team_id, employee_id=employee_id, created_by_id=created_by_id,
            search=search,
        )
        if not q_mr.get("__none__"):
            mr_docs = await db.room_bookings.find(q_mr, {"_id": 0}).sort([("start_at", -1)]).limit(5000).to_list(5000)
            mr_docs = await _enrich_bookings_with_team(mr_docs)
            rows.extend(_booking_view(d) for d in mr_docs)

    if type_ in ("all", "workstation"):
        q_ws = await _build_workstation_query(
            status=status_, date_from=df, date_to=dt,
            team_id=team_id, employee_id=employee_id, created_by_id=created_by_id,
            search=search,
        )
        ws_docs = await db.workstation_bookings.find(q_ws, {"_id": 0}).sort([("date", -1)]).limit(5000).to_list(5000)
        ws_enriched = await _enrich_workstation_with_team(ws_docs)
        rows.extend(ws_enriched)

    # In-memory sort
    direction_int = -1 if (direction or "").lower() == "desc" else 1
    key_for_sort = {
        "date": lambda r: r.get("start_at") or r.get("date") or "",
        "seq_no": lambda r: r.get("seq_no") or 0,
        "title": lambda r: (r.get("title") or "").lower(),
        "room_name": lambda r: (r.get("room_name") or "").lower(),
        "organizer": lambda r: ((r.get("organizer") or {}).get("name") or "").lower(),
        "status": lambda r: r.get("status") or "",
        "created_at": lambda r: r.get("created_at") or "",
    }.get(sort, lambda r: r.get("start_at") or r.get("date") or "")
    rows.sort(key=key_for_sort, reverse=(direction_int == -1))

    total = len(rows)
    skip = (page - 1) * page_size
    items = rows[skip:skip + page_size]
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total else 0,
    }


@api_router.get("/bookings/filters")
async def bookings_filter_options(user=Depends(get_current_user)):
    """Distinct values to populate filter dropdowns. Returns:
    - teams: [{id, name}]
    - employees: [{id, name, email, emp_id}]
    - creators: same shape as employees (organizer.id distinct list)
    """
    teams = await db.teams.find({}, {"_id": 0, "id": 1, "name": 1}).sort("name", 1).to_list(500)
    # Employees = contacts (could be filtered by status==Active if desired)
    employees = await db.contacts.find(
        {}, {"_id": 0, "id": 1, "name": 1, "email": 1, "emp_id": 1}
    ).sort("name", 1).to_list(2000)
    # Creators = distinct organizer.id present in room_bookings → joined with contacts
    organizer_ids: List[str] = await db.room_bookings.distinct("organizer.id")
    creators = []
    if organizer_ids:
        creators_docs = await db.contacts.find(
            {"id": {"$in": organizer_ids}},
            {"_id": 0, "id": 1, "name": 1, "email": 1, "emp_id": 1},
        ).sort("name", 1).to_list(2000)
        creators = creators_docs
    return {"teams": teams, "employees": employees, "creators": creators}


class BulkCancelRequest(BaseModel):
    booking_ids: List[str] = Field(..., min_length=1)


@api_router.post("/bookings/bulk-cancel")
async def bulk_cancel(body: BulkCancelRequest, user=Depends(get_current_user)):
    """Cancel multiple bookings in one shot. Permissions today: admin (any role) can cancel any.
    The response details which ids were cancelled vs skipped (already cancelled / not found).
    Works across BOTH Meeting Room and Workstation bookings.
    """
    is_admin = user.get("role") in ("Super Admin", "Admin")
    if not is_admin:
        raise HTTPException(403, "Only admins can bulk cancel bookings")

    ids = list({bid for bid in body.booking_ids if bid})
    if not ids:
        raise HTTPException(400, "booking_ids cannot be empty")

    mr_docs = await db.room_bookings.find({"id": {"$in": ids}}, {"_id": 0}).to_list(1000)
    ws_docs = await db.workstation_bookings.find({"id": {"$in": ids}}, {"_id": 0}).to_list(1000)

    found_ids = {d["id"] for d in mr_docs} | {d["id"] for d in ws_docs}
    not_found = [bid for bid in ids if bid not in found_ids]
    already = [d["id"] for d in (mr_docs + ws_docs) if d.get("cancelled")]
    mr_to_cancel = [d["id"] for d in mr_docs if not d.get("cancelled")]
    ws_to_cancel = [d["id"] for d in ws_docs if not d.get("cancelled")]

    actor = {"id": user.get("id"), "name": user.get("name"), "email": user.get("email")}
    if mr_to_cancel:
        await db.room_bookings.update_many(
            {"id": {"$in": mr_to_cancel}},
            {"$set": {"cancelled": True, "cancelled_at": now_iso(), "cancelled_by": actor, "updated_at": now_iso()}},
        )
    if ws_to_cancel:
        await db.workstation_bookings.update_many(
            {"id": {"$in": ws_to_cancel}},
            {"$set": {"cancelled": True, "updated_at": now_iso(), "cancelled_by": actor}},
        )
    return {
        "ok": True,
        "cancelled": mr_to_cancel + ws_to_cancel,
        "already_cancelled": already,
        "not_found": not_found,
        "count": len(mr_to_cancel) + len(ws_to_cancel),
    }


@api_router.get("/bookings/export")
async def export_bookings(
    user=Depends(get_current_user),
    format: str = Query("csv", description="csv | xlsx"),
    type: str = Query("all"),
    status: str = Query("all"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    team_id: Optional[str] = Query(None),
    employee_id: Optional[str] = Query(None),
    created_by_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    ids: Optional[str] = Query(None, description="Comma-separated booking uuids to export ONLY these rows"),
):
    fmt = (format or "csv").lower()
    if fmt not in {"csv", "xlsx"}:
        raise HTTPException(400, "format must be 'csv' or 'xlsx'")

    if ids:
        id_list = [x.strip() for x in ids.split(",") if x.strip()]
        q = {"id": {"$in": id_list}} if id_list else {"__none__": True}
    else:
        type_ = (type or "all").lower()
        status_ = (status or "all").lower()
        if type_ not in VALID_TYPES or status_ not in VALID_STATUSES:
            raise HTTPException(400, "Invalid type/status")
        q = await _build_query(
            type_=type_, status=status_,
            date_from=_parse_date(date_from, "date_from"),
            date_to=_parse_date(date_to, "date_to"),
            team_id=team_id, employee_id=employee_id, created_by_id=created_by_id,
            search=search,
        )
    if q.get("__none__"):
        rows = []
    else:
        cursor = db.room_bookings.find(q, {"_id": 0}).sort([("start_at", -1)]).limit(10000)
        docs = await cursor.to_list(10000)
        docs = await _enrich_bookings_with_team(docs)
        rows = [_booking_view(d) for d in docs]

    # Flatten for export
    def _fmt_dt(s: Optional[str]) -> str:
        if not s:
            return ""
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            return dt.strftime("%d-%b-%Y %H:%M")
        except Exception:
            return s

    def _fmt_date(s: Optional[str]) -> str:
        if not s:
            return ""
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).strftime("%d-%b-%Y")
        except Exception:
            return s

    def _fmt_time_range(start: Optional[str], end: Optional[str]) -> str:
        if not start or not end:
            return ""
        try:
            s = datetime.fromisoformat(start.replace("Z", "+00:00"))
            e = datetime.fromisoformat(end.replace("Z", "+00:00"))
            return f"{s.strftime('%I:%M %p').lstrip('0')} – {e.strftime('%I:%M %p').lstrip('0')}"
        except Exception:
            return ""

    columns = [
        ("Booking ID", lambda r: r.get("seq_no")),
        ("Type", lambda r: r.get("type")),
        ("Title", lambda r: r.get("title")),
        ("Room / Seat", lambda r: r.get("room_name")),
        ("Employee Name", lambda r: (r.get("organizer") or {}).get("name")),
        ("Employee Email", lambda r: (r.get("organizer") or {}).get("email")),
        ("Team", lambda r: r.get("organizer_team_name") or ""),
        ("Date", lambda r: _fmt_date(r.get("start_at"))),
        ("Time", lambda r: _fmt_time_range(r.get("start_at"), r.get("end_at"))),
        ("Recurring", lambda r: "Yes" if r.get("recurring") else "No"),
        ("Frequency", lambda r: (r.get("recurring") or {}).get("frequency") or ""),
        ("Status", lambda r: r.get("status")),
        ("Created By", lambda r: (r.get("created_by") or {}).get("name")),
        ("Created On", lambda r: _fmt_dt(r.get("created_at"))),
    ]

    if fmt == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([c[0] for c in columns])
        for r in rows:
            writer.writerow([c[1](r) for c in columns])
        content = buf.getvalue().encode("utf-8-sig")  # BOM so Excel opens UTF-8 correctly
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        return Response(
            content=content,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename=bookings_{ts}.csv"},
        )

    # xlsx
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
    except Exception:
        raise HTTPException(500, "Excel export requires openpyxl. Install it on the server.")
    wb = Workbook()
    ws = wb.active
    ws.title = "Bookings"
    ws.append([c[0] for c in columns])
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="EC9324")
    center = Alignment(horizontal="center", vertical="center")
    for cell in ws[1]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center
    for r in rows:
        ws.append([c[1](r) for c in columns])
    for i, c in enumerate(columns, start=1):
        ws.column_dimensions[chr(64 + i) if i <= 26 else "A"].width = max(14, min(40, len(c[0]) + 6))
    ws.freeze_panes = "A2"
    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return Response(
        content=out.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=bookings_{ts}.xlsx"},
    )


# NOTE: this parameterised route must be registered LAST so the literal routes
# (/bookings/filters, /bookings/bulk-cancel, /bookings/export) match first.
@api_router.get("/bookings/{booking_id}")
async def get_booking(booking_id: str, user=Depends(get_current_user)):
    """Resolve by uuid `id` OR numeric `seq_no` (whichever matches), across BOTH
    meeting-room and workstation bookings."""
    # Try workstation first (its seq_no range starts at 20000 which is unambiguous)
    ws = None
    if booking_id.isdigit():
        ws = await db.workstation_bookings.find_one({"seq_no": int(booking_id)}, {"_id": 0})
    if not ws:
        ws = await db.workstation_bookings.find_one({"id": booking_id}, {"_id": 0})
    if ws:
        enriched = await _enrich_workstation_with_team([ws])
        return enriched[0]

    doc = None
    if booking_id.isdigit():
        doc = await db.room_bookings.find_one({"seq_no": int(booking_id)}, {"_id": 0})
    if not doc:
        doc = await db.room_bookings.find_one({"id": booking_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Booking not found")
    enriched = await _enrich_bookings_with_team([doc])
    return _booking_view(enriched[0])
