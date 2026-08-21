"""CRM → Clients router (Aug 04 2026).

MVP scope
---------
Standalone Clients directory (separate from Client Contacts). Each record has:
  * name           — required, unique (case-insensitive)
  * type           — one of CLIENT_TYPES (single-select)
  * display_id     — auto-incrementing numeric id, starts at 1001
  * created_by / updated_by / created_on / updated_on — audit stamps
  * Placeholder counts (client_contact_count, project_count, serviced_count) —
    return 0 for now; a future task will hydrate them via aggregations.

REST
----
POST   /api/clients          create
GET    /api/clients          list  (?search= &page= &page_size= &type=)
GET    /api/clients/{id}     detail
PATCH  /api/clients/{id}     partial update
DELETE /api/clients/{id}     remove
"""
from __future__ import annotations

import re
import uuid
from typing import Optional, List

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from core import api_router, db, now_iso, get_current_user

COLL = "clients"
COUNTER_KEY = "client_seq"

CLIENT_TYPES = [
    "Venture Capital/Private Equity",
    "Hedge funds/Public Markets",
    "Research and Consulting",
    "Corporations and Companies",
]


# ---------- Schemas ----------
class ClientCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=180)
    type: str = Field(..., min_length=1)

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Name is required")
        return v

    @field_validator("type")
    @classmethod
    def _check_type(cls, v: str) -> str:
        v = (v or "").strip()
        if v not in CLIENT_TYPES:
            raise ValueError(f"Type must be one of {CLIENT_TYPES}")
        return v


class ClientUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=180)
    type: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("Name cannot be blank")
        return v

    @field_validator("type")
    @classmethod
    def _check_type(cls, v):
        if v is None:
            return v
        v = v.strip()
        if v not in CLIENT_TYPES:
            raise ValueError(f"Type must be one of {CLIENT_TYPES}")
        return v


# ---------- Helpers ----------
def _actor(user: dict) -> dict:
    return {
        "id": user.get("id"),
        "name": user.get("name"),
        "email": user.get("email"),
        "emp_id": user.get("emp_id"),
    }


def _serialize(doc: dict) -> dict:
    if not doc:
        return doc
    return {k: v for k, v in doc.items() if k != "_id"}


def _with_placeholders(doc: dict) -> dict:
    """Attach placeholder aggregate counts. Will be computed by real queries later."""
    if not doc:
        return doc
    doc.setdefault("client_contact_count", 0)
    doc.setdefault("project_count", 0)
    doc.setdefault("serviced_count", 0)
    return doc


async def _next_display_id() -> int:
    """Auto-incrementing numeric id. First client -> 1001."""
    await db["counters"].find_one_and_update(
        {"_id": COUNTER_KEY},
        {"$inc": {"seq": 1}, "$setOnInsert": {"seq_base": 1000}},
        upsert=True,
        return_document=True,
    )
    doc = await db["counters"].find_one({"_id": COUNTER_KEY})
    base = int((doc or {}).get("seq_base") or 1000)
    seq = int((doc or {}).get("seq") or 1)
    return base + seq


def _esc(s: str) -> str:
    return re.escape(s or "")


async def _dup_name(name: str, exclude_id: Optional[str] = None) -> bool:
    q = {"name": {"$regex": f"^{_esc(name)}$", "$options": "i"}}
    if exclude_id:
        q["id"] = {"$ne": exclude_id}
    return (await db[COLL].find_one(q, {"_id": 1})) is not None


# ---------- Routes ----------
@api_router.get("/clients/types")
async def list_client_types(user=Depends(get_current_user)):
    return {"types": CLIENT_TYPES}


@api_router.post("/clients")
async def create_client(payload: ClientCreate, user=Depends(get_current_user)):
    if await _dup_name(payload.name):
        raise HTTPException(400, "A client with this name already exists")

    now = now_iso()
    doc = {
        "id": str(uuid.uuid4()),
        "display_id": await _next_display_id(),
        "name": payload.name,
        "type": payload.type,
        "client_contact_count": 0,
        "project_count": 0,
        "serviced_count": 0,
        "created_by": _actor(user),
        "created_on": now,
        "updated_by": _actor(user),
        "updated_on": now,
    }
    await db[COLL].insert_one(doc)
    return _with_placeholders(_serialize(doc))


@api_router.get("/clients")
async def list_clients(
    search: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    sort: Optional[str] = Query("newest", description="newest | oldest | name_asc | name_desc | id_asc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(24, ge=1, le=200),
    user=Depends(get_current_user),
):
    q: dict = {}
    if type:
        q["type"] = type
    if search:
        s = search.strip()
        if s:
            q["$or"] = [
                {"name": {"$regex": _esc(s), "$options": "i"}},
                {"type": {"$regex": _esc(s), "$options": "i"}},
            ]

    sort_map = {
        "newest":    [("created_on", -1)],
        "oldest":    [("created_on", 1)],
        "name_asc":  [("name", 1)],
        "name_desc": [("name", -1)],
        "id_asc":    [("display_id", 1)],
    }
    sort_spec = sort_map.get(sort or "newest", sort_map["newest"])

    total = await db[COLL].count_documents(q)
    cursor = db[COLL].find(q).sort(sort_spec).skip((page - 1) * page_size).limit(page_size)
    rows: List[dict] = []
    async for d in cursor:
        rows.append(_with_placeholders(_serialize(d)))
    return {"rows": rows, "total": total, "page": page, "page_size": page_size}


@api_router.get("/clients/{client_id}")
async def get_client(client_id: str, user=Depends(get_current_user)):
    doc = await db[COLL].find_one({"id": client_id})
    if not doc:
        raise HTTPException(404, "Client not found")
    return _with_placeholders(_serialize(doc))


@api_router.get("/clients/{client_id}/segmentation")
async def get_client_segmentation(client_id: str, user=Depends(get_current_user)):
    """Return the segmentation whose name matches this client's name.

    Response shape:
      { exists: bool, segmentation: {...}|null }
    """
    client = await db[COLL].find_one({"id": client_id})
    if not client:
        raise HTTPException(404, "Client not found")
    name = client.get("name") or ""
    seg = await db["segmentations"].find_one({
        "name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}
    })
    if not seg:
        return {"exists": False, "segmentation": None, "client_name": name}
    return {
        "exists": True,
        "client_name": name,
        "segmentation": {k: v for k, v in seg.items() if k != "_id"},
    }


# =====================================================================
# Link Segmentation — map Infollion Research Level-1 categories to the
# selected client's own Level-1 segmentations.
# =====================================================================
LINKS_COLL = "segmentation_links"
INFOLLION_NAME = "Infollion Research"


def _level1_names(seg: Optional[dict]) -> List[str]:
    """Return the Level-1 node names (tree root's direct children)."""
    if not seg:
        return []
    tree = seg.get("tree") or {}
    out: List[str] = []
    for ch in (tree.get("children") or []):
        nm = (ch or {}).get("name")
        if nm and str(nm).strip():
            out.append(str(nm).strip())
    # de-dup while preserving order
    seen = set()
    uniq = []
    for n in out:
        if n not in seen:
            seen.add(n)
            uniq.append(n)
    return uniq


def _levels_struct(seg: Optional[dict]) -> dict:
    """Describe a segmentation tree by USER-FACING level.

    Level numbering matches the rest of the app:
      • Level 1 = the tree root (the segmentation/client name itself)
      • Level 2 = the root's direct children
      • Level 3 = grandchildren, etc.

    Only Level 2+ nodes are returned (the root / Level 1 is intentionally
    omitted — the Overview only ever visualises Level 2 downward).

    Returns:
      {
        "max_level": <int>,          # deepest user-facing level present (>=1)
        "nodes": {
          "2": [{ "name", "path", "l2" }, ...],
          "3": [ ... ],
          ...
        }
      }

    `path`  — unique "A / B / C" trail (stable id; names may repeat across
              different parents at deeper levels).
    `l2`    — the node's Level-2 ancestor name. Used by the Overview to
              PROJECT the Level-2 Infollion→client mappings down to whatever
              level the user has chosen to display.
    """
    if not seg:
        return {"max_level": 1, "nodes": {}}
    tree = seg.get("tree") or {}
    nodes_by_level: dict = {}
    max_level = 1

    def walk(node: dict, node_level: int, l2_ancestor, path):
        nonlocal max_level
        for ch in (node.get("children") or []):
            nm = (ch or {}).get("name")
            if not nm or not str(nm).strip():
                continue
            nm = str(nm).strip()
            child_level = node_level + 1
            cur_l2 = nm if child_level == 2 else l2_ancestor
            cur_path = (path + " / " + nm) if path else nm
            max_level = max(max_level, child_level)
            nodes_by_level.setdefault(str(child_level), []).append({
                "name": nm,
                "path": cur_path,
                "l2": cur_l2,
            })
            walk(ch, child_level, cur_l2, cur_path)

    walk(tree, 1, None, "")
    return {"max_level": max_level, "nodes": nodes_by_level}


class SegmentationLinkUpdate(BaseModel):
    # { <infollion_level1_name>: [<client_level1_name>, ...] }
    mappings: dict = Field(default_factory=dict)


@api_router.get("/clients/{client_id}/segmentation-link")
async def get_client_segmentation_link(client_id: str, user=Depends(get_current_user)):
    """Payload for the Client Detail → Link Segmentation tab.

    Returns:
      {
        client: { id, name },
        infollion: { exists, name, level1: [name, ...] },
        client_level1: [name, ...],       # the selected client's own L1
        client_has_segmentation: bool,
        mappings: { <infollion_l1>: [<client_l1>, ...] }  # saved only
      }
    """
    client = await db[COLL].find_one({"id": client_id})
    if not client:
        raise HTTPException(404, "Client not found")
    client_name = client.get("name") or ""

    infollion = await db["segmentations"].find_one({
        "name": {"$regex": f"^{re.escape(INFOLLION_NAME)}$", "$options": "i"}
    })
    infollion_l1 = _level1_names(infollion)

    client_seg = await db["segmentations"].find_one({
        "name": {"$regex": f"^{re.escape(client_name)}$", "$options": "i"}
    })
    client_l1 = _level1_names(client_seg)

    saved = await db[LINKS_COLL].find_one({"client_id": client_id})
    raw_mappings = (saved or {}).get("mappings") or {}

    # Sanitize: only keep infollion keys that still exist and client targets
    # that still exist — so stale entries silently drop out.
    infollion_set = set(infollion_l1)
    client_set = set(client_l1)
    mappings: dict = {}
    for k, vals in raw_mappings.items():
        if k in infollion_set:
            kept = [v for v in (vals or []) if v in client_set]
            if kept:
                mappings[k] = kept

    return {
        "client": {"id": client_id, "name": client_name},
        "infollion": {
            "exists": bool(infollion),
            "name": INFOLLION_NAME,
            "level1": infollion_l1,
            "levels": _levels_struct(infollion),
        },
        "client_level1": client_l1,
        "client_levels": _levels_struct(client_seg),
        "client_has_segmentation": bool(client_seg) and len(client_l1) > 0,
        "mappings": mappings,
    }


@api_router.put("/clients/{client_id}/segmentation-link")
async def put_client_segmentation_link(
    client_id: str, body: SegmentationLinkUpdate, user=Depends(get_current_user)
):
    """Persist the Infollion→client Level-1 mapping for this client.

    Mappings are only saved when the user clicks Save on the frontend.
    """
    client = await db[COLL].find_one({"id": client_id})
    if not client:
        raise HTTPException(404, "Client not found")
    client_name = client.get("name") or ""

    infollion = await db["segmentations"].find_one({
        "name": {"$regex": f"^{re.escape(INFOLLION_NAME)}$", "$options": "i"}
    })
    infollion_set = set(_level1_names(infollion))

    client_seg = await db["segmentations"].find_one({
        "name": {"$regex": f"^{re.escape(client_name)}$", "$options": "i"}
    })
    client_set = set(_level1_names(client_seg))

    # Validate + sanitize incoming payload against current L1 nodes.
    clean: dict = {}
    for k, vals in (body.mappings or {}).items():
        if k not in infollion_set:
            continue
        kept = []
        for v in (vals or []):
            if v in client_set and v not in kept:
                kept.append(v)
        if kept:
            clean[k] = kept

    now = now_iso()
    actor = {"id": user.get("id"), "name": user.get("name"), "email": user.get("email")}
    existing = await db[LINKS_COLL].find_one({"client_id": client_id})
    if existing:
        await db[LINKS_COLL].update_one(
            {"client_id": client_id},
            {"$set": {
                "mappings": clean,
                "client_name": client_name,
                "updated_by": actor,
                "updated_on": now,
            }},
        )
    else:
        await db[LINKS_COLL].insert_one({
            "id": str(uuid.uuid4()),
            "client_id": client_id,
            "client_name": client_name,
            "mappings": clean,
            "created_by": actor,
            "created_on": now,
            "updated_by": actor,
            "updated_on": now,
        })

    return {"ok": True, "mappings": clean}




@api_router.patch("/clients/{client_id}")
async def update_client(
    client_id: str, payload: ClientUpdate, user=Depends(get_current_user)
):
    existing = await db[COLL].find_one({"id": client_id})
    if not existing:
        raise HTTPException(404, "Client not found")

    updates: dict = {}
    if payload.name is not None and payload.name != existing.get("name"):
        if await _dup_name(payload.name, exclude_id=client_id):
            raise HTTPException(400, "A client with this name already exists")
        updates["name"] = payload.name
    if payload.type is not None:
        updates["type"] = payload.type

    if not updates:
        return _with_placeholders(_serialize(existing))

    updates["updated_by"] = _actor(user)
    updates["updated_on"] = now_iso()
    await db[COLL].update_one({"id": client_id}, {"$set": updates})
    doc = await db[COLL].find_one({"id": client_id})
    return _with_placeholders(_serialize(doc))


@api_router.delete("/clients/{client_id}")
async def delete_client(client_id: str, user=Depends(get_current_user)):
    res = await db[COLL].delete_one({"id": client_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Client not found")
    return {"ok": True}


# ------- Sync from Segmentations -------------------------------
# Creates one Client per Segmentation that has no matching client yet
# (case-insensitive name match). Excludes "Infollion Research" by name.
# Default Type = "Corporations and Companies" for auto-created rows.
_EXCLUDE_NAMES = {"infollion research"}


@api_router.post("/clients/sync-from-segmentations")
async def sync_from_segmentations(user=Depends(get_current_user)):
    created: list = []
    skipped_existing: list = []
    skipped_excluded: list = []

    async for seg in db["segmentations"].find({}):
        name = (seg.get("name") or "").strip()
        if not name:
            continue
        if name.lower() in _EXCLUDE_NAMES:
            skipped_excluded.append(name)
            continue
        # If a matching client already exists, skip
        existing = await db[COLL].find_one(
            {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}
        )
        if existing:
            skipped_existing.append(name)
            continue

        now = now_iso()
        doc = {
            "id": str(uuid.uuid4()),
            "display_id": await _next_display_id(),
            "name": name,
            "type": "Corporations and Companies",
            "client_contact_count": 0,
            "project_count": 0,
            "serviced_count": 0,
            "seeded_from_segmentation": True,  # marker so UI knows to seed random cells
            "created_by": _actor(user),
            "created_on": now,
            "updated_by": _actor(user),
            "updated_on": now,
        }
        await db[COLL].insert_one(doc)
        created.append({"display_id": doc["display_id"], "name": name})

    return {
        "created": created,
        "created_count": len(created),
        "skipped_existing": skipped_existing,
        "skipped_excluded": skipped_excluded,
    }
