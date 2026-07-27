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
# dropdown AND clicks through to the correct focused view.
#
# CRITICAL — we DO NOT invent synthetic data. Every test notification points
# at a REAL entry in the database (a real pending request, a real declined
# meeting-room booking, a real closed ticket, …). That way clicking the
# notification opens the target page with the correct row selected and
# focused, exactly as a production notification would.


async def _pick_real_entry_for_kind(kind: str) -> Optional[dict]:
    """Return a fresh dict {id, action_url, variables} sourced from a REAL
    DB entry that matches the state a notification of ``kind`` fires from.
    Returns None only when no matching row exists — in that case the caller
    should skip this kind (never invent a fake id).
    """
    # ------------------------------------------------------------------
    # Workstation requests
    # ------------------------------------------------------------------
    if kind == "workstation_request_submitted":
        req = await db.workstation_requests.find_one(
            {"status": "Pending Approval"}, {"_id": 0}, sort=[("requested_on", -1)]
        )
        if not req:
            return None
        rid = req["id"]
        return {
            "id": rid,
            "action_url": f"/workspace-manager/pending-approvals?requestId={rid}",
            "variables": {
                "requested_by_name": (req.get("requested_by") or {}).get("name") or "Admin User",
                "employee_name":     (req.get("employee") or {}).get("name") or "Employee",
                "seat_label":        req.get("seat_label") or "—",
                "date":              req.get("date") or "",
            },
            "related_type": "workstation_request",
        }

    if kind == "workstation_request_approved":
        # Prefer an Approved request that has a linked booking so the click
        # opens the booking detail (matches real production behaviour).
        req = await db.workstation_requests.find_one(
            {"status": "Approved", "approved_booking_id": {"$exists": True, "$ne": None}},
            {"_id": 0},
            sort=[("decided_on", -1)],
        )
        if not req:
            req = await db.workstation_requests.find_one({"status": "Approved"}, {"_id": 0})
        if not req:
            return None
        booking_id = req.get("approved_booking_id") or req["id"]
        return {
            "id": booking_id,
            "action_url": f"/workspace-manager/bookings?bookingId={booking_id}",
            "variables": {
                "seat_label": req.get("seat_label") or "—",
                "date":       req.get("date") or "",
                "decided_by": (req.get("decided_by") or {}).get("name") or "Admin User",
            },
            "related_type": "workstation_booking",
        }

    if kind == "workstation_request_declined":
        req = await db.workstation_requests.find_one(
            {"status": "Declined"}, {"_id": 0}, sort=[("decided_on", -1)]
        )
        if not req:
            return None
        rid = req["id"]
        return {
            "id": rid,
            "action_url": f"/workspace-manager/request-workstation?requestId={rid}",
            "variables": {
                "seat_label": req.get("seat_label") or "—",
                "date":       req.get("date") or "",
                "decided_by": (req.get("decided_by") or {}).get("name") or "Admin User",
            },
            "related_type": "workstation_request",
        }

    if kind == "workstation_assigned":
        booking = await db.workstation_bookings.find_one({}, {"_id": 0}, sort=[("created_at", -1)])
        if not booking:
            return None
        bid = booking["id"]
        return {
            "id": bid,
            "action_url": f"/workspace-manager/bookings?bookingId={bid}",
            "variables": {
                "seat_label":  booking.get("seat_label") or "—",
                "date":        booking.get("date") or "",
                "assigned_by": (booking.get("created_by") or {}).get("name") or "Admin User",
            },
            "related_type": "workstation_booking",
        }

    # ------------------------------------------------------------------
    # Meeting room requests
    # ------------------------------------------------------------------
    if kind == "meeting_room_request_submitted":
        req = await db.meeting_room_requests.find_one(
            {"status": "Pending Approval"}, {"_id": 0}, sort=[("requested_on", -1)]
        )
        if not req:
            return None
        rid = req["id"]
        return {
            "id": rid,
            "action_url": f"/workspace-manager/pending-approvals?requestId={rid}",
            "variables": {
                "requested_by_name": (req.get("requested_by") or {}).get("name") or "Admin User",
                "meeting_title":     req.get("title") or "Meeting",
                "room_name":         req.get("room_name") or "Room",
                "start_at":          req.get("start_at") or "",
            },
            "related_type": "meeting_room_request",
        }

    if kind == "meeting_room_request_approved":
        booking = await db.room_bookings.find_one({}, {"_id": 0}, sort=[("created_at", -1)])
        if not booking:
            return None
        bid = booking["id"]
        # For {{decided_by}} — pull the request that spawned this booking if
        # available, otherwise fall back to the organizer.
        decided_by = ""
        from_req_id = booking.get("from_request_id")
        if from_req_id:
            req = await db.meeting_room_requests.find_one({"id": from_req_id}, {"_id": 0})
            if req:
                decided_by = (req.get("decided_by") or {}).get("name", "")
        if not decided_by:
            decided_by = (booking.get("organizer") or {}).get("name") or "Admin User"
        return {
            "id": bid,
            "action_url": f"/workspace-manager/meeting-room-booking?bookingId={bid}",
            "variables": {
                "title":      booking.get("title") or "Meeting",
                "room_name":  booking.get("room_name") or "Room",
                "start_at":   booking.get("start_at") or "",
                "decided_by": decided_by,
            },
            "related_type": "room_booking",
        }

    if kind == "meeting_room_request_declined":
        req = await db.meeting_room_requests.find_one(
            {"status": "Declined"}, {"_id": 0}, sort=[("decided_on", -1)]
        )
        if not req:
            return None
        rid = req["id"]
        return {
            "id": rid,
            "action_url": f"/workspace-manager/meeting-room-booking?requestId={rid}",
            "variables": {
                "title":      req.get("title") or "Meeting",
                "room_name":  req.get("room_name") or "Room",
                "start_at":   req.get("start_at") or "",
                "decided_by": (req.get("decided_by") or {}).get("name") or "Admin User",
            },
            "related_type": "meeting_room_request",
        }

    # ------------------------------------------------------------------
    # Profix ticket closed
    # ------------------------------------------------------------------
    if kind == "request_closed":
        ticket = await db.tickets.find_one(
            {"status": "Closed"}, {"_id": 0}, sort=[("closed_on", -1)]
        )
        if not ticket:
            return None
        tid = ticket["id"]
        # Tickets carry a human-readable id (e.g. "TKT-1102") separate from
        # the internal uuid. Use it in the body so the bell's regex parser
        # extracts a clean number, matching real production notifications.
        display_id = ticket.get("ticket_id") or tid[:8]
        closed_by = (
            (ticket.get("closed_by") or {}).get("name")
            if isinstance(ticket.get("closed_by"), dict)
            else (ticket.get("closed_by") if isinstance(ticket.get("closed_by"), str) else None)
        )
        if not closed_by:
            closed_by = (ticket.get("updated_by") or {}).get("name", "") or "Admin User"
        return {
            "id": tid,
            "action_url": f"/admin/tickets/{tid}",
            "variables": {
                "ticket_id": display_id,
                "closed_by": closed_by,
            },
            "related_type": "ticket",
        }

    return None


async def _materialise_test_notification(user: dict, tpl: dict) -> Optional[dict]:
    """Insert one inapp_notifications row for ``user`` using ``tpl`` and a
    REAL matching-state DB entry. Returns None (and inserts nothing) when
    no suitable entry exists — callers should log and skip that kind.

    The inserted row is tagged with related_type='notification_template_test'
    so the dedup wipe in send-test-all can find it, but the action_url and
    the visible id refer to real data — clicking the bell row opens the
    target page with the correct entity selected, exactly as production.
    """
    from inapp_notifications import notify_user_inapp

    kind = tpl["kind"]
    src = await _pick_real_entry_for_kind(kind)
    if not src:
        return None
    doc = await notify_user_inapp(
        db,
        user_id=user["id"],
        kind=kind,
        variables=src["variables"],
        related_id=src["id"],
        # We keep the test tag so the dedup wipe in send-test-all can
        # target it, but expose the real underlying entity via
        # related_id + action_url so click-through works.
        related_type="notification_template_test",
        action_url=src["action_url"],
        default_title=tpl.get("title") or "Test notification",
        default_body=tpl.get("body") or "This is a test notification.",
    )
    if doc is None:
        # Template Inactive → bypass status check with a manual insert so
        # the admin can still validate the row (title tagged with [Test]).
        import uuid as _uuid
        title = tpl.get("title") or "Test notification"
        body = tpl.get("body") or "This is a test notification."
        for k, v in src["variables"].items():
            title = title.replace("{{" + k + "}}", str(v))
            body = body.replace("{{" + k + "}}", str(v))
        doc = {
            "id": str(_uuid.uuid4()),
            "user_id": user["id"],
            "kind": kind,
            "title": f"[Test] {title}",
            "body": body,
            "related_id": src["id"],
            "related_type": "notification_template_test",
            "action_url": src["action_url"],
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
    single template, linked to a REAL matching-state entry so click-through
    opens the correct focused view."""
    tpl = await db.notification_templates.find_one({"id": tpl_id})
    if not tpl:
        raise HTTPException(404, "Template not found")
    doc = await _materialise_test_notification(user, tpl)
    if not doc:
        raise HTTPException(
            409,
            f"No matching-state entry exists for kind '{tpl['kind']}' — "
            "create a real request/booking/ticket in the appropriate state first.",
        )
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
    user, each linked to a REAL matching-state DB entry so click-through
    opens the correct focused view. Templates whose kind has no matching
    entry are reported in the ``skipped`` list rather than silently ignored.

    Prior test-notifications for this user are wiped first so the bell only
    contains the freshly-created set.
    """
    await db.inapp_notifications.delete_many({
        "user_id": user["id"],
        "related_type": "notification_template_test",
    })
    tpls = await db.notification_templates.find({}, {"_id": 0}).to_list(500)
    created, skipped = [], []
    for tpl in tpls:
        doc = await _materialise_test_notification(user, tpl)
        if doc:
            created.append({"kind": tpl["kind"], "id": doc.get("id"),
                            "related_id": doc.get("related_id"),
                            "action_url": doc.get("action_url")})
        else:
            skipped.append({"kind": tpl["kind"], "name": tpl.get("name"),
                            "reason": "no matching-state entry in DB"})
    await log_audit(
        actor=user, action="notification_template.send_test_all",
        resource="notification_template", resource_id="*",
        detail=f"Sent test notifications for {len(created)} templates "
               f"(skipped {len(skipped)})",
        severity="info",
    )
    return {"ok": True, "count": len(created), "notifications": created,
            "skipped": skipped}



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
