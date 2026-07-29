"""Tickets: list/CRUD, bulk, csv export, comments, activity."""
import csv
import io
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import Depends, HTTPException
from fastapi.responses import StreamingResponse

from core import (
    api_router, db, now_iso, get_current_user, ist_now,
    TicketCreate, TicketUpdate, BulkAssign, BulkStatus, CommentCreate, TicketReopen,
)
from notifications import send_email
from routers.permissions import get_effective_scope, get_user_scope_context, scope_to_id_filter
from routers.permissions_v3 import get_v3_function, TICKET_STATUS_RANK, _MAX_EDITABLE_STATUS_RANK, require_any_v3_page_view


async def _ticket_view_filter(user: dict) -> dict:
    """Build a Mongo query filter that limits which tickets the user is allowed
    to see, based on their effective `profix.ticket.view` scope.

    Returns `{}` for unrestricted access (Super Admin / "all").
    Returns `{"$or": [{"created_by_id": {"$in": ids}}, {"assigned_to_id": {"$in": ids}}]}`
    for "respective" or "team".
    Returns an impossible filter `{"id": "__none__"}` for deny.
    """
    scope = await get_effective_scope(user, "profix", "ticket", "view")
    if scope == "all" or scope is True:
        return {}
    ctx = await get_user_scope_context(user)
    ids = scope_to_id_filter(scope, ctx)
    if ids is None:
        return {}
    if not ids:
        return {"id": "__no_match__"}
    return {"$or": [{"created_by_id": {"$in": ids}}, {"assigned_to_id": {"$in": ids}}]}


async def _resolve_user_team(user_id: str) -> tuple:
    """Return `(team_id, team_name)` for the team the user is a MEMBER of.

    Falls back to a team the user MANAGES if they're only a manager. A user
    is a member of at most one team (backend-enforced), but may manage many.
    Returns `(None, None)` if the user isn't attached to any team.
    """
    if not user_id:
        return (None, None)
    t = await db.teams.find_one({"member_ids": user_id}, {"_id": 0, "id": 1, "name": 1})
    if not t:
        t = await db.teams.find_one(
            {"manager_ids": user_id},
            {"_id": 0, "id": 1, "name": 1},
            sort=[("name", 1)],
        )
    if not t:
        return (None, None)
    return (t.get("id"), t.get("name"))


async def _team_map_for_users(user_ids) -> dict:
    """Batch resolver: {user_id: {"team_id": ..., "team_name": ...}}.

    Preloads all teams once, then loops through their member_ids / manager_ids
    to build the reverse map. O(#teams + #members) — no per-ticket query.
    Prefers `member` team over `manager` team when a user is both.
    """
    ids = [u for u in (user_ids or []) if u]
    if not ids:
        return {}
    id_set = set(ids)
    teams = await db.teams.find(
        {"$or": [{"member_ids": {"$in": ids}}, {"manager_ids": {"$in": ids}}]},
        {"_id": 0, "id": 1, "name": 1, "member_ids": 1, "manager_ids": 1},
    ).to_list(2000)
    out: dict = {}
    # First pass: members (unique per user).
    for t in teams:
        for uid in (t.get("member_ids") or []):
            if uid in id_set:
                out[uid] = {"team_id": t.get("id"), "team_name": t.get("name")}
    # Second pass: managers — only fill if not already resolved as a member.
    for t in sorted(teams, key=lambda x: (x.get("name") or "")):
        for uid in (t.get("manager_ids") or []):
            if uid in id_set and uid not in out:
                out[uid] = {"team_id": t.get("id"), "team_name": t.get("name")}
    return out


async def _team_map_for_names(names) -> dict:
    """NAME-based fallback resolver: {creator_name: {team_id, team_name}}.

    Used for legacy tickets whose `created_by_id` was seeded from a previous
    DB (so it doesn't match any current contact). We look up each name in
    `contacts` to find their current id, then reuse `_team_map_for_users`.
    """
    ns = list({(n or "").strip() for n in (names or []) if n})
    ns = [n for n in ns if n]
    if not ns:
        return {}
    docs = await db.contacts.find(
        {"name": {"$in": ns}},
        {"_id": 0, "id": 1, "name": 1},
    ).to_list(2000)
    name_to_id = {d["name"]: d["id"] for d in docs}
    id_map = await _team_map_for_users(list(name_to_id.values()))
    return {name: id_map[cid] for name, cid in name_to_id.items() if cid in id_map}


def _enrich_tickets_with_team(items: list, team_map: dict, name_map: dict = None) -> list:
    """Overlay `team_id` / `team_name` on each ticket from the current
    teams collection so the UI always reflects reality (handles legacy
    tickets created before the enrichment fix, and tickets whose creator
    was moved to a different team afterwards).

    `name_map` is an optional fallback keyed by creator name — used when
    the `created_by_id` no longer maps to a current contact (data seeded
    from an older DB, name-column-only imports, etc.).
    """
    for t in items:
        creator_id = t.get("created_by_id")
        info = team_map.get(creator_id) if creator_id else None
        if not info and name_map:
            info = name_map.get((t.get("created_by_name") or "").strip())
        if info:
            t["team_id"] = info["team_id"]
            t["team_name"] = info["team_name"]
        else:
            # Preserve any existing value only if it's a real team; otherwise
            # explicitly null it out so the UI shows the empty state.
            if not t.get("team_name"):
                t["team_id"] = t.get("team_id") or None
                t["team_name"] = None
    return items


async def _apply_pending_team_filter(query: dict) -> dict:
    """`parse_filters` stashes the `team` filter under `_pending_team_filter`
    because it needs an async DB lookup to be complete. Convert it here into
    a concrete `$or` clause and merge into the query dict. No-op when the
    marker is absent."""
    tm_list = query.pop("_pending_team_filter", None)
    if not tm_list:
        return query
    # Fetch the requested teams and derive all user_ids that belong to them
    # (members + managers) so tickets can be matched by creator even if the
    # ticket's team_id was never populated.
    team_docs = await db.teams.find(
        {"id": {"$in": tm_list}},
        {"_id": 0, "id": 1, "member_ids": 1, "manager_ids": 1},
    ).to_list(2000)
    user_ids: set = set()
    for t in team_docs:
        user_ids.update(t.get("member_ids") or [])
        user_ids.update(t.get("manager_ids") or [])
    id_filter = {"$in": tm_list} if len(tm_list) > 1 else tm_list[0]
    or_clause = [{"team_id": id_filter}]
    if user_ids:
        or_clause.append({"created_by_id": {"$in": list(user_ids)}})
        # NAME-based fallback — legacy tickets whose created_by_id no longer
        # matches any current contact. Look up contact names for these ids
        # and add a `created_by_name` clause too.
        contacts = await db.contacts.find(
            {"id": {"$in": list(user_ids)}},
            {"_id": 0, "name": 1},
        ).to_list(2000)
        creator_names = [c["name"] for c in contacts if c.get("name")]
        if creator_names:
            or_clause.append({"created_by_name": {"$in": creator_names}})
    # Merge into existing query, preserving any pre-existing $and / $or.
    team_filter = or_clause[0] if len(or_clause) == 1 else {"$or": or_clause}
    if not query:
        return team_filter
    if "$and" in query:
        query["$and"].append(team_filter)
        return query
    return {"$and": [query, team_filter]}


async def _check_ticket_action_scope(user: dict, ticket: dict, action: str) -> bool:
    """Check whether `user` is allowed to perform `action` (view/edit/assign/approve)
    on the given ticket, considering scope. Returns True/False.
    """
    scope = await get_effective_scope(user, "profix", "ticket", action)
    if scope == "all" or scope is True:
        return True
    if not scope:
        return False
    ctx = await get_user_scope_context(user)
    allowed_ids = set(scope_to_id_filter(scope, ctx) or [])
    return (
        ticket.get("created_by_id") in allowed_ids
        or ticket.get("assigned_to_id") in allowed_ids
    )


def _date_match(date_from, date_to, field="created_at"):
    if not date_from and not date_to:
        return {}
    db_field = "updated_on" if field == "updated_at" else "created_on"
    cond = {}
    if date_from:
        cond["$gte"] = f"{date_from}T00:00:00"
    if date_to:
        try:
            d = datetime.fromisoformat(date_to).date()
            next_day = (datetime(d.year, d.month, d.day) + timedelta(days=1)).date().isoformat()
            cond["$lt"] = f"{next_day}T00:00:00"
        except Exception:
            cond["$lte"] = f"{date_to}T23:59:59"
    return {db_field: cond}


def _csv_list(v):
    """Parse a comma-separated string into a de-duplicated non-empty list.
    Empty / None / "all" returns []. Keeps original order minus dupes.
    """
    if not v:
        return []
    seen = set()
    out = []
    for part in str(v).split(","):
        p = part.strip()
        if not p or p.lower() == "all":
            continue
        if p in seen:
            continue
        seen.add(p)
        out.append(p)
    return out


def parse_filters(status, priority, created_by, assigned_to, q, created_on, updated_on, due_date, date_from=None, date_to=None, date_field="created_at", team=None, id_q=None, desc_q=None):
    query = {}
    # status / priority / created_by / team support both single & comma-separated
    st_list = _csv_list(status)
    if st_list:
        query["status"] = {"$in": st_list} if len(st_list) > 1 else st_list[0]
    pr_list = _csv_list(priority)
    if pr_list:
        query["priority"] = {"$in": pr_list} if len(pr_list) > 1 else pr_list[0]
    cb_list = _csv_list(created_by)
    if cb_list:
        query["created_by_id"] = {"$in": cb_list} if len(cb_list) > 1 else cb_list[0]
    if assigned_to is not None and assigned_to != "":
        at_list = _csv_list(assigned_to)
        # "unassigned" is a pseudo-value that maps to null/empty
        has_unassigned = any(x.lower() == "unassigned" for x in at_list)
        concrete = [x for x in at_list if x.lower() != "unassigned"]
        if has_unassigned and concrete:
            query["$or"] = [
                {"assigned_to_id": {"$in": [None, ""]}},
                {"assigned_to_id": {"$in": concrete}},
            ]
        elif has_unassigned:
            query["assigned_to_id"] = {"$in": [None, ""]}
        elif concrete:
            query["assigned_to_id"] = {"$in": concrete} if len(concrete) > 1 else concrete[0]
    tm_list = _csv_list(team)
    if tm_list:
        # Match either the denormalized team_id on the ticket OR tickets whose
        # creator currently belongs to one of the requested teams (legacy
        # tickets never got team_id populated correctly — this fallback keeps
        # the filter working across the whole dataset).
        query["_pending_team_filter"] = tm_list
    # ---- Split search: exact ID match + description substring (Jul 2026) ----
    # `id_q`  → numeric only, EXACT match on `ticket_id` (accepts either "1102"
    #          or "TKT-1102" from the caller; we normalise to full form).
    # `desc_q` → substring, case-insensitive, on `description` only. Special
    #           regex characters are escaped so users can search for symbols.
    if id_q is not None and str(id_q).strip() != "":
        s = str(id_q).strip()
        # Strip optional "TKT-" prefix; keep only digits.
        digits = re.sub(r"[^0-9]", "", s.upper().removeprefix("TKT-") if s.upper().startswith("TKT-") else s)
        if digits:
            query["ticket_id"] = f"TKT-{digits}"
        else:
            # Non-numeric ID input → force empty result set.
            query["ticket_id"] = "__no_match__"
    if desc_q is not None and str(desc_q).strip() != "":
        escaped = re.escape(str(desc_q).strip())
        query["description"] = {"$regex": escaped, "$options": "i"}
    # Legacy combined `q` — used only if neither id_q nor desc_q was supplied.
    if q and not (id_q or desc_q):
        # Search across ticket fields. Special-case: if the user types a bare
        # number (e.g. "1102"), also match the full ticket_id "TKT-1102". If
        # they type "TKT-1102" or "TKT" it still matches on ticket_id.
        or_clauses = [
            {"ticket_id": {"$regex": q, "$options": "i"}},
            {"description": {"$regex": q, "$options": "i"}},
            {"assigned_to_name": {"$regex": q, "$options": "i"}},
            {"created_by_name": {"$regex": q, "$options": "i"}},
            {"team_name": {"$regex": q, "$options": "i"}},
        ]
        q_clean = q.strip()
        if q_clean.isdigit():
            or_clauses.append({"ticket_id": {"$regex": f"^TKT-{q_clean}", "$options": "i"}})
        query["$or"] = or_clauses
    if created_on:
        query["created_on"] = {"$regex": f"^{created_on}"}
    if updated_on:
        query["updated_on"] = {"$regex": f"^{updated_on}"}
    if due_date:
        query["due_date"] = due_date
    if date_from or date_to:
        query.update(_date_match(date_from, date_to, date_field))
    return query


@api_router.get("/tickets")
async def list_tickets(
    user=Depends(require_any_v3_page_view(
        ("profix", "all_requests"),
        ("profix", "open_requests"),
        ("profix", "unassigned"),
        ("profix", "ticket_detail"),
    )),
    scope: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    created_by: Optional[str] = None,
    assigned_to: Optional[str] = None,
    team: Optional[str] = None,
    q: Optional[str] = None,
    id_q: Optional[str] = None,
    desc_q: Optional[str] = None,
    created_on: Optional[str] = None,
    updated_on: Optional[str] = None,
    due_date: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    date_field: Optional[str] = "created_at",
    page: Optional[int] = None,
    page_size: int = 25,
    sort_by: str = "updated_on",
    sort_dir: str = "desc",
):
    query = parse_filters(status, priority, created_by, assigned_to, q, created_on, updated_on, due_date, date_from, date_to, date_field, team=team, id_q=id_q, desc_q=desc_q)
    query = await _apply_pending_team_filter(query)

    role = user["role"]
    uid = user["id"]
    if scope == "mine":
        if role == "Research":
            query["created_by_id"] = uid
        elif role == "DQ Team":
            query["assigned_to_id"] = uid
    elif scope == "created":
        query["created_by_id"] = uid
    elif scope == "assigned":
        query["assigned_to_id"] = uid
    elif scope == "unassigned":
        query["assigned_to_id"] = {"$in": [None, ""]}
        query["status"] = "Open"
    elif scope == "open":
        query["status"] = "Open"
    if role == "Research" and scope not in ("created", "mine"):
        query["created_by_id"] = uid

    # Scope enforcement: layer on the user's effective view scope on profix.ticket.
    view_filter = await _ticket_view_filter(user)
    if view_filter:
        # Combine with the existing query using $and so both restrictions apply.
        if "$and" in query:
            query["$and"].append(view_filter)
        else:
            query = {"$and": [query, view_filter]} if query else view_filter

    if page is not None:
        page = max(1, page)
        page_size = max(1, min(page_size, 200))
        # subject is no longer a valid sort field (removed Jul 2026 — see PRD)
        sort_field = sort_by if sort_by in ("ticket_id", "status", "priority", "created_on", "updated_on", "due_date", "number_of_profiles") else "updated_on"
        sort_order = -1 if sort_dir == "desc" else 1
        total = await db.tickets.count_documents(query)

        # Status default order: Open → In Progress → Closed
        # Priority default order: High → Medium → Low
        # When sorting on those fields, project a numeric rank and sort by it.
        # For status sort we ALSO tie-break by priority (High first) then updated_on.
        if sort_field == "status":
            pipeline = [
                {"$match": query},
                {"$addFields": {
                    "_status_rank": {"$switch": {"branches": [
                        {"case": {"$eq": ["$status", "Open"]}, "then": 1},
                        {"case": {"$eq": ["$status", "In Progress"]}, "then": 2},
                        {"case": {"$eq": ["$status", "Closed"]}, "then": 3},
                    ], "default": 99}},
                    "_priority_rank": {"$switch": {"branches": [
                        {"case": {"$eq": ["$priority", "High"]}, "then": 1},
                        {"case": {"$eq": ["$priority", "Medium"]}, "then": 2},
                        {"case": {"$eq": ["$priority", "Low"]}, "then": 3},
                    ], "default": 99}},
                }},
                {"$sort": {"_status_rank": sort_order, "_priority_rank": 1, "updated_on": -1}},
                {"$skip": (page - 1) * page_size},
                {"$limit": page_size},
                {"$project": {"_id": 0, "_status_rank": 0, "_priority_rank": 0}},
            ]
            items = await db.tickets.aggregate(pipeline).to_list(page_size)
        elif sort_field == "priority":
            pipeline = [
                {"$match": query},
                {"$addFields": {"_rank": {"$switch": {"branches": [
                    {"case": {"$eq": ["$priority", "High"]}, "then": 1},
                    {"case": {"$eq": ["$priority", "Medium"]}, "then": 2},
                    {"case": {"$eq": ["$priority", "Low"]}, "then": 3},
                ], "default": 99}}}},
                {"$sort": {"_rank": sort_order, "updated_on": -1}},
                {"$skip": (page - 1) * page_size},
                {"$limit": page_size},
                {"$project": {"_id": 0, "_rank": 0}},
            ]
            items = await db.tickets.aggregate(pipeline).to_list(page_size)
        else:
            items = await db.tickets.find(query, {"_id": 0}).sort(sort_field, sort_order).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
        # Enrich with current team info (handles legacy tickets missing team_name).
        creator_ids = list({t.get("created_by_id") for t in items if t.get("created_by_id")})
        creator_names = list({t.get("created_by_name") for t in items if t.get("created_by_name")})
        team_map = await _team_map_for_users(creator_ids)
        name_map = await _team_map_for_names(creator_names)
        _enrich_tickets_with_team(items, team_map, name_map)
        return {"items": items, "total": total, "page": page, "page_size": page_size}
    items = await db.tickets.find(query, {"_id": 0}).sort("updated_on", -1).to_list(2000)
    creator_ids = list({t.get("created_by_id") for t in items if t.get("created_by_id")})
    creator_names = list({t.get("created_by_name") for t in items if t.get("created_by_name")})
    team_map = await _team_map_for_users(creator_ids)
    name_map = await _team_map_for_names(creator_names)
    _enrich_tickets_with_team(items, team_map, name_map)
    return items


@api_router.get("/tickets/export.csv")
async def export_tickets_csv(
    user=Depends(require_any_v3_page_view(
        ("profix", "all_requests"),
        ("profix", "open_requests"),
        ("profix", "unassigned"),
    )),
    scope: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    created_by: Optional[str] = None,
    assigned_to: Optional[str] = None,
    team: Optional[str] = None,
    q: Optional[str] = None,
    id_q: Optional[str] = None,
    desc_q: Optional[str] = None,
    created_on: Optional[str] = None,
    updated_on: Optional[str] = None,
    due_date: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    date_field: Optional[str] = "created_at",
):
    query = parse_filters(status, priority, created_by, assigned_to, q, created_on, updated_on, due_date, date_from, date_to, date_field, team=team, id_q=id_q, desc_q=desc_q)
    query = await _apply_pending_team_filter(query)
    role = user["role"]; uid = user["id"]
    if scope == "mine":
        if role == "Research":
            query["created_by_id"] = uid
        elif role == "DQ Team":
            query["assigned_to_id"] = uid
    elif scope == "created":
        query["created_by_id"] = uid
    elif scope == "assigned":
        query["assigned_to_id"] = uid
    elif scope == "unassigned":
        query["assigned_to_id"] = {"$in": [None, ""]}
        query["status"] = "Open"
    if role == "Research" and scope not in ("created", "mine"):
        query["created_by_id"] = uid
    # Scope enforcement on export as well — never export beyond the user's view scope.
    view_filter = await _ticket_view_filter(user)
    if view_filter:
        query = {"$and": [query, view_filter]} if query else view_filter
    items = await db.tickets.find(query, {"_id": 0}).sort("updated_on", -1).to_list(20000)
    # Enrich with current team info from teams collection (handles legacy
    # tickets that were created before the fix).
    creator_ids = list({t.get("created_by_id") for t in items if t.get("created_by_id")})
    creator_names = list({t.get("created_by_name") for t in items if t.get("created_by_name")})
    team_map = await _team_map_for_users(creator_ids)
    name_map = await _team_map_for_names(creator_names)
    _enrich_tickets_with_team(items, team_map, name_map)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Ticket ID", "Status", "Priority", "Created By", "Team", "Assigned To", "Profiles", "Due Date", "Created On", "Updated On"])
    for t in items:
        w.writerow([
            t.get("ticket_id", ""), t.get("status", ""), t.get("priority", ""),
            t.get("created_by_name", ""), t.get("team_name", "") or "—",
            t.get("assigned_to_name") or "Unassigned",
            t.get("number_of_profiles", "") or 0,
            t.get("due_date") or "", t.get("created_on", ""), t.get("updated_on", ""),
        ])
    filename = f"tickets_{ist_now().date().isoformat()}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.post("/tickets")
async def create_ticket(body: TicketCreate, user=Depends(get_current_user)):
    if user["role"] not in ("Super Admin", "Admin"):
        raise HTTPException(403, "Only Super Admin / Admin can create tickets")
    if body.number_of_profiles is None:
        raise HTTPException(400, "No. of Records is Blank")
    if body.number_of_profiles == 0:
        raise HTTPException(400, "No. of Records cannot be 0")
    if body.number_of_profiles < 0:
        raise HTTPException(400, "No. of Records must be greater than 0")
    # Denormalise the creator's team onto the ticket so list/filter/export
    # can show "Team" without per-row joins. Team membership is stored on
    # the TEAMS collection (member_ids / manager_ids), NOT on the contact,
    # so we look it up via _resolve_user_team.
    team_id, team_name = await _resolve_user_team(user["id"])
    count = await db.tickets.count_documents({})
    doc = {
        "id": str(uuid.uuid4()),
        "ticket_id": f"TKT-{1000 + count + 1}",
        "description": body.description or "",
        "priority": body.priority,
        "due_date": body.due_date,
        "number_of_profiles": body.number_of_profiles,
        "attachment_path": body.attachment_path,
        "attachment_name": body.attachment_name,
        "attachments": body.attachments or ([{"path": body.attachment_path, "filename": body.attachment_name}] if body.attachment_path else []),
        "status": "Open",
        "created_by_id": user["id"],
        "created_by_name": user["name"],
        "team_id": team_id,
        "team_name": team_name,
        "assigned_to_id": None,
        "assigned_to_name": None,
        "created_on": now_iso(),
        "updated_on": now_iso(),
    }
    await db.tickets.insert_one(doc)
    doc.pop("_id", None)
    await db.activity.insert_one({
        "id": str(uuid.uuid4()), "ticket_id": doc["id"], "action": "created",
        "by_id": user["id"], "by_name": user["name"], "at": now_iso(),
        "detail": f"Ticket created by {user['name']}"
    })
    return doc


@api_router.get("/tickets/{ticket_id}")
async def get_ticket(ticket_id: str, user=Depends(get_current_user)):
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Not found")
    # Scope enforcement on direct fetch — prevents URL-manipulation bypass.
    if not await _check_ticket_action_scope(user, t, "view"):
        raise HTTPException(404, "Not found")
    if user["role"] == "DQ Team" and t.get("assigned_to_id") == user["id"] and t.get("status") == "Open":
        await db.tickets.update_one(
            {"id": ticket_id},
            {"$set": {"status": "In Progress", "updated_on": now_iso()}}
        )
        await db.activity.insert_one({
            "id": str(uuid.uuid4()), "ticket_id": ticket_id, "action": "updated",
            "by_id": user["id"], "by_name": user["name"], "at": now_iso(),
            "detail": "Status changed from Open to In Progress"
        })
        t["status"] = "In Progress"
        t["updated_on"] = now_iso()
    return t


# ── Assign-To eligibility helper (Jul 2026) ────────────────────────────────
# A ticket may only be assigned to a user whose effective permission set(s)
# enable EITHER `profix.ticket_detail.assign_to_self` or `assign_to_others`.
# Uses the same OR-of-flags rule as GET /api/contacts/assignable so the UI
# and the backend guardrail stay in perfect sync.
async def _user_is_assignable(target_user_id: str) -> bool:
    """Return True iff the given contact is a valid Assign-To target."""
    target = await db.contacts.find_one(
        {"id": target_user_id, "status": "Active"},
        {"_id": 0, "permission_set_ids": 1},
    )
    if not target:
        return False
    sids = target.get("permission_set_ids") or []
    if not sids:
        return False
    sets = await db.permission_sets.find(
        {"id": {"$in": sids}}, {"_id": 0, "modules": 1}
    ).to_list(500)
    for s in sets:
        fns = ((((s.get("modules") or {}).get("profix") or {}).get("pages") or {}).get("ticket_detail") or {}).get("functions") or {}
        if (fns.get("assign_to_self") or {}).get("enabled"):
            return True
        if (fns.get("assign_to_others") or {}).get("enabled"):
            return True
    return False



@api_router.patch("/tickets/{ticket_id}")
async def update_ticket(ticket_id: str, body: TicketUpdate, user=Depends(get_current_user)):
    t = await db.tickets.find_one({"id": ticket_id})
    if not t:
        raise HTTPException(404, "Not found")
    role = user["role"]
    update = {}
    activity = []

    if body.status is not None:
        if role in ("Super Admin", "Admin"):
            if role == "Admin" and not await _check_ticket_action_scope(user, t, "edit"):
                raise HTTPException(403, "Edit scope does not cover this ticket")
        elif role == "DQ Team":
            if t.get("assigned_to_id") != user["id"]:
                raise HTTPException(403, "Can only update status of tickets assigned to you")
        else:
            raise HTTPException(403, "Cannot update status")
        if body.status != t.get("status"):
            update["status"] = body.status
            activity.append(f"Status changed from {t.get('status')} to {body.status}")

    if body.assigned_to is not None:
        if role in ("Super Admin", "Admin"):
            if role == "Admin" and not await _check_ticket_action_scope(user, t, "assign"):
                raise HTTPException(403, "Assign scope does not cover this ticket")
            if body.assigned_to == "":
                update["assigned_to_id"] = None
                update["assigned_to_name"] = None
                activity.append("Unassigned")
            else:
                assignee = await db.contacts.find_one({"id": body.assigned_to})
                if not assignee:
                    raise HTTPException(400, "Assignee not found")
                # Eligibility guardrail — the target must have
                # profix.ticket_detail.assign_to_self OR assign_to_others
                # enabled. This mirrors the /contacts/assignable rule.
                if not await _user_is_assignable(assignee["id"]):
                    raise HTTPException(
                        400,
                        "Selected user is not eligible for assignment. "
                        "Grant Assign Requests to Self / Others via their Permission Set.",
                    )
                # If the Admin's assign scope is "respective" or "team", the assignee
                # must be in their scoped id whitelist (else they could assign to anyone).
                if role == "Admin":
                    a_scope = await get_effective_scope(user, "profix", "ticket", "assign")
                    if a_scope not in ("all", True):
                        ctx = await get_user_scope_context(user)
                        allowed = set(scope_to_id_filter(a_scope, ctx) or [])
                        if assignee["id"] not in allowed:
                            raise HTTPException(403, "Assignee is outside your assign scope")
                update["assigned_to_id"] = assignee["id"]
                update["assigned_to_name"] = assignee["name"]
                activity.append(f"Assigned to {assignee['name']}")
        elif role == "DQ Team":
            if body.assigned_to != user["id"]:
                raise HTTPException(403, "DQ can only assign to themselves")
            if t.get("assigned_to_id"):
                raise HTTPException(403, "Already assigned")
            # DQ self-assign must still satisfy the eligibility rule — the DQ
            # user themselves must have assign_to_self enabled.
            if not await _user_is_assignable(user["id"]):
                raise HTTPException(
                    403,
                    "You are not eligible for self-assignment. "
                    "Ask an admin to grant Assign Requests to Self on your Permission Set.",
                )
            update["assigned_to_id"] = user["id"]
            update["assigned_to_name"] = user["name"]
            activity.append(f"Self-assigned to {user['name']}")
        else:
            raise HTTPException(403, "Cannot assign")

    # ── Field edits (description / priority / due_date / number_of_profiles / attachments)
    # Gated by the v3 permission `profix.ticket_detail.edit` + a per-set
    # `max_editable_status` lock. Super Admin bypasses the lock entirely.
    _EDIT_FIELDS = {
        "description":        (body.description,        "Description"),
        "priority":           (body.priority,           "Priority"),
        "due_date":           (body.due_date,           "Due Date"),
        "number_of_profiles": (body.number_of_profiles, "No. of Records"),
    }
    _sent_field_edits = {k: v for k, (v, _) in _EDIT_FIELDS.items() if v is not None}
    _attachment_edit = body.attachments is not None or body.attachment_path is not None or body.attachment_name is not None
    if _sent_field_edits or _attachment_edit:
        # Permission check — Super Admin always passes; others must have the
        # profix.ticket_detail.edit function enabled + status lock satisfied.
        if role != "Super Admin":
            fn_entry = await get_v3_function(user, "profix", "ticket_detail", "edit")
            if not fn_entry or not fn_entry.get("enabled"):
                raise HTTPException(403, "You do not have permission to edit this request.")
            # Number-of-records validation must still hold.
            max_editable = fn_entry.get("max_editable_status") or "in_progress"
            cur_rank = TICKET_STATUS_RANK.get(t.get("status") or "Open", 1)
            allowed_rank = _MAX_EDITABLE_STATUS_RANK.get(max_editable, 2)
            if cur_rank > allowed_rank:
                _labels = {"open": "Open", "in_progress": "In Progress", "closed": "Closed"}
                raise HTTPException(
                    403,
                    f"This request is locked from editing after status \"{_labels.get(max_editable, max_editable)}\".",
                )
        # Validate No. of Records if being changed.
        if "number_of_profiles" in _sent_field_edits:
            n = _sent_field_edits["number_of_profiles"]
            if n is None or n == 0:
                raise HTTPException(400, "No. of Records must be greater than 0")
            if n < 0:
                raise HTTPException(400, "No. of Records must be greater than 0")
        # Apply each field, log per-field activity.
        for k, (new_val, label) in _EDIT_FIELDS.items():
            if new_val is None:
                continue
            old_val = t.get(k)
            if old_val == new_val:
                continue
            update[k] = new_val
            # Description is usually long — skip embedding old/new in activity detail.
            if k == "description":
                activity.append("Description updated")
            else:
                _old = old_val if old_val not in (None, "") else "—"
                activity.append(f"{label} changed from \"{_old}\" to \"{new_val}\"")
        if _attachment_edit:
            new_attachments = body.attachments if body.attachments is not None else t.get("attachments") or []
            update["attachments"] = new_attachments
            # Keep legacy single-attachment fields in sync with the first entry
            # so existing readers (email templates, CSV export) don't break.
            first = new_attachments[0] if new_attachments else {}
            update["attachment_path"] = body.attachment_path if body.attachment_path is not None else first.get("path")
            update["attachment_name"] = body.attachment_name if body.attachment_name is not None else first.get("filename")
            activity.append(f"Attachments updated ({len(new_attachments)} file(s))")

    if not update:
        raise HTTPException(400, "Nothing to update")
    update["updated_on"] = now_iso()
    await db.tickets.update_one({"id": ticket_id}, {"$set": update})
    for a in activity:
        await db.activity.insert_one({
            "id": str(uuid.uuid4()), "ticket_id": ticket_id, "action": "updated",
            "by_id": user["id"], "by_name": user["name"], "at": now_iso(), "detail": a
        })

    # Notify the request creator when the ticket transitions to Closed.
    # Driven by the `request_closed` email template (seeded in DEFAULT_TEMPLATES).
    if update.get("status") == "Closed" and t.get("status") != "Closed":
        try:
            creator = await db.contacts.find_one({"id": t.get("created_by_id")}) if t.get("created_by_id") else None
            to_email = (creator or {}).get("email")
            to_name = (creator or {}).get("name") or t.get("created_by_name") or "there"
            if to_email:
                await send_email(
                    db,
                    to_email=to_email,
                    to_name=to_name,
                    kind="request_closed",
                    subject="Request Closed",
                    body="<p>Your request has been closed.</p>",
                    related_id=ticket_id,
                    metadata={
                        "ticket_id": t.get("ticket_id") or ticket_id,
                        "subject": t.get("ticket_id") or "",
                        "closed_by": user.get("name") or "",
                        "closed_at": update["updated_on"],
                    },
                )
        except Exception as e:  # noqa: BLE001 — never block the API on a notification failure
            import logging as _l
            _l.getLogger(__name__).warning(f"request_closed email failed for ticket={ticket_id}: {e}")
        # In-app bell notification for the requester (idempotent per-transition)
        try:
            from inapp_notifications import notify_user_inapp
            if t.get("created_by_id"):
                await notify_user_inapp(
                    db,
                    user_id=t.get("created_by_id"),
                    kind="request_closed",
                    variables={
                        "ticket_id": t.get("ticket_id") or ticket_id,
                        "closed_by": user.get("name") or "",
                        "name": t.get("created_by_name") or "",
                    },
                    related_id=ticket_id,
                    related_type="ticket",
                    action_url=f"/admin/tickets/{ticket_id}",
                )
        except Exception:  # noqa: BLE001
            pass

    return await db.tickets.find_one({"id": ticket_id}, {"_id": 0})


@api_router.post("/tickets/bulk-assign")
async def bulk_assign(body: BulkAssign, user=Depends(get_current_user)):
    role = user["role"]
    if role not in ("Super Admin", "Admin", "DQ Team"):
        raise HTTPException(403, "Forbidden")
    if role == "DQ Team":
        assignee_id = user["id"]
        assignee_name = user["name"]
        # DQ self-assign must satisfy the eligibility rule as well.
        if not await _user_is_assignable(user["id"]):
            raise HTTPException(
                403,
                "You are not eligible for self-assignment. "
                "Ask an admin to grant Assign Requests to Self on your Permission Set.",
            )
    else:
        if not body.assigned_to:
            raise HTTPException(400, "assigned_to required")
        a = await db.contacts.find_one({"id": body.assigned_to})
        if not a:
            raise HTTPException(400, "Assignee not found")
        assignee_id = a["id"]; assignee_name = a["name"]
        # Eligibility guardrail — same rule as /contacts/assignable.
        if not await _user_is_assignable(assignee_id):
            raise HTTPException(
                400,
                "Selected user is not eligible for assignment. "
                "Grant Assign Requests to Self / Others via their Permission Set.",
            )
        # Admin: assignee must fall inside the Admin's assign scope.
        if role == "Admin":
            a_scope = await get_effective_scope(user, "profix", "ticket", "assign")
            if not a_scope:
                raise HTTPException(403, "No assign permission")
            if a_scope not in ("all", True):
                ctx = await get_user_scope_context(user)
                allowed = set(scope_to_id_filter(a_scope, ctx) or [])
                if assignee_id not in allowed:
                    raise HTTPException(403, "Assignee is outside your assign scope")

    # Pre-compute scope filter for Admin so we only touch tickets they can assign.
    admin_assign_allowed: Optional[set] = None
    if role == "Admin":
        a_scope = await get_effective_scope(user, "profix", "ticket", "assign")
        if a_scope not in ("all", True):
            ctx = await get_user_scope_context(user)
            admin_assign_allowed = set(scope_to_id_filter(a_scope, ctx) or [])

    success = 0
    for tid in body.ticket_ids:
        t = await db.tickets.find_one({"id": tid})
        if not t:
            continue
        if role == "DQ Team" and t.get("assigned_to_id"):
            continue
        if admin_assign_allowed is not None and not (
            t.get("created_by_id") in admin_assign_allowed
            or t.get("assigned_to_id") in admin_assign_allowed
        ):
            continue
        await db.tickets.update_one({"id": tid}, {"$set": {
            "assigned_to_id": assignee_id, "assigned_to_name": assignee_name, "updated_on": now_iso()
        }})
        await db.activity.insert_one({
            "id": str(uuid.uuid4()), "ticket_id": tid, "action": "assigned",
            "by_id": user["id"], "by_name": user["name"], "at": now_iso(),
            "detail": f"Assigned to {assignee_name}"
        })
        success += 1
    return {"assigned": success}


@api_router.post("/tickets/bulk-status")
async def bulk_status(body: BulkStatus, user=Depends(get_current_user)):
    role = user["role"]
    if role not in ("Super Admin", "Admin", "DQ Team"):
        raise HTTPException(403, "Forbidden")
    # Admin scope: pre-compute their edit-scoped id whitelist (or unrestricted).
    admin_edit_allowed: Optional[set] = None
    if role == "Admin":
        e_scope = await get_effective_scope(user, "profix", "ticket", "edit")
        if not e_scope:
            raise HTTPException(403, "No edit permission")
        if e_scope not in ("all", True):
            ctx = await get_user_scope_context(user)
            admin_edit_allowed = set(scope_to_id_filter(e_scope, ctx) or [])
    success = 0
    for tid in body.ticket_ids:
        t = await db.tickets.find_one({"id": tid})
        if not t:
            continue
        if role == "DQ Team" and t.get("assigned_to_id") != user["id"]:
            continue
        if admin_edit_allowed is not None and not (
            t.get("created_by_id") in admin_edit_allowed
            or t.get("assigned_to_id") in admin_edit_allowed
        ):
            continue
        if t.get("status") == body.status:
            continue
        await db.tickets.update_one({"id": tid}, {"$set": {"status": body.status, "updated_on": now_iso()}})
        await db.activity.insert_one({
            "id": str(uuid.uuid4()), "ticket_id": tid, "action": "updated",
            "by_id": user["id"], "by_name": user["name"], "at": now_iso(),
            "detail": f"Status changed from {t.get('status')} to {body.status}"
        })
        # Notify creator on Closed transition (same template as single-update path).
        if body.status == "Closed" and t.get("status") != "Closed":
            try:
                creator = await db.contacts.find_one({"id": t.get("created_by_id")}) if t.get("created_by_id") else None
                to_email = (creator or {}).get("email")
                to_name = (creator or {}).get("name") or t.get("created_by_name") or "there"
                if to_email:
                    await send_email(
                        db,
                        to_email=to_email,
                        to_name=to_name,
                        kind="request_closed",
                        subject="Request Closed",
                        body="<p>Your request has been closed.</p>",
                        related_id=tid,
                        metadata={
                            "ticket_id": t.get("ticket_id") or tid,
                            "subject": t.get("ticket_id") or "",
                            "closed_by": user.get("name") or "",
                            "closed_at": now_iso(),
                        },
                    )
            except Exception as e:  # noqa: BLE001
                import logging as _l
                _l.getLogger(__name__).warning(f"request_closed email failed for ticket={tid}: {e}")
            # In-app bell notification (same trigger, same template)
            try:
                from inapp_notifications import notify_user_inapp
                if t.get("created_by_id"):
                    await notify_user_inapp(
                        db,
                        user_id=t.get("created_by_id"),
                        kind="request_closed",
                        variables={
                            "ticket_id": t.get("ticket_id") or tid,
                            "closed_by": user.get("name") or "",
                            "name": t.get("created_by_name") or "",
                        },
                        related_id=tid,
                        related_type="ticket",
                        action_url=f"/admin/tickets/{tid}",
                    )
            except Exception:  # noqa: BLE001
                pass
        success += 1
    return {"updated": success}


# ---------- Comments & Activity ----------
@api_router.get("/tickets/{ticket_id}/activity")
async def get_activity(ticket_id: str, user=Depends(get_current_user)):
    items = await db.activity.find({"ticket_id": ticket_id}, {"_id": 0}).sort("at", -1).to_list(500)
    return items


@api_router.get("/tickets/{ticket_id}/comments")
async def get_comments(ticket_id: str, user=Depends(get_current_user)):
    items = await db.comments.find({"ticket_id": ticket_id}, {"_id": 0}).sort("at", 1).to_list(500)
    return items


@api_router.post("/tickets/{ticket_id}/comments")
async def add_comment(ticket_id: str, body: CommentCreate, user=Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()), "ticket_id": ticket_id,
        "by_id": user["id"], "by_name": user["name"],
        "content": body.content, "at": now_iso()
    }
    await db.comments.insert_one(doc)
    doc.pop("_id", None)
    await db.activity.insert_one({
        "id": str(uuid.uuid4()), "ticket_id": ticket_id, "action": "comment",
        "by_id": user["id"], "by_name": user["name"], "at": now_iso(),
        "detail": "Added a comment"
    })
    return doc


# ---------- Reopen ----------
@api_router.post("/tickets/{ticket_id}/reopen")
async def reopen_ticket(ticket_id: str, body: TicketReopen, user=Depends(get_current_user)):
    """Reopen a Closed ticket.

    Rules:
      - Ticket must exist and its current status must be "Closed".
      - Only the ticket creator (requester) OR Super Admin / Admin may reopen.
        Admins additionally must have "edit" scope over the ticket.
      - `reason` is required (min 5 chars after trimming, max 500).
      - Status transitions Closed → Open. Stamps `reopened_by_id/name/on`,
        stores the most-recent `reopen_reason`, and increments `reopen_count`.
      - Logs a single `action="reopened"` activity row carrying the reason.
    """
    reason = (body.reason or "").strip()
    if len(reason) < 5:
        raise HTTPException(400, "Please provide a reason (at least 5 characters).")
    if len(reason) > 500:
        raise HTTPException(400, "Reason must be 500 characters or fewer.")

    t = await db.tickets.find_one({"id": ticket_id})
    if not t:
        raise HTTPException(404, "Not found")
    # View-scope check first — hides existence for out-of-scope tickets.
    if not await _check_ticket_action_scope(user, t, "view"):
        raise HTTPException(404, "Not found")
    if t.get("status") != "Closed":
        raise HTTPException(400, "Only Closed requests can be reopened.")

    role = user.get("role")
    is_creator = t.get("created_by_id") == user.get("id")
    is_super = role == "Super Admin"
    # Permission gate:
    #   • Super Admin — always
    #   • Creator      — always (the requester can reopen their own request)
    #   • Others       — only if profix.ticket_detail.reopen is enabled in
    #                    their assigned permission set(s).
    if not (is_super or is_creator):
        fn_entry = await get_v3_function(user, "profix", "ticket_detail", "reopen")
        if not fn_entry or not fn_entry.get("enabled"):
            raise HTTPException(403, "Only the requester or an admin can reopen this request.")
    # Admins additionally must pass their edit scope on this ticket.
    if role == "Admin" and not is_creator and not await _check_ticket_action_scope(user, t, "edit"):
        raise HTTPException(403, "Edit scope does not cover this ticket")

    ts = now_iso()
    await db.tickets.update_one(
        {"id": ticket_id},
        {
            "$set": {
                "status": "Open",
                "reopen_reason": reason,
                "reopened_by_id": user.get("id"),
                "reopened_by_name": user.get("name"),
                "reopened_on": ts,
                "updated_on": ts,
            },
            "$inc": {"reopen_count": 1},
        },
    )
    await db.activity.insert_one({
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "action": "reopened",
        "by_id": user.get("id"),
        "by_name": user.get("name"),
        "at": ts,
        "detail": f"Request reopened. Reason: {reason}",
    })
    return await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
