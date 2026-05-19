from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import secrets
import string
import bcrypt
import jwt
import requests
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal, Dict, Any
from cryptography.fernet import Fernet
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File, Form, Query, Header
from fastapi.responses import Response as FastResponse, StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

import csv
import io
import hashlib
from notifications import (
    send_email,
    render_new_employee_email,
    render_admin_password_reset_email,
    render_forgot_password_email,
)

# ---------- Config ----------
JWT_ALGORITHM = "HS256"
JWT_SECRET = os.environ["JWT_SECRET"]
APP_NAME = os.environ.get("APP_NAME", "ticketing-system")
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
FERNET_KEY = os.environ.get("FERNET_KEY")
fernet = Fernet(FERNET_KEY.encode()) if FERNET_KEY else None

# ---------- DB ----------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# ---------- App ----------
app = FastAPI()
api_router = APIRouter(prefix="/api")

# ---------- Storage ----------
storage_key = None

def init_storage():
    global storage_key
    if storage_key:
        return storage_key
    try:
        resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
        resp.raise_for_status()
        storage_key = resp.json()["storage_key"]
        return storage_key
    except Exception as e:
        logging.error(f"Storage init failed: {e}")
        return None

def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    if not key:
        raise HTTPException(500, "Storage not available")
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120
    )
    resp.raise_for_status()
    return resp.json()

def get_object(path: str):
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key}, timeout=60
    )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")

# ---------- Helpers ----------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

def encrypt_password(plain: str) -> Optional[str]:
    if not fernet:
        return None
    return fernet.encrypt(plain.encode("utf-8")).decode("utf-8")

def decrypt_password(token: Optional[str]) -> Optional[str]:
    if not fernet or not token:
        return None
    try:
        return fernet.decrypt(token.encode("utf-8")).decode("utf-8")
    except Exception:
        return None

def generate_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    pwd = "".join(secrets.choice(alphabet) for _ in range(length - 2))
    # Ensure complexity: 1 upper, 1 lower, 1 digit, 1 special
    specials = "!@#$%&*"
    return (
        secrets.choice(string.ascii_uppercase)
        + secrets.choice(string.ascii_lowercase)
        + pwd
        + secrets.choice(string.digits)
        + secrets.choice(specials)
    )

def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
        "type": "access"
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def now_iso():
    return datetime.now(timezone.utc).isoformat()

# ---------- Permission Module Schema ----------
PERMISSION_MODULES = [
    {
        "key": "profix",
        "label": "ProfiX",
        "description": "Expert Profile Update Tool",
        "icon": "Briefcase",
        "color": "#ec9324",
        "groups": [
            {
                "key": "tickets",
                "label": "Tickets & Requests",
                "features": [
                    {"key": "ticket", "label": "Ticket", "actions": ["view", "create", "edit", "assign", "approve", "delete"]},
                    {"key": "ticket_status", "label": "Ticket Status", "actions": ["view", "edit", "approve"]},
                    {"key": "comments", "label": "Comments", "actions": ["view", "create", "edit", "delete"]},
                    {"key": "attachments", "label": "Attachments", "actions": ["view", "create", "delete"]},
                ],
            },
            {
                "key": "analytics",
                "label": "Analytics & Reports",
                "features": [
                    {"key": "dq_dashboard", "label": "DQ Performance Dashboard", "actions": ["view"]},
                    {"key": "ticket_reports", "label": "Ticket Reports", "actions": ["view", "create"]},
                ],
            },
        ],
    },
    {
        "key": "desk_booking",
        "label": "Desk Booking",
        "description": "Seat Allocation System",
        "icon": "Armchair",
        "color": "#3b82f6",
        "groups": [
            {
                "key": "seats",
                "label": "Seat Management",
                "features": [
                    {"key": "seat_request", "label": "Seat Request", "actions": ["view", "create", "edit", "approve", "delete"]},
                    {"key": "team_seat_request", "label": "Team Seat Request", "actions": ["view", "create", "approve"]},
                    {"key": "seat_allocation", "label": "Seat Allocation", "actions": ["view", "assign", "edit"]},
                ],
            },
            {
                "key": "floor",
                "label": "Floor Plan",
                "features": [
                    {"key": "floor_plan", "label": "Floor Plan", "actions": ["view", "edit"]},
                    {"key": "zones", "label": "Zones", "actions": ["view", "create", "edit", "delete"]},
                ],
            },
        ],
    },
]

ALL_ACTIONS = ["view", "create", "edit", "assign", "approve", "delete"]
# Actions where "scope" (Respective vs All) matters. Other actions stay boolean.
SCOPED_ACTIONS = {"view", "edit", "assign"}

def normalize_action_value(v) -> Any:
    """Normalize a stored action value to one of: False, True, 'respective', 'all'.

    Legacy boolean True is treated as 'all' when the action is scoped.
    """
    if v in ("all", "respective"):
        return v
    return bool(v)

def action_precedence(v) -> int:
    """Higher = more permissive. Used when merging across role/team/employee."""
    if v == "all":
        return 3
    if v == "respective":
        return 2
    if v is True:
        return 2  # legacy 'true' acts like 'respective+' but below 'all'
    return 0

def feature_actions(module_key: str, feature_key: str) -> List[str]:
    for m in PERMISSION_MODULES:
        if m["key"] != module_key:
            continue
        for g in m["groups"]:
            for f in g["features"]:
                if f["key"] == feature_key:
                    return f["actions"]
    return []

DEFAULT_PRESETS = [
    {
        "id": "preset-research-user",
        "name": "Research User",
        "description": "Create & view own ProfiX requests; comment on them.",
        "module": "profix",
        "rules": [
            {"feature": "ticket", "actions": {"view": True, "create": True, "edit": False, "assign": False, "approve": False, "delete": False}},
            {"feature": "comments", "actions": {"view": True, "create": True, "edit": False, "delete": False}},
            {"feature": "attachments", "actions": {"view": True, "create": True, "delete": False}},
            {"feature": "ticket_reports", "actions": {"view": False, "create": False}},
        ],
        "system": True,
    },
    {
        "id": "preset-dq-staff",
        "name": "DQ Staff",
        "description": "Self-assign tickets and update own tickets.",
        "module": "profix",
        "rules": [
            {"feature": "ticket", "actions": {"view": True, "create": False, "edit": True, "assign": True, "approve": False, "delete": False}},
            {"feature": "ticket_status", "actions": {"view": True, "edit": True, "approve": False}},
            {"feature": "comments", "actions": {"view": True, "create": True, "edit": True, "delete": False}},
            {"feature": "attachments", "actions": {"view": True, "create": True, "delete": False}},
        ],
        "system": True,
    },
    {
        "id": "preset-dq-manager",
        "name": "DQ Manager",
        "description": "Assign any ticket and update any ticket status.",
        "module": "profix",
        "rules": [
            {"feature": "ticket", "actions": {"view": True, "create": True, "edit": True, "assign": True, "approve": True, "delete": False}},
            {"feature": "ticket_status", "actions": {"view": True, "edit": True, "approve": True}},
            {"feature": "comments", "actions": {"view": True, "create": True, "edit": True, "delete": True}},
            {"feature": "attachments", "actions": {"view": True, "create": True, "delete": True}},
            {"feature": "dq_dashboard", "actions": {"view": True}},
            {"feature": "ticket_reports", "actions": {"view": True, "create": True}},
        ],
        "system": True,
    },
    {
        "id": "preset-admin-full-profix",
        "name": "Admin (Full)",
        "description": "Unrestricted access on ProfiX.",
        "module": "profix",
        "rules": [
            {"feature": "ticket", "actions": {"view": True, "create": True, "edit": True, "assign": True, "approve": True, "delete": True}},
            {"feature": "ticket_status", "actions": {"view": True, "edit": True, "approve": True}},
            {"feature": "comments", "actions": {"view": True, "create": True, "edit": True, "delete": True}},
            {"feature": "attachments", "actions": {"view": True, "create": True, "delete": True}},
            {"feature": "dq_dashboard", "actions": {"view": True}},
            {"feature": "ticket_reports", "actions": {"view": True, "create": True}},
        ],
        "system": True,
    },
    {
        "id": "preset-desk-staff",
        "name": "Staff (self only)",
        "description": "Request a desk for yourself only.",
        "module": "desk_booking",
        "rules": [
            {"feature": "seat_request", "actions": {"view": True, "create": True, "edit": True, "approve": False, "delete": True}},
            {"feature": "team_seat_request", "actions": {"view": False, "create": False, "approve": False}},
            {"feature": "seat_allocation", "actions": {"view": True, "assign": False, "edit": False}},
            {"feature": "floor_plan", "actions": {"view": True, "edit": False}},
        ],
        "system": True,
    },
    {
        "id": "preset-desk-manager",
        "name": "Manager (team)",
        "description": "Request seats for your team members.",
        "module": "desk_booking",
        "rules": [
            {"feature": "seat_request", "actions": {"view": True, "create": True, "edit": True, "approve": False, "delete": True}},
            {"feature": "team_seat_request", "actions": {"view": True, "create": True, "approve": False}},
            {"feature": "seat_allocation", "actions": {"view": True, "assign": False, "edit": False}},
            {"feature": "floor_plan", "actions": {"view": True, "edit": False}},
        ],
        "system": True,
    },
    {
        "id": "preset-desk-hr",
        "name": "HR (allocate + approve)",
        "description": "Allocate seats and approve requests.",
        "module": "desk_booking",
        "rules": [
            {"feature": "seat_request", "actions": {"view": True, "create": True, "edit": True, "approve": True, "delete": True}},
            {"feature": "team_seat_request", "actions": {"view": True, "create": True, "approve": True}},
            {"feature": "seat_allocation", "actions": {"view": True, "assign": True, "edit": True}},
            {"feature": "floor_plan", "actions": {"view": True, "edit": True}},
            {"feature": "zones", "actions": {"view": True, "create": True, "edit": True, "delete": True}},
        ],
        "system": True,
    },
]

# ---------- Audit helper ----------
async def log_audit(*, actor: dict, action: str, resource: str, resource_id: Optional[str] = None,
                   detail: str = "", metadata: Optional[dict] = None, severity: str = "info"):
    try:
        await db.audit_log.insert_one({
            "id": str(uuid.uuid4()),
            "at": now_iso(),
            "actor_id": (actor or {}).get("id"),
            "actor_name": (actor or {}).get("name"),
            "actor_email": (actor or {}).get("email"),
            "actor_role": (actor or {}).get("role"),
            "action": action,
            "resource": resource,
            "resource_id": resource_id,
            "detail": detail,
            "metadata": metadata or {},
            "severity": severity,
        })
    except Exception as e:
        logging.error(f"audit log failed: {e}")

def _public_contact(doc: dict) -> dict:
    """Sanitize contact for output (drop _id, password_hash, password_encrypted)."""
    if not doc:
        return doc
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    doc.pop("password_encrypted", None)
    return doc

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.contacts.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0, "password_encrypted": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        if user.get("status") != "Active":
            raise HTTPException(status_code=403, detail="User is inactive")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def require_role(*roles):
    async def checker(user=Depends(get_current_user)):
        if user.get("role") not in roles:
            raise HTTPException(403, "Not authorized")
        return user
    return checker

# ---------- Models ----------
# 'Research' is the new label; 'Research Associate' and 'DQ Team' are kept in the Literal
# only for backward-compatibility while existing rows are migrated. New employees can never
# be assigned 'DQ Team' or 'Research Associate' — the form dropdown hides them.
ContactRole = Literal["Admin", "Manager", "Research", "Delivery", "Member", "DQ Team", "Research Associate"]
ContactStatus = Literal["Active", "Inactive"]
TicketStatus = Literal["Open", "In Progress", "Closed"]
TicketPriority = Literal["High", "Medium", "Low"]

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class GoogleSessionIn(BaseModel):
    session_id: str

class ContactCreate(BaseModel):
    email: EmailStr
    name: str
    phone: Optional[str] = None
    role: ContactRole
    emp_id: str
    doj: str  # YYYY-MM-DD — mandatory

class ContactUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[ContactRole] = None
    status: Optional[ContactStatus] = None
    emp_id: Optional[str] = None
    doj: Optional[str] = None

class TeamCreate(BaseModel):
    name: str
    manager_ids: List[str] = []
    member_ids: List[str] = []
    color: Optional[str] = "#ec9324"

class TeamUpdate(BaseModel):
    name: Optional[str] = None
    manager_ids: Optional[List[str]] = None
    member_ids: Optional[List[str]] = None
    color: Optional[str] = None

class PermissionsIn(BaseModel):
    rules: List[Dict[str, Any]]

class TicketCreate(BaseModel):
    subject: str
    description: Optional[str] = ""
    priority: TicketPriority
    due_date: Optional[str] = None
    number_of_profiles: Optional[int] = None
    attachment_path: Optional[str] = None
    attachment_name: Optional[str] = None
    attachments: Optional[List[dict]] = None

class TicketUpdate(BaseModel):
    status: Optional[TicketStatus] = None
    assigned_to: Optional[str] = None  # contact id, or empty string for unassign

class BulkAssign(BaseModel):
    ticket_ids: List[str]
    assigned_to: Optional[str] = None

class BulkStatus(BaseModel):
    ticket_ids: List[str]
    status: TicketStatus

class CommentCreate(BaseModel):
    content: str

class ForgotPasswordIn(BaseModel):
    email: EmailStr

class ResetPasswordIn(BaseModel):
    token: str
    new_password: str

class BulkContactStatus(BaseModel):
    contact_ids: List[str]
    status: ContactStatus

class BulkContactRole(BaseModel):
    contact_ids: List[str]
    role: ContactRole

class EmailTemplateIn(BaseModel):
    name: str
    kind: str  # new_employee | admin_password_reset | forgot_password | custom-<slug>
    category: Optional[str] = "transactional"
    subject: str
    body: str  # HTML or plaintext
    status: Literal["Active", "Inactive"] = "Active"

class EmailTemplateUpdate(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = None
    category: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    status: Optional[Literal["Active", "Inactive"]] = None

# ---------- Auth Routes ----------
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
    response.set_cookie("access_token", token, httponly=True, secure=False, samesite="lax", max_age=43200, path="/")
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
    response.set_cookie("access_token", token, httponly=True, secure=False, samesite="lax", max_age=43200, path="/")
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

# ---------- Forgot / Reset Password ----------
def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

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
            "token_hash": _hash_reset_token(token),
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
    rec = await db.password_reset_tokens.find_one({"token_hash": _hash_reset_token(body.token)})
    if not rec or rec.get("used"):
        raise HTTPException(400, "Invalid or expired reset link")
    expires = rec.get("expires_at")
    # MongoDB returns datetimes as naive UTC; normalize.
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

# ---------- Notifications Outbox ----------
@api_router.get("/notifications/outbox")
async def list_notifications(
    user=Depends(require_role("Admin")),
    kind: Optional[str] = None,
    status: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 200,
):
    query = {}
    if kind: query["kind"] = kind
    if status: query["status"] = status
    if q:
        query["$or"] = [
            {"to_email": {"$regex": q, "$options": "i"}},
            {"to_name": {"$regex": q, "$options": "i"}},
            {"subject": {"$regex": q, "$options": "i"}},
        ]
    items = await db.notifications_outbox.find(query, {"_id": 0}).sort("created_at", -1).to_list(min(limit, 1000))
    return items

@api_router.get("/notifications/outbox/{notif_id}")
async def get_notification(notif_id: str, user=Depends(require_role("Admin"))):
    n = await db.notifications_outbox.find_one({"id": notif_id}, {"_id": 0})
    if not n:
        raise HTTPException(404, "Not found")
    return n

@api_router.delete("/notifications/outbox/{notif_id}")
async def delete_notification(notif_id: str, user=Depends(require_role("Admin"))):
    await db.notifications_outbox.delete_one({"id": notif_id})
    return {"ok": True}

# ---------- Email Templates ----------
DEFAULT_TEMPLATES = [
    {
        "kind": "new_employee",
        "name": "New employee welcome",
        "category": "onboarding",
        "subject": "Welcome to Infollion — your account is ready",
        "body": (
            "<p>Hi {{name}},</p>"
            "<p>An account has been created for you on Infollion.</p>"
            "<ul>"
            "<li><b>Email:</b> {{email}}</li>"
            "<li><b>Temporary password:</b> {{password}}</li>"
            "</ul>"
            "<p>Sign in at <a href=\"{{login_url}}\">{{login_url}}</a> and change your password from the profile screen.</p>"
            "<p>— Infollion Admin</p>"
        ),
    },
    {
        "kind": "admin_password_reset",
        "name": "Admin password reset notice",
        "category": "security",
        "subject": "Your Infollion password has been reset",
        "body": (
            "<p>Hi {{name}},</p>"
            "<p>An administrator has reset your password.</p>"
            "<ul>"
            "<li><b>Email:</b> {{email}}</li>"
            "<li><b>New password:</b> {{password}}</li>"
            "</ul>"
            "<p>Sign in at <a href=\"{{login_url}}\">{{login_url}}</a> and change your password from the profile screen.</p>"
        ),
    },
    {
        "kind": "forgot_password",
        "name": "Forgot password reset link",
        "category": "security",
        "subject": "Reset your Infollion password",
        "body": (
            "<p>Hi {{name}},</p>"
            "<p>We received a request to reset your password. The link below is valid for 60 minutes.</p>"
            "<p><a href=\"{{reset_link}}\">Reset my password</a></p>"
            "<p>If you didn't request this, you can ignore this email.</p>"
        ),
    },
]

@api_router.get("/email-templates")
async def list_email_templates(user=Depends(require_role("Admin", "Manager")), q: Optional[str] = None, category: Optional[str] = None, status: Optional[str] = None):
    query = {}
    if category: query["category"] = category
    if status: query["status"] = status
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"subject": {"$regex": q, "$options": "i"}},
            {"kind": {"$regex": q, "$options": "i"}},
        ]
    items = await db.email_templates.find(query, {"_id": 0}).sort("updated_at", -1).to_list(500)
    return items

@api_router.post("/email-templates")
async def create_email_template(body: EmailTemplateIn, user=Depends(require_role("Admin"))):
    if not body.name.strip():
        raise HTTPException(400, "Name is required")
    if not body.kind.strip():
        raise HTTPException(400, "Kind is required")
    doc = {
        "id": str(uuid.uuid4()),
        "name": body.name.strip(),
        "kind": body.kind.strip(),
        "category": body.category or "transactional",
        "subject": body.subject,
        "body": body.body,
        "status": body.status,
        "system": False,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "updated_by": user["id"],
    }
    await db.email_templates.insert_one(doc)
    doc.pop("_id", None)
    await log_audit(actor=user, action="email_template.create", resource="email_template",
                    resource_id=doc["id"], detail=f"Created template '{doc['name']}'", severity="info")
    return doc

@api_router.patch("/email-templates/{tpl_id}")
async def update_email_template(tpl_id: str, body: EmailTemplateUpdate, user=Depends(require_role("Admin", "Manager"))):
    tpl = await db.email_templates.find_one({"id": tpl_id})
    if not tpl:
        raise HTTPException(404, "Template not found")
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    # Manager can only toggle status, not edit content
    if user["role"] == "Manager":
        upd = {k: v for k, v in upd.items() if k == "status"}
        if not upd:
            raise HTTPException(403, "Managers can only toggle template status")
    upd["updated_at"] = now_iso()
    upd["updated_by"] = user["id"]
    await db.email_templates.update_one({"id": tpl_id}, {"$set": upd})
    out = await db.email_templates.find_one({"id": tpl_id}, {"_id": 0})
    await log_audit(actor=user, action="email_template.update", resource="email_template",
                    resource_id=tpl_id, detail=f"Updated template '{out['name']}'", severity="info")
    return out

@api_router.post("/email-templates/{tpl_id}/duplicate")
async def duplicate_email_template(tpl_id: str, user=Depends(require_role("Admin"))):
    tpl = await db.email_templates.find_one({"id": tpl_id}, {"_id": 0})
    if not tpl:
        raise HTTPException(404, "Template not found")
    doc = {**tpl, "id": str(uuid.uuid4()), "name": f"{tpl['name']} (copy)",
           "kind": f"custom-{uuid.uuid4().hex[:8]}", "system": False,
           "created_at": now_iso(), "updated_at": now_iso(), "updated_by": user["id"]}
    await db.email_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.delete("/email-templates/{tpl_id}")
async def delete_email_template(tpl_id: str, user=Depends(require_role("Admin"))):
    tpl = await db.email_templates.find_one({"id": tpl_id})
    if not tpl:
        raise HTTPException(404, "Template not found")
    if tpl.get("system"):
        raise HTTPException(400, "System templates cannot be deleted — set them to Inactive instead")
    await db.email_templates.delete_one({"id": tpl_id})
    await log_audit(actor=user, action="email_template.delete", resource="email_template",
                    resource_id=tpl_id, detail=f"Deleted template '{tpl['name']}'", severity="warning")
    return {"ok": True}

# ---------- Contacts helpers ----------
async def _enrich_contacts_with_team(contacts: List[dict]) -> List[dict]:
    """Attach team_name and manager_names from teams collection (employee belongs to 1 team)."""
    if not contacts:
        return contacts
    teams = await db.teams.find({}, {"_id": 0}).to_list(2000)
    # Map of member_id -> team
    member_team: Dict[str, dict] = {}
    for t in teams:
        for mid in t.get("member_ids", []) or []:
            member_team[mid] = t
        for mid in t.get("manager_ids", []) or []:
            # managers also "belong" to the team they manage as their team if not assigned elsewhere
            member_team.setdefault(mid, t)

    # Build manager_id -> name map
    mgr_ids = list({mid for t in teams for mid in (t.get("manager_ids") or [])})
    mgr_docs = []
    if mgr_ids:
        mgr_docs = await db.contacts.find({"id": {"$in": mgr_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)
    mgr_name_map = {m["id"]: m["name"] for m in mgr_docs}

    for c in contacts:
        t = member_team.get(c["id"])
        if t:
            c["team_id"] = t["id"]
            c["team_name"] = t["name"]
            c["team_color"] = t.get("color")
            c["manager_names"] = [mgr_name_map.get(mid, "") for mid in (t.get("manager_ids") or []) if mgr_name_map.get(mid)]
        else:
            c["team_id"] = None
            c["team_name"] = None
            c["team_color"] = None
            c["manager_names"] = []
    return contacts

# ---------- Contacts Routes ----------
@api_router.get("/contacts")
async def list_contacts(
    user=Depends(get_current_user),
    q: Optional[str] = None,
    role: Optional[str] = None,
    type: Optional[str] = None,
    status: Optional[str] = None,
    page: Optional[int] = None,
    page_size: int = 25,
    sort_by: str = "name",
    sort_dir: str = "asc",
):
    # 'type' kept as backward-compat alias for 'role'
    role_filter = role or type
    query = {}
    if user["role"] not in ("Admin", "Manager"):
        query["role"] = {"$in": ["DQ Team", "Admin", "Manager"]}
    if role_filter:
        query["role"] = role_filter
    if status:
        query["status"] = status
    if q:
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"email": {"$regex": q, "$options": "i"}}]
    # Pagination is opt-in: only kicks in when `page` is supplied.
    if page is not None:
        page = max(1, page)
        page_size = max(1, min(page_size, 200))
        sort_field = sort_by if sort_by in ("name", "email", "role", "doj", "emp_id", "created_on", "last_login", "status") else "name"
        sort_order = -1 if sort_dir == "desc" else 1
        total = await db.contacts.count_documents(query)
        cursor = db.contacts.find(query, {"_id": 0, "password_hash": 0, "password_encrypted": 0}).sort(sort_field, sort_order).skip((page - 1) * page_size).limit(page_size)
        items = await cursor.to_list(page_size)
        items = await _enrich_contacts_with_team(items)
        return {"items": items, "total": total, "page": page, "page_size": page_size}
    items = await db.contacts.find(query, {"_id": 0, "password_hash": 0, "password_encrypted": 0}).to_list(2000)
    items = await _enrich_contacts_with_team(items)
    return items

@api_router.get("/contacts/export.csv")
async def export_contacts_csv(
    user=Depends(require_role("Admin")),
    q: Optional[str] = None,
    role: Optional[str] = None,
    status: Optional[str] = None,
):
    query = {}
    if role: query["role"] = role
    if status: query["status"] = status
    if q:
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"email": {"$regex": q, "$options": "i"}}]
    items = await db.contacts.find(query, {"_id": 0, "password_hash": 0, "password_encrypted": 0}).to_list(10000)
    items = await _enrich_contacts_with_team(items)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Name", "Emp ID", "Email", "Phone", "Role", "Team", "Manager(s)", "DOJ", "Status", "Created On", "Last Login"])
    for c in items:
        w.writerow([
            c.get("name", ""), c.get("emp_id", ""), c.get("email", ""), c.get("phone", ""),
            c.get("role", ""), c.get("team_name") or "",
            ", ".join(c.get("manager_names") or []),
            c.get("doj") or "", c.get("status", ""),
            c.get("created_on", ""), c.get("last_login") or "",
        ])
    filename = f"employees_{datetime.now(timezone.utc).date().isoformat()}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

@api_router.post("/contacts/bulk-status")
async def bulk_contact_status(body: BulkContactStatus, user=Depends(require_role("Admin"))):
    if not body.contact_ids:
        raise HTTPException(400, "No contacts selected")
    # Prevent admin from deactivating themselves accidentally
    targets = [cid for cid in body.contact_ids if cid != user["id"]]
    if not targets:
        raise HTTPException(400, "Cannot change your own status")
    r = await db.contacts.update_many({"id": {"$in": targets}}, {"$set": {"status": body.status}})
    await log_audit(
        actor=user, action="contact.bulk_status", resource="contact",
        detail=f"Bulk set status={body.status} for {r.modified_count} employee(s)",
        metadata={"count": r.modified_count, "status": body.status},
        severity="warning",
    )
    return {"updated": r.modified_count}

@api_router.post("/contacts/bulk-role")
async def bulk_contact_role(body: BulkContactRole, user=Depends(require_role("Admin"))):
    if not body.contact_ids:
        raise HTTPException(400, "No contacts selected")
    targets = [cid for cid in body.contact_ids if cid != user["id"]]
    if not targets:
        raise HTTPException(400, "Cannot change your own role")
    r = await db.contacts.update_many({"id": {"$in": targets}}, {"$set": {"role": body.role}})
    await log_audit(
        actor=user, action="contact.bulk_role", resource="contact",
        detail=f"Bulk set role={body.role} for {r.modified_count} employee(s)",
        metadata={"count": r.modified_count, "role": body.role},
        severity="warning",
    )
    return {"updated": r.modified_count}

@api_router.post("/contacts")
async def create_contact(body: ContactCreate, user=Depends(require_role("Admin"))):
    email = body.email.lower().strip()
    if not body.emp_id or not body.emp_id.strip():
        raise HTTPException(400, "Employee ID is required")
    if not body.doj or not str(body.doj).strip():
        raise HTTPException(400, "Date of Joining is required")
    if await db.contacts.find_one({"email": email}):
        raise HTTPException(400, "Email already exists")
    if await db.contacts.find_one({"emp_id": body.emp_id.strip()}):
        raise HTTPException(400, "Employee ID already exists")
    generated_pwd = generate_password()
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": body.name,
        "phone": body.phone or "",
        "role": body.role,
        "emp_id": body.emp_id.strip(),
        "doj": body.doj,
        "status": "Active",
        "created_on": now_iso(),
        "last_login": None,
        "password_hash": hash_password(generated_pwd),
        "password_encrypted": encrypt_password(generated_pwd),
    }
    await db.contacts.insert_one(doc)
    out = _public_contact(dict(doc))
    out["generated_password"] = generated_pwd  # one-time return at creation
    # Send welcome email with credentials (outbox by default)
    try:
        subject, body = render_new_employee_email(
            name=doc["name"], email=doc["email"], password=generated_pwd,
            login_url=os.environ.get("APP_PUBLIC_URL", "") + "/login",
        )
        await send_email(
            db, to_email=doc["email"], to_name=doc["name"],
            kind="new_employee", subject=subject, body=body,
            related_id=doc["id"], metadata={"created_by": user.get("id")},
            variables={"password": generated_pwd, "login_url": os.environ.get("APP_PUBLIC_URL", "") + "/login"},
        )
    except Exception as e:
        logger.error(f"new-employee email failed: {e}")
    await log_audit(
        actor=user, action="contact.create", resource="contact", resource_id=doc["id"],
        detail=f"Created employee {doc['name']} ({doc['email']}) as {doc['role']}",
        severity="info",
    )
    return out

@api_router.patch("/contacts/{contact_id}")
async def update_contact(contact_id: str, body: ContactUpdate, user=Depends(require_role("Admin"))):
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "Nothing to update")
    await db.contacts.update_one({"id": contact_id}, {"$set": update})
    contact = await db.contacts.find_one({"id": contact_id}, {"_id": 0, "password_hash": 0, "password_encrypted": 0})
    if not contact:
        raise HTTPException(404, "Not found")
    [c] = await _enrich_contacts_with_team([contact])
    return c

@api_router.get("/contacts/{contact_id}")
async def get_contact(contact_id: str, user=Depends(require_role("Admin"))):
    c = await db.contacts.find_one({"id": contact_id}, {"_id": 0, "password_hash": 0, "password_encrypted": 0})
    if not c:
        raise HTTPException(404, "Not found")
    [c] = await _enrich_contacts_with_team([c])
    return c

@api_router.get("/contacts/{contact_id}/password")
async def get_contact_password(contact_id: str, user=Depends(require_role("Admin"))):
    c = await db.contacts.find_one({"id": contact_id})
    if not c:
        raise HTTPException(404, "Not found")
    pwd = decrypt_password(c.get("password_encrypted"))
    if not pwd:
        raise HTTPException(404, "Password not available — please reset to view")
    return {"password": pwd}

@api_router.post("/contacts/{contact_id}/reset-password")
async def reset_contact_password(contact_id: str, user=Depends(require_role("Admin"))):
    c = await db.contacts.find_one({"id": contact_id})
    if not c:
        raise HTTPException(404, "Not found")
    new_pwd = generate_password()
    await db.contacts.update_one({"id": contact_id}, {"$set": {
        "password_hash": hash_password(new_pwd),
        "password_encrypted": encrypt_password(new_pwd),
    }})
    # Notify the employee via email (outbox by default)
    try:
        subject, body = render_admin_password_reset_email(
            name=c["name"], email=c["email"], password=new_pwd,
            login_url=os.environ.get("APP_PUBLIC_URL", "") + "/login",
        )
        await send_email(
            db, to_email=c["email"], to_name=c["name"],
            kind="admin_password_reset", subject=subject, body=body,
            related_id=c["id"], metadata={"reset_by": user.get("id")},
            variables={"password": new_pwd, "login_url": os.environ.get("APP_PUBLIC_URL", "") + "/login"},
        )
    except Exception as e:
        logger.error(f"admin password reset email failed: {e}")
    await log_audit(
        actor=user, action="contact.reset_password", resource="contact", resource_id=contact_id,
        detail=f"Reset password for {c.get('name')} ({c.get('email')})", severity="warning",
    )
    return {"password": new_pwd}

# 30-color palette for auto-assignment (HSL-spaced, high-contrast)
TEAM_COLOR_PALETTE = [
    "#ec9324", "#22c55e", "#3b82f6", "#a855f7", "#ef4444",
    "#06b6d4", "#eab308", "#f97316", "#14b8a6", "#64748b",
    "#10b981", "#8b5cf6", "#f43f5e", "#0ea5e9", "#84cc16",
    "#d946ef", "#f59e0b", "#0891b2", "#6366f1", "#dc2626",
    "#16a34a", "#7c3aed", "#0284c7", "#ca8a04", "#be123c",
    "#059669", "#9333ea", "#0369a1", "#a16207", "#9f1239",
]

async def _next_unused_color(exclude_team_id: Optional[str] = None) -> str:
    """Pick the first palette color not yet used by another team."""
    q = {}
    if exclude_team_id:
        q["id"] = {"$ne": exclude_team_id}
    used = await db.teams.distinct("color", q)
    used_set = {c for c in used if c}
    for c in TEAM_COLOR_PALETTE:
        if c not in used_set:
            return c
    # All 30 used → cycle deterministically based on team count
    n = await db.teams.count_documents({})
    return TEAM_COLOR_PALETTE[n % len(TEAM_COLOR_PALETTE)]

@api_router.get("/teams/colors")
async def team_colors(user=Depends(get_current_user)):
    """Return palette + which colors are already taken."""
    used = await db.teams.distinct("color")
    suggested = await _next_unused_color()
    return {"palette": TEAM_COLOR_PALETTE, "used": [c for c in used if c], "suggested": suggested}

# ---------- Teams Routes ----------
@api_router.get("/teams")
async def list_teams(user=Depends(get_current_user)):
    teams = await db.teams.find({}, {"_id": 0}).sort("created_on", -1).to_list(2000)
    # Enrich with names
    all_ids = {mid for t in teams for mid in (t.get("manager_ids") or []) + (t.get("member_ids") or [])}
    contacts = []
    if all_ids:
        contacts = await db.contacts.find({"id": {"$in": list(all_ids)}}, {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1}).to_list(2000)
    name_map = {c["id"]: c for c in contacts}
    for t in teams:
        t["managers"] = [name_map.get(mid, {"id": mid, "name": "Unknown"}) for mid in (t.get("manager_ids") or [])]
        t["members"] = [name_map.get(mid, {"id": mid, "name": "Unknown"}) for mid in (t.get("member_ids") or [])]
    return teams

@api_router.post("/teams")
async def create_team(body: TeamCreate, user=Depends(require_role("Admin"))):
    if not body.name.strip():
        raise HTTPException(400, "Team name required")
    if await db.teams.find_one({"name": body.name.strip()}):
        raise HTTPException(400, "Team name already exists")
    # Ensure members not already in another team (since employee belongs to one team)
    member_ids = list({*body.member_ids})
    if member_ids:
        conflict = await db.teams.find_one({"member_ids": {"$in": member_ids}})
        if conflict:
            raise HTTPException(400, f"Some members already belong to team '{conflict['name']}'")
    # Auto-assign next unused color only when the admin didn't supply one.
    color = body.color
    if not color:
        color = await _next_unused_color()
    doc = {
        "id": str(uuid.uuid4()),
        "name": body.name.strip(),
        "manager_ids": list({*body.manager_ids}),
        "member_ids": member_ids,
        "color": color,
        "created_on": now_iso(),
        "updated_on": now_iso(),
    }
    await db.teams.insert_one(doc)
    doc.pop("_id", None)
    await log_audit(
        actor=user, action="team.create", resource="team", resource_id=doc["id"],
        detail=f"Created team '{doc['name']}' with {len(doc['member_ids'])} members",
        severity="info",
    )
    return doc

@api_router.patch("/teams/{team_id}")
async def update_team(team_id: str, body: TeamUpdate, user=Depends(require_role("Admin"))):
    team = await db.teams.find_one({"id": team_id})
    if not team:
        raise HTTPException(404, "Team not found")
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if "name" in update:
        update["name"] = update["name"].strip()
        if update["name"] != team["name"]:
            other = await db.teams.find_one({"name": update["name"]})
            if other:
                raise HTTPException(400, "Team name already exists")
    if "member_ids" in update:
        member_ids = list({*update["member_ids"]})
        if member_ids:
            conflict = await db.teams.find_one({"id": {"$ne": team_id}, "member_ids": {"$in": member_ids}})
            if conflict:
                raise HTTPException(400, f"Some members already belong to team '{conflict['name']}'")
        update["member_ids"] = member_ids
    if "manager_ids" in update:
        update["manager_ids"] = list({*update["manager_ids"]})
    update["updated_on"] = now_iso()
    await db.teams.update_one({"id": team_id}, {"$set": update})
    t = await db.teams.find_one({"id": team_id}, {"_id": 0})
    return t

@api_router.delete("/teams/{team_id}")
async def delete_team(team_id: str, user=Depends(require_role("Admin"))):
    await db.teams.delete_one({"id": team_id})
    return {"ok": True}

# ---------- Permissions (legacy simple matrix - kept for backward compat) ----------
@api_router.get("/permissions")
async def get_permissions(user=Depends(require_role("Admin"))):
    doc = await db.permissions.find_one({"id": "default"}, {"_id": 0})
    if not doc:
        return {"rules": []}
    return doc

@api_router.put("/permissions")
async def update_permissions(body: PermissionsIn, user=Depends(require_role("Admin"))):
    doc = {
        "id": "default",
        "rules": body.rules,
        "updated_on": now_iso(),
        "updated_by": user["id"],
    }
    await db.permissions.update_one({"id": "default"}, {"$set": doc}, upsert=True)
    return doc

# ---------- Permissions v2 (enterprise — unified 3-layer engine) ----------
# A permission rule has up to three optional filters: role, team_id, employee_id.
# At least ONE filter must be set. A rule matches a user iff ALL set filters match.
# Specificity weight: role=1, team=2, employee=4 (gives strict total order).
# Effective access: highest specificity tier with explicit value wins; within tier
# the most permissive value wins (all > respective > true > false).

class PermRuleIn(BaseModel):
    module: str
    feature: str
    role: Optional[str] = None
    team_id: Optional[str] = None
    employee_id: Optional[str] = None
    # Legacy fields — auto-converted to filter fields if present
    subject_type: Optional[Literal["role", "team", "employee"]] = None
    subject_id: Optional[str] = None
    actions: Dict[str, Any]  # values: bool | "respective" | "all"
    note: Optional[str] = ""

class PermRulesBulkIn(BaseModel):
    rules: List[PermRuleIn]


def _normalize_filters(r: PermRuleIn) -> Dict[str, Optional[str]]:
    """Convert legacy subject_type/subject_id into role/team_id/employee_id if needed."""
    role, team_id, employee_id = r.role, r.team_id, r.employee_id
    if r.subject_type and r.subject_id:
        if r.subject_type == "role" and not role:
            role = r.subject_id
        elif r.subject_type == "team" and not team_id:
            team_id = r.subject_id
        elif r.subject_type == "employee" and not employee_id:
            employee_id = r.subject_id
    return {"role": role, "team_id": team_id, "employee_id": employee_id}


def _rule_specificity(rule: dict) -> int:
    """Weighted specificity score. Higher = more specific."""
    s = 0
    if rule.get("role"): s += 1
    if rule.get("team_id"): s += 2
    if rule.get("employee_id"): s += 4
    return s


def _rule_matches_user(rule: dict, user_role: str, user_id: str, team_ids_of_user: set) -> bool:
    """A rule matches a user iff all set filters match the user."""
    if rule.get("role") and rule["role"] != user_role:
        return False
    if rule.get("team_id") and rule["team_id"] not in team_ids_of_user:
        return False
    if rule.get("employee_id") and rule["employee_id"] != user_id:
        return False
    # At least one filter must be set — defensive
    if not any(rule.get(k) for k in ("role", "team_id", "employee_id")):
        return False
    return True


@api_router.get("/permissions/schema")
async def permissions_schema(user=Depends(get_current_user)):
    return {"modules": PERMISSION_MODULES, "actions": ALL_ACTIONS, "scoped_actions": sorted(SCOPED_ACTIONS)}

def _serialize_rule(r: dict) -> dict:
    r.pop("_id", None)
    return r

@api_router.get("/permissions/v2")
async def list_permission_rules_v2(
    user=Depends(require_role("Admin")),
    module: Optional[str] = None,
    role: Optional[str] = None,
    team_id: Optional[str] = None,
    employee_id: Optional[str] = None,
):
    q = {}
    if module: q["module"] = module
    if role: q["role"] = role
    if team_id: q["team_id"] = team_id
    if employee_id: q["employee_id"] = employee_id
    rules = await db.permission_rules.find(q, {"_id": 0}).to_list(5000)
    return rules

@api_router.put("/permissions/v2/bulk")
async def bulk_replace_rules(body: PermRulesBulkIn, user=Depends(require_role("Admin"))):
    # Validate features against schema
    for r in body.rules:
        valid = feature_actions(r.module, r.feature)
        if not valid:
            raise HTTPException(400, f"Unknown feature {r.module}.{r.feature}")
        filters = _normalize_filters(r)
        if not any(filters.values()):
            raise HTTPException(400, f"Rule for {r.module}.{r.feature} has no Role / Team / Employee filter set")
        r.role, r.team_id, r.employee_id = filters["role"], filters["team_id"], filters["employee_id"]
        # Preserve scope strings for scoped actions; coerce others to bool
        normalized = {}
        for a in valid:
            v = r.actions.get(a, False)
            if a in SCOPED_ACTIONS and v in ("all", "respective"):
                normalized[a] = v
            else:
                normalized[a] = bool(v)
        r.actions = normalized

    existing_count = await db.permission_rules.count_documents({})
    await db.permission_rules.delete_many({})
    now = now_iso()
    payload = []
    for r in body.rules:
        payload.append({
            "id": str(uuid.uuid4()),
            "module": r.module,
            "feature": r.feature,
            "role": r.role,
            "team_id": r.team_id,
            "employee_id": r.employee_id,
            "actions": r.actions,
            "note": r.note or "",
            "created_on": now,
            "updated_on": now,
            "updated_by": user["id"],
        })
    if payload:
        await db.permission_rules.insert_many(payload)

    await log_audit(
        actor=user, action="permissions.bulk_save", resource="permissions",
        detail=f"Saved {len(payload)} rules (previously {existing_count}).",
        metadata={"count_before": existing_count, "count_after": len(payload)},
        severity="warning",
    )
    return {"count": len(payload)}

@api_router.delete("/permissions/v2/rule/{rule_id}")
async def delete_rule(rule_id: str, user=Depends(require_role("Admin"))):
    r = await db.permission_rules.find_one({"id": rule_id})
    if not r:
        raise HTTPException(404, "Not found")
    await db.permission_rules.delete_one({"id": rule_id})
    desc = f"role={r.get('role')} team={r.get('team_id')} emp={r.get('employee_id')}"
    await log_audit(
        actor=user, action="permissions.delete_rule", resource="permissions", resource_id=rule_id,
        detail=f"Deleted rule {r['module']}.{r['feature']} ({desc})",
        severity="warning",
    )
    return {"ok": True}

# ---------- Effective access ----------
def _merge_actions(base: Dict[str, Any], add: Dict[str, Any]) -> Dict[str, Any]:
    """Merge two action dicts preferring the higher-precedence value (all > respective > true > false)."""
    out = dict(base)
    for k, v in add.items():
        existing = out.get(k, False)
        out[k] = v if action_precedence(v) >= action_precedence(existing) else existing
    return out

async def _compute_effective(employee: dict) -> dict:
    """Return effective access for a given employee with explanations.

    For each (module, feature, action) we find all rules matching this employee,
    take the highest specificity tier that has the action explicitly set, and
    within that tier pick the most permissive value.
    """
    user_role = employee.get("role")
    user_id = employee["id"]
    # All teams the user belongs to (member or manager)
    user_teams = await db.teams.find(
        {"$or": [{"member_ids": user_id}, {"manager_ids": user_id}]},
        {"_id": 0, "id": 1, "name": 1}
    ).to_list(100)
    team_ids_of_user = {t["id"] for t in user_teams}
    primary_team = user_teams[0] if user_teams else None

    # Pull every rule and filter in-memory (rule count is bounded; permission_rules collection is small).
    all_rules = await db.permission_rules.find({}, {"_id": 0}).to_list(5000)
    matching = [r for r in all_rules if _rule_matches_user(r, user_role, user_id, team_ids_of_user)]

    effective: Dict[str, Dict[str, Dict[str, Any]]] = {}
    sources: Dict[str, Dict[str, List[dict]]] = {}

    # Group matching rules by (module, feature)
    grouped: Dict[tuple, List[dict]] = {}
    for r in matching:
        grouped.setdefault((r["module"], r["feature"]), []).append(r)

    for (module, feature), rules in grouped.items():
        # Sort by specificity desc so the most-specific rule's tier wins
        rules_sorted = sorted(rules, key=_rule_specificity, reverse=True)
        valid_actions = feature_actions(module, feature)
        eff_actions = {}
        for action in valid_actions:
            # Find the highest specificity tier among rules that have this action set.
            top_spec = None
            best_val = False
            for r in rules_sorted:
                if action not in r.get("actions", {}):
                    continue
                v = r["actions"][action]
                spec = _rule_specificity(r)
                if top_spec is None:
                    top_spec = spec
                if spec < top_spec:
                    break  # lower specificity — ignore
                # Same top tier — keep most permissive
                if action_precedence(v) > action_precedence(best_val):
                    best_val = v
            if top_spec is not None:
                eff_actions[action] = best_val
        if eff_actions:
            effective.setdefault(module, {})[feature] = eff_actions
        # Sources list (for explainability in the UI)
        sources.setdefault(module, {})[feature] = [
            {
                "level": ("employee" if r.get("employee_id") else "team" if r.get("team_id") else "role"),
                "actions": r["actions"],
                "role": r.get("role"),
                "team_id": r.get("team_id"),
                "employee_id": r.get("employee_id"),
                "specificity": _rule_specificity(r),
                "note": r.get("note", ""),
            }
            for r in rules_sorted
        ]

    return {
        "employee": {
            "id": user_id, "name": employee["name"], "email": employee["email"],
            "role": user_role,
            "team_id": primary_team["id"] if primary_team else None,
            "team_name": primary_team["name"] if primary_team else None,
            "team_ids": list(team_ids_of_user),
        },
        "effective": effective,
        "sources": sources,
        "counts": {
            "matching_rules": len(matching),
            "total_rules": len(all_rules),
        },
    }

@api_router.get("/permissions/effective/{employee_id}")
async def effective_for_employee(employee_id: str, user=Depends(get_current_user)):
    # Admin can view anyone, employees can view themselves
    if user["role"] not in ("Admin", "Manager") and user["id"] != employee_id:
        raise HTTPException(403, "Not authorized")
    emp = await db.contacts.find_one({"id": employee_id}, {"_id": 0, "password_hash": 0, "password_encrypted": 0})
    if not emp:
        raise HTTPException(404, "Employee not found")
    return await _compute_effective(emp)

@api_router.get("/permissions/me/effective")
async def effective_for_me(user=Depends(get_current_user)):
    return await _compute_effective(user)

# ---------- Permission Presets ----------
class PresetApplyIn(BaseModel):
    # Same three optional filters as a rule; preset replaces all rules matching these filters within preset module.
    role: Optional[str] = None
    team_id: Optional[str] = None
    employee_id: Optional[str] = None

@api_router.get("/permissions/presets")
async def list_presets(user=Depends(require_role("Admin"))):
    items = await db.permission_presets.find({}, {"_id": 0}).to_list(500)
    return items

class PresetCreateIn(BaseModel):
    name: str
    description: Optional[str] = ""
    module: str
    rules: List[Dict[str, Any]]

@api_router.post("/permissions/presets")
async def create_preset(body: PresetCreateIn, user=Depends(require_role("Admin"))):
    doc = {
        "id": str(uuid.uuid4()),
        "name": body.name,
        "description": body.description or "",
        "module": body.module,
        "rules": body.rules,
        "system": False,
        "created_on": now_iso(),
        "created_by": user["id"],
    }
    await db.permission_presets.insert_one(doc)
    await log_audit(
        actor=user, action="permissions.preset_create", resource="permission_preset",
        resource_id=doc["id"], detail=f"Created preset '{body.name}'", severity="info",
    )
    doc.pop("_id", None)
    return doc

@api_router.post("/permissions/presets/{preset_id}/apply")
async def apply_preset(preset_id: str, body: PresetApplyIn, user=Depends(require_role("Admin"))):
    preset = await db.permission_presets.find_one({"id": preset_id}, {"_id": 0})
    if not preset:
        raise HTTPException(404, "Preset not found")
    if not any([body.role, body.team_id, body.employee_id]):
        raise HTTPException(400, "Pick a role, team or employee filter to apply the preset to")
    # Replace any rules that have the EXACT same filter set within preset module
    filter_q = {
        "module": preset["module"],
        "role": body.role,
        "team_id": body.team_id,
        "employee_id": body.employee_id,
    }
    await db.permission_rules.delete_many(filter_q)
    payload = []
    now = now_iso()
    for r in preset["rules"]:
        valid = feature_actions(preset["module"], r["feature"])
        if not valid:
            continue
        # Preserve scope strings if provided
        actions = {}
        for a in valid:
            v = r.get("actions", {}).get(a, False)
            if a in SCOPED_ACTIONS and v in ("all", "respective"):
                actions[a] = v
            else:
                actions[a] = bool(v)
        payload.append({
            "id": str(uuid.uuid4()),
            "module": preset["module"],
            "feature": r["feature"],
            "role": body.role,
            "team_id": body.team_id,
            "employee_id": body.employee_id,
            "actions": actions,
            "note": f"Applied from preset '{preset['name']}'",
            "created_on": now,
            "updated_on": now,
            "updated_by": user["id"],
        })
    if payload:
        await db.permission_rules.insert_many(payload)
    target_desc = " + ".join(f"{k}={v}" for k, v in [("role", body.role), ("team", body.team_id), ("emp", body.employee_id)] if v)
    await log_audit(
        actor=user, action="permissions.preset_apply", resource="permission_preset", resource_id=preset_id,
        detail=f"Applied preset '{preset['name']}' to {target_desc} ({len(payload)} rules)",
        severity="info",
    )
    return {"count": len(payload)}

# ---------- Permission Stats ----------
@api_router.get("/permissions/stats")
async def permissions_stats(user=Depends(require_role("Admin"))):
    roles_distinct = await db.contacts.distinct("role")
    total_rules = await db.permission_rules.count_documents({})
    # Compound rules = more than one filter set
    compound_rules = 0
    employees_with_overrides = set()
    restricted = 0
    async for r in db.permission_rules.find({}, {"actions": 1, "role": 1, "team_id": 1, "employee_id": 1}):
        filters_set = sum(1 for k in ("role", "team_id", "employee_id") if r.get(k))
        if filters_set > 1:
            compound_rules += 1
        if r.get("employee_id"):
            employees_with_overrides.add(r["employee_id"])
        for v in (r.get("actions") or {}).values():
            if v is False:
                restricted += 1
    return {
        "total_roles": len(roles_distinct),
        "total_rules": total_rules,
        "employees_with_overrides": len(employees_with_overrides),
        "restricted_actions": restricted,
        "compound_rules": compound_rules,
    }

# ---------- Audit Log (org-wide) ----------
@api_router.get("/audit-log")
async def list_audit(
    user=Depends(require_role("Admin")),
    q: Optional[str] = None,
    resource: Optional[str] = None,
    action: Optional[str] = None,
    severity: Optional[str] = None,
    actor_id: Optional[str] = None,
    limit: int = 200,
):
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

# ---------- Tickets Routes ----------
def parse_filters(status, priority, created_by, assigned_to, q, created_on, updated_on, due_date, date_from=None, date_to=None, date_field="created_at"):
    query = {}
    if status:
        query["status"] = status
    if priority:
        query["priority"] = priority
    if created_by:
        query["created_by_id"] = created_by
    if assigned_to is not None:
        if assigned_to == "unassigned":
            query["assigned_to_id"] = {"$in": [None, ""]}
        else:
            query["assigned_to_id"] = assigned_to
    if q:
        query["$or"] = [
            {"ticket_id": {"$regex": q, "$options": "i"}},
            {"subject": {"$regex": q, "$options": "i"}},
            {"assigned_to_name": {"$regex": q, "$options": "i"}},
            {"created_by_name": {"$regex": q, "$options": "i"}},
        ]
    if created_on:
        query["created_on"] = {"$regex": f"^{created_on}"}
    if updated_on:
        query["updated_on"] = {"$regex": f"^{updated_on}"}
    if due_date:
        query["due_date"] = due_date
    if date_from or date_to:
        query.update(_date_match(date_from, date_to, date_field))
    return query

@api_router.get("/tickets")
async def list_tickets(
    user=Depends(get_current_user),
    scope: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    created_by: Optional[str] = None,
    assigned_to: Optional[str] = None,
    q: Optional[str] = None,
    created_on: Optional[str] = None,
    updated_on: Optional[str] = None,
    due_date: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    date_field: Optional[str] = "created_at",
    page: Optional[int] = None,
    page_size: int = 25,
    sort_by: str = "updated_on",
    sort_dir: str = "desc",
):
    query = parse_filters(status, priority, created_by, assigned_to, q, created_on, updated_on, due_date, date_from, date_to, date_field)

    role = user["role"]
    uid = user["id"]
    if scope == "mine":
        if role == "Research":
            query["created_by_id"] = uid
        elif role == "DQ Team":
            query["assigned_to_id"] = uid
    elif scope == "created":
        query["created_by_id"] = uid
    elif scope == "assigned":
        query["assigned_to_id"] = uid
    elif scope == "unassigned":
        query["assigned_to_id"] = {"$in": [None, ""]}
        query["status"] = "Open"
    elif scope == "open":
        query["status"] = "Open"
    # role-based default restriction
    if role == "Research" and scope not in ("created", "mine"):
        query["created_by_id"] = uid

    if page is not None:
        page = max(1, page)
        page_size = max(1, min(page_size, 200))
        sort_field = sort_by if sort_by in ("ticket_id", "subject", "status", "priority", "created_on", "updated_on", "due_date", "number_of_profiles") else "updated_on"
        sort_order = -1 if sort_dir == "desc" else 1
        total = await db.tickets.count_documents(query)
        items = await db.tickets.find(query, {"_id": 0}).sort(sort_field, sort_order).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
        return {"items": items, "total": total, "page": page, "page_size": page_size}
    items = await db.tickets.find(query, {"_id": 0}).sort("updated_on", -1).to_list(2000)
    return items

@api_router.get("/tickets/export.csv")
async def export_tickets_csv(
    user=Depends(get_current_user),
    scope: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    created_by: Optional[str] = None,
    assigned_to: Optional[str] = None,
    q: Optional[str] = None,
    created_on: Optional[str] = None,
    updated_on: Optional[str] = None,
    due_date: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    date_field: Optional[str] = "created_at",
):
    query = parse_filters(status, priority, created_by, assigned_to, q, created_on, updated_on, due_date, date_from, date_to, date_field)
    role = user["role"]; uid = user["id"]
    if scope == "mine":
        if role == "Research":
            query["created_by_id"] = uid
        elif role == "DQ Team":
            query["assigned_to_id"] = uid
    elif scope == "created":
        query["created_by_id"] = uid
    elif scope == "assigned":
        query["assigned_to_id"] = uid
    elif scope == "unassigned":
        query["assigned_to_id"] = {"$in": [None, ""]}
        query["status"] = "Open"
    if role == "Research" and scope not in ("created", "mine"):
        query["created_by_id"] = uid
    items = await db.tickets.find(query, {"_id": 0}).sort("updated_on", -1).to_list(20000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Ticket ID", "Subject", "Status", "Priority", "Created By", "Assigned To", "Profiles", "Due Date", "Created On", "Updated On"])
    for t in items:
        w.writerow([
            t.get("ticket_id", ""), t.get("subject", ""), t.get("status", ""), t.get("priority", ""),
            t.get("created_by_name", ""), t.get("assigned_to_name") or "Unassigned",
            t.get("number_of_profiles", "") or 0,
            t.get("due_date") or "", t.get("created_on", ""), t.get("updated_on", ""),
        ])
    filename = f"tickets_{datetime.now(timezone.utc).date().isoformat()}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

@api_router.post("/tickets")
async def create_ticket(body: TicketCreate, user=Depends(get_current_user)):
    if user["role"] not in ("Research", "Admin", "Manager"):
        raise HTTPException(403, "Only RA/Admin/Manager can create tickets")
    if body.number_of_profiles is None:
        raise HTTPException(400, "No. of Records is Blank")
    if body.number_of_profiles == 0:
        raise HTTPException(400, "No. of Records cannot be 0")
    if body.number_of_profiles < 0:
        raise HTTPException(400, "No. of Records must be greater than 0")
    count = await db.tickets.count_documents({})
    doc = {
        "id": str(uuid.uuid4()),
        "ticket_id": f"TKT-{1000 + count + 1}",
        "subject": body.subject,
        "description": body.description or "",
        "priority": body.priority,
        "due_date": body.due_date,
        "number_of_profiles": body.number_of_profiles,
        "attachment_path": body.attachment_path,
        "attachment_name": body.attachment_name,
        "attachments": body.attachments or ([{"path": body.attachment_path, "filename": body.attachment_name}] if body.attachment_path else []),
        "status": "Open",
        "created_by_id": user["id"],
        "created_by_name": user["name"],
        "assigned_to_id": None,
        "assigned_to_name": None,
        "created_on": now_iso(),
        "updated_on": now_iso(),
    }
    await db.tickets.insert_one(doc)
    doc.pop("_id", None)
    await db.activity.insert_one({
        "id": str(uuid.uuid4()), "ticket_id": doc["id"], "action": "created",
        "by_id": user["id"], "by_name": user["name"], "at": now_iso(),
        "detail": f"Ticket created by {user['name']}"
    })
    return doc

@api_router.get("/tickets/{ticket_id}")
async def get_ticket(ticket_id: str, user=Depends(get_current_user)):
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Not found")
    if user["role"] == "DQ Team" and t.get("assigned_to_id") == user["id"] and t.get("status") == "Open":
        await db.tickets.update_one(
            {"id": ticket_id},
            {"$set": {"status": "In Progress", "updated_on": now_iso()}}
        )
        await db.activity.insert_one({
            "id": str(uuid.uuid4()), "ticket_id": ticket_id, "action": "updated",
            "by_id": user["id"], "by_name": user["name"], "at": now_iso(),
            "detail": "Status changed from Open to In Progress"
        })
        t["status"] = "In Progress"
        t["updated_on"] = now_iso()
    return t

@api_router.patch("/tickets/{ticket_id}")
async def update_ticket(ticket_id: str, body: TicketUpdate, user=Depends(get_current_user)):
    t = await db.tickets.find_one({"id": ticket_id})
    if not t:
        raise HTTPException(404, "Not found")
    role = user["role"]
    update = {}
    activity = []

    if body.status is not None:
        if role in ("Admin", "Manager"):
            pass
        elif role == "DQ Team":
            if t.get("assigned_to_id") != user["id"]:
                raise HTTPException(403, "Can only update status of tickets assigned to you")
        else:
            raise HTTPException(403, "Cannot update status")
        if body.status != t.get("status"):
            update["status"] = body.status
            activity.append(f"Status changed from {t.get('status')} to {body.status}")

    if body.assigned_to is not None:
        if role in ("Admin", "Manager"):
            if body.assigned_to == "":
                update["assigned_to_id"] = None
                update["assigned_to_name"] = None
                activity.append("Unassigned")
            else:
                assignee = await db.contacts.find_one({"id": body.assigned_to})
                if not assignee:
                    raise HTTPException(400, "Assignee not found")
                update["assigned_to_id"] = assignee["id"]
                update["assigned_to_name"] = assignee["name"]
                activity.append(f"Assigned to {assignee['name']}")
        elif role == "DQ Team":
            if body.assigned_to != user["id"]:
                raise HTTPException(403, "DQ can only assign to themselves")
            if t.get("assigned_to_id"):
                raise HTTPException(403, "Already assigned")
            update["assigned_to_id"] = user["id"]
            update["assigned_to_name"] = user["name"]
            activity.append(f"Self-assigned to {user['name']}")
        else:
            raise HTTPException(403, "Cannot assign")

    if not update:
        raise HTTPException(400, "Nothing to update")
    update["updated_on"] = now_iso()
    await db.tickets.update_one({"id": ticket_id}, {"$set": update})
    for a in activity:
        await db.activity.insert_one({
            "id": str(uuid.uuid4()), "ticket_id": ticket_id, "action": "updated",
            "by_id": user["id"], "by_name": user["name"], "at": now_iso(), "detail": a
        })
    return await db.tickets.find_one({"id": ticket_id}, {"_id": 0})

@api_router.post("/tickets/bulk-assign")
async def bulk_assign(body: BulkAssign, user=Depends(get_current_user)):
    role = user["role"]
    if role not in ("Admin", "Manager", "DQ Team"):
        raise HTTPException(403, "Forbidden")
    if role == "DQ Team":
        assignee_id = user["id"]
        assignee_name = user["name"]
    else:
        if not body.assigned_to:
            raise HTTPException(400, "assigned_to required")
        a = await db.contacts.find_one({"id": body.assigned_to})
        if not a:
            raise HTTPException(400, "Assignee not found")
        assignee_id = a["id"]; assignee_name = a["name"]

    success = 0
    for tid in body.ticket_ids:
        t = await db.tickets.find_one({"id": tid})
        if not t:
            continue
        if role == "DQ Team" and t.get("assigned_to_id"):
            continue
        await db.tickets.update_one({"id": tid}, {"$set": {
            "assigned_to_id": assignee_id, "assigned_to_name": assignee_name, "updated_on": now_iso()
        }})
        await db.activity.insert_one({
            "id": str(uuid.uuid4()), "ticket_id": tid, "action": "assigned",
            "by_id": user["id"], "by_name": user["name"], "at": now_iso(),
            "detail": f"Assigned to {assignee_name}"
        })
        success += 1
    return {"assigned": success}

@api_router.post("/tickets/bulk-status")
async def bulk_status(body: BulkStatus, user=Depends(get_current_user)):
    role = user["role"]
    if role not in ("Admin", "Manager", "DQ Team"):
        raise HTTPException(403, "Forbidden")
    success = 0
    for tid in body.ticket_ids:
        t = await db.tickets.find_one({"id": tid})
        if not t:
            continue
        if role == "DQ Team" and t.get("assigned_to_id") != user["id"]:
            continue
        if t.get("status") == body.status:
            continue
        await db.tickets.update_one({"id": tid}, {"$set": {"status": body.status, "updated_on": now_iso()}})
        await db.activity.insert_one({
            "id": str(uuid.uuid4()), "ticket_id": tid, "action": "updated",
            "by_id": user["id"], "by_name": user["name"], "at": now_iso(),
            "detail": f"Status changed from {t.get('status')} to {body.status}"
        })
        success += 1
    return {"updated": success}

# ---------- Comments & Activity ----------
@api_router.get("/tickets/{ticket_id}/activity")
async def get_activity(ticket_id: str, user=Depends(get_current_user)):
    items = await db.activity.find({"ticket_id": ticket_id}, {"_id": 0}).sort("at", -1).to_list(500)
    return items

@api_router.get("/tickets/{ticket_id}/comments")
async def get_comments(ticket_id: str, user=Depends(get_current_user)):
    items = await db.comments.find({"ticket_id": ticket_id}, {"_id": 0}).sort("at", 1).to_list(500)
    return items

@api_router.post("/tickets/{ticket_id}/comments")
async def add_comment(ticket_id: str, body: CommentCreate, user=Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()), "ticket_id": ticket_id,
        "by_id": user["id"], "by_name": user["name"],
        "content": body.content, "at": now_iso()
    }
    await db.comments.insert_one(doc)
    doc.pop("_id", None)
    await db.activity.insert_one({
        "id": str(uuid.uuid4()), "ticket_id": ticket_id, "action": "comment",
        "by_id": user["id"], "by_name": user["name"], "at": now_iso(),
        "detail": "Added a comment"
    })
    return doc

# ---------- Upload / File ----------
@api_router.post("/upload")
async def upload(file: UploadFile = File(...), user=Depends(get_current_user)):
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 10MB)")
    ext = (file.filename or "bin").rsplit(".", 1)[-1] if "." in (file.filename or "") else "bin"
    path = f"{APP_NAME}/uploads/{user['id']}/{uuid.uuid4()}.{ext}"
    result = put_object(path, data, file.content_type or "application/octet-stream")
    await db.files.insert_one({
        "id": str(uuid.uuid4()),
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": file.content_type,
        "size": result.get("size", len(data)),
        "uploaded_by": user["id"],
        "is_deleted": False,
        "created_at": now_iso(),
    })
    return {"path": result["path"], "filename": file.filename, "size": result.get("size", len(data))}

@api_router.get("/files/{path:path}")
async def download(path: str, request: Request, auth: Optional[str] = Query(None)):
    token = request.cookies.get("access_token") or auth
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        raise HTTPException(401, "Invalid token")
    record = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not record:
        raise HTTPException(404, "Not found")
    data, ct = get_object(path)
    return FastResponse(content=data, media_type=record.get("content_type") or ct)

# ---------- Dashboard ----------
def _date_match(date_from, date_to, field="created_at"):
    if not date_from and not date_to:
        return {}
    db_field = "updated_on" if field == "updated_at" else "created_on"
    cond = {}
    if date_from:
        cond["$gte"] = f"{date_from}T00:00:00"
    if date_to:
        try:
            d = datetime.fromisoformat(date_to).date()
            next_day = (datetime(d.year, d.month, d.day) + timedelta(days=1)).date().isoformat()
            cond["$lt"] = f"{next_day}T00:00:00"
        except Exception:
            cond["$lte"] = f"{date_to}T23:59:59"
    return {db_field: cond}

@api_router.get("/dashboard/stats")
async def dashboard_stats(
    user=Depends(get_current_user),
    member_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    date_field: Optional[str] = "created_at",
):
    role = user["role"]
    base = {}
    if role == "Research":
        base["created_by_id"] = user["id"]
    elif role == "DQ Team":
        base["assigned_to_id"] = user["id"]
    elif role in ("Admin", "Manager") and member_id:
        base["assigned_to_id"] = member_id

    base = {**base, **_date_match(date_from, date_to, date_field)}

    async def cnt(extra):
        q = {**base, **extra}
        return await db.tickets.count_documents(q)

    total = await cnt({})
    open_c = await cnt({"status": "Open"})
    inprog = await cnt({"status": "In Progress"})
    closed = await cnt({"status": "Closed"})
    return {"total": total, "open": open_c, "in_progress": inprog, "closed": closed}

@api_router.get("/dashboard/dq-performance")
async def dq_performance(
    user=Depends(require_role("Admin", "Manager")),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    date_field: Optional[str] = "created_at",
):
    members = await db.contacts.find({"role": "DQ Team", "status": "Active"}, {"_id": 0, "password_hash": 0, "password_encrypted": 0}).to_list(500)
    date_match = _date_match(date_from, date_to, date_field)
    out = []
    for m in members:
        base = {"assigned_to_id": m["id"], **date_match}
        agg_open = await db.tickets.aggregate([
            {"$match": {**base, "status": "Open"}},
            {"$group": {"_id": None, "total": {"$sum": "$number_of_profiles"}}}
        ]).to_list(1)
        agg_ip = await db.tickets.aggregate([
            {"$match": {**base, "status": "In Progress"}},
            {"$group": {"_id": None, "total": {"$sum": "$number_of_profiles"}}}
        ]).to_list(1)
        open_profiles = agg_open[0]["total"] if agg_open else 0
        in_progress_profiles = agg_ip[0]["total"] if agg_ip else 0
        out.append({
            "id": m["id"], "name": m["name"], "email": m["email"],
            "total": await db.tickets.count_documents(base),
            "open": await db.tickets.count_documents({**base, "status": "Open"}),
            "in_progress": await db.tickets.count_documents({**base, "status": "In Progress"}),
            "closed": await db.tickets.count_documents({**base, "status": "Closed"}),
            "open_profiles": open_profiles,
            "in_progress_profiles": in_progress_profiles,
            "profiles_assigned": open_profiles + in_progress_profiles,
        })
    return out

@api_router.get("/dashboard/recent")
async def dashboard_recent(
    user=Depends(get_current_user),
    kind: str = "updated",
    limit: int = 8,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    date_field: Optional[str] = "created_at",
):
    role = user["role"]
    base = {}
    if role == "Research":
        base["created_by_id"] = user["id"]
    elif role == "DQ Team":
        base["$or"] = [
            {"assigned_to_id": user["id"]},
            {"$and": [{"assigned_to_id": {"$in": [None, ""]}}, {"status": "Open"}]},
        ]
    base = {**base, **_date_match(date_from, date_to, date_field)}
    sort_field = "created_on" if kind == "new" else "updated_on"
    items = await db.tickets.find(base, {"_id": 0}).sort(sort_field, -1).to_list(limit)
    return items

@api_router.get("/")
async def root():
    return {"message": "Ticketing System API"}

# Include router
app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ---------- Startup: seed + indexes ----------
@app.on_event("startup")
async def startup():
    await db.contacts.create_index("email", unique=True)
    await db.tickets.create_index("ticket_id", unique=True)
    await db.audit_log.create_index([("at", -1)])
    await db.permission_rules.create_index([("module", 1), ("feature", 1), ("role", 1), ("team_id", 1), ("employee_id", 1)])
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.password_reset_tokens.create_index("token_hash")
    await db.notifications_outbox.create_index([("created_at", -1)])
    await db.email_templates.create_index("kind")
    init_storage()

    # Seed default email templates (idempotent — by `kind`)
    for t in DEFAULT_TEMPLATES:
        existing = await db.email_templates.find_one({"kind": t["kind"]})
        if not existing:
            await db.email_templates.insert_one({
                **t, "id": str(uuid.uuid4()), "status": "Active", "system": True,
                "created_at": now_iso(), "updated_at": now_iso(),
            })

    # Seed default permission presets (idempotent)
    for p in DEFAULT_PRESETS:
        existing = await db.permission_presets.find_one({"id": p["id"]})
        if not existing:
            await db.permission_presets.insert_one({**p, "created_on": now_iso()})
        else:
            # refresh system presets in case definitions changed
            if existing.get("system"):
                await db.permission_presets.update_one(
                    {"id": p["id"]},
                    {"$set": {"name": p["name"], "description": p["description"], "module": p["module"], "rules": p["rules"], "system": True}},
                )

    # ---- Migration: rename `type` -> `role` for contacts ----
    legacy = await db.contacts.find({"type": {"$exists": True}}, {"_id": 1, "type": 1, "role": 1}).to_list(5000)
    migrated = 0
    for doc in legacy:
        upd = {}
        # only set role if missing
        if not doc.get("role"):
            upd["$set"] = {"role": doc["type"]}
        upd_combined = upd.copy()
        upd_combined["$unset"] = {"type": ""}
        await db.contacts.update_one({"_id": doc["_id"]}, upd_combined)
        migrated += 1
    if migrated:
        logger.info(f"Migrated {migrated} contacts from type -> role")

    # ---- Migration: rename role 'Research Associate' -> 'Research' (one-way) ----
    res = await db.contacts.update_many({"role": "Research Associate"}, {"$set": {"role": "Research"}})
    if res.modified_count:
        logger.info(f"Migrated {res.modified_count} contacts: 'Research Associate' -> 'Research'")

    # ---- Migration: permission rules subject_type/subject_id -> role/team_id/employee_id ----
    legacy_perm = await db.permission_rules.find({"subject_type": {"$exists": True}}).to_list(10000)
    perm_migrated = 0
    for r in legacy_perm:
        upd = {"$unset": {"subject_type": "", "subject_id": ""}, "$set": {}}
        st = r.get("subject_type")
        sid = r.get("subject_id")
        if st == "role" and sid and not r.get("role"):
            upd["$set"]["role"] = sid
        elif st == "team" and sid and not r.get("team_id"):
            upd["$set"]["team_id"] = sid
        elif st == "employee" and sid and not r.get("employee_id"):
            upd["$set"]["employee_id"] = sid
        if not upd["$set"]:
            upd.pop("$set")
        await db.permission_rules.update_one({"_id": r["_id"]}, upd)
        perm_migrated += 1
    if perm_migrated:
        logger.info(f"Migrated {perm_migrated} permission_rules: subject_type/id -> role/team_id/employee_id")

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@ticketing.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "Admin@123")

    existing = await db.contacts.find_one({"email": admin_email})
    if not existing:
        await db.contacts.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email, "name": "Admin User", "phone": "",
            "role": "Admin", "status": "Active",
            "emp_id": "EMP-0001", "doj": "2024-01-01",
            "created_on": now_iso(), "last_login": None,
            "password_hash": hash_password(admin_password),
            "password_encrypted": encrypt_password(admin_password),
        })
        logger.info(f"Seeded admin: {admin_email}")
    else:
        if not verify_password(admin_password, existing.get("password_hash", "")):
            await db.contacts.update_one({"email": admin_email}, {"$set": {
                "password_hash": hash_password(admin_password),
                "password_encrypted": encrypt_password(admin_password),
            }})
        # Backfill encrypted password if missing
        if not existing.get("password_encrypted"):
            await db.contacts.update_one({"email": admin_email}, {"$set": {
                "password_encrypted": encrypt_password(admin_password)
            }})

    # Test users
    test_users = [
        {"email": "manager@ticketing.com", "name": "Maya Khanna", "role": "Manager", "password": "Test@123", "emp_id": "EMP-0010", "doj": "2024-02-01"},
        {"email": "ra@ticketing.com", "name": "Riya Sharma", "role": "Research", "password": "Test@123", "emp_id": "EMP-0020", "doj": "2024-03-01"},
        {"email": "dq1@ticketing.com", "name": "Dev Kapoor", "role": "DQ Team", "password": "Test@123", "emp_id": "EMP-0030", "doj": "2024-04-01"},
        {"email": "dq2@ticketing.com", "name": "Sara Mehta", "role": "DQ Team", "password": "Test@123", "emp_id": "EMP-0031", "doj": "2024-04-15"},
    ]
    for u in test_users:
        if not await db.contacts.find_one({"email": u["email"]}):
            await db.contacts.insert_one({
                "id": str(uuid.uuid4()),
                "email": u["email"], "name": u["name"], "phone": "",
                "role": u["role"], "status": "Active",
                "emp_id": u.get("emp_id", ""), "doj": u.get("doj"),
                "created_on": now_iso(), "last_login": None,
                "password_hash": hash_password(u["password"]),
                "password_encrypted": encrypt_password(u["password"]),
            })
        else:
            # Backfill encrypted password if missing
            existing_u = await db.contacts.find_one({"email": u["email"]})
            if not existing_u.get("password_encrypted"):
                await db.contacts.update_one({"email": u["email"]}, {"$set": {
                    "password_encrypted": encrypt_password(u["password"])
                }})

@app.on_event("shutdown")
async def shutdown():
    client.close()
