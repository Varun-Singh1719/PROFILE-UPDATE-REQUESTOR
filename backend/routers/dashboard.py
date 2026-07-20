"""Dashboard endpoints: stats, dq-performance, recent.

All ticket-backed widgets respect the caller's effective `profix.ticket.view`
scope (Phase 2 scope enforcement). Super Admin always gets unrestricted access.
"""
from typing import Optional

from fastapi import Depends, HTTPException

from core import api_router, db, get_current_user, require_role
from routers.tickets import _date_match, _ticket_view_filter


def _merge_query(base: dict, view_filter: dict) -> dict:
    """Combine a `base` Mongo query with the view-scope `view_filter`. Both can
    contain `$and` or `$or` clauses; we merge via `$and` to preserve semantics."""
    if not view_filter:
        return base
    if not base:
        return view_filter
    return {"$and": [base, view_filter]}


@api_router.get("/dashboard/stats")
async def dashboard_stats(
    user=Depends(get_current_user),
    member_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    date_field: Optional[str] = "created_at",
):
    role = user["role"]
    base = {}
    if role == "Research":
        base["created_by_id"] = user["id"]
    elif role == "DQ Team":
        base["assigned_to_id"] = user["id"]
    elif role in ("Super Admin", "Admin") and member_id:
        base["assigned_to_id"] = member_id
    base = {**base, **_date_match(date_from, date_to, date_field)}

    # Scope enforcement: layer on the user's effective profix.ticket.view scope.
    view_filter = await _ticket_view_filter(user)
    base = _merge_query(base, view_filter)

    async def cnt(extra):
        q = _merge_query(base, extra) if "$and" in base else {**base, **extra}
        return await db.tickets.count_documents(q)

    total = await cnt({})
    open_c = await cnt({"status": "Open"})
    inprog = await cnt({"status": "In Progress"})
    closed = await cnt({"status": "Closed"})
    return {"total": total, "open": open_c, "in_progress": inprog, "closed": closed}


@api_router.get("/dashboard/dq-performance")
async def dq_performance(
    user=Depends(require_role("Super Admin", "Admin")),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    date_field: Optional[str] = "created_at",
):
    # v3 has no "DQ Team" role anymore (legacy collapse); read from a permissive
    # filter so Admin still sees the historical performance leaderboard.
    members = await db.contacts.find(
        {"role": {"$in": ["Super Admin", "Admin", "DQ Team"]}, "status": "Active"},
        {"_id": 0, "password_hash": 0, "password_encrypted": 0},
    ).to_list(500)

    # Filter down to members who currently have Profix (ticket view) access
    # via their effective permissions. Super Admins pass through automatically.
    # Pre-fetch permission sets once (perf: avoid N per-user DB roundtrips).
    all_set_ids: set = set()
    for m in members:
        for sid in (m.get("permission_set_ids") or []):
            all_set_ids.add(sid)
    sets_by_id: dict = {}
    if all_set_ids:
        set_docs = await db.permission_sets.find(
            {"id": {"$in": list(all_set_ids)}}, {"_id": 0, "id": 1, "modules": 1}
        ).to_list(500)
        sets_by_id = {s["id"]: s for s in set_docs}

    def _set_grants_profix_view(pset: dict) -> bool:
        val = ((pset.get("modules") or {}).get("profix") or {}).get("ticket", {}).get("view")
        if val is True:
            return True
        if isinstance(val, str) and val in ("all", "team", "respective"):
            return True
        return False

    allowed_members = []
    for m in members:
        if m.get("role") == "Super Admin":
            allowed_members.append(m)
            continue
        set_ids = m.get("permission_set_ids") or []
        if any(_set_grants_profix_view(sets_by_id.get(sid, {})) for sid in set_ids):
            allowed_members.append(m)
    members = allowed_members

    date_match = _date_match(date_from, date_to, date_field)
    view_filter = await _ticket_view_filter(user)
    out = []
    for m in members:
        base = {"assigned_to_id": m["id"], **date_match}
        base = _merge_query(base, view_filter)

        agg_open = await db.tickets.aggregate([
            {"$match": _merge_query(base, {"status": "Open"})},
            {"$group": {"_id": None, "total": {"$sum": "$number_of_profiles"}}}
        ]).to_list(1)
        agg_ip = await db.tickets.aggregate([
            {"$match": _merge_query(base, {"status": "In Progress"})},
            {"$group": {"_id": None, "total": {"$sum": "$number_of_profiles"}}}
        ]).to_list(1)
        open_profiles = agg_open[0]["total"] if agg_open else 0
        in_progress_profiles = agg_ip[0]["total"] if agg_ip else 0
        out.append({
            "id": m["id"], "name": m["name"], "email": m["email"],
            "total": await db.tickets.count_documents(base),
            "open": await db.tickets.count_documents(_merge_query(base, {"status": "Open"})),
            "in_progress": await db.tickets.count_documents(_merge_query(base, {"status": "In Progress"})),
            "closed": await db.tickets.count_documents(_merge_query(base, {"status": "Closed"})),
            "open_profiles": open_profiles,
            "in_progress_profiles": in_progress_profiles,
            "profiles_assigned": open_profiles + in_progress_profiles,
        })
    return out


@api_router.get("/dashboard/recent")
async def dashboard_recent(
    user=Depends(get_current_user),
    kind: str = "updated",
    limit: int = 8,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    date_field: Optional[str] = "created_at",
):
    role = user["role"]
    base = {}
    if role == "Research":
        base["created_by_id"] = user["id"]
    elif role == "DQ Team":
        base["$or"] = [
            {"assigned_to_id": user["id"]},
            {"$and": [{"assigned_to_id": {"$in": [None, ""]}}, {"status": "Open"}]},
        ]
    base = {**base, **_date_match(date_from, date_to, date_field)}
    # Scope enforcement
    view_filter = await _ticket_view_filter(user)
    base = _merge_query(base, view_filter)
    sort_field = "created_on" if kind == "new" else "updated_on"
    items = await db.tickets.find(base, {"_id": 0}).sort(sort_field, -1).to_list(limit)
    return items


@api_router.get("/")
async def root():
    return {"message": "Ticketing System API"}
