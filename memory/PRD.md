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
