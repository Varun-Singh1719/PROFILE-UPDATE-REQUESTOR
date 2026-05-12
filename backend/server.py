from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import bcrypt
import jwt
import requests
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal
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

def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
        "type": "access"
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def now_iso():
    return datetime.now(timezone.utc).isoformat()

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
        user = await db.contacts.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
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
        if user["type"] not in roles:
            raise HTTPException(403, "Not authorized")
        return user
    return checker

# ---------- Models ----------
ContactType = Literal["Admin", "Research Associate", "DQ Team"]
ContactStatus = Literal["Active", "Inactive"]
TicketStatus = Literal["Open", "In Progress", "Closed"]
TicketPriority = Literal["High", "Medium", "Low"]

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class ContactCreate(BaseModel):
    email: EmailStr
    name: str
    phone: Optional[str] = None
    type: ContactType
    password: str

class ContactUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    type: Optional[ContactType] = None
    status: Optional[ContactStatus] = None

class TicketCreate(BaseModel):
    subject: str
    priority: TicketPriority
    due_date: Optional[str] = None
    number_of_profiles: int = 0
    attachment_path: Optional[str] = None
    attachment_name: Optional[str] = None

class TicketUpdate(BaseModel):
    status: Optional[TicketStatus] = None
    assigned_to: Optional[str] = None  # contact id, or empty string for unassign

class BulkAssign(BaseModel):
    ticket_ids: List[str]
    assigned_to: Optional[str] = None  # if None and DQ user => assign to self

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
    token = create_access_token(user["id"], user["email"], user["type"])
    response.set_cookie("access_token", token, httponly=True, secure=False, samesite="lax", max_age=43200, path="/")
    await db.contacts.update_one({"id": user["id"]}, {"$set": {"last_login": now_iso()}})
    user.pop("_id", None); user.pop("password_hash", None)
    return {"user": user, "access_token": token}

@api_router.post("/auth/logout")
async def logout(response: Response, _: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}

@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user

# ---------- Contacts Routes ----------
@api_router.get("/contacts")
async def list_contacts(user=Depends(get_current_user), q: Optional[str] = None, type: Optional[str] = None, status: Optional[str] = None):
    # Admin can see all; others can only see DQ members + themselves
    query = {}
    if user["type"] != "Admin":
        query["type"] = {"$in": ["DQ Team", "Admin"]}
    if type:
        query["type"] = type
    if status:
        query["status"] = status
    if q:
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"email": {"$regex": q, "$options": "i"}}]
    items = await db.contacts.find(query, {"_id": 0, "password_hash": 0}).to_list(2000)
    return items

@api_router.post("/contacts")
async def create_contact(body: ContactCreate, user=Depends(require_role("Admin"))):
    email = body.email.lower().strip()
    if await db.contacts.find_one({"email": email}):
        raise HTTPException(400, "Email already exists")
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": body.name,
        "phone": body.phone or "",
        "type": body.type,
        "status": "Active",
        "created_on": now_iso(),
        "last_login": None,
        "password_hash": hash_password(body.password),
    }
    await db.contacts.insert_one(doc)
    doc.pop("_id", None); doc.pop("password_hash", None)
    return doc

@api_router.patch("/contacts/{contact_id}")
async def update_contact(contact_id: str, body: ContactUpdate, user=Depends(require_role("Admin"))):
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "Nothing to update")
    await db.contacts.update_one({"id": contact_id}, {"$set": update})
    contact = await db.contacts.find_one({"id": contact_id}, {"_id": 0, "password_hash": 0})
    if not contact:
        raise HTTPException(404, "Not found")
    return contact

# ---------- Tickets Routes ----------
def parse_filters(status, priority, created_by, assigned_to, q, created_on, updated_on, due_date):
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
    return query

@api_router.get("/tickets")
async def list_tickets(
    user=Depends(get_current_user),
    scope: Optional[str] = None,  # mine|created|assigned|unassigned|open|all
    status: Optional[str] = None,
    priority: Optional[str] = None,
    created_by: Optional[str] = None,
    assigned_to: Optional[str] = None,
    q: Optional[str] = None,
    created_on: Optional[str] = None,
    updated_on: Optional[str] = None,
    due_date: Optional[str] = None,
):
    query = parse_filters(status, priority, created_by, assigned_to, q, created_on, updated_on, due_date)

    role = user["type"]
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
    if user["type"] not in ("Research Associate", "Admin"):
        raise HTTPException(403, "Only RA/Admin can create tickets")
    count = await db.tickets.count_documents({})
    doc = {
        "id": str(uuid.uuid4()),
        "ticket_id": f"TKT-{1000 + count + 1}",
        "subject": body.subject,
        "priority": body.priority,
        "due_date": body.due_date,
        "number_of_profiles": body.number_of_profiles,
        "attachment_path": body.attachment_path,
        "attachment_name": body.attachment_name,
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
    return t

@api_router.patch("/tickets/{ticket_id}")
async def update_ticket(ticket_id: str, body: TicketUpdate, user=Depends(get_current_user)):
    t = await db.tickets.find_one({"id": ticket_id})
    if not t:
        raise HTTPException(404, "Not found")
    role = user["type"]
    update = {}
    activity = []

    if body.status is not None:
        # Admin can always update. DQ only if assigned to them. RA cannot update status.
        if role == "Admin":
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
        # Admin: assign/reassign to anyone (or unassign with empty string)
        # DQ: only assign to self when ticket is unassigned
        if role == "Admin":
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
    role = user["type"]
    if role not in ("Admin", "DQ Team"):
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
    # Allow either cookie auth or ?auth=token
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
@api_router.get("/dashboard/stats")
async def dashboard_stats(user=Depends(get_current_user), member_id: Optional[str] = None):
    role = user["type"]
    base = {}
    if role == "Research Associate":
        base["created_by_id"] = user["id"]
    elif role == "DQ Team":
        base["assigned_to_id"] = user["id"]
    elif role == "Admin" and member_id:
        base["assigned_to_id"] = member_id

    async def cnt(extra):
        q = {**base, **extra}
        return await db.tickets.count_documents(q)

    total = await cnt({})
    open_c = await cnt({"status": "Open"})
    inprog = await cnt({"status": "In Progress"})
    closed = await cnt({"status": "Closed"})
    return {"total": total, "open": open_c, "in_progress": inprog, "closed": closed}

@api_router.get("/dashboard/dq-performance")
async def dq_performance(user=Depends(require_role("Admin"))):
    members = await db.contacts.find({"type": "DQ Team", "status": "Active"}, {"_id": 0, "password_hash": 0}).to_list(500)
    out = []
    for m in members:
        base = {"assigned_to_id": m["id"]}
        out.append({
            "id": m["id"], "name": m["name"], "email": m["email"],
            "total": await db.tickets.count_documents(base),
            "open": await db.tickets.count_documents({**base, "status": "Open"}),
            "in_progress": await db.tickets.count_documents({**base, "status": "In Progress"}),
            "closed": await db.tickets.count_documents({**base, "status": "Closed"}),
        })
    return out

@api_router.get("/dashboard/recent")
async def dashboard_recent(user=Depends(get_current_user), kind: str = "updated", limit: int = 8):
    base = {}
    role = user["type"]
    if role == "Research Associate":
        base["created_by_id"] = user["id"]
    elif role == "DQ Team":
        base["assigned_to_id"] = user["id"]
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

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@ticketing.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "Admin@123")

    existing = await db.contacts.find_one({"email": admin_email})
    if not existing:
        await db.contacts.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email, "name": "Admin User", "phone": "",
            "type": "Admin", "status": "Active",
            "created_on": now_iso(), "last_login": None,
            "password_hash": hash_password(admin_password)
        })
        logger.info(f"Seeded admin: {admin_email}")
    else:
        if not verify_password(admin_password, existing.get("password_hash", "")):
            await db.contacts.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})

    # Test users
    test_users = [
        {"email": "ra@ticketing.com", "name": "Riya Sharma", "type": "Research Associate", "password": "Test@123"},
        {"email": "dq1@ticketing.com", "name": "Dev Kapoor", "type": "DQ Team", "password": "Test@123"},
        {"email": "dq2@ticketing.com", "name": "Sara Mehta", "type": "DQ Team", "password": "Test@123"},
    ]
    for u in test_users:
        if not await db.contacts.find_one({"email": u["email"]}):
            await db.contacts.insert_one({
                "id": str(uuid.uuid4()),
                "email": u["email"], "name": u["name"], "phone": "",
                "type": u["type"], "status": "Active",
                "created_on": now_iso(), "last_login": None,
                "password_hash": hash_password(u["password"])
            })

@app.on_event("shutdown")
async def shutdown():
    client.close()
