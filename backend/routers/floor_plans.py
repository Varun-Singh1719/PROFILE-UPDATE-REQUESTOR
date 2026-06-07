"""Floor Plans — multi-plan model with Draft/Live workflow, versioning, audit.

Data model
==========

  floor_plans:           one document per named floor plan
    { id, name, pdfUrl, default: bool,
      live_version_id, draft (embedded seats/pdfUrl), draft_updated_at,
      created_at, created_by, updated_at, updated_by }

  floor_plan_versions:   immutable snapshots, created on every publish/rollback
    { id, plan_id, version_number, state: "published",
      seats[], pdfUrl, name, comments, diff_summary,
      created_at, created_by }

  audit_log (existing):  resource="floor_plan", action="save_draft|publish|rollback|clone|delete|create"

Backward compatibility
======================

  GET /api/floor-plans/active still returns the *default* plan's published version
  in the legacy shape, so the existing Floor Layout page keeps working unchanged.
"""
from __future__ import annotations

import os
import re
import uuid
from pathlib import Path
from typing import List, Optional, Dict, Any
from urllib.parse import urlparse

import jwt
import requests
from fastapi import Depends, HTTPException, UploadFile, File, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from core import api_router, db, get_current_user, require_role, now_iso, log_audit, JWT_SECRET, JWT_ALGORITHM

# Local on-disk storage for uploaded floor-plan PDFs
PDF_STORAGE_DIR = Path(__file__).resolve().parent.parent / "uploads" / "floor-plans"
PDF_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
PDF_FILENAME_RE = re.compile(r"^[a-f0-9-]{36}\.pdf$")  # uuid.pdf only


def _verify_token_from_request(request: Request, auth_query: Optional[str]) -> None:
    """Auth check that also accepts ?auth=<jwt> query (for direct <iframe>/<embed> fetches)."""
    token = request.cookies.get("access_token") or auth_query
    if not token:
        bearer = request.headers.get("Authorization", "")
        if bearer.startswith("Bearer "):
            token = bearer[7:]
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        raise HTTPException(401, "Invalid token")



# --------------------------------------------------------------------------- #
# Models                                                                      #
# --------------------------------------------------------------------------- #

class Seat(BaseModel):
    id: str
    label: str
    x: float
    y: float
    size: float = 10
    rotation: float = 0
    status: str = "available"
    locked: bool = False


class Room(BaseModel):
    id: str
    name: str
    x: float  # top-left x in %
    y: float  # top-left y in %
    w: float  # width in %
    h: float  # height in %
    capacity: int = Field(default=1, ge=1, le=20)  # seating capacity (1-20)


class PlanCreate(BaseModel):
    name: str
    pdfUrl: str


class DraftIn(BaseModel):
    name: Optional[str] = None
    pdfUrl: str
    seats: List[Seat] = Field(default_factory=list)
    rooms: List[Room] = Field(default_factory=list)


class PublishIn(BaseModel):
    comments: str = ""


class CloneIn(BaseModel):
    name: str


class RollbackIn(BaseModel):
    comments: str = ""


class ThumbnailIn(BaseModel):
    thumbnail: str  # data URL (image/png base64)


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #

def _actor(user: dict) -> dict:
    return {"id": user.get("id"), "email": user.get("email"), "name": user.get("name")}


def _strip_id(doc):
    if doc and "_id" in doc:
        doc.pop("_id", None)
    return doc


async def _get_plan_or_404(plan_id: str) -> dict:
    doc = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, f"Floor plan '{plan_id}' not found")
    return doc


async def _get_version(version_id: str) -> Optional[dict]:
    return await db.floor_plan_versions.find_one({"id": version_id}, {"_id": 0})


async def _live_seats(plan: dict) -> List[dict]:
    """Return the seats from the plan's published live version (or [])."""
    vid = plan.get("live_version_id")
    if not vid:
        return []
    v = await _get_version(vid)
    return (v or {}).get("seats", [])


async def _live_rooms(plan: dict) -> List[dict]:
    """Return the meeting rooms from the plan's published live version (or [])."""
    vid = plan.get("live_version_id")
    if not vid:
        return []
    v = await _get_version(vid)
    return (v or {}).get("rooms", []) or []


def _seat_dict(seats: List[dict]) -> Dict[str, dict]:
    return {s["id"]: s for s in seats}


def _round(n: float) -> float:
    return round(float(n), 2)


def compute_diff(prev: List[dict], curr: List[dict]) -> Dict[str, Any]:
    """Compute a per-action diff between two seat lists keyed by seat id."""
    a, b = _seat_dict(prev), _seat_dict(curr)
    added = sorted(set(b) - set(a))
    removed = sorted(set(a) - set(b))
    moved, rotated, resized = [], [], []
    for sid in sorted(set(a) & set(b)):
        sa, sb = a[sid], b[sid]
        if _round(sa.get("x", 0)) != _round(sb.get("x", 0)) or _round(sa.get("y", 0)) != _round(sb.get("y", 0)):
            moved.append(sid)
        if _round(sa.get("rotation", 0)) != _round(sb.get("rotation", 0)):
            rotated.append(sid)
        if _round(sa.get("size", 10)) != _round(sb.get("size", 10)):
            resized.append(sid)
    return {
        "added": added, "removed": removed,
        "moved": moved, "rotated": rotated, "resized": resized,
        "counts": {
            "added": len(added), "removed": len(removed),
            "moved": len(moved), "rotated": len(rotated), "resized": len(resized),
        },
    }


async def _next_version_number(plan_id: str) -> int:
    cursor = db.floor_plan_versions.find({"plan_id": plan_id}, {"version_number": 1, "_id": 0}).sort("version_number", -1).limit(1)
    docs = await cursor.to_list(1)
    return (docs[0]["version_number"] + 1) if docs else 1


# --------------------------------------------------------------------------- #
# One-time migration: legacy "active" doc -> first multi-plan entry           #
# --------------------------------------------------------------------------- #

def _compute_status(doc: dict) -> str:
    """Derive the public status for a plan.

    Precedence:
      1. Explicit override field `status_override` ('inactive' | 'live')
      2. Live version present → 'live'
      3. Otherwise → 'draft'
    """
    override = (doc.get("status_override") or "").lower()
    if override in ("inactive", "live"):
        return override
    return "live" if doc.get("live_version_id") else "draft"


def _strip_legacy(d: dict) -> dict:
    """Remove deprecated/internal fields from API responses."""
    d.pop("default", None)
    return d


async def ensure_migrated():
    """Migrate the legacy single-doc 'active' plan to the multi-plan schema.

    Safe to call repeatedly — exits early once migrated.
    """
    # Already migrated?
    if await db.floor_plans.count_documents({"id": {"$ne": "active"}}) > 0:
        # But we still want to remove the legacy 'active' doc if it lingers.
        await db.floor_plans.delete_one({"id": "active"})
        return

    legacy = await db.floor_plans.find_one({"id": "active"}, {"_id": 0})
    if not legacy:
        return  # nothing to migrate

    plan_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    actor = legacy.get("updated_by") or {"id": None, "name": "system", "email": None}
    now = now_iso()

    await db.floor_plan_versions.insert_one({
        "id": version_id,
        "plan_id": plan_id,
        "version_number": 1,
        "state": "published",
        "seats": legacy.get("seats", []),
        "pdfUrl": legacy.get("pdfUrl"),
        "name": legacy.get("name") or "Floor Plan 1",
        "comments": "Auto-migrated from legacy single-plan model",
        "diff_summary": {"counts": {"added": len(legacy.get("seats", [])), "removed": 0, "moved": 0, "rotated": 0, "resized": 0}},
        "created_at": legacy.get("updated_at") or now,
        "created_by": actor,
    })

    await db.floor_plans.insert_one({
        "id": plan_id,
        "name": legacy.get("name") or "Floor Plan 1",
        "pdfUrl": legacy.get("pdfUrl"),
        "status_override": None,
        "live_version_id": version_id,
        "draft": None,
        "draft_updated_at": None,
        "created_at": legacy.get("updated_at") or now,
        "created_by": actor,
        "updated_at": legacy.get("updated_at") or now,
        "updated_by": actor,
    })

    await db.floor_plans.delete_one({"id": "active"})


# --------------------------------------------------------------------------- #
# List + Create                                                               #
# --------------------------------------------------------------------------- #

@api_router.get("/floor-plans")
async def list_floor_plans(user=Depends(get_current_user)):
    await ensure_migrated()
    # One-time cleanup: drop deprecated `default` field from DB docs
    await db.floor_plans.update_many({"default": {"$exists": True}}, {"$unset": {"default": ""}})
    docs = await db.floor_plans.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    # enrich with version_count and seat_count
    for d in docs:
        d["version_count"] = await db.floor_plan_versions.count_documents({"plan_id": d["id"]})
        live = None
        if d.get("live_version_id"):
            live = await _get_version(d["live_version_id"])
        d["live_seat_count"] = len((live or {}).get("seats", []))
        d["last_published_at"] = (live or {}).get("created_at")
        d["has_draft"] = d.get("draft") is not None
        d["status"] = _compute_status(d)
        _strip_legacy(d)
    return docs


@api_router.post("/floor-plans")
async def create_floor_plan(
    payload: PlanCreate,
    user=Depends(require_role("Super Admin", "Admin")),
):
    await ensure_migrated()
    plan_id = str(uuid.uuid4())
    now = now_iso()
    actor = _actor(user)
    doc = {
        "id": plan_id,
        "name": payload.name,
        "pdfUrl": payload.pdfUrl,
        "status_override": None,
        "live_version_id": None,
        "draft": None,
        "draft_updated_at": None,
        "created_at": now, "created_by": actor,
        "updated_at": now, "updated_by": actor,
    }
    await db.floor_plans.insert_one(doc)
    await log_audit(actor=actor, action="floor_plan.create",
                    resource="floor_plan", resource_id=plan_id,
                    metadata={"name": payload.name})
    out = _strip_id(doc)
    out["status"] = _compute_status(out)
    out["has_draft"] = False
    out["version_count"] = 0
    out["live_seat_count"] = 0
    out["last_published_at"] = None
    return _strip_legacy(out)


# --------------------------------------------------------------------------- #
# Backward-compat endpoint for FloorLayoutPage                                #
# IMPORTANT: must be declared BEFORE GET /floor-plans/{plan_id} so the        #
# literal "/active" path isn't matched as a plan id.                          #
# --------------------------------------------------------------------------- #

@api_router.get("/floor-plans/active")
async def get_active_floor_plan(user=Depends(get_current_user)):
    """Return the first available live plan (legacy endpoint).

    Kept for backward compatibility with any older client embeds.
    """
    await ensure_migrated()
    plan = await db.floor_plans.find_one(
        {"live_version_id": {"$ne": None}, "status_override": {"$ne": "inactive"}},
        {"_id": 0}, sort=[("created_at", 1)],
    )
    if not plan:
        return None
    v = await _get_version(plan["live_version_id"])
    if not v:
        return None
    return {
        "id": "active",
        "plan_id": plan["id"],
        "name": v.get("name") or plan.get("name"),
        "pdfUrl": v.get("pdfUrl") or plan.get("pdfUrl"),
        "seats": v.get("seats", []),
        "updated_at": v.get("created_at"),
        "updated_by": v.get("created_by"),
        "version_number": v.get("version_number"),
    }


# --------------------------------------------------------------------------- #
# PDF upload (local disk) + serve + external-URL proxy                        #
# IMPORTANT: declared BEFORE GET /floor-plans/{plan_id} so the literal paths  #
# "/upload-pdf", "/pdf/{filename}", "/proxy-pdf" aren't matched as plan ids.  #
# --------------------------------------------------------------------------- #

MAX_PDF_BYTES = 15 * 1024 * 1024  # 15 MB cap
ALLOWED_PROXY_SCHEMES = {"http", "https"}


@api_router.post("/floor-plans/upload-pdf")
async def upload_pdf(
    file: UploadFile = File(...),
    user=Depends(require_role("Super Admin", "Admin")),
):
    """Persist a PDF on the backend disk and return a relative URL for use as pdfUrl."""
    data = await file.read()
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(400, f"PDF too large (max {MAX_PDF_BYTES // (1024 * 1024)} MB)")
    ctype = (file.content_type or "").lower()
    fname_lower = (file.filename or "").lower()
    if not (ctype == "application/pdf" or fname_lower.endswith(".pdf") or data[:5] == b"%PDF-"):
        raise HTTPException(400, "Only PDF files are accepted")
    if not data.startswith(b"%PDF"):
        raise HTTPException(400, "File does not look like a valid PDF")
    new_name = f"{uuid.uuid4()}.pdf"
    dest = PDF_STORAGE_DIR / new_name
    dest.write_bytes(data)
    rel = f"/api/floor-plans/pdf/{new_name}"
    return {
        "filename": file.filename,
        "size": len(data),
        "path": rel,
        "pdfUrl": rel,
    }


@api_router.get("/floor-plans/pdf/{filename}")
async def serve_pdf(filename: str, request: Request, auth: Optional[str] = Query(None)):
    """Serve a previously uploaded PDF. Auth via cookie, Bearer header, or `?auth=` query."""
    _verify_token_from_request(request, auth)
    if not PDF_FILENAME_RE.match(filename):
        raise HTTPException(404, "Not found")
    path = PDF_STORAGE_DIR / filename
    if not path.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(path, media_type="application/pdf", filename=filename)


@api_router.get("/floor-plans/proxy-pdf")
async def proxy_pdf(url: str, request: Request, auth: Optional[str] = Query(None)):
    """Stream an external PDF through the backend so it doesn't run into CORS in the browser."""
    _verify_token_from_request(request, auth)
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(400, "Invalid URL")
    if parsed.scheme.lower() not in ALLOWED_PROXY_SCHEMES or not parsed.netloc:
        raise HTTPException(400, "URL must be http(s)")
    try:
        upstream = requests.get(url, stream=True, timeout=20, allow_redirects=True)
    except requests.RequestException as e:
        raise HTTPException(502, f"Upstream fetch failed: {e}")
    if upstream.status_code >= 400:
        upstream.close()
        raise HTTPException(upstream.status_code, f"Upstream returned {upstream.status_code}")
    ctype = upstream.headers.get("Content-Type", "application/pdf")

    def _iter():
        try:
            for chunk in upstream.iter_content(chunk_size=64 * 1024):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    return StreamingResponse(_iter(), media_type=ctype)


# --------------------------------------------------------------------------- #
# Plan detail / delete / set-default / clone                                  #
# --------------------------------------------------------------------------- #

@api_router.get("/floor-plans/{plan_id}")
async def get_floor_plan(plan_id: str, user=Depends(get_current_user)):
    await ensure_migrated()
    plan = await _get_plan_or_404(plan_id)
    plan["live_seats"] = await _live_seats(plan)
    plan["live_rooms"] = await _live_rooms(plan)
    plan["version_count"] = await db.floor_plan_versions.count_documents({"plan_id": plan_id})
    plan["has_draft"] = plan.get("draft") is not None
    plan["status"] = _compute_status(plan)
    return _strip_legacy(plan)


@api_router.delete("/floor-plans/{plan_id}")
async def delete_floor_plan(plan_id: str, user=Depends(require_role("Super Admin", "Admin"))):
    plan = await _get_plan_or_404(plan_id)
    await db.floor_plan_versions.delete_many({"plan_id": plan_id})
    await db.floor_plans.delete_one({"id": plan_id})
    await log_audit(actor=_actor(user), action="floor_plan.delete",
                    resource="floor_plan", resource_id=plan_id,
                    metadata={"name": plan.get("name")})
    return {"ok": True}


class StatusIn(BaseModel):
    status: str  # 'live' | 'inactive'


@api_router.patch("/floor-plans/{plan_id}/status")
async def set_status(
    plan_id: str,
    payload: StatusIn,
    user=Depends(require_role("Super Admin", "Admin")),
):
    """Toggle a plan between Live and Inactive (Draft is derived, not set)."""
    plan = await _get_plan_or_404(plan_id)
    new = payload.status.lower()
    if new not in ("live", "inactive"):
        raise HTTPException(400, "status must be 'live' or 'inactive'")
    if new == "live" and not plan.get("live_version_id"):
        raise HTTPException(400, "Plan has no published version yet — cannot mark Live")
    override = None if new == "live" else "inactive"
    await db.floor_plans.update_one({"id": plan_id}, {"$set": {"status_override": override, "updated_at": now_iso(), "updated_by": _actor(user)}})
    await log_audit(actor=_actor(user), action=f"floor_plan.status.{new}",
                    resource="floor_plan", resource_id=plan_id,
                    metadata={"name": plan.get("name")})
    return {"ok": True, "status": new}


@api_router.post("/floor-plans/{plan_id}/clone")
async def clone_floor_plan(
    plan_id: str,
    payload: CloneIn,
    user=Depends(require_role("Super Admin", "Admin")),
):
    src = await _get_plan_or_404(plan_id)
    new_id = str(uuid.uuid4())
    actor = _actor(user)
    now = now_iso()

    # Determine source seats: prefer live; fall back to draft
    src_seats = await _live_seats(src)
    src_pdf = src.get("pdfUrl")
    if not src_seats and src.get("draft"):
        src_seats = src["draft"].get("seats", [])
        src_pdf = src["draft"].get("pdfUrl") or src_pdf

    # Create an initial published version 1 so the clone is immediately usable
    new_version_id = None
    if src_seats:
        new_version_id = str(uuid.uuid4())
        await db.floor_plan_versions.insert_one({
            "id": new_version_id,
            "plan_id": new_id,
            "version_number": 1,
            "state": "published",
            "seats": src_seats,
            "pdfUrl": src_pdf,
            "name": payload.name,
            "comments": f"Cloned from '{src.get('name')}'",
            "diff_summary": {"counts": {"added": len(src_seats), "removed": 0, "moved": 0, "rotated": 0, "resized": 0}},
            "created_at": now,
            "created_by": actor,
        })

    new_plan = {
        "id": new_id,
        "name": payload.name,
        "pdfUrl": src_pdf,
        "status_override": None,
        "live_version_id": new_version_id,
        "draft": None,
        "draft_updated_at": None,
        "created_at": now, "created_by": actor,
        "updated_at": now, "updated_by": actor,
    }
    await db.floor_plans.insert_one(new_plan)
    await log_audit(actor=actor, action="floor_plan.clone",
                    resource="floor_plan", resource_id=new_id,
                    metadata={"source_plan_id": plan_id, "source_name": src.get("name"), "new_name": payload.name, "seat_count": len(src_seats)})
    return _strip_id(new_plan)


# --------------------------------------------------------------------------- #
# Draft (auto-save target)                                                    #
# --------------------------------------------------------------------------- #

@api_router.put("/floor-plans/{plan_id}/draft")
async def save_draft(
    plan_id: str,
    payload: DraftIn,
    user=Depends(require_role("Super Admin", "Admin")),
):
    await _get_plan_or_404(plan_id)
    now = now_iso()
    actor = _actor(user)
    draft = {
        "seats": [s.model_dump() for s in payload.seats],
        "rooms": [r.model_dump() for r in payload.rooms],
        "pdfUrl": payload.pdfUrl,
        "updated_at": now,
        "updated_by": actor,
    }
    update = {
        "draft": draft,
        "draft_updated_at": now,
        "updated_at": now,
        "updated_by": actor,
        "pdfUrl": payload.pdfUrl,
    }
    if payload.name:
        update["name"] = payload.name
    await db.floor_plans.update_one({"id": plan_id}, {"$set": update})
    # No audit entry for auto-save (would be spammy). Audit fires on publish.
    return {"ok": True, "draft_updated_at": now}


@api_router.delete("/floor-plans/{plan_id}/draft")
async def discard_draft(plan_id: str, user=Depends(require_role("Super Admin", "Admin"))):
    await _get_plan_or_404(plan_id)
    await db.floor_plans.update_one({"id": plan_id}, {"$set": {"draft": None, "draft_updated_at": None}})
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Publish — promotes current draft to a new published version                 #
# --------------------------------------------------------------------------- #

@api_router.post("/floor-plans/{plan_id}/publish")
async def publish_draft(
    plan_id: str,
    payload: PublishIn,
    user=Depends(require_role("Super Admin", "Admin")),
):
    plan = await _get_plan_or_404(plan_id)
    if not plan.get("draft"):
        raise HTTPException(400, "No draft to publish")

    draft_seats = plan["draft"].get("seats", [])
    draft_rooms = plan["draft"].get("rooms", []) or []
    pdf_url = plan["draft"].get("pdfUrl") or plan.get("pdfUrl")

    # Validation: duplicate seat IDs would prevent publish
    seat_ids = [s["id"] for s in draft_seats]
    dupes = [sid for sid in set(seat_ids) if seat_ids.count(sid) > 1]
    if dupes:
        raise HTTPException(400, f"Duplicate seat IDs detected: {', '.join(sorted(dupes))}")

    prev_seats = await _live_seats(plan)
    diff = compute_diff(prev_seats, draft_seats)

    version_id = str(uuid.uuid4())
    actor = _actor(user)
    now = now_iso()
    version_number = await _next_version_number(plan_id)

    await db.floor_plan_versions.insert_one({
        "id": version_id,
        "plan_id": plan_id,
        "version_number": version_number,
        "state": "published",
        "seats": draft_seats,
        "rooms": draft_rooms,
        "pdfUrl": pdf_url,
        "name": plan.get("name"),
        "comments": payload.comments,
        "diff_summary": diff,
        "created_at": now,
        "created_by": actor,
    })
    await db.floor_plans.update_one(
        {"id": plan_id},
        {"$set": {
            "live_version_id": version_id,
            "draft": None,
            "draft_updated_at": None,
            "pdfUrl": pdf_url,
            "updated_at": now,
            "updated_by": actor,
        }},
    )
    await log_audit(actor=actor, action="floor_plan.publish",
                    resource="floor_plan", resource_id=plan_id,
                    metadata={"version_number": version_number, "version_id": version_id,
                              "comments": payload.comments, "diff": diff["counts"]})
    return {"ok": True, "version_id": version_id, "version_number": version_number, "diff": diff}


# --------------------------------------------------------------------------- #
# Versions: list / detail / rollback / compare                                #
# --------------------------------------------------------------------------- #

@api_router.get("/floor-plans/{plan_id}/versions")
async def list_versions(plan_id: str, user=Depends(get_current_user)):
    await _get_plan_or_404(plan_id)
    docs = await db.floor_plan_versions.find(
        {"plan_id": plan_id},
        {"_id": 0, "seats": 0},  # omit big seats array from list
    ).sort("version_number", -1).to_list(500)
    # expose actual current seat counts by counting on demand for accuracy
    for d in docs:
        v = await db.floor_plan_versions.find_one({"id": d["id"]}, {"seats": 1, "_id": 0})
        d["seat_count"] = len((v or {}).get("seats", []))
    return docs


@api_router.get("/floor-plans/{plan_id}/versions/compare")
async def compare_versions(plan_id: str, a: str, b: str, user=Depends(get_current_user)):
    va = await _get_version(a)
    vb = await _get_version(b)
    if not va or not vb or va["plan_id"] != plan_id or vb["plan_id"] != plan_id:
        raise HTTPException(404, "Version not found")
    diff = compute_diff(va.get("seats", []), vb.get("seats", []))
    return {
        "a": {"id": va["id"], "version_number": va["version_number"], "created_at": va["created_at"], "seat_count": len(va.get("seats", []))},
        "b": {"id": vb["id"], "version_number": vb["version_number"], "created_at": vb["created_at"], "seat_count": len(vb.get("seats", []))},
        "diff": diff,
    }


@api_router.get("/floor-plans/{plan_id}/versions/{version_id}")
async def get_version(plan_id: str, version_id: str, user=Depends(get_current_user)):
    v = await _get_version(version_id)
    if not v or v["plan_id"] != plan_id:
        raise HTTPException(404, "Version not found")
    return v


@api_router.post("/floor-plans/{plan_id}/versions/{version_id}/rollback")
async def rollback_to_version(
    plan_id: str,
    version_id: str,
    payload: RollbackIn,
    user=Depends(require_role("Super Admin", "Admin")),
):
    plan = await _get_plan_or_404(plan_id)
    target = await _get_version(version_id)
    if not target or target["plan_id"] != plan_id:
        raise HTTPException(404, "Version not found")

    prev_seats = await _live_seats(plan)
    diff = compute_diff(prev_seats, target.get("seats", []))

    new_version_id = str(uuid.uuid4())
    actor = _actor(user)
    now = now_iso()
    version_number = await _next_version_number(plan_id)

    await db.floor_plan_versions.insert_one({
        "id": new_version_id,
        "plan_id": plan_id,
        "version_number": version_number,
        "state": "published",
        "seats": target.get("seats", []),
        "pdfUrl": target.get("pdfUrl") or plan.get("pdfUrl"),
        "name": plan.get("name"),
        "comments": payload.comments or f"Rollback to version {target.get('version_number')}",
        "diff_summary": diff,
        "rolled_back_from": target["id"],
        "created_at": now,
        "created_by": actor,
    })
    await db.floor_plans.update_one(
        {"id": plan_id},
        {"$set": {
            "live_version_id": new_version_id,
            "pdfUrl": target.get("pdfUrl") or plan.get("pdfUrl"),
            "updated_at": now,
            "updated_by": actor,
        }},
    )
    await log_audit(actor=actor, action="floor_plan.rollback",
                    resource="floor_plan", resource_id=plan_id,
                    metadata={"from_version": target.get("version_number"),
                              "new_version": version_number, "diff": diff["counts"]})
    return {"ok": True, "version_id": new_version_id, "version_number": version_number, "diff": diff}


# --------------------------------------------------------------------------- #
# Thumbnail                                                                   #
# --------------------------------------------------------------------------- #

@api_router.put("/floor-plans/{plan_id}/thumbnail")
async def set_thumbnail(
    plan_id: str,
    payload: ThumbnailIn,
    user=Depends(require_role("Super Admin", "Admin")),
):
    """Store a base64 data-URL thumbnail. ~50KB-200KB strings."""
    await _get_plan_or_404(plan_id)
    if not payload.thumbnail.startswith("data:image/"):
        raise HTTPException(400, "Thumbnail must be a data:image/* URL")
    if len(payload.thumbnail) > 800_000:  # ~600KB binary cap
        raise HTTPException(400, "Thumbnail too large")
    await db.floor_plans.update_one({"id": plan_id}, {"$set": {"thumbnail": payload.thumbnail}})
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Audit log scoped to floor plans                                             #
# --------------------------------------------------------------------------- #

@api_router.get("/floor-plans/{plan_id}/audit")
async def plan_audit(plan_id: str, limit: int = 200, user=Depends(get_current_user)):
    await _get_plan_or_404(plan_id)
    docs = await db.audit_log.find(
        {"resource": "floor_plan", "resource_id": plan_id},
        {"_id": 0},
    ).sort("at", -1).limit(limit).to_list(limit)
    return docs

