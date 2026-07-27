"""Bulk upload (Excel .xlsx / CSV) for Employees / Contacts.

Endpoints:
  GET  /api/contacts/sample-template?format=csv|xlsx — download blank template
  POST /api/contacts/bulk-upload                    — accept .xlsx or .csv, validate, partial-insert, return summary
  GET  /api/contacts/upload-history                 — list past upload sessions (paginated)
  GET  /api/contacts/upload-history/{id}            — full upload session (with embedded errors)
  GET  /api/contacts/upload-history/{id}/error-report.xlsx — download per-row error report

Schema (8 columns; only Phone, Phone ISD and Permission Sets are optional):
  Name, Email, Phone ISD, Phone, DOJ (MM-DD-YYYY), Employee ID, Role, Permission Sets
"""
from __future__ import annotations

import io
import os
import re
import csv
import uuid
import logging
from datetime import datetime, timezone, date
from typing import Optional, Dict, Any, List

from fastapi import Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse, Response
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from core import (
    api_router, db, log_audit, now_iso, require_role,
    hash_password, encrypt_password, generate_password,
)
from notifications import send_email, render_new_employee_email

logger = logging.getLogger(__name__)

# Canonical template column order — matches the Add Employee form.
# Only Phone, Phone ISD and Permission Sets are optional.
TEMPLATE_HEADERS = [
    "Name",
    "Email",
    "Phone ISD",
    "Phone",
    "DOJ",
    "Employee ID",
    "Role",
    "Permission Sets",
]
REQUIRED_HEADERS = {"Name", "Email", "DOJ", "Employee ID", "Role"}
VALID_ROLES = {"Super Admin", "Admin"}

# Simple email validator — RFC-compliant enough for HR data.
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")

SAMPLE_ROWS = [
    ["John Smith",    "john.smith@company.com",    "+91", "9876543210", "01-15-2026", "EMP001", "Admin",       "Request Manager"],
    ["Sarah Johnson", "sarah.johnson@company.com", "+1",  "5551234567", "02-01-2026", "EMP002", "Super Admin", "Request Manager, Team Manager"],
]


def _normalize_doj_mmddyyyy(raw) -> Optional[str]:
    """Parse the DOJ cell. Accepts MM-DD-YYYY string, Excel date cell, or
    common variants. Returns ISO YYYY-MM-DD (the canonical form used in DB)
    or None on failure.
    """
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        return raw.date().isoformat()
    if isinstance(raw, date):
        return raw.isoformat()
    s = str(raw).strip()
    # Primary expected format: MM-DD-YYYY
    for fmt in ("%m-%d-%Y", "%m/%d/%Y", "%Y-%m-%d", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _cell_text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%m-%d-%Y")
    if isinstance(v, date):
        return v.strftime("%m-%d-%Y")
    return str(v).strip()


# ---------- Sample template ----------

def _normalize_isd(raw) -> str:
    """Coerce '+91', '91', or '+91  ' → '+91'. Blank → ''."""
    s = str(raw or "").strip()
    if not s:
        return ""
    if not s.startswith("+"):
        s = "+" + s.lstrip("+")
    # Strip any non-digit after the leading +
    return "+" + re.sub(r"\D", "", s)


async def _resolve_permission_sets(raw) -> tuple[List[str], List[str]]:
    """Parse a Permission Sets cell → (resolved_ids, unknown_tokens).

    Accepts a comma / semicolon / pipe delimited list of either:
      • permission set names (e.g. "Request Manager")
      • numeric ids (e.g. "8" or "#8")
      • internal uuid ids (e.g. "pset-abc123…")
    """
    if raw is None:
        return [], []
    s = str(raw).strip()
    if not s:
        return [], []
    tokens = [t.strip() for t in re.split(r"[,;|]", s) if t and t.strip()]
    if not tokens:
        return [], []

    # Load all sets once — small collection.
    sets = await db.permission_sets.find(
        {}, {"_id": 0, "id": 1, "name": 1, "title": 1, "numeric_id": 1, "seq_no": 1},
    ).to_list(500)
    by_id = {p["id"]: p for p in sets}
    by_name = {(p.get("name") or p.get("title") or "").lower(): p for p in sets if (p.get("name") or p.get("title"))}
    by_numeric = {}
    for p in sets:
        n = p.get("numeric_id") or p.get("seq_no")
        if n is not None:
            by_numeric[str(n)] = p

    resolved: List[str] = []
    unknown: List[str] = []
    for t in tokens:
        # Try uuid-style id first
        if t in by_id:
            pid = by_id[t]["id"]
        else:
            # numeric with or without leading #
            num = t.lstrip("#").strip()
            hit = by_numeric.get(num) if num.isdigit() else None
            if not hit:
                hit = by_name.get(t.lower())
            pid = hit["id"] if hit else None
        if pid:
            if pid not in resolved:
                resolved.append(pid)
        else:
            unknown.append(t)
    return resolved, unknown


@api_router.get("/contacts/sample-template")
async def download_sample_template(format: str = "xlsx", user=Depends(require_role("Super Admin"))):
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
        # Trailing instructions row (commented out via a first column marker)
        w.writerow([])
        w.writerow(["# Instructions:"])
        w.writerow(["# Required: Name, Email, DOJ (MM-DD-YYYY), Employee ID, Role (Super Admin | Admin)."])
        w.writerow(["# Optional: Phone ISD (e.g. +91), Phone, Permission Sets (comma-separated names or #ids, e.g. \"Request Manager, #8\")."])
        filename = "employees_upload_template.csv"
        return Response(
            content=buf.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # ---------- XLSX branch ----------
    wb = Workbook()
    ws = wb.active
    ws.title = "Employees"

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

    # Widths — one per header, tuned so the file opens without truncation.
    widths = [22, 32, 10, 14, 14, 14, 12, 28]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"

    # Instructions sheet — explains required vs optional + role / doj / permission set formats.
    notes = wb.create_sheet("Instructions")
    notes_lines = [
        ("Field", "Required?", "Notes"),
        ("Name", "Yes", "Full name of the employee."),
        ("Email", "Yes", "Unique. Will be the login email. Standard email format."),
        ("Phone ISD", "No", "Country code with the leading +, e.g. +91 for India, +1 for US. May be left blank."),
        ("Phone", "No", "Local mobile number — digits only."),
        ("DOJ", "Yes", "Date of Joining. Format: MM-DD-YYYY (e.g. 01-15-2026). Excel date cells are also accepted."),
        ("Employee ID", "Yes", "Unique. Internal HR / payroll code (e.g. EMP001)."),
        ("Role", "Yes", "One of: Super Admin, Admin."),
        ("Permission Sets", "No", "Comma-, semicolon- or pipe-separated list. Each item can be a permission-set NAME (e.g. \"Request Manager\") or a numeric id with or without # (e.g. \"8\" or \"#8\"). Unknown names are reported per-row so the rest of the upload still goes through."),
        ("", "", ""),
        ("System-generated fields", "", "Do NOT include — handled automatically: Internal Record ID, Created Date, Created By, Last Updated Date, Password."),
    ]
    for r_idx, row in enumerate(notes_lines, start=1):
        for c_idx, val in enumerate(row, start=1):
            cell = notes.cell(row=r_idx, column=c_idx, value=val)
            if r_idx == 1:
                cell.font = Font(bold=True, color="FFFFFF")
                cell.fill = header_fill
    notes.column_dimensions["A"].width = 22
    notes.column_dimensions["B"].width = 12
    notes.column_dimensions["C"].width = 80

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = "employees_upload_template.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------- Bulk upload ----------

def _row_to_dict(headers: List[str], row: tuple) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for i, h in enumerate(headers):
        v = row[i] if i < len(row) else None
        out[h] = v
    return out


def _read_rows_any(file_bytes: bytes, filename: str) -> tuple[List[str], List[tuple]]:
    """Return (headers, list_of_rows) from either a .xlsx or .csv payload.

    Rows are returned as tuples so the downstream `_row_to_dict` helper works
    unchanged for both formats.
    """
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
        # Decode with a tolerant encoding chain — HR files often come from
        # Excel export which can be utf-8-sig or cp1252.
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
        # Skip blank leading rows
        rows_all = [r for r in rows_all if any((c or "").strip() for c in r)]
        # Skip comment-only rows (first cell begins with '#') — the CSV
        # template embeds trailing instruction lines starting with '#'.
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


@api_router.post("/contacts/bulk-upload")
async def bulk_upload_contacts(
    file: UploadFile = File(...),
    user=Depends(require_role("Super Admin")),
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

    # Pre-load existing emails + emp_ids for uniqueness check.
    existing_emails: set = set()
    existing_emp_ids: set = set()
    async for c in db.contacts.find({}, {"_id": 0, "email": 1, "emp_id": 1}):
        if c.get("email"):
            existing_emails.add(c["email"].lower())
        if c.get("emp_id"):
            existing_emp_ids.add(c["emp_id"].strip())

    seen_emails: set = set()
    seen_emp_ids: set = set()

    success_records: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    total = 0

    for row_offset, row in enumerate(data_rows, start=2):  # row 1 = header
        excel_row_num = row_offset
        # Skip fully empty rows
        if not row or all((v is None or _cell_text(v) == "") for v in row):
            continue
        total += 1
        d = _row_to_dict(headers, row)

        name = _cell_text(d.get("Name"))
        email = _cell_text(d.get("Email")).lower()
        phone_isd = _normalize_isd(d.get("Phone ISD"))
        phone = _cell_text(d.get("Phone"))
        doj_raw = d.get("DOJ")
        emp_id = _cell_text(d.get("Employee ID"))
        role = _cell_text(d.get("Role"))
        psets_raw = d.get("Permission Sets")

        row_errors: List[str] = []
        # Mandatory field validation
        if not name:
            row_errors.append("Name is required")
        if not email:
            row_errors.append("Email is required")
        elif not EMAIL_RE.match(email):
            row_errors.append("Email format is invalid")
        if not emp_id:
            row_errors.append("Employee ID is required")
        if not role:
            row_errors.append("Role is required")
        elif role not in VALID_ROLES:
            row_errors.append(f"Role must be one of: {', '.join(sorted(VALID_ROLES))}")
        # DOJ
        doj_iso = _normalize_doj_mmddyyyy(doj_raw)
        if doj_raw in (None, ""):
            row_errors.append("DOJ is required")
        elif not doj_iso:
            row_errors.append("DOJ must be in MM-DD-YYYY format")

        # Permission sets — resolve to internal ids, unknown values become
        # per-row errors so users know exactly which names to fix.
        resolved_pset_ids, unknown_psets = await _resolve_permission_sets(psets_raw)
        if unknown_psets:
            row_errors.append(
                f"Unknown Permission Set(s): {', '.join(unknown_psets)}"
            )

        # Uniqueness — check in-file dup BEFORE system-exists so users see the
        # more accurate reason when two rows in the same file collide.
        if email:
            if email in seen_emails:
                row_errors.append("Duplicate Email in upload file")
            elif email in existing_emails:
                row_errors.append("Email already exists in system")
        if emp_id:
            if emp_id in seen_emp_ids:
                row_errors.append("Duplicate Employee ID in upload file")
            elif emp_id in existing_emp_ids:
                row_errors.append("Employee ID already exists in system")

        if row_errors:
            errors.append({
                "row": excel_row_num,
                "name": name,
                "reason": "; ".join(row_errors),
            })
            continue

        # Reserve in-file uniqueness as we go
        seen_emails.add(email)
        seen_emp_ids.add(emp_id)

        # Build the contact doc + insert
        generated_pwd = generate_password()
        contact_id = str(uuid.uuid4())
        doc = {
            "id": contact_id,
            "email": email,
            "name": name,
            "phone": phone or "",
            "phone_isd": phone_isd or "",
            "role": role,
            "emp_id": emp_id,
            "doj": doj_iso,
            "permission_set_ids": resolved_pset_ids,
            "status": "Active",
            "created_on": now_iso(),
            "last_login": None,
            "password_hash": hash_password(generated_pwd),
            "password_encrypted": encrypt_password(generated_pwd),
        }
        try:
            await db.contacts.insert_one(doc)
        except Exception as e:  # noqa: BLE001
            errors.append({
                "row": excel_row_num,
                "name": name,
                "reason": f"DB insert failed: {e}",
            })
            continue

        success_records.append({
            "id": contact_id, "name": name, "email": email,
            "emp_id": emp_id, "password": generated_pwd,
        })

        # Reserve uniqueness for subsequent rows
        existing_emails.add(email)
        existing_emp_ids.add(emp_id)

    # Send notification emails (best-effort, after all rows processed).
    login_url = (os.environ.get("APP_PUBLIC_URL", "") or "") + "/login"
    for rec in success_records:
        try:
            subject, mbody = render_new_employee_email(
                name=rec["name"], email=rec["email"],
                password=rec["password"], login_url=login_url,
            )
            await send_email(
                db, to_email=rec["email"], to_name=rec["name"],
                kind="new_employee", subject=subject, body=mbody,
                related_id=rec["id"], metadata={"created_by": user.get("id"), "source": "bulk_upload"},
                variables={"password": rec["password"], "login_url": login_url,
                           "emp_id": rec["emp_id"], "date_created": now_iso()},
            )
        except Exception as e:
            logger.error(f"bulk_upload: new-employee email failed for {rec['email']}: {e}")

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
    await db.contact_uploads.insert_one(upload_doc)
    upload_doc.pop("_id", None)

    await log_audit(
        actor=user, action="contact.bulk_upload", resource="contact_upload",
        resource_id=upload_id,
        detail=f"Bulk uploaded employees: total={total} success={success_count} failed={failed_count} status={status} file={file.filename}",
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

@api_router.get("/contacts/upload-history")
async def list_upload_history(
    page: int = 1,
    page_size: int = 25,
    user=Depends(require_role("Super Admin")),
):
    page = max(1, page)
    page_size = max(1, min(page_size, 200))
    total = await db.contact_uploads.count_documents({})
    cursor = (
        db.contact_uploads
        .find({}, {"_id": 0, "errors": 0})
        .sort("uploaded_at", -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    items = await cursor.to_list(page_size)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@api_router.get("/contacts/upload-history/{upload_id}")
async def get_upload_session(upload_id: str, user=Depends(require_role("Super Admin"))):
    doc = await db.contact_uploads.find_one({"id": upload_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Upload not found")
    return doc


@api_router.get("/contacts/upload-history/{upload_id}/error-report.xlsx")
async def download_error_report(upload_id: str, user=Depends(require_role("Super Admin"))):
    doc = await db.contact_uploads.find_one({"id": upload_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Upload not found")
    errors: List[Dict[str, Any]] = doc.get("errors") or []

    wb = Workbook()
    ws = wb.active
    ws.title = "Errors"
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="DC2626")
    # Per spec: only Row Number, Employee Name, Error Reason
    headers = ["Row Number", "Employee Name", "Error Reason"]
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=1, column=i, value=h)
        c.font = header_font
        c.fill = header_fill
    for r_idx, e in enumerate(errors, start=2):
        ws.cell(row=r_idx, column=1, value=e.get("row"))
        ws.cell(row=r_idx, column=2, value=e.get("name") or "")
        ws.cell(row=r_idx, column=3, value=e.get("reason") or "")
    widths = [12, 28, 80]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"

    # Meta sheet
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
    filename = f"error_report_{safe_fname}_{upload_id[:8]}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
