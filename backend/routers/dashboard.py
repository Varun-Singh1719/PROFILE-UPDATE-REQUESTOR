"""Dashboard endpoints: stats, dq-performance, recent."""
from typing import Optional

from fastapi import Depends

from core import api_router, db, get_current_user, require_role
from routers.tickets import _date_match


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
    elif role in ("Super Admin", "Admin") and member_id:
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
    user=Depends(require_role("Super Admin", "Admin")),
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
