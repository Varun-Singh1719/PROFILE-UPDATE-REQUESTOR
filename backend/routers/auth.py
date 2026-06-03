"""Auth: login, google session, logout, me, forgot/reset password."""
import os
import uuid
import logging
import secrets
from datetime import datetime, timezone, timedelta

import requests
from fastapi import Depends, HTTPException, Response

from core import (
    api_router, db, log_audit, now_iso, hash_password, verify_password,
    encrypt_password, create_access_token, get_current_user, _public_contact,
    hash_reset_token,
    LoginIn, GoogleSessionIn, ForgotPasswordIn, ResetPasswordIn,
)
from notifications import send_email, render_forgot_password_email

logger = logging.getLogger(__name__)


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
    response.set_cookie("access_token", token, httponly=True, secure=False, samesite="none", max_age=43200, path="/")
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
    response.set_cookie("access_token", token, httponly=True, secure=False, samesite="none", max_age=43200, path="/")
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


@api_router.post("/auth/forgot-password")
async def forgot_password(body: ForgotPasswordIn):
    """Always returns 200 to prevent email enumeration."""
    email = body.email.lower().strip()
    user = await db.contacts.find_one({"email": email})
    if user and user.get("status") == "Active":
        token = secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc) + timedelta(hours=1)
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
    if not expires or expires < datetime.now(timezone.utc):
        raise HTTPException(400, "Invalid or expired reset link")
    user = await db.contacts.find_one({"id": rec["user_id"]})
    if not user or user.get("status") != "Active":
        raise HTTPException(400, "Invalid or expired reset link")
    await db.contacts.update_one({"id": user["id"]}, {"$set": {
        "password_hash": hash_password(body.new_password),
        "password_encrypted": encrypt_password(body.new_password),
    }})
    await db.password_reset_tokens.update_one({"id": rec["id"]}, {"$set": {"used": True, "used_at": now_iso()}})
    await log_audit(
        actor=user, action="auth.reset_password", resource="auth", resource_id=user["id"],
        detail=f"{user.get('email')} reset their password via link", severity="warning",
    )
    return {"ok": True}
