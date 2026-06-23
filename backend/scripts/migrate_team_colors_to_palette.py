"""
One-time migration: convert any team whose `color` is still a legacy hex
string (e.g. "#ec9324") to a palette id from the new TEAM_PALETTES set
("tp1"..."tp60"). Picks the next unused palette id deterministically.

Safe to re-run — only touches teams whose color does NOT already start with
"tp". Run with:  python3 /app/backend/scripts/migrate_team_colors_to_palette.py
"""
import asyncio
import os
import sys
from pathlib import Path

# Make the backend package importable
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# Mirrors /app/frontend/src/lib/teamColors.js — keep in sync if the front-end
# palette ever grows. Order matters: first unused id wins.
TEAM_PALETTE_IDS = [f"tp{i}" for i in range(1, 61)]


async def main():
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    teams = await db.teams.find({}, {"_id": 0, "id": 1, "name": 1, "color": 1}).to_list(2000)
    used_palette_ids = {t.get("color") for t in teams if isinstance(t.get("color"), str) and t["color"].startswith("tp")}

    to_migrate = [t for t in teams if not (isinstance(t.get("color"), str) and t["color"].startswith("tp"))]
    if not to_migrate:
        print(f"Nothing to migrate — all {len(teams)} teams already use palette ids.")
        return

    print(f"{len(to_migrate)} team(s) need migration: {[t['name'] for t in to_migrate]}")

    available = [pid for pid in TEAM_PALETTE_IDS if pid not in used_palette_ids]
    if len(available) < len(to_migrate):
        # Re-cycle from the top if the palette is exhausted (allow duplicates).
        available = list(TEAM_PALETTE_IDS)

    for team, new_pid in zip(to_migrate, available):
        await db.teams.update_one({"id": team["id"]}, {"$set": {"color": new_pid}})
        print(f"  {team['name']:<30s} {team.get('color')!r} -> {new_pid}")

    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
