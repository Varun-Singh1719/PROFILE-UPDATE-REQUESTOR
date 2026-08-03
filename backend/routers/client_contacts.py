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

import re
import uuid
from typing import Optional, List

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from core import api_router, db, now_iso, get_current_user


COLL = "client_contacts"
COUNTER_KEY = "client_contact_seq"


# ---------- helpers (dedup) ----------
def _norm_email(v: Optional[str]) -> str:
    return (v or "").strip().lower()


def _norm_phone(v: Optional[str]) -> str:
    """Strip everything except digits. Used only for duplicate detection —
    we still store the original user-typed value verbatim."""
    return re.sub(r"\D", "", (v or ""))


def _phone_key(v: Optional[str]) -> str:
    """Return the last 10 digits of a phone number, used as a dedup key.
    Handles inputs with or without country code — '+91 9876543210',
    '919876543210', '9876543210' all map to '9876543210'. Numbers shorter
    than 10 digits are returned as-is (some corporate lines are 4-8 digits)."""
    digits = re.sub(r"\D", "", (v or ""))
    return digits[-10:] if len(digits) >= 10 else digits


async def _find_duplicates(
    email: Optional[str],
    phone: Optional[str],
    exclude_id: Optional[str] = None,
) -> list[dict]:
    """Return matching client-contact rows whose email OR normalized phone
    equals the input. Empty inputs are ignored. `exclude_id` skips the row
    being edited so patches don't self-collide."""
    ne = _norm_email(email)
    pk = _phone_key(phone)
    if not ne and not pk:
        return []

    # Broad prefilter — fetch a small candidate set from Mongo, then confirm
    # the semantic match in Python (so phone-country-code mismatches are
    # handled correctly without storing a normalized copy).
    prefilter: list = []
    if ne:
        prefilter.append({"email": re.compile(f"^{re.escape(ne)}$", re.IGNORECASE)})
    if pk:
        # Regex on the trailing 10 digits — Mongo can't do this cleanly, so
        # we just fetch any doc whose phone field contains any of these digits.
        prefilter.append({"phone": {"$regex": re.escape(pk), "$options": "i"}})

    q: dict = {"$or": prefilter}
    if exclude_id:
        q["id"] = {"$ne": exclude_id}

    hits: list = []
    async for d in db[COLL].find(
        q,
        {"_id": 0, "id": 1, "display_id": 1, "name": 1, "email": 1, "phone": 1, "phone_isd": 1, "client_name": 1, "designation": 1},
    ).limit(50):
        match_on: list[str] = []
        if ne and (d.get("email") or "").strip().lower() == ne:
            match_on.append("email")
        if pk and _phone_key(d.get("phone")) == pk:
            match_on.append("phone")
        if match_on:
            d["match_on"] = match_on
            hits.append(d)
    return hits



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
    phone_isd: Optional[str] = Field(None, max_length=8)
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
    phone_isd: Optional[str] = Field(None, max_length=8)
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
    payload: ClientContactCreate,
    force: bool = Query(False, description="Skip duplicate-detection (email/phone) — set to true after showing the user the duplicate warning dialog"),
    user=Depends(get_current_user),
):
    # Duplicate detection — email + phone. Returns HTTP 409 with the list of
    # matches so the frontend can render a "Duplicate found" dialog. The
    # frontend then either cancels OR re-submits with ?force=true.
    if not force:
        dups = await _find_duplicates(payload.email, payload.phone)
        if dups:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "DUPLICATE_CLIENT_CONTACT",
                    "message": "A client contact with the same email or phone already exists.",
                    "duplicates": dups,
                },
            )
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


@api_router.get("/client-contacts/check-duplicate")
async def check_duplicate(
    email: Optional[str] = Query(None),
    phone: Optional[str] = Query(None),
    exclude_id: Optional[str] = Query(None, description="Skip this contact id (for edit flows)"),
    user=Depends(get_current_user),
):
    """Live duplicate-check for the create/edit form. Returns
    `{duplicates: [...]}` — empty list means no conflict."""
    dups = await _find_duplicates(email, phone, exclude_id=exclude_id)
    return {"duplicates": dups}


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
    contact_id: str,
    payload: ClientContactUpdate,
    force: bool = Query(False),
    user=Depends(get_current_user),
):
    existing = await db[COLL].find_one({"id": contact_id})
    if not existing:
        raise HTTPException(404, "Client contact not found")
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None or True}
    # Duplicate check runs only when the user actually changed email/phone.
    if not force:
        new_email = updates.get("email", existing.get("email"))
        new_phone = updates.get("phone", existing.get("phone"))
        dups = await _find_duplicates(new_email, new_phone, exclude_id=contact_id)
        if dups:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "DUPLICATE_CLIENT_CONTACT",
                    "message": "A different client contact already has this email or phone.",
                    "duplicates": dups,
                },
            )
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
