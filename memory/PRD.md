# Infollion Utilities — PRD


## Employees Activation / Deactivation + 24h Session (Jul 30 2026)
- **Manage → Employees confirmation dialog**: the row-level status Switch on `/admin/contacts` now opens a confirmation modal ("Are you sure you want to activate/deactivate user {Employee Name}?") before hitting `PATCH /contacts/{id}`. Yes triggers the API call, No cancels. Deactivate path uses a red confirm button + hint "A deactivated user will not be able to log in."; Activate path uses the brand orange.
- **Deactivated login block**: `POST /api/auth/login` and `POST /api/auth/google-session` return **HTTP 403 `{"detail":"User profile Deactivated"}`** when `contacts.status != "Active"`. The frontend surfaces the string verbatim (toast + inline `error`).
- **24-hour session timer**: JWT `exp` bumped from 12h → 24h in `core.create_access_token`; both auth cookies use `max_age=86400`. Frontend `AuthContext` decodes `exp` from the token and schedules a `setTimeout` for auto-logout at expiry; the axios response interceptor also catches 401 `Token expired` defensively. On expiry the user is bounced to `/login?session_expired=1` where `LoginPage` shows a `notify.info("Your session has expired. Please log in again.")` toast and strips the query param.
- **Env**: recreated `/app/backend/.env` and `/app/frontend/.env` on this container. Backend now points at the user-provided Atlas cluster (`cluster0.vmgql1i.mongodb.net`, `DB_NAME=app_db`, user `sakshamsinghal_db_user`). Regenerated `JWT_SECRET` + `FERNET_KEY`. Login verified for `admin@ticketing.com / Admin@123`.


## IST Timezone Standardisation (Jul 2025) — app-wide
- **Backend**: added `IST` / `ist_now` / `ist_now_iso` / `ist_today` helpers to `core.py`. Rewrote `now_iso()` (used ~141 times) to return IST-tagged (+05:30) ISO strings. Duplicated the helper in `notifications.py` and `inapp_notifications.py`. Fixed direct callers of naive `datetime.now()` / `datetime.utcnow()` / `date.today()` across Workspace Manager (my_workspace, room_bookings, bookings, workstation_*), ProfiX (tickets, contacts), auth (password-reset expiry) and approval_settings. JWT `exp` also on IST-aware datetime.
- **Frontend**: new `src/lib/dateIST.js` with `formatISTDateTime`, `formatISTDate`, `istTodayISO`, etc. Batch-patched every `.toLocaleString / .toLocaleDateString / .toLocaleTimeString` call to include `timeZone: "Asia/Kolkata"` (37 files, 69 sites) via `scripts/inject_ist_timezone.py` (idempotent). Fixed the org-wide dashboard's "today" bug (was using `Date.toISOString().slice(0,10)` = UTC). Date pickers intentionally kept browser-local per spec.
- **Env**: recreated `/app/backend/.env` (missing on this fresh container) — MongoDB Atlas `cluster0.vmgql1i.mongodb.net`, `DB_NAME=app_db`, new user `sakshamsinghal_db_user`. Regenerated `JWT_SECRET` + `FERNET_KEY`. Login verified for `admin@ticketing.com / Admin@123`.


## Latest UI polish (Jul 2026) — Workstation Booking · Team Auto Assignment
- **Workstation-Booking / Pending-Approval conflict validation (new feature)** — applies to *every* booking path (Manual + Employee, Manual + Team, Team Auto Assignment).
  - **Approved conflict** (`EMPLOYEE_ALREADY_BOOKED`): existing behavior — blocked with an error, user must resolve before continuing.
  - **Pending-Approval conflict**: new. Backend `POST /api/workstation-bookings` now checks every target `employee_id` + selected `seat_id` on every target date against `workstation_requests.status ∈ ACTIVE_PENDING_STATUSES`. If any conflict exists AND the payload does not carry `confirm_auto_decline_pending: true`, it returns **HTTP 409 `PENDING_REQUESTS_WILL_BE_DECLINED`** with:
    - `message`, `pending_count`, `proposed_count`
    - `pending_requests[]` — each row carrying `id`, `employee {name, emp_id, …}`, `seat_label` (their pending seat), `proposed_seat {seat_id, seat_label}` (the seat they'll be booked into), `date`, `requested_on`, `status`, `requested_by`, `plan_name`, `team_name`.
  - When the client re-submits with `confirm_auto_decline_pending: true`, the backend wraps *(decline pending rows)* + *(insert new bookings)* in a single MongoDB replica-set **transaction**. Each pending row is CAS-updated on `status ∈ Pending Approval` so a concurrent approver action yields `PENDING_STATE_CHANGED` and rolls back — matching the spec's "One or more requests have already been processed" gate.
  - Decline audit: `status = Declined`, `decided_by = actor (auto_declined:true)`, `decided_on = now`, `decision_note = "Automatically declined due to workstation allocation through Workstation Booking"`.
  - Response now also includes `auto_declined_count`.
- **Frontend `PendingConflictConfirmDialog.jsx`** — spec-verbatim confirmation modal (amber header, orange summary pills, 7-column table Employee Name / Employee ID / Requested Workstation / Proposed Workstation / Booked For Date / Requested On / Current Status). Rendered from `WorkstationBookingPage.jsx` when the 409 fires; Confirm re-runs `handleSave` with `confirmAutoDeclinePending: true`. Success toast (spec verbatim): *"Successfully created X workstation booking(s). Y Pending Approval request(s) were automatically declined."*
- **"Review : Proposed Plan" dialog now fires for Manual Selection too** (single-seat + Employee and multi-seat + Team) — every mode routes through the same review step first.
- **Duplicate Pending Approval validation** on Workstation Booking / Request Workstation submit.
  - Backend `POST /api/workstation-requests` now supports an optional `replace_request_id`. Without it, an existing pending request for the same employee + date still returns **HTTP 409 `EMPLOYEE_PENDING`** — but the payload is enriched with the full conflict context (`id`, `seat_label`, `date`, `status`, `requested_by`, `requested_on`, `employee`, `plan_name`, `team_name`).
  - With `replace_request_id` set, the endpoint atomically (MongoDB replica-set transaction) **cancels the target pending request** (setting `status → Cancelled`, `cancelled_by`, `cancelled_on`, `cancellation_reason: "Replaced by a new booking request"`, `replaced_by_group_id`) **and creates the new request(s)**. A CAS on `status == "Pending Approval"` guards against concurrent approver actions and surfaces `HTTP 409 REPLACE_TARGET_NOT_PENDING` if the row has moved.
  - Frontend renders a new `DuplicatePendingConfirmDialog` (amber header, per-spec message) with **Request ID, Workstation, Booked For Date, Requested On, Status (Pending Approval chip), and Requested By** (last row only when the request was filed on behalf of someone else). Confirm re-submits with `replace_request_id`; Cancel closes without side-effects.
  - Success toast on completion of the replace flow: *"Your previous pending request has been cancelled and a new booking request has been submitted for approval."*
  - Employee-name dropdown now distinguishes booked (chip = **Alloted** — disabled, orange outlined) from pending-only (chip = **Pending** — amber outlined, **still selectable** so the manager can reach the replace flow). Sort order: free → pending → alloted, alphabetical within each bucket.
- **Diagnostic error messages** on the submit `catch` block. Prefers backend `detail.message`; falls back to `Request failed (HTTP <status>).`, network-specific hint, or per-mode retry hint; always `console.error`s the full context under `[workstation submit] failed` so a repro can be diagnosed exactly.
- **Dialog title** renamed from "Review proposed workstation plan" → **"Review : Proposed Plan"**.
- **Recurring context in the dialog**: when the manager has toggled *Recurring* on in the side panel, the dialog header now shows **Start date**, **End date**, and the selected **Days** (sorted Su → S) as solid orange (`#ec9324`) + white-text pills matching the workstation-number style. Each day pill has a hover tooltip (same `group`/`group-hover` gray-900 pattern as the Notification Bell) that reveals the full day name — "Monday", "Wednesday", "Friday", etc.
- Non-recurring plans still show the single booking date only.
- **Behavior confirmed**: the backend (`workstation_bookings.py::_expand_recurring`) walks day-by-day from the start date to the recurring `end_date` and creates a booking on every future date whose weekday is in the selected `days` list — i.e., picking M / W / F with an end date one month out yields ~12 bookings, one on each Mon/Wed/Fri in that window.
- **Alloted chip** in the Team dropdown (`SingleSelect`) and the "Choose team member" picker inside `ConfirmProposalDialog` uses the same visual language as the **In Progress** status badge — outlined pill (transparent bg, `border-2`, orange `#ec9324` border+text, uppercase tracking).
- **Dropdown sort order**: options are grouped **Unalloted first (alphabetical) → Alloted at the bottom (alphabetical)**. Applies to both the Team dropdown and the row-level Choose-team-member dropdown.
- **Workstation number** pill (A1, R1, …) inside the review dialog uses the solid **Medium-priority** style — solid orange `#ec9324` background + white text (shape / size retained).
- **"N workstations"** chip in the dialog header shares the same solid orange + white style.
- **Edit / Remove** row actions are icon-only (pencil / trash) with a hover tooltip identical to the top-bar Notification Bell.
- **Row layout**: employee name and Emp ID render in-line on a single row (parallel), and the modal's boilerplate description ("Confirm which team member will sit at each workstation…") is removed.
- **Awaiting-start hint block** ("Click a starting workstation on the floor map. The system will auto-select the next N consecutive available seats.") removed. Bottom summary line rewritten so it no longer echoes the removed instruction.



## Latest UI polish (Jul 2026) — Sidebar
- Removed "Infollion" wordmark and "Super Admin" role subtitle from sidebar header. Only the Infollion logo is now shown, centered, at a larger size (h-10) for a cleaner look.
- Unified label typography across all sidebar entries (top-level links + group headers + children) at `text-sm`.
- Added `whitespace-nowrap` + `truncate` and reduced icon gap/padding so multi-word items like **Workspace Manager** always render on a single line.
- Toggle button anchored on the right of the header (absolute-positioned) so the logo stays centred.
- Env: recreated `/app/backend/.env` (Mongo Atlas `cluster0.vmgql1i.mongodb.net`, `DB_NAME=app_db`) and `/app/frontend/.env` (`REACT_APP_BACKEND_URL`) which were empty on this fresh container. Regenerated `JWT_SECRET` + `FERNET_KEY`. Login verified for `admin@ticketing.com / Admin@123`.

## Overview
Internal admin platform for Infollion. Combines:
- **ProfiX** — Ticketing / requests workflow.
- **Workspace Manager** — Floor calibration, desk/seat booking, meeting room booking, and a **centralized Bookings module** that aggregates every booking in one searchable / filterable / exportable table.
- **Manage** — Teams, Permissions, Email Templates, Notifications, Employee list.

## Core Personas
- **Super Admin** — Full access incl. employee/team/permission management.
- **Admin** — Day-to-day operational access (no employee/permission edits).

## Latest delivered feature (Feb 2026)
### Employee Bulk Upload via Excel (.xlsx) — Feb 2026
- New router: `/app/backend/routers/contact_uploads.py` (imported BEFORE `contacts.py` in `server.py` to avoid the `/contacts/{contact_id}` dynamic route shadowing the new static endpoints).
- Endpoints (Super Admin only):
  - `GET /api/contacts/sample-template` — returns a styled .xlsx with 9 headers + 2 sample rows + an "Instructions" sheet.
  - `POST /api/contacts/bulk-upload` — multipart file=<.xlsx>. Validates rows (mandatory fields, role ∈ {Super Admin, Admin}, DOJ date format, unique email + emp_id against DB and within file), supports PARTIAL processing (valid rows inserted, invalid rows captured), returns summary `{upload_id, total, success, failed, status, errors[:50]}`.
  - `GET /api/contacts/upload-history` — paginated list of past uploads (errors omitted from list response).
  - `GET /api/contacts/upload-history/{id}` — full upload session including embedded errors.
  - `GET /api/contacts/upload-history/{id}/error-report.xlsx` — 2-sheet error report (`Errors` + `Upload Info`).
- Manager Email column → resolves to a Team where that email's contact is in `manager_ids`; the new employee is `$addToSet`-ed into `member_ids`. Negative case (no matching manager team) returns row error.
- Per-row notification: reuses existing `new_employee` email template via `notifications.send_email` (queues to `notifications_outbox`).
- Frontend: `ContactListPage.jsx` gets two new toolbar buttons (`Upload Employees`, `Upload History`) and two new modals — `BulkUploadModal` (drag-drop dropzone + progress bar + summary cards + error preview + download error report) and `UploadHistoryModal` (table of past sessions + per-row report download). Wired test-ids exposed for QA.
- Schema: `ContactCreate`/`ContactUpdate` extended with optional `department`, `designation`, `location` (Feb 2026). New collection: `contact_uploads` (`{id, filename, uploaded_by, uploaded_at, total_rows, success_count, failed_count, status, errors[]}`). Backend indexes on `uploaded_at` desc + `id` unique.
- P0 admin controls scope: metadata + error log download only. Reprocess / original-file download / audit log surfaced beyond `log_audit` event are P1.
- Tests: `/app/backend/tests/test_contact_bulk_upload.py` — 13/13 pytest pass. Smoke-tested via curl and screenshot.

### ProfiX "Request Closed" email (Feb 2026)
- New seeded template `request_closed` (subject: **Request Closed**, category: notification) in `/app/backend/core.py::DEFAULT_TEMPLATES`.
- Fired from `/app/backend/routers/tickets.py` when ticket status transitions to `Closed` — both the single PATCH endpoint and the bulk `/tickets/bulk-status` endpoint. Email goes to the request **creator** (looked up from `contacts` by `created_by_id`).
- Uses the standard outbox notifications pipeline (`notifications.send_email`) so the template-driven subject/body are honored and the email is queued in `notifications_outbox`.
- Surfaces in the Email Templates page as a Profix-type row (interleaved alphabetically; "Request closed" sorts after "New employee welcome").

### Email Templates page — Type column, sortable headers, hover-name action buttons (Feb 2026)
- File: `/app/frontend/src/pages/EmailTemplatesPage.jsx`
- 3 frontend-only meeting templates injected with `localStorage` persistence (backend wiring TBD):
  - `meeting_room_booked`, `meeting_rescheduled`, `meeting_cancelled` — From Email shown as **TBD** pill.
- Both **Admin** and **Super Admin** roles can edit (previously Super Admin was excluded).
- **Type** column: orange "Meeting" pill for the 3 meeting templates, slate "Profix" pill for the rest (derived from `kind` prefix; no backend schema change).
- **Sortable column headers** (Name, Type, Kind, Category, From Email, Status, Last Updated) — clickable with up/down/chevron icons. **Default sort: Name asc**, so meeting + profix rows are interleaved alphabetically.
- **Hover tooltips on action buttons** (Preview, Edit, Duplicate, Delete / Reset to default) via shadcn `Tooltip` wrapped in `IconAction` helper. Tooltips appear after 150ms hover.
- Meeting templates use a **Reset to default** action (RotateCcw icon) instead of Delete; system Profix templates remain non-deletable.

### Bookings Module — centralized read-only repository
- Route: `/workspace-manager/bookings`
- Backend: `/app/backend/routers/bookings.py`
  - `GET /api/bookings` — paginated/filterable/sortable list (filters: date range, status, team, employee, created-by, search; sorts: seq_no/date/title/room_name/organizer/status/created_at).
  - `GET /api/bookings/filters` — distinct teams / employees / creators for dropdowns.
  - `GET /api/bookings/{id}` — single booking detail (by uuid OR seq_no).
  - `POST /api/bookings/bulk-cancel` — admin-only bulk cancellation.
  - `GET /api/bookings/export` — CSV / XLSX export (respects same filters; supports `ids=` for selection-only export).
- Frontend: `/app/frontend/src/pages/BookingsPage.jsx`
  - Filter bar, sortable shadcn-style data table, row checkboxes, bulk action bar (Export Selected + Bulk Cancel), per-row View/Edit/Cancel, side details drawer with sections (Booking Info, Resource, Meeting, Attendees), Confirm modal for bulk cancel.
- Auto-incrementing `seq_no` integer ID added to `room_bookings` collection (backfill runs on backend startup). User-facing IDs displayed as `#<seq_no>`.
- Workstation type is **deliberately out of scope** — only Meeting Room bookings aggregated today.
- Added `openpyxl` to backend requirements for Excel export.

### Earlier features (Feb 2026)
- Meeting Room booking page: form slide-in animation, edit/reschedule tooltip, responsive layout, +20% reduced upcoming-panel width, horizontal datetime picker.
- Meeting room reschedule backend: `PATCH /api/room-bookings/{id}`, team-name enrichment, fortnightly recurrence.
- Login page rename: "Infollion Expert Profile Update" → "Infollion Utilities".
- Test data seed: `/app/scripts/seed_mrb_test_data.py` (test users, teams, rooms).

## Architecture
- `/app/backend/` — FastAPI + motor MongoDB. Routers under `/app/backend/routers/`. Aggregator (`bookings.py`) reuses `_enrich_bookings_with_team` from `room_bookings.py`.
- `/app/frontend/` — React + TailwindCSS + Shadcn UI. Pages under `/app/frontend/src/pages/`.

## Key DB collections
- `room_bookings` — `{id, seq_no, title, start_at, end_at, organizer, room_id/name, plan_id/name, attendees, recurring, cancelled, created_at, ...}`
- `teams` — `{id, name, member_ids}`
- `contacts` — `{id, name, email, emp_id, ...}`

## Test credentials
See `/app/memory/test_credentials.md` (admin@ticketing.com / Admin@123).

## Roadmap (backlog)
- **P1**: Integrate Workstation bookings into the Bookings Module once that backend is built (filter chip, type column already supports it; backend `__none__` shortcut to be replaced with real query).
- **P1**: Reschedule deep-link → MRB page reads `?reschedule=<id>` query param and opens the booking form pre-populated (currently routes but doesn't auto-load).
- **P2**: Saved filter presets per user.
- **P2**: Email notification on bulk-cancel.
- **P2**: PDF export option.

---

## Update Jun 10, 2026 — Floor Layout polish

- Added **Live On/Off toggle** to PlanCard in `FloorPlansListPage.jsx` (same switch style as the in-calibration toggle). Wires to existing `PATCH /api/floor-plans/{id}/status`. If a plan has no published version yet, the toggle prompts the user to open the calibration page.
- Fixed **meeting rooms being wiped on publish**. `handlePublish` in `SeatCalibrationPage.jsx` now includes `rooms` in the pre-publish draft PUT so calibrated meeting rooms ride along into the new live version.
- `PublishDialog` now also surfaces meeting-room delta (added / removed) and total room count so going Live makes both seats and rooms explicit in the confirmation.
- Meeting Room Calibration tooling restyled to brand orange (#ec9324): tool buttons, selection panel, room border/handle, drawing preview. Drawing preview dashed line trimmed from 2px → 1px to look like a guide instead of a hard frame.
- Room label inside calibration now uses **container-query units** (`clamp(7px, 18cqh, 16px)`) so the text scales smoothly with the room rectangle (and therefore with zoom), instead of being fixed at 10px.


## Update Feb 11, 2026 — Workstation seat label polish

- `WorkstationSeat.jsx`: moved the workstation number label from the geometric centre of the bounding box (`top: 50%`) to **`top: 69%`** so it sits squarely on the chair body of the new top-down silhouette instead of floating over the backrest connector.
- Bumped label font size by +2px (`Math.max(5, size * 0.25 + 2)`) and increased weight from `bold` to `900` for readability at all zoom levels.



## Update Feb 23, 2026 — Teams two-shade gradient color picker (60+ shades)

- **New shared util** `/app/frontend/src/lib/teamColors.js` — exports `TEAM_PALETTES` (60 two-stop gradient palettes with stable ids `tp1`..`tp60`) plus helpers `teamBackground(value)`, `teamSolid(value)`, `suggestNextPalette(used)`, `teamInitials(name)`, `paletteForTeam(value)`. Helpers transparently fall back for legacy hex values so old `team.color` strings still render.
- **TeamsPage (`/admin/teams`)**: replaced the small hex-swatch row + `<input type="color">` picker with a **60-swatch gradient grid** styled exactly like the Employee avatar palette — each swatch is a 36×36 rounded-full circle showing the live team initials over a two-shade `linear-gradient(135deg, stop0, stop1)`. Auto-selects the first unused palette id on create. The **Color column** in the team list now renders a 36×36 gradient circle with the team's initials (e.g. `AQ`, `DT`) instead of a 24×24 flat hex square.
- **Consumers updated** to use the new gradient (so palette ids and legacy hex both render):
  - `EmployeeDashboard.jsx` — top profile circle (`style.background = teamBackground(user.team_color)`).
  - `ContactListPage.jsx` — both the card view and the table row team-color chip.
  - `WorkstationSeat.jsx` — SVG fill resolves the palette id to a single hex via `teamSolid()` so the floor-map seat still renders correctly when a team uses a `tp*` id.
- **One-time migration** `/app/backend/scripts/migrate_team_colors_to_palette.py` — converts any team whose `color` is still a legacy hex (e.g. `#ec9324`) into the next unused palette id. Idempotent: only touches teams whose color does NOT already start with `tp`. Run-once on Feb 23 2026 migrated all 4 legacy teams (Aquaholics → tp5, Design Squad → tp4, Research Team → tp3, DQ Team → tp2).
- Backend (`/api/teams`, `/api/teams/colors`) untouched — `color` is still `Optional[str]` so palette ids store transparently. `TeamCreate.color` default left at `#ec9324` for backwards compatibility; frontend overrides it on create.
- Frontend test ids: `team-color-grid` (container), `team-color-tp1`…`team-color-tp60` (each swatch), `team-swatch-{name}` (list-row circle). Legacy `team-color-picker` / `team-color-{hex}` ids removed intentionally.
- Verified by frontend testing agent (iteration_5.json) — 10/10 flows pass, including create/edit/persistence-after-reload, legacy-hex fallback, and Employee Dashboard regression.

## Update Jul 05, 2026 — Workstation Booking: Team Auto Assignment mode

- New Booking Mode toggle in `WorkstationBookingPage.jsx`: **Manual Selection** (original) vs **Team Auto Assignment**.
- Auto Assignment workflow:
  1. User picks a Team → sidebar shows team name + total member count (union of `member_ids` + `manager_ids`).
  2. User clicks a starting workstation on the floor map.
  3. Frontend natural-sorts all seat labels alphanumerically (G1, G2, …, G20, H1, H2, …) via `String.localeCompare(…, {numeric:true})`, then walks forward from the starting seat skipping booked/pending workstations until N available seats are collected (N = team size).
  4. If fewer than N available seats can be found from that starting point, an error toast asks the user to pick a different starting workstation. Otherwise the proposed seats are highlighted on the map and shown as removable chips in a "Proposed Selection" card (Team Name, Team Size, Selected count, seat chips).
  5. Three actions: **Confirm Booking** (submits), **Modify** (clears seats but keeps team so user can re-pick starting seat — chip-X and additional map clicks also allow inline add/remove), **Cancel** (full reset).
- Submit path: single API call `POST /api/workstation-bookings` (or `/workstation-requests` in request mode). Employees are drawn randomly from the team's available pool. In the edge case where the user modifies the proposal down to a single seat, the submit falls back to the `employee_id` payload shape (backend requires it for 1-seat bookings).
- Manual mode is untouched — all its dropdowns, allocation modes, recurring options and validation continue to work; switching modes clears the seat selection.
- Test IDs added: `ws-booking-mode-toggle`, `ws-mode-manual`, `ws-mode-auto`, `ws-auto-team-select`, `ws-auto-team-info`, `ws-auto-team-size`, `ws-auto-instruction`, `ws-auto-proposed`, `ws-auto-chip-<seatId>`, `ws-modify-button`.
- Verified end-to-end on the InfraXcellence team (16 members): auto-selected 16 seats in natural label order, allowed chip-based modification down to 15 seats, submitted successfully and persisted to MongoDB Atlas (`app_db.workstation_bookings`).


## Update Jul 05, 2026 (b) — Team Auto Assignment: Preview + Auto-center + Best-block suggestion

Follow-up polish on the Team Auto Assignment mode:

1. **Preview Before Assignment** — the Proposed Selection card now shows a dedicated **Starting** row (`data-testid="ws-auto-start-label"`) alongside Team / Team Size / Selected. No booking is created until the user clicks Confirm; Modify keeps the team but clears the seat proposal so the user can re-pick a starting workstation; Cancel is a full reset.
2. **Auto-center map** — the page passes `zoomToSeatIds={selectedSeatIds}` to `WorkstationFloorMap` while `bookingMode === "auto" && autoPhase === "proposed"`. The map's existing bbox-anchor / `zoomToElement` logic then smoothly pans + zooms so the entire proposed block fits in the viewport (250ms easeOut). Re-zooms on every chip-add / chip-remove so a modified block stays framed.
3. **Best-Available Suggestion** — when the user's chosen starting workstation cannot accommodate the whole team, a new helper `findNearestValidStart(chosenStartId, count)` fans outward (forward-first) from the chosen seat in the natural-sort order and returns the closest starting seat whose forward-walk yields N available seats. A shadcn Dialog (`ws-auto-suggestion-dialog`) shows the message *"N consecutive workstations are not available from X. The nearest available block starts at Y. Would you like to use this instead?"* with three actions: **Use Suggested Block** (`ws-suggestion-use`), **Choose Another Starting Workstation** (`ws-suggestion-choose-another`), **Cancel** (`ws-suggestion-cancel`). Only fires when a suggestion exists — if the whole floor lacks any block of size N, an explanatory toast is shown instead.

Verified end-to-end on the InfraXcellence team (16 members): mid-plan click centered the map on the I/J/L/M block; clicking `Z10` triggered the dialog, `Use Suggested Block` accepted `Y5…Z10` and re-centered on the Y-Z region.

