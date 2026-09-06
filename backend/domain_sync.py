"""MySQL `domains` → CRM Segmentation "Infollion Research" sync.

The Infollion Research segmentation is a READ-ONLY mirror of the external
Infollion MySQL `domains` table (id, name, parent_id, level L0..L3):

    MySQL level   →   Segmentation level (user-facing)
    (root)            Level 1  = "Infollion Research" (injected)
    L0                Level 2  = direct children of the root
    L1                Level 3  (linked to its L0 via parent_id)
    L2                Level 4
    L3                Level 5

Rules (agreed Sep 06 2026):
  * Node identity = MySQL `id`, stored on every tree node as `ext_id`.
  * Names are shown exactly as in MySQL (full path names, no trimming of the
    "A - B - C" prefix).
  * Every run REBUILDS the tree from MySQL: renames + additions are picked
    up automatically. Nothing is ever deleted in MySQL; should a row still
    vanish, its node is KEPT (`stale: true`) under its previous parent in
    `merge` mode (the default). `replace` mode (one-off initial load) drops
    such orphans.
  * A Level-2 rename (same ext_id, new name) is propagated to everything
    keyed by that name: `segmentation_links.mappings` keys (Clients → Link
    Segmentation) and `client_contacts.industries` values (Timeline entry
    recorded on each contact). Skipped in `replace` mode (initial load —
    old Excel names have no meaningful mapping to the MySQL names).
  * The segmentation document is flagged `read_only: true`; the
    segmentations router rejects PATCH / DELETE on it for everyone
    (including Super Admin).
  * Runs inside `crm_sync.run_full_sync` (scheduled 11:00 & 15:00 IST).
"""
from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from typing import Optional

from core import db, now_iso
from mysql_db import mysql_query

logger = logging.getLogger("domain_sync")

SEG_COLL = "segmentations"
LINKS_COLL = "segmentation_links"
CONTACTS_COLL = "client_contacts"
INFOLLION_NAME = "Infollion Research"
SOURCE_KIND = "mysql_domains"
SYSTEM_ACTOR = {"id": "system:mysql-sync", "name": "MySQL Sync (domains)", "email": None, "emp_id": None}
DESCRIPTION = ("Synced from the Infollion MySQL `domains` table (L0–L3 → Levels 2–5). "
               "Read-only — changes are made in MySQL and picked up by the scheduled sync.")

LEVEL_ORDER = ["L0", "L1", "L2", "L3"]


# ----------------------------------------------------------------- helpers
def _walk(node: dict, depth: int, parent_ext: Optional[int], out: dict):
    """Flatten a tree into {ext_id: {name, depth, parent_ext_id, node}}.
    depth 0 = root (Level 1), depth 1 = Level 2, ..."""
    for ch in node.get("children") or []:
        ext = ch.get("ext_id")
        if ext is not None:
            out[int(ext)] = {"name": (ch.get("name") or "").strip(), "depth": depth + 1,
                             "parent_ext_id": parent_ext, "node": ch}
        _walk(ch, depth + 1, int(ext) if ext is not None else None, out)


async def _find_segmentation() -> Optional[dict]:
    import re
    return await db[SEG_COLL].find_one(
        {"name": {"$regex": f"^{re.escape(INFOLLION_NAME)}$", "$options": "i"}}
    )


def _build_tree_from_rows(rows: list, seg_name: str):
    """Return (tree, by_id). Children keep MySQL id order (mirrors the table)."""
    by_id = {}
    for r in rows:
        try:
            rid = int(r["id"])
        except (TypeError, ValueError, KeyError):
            continue
        nm = (r.get("name") or "").strip()
        if not nm:
            continue
        pid = r.get("parent_id")
        try:
            pid = int(pid) if pid is not None else None
        except (TypeError, ValueError):
            pid = None
        by_id[rid] = {"id": rid, "name": nm, "parent_id": pid, "level": (r.get("level") or "").strip()}

    children = defaultdict(list)
    roots = []
    for rid in sorted(by_id):
        r = by_id[rid]
        pid = r["parent_id"]
        # L0 rows (or rows whose parent is unknown) hang directly off the root.
        if pid is None or pid == rid or pid not in by_id:
            roots.append(r)
        else:
            children[pid].append(r)

    def build(r, depth=1, seen=frozenset()):
        node = {"name": r["name"], "ext_id": r["id"], "level": r["level"] or f"L{depth - 1}", "children": []}
        if r["id"] in seen:  # defensive: cyclic parent_id data
            return node
        nxt = seen | {r["id"]}
        node["children"] = [build(c, depth + 1, nxt) for c in children.get(r["id"], [])]
        return node

    tree = {"name": seg_name, "ext_id": None, "level": "L_ROOT",
            "children": [build(r) for r in roots]}
    return tree, by_id


def _attach_orphans(tree: dict, old_nodes: dict, by_id: dict) -> int:
    """merge mode: keep nodes that disappeared from MySQL (flagged stale)
    under their previous parent (or the root when the parent is gone too)."""
    new_nodes: dict = {}
    _walk(tree, 0, None, new_nodes)
    kept = 0
    # Attach top-most orphans only (their old subtree travels with them).
    for ext, info in old_nodes.items():
        if ext in by_id:
            continue
        parent = info["parent_ext_id"]
        # If the parent is itself an orphan it will be attached with its subtree.
        if parent is not None and parent in old_nodes and parent not in by_id:
            continue
        clone = dict(info["node"])
        clone["stale"] = True
        target = new_nodes[parent]["node"] if (parent is not None and parent in new_nodes) else tree
        target.setdefault("children", []).append(clone)
        kept += 1
    return kept


async def _propagate_level2_renames(renames: list) -> dict:
    """renames: [{ext_id, old, new, depth}] — only depth==1 (Level 2) matter."""
    out = {"links_updated": 0, "contacts_updated": 0}
    l2 = [r for r in renames if r["depth"] == 1 and r["old"] and r["new"] and r["old"] != r["new"]]
    if not l2:
        return out

    # 1) segmentation_links.mappings keys
    async for link in db[LINKS_COLL].find({}, {"_id": 0, "id": 1, "client_id": 1, "mappings": 1}):
        mappings = dict(link.get("mappings") or {})
        changed = False
        for r in l2:
            if r["old"] in mappings:
                vals = mappings.pop(r["old"])
                existing = mappings.get(r["new"]) or []
                mappings[r["new"]] = existing + [v for v in vals if v not in existing]
                changed = True
        if changed:
            await db[LINKS_COLL].update_one(
                {"client_id": link["client_id"]},
                {"$set": {"mappings": mappings, "updated_by": SYSTEM_ACTOR, "updated_on": now_iso()}},
            )
            out["links_updated"] += 1

    # 2) client_contacts.industries values (+ Timeline entry per contact)
    try:
        from routers.client_contact_timeline import record_entries
    except Exception:  # noqa: BLE001
        record_entries = None
    for r in l2:
        cursor = db[CONTACTS_COLL].find({"industries": r["old"]}, {"_id": 0, "id": 1, "industries": 1})
        async for c in cursor:
            inds = [r["new"] if v == r["old"] else v for v in (c.get("industries") or [])]
            # de-dup preserving order
            seen, clean = set(), []
            for v in inds:
                if v not in seen:
                    seen.add(v)
                    clean.append(v)
            await db[CONTACTS_COLL].update_one({"id": c["id"]}, {"$set": {"industries": clean}})
            out["contacts_updated"] += 1
            if record_entries:
                try:
                    await record_entries(c["id"], SYSTEM_ACTOR, [{
                        "field": "industries", "field_label": "Industry", "action": "edited",
                        "previous_value": r["old"], "new_value": r["new"],
                    }])
                except Exception:  # noqa: BLE001
                    logger.exception("timeline entry failed for contact %s", c["id"])
    return out


# ----------------------------------------------------------------- main entry
async def sync_domains(mode: str = "merge") -> dict:
    """Rebuild the Infollion Research segmentation tree from MySQL `domains`.

    mode = "merge"   → keep (stale-flag) nodes missing from MySQL, propagate
                       Level-2 renames to links / industries.   (scheduled)
    mode = "replace" → one-off initial load: tree = MySQL exactly, no rename
                       propagation.
    """
    rows = await mysql_query(
        "SELECT id, name, parent_id, level FROM domains ORDER BY id"
    )
    if not rows:
        raise RuntimeError("MySQL `domains` returned no rows — refusing to overwrite the segmentation")

    seg = await _find_segmentation()
    seg_name = (seg or {}).get("name") or INFOLLION_NAME

    old_nodes: dict = {}
    if seg and isinstance(seg.get("tree"), dict):
        _walk(seg["tree"], 0, None, old_nodes)

    tree, by_id = _build_tree_from_rows(rows, seg_name)

    new_nodes: dict = {}
    _walk(tree, 0, None, new_nodes)

    added = [e for e in new_nodes if e not in old_nodes]
    renames = [
        {"ext_id": e, "old": old_nodes[e]["name"], "new": new_nodes[e]["name"], "depth": new_nodes[e]["depth"]}
        for e in new_nodes if e in old_nodes and old_nodes[e]["name"] != new_nodes[e]["name"]
    ]
    missing = [e for e in old_nodes if e not in by_id]

    kept = 0
    propagated = {"links_updated": 0, "contacts_updated": 0}
    if mode == "merge":
        kept = _attach_orphans(tree, old_nodes, by_id)
        # Only propagate when the previous tree was itself MySQL-derived —
        # ext_ids of the legacy Excel import do not map to the same names.
        if seg and ((seg.get("source") or {}).get("kind") == SOURCE_KIND):
            propagated = await _propagate_level2_renames(renames)

    level_counts = defaultdict(int)
    for info in new_nodes.values():
        level_counts[f"level_{info['depth'] + 1}"] += 1

    now = now_iso()
    source = {
        "kind": SOURCE_KIND,
        "table": "domains",
        "synced_at": now,
        "mode": mode,
        "rows": len(by_id),
    }
    updates = {
        "tree": tree,
        "read_only": True,
        "source": source,
        "updated_by": SYSTEM_ACTOR,
        "updated_on": now,
    }
    # The record is read-only in the app, so the sync owns the description too.
    # Replace the legacy Excel-import text (or an empty one) with the MySQL provenance.
    old_desc = ((seg or {}).get("description") or "").strip()
    if not old_desc or "excel" in old_desc.lower() or old_desc.startswith("Synced from the Infollion MySQL"):
        updates["description"] = DESCRIPTION
    if seg:
        await db[SEG_COLL].update_one({"id": seg["id"]}, {"$set": updates})
        seg_id = seg["id"]
    else:
        seg_id = str(uuid.uuid4())
        await db[SEG_COLL].insert_one({
            "id": seg_id,
            "name": INFOLLION_NAME,
            "status": "Active",
            "created_by": SYSTEM_ACTOR,
            "created_on": now,
            "description": DESCRIPTION,
            **updates,
        })

    summary = {
        "segmentation_id": seg_id,
        "mode": mode,
        "mysql_rows": len(by_id),
        "nodes": len(new_nodes),
        "levels": dict(level_counts),
        "added": len(added),
        "renamed": len(renames),
        "renamed_level2": [r for r in renames if r["depth"] == 1][:50],
        "missing_in_mysql": len(missing),
        "orphans_kept": kept,
        **propagated,
        "synced_at": now,
    }
    logger.info("domains sync (%s): %s", mode, {k: v for k, v in summary.items() if k != "renamed_level2"})
    return summary
