"""Auth: login, google session, logout, me, change/forgot/reset password."""
import os
import re
import uuid
import logging
import secrets
from datetime import datetime, timezone, timedelta

import requests
from fastapi import Depends, HTTPException, Response
from pydantic import BaseModel

from core import (
    api_router, db, log_audit, now_iso, hash_password, verify_password,
    encrypt_password, create_access_token, get_current_user, _public_contact,
    hash_reset_token, IST, ist_now,
    LoginIn, GoogleSessionIn, ForgotPasswordIn, ResetPasswordIn,
)
from notifications import send_email, render_forgot_password_email

logger = logging.getLogger(__name__)

# Password policy — mirror this on the frontend strength meter.
# Min 8 chars, with at least one uppercase, lowercase, digit, special character.
PASSWORD_SPECIAL_RE = re.compile(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>/?`~]")

def validate_password_policy(pw: str) -> str | None:
    """Return an error string if `pw` fails the policy, else None."""
    if not pw or len(pw) < 8:
        return "Password must be at least 8 characters"
    if not re.search(r"[A-Z]", pw):
        return "Password must contain at least one uppercase letter"
    if not re.search(r"[a-z]", pw):
        return "Password must contain at least one lowercase letter"
    if not re.search(r"\d", pw):
        return "Password must contain at least one digit"
    if not PASSWORD_SPECIAL_RE.search(pw):
        return "Password must contain at least one special character"
    return None


class ChangePasswordIn(BaseModel):
    old_password: str
    new_password: str


@api_router.post("/auth/login")
async def login(body: LoginIn, response: Response):
    email = body.email.lower().strip()
    user = await db.contacts.find_one({"email": email})
    if not user:
        raise HTTPException(401, "Invalid credentials")
    if user.get("status") != "Active":
        raise HTTPException(403, "Account is inactive")
    if not verify_password(body.password, user.get("password_hash", "")):
        raise HTTPException(401, "Invalid credentials")
    token = create_access_token(user["id"], user["email"], user["role"])
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none", max_age=43200, path="/")
    await db.contacts.update_one({"id": user["id"]}, {"$set": {"last_login": now_iso()}})
    _public_contact(user)
    await log_audit(
        actor=user, action="auth.login", resource="auth",
        detail=f"{user.get('name')} logged in", severity="info",
    )
    return {"user": user, "access_token": token}


# REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
@api_router.post("/auth/google-session")
async def google_session(body: GoogleSessionIn, response: Response):
    try:
        r = requests.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": body.session_id},
            timeout=15,
        )
        if r.status_code != 200:
            raise HTTPException(401, "Invalid Google session")
        data = r.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Google session exchange failed: {e}")
        raise HTTPException(500, "Auth service unavailable")

    email = (data.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(401, "No email returned from Google")

    user = await db.contacts.find_one({"email": email})
    if not user:
        raise HTTPException(403, "User does not exist.")
    if user.get("status") != "Active":
        raise HTTPException(403, "User does not exist.")

    token = create_access_token(user["id"], user["email"], user["role"])
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none", max_age=43200, path="/")
    await db.contacts.update_one({"id": user["id"]}, {"$set": {"last_login": now_iso()}})
    _public_contact(user)
    return {"user": user, "access_token": token}


@api_router.post("/auth/logout")
async def logout(response: Response, _: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


# --------------------------------------------------------------------------- #
# Impersonation ("Login As")                                                   #
#                                                                             #
# A Super Admin can mint a short-lived access token for any other active      #
# user. The frontend opens a NEW browser tab and stores the token in that     #
# tab's sessionStorage so the original tab (which uses localStorage +         #
# httpOnly cookie) is not affected. Every impersonation is written to the     #
# audit log with the actor + target.                                          #
# --------------------------------------------------------------------------- #

class ImpersonateIn(BaseModel):
    user_id: str


@api_router.get("/auth/impersonation-candidates")
async def impersonation_candidates(actor: dict = Depends(get_current_user)):
    """List active users a Super Admin can impersonate. Excludes the actor
    itself and inactive accounts. Returned rows are trimmed to what the
    dropdown needs — id, name, email, role."""
    if actor.get("role") != "Super Admin":
        raise HTTPException(403, "Only Super Admins can impersonate")
    cursor = db.contacts.find(
        {"status": "Active", "id": {"$ne": actor.get("id")}},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1},
    ).sort("name", 1)
    users = await cursor.to_list(1000)
    return {"users": users}


@api_router.post("/auth/impersonate")
async def impersonate(body: ImpersonateIn, actor: dict = Depends(get_current_user)):
    """Mint an access token for another user. Super Admin only. Does NOT set
    the auth cookie — the caller (frontend) puts the returned token into the
    new tab's `sessionStorage` so the original session keeps working."""
    if actor.get("role") != "Super Admin":
        raise HTTPException(403, "Only Super Admins can impersonate")
    if not body.user_id or body.user_id == actor.get("id"):
        raise HTTPException(400, "Pick a different user to impersonate")

    target = await db.contacts.find_one({"id": body.user_id})
    if not target:
        raise HTTPException(404, "User not found")
    if target.get("status") != "Active":
        raise HTTPException(400, "That user account is inactive")

    token = create_access_token(target["id"], target["email"], target["role"])
    _public_contact(target)

    await log_audit(
        actor=actor,
        action="auth.impersonate",
        resource="user",
        resource_id=target["id"],
        detail=f"{actor.get('name') or actor.get('email')} started impersonating {target.get('name') or target.get('email')}",
        metadata={
            "target_id": target["id"],
            "target_email": target.get("email"),
            "target_role": target.get("role"),
        },
        severity="warning",
    )
    return {"access_token": token, "user": target}


@api_router.post("/auth/forgot-password")
async def forgot_password(body: ForgotPasswordIn):
    """Always returns 200 to prevent email enumeration."""
    email = body.email.lower().strip()
    user = await db.contacts.find_one({"email": email})
    if user and user.get("status") == "Active":
        token = secrets.token_urlsafe(32)
        expires = ist_now() + timedelta(hours=1)
        await db.password_reset_tokens.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "email": email,
            "token_hash": hash_reset_token(token),
            "expires_at": expires,
            "used": False,
            "created_at": now_iso(),
        })
        public = os.environ.get("APP_PUBLIC_URL", "").rstrip("/")
        reset_link = f"{public}/reset-password?token={token}"
        try:
            subject, msg = render_forgot_password_email(user["name"], reset_link)
            await send_email(
                db, to_email=user["email"], to_name=user["name"],
                kind="forgot_password", subject=subject, body=msg,
                related_id=user["id"], metadata={"reset_link": reset_link},
                variables={"reset_link": reset_link},
            )
        except Exception as e:
            logger.error(f"forgot password email failed: {e}")
        await log_audit(
            actor=user, action="auth.forgot_password", resource="auth",
            detail=f"Password reset requested for {email}", severity="info",
        )
    return {"ok": True}


@api_router.post("/auth/reset-password")
async def reset_password(body: ResetPasswordIn):
    if not body.new_password or len(body.new_password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    rec = await db.password_reset_tokens.find_one({"token_hash": hash_reset_token(body.token)})
    if not rec or rec.get("used"):
        raise HTTPException(400, "Invalid or expired reset link")
    expires = rec.get("expires_at")
    if isinstance(expires, str):
        try:
            expires = datetime.fromisoformat(expires)
        except Exception:
            expires = None
    if isinstance(expires, datetime) and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if not expires or expires < ist_now():
        raise HTTPException(400, "Invalid or expired reset link")
    user = await db.contacts.find_one({"id": rec["user_id"]})
    if not user or user.get("status") != "Active":
        raise HTTPException(400, "Invalid or expired reset link")
    await db.contacts.update_one({"id": user["id"]}, {"$set": {
        "password_hash": hash_password(body.new_password),
        "password_encrypted": encrypt_password(body.new_password),
        "password_changed_at": now_iso(),
    }})
    await db.password_reset_tokens.update_one({"id": rec["id"]}, {"$set": {"used": True, "used_at": now_iso()}})
    await log_audit(
        actor=user, action="auth.reset_password", resource="auth", resource_id=user["id"],
        detail=f"{user.get('email')} reset their password via link", severity="warning",
    )
    return {"ok": True}


@api_router.post("/auth/change-password")
async def change_password(body: ChangePasswordIn, user: dict = Depends(get_current_user)):
    """Authenticated password change.

    Validation order (fail-fast):
      1. Old password must match the stored hash.
      2. New password must satisfy the system policy (8+ chars / upper / lower / digit / special).
      3. New password must differ from old password (no reuse of current).

    On success: updates password_hash + password_encrypted + password_changed_at,
    records an audit event, and returns 200.
    """
    # Look up the live user with password fields (current_user has them stripped).
    record = await db.contacts.find_one({"id": user["id"]})
    if not record:
        raise HTTPException(404, "User not found")
    if record.get("status") != "Active":
        raise HTTPException(403, "Account is inactive")

    # 1. Verify old password
    if not verify_password(body.old_password, record.get("password_hash", "")):
        raise HTTPException(400, "Old password is incorrect")

    # 2. Policy
    err = validate_password_policy(body.new_password)
    if err:
        raise HTTPException(400, err)

    # 3. Reject reuse of current password
    if verify_password(body.new_password, record.get("password_hash", "")):
        raise HTTPException(400, "New password must be different from the current password")

    now = now_iso()
    await db.contacts.update_one({"id": user["id"]}, {"$set": {
        "password_hash": hash_password(body.new_password),
        "password_encrypted": encrypt_password(body.new_password),
        "password_changed_at": now,
    }})
    await log_audit(
        actor=user, action="auth.change_password", resource="auth", resource_id=user["id"],
        detail=f"{user.get('email')} changed their password", severity="warning",
    )
    return {"ok": True, "password_changed_at": now}
