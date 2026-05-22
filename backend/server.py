"""Ticketing System — main entrypoint.

Configures the FastAPI app, registers all routers, and runs startup migrations.
Domain logic lives under `routers/`; shared infrastructure under `core.py`.
"""
import logging
import os
import uuid

from starlette.middleware.cors import CORSMiddleware

# Import core to bootstrap config / db / app / api_router.
from core import (
    app, api_router, db, client, init_storage,
    now_iso, hash_password, verify_password, encrypt_password,
    DEFAULT_PRESETS, DEFAULT_TEMPLATES,
)

# Register all routes by importing each router module (side-effect on api_router).
from routers import auth as _auth  # noqa: F401
from routers import notifications_email as _notif  # noqa: F401
from routers import contacts as _contacts  # noqa: F401
from routers import teams as _teams  # noqa: F401
from routers import permissions as _permissions  # noqa: F401
from routers import permission_sets as _psets  # noqa: F401
from routers import audit as _audit  # noqa: F401
from routers import tickets as _tickets  # noqa: F401
from routers import files as _files  # noqa: F401
from routers import dashboard as _dashboard  # noqa: F401

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.contacts.create_index("email", unique=True)
    await db.tickets.create_index("ticket_id", unique=True)
    await db.audit_log.create_index([("at", -1)])
    await db.permission_rules.create_index([("module", 1), ("feature", 1), ("role", 1), ("team_id", 1), ("employee_id", 1)])
    await db.permission_sets.create_index("id", unique=True)
    await db.permission_sets.create_index("numeric_id", unique=True)
    await db.permission_sets.create_index([("created_at", -1)])
    await db.permission_sets.create_index([("created_by.id", 1)])
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

    # ---- Migration v3: collapse legacy roles into Super Admin / Admin (ONE-TIME) ----
    flag = await db.system_meta.find_one({"_id": "v3_role_collapse"})
    if not flag:
        res_super = await db.contacts.update_many({"role": "Admin"}, {"$set": {"role": "Super Admin"}})
        if res_super.modified_count:
            logger.info(f"v3 role collapse: {res_super.modified_count} contacts 'Admin' -> 'Super Admin'")
        res_admin = await db.contacts.update_many(
            {"role": {"$in": ["Manager", "Research", "Research Associate", "Delivery", "Member", "DQ Team"]}},
            {"$set": {"role": "Admin"}},
        )
        if res_admin.modified_count:
            logger.info(f"v3 role collapse: {res_admin.modified_count} contacts legacy roles -> 'Admin'")
        await db.system_meta.insert_one({
            "_id": "v3_role_collapse",
            "completed_at": now_iso(),
            "promoted_to_super_admin": res_super.modified_count,
            "collapsed_to_admin": res_admin.modified_count,
        })

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
            "role": "Super Admin", "status": "Active",
            "emp_id": "EMP-0001", "doj": "2024-01-01",
            "created_on": now_iso(), "last_login": None,
            "password_hash": hash_password(admin_password),
            "password_encrypted": encrypt_password(admin_password),
        })
        logger.info(f"Seeded admin: {admin_email}")
    else:
        if existing.get("role") != "Super Admin":
            await db.contacts.update_one({"email": admin_email}, {"$set": {"role": "Super Admin"}})
        if not verify_password(admin_password, existing.get("password_hash", "")):
            await db.contacts.update_one({"email": admin_email}, {"$set": {
                "password_hash": hash_password(admin_password),
                "password_encrypted": encrypt_password(admin_password),
            }})
        if not existing.get("password_encrypted"):
            await db.contacts.update_one({"email": admin_email}, {"$set": {
                "password_encrypted": encrypt_password(admin_password)
            }})

    # Test users — all collapsed to Admin per v3 role model
    test_users = [
        {"email": "manager@ticketing.com", "name": "Maya Khanna", "role": "Admin", "password": "Test@123", "emp_id": "EMP-0010", "doj": "2024-02-01"},
        {"email": "ra@ticketing.com", "name": "Riya Sharma", "role": "Admin", "password": "Test@123", "emp_id": "EMP-0020", "doj": "2024-03-01"},
        {"email": "dq1@ticketing.com", "name": "Dev Kapoor", "role": "Admin", "password": "Test@123", "emp_id": "EMP-0030", "doj": "2024-04-01"},
        {"email": "dq2@ticketing.com", "name": "Sara Mehta", "role": "Admin", "password": "Test@123", "emp_id": "EMP-0031", "doj": "2024-04-15"},
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
            existing_u = await db.contacts.find_one({"email": u["email"]})
            if not existing_u.get("password_encrypted"):
                await db.contacts.update_one({"email": u["email"]}, {"$set": {
                    "password_encrypted": encrypt_password(u["password"])
                }})


@app.on_event("shutdown")
async def shutdown():
    client.close()
