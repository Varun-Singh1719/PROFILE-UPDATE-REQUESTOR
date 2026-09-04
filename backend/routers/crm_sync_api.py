"""Manual CRM sync endpoints (buttons on list + detail pages)."""
import re
import asyncio
import logging

from fastapi import Depends, HTTPException, Query

from core import api_router, db, get_current_user, now_iso
from mysql_db import mysql_query_one
import crm_sync

logger = logging.getLogger("crm_sync_api")

CLIENTS = "clients"
CONTACTS = "client_contacts"


def _serialize(doc):
    return {k: v for k, v in doc.items() if k != "_id"} if doc else doc


@api_router.post("/crm-sync/run")
async def crm_sync_run(scope: str = Query("all", regex="^(all|clients|contacts|client-contacts)$"),
                       user=Depends(get_current_user)):
    """Kick off a full (idempotent) MySQL → MongoDB sync + metric refresh in the
    background and return immediately (a full run takes a few minutes)."""
    asyncio.create_task(crm_sync.run_full_sync(scope))
    return {"status": "started", "scope": scope,
            "message": "Sync started in the background. Records and metrics will refresh in a few minutes."}


@api_router.post("/clients/{client_id}/sync")
async def sync_one_client(client_id: str, user=Depends(get_current_user)):
    doc = await db[CLIENTS].find_one({"id": client_id})
    if not doc:
        raise HTTPException(404, "Client not found")
    mid = (doc.get("mysql_ref") or {}).get("mysql_id")
    if mid is None:
        # try to link by name now (counterpart may have appeared)
        name = (doc.get("name") or "").strip()
        m = await mysql_query_one(
            "SELECT id FROM clients WHERE LOWER(TRIM(name)) = %s LIMIT 1", [name.lower()]
        )
        if m:
            mid = m["id"]
    update = {"updated_on": now_iso()}
    if mid is not None:
        metrics = await crm_sync.client_metrics_for(mid)
        update.update(metrics)
        update["mysql_ref"] = {"mysql_id": mid, "matched_by": "name", "linked_at": now_iso()}
    else:
        update["totals_till_date"] = {"projects": 0, "serviced": 0, "calls": 0, "revenue": 0}
    await db[CLIENTS].update_one({"id": client_id}, {"$set": update})
    return _serialize(await db[CLIENTS].find_one({"id": client_id}))


@api_router.post("/client-contacts/{contact_id}/sync")
async def sync_one_contact(contact_id: str, user=Depends(get_current_user)):
    doc = await db[CONTACTS].find_one({"id": contact_id})
    if not doc:
        raise HTTPException(404, "Client contact not found")
    mid = (doc.get("mysql_ref") or {}).get("mysql_id")
    if mid is None:
        email = (doc.get("email") or "").strip()
        if email:
            m = await mysql_query_one(
                "SELECT id FROM client_contacts WHERE LOWER(TRIM(email)) = %s LIMIT 1",
                [email.lower()],
            )
            if m:
                mid = m["id"]
    update = {"updated_on": now_iso()}
    if mid is not None:
        metrics = await crm_sync.contact_metrics_for(mid)
        update.update(metrics)
        update["mysql_ref"] = {"mysql_id": mid, "matched_by": "email", "linked_at": now_iso()}
    else:
        update["totals_till_date"] = {"projects": 0, "serviced": 0, "calls": 0, "revenue": 0}
    await db[CONTACTS].update_one({"id": contact_id}, {"$set": update})
    return _serialize(await db[CONTACTS].find_one({"id": contact_id}))
