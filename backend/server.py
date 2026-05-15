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
from fastapi.responses import Response as FastResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

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
ContactRole = Literal["Admin", "Manager", "Research Associate", "DQ Team"]
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
    emp_id: Optional[str] = None
    doj: Optional[str] = None  # YYYY-MM-DD

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
async def list_contacts(user=Depends(get_current_user), q: Optional[str] = None, role: Optional[str] = None, type: Optional[str] = None, status: Optional[str] = None):
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
    items = await db.contacts.find(query, {"_id": 0, "password_hash": 0, "password_encrypted": 0}).to_list(2000)
    items = await _enrich_contacts_with_team(items)
    return items

@api_router.post("/contacts")
async def create_contact(body: ContactCreate, user=Depends(require_role("Admin"))):
    email = body.email.lower().strip()
    if await db.contacts.find_one({"email": email}):
        raise HTTPException(400, "Email already exists")
    generated_pwd = generate_password()
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": body.name,
        "phone": body.phone or "",
        "role": body.role,
        "emp_id": body.emp_id or "",
        "doj": body.doj or None,
        "status": "Active",
        "created_on": now_iso(),
        "last_login": None,
        "password_hash": hash_password(generated_pwd),
        "password_encrypted": encrypt_password(generated_pwd),
    }
    await db.contacts.insert_one(doc)
    out = _public_contact(dict(doc))
    out["generated_password"] = generated_pwd  # one-time return at creation
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
    return {"password": new_pwd}

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
    doc = {
        "id": str(uuid.uuid4()),
        "name": body.name.strip(),
        "manager_ids": list({*body.manager_ids}),
        "member_ids": member_ids,
        "color": body.color or "#ec9324",
        "created_on": now_iso(),
        "updated_on": now_iso(),
    }
    await db.teams.insert_one(doc)
    doc.pop("_id", None)
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

# ---------- Permissions (UI-only config storage) ----------
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
):
    query = parse_filters(status, priority, created_by, assigned_to, q, created_on, updated_on, due_date, date_from, date_to, date_field)

    role = user["role"]
    uid = user["id"]
    if scope == "mine":
        if role == "Research Associate":
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
    if role == "Research Associate" and scope not in ("created", "mine"):
        query["created_by_id"] = uid

    items = await db.tickets.find(query, {"_id": 0}).sort("updated_on", -1).to_list(2000)
    return items

@api_router.post("/tickets")
async def create_ticket(body: TicketCreate, user=Depends(get_current_user)):
    if user["role"] not in ("Research Associate", "Admin", "Manager"):
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
    if role == "Research Associate":
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
    if role == "Research Associate":
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
    init_storage()

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
        {"email": "ra@ticketing.com", "name": "Riya Sharma", "role": "Research Associate", "password": "Test@123", "emp_id": "EMP-0020", "doj": "2024-03-01"},
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
