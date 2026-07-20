"""HTTP surface for in-app notifications (the bell) + notification templates.

Endpoints
---------
Bell dropdown (any authenticated user, scoped to `user_id == current_user.id`):
    GET    /api/notifications/inapp                — list (?status=unread|read|all&limit=50)
    GET    /api/notifications/inapp/unread-count   — { count: N }
    POST   /api/notifications/inapp/{id}/read      — mark one read
    POST   /api/notifications/inapp/read-all       — mark all read

Notification templates admin (Super Admin only for edits; Admin can read):
    GET    /api/notification-templates             — list all
    GET    /api/notification-templates/{id}
    PATCH  /api/notification-templates/{id}        — update title / body / status
"""

from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from core import api_router, db, get_current_user, log_audit, now_iso, require_role


# ---------------------------------------------------------------------------
# Bell dropdown APIs
# ---------------------------------------------------------------------------

@api_router.get("/notifications/inapp")
async def list_inapp_notifications(
    user=Depends(get_current_user),
    status: str = "all",
    limit: int = 50,
):
    """Return the current user's notifications, newest first.

    ``status`` = ``unread`` | ``read`` | ``all`` (default all).
    """
    q = {"user_id": user["id"]}
    s = (status or "all").lower()
    if s == "unread":
        q["read"] = False
    elif s == "read":
        q["read"] = True
    limit = max(1, min(int(limit or 50), 200))
    items = (
        await db.inapp_notifications
        .find(q, {"_id": 0})
        .sort("created_at", -1)
        .to_list(limit)
    )
    return items


@api_router.get("/notifications/inapp/unread-count")
async def unread_count(user=Depends(get_current_user)):
    n = await db.inapp_notifications.count_documents({"user_id": user["id"], "read": False})
    return {"count": n}


@api_router.post("/notifications/inapp/{notif_id}/read")
async def mark_read(notif_id: str, user=Depends(get_current_user)):
    doc = await db.inapp_notifications.find_one({"id": notif_id, "user_id": user["id"]})
    if not doc:
        raise HTTPException(404, "Notification not found")
    if not doc.get("read"):
        await db.inapp_notifications.update_one(
            {"id": notif_id},
            {"$set": {"read": True, "read_at": now_iso()}},
        )
    return {"ok": True}


@api_router.post("/notifications/inapp/read-all")
async def mark_all_read(user=Depends(get_current_user)):
    result = await db.inapp_notifications.update_many(
        {"user_id": user["id"], "read": False},
        {"$set": {"read": True, "read_at": now_iso()}},
    )
    return {"ok": True, "updated": result.modified_count}


# ---------------------------------------------------------------------------
# Notification-templates admin APIs
# ---------------------------------------------------------------------------

class NotificationTemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    title: Optional[str] = Field(None, max_length=200)
    body: Optional[str] = Field(None, max_length=2000)
    action_label: Optional[str] = Field(None, max_length=80)
    status: Optional[str] = None  # "Active" | "Inactive"


@api_router.get("/notification-templates")
async def list_notification_templates(user=Depends(require_role("Super Admin", "Admin"))):
    items = await db.notification_templates.find({}, {"_id": 0}).sort("kind", 1).to_list(500)
    return items


@api_router.get("/notification-templates/{tpl_id}")
async def get_notification_template(tpl_id: str, user=Depends(require_role("Super Admin", "Admin"))):
    tpl = await db.notification_templates.find_one({"id": tpl_id}, {"_id": 0})
    if not tpl:
        raise HTTPException(404, "Template not found")
    return tpl


@api_router.patch("/notification-templates/{tpl_id}")
async def update_notification_template(
    tpl_id: str,
    body: NotificationTemplateUpdate,
    user=Depends(require_role("Super Admin", "Admin")),
):
    tpl = await db.notification_templates.find_one({"id": tpl_id})
    if not tpl:
        raise HTTPException(404, "Template not found")
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if user["role"] != "Super Admin":
        # Non–Super Admin can only toggle Active/Inactive
        upd = {k: v for k, v in upd.items() if k == "status"}
        if not upd:
            raise HTTPException(403, "Only Super Admin can edit template content")
    if "status" in upd and upd["status"] not in ("Active", "Inactive"):
        raise HTTPException(400, "status must be 'Active' or 'Inactive'")
    upd["updated_at"] = now_iso()
    upd["updated_by"] = user["id"]
    await db.notification_templates.update_one({"id": tpl_id}, {"$set": upd})
    out = await db.notification_templates.find_one({"id": tpl_id}, {"_id": 0})
    await log_audit(
        actor=user, action="notification_template.update",
        resource="notification_template", resource_id=tpl_id,
        detail=f"Updated notification template '{out.get('name')}'",
        severity="info",
    )
    return out
