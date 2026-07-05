"""Profile endpoints.

  GET  /api/profile/me          — current user enriched with team_name + permission_set_names
  POST /api/profile/avatar      — upload an image file (max ~2MB) as the avatar (stored base64 on the doc)
  POST /api/profile/avatar/preset — set avatar to a predefined cartoon preset (just stores a slug)
  DELETE /api/profile/avatar    — reset avatar to initials (default)

Avatar storage model on the contact document:
  avatar_kind:     "initials" (default) | "preset" | "upload"
  avatar_preset:   slug like "memoji-1" (only if kind="preset")
  avatar_image:    base64 data URL "data:image/png;base64,..." (only if kind="upload")
"""
from __future__ import annotations

import base64
import logging
from typing import Optional

from fastapi import Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from core import api_router, db, get_current_user, log_audit, now_iso

logger = logging.getLogger(__name__)

# Max uploaded avatar size — keep small since we embed base64 in the contact doc.
MAX_AVATAR_BYTES = 2 * 1024 * 1024  # 2 MB raw

# Allowed presets — must match the frontend AVATAR_PRESET_DEFS slugs.
# These render as 3D Fluent Microsoft emoji from a public CDN.
ALLOWED_PRESETS = {
    "smile", "beam", "grin", "heart-eyes", "halo", "sunglasses",
    "star-struck", "savoring", "monocle", "nerd", "party", "hearts",
}

# Allowed initials-color palettes — must match the frontend INITIALS_PALETTES list.
# Storing the palette id (e.g. "p1") rather than the raw hex pair keeps the
# server free to evolve the actual gradients without re-migrating documents.
ALLOWED_COLORS = {f"p{i}" for i in range(1, 13)}

ALLOWED_IMAGE_MIMES = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}


async def _resolve_team_name(user_id: str) -> str:
    """Return the team name the user is mapped to (as a member), or '' if none.

    If a user is in multiple teams, return the first one (alphabetically by name)
    to keep this deterministic.
    """
    team = await db.teams.find_one(
        {"member_ids": user_id},
        {"_id": 0, "name": 1},
        sort=[("name", 1)],
    )
    return (team or {}).get("name", "") or ""


async def _resolve_permission_set_names(ids: list[str]) -> list[str]:
    if not ids:
        return []
    cursor = db.permission_sets.find({"id": {"$in": ids}}, {"_id": 0, "name": 1})
    docs = await cursor.to_list(length=len(ids))
    return [d.get("name") for d in docs if d.get("name")]


@api_router.get("/profile/me")
async def get_my_profile(user: dict = Depends(get_current_user)):
    # Re-load to pick up avatar / password_changed_at fields that get_current_user already returns,
    # but normalize defaults here.
    team_name = await _resolve_team_name(user["id"])
    pset_ids = user.get("permission_set_ids") or []
    pset_names = await _resolve_permission_set_names(pset_ids)
    return {
        "id": user["id"],
        "name": user.get("name") or "",
        "email": user.get("email"),
        "phone": user.get("phone") or "",
        "emp_id": user.get("emp_id") or "",
        "doj": user.get("doj") or "",
        "role": user.get("role"),
        "status": user.get("status"),
        "team_name": team_name,
        "permission_set_ids": pset_ids,
        "permission_set_names": pset_names,
        "last_login": user.get("last_login"),
        "password_changed_at": user.get("password_changed_at"),
        "created_on": user.get("created_on"),
        "avatar_kind": user.get("avatar_kind") or "initials",
        "avatar_preset": user.get("avatar_preset"),
        "avatar_image": user.get("avatar_image"),
        "avatar_color": user.get("avatar_color"),
        "preferences": {
            "default_dashboard": (user.get("preferences") or {}).get("default_dashboard") or "workspace_manager",
        },
    }


ALLOWED_DEFAULT_DASHBOARDS = {"workspace_manager", "profix"}


class PreferencesIn(BaseModel):
    default_dashboard: Optional[str] = None


@api_router.patch("/profile/preferences")
async def update_preferences(body: PreferencesIn, user: dict = Depends(get_current_user)):
    """Update the current user's per-account preferences (currently just
    `default_dashboard`). Fields left as None are ignored."""
    updates = {}
    if body.default_dashboard is not None:
        if body.default_dashboard not in ALLOWED_DEFAULT_DASHBOARDS:
            raise HTTPException(400, f"Unknown default_dashboard: {body.default_dashboard}")
        updates["preferences.default_dashboard"] = body.default_dashboard
    if not updates:
        raise HTTPException(400, "Nothing to update")
    await db.contacts.update_one({"id": user["id"]}, {"$set": updates})
    await log_audit(
        actor=user, action="profile.preferences_update", resource="profile",
        resource_id=user["id"],
        detail=f"{user.get('email')} updated preferences: {updates}",
        severity="info",
    )
    fresh = await db.contacts.find_one({"id": user["id"]}, {"_id": 0, "preferences": 1})
    prefs = (fresh or {}).get("preferences") or {}
    return {
        "ok": True,
        "preferences": {
            "default_dashboard": prefs.get("default_dashboard") or "workspace_manager",
        },
    }


class SetPresetIn(BaseModel):
    preset: str


class SetInitialsColorIn(BaseModel):
    color: str  # palette id like "p1"


@api_router.post("/profile/avatar/initials")
async def set_avatar_initials(body: SetInitialsColorIn, user: dict = Depends(get_current_user)):
    """Pick a specific gradient shade for the initials avatar.

    Setting this also flips avatar_kind back to "initials" (so callers don't
    have to clear preset/upload separately).
    """
    if body.color not in ALLOWED_COLORS:
        raise HTTPException(400, f"Unknown initials color: {body.color}")
    await db.contacts.update_one(
        {"id": user["id"]},
        {"$set": {"avatar_kind": "initials", "avatar_color": body.color},
         "$unset": {"avatar_preset": "", "avatar_image": ""}},
    )
    await log_audit(
        actor=user, action="profile.avatar_initials_color", resource="profile",
        resource_id=user["id"],
        detail=f"{user.get('email')} set initials avatar color to {body.color}",
        severity="info",
    )
    return {"ok": True, "avatar_kind": "initials", "avatar_color": body.color}


@api_router.post("/profile/avatar/preset")
async def set_avatar_preset(body: SetPresetIn, user: dict = Depends(get_current_user)):
    if body.preset not in ALLOWED_PRESETS:
        raise HTTPException(400, f"Unknown avatar preset: {body.preset}")
    await db.contacts.update_one(
        {"id": user["id"]},
        {"$set": {"avatar_kind": "preset", "avatar_preset": body.preset},
         "$unset": {"avatar_image": ""}},
    )
    await log_audit(
        actor=user, action="profile.avatar_preset", resource="profile",
        resource_id=user["id"],
        detail=f"{user.get('email')} set avatar preset to {body.preset}", severity="info",
    )
    return {"ok": True, "avatar_kind": "preset", "avatar_preset": body.preset}


@api_router.post("/profile/avatar")
async def upload_avatar(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    if file.content_type not in ALLOWED_IMAGE_MIMES:
        raise HTTPException(400, f"Unsupported image type: {file.content_type}")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty upload")
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(400, f"Image too large — max {MAX_AVATAR_BYTES // (1024 * 1024)} MB")
    b64 = base64.b64encode(data).decode("ascii")
    data_url = f"data:{file.content_type};base64,{b64}"
    await db.contacts.update_one(
        {"id": user["id"]},
        {"$set": {"avatar_kind": "upload", "avatar_image": data_url},
         "$unset": {"avatar_preset": ""}},
    )
    await log_audit(
        actor=user, action="profile.avatar_upload", resource="profile",
        resource_id=user["id"],
        detail=f"{user.get('email')} uploaded a new avatar ({len(data)} bytes)",
        metadata={"size": len(data), "mime": file.content_type}, severity="info",
    )
    return {"ok": True, "avatar_kind": "upload", "avatar_image": data_url}


@api_router.delete("/profile/avatar")
async def clear_avatar(user: dict = Depends(get_current_user)):
    await db.contacts.update_one(
        {"id": user["id"]},
        {"$set": {"avatar_kind": "initials"},
         "$unset": {"avatar_preset": "", "avatar_image": "", "avatar_color": ""}},
    )
    return {"ok": True, "avatar_kind": "initials"}
