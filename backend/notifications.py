"""Email notification service.

Two modes (controlled by EMAIL_PROVIDER env):
  - 'outbox' (default): Persists every email to the `notifications_outbox`
    collection so an Admin can review what would have been sent. No external
    network call is made.
  - 'resend': Same persistence, plus an HTTP POST to Resend's REST API. If
    RESEND_API_KEY is missing, falls back to outbox-only mode and marks the
    outbox row as `provider_error`.

Each outbox document carries the full rendered email and a `status` field
(`queued` → `sent` | `error`) so the Admin UI can show delivery history.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import requests

logger = logging.getLogger(__name__)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# -------- Templates --------

def render_new_employee_email(name: str, email: str, password: str, login_url: str) -> tuple[str, str]:
    subject = "Welcome to Infollion — your account is ready"
    body = (
        f"Hi {name},\n\n"
        f"An account has been created for you on Infollion.\n\n"
        f"  Login URL : {login_url or '(set APP_PUBLIC_URL)'}\n"
        f"  Email     : {email}\n"
        f"  Password  : {password}\n\n"
        "Please sign in and change your password from the profile screen.\n\n"
        "— Infollion Admin"
    )
    return subject, body


def render_admin_password_reset_email(name: str, email: str, password: str, login_url: str) -> tuple[str, str]:
    subject = "Your Infollion password has been reset"
    body = (
        f"Hi {name},\n\n"
        f"An administrator has reset your password.\n\n"
        f"  Login URL : {login_url or '(set APP_PUBLIC_URL)'}\n"
        f"  Email     : {email}\n"
        f"  Password  : {password}\n\n"
        "Sign in and change your password from the profile screen.\n\n"
        "— Infollion Admin"
    )
    return subject, body


def render_forgot_password_email(name: str, reset_link: str) -> tuple[str, str]:
    subject = "Reset your Infollion password"
    body = (
        f"Hi {name or 'there'},\n\n"
        "We received a request to reset your password. Click the link below to choose a new one. "
        "The link expires in 60 minutes.\n\n"
        f"  {reset_link}\n\n"
        "If you didn't request this, you can ignore this email.\n\n"
        "— Infollion"
    )
    return subject, body


# -------- Provider dispatch --------

def _send_via_resend(to_email: str, subject: str, body: str) -> tuple[bool, Optional[str]]:
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        return False, "RESEND_API_KEY not configured"
    sender = os.environ.get("EMAIL_FROM") or "no-reply@example.com"
    try:
        r = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"from": sender, "to": [to_email], "subject": subject, "text": body},
            timeout=20,
        )
        if r.status_code >= 300:
            return False, f"resend status {r.status_code}: {r.text[:300]}"
        return True, None
    except Exception as e:  # noqa: BLE001 - third-party network call
        return False, f"resend exception: {e}"


async def send_email(db, *, to_email: str, to_name: str, kind: str, subject: str, body: str,
                     related_id: Optional[str] = None, metadata: Optional[dict] = None,
                     variables: Optional[dict] = None) -> dict:
    """Persist + (optionally) send. Returns the outbox doc (sans _id).

    If a template exists in `email_templates` for the given `kind`, its subject/body
    overrides the caller-provided ones. `{{variable}}` placeholders are replaced from
    the merged `metadata` + `variables` map. If the template's `status == 'Inactive'`,
    the email is skipped entirely.
    """
    provider = (os.environ.get("EMAIL_PROVIDER") or "outbox").lower()

    # Look up template for this kind (most recently updated wins if multiple)
    tpl = await db.email_templates.find_one({"kind": kind})
    if tpl:
        if tpl.get("status") == "Inactive":
            logger.info(f"Email {kind} suppressed for {to_email}: template is Inactive")
            return {"skipped": True, "reason": "template_inactive", "kind": kind}
        subject = tpl.get("subject") or subject
        body = tpl.get("body") or body

    # Variable substitution: simple {{key}} replace
    merged_vars = {"name": to_name, "email": to_email, **(metadata or {}), **(variables or {})}
    for k, v in merged_vars.items():
        if v is None:
            v = ""
        subject = subject.replace("{{" + k + "}}", str(v))
        body = body.replace("{{" + k + "}}", str(v))

    doc = {
        "id": str(uuid.uuid4()),
        "to_email": to_email,
        "to_name": to_name,
        "kind": kind,
        "subject": subject,
        "body": body,
        "related_id": related_id,
        "metadata": metadata or {},
        "provider": provider,
        "status": "queued",
        "error": None,
        "created_at": now_iso(),
        "sent_at": None,
    }

    if provider == "resend":
        ok, err = _send_via_resend(to_email, subject, body)
        doc["status"] = "sent" if ok else "error"
        doc["error"] = err
        doc["sent_at"] = now_iso() if ok else None
    else:
        # 'outbox' / default: don't actually send, just persist.
        doc["status"] = "queued"

    await db.notifications_outbox.insert_one(doc)
    doc.pop("_id", None)
    if doc["status"] == "error":
        logger.warning(f"Email {kind} to {to_email} failed: {doc['error']}")
    else:
        logger.info(f"Email {kind} to {to_email} stored (status={doc['status']})")
    return doc
