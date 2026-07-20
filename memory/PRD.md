# Infollion Utilities — PRD


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

