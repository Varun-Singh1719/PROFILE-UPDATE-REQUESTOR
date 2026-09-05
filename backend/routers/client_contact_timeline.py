"""CRM → Client Contact → Timeline (immutable audit history).

Every change made to a Client Contact *profile* is recorded here as one
document PER FIELD CHANGE. All changes that belong to the same Save share a
`batch_id` + timestamp + user so the UI can group them.

    client_contact_timeline
    -----------------------
    id              uuid
    contact_id      client_contacts.id
    batch_id        uuid — same for every change of one save
    at              ISO-8601 (IST) — time of the change
    user            {id, name, email, emp_id} — who made the change
    event           "created" | "updated"
    field           machine key            (e.g. "designation", "industries")
    field_label     human label            (e.g. "Designation", "Industry")
    action          "added" | "edited" | "deleted"
    previous_value  snapshot string or None
    new_value       snapshot string or None

Values are SNAPSHOTS taken at the moment of the change — they are never
re-derived from the current contact record, so history never drifts.

The collection is strictly READ-ONLY from the API: the only route exposed is
    GET /api/client-contacts/{id}/timeline
There is deliberately no POST / PATCH / DELETE.
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Dict, List, Optional, Tuple

from fastapi import Depends, HTTPException, Query

from core import api_router, db, now_iso, get_current_user

TL_COLL = "client_contact_timeline"

# Human labels for the editable profile fields (order = display order).
FIELD_LABELS: Dict[str, str] = {
    "name": "Name",
    "email": "Email",
    "phone": "Phone Number",
    "client_name": "Client",
    "designation": "Designation",
    "type": "Type",
    "city": "City",
    "country_name": "Country",
    "linkedin_url": "Web Handle",
    "industries": "Industry",
    "previous_work_experience": "Employment History",
    "note": "Note",
}

# Fields that are NOT profile edits (system / derived / sync metrics) and must
# never appear on the Timeline.
IGNORED_FIELDS = {
    "id", "_id", "display_id",
    "created_by", "created_on", "updated_by", "updated_on",
    "phone_isd",          # folded into "Phone Number"
    "base_location",      # derived from City + Country
    "country_id",         # internal id behind "Country"
    "totals_till_date", "activity_by_month",
    "last_project_receiving_date", "last_call_date",
    "poc_status_key", "poc_status_computed_at", "poc_status",
    "mysql_ref",
}

WE_KEYS = ("company_name", "designation", "start_month_year", "end_month_year", "city", "country_name")


# ---------------------------------------------------------------- value helpers
def _s(v: Any) -> str:
    """Normalise a scalar to a trimmed string ('' for None)."""
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False, sort_keys=True)
    return str(v).strip()


def _phone_display(doc: dict) -> str:
    isd = _s(doc.get("phone_isd"))
    num = _s(doc.get("phone"))
    if not num:
        return ""
    return f"{isd} {num}".strip()


def _we_norm(w: Any) -> Dict[str, str]:
    w = w or {}
    if not isinstance(w, dict):
        w = dict(w)
    return {k: _s(w.get(k)) for k in WE_KEYS}


def _we_display(w: Dict[str, str]) -> str:
    company = w.get("company_name") or "—"
    desig = w.get("designation") or "—"
    start = w.get("start_month_year") or "—"
    end = w.get("end_month_year") or "Present"
    out = f"{company} · {desig} · {start} – {end}"
    loc = ", ".join(x for x in (w.get("city"), w.get("country_name")) if x)
    return f"{out} · {loc}" if loc else out


def _we_is_blank(w: Dict[str, str]) -> bool:
    return not any(w.values())


def _label(field: str) -> str:
    return FIELD_LABELS.get(field) or field.replace("_", " ").strip().title()


def _scalar_change(field: str, old: str, new: str) -> Optional[dict]:
    if old == new:
        return None
    if not old and new:
        return {"field": field, "action": "added", "previous_value": None, "new_value": new}
    if old and not new:
        return {"field": field, "action": "deleted", "previous_value": old, "new_value": None}
    return {"field": field, "action": "edited", "previous_value": old, "new_value": new}


# ---------------------------------------------------------------- diff engine
def diff_contact(old: Optional[dict], new: dict) -> List[dict]:
    """Return the list of field-level changes between `old` (stored doc, or None
    for a brand-new contact) and `new` (the doc AFTER the save). Each entry:
        {field, action, previous_value, new_value}
    """
    old = old or {}
    changes: List[dict] = []

    # 1) Phone (ISD + number folded into one human field)
    ch = _scalar_change("phone", _phone_display(old), _phone_display(new))
    if ch:
        changes.append(ch)

    # 2) Plain scalar profile fields
    for f in ("name", "email", "client_name", "designation", "type", "city", "country_name", "linkedin_url"):
        ch = _scalar_change(f, _s(old.get(f)), _s(new.get(f)))
        if ch:
            changes.append(ch)

    # 3) Industry — multi-select: one entry per added / removed item
    old_ind = [_s(x) for x in (old.get("industries") or []) if _s(x)]
    new_ind = [_s(x) for x in (new.get("industries") or []) if _s(x)]
    for item in new_ind:
        if item not in old_ind:
            changes.append({"field": "industries", "action": "added", "previous_value": None, "new_value": item})
    for item in old_ind:
        if item not in new_ind:
            changes.append({"field": "industries", "action": "deleted", "previous_value": item, "new_value": None})

    # 4) Employment History — list of rows: added / edited / deleted per row
    changes.extend(_diff_work_experience(
        [_we_norm(w) for w in (old.get("previous_work_experience") or [])],
        [_we_norm(w) for w in (new.get("previous_work_experience") or [])],
    ))

    # 5) Any other editable key present on either side (generic fallback so
    #    future fields are captured automatically).
    known = set(FIELD_LABELS) | IGNORED_FIELDS | {"phone_isd"}
    for f in sorted((set(old) | set(new)) - known):
        ch = _scalar_change(f, _s(old.get(f)), _s(new.get(f)))
        if ch:
            changes.append(ch)

    return changes


def _diff_work_experience(old_rows: List[Dict[str, str]], new_rows: List[Dict[str, str]]) -> List[dict]:
    """Row-level diff of Employment History.

    Strategy (no stable row ids exist):
      a. rows that are identical on both sides → unchanged
      b. remaining rows paired by company name (case-insensitive) → Edited
      c. remaining rows paired by original list position → Edited
      d. anything left: old → Deleted, new → Added
    Blank rows (all four cells empty) are ignored.
    """
    old_rows = [(i, r) for i, r in enumerate(old_rows) if not _we_is_blank(r)]
    new_rows = [(i, r) for i, r in enumerate(new_rows) if not _we_is_blank(r)]

    # a. exact matches
    remaining_new = list(new_rows)
    unmatched_old: List[Tuple[int, Dict[str, str]]] = []
    for oi, orow in old_rows:
        hit = next((k for k, (_, nrow) in enumerate(remaining_new) if nrow == orow), None)
        if hit is not None:
            remaining_new.pop(hit)
        else:
            unmatched_old.append((oi, orow))
    unmatched_new = remaining_new

    out: List[dict] = []

    def _emit_edit(orow: Dict[str, str], nrow: Dict[str, str]) -> None:
        out.append({
            "field": "previous_work_experience",
            "action": "edited",
            "previous_value": _we_display(orow),
            "new_value": _we_display(nrow),
        })

    # b. pair by company name
    still_old: List[Tuple[int, Dict[str, str]]] = []
    for oi, orow in unmatched_old:
        key = orow["company_name"].lower()
        hit = next((k for k, (_, nrow) in enumerate(unmatched_new) if key and nrow["company_name"].lower() == key), None)
        if hit is not None:
            _, nrow = unmatched_new.pop(hit)
            _emit_edit(orow, nrow)
        else:
            still_old.append((oi, orow))

    # c. pair by position
    still_old2: List[Tuple[int, Dict[str, str]]] = []
    for oi, orow in still_old:
        hit = next((k for k, (ni, _) in enumerate(unmatched_new) if ni == oi), None)
        if hit is not None:
            _, nrow = unmatched_new.pop(hit)
            _emit_edit(orow, nrow)
        else:
            still_old2.append((oi, orow))

    # d. leftovers
    for _, orow in still_old2:
        out.append({"field": "previous_work_experience", "action": "deleted",
                    "previous_value": _we_display(orow), "new_value": None})
    for _, nrow in unmatched_new:
        out.append({"field": "previous_work_experience", "action": "added",
                    "previous_value": None, "new_value": _we_display(nrow)})
    return out


# ---------------------------------------------------------------- recorder
def _actor(user: Optional[dict]) -> dict:
    user = user or {}
    return {
        "id": user.get("id"),
        "name": user.get("name") or user.get("email") or "System",
        "email": user.get("email"),
        "emp_id": user.get("emp_id"),
    }


async def record_contact_changes(
    contact_id: str,
    old: Optional[dict],
    new: dict,
    user: Optional[dict],
    event: str = "updated",
) -> List[dict]:
    """Diff `old` → `new` and persist one immutable timeline entry per change.
    Returns the entries written (empty list when nothing changed)."""
    changes = diff_contact(old, new)
    if not changes:
        return []
    batch_id = str(uuid.uuid4())
    at = now_iso()
    actor = _actor(user)
    docs = []
    for c in changes:
        docs.append({
            "id": str(uuid.uuid4()),
            "contact_id": contact_id,
            "batch_id": batch_id,
            "at": at,
            "user": actor,
            "event": event,
            "field": c["field"],
            "field_label": _label(c["field"]),
            "action": c["action"],
            "previous_value": c["previous_value"],
            "new_value": c["new_value"],
        })
    await db[TL_COLL].insert_many(docs)
    return [{k: v for k, v in d.items() if k != "_id"} for d in docs]


async def record_entries(
    contact_id: str,
    user: Optional[dict],
    changes: List[dict],
    event: str = "updated",
) -> List[dict]:
    """Persist pre-computed changes (e.g. Notes added / edited / deleted) as one
    immutable batch. `changes` items: {field, action, previous_value, new_value}."""
    if not changes:
        return []
    batch_id = str(uuid.uuid4())
    at = now_iso()
    actor = _actor(user)
    docs = [{
        "id": str(uuid.uuid4()),
        "contact_id": contact_id,
        "batch_id": batch_id,
        "at": at,
        "user": actor,
        "event": event,
        "field": c["field"],
        "field_label": _label(c["field"]),
        "action": c["action"],
        "previous_value": c.get("previous_value"),
        "new_value": c.get("new_value"),
    } for c in changes]
    await db[TL_COLL].insert_many(docs)
    return [{k: v for k, v in d.items() if k != "_id"} for d in docs]


# ---------------------------------------------------------------- read-only API
@api_router.get("/client-contacts/{contact_id}/timeline")
async def get_client_contact_timeline(
    contact_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100, description="Number of save-batches per page"),
    user=Depends(get_current_user),
):
    """Read-only, immutable audit history of a Client Contact profile.

    Returns save-batches newest-first; each batch groups every field changed in
    that single Save (same user + timestamp)."""
    if not await db["client_contacts"].find_one({"id": contact_id}, {"_id": 1}):
        raise HTTPException(404, "Client contact not found")

    pipeline = [
        {"$match": {"contact_id": contact_id}},
        {"$sort": {"at": -1}},
        {"$group": {
            "_id": "$batch_id",
            "at": {"$first": "$at"},
            "user": {"$first": "$user"},
            "event": {"$first": "$event"},
            "changes": {"$push": {
                "id": "$id", "field": "$field", "field_label": "$field_label",
                "action": "$action", "previous_value": "$previous_value", "new_value": "$new_value",
            }},
        }},
        {"$sort": {"at": -1, "_id": 1}},
        {"$facet": {
            "rows": [{"$skip": (page - 1) * page_size}, {"$limit": page_size}],
            "meta": [{"$count": "total_batches"}],
        }},
    ]
    res = await db[TL_COLL].aggregate(pipeline).to_list(1)
    res = res[0] if res else {"rows": [], "meta": []}
    total_batches = (res["meta"][0]["total_batches"] if res["meta"] else 0)
    total_changes = await db[TL_COLL].count_documents({"contact_id": contact_id})

    # Keep changes inside a batch in a stable, readable order.
    order = {k: i for i, k in enumerate(FIELD_LABELS)}
    batches = []
    for b in res["rows"]:
        chs = sorted(b["changes"], key=lambda c: (order.get(c["field"], 99), c["field_label"], c["action"]))
        batches.append({
            "batch_id": b["_id"],
            "at": b["at"],
            "user": b["user"],
            "event": b.get("event") or "updated",
            "changes": chs,
        })
    return {
        "batches": batches,
        "total_batches": total_batches,
        "total_changes": total_changes,
        "page": page,
        "page_size": page_size,
        "read_only": True,
    }
