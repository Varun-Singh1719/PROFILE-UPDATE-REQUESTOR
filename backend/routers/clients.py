"""CRM → Clients router (Aug 04 2026).

MVP scope
---------
Standalone Clients directory (separate from Client Contacts). Each record has:
  * name           — required, unique (case-insensitive)
  * type           — one of CLIENT_TYPES (single-select)
  * display_id     — auto-incrementing numeric id, starts at 1001
  * created_by / updated_by / created_on / updated_on — audit stamps
  * Placeholder counts (client_contact_count, project_count, serviced_count) —
    return 0 for now; a future task will hydrate them via aggregations.

REST
----
POST   /api/clients          create
GET    /api/clients          list  (?search= &page= &page_size= &type=)
GET    /api/clients/{id}     detail
PATCH  /api/clients/{id}     partial update
DELETE /api/clients/{id}     remove
"""
from __future__ import annotations

import re
import uuid
from typing import Optional, List

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from core import api_router, db, now_iso, get_current_user

COLL = "clients"
COUNTER_KEY = "client_seq"

CLIENT_TYPES = [
    "Venture Capital/Private Equity",
    "Hedge funds/Public Markets",
    "Research and Consulting",
    "Corporations and Companies",
]


# ---------- Schemas ----------
class ClientCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=180)
    type: str = Field(..., min_length=1)

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Name is required")
        return v

    @field_validator("type")
    @classmethod
    def _check_type(cls, v: str) -> str:
        v = (v or "").strip()
        if v not in CLIENT_TYPES:
            raise ValueError(f"Type must be one of {CLIENT_TYPES}")
        return v


class ClientUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=180)
    type: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("Name cannot be blank")
        return v

    @field_validator("type")
    @classmethod
    def _check_type(cls, v):
        if v is None:
            return v
        v = v.strip()
        if v not in CLIENT_TYPES:
            raise ValueError(f"Type must be one of {CLIENT_TYPES}")
        return v


# ---------- Helpers ----------
def _actor(user: dict) -> dict:
    return {
        "id": user.get("id"),
        "name": user.get("name"),
        "email": user.get("email"),
        "emp_id": user.get("emp_id"),
    }


def _serialize(doc: dict) -> dict:
    if not doc:
        return doc
    return {k: v for k, v in doc.items() if k != "_id"}


def _with_placeholders(doc: dict) -> dict:
    """Attach placeholder aggregate counts. Will be computed by real queries later."""
    if not doc:
        return doc
    doc.setdefault("client_contact_count", 0)
    doc.setdefault("project_count", 0)
    doc.setdefault("serviced_count", 0)
    return doc


async def _next_display_id() -> int:
    """Auto-incrementing numeric id. First client -> 1001."""
    await db["counters"].find_one_and_update(
        {"_id": COUNTER_KEY},
        {"$inc": {"seq": 1}, "$setOnInsert": {"seq_base": 1000}},
        upsert=True,
        return_document=True,
    )
    doc = await db["counters"].find_one({"_id": COUNTER_KEY})
    base = int((doc or {}).get("seq_base") or 1000)
    seq = int((doc or {}).get("seq") or 1)
    return base + seq


def _esc(s: str) -> str:
    return re.escape(s or "")


async def _dup_name(name: str, exclude_id: Optional[str] = None) -> bool:
    q = {"name": {"$regex": f"^{_esc(name)}$", "$options": "i"}}
    if exclude_id:
        q["id"] = {"$ne": exclude_id}
    return (await db[COLL].find_one(q, {"_id": 1})) is not None


# ---------- Routes ----------
@api_router.get("/clients/types")
async def list_client_types(user=Depends(get_current_user)):
    return {"types": CLIENT_TYPES}


@api_router.post("/clients")
async def create_client(payload: ClientCreate, user=Depends(get_current_user)):
    if await _dup_name(payload.name):
        raise HTTPException(400, "A client with this name already exists")

    now = now_iso()
    doc = {
        "id": str(uuid.uuid4()),
        "display_id": await _next_display_id(),
        "name": payload.name,
        "type": payload.type,
        "client_contact_count": 0,
        "project_count": 0,
        "serviced_count": 0,
        "created_by": _actor(user),
        "created_on": now,
        "updated_by": _actor(user),
        "updated_on": now,
    }
    await db[COLL].insert_one(doc)
    return _with_placeholders(_serialize(doc))


@api_router.get("/clients")
async def list_clients(
    search: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    sort: Optional[str] = Query("newest", description="newest | oldest | name_asc | name_desc | id_asc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(24, ge=1, le=200),
    user=Depends(get_current_user),
):
    q: dict = {}
    if type:
        q["type"] = type
    if search:
        s = search.strip()
        if s:
            q["$or"] = [
                {"name": {"$regex": _esc(s), "$options": "i"}},
                {"type": {"$regex": _esc(s), "$options": "i"}},
            ]

    sort_map = {
        "newest":    [("created_on", -1)],
        "oldest":    [("created_on", 1)],
        "name_asc":  [("name", 1)],
        "name_desc": [("name", -1)],
        "id_asc":    [("display_id", 1)],
    }
    sort_spec = sort_map.get(sort or "newest", sort_map["newest"])

    total = await db[COLL].count_documents(q)
    cursor = db[COLL].find(q).sort(sort_spec).skip((page - 1) * page_size).limit(page_size)
    rows: List[dict] = []
    async for d in cursor:
        rows.append(_with_placeholders(_serialize(d)))
    return {"rows": rows, "total": total, "page": page, "page_size": page_size}


@api_router.get("/clients/{client_id}")
async def get_client(client_id: str, user=Depends(get_current_user)):
    doc = await db[COLL].find_one({"id": client_id})
    if not doc:
        raise HTTPException(404, "Client not found")
    return _with_placeholders(_serialize(doc))


@api_router.patch("/clients/{client_id}")
async def update_client(
    client_id: str, payload: ClientUpdate, user=Depends(get_current_user)
):
    existing = await db[COLL].find_one({"id": client_id})
    if not existing:
        raise HTTPException(404, "Client not found")

    updates: dict = {}
    if payload.name is not None and payload.name != existing.get("name"):
        if await _dup_name(payload.name, exclude_id=client_id):
            raise HTTPException(400, "A client with this name already exists")
        updates["name"] = payload.name
    if payload.type is not None:
        updates["type"] = payload.type

    if not updates:
        return _with_placeholders(_serialize(existing))

    updates["updated_by"] = _actor(user)
    updates["updated_on"] = now_iso()
    await db[COLL].update_one({"id": client_id}, {"$set": updates})
    doc = await db[COLL].find_one({"id": client_id})
    return _with_placeholders(_serialize(doc))


@api_router.delete("/clients/{client_id}")
async def delete_client(client_id: str, user=Depends(get_current_user)):
    res = await db[COLL].delete_one({"id": client_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Client not found")
    return {"ok": True}
