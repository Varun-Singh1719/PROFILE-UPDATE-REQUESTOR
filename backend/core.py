"""Shared application infrastructure (config, db, app, models, helpers).

All router modules import from here. server.py only handles startup, shutdown
and router registration.
"""
from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import secrets
import string
import hashlib
import bcrypt
import jwt
import requests
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal, Dict, Any
from cryptography.fernet import Fernet
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr

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

logger = logging.getLogger("ticketing")

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

# ---------- Crypto / Password helpers ----------
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

def hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

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
# Actions where scope (Respective / Team / All) applies. In v3 these are scoped
# only on the ProfiX module. Desk Booking actions stay pure boolean for now.
SCOPED_ACTIONS = {"view", "edit", "assign", "approve"}
SCOPED_MODULES = {"profix"}
SCOPE_VALUES = ("respective", "team", "all")

def is_scoped(module_key: str, action: str) -> bool:
    """Whether (module, action) is currently scope-aware (string scope value)
    or remains pure boolean."""
    return module_key in SCOPED_MODULES and action in SCOPED_ACTIONS

def scope_precedence(v) -> int:
    """Higher = broader access. Used when merging scopes across Permission Sets.

    `True` is treated as legacy 'all' (so pre-scope sets keep working).
    """
    if v is True or v == "all":
        return 3
    if v == "team":
        return 2
    if v == "respective":
        return 1
    return 0  # False / None / unknown

def scope_or_merge(existing, incoming):
    """OR-merge two scope values picking the broader. Returns the broader of the two."""
    return incoming if scope_precedence(incoming) > scope_precedence(existing) else existing

def normalize_action_value(v) -> Any:
    if v in SCOPE_VALUES:
        return v
    return bool(v)

def action_precedence(v) -> int:
    # Backward-compat name still used by legacy permissions.v2 code paths.
    return scope_precedence(v)

def feature_actions(module_key: str, feature_key: str) -> List[str]:
    for m in PERMISSION_MODULES:
        if m["key"] != module_key:
            continue
        for g in m["groups"]:
            for f in g["features"]:
                if f["key"] == feature_key:
                    return f["actions"]
    return []

# ---------- Default Permission Presets (legacy) ----------
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

# ---------- Email Templates seeds ----------
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
    {
        # ProfiX notification — fired when a ticket's status transitions to "Closed".
        # Sent to the request creator. Variables resolved at send-time:
        #   {{name}}, {{ticket_id}}, {{subject}}, {{closed_by}}, {{closed_at}}
        "kind": "request_closed",
        "name": "Request closed",
        "category": "notification",
        "subject": "Request Closed",
        "body": (
            "<p>Hi {{name}},</p>"
            "<p>Your request <strong>{{ticket_id}}</strong> — \"{{subject}}\" has been "
            "<strong>closed</strong>.</p>"
            "<ul>"
            "<li><b>Ticket ID:</b> {{ticket_id}}</li>"
            "<li><b>Subject:</b> {{subject}}</li>"
            "<li><b>Closed by:</b> {{closed_by}}</li>"
            "<li><b>Closed on:</b> {{closed_at}}</li>"
            "</ul>"
            "<p>If you believe this was closed in error, please reach out to the team.</p>"
            "<p>— Infollion ProfiX</p>"
        ),
    },
    {
        # Sent when a workstation **request** is submitted (status = Pending Approval).
        # Goes to the approver(s). Variables: {{name}} (approver), {{requested_by}},
        # {{requested_on}}, {{requested_for_date}}, {{plan_name}}, {{seat_labels}}.
        "kind": "workstation_requested",
        "name": "Workstation requested — pending approval",
        "category": "notification",
        "subject": "Workstation request pending approval",
        "body": (
            "<p>Hi {{name}},</p>"
            "<p>A workstation request is waiting for your approval.</p>"
            "<ul>"
            "<li><b>Requested by:</b> {{requested_by}}</li>"
            "<li><b>Requested on:</b> {{requested_on}}</li>"
            "<li><b>For date:</b> {{requested_for_date}}</li>"
            "<li><b>Floor plan:</b> {{plan_name}}</li>"
            "<li><b>Workstation(s):</b> {{seat_labels}}</li>"
            "</ul>"
            "<p>Open <a href=\"{{approvals_url}}\">Pending Approvals</a> to approve or decline.</p>"
            "<p>— Infollion Workspace Manager</p>"
        ),
    },
    {
        # Sent to the requester when their workstation request is approved.
        "kind": "workstation_request_approved",
        "name": "Workstation request approved",
        "category": "notification",
        "subject": "Your workstation request is approved",
        "body": (
            "<p>Hi {{name}},</p>"
            "<p>Your workstation request has been <strong>approved</strong> and a booking has been created.</p>"
            "<ul>"
            "<li><b>Floor plan:</b> {{plan_name}}</li>"
            "<li><b>Workstation(s):</b> {{seat_labels}}</li>"
            "<li><b>Date:</b> {{requested_for_date}}</li>"
            "<li><b>Approved by:</b> {{approved_by}}</li>"
            "</ul>"
            "<p>— Infollion Workspace Manager</p>"
        ),
    },
    {
        # Sent to the requester when their workstation request is declined.
        "kind": "workstation_request_declined",
        "name": "Workstation request declined",
        "category": "notification",
        "subject": "Your workstation request was declined",
        "body": (
            "<p>Hi {{name}},</p>"
            "<p>Unfortunately your workstation request has been <strong>declined</strong>.</p>"
            "<ul>"
            "<li><b>Floor plan:</b> {{plan_name}}</li>"
            "<li><b>Workstation(s):</b> {{seat_labels}}</li>"
            "<li><b>Date:</b> {{requested_for_date}}</li>"
            "<li><b>Declined by:</b> {{declined_by}}</li>"
            "</ul>"
            "<p>You can submit a new request for a different workstation or date.</p>"
            "<p>— Infollion Workspace Manager</p>"
        ),
    },
]

# ---------- Team color palette ----------
TEAM_COLOR_PALETTE = [
    "#ec9324", "#22c55e", "#3b82f6", "#a855f7", "#ef4444",
    "#06b6d4", "#eab308", "#f97316", "#14b8a6", "#64748b",
    "#10b981", "#8b5cf6", "#f43f5e", "#0ea5e9", "#84cc16",
    "#d946ef", "#f59e0b", "#0891b2", "#6366f1", "#dc2626",
    "#16a34a", "#7c3aed", "#0284c7", "#ca8a04", "#be123c",
    "#059669", "#9333ea", "#0369a1", "#a16207", "#9f1239",
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
# Canonical roles after the v3 role collapse: only "Super Admin" and "Admin" remain.
# Legacy roles (Manager, Research, Delivery, Member, DQ Team, Research Associate) are
# migrated to "Admin" on startup. The previous "Admin" role becomes "Super Admin".
ContactRole = Literal["Super Admin", "Admin"]
ContactStatus = Literal["Active", "Inactive"]
TicketStatus = Literal["Open", "In Progress", "Closed"]
TicketPriority = Literal["High", "Medium", "Low"]

# Legacy role aliases — used for input normalization and startup migration.
LEGACY_ROLE_MAP = {
    "Admin": "Super Admin",
    "Manager": "Admin",
    "Research": "Admin",
    "Research Associate": "Admin",
    "Delivery": "Admin",
    "Member": "Admin",
    "DQ Team": "Admin",
}

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
    permission_set_ids: Optional[List[str]] = None

class ContactUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[ContactRole] = None
    status: Optional[ContactStatus] = None
    emp_id: Optional[str] = None
    doj: Optional[str] = None
    permission_set_ids: Optional[List[str]] = None

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

# Permission Set models (v3) — named, reusable templates.
class PermissionSetCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    modules: Dict[str, Dict[str, Dict[str, Any]]] = {}

class PermissionSetUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    modules: Optional[Dict[str, Dict[str, Dict[str, Any]]]] = None

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

# Permission Rules v2 (legacy)
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

class PresetApplyIn(BaseModel):
    role: Optional[str] = None
    team_id: Optional[str] = None
    employee_id: Optional[str] = None

class PresetCreateIn(BaseModel):
    name: str
    description: Optional[str] = ""
    module: str
    rules: List[Dict[str, Any]]
