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
    return {
        "id": user.get("id"),
        "name": user.get("name"),
        "email": user.get("email"),
    }


def _serialize(doc: dict) -> dict:
    if not doc:
        return doc
    doc = {k: v for k, v in doc.items() if k != "_id"}
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
    rows = [_serialize(d) async for d in cursor]
    return {"rows": rows, "total": len(rows)}


@api_router.get("/segmentations/{seg_id}")
async def get_segmentation(seg_id: str, user=Depends(get_current_user)):
    doc = await db[COLL].find_one({"id": seg_id})
    if not doc:
        raise HTTPException(404, "Segmentation not found")
    return _serialize(doc)


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
    return _serialize(doc)


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
        return _serialize(existing)

    updates["updated_by"] = _actor_stub(user)
    updates["updated_on"] = now_iso()

    await db[COLL].update_one({"id": seg_id}, {"$set": updates})
    doc = await db[COLL].find_one({"id": seg_id})
    return _serialize(doc)


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
