"""Dashboard endpoints: stats, dq-performance, recent.

All ticket-backed widgets respect the caller's effective `profix.ticket.view`
scope (Phase 2 scope enforcement). Super Admin always gets unrestricted access.

Jul 2026 — ProfiX Dashboard now honors the Super-Admin-configured
`dashboard.profix.metrics_based_on` field ("created_by" | "assigned_to") on
the caller's Permission Set. When set to "assigned_to" the dashboard cards +
per-member "Team" stats use `assigned_to_id` as the primary owner field;
otherwise they use `created_by_id` (default).
"""
from typing import Optional

from fastapi import Depends, HTTPException

from core import api_router, db, get_current_user, require_role
from routers.tickets import _date_match, _ticket_view_filter
from routers.permissions_v3 import get_profix_dashboard_config


def _merge_query(base: dict, view_filter: dict) -> dict:
    """Combine a `base` Mongo query with the view-scope `view_filter`. Both can
    contain `$and` or `$or` clauses; we merge via `$and` to preserve semantics."""
    if not view_filter:
        return base
    if not base:
        return view_filter
    return {"$and": [base, view_filter]}


def _metrics_field(metrics_based_on: str) -> str:
    """Map "created_by" | "assigned_to" → the ticket document owner field."""
    return "assigned_to_id" if metrics_based_on == "assigned_to" else "created_by_id"


def _sanitize_metrics_override(v: Optional[str]) -> Optional[str]:
    if v in ("created_by", "assigned_to"):
        return v
    return None


@api_router.get("/dashboard/stats")
async def dashboard_stats(
    user=Depends(get_current_user),
    member_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    date_field: Optional[str] = "created_at",
    metrics_based_on: Optional[str] = None,
):
    # Resolve the caller's effective ProfiX dashboard config
    cfg = await get_profix_dashboard_config(user)
    # Client override (belt-and-braces) — only honored if it matches a valid
    # option. Otherwise fall back to the Permission-Set-configured value.
    metric = _sanitize_metrics_override(metrics_based_on) or cfg["metrics_based_on"]
    access_level = cfg["access_level"]
    field = _metrics_field(metric)

    role = user["role"]
    base: dict = {}

    # For Super Admin OR access_level == "overall" → no owner filter (org-wide).
    # Otherwise apply an owner filter based on the selected metrics field.
    if role == "Super Admin" or access_level == "overall":
        # Super-Admin/Overall may still drill into a specific member from the UI
        # (via ?member_id=...). When they do, we filter by the chosen owner field.
        if member_id:
            base[field] = member_id
    elif access_level == "manager":
        # Manager dashboard — restricted to a specific member (when drilling in)
        # or unrestricted-inside-team otherwise. Team restriction happens via
        # the view_filter layer (ticket.view scope=team).
        if member_id:
            base[field] = member_id
    else:
        # Individual (or legacy roles): the user only sees their OWN tickets,
        # keyed by the configured owner field.
        base[field] = user["id"]

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
    return {
        "total": total,
        "open": open_c,
        "in_progress": inprog,
        "closed": closed,
        # Echo the metric back so the client can render helper labels/tooltips
        # if needed. Never affects UI layout.
        "metrics_based_on": metric,
    }


async def _user_team_ids(user_id: str) -> list:
    """Return the list of team ids that `user_id` is a MEMBER or MANAGER of."""
    teams = await db.teams.find(
        {"$or": [{"member_ids": user_id}, {"manager_ids": user_id}]},
        {"_id": 0, "id": 1, "member_ids": 1, "manager_ids": 1},
    ).to_list(200)
    return teams


@api_router.get("/dashboard/dq-performance")
async def dq_performance(
    user=Depends(require_role("Super Admin", "Admin")),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    date_field: Optional[str] = "created_at",
    metrics_based_on: Optional[str] = None,
):
    # Resolve the caller's effective ProfiX dashboard config (metric + access level).
    cfg = await get_profix_dashboard_config(user)
    metric = _sanitize_metrics_override(metrics_based_on) or cfg["metrics_based_on"]
    access_level = cfg["access_level"]
    field = _metrics_field(metric)

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
        # v3 shape: view is a dict {enabled, visible, scope}
        if isinstance(val, dict) and val.get("enabled") and val.get("visible"):
            return True
        # Additionally: v3 "all_requests" page under profix grants ticket visibility.
        pages = ((pset.get("modules") or {}).get("profix") or {}).get("pages") or {}
        for page_key in ("all_requests", "open_requests", "unassigned"):
            pg = pages.get(page_key) or {}
            view = pg.get("view") or {}
            if view.get("enabled") and view.get("visible"):
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

    # Manager scope — restrict the Team section to the CURRENT actor's own
    # team members (union across all teams they manage or are a member of).
    # Super Admin / Overall access-level → no restriction.
    if user.get("role") != "Super Admin" and access_level == "manager":
        my_teams = await _user_team_ids(user["id"])
        allowed_ids: set = set()
        for t in my_teams:
            # If the actor is a MANAGER of the team, include all team members
            # (excluding the actor themselves is optional — matches the spec's
            # "Team Members who have access to ProfiX").
            if user["id"] in (t.get("manager_ids") or []):
                for mid in (t.get("member_ids") or []):
                    allowed_ids.add(mid)
                for mid in (t.get("manager_ids") or []):
                    allowed_ids.add(mid)
        # Exclude the actor themselves from the Team section so it lists team
        # MEMBERS, not the manager themselves.
        allowed_ids.discard(user["id"])
        members = [m for m in members if m.get("id") in allowed_ids]
    elif user.get("role") != "Super Admin" and access_level == "individual":
        # Individual dashboard has no Team section — return empty.
        members = []

    date_match = _date_match(date_from, date_to, date_field)
    view_filter = await _ticket_view_filter(user)
    out = []
    for m in members:
        base = {field: m["id"], **date_match}
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
    metrics_based_on: Optional[str] = None,
):
    # Honor the same metric semantics for the Recent Updates strip so that
    # an "Assigned To" dashboard doesn't show requests the caller is not
    # personally involved with when they are on an Individual view.
    cfg = await get_profix_dashboard_config(user)
    metric = _sanitize_metrics_override(metrics_based_on) or cfg["metrics_based_on"]
    access_level = cfg["access_level"]
    field = _metrics_field(metric)

    role = user["role"]
    base: dict = {}

    if role == "Super Admin" or access_level in ("overall", "manager"):
        # No owner filter — Recent Updates spans the entire (scope-filtered) org.
        pass
    else:
        # Individual view — only user's own tickets under the selected field.
        if field == "assigned_to_id":
            base["$or"] = [
                {"assigned_to_id": user["id"]},
                {"$and": [{"assigned_to_id": {"$in": [None, ""]}}, {"status": "Open"}]},
            ]
        else:
            base["created_by_id"] = user["id"]

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
