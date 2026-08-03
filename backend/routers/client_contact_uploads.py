"""Bulk upload (Excel .xlsx / CSV) for CRM → Client Contacts.

Mirrors `contact_uploads.py` (Employees) closely so the UX / testids /
history behaviour stays consistent across the two modules.

Endpoints:
  GET  /api/client-contacts/sample-template?format=csv|xlsx
       — download a blank template + sample rows + Instructions sheet.
  POST /api/client-contacts/bulk-upload
       — accept .xlsx or .csv, validate every row (name required, email/phone
         must be unique both in-file and against the existing directory,
         client_name must match a real Segmentation, industries are dropped
         with a warning if they aren't L2 children of the resolved client),
         partial-insert every valid row, and return a summary.
  GET  /api/client-contacts/upload-history                     — paginated list of past sessions.
  GET  /api/client-contacts/upload-history/{id}                — one session with embedded errors.
  GET  /api/client-contacts/upload-history/{id}/error-report.xlsx
       — download the per-row error report (Row / Contact Name / Error Reason).

Template columns (Name is the only mandatory field):
  Name, Email, Phone, Client Name, Designation, Base Location, LinkedIn URL, Industries
"""
from __future__ import annotations

import io
import re
import csv
import uuid
import logging
from datetime import datetime, date
from typing import Optional, Dict, Any, List

from fastapi import Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse, Response
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from core import api_router, db, log_audit, now_iso, get_current_user

# NOTE: We intentionally do NOT `from routers.client_contacts import …` here.
# Doing so would force `client_contacts.py` to load first, which registers its
# `/client-contacts/{contact_id}` dynamic route BEFORE the static routes below
# (`/client-contacts/sample-template`, `/client-contacts/bulk-upload`,
# `/client-contacts/upload-history`) — FastAPI would then always match the
# static paths against the `{contact_id}` catch-all and return 404. So we
# inline the tiny helpers we need.
CC_COLL = "client_contacts"
CC_COUNTER_KEY = "client_contact_seq"


def _norm_email(v: Optional[str]) -> str:
    return (v or "").strip().lower()


def _phone_key(v: Optional[str]) -> str:
    """Trailing-10-digit dedup key — see `client_contacts._phone_key`."""
    digits = re.sub(r"\D", "", (v or ""))
    return digits[-10:] if len(digits) >= 10 else digits


async def _next_display_id() -> int:
    await db["counters"].find_one_and_update(
        {"_id": CC_COUNTER_KEY},
        {"$inc": {"seq": 1}, "$setOnInsert": {"seq_base": 1041}},
        upsert=True,
        return_document=True,
    )
    doc = await db["counters"].find_one({"_id": CC_COUNTER_KEY})
    base = int((doc or {}).get("seq_base") or 1041)
    seq = int((doc or {}).get("seq") or 1)
    return base + seq


logger = logging.getLogger(__name__)

TEMPLATE_HEADERS = [
    "Name",
    "Email",
    "ISD",
    "Phone",
    "Client Name",
    "Designation",
    "Base Location",
    "LinkedIn URL",
    "Industries",
]
REQUIRED_HEADERS = {"Name"}

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")

SAMPLE_ROWS = [
    [
        "Priya Sharma",
        "priya.sharma@boston-consulting.com",
        "+91",
        "9876543210",
        "McKinsey",
        "Partner",
        "Mumbai, IN",
        "https://linkedin.com/in/priya-sharma-cxo",
        "Financial Services; Insurance",
    ],
    [
        "Rahul Menon",
        "rahul.menon@acme.com",
        "+91",
        "9812345678",
        "Infollion Research",
        "Vice President — Strategy",
        "Bengaluru, IN",
        "https://linkedin.com/in/rahul-menon",
        "BFSI; Chemicals",
    ],
]


def _cell_text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, date):
        return v.strftime("%Y-%m-%d")
    return str(v).strip()


# ---------- Sample template ----------
@api_router.get("/client-contacts/sample-template")
async def download_cc_sample_template(
    format: str = "xlsx",
    user=Depends(get_current_user),
):
    fmt = (format or "xlsx").lower()
    if fmt not in ("csv", "xlsx"):
        raise HTTPException(400, "format must be 'csv' or 'xlsx'")

    # ---------- CSV branch ----------
    if fmt == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(TEMPLATE_HEADERS)
        for row in SAMPLE_ROWS:
            w.writerow(row)
        w.writerow([])
        w.writerow(["# Instructions:"])
        w.writerow(["# Required: Name."])
        w.writerow(["# Optional: Email, Phone, Client Name (must exist as a Segmentation), Designation, Base Location, LinkedIn URL, Industries (semicolon or comma separated; only L2 children of the client are kept)."])
        w.writerow(["# Duplicates: rows sharing an email or phone with an existing contact are rejected. Fix the source data or bulk-delete duplicates before retrying."])
        return Response(
            content=buf.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="client_contacts_upload_template.csv"'},
        )

    # ---------- XLSX branch ----------
    wb = Workbook()
    ws = wb.active
    ws.title = "Client Contacts"

    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill("solid", fgColor="EC9324")
    thin = Side(border_style="thin", color="D1D5DB")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    left_align = Alignment(horizontal="left", vertical="center", wrap_text=True)

    for col_idx, h in enumerate(TEMPLATE_HEADERS, start=1):
        c = ws.cell(row=1, column=col_idx, value=h)
        c.font = header_font
        c.fill = header_fill
        c.alignment = left_align
        c.border = border
    for row_idx, row in enumerate(SAMPLE_ROWS, start=2):
        for col_idx, val in enumerate(row, start=1):
            ws.cell(row=row_idx, column=col_idx, value=val)

    widths = [22, 32, 8, 16, 22, 26, 20, 40, 34]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"

    # Instructions sheet
    notes = wb.create_sheet("Instructions")
    notes_lines = [
        ("Field", "Required?", "Notes"),
        ("Name", "Yes", "Full name of the client contact."),
        ("Email", "No", "Standard email format. Must be unique across the whole client-contact directory."),
        ("ISD", "No", "Country dial-code — e.g. '+91', '+1'. Defaults to '+91' if left blank."),
        ("Phone", "No", "Digits only (or any format). Must be unique — formatting is ignored, we dedup on the trailing 10 digits."),
        ("Client Name", "No", "Must exactly match an existing Segmentation (Level 1) name — e.g. 'McKinsey', 'Infollion Research'. Rows with an unknown Client Name are rejected."),
        ("Designation", "No", "Free text — e.g. 'Partner', 'Director'."),
        ("Base Location", "No", "Free text — e.g. 'Mumbai, IN'."),
        ("LinkedIn URL", "No", "Full LinkedIn profile URL — e.g. 'https://linkedin.com/in/…'."),
        ("Industries", "No", "Semicolon- or comma-separated list of Level-2 segments belonging to the chosen Client Name. Unknown industries are skipped and reported in the row error."),
        ("", "", ""),
        ("System-generated fields", "", "Do NOT include — handled automatically: ID (numeric), UUID, Created By, Created On, Updated By, Updated On."),
    ]
    for r_idx, row in enumerate(notes_lines, start=1):
        for c_idx, val in enumerate(row, start=1):
            cell = notes.cell(row=r_idx, column=c_idx, value=val)
            if r_idx == 1:
                cell.font = Font(bold=True, color="FFFFFF")
                cell.fill = header_fill
    notes.column_dimensions["A"].width = 22
    notes.column_dimensions["B"].width = 12
    notes.column_dimensions["C"].width = 92

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="client_contacts_upload_template.xlsx"'},
    )


# ---------- Bulk upload ----------
def _row_to_dict(headers: List[str], row: tuple) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for i, h in enumerate(headers):
        v = row[i] if i < len(row) else None
        out[h] = v
    return out


def _read_rows_any(file_bytes: bytes, filename: str) -> tuple[List[str], List[tuple]]:
    fname = (filename or "").lower()
    if fname.endswith(".xlsx"):
        try:
            wb = load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
        except Exception as e:
            raise HTTPException(400, f"Could not read .xlsx file: {e}")
        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)
        try:
            header_row = next(rows_iter)
        except StopIteration:
            raise HTTPException(400, "File is empty")
        headers = [(_cell_text(h)) for h in header_row]
        while headers and not headers[-1]:
            headers.pop()
        rows = [tuple(r) for r in rows_iter]
        return headers, rows

    if fname.endswith(".csv"):
        text = None
        for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
            try:
                text = file_bytes.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        if text is None:
            raise HTTPException(400, "Could not decode CSV file (unknown encoding)")
        reader = csv.reader(io.StringIO(text))
        rows_all = list(reader)
        rows_all = [r for r in rows_all if any((c or "").strip() for c in r)]
        rows_all = [r for r in rows_all if not (r and str(r[0]).strip().startswith("#"))]
        if not rows_all:
            raise HTTPException(400, "File is empty")
        header_row = rows_all[0]
        headers = [(_cell_text(h)) for h in header_row]
        while headers and not headers[-1]:
            headers.pop()
        rows = [tuple(r) for r in rows_all[1:]]
        return headers, rows

    raise HTTPException(400, "Only .xlsx or .csv files are supported")


def _split_industries(raw) -> List[str]:
    if raw is None:
        return []
    s = str(raw).strip()
    if not s:
        return []
    parts = [t.strip() for t in re.split(r"[;,|]", s) if t and t.strip()]
    return parts


@api_router.post("/client-contacts/bulk-upload")
async def bulk_upload_client_contacts(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    if not file.filename or not (
        file.filename.lower().endswith(".xlsx") or file.filename.lower().endswith(".csv")
    ):
        raise HTTPException(400, "Only .xlsx or .csv files are supported")

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")

    headers, data_rows = _read_rows_any(raw, file.filename)
    header_set = set(headers)
    missing = REQUIRED_HEADERS - header_set
    if missing:
        raise HTTPException(400, f"Missing required column(s): {', '.join(sorted(missing))}")

    # Pre-load existing emails + phones (normalized) for uniqueness check.
    existing_emails: set = set()
    existing_phones: set = set()
    async for c in db[CC_COLL].find({}, {"_id": 0, "email": 1, "phone": 1}):
        e = _norm_email(c.get("email"))
        if e:
            existing_emails.add(e)
        p = _phone_key(c.get("phone"))
        if p:
            existing_phones.add(p)

    # Preload segmentations for Client Name + Industries validation.
    seg_by_name: Dict[str, dict] = {}
    async for s in db.segmentations.find({}, {"_id": 0, "name": 1, "tree": 1}):
        nm = (s.get("name") or "").strip()
        if nm:
            seg_by_name[nm.lower()] = s

    seen_emails: set = set()
    seen_phones: set = set()

    success_records: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    total = 0

    for row_offset, row in enumerate(data_rows, start=2):  # row 1 = header
        excel_row_num = row_offset
        if not row or all((v is None or _cell_text(v) == "") for v in row):
            continue
        total += 1
        d = _row_to_dict(headers, row)

        name = _cell_text(d.get("Name"))
        email = _cell_text(d.get("Email"))
        phone_isd = _cell_text(d.get("ISD"))
        phone = _cell_text(d.get("Phone"))
        client_name = _cell_text(d.get("Client Name"))
        designation = _cell_text(d.get("Designation"))
        base_location = _cell_text(d.get("Base Location"))
        linkedin_url = _cell_text(d.get("LinkedIn URL"))
        industries_raw = d.get("Industries")

        row_errors: List[str] = []
        row_warnings: List[str] = []

        # Mandatory fields
        if not name:
            row_errors.append("Name is required")

        # Email — validated only when supplied
        e_norm = _norm_email(email)
        if email and not EMAIL_RE.match(email):
            row_errors.append("Email format is invalid")

        # Client Name — if supplied, must exist
        resolved_client: Optional[str] = None
        seg_doc: Optional[dict] = None
        if client_name:
            seg_doc = seg_by_name.get(client_name.strip().lower())
            if not seg_doc:
                row_errors.append(f"Client Name '{client_name}' does not exist in Segmentations")
            else:
                resolved_client = seg_doc.get("name")

        # Industries — keep only those that are direct L2 children of the client's tree.
        industries_final: List[str] = []
        indus_input = _split_industries(industries_raw)
        if indus_input:
            if not seg_doc:
                if client_name:
                    row_warnings.append("Industries ignored (Client Name missing / invalid)")
                else:
                    row_warnings.append("Industries ignored (Client Name is blank)")
            else:
                valid = {
                    (c.get("name") or "").strip().lower(): (c.get("name") or "").strip()
                    for c in (seg_doc.get("tree") or {}).get("children", [])
                }
                unknown_indus: List[str] = []
                for i in indus_input:
                    key = i.strip().lower()
                    if key in valid:
                        val = valid[key]
                        if val not in industries_final:
                            industries_final.append(val)
                    else:
                        unknown_indus.append(i)
                if unknown_indus:
                    row_warnings.append(
                        f"Unknown industries dropped: {', '.join(unknown_indus)}"
                    )

        # Uniqueness — email + phone. In-file first, then system.
        p_norm = _phone_key(phone)
        if e_norm:
            if e_norm in seen_emails:
                row_errors.append("Duplicate Email in upload file")
            elif e_norm in existing_emails:
                row_errors.append("Email already exists in the client-contact directory")
        if p_norm:
            if p_norm in seen_phones:
                row_errors.append("Duplicate Phone in upload file")
            elif p_norm in existing_phones:
                row_errors.append("Phone already exists in the client-contact directory")

        if row_errors:
            errors.append({
                "row": excel_row_num,
                "name": name,
                "reason": "; ".join(row_errors + ([f"(warnings: {'; '.join(row_warnings)})"] if row_warnings else [])),
            })
            continue

        # Reserve in-file uniqueness
        if e_norm:
            seen_emails.add(e_norm)
        if p_norm:
            seen_phones.add(p_norm)

        display_id = await _next_display_id()
        contact_id = str(uuid.uuid4())
        doc = {
            "id": contact_id,
            "display_id": display_id,
            "name": name,
            "email": email or None,
            "phone": phone or None,
            "phone_isd": phone_isd or None,
            "client_name": resolved_client,
            "designation": designation or None,
            "base_location": base_location or None,
            "linkedin_url": linkedin_url or None,
            "industries": industries_final or None,
            "previous_work_experience": None,
            "created_by": {
                "id": user.get("id"),
                "name": user.get("name"),
                "email": user.get("email"),
                "emp_id": user.get("emp_id"),
            },
            "created_on": now_iso(),
            "updated_by": {
                "id": user.get("id"),
                "name": user.get("name"),
                "email": user.get("email"),
                "emp_id": user.get("emp_id"),
            },
            "updated_on": now_iso(),
        }
        try:
            await db[CC_COLL].insert_one(doc)
        except Exception as e:  # noqa: BLE001
            errors.append({
                "row": excel_row_num,
                "name": name,
                "reason": f"DB insert failed: {e}",
            })
            continue

        success_records.append({
            "id": contact_id,
            "display_id": display_id,
            "name": name,
            "email": email or None,
        })
        if e_norm:
            existing_emails.add(e_norm)
        if p_norm:
            existing_phones.add(p_norm)

    success_count = len(success_records)
    failed_count = len(errors)
    if total == 0:
        status = "Empty"
    elif failed_count == 0:
        status = "Completed"
    elif success_count == 0:
        status = "Failed"
    else:
        status = "Partial"

    upload_id = str(uuid.uuid4())
    upload_doc = {
        "id": upload_id,
        "filename": file.filename,
        "uploaded_by": {
            "id": user.get("id"),
            "name": user.get("name"),
            "email": user.get("email"),
        },
        "uploaded_at": now_iso(),
        "total_rows": total,
        "success_count": success_count,
        "failed_count": failed_count,
        "status": status,
        "errors": errors[:5000],
        "truncated_errors": failed_count > 5000,
    }
    await db.client_contact_uploads.insert_one(upload_doc)
    upload_doc.pop("_id", None)

    await log_audit(
        actor=user,
        action="client_contact.bulk_upload",
        resource="client_contact_upload",
        resource_id=upload_id,
        detail=f"Bulk uploaded client contacts: total={total} success={success_count} failed={failed_count} status={status} file={file.filename}",
        metadata={"total": total, "success": success_count, "failed": failed_count, "status": status},
        severity="info",
    )

    return {
        "upload_id": upload_id,
        "filename": file.filename,
        "total": total,
        "success": success_count,
        "failed": failed_count,
        "status": status,
        "errors": errors[:50],
        "has_more_errors": failed_count > 50,
    }


# ---------- Upload history ----------
@api_router.get("/client-contacts/upload-history")
async def list_cc_upload_history(
    page: int = 1,
    page_size: int = 25,
    user=Depends(get_current_user),
):
    page = max(1, page)
    page_size = max(1, min(page_size, 200))
    total = await db.client_contact_uploads.count_documents({})
    cursor = (
        db.client_contact_uploads
        .find({}, {"_id": 0, "errors": 0})
        .sort("uploaded_at", -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    items = await cursor.to_list(page_size)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@api_router.get("/client-contacts/upload-history/{upload_id}")
async def get_cc_upload_session(upload_id: str, user=Depends(get_current_user)):
    doc = await db.client_contact_uploads.find_one({"id": upload_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Upload not found")
    return doc


@api_router.get("/client-contacts/upload-history/{upload_id}/error-report.xlsx")
async def download_cc_error_report(upload_id: str, user=Depends(get_current_user)):
    doc = await db.client_contact_uploads.find_one({"id": upload_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Upload not found")
    errors: List[Dict[str, Any]] = doc.get("errors") or []

    wb = Workbook()
    ws = wb.active
    ws.title = "Errors"
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="DC2626")
    headers = ["Row Number", "Contact Name", "Error Reason"]
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=1, column=i, value=h)
        c.font = header_font
        c.fill = header_fill
    for r_idx, e in enumerate(errors, start=2):
        ws.cell(row=r_idx, column=1, value=e.get("row"))
        ws.cell(row=r_idx, column=2, value=e.get("name") or "")
        ws.cell(row=r_idx, column=3, value=e.get("reason") or "")
    widths = [12, 28, 92]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"

    meta = wb.create_sheet("Upload Info")
    meta_rows = [
        ("Filename", doc.get("filename")),
        ("Uploaded by", (doc.get("uploaded_by") or {}).get("name")),
        ("Uploaded at", doc.get("uploaded_at")),
        ("Total rows", doc.get("total_rows")),
        ("Success", doc.get("success_count")),
        ("Failed", doc.get("failed_count")),
        ("Status", doc.get("status")),
    ]
    for r_idx, (k, v) in enumerate(meta_rows, start=1):
        meta.cell(row=r_idx, column=1, value=k).font = Font(bold=True)
        meta.cell(row=r_idx, column=2, value=str(v) if v is not None else "")
    meta.column_dimensions["A"].width = 18
    meta.column_dimensions["B"].width = 50

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    safe_fname = (doc.get("filename") or "upload").rsplit(".", 1)[0]
    filename = f"cc_error_report_{safe_fname}_{upload_id[:8]}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
