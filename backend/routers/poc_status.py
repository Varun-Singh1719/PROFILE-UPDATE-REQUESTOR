"""CRM → POC Status Configuration + Status Engine  (Aug 04 2026)

Per-client configuration
========================
Each Client has its own POC Status configuration (one active config per
client at a time). A Client Contact's status is derived from the config of
its parent Client (matched by `client_name` on the contact ⇢ `name` on the
client). Two statuses today (Active, Dormant), designed so more (Warm /
Cold / Inactive / Archived) can be added later without touching the data
model or the persistence layer.

REST
----
GET  /api/poc-status/statuses                        → status catalogue
GET  /api/clients/{client_id}/poc-status/config      → that client's active config (or null)
PUT  /api/clients/{client_id}/poc-status/config      → replace that client's config
                                                       (recomputes every Client Contact
                                                        belonging to this client only)

Centralised engine
------------------
`compute_status(contact, config, today=None)` is the ONE function everyone
uses. It returns a dict `{key, label, color}` from the STATUSES table so
the frontend renders identical chips everywhere. When a contact has no
config for its client, the safe default is Active (never crash the UI).
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional, List, Dict

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from core import api_router, db, now_iso, get_current_user, IST

COLL_CONFIG  = "poc_status_config"
COLL_CONTACT = "client_contacts"
COLL_CLIENT  = "clients"

UNITS = ["days", "weeks", "months", "years"]
UNIT_TO_DAYS = {
    "days":   1,
    "weeks":  7,
    "months": 30,   # calendar-approx, good enough for status classification
    "years":  365,
}

# Status catalogue — order matters (first matching predicate wins).
# `predicate(diff_days, threshold_days) → bool`. Dormant is the terminal
# catch-all so a new status can safely be inserted ABOVE it later.
STATUSES = [
    {
        "key": "active",
        "label": "Active",
        "color": "green",
        "predicate": lambda diff, threshold: diff is not None and diff < threshold,
    },
    {
        "key": "dormant",
        "label": "Dormant",
        "color": "red",
        "predicate": lambda diff, threshold: True,
    },
]


# ============================================================
#                           SCHEMAS
# ============================================================
class ConfigIn(BaseModel):
    duration: int = Field(..., ge=1, le=12)
    unit: str

    @field_validator("unit")
    @classmethod
    def _unit(cls, v):
        v = (v or "").strip().lower()
        if v not in UNITS:
            raise ValueError(f"unit must be one of {UNITS}")
        return v


# ============================================================
#                       CONFIG HELPERS
# ============================================================
async def get_active_config_for_client(client_id: str) -> Optional[dict]:
    doc = await db[COLL_CONFIG].find_one({"client_id": client_id, "active": True})
    if not doc:
        return None
    return {k: v for k, v in doc.items() if k != "_id"}


async def _client_by_id(client_id: str) -> Optional[dict]:
    return await db[COLL_CLIENT].find_one({"id": client_id})


async def _client_by_name(name: str) -> Optional[dict]:
    if not name:
        return None
    import re
    return await db[COLL_CLIENT].find_one(
        {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}
    )


def threshold_days_for(config: Optional[dict]) -> Optional[int]:
    if not config:
        return None
    unit = (config.get("unit") or "").lower()
    duration = int(config.get("duration") or 0)
    if duration <= 0 or unit not in UNIT_TO_DAYS:
        return None
    return duration * UNIT_TO_DAYS[unit]


# ============================================================
#                       STATUS ENGINE  (CENTRAL)
# ============================================================
def _parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        if "T" in s:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        return datetime.strptime(s[:10], "%Y-%m-%d")
    except Exception:
        return None


def compute_status(
    contact: dict,
    config: Optional[dict],
    today: Optional[datetime] = None,
) -> dict:
    """Return { key, label, color } for this contact given the config."""
    threshold = threshold_days_for(config)
    if threshold is None:
        # No config → safe default Active (frontend never shows a broken chip).
        s = STATUSES[0]
        return {"key": s["key"], "label": s["label"], "color": s["color"]}

    last_dt = _parse_date(contact.get("last_project_receiving_date"))
    if today is None:
        today = datetime.now(IST).replace(tzinfo=None)
    diff = None
    if last_dt is not None:
        diff = (today - last_dt.replace(tzinfo=None)).days

    if diff is None:
        s = next((st for st in STATUSES if st["key"] == "dormant"), STATUSES[-1])
        return {"key": s["key"], "label": s["label"], "color": s["color"]}

    for st in STATUSES:
        if st["predicate"](diff, threshold):
            return {"key": st["key"], "label": st["label"], "color": st["color"]}
    s = STATUSES[-1]
    return {"key": s["key"], "label": s["label"], "color": s["color"]}


async def annotate_status(contacts: List[dict]) -> List[dict]:
    """Attach `poc_status` (dict) to a list of contact rows.

    Batches the config lookups: builds a `{client_name → config}` cache so
    a page of N contacts requires at most `distinct(client_name)` DB reads.
    """
    if not contacts:
        return contacts
    # Distinct client names on this page
    names = sorted({c.get("client_name") or "" for c in contacts if c.get("client_name")})
    config_cache: Dict[str, Optional[dict]] = {}
    if names:
        # Resolve names → client ids in one round-trip
        import re
        cursor = db[COLL_CLIENT].find(
            {"name": {"$in": names}},  # exact case first
            {"_id": 0, "id": 1, "name": 1},
        )
        name_to_id: Dict[str, str] = {}
        async for d in cursor:
            name_to_id[d["name"]] = d["id"]
        # Case-insensitive fallback for any misses
        for n in names:
            if n in name_to_id:
                continue
            match = await _client_by_name(n)
            if match:
                name_to_id[n] = match["id"]
        # Fetch configs
        client_ids = list(name_to_id.values())
        if client_ids:
            cursor = db[COLL_CONFIG].find({"client_id": {"$in": client_ids}, "active": True})
            id_to_cfg: Dict[str, dict] = {}
            async for d in cursor:
                id_to_cfg[d["client_id"]] = {k: v for k, v in d.items() if k != "_id"}
            for name, cid in name_to_id.items():
                config_cache[name] = id_to_cfg.get(cid)

    for c in contacts:
        cfg = config_cache.get(c.get("client_name") or "")
        c["poc_status"] = compute_status(c, cfg)
    return contacts


async def recompute_client_contacts(client_id: str) -> int:
    """Recompute every Client Contact belonging to a given Client id.

    Stores just the status KEY as `poc_status_key`. Fresh label + colour
    are attached on read via `annotate_status`.
    """
    client = await _client_by_id(client_id)
    if not client:
        return 0
    name = client.get("name") or ""
    if not name:
        return 0
    config = await get_active_config_for_client(client_id)
    import re
    q = {"client_name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}
    n = 0
    async for c in db[COLL_CONTACT].find(q):
        s = compute_status(c, config)
        await db[COLL_CONTACT].update_one(
            {"id": c.get("id")},
            {"$set": {"poc_status_key": s["key"], "poc_status_computed_at": now_iso()}},
        )
        n += 1
    return n


# ============================================================
#                          ROUTES
# ============================================================
@api_router.get("/poc-status/statuses")
async def list_statuses(user=Depends(get_current_user)):
    return {
        "statuses": [
            {"key": s["key"], "label": s["label"], "color": s["color"]}
            for s in STATUSES
        ],
        "units": UNITS,
    }


@api_router.get("/clients/{client_id}/poc-status/config")
async def get_client_config(client_id: str, user=Depends(get_current_user)):
    client = await _client_by_id(client_id)
    if not client:
        raise HTTPException(404, "Client not found")
    cfg = await get_active_config_for_client(client_id)
    return {"config": cfg, "client_id": client_id, "client_name": client.get("name")}


@api_router.put("/clients/{client_id}/poc-status/config")
async def upsert_client_config(
    client_id: str, payload: ConfigIn, user=Depends(get_current_user)
):
    client = await _client_by_id(client_id)
    if not client:
        raise HTTPException(404, "Client not found")
    # Deactivate any prior configs for this client (kept as history)
    await db[COLL_CONFIG].update_many(
        {"client_id": client_id, "active": True},
        {"$set": {"active": False}},
    )
    now = now_iso()
    doc = {
        "id": f"cfg-{int(datetime.now(IST).timestamp() * 1000)}",
        "client_id": client_id,
        "client_name": client.get("name"),
        "duration": payload.duration,
        "unit": payload.unit,
        "active": True,
        "created_by": {"id": user.get("id"), "name": user.get("name"), "email": user.get("email")},
        "created_on": now,
    }
    await db[COLL_CONFIG].insert_one(doc)
    recomputed = await recompute_client_contacts(client_id)
    return {
        "config": {k: v for k, v in doc.items() if k != "_id"},
        "recomputed": recomputed,
    }
