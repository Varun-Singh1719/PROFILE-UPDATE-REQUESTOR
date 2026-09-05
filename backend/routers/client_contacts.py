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
from typing import Optional, List, Dict, Any

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


CONTACT_TYPES = ["Domain Specific", "Domain Agnostic", "Central Team"]


def _clean_contact_type(v):
    if v is None:
        return None
    v = str(v).strip()
    if v == "":
        return None
    if v not in CONTACT_TYPES:
        raise ValueError(f"Type must be one of {CONTACT_TYPES}")
    return v


class ClientContactBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    email: Optional[str] = Field(None, max_length=200)
    phone: Optional[str] = Field(None, max_length=40)
    phone_isd: Optional[str] = Field(None, max_length=8)
    client_name: Optional[str] = Field(None, max_length=200)
    designation: Optional[str] = Field(None, max_length=200)
    type: Optional[str] = Field(None, max_length=40)   # Domain Specific | Domain Agnostic | Central Team
    base_location: Optional[str] = Field(None, max_length=160)
    city: Optional[str] = Field(None, max_length=120)
    country_id: Optional[int] = None            # preserved from Country List (id) for future reference
    country_name: Optional[str] = Field(None, max_length=120)
    previous_work_experience: Optional[List[WorkExperience]] = None
    linkedin_url: Optional[str] = Field(None, max_length=400)
    industries: Optional[List[str]] = None      # L2 segment names
    # Metric placeholders — will be replaced by the real calc pipeline later.
    # `totals_till_date` = { projects, serviced, calls, revenue } ints.
    # `activity_by_month` = { projects: {"YYYY-MM": n}, serviced: {...}, ... }.
    # `last_project_receiving_date` / `last_call_date` = ISO date strings.
    totals_till_date: Optional[Dict[str, int]] = None
    activity_by_month: Optional[Dict[str, Dict[str, int]]] = None
    last_project_receiving_date: Optional[str] = Field(None, max_length=32)
    last_call_date: Optional[str] = Field(None, max_length=32)

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Name is required")
        return v

    @field_validator("type")
    @classmethod
    def _validate_type(cls, v):
        return _clean_contact_type(v)


class ClientContactCreate(ClientContactBase):
    pass


class ClientContactUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=160)
    email: Optional[str] = Field(None, max_length=200)
    phone: Optional[str] = Field(None, max_length=40)
    phone_isd: Optional[str] = Field(None, max_length=8)
    client_name: Optional[str] = Field(None, max_length=200)
    designation: Optional[str] = Field(None, max_length=200)
    type: Optional[str] = Field(None, max_length=40)
    base_location: Optional[str] = Field(None, max_length=160)
    city: Optional[str] = Field(None, max_length=120)
    country_id: Optional[int] = None
    country_name: Optional[str] = Field(None, max_length=120)
    previous_work_experience: Optional[List[WorkExperience]] = None
    linkedin_url: Optional[str] = Field(None, max_length=400)
    industries: Optional[List[str]] = None
    totals_till_date: Optional[Dict[str, int]] = None
    activity_by_month: Optional[Dict[str, Dict[str, int]]] = None
    last_project_receiving_date: Optional[str] = Field(None, max_length=32)
    last_call_date: Optional[str] = Field(None, max_length=32)

    @field_validator("type")
    @classmethod
    def _validate_type(cls, v):
        return _clean_contact_type(v)


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
    # Conditional requirement: "Domain Specific" contacts must have at least
    # one Industry selected.
    if payload.type == "Domain Specific" and not (payload.industries or []):
        raise HTTPException(400, "Industry is required when Type is 'Domain Specific'")
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
    # POC Status: central engine annotates every row inline
    from routers.poc_status import annotate_status as _poc_annotate
    await _poc_annotate(rows)
    return {"rows": rows, "total": total, "page": page, "page_size": page_size}


@api_router.get("/client-contacts/{contact_id}/by-client")
async def client_contact_by_client(contact_id: str, user=Depends(get_current_user)):
    """Projects / Calls broken down by the contact's EMPLOYERS (current client +
    previous work experience), computed from the MySQL mirror:
        projects = COUNT(DISTINCT mysql_projects.id) whose client_contacts list
                   contains the contact and whose client_id is that employer
        calls    = COUNT(DISTINCT mysql_calls.id) with fk_project in those projects
    Employers with no MySQL data are still listed with zeros. Order: current first,
    then previous employers (most recent first)."""
    doc = await db[COLL].find_one({"id": contact_id})
    if not doc:
        raise HTTPException(404, "Client contact not found")

    employers = []
    if doc.get("client_name"):
        employers.append({"client": doc["client_name"], "current": True,
                          "designation": doc.get("designation") or ""})
    prev = list(doc.get("previous_work_experience") or [])
    # most recent first (by start_month_year text is unreliable → keep stored order reversed)
    for w in reversed(prev):
        if w.get("company_name"):
            employers.append({"client": w["company_name"], "current": False,
                              "designation": w.get("designation") or "",
                              "start": w.get("start_month_year"), "end": w.get("end_month_year")})

    # Numbers from the mirror (only when this contact is linked to a MySQL id)
    by_client: Dict[int, dict] = {}
    mid = (doc.get("mysql_ref") or {}).get("mysql_id")
    if mid is not None:
        projs = [p async for p in db["mysql_projects"].find(
            {"client_contact_ids": int(mid)}, {"_id": 1, "client_id": 1, "receiving_date": 1})]
        pid_to_client = {p["_id"]: p.get("client_id") for p in projs}
        for p in projs:
            b = by_client.setdefault(p.get("client_id"), {"projects": set(), "last_project": None,
                                                            "calls": set(), "last_call": None})
            b["projects"].add(p["_id"])
            rd = p.get("receiving_date")
            if rd and (b["last_project"] is None or rd > b["last_project"]):
                b["last_project"] = rd
        if pid_to_client:
            async for c in db["mysql_calls"].find({"fk_project": {"$in": list(pid_to_client)}},
                                                  {"_id": 1, "fk_project": 1, "call_start_time": 1}):
                b = by_client.get(pid_to_client.get(c["fk_project"]))
                if b is None:
                    continue
                b["calls"].add(c["_id"])
                st = c.get("call_start_time")
                if st and (b["last_call"] is None or st > b["last_call"]):
                    b["last_call"] = st
    # client_id → name
    names = {}
    if by_client:
        async for c in db["mysql_clients"].find({"_id": {"$in": [k for k in by_client if k is not None]}},
                                                {"_id": 1, "name": 1}):
            names[c["_id"]] = (c.get("name") or "").strip()
    by_name = {names[k].lower(): v for k, v in by_client.items() if k in names}

    def _iso(v):
        return v.isoformat() if hasattr(v, "isoformat") else v

    rows, used = [], set()
    for e in employers:
        b = by_name.get(e["client"].strip().lower())
        used.add(e["client"].strip().lower())
        rows.append({**e,
                     "projects": len(b["projects"]) if b else 0,
                     "last_project_date": _iso(b["last_project"]) if b else None,
                     "calls": len(b["calls"]) if b else 0,
                     "last_call_date": _iso(b["last_call"]) if b else None})
    # Any MySQL client with data that is not in the work experience list
    for k, b in by_client.items():
        nm = names.get(k, "")
        if not nm or nm.lower() in used:
            continue
        rows.append({"client": nm, "current": False, "designation": "", "unlisted": True,
                     "projects": len(b["projects"]), "last_project_date": _iso(b["last_project"]),
                     "calls": len(b["calls"]), "last_call_date": _iso(b["last_call"])})
    return {"rows": rows, "linked": mid is not None}


@api_router.get("/client-contacts/{contact_id}")
async def get_client_contact(contact_id: str, user=Depends(get_current_user)):
    doc = await db[COLL].find_one({"id": contact_id})
    if not doc:
        raise HTTPException(404, "Client contact not found")
    row = _serialize(doc)
    from routers.poc_status import annotate_status as _poc_annotate
    await _poc_annotate([row])
    return row


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
    # Conditional requirement: if the resulting record is "Domain Specific", it
    # must have at least one Industry. Merge patch with the stored doc so a
    # partial update (e.g. only changing `type`) is validated correctly.
    eff_type = updates.get("type", existing.get("type"))
    eff_industries = updates.get("industries", existing.get("industries")) or []
    if eff_type == "Domain Specific" and not eff_industries:
        raise HTTPException(400, "Industry is required when Type is 'Domain Specific'")
    updates["updated_by"] = _actor(user)
    updates["updated_on"] = now_iso()
    await db[COLL].update_one({"id": contact_id}, {"$set": updates})
    doc = await db[COLL].find_one({"id": contact_id})
    row = _serialize(doc)
    # If the field driving POC Status changed, refresh cached key + annotate
    if "last_project_receiving_date" in updates:
        from routers.poc_status import (
            annotate_status as _poc_annotate,
            compute_status as _poc_compute,
            get_active_config as _poc_cfg,
        )
        cfg = await _poc_cfg()
        s = _poc_compute(doc, cfg)
        await db[COLL].update_one(
            {"id": contact_id},
            {"$set": {"poc_status_key": s["key"], "poc_status_computed_at": now_iso()}},
        )
    from routers.poc_status import annotate_status as _poc_annotate2
    await _poc_annotate2([row])
    return row


@api_router.delete("/client-contacts/{contact_id}")
async def delete_client_contact(contact_id: str, user=Depends(get_current_user)):
    result = await db[COLL].delete_one({"id": contact_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Client contact not found")
    return {"ok": True}
