"""Teams: CRUD + color palette."""
import uuid
from typing import Optional

from fastapi import Depends, HTTPException

from core import (
    api_router, db, log_audit, now_iso, require_role, get_current_user,
    TEAM_COLOR_PALETTE,
    TeamCreate, TeamUpdate,
)


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


@api_router.get("/teams/colors")
async def team_colors(user=Depends(get_current_user)):
    """Return palette + which colors are already taken."""
    used = await db.teams.distinct("color")
    suggested = await _next_unused_color()
    return {"palette": TEAM_COLOR_PALETTE, "used": [c for c in used if c], "suggested": suggested}


@api_router.get("/teams")
async def list_teams(user=Depends(get_current_user)):
    teams = await db.teams.find({}, {"_id": 0}).sort("created_on", -1).to_list(2000)
    all_ids = {mid for t in teams for mid in (t.get("manager_ids") or []) + (t.get("member_ids") or [])}
    contacts = []
    if all_ids:
        contacts = await db.contacts.find({"id": {"$in": list(all_ids)}}, {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1}).to_list(2000)
    name_map = {c["id"]: c for c in contacts}
    for t in teams:
        t["managers"] = [name_map.get(mid, {"id": mid, "name": "Unknown"}) for mid in (t.get("manager_ids") or [])]
        t["members"] = [name_map.get(mid, {"id": mid, "name": "Unknown"}) for mid in (t.get("member_ids") or [])]
    return teams


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
    color = body.color
    if not color:
        color = await _next_unused_color()
    # Enforce one-team-per-colour: a colour already taken by another team
    # cannot be re-assigned, even via direct API. (Frontend already disables
    # such swatches; this is the defence-in-depth check.)
    clash = await db.teams.find_one({"color": color})
    if clash:
        raise HTTPException(400, f"Colour already in use by team '{clash['name']}'. Pick a different shade.")
    doc = {
        "id": str(uuid.uuid4()),
        "name": body.name.strip(),
        "manager_ids": list({*body.manager_ids}),
        "member_ids": member_ids,
        "color": color,
        "initials": _normalize_initials(body.initials),
        "created_on": now_iso(),
        "updated_on": now_iso(),
    }
    await db.teams.insert_one(doc)
    doc.pop("_id", None)
    await log_audit(
        actor=user, action="team.create", resource="team", resource_id=doc["id"],
        detail=f"Created team '{doc['name']}' with {len(doc['member_ids'])} members",
        severity="info",
    )
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
    if "member_ids" in update:
        member_ids = list({*update["member_ids"]})
        if member_ids:
            conflict = await db.teams.find_one({"id": {"$ne": team_id}, "member_ids": {"$in": member_ids}})
            if conflict:
                raise HTTPException(400, f"Some members already belong to team '{conflict['name']}'")
        update["member_ids"] = member_ids
    if "manager_ids" in update:
        update["manager_ids"] = list({*update["manager_ids"]})
    if "color" in update and update["color"]:
        clash = await db.teams.find_one({"id": {"$ne": team_id}, "color": update["color"]})
        if clash:
            raise HTTPException(400, f"Colour already in use by team '{clash['name']}'. Pick a different shade.")
    if "initials" in update:
        update["initials"] = _normalize_initials(update["initials"])
    update["updated_on"] = now_iso()
    await db.teams.update_one({"id": team_id}, {"$set": update})
    t = await db.teams.find_one({"id": team_id}, {"_id": 0})
    return t


@api_router.delete("/teams/{team_id}")
async def delete_team(team_id: str, user=Depends(require_role("Super Admin"))):
    await db.teams.delete_one({"id": team_id})
    return {"ok": True}
