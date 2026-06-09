"""Add 8 additional meeting rooms to the live floor plan so the calendar
has 11 rooms total. Idempotent — re-running keeps the room count at 11.
"""
from __future__ import annotations
import asyncio
import os
import sys
import uuid

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
PLAN_NAME = "HQ — Ground Floor"

# (name, capacity) — the spatial coordinates are placeholders; the calendar UI doesn't
# use them. The room cards in the floor map still render but the priority is to get the
# names into the calendar's resource columns.
EXTRA_ROOMS = [
    ("Board Room", 14),
    ("Conference A", 10),
    ("Conference B", 10),
    ("Training Room", 16),
    ("Interview Room 1", 4),
    ("Interview Room 2", 4),
    ("Focus Pod 1", 2),
    ("Focus Pod 2", 2),
]


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    plan = await db.floor_plans.find_one({"name": PLAN_NAME})
    if not plan:
        print(f"! plan '{PLAN_NAME}' not found"); return

    live_id = plan.get("live_version_id")
    if not live_id:
        print("! plan has no live version"); return

    version = await db.floor_plan_versions.find_one({"id": live_id})
    rooms = list(version.get("rooms") or [])
    existing_names = {r.get("name") for r in rooms}

    # Place extra rooms in a strip across the top of the floor (y=5..18, x=5..95)
    # in two rows of four — purely cosmetic, calendar ignores coordinates.
    cols = 4
    cell_w = (95 - 5) / cols     # 22.5
    cell_h = 6
    added = 0
    for i, (name, cap) in enumerate(EXTRA_ROOMS):
        if name in existing_names:
            continue
        row = i // cols      # 0 or 1
        col = i % cols
        rooms.append({
            "id": str(uuid.uuid4()),
            "name": name,
            "x": round(5 + col * cell_w, 2),
            "y": round(5 + row * (cell_h + 1), 2),
            "w": round(cell_w - 1.5, 2),
            "h": cell_h,
            "capacity": cap,
        })
        added += 1

    if added == 0:
        print(f"  all {len(EXTRA_ROOMS)} extras already present — nothing to do.")
    else:
        await db.floor_plan_versions.update_one({"id": live_id}, {"$set": {"rooms": rooms}})
        # Sync draft snapshot so Floor Calibration UI shows the same rooms.
        if plan.get("draft"):
            await db.floor_plans.update_one(
                {"id": plan["id"]},
                {"$set": {"draft.rooms": rooms}},
            )
        print(f"  added {added} new rooms → total now {len(rooms)}")

    print("\n=== rooms on live version ===")
    for r in rooms:
        print(f"  · {r['name']:<20s} cap {r.get('capacity', 1)}")


if __name__ == "__main__":
    asyncio.run(main())
