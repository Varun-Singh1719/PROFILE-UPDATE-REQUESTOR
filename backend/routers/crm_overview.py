"""CRM → Dynamic Overview (Cross-Segmentation Mapping) — metadata router.

The user-facing tab name for the Cross-Segmentation Overview screen is NOT
hardcoded anywhere in the UI. It is stored in the `app_settings` collection
under the key `crm_overview_tab` and served from here, so the label can be
renamed in the future by simply updating this document — zero code changes.

The internal route/identifier (`route_id`) stays constant; only the display
label (`tab_name`) is dynamic and is reflected across the Sidebar, Page
Header, Breadcrumbs and Navigation on the frontend.

Endpoints:
  GET  /api/crm/overview/meta   → { tab_name, route_id, description }
  PUT  /api/crm/overview/meta   → update tab_name / description (Super Admin)
"""
from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from core import api_router, db, now_iso, get_current_user

SETTINGS_COLL = "app_settings"
META_KEY = "crm_overview_tab"

# Default metadata — seeded once if the document does not yet exist.
DEFAULT_META = {
    "key": META_KEY,
    "tab_name": "Overview",
    "route_id": "crm_overview",
    "description": "Cross-segmentation mapping between Infollion Research and a selected client.",
}


def _clean(doc: dict) -> dict:
    return {
        "tab_name": doc.get("tab_name") or DEFAULT_META["tab_name"],
        "route_id": doc.get("route_id") or DEFAULT_META["route_id"],
        "description": doc.get("description") or DEFAULT_META["description"],
    }


async def _get_or_seed() -> dict:
    doc = await db[SETTINGS_COLL].find_one({"key": META_KEY})
    if not doc:
        seed = {**DEFAULT_META, "created_on": now_iso(), "updated_on": now_iso()}
        await db[SETTINGS_COLL].update_one(
            {"key": META_KEY}, {"$setOnInsert": seed}, upsert=True
        )
        doc = await db[SETTINGS_COLL].find_one({"key": META_KEY}) or seed
    return doc


class OverviewMetaUpdate(BaseModel):
    tab_name: Optional[str] = Field(None, min_length=1, max_length=60)
    description: Optional[str] = Field(None, max_length=500)


@api_router.get("/crm/overview/meta")
async def get_overview_meta(user=Depends(get_current_user)):
    """Return the dynamic display metadata for the Cross-Segmentation
    Overview tab. Seeds the default document on first access."""
    doc = await _get_or_seed()
    return _clean(doc)


@api_router.put("/crm/overview/meta")
async def update_overview_meta(body: OverviewMetaUpdate, user=Depends(get_current_user)):
    """Rename the Overview tab (Super Admin only). Demonstrates that the
    label is configuration-driven and renamable without code changes."""
    if (user or {}).get("role") != "Super Admin":
        raise HTTPException(403, "Only a Super Admin can rename this tab")
    await _get_or_seed()
    update: dict = {"updated_on": now_iso()}
    if body.tab_name is not None:
        update["tab_name"] = body.tab_name.strip()
    if body.description is not None:
        update["description"] = body.description.strip()
    await db[SETTINGS_COLL].update_one({"key": META_KEY}, {"$set": update})
    doc = await db[SETTINGS_COLL].find_one({"key": META_KEY})
    return _clean(doc or {})


@api_router.get("/crm/overview/segment-contacts")
async def get_segment_contacts(client_name: str, user=Depends(get_current_user)):
    """For the given client, return the client contacts grouped by the
    Level-2 segment they are mapped to (via their `industries` list), plus a
    per-segment count. Powers the segment count badges and the "Selected
    Segment" popup on the Cross-Segmentation Overview page."""
    counts: dict = {}
    contacts: dict = {}
    cursor = db["client_contacts"].find(
        {"client_name": client_name},
        {"_id": 0, "id": 1, "name": 1, "designation": 1, "email": 1,
         "base_location": 1, "industries": 1, "display_id": 1},
    )
    async for c in cursor:
        segs = c.get("industries") or []
        info = {
            "id": c.get("id"),
            "display_id": c.get("display_id"),
            "name": c.get("name"),
            "designation": c.get("designation"),
            "email": c.get("email"),
            "base_location": c.get("base_location"),
        }
        for seg in segs:
            counts[seg] = counts.get(seg, 0) + 1
            contacts.setdefault(seg, []).append(info)
    for seg in contacts:
        contacts[seg].sort(key=lambda x: (x.get("name") or "").lower())
    return {"counts": counts, "contacts": contacts}
