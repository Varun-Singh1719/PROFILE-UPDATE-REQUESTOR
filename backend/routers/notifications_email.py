"""Notifications outbox + Email Templates."""
import uuid
from typing import Optional

from fastapi import Depends, HTTPException

from core import (
    api_router, db, log_audit, now_iso, require_role,
    EmailTemplateIn, EmailTemplateUpdate,
)


def _csv_list(v):
    """Parse a comma-separated string into a de-duplicated non-empty list."""
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


# ---------- Notifications Outbox ----------
@api_router.get("/notifications/outbox")
async def list_notifications(
    user=Depends(require_role("Super Admin")),
    kind: Optional[str] = None,
    status: Optional[str] = None,
    q: Optional[str] = None,
    q_name: Optional[str] = None,
    q_email: Optional[str] = None,
    page: Optional[int] = None,
    page_size: int = 50,
    limit: int = 200,
):
    query = {}
    kind_list = _csv_list(kind)
    if kind_list:
        query["kind"] = {"$in": kind_list} if len(kind_list) > 1 else kind_list[0]
    status_list = _csv_list(status)
    if status_list:
        query["status"] = {"$in": status_list} if len(status_list) > 1 else status_list[0]
    # Field-scoped searches: name or email or the legacy combined `q`.
    ands = []
    if q_name:
        ands.append({"to_name": {"$regex": q_name.strip(), "$options": "i"}})
    if q_email:
        ands.append({"to_email": {"$regex": q_email.strip(), "$options": "i"}})
    if q:
        ands.append({"$or": [
            {"to_email": {"$regex": q, "$options": "i"}},
            {"to_name": {"$regex": q, "$options": "i"}},
            {"subject": {"$regex": q, "$options": "i"}},
        ]})
    if ands:
        query["$and"] = ands
    # Paginated shape when `page` is provided; array for backward compat otherwise.
    if page is not None:
        p = max(1, int(page or 1))
        ps = max(1, min(int(page_size or 50), 500))
        total = await db.notifications_outbox.count_documents(query)
        items = (
            await db.notifications_outbox
            .find(query, {"_id": 0})
            .sort("created_at", -1)
            .skip((p - 1) * ps).limit(ps)
            .to_list(ps)
        )
        return {"items": items, "total": total, "page": p, "page_size": ps}
    items = await db.notifications_outbox.find(query, {"_id": 0}).sort("created_at", -1).to_list(min(limit, 1000))
    return items


@api_router.get("/notifications/outbox/{notif_id}")
async def get_notification(notif_id: str, user=Depends(require_role("Super Admin"))):
    n = await db.notifications_outbox.find_one({"id": notif_id}, {"_id": 0})
    if not n:
        raise HTTPException(404, "Not found")
    return n


@api_router.delete("/notifications/outbox/{notif_id}")
async def delete_notification(notif_id: str, user=Depends(require_role("Super Admin"))):
    await db.notifications_outbox.delete_one({"id": notif_id})
    return {"ok": True}


@api_router.post("/notifications/outbox/{notif_id}/retry")
async def retry_notification(notif_id: str, user=Depends(require_role("Super Admin"))):
    """Re-attempt delivery for a failed outbox row.

    Behaviour:
      • Only rows currently in `status="error"` can be retried.
      • When EMAIL_PROVIDER=resend, fires a fresh Resend HTTP call and
        updates the row in-place to `sent`/`error` based on the result.
      • In the default `outbox` provider (no real send), the row is simply
        flipped back to `queued` so it's ready for the next real dispatch.
    """
    import os
    from notifications import _send_via_resend  # local import to avoid cycles

    n = await db.notifications_outbox.find_one({"id": notif_id})
    if not n:
        raise HTTPException(404, "Not found")
    if n.get("status") != "error":
        raise HTTPException(400, "Only failed items can be retried")

    provider = (os.environ.get("EMAIL_PROVIDER") or "outbox").lower()
    if provider == "resend":
        ok, err = _send_via_resend(n["to_email"], n["subject"], n["body"])
        upd = {
            "status": "sent" if ok else "error",
            "error": err,
            "sent_at": now_iso() if ok else None,
            "retried_at": now_iso(),
        }
    else:
        upd = {"status": "queued", "error": None, "retried_at": now_iso()}

    await db.notifications_outbox.update_one({"id": notif_id}, {"$set": upd})
    await log_audit(actor=user, action="notification.retry", resource="notification",
                    resource_id=notif_id, detail=f"Retried notification to {n.get('to_email')}",
                    severity="info")
    out = await db.notifications_outbox.find_one({"id": notif_id}, {"_id": 0})
    return out


# ---------- Email Templates ----------
@api_router.get("/email-templates")
async def list_email_templates(user=Depends(require_role("Super Admin", "Admin")), q: Optional[str] = None, category: Optional[str] = None, status: Optional[str] = None):
    query = {}
    cat_list = _csv_list(category)
    if cat_list:
        query["category"] = {"$in": cat_list} if len(cat_list) > 1 else cat_list[0]
    status_list = _csv_list(status)
    if status_list:
        query["status"] = {"$in": status_list} if len(status_list) > 1 else status_list[0]
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"subject": {"$regex": q, "$options": "i"}},
            {"kind": {"$regex": q, "$options": "i"}},
        ]
    items = await db.email_templates.find(query, {"_id": 0}).sort("updated_at", -1).to_list(500)
    return items


@api_router.post("/email-templates")
async def create_email_template(body: EmailTemplateIn, user=Depends(require_role("Super Admin"))):
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
async def update_email_template(tpl_id: str, body: EmailTemplateUpdate, user=Depends(require_role("Super Admin", "Admin"))):
    tpl = await db.email_templates.find_one({"id": tpl_id})
    if not tpl:
        raise HTTPException(404, "Template not found")
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    # Admin (non-Super) can only toggle status; Super Admin can edit content
    if user["role"] != "Super Admin":
        upd = {k: v for k, v in upd.items() if k == "status"}
        if not upd:
            raise HTTPException(403, "Only Super Admin can edit template content")
    upd["updated_at"] = now_iso()
    upd["updated_by"] = user["id"]
    await db.email_templates.update_one({"id": tpl_id}, {"$set": upd})
    out = await db.email_templates.find_one({"id": tpl_id}, {"_id": 0})
    await log_audit(actor=user, action="email_template.update", resource="email_template",
                    resource_id=tpl_id, detail=f"Updated template '{out['name']}'", severity="info")
    return out


@api_router.post("/email-templates/{tpl_id}/duplicate")
async def duplicate_email_template(tpl_id: str, user=Depends(require_role("Super Admin"))):
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
async def delete_email_template(tpl_id: str, user=Depends(require_role("Super Admin"))):
    tpl = await db.email_templates.find_one({"id": tpl_id})
    if not tpl:
        raise HTTPException(404, "Template not found")
    if tpl.get("system"):
        raise HTTPException(400, "System templates cannot be deleted — set them to Inactive instead")
    await db.email_templates.delete_one({"id": tpl_id})
    await log_audit(actor=user, action="email_template.delete", resource="email_template",
                    resource_id=tpl_id, detail=f"Deleted template '{tpl['name']}'", severity="warning")
    return {"ok": True}
