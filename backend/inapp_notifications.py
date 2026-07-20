"""In-app notifications (the bell dropdown).

Two collections
---------------
* ``notification_templates`` — one row per notification `kind`, editable via
  the "Notification Templates" admin page. Fields::

      { id, kind, name, description, trigger, title, body, action_label,
        status: "Active" | "Inactive", system, created_at, updated_at }

* ``inapp_notifications`` — per-user records that materialise when a
  triggering event happens. Fields::

      { id, user_id, kind, title, body, related_id, related_type,
        action_url, read, created_at, read_at }

Public helper
-------------
:func:`notify_user_inapp` is called from anywhere in the backend (ticket
close, workstation approve, etc.) to emit a notification. It reads the
template for the ``kind`` (falling back to caller-provided title/body),
substitutes ``{{variable}}`` placeholders and inserts a row into
``inapp_notifications`` — but only if the template is Active.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Default templates seeded on startup (idempotent — only inserted if missing)
# ---------------------------------------------------------------------------
DEFAULT_INAPP_NOTIFICATION_TEMPLATES = [
    {
        "kind": "workstation_request_approved",
        "name": "Workstation Request Approved",
        "description": "Fires when a Workspace Manager approves a workstation "
                       "request the recipient had submitted.",
        "trigger": "Workspace Manager approves a workstation request",
        "title": "Workstation request approved",
        "body": "Your workstation request for {{seat_label}} on {{date}} was "
                "approved by {{decided_by}}.",
        "action_label": "View booking",
    },
    {
        "kind": "workstation_request_declined",
        "name": "Workstation Request Declined",
        "description": "Fires when a Workspace Manager declines a workstation "
                       "request the recipient had submitted.",
        "trigger": "Workspace Manager declines a workstation request",
        "title": "Workstation request declined",
        "body": "Your workstation request for {{seat_label}} on {{date}} was "
                "declined by {{decided_by}}.",
        "action_label": "View request",
    },
    {
        "kind": "workstation_assigned",
        "name": "Workstation Assigned",
        "description": "Fires when a Workspace Manager creates a booking that "
                       "directly assigns a workstation to the recipient "
                       "(without going through a request).",
        "trigger": "Workspace Manager assigns a workstation to an employee",
        "title": "You've been assigned a workstation",
        "body": "You have been assigned {{seat_label}} on {{date}} by "
                "{{assigned_by}}.",
        "action_label": "View booking",
    },
    {
        "kind": "request_closed",
        "name": "Request Closed (Profix)",
        "description": "Fires when a Profix data-quality request created by "
                       "the recipient is closed.",
        "trigger": "Profix agent closes a request",
        "title": "Request {{ticket_id}} closed",
        "body": "Your request {{ticket_id}} was closed by {{closed_by}}.",
        "action_label": "View request",
    },
]


async def seed_default_templates(db):
    """Insert missing default templates. Existing templates (identified by
    ``kind``) are left untouched so admin edits are preserved across restarts.
    """
    now = now_iso()
    for tpl in DEFAULT_INAPP_NOTIFICATION_TEMPLATES:
        existing = await db.notification_templates.find_one({"kind": tpl["kind"]})
        if existing:
            continue
        await db.notification_templates.insert_one({
            "id": str(uuid.uuid4()),
            **tpl,
            "status": "Active",
            "system": True,
            "created_at": now,
            "updated_at": now,
        })


def _render(text: str, variables: dict) -> str:
    """Simple ``{{key}}`` replacement — mirrors ``send_email`` behaviour."""
    if not text:
        return ""
    for k, v in (variables or {}).items():
        if v is None:
            v = ""
        text = text.replace("{{" + str(k) + "}}", str(v))
    return text


async def notify_user_inapp(
    db,
    *,
    user_id: str,
    kind: str,
    variables: Optional[dict] = None,
    related_id: Optional[str] = None,
    related_type: Optional[str] = None,
    action_url: Optional[str] = None,
    # Fallbacks used when there's no template row for this kind
    default_title: str = "",
    default_body: str = "",
) -> Optional[dict]:
    """Materialise an in-app notification for ``user_id``.

    Returns the inserted doc (sans _id) on success, ``None`` if the template
    is Inactive or there was no user to notify. All exceptions are swallowed
    with a warning log so a notification failure never breaks the caller's
    business flow.
    """
    if not user_id:
        return None
    try:
        tpl = await db.notification_templates.find_one({"kind": kind})
        if tpl and tpl.get("status") == "Inactive":
            logger.info(f"In-app notification {kind} skipped for user={user_id}: template Inactive")
            return None
        title = _render((tpl or {}).get("title") or default_title, variables or {})
        body = _render((tpl or {}).get("body") or default_body, variables or {})
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "kind": kind,
            "title": title,
            "body": body,
            "related_id": related_id,
            "related_type": related_type,
            "action_url": action_url,
            "read": False,
            "created_at": now_iso(),
            "read_at": None,
        }
        await db.inapp_notifications.insert_one(doc)
        doc.pop("_id", None)
        return doc
    except Exception as e:  # noqa: BLE001 — never break caller
        logger.warning(f"notify_user_inapp({kind}) failed for user={user_id}: {e}")
        return None
