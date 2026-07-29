"""Teams: CRUD + color palette."""
import uuid
from typing import Optional

from fastapi import Depends, HTTPException

from core import (
    api_router, db, log_audit, now_iso, require_role, get_current_user,
    TEAM_COLOR_PALETTE,
    TeamCreate, TeamUpdate,
)
from routers.permissions_v3 import has_v3_page_view, require_v3_page_view, has_any_v3_module_access


async def _next_unused_color(exclude_team_id: Optional[str] = None) -> str:
    """Pick the first palette color not yet used by another team."""
    q = {}
    if exclude_team_id:
        q["id"] = {"$ne": exclude_team_id}
    used = await db.teams.distinct("color", q)
    used_set = {c for c in used if c}
    for c in TEAM_COLOR_PALETTE:
        if c not in used_set:
            return c
    n = await db.teams.count_documents({})
    return TEAM_COLOR_PALETTE[n % len(TEAM_COLOR_PALETTE)]


def _normalize_initials(raw: Optional[str]) -> Optional[str]:
    """Trim, uppercase, strip non-letters/digits, cap at 2 chars. Empty → None."""
    if not raw:
        return None
    cleaned = "".join(ch for ch in str(raw).strip().upper() if ch.isalnum())[:2]
    return cleaned or None


def _actor_ref(user) -> dict:
    """Small embed doc for created_by / updated_by."""
    return {
        "id": user.get("id"),
        "name": user.get("name") or user.get("email"),
        "email": user.get("email"),
    }


async def _hydrate_team(t: dict, name_map: Optional[dict] = None) -> dict:
    """Attach `managers` / `members` / `created_by` / `updated_by` objects.

    Non-destructive: pass a preloaded `name_map` (id -> contact) or omit and
    it will be fetched here (single-team endpoints).
    """
    if name_map is None:
        ids = set(t.get("manager_ids") or []) | set(t.get("member_ids") or [])
        for k in ("created_by", "updated_by"):
            ref = t.get(k)
            if isinstance(ref, dict) and ref.get("id"):
                ids.add(ref["id"])
        contacts = []
        if ids:
            contacts = await db.contacts.find(
                {"id": {"$in": list(ids)}},
                {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "emp_id": 1},
            ).to_list(2000)
        name_map = {c["id"]: c for c in contacts}

    t["managers"] = [
        name_map.get(mid, {"id": mid, "name": "Unknown"})
        for mid in (t.get("manager_ids") or [])
    ]
    t["members"] = [
        name_map.get(mid, {"id": mid, "name": "Unknown"})
        for mid in (t.get("member_ids") or [])
    ]
    # Refresh embedded created_by / updated_by names in case the contact was
    # renamed after the team was created.
    for k in ("created_by", "updated_by"):
        ref = t.get(k)
        if isinstance(ref, dict) and ref.get("id"):
            latest = name_map.get(ref["id"])
            if latest:
                ref["name"] = latest.get("name") or ref.get("name")
                ref["email"] = latest.get("email") or ref.get("email")
    return t


@api_router.get("/teams/colors")
async def team_colors(user=Depends(get_current_user)):
    """Return palette + which colors are already taken."""
    used = await db.teams.distinct("color")
    suggested = await _next_unused_color()
    return {"palette": TEAM_COLOR_PALETTE, "used": [c for c in used if c], "suggested": suggested}


@api_router.get("/teams")
async def list_teams(user=Depends(get_current_user)):
    teams = await db.teams.find({}, {"_id": 0}).sort("created_on", -1).to_list(2000)
    # Batch-load all referenced contacts (members, managers, created_by, updated_by).
    all_ids = set()
    for t in teams:
        all_ids.update(t.get("manager_ids") or [])
        all_ids.update(t.get("member_ids") or [])
        for k in ("created_by", "updated_by"):
            ref = t.get(k)
            if isinstance(ref, dict) and ref.get("id"):
                all_ids.add(ref["id"])
    contacts = []
    if all_ids:
        contacts = await db.contacts.find(
            {"id": {"$in": list(all_ids)}},
            {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "emp_id": 1},
        ).to_list(2000)
    name_map = {c["id"]: c for c in contacts}
    for t in teams:
        await _hydrate_team(t, name_map)

    # Backend permission-leak fix (Jul 29 2026): if the caller is NOT a
    # Super Admin AND does not have manage.teams.view, return a lite payload
    # (id/name/color/initials/counts only). This keeps cross-module features
    # like the team filter on ticket lists and the team dropdown on booking
    # forms working, while preventing leaks of member emails/roles.
    #
    # QA D6/D8 fix (Aug 2026): the lite payload is only shared with users
    # who legitimately need it for cross-module usage (profix or desk_booking
    # pages). Users with zero applicable permissions (e.g. Admins on an empty
    # set or on a manage-only set without teams.view) get 403.
    can_manage_teams = await has_v3_page_view(user, "manage", "teams")
    if can_manage_teams:
        return teams
    can_use_lite = await has_any_v3_module_access(user, "profix", "desk_booking")
    if not can_use_lite:
        raise HTTPException(403, "Access denied to manage.teams")
    lite = []
    for t in teams:
        lite.append({
            "id": t.get("id"),
            "name": t.get("name"),
            "color": t.get("color"),
            "initials": t.get("initials"),
            "member_count": len(t.get("member_ids") or []),
            "manager_count": len(t.get("manager_ids") or []),
        })
    return lite


@api_router.get("/teams/{team_id}")
async def get_team(team_id: str, user=Depends(require_v3_page_view("manage", "teams"))):
    t = await db.teams.find_one({"id": team_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Team not found")
    await _hydrate_team(t)
    return t


@api_router.post("/teams")
async def create_team(body: TeamCreate, user=Depends(require_role("Super Admin"))):
    if not body.name.strip():
        raise HTTPException(400, "Team name required")
    if await db.teams.find_one({"name": body.name.strip()}):
        raise HTTPException(400, "Team name already exists")
    member_ids = list({*body.member_ids})
    if member_ids:
        conflict = await db.teams.find_one({"member_ids": {"$in": member_ids}})
        if conflict:
            raise HTTPException(400, f"Some members already belong to team '{conflict['name']}'")
    manager_ids = list({*body.manager_ids})
    # NOTE: managers are intentionally NOT restricted to one team — a user may
    # manage multiple teams (per Jul-2026 spec).
    color = body.color
    if not color:
        color = await _next_unused_color()
    # Enforce one-team-per-colour: a colour already taken by another team
    # cannot be re-assigned, even via direct API. (Frontend already disables
    # such swatches; this is the defence-in-depth check.)
    clash = await db.teams.find_one({"color": color})
    if clash:
        raise HTTPException(400, f"Colour already in use by team '{clash['name']}'. Pick a different shade.")
    now = now_iso()
    actor = _actor_ref(user)
    doc = {
        "id": str(uuid.uuid4()),
        "name": body.name.strip(),
        "description": (body.description or "").strip(),
        "manager_ids": manager_ids,
        "member_ids": member_ids,
        "color": color,
        "initials": _normalize_initials(body.initials),
        "created_on": now,
        "updated_on": now,
        "created_by": actor,
        "updated_by": actor,
    }
    await db.teams.insert_one(doc)
    doc.pop("_id", None)
    await log_audit(
        actor=user, action="team.create", resource="team", resource_id=doc["id"],
        detail=f"Created team '{doc['name']}' with {len(doc['member_ids'])} members",
        severity="info",
    )
    await _hydrate_team(doc)
    return doc


@api_router.patch("/teams/{team_id}")
async def update_team(team_id: str, body: TeamUpdate, user=Depends(require_role("Super Admin"))):
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(404, "Team not found")
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if "name" in update:
        update["name"] = update["name"].strip()
        if update["name"] != team["name"]:
            other = await db.teams.find_one({"name": update["name"]})
            if other:
                raise HTTPException(400, "Team name already exists")
    if "description" in update:
        update["description"] = (update["description"] or "").strip()
    if "member_ids" in update:
        member_ids = list({*update["member_ids"]})
        if member_ids:
            conflict = await db.teams.find_one({"id": {"$ne": team_id}, "member_ids": {"$in": member_ids}})
            if conflict:
                raise HTTPException(400, f"Some members already belong to team '{conflict['name']}'")
        update["member_ids"] = member_ids
    if "manager_ids" in update:
        # Managers may belong to multiple teams; only dedupe.
        update["manager_ids"] = list({*update["manager_ids"]})
    if "color" in update and update["color"]:
        clash = await db.teams.find_one({"id": {"$ne": team_id}, "color": update["color"]})
        if clash:
            raise HTTPException(400, f"Colour already in use by team '{clash['name']}'. Pick a different shade.")
    if "initials" in update:
        update["initials"] = _normalize_initials(update["initials"])
    update["updated_on"] = now_iso()
    update["updated_by"] = _actor_ref(user)
    await db.teams.update_one({"id": team_id}, {"$set": update})
    t = await db.teams.find_one({"id": team_id}, {"_id": 0})
    await _hydrate_team(t)
    return t


@api_router.delete("/teams/{team_id}")
async def delete_team(team_id: str, user=Depends(require_role("Super Admin"))):
    await db.teams.delete_one({"id": team_id})
    return {"ok": True}
