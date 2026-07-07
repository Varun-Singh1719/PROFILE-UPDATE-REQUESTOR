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
GET  /api/permissions/preview/{id}      — dry-run: return effective permissions
                                          a user assigned to <id> would see.
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

# Dashboard access-level precedence — higher wins when merging.
_DASHBOARD_ACCESS_RANK = {None: 0, "individual": 1, "manager": 2, "overall": 3}
_DASHBOARD_ACCESS_VALUES = ("individual", "manager", "overall")


def _sanitize_access_level(v: Any) -> Optional[str]:
    if v in _DASHBOARD_ACCESS_VALUES:
        return v
    return None


def _merge_access_level(a: Optional[str], b: Optional[str]) -> Optional[str]:
    """Pick the higher-ranked dashboard access level."""
    ra = _DASHBOARD_ACCESS_RANK.get(a, 0)
    rb = _DASHBOARD_ACCESS_RANK.get(b, 0)
    return a if ra >= rb else b


def _merge_rw(a: Optional[dict], b: Optional[dict]) -> dict:
    """Merge two {enabled, visible, scope} triples using OR semantics.

    - `enabled` = OR of both
    - `visible` = OR of both (a function is visible if ANY assigned set marks it visible)
    - `scope`   = broader wins (overall > team > individual > None)
    """
    a = a or {}
    b = b or {}
    scope_a = a.get("scope")
    scope_b = b.get("scope")
    scope = scope_a if _SCOPE_RANK.get(scope_a, 0) >= _SCOPE_RANK.get(scope_b, 0) else scope_b
    return {
        "enabled": bool(a.get("enabled")) or bool(b.get("enabled")),
        "visible": bool(a.get("visible")) or bool(b.get("visible")),
        "scope": scope,
    }


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


def _sanitize_rw(v: Any, scoped: bool = True) -> dict:
    """Sanitize a {enabled, visible, scope} triple."""
    out = _empty_rw()
    if not isinstance(v, dict):
        return out
    out["enabled"] = bool(v.get("enabled"))
    # `visible` defaults to True (rows are shown by default) — the toggle
    # HIDES a row when set to False.
    if "visible" in v:
        out["visible"] = bool(v.get("visible"))
    out["scope"] = _sanitize_scope(v.get("scope")) if scoped else None
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
                pages_out[pkey] = {"access_level": lvl}
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
                fn_out[fkey] = _sanitize_rw(fdata, scoped=scoped)
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
    user=Depends(get_current_user),
    q: Optional[str] = Query(None, description="Search by title/description"),
):
    query: Dict[str, Any] = {"version": 3}
    if q:
        query["$or"] = [
            {"title":       {"$regex": q, "$options": "i"}},
            {"description": {"$regex": q, "$options": "i"}},
        ]
    docs = await db.permission_sets.find(query, {"_id": 0}).sort("updated_on", -1).to_list(1000)
    return docs


@api_router.get("/permission-sets-v3/{pset_id}")
async def get_v3_set(pset_id: str, user=Depends(get_current_user)):
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


@api_router.post("/permission-sets-v3")
async def create_v3_set(body: PermissionSetV3In, user=Depends(require_role("Super Admin"))):
    modules = _normalize_v3_modules(body.modules or {})
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

    modules = _normalize_v3_modules(body.modules or {})
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
    existing = await db.permission_sets.find_one({"id": pset_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Permission set not found")
    await db.permission_sets.delete_one({"id": pset_id})
    await log_audit(
        actor=user, action="permission_set.delete", resource="permission_set",
        resource_id=pset_id,
        detail=f"Deleted permission set '{existing.get('title')}'",
        metadata={"previous": {"title": existing.get("title"), "modules": existing.get("modules") or {}}},
    )
    return {"ok": True}


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
# Effective permission preview                                                 #
# --------------------------------------------------------------------------- #

def _effective_from_set(set_modules: dict) -> dict:
    """Return a flat 'effective' view for the preview modal — hidden pages
    and functions are stripped."""
    out: Dict[str, dict] = {}
    for mkey, mdata in (set_modules or {}).items():
        # Dashboard module — just carry access_level per page
        if mkey == "dashboard":
            pages_out = {}
            for pkey, pdata in (mdata.get("pages") or {}).items():
                lvl = (pdata or {}).get("access_level")
                if lvl:
                    pages_out[pkey] = {"access_level": lvl}
            if pages_out:
                out[mkey] = {"pages": pages_out}
            continue

        pages_out = {}
        for pkey, pdata in (mdata.get("pages") or {}).items():
            view = pdata.get("view") or {}
            edit = pdata.get("edit") or {}
            if not view.get("visible") and not edit.get("visible"):
                continue
            fns_out = {}
            for fkey, fdata in (pdata.get("functions") or {}).items():
                if not fdata.get("visible"):
                    continue
                fns_out[fkey] = {"enabled": bool(fdata.get("enabled")), "scope": fdata.get("scope")}
            pages_out[pkey] = {
                "view": {"enabled": bool(view.get("enabled")), "scope": view.get("scope")} if view.get("visible") else None,
                "edit": {"enabled": bool(edit.get("enabled")), "scope": edit.get("scope")} if edit.get("visible") else None,
                "functions": fns_out,
            }
        if pages_out:
            out[mkey] = {"pages": pages_out}
    return out


@api_router.get("/permissions/preview/{pset_id}")
async def permissions_preview(pset_id: str, user=Depends(require_role("Super Admin"))):
    doc = await db.permission_sets.find_one({"id": pset_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Permission set not found")
    modules = doc.get("modules") or {}
    if doc.get("version") != 3:
        doc = _migrate_legacy_to_v3(doc)
        modules = doc.get("modules") or {}
    return {"id": pset_id, "title": doc.get("title"), "effective": _effective_from_set(modules)}


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

    if set_ids:
        docs = await db.permission_sets.find(
            {"id": {"$in": set_ids}}, {"_id": 0}
        ).to_list(500)
        for doc in docs:
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
        "has_any_set": bool(set_ids),
        "set_ids": set_ids,
        "modules": merged,
    }
