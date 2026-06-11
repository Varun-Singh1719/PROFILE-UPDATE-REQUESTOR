# Infollion Utilities — PRD

## Overview
Internal admin platform for Infollion. Combines:
- **ProfiX** — Ticketing / requests workflow.
- **Workspace Manager** — Floor calibration, desk/seat booking, meeting room booking, and a **centralized Bookings module** that aggregates every booking in one searchable / filterable / exportable table.
- **Manage** — Teams, Permissions, Email Templates, Notifications, Employee list.

## Core Personas
- **Super Admin** — Full access incl. employee/team/permission management.
- **Admin** — Day-to-day operational access (no employee/permission edits).

## Latest delivered feature (Feb 2026)
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
