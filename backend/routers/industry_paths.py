"""Hierarchical Industry selection for Client Contacts (Sep 2026).

A Client Contact's Industries are PATHS through the read-only "Infollion
Research" segmentation (mirrored from MySQL `domains`):

    Level 0 → Level 1 → Level 2 → Level 3      (root "Client Name" excluded)

Storage on `client_contacts`:
  * `industry_paths` : [{ext_ids:[int,...], names:[str,...], label:"A → B → C"}]
                        (1–4 ids, each the child of the previous one)
  * `industries`     : [label, ...]  — DERIVED display strings kept for every
                        legacy consumer (cards, detail, Overview, Timeline diff,
                        "Domain Specific requires ≥1 Industry" rule).

Display names are shortened relative to the parent ("Real Estate - Residential"
under "Real Estate" → "Residential") so chips read like the spec example.
Nothing is hard-coded — everything comes from the segmentation tree.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional

from fastapi import HTTPException

from core import db

INFOLLION_NAME = "Infollion Research"
MAX_DEPTH = 4  # Level 0..3
SEP = " → "


def short_name(name: str, parent_name: Optional[str]) -> str:
    name = (name or "").strip()
    if parent_name:
        p = parent_name.strip()
        for sep in (" - ", " – ", " — ", " / ", ": "):
            if name.lower().startswith((p + sep).lower()) and len(name) > len(p) + len(sep):
                return name[len(p) + len(sep):].strip()
    return name


async def load_nodes() -> Dict[str, object]:
    """Flatten the Infollion tree → {segmentation_name, nodes{ext_id: node}}.
    node = {ext_id, name, short, level (0-based), parent_ext_id}."""
    seg = await db["segmentations"].find_one(
        {"name": {"$regex": f"^{re.escape(INFOLLION_NAME)}$", "$options": "i"}},
        {"_id": 0, "name": 1, "tree": 1},
    )
    nodes: Dict[int, dict] = {}
    if not seg:
        return {"segmentation_name": INFOLLION_NAME, "nodes": nodes}

    def walk(node: dict, level: int, parent: Optional[dict]):
        for ch in node.get("children") or []:
            ext = ch.get("ext_id")
            nm = (ch.get("name") or "").strip()
            if ext is None or not nm or level >= MAX_DEPTH:
                continue
            ext = int(ext)
            nodes[ext] = {
                "ext_id": ext,
                "name": nm,
                "short": short_name(nm, parent["name"] if parent else None),
                "level": level,
                "parent_ext_id": parent["ext_id"] if parent else None,
                "stale": bool(ch.get("stale")),
            }
            walk(ch, level + 1, nodes[ext])

    walk(seg.get("tree") or {}, 0, None)
    return {"segmentation_name": seg.get("name") or INFOLLION_NAME, "nodes": nodes}


def _norm_chain(raw) -> List[int]:
    if isinstance(raw, dict):
        raw = raw.get("ext_ids")
    if not isinstance(raw, (list, tuple)):
        raise HTTPException(400, "Each industry path must be a list of segment ids")
    try:
        ids = [int(x) for x in raw]
    except (TypeError, ValueError):
        raise HTTPException(400, "Industry path ids must be integers")
    if not ids or len(ids) > MAX_DEPTH:
        raise HTTPException(400, f"An industry path must have 1 to {MAX_DEPTH} levels")
    return ids


async def resolve_paths(raw_paths) -> List[dict]:
    """Validate + enrich [[ext_id,...], ...] (or [{ext_ids}]) against the tree.
    Returns [{ext_ids, names, shorts, label}] de-duplicated, order preserved."""
    if not raw_paths:
        return []
    data = await load_nodes()
    nodes: Dict[int, dict] = data["nodes"]  # type: ignore[assignment]
    out: List[dict] = []
    seen = set()
    for raw in raw_paths:
        ids = _norm_chain(raw)
        names, shorts = [], []
        for depth, ext in enumerate(ids):
            n = nodes.get(ext)
            if not n:
                raise HTTPException(400, f"Unknown industry segment id {ext}")
            if n["level"] != depth:
                raise HTTPException(400, f"'{n['name']}' is not a Level {depth} segment")
            expected_parent = ids[depth - 1] if depth else None
            if n["parent_ext_id"] != expected_parent:
                raise HTTPException(400, f"'{n['name']}' does not belong to the selected Level {depth - 1} segment")
            names.append(n["name"])
            shorts.append(n["short"])
        key = tuple(ids)
        if key in seen:
            continue
        seen.add(key)
        out.append({"ext_ids": ids, "names": names, "shorts": shorts, "label": SEP.join(shorts)})
    return out


def labels_of(paths: List[dict]) -> List[str]:
    return [p["label"] for p in (paths or [])]
