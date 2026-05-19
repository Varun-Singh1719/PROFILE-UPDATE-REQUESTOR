# Ticketing System – PRD

## Original Problem Statement
Multi-role internal ticketing platform with role-based access. Roles include Admin, Manager, Research (formerly "Research Associate"), Delivery, Member, and legacy DQ Team. Tickets carry Subject, Priority, Due Date, Number of Profiles, Attachment, Status (Open/In Progress/Closed), Assigned To. RA creates tickets, DQ self-assigns and updates status, Admin manages everything. Strict theme: highlight `#ec9324`, shadow `#b2b2b2`, flat white background. Permission-driven access rather than role-driven where possible.

## Architecture
- **Backend**: FastAPI + MongoDB (motor) + JWT auth (cookie + Bearer) + Emergent Object Storage for attachments.
- **Frontend**: React + Tailwind + shadcn UI + Manrope font + Sonner toasts.
- **Email**: Pluggable provider abstraction (`outbox` default, optional `resend`).
- **Collections**: contacts, tickets, comments, activity, files, teams, permission_rules, permission_presets, audit_log, password_reset_tokens, notifications_outbox, email_templates.

## User Personas / Roles
- **Admin** — full visibility, manages contacts, teams, permissions, email templates, notifications outbox.
- **Manager** — Admin-level access inside ProfiX only; can toggle email-template status; cannot edit template content.
- **Research** (renamed from "Research Associate") — creates tickets, sees their own.
- **DQ Team** (legacy) — self-assigns and updates assigned tickets.
- **Delivery / Member** — default `/employee` dashboard; permission-driven access elsewhere.

## Auth & Security
- JWT 12h tokens, bcrypt password hashing.
- Forgot-password (anti-enumeration: always returns 200) + reset-password with 1h hashed token in `password_reset_tokens` (TTL index).
- Brute force protection at app layer via lock + audit log.
- Emergent-managed Google sign-in (active contacts only).
- Admin-triggered password reset auto-generates a 12-char complex password.

## Notifications / Email
- `EMAIL_PROVIDER=outbox` (default) — every email payload persisted to `notifications_outbox`; Admin reviews at `/admin/notifications`.
- `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` — same persistence plus HTTP POST to Resend.
- Triggers: new employee credentials, admin-triggered password reset, forgot password.
- Templates live in `email_templates` collection; setting `status='Inactive'` suppresses that kind entirely.
- Subject/body support `{{name}} {{email}} {{password}} {{login_url}} {{reset_link}}` placeholders.

## Permissions
- Subjects: Role / Team / Employee; Employee overrides > Team > Role.
- Scoped actions (`view`, `edit`, `assign`) accept values `false` / `true` / `"respective"` / `"all"` — precedence: `all` > `respective` > `true` > `false`.
- Non-scoped actions (`create`, `approve`, `delete`) remain boolean.
- Presets system (`/api/permissions/presets`) with Apply-to-subject endpoint.

## What's been implemented (cumulative)
### Existing (2026-05-12)
- Login + role-based redirect, Google sign-in, branding (Infollion logo).
- Admin/RA/DQ dashboards with metric cards, DQ Performance, Recent Updates.
- Ticket listing + bulk actions + detail + comments + activity + attachments.
- Contact CRUD + active/inactive toggle.

### 2026-05-15 — Admin/Manager v1
- ProfiX collapsible sidebar group, Manage group for Admin.
- Role rename `type` → `role`; Manager role added with Admin-level ProfiX rights.
- Auto-generated passwords (Fernet-encrypted for one-time recall).
- Teams CRUD with manager/member multi-selects + colour code.
- Permissions matrix page (Role/Team/Employee × Module × Feature × Action).
- Employee List revamp with EMP ID, DOJ, password eye toggle in detail/edit.

### 2026-05-19 — Admin/Manager v2 (this fork)
- **Forgot/Reset password**: `/api/auth/forgot-password` (anti-enumeration) + `/api/auth/reset-password`, frontend pages, "Forgot your password?" link on login.
- **Notifications Outbox**: every system email persisted to `notifications_outbox`; admin UI at `/admin/notifications` to filter/preview/delete.
- **Email Templates module** (`/admin/email-templates`, `/manager/email-templates`): full CRUD (Admin), toggle-only (Manager), preview, duplicate, contentEditable rich-text editor, 3 system templates seeded (new_employee, admin_password_reset, forgot_password). Inactive status suppresses that email kind.
- **Server-side pagination + CSV export**: `/api/tickets?page&page_size&sort_by&sort_dir`, `/api/contacts?page…`, `/api/tickets/export.csv`, `/api/contacts/export.csv` (Admin only).
- **Bulk employee ops**: `/api/contacts/bulk-status` + `/api/contacts/bulk-role` (Admin), with select-all checkbox + bulk actions dropdown on Employee List.
- **Role refactor**: `Research Associate` → `Research` (one-way migration). New selectable roles `Delivery` and `Member`. `DQ Team` hidden from the form dropdown but legacy DQ users still work and route to `/dq`. Delivery/Member route to new `/employee` dashboard.
- **EMP ID + DOJ mandatory** on employee creation (backend validation + form `required`).
- **Employee List slim table**: Name, EMP ID, Email, Team, DOJ, Role, Active, Edit. Phone, Manager(s), Last Login, Created moved to detail modal. Sticky header + sortable columns + pagination.
- **Teams auto-color**: `/api/teams/colors` returns 30-color palette + used + suggested. New teams auto-assign next unused colour; admin can override to any colour (including duplicates). Already-assigned employees appear greyed out with tooltip in the member/manager multi-selects. Search bar above teams table.
- **Permissions scope dropdown**: `view/edit/assign` actions now have None/Respective/All dropdown; create/delete/approve remain switches. Merge logic respects `all > respective > true > false` precedence with Employee > Team > Role hierarchy.

## Backlog
- **P1** — Schedule/retry sending from outbox when Resend is configured but a send fails.
- **P1** — Login throttle / lockout (currently only relies on bcrypt cost).
- **P2** — CSV export with Excel-friendly BOM + UTF-8 negotiation.
- **P2** — Email template versioning / preview-with-sample-data.
- **P2** — Move auth to cookie-only (drop localStorage token), split server.py into routers.
- **P2** — WebSockets for real-time ticket updates.
- **P2** — Reporting analytics (closure time, SLA adherence per DQ member).

## Demo / Test Accounts
See `/app/memory/test_credentials.md`.

## Endpoints (recently added)
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/notifications/outbox` (Admin)
- `GET|DELETE /api/notifications/outbox/{id}` (Admin)
- `GET /api/email-templates`, `POST` (Admin), `PATCH` (Admin/Manager-status-only), `POST .../duplicate` (Admin), `DELETE` (Admin)
- `GET /api/teams/colors`
- `GET /api/tickets/export.csv`, `GET /api/contacts/export.csv`
- `POST /api/contacts/bulk-status`, `POST /api/contacts/bulk-role`
- Pagination on `/api/tickets`, `/api/contacts` (opt-in via `?page=`).
