"""Floor Plans: store calibrated seat configurations for the office floor map.

A single "active" floor plan acts as the source of truth for the Floor Layout
view in the Workspace Manager. Admins (Super Admin / Admin) can save / update
it from the Seat Calibration page; everyone authenticated can read it.
"""
from typing import List, Optional
from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from core import api_router, db, get_current_user, require_role, now_iso, log_audit


ACTIVE_PLAN_ID = "active"  # Single-tenant: one active plan


class Seat(BaseModel):
    id: str
    label: str
    x: float
    y: float
    size: float = 10
    rotation: float = 0
    status: str = "available"


class FloorPlanIn(BaseModel):
    name: str = Field(default="Office Floor Plan")
    pdfUrl: str
    seats: List[Seat] = Field(default_factory=list)


class FloorPlanOut(FloorPlanIn):
    id: str
    updated_at: str
    updated_by: Optional[dict] = None


@api_router.get("/floor-plans/active", response_model=Optional[FloorPlanOut])
async def get_active_floor_plan(user=Depends(get_current_user)):
    """Return the active floor plan, or null if none has been saved yet."""
    doc = await db.floor_plans.find_one({"id": ACTIVE_PLAN_ID}, {"_id": 0})
    return doc


@api_router.put("/floor-plans/active", response_model=FloorPlanOut)
async def upsert_active_floor_plan(
    payload: FloorPlanIn,
    user=Depends(require_role("Super Admin", "Admin")),
):
    """Create or replace the active floor plan. Admin-only."""
    now = now_iso()
    actor = {"id": user.get("id"), "email": user.get("email"), "name": user.get("name")}
    doc = {
        "id": ACTIVE_PLAN_ID,
        "name": payload.name,
        "pdfUrl": payload.pdfUrl,
        "seats": [s.model_dump() for s in payload.seats],
        "updated_at": now,
        "updated_by": actor,
    }
    await db.floor_plans.update_one({"id": ACTIVE_PLAN_ID}, {"$set": doc}, upsert=True)
    await log_audit(
        actor=actor,
        action="floor_plan.save",
        resource="floor_plan",
        resource_id=ACTIVE_PLAN_ID,
        metadata={"seat_count": len(payload.seats), "pdfUrl": payload.pdfUrl},
    )
    return doc
