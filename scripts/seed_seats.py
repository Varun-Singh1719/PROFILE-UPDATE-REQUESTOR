"""Seed seats onto the existing 'HQ — Ground Floor' plan so Floor Layout
and Floor Calibration pages have visible content.

Idempotent: writes seats only if the live version currently has no seats.
"""
from __future__ import annotations
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

PLAN_NAME = "HQ — Ground Floor"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_seats(n_rows: int = 4, n_cols: int = 8) -> list:
    """Place an n_rows x n_cols grid of seats in the lower-half of the floor,
    leaving the upper half for the seeded meeting rooms.
    Coordinates are 0..100 percentages — matches existing Seat model usage.
    """
    seats = []
    # Lay seats from y=45 to y=85, x=8 to x=92
    x0, x1 = 8, 92
    y0, y1 = 48, 86
    dx = (x1 - x0) / max(n_cols - 1, 1)
    dy = (y1 - y0) / max(n_rows - 1, 1)
    counter = 1
    for r in range(n_rows):
        for c in range(n_cols):
            seats.append({
                "id": str(uuid.uuid4()),
                "label": f"S{counter:02d}",
                "x": round(x0 + c * dx, 2),
                "y": round(y0 + r * dy, 2),
                "size": 3.2,
                "rotation": 0,
                "status": "available",
                "locked": False,
            })
            counter += 1
    return seats


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    plan = await db.floor_plans.find_one({"name": PLAN_NAME})
    if not plan:
        print(f"! plan '{PLAN_NAME}' not found — run seed_mrb_test_data.py first.")
        return

    live_id = plan.get("live_version_id")
    if not live_id:
        print("! plan has no live version — nothing to do.")
        return

    version = await db.floor_plan_versions.find_one({"id": live_id})
    existing_seats = version.get("seats") or []
    if existing_seats:
        print(f"  seats already present: {len(existing_seats)} — skipping seeding.")
    else:
        seats = build_seats(4, 8)
        await db.floor_plan_versions.update_one(
            {"id": live_id}, {"$set": {"seats": seats}}
        )
        print(f"  seeded {len(seats)} seats onto live version {live_id[:8]}")

    # Also update the plan's draft snapshot if it exists, so Floor Calibration shows the same.
    if plan.get("draft"):
        await db.floor_plans.update_one(
            {"id": plan["id"]},
            {"$set": {"draft.seats": (await db.floor_plan_versions.find_one({"id": live_id})).get("seats", []),
                      "draft_updated_at": now_iso()}},
        )
        print("  draft snapshot synced with live seats.")

    print("\n=== floor plan summary ===")
    v = await db.floor_plan_versions.find_one({"id": live_id})
    print(f"  rooms: {len(v.get('rooms') or [])}")
    print(f"  seats: {len(v.get('seats') or [])}")


if __name__ == "__main__":
    asyncio.run(main())
