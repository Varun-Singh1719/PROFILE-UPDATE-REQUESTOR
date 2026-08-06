"""Ticketing System — main entrypoint.

Configures the FastAPI app, registers all routers, and runs startup migrations.
Domain logic lives under `routers/`; shared infrastructure under `core.py`.
"""
import logging
import os
import uuid

from starlette.middleware.cors import CORSMiddleware
from fastapi import Request
from fastapi.responses import Response

# Import core to bootstrap config / db / app / api_router.
from core import (
    app, api_router, db, client,
    now_iso, hash_password, verify_password, encrypt_password,
    DEFAULT_PRESETS, DEFAULT_TEMPLATES,
)

# Register all routes by importing each router module (side-effect on api_router).
from routers import auth as _auth  # noqa: F401
from routers import notifications_email as _notif  # noqa: F401
from routers import notifications_inapp as _notif_inapp  # noqa: F401
# NOTE: contact_uploads MUST be imported BEFORE contacts because contacts.py
# registers a dynamic `GET /contacts/{contact_id}` route that would otherwise
# shadow the static `/contacts/sample-template` and `/contacts/upload-history`
# endpoints (FastAPI matches routes in declaration order).
from routers import contact_uploads as _contact_uploads  # noqa: F401
from routers import contacts as _contacts  # noqa: F401
from routers import profile as _profile  # noqa: F401
from routers import teams as _teams  # noqa: F401
from routers import permissions as _permissions  # noqa: F401
from routers import permission_sets as _psets  # noqa: F401
from routers import audit as _audit  # noqa: F401
from routers import tickets as _tickets  # noqa: F401
from routers import files as _files  # noqa: F401
from routers import dashboard as _dashboard  # noqa: F401
from routers import floor_plans as _floor_plans  # noqa: F401
from routers import room_bookings as _room_bookings  # noqa: F401
from routers import meeting_room_requests as _meeting_room_requests  # noqa: F401
from routers import workstation_bookings as _workstation_bookings  # noqa: F401
from routers import workstation_requests as _workstation_requests  # noqa: F401
from routers import approval_settings as _approval_settings  # noqa: F401
from routers import bookings as _bookings  # noqa: F401
from routers import my_workspace as _my_workspace  # noqa: F401
from routers import permissions_v3 as _permissions_v3  # noqa: F401
from routers import segmentations as _segmentations  # noqa: F401
from routers import clients as _clients  # noqa: F401
from routers import crm_overview as _crm_overview  # noqa: F401
from routers import poc_status as _poc_status  # noqa: F401
from routers import client_contact_uploads as _client_contact_uploads  # noqa: F401  (must come BEFORE client_contacts so /client-contacts/sample-template etc. beat /client-contacts/{id})
from routers import client_contacts as _client_contacts  # noqa: F401

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Override CORS headers set by ingress
@app.middleware("http")
async def override_cors_headers(request: Request, call_next):
    response = await call_next(request)
    origin = request.headers.get("origin", "")
    if "preview.emergentagent.com" in origin:
        # Remove wildcard and set specific origin
        if "access-control-allow-origin" in response.headers:
            del response.headers["access-control-allow-origin"]
        response.headers["access-control-allow-origin"] = origin
        response.headers["access-control-allow-credentials"] = "true"
    return response

app.include_router(api_router)


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
    await db.contact_uploads.create_index([("uploaded_at", -1)])
    await db.contact_uploads.create_index("id", unique=True)
    await db.room_bookings.create_index("seq_no", unique=True, sparse=True)
    await db.room_bookings.create_index([("start_at", 1)])
    await db.room_bookings.create_index([("organizer.id", 1)])
    await db.workstation_bookings.create_index("id", unique=True)
    await db.workstation_bookings.create_index("seq_no", unique=True, sparse=True)
    await db.workstation_bookings.create_index([("plan_id", 1), ("date", 1), ("cancelled", 1)])
    await db.workstation_bookings.create_index([("employee.id", 1), ("date", 1), ("cancelled", 1)])
    await db.workstation_bookings.create_index([("seat_id", 1), ("date", 1), ("cancelled", 1)])
    await db.workstation_bookings.create_index([("series_id", 1)])
    # Workstation Requests (approval-based allocation)
    await db.workstation_requests.create_index("id", unique=True)
    await db.workstation_requests.create_index("seq_no", unique=True, sparse=True)
    await db.workstation_requests.create_index([("plan_id", 1), ("date", 1), ("status", 1)])
    await db.workstation_requests.create_index([("seat_id", 1), ("date", 1), ("status", 1)])
    await db.workstation_requests.create_index([("employee.id", 1), ("date", 1), ("status", 1)])
    await db.workstation_requests.create_index([("status", 1), ("requested_on", -1)])
    await db.workstation_requests.create_index([("group_id", 1)])

    # meeting_room_requests — approval flow for meeting-room bookings
    await db.meeting_room_requests.create_index("id", unique=True)
    await db.meeting_room_requests.create_index("seq_no", unique=True, sparse=True)
    await db.meeting_room_requests.create_index([("plan_id", 1), ("room_id", 1), ("status", 1)])
    await db.meeting_room_requests.create_index([("status", 1), ("requested_on", -1)])
    await db.meeting_room_requests.create_index([("requested_by.id", 1), ("status", 1)])
    await db.meeting_room_requests.create_index([("series_id", 1)])
    # In-app notifications (bell dropdown) + editable templates
    await db.inapp_notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.inapp_notifications.create_index([("user_id", 1), ("read", 1)])
    await db.notification_templates.create_index("kind", unique=True)
    # CRM → Segmentations
    await db.segmentations.create_index("id", unique=True)
    await db.segmentations.create_index([("name", 1)])
    await db.segmentations.create_index([("created_on", -1)])
    # ─── Migration: default phone_isd = "+91" for existing contacts that
    # pre-date the ISD split (Jul-2026). Idempotent — the query only matches
    # rows that don't already have a phone_isd persisted.
    try:
        migr = await db.contacts.update_many(
            {"$or": [{"phone_isd": {"$exists": False}}, {"phone_isd": None}, {"phone_isd": ""}]},
            {"$set": {"phone_isd": "+91"}},
        )
        if migr.modified_count:
            logger.info(f"Defaulted phone_isd=+91 on {migr.modified_count} contact(s)")
    except Exception as _e:  # noqa: BLE001
        logger.warning(f"phone_isd default migration skipped: {_e}")

    # Seed default notification templates (idempotent — skips existing kinds)
    from inapp_notifications import seed_default_templates as _seed_inapp_tpl
    await _seed_inapp_tpl(db)

    # ─── Migration: rewrite legacy in-app notification action_urls so old
    # notifications also deep-link to the specific record (Jul 2026). We
    # only rewrite rows whose current action_url is one of the historical
    # module-only paths — user-edited urls (if any) are left alone.
    try:
        legacy_to_kind_map = {
            "/workspace-manager/workstation-requests": {
                "workstation_request_submitted": "/workspace-manager/pending-approvals?requestId={rid}",
                "workstation_request_declined":  "/workspace-manager/request-workstation?requestId={rid}",
            },
            "/workspace-manager/meeting-room-requests": {
                "meeting_room_request_submitted": "/workspace-manager/pending-approvals?requestId={rid}",
            },
            "/workspace-manager/bookings": {
                "workstation_request_approved": "/workspace-manager/bookings?bookingId={rid}",
                "workstation_assigned":         "/workspace-manager/bookings?bookingId={rid}",
            },
            "/workspace-manager/meeting-room-booking": {
                "meeting_room_request_approved": "/workspace-manager/meeting-room-booking?bookingId={rid}",
                "meeting_room_request_declined": "/workspace-manager/meeting-room-booking?requestId={rid}",
            },
        }
        total_fixed = 0
        for legacy_url, kind_map in legacy_to_kind_map.items():
            for kind, tmpl in kind_map.items():
                cursor = db.inapp_notifications.find(
                    {"kind": kind, "action_url": legacy_url, "related_id": {"$ne": None}},
                    {"_id": 1, "related_id": 1},
                )
                async for doc in cursor:
                    new_url = tmpl.format(rid=doc["related_id"])
                    await db.inapp_notifications.update_one(
                        {"_id": doc["_id"]}, {"$set": {"action_url": new_url}}
                    )
                    total_fixed += 1
        if total_fixed:
            logger.info(f"Migrated action_url on {total_fixed} in-app notifications to deep-link format")
    except Exception as _e:  # noqa: BLE001 — never break startup
        logger.warning(f"in-app notification action_url migration skipped: {_e}")
    # NOTE: do NOT call init_storage() here — it makes a blocking outbound
    # HTTPS call (timeout=30s) that returns 400 when the storage feature
    # isn't wired up, which adds 5–10s to every cold-start / hot-reload and
    # widens the 502 window the ingress shows to users. The function is
    # already lazy-invoked on the first file upload (see put_object/get_object).

    # Backfill seq_no on existing bookings (idempotent, one-shot)
    from routers.room_bookings import _ensure_seq_no_backfill
    await _ensure_seq_no_backfill()

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

    # ---- Migration: backfill team_id / team_name on existing tickets ----
    # Idempotent: only touches tickets that lack team_id and whose creator
    # currently belongs to a team.
    missing = await db.tickets.find({"team_id": {"$in": [None, ""]}}, {"_id": 0, "id": 1, "created_by_id": 1}).to_list(20000)
    if missing:
        # Build a creator_id -> team_id/name map in one shot.
        creator_ids = list({m.get("created_by_id") for m in missing if m.get("created_by_id")})
        contacts = await db.contacts.find({"id": {"$in": creator_ids}}, {"_id": 0, "id": 1, "team_id": 1}).to_list(len(creator_ids))
        team_ids = list({c["team_id"] for c in contacts if c.get("team_id")})
        teams = await db.teams.find({"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(team_ids))
        team_name_by_id = {t["id"]: t["name"] for t in teams}
        team_by_creator = {c["id"]: c.get("team_id") for c in contacts}
        ticket_backfilled = 0
        for m in missing:
            tid = team_by_creator.get(m.get("created_by_id"))
            if not tid:
                continue
            await db.tickets.update_one(
                {"id": m["id"]},
                {"$set": {"team_id": tid, "team_name": team_name_by_id.get(tid)}},
            )
            ticket_backfilled += 1
        if ticket_backfilled:
            logger.info(f"Backfilled team on {ticket_backfilled} tickets")

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

    # ---- Migration: strip `subject` field from tickets (Jul 2026) ----
    # The Subject column was removed from the app; existing tickets still hold
    # the old field in DB. $unset it so the field disappears from list/detail
    # responses and doesn't leak into exports.
    try:
        res_unset_subject = await db.tickets.update_many(
            {"subject": {"$exists": True}},
            {"$unset": {"subject": ""}},
        )
        if res_unset_subject.modified_count:
            logger.info(f"Migration: unset `subject` on {res_unset_subject.modified_count} tickets")
    except Exception as _e:  # noqa: BLE001
        logger.warning(f"tickets.subject $unset migration skipped: {_e}")

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
