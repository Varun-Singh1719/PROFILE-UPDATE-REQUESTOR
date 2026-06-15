"""Bulk upload (Excel .xlsx) for Employees / Contacts.

Endpoints:
  GET  /api/contacts/sample-template            — download .xlsx template w/ headers + 2 sample rows
  POST /api/contacts/bulk-upload                — accept .xlsx, validate, partial-insert, return summary
  GET  /api/contacts/upload-history             — list past upload sessions (paginated)
  GET  /api/contacts/upload-history/{id}        — full upload session (with embedded errors)
  GET  /api/contacts/upload-history/{id}/error-report.xlsx — download per-row error report

Design notes:
  * Partial processing: valid rows are inserted row-by-row; invalid rows are
    captured into the upload session document so they can be downloaded as an
    error report. The DB does NOT rollback if some rows fail.
  * Manager Email → resolves to a Team where that email's contact is one of
    the team's `manager_ids`. The newly created employee is added to that
    team's `member_ids`. If multiple teams match, the first one wins.
  * Per-row notifications reuse the existing `new_employee` email template
    via `send_email` (so admins can toggle the template Inactive to suppress).
  * Errors collection embedded inside the upload doc; capped at 5000 rows.
"""
from __future__ import annotations

import io
import os
import uuid
import logging
from datetime import datetime, timezone, date
from typing import Optional, Dict, Any, List, Tuple

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

# Canonical template column order. The first 5 are mandatory.
TEMPLATE_HEADERS = [
    "Employee Name",
    "Email Address",
    "Employee Code",
    "Role",
    "Date of Joining",
    "Department",
    "Designation",
    "Manager Email",
    "Location",
]
REQUIRED_HEADERS = {"Employee Name", "Email Address", "Employee Code", "Role", "Date of Joining"}
VALID_ROLES = {"Super Admin", "Admin"}

SAMPLE_ROWS = [
    ["Aarav Sharma", "aarav.sharma@example.com", "EMP-1001", "Admin", "2025-04-01",
     "Engineering", "Software Engineer", "manager@ticketing.com", "Bangalore"],
    ["Priya Iyer", "priya.iyer@example.com", "EMP-1002", "Admin", "2025-05-15",
     "Human Resources", "HR Executive", "", "Mumbai"],
]


def _normalize_doj(raw) -> Optional[str]:
    """Accept Excel date cells / strings; return ISO YYYY-MM-DD or None on failure."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        return raw.date().isoformat()
    if isinstance(raw, date):
        return raw.isoformat()
    s = str(raw).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _cell_text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
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
    center = Alignment(horizontal="left", vertical="center", wrap_text=True)

    for col_idx, h in enumerate(TEMPLATE_HEADERS, start=1):
        c = ws.cell(row=1, column=col_idx, value=h)
        c.font = header_font
        c.fill = header_fill
        c.alignment = center
        c.border = border
    for row_idx, row in enumerate(SAMPLE_ROWS, start=2):
        for col_idx, val in enumerate(row, start=1):
            ws.cell(row=row_idx, column=col_idx, value=val)

    # Column widths
    widths = [22, 30, 16, 14, 16, 22, 22, 28, 18]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"

    # Notes sheet — explains required vs optional + role/doj formats.
    notes = wb.create_sheet("Instructions")
    notes_lines = [
        ("Field", "Required?", "Notes"),
        ("Employee Name", "Yes", "Full name of the employee."),
        ("Email Address", "Yes", "Unique. Will be the login email."),
        ("Employee Code", "Yes", "Unique. Internal HR / payroll code (e.g. EMP-1001)."),
        ("Role", "Yes", "One of: Super Admin, Admin."),
        ("Date of Joining", "Yes", "Format: YYYY-MM-DD (Excel date cells also accepted)."),
        ("Department", "No", "Free text — e.g. Engineering, HR."),
        ("Designation", "No", "Free text — e.g. Software Engineer."),
        ("Manager Email", "No", "If supplied, must match an existing employee who is a Team Manager. The new employee will be added to that team."),
        ("Location", "No", "Free text — e.g. Bangalore."),
        ("", "", ""),
        ("System-generated fields", "", "Do NOT include — handled automatically: Employee ID, Internal Record ID, Created Date, Created By, Last Updated Date, Password."),
    ]
    for r_idx, row in enumerate(notes_lines, start=1):
        for c_idx, val in enumerate(row, start=1):
            cell = notes.cell(row=r_idx, column=c_idx, value=val)
            if r_idx == 1:
                cell.font = Font(bold=True)
                cell.fill = header_fill
                cell.font = Font(bold=True, color="FFFFFF")
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

async def _resolve_manager_team(manager_email: str) -> Optional[dict]:
    """Find a team whose manager_ids contains a contact with the given email.
    Returns the team doc or None.
    """
    if not manager_email:
        return None
    mgr = await db.contacts.find_one({"email": manager_email.lower().strip()}, {"_id": 0, "id": 1})
    if not mgr:
        return None
    team = await db.teams.find_one({"manager_ids": mgr["id"]}, {"_id": 0})
    return team


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

    # Normalize headers (strip whitespace, ignore trailing Nones)
    headers = [(_cell_text(h)) for h in header_row]
    while headers and not headers[-1]:
        headers.pop()
    header_set = set(headers)
    missing = REQUIRED_HEADERS - header_set
    if missing:
        raise HTTPException(400, f"Missing required column(s): {', '.join(sorted(missing))}")

    # Pre-load existing emails + emp_ids to validate uniqueness in-bulk.
    existing_emails = set()
    existing_emp_ids = set()
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

    # Manager team cache: email -> team doc (or None)
    mgr_cache: Dict[str, Optional[dict]] = {}

    for excel_row_num, row in enumerate(rows_iter, start=2):  # row 1 = header
        # Skip fully empty rows
        if not row or all((v is None or _cell_text(v) == "") for v in row):
            continue
        total += 1
        d = _row_to_dict(headers, row)

        name = _cell_text(d.get("Employee Name"))
        email = _cell_text(d.get("Email Address")).lower()
        emp_id = _cell_text(d.get("Employee Code"))
        role = _cell_text(d.get("Role"))
        doj_raw = d.get("Date of Joining")
        department = _cell_text(d.get("Department")) or None
        designation = _cell_text(d.get("Designation")) or None
        manager_email = _cell_text(d.get("Manager Email")).lower() or None
        location = _cell_text(d.get("Location")) or None

        row_errors: List[str] = []
        if not name:
            row_errors.append("Employee Name is required")
        if not email:
            row_errors.append("Email Address is required")
        elif "@" not in email:
            row_errors.append("Email Address looks invalid")
        if not emp_id:
            row_errors.append("Employee Code is required")
        if not role:
            row_errors.append("Role is required")
        elif role not in VALID_ROLES:
            row_errors.append(f"Role must be one of: {', '.join(sorted(VALID_ROLES))}")
        doj_iso = _normalize_doj(doj_raw)
        if doj_raw in (None, ""):
            row_errors.append("Date of Joining is required")
        elif not doj_iso:
            row_errors.append("Date of Joining must be YYYY-MM-DD")

        # Uniqueness checks
        if email:
            if email in existing_emails:
                row_errors.append("Email already exists in system")
            elif email in seen_emails:
                row_errors.append("Duplicate Email in upload file")
        if emp_id:
            if emp_id in existing_emp_ids:
                row_errors.append("Employee Code already exists in system")
            elif emp_id in seen_emp_ids:
                row_errors.append("Duplicate Employee Code in upload file")

        # Manager Email lookup (only if no other blocking error so far)
        team_to_attach: Optional[dict] = None
        if manager_email and not row_errors:
            if manager_email in mgr_cache:
                team_to_attach = mgr_cache[manager_email]
            else:
                team_to_attach = await _resolve_manager_team(manager_email)
                mgr_cache[manager_email] = team_to_attach
            if team_to_attach is None:
                row_errors.append("Manager Email not found among existing Team Managers")

        if row_errors:
            errors.append({
                "row": excel_row_num,
                "name": name,
                "email": email,
                "emp_id": emp_id,
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
            "phone": "",
            "role": role,
            "emp_id": emp_id,
            "doj": doj_iso,
            "permission_set_ids": [],
            "department": department,
            "designation": designation,
            "location": location,
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
                "name": name, "email": email, "emp_id": emp_id,
                "reason": f"DB insert failed: {e}",
            })
            continue

        # Attach to manager's team if resolved
        if team_to_attach:
            try:
                await db.teams.update_one(
                    {"id": team_to_attach["id"]},
                    {"$addToSet": {"member_ids": contact_id}},
                )
            except Exception as e:
                logger.warning(f"Failed to attach {email} to team {team_to_attach.get('id')}: {e}")

        # Track for email + summary
        success_records.append({
            "id": contact_id, "name": name, "email": email,
            "emp_id": emp_id, "password": generated_pwd,
            "department": department, "designation": designation,
            "role": role, "doj": doj_iso,
        })

        # Reserve uniqueness for subsequent rows
        existing_emails.add(email)
        existing_emp_ids.add(emp_id)

    # Send notification emails (best-effort, after all rows processed so the
    # upload returns quickly enough — still sequential for simplicity).
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
                           "emp_id": rec["emp_id"], "department": rec["department"] or "",
                           "designation": rec["designation"] or "",
                           "date_created": now_iso()},
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
        # Cap embedded errors to avoid pathologically huge docs.
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
        "errors": errors[:50],  # first 50 inlined for immediate display
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
        .find({}, {"_id": 0, "errors": 0})  # omit big errors array in list view
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
    header_fill = PatternFill("solid", fgColor="DC2626")  # red-600
    headers = ["Row #", "Employee Name", "Email Address", "Employee Code", "Reason(s)"]
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=1, column=i, value=h)
        c.font = header_font
        c.fill = header_fill
    for r_idx, e in enumerate(errors, start=2):
        ws.cell(row=r_idx, column=1, value=e.get("row"))
        ws.cell(row=r_idx, column=2, value=e.get("name") or "")
        ws.cell(row=r_idx, column=3, value=e.get("email") or "")
        ws.cell(row=r_idx, column=4, value=e.get("emp_id") or "")
        ws.cell(row=r_idx, column=5, value=e.get("reason") or "")
    widths = [8, 24, 32, 16, 80]
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
