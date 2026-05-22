"""Permissions (legacy v1 simple matrix, v2 rules engine, presets, effective access, stats)."""
import uuid
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException

from core import (
    api_router, db, log_audit, now_iso, require_role, get_current_user,
    PERMISSION_MODULES, ALL_ACTIONS, SCOPED_ACTIONS, feature_actions,
    action_precedence,
    PermissionsIn, PermRuleIn, PermRulesBulkIn, PresetCreateIn, PresetApplyIn,
)


# ---------- Legacy v1 ----------
@api_router.get("/permissions")
async def get_permissions(user=Depends(require_role("Super Admin"))):
    doc = await db.permissions.find_one({"id": "default"}, {"_id": 0})
    if not doc:
        return {"rules": []}
    return doc


@api_router.put("/permissions")
async def update_permissions(body: PermissionsIn, user=Depends(require_role("Super Admin"))):
    doc = {
        "id": "default",
        "rules": body.rules,
        "updated_on": now_iso(),
        "updated_by": user["id"],
    }
    await db.permissions.update_one({"id": "default"}, {"$set": doc}, upsert=True)
    return doc


# ---------- v2 helpers ----------
def _normalize_filters(r: PermRuleIn) -> Dict[str, Optional[str]]:
    """Convert legacy subject_type/subject_id into role/team_id/employee_id if needed."""
    role, team_id, employee_id = r.role, r.team_id, r.employee_id
    if r.subject_type and r.subject_id:
        if r.subject_type == "role" and not role:
            role = r.subject_id
        elif r.subject_type == "team" and not team_id:
            team_id = r.subject_id
        elif r.subject_type == "employee" and not employee_id:
            employee_id = r.subject_id
    return {"role": role, "team_id": team_id, "employee_id": employee_id}


def _rule_matches_user(rule: dict, user_role: str, user_id: str, team_ids_of_user: set) -> bool:
    if rule.get("role") and rule["role"] != user_role:
        return False
    if rule.get("team_id") and rule["team_id"] not in team_ids_of_user:
        return False
    if rule.get("employee_id") and rule["employee_id"] != user_id:
        return False
    if not any(rule.get(k) for k in ("role", "team_id", "employee_id")):
        return False
    return True


@api_router.get("/permissions/schema")
async def permissions_schema(user=Depends(get_current_user)):
    return {"modules": PERMISSION_MODULES, "actions": ALL_ACTIONS, "scoped_actions": sorted(SCOPED_ACTIONS)}


@api_router.get("/permissions/v2")
async def list_permission_rules_v2(
    user=Depends(require_role("Super Admin")),
    module: Optional[str] = None,
    role: Optional[str] = None,
    team_id: Optional[str] = None,
    employee_id: Optional[str] = None,
):
    q = {}
    if module: q["module"] = module
    if role: q["role"] = role
    if team_id: q["team_id"] = team_id
    if employee_id: q["employee_id"] = employee_id
    rules = await db.permission_rules.find(q, {"_id": 0}).to_list(5000)
    return rules


@api_router.put("/permissions/v2/bulk")
async def bulk_replace_rules(body: PermRulesBulkIn, user=Depends(require_role("Super Admin"))):
    for r in body.rules:
        valid = feature_actions(r.module, r.feature)
        if not valid:
            raise HTTPException(400, f"Unknown feature {r.module}.{r.feature}")
        filters = _normalize_filters(r)
        if not any(filters.values()):
            raise HTTPException(400, f"Rule for {r.module}.{r.feature} has no Role / Team / Employee filter set")
        r.role, r.team_id, r.employee_id = filters["role"], filters["team_id"], filters["employee_id"]
        normalized = {}
        for a in valid:
            v = r.actions.get(a, False)
            if a in SCOPED_ACTIONS and v in ("all", "respective"):
                normalized[a] = v
            else:
                normalized[a] = bool(v)
        r.actions = normalized

    existing_count = await db.permission_rules.count_documents({})
    await db.permission_rules.delete_many({})
    now = now_iso()
    payload = []
    for r in body.rules:
        payload.append({
            "id": str(uuid.uuid4()),
            "module": r.module,
            "feature": r.feature,
            "role": r.role,
            "team_id": r.team_id,
            "employee_id": r.employee_id,
            "actions": r.actions,
            "note": r.note or "",
            "created_on": now,
            "updated_on": now,
            "updated_by": user["id"],
        })
    if payload:
        await db.permission_rules.insert_many(payload)

    await log_audit(
        actor=user, action="permissions.bulk_save", resource="permissions",
        detail=f"Saved {len(payload)} rules (previously {existing_count}).",
        metadata={"count_before": existing_count, "count_after": len(payload)},
        severity="warning",
    )
    return {"count": len(payload)}


@api_router.delete("/permissions/v2/rule/{rule_id}")
async def delete_rule(rule_id: str, user=Depends(require_role("Super Admin"))):
    r = await db.permission_rules.find_one({"id": rule_id})
    if not r:
        raise HTTPException(404, "Not found")
    await db.permission_rules.delete_one({"id": rule_id})
    desc = f"role={r.get('role')} team={r.get('team_id')} emp={r.get('employee_id')}"
    await log_audit(
        actor=user, action="permissions.delete_rule", resource="permissions", resource_id=rule_id,
        detail=f"Deleted rule {r['module']}.{r['feature']} ({desc})",
        severity="warning",
    )
    return {"ok": True}


# ---------- Effective access ----------
def _full_access_effective() -> Dict[str, Dict[str, Dict[str, bool]]]:
    eff: Dict[str, Dict[str, Dict[str, bool]]] = {}
    for m in PERMISSION_MODULES:
        eff[m["key"]] = {}
        for g in m["groups"]:
            for f in g["features"]:
                eff[m["key"]][f["key"]] = {a: True for a in f["actions"]}
    return eff


async def _compute_effective(employee: dict) -> dict:
    """Compute effective access for `employee`.

    v3 semantics:
      * Super Admin → full access on every feature (no sets needed).
      * Admin → OR-union of all assigned Permission Sets.
    Legacy permission_rules are still consulted as a fallback for users with no sets.
    """
    user_role = employee.get("role")
    user_id = employee["id"]

    user_teams = await db.teams.find(
        {"$or": [{"member_ids": user_id}, {"manager_ids": user_id}]},
        {"_id": 0, "id": 1, "name": 1}
    ).to_list(100)
    team_ids_of_user = {t["id"] for t in user_teams}
    primary_team = user_teams[0] if user_teams else None

    employee_block = {
        "id": user_id,
        "name": employee.get("name"),
        "email": employee.get("email"),
        "role": user_role,
        "team_id": primary_team["id"] if primary_team else None,
        "team_name": primary_team["name"] if primary_team else None,
        "team_ids": list(team_ids_of_user),
        "permission_set_ids": list(employee.get("permission_set_ids") or []),
    }

    if user_role == "Super Admin":
        return {
            "employee": employee_block,
            "effective": _full_access_effective(),
            "sources": {"super_admin": True, "sets": []},
            "counts": {"sets": 0, "matching_rules": 0, "total_rules": 0, "is_super_admin": True},
        }

    set_ids = employee_block["permission_set_ids"]
    sets_assigned: List[dict] = []
    if set_ids:
        sets_assigned = await db.permission_sets.find(
            {"id": {"$in": set_ids}}, {"_id": 0}
        ).to_list(500)

    effective: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for s in sets_assigned:
        for mkey, features in (s.get("modules") or {}).items():
            mod_eff = effective.setdefault(mkey, {})
            for fkey, actions in (features or {}).items():
                f_eff = mod_eff.setdefault(fkey, {})
                for action, val in (actions or {}).items():
                    if action not in f_eff:
                        f_eff[action] = bool(val)
                    elif bool(val):
                        f_eff[action] = True

    if not sets_assigned:
        all_rules = await db.permission_rules.find({}, {"_id": 0}).to_list(5000)
        legacy_matches = [r for r in all_rules if _rule_matches_user(r, user_role, user_id, team_ids_of_user)]
        if legacy_matches:
            for r in legacy_matches:
                mkey, fkey = r.get("module"), r.get("feature")
                if not mkey or not fkey:
                    continue
                mod_eff = effective.setdefault(mkey, {})
                f_eff = mod_eff.setdefault(fkey, {})
                for action, val in (r.get("actions") or {}).items():
                    truthy = bool(val) or val in ("all", "respective")
                    if action not in f_eff:
                        f_eff[action] = truthy
                    elif truthy:
                        f_eff[action] = True

    return {
        "employee": employee_block,
        "effective": effective,
        "sources": {
            "super_admin": False,
            "sets": [
                {"id": s["id"], "numeric_id": s.get("numeric_id"), "name": s.get("name")}
                for s in sets_assigned
            ],
        },
        "counts": {
            "sets": len(sets_assigned),
            "matching_rules": 0,
            "total_rules": await db.permission_rules.count_documents({}),
            "is_super_admin": False,
        },
    }


@api_router.get("/permissions/effective/{employee_id}")
async def effective_for_employee(employee_id: str, user=Depends(get_current_user)):
    if user["role"] not in ("Super Admin", "Admin") and user["id"] != employee_id:
        raise HTTPException(403, "Not authorized")
    emp = await db.contacts.find_one({"id": employee_id}, {"_id": 0, "password_hash": 0, "password_encrypted": 0})
    if not emp:
        raise HTTPException(404, "Employee not found")
    return await _compute_effective(emp)


@api_router.get("/permissions/me/effective")
async def effective_for_me(user=Depends(get_current_user)):
    return await _compute_effective(user)


# ---------- Permission Presets ----------
@api_router.get("/permissions/presets")
async def list_presets(user=Depends(require_role("Super Admin"))):
    items = await db.permission_presets.find({}, {"_id": 0}).to_list(500)
    return items


@api_router.post("/permissions/presets")
async def create_preset(body: PresetCreateIn, user=Depends(require_role("Super Admin"))):
    doc = {
        "id": str(uuid.uuid4()),
        "name": body.name,
        "description": body.description or "",
        "module": body.module,
        "rules": body.rules,
        "system": False,
        "created_on": now_iso(),
        "created_by": user["id"],
    }
    await db.permission_presets.insert_one(doc)
    await log_audit(
        actor=user, action="permissions.preset_create", resource="permission_preset",
        resource_id=doc["id"], detail=f"Created preset '{body.name}'", severity="info",
    )
    doc.pop("_id", None)
    return doc


@api_router.post("/permissions/presets/{preset_id}/apply")
async def apply_preset(preset_id: str, body: PresetApplyIn, user=Depends(require_role("Super Admin"))):
    preset = await db.permission_presets.find_one({"id": preset_id}, {"_id": 0})
    if not preset:
        raise HTTPException(404, "Preset not found")
    if not any([body.role, body.team_id, body.employee_id]):
        raise HTTPException(400, "Pick a role, team or employee filter to apply the preset to")
    filter_q = {
        "module": preset["module"],
        "role": body.role,
        "team_id": body.team_id,
        "employee_id": body.employee_id,
    }
    await db.permission_rules.delete_many(filter_q)
    payload = []
    now = now_iso()
    for r in preset["rules"]:
        valid = feature_actions(preset["module"], r["feature"])
        if not valid:
            continue
        actions = {}
        for a in valid:
            v = r.get("actions", {}).get(a, False)
            if a in SCOPED_ACTIONS and v in ("all", "respective"):
                actions[a] = v
            else:
                actions[a] = bool(v)
        payload.append({
            "id": str(uuid.uuid4()),
            "module": preset["module"],
            "feature": r["feature"],
            "role": body.role,
            "team_id": body.team_id,
            "employee_id": body.employee_id,
            "actions": actions,
            "note": f"Applied from preset '{preset['name']}'",
            "created_on": now,
            "updated_on": now,
            "updated_by": user["id"],
        })
    if payload:
        await db.permission_rules.insert_many(payload)
    target_desc = " + ".join(f"{k}={v}" for k, v in [("role", body.role), ("team", body.team_id), ("emp", body.employee_id)] if v)
    await log_audit(
        actor=user, action="permissions.preset_apply", resource="permission_preset", resource_id=preset_id,
        detail=f"Applied preset '{preset['name']}' to {target_desc} ({len(payload)} rules)",
        severity="info",
    )
    return {"count": len(payload)}


@api_router.get("/permissions/stats")
async def permissions_stats(user=Depends(require_role("Super Admin"))):
    roles_distinct = await db.contacts.distinct("role")
    total_rules = await db.permission_rules.count_documents({})
    compound_rules = 0
    employees_with_overrides = set()
    restricted = 0
    async for r in db.permission_rules.find({}, {"actions": 1, "role": 1, "team_id": 1, "employee_id": 1}):
        filters_set = sum(1 for k in ("role", "team_id", "employee_id") if r.get(k))
        if filters_set > 1:
            compound_rules += 1
        if r.get("employee_id"):
            employees_with_overrides.add(r["employee_id"])
        for v in (r.get("actions") or {}).values():
            if v is False:
                restricted += 1
    return {
        "total_roles": len(roles_distinct),
        "total_rules": total_rules,
        "employees_with_overrides": len(employees_with_overrides),
        "restricted_actions": restricted,
        "compound_rules": compound_rules,
    }
