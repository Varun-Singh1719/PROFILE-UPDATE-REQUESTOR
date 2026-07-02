"""Approval Settings — Auto-Approval configuration.

Stored as a singleton document (id="singleton") in the `approval_settings`
collection.  Shape:

    {
      "id": "singleton",
      "enabled": bool,                     # master ON/OFF switch
      "matrix": {
        "workstation":  { "team_member": bool, "manager": bool, "recurring": bool },
        "meeting_room": { "team_member": bool, "manager": bool, "recurring": bool },
      },
      "updated_at": ISO-8601,
      "updated_by": { id, email, name },
    }

Phase-1 enforcement:
  * Workstation requests → `matrix.workstation.team_member` / `.manager`
    (recurring cell is stored but not applied since workstation *requests*
    are single-day only today.)
  * Meeting Room → config saved, no enforcement yet (workflow doesn't exist).

Rule evaluation (see `evaluate_workstation_request`):

    is_manager = submitter is listed in any team's `manager_ids`.
    match = ((is_manager  AND matrix.workstation.manager) OR
            (NOT is_manager AND matrix.workstation.team_member) OR
            (request.recurring is truthy AND matrix.workstation.recurring))

If `enabled` is False the settings are inert and every request goes to the
manual queue.
"""

from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import api_router, db, require_role, now_iso, log_audit


# --------------------------------------------------------------------------- #
# Constants & defaults                                                        #
# --------------------------------------------------------------------------- #

SINGLETON_ID = "singleton"
RESOURCES = ("workstation", "meeting_room")
CRITERIA = ("team_member", "manager", "recurring")


def _default_matrix() -> dict:
    return {r: {c: False for c in CRITERIA} for r in RESOURCES}


def _default_settings() -> dict:
    return {
        "id": SINGLETON_ID,
        "enabled": False,
        "matrix": _default_matrix(),
        "updated_at": None,
        "updated_by": None,
    }


def _sanitize(matrix: dict) -> dict:
    """Return a matrix dict guaranteed to contain every resource × criterion cell."""
    clean = _default_matrix()
    if not isinstance(matrix, dict):
        return clean
    for r in RESOURCES:
        row = matrix.get(r) or {}
        if isinstance(row, dict):
            for c in CRITERIA:
                clean[r][c] = bool(row.get(c))
    return clean


# --------------------------------------------------------------------------- #
# Pydantic input                                                              #
# --------------------------------------------------------------------------- #

class MatrixIn(BaseModel):
    workstation: Optional[dict] = None
    meeting_room: Optional[dict] = None


class SettingsIn(BaseModel):
    enabled: Optional[bool] = None
    matrix: Optional[MatrixIn] = None


# --------------------------------------------------------------------------- #
# Storage helpers                                                             #
# --------------------------------------------------------------------------- #

async def get_settings() -> dict:
    """Load the singleton settings doc; auto-create defaults on first read."""
    doc = await db.approval_settings.find_one({"id": SINGLETON_ID}, {"_id": 0})
    if not doc:
        doc = _default_settings()
        await db.approval_settings.insert_one({**doc})
        doc.pop("_id", None)
        return doc
    # Backfill any missing cells so consumers never crash on absent keys.
    doc["enabled"] = bool(doc.get("enabled", False))
    doc["matrix"] = _sanitize(doc.get("matrix") or {})
    return doc


async def _write_settings(new_doc: dict, actor: dict, previous: dict) -> dict:
    """Persist and log an audit trail entry."""
    new_doc["id"] = SINGLETON_ID
    new_doc["updated_at"] = now_iso()
    new_doc["updated_by"] = actor
    await db.approval_settings.update_one(
        {"id": SINGLETON_ID}, {"$set": new_doc}, upsert=True,
    )
    await log_audit(
        actor=actor,
        action="approval_settings.update",
        resource="approval_settings",
        resource_id=SINGLETON_ID,
        detail=(
            f"Auto-Approval {'ENABLED' if new_doc.get('enabled') else 'DISABLED'} — "
            f"matrix updated"
        ),
        metadata={
            "previous": {
                "enabled": bool(previous.get("enabled", False)),
                "matrix": previous.get("matrix") or _default_matrix(),
            },
            "next": {
                "enabled": bool(new_doc.get("enabled", False)),
                "matrix": new_doc.get("matrix") or _default_matrix(),
            },
        },
    )
    return await get_settings()


# --------------------------------------------------------------------------- #
# Endpoints                                                                    #
# --------------------------------------------------------------------------- #

@api_router.get("/approval-settings")
async def read_approval_settings(user=Depends(require_role("Super Admin", "Admin"))):
    """Any signed-in Admin can read the current settings (needed to show the
    toggle state on the Pending Approvals page). Only Super Admin can write."""
    return await get_settings()


@api_router.put("/approval-settings")
async def update_approval_settings(
    payload: SettingsIn,
    user=Depends(require_role("Super Admin")),
):
    """Update the enabled flag and/or matrix. Fields omitted are left untouched."""
    if payload.enabled is None and payload.matrix is None:
        raise HTTPException(400, "Nothing to update — provide enabled or matrix")

    current = await get_settings()
    new_doc = {
        "enabled": current["enabled"] if payload.enabled is None else bool(payload.enabled),
        "matrix": current["matrix"],
    }
    if payload.matrix is not None:
        merged = _sanitize(current["matrix"])
        for r in RESOURCES:
            incoming = getattr(payload.matrix, r, None)
            if isinstance(incoming, dict):
                for c in CRITERIA:
                    if c in incoming:
                        merged[r][c] = bool(incoming[c])
        new_doc["matrix"] = merged

    actor = {"id": user.get("id"), "email": user.get("email"), "name": user.get("name")}
    return await _write_settings(new_doc, actor=actor, previous=current)


@api_router.post("/approval-settings/reset")
async def reset_approval_settings(user=Depends(require_role("Super Admin"))):
    """Reset to defaults — Auto-Approval OFF, every cell unchecked."""
    current = await get_settings()
    defaults = {"enabled": False, "matrix": _default_matrix()}
    actor = {"id": user.get("id"), "email": user.get("email"), "name": user.get("name")}
    return await _write_settings(defaults, actor=actor, previous=current)


# --------------------------------------------------------------------------- #
# Rule evaluation — used by the workstation requests router                    #
# --------------------------------------------------------------------------- #

async def is_manager(submitter: dict) -> bool:
    """A submitter is considered a Manager if their contact id (or email as
    fallback) appears in any team's `manager_ids` list."""
    if not submitter:
        return False
    ids = [x for x in [submitter.get("id"), submitter.get("email")] if x]
    if not ids:
        return False
    hit = await db.teams.find_one({"manager_ids": {"$in": ids}}, {"_id": 0, "id": 1})
    return hit is not None


async def should_auto_approve_workstation(submitter: dict, is_recurring: bool = False) -> bool:
    """Return True if the workstation request should be auto-approved based
    on the current settings + the submitter's manager status."""
    settings = await get_settings()
    if not settings.get("enabled"):
        return False
    matrix = settings.get("matrix") or _default_matrix()
    ws = matrix.get("workstation") or {}
    submitter_is_manager = await is_manager(submitter)
    if submitter_is_manager and ws.get("manager"):
        return True
    if (not submitter_is_manager) and ws.get("team_member"):
        return True
    if is_recurring and ws.get("recurring"):
        return True
    return False
