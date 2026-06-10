"""Contacts (employees): CRUD + bulk + csv export + password retrieval/reset."""
import os
import csv
import io
import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import Depends, HTTPException
from fastapi.responses import StreamingResponse

from core import (
    api_router, db, log_audit, now_iso, require_role, get_current_user,
    hash_password, encrypt_password, decrypt_password, generate_password,
    _public_contact,
    ContactCreate, ContactUpdate, BulkContactStatus, BulkContactRole,
)
from notifications import (
    send_email, render_new_employee_email, render_admin_password_reset_email,
)

logger = logging.getLogger(__name__)


async def _enrich_contacts_with_team(contacts: List[dict]) -> List[dict]:
    """Attach team_name, manager_names and permission_sets enrichment to contacts."""
    if not contacts:
        return contacts
    teams = await db.teams.find({}, {"_id": 0}).to_list(2000)
    member_team: Dict[str, dict] = {}
    for t in teams:
        for mid in t.get("member_ids", []) or []:
            member_team[mid] = t
        for mid in t.get("manager_ids", []) or []:
            member_team.setdefault(mid, t)

    mgr_ids = list({mid for t in teams for mid in (t.get("manager_ids") or [])})
    mgr_docs = []
    if mgr_ids:
        mgr_docs = await db.contacts.find({"id": {"$in": mgr_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)
    mgr_name_map = {m["id"]: m["name"] for m in mgr_docs}

    all_set_ids: set = set()
    for c in contacts:
        for sid in (c.get("permission_set_ids") or []):
            all_set_ids.add(sid)
    pset_map: Dict[str, dict] = {}
    if all_set_ids:
        psets = await db.permission_sets.find(
            {"id": {"$in": list(all_set_ids)}},
            {"_id": 0, "id": 1, "numeric_id": 1, "name": 1},
        ).to_list(2000)
        pset_map = {p["id"]: p for p in psets}

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
        ids = list(c.get("permission_set_ids") or [])
        c["permission_set_ids"] = ids
        c["permission_sets"] = [pset_map[i] for i in ids if i in pset_map]
    return contacts


@api_router.get("/contacts")
async def list_contacts(
    user=Depends(get_current_user),
    q: Optional[str] = None,
    role: Optional[str] = None,
    type: Optional[str] = None,
    status: Optional[str] = None,
    permission_set_id: Optional[str] = None,
    page: Optional[int] = None,
    page_size: int = 25,
    sort_by: str = "name",
    sort_dir: str = "asc",
):
    # 'type' kept as backward-compat alias for 'role'
    role_filter = role or type
    query = {}
    if user["role"] not in ("Super Admin", "Admin"):
        query["role"] = {"$in": ["Super Admin", "Admin"]}
    if role_filter:
        query["role"] = role_filter
    if status:
        query["status"] = status
    if permission_set_id:
        target_id = permission_set_id
        if permission_set_id.isdigit():
            pset = await db.permission_sets.find_one(
                {"$or": [{"id": permission_set_id}, {"numeric_id": int(permission_set_id)}]},
                {"_id": 0, "id": 1},
            )
            if pset:
                target_id = pset["id"]
        query["permission_set_ids"] = target_id
    if q:
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"email": {"$regex": q, "$options": "i"}}]
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
    user=Depends(require_role("Super Admin")),
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
async def bulk_contact_status(body: BulkContactStatus, user=Depends(require_role("Super Admin"))):
    if not body.contact_ids:
        raise HTTPException(400, "No contacts selected")
    targets = [cid for cid in body.contact_ids if cid != user["id"]]
    if not targets:
        raise HTTPException(400, "Cannot change your own status")
    r = await db.contacts.update_many({"id": {"$in": targets}}, {"$set": {"status": body.status}})
    # Auto-release workstation bookings if employees became Inactive
    released_count = 0
    if (body.status or "").lower() == "inactive":
        try:
            from routers.workstation_bookings import auto_release_for_employee
            actor = {"id": user.get("id"), "name": user.get("name"), "email": user.get("email")}
            for cid in targets:
                released_count += await auto_release_for_employee(cid, actor)
        except Exception as e:
            logger.error(f"Auto-release failed for bulk_contact_status: {e}")
    await log_audit(
        actor=user, action="contact.bulk_status", resource="contact",
        detail=f"Bulk set status={body.status} for {r.modified_count} employee(s); released {released_count} workstation booking(s)",
        metadata={"count": r.modified_count, "status": body.status, "workstation_released": released_count},
        severity="warning",
    )
    return {"updated": r.modified_count, "workstation_released": released_count}


@api_router.post("/contacts/bulk-role")
async def bulk_contact_role(body: BulkContactRole, user=Depends(require_role("Super Admin"))):
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
async def create_contact(body: ContactCreate, user=Depends(require_role("Super Admin"))):
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
        "permission_set_ids": list(body.permission_set_ids or []),
        "status": "Active",
        "created_on": now_iso(),
        "last_login": None,
        "password_hash": hash_password(generated_pwd),
        "password_encrypted": encrypt_password(generated_pwd),
    }
    await db.contacts.insert_one(doc)
    out = _public_contact(dict(doc))
    out["generated_password"] = generated_pwd
    try:
        subject, mbody = render_new_employee_email(
            name=doc["name"], email=doc["email"], password=generated_pwd,
            login_url=os.environ.get("APP_PUBLIC_URL", "") + "/login",
        )
        await send_email(
            db, to_email=doc["email"], to_name=doc["name"],
            kind="new_employee", subject=subject, body=mbody,
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
async def update_contact(contact_id: str, body: ContactUpdate, user=Depends(require_role("Super Admin"))):
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "Nothing to update")
    before = await db.contacts.find_one({"id": contact_id}, {"_id": 0, "permission_set_ids": 1, "name": 1, "email": 1, "status": 1})
    await db.contacts.update_one({"id": contact_id}, {"$set": update})
    contact = await db.contacts.find_one({"id": contact_id}, {"_id": 0, "password_hash": 0, "password_encrypted": 0})
    if not contact:
        raise HTTPException(404, "Not found")
    # Auto-release workstation bookings on Active -> Inactive transitions
    if (
        "status" in update
        and (update["status"] or "").lower() == "inactive"
        and (before or {}).get("status") != "Inactive"
    ):
        try:
            from routers.workstation_bookings import auto_release_for_employee
            actor = {"id": user.get("id"), "name": user.get("name"), "email": user.get("email")}
            released = await auto_release_for_employee(contact_id, actor)
            if released:
                await log_audit(
                    actor=user, action="workstation_booking.auto_release", resource="contact", resource_id=contact_id,
                    detail=f"Auto-released {released} workstation booking(s) after employee deactivation",
                    metadata={"contact_id": contact_id, "released": released}, severity="info",
                )
        except Exception as e:
            logger.error(f"Auto-release failed for update_contact: {e}")
    if before is not None and "permission_set_ids" in update:
        old_ids = set(before.get("permission_set_ids") or [])
        new_ids = set(update["permission_set_ids"])
        if old_ids != new_ids:
            await log_audit(
                actor=user, action="contact.assign_permission_sets", resource="contact", resource_id=contact_id,
                detail=f"Updated permission sets for {before.get('name')} ({before.get('email')}): {len(old_ids)} -> {len(new_ids)}",
                metadata={"before": list(old_ids), "after": list(new_ids)},
                severity="info",
            )
    [c] = await _enrich_contacts_with_team([contact])
    return c


@api_router.get("/contacts/{contact_id}")
async def get_contact(contact_id: str, user=Depends(require_role("Super Admin"))):
    c = await db.contacts.find_one({"id": contact_id}, {"_id": 0, "password_hash": 0, "password_encrypted": 0})
    if not c:
        raise HTTPException(404, "Not found")
    [c] = await _enrich_contacts_with_team([c])
    return c


@api_router.get("/contacts/{contact_id}/password")
async def get_contact_password(contact_id: str, user=Depends(require_role("Super Admin"))):
    c = await db.contacts.find_one({"id": contact_id})
    if not c:
        raise HTTPException(404, "Not found")
    pwd = decrypt_password(c.get("password_encrypted"))
    if not pwd:
        raise HTTPException(404, "Password not available — please reset to view")
    return {"password": pwd}


@api_router.post("/contacts/{contact_id}/reset-password")
async def reset_contact_password(contact_id: str, user=Depends(require_role("Super Admin"))):
    c = await db.contacts.find_one({"id": contact_id})
    if not c:
        raise HTTPException(404, "Not found")
    new_pwd = generate_password()
    await db.contacts.update_one({"id": contact_id}, {"$set": {
        "password_hash": hash_password(new_pwd),
        "password_encrypted": encrypt_password(new_pwd),
    }})
    try:
        subject, mbody = render_admin_password_reset_email(
            name=c["name"], email=c["email"], password=new_pwd,
            login_url=os.environ.get("APP_PUBLIC_URL", "") + "/login",
        )
        await send_email(
            db, to_email=c["email"], to_name=c["name"],
            kind="admin_password_reset", subject=subject, body=mbody,
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
