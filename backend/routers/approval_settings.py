"""Approval Settings — Auto-Approval configuration.

Stored as a singleton document (id="singleton") in the `approval_settings`
collection. Updated shape (Jul 2026):

    {
      "id": "singleton",
      "enabled": bool,                     # master ON/OFF switch
      "matrix": {
        "workstation":  {
          "team_member": bool,
          "manager": bool,
          "date": { "enabled": bool, "mode": "on"|"before"|"after"|"between",
                    "from": "YYYY-MM-DD"|null, "to": "YYYY-MM-DD"|null },
          "time": { "enabled": bool, "operator": "on"|"before"|"after"|"between",
                    "from": "HH:MM"|null, "to": "HH:MM"|null },
        },
        "meeting_room": { <same shape> },
      },
      "updated_at": ISO-8601,
      "updated_by": { id, email, name },
    }

Legacy shape:
  * `recurring` bool cells are still accepted on read but are ignored on write.

Rule evaluation
===============
When `enabled` is True and ANY configured cell matches the incoming request
the request is auto-approved (OR semantics):

  * team_member: matches when submitter is NOT in any team's manager_ids.
  * manager    : matches when submitter IS in some team's manager_ids.
  * date       : compares booking date against the configured mode/from/to.
  * time       : compares booking time-of-day (or submission time for
                 workstation, since workstation requests are full-day) against
                 the configured operator/from/to (24-h HH:MM).

Empty / disabled cells simply don't participate — they neither auto-approve
nor block the flow.
"""

from __future__ import annotations

import datetime as _dt
from typing import Any, Optional
from fastapi import Depends, HTTPException
from pydantic import BaseModel

from core import api_router, db, require_role, now_iso, log_audit, ist_now
from routers.permissions_v3 import require_v3_function


# --------------------------------------------------------------------------- #
# Constants & defaults                                                        #
# --------------------------------------------------------------------------- #

SINGLETON_ID = "singleton"
RESOURCES = ("workstation", "meeting_room")
BOOL_CRITERIA = ("team_member", "manager")
DATE_MODES = ("on", "before", "after", "between")
TIME_OPS = ("on", "before", "after", "between")


def _empty_date_rule() -> dict:
    return {"enabled": False, "mode": "on", "from": None, "to": None}


def _empty_time_rule() -> dict:
    return {"enabled": False, "operator": "on", "from": None, "to": None}


def _empty_duration_rule() -> dict:
    # Auto-approve any meeting whose scheduled length is <= value (converted
    # to minutes using unit). Applies to meeting_room; ignored elsewhere.
    return {"enabled": False, "value": 30, "unit": "min"}


DURATION_UNITS = ("min", "hour")


def _default_row() -> dict:
    return {
        "team_member": False,
        "manager": False,
        "date": _empty_date_rule(),
        "time": _empty_time_rule(),
        "duration": _empty_duration_rule(),
    }


def _default_matrix() -> dict:
    return {r: _default_row() for r in RESOURCES}


def _default_settings() -> dict:
    return {
        "id": SINGLETON_ID,
        "enabled": False,
        "matrix": _default_matrix(),
        "updated_at": None,
        "updated_by": None,
    }


def _sanitize_date_rule(v: Any) -> dict:
    out = _empty_date_rule()
    if not isinstance(v, dict):
        return out
    out["enabled"] = bool(v.get("enabled"))
    mode = str(v.get("mode") or "on").lower()
    out["mode"] = mode if mode in DATE_MODES else "on"
    d_from = v.get("from")
    d_to = v.get("to")
    out["from"] = d_from if (isinstance(d_from, str) and d_from) else None
    out["to"] = d_to if (isinstance(d_to, str) and d_to) else None
    return out


def _sanitize_time_rule(v: Any) -> dict:
    out = _empty_time_rule()
    if not isinstance(v, dict):
        return out
    out["enabled"] = bool(v.get("enabled"))
    op = str(v.get("operator") or "on").lower()
    out["operator"] = op if op in TIME_OPS else "on"
    t_from = v.get("from")
    t_to = v.get("to")
    out["from"] = t_from if (isinstance(t_from, str) and t_from) else None
    out["to"] = t_to if (isinstance(t_to, str) and t_to) else None
    return out


def _sanitize_duration_rule(v: Any) -> dict:
    out = _empty_duration_rule()
    if not isinstance(v, dict):
        return out
    out["enabled"] = bool(v.get("enabled"))
    try:
        raw_val = int(v.get("value") or 0)
    except Exception:
        raw_val = 0
    # Clamp to 1..60 (UI dropdown range). 0/negative falls back to the default 30.
    if raw_val <= 0:
        raw_val = 30
    out["value"] = max(1, min(60, raw_val))
    unit = str(v.get("unit") or "min").lower()
    out["unit"] = unit if unit in DURATION_UNITS else "min"
    return out


def _duration_rule_minutes(rule: Optional[dict]) -> int:
    """Convert a duration rule into total minutes (value × unit)."""
    if not rule:
        return 0
    try:
        v = int(rule.get("value") or 0)
    except Exception:
        v = 0
    if v <= 0:
        return 0
    return v * 60 if (rule.get("unit") == "hour") else v


def _sanitize(matrix: Any) -> dict:
    """Return a matrix dict guaranteed to have every resource + criterion cell."""
    clean = _default_matrix()
    if not isinstance(matrix, dict):
        return clean
    for r in RESOURCES:
        row = matrix.get(r) or {}
        if not isinstance(row, dict):
            continue
        for c in BOOL_CRITERIA:
            clean[r][c] = bool(row.get(c))
        clean[r]["date"] = _sanitize_date_rule(row.get("date"))
        clean[r]["time"] = _sanitize_time_rule(row.get("time"))
        clean[r]["duration"] = _sanitize_duration_rule(row.get("duration"))
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
    """Any signed-in Admin can read the current settings. Only Super Admin can write."""
    return await get_settings()


@api_router.put("/approval-settings")
async def update_approval_settings(
    payload: SettingsIn,
    user=Depends(require_v3_function("desk_booking", "pending_approvals", "configure_auto_approval")),
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
                # bool criteria
                for c in BOOL_CRITERIA:
                    if c in incoming:
                        merged[r][c] = bool(incoming[c])
                # date rule
                if "date" in incoming:
                    merged[r]["date"] = _sanitize_date_rule(incoming.get("date"))
                # time rule
                if "time" in incoming:
                    merged[r]["time"] = _sanitize_time_rule(incoming.get("time"))
                # duration rule (meeting_room only, but we still persist any
                # incoming value on other resources so admins don't lose it).
                if "duration" in incoming:
                    merged[r]["duration"] = _sanitize_duration_rule(incoming.get("duration"))
        new_doc["matrix"] = merged

    actor = {"id": user.get("id"), "email": user.get("email"), "name": user.get("name")}
    return await _write_settings(new_doc, actor=actor, previous=current)


@api_router.post("/approval-settings/reset")
async def reset_approval_settings(user=Depends(require_v3_function("desk_booking", "pending_approvals", "configure_auto_approval"))):
    """Reset to defaults — Auto-Approval OFF, every cell unchecked."""
    current = await get_settings()
    defaults = {"enabled": False, "matrix": _default_matrix()}
    actor = {"id": user.get("id"), "email": user.get("email"), "name": user.get("name")}
    return await _write_settings(defaults, actor=actor, previous=current)


# --------------------------------------------------------------------------- #
# Rule evaluation — used by the workstation requests router                    #
# --------------------------------------------------------------------------- #

async def is_manager(submitter: dict) -> bool:
    """A submitter is a Manager if their contact id (or email fallback)
    appears in any team's `manager_ids` list."""
    if not submitter:
        return False
    ids = [x for x in [submitter.get("id"), submitter.get("email")] if x]
    if not ids:
        return False
    hit = await db.teams.find_one({"manager_ids": {"$in": ids}}, {"_id": 0, "id": 1})
    return hit is not None


def _parse_iso_date(s: Optional[str]) -> Optional[_dt.date]:
    if not s or not isinstance(s, str):
        return None
    try:
        return _dt.date.fromisoformat(s)
    except Exception:
        return None


def _parse_hhmm(s: Optional[str]) -> Optional[_dt.time]:
    if not s or not isinstance(s, str):
        return None
    try:
        parts = s.split(":")
        if len(parts) < 2:
            return None
        h = int(parts[0]); m = int(parts[1])
        return _dt.time(hour=max(0, min(23, h)), minute=max(0, min(59, m)))
    except Exception:
        return None


def matches_date_rule(rule: dict, booking_date: Optional[str]) -> bool:
    """Return True iff `booking_date` (YYYY-MM-DD) satisfies the configured
    date rule. Disabled or unconfigured rules return False (they don't match)."""
    if not rule or not rule.get("enabled"):
        return False
    b = _parse_iso_date(booking_date)
    if b is None:
        return False
    mode = (rule.get("mode") or "on").lower()
    d_from = _parse_iso_date(rule.get("from"))
    d_to = _parse_iso_date(rule.get("to"))
    if mode == "on":
        return d_from is not None and b == d_from
    if mode == "before":
        return d_from is not None and b < d_from
    if mode == "after":
        return d_from is not None and b > d_from
    if mode == "between":
        if d_from is None:
            return False
        end = d_to if d_to is not None else d_from
        lo, hi = (d_from, end) if d_from <= end else (end, d_from)
        return lo <= b <= hi
    return False


def matches_time_rule(rule: dict, booking_time: Optional[str]) -> bool:
    """Return True iff `booking_time` (HH:MM 24-h) satisfies the time rule."""
    if not rule or not rule.get("enabled"):
        return False
    bt = _parse_hhmm(booking_time)
    if bt is None:
        return False
    op = (rule.get("operator") or "on").lower()
    t_from = _parse_hhmm(rule.get("from"))
    t_to = _parse_hhmm(rule.get("to"))
    if op == "on":
        return t_from is not None and bt == t_from
    if op == "before":
        return t_from is not None and bt < t_from
    if op == "after":
        return t_from is not None and bt > t_from
    if op == "between":
        if t_from is None:
            return False
        end = t_to if t_to is not None else t_from
        lo, hi = (t_from, end) if t_from <= end else (end, t_from)
        return lo <= bt <= hi
    return False


def matches_duration_rule(rule: dict, booking_duration_minutes: Optional[int]) -> bool:
    """Return True iff the meeting length is <= the configured duration
    (converted to minutes). Disabled/unconfigured rules return False."""
    if not rule or not rule.get("enabled"):
        return False
    if booking_duration_minutes is None:
        return False
    try:
        dur = int(booking_duration_minutes)
    except Exception:
        return False
    if dur <= 0:
        return False
    threshold = _duration_rule_minutes(rule)
    if threshold <= 0:
        return False
    return dur <= threshold


async def should_auto_approve_workstation(
    submitter: dict,
    is_recurring: bool = False,  # kept for signature compat; unused
    booking_date: Optional[str] = None,
    booking_time: Optional[str] = None,
) -> bool:
    """Return True if the workstation request should be auto-approved.

    OR semantics — any configured criterion that matches triggers approval.
    Date/Time rules must be independently enabled to participate.
    """
    return await _match_matrix_row(
        submitter, "workstation",
        booking_date=booking_date,
        booking_time=booking_time,
        booking_duration_minutes=None,
    )


async def should_auto_approve_meeting_room(
    submitter: dict,
    booking_date: Optional[str] = None,
    booking_time: Optional[str] = None,
    booking_duration_minutes: Optional[int] = None,
) -> bool:
    """Return True if the meeting-room request should be auto-approved.

    Uses the `meeting_room` cell of the approval-settings matrix. Same OR
    semantics as workstation: team-member / manager / date / time /
    duration — any matching enabled cell triggers auto-approval. The
    duration rule matches when the meeting's scheduled length is <= the
    configured value.
    """
    return await _match_matrix_row(
        submitter, "meeting_room",
        booking_date=booking_date,
        booking_time=booking_time,
        booking_duration_minutes=booking_duration_minutes,
    )


async def _match_matrix_row(
    submitter: dict,
    resource: str,
    booking_date: Optional[str],
    booking_time: Optional[str],
    booking_duration_minutes: Optional[int] = None,
) -> bool:
    """Shared auto-approval logic for workstation + meeting-room.

    AND + OR semantics (not a flat OR):

        (Manager  AND Date AND Time [AND Duration])
      OR
        (Team Member AND Date AND Time [AND Duration])

    where only the criteria actually configured (enabled) are included. The
    two role selections (Manager / Team Member) form OR-ed rule *sets*; the
    attribute criteria (Date / Time / Duration) are AND-ed *within* each set.
    Because the attribute set is identical across both role sets, this reduces
    to: the submitter must belong to one of the configured roles AND every
    configured attribute must match. Duration participates for meeting rooms
    only — it is never evaluated for workstations.
    """
    settings = await get_settings()
    if not settings.get("enabled"):
        return False
    row = (settings.get("matrix") or {}).get(resource) or {}

    # Role sets that are configured (OR-ed together).
    configured_roles = [r for r in ("manager", "team_member") if row.get(r)]

    # Configured attribute criteria + whether each currently matches. These are
    # AND-ed together inside every role set.
    attr_checks: list[bool] = []

    date_rule = row.get("date") or {}
    if date_rule.get("enabled"):
        attr_checks.append(matches_date_rule(date_rule, booking_date))

    # Time + Duration apply to meeting rooms only. A workstation booking has a
    # date but no time-of-day, so the Time rule is never evaluated for it.
    if resource == "meeting_room":
        time_rule = row.get("time") or {}
        if time_rule.get("enabled"):
            time_of_day = booking_time
            if not time_of_day:
                now = ist_now()
                time_of_day = f"{now.hour:02d}:{now.minute:02d}"
            attr_checks.append(matches_time_rule(time_rule, time_of_day))

        dur_rule = row.get("duration") or {}
        if dur_rule.get("enabled"):
            attr_checks.append(matches_duration_rule(dur_rule, booking_duration_minutes))

    # Nothing configured for this resource → no auto-approval.
    if not configured_roles and not attr_checks:
        return False

    # Role gate: when any role set is configured, each set is scoped to its
    # role, so the submitter must belong to one of the configured roles. When
    # no role is configured, the attribute criteria apply to everyone.
    if configured_roles:
        submitter_role = "manager" if await is_manager(submitter) else "team_member"
        if submitter_role not in configured_roles:
            return False

    # Attribute gate: ALL configured attributes must match (AND).
    if not all(attr_checks):
        return False

    return True
