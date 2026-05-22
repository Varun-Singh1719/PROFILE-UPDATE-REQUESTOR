# Infollion Ticketing — PRD (v3)

## Original Problem Statement
Internal multi-tenant ticketing platform with strict permission-driven access.
Tickets carry Subject, Priority, Due Date, Number of Profiles, Attachment,
Status (Open/In Progress/Closed), Assigned To. Super Admin manages everything;
all other employees ("Admin") see only what their assigned Permission Sets
allow. Strict theme: highlight `#ec9324`, shadow `#b2b2b2`, flat white background.

## v3 Role Model (current)
Only two canonical roles exist after the role-collapse migration:

| Role          | Notes                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| **Super Admin** | Singular admin. Bypasses Permission Sets — has full access everywhere. Can create / edit / delete employees, teams, Permission Sets, email templates, audit log, notifications outbox. |
| **Admin**     | Every other employee. Access is governed **entirely** by the union of their assigned Permission Sets (allow wins / OR-merge). Cannot reach any Super-Admin-only screen. |

Legacy roles (Manager, Research, Research Associate, DQ Team, Delivery, Member)
are migrated to `Admin` on startup. The previous `Admin` becomes `Super Admin`.
Migration is **idempotent** — guarded by `system_meta._id="v3_role_collapse"`.

## Permission Sets (v3)
Permission Sets are reusable, named templates of feature-action grants spanning
multiple modules (currently **ProfiX** and **Desk Booking**).

- Employees are assigned 1..N sets via `contact.permission_set_ids: List[str]`.
- Effective access = **OR-union** of every assigned set (allow wins). e.g. if
  Set A allows `edit=true` and Set B has `edit=false`, the merged result is
  `edit=true`.
- Super Admin short-circuits with full access — sets are ignored.
- A Permission Set has: `id` (uuid), `numeric_id` (auto-increment), `name`
  (unique, case-insensitive), `description`, `modules`, `created_by`,
  `created_at`, `updated_by`, `updated_at`.
- `modules` is shaped as
  `{ profix: { feature_key: { action: bool, … }, … }, desk_booking: { … } }`.

### Endpoints
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET    | `/api/permission-sets`              | any authed | filters: `q`, `created_by`, `created_from`, `created_to`, `module` |
| GET    | `/api/permission-sets/stats`        | any authed | totals + counts by module + employees-with-sets |
| GET    | `/api/permission-sets/{id}`         | any authed | accepts uuid or numeric_id as string |
| POST   | `/api/permission-sets`              | Super Admin | unique-name validation, audit log |
| PATCH  | `/api/permission-sets/{id}`         | Super Admin | rename validation |
| POST   | `/api/permission-sets/{id}/duplicate` | Super Admin | clones; auto-renames to "X (Copy)" / "X (Copy N)" |
| DELETE | `/api/permission-sets/{id}`         | Super Admin | also `$pull`s id from every contact |

### Contacts integration
- `contact.permission_set_ids: List[str]` round-trips through `GET / POST / PATCH /api/contacts`.
- `GET /api/contacts` accepts a `permission_set_id` query param (uuid **or** numeric_id) for filtering "which employees have set X".
- Listing returns an enriched `permission_sets: [{ id, numeric_id, name }]` array per contact.
- Audit entry `contact.assign_permission_sets` written on every change to the array.

### Frontend surfaces
- **`/admin/permissions`** (Super Admin only): single editor, two accordions
  (ProfiX Features, Desk Booking Features). "Save Changes" opens a modal that
  asks for a Title + optional description and POSTs a new Permission Set.
- **`/admin/permission-sets`** (Super Admin only): list view with filters
  (search, created_on from/to, created_by, module pills), and per-row actions:
  View, Edit, **Duplicate**, Delete.
- **`/admin/permission-sets/:id`** (Super Admin only): detail page; read-only
  by default with an Edit toggle (URL flag `?edit=1`).
- **`/admin/contacts`** (Super Admin only): multi-select Permission Sets in the
  add/edit dialog (formatted as `#numeric_id · name`); chips in the detail
  modal; **Permission Set filter dropdown** in the toolbar.

## Architecture
- **Backend**: FastAPI + MongoDB (motor) + JWT auth (cookie + Bearer) + Emergent Object Storage for attachments.
- **Frontend**: React + Tailwind + shadcn UI + Manrope font + Sonner toasts.
- **Email**: Pluggable provider abstraction (`outbox` default, optional `resend`).
- **Collections**: contacts, tickets, comments, activity, files, teams,
  `permission_sets` (v3), `permission_rules` (legacy fallback), `permission_presets`,
  audit_log, password_reset_tokens, notifications_outbox, email_templates,
  `system_meta` (migration flags).

### Routing (v3)
- Single admin shell at `/admin` for both Super Admin and Admin.
- Super-Admin-only screens: `/admin/contacts`, `/admin/teams`, `/admin/permissions`,
  `/admin/permission-sets`, `/admin/permission-sets/:id`, `/admin/notifications`,
  `/admin/email-templates`.
- Sidebar nav inside the shell is gated by `usePermissions().can(module, feature, action)`.
- Legacy paths `/manager/*`, `/ra/*`, `/dq/*`, `/employee/*` redirect to `/admin`.

## Auth & Security
- JWT 12h tokens, bcrypt password hashing.
- Forgot-password (anti-enumeration: always returns 200) + reset-password with 1h hashed token in `password_reset_tokens` (TTL index).
- Brute force protection at app layer via lock + audit log.
- Emergent-managed Google sign-in (active contacts only).
- Admin-triggered password reset auto-generates a 12-char complex password.

## Notifications / Email
- `EMAIL_PROVIDER=outbox` (default) — every email payload persisted to `notifications_outbox`; Super Admin reviews at `/admin/notifications`.
- `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` — same persistence plus HTTP POST to Resend.
- Triggers: new employee credentials, admin-triggered password reset, forgot password.
- Templates live in `email_templates` collection; setting `status='Inactive'` suppresses that kind entirely.

## What's been implemented (cumulative)
### Pre-v3 baseline
- Login + role-based redirect, Google sign-in, branding (Infollion logo).
- Ticket listing + bulk actions + detail + comments + activity + attachments.
- Contact CRUD + active/inactive toggle.
- Teams CRUD with manager/member multi-selects + color palette.
- Auto-generated passwords (Fernet-encrypted for one-time recall).
- Forgot/reset password, Notifications Outbox, Email Templates module (CRUD + RBAC + Inactive suppression).
- Server-side pagination + CSV export for tickets/contacts.
- Bulk employee status/role.
- EMP ID + DOJ mandatory on employee creation.

### 2026-05-22 — v3 role collapse + Permission Sets
- Collapsed roles to `Super Admin` and `Admin`; idempotent startup migration.
- `permission_sets` collection + full CRUD endpoints; auto-incrementing `numeric_id`.
- `contact.permission_set_ids` round-tripped end-to-end; assignment audit log.
- `GET /api/permissions/me/effective` rewritten to OR-merge assigned sets;
  legacy `permission_rules` kept as fallback for users with no assigned sets.
- Frontend: Permissions editor (accordion + save-as-set modal), Permission Sets
  list / detail / edit pages, Contacts multi-select + chips, Sidebar + App
  routing rewritten to v3 model. All Manage screens Super-Admin-only.
- Backend testing agent: **36/36 v3 tests passed**.

### 2026-05-22 — polish + router split (this run)
- `GET /api/contacts?permission_set_id=` filter (accepts uuid or numeric_id).
- `POST /api/permission-sets/{id}/duplicate` — server-side clone with auto-naming.
- Permission Sets list page now has a one-click **Duplicate** action that opens the new copy in edit mode.
- Employee List page now has a **Permission Set filter dropdown** alongside Role/Status.
- **Backend refactor**: split `server.py` (2480 lines) into a slim entrypoint
  (`server.py`, ~195 lines: startup + migrations + router registration), a
  shared infrastructure module (`core.py`, ~590 lines: config / db / app /
  models / helpers / schema), and 10 domain-focused routers under
  `routers/` — `auth`, `notifications_email`, `contacts`, `teams`,
  `permissions` (legacy v1+v2+presets+effective+stats), `permission_sets`
  (v3 CRUD + duplicate), `audit`, `tickets` (+ comments + activity + csv),
  `files`, `dashboard`. Added `backend/tests/test_refactor_smoke.py` (26 tests, all green).

### 2026-05-22 — Granular access scope for Permission Sets (this run)
- **Data model**: scoped ProfiX actions (`view`, `edit`, `assign`, `approve`) now
  store one of `false / "respective" / "team" / "all"` instead of bool. Non-scoped
  actions and Desk Booking actions remain boolean. Legacy `true` migrates to `"all"`.
- **Effective merge**: OR-union picks the broadest scope per action across all assigned
  sets — `all > team > respective > false`. Super Admin always resolves to `"all"`.
- **`GET /api/permissions/schema`**: each feature now advertises `scoped_actions: string[]`;
  response also includes `scope_values` and `scoped_modules`.
- **Editor UI** (`PermissionsPage` + `PermissionSetDetailPage`):
  toggling on a scoped action defaults to `respective` and reveals a
  Respective / Team / All dropdown next to the chip. Toggling off resets the scope.
  Header has a HelpCircle tooltip explaining the three values.
- **`usePermissions` hook**: added `getScope(module, feature, action)` and
  `teamMemberIds`. `can()` still works for callers that just need a boolean.
- **Ticket enforcement** (Phase 1 surface):
  - `GET /api/tickets`, `GET /api/tickets/export.csv`: list is filtered by the
    user's effective `profix.ticket.view` scope (created_by_id ∪ assigned_to_id
    must fall in the user's allowed-id set).
  - `GET /api/tickets/{id}`: returns 404 if outside view scope (URL-bypass blocked).
  - `PATCH /api/tickets/{id}`: status change requires `edit` scope on the
    target; assignee change requires `assign` scope, and the assignee themselves
    must fall within the Admin's assign-scope id whitelist.
  - `POST /api/tickets/bulk-assign` and `bulk-status`: same scope checks applied
    per-ticket.
- **Audit**: scope changes flow through the existing `permission_set.update` /
  `permission_set.create` entries — full modules tree (with scope strings) is
  recorded.
- Tests: `backend/tests/test_scope.py` (12 tests) — storage, OR-merge, view scope,
  edit scope. `test_refactor_smoke.py` (26 tests) re-verified. **38/38 pass.**

## Backlog (P-tiered)
- **P1** — Phase 2 scope enforcement: dashboard widgets (`/api/dashboard/*`),
  recent feed, notifications outbox filters, global search.
- **P1** — Schedule/retry sending from outbox when Resend is configured but a send fails.
- **P1** — Login throttle / lockout (currently only relies on bcrypt cost).
- **P2** — CSV export with Excel-friendly BOM + UTF-8 negotiation.
- **P2** — Email template versioning / preview-with-sample-data.
- **P2** — Move auth to cookie-only (drop localStorage token).
- **P2** — WebSockets for real-time ticket updates.
- **P2** — Reporting analytics (closure time, SLA adherence per team).

## Demo / Test Accounts
See `/app/memory/test_credentials.md`.
