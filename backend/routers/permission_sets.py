"""Permission Sets (v3): named, reusable templates assigned to employees."""
import json
import uuid
from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException

from core import (
    api_router, db, log_audit, now_iso, require_role, get_current_user,
    PERMISSION_MODULES,
    PermissionSetCreate, PermissionSetUpdate,
)


async def _next_permission_set_seq() -> int:
    """Atomic counter for permission_set numeric IDs."""
    res = await db.counters.find_one_and_update(
        {"_id": "permission_set"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return res["seq"] if res else 1


def _normalize_pset_modules(modules: Dict[str, Dict[str, Dict[str, Any]]]) -> Dict[str, Dict[str, Dict[str, bool]]]:
    """Validate & normalize a permission set's modules tree against the schema.
    Drops unknown modules/features/actions; coerces values to bool. Scoped values
    'all'/'respective' are coerced to True (Permission Sets v3 uses pure booleans)."""
    out: Dict[str, Dict[str, Dict[str, bool]]] = {}
    valid_modules = {m["key"]: m for m in PERMISSION_MODULES}
    for mkey, features in (modules or {}).items():
        if mkey not in valid_modules:
            continue
        valid_features = {}
        for g in valid_modules[mkey]["groups"]:
            for f in g["features"]:
                valid_features[f["key"]] = f["actions"]
        mod_out: Dict[str, Dict[str, bool]] = {}
        for fkey, actions in (features or {}).items():
            if fkey not in valid_features:
                continue
            allowed = valid_features[fkey]
            f_out = {}
            for a in allowed:
                v = (actions or {}).get(a, False)
                if v in ("all", "respective"):
                    f_out[a] = True
                else:
                    f_out[a] = bool(v)
            mod_out[fkey] = f_out
        if mod_out:
            out[mkey] = mod_out
    return out


def _serialize_pset(p: dict) -> dict:
    p.pop("_id", None)
    return p


@api_router.get("/permission-sets")
async def list_permission_sets(
    user=Depends(get_current_user),
    q: Optional[str] = None,
    created_by: Optional[str] = None,
    created_from: Optional[str] = None,
    created_to: Optional[str] = None,
    module: Optional[str] = None,
):
    """List Permission Sets. Filters: q (name search), created_by (user id),
    created_from / created_to (YYYY-MM-DD), module (profix|desk_booking).
    Open to any authed user so multi-select dropdowns can populate."""
    query = {}
    if q:
        query["name"] = {"$regex": q, "$options": "i"}
    if created_by:
        query["created_by.id"] = created_by
    date_cond = {}
    if created_from:
        date_cond["$gte"] = created_from
    if created_to:
        date_cond["$lte"] = created_to if "T" in created_to else f"{created_to}T23:59:59"
    if date_cond:
        query["created_at"] = date_cond
    if module:
        query[f"modules.{module}"] = {"$exists": True}
    items = await db.permission_sets.find(query, {"_id": 0}).sort("numeric_id", -1).to_list(2000)
    return items


@api_router.get("/permission-sets/stats")
async def permission_sets_stats(user=Depends(get_current_user)):
    total = await db.permission_sets.count_documents({})
    profix = await db.permission_sets.count_documents({"modules.profix": {"$exists": True}})
    desk = await db.permission_sets.count_documents({"modules.desk_booking": {"$exists": True}})
    employees_with_sets = await db.contacts.count_documents({"permission_set_ids": {"$exists": True, "$ne": []}})
    return {
        "total_sets": total,
        "profix_sets": profix,
        "desk_booking_sets": desk,
        "employees_with_sets": employees_with_sets,
    }


@api_router.get("/permission-sets/{pset_id}")
async def get_permission_set(pset_id: str, user=Depends(get_current_user)):
    q = {"id": pset_id}
    if pset_id.isdigit():
        q = {"$or": [{"id": pset_id}, {"numeric_id": int(pset_id)}]}
    p = await db.permission_sets.find_one(q, {"_id": 0})
    if not p:
        raise HTTPException(404, "Permission Set not found")
    return p


@api_router.post("/permission-sets")
async def create_permission_set(body: PermissionSetCreate, user=Depends(require_role("Super Admin"))):
    if not body.name or not body.name.strip():
        raise HTTPException(400, "Name is required")
    existing = await db.permission_sets.find_one({"name": {"$regex": f"^{body.name.strip()}$", "$options": "i"}})
    if existing:
        raise HTTPException(400, "A Permission Set with this name already exists")
    seq = await _next_permission_set_seq()
    now = now_iso()
    doc = {
        "id": str(uuid.uuid4()),
        "numeric_id": seq,
        "name": body.name.strip(),
        "description": (body.description or "").strip(),
        "modules": _normalize_pset_modules(body.modules or {}),
        "created_by": {"id": user["id"], "name": user.get("name"), "email": user.get("email")},
        "created_at": now,
        "updated_at": now,
        "updated_by": {"id": user["id"], "name": user.get("name"), "email": user.get("email")},
    }
    await db.permission_sets.insert_one(doc)
    await log_audit(
        actor=user, action="permission_set.create", resource="permission_set", resource_id=doc["id"],
        detail=f"Created Permission Set '{doc['name']}' (#{seq})",
        metadata={"numeric_id": seq},
        severity="info",
    )
    return _serialize_pset(dict(doc))


@api_router.patch("/permission-sets/{pset_id}")
async def update_permission_set(pset_id: str, body: PermissionSetUpdate, user=Depends(require_role("Super Admin"))):
    p = await db.permission_sets.find_one({"id": pset_id})
    if not p:
        raise HTTPException(404, "Permission Set not found")
    update = {}
    if body.name is not None and body.name.strip():
        clash = await db.permission_sets.find_one({
            "name": {"$regex": f"^{body.name.strip()}$", "$options": "i"},
            "id": {"$ne": pset_id},
        })
        if clash:
            raise HTTPException(400, "A Permission Set with this name already exists")
        update["name"] = body.name.strip()
    if body.description is not None:
        update["description"] = body.description.strip()
    if body.modules is not None:
        update["modules"] = _normalize_pset_modules(body.modules)
    if not update:
        raise HTTPException(400, "Nothing to update")
    update["updated_at"] = now_iso()
    update["updated_by"] = {"id": user["id"], "name": user.get("name"), "email": user.get("email")}
    await db.permission_sets.update_one({"id": pset_id}, {"$set": update})
    new_doc = await db.permission_sets.find_one({"id": pset_id}, {"_id": 0})
    await log_audit(
        actor=user, action="permission_set.update", resource="permission_set", resource_id=pset_id,
        detail=f"Updated Permission Set '{new_doc.get('name')}' (#{new_doc.get('numeric_id')})",
        severity="info",
    )
    return new_doc


@api_router.delete("/permission-sets/{pset_id}")
async def delete_permission_set(pset_id: str, user=Depends(require_role("Super Admin"))):
    p = await db.permission_sets.find_one({"id": pset_id})
    if not p:
        raise HTTPException(404, "Permission Set not found")
    await db.permission_sets.delete_one({"id": pset_id})
    res = await db.contacts.update_many(
        {"permission_set_ids": pset_id},
        {"$pull": {"permission_set_ids": pset_id}},
    )
    await log_audit(
        actor=user, action="permission_set.delete", resource="permission_set", resource_id=pset_id,
        detail=f"Deleted Permission Set '{p.get('name')}' (#{p.get('numeric_id')}); unassigned from {res.modified_count} employee(s)",
        metadata={"unassigned_count": res.modified_count},
        severity="warning",
    )
    return {"ok": True, "unassigned_count": res.modified_count}


@api_router.post("/permission-sets/{pset_id}/duplicate")
async def duplicate_permission_set(pset_id: str, user=Depends(require_role("Super Admin"))):
    """Clone an existing Permission Set. The new set gets a fresh numeric_id,
    its own uuid, and a name suffixed with '(Copy)' (or '(Copy N)' if a clash exists).
    Modules + description are deep-copied verbatim."""
    src = await db.permission_sets.find_one({"id": pset_id}, {"_id": 0})
    if not src:
        raise HTTPException(404, "Permission Set not found")
    base = src.get("name") or "Permission Set"
    candidate = f"{base} (Copy)"
    n = 2
    while await db.permission_sets.find_one({"name": {"$regex": f"^{candidate}$", "$options": "i"}}):
        candidate = f"{base} (Copy {n})"
        n += 1
    seq = await _next_permission_set_seq()
    now = now_iso()
    doc = {
        "id": str(uuid.uuid4()),
        "numeric_id": seq,
        "name": candidate,
        "description": src.get("description") or "",
        "modules": json.loads(json.dumps(src.get("modules") or {})),
        "created_by": {"id": user["id"], "name": user.get("name"), "email": user.get("email")},
        "created_at": now,
        "updated_at": now,
        "updated_by": {"id": user["id"], "name": user.get("name"), "email": user.get("email")},
    }
    await db.permission_sets.insert_one(doc)
    await log_audit(
        actor=user, action="permission_set.duplicate", resource="permission_set", resource_id=doc["id"],
        detail=f"Duplicated Permission Set '{src.get('name')}' (#{src.get('numeric_id')}) -> '{candidate}' (#{seq})",
        metadata={"source_id": pset_id, "source_numeric_id": src.get("numeric_id"), "numeric_id": seq},
        severity="info",
    )
    return _serialize_pset(dict(doc))
