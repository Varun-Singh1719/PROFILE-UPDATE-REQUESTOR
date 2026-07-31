"""Prune the Infollion Research segmentation to keep only Levels 1-3.

Level mapping (from the original import):
    depth 0 -> Level 1  (root "Infollion Research")   KEEP
    depth 1 -> Level 2  (26 nodes)                    KEEP
    depth 2 -> Level 3  (110 nodes)                   KEEP  — but strip .children
    depth 3 -> Level 4                                DELETE
    depth 4 -> Level 5                                DELETE

Idempotent: safe to run multiple times. Also updates updated_by/updated_on.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from core import db, now_iso  # noqa: E402

SEGMENT_NAME = "Infollion Research"


def prune_at(node: dict, current_depth: int, max_depth_keep: int) -> None:
    """Recursively strip children beyond max_depth_keep."""
    if current_depth >= max_depth_keep:
        # Drop everything deeper than this node.
        node["children"] = []
        return
    kids = node.get("children") or []
    for c in kids:
        prune_at(c, current_depth + 1, max_depth_keep)


def count_nodes(node: dict) -> int:
    total = 1
    for c in node.get("children", []) or []:
        total += count_nodes(c)
    return total


def by_depth(node: dict, depth: int, acc: dict) -> None:
    acc[depth] = acc.get(depth, 0) + 1
    for c in node.get("children", []) or []:
        by_depth(c, depth + 1, acc)


async def pick_actor():
    contact = await db["contacts"].find_one(
        {"role": {"$in": ["Super Admin", "SuperAdmin", "super_admin", "Super admin"]}}
    )
    if contact:
        return {
            "id": contact.get("id") or contact.get("_id"),
            "name": contact.get("name"),
            "email": contact.get("email"),
        }
    return {"id": "system-pruner", "name": "System Pruner", "email": None}


async def main():
    seg = await db["segmentations"].find_one(
        {"name": {"$regex": f"^{SEGMENT_NAME}$", "$options": "i"}}
    )
    if not seg:
        raise SystemExit(f"Segmentation {SEGMENT_NAME!r} not found in DB")

    tree = seg.get("tree") or {}
    before_stats: dict = {}
    by_depth(tree, 0, before_stats)
    print(f"BEFORE — total nodes: {count_nodes(tree)}, by depth: {before_stats}")

    # Depth 2 = Level 3 → keep, but strip its children (which are Level 4+)
    prune_at(tree, 0, 2)

    after_stats: dict = {}
    by_depth(tree, 0, after_stats)
    print(f"AFTER  — total nodes: {count_nodes(tree)}, by depth: {after_stats}")

    actor = await pick_actor()
    now = now_iso()
    res = await db["segmentations"].update_one(
        {"id": seg["id"]},
        {"$set": {
            "tree": tree,
            "updated_by": actor,
            "updated_on": now,
        }},
    )
    print(f"✓ Updated segmentation id={seg['id']} — matched={res.matched_count}, modified={res.modified_count}")

    # Verify persistence
    fresh = await db["segmentations"].find_one({"id": seg["id"]})
    verify_stats: dict = {}
    by_depth(fresh.get("tree") or {}, 0, verify_stats)
    print(f"VERIFY (re-read) — total nodes: {count_nodes(fresh.get('tree') or {})}, by depth: {verify_stats}")


if __name__ == "__main__":
    asyncio.run(main())
