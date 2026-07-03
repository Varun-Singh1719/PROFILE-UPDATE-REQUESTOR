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
from notifications import send_email
from routers.permissions import get_effective_scope, get_user_scope_context, scope_to_id_filter


async def _ticket_view_filter(user: dict) -> dict:
    """Build a Mongo query filter that limits which tickets the user is allowed
    to see, based on their effective `profix.ticket.view` scope.

    Returns `{}` for unrestricted access (Super Admin / "all").
    Returns `{"$or": [{"created_by_id": {"$in": ids}}, {"assigned_to_id": {"$in": ids}}]}`
    for "respective" or "team".
    Returns an impossible filter `{"id": "__none__"}` for deny.
    """
    scope = await get_effective_scope(user, "profix", "ticket", "view")
    if scope == "all" or scope is True:
        return {}
    ctx = await get_user_scope_context(user)
    ids = scope_to_id_filter(scope, ctx)
    if ids is None:
        return {}
    if not ids:
        return {"id": "__no_match__"}
    return {"$or": [{"created_by_id": {"$in": ids}}, {"assigned_to_id": {"$in": ids}}]}


async def _check_ticket_action_scope(user: dict, ticket: dict, action: str) -> bool:
    """Check whether `user` is allowed to perform `action` (view/edit/assign/approve)
    on the given ticket, considering scope. Returns True/False.
    """
    scope = await get_effective_scope(user, "profix", "ticket", action)
    if scope == "all" or scope is True:
        return True
    if not scope:
        return False
    ctx = await get_user_scope_context(user)
    allowed_ids = set(scope_to_id_filter(scope, ctx) or [])
    return (
        ticket.get("created_by_id") in allowed_ids
        or ticket.get("assigned_to_id") in allowed_ids
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


def _csv_list(v):
    """Parse a comma-separated string into a de-duplicated non-empty list.
    Empty / None / "all" returns []. Keeps original order minus dupes.
    """
    if not v:
        return []
    seen = set()
    out = []
    for part in str(v).split(","):
        p = part.strip()
        if not p or p.lower() == "all":
            continue
        if p in seen:
            continue
        seen.add(p)
        out.append(p)
    return out


def parse_filters(status, priority, created_by, assigned_to, q, created_on, updated_on, due_date, date_from=None, date_to=None, date_field="created_at", team=None):
    query = {}
    # status / priority / created_by / team support both single & comma-separated
    st_list = _csv_list(status)
    if st_list:
        query["status"] = {"$in": st_list} if len(st_list) > 1 else st_list[0]
    pr_list = _csv_list(priority)
    if pr_list:
        query["priority"] = {"$in": pr_list} if len(pr_list) > 1 else pr_list[0]
    cb_list = _csv_list(created_by)
    if cb_list:
        query["created_by_id"] = {"$in": cb_list} if len(cb_list) > 1 else cb_list[0]
    if assigned_to is not None and assigned_to != "":
        at_list = _csv_list(assigned_to)
        # "unassigned" is a pseudo-value that maps to null/empty
        has_unassigned = any(x.lower() == "unassigned" for x in at_list)
        concrete = [x for x in at_list if x.lower() != "unassigned"]
        if has_unassigned and concrete:
            query["$or"] = [
                {"assigned_to_id": {"$in": [None, ""]}},
                {"assigned_to_id": {"$in": concrete}},
            ]
        elif has_unassigned:
            query["assigned_to_id"] = {"$in": [None, ""]}
        elif concrete:
            query["assigned_to_id"] = {"$in": concrete} if len(concrete) > 1 else concrete[0]
    tm_list = _csv_list(team)
    if tm_list:
        query["team_id"] = {"$in": tm_list} if len(tm_list) > 1 else tm_list[0]
    if q:
        query["$or"] = [
            {"ticket_id": {"$regex": q, "$options": "i"}},
            {"subject": {"$regex": q, "$options": "i"}},
            {"description": {"$regex": q, "$options": "i"}},
            {"assigned_to_name": {"$regex": q, "$options": "i"}},
            {"created_by_name": {"$regex": q, "$options": "i"}},
            {"team_name": {"$regex": q, "$options": "i"}},
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
    team: Optional[str] = None,
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
    query = parse_filters(status, priority, created_by, assigned_to, q, created_on, updated_on, due_date, date_from, date_to, date_field, team=team)

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

    # Scope enforcement: layer on the user's effective view scope on profix.ticket.
    view_filter = await _ticket_view_filter(user)
    if view_filter:
        # Combine with the existing query using $and so both restrictions apply.
        if "$and" in query:
            query["$and"].append(view_filter)
        else:
            query = {"$and": [query, view_filter]} if query else view_filter

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
    team: Optional[str] = None,
    q: Optional[str] = None,
    created_on: Optional[str] = None,
    updated_on: Optional[str] = None,
    due_date: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    date_field: Optional[str] = "created_at",
):
    query = parse_filters(status, priority, created_by, assigned_to, q, created_on, updated_on, due_date, date_from, date_to, date_field, team=team)
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
    # Scope enforcement on export as well — never export beyond the user's view scope.
    view_filter = await _ticket_view_filter(user)
    if view_filter:
        query = {"$and": [query, view_filter]} if query else view_filter
    items = await db.tickets.find(query, {"_id": 0}).sort("updated_on", -1).to_list(20000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Ticket ID", "Subject", "Status", "Priority", "Created By", "Team", "Assigned To", "Profiles", "Due Date", "Created On", "Updated On"])
    for t in items:
        w.writerow([
            t.get("ticket_id", ""), t.get("subject", ""), t.get("status", ""), t.get("priority", ""),
            t.get("created_by_name", ""), t.get("team_name", "") or "—",
            t.get("assigned_to_name") or "Unassigned",
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
    # Denormalise the creator's team onto the ticket so list/filter/export
    # can show "Team" without per-row joins.
    creator = await db.contacts.find_one({"id": user["id"]}, {"_id": 0, "team_id": 1}) or {}
    team_id = creator.get("team_id")
    team_name = None
    if team_id:
        team_doc = await db.teams.find_one({"id": team_id}, {"_id": 0, "name": 1})
        team_name = (team_doc or {}).get("name")
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
        "team_id": team_id,
        "team_name": team_name,
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
    # Scope enforcement on direct fetch — prevents URL-manipulation bypass.
    if not await _check_ticket_action_scope(user, t, "view"):
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
            if role == "Admin" and not await _check_ticket_action_scope(user, t, "edit"):
                raise HTTPException(403, "Edit scope does not cover this ticket")
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
            if role == "Admin" and not await _check_ticket_action_scope(user, t, "assign"):
                raise HTTPException(403, "Assign scope does not cover this ticket")
            if body.assigned_to == "":
                update["assigned_to_id"] = None
                update["assigned_to_name"] = None
                activity.append("Unassigned")
            else:
                assignee = await db.contacts.find_one({"id": body.assigned_to})
                if not assignee:
                    raise HTTPException(400, "Assignee not found")
                # If the Admin's assign scope is "respective" or "team", the assignee
                # must be in their scoped id whitelist (else they could assign to anyone).
                if role == "Admin":
                    a_scope = await get_effective_scope(user, "profix", "ticket", "assign")
                    if a_scope not in ("all", True):
                        ctx = await get_user_scope_context(user)
                        allowed = set(scope_to_id_filter(a_scope, ctx) or [])
                        if assignee["id"] not in allowed:
                            raise HTTPException(403, "Assignee is outside your assign scope")
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

    # Notify the request creator when the ticket transitions to Closed.
    # Driven by the `request_closed` email template (seeded in DEFAULT_TEMPLATES).
    if update.get("status") == "Closed" and t.get("status") != "Closed":
        try:
            creator = await db.contacts.find_one({"id": t.get("created_by_id")}) if t.get("created_by_id") else None
            to_email = (creator or {}).get("email")
            to_name = (creator or {}).get("name") or t.get("created_by_name") or "there"
            if to_email:
                await send_email(
                    db,
                    to_email=to_email,
                    to_name=to_name,
                    kind="request_closed",
                    subject="Request Closed",
                    body="<p>Your request has been closed.</p>",
                    related_id=ticket_id,
                    metadata={
                        "ticket_id": t.get("ticket_id") or ticket_id,
                        "subject": t.get("subject") or "",
                        "closed_by": user.get("name") or "",
                        "closed_at": update["updated_on"],
                    },
                )
        except Exception as e:  # noqa: BLE001 — never block the API on a notification failure
            import logging as _l
            _l.getLogger(__name__).warning(f"request_closed email failed for ticket={ticket_id}: {e}")

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
        # Admin: assignee must fall inside the Admin's assign scope.
        if role == "Admin":
            a_scope = await get_effective_scope(user, "profix", "ticket", "assign")
            if not a_scope:
                raise HTTPException(403, "No assign permission")
            if a_scope not in ("all", True):
                ctx = await get_user_scope_context(user)
                allowed = set(scope_to_id_filter(a_scope, ctx) or [])
                if assignee_id not in allowed:
                    raise HTTPException(403, "Assignee is outside your assign scope")

    # Pre-compute scope filter for Admin so we only touch tickets they can assign.
    admin_assign_allowed: Optional[set] = None
    if role == "Admin":
        a_scope = await get_effective_scope(user, "profix", "ticket", "assign")
        if a_scope not in ("all", True):
            ctx = await get_user_scope_context(user)
            admin_assign_allowed = set(scope_to_id_filter(a_scope, ctx) or [])

    success = 0
    for tid in body.ticket_ids:
        t = await db.tickets.find_one({"id": tid})
        if not t:
            continue
        if role == "DQ Team" and t.get("assigned_to_id"):
            continue
        if admin_assign_allowed is not None and not (
            t.get("created_by_id") in admin_assign_allowed
            or t.get("assigned_to_id") in admin_assign_allowed
        ):
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
    # Admin scope: pre-compute their edit-scoped id whitelist (or unrestricted).
    admin_edit_allowed: Optional[set] = None
    if role == "Admin":
        e_scope = await get_effective_scope(user, "profix", "ticket", "edit")
        if not e_scope:
            raise HTTPException(403, "No edit permission")
        if e_scope not in ("all", True):
            ctx = await get_user_scope_context(user)
            admin_edit_allowed = set(scope_to_id_filter(e_scope, ctx) or [])
    success = 0
    for tid in body.ticket_ids:
        t = await db.tickets.find_one({"id": tid})
        if not t:
            continue
        if role == "DQ Team" and t.get("assigned_to_id") != user["id"]:
            continue
        if admin_edit_allowed is not None and not (
            t.get("created_by_id") in admin_edit_allowed
            or t.get("assigned_to_id") in admin_edit_allowed
        ):
            continue
        if t.get("status") == body.status:
            continue
        await db.tickets.update_one({"id": tid}, {"$set": {"status": body.status, "updated_on": now_iso()}})
        await db.activity.insert_one({
            "id": str(uuid.uuid4()), "ticket_id": tid, "action": "updated",
            "by_id": user["id"], "by_name": user["name"], "at": now_iso(),
            "detail": f"Status changed from {t.get('status')} to {body.status}"
        })
        # Notify creator on Closed transition (same template as single-update path).
        if body.status == "Closed" and t.get("status") != "Closed":
            try:
                creator = await db.contacts.find_one({"id": t.get("created_by_id")}) if t.get("created_by_id") else None
                to_email = (creator or {}).get("email")
                to_name = (creator or {}).get("name") or t.get("created_by_name") or "there"
                if to_email:
                    await send_email(
                        db,
                        to_email=to_email,
                        to_name=to_name,
                        kind="request_closed",
                        subject="Request Closed",
                        body="<p>Your request has been closed.</p>",
                        related_id=tid,
                        metadata={
                            "ticket_id": t.get("ticket_id") or tid,
                            "subject": t.get("subject") or "",
                            "closed_by": user.get("name") or "",
                            "closed_at": now_iso(),
                        },
                    )
            except Exception as e:  # noqa: BLE001
                import logging as _l
                _l.getLogger(__name__).warning(f"request_closed email failed for ticket={tid}: {e}")
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
