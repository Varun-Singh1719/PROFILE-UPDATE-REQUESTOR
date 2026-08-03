"""CRM → Segmentations router.

MVP scope (Jul 2026):
  * Simple standalone list of "Segmentation" records.
  * Fields: name (required, unique), description (optional),
    status ("Active" | "Inactive", default Active), audit timestamps and
    actor stamps (created_by / updated_by).
  * REST: GET (list) / GET (detail) / POST (create) / PATCH (update) /
    DELETE (remove).
  * Access is currently open to any authenticated user (Super Admin + Admin).
    Once permissions v3 gets a "crm" module we'll tighten the gate.
"""
from __future__ import annotations

import uuid
from typing import Optional, List

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from core import api_router, db, now_iso, get_current_user


COLL = "segmentations"


# ---------- Pydantic schemas ----------
class SegmentationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    status: Optional[str] = "Active"
    tree: Optional[dict] = None

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Name is required")
        return v

    @field_validator("status")
    @classmethod
    def _clean_status(cls, v: Optional[str]) -> str:
        if v is None:
            return "Active"
        v = (v or "").strip()
        return v if v in {"Active", "Inactive"} else "Active"


class SegmentationUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    status: Optional[str] = None
    tree: Optional[dict] = None

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("Name cannot be blank")
        return v

    @field_validator("status")
    @classmethod
    def _clean_status(cls, v):
        if v is None:
            return v
        v = (v or "").strip()
        if v not in {"Active", "Inactive"}:
            raise ValueError("Status must be Active or Inactive")
        return v


# ---------- helpers ----------
def _actor_stub(user: dict) -> dict:
    """Denormalized actor block persisted on segmentation docs.

    We include emp_id at write-time so historical rows carry a snapshot,
    and additionally enrich on read (via _enrich_actor) so renaming an
    employee or backfilling an emp_id is reflected in the UI without
    requiring a re-save of every segmentation.
    """
    return {
        "id": user.get("id"),
        "name": user.get("name"),
        "email": user.get("email"),
        "emp_id": user.get("emp_id"),
    }


async def _emp_id_map_for(ids: List[str]) -> dict:
    """Look up emp_id / name / email for a batch of contact IDs.

    Returns { contact_id: {"emp_id": ..., "name": ..., "email": ...} }.
    Ids missing from the collection are silently skipped.
    """
    ids = [i for i in (ids or []) if i]
    if not ids:
        return {}
    cursor = db.contacts.find(
        {"id": {"$in": ids}},
        {"_id": 0, "id": 1, "emp_id": 1, "name": 1, "email": 1},
    )
    out: dict = {}
    async for c in cursor:
        out[c.get("id")] = {
            "emp_id": c.get("emp_id"),
            "name": c.get("name"),
            "email": c.get("email"),
        }
    return out


def _enrich_actor(actor: Optional[dict], contact_map: dict) -> Optional[dict]:
    """Merge fresh emp_id / name from the contacts collection into an
    actor stub. Falls back to the persisted values when the contact has
    since been deleted."""
    if not actor:
        return actor
    fresh = contact_map.get(actor.get("id")) or {}
    return {
        "id": actor.get("id"),
        "name": fresh.get("name") or actor.get("name"),
        "email": fresh.get("email") or actor.get("email"),
        "emp_id": fresh.get("emp_id") or actor.get("emp_id"),
    }


def _serialize(doc: dict) -> dict:
    if not doc:
        return doc
    doc = {k: v for k, v in doc.items() if k != "_id"}
    return doc


async def _enrich_doc(doc: dict) -> dict:
    """Populate emp_id / current name on created_by & updated_by so the
    UI's Details pivot table always shows up-to-date employee info even
    for segmentations created before emp_id was persisted."""
    if not doc:
        return doc
    cb = doc.get("created_by") or {}
    ub = doc.get("updated_by") or {}
    ids = [cb.get("id"), ub.get("id")]
    contact_map = await _emp_id_map_for(ids)
    if cb:
        doc["created_by"] = _enrich_actor(cb, contact_map)
    if ub:
        doc["updated_by"] = _enrich_actor(ub, contact_map)
    return doc


# ---------- routes ----------
@api_router.get("/segmentations")
async def list_segmentations(
    q: Optional[str] = Query(None, description="Substring search on name/description"),
    status: Optional[str] = Query(None, description="Active | Inactive"),
    user=Depends(get_current_user),
):
    query: dict = {}
    if status in {"Active", "Inactive"}:
        query["status"] = status
    if q:
        q = q.strip()
        if q:
            query["$or"] = [
                {"name": {"$regex": q, "$options": "i"}},
                {"description": {"$regex": q, "$options": "i"}},
            ]
    cursor = db[COLL].find(query).sort("created_on", -1)
    rows_raw = [_serialize(d) async for d in cursor]

    # Batch-enrich all actor stubs in one contacts query.
    ids: list = []
    for r in rows_raw:
        for k in ("created_by", "updated_by"):
            a = r.get(k) or {}
            if a.get("id"):
                ids.append(a["id"])
    contact_map = await _emp_id_map_for(list(set(ids)))
    for r in rows_raw:
        if r.get("created_by"):
            r["created_by"] = _enrich_actor(r["created_by"], contact_map)
        if r.get("updated_by"):
            r["updated_by"] = _enrich_actor(r["updated_by"], contact_map)
    return {"rows": rows_raw, "total": len(rows_raw)}


@api_router.get("/segmentations/{seg_id}")
async def get_segmentation(seg_id: str, user=Depends(get_current_user)):
    doc = await db[COLL].find_one({"id": seg_id})
    if not doc:
        raise HTTPException(404, "Segmentation not found")
    return await _enrich_doc(_serialize(doc))


@api_router.post("/segmentations")
async def create_segmentation(body: SegmentationCreate, user=Depends(get_current_user)):
    # unique name (case-insensitive)
    existing = await db[COLL].find_one({
        "name": {"$regex": f"^{_escape_regex(body.name)}$", "$options": "i"}
    })
    if existing:
        raise HTTPException(400, "A segmentation with this name already exists")

    now = now_iso()
    # Default seed tree = root node with the segmentation name; the user can
    # add branches inside the Collapsible Tree editor after create.
    tree = body.tree or {"name": body.name, "children": []}
    doc = {
        "id": str(uuid.uuid4()),
        "name": body.name,
        "description": body.description or "",
        "status": body.status or "Active",
        "tree": tree,
        "created_by": _actor_stub(user),
        "created_on": now,
        "updated_by": _actor_stub(user),
        "updated_on": now,
    }
    await db[COLL].insert_one(doc)
    return await _enrich_doc(_serialize(doc))


@api_router.patch("/segmentations/{seg_id}")
async def update_segmentation(seg_id: str, body: SegmentationUpdate, user=Depends(get_current_user)):
    existing = await db[COLL].find_one({"id": seg_id})
    if not existing:
        raise HTTPException(404, "Segmentation not found")

    updates: dict = {}
    if body.name is not None and body.name != existing.get("name"):
        # dup check
        dup = await db[COLL].find_one({
            "id": {"$ne": seg_id},
            "name": {"$regex": f"^{_escape_regex(body.name)}$", "$options": "i"},
        })
        if dup:
            raise HTTPException(400, "A segmentation with this name already exists")
        updates["name"] = body.name
    if body.description is not None:
        updates["description"] = body.description
    if body.status is not None:
        updates["status"] = body.status
    if body.tree is not None:
        updates["tree"] = body.tree

    if not updates:
        return await _enrich_doc(_serialize(existing))

    updates["updated_by"] = _actor_stub(user)
    updates["updated_on"] = now_iso()

    await db[COLL].update_one({"id": seg_id}, {"$set": updates})
    doc = await db[COLL].find_one({"id": seg_id})
    return await _enrich_doc(_serialize(doc))


@api_router.delete("/segmentations/{seg_id}")
async def delete_segmentation(seg_id: str, user=Depends(get_current_user)):
    res = await db[COLL].delete_one({"id": seg_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Segmentation not found")
    return {"ok": True}


# ---------- utils ----------
def _escape_regex(s: str) -> str:
    """Minimal regex-metachar escape for Mongo $regex safe substring/exact matches."""
    import re
    return re.escape(s or "")
