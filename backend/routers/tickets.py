"""Tickets: list/CRUD, bulk, csv export, comments, activity."""
import csv
import io
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import Depends, HTTPException
from fastapi.responses import StreamingResponse

from core import (
    api_router, db, now_iso, get_current_user,
    TicketCreate, TicketUpdate, BulkAssign, BulkStatus, CommentCreate,
)


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
    if user["role"] not in ("Super Admin", "Admin"):
        raise HTTPException(403, "Only Super Admin / Admin can create tickets")
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
        if role in ("Super Admin", "Admin"):
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
        if role in ("Super Admin", "Admin"):
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
    if role not in ("Super Admin", "Admin", "DQ Team"):
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
    if role not in ("Super Admin", "Admin", "DQ Team"):
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
