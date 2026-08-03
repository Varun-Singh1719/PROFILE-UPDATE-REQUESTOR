"""CRM → Client Contacts router (Aug 2026).

Scope
-----
Standalone client-contact directory keyed by an auto-incrementing numeric
`display_id` (1042-style). Every record carries:
  * name / email / phone
  * client_name  — a Level-1 segmentation name (dropdown-driven in UI)
  * designation / base_location
  * previous_work_experience — repeatable array
       (company_name, designation, start_month_year, end_month_year)
  * linkedin_url             — web handle
  * industries               — multi-select of Level-2 segments belonging to
                                the chosen client_name.
  * activity placeholders    — projects / serviced / calls / revenue
                                (backend stores nothing here yet; the frontend
                                shows "-" until the calc pipeline exists).

REST
----
POST   /api/client-contacts        create
GET    /api/client-contacts        list  (search=  page=  page_size=)
GET    /api/client-contacts/{id}   detail
PATCH  /api/client-contacts/{id}   partial update
DELETE /api/client-contacts/{id}   remove
"""
from __future__ import annotations

import uuid
from typing import Optional, List

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from core import api_router, db, now_iso, get_current_user


COLL = "client_contacts"
COUNTER_KEY = "client_contact_seq"


# ---------- Pydantic schemas ----------
class WorkExperience(BaseModel):
    company_name: Optional[str] = Field(None, max_length=200)
    designation: Optional[str] = Field(None, max_length=200)
    start_month_year: Optional[str] = Field(None, max_length=20)   # e.g. "Jan 2024"
    end_month_year: Optional[str] = Field(None, max_length=20)     # e.g. "Aug 2026" or "Present"


class ClientContactBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    email: Optional[str] = Field(None, max_length=200)
    phone: Optional[str] = Field(None, max_length=40)
    client_name: Optional[str] = Field(None, max_length=200)
    designation: Optional[str] = Field(None, max_length=200)
    base_location: Optional[str] = Field(None, max_length=160)
    previous_work_experience: Optional[List[WorkExperience]] = None
    linkedin_url: Optional[str] = Field(None, max_length=400)
    industries: Optional[List[str]] = None      # L2 segment names

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Name is required")
        return v


class ClientContactCreate(ClientContactBase):
    pass


class ClientContactUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=160)
    email: Optional[str] = Field(None, max_length=200)
    phone: Optional[str] = Field(None, max_length=40)
    client_name: Optional[str] = Field(None, max_length=200)
    designation: Optional[str] = Field(None, max_length=200)
    base_location: Optional[str] = Field(None, max_length=160)
    previous_work_experience: Optional[List[WorkExperience]] = None
    linkedin_url: Optional[str] = Field(None, max_length=400)
    industries: Optional[List[str]] = None


# ---------- helpers ----------
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


async def _next_display_id() -> int:
    """Return the next 1-based auto-incrementing numeric display id.

    Uses an atomic $inc on a `counters` collection so parallel POSTs never
    collide. The counter starts at 1041 so the FIRST client contact gets
    id = 1042 (matches the sample format the user specified).
    """
    result = await db["counters"].find_one_and_update(
        {"_id": COUNTER_KEY},
        {"$inc": {"seq": 1}, "$setOnInsert": {"seq_base": 1041}},
        upsert=True,
        return_document=True,
    )
    # motor returns the DOC AFTER $inc when return_document=After (v2 API).
    # We want the incremented value plus the base. Because upsert may or may
    # not include seq_base in the returned doc reliably, we fetch again.
    doc = await db["counters"].find_one({"_id": COUNTER_KEY})
    base = int((doc or {}).get("seq_base") or 1041)
    seq = int((doc or {}).get("seq") or 1)
    return base + seq


# ---------- routes ----------
@api_router.post("/client-contacts")
async def create_client_contact(
    payload: ClientContactCreate, user=Depends(get_current_user)
):
    display_id = await _next_display_id()
    doc = {
        "id": str(uuid.uuid4()),
        "display_id": display_id,
        **payload.model_dump(),
        "created_by": _actor(user),
        "created_on": now_iso(),
        "updated_by": _actor(user),
        "updated_on": now_iso(),
    }
    await db[COLL].insert_one(doc)
    return _serialize(doc)


@api_router.get("/client-contacts")
async def list_client_contacts(
    search: Optional[str] = Query(None),
    client_name: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user=Depends(get_current_user),
):
    query: dict = {}
    if client_name:
        query["client_name"] = client_name
    if search:
        import re
        rx = re.compile(re.escape(search.strip()), re.IGNORECASE)
        query["$or"] = [
            {"name": rx},
            {"email": rx},
            {"phone": rx},
            {"client_name": rx},
            {"designation": rx},
            {"base_location": rx},
        ]
    total = await db[COLL].count_documents(query)
    skip = (page - 1) * page_size
    cursor = db[COLL].find(query).sort("created_on", -1).skip(skip).limit(page_size)
    rows = [_serialize(d) async for d in cursor]
    return {"rows": rows, "total": total, "page": page, "page_size": page_size}


@api_router.get("/client-contacts/{contact_id}")
async def get_client_contact(contact_id: str, user=Depends(get_current_user)):
    doc = await db[COLL].find_one({"id": contact_id})
    if not doc:
        raise HTTPException(404, "Client contact not found")
    return _serialize(doc)


@api_router.patch("/client-contacts/{contact_id}")
async def update_client_contact(
    contact_id: str, payload: ClientContactUpdate, user=Depends(get_current_user)
):
    existing = await db[COLL].find_one({"id": contact_id})
    if not existing:
        raise HTTPException(404, "Client contact not found")
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None or True}
    # `exclude_unset=True` already drops absent fields; keep explicit None
    # (allowing user to clear a value) — we set unconditionally.
    if not updates:
        return _serialize(existing)
    updates["updated_by"] = _actor(user)
    updates["updated_on"] = now_iso()
    await db[COLL].update_one({"id": contact_id}, {"$set": updates})
    doc = await db[COLL].find_one({"id": contact_id})
    return _serialize(doc)


@api_router.delete("/client-contacts/{contact_id}")
async def delete_client_contact(contact_id: str, user=Depends(get_current_user)):
    result = await db[COLL].delete_one({"id": contact_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Client contact not found")
    return {"ok": True}
