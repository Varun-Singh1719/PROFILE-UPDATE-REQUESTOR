"""CRM → Client Contact → Notes.

Free-text notes (max 1000 chars) attached to a Client Contact. Every add /
edit / delete is also written to the contact's immutable Timeline
(field "Note", action added / edited / deleted, with value snapshots).

    client_contact_notes
    --------------------
    id, contact_id, text,
    created_by {id,name,email,emp_id}, created_at,
    updated_by {..} | None, updated_at | None
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from core import api_router, db, now_iso, get_current_user
from routers.client_contact_timeline import record_entries

COLL = "client_contact_notes"
CC_COLL = "client_contacts"
MAX_LEN = 1000


class NoteIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_LEN)

    @field_validator("text")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Note cannot be empty")
        if len(v) > MAX_LEN:
            raise ValueError(f"Note cannot exceed {MAX_LEN} characters")
        return v


def _actor(user: dict) -> dict:
    return {
        "id": user.get("id"),
        "name": user.get("name") or user.get("email") or "Unknown",
        "email": user.get("email"),
        "emp_id": user.get("emp_id"),
    }


def _ser(d: dict) -> dict:
    return {k: v for k, v in d.items() if k != "_id"}


async def _ensure_contact(contact_id: str) -> None:
    if not await db[CC_COLL].find_one({"id": contact_id}, {"_id": 1}):
        raise HTTPException(404, "Client contact not found")


@api_router.get("/client-contacts/{contact_id}/notes")
async def list_notes(contact_id: str, user=Depends(get_current_user)):
    await _ensure_contact(contact_id)
    rows = await db[COLL].find({"contact_id": contact_id}).sort("created_at", -1).to_list(500)
    return {"rows": [_ser(r) for r in rows], "total": len(rows), "max_length": MAX_LEN}


@api_router.post("/client-contacts/{contact_id}/notes")
async def add_note(contact_id: str, body: NoteIn, user=Depends(get_current_user)):
    await _ensure_contact(contact_id)
    doc = {
        "id": str(uuid.uuid4()),
        "contact_id": contact_id,
        "text": body.text,
        "created_by": _actor(user),
        "created_at": now_iso(),
        "updated_by": None,
        "updated_at": None,
    }
    await db[COLL].insert_one(doc)
    await record_entries(contact_id, user, [
        {"field": "note", "action": "added", "previous_value": None, "new_value": body.text},
    ], event="note")
    return _ser(doc)


@api_router.patch("/client-contacts/{contact_id}/notes/{note_id}")
async def edit_note(contact_id: str, note_id: str, body: NoteIn, user=Depends(get_current_user)):
    existing = await db[COLL].find_one({"id": note_id, "contact_id": contact_id})
    if not existing:
        raise HTTPException(404, "Note not found")
    if existing["text"] == body.text:
        return _ser(existing)
    upd = {"text": body.text, "updated_by": _actor(user), "updated_at": now_iso()}
    await db[COLL].update_one({"id": note_id}, {"$set": upd})
    await record_entries(contact_id, user, [
        {"field": "note", "action": "edited", "previous_value": existing["text"], "new_value": body.text},
    ], event="note")
    return _ser({**existing, **upd})


@api_router.delete("/client-contacts/{contact_id}/notes/{note_id}")
async def delete_note(contact_id: str, note_id: str, user=Depends(get_current_user)):
    existing = await db[COLL].find_one({"id": note_id, "contact_id": contact_id})
    if not existing:
        raise HTTPException(404, "Note not found")
    await db[COLL].delete_one({"id": note_id})
    await record_entries(contact_id, user, [
        {"field": "note", "action": "deleted", "previous_value": existing["text"], "new_value": None},
    ], event="note")
    return {"ok": True}
