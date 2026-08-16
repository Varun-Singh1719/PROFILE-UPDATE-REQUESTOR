"""Permissions v3 — Redesigned matrix API.

Storage
-------
v3 permission sets live in the same `permission_sets` collection but carry
`version = 3` and use a richer per-feature value shape:

    {
      "id": "pset-<uuid>",
      "seq_no": <int>,
      "title": "…",
      "description": "…",
      "version": 3,
      "modules": {
        "profix": {
          "features": {
            "dashboard": {
              "view":  {"enabled": true,  "visible": true,  "scope": "team"},
              "edit":  {"enabled": false, "visible": true,  "scope": null}
            },
            ...
          },
          "actions": {
            "create": {"enabled": true, "visible": true, "scope": "team"},
            ...
          }
        },
        "desk_booking": { ... }
      },
      "created_on": ISO, "created_by": <actor>,
      "updated_on": ISO, "updated_by": <actor>,
    }

Endpoints
---------
GET  /api/permissions/schema/v3         — catalog (modules, features, actions)
GET  /api/permission-sets/v3            — list v3 sets
GET  /api/permission-sets/v3/{id}       — get one
POST /api/permission-sets/v3            — create
PUT  /api/permission-sets/v3/{id}       — replace/update
DELETE /api/permission-sets/v3/{id}     — delete
GET  /api/permissions/audit             — audit-log rows scoped to permission changes
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core import (
    api_router, db, log_audit, now_iso, require_role, get_current_user,
    PERMISSION_MODULES_V3, SCOPE_V3_VALUES,
)


# Scope precedence used when merging multiple assigned permission sets.
# Broader scope wins.
_SCOPE_RANK = {None: 0, "individual": 1, "team": 2, "overall": 3}

# max_editable_status precedence (broader wins) — used on
# profix.ticket_detail.edit to lock the "Edit" action once a ticket passes a
# given status. "closed" means the ticket is editable in any status.
_MAX_EDITABLE_STATUS_VALUES = ("open", "in_progress", "closed")
_MAX_EDITABLE_STATUS_RANK = {None: 0, "open": 1, "in_progress": 2, "closed": 3}

# Ticket-status ordinal used to compare a ticket's current status against a
# permission set's max_editable_status. Kept in sync with the TicketStatus
# enum below.
TICKET_STATUS_RANK = {"Open": 1, "In Progress": 2, "Closed": 3}


def _sanitize_max_editable_status(v: Any) -> Optional[str]:
    if v in _MAX_EDITABLE_STATUS_VALUES:
        return v
    return None


def _merge_max_editable_status(a: Optional[str], b: Optional[str]) -> Optional[str]:
    ra = _MAX_EDITABLE_STATUS_RANK.get(a, 0)
    rb = _MAX_EDITABLE_STATUS_RANK.get(b, 0)
    return a if ra >= rb else b

# Dashboard access-level precedence — higher wins when merging.
_DASHBOARD_ACCESS_RANK = {None: 0, "individual": 1, "manager": 2, "overall": 3}
_DASHBOARD_ACCESS_VALUES = ("individual", "manager", "overall")

# Dashboard metrics-based-on precedence (Jul 2026, ProfiX-only). When merging
# multiple assigned permission sets, "assigned_to" wins over "created_by",
# which wins over None. Only meaningful for the `profix` dashboard page.
_DASHBOARD_METRICS_RANK = {None: 0, "created_by": 1, "assigned_to": 2}
_DASHBOARD_METRICS_VALUES = ("created_by", "assigned_to")


def _sanitize_access_level(v: Any) -> Optional[str]:
    if v in _DASHBOARD_ACCESS_VALUES:
        return v
    return None


def _merge_access_level(a: Optional[str], b: Optional[str]) -> Optional[str]:
    """Pick the higher-ranked dashboard access level."""
    ra = _DASHBOARD_ACCESS_RANK.get(a, 0)
    rb = _DASHBOARD_ACCESS_RANK.get(b, 0)
    return a if ra >= rb else b


def _sanitize_metrics_based_on(v: Any) -> Optional[str]:
    if v in _DASHBOARD_METRICS_VALUES:
        return v
    return None


def _merge_metrics_based_on(a: Optional[str], b: Optional[str]) -> Optional[str]:
    ra = _DASHBOARD_METRICS_RANK.get(a, 0)
    rb = _DASHBOARD_METRICS_RANK.get(b, 0)
    return a if ra >= rb else b


def _merge_rw(a: Optional[dict], b: Optional[dict]) -> dict:
    """Merge two {enabled, visible, scope[, max_editable_status]} triples using
    OR semantics.

    - `enabled` = OR of both
    - `visible` = OR of both (a function is visible if ANY assigned set marks it visible)
    - `scope`   = broader wins (overall > team > individual > None)
    - `max_editable_status` (edit-only field) — broader wins
      (closed > in_progress > open > None). Only surfaces when at least one
      side carries it.
    """
    a = a or {}
    b = b or {}
    scope_a = a.get("scope")
    scope_b = b.get("scope")
    scope = scope_a if _SCOPE_RANK.get(scope_a, 0) >= _SCOPE_RANK.get(scope_b, 0) else scope_b
    out = {
        "enabled": bool(a.get("enabled")) or bool(b.get("enabled")),
        "visible": bool(a.get("visible")) or bool(b.get("visible")),
        "scope": scope,
    }
    max_a = a.get("max_editable_status")
    max_b = b.get("max_editable_status")
    if max_a is not None or max_b is not None:
        out["max_editable_status"] = _merge_max_editable_status(max_a, max_b)
    return out


def _merge_modules(target: Dict[str, dict], src: Dict[str, dict]) -> None:
    """Merge `src` v3 modules dict into `target` in-place."""
    for mkey, mdata in (src or {}).items():
        t_mod = target.setdefault(mkey, {"pages": {}})
        t_pages = t_mod.setdefault("pages", {})
        for pkey, pdata in ((mdata or {}).get("pages") or {}).items():
            # Dashboard module — merge access_level with highest-wins semantics
            if mkey == "dashboard":
                t_page = t_pages.setdefault(pkey, {"access_level": None})
                incoming = _sanitize_access_level((pdata or {}).get("access_level"))
                t_page["access_level"] = _merge_access_level(
                    t_page.get("access_level"), incoming
                )
                # ProfiX-only: merge the "metrics_based_on" configurable.
                if pkey == "profix":
                    incoming_metrics = _sanitize_metrics_based_on(
                        (pdata or {}).get("metrics_based_on")
                    )
                    t_page["metrics_based_on"] = _merge_metrics_based_on(
                        t_page.get("metrics_based_on"), incoming_metrics
                    )
                continue
            # Everything else — merge the {view, edit, functions} triples
            t_page = t_pages.setdefault(pkey, {"view": {}, "edit": {}, "functions": {}})
            t_page["view"] = _merge_rw(t_page.get("view"), pdata.get("view"))
            t_page["edit"] = _merge_rw(t_page.get("edit"), pdata.get("edit"))
            t_fns = t_page.setdefault("functions", {})
            for fkey, fdata in (pdata.get("functions") or {}).items():
                t_fns[fkey] = _merge_rw(t_fns.get(fkey), fdata)


# --------------------------------------------------------------------------- #
# Catalog                                                                      #
# --------------------------------------------------------------------------- #

@api_router.get("/permissions/schema/v3")
async def permissions_schema_v3(user=Depends(get_current_user)):
    """Return the v3 catalog. UI uses this to render the matrix."""
    return {
        "modules": PERMISSION_MODULES_V3,
        "scope_values": list(SCOPE_V3_VALUES),
    }


# --------------------------------------------------------------------------- #
# Value shape helpers                                                          #
# --------------------------------------------------------------------------- #

def _empty_rw() -> dict:
    return {"enabled": False, "visible": True, "scope": None}


def _sanitize_scope(v: Any) -> Optional[str]:
    if v in SCOPE_V3_VALUES:
        return v
    return None


def _sanitize_rw(v: Any, scoped: bool = True, has_status_lock: bool = False) -> dict:
    """Sanitize a {enabled, visible, scope[, max_editable_status]} triple."""
    out = _empty_rw()
    if not isinstance(v, dict):
        return out
    out["enabled"] = bool(v.get("enabled"))
    # `visible` defaults to True (rows are shown by default) — the toggle
    # HIDES a row when set to False.
    if "visible" in v:
        out["visible"] = bool(v.get("visible"))
    out["scope"] = _sanitize_scope(v.get("scope")) if scoped else None
    if has_status_lock:
        out["max_editable_status"] = _sanitize_max_editable_status(v.get("max_editable_status"))
    return out


def _normalize_v3_modules(modules: Any) -> Dict[str, dict]:
    """Validate & normalize the modules tree against the v3 catalog.

    Also transparently re-maps legacy keys that lived under ``profix`` before
    the "Manage" module was split out (Jul 6, 2026). E.g. an incoming payload
    with ``profix.employees.…`` is rewritten to ``manage.employees.…`` so
    existing permission sets keep working after the catalog reshuffle.

    New shape (Aug 2026):
      modules[<mkey>].pages[<pkey>] = {
        view: {enabled, visible, scope},
        edit: {enabled, visible, scope},
        functions: { <fkey>: {enabled, visible, scope} }
      }
    """
    # Pages that migrated from profix → manage (Jul 6, 2026)
    _PROFIX_TO_MANAGE_PAGES = {
        "employees", "teams", "notifications", "email_templates",
        "reports", "audit_logs", "settings",
    }

    # First pass — key remap: hoist any legacy profix.<manage_page> into manage.<page>
    remapped_input: Dict[str, Any] = {}
    for mkey, mdata in (modules or {}).items():
        if mkey == "profix" and isinstance(mdata, dict):
            pages_src = (mdata or {}).get("pages") or {}
            keep_pages: Dict[str, Any] = {}
            hoist_pages: Dict[str, Any] = {}
            for pkey, pdata in pages_src.items():
                if pkey in _PROFIX_TO_MANAGE_PAGES:
                    hoist_pages[pkey] = pdata
                else:
                    keep_pages[pkey] = pdata
            if keep_pages:
                remapped_input["profix"] = {"pages": keep_pages}
            if hoist_pages:
                existing_manage = (modules or {}).get("manage") or {}
                existing_pages = (existing_manage.get("pages") if isinstance(existing_manage, dict) else {}) or {}
                merged = {**existing_pages, **hoist_pages}  # incoming manage overrides
                remapped_input["manage"] = {"pages": merged}
        elif mkey == "manage" and "manage" in remapped_input:
            # Already merged above; skip (avoid overwriting the merge result)
            continue
        else:
            remapped_input[mkey] = mdata

    catalog = {m["key"]: m for m in PERMISSION_MODULES_V3}
    out: Dict[str, dict] = {}
    for mkey, mdata in remapped_input.items():
        if mkey not in catalog:
            continue
        catalog_m = catalog[mkey]
        valid_pages = {p["key"]: p for p in catalog_m["pages"]}

        # Special-case: dashboard module — each page carries a single access_level
        # ("individual" | "manager" | "overall"), not the view/edit/functions triple.
        if catalog_m.get("type") == "access_level":
            raw_pages = (mdata or {}).get("pages") or {}
            pages_out: Dict[str, dict] = {}
            for pkey, pdata in raw_pages.items():
                if pkey not in valid_pages:
                    continue
                pdata = pdata if isinstance(pdata, dict) else {}
                lvl = _sanitize_access_level(pdata.get("access_level"))
                page_entry: Dict[str, Any] = {"access_level": lvl}
                # ProfiX-only: persist Super-Admin's Dashboard-Metrics-Based-On choice.
                if pkey == "profix":
                    metrics = _sanitize_metrics_based_on(pdata.get("metrics_based_on"))
                    page_entry["metrics_based_on"] = metrics
                pages_out[pkey] = page_entry
            if pages_out:
                out[mkey] = {"pages": pages_out}
            continue

        raw_pages = (mdata or {}).get("pages") or {}
        pages_out: Dict[str, dict] = {}
        for pkey, pdata in raw_pages.items():
            if pkey not in valid_pages:
                continue
            pdata = pdata if isinstance(pdata, dict) else {}
            valid_functions = {f["key"]: f for f in (valid_pages[pkey].get("functions") or [])}
            fn_out: Dict[str, dict] = {}
            for fkey, fdata in (pdata.get("functions") or {}).items():
                if fkey not in valid_functions:
                    continue
                scoped = bool(valid_functions[fkey].get("scoped", False))
                has_lock = bool(valid_functions[fkey].get("has_status_lock", False))
                fn_out[fkey] = _sanitize_rw(fdata, scoped=scoped, has_status_lock=has_lock)
            pages_out[pkey] = {
                "view": _sanitize_rw(pdata.get("view")),
                "edit": _sanitize_rw(pdata.get("edit")),
                "functions": fn_out,
            }

        if pages_out:
            out[mkey] = {"pages": pages_out}
    return out


# --------------------------------------------------------------------------- #
# Pydantic input                                                               #
# --------------------------------------------------------------------------- #

class PermissionSetV3In(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = ""
    modules: Optional[dict] = None
    copied_from_id: Optional[str] = None  # optional lineage


# --------------------------------------------------------------------------- #
# Endpoints                                                                    #
# --------------------------------------------------------------------------- #

@api_router.get("/permission-sets-v3")
async def list_v3_sets(
    user=Depends(get_current_user),  # deferred v3 check inside — see below
    q: Optional[str] = Query(None, description="Search by title/description"),
    created_by: Optional[str] = Query(None, description="Comma-separated user ids"),
    updated_by: Optional[str] = Query(None, description="Comma-separated user ids"),
    created_from: Optional[str] = Query(None, description="YYYY-MM-DD or ISO"),
    created_to: Optional[str] = Query(None, description="YYYY-MM-DD or ISO"),
    updated_from: Optional[str] = Query(None, description="YYYY-MM-DD or ISO"),
    updated_to: Optional[str] = Query(None, description="YYYY-MM-DD or ISO"),
    modules: Optional[str] = Query(None, description="Comma-separated module keys"),
    sort_by: Optional[str] = Query("updated_on", description="seq_no|title|created_on|updated_on|assigned_users"),
    sort_dir: Optional[str] = Query("desc", description="asc|desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    status: Optional[str] = Query("active", description="Comma-separated: active,deleted"),
    include_deleted: bool = Query(False),
):
    """Paginated list of v3 permission sets with filters + assigned-user counts.

    Status filter (default = "active"):
      - "active" — only sets with no `deleted_at`
      - "deleted" — only soft-deleted sets
      - "active,deleted" (or both) — everything
    `include_deleted=true` is a legacy alias for status="active,deleted".

    Response: `{items: [...], total, page, page_size}`.
    Each item is enriched with `assigned_users_count`.
    """
    # v3-permission gate: only users with manage.permissions.view can list sets.
    # (Defined below in this file; call via the module-level helper.)
    entry = await get_v3_page_view(user, "manage", "permissions")
    if not entry or not entry.get("enabled") or not entry.get("visible"):
        raise HTTPException(403, "Access denied to manage.permissions")

    query: Dict[str, Any] = {"version": 3}

    # Normalise status → set of {"active", "deleted"}
    status_tokens = {s.strip().lower() for s in (status or "").split(",") if s.strip()}
    if include_deleted or {"active", "deleted"}.issubset(status_tokens):
        pass  # no deleted_at filter
    elif "deleted" in status_tokens and "active" not in status_tokens:
        query["deleted_at"] = {"$nin": [None]}  # only soft-deleted
    else:
        # Default & "active" — exclude soft-deleted
        query["deleted_at"] = {"$in": [None]}

    if q:
        q_clean = q.strip().lstrip("#").strip()
        or_clauses = [
            {"title":       {"$regex": q_clean, "$options": "i"}},
            {"description": {"$regex": q_clean, "$options": "i"}},
        ]
        if q_clean.isdigit():
            or_clauses.append({"seq_no": int(q_clean)})
            or_clauses.append({"numeric_id": int(q_clean)})
        query["$or"] = or_clauses

    def _split(v):
        return [x.strip() for x in (v or "").split(",") if x.strip()]

    cb_ids = _split(created_by)
    if cb_ids:
        query["created_by.id"] = {"$in": cb_ids}
    ub_ids = _split(updated_by)
    if ub_ids:
        query["updated_by.id"] = {"$in": ub_ids}

    date_cond: Dict[str, Any] = {}
    if created_from:
        date_cond["$gte"] = created_from
    if created_to:
        date_cond["$lte"] = created_to if "T" in created_to else f"{created_to}T23:59:59.999999+00:00"
    if date_cond:
        query["created_on"] = date_cond

    upd_cond: Dict[str, Any] = {}
    if updated_from:
        upd_cond["$gte"] = updated_from
    if updated_to:
        upd_cond["$lte"] = updated_to if "T" in updated_to else f"{updated_to}T23:59:59.999999+00:00"
    if upd_cond:
        query["updated_on"] = upd_cond

    mod_keys = _split(modules)
    if mod_keys:
        # Match sets that include ANY of the selected modules (OR semantics).
        query["$and"] = query.get("$and", []) + [
            {"$or": [{f"modules.{m}": {"$exists": True}} for m in mod_keys]},
        ]

    # Sort direction
    direction = -1 if (sort_dir or "desc").lower() != "asc" else 1
    sort_field = {
        "seq_no": "seq_no",
        "numeric_id": "seq_no",
        "id": "seq_no",
        "title": "title",
        "name": "title",
        "created_on": "created_on",
        "updated_on": "updated_on",
    }.get((sort_by or "updated_on").lower(), "updated_on")

    total = await db.permission_sets.count_documents(query)
    skip = (page - 1) * page_size

    cursor = db.permission_sets.find(query, {"_id": 0}).sort(sort_field, direction).skip(skip).limit(page_size)
    docs = await cursor.to_list(page_size)

    # Enrich with assigned users count (from contacts.permission_set_ids)
    set_ids = [d.get("id") for d in docs if d.get("id")]
    counts: Dict[str, int] = {sid: 0 for sid in set_ids}
    if set_ids:
        pipeline = [
            {"$match": {"permission_set_ids": {"$in": set_ids}}},
            {"$unwind": "$permission_set_ids"},
            {"$match": {"permission_set_ids": {"$in": set_ids}}},
            {"$group": {"_id": "$permission_set_ids", "n": {"$sum": 1}}},
        ]
        async for row in db.contacts.aggregate(pipeline):
            counts[row["_id"]] = int(row.get("n") or 0)

    for d in docs:
        d["assigned_users_count"] = counts.get(d.get("id"), 0)

    # Client-side sort by assigned_users if requested (post-enrichment)
    if (sort_by or "").lower() in ("assigned_users", "users", "users_count"):
        docs.sort(key=lambda x: x.get("assigned_users_count", 0), reverse=(direction == -1))

    return {"items": docs, "total": total, "page": page, "page_size": page_size}


@api_router.get("/permission-sets-v3/filter-options")
async def list_v3_filter_options(user=Depends(get_current_user)):
    """Distinct creators/updaters + available modules — used to populate the
    filter dropdowns on the Permission Sets tab. Includes historical users from
    soft-deleted sets so filters remain useful when Status=Deleted."""
    entry = await get_v3_page_view(user, "manage", "permissions")
    if not entry or not entry.get("enabled") or not entry.get("visible"):
        raise HTTPException(403, "Access denied to manage.permissions")
    creators_map: Dict[str, dict] = {}
    updaters_map: Dict[str, dict] = {}
    modules_present: set = set()

    async for doc in db.permission_sets.find(
        {"version": 3},
        {"_id": 0, "created_by": 1, "updated_by": 1, "modules": 1},
    ):
        cb = doc.get("created_by") or {}
        if cb.get("id") and cb["id"] not in creators_map:
            creators_map[cb["id"]] = {"id": cb["id"], "name": cb.get("name") or cb.get("email"), "email": cb.get("email")}
        ub = doc.get("updated_by") or {}
        if ub.get("id") and ub["id"] not in updaters_map:
            updaters_map[ub["id"]] = {"id": ub["id"], "name": ub.get("name") or ub.get("email"), "email": ub.get("email")}
        for m in (doc.get("modules") or {}).keys():
            modules_present.add(m)

    module_catalog = {m["key"]: m for m in PERMISSION_MODULES_V3}
    modules_out = [
        {"key": k, "label": (module_catalog.get(k) or {}).get("label") or k.replace("_", " ").title()}
        for k in sorted(modules_present)
    ]

    return {
        "created_by": sorted(creators_map.values(), key=lambda x: (x.get("name") or "").lower()),
        "updated_by": sorted(updaters_map.values(), key=lambda x: (x.get("name") or "").lower()),
        "modules": modules_out,
    }


@api_router.get("/permission-sets-v3/{pset_id}")
async def get_v3_set(pset_id: str, user=Depends(get_current_user)):
    entry = await get_v3_page_view(user, "manage", "permissions")
    if not entry or not entry.get("enabled") or not entry.get("visible"):
        raise HTTPException(403, "Access denied to manage.permissions")
    doc = await db.permission_sets.find_one({"id": pset_id, "version": 3}, {"_id": 0})
    if not doc:
        # Try to migrate a legacy set on the fly so the UI can still open it
        legacy = await db.permission_sets.find_one({"id": pset_id}, {"_id": 0})
        if legacy:
            return _migrate_legacy_to_v3(legacy)
        raise HTTPException(404, "Permission set not found")
    # Re-normalize modules so pre-Jul-2026 sets (where Manage pages lived under
    # profix) surface under the new `manage` module without any DB migration.
    doc["modules"] = _normalize_v3_modules(doc.get("modules") or {})
    return doc


async def _next_seq() -> int:
    last = await db.permission_sets.find_one(
        {}, {"_id": 0, "seq_no": 1, "numeric_id": 1}, sort=[("seq_no", -1)],
    )
    if not last:
        last = await db.permission_sets.find_one(
            {}, {"_id": 0, "numeric_id": 1}, sort=[("numeric_id", -1)],
        )
    return int((last or {}).get("seq_no") or (last or {}).get("numeric_id") or 0) + 1


def _actor(user: dict) -> dict:
    return {"id": user.get("id"), "email": user.get("email"), "name": user.get("name")}


def _validate_profix_dashboard_metric(modules: dict) -> None:
    """Enforce: when the ProfiX Dashboard is granted an access level, a
    Dashboard Metric ("created_by" | "assigned_to") MUST be selected — the
    dashboard cards + team stats are computed on this field, so it can't be
    left unset. Raises 400 otherwise. `modules` must already be normalized."""
    profix = (((modules or {}).get("dashboard") or {}).get("pages") or {}).get("profix") or {}
    access = profix.get("access_level")
    metric = profix.get("metrics_based_on")
    if access and metric not in ("created_by", "assigned_to"):
        raise HTTPException(
            400,
            "Select a Dashboard Metric (Created By / Assigned To) for the ProfiX Dashboard — it is required when a dashboard access level is granted.",
        )


@api_router.post("/permission-sets-v3")
async def create_v3_set(body: PermissionSetV3In, user=Depends(require_role("Super Admin"))):
    modules = _normalize_v3_modules(body.modules or {})
    _validate_profix_dashboard_metric(modules)
    seq = await _next_seq()
    doc = {
        "id": f"pset-{uuid.uuid4()}",
        "seq_no": seq,
        "numeric_id": seq,   # keep legacy unique-index happy
        "title": body.title.strip(),
        "description": (body.description or "").strip(),
        "version": 3,
        "modules": modules,
        "created_on": now_iso(),
        "created_by": _actor(user),
        "updated_on": now_iso(),
        "updated_by": _actor(user),
        "copied_from_id": body.copied_from_id,
        "deleted_at": None,
        "deleted_by": None,
    }
    await db.permission_sets.insert_one({**doc})
    doc.pop("_id", None)
    await log_audit(
        actor=user, action="permission_set.create", resource="permission_set",
        resource_id=doc["id"],
        detail=f"Created permission set '{doc['title']}'",
        metadata={"next": {"title": doc["title"], "modules": modules}},
    )
    return doc


@api_router.put("/permission-sets-v3/{pset_id}")
async def update_v3_set(
    pset_id: str, body: PermissionSetV3In, user=Depends(require_role("Super Admin")),
):
    existing = await db.permission_sets.find_one({"id": pset_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Permission set not found")
    if existing.get("deleted_at"):
        raise HTTPException(400, "Cannot edit a deleted permission set")

    modules = _normalize_v3_modules(body.modules or {})
    _validate_profix_dashboard_metric(modules)
    updates = {
        "title": body.title.strip(),
        "description": (body.description or "").strip(),
        "version": 3,
        "modules": modules,
        "updated_on": now_iso(),
        "updated_by": _actor(user),
    }
    await db.permission_sets.update_one({"id": pset_id}, {"$set": updates})
    fresh = await db.permission_sets.find_one({"id": pset_id}, {"_id": 0})
    await log_audit(
        actor=user, action="permission_set.update", resource="permission_set",
        resource_id=pset_id,
        detail=f"Updated permission set '{fresh.get('title')}'",
        metadata={
            "previous": {
                "title": existing.get("title"),
                "modules": existing.get("modules") or {},
                "version": existing.get("version"),
            },
            "next": {"title": fresh.get("title"), "modules": modules, "version": 3},
        },
    )
    return fresh


@api_router.delete("/permission-sets-v3/{pset_id}")
async def delete_v3_set(pset_id: str, user=Depends(require_role("Super Admin"))):
    """Soft-delete: mark `deleted_at`/`deleted_by`. The document remains in the
    collection so audit-log references keep resolving.

    QA D2 FIX (Aug 2026): we intentionally DO NOT `$pull` the deleted set from
    `contacts.permission_set_ids`. The v3 helpers now filter by
    `deleted_at: null`, so a user whose only set has been deleted will:
      • return an empty `docs` list from permission_sets.find(...),
      • fall through to the "explicitly denied" branch (return None),
      • get 403 on every permission-gated endpoint immediately.
    If we `$pull`ed here, the user's `permission_set_ids` would become `[]`
    and they'd incorrectly hit the pre-onboarded permissive fallback."""
    existing = await db.permission_sets.find_one({"id": pset_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Permission set not found")
    if existing.get("deleted_at"):
        raise HTTPException(400, "Permission set is already deleted")
    now = now_iso()
    await db.permission_sets.update_one(
        {"id": pset_id},
        {"$set": {
            "deleted_at": now,
            "deleted_by": _actor(user),
            "updated_on": now,
            "updated_by": _actor(user),
        }},
    )
    # Count (but do not modify) affected contacts, for audit visibility.
    affected_count = await db.contacts.count_documents({"permission_set_ids": pset_id})
    await log_audit(
        actor=user, action="permission_set.delete", resource="permission_set",
        resource_id=pset_id,
        detail=f"Deleted permission set '{existing.get('title')}' (soft); {affected_count} employee(s) had it assigned (assignments preserved as orphan references)",
        metadata={
            "previous": {"title": existing.get("title"), "modules": existing.get("modules") or {}},
            "affected_count": affected_count,
            "soft": True,
        },
        severity="warning",
    )
    return {"ok": True, "unassigned_count": affected_count}


@api_router.post("/permission-sets-v3/{pset_id}/duplicate")
async def duplicate_v3_set(pset_id: str, user=Depends(require_role("Super Admin"))):
    """Clone an existing v3 permission set. New id + seq_no, name suffixed
    '(Copy)' (or '(Copy N)' on collision). Modules deep-copied. Soft-deleted
    sets cannot be duplicated."""
    import json as _json
    src = await db.permission_sets.find_one({"id": pset_id, "version": 3}, {"_id": 0})
    if not src or src.get("deleted_at"):
        raise HTTPException(404, "Permission set not found")

    base_title = src.get("title") or "Permission Set"
    candidate = f"{base_title} (Copy)"
    n = 2
    while await db.permission_sets.find_one({
        "title": {"$regex": f"^{candidate}$", "$options": "i"},
        "version": 3,
        "deleted_at": {"$in": [None]},
    }):
        candidate = f"{base_title} (Copy {n})"
        n += 1

    seq = await _next_seq()
    now = now_iso()
    doc = {
        "id": f"pset-{uuid.uuid4()}",
        "seq_no": seq,
        "numeric_id": seq,
        "title": candidate,
        "description": src.get("description") or "",
        "version": 3,
        "modules": _json.loads(_json.dumps(src.get("modules") or {})),
        "created_on": now,
        "created_by": _actor(user),
        "updated_on": now,
        "updated_by": _actor(user),
        "copied_from_id": pset_id,
    }
    await db.permission_sets.insert_one({**doc})
    doc.pop("_id", None)
    await log_audit(
        actor=user, action="permission_set.duplicate", resource="permission_set",
        resource_id=doc["id"],
        detail=f"Duplicated permission set '{src.get('title')}' → '{candidate}' (#{seq})",
        metadata={"source_id": pset_id, "source_seq_no": src.get("seq_no"), "seq_no": seq},
    )
    return doc


# --------------------------------------------------------------------------- #
# Legacy migration                                                             #
# --------------------------------------------------------------------------- #

def _migrate_legacy_to_v3(legacy: dict) -> dict:
    """Read a v1/v2 permission-set doc and materialize it in v3 shape so the UI
    can display it. Purely in-memory — the doc on disk is not touched.

    Also handles the Jul 6, 2026 catalog re-shuffle: legacy sets that stored
    Employees/Teams/etc. under ``profix`` are hoisted into the new ``manage``
    module.
    """
    _PROFIX_TO_MANAGE_PAGES = {
        "employees", "teams", "notifications", "email_templates",
        "reports", "audit_logs", "settings",
    }
    catalog = {m["key"]: m for m in PERMISSION_MODULES_V3}
    modules_out: Dict[str, dict] = {}

    def _v(x):
        if x in ("respective", "team", "all"):
            return {"enabled": True, "visible": True, "scope": {"respective": "individual", "team": "team", "all": "overall"}[x]}
        return {"enabled": bool(x), "visible": True, "scope": None}

    for mkey, feats in (legacy.get("modules") or {}).items():
        for fkey, actions in (feats or {}).items():
            # Route legacy profix.<manage_page> into the new manage module
            target_mkey = mkey
            if mkey == "profix" and fkey in _PROFIX_TO_MANAGE_PAGES:
                target_mkey = "manage"
            if target_mkey not in catalog:
                continue
            pages_by_key = {p["key"]: p for p in catalog[target_mkey]["pages"]}
            if fkey not in pages_by_key or not isinstance(actions, dict):
                continue
            fn_catalog = {f["key"]: f for f in (pages_by_key[fkey].get("functions") or [])}
            fn_out: Dict[str, dict] = {}
            for a, v in actions.items():
                if a in ("view", "edit"):
                    continue
                if a in fn_catalog:
                    if v in ("respective", "team", "all"):
                        fn_out[a] = {"enabled": True, "visible": True, "scope": {"respective": "individual", "team": "team", "all": "overall"}[v]}
                    else:
                        fn_out[a] = {"enabled": bool(v), "visible": True, "scope": None}
            target_module = modules_out.setdefault(target_mkey, {"pages": {}})
            target_module["pages"][fkey] = {
                "view": _v(actions.get("view")),
                "edit": _v(actions.get("edit")),
                "functions": fn_out,
            }
    return {**legacy, "modules": modules_out, "version": 3, "migrated_from_legacy": True}


# --------------------------------------------------------------------------- #
# Audit log for permission changes                                             #
# --------------------------------------------------------------------------- #

@api_router.get("/permissions/audit")
async def permissions_audit(
    limit: int = Query(50, ge=1, le=500),
    skip: int = Query(0, ge=0),
    resource_id: Optional[str] = None,
    q: Optional[str] = Query(None, description="Search by detail / actor name/email"),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user=Depends(require_role("Super Admin")),
):
    """Return permission_set.* audit rows for the Round 3 Audit Log tab.

    Each row is enriched with the target permission set's current title
    (if it still exists) so the UI doesn't have to N+1 lookup.
    """
    query: Dict[str, Any] = {"action": {"$regex": "^permission_set\\."}}
    if resource_id:
        query["resource_id"] = resource_id
    if date_from or date_to:
        rng: Dict[str, Any] = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            # inclusive upper bound: bump by one day worth of ISO if just a date is passed
            rng["$lte"] = date_to if "T" in (date_to or "") else f"{date_to}T23:59:59.999999+00:00"
        query["created_at"] = rng
    if q:
        query["$or"] = [
            {"detail":       {"$regex": q, "$options": "i"}},
            {"actor.name":   {"$regex": q, "$options": "i"}},
            {"actor.email":  {"$regex": q, "$options": "i"}},
            {"resource_id":  {"$regex": q, "$options": "i"}},
        ]

    cursor = db.audit_log.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit)
    rows = await cursor.to_list(limit)
    total = await db.audit_log.count_documents(query)

    # Enrich with target set's current title (best-effort — set may have been deleted)
    resource_ids = list({r.get("resource_id") for r in rows if r.get("resource_id")})
    titles: Dict[str, str] = {}
    if resource_ids:
        async for doc in db.permission_sets.find(
            {"id": {"$in": resource_ids}}, {"_id": 0, "id": 1, "title": 1}
        ):
            titles[doc["id"]] = doc.get("title") or ""
    for r in rows:
        rid = r.get("resource_id")
        if rid:
            r["target_title"] = titles.get(rid)
    return {"rows": rows, "total": total, "skip": skip, "limit": limit}


# --------------------------------------------------------------------------- #
# Copy-from support                                                            #
# --------------------------------------------------------------------------- #

@api_router.get("/permission-sets-v3/{pset_id}/clone-payload")
async def clone_payload(pset_id: str, user=Depends(require_role("Super Admin"))):
    """Return a v3 payload (title/modules) suitable for prefilling the editor
    when the user chooses 'Copy from an existing set'. Works for both v3 sets
    and legacy ones (via on-the-fly migration)."""
    doc = await db.permission_sets.find_one({"id": pset_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Permission set not found")
    if doc.get("version") != 3:
        doc = _migrate_legacy_to_v3(doc)
    return {
        "title": f"Copy of {doc.get('title', 'permission set')}",
        "description": doc.get("description") or "",
        "modules": doc.get("modules") or {},
        "copied_from_id": pset_id,
    }


# --------------------------------------------------------------------------- #
# Effective permissions for the current user (Round 3 — client-side gating)   #
# --------------------------------------------------------------------------- #

@api_router.get("/me/permissions")
async def my_effective_permissions(user=Depends(get_current_user)):
    """Return the effective v3 permission matrix for the *current* user.

    Semantics
    ---------
    - Super Admin → `is_super_admin: true`, no matrix needed (client shows/enables all).
    - Otherwise → OR-union of every assigned Permission Set (via `permission_set_ids`
      on the user record). Legacy v1/v2 sets are migrated on the fly to the v3 shape.
    - Fallback (`has_any_set: false`) → empty matrix. Client treats this as
      *permissive* (show + enable everything) so existing users aren't locked out
      before permissions have been onboarded.

    The response shape matches the v3 catalog for direct look-ups from the UI:
        {
          is_super_admin: bool,
          has_any_set: bool,
          set_ids: [str, ...],
          modules: {
            <mkey>: {
              pages: {
                <pkey>: {
                  view:  {enabled, visible, scope},
                  edit:  {enabled, visible, scope},
                  functions: { <fkey>: {enabled, visible, scope} },
                }
              }
            }
          }
        }
    """
    is_super = user.get("role") == "Super Admin"
    if is_super:
        return {
            "is_super_admin": True,
            "has_any_set": False,
            "set_ids": [],
            "modules": {},
        }

    set_ids: List[str] = list(user.get("permission_set_ids") or [])
    merged: Dict[str, dict] = {}
    live_set_ids: List[str] = []

    if set_ids:
        docs = await db.permission_sets.find(
            # D2 FIX (Aug 2026): filter out soft-deleted permission sets so a
            # deleted set stops granting access immediately (previously the
            # cached JWT continued to work until natural expiry).
            {"id": {"$in": set_ids}, "deleted_at": {"$in": [None]}},
            {"_id": 0},
        ).to_list(500)
        for doc in docs:
            live_set_ids.append(doc.get("id"))
            modules = doc.get("modules") or {}
            if doc.get("version") != 3:
                # Migrate legacy set → v3 shape in-memory
                migrated = _migrate_legacy_to_v3(doc)
                modules = migrated.get("modules") or {}
            else:
                # Re-normalize v3 sets so pre-Jul-2026 docs (Manage pages under
                # profix) surface under the new manage module.
                modules = _normalize_v3_modules(modules)
            _merge_modules(merged, modules)

    return {
        "is_super_admin": False,
        # `has_any_set` is TRUE only if at least one *live* set is assigned —
        # so a user whose only set has been deleted correctly falls through to
        # the "No Module Assigned" banner instead of the pre-onboarded
        # permissive fallback.
        "has_any_set": bool(live_set_ids),
        "set_ids": live_set_ids,
        "modules": merged,
    }


# --------------------------------------------------------------------------- #
# V3 helper used by other routers                                              #
# --------------------------------------------------------------------------- #

async def get_v3_function(user: dict, mkey: str, pkey: str, fkey: str) -> Optional[dict]:
    """Return the effective v3 function entry for `user` at (mkey, pkey, fkey).

    - Super Admin → returns a permissive entry {enabled:True, visible:True,
      scope:"overall", max_editable_status:"closed"}.
    - Otherwise → OR-union across the user's assigned Permission Sets.
      Returns `None` if the user has no assigned sets AND the fallback is
      permissive (caller should treat this as full-access), or an entry with
      `enabled: False` when explicitly denied.

    Fallback rule (aligned with the client-side EffectivePermissionsContext):
      if the user has NO assigned permission sets, we return a permissive
      entry so pre-onboarded users aren't locked out.
    """
    if user.get("role") == "Super Admin":
        return {
            "enabled": True,
            "visible": True,
            "scope": "overall",
            "max_editable_status": "closed",
        }

    set_ids: List[str] = list(user.get("permission_set_ids") or [])
    if not set_ids:
        # Permissive fallback — matches EffectivePermissionsContext behavior.
        return {
            "enabled": True,
            "visible": True,
            "scope": "overall",
            "max_editable_status": "closed",
        }

    docs = await db.permission_sets.find(
        # D2 FIX (Aug 2026): skip soft-deleted sets.
        {"id": {"$in": set_ids}, "deleted_at": {"$in": [None]}}, {"_id": 0}
    ).to_list(500)
    # If ALL assigned sets have been deleted, treat the user as fully denied
    # (NOT as pre-onboarded, since they had sets assigned that were later
    # revoked). Returning None here disables the feature.
    if not docs:
        return None
    merged: Dict[str, dict] = {}
    for doc in docs:
        modules = doc.get("modules") or {}
        if doc.get("version") != 3:
            migrated = _migrate_legacy_to_v3(doc)
            modules = migrated.get("modules") or {}
        else:
            modules = _normalize_v3_modules(modules)
        _merge_modules(merged, modules)

    page = ((merged.get(mkey) or {}).get("pages") or {}).get(pkey) or {}
    entry = (page.get("functions") or {}).get(fkey)
    return entry  # None ⇒ not granted



# --------------------------------------------------------------------------- #
# V3 page-level view helper + FastAPI dependency                              #
# (Added Jul 29 2026 to close backend permission-leak reported by QA — the    #
# frontend was gating pages but the API endpoints only checked role, so a    #
# restricted admin could bypass with curl.)                                  #
# --------------------------------------------------------------------------- #

async def get_v3_page_view(user: dict, mkey: str, pkey: str) -> Optional[dict]:
    """Return the effective view entry for (mkey, pkey) for `user`.

    Semantics match the frontend `EffectivePermissionsContext.isPageViewVisible`:
      - Super Admin → permissive (returns overall-scope entry).
      - Admin with NO assigned permission sets → permissive fallback (matches
        pre-onboarded behavior; keeps app usable while sets are being rolled
        out).
      - Admin WITH sets → OR-union across sets; returns the merged view entry
        (or None if no set grants this page).
    """
    if user.get("role") == "Super Admin":
        return {"enabled": True, "visible": True, "scope": "overall"}

    set_ids: List[str] = list(user.get("permission_set_ids") or [])
    if not set_ids:
        return {"enabled": True, "visible": True, "scope": "overall"}

    docs = await db.permission_sets.find(
        # D2 FIX (Aug 2026): filter out soft-deleted sets so access revocation
        # is immediate rather than JWT-lifetime-bound.
        {"id": {"$in": set_ids}, "deleted_at": {"$in": [None]}}, {"_id": 0}
    ).to_list(500)
    # If ALL assigned sets were deleted, treat as explicitly denied — do NOT
    # fall through to the pre-onboarded permissive fallback.
    if not docs:
        return None
    merged: Dict[str, dict] = {}
    for doc in docs:
        modules = doc.get("modules") or {}
        if doc.get("version") != 3:
            migrated = _migrate_legacy_to_v3(doc)
            modules = migrated.get("modules") or {}
        else:
            modules = _normalize_v3_modules(modules)
        _merge_modules(merged, modules)

    page = ((merged.get(mkey) or {}).get("pages") or {}).get(pkey) or {}
    return page.get("view")  # None ⇒ not granted


def require_v3_page_view(mkey: str, pkey: str):
    """FastAPI dependency: 403 unless `user` has view.enabled+visible for (mkey, pkey).

    Usage:
        @router.get("/contacts")
        async def list_contacts(user=Depends(require_v3_page_view("manage", "employees"))):
            ...
    """
    async def _dep(user=Depends(get_current_user)):
        entry = await get_v3_page_view(user, mkey, pkey)
        if not entry or not entry.get("enabled") or not entry.get("visible"):
            raise HTTPException(403, f"Access denied to {mkey}.{pkey}")
        return user
    return _dep


def require_any_v3_page_view(*pages: tuple):
    """FastAPI dependency: 403 unless `user` has view.enabled+visible for AT LEAST
    ONE of the given (module, page) tuples.

    Useful when a single API endpoint is used to feed multiple UI surfaces
    (e.g. floor plans are viewed on Floor Layout page AND Floor Calibration
    page).

    Usage:
        @router.get("/floor-plans")
        async def list_floor_plans(user=Depends(require_any_v3_page_view(
            ("desk_booking", "floor_layout"),
            ("desk_booking", "floor_plans"),
        ))):
            ...
    """
    async def _dep(user=Depends(get_current_user)):
        for mkey, pkey in pages:
            entry = await get_v3_page_view(user, mkey, pkey)
            if entry and entry.get("enabled") and entry.get("visible"):
                return user
        allowed = ", ".join(f"{m}.{p}" for m, p in pages)
        raise HTTPException(403, f"Access denied — needs one of: {allowed}")
    return _dep


async def has_v3_page_view(user: dict, mkey: str, pkey: str) -> bool:
    """Non-blocking check — returns True if user's effective view for (mkey, pkey)
    is enabled+visible. Used to conditionally strip sensitive fields from a
    response that is otherwise broadly accessible (e.g. `list_teams` returns a
    lite payload to non-managers but full payload to manage.teams viewers).
    """
    entry = await get_v3_page_view(user, mkey, pkey)
    return bool(entry and entry.get("enabled") and entry.get("visible"))


async def get_profix_dashboard_config(user: dict) -> dict:
    """Return the effective ProfiX Dashboard config for `user`.

    Response:
        {
          "access_level": "individual" | "manager" | "overall" | None,
          "metrics_based_on": "created_by" | "assigned_to",
        }

    Rules:
      • Super Admin → access_level="overall", metrics_based_on defaults to
        "created_by" unless overridden by an assigned permission set.
      • Otherwise → OR-union across assigned Permission Sets (matches
        `my_effective_permissions`). `metrics_based_on` defaults to
        "created_by" when nothing is configured.
    """
    default_metric = "created_by"
    is_super = user.get("role") == "Super Admin"

    set_ids: List[str] = list(user.get("permission_set_ids") or [])
    if not set_ids:
        # No sets → permissive fallback. Super Admin gets overall, others None.
        return {
            "access_level": "overall" if is_super else None,
            "metrics_based_on": default_metric,
        }

    docs = await db.permission_sets.find(
        {"id": {"$in": set_ids}, "deleted_at": {"$in": [None]}}, {"_id": 0}
    ).to_list(500)
    merged: Dict[str, dict] = {}
    for doc in docs:
        modules = doc.get("modules") or {}
        if doc.get("version") != 3:
            migrated = _migrate_legacy_to_v3(doc)
            modules = migrated.get("modules") or {}
        else:
            modules = _normalize_v3_modules(modules)
        _merge_modules(merged, modules)

    dash_profix = (((merged.get("dashboard") or {}).get("pages") or {}).get("profix")) or {}
    access = dash_profix.get("access_level") or ("overall" if is_super else None)
    metric = _sanitize_metrics_based_on(dash_profix.get("metrics_based_on")) or default_metric
    return {"access_level": access, "metrics_based_on": metric}


# --------------------------------------------------------------------------- #
# V3 page-level EDIT helper + dependency (Aug 2026 QA fix — D7)
# --------------------------------------------------------------------------- #

async def get_v3_page_edit(user: dict, mkey: str, pkey: str) -> Optional[dict]:
    """Return the effective EDIT entry for (mkey, pkey) for `user`.

    Same semantics as `get_v3_page_view` but for the `edit` sub-entry.
    - Super Admin → permissive (overall scope).
    - Admin with NO assigned permission sets → permissive fallback.
    - Admin WITH sets → OR-union across sets; returns merged edit entry or
      None if not granted.
    """
    if user.get("role") == "Super Admin":
        return {"enabled": True, "visible": True, "scope": "overall"}

    set_ids: List[str] = list(user.get("permission_set_ids") or [])
    if not set_ids:
        return {"enabled": True, "visible": True, "scope": "overall"}

    docs = await db.permission_sets.find(
        {"id": {"$in": set_ids}, "deleted_at": {"$in": [None]}}, {"_id": 0}
    ).to_list(500)
    if not docs:
        return None
    merged: Dict[str, dict] = {}
    for doc in docs:
        modules = doc.get("modules") or {}
        if doc.get("version") != 3:
            migrated = _migrate_legacy_to_v3(doc)
            modules = migrated.get("modules") or {}
        else:
            modules = _normalize_v3_modules(modules)
        _merge_modules(merged, modules)

    page = ((merged.get(mkey) or {}).get("pages") or {}).get(pkey) or {}
    return page.get("edit")


def require_v3_page_edit(mkey: str, pkey: str):
    """FastAPI dependency: 403 unless user has BOTH view.enabled+visible AND
    edit.enabled+visible on (mkey, pkey). Edit-without-View is not a valid
    combination — see QA scenario H.
    """
    async def _dep(user=Depends(get_current_user)):
        view_entry = await get_v3_page_view(user, mkey, pkey)
        if not view_entry or not view_entry.get("enabled") or not view_entry.get("visible"):
            raise HTTPException(403, f"Access denied to {mkey}.{pkey} (view required)")
        edit_entry = await get_v3_page_edit(user, mkey, pkey)
        if not edit_entry or not edit_entry.get("enabled") or not edit_entry.get("visible"):
            raise HTTPException(403, f"Edit denied on {mkey}.{pkey}")
        return user
    return _dep


def require_v3_function(mkey: str, pkey: str, fkey: str):
    """FastAPI dependency: 403 unless user has function `fkey` enabled+visible on
    page (mkey, pkey). Super Admin is permissive (handled by get_v3_function).

    Used for ACTION-level gates that the frontend already checks per-function —
    e.g. Pending Approvals → approve / reject / configure_auto_approval — so a
    Permission Set that enables the action lets a non-Super-Admin perform it,
    instead of the endpoint hard-requiring the Super Admin role.
    """
    async def _dep(user=Depends(get_current_user)):
        entry = await get_v3_function(user, mkey, pkey, fkey)
        if not entry or not entry.get("enabled") or not entry.get("visible"):
            raise HTTPException(403, f"Access denied — {mkey}.{pkey}.{fkey} not granted")
        return user
    return _dep


async def has_any_v3_module_access(user: dict, *modules: str) -> bool:
    """Returns True if the user has ANY (page, view.enabled+visible) inside ANY
    of the given module keys. Used to gate cross-module payloads (e.g. teams
    lite payload — only shared with users who actually consume it via
    profix/desk_booking pages).
    """
    if user.get("role") == "Super Admin":
        return True
    set_ids: List[str] = list(user.get("permission_set_ids") or [])
    if not set_ids:
        # Pre-onboarded users: permissive fallback (matches other helpers).
        return True
    docs = await db.permission_sets.find(
        {"id": {"$in": set_ids}, "deleted_at": {"$in": [None]}}, {"_id": 0}
    ).to_list(500)
    if not docs:
        return False
    merged: Dict[str, dict] = {}
    for doc in docs:
        raw = doc.get("modules") or {}
        if doc.get("version") != 3:
            migrated = _migrate_legacy_to_v3(doc)
            raw = migrated.get("modules") or {}
        else:
            raw = _normalize_v3_modules(raw)
        _merge_modules(merged, raw)
    for mkey in modules:
        pages = ((merged.get(mkey) or {}).get("pages") or {})
        for _pkey, entry in pages.items():
            view = (entry or {}).get("view") or {}
            if view.get("enabled") and view.get("visible"):
                return True
    return False

