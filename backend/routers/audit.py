"""Audit log (org-wide)."""
from typing import Optional
from fastapi import Depends
from core import api_router, db, require_role


async def _list_audit_impl(
    user,
    q: Optional[str] = None,
    resource: Optional[str] = None,
    action: Optional[str] = None,
    severity: Optional[str] = None,
    actor_id: Optional[str] = None,
    limit: int = 200,
):
    """Shared implementation used by both /audit-log (canonical) and
    /audit-logs (plural alias, added Jul 30 2026 for API-consumer
    discoverability — see backend QA report)."""
    query = {}
    if resource: query["resource"] = resource
    if action: query["action"] = {"$regex": action, "$options": "i"}
    if severity: query["severity"] = severity
    if actor_id: query["actor_id"] = actor_id
    if q:
        query["$or"] = [
            {"detail": {"$regex": q, "$options": "i"}},
            {"actor_name": {"$regex": q, "$options": "i"}},
            {"actor_email": {"$regex": q, "$options": "i"}},
            {"action": {"$regex": q, "$options": "i"}},
        ]
    items = await db.audit_log.find(query, {"_id": 0}).sort("at", -1).to_list(min(limit, 1000))
    return items


@api_router.get("/audit-log")
async def list_audit(
    user=Depends(require_role("Super Admin")),
    q: Optional[str] = None,
    resource: Optional[str] = None,
    action: Optional[str] = None,
    severity: Optional[str] = None,
    actor_id: Optional[str] = None,
    limit: int = 200,
):
    return await _list_audit_impl(user, q, resource, action, severity, actor_id, limit)


@api_router.get("/audit-logs")
async def list_audit_alias(
    user=Depends(require_role("Super Admin")),
    q: Optional[str] = None,
    resource: Optional[str] = None,
    action: Optional[str] = None,
    severity: Optional[str] = None,
    actor_id: Optional[str] = None,
    limit: int = 200,
):
    """Plural alias for /api/audit-log — added for API-consumer discoverability."""
    return await _list_audit_impl(user, q, resource, action, severity, actor_id, limit)

