"""CRM MongoDB master ↔ MySQL activity synchronisation.

Design:
  • MongoDB = master for Client & Client Contact CRM records (create/edit/etc).
  • MySQL   = source of truth for activity metrics (Projects / Serviced / Calls
              / Revenue) and for auto-importing records that only exist in MySQL.

Each Mongo doc carries a dedicated reference field:
    mysql_ref = { "mysql_id": <int>, "matched_by": "email"|"name"|"import",
                  "linked_at": iso }

Matching keys:
    • Client Contact → normalized email (trim + lowercase, case-insensitive)
    • Client         → name (case-insensitive), the app's existing identity rule

All operations are idempotent — re-running never creates duplicates.
MySQL is only ever READ from here.
"""
import re
import uuid
import logging
from collections import defaultdict

from core import db, now_iso
from mysql_db import mysql_query

logger = logging.getLogger("crm_sync")

CLIENTS = "clients"
CONTACTS = "client_contacts"

CLIENT_TYPES = {
    "Venture Capital/Private Equity",
    "Hedge funds/Public Markets",
    "Research and Consulting",
    "Corporations and Companies",
}


# ----------------------------------------------------------------- helpers
def _norm_email(v):
    return (v or "").strip().lower()


def _esc(s):
    return re.escape(s or "")


async def _alloc_display_ids(counter_key, base_default, n):
    """Reserve `n` sequential display ids from the shared counters collection."""
    if n <= 0:
        return []
    await db["counters"].update_one(
        {"_id": counter_key},
        {"$inc": {"seq": n}, "$setOnInsert": {"seq_base": base_default}},
        upsert=True,
    )
    doc = await db["counters"].find_one({"_id": counter_key})
    base = int((doc or {}).get("seq_base") or base_default)
    seq = int((doc or {}).get("seq") or n)
    start = base + seq - n + 1
    return list(range(start, start + n))


def _digits(tok):
    tok = str(tok or "").strip()
    return int(tok) if tok.isdigit() else None


# ----------------------------------------------------------------- metrics (batch)
async def compute_all_metrics():
    """Load projects + calls once and compute per-contact and per-client metrics.

    Returns (contact_metrics, client_metrics) keyed by MySQL id.
    Metric shape: {projects, serviced, calls, revenue,
                   last_project_receiving_date, last_call_date}
    """
    projects = await mysql_query(
        "SELECT id, client_contacts, client_id, receiving_date FROM projects"
    )
    calls = await mysql_query(
        "SELECT client_contact, fk_project, call_start_time, revenue_in_usd FROM calls"
    )

    proj_client = {}
    proj_recv = {}
    proj_contacts = defaultdict(set)          # contact_id -> {project_id}
    client_projects = defaultdict(set)        # client_id  -> {project_id}
    for p in projects:
        pid = p["id"]
        proj_client[pid] = p.get("client_id")
        proj_recv[pid] = p.get("receiving_date")
        if p.get("client_id") is not None:
            client_projects[p["client_id"]].add(pid)
        for tok in str(p.get("client_contacts") or "").split(","):
            cid = _digits(tok)
            if cid is not None:
                proj_contacts[cid].add(pid)

    proj_has_rev = set()
    contact_calls = defaultdict(lambda: {"count": 0, "rev": 0.0, "last": None})
    client_calls = defaultdict(lambda: {"count": 0, "rev": 0.0, "last": None})
    for c in calls:
        pid = c.get("fk_project")
        rev = float(c.get("revenue_in_usd") or 0)
        st = c.get("call_start_time")
        if rev > 0:
            proj_has_rev.add(pid)
        cid = _digits(c.get("client_contact"))
        if cid is not None:
            m = contact_calls[cid]
            m["count"] += 1
            m["rev"] += rev
            if st and (m["last"] is None or st > m["last"]):
                m["last"] = st
        clid = proj_client.get(pid)
        if clid is not None:
            cm = client_calls[clid]
            cm["count"] += 1
            cm["rev"] += rev
            if st and (cm["last"] is None or st > cm["last"]):
                cm["last"] = st

    contact_metrics = {}
    for cid in set(proj_contacts) | set(contact_calls):
        pset = proj_contacts.get(cid, set())
        cc = contact_calls.get(cid, {"count": 0, "rev": 0.0, "last": None})
        recv = [proj_recv[p] for p in pset if proj_recv.get(p)]
        contact_metrics[cid] = {
            "totals_till_date": {
                "projects": len(pset),
                "serviced": len(pset & proj_has_rev),
                "calls": cc["count"],
                "revenue": int(round(cc["rev"])),
            },
            "last_project_receiving_date": max(recv) if recv else None,
            "last_call_date": cc["last"],
        }

    client_metrics = {}
    for clid in set(client_projects) | set(client_calls):
        pset = client_projects.get(clid, set())
        cc = client_calls.get(clid, {"count": 0, "rev": 0.0, "last": None})
        recv = [proj_recv[p] for p in pset if proj_recv.get(p)]
        client_metrics[clid] = {
            "totals_till_date": {
                "projects": len(pset),
                "serviced": len(pset & proj_has_rev),
                "calls": cc["count"],
                "revenue": int(round(cc["rev"])),
            },
            "client_contact_count": None,   # filled from Mongo, not MySQL
            "project_count": len(pset),
            "serviced_count": len(pset & proj_has_rev),
            "last_project_receiving_date": max(recv) if recv else None,
            "last_call_date": cc["last"],
        }

    return contact_metrics, client_metrics


# ----------------------------------------------------------------- single-record metrics
async def contact_metrics_for(mysql_id):
    cid = int(mysql_id)
    projs = await mysql_query(
        "SELECT id, receiving_date FROM projects "
        "WHERE CONCAT(',', IFNULL(client_contacts,''), ',') LIKE %s",
        [f"%,{cid},%"],
    )
    pids = [p["id"] for p in projs]
    recv = [p["receiving_date"] for p in projs if p.get("receiving_date")]
    calls = await mysql_query(
        "SELECT fk_project, call_start_time, revenue_in_usd FROM calls WHERE client_contact = %s",
        [cid],
    )
    rev = sum(float(c.get("revenue_in_usd") or 0) for c in calls)
    last_call = max([c["call_start_time"] for c in calls if c.get("call_start_time")], default=None)
    serviced = 0
    if pids:
        placeholders = ",".join(["%s"] * len(pids))
        rows = await mysql_query(
            f"SELECT DISTINCT fk_project FROM calls WHERE revenue_in_usd > 0 AND fk_project IN ({placeholders})",
            pids,
        )
        serviced = len(rows)
    return {
        "totals_till_date": {
            "projects": len(pids),
            "serviced": serviced,
            "calls": len(calls),
            "revenue": int(round(rev)),
        },
        "last_project_receiving_date": max(recv) if recv else None,
        "last_call_date": last_call,
    }


async def client_metrics_for(mysql_id):
    clid = int(mysql_id)
    projs = await mysql_query(
        "SELECT id, receiving_date FROM projects WHERE client_id = %s", [clid]
    )
    pids = [p["id"] for p in projs]
    recv = [p["receiving_date"] for p in projs if p.get("receiving_date")]
    calls = []
    serviced = 0
    if pids:
        placeholders = ",".join(["%s"] * len(pids))
        calls = await mysql_query(
            f"SELECT fk_project, call_start_time, revenue_in_usd FROM calls WHERE fk_project IN ({placeholders})",
            pids,
        )
        serviced = len({c["fk_project"] for c in calls if float(c.get("revenue_in_usd") or 0) > 0})
    rev = sum(float(c.get("revenue_in_usd") or 0) for c in calls)
    return {
        "totals_till_date": {
            "projects": len(pids),
            "serviced": serviced,
            "calls": len(calls),
            "revenue": int(round(rev)),
        },
        "project_count": len(pids),
        "serviced_count": serviced,
        "last_project_receiving_date": max(recv) if recv else None,
        "last_call_date": max([c["call_start_time"] for c in calls if c.get("call_start_time")], default=None),
    }


# ----------------------------------------------------------------- sync: clients
async def sync_clients(client_metrics=None):
    stats = defaultdict(int)
    if client_metrics is None:
        _, client_metrics = await compute_all_metrics()

    rows = await mysql_query("SELECT id, name, type, created_at, updated_at FROM clients")
    to_create = []
    for r in rows:
        mid = r["id"]
        name = (r.get("name") or "").strip()
        ctype = r.get("type") if r.get("type") in CLIENT_TYPES else (r.get("type") or "")
        metrics = client_metrics.get(mid, {})
        totals = metrics.get("totals_till_date", {})
        set_fields = {
            "mysql_ref": {"mysql_id": mid, "matched_by": "name", "linked_at": now_iso()},
            "totals_till_date": totals,
            "project_count": metrics.get("project_count", 0),
            "serviced_count": metrics.get("serviced_count", 0),
            "last_project_receiving_date": metrics.get("last_project_receiving_date"),
            "last_call_date": metrics.get("last_call_date"),
            "updated_on": now_iso(),
        }
        existing = await db[CLIENTS].find_one(
            {"$or": [{"mysql_ref.mysql_id": mid},
                     {"name": {"$regex": f"^{_esc(name)}$", "$options": "i"}}]},
            {"_id": 1},
        )
        if existing:
            await db[CLIENTS].update_one({"_id": existing["_id"]}, {"$set": set_fields})
            stats["matched_linked"] += 1
        else:
            to_create.append((r, name, ctype, set_fields))

    if to_create:
        ids = await _alloc_display_ids("client_seq", 1000, len(to_create))
        docs = []
        for (r, name, ctype, set_fields), disp in zip(to_create, ids):
            docs.append({
                "id": str(uuid.uuid4()),
                "display_id": disp,
                "name": name,
                "type": ctype,
                "key_account_manager_ids": [],
                "client_contact_count": 0,
                "created_by": {"name": "MySQL Sync"},
                "created_on": r.get("created_at") or now_iso(),
                "updated_by": {"name": "MySQL Sync"},
                **set_fields,
            })
        if docs:
            await db[CLIENTS].insert_many(docs)
            stats["created"] += len(docs)
    logger.info(f"sync_clients: {dict(stats)}")
    return dict(stats)


# ----------------------------------------------------------------- sync: contacts
async def sync_contacts(contact_metrics=None):
    stats = defaultdict(int)
    if contact_metrics is None:
        contact_metrics, _ = await compute_all_metrics()

    # Map MySQL client id -> name so we can set client_name on the contact.
    client_rows = await mysql_query("SELECT id, name FROM clients")
    client_name_by_id = {c["id"]: (c.get("name") or "").strip() for c in client_rows}

    rows = await mysql_query(
        "SELECT id, salutation, name, email, mobile, designation, fkClient FROM client_contacts"
    )
    to_create = []
    for r in rows:
        mid = r["id"]
        email = _norm_email(r.get("email"))
        metrics = contact_metrics.get(mid, {})
        set_fields = {
            "mysql_ref": {"mysql_id": mid, "matched_by": "email", "linked_at": now_iso()},
            "totals_till_date": metrics.get("totals_till_date", {}),
            "last_project_receiving_date": metrics.get("last_project_receiving_date"),
            "last_call_date": metrics.get("last_call_date"),
            "updated_on": now_iso(),
        }
        existing = None
        if email:
            existing = await db[CONTACTS].find_one(
                {"$or": [{"mysql_ref.mysql_id": mid},
                         {"email": {"$regex": f"^{_esc(r.get('email','').strip())}$", "$options": "i"}}]},
                {"_id": 1, "client_name": 1, "designation": 1},
            )
        else:
            existing = await db[CONTACTS].find_one({"mysql_ref.mysql_id": mid}, {"_id": 1})

        if existing:
            await db[CONTACTS].update_one({"_id": existing["_id"]}, {"$set": set_fields})
            stats["matched_linked"] += 1
        else:
            to_create.append((r, email, set_fields))

    if to_create:
        ids = await _alloc_display_ids("client_contact_seq", 1041, len(to_create))
        docs = []
        for (r, email, set_fields), disp in zip(to_create, ids):
            docs.append({
                "id": str(uuid.uuid4()),
                "display_id": disp,
                "name": (r.get("name") or "").strip(),
                "email": (r.get("email") or "").strip(),
                "phone": (r.get("mobile") or "").strip(),
                "phone_isd": "",
                "client_name": client_name_by_id.get(r.get("fkClient"), ""),
                "designation": (r.get("designation") or "").strip(),
                "type": "",
                "base_location": "",
                "city": "",
                "country_id": None,
                "country_name": "",
                "industries": [],
                "previous_work_experience": [],
                "linkedin_url": "",
                "salutation": (r.get("salutation") or "").strip(),
                "created_by": {"name": "MySQL Sync"},
                "created_on": now_iso(),
                "updated_by": {"name": "MySQL Sync"},
                **set_fields,
            })
        if docs:
            await db[CONTACTS].insert_many(docs)
            stats["created"] += len(docs)
    logger.info(f"sync_contacts: {dict(stats)}")
    return dict(stats)


async def refresh_client_contact_counts():
    """Recompute `client_contact_count` on every client from the Mongo
    client_contacts collection (grouped by `client_name`). Covers contacts that
    came from MySQL (fkClient → client name) as well as manually added ones.
    Clients with no contacts are reset to 0."""
    from pymongo import UpdateOne
    counts = {}
    cursor = db[CONTACTS].aggregate([
        {"$match": {"client_name": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$client_name", "n": {"$sum": 1}}},
    ])
    async for g in cursor:
        counts[g["_id"]] = g["n"]
    await db[CLIENTS].update_many(
        {"name": {"$nin": list(counts.keys())}}, {"$set": {"client_contact_count": 0}}
    )
    ops = [
        UpdateOne({"name": name}, {"$set": {"client_contact_count": n}})
        for name, n in counts.items()
    ]
    if ops:
        await db[CLIENTS].bulk_write(ops, ordered=False)
    logger.info(f"refresh_client_contact_counts: {len(counts)} clients with contacts")
    return len(counts)


async def run_full_sync(scope="all"):
    result = {}
    try:
        contact_metrics, client_metrics = await compute_all_metrics()
        if scope in ("all", "clients"):
            result["clients"] = await sync_clients(client_metrics)
        if scope in ("all", "contacts", "client-contacts"):
            result["contacts"] = await sync_contacts(contact_metrics)
        # Contacts-per-client numbers shown on the Client cards / detail.
        result["client_contact_counts"] = await refresh_client_contact_counts()
        result["ok"] = True
    except Exception as e:  # noqa: BLE001
        logger.exception("run_full_sync failed")
        result["ok"] = False
        result["error"] = str(e)
    return result
