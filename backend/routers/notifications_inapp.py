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


# ---------------------------------------------------------------------------
# Test-notification helpers (for the bell)
# ---------------------------------------------------------------------------
#
# These endpoints materialise a sample in-app notification for the current
# user using an existing template. They exist so a Super Admin / Admin can
# quickly validate that every template renders correctly in the bell
# dropdown without needing to trigger the real business flow (workstation
# request, meeting room booking, ticket close, etc.).

# Realistic-looking dummy variables per kind so placeholders like
# `{{seat_label}}` render as something meaningful in the bell.
_TEST_VARIABLES_BY_KIND = {
    "workstation_request_submitted": {
        "requested_by_name": "Aarushi Bhatia",
        "employee_name": "Aarushi Bhatia",
        "seat_label": "A-101",
        "date": "20 Aug 2026",
    },
    "workstation_request_approved": {
        "seat_label": "A-101",
        "date": "20 Aug 2026",
        "decided_by": "Admin User",
    },
    "workstation_request_declined": {
        "seat_label": "A-101",
        "date": "20 Aug 2026",
        "decided_by": "Admin User",
    },
    "workstation_assigned": {
        "seat_label": "B-204",
        "date": "20 Aug 2026",
        "assigned_by": "Admin User",
    },
    "meeting_room_request_submitted": {
        "requested_by_name": "Aarushi Bhatia",
        "meeting_title": "Sprint Planning",
        "room_name": "Alpha",
        "start_at": "20 Aug 2026, 10:00 AM",
    },
    "meeting_room_request_approved": {
        "title": "Sprint Planning",
        "room_name": "Alpha",
        "start_at": "20 Aug 2026, 10:00 AM",
        "decided_by": "Admin User",
    },
    "meeting_room_request_declined": {
        "title": "Sprint Planning",
        "room_name": "Alpha",
        "start_at": "20 Aug 2026, 10:00 AM",
        "decided_by": "Admin User",
    },
    "request_closed": {
        "ticket_id": "TCK-00512",
        "closed_by": "Admin User",
    },
}

# The bell popover navigates using `action_url` when the row is clicked.
# For each template kind we route to the same destination a real production
# notification of that kind would hit, so admins can validate the entire
# click-through flow. When we don't have a real booking/request ID to point
# at (this is a synthetic test after all), we fall back to the listing page
# for that resource — the admin still lands on the correct module.
def _test_action_url_for(kind: str) -> str:
    routes = {
        # Approvers land on the pending-approvals queue
        "workstation_request_submitted":  "/workspace-manager/pending-approvals",
        "meeting_room_request_submitted": "/workspace-manager/pending-approvals",
        # Approved workstation → the workstation bookings listing
        "workstation_request_approved":   "/workspace-manager/bookings",
        "workstation_assigned":           "/workspace-manager/bookings",
        # Declined workstation → the requestor's own workstation request page
        "workstation_request_declined":   "/workspace-manager/request-workstation",
        # Meeting-room approved / declined → the booking screen
        "meeting_room_request_approved":  "/workspace-manager/meeting-room-booking",
        "meeting_room_request_declined":  "/workspace-manager/meeting-room-booking",
        # Profix request closed → the admin's tickets list
        "request_closed":                 "/admin/open-requests",
    }
    return routes.get(kind, "/admin/notification-templates")


async def _materialise_test_notification(user: dict, tpl: dict) -> dict:
    """Insert one inapp_notifications row for ``user`` using ``tpl``.

    Uses the standard ``notify_user_inapp`` helper so the resulting row is
    indistinguishable from a production one — including template rendering
    of ``{{placeholders}}``.
    """
    from inapp_notifications import notify_user_inapp

    kind = tpl["kind"]
    variables = _TEST_VARIABLES_BY_KIND.get(kind, {})
    doc = await notify_user_inapp(
        db,
        user_id=user["id"],
        kind=kind,
        variables=variables,
        related_id=tpl["id"],
        related_type="notification_template_test",
        action_url=_test_action_url_for(kind),
        default_title=tpl.get("title") or "Test notification",
        default_body=tpl.get("body") or "This is a test notification.",
    )
    if doc is None:
        # Template is Inactive — still surface a row so the admin can see
        # something in the bell for validation. Bypass status check by
        # inserting directly with a "(Test — Inactive)" tag in the title.
        import uuid as _uuid
        title = tpl.get("title") or "Test notification"
        body = tpl.get("body") or "This is a test notification."
        # Render placeholders manually for the inactive case.
        for k, v in variables.items():
            title = title.replace("{{" + k + "}}", str(v))
            body = body.replace("{{" + k + "}}", str(v))
        doc = {
            "id": str(_uuid.uuid4()),
            "user_id": user["id"],
            "kind": kind,
            "title": f"[Test] {title}",
            "body": body,
            "related_id": tpl["id"],
            "related_type": "notification_template_test",
            "action_url": _test_action_url_for(kind),
            "read": False,
            "created_at": now_iso(),
            "read_at": None,
        }
        await db.inapp_notifications.insert_one(doc)
        doc.pop("_id", None)
    return doc


@api_router.post("/notification-templates/{tpl_id}/send-test")
async def send_test_notification(
    tpl_id: str,
    user=Depends(require_role("Super Admin", "Admin")),
):
    """Create one sample in-app notification for the current user from a
    single template. Useful for previewing what a real notification will
    look like in the bell dropdown."""
    tpl = await db.notification_templates.find_one({"id": tpl_id})
    if not tpl:
        raise HTTPException(404, "Template not found")
    doc = await _materialise_test_notification(user, tpl)
    await log_audit(
        actor=user, action="notification_template.send_test",
        resource="notification_template", resource_id=tpl_id,
        detail=f"Sent test notification '{tpl.get('name')}' to self",
        severity="info",
    )
    return {"ok": True, "notification": doc}


@api_router.post("/notification-templates/send-test-all")
async def send_test_notifications_all(
    user=Depends(require_role("Super Admin", "Admin")),
):
    """Create one sample in-app notification per template for the current
    user in a single call. This gives admins a quick way to populate the
    bell with one entry for every template so all cards can be validated.

    Prior test-notifications for this user are wiped first so the bell only
    contains the freshly-created set — otherwise repeated presses would
    quickly clutter the dropdown with duplicates.
    """
    await db.inapp_notifications.delete_many({
        "user_id": user["id"],
        "related_type": "notification_template_test",
    })
    tpls = await db.notification_templates.find({}, {"_id": 0}).to_list(500)
    created = []
    for tpl in tpls:
        doc = await _materialise_test_notification(user, tpl)
        if doc:
            created.append({"kind": tpl["kind"], "id": doc.get("id")})
    await log_audit(
        actor=user, action="notification_template.send_test_all",
        resource="notification_template", resource_id="*",
        detail=f"Sent test notifications for {len(created)} templates to self",
        severity="info",
    )
    return {"ok": True, "count": len(created), "notifications": created}



# ---------------------------------------------------------------------------
# Notification-settings singleton (bell refresh cadence)
# ---------------------------------------------------------------------------
#
# Stored as a singleton doc in `notification_settings`:
#   { id: "singleton", poll_interval_ms: int, updated_at, updated_by }
#
# The frontend NotificationBell reads this on mount and re-schedules its
# unread-count poll accordingly. Any authenticated user can read; only Super
# Admin can write.

_SETTINGS_SINGLETON = "singleton"
_DEFAULT_POLL_MS = 10 * 60 * 1000       # 10 minutes
_MIN_POLL_MS     = 1 * 1000             # 1 second
_MAX_POLL_MS     = 24 * 60 * 60 * 1000  # 24 hours


class NotificationSettingsUpdate(BaseModel):
    poll_interval_ms: int = Field(..., ge=_MIN_POLL_MS, le=_MAX_POLL_MS)


async def _get_notification_settings_doc() -> dict:
    doc = await db.notification_settings.find_one({"id": _SETTINGS_SINGLETON}, {"_id": 0})
    if not doc:
        doc = {
            "id": _SETTINGS_SINGLETON,
            "poll_interval_ms": _DEFAULT_POLL_MS,
            "updated_at": None,
            "updated_by": None,
        }
    return doc


@api_router.get("/notifications/settings")
async def get_notification_settings(user=Depends(get_current_user)):
    """Return the current bell-poll settings. Any authenticated user."""
    return await _get_notification_settings_doc()


@api_router.put("/notifications/settings")
async def update_notification_settings(
    body: NotificationSettingsUpdate,
    user=Depends(require_role("Super Admin")),
):
    """Update the bell-poll cadence. Super Admin only."""
    upd = {
        "id": _SETTINGS_SINGLETON,
        "poll_interval_ms": int(body.poll_interval_ms),
        "updated_at": now_iso(),
        "updated_by": user["id"],
    }
    await db.notification_settings.update_one(
        {"id": _SETTINGS_SINGLETON}, {"$set": upd}, upsert=True,
    )
    await log_audit(
        actor=user, action="notification_settings.update",
        resource="notification_settings", resource_id=_SETTINGS_SINGLETON,
        detail=f"Bell refresh interval set to {upd['poll_interval_ms']} ms",
        severity="info",
    )
    return await _get_notification_settings_doc()
