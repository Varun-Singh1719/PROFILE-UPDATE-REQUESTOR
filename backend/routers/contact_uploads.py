"""Bulk upload (Excel .xlsx) for Employees / Contacts.

Endpoints:
  GET  /api/contacts/sample-template                — download .xlsx template (6 cols + 2 sample rows)
  POST /api/contacts/bulk-upload                    — accept .xlsx, validate, partial-insert, return summary
  GET  /api/contacts/upload-history                 — list past upload sessions (paginated)
  GET  /api/contacts/upload-history/{id}            — full upload session (with embedded errors)
  GET  /api/contacts/upload-history/{id}/error-report.xlsx — download per-row error report

Schema (6 columns; all required except Phone):
  Name, Email, Phone, DOJ (MM-DD-YYYY), Employee ID, Role
"""
from __future__ import annotations

import io
import os
import re
import uuid
import logging
from datetime import datetime, timezone, date
from typing import Optional, Dict, Any, List

from fastapi import Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from core import (
    api_router, db, log_audit, now_iso, require_role,
    hash_password, encrypt_password, generate_password,
)
from notifications import send_email, render_new_employee_email

logger = logging.getLogger(__name__)

# Canonical template column order. Phone is the only optional column.
TEMPLATE_HEADERS = ["Name", "Email", "Phone", "DOJ", "Employee ID", "Role"]
REQUIRED_HEADERS = {"Name", "Email", "DOJ", "Employee ID", "Role"}
VALID_ROLES = {"Super Admin", "Admin"}

# Simple email validator — RFC-compliant enough for HR data.
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")

SAMPLE_ROWS = [
    ["John Smith",    "john.smith@company.com",    "9876543210", "01-15-2026", "EMP001", "Admin"],
    ["Sarah Johnson", "sarah.johnson@company.com", "9876543211", "02-01-2026", "EMP002", "Admin"],
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

@api_router.get("/contacts/sample-template")
async def download_sample_template(user=Depends(require_role("Super Admin"))):
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

    widths = [22, 32, 14, 14, 14, 12]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"

    # Instructions sheet — explains required vs optional + role/doj formats.
    notes = wb.create_sheet("Instructions")
    notes_lines = [
        ("Field", "Required?", "Notes"),
        ("Name", "Yes", "Full name of the employee."),
        ("Email", "Yes", "Unique. Will be the login email. Standard email format."),
        ("Phone", "No", "Contact number — digits only."),
        ("DOJ", "Yes", "Date of Joining. Format: MM-DD-YYYY (e.g. 01-15-2026). Excel date cells are also accepted."),
        ("Employee ID", "Yes", "Unique. Internal HR / payroll code (e.g. EMP001)."),
        ("Role", "Yes", "One of: Super Admin, Admin."),
        ("", "", ""),
        ("System-generated fields", "", "Do NOT include — handled automatically: Internal Record ID, Created Date, Created By, Last Updated Date, Password. Permission Set is assigned later via the Edit Employee screen."),
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


@api_router.post("/contacts/bulk-upload")
async def bulk_upload_contacts(
    file: UploadFile = File(...),
    user=Depends(require_role("Super Admin")),
):
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Only .xlsx files are supported")

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")

    try:
        wb = load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
        ws = wb.active
    except Exception as e:
        raise HTTPException(400, f"Could not read .xlsx file: {e}")

    rows_iter = ws.iter_rows(values_only=True)
    try:
        header_row = next(rows_iter)
    except StopIteration:
        raise HTTPException(400, "File is empty")

    headers = [(_cell_text(h)) for h in header_row]
    while headers and not headers[-1]:
        headers.pop()
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

    for excel_row_num, row in enumerate(rows_iter, start=2):  # row 1 = header
        # Skip fully empty rows
        if not row or all((v is None or _cell_text(v) == "") for v in row):
            continue
        total += 1
        d = _row_to_dict(headers, row)

        name = _cell_text(d.get("Name"))
        email = _cell_text(d.get("Email")).lower()
        phone = _cell_text(d.get("Phone"))
        doj_raw = d.get("DOJ")
        emp_id = _cell_text(d.get("Employee ID"))
        role = _cell_text(d.get("Role"))

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
            "role": role,
            "emp_id": emp_id,
            "doj": doj_iso,
            "permission_set_ids": [],
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
