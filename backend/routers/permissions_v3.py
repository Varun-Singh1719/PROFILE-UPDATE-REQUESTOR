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

    New shape (Aug 2026):
      modules[<mkey>].pages[<pkey>] = {
        view: {enabled, visible, scope},
        edit: {enabled, visible, scope},
        functions: { <fkey>: {enabled, visible, scope} }
      }
    """
    catalog = {m["key"]: m for m in PERMISSION_MODULES_V3}
    out: Dict[str, dict] = {}
    for mkey, mdata in (modules or {}).items():
        if mkey not in catalog:
            continue
        catalog_m = catalog[mkey]
        valid_pages = {p["key"]: p for p in catalog_m["pages"]}

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
    """
    catalog = {m["key"]: m for m in PERMISSION_MODULES_V3}
    modules_out: Dict[str, dict] = {}

    def _v(x):
        if x in ("respective", "team", "all"):
            return {"enabled": True, "visible": True, "scope": {"respective": "individual", "team": "team", "all": "overall"}[x]}
        return {"enabled": bool(x), "visible": True, "scope": None}

    for mkey, feats in (legacy.get("modules") or {}).items():
        if mkey not in catalog:
            continue
        pages_by_key = {p["key"]: p for p in catalog[mkey]["pages"]}
        pages_out: Dict[str, dict] = {}
        for fkey, actions in (feats or {}).items():
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
            pages_out[fkey] = {
                "view": _v(actions.get("view")),
                "edit": _v(actions.get("edit")),
                "functions": fn_out,
            }
        if pages_out:
            modules_out[mkey] = {"pages": pages_out}
    return {**legacy, "modules": modules_out, "version": 3, "migrated_from_legacy": True}


# --------------------------------------------------------------------------- #
# Audit log for permission changes                                             #
# --------------------------------------------------------------------------- #

@api_router.get("/permissions/audit")
async def permissions_audit(
    limit: int = Query(50, ge=1, le=500),
    resource_id: Optional[str] = None,
    user=Depends(require_role("Super Admin")),
):
    q: Dict[str, Any] = {"action": {"$regex": "^permission_set\\."}}
    if resource_id:
        q["resource_id"] = resource_id
    rows = await db.audit_log.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return rows


# --------------------------------------------------------------------------- #
# Effective permission preview                                                 #
# --------------------------------------------------------------------------- #

def _effective_from_set(set_modules: dict) -> dict:
    """Return a flat 'effective' view for the preview modal — hidden pages
    and functions are stripped."""
    out: Dict[str, dict] = {}
    for mkey, mdata in (set_modules or {}).items():
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
