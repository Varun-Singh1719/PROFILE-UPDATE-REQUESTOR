# Infollion Utilities — PRD


## Session Aug 18 2026 — Permission filter ID display + Workstation auto-assign popup layout
- **Manage → Employees → Permission Set filter** (`ContactListPage.jsx`): dropdown rows now show Name + bare numeric ID (orange) only — removed the "ID :" prefix from the `meta` render. Verified visually (e.g. "HR 171").
- **Workstation Booking → Team Auto Assignment "Not enough consecutive seats" dialog** (`WorkstationBookingPage.jsx`): footer buttons were overflowing the box. Replaced `DialogFooter` (sm:flex-row) with a vertical `flex flex-col gap-2` of full-width buttons (Use Suggested Block / Choose Another / Cancel); capped `DialogContent` width (`max-w-[calc(100vw-2rem)] overflow-hidden`) and added `break-words` to the description so text/buttons stay inside the box.
- **Env restore (this container)**: recreated `/app/backend/.env` (Atlas `cluster0.vmgql1i.mongodb.net` · `app_db` · user `sakshamsinghal_db_user`, per user-supplied creds; fresh JWT_SECRET + FERNET_KEY) and `/app/frontend/.env` (`REACT_APP_BACKEND_URL` = preview URL). Backend was crash-looping (KeyError JWT_SECRET). Installed missing `tzlocal` (added to requirements) so the daily scheduler starts. Login verified `admin@ticketing.com / Admin@123`.


## Session Aug 16 2026 (rev-5) — ProfiX dashboard + filters-respect-Enable + Floor Layout + Workstation form (ALL TESTED ✅)
Verified by testing agents (backend + frontend), all PASS:
- **Recent Updates by update-date** (`dashboard.py`): `/dashboard/recent?kind=updated` now windows on `updated_on` (created_on for `new`), so a request created earlier but updated in-window (e.g. TKT-1120: created Jul-29, updated Aug-16) appears.
- **Filters respect Enable** (ProfiX ticket lists, `TicketListPage.jsx` + `DeferredSearchInput`/`DateFilter`): Shown+Enable-off → filter greyed/disabled; Hidden → not rendered; added `filter_id/team/created_by` gating.
- **ProfiX Dashboard Metric required** (`PermissionsPage.jsx` + `permissions_v3.py`): when a dashboard access level is granted, save is blocked (frontend red-error + toast; backend 400) unless Created By / Assigned To is chosen.
- **ProfiX Dashboard Team section** (`AdminDashboard.jsx`): hidden for Individual; shown for Manager & Overall (Super Admin=overall).
- **Floor Layout Team filter** (`FloorLayoutPage.jsx` + `core.py`): added `filter_team` to catalog (permission-gated hide/enable); dropdown now lists ALL teams (from `/teams`) not just booked ones; selection persists across date changes (resets only on plan change).
- **Request Workstation employee scoping** (`WorkstationBookingPage.jsx`): Employee Name field scoped by desk-booking (workspace_manager) dashboard access — Individual auto-locks to self ("You can only book for yourself"), Manager lists team members, Overall lists everyone.
- Env note: ProfiX dashboard aggregations are Atlas-backed (~8-10s load). Backend `.env`/`frontend/.env` restored earlier this session; TicketTable.jsx syntax error fixed.



## ProfiX Filters now respect the "Enable" toggle (Aug 16 2026)
- **Behavior**: On the ProfiX ticket-list pages (All / Open / Unassigned — all rendered by `TicketListPage.jsx`), each filter now honours BOTH permission toggles:
  - Visibility **Hidden** → filter not rendered (unchanged).
  - Visibility **Shown** + Enable **on** → filter rendered and interactive (unchanged).
  - Visibility **Shown** + Enable **off** → filter rendered but **greyed-out / disabled** (NEW — previously it was fully usable).
- **Impl**: `TicketListPage` passes `disabled={!permFilterX.canUse}` to every filter (`filter_id`, `search`, `filter_status`, `filter_priority`, `filter_team`, `filter_created_by`, `filter_assignee`, `filter_date`). `canUse = enabled && visible`. Added a `disabled` prop to `DeferredSearchInput.jsx` and `DateFilter.jsx`; `MultiSelectFilter.jsx` already supported it.
- **Verified** via impersonating Aanchal Sharma (set #166): Status set to Shown+Enable-off → greyed & non-clickable; Priority (Enable-on) → active; Assignee (Hidden) → absent. Also matched the user's own live config where Team/Created By were Shown+Enable-off → both rendered greyed.
- **Audit of other Permission-tab pages**: Only ProfiX pages currently permission-gate their FILTERS. Every other list page (Employees, Teams, Notifications Outbox, Email Templates, Bookings, Meeting Rooms, Workstation, Pending Approvals, Floor Plans, CRM) does **not** gate its search/filter controls by permissions at all (their action BUTTONS already respect enable+visibility). So "make filters respect Enable" has no effect there yet — wiring full filter gating (visibility + enable) on those pages is a separate, larger task pending user confirmation.
- Testing agent NOT deployed (per user instruction).



## ProfiX Permissions — Filter-visibility fix + build repair (Aug 16 2026)
- **Root cause**: The whole app was down/stale — (1) both `backend/.env` and `frontend/.env` were missing, and (2) `frontend/src/components/TicketTable.jsx` had a **syntax error** (the `renderRowActions` arrow function was converted to a block body `=> {` for the "empty-menu auto-hide" feature but was never closed with `};`), so webpack failed to compile and the user kept seeing the last-good (pre-fix) bundle.
- **Fixes**:
  - Recreated `backend/.env` (Atlas `cluster0.vmgql1i` · DB `app_db` · user `sakshamsinghal_db_user`, per user-supplied creds; fresh JWT_SECRET + FERNET_KEY) and `frontend/.env` (`REACT_APP_BACKEND_URL` = preview URL).
  - Added the missing `};` in `TicketTable.jsx` → frontend compiles again.
- **Verified (Permission Set #166 "Research Associate", assigned to Aanchal Sharma, Admin)**:
  - Editor → ProfiX → All Requests → Filters now shows all toggles incl. **ID / Team / Created By** (Team & Created By = Shown) and **Assignee = Hidden** (red badge). Catalog already carried these keys in `backend/core.py`.
  - Impersonating Aanchal on `/admin/open-tickets` → filter bar renders only Search / Status / Priority / Date; the **Assigned To filter is correctly hidden** (enforced via `EffectivePermissionsContext` + `TicketListPage`).
  - Same page-level gating applies to Open Requests & Unassigned (catalog + `permPageKey`).
  - Empty-menu auto-hide (⋮ hidden when a row has zero visible actions) is implemented in `TicketTable.jsx` and now compiles.
- Testing agent NOT deployed (per explicit user instruction). Note: if the user was testing a **deployed** build, they must redeploy (Save to GitHub → deploy) to pick up these fixes.



## CRM → Client Contacts — Country dropdown fix + Detail/Card redesign (Aug 08 2026)
- **Country dropdown bug fixed**: the custom `CountrySelect` (portal popup) was un-clickable & keyboard-dead inside the Radix Dialog. Replaced it with the existing shared **`SearchSelect`** (single-select) — same Link-Segmentation UX, works in dialogs (z-9999 + pointer-events + capture-stopPropagation), full keyboard nav (↑/↓/Enter/Home/End). Deleted `components/CountrySelect.jsx`. `onChange` derives `country_name` via `getCountryName`.
- **City now optional**, **Country required** (removed `city` from `REQUIRED_CC_FIELDS`; label "City" vs "Country *").
- **New `HoverTip` component** (in ClientContactsPage) — dark gray-900 group-hover bubble, identical to CRM → Client Detail → POC Status Configuration tooltip.
- **Detail view redesign** (`ClientContactDetail`):
  - Removed the separate Location/Region bar.
  - Location now renders as **"City, Country"** (e.g. "Mumbai, India") in the name-bar meta row.
  - **Region** shown as a new icon (`Public` globe) + region name right after Location (auto-derived from `country_id`).
  - Hover tooltips added for Email, Phone No, Location, Region, Designation, Client, Status.
  - **Status** chip moved to the top-right corner; **Edit** turned into an icon-only round button placed **below** Status (exact POC-Status-Configuration button style + "Edit" hover tooltip). `data-testid="cc-detail-edit"` kept.
- **Card view redesign** (`ContactCard`) → full-width horizontal row (list grid is now single column):
  - Removed the client-name firm logo, the metrics row, the View button and the CopyableContactIcon.
  - Row 1: avatar · name · ID · client chip … (right corner) Status pill + Edit + Delete icons.
  - Row 2: Designation (wraps to new line if long) with **Location** parallel on the right (renamed from "Base Location").
  - Row 3: Email + Phone. Responsive via flex-wrap.
- Verified via 4 Playwright screenshots (country click-select = United Kingdom; card list; detail with Mumbai, India + LATAM region + Region tooltip). Testing agent NOT deployed per user instruction.



## CRM → Client Contacts — Base Location split into City + Country + auto Region (Aug 07 2026)
- **Base Location → City + Country**: the single "Base Location" field in the Add/Edit Client Contact form (`ContactFormDialog`) is now two required fields — **City** (text `Input`) and **Country** (searchable dropdown).
- **Country data**: new `frontend/src/data/countries.js` (AUTO-GENERATED from the user-supplied `Country List.xlsx`, 197 rows). Exports `COUNTRIES`, `COUNTRY_OPTIONS`, `regionCountryMap` (verbatim business mapping), `REGION_LABELS`, `getCountryName(id)`, `getRegionByCountryId(id)`. The country **id is preserved** for future reference.
- **Country dropdown UX**: new `frontend/src/components/CountrySelect.jsx` — a **single-select** clone of the CRM → Client → Link Segmentation "Select segmentation" dropdown (`SegLinkMultiSelect`): orange `#ec9324` accent, inline search, `createPortal` popup that follows scroll/resize, checkmark on the selected row, outside-click/Esc close, clear (×) button.
- **Backend** (`routers/client_contacts.py`): added `city: Optional[str]`, `country_id: Optional[int]`, `country_name: Optional[str]` to `ClientContactBase` and `ClientContactUpdate`. Legacy `base_location` kept and auto-composed as `"City, Country"` on save (frontend) so existing list/card/export displays keep working. Verified persistence via create→get→delete (city/country_id/country_name round-trip OK).
- **Region (detail view)**: `ClientContactDetail` now shows a **Location** card with City · Country · **Region**, where Region is auto-derived from `country_id` via `getRegionByCountryId` (first-match-wins on the user's overlapping id lists). Region renders as an orange badge (e.g. India id 39 → **LATAM** per the supplied map).
- Edit flow: legacy records (only `base_location`) pre-fill City from `base_location`; user picks a Country on next edit.
- Verified via 3 Playwright screenshots (Country dropdown open+search, form with City/Country, detail Location card w/ Region=LATAM). Testing agent NOT deployed per user instruction.



## CRM Forms — Notched-Outline Field Headers (Aug 07 2026)
- **Goal**: Make every field header/label in the CRM Add/Edit forms sit "notched" on the control's top border (Material-UI outlined style) so the header stays visible whether the field is **blank or filled** — matching the user-supplied reference screenshots.
- **New shared component**: `frontend/src/components/FloatingField.jsx` — wraps a bordered control and renders the label absolutely at `-top-2 left-3` with a solid `labelBg` (default `bg-white`, override to `bg-gray-50` on grey surfaces) punching through the border.
- **Applied to (3 of the 4 CRM pages that have data-entry forms)**:
  - **Clients** (`ClientsPage.jsx`) — Name, Type now use `FloatingField` (removed stacked shadcn `Label`).
  - **Segmentations** (`SegmentationsPage.jsx`) — Name, Description now use `FloatingField`.
  - **Client Contacts** (`ClientContactsPage.jsx`) — local `Field` wrapper rewritten to the notched style (auto-updates Name / Designation / Email / Phone / Client Name / Base Location / work-experience rows); "Web Handle" converted; work-experience `Field`s pass `labelBg="bg-gray-50"`; grid spacing bumped to `gap-y-5` so labels don't crowd.
  - **Overview** (`CrossSegmentationOverviewPage.jsx`) — **skipped** (it's a zoom/pan canvas with no data-entry form, per user).
- Existing orange (`#ec9324`) focus accent preserved on all controls.
- **Env restore**: recreated missing `backend/.env` (Atlas `cluster0.vmgql1i` · `app_db` · user `sakshamsinghal_db_user`, per user creds; new JWT_SECRET + FERNET_KEY) and `frontend/.env` (`REACT_APP_BACKEND_URL` = preview URL). Backend was crash-looping (KeyError JWT_SECRET) before this. Login verified `admin@ticketing.com / Admin@123`.
- Testing agent NOT deployed (per user instruction). Verified via 4 Playwright screenshots: CC blank, CC filled (incl. grey work-experience card), Clients form, Segmentations form.



## CRM → Segmentation — Cross-Segmentation Level-2 Linking UI/UX Mockups (Aug 04 2026)
- **Purpose**: static visual mockups to compare 3 candidate UI/UX approaches for linking a Level-2 node of one Segmentation to Level-2 nodes of other Segmentations (many-to-many tag). **Mockups only — no backend wiring, no persistence.**
- **New route**: `/crm/segmentation-link-mockups` (registered in `App.js`, gated `ADMIN_ROLES`).
- **File**: `frontend/src/pages/SegmentationLinkMockupsPage.jsx` (~1000 lines, self-contained mock data for 3 companies × 4-6 L2 nodes each and 6 pre-seeded cross-links).
- **Three tabs, each with Best-For / Not-Ideal / Interaction-Model bottom cards**:
  1. **Concept A · Chip Drawer** — click a L2 node in the source tree → right-side drawer shows existing links as coloured chips + "+ Link Node" opens a segmentation-grouped searchable multi-select modal.
  2. **Concept B · Dual-Tree Linker** — split canvas: left panel = source segmentation nodes, right panel = target segmentation (dropdown switcher). Drag from a left card and drop onto a right card to link. Existing links render as dashed orange arcs; unlink from the right sidebar.
  3. **Concept C · Constellation Graph** — force-directed-style clustered view: all L2 nodes across all segmentations plotted around per-segmentation cluster anchors. Hover a node → highlight all its links; click → focus in side panel. Filter tabs: All / Linked / Unlinked.
- **Env**: recreated `/app/backend/.env` (Atlas cluster0.vmgql1i.mongodb.net · `app_db` · user `sakshamsinghal_db_user`, per user-supplied creds) and `/app/frontend/.env`. JWT_SECRET + FERNET_KEY regenerated. Login verified for `admin@ticketing.com / Admin@123`.
- Testing agent NOT deployed per user instruction. Verified via 3 playwright screenshots at 1600×1000 — Concept A default view, Concept A picker modal open, Concept B, Concept C.


## CRM → Client Contacts — Card + Form + Colour polish (Aug 3 2026 rev-4)
- **Single-orange colour scheme** — killed the "rainbow" from earlier rev.
  - `TotalTillDateChips` now uses one orange scheme for all four chips (Projects / Serviced / Calls / Revenue).
  - `ActivitySummary` pivot: every row (dot + label text + Total column value) is orange. The Total column background stays orange-tinted.
  - `MetricMini` on the card is orange for all four metrics.
- **Phone number split** — Add/Edit dialog now uses the shared `ISDPicker` + a numeric-only `Input`, exactly like Manage → Teams → Add Contact (Employee). Backend `ClientContactBase` / `ClientContactUpdate` gained an `Optional[str] phone_isd` field; bulk-upload template got a dedicated `ISD` column. A small `splitLegacyPhone(row)` helper auto-splits legacy `"+91 9876543210"` values into `{ phone_isd: "+91", phone: "9876543210" }` when opening the edit dialog so old records render cleanly. `DEFAULT_ISD` (`+91`) is used as the fallback.
- **Card view redesign** (per screenshots supplied):
  - Initials pill moves left; **name is now on the top-left**, followed by a small **LinkedIn icon** and a **combined phone-msg icon** immediately after the name. ID row sits below the name.
  - **New `CopyableContactIcon` component** (uses MUI `PermPhoneMsgOutlined` icon = envelope-with-phone-receiver hybrid, matching your screenshot 1). States:
    - **Green pill** when either email or phone is available → hover tooltip **"Available"**.
    - **Grey pill** when neither is available → hover tooltip **"Not Available"**, no popover.
    - **Click** (when green) → Radix `Popover` opens with clickable rows for phone and email (matches screenshot 2). Each row has an icon + value.
    - **Hover a row** → dark tooltip **"Copy mobile number"** / **"Copy email address"** (matches screenshot 3). **Click a row** → copies to clipboard via `navigator.clipboard.writeText`, shows a green "COPIED" flash + `notify.success` toast, then auto-hides.
  - **New `LinkedInIconBtn` component** — small round pill with the MUI `LinkedIn` icon:
    - **Blue (`#0a66c2`) + white icon** when URL is present → tooltip **"Click to Open"**. Click → `window.open(url, "_blank", "noopener,noreferrer")`.
    - **Grey + white icon** when no URL → tooltip **"Not Available"**, click is a no-op (`disabled`).
  - Card bottom action bar reduced to Edit / View / Delete (email / phone / linkedin removed since they moved to the header row).
- **Detail-page header** — phone display now prefixes the ISD (`+91 9999900000`).
- **DuplicateWarningDialog** — the existing-record card now also shows the ISD prefix before the phone digits.

Verified via 8 playwright screenshots at 1600×1000:
  1. Card list with two rows — one green (John Doe) + one grey (Empty Contact) — plus "Not Available" tooltip on the grey icon.
  2. Combined popover open on the green card showing `+91 9999900000` and `john@acme.com`.
  3. "Copy mobile number" tooltip on hover.
  4. Edit dialog with `ISDPicker` (`+91 IN`) split cleanly from mobile digits (legacy `+91 9999900000` auto-split into `+91` + `9999900000`).
  5. Detail page — 4 orange total-till-date chips + pivot rows all-orange.



## CRM → Client Contact Detail — Pivot table + full-width polish (Aug 3 2026 rev-3)
- **Detail-page layout fix**: dropped `max-w-6xl` on the outer container so the page now spans the full viewport width (removed the big empty gutter on the right). Sections stretch edge-to-edge with the existing `px-6` container padding.
- **Total-till-date chips** — new `TotalTillDateChips` component sits between the name/header card and the Industries card. Four coloured pill-cards (orange Projects / emerald Serviced / blue Calls / purple Revenue) each showing `TOTAL TILL DATE · {value}`. Values default to `0` (`$0` for Revenue) until the calc pipeline lands; will pick up real numbers automatically when the detail response starts including `totals_till_date`. Test-ids: `cc-total-chips`, `cc-total-chip-projects` / `-serviced` / `-calls` / `-revenue`.
- **Activity Summary → pivot table**: rewrote the summary section.
  - **Rows** (4): Projects (orange), Serviced (emerald), Calls (blue), Revenue (purple). Each row label carries its accent-coloured dot.
  - **Columns**: one per month spanned by the DateFilter range, followed by a **Total** column with an orange highlight background.
  - **Missing months show `0`** (or `$0` for Revenue) exactly as requested. Non-zero cells render bold; zero cells render in light grey (`text-gray-300`) so the sparse-vs-dense pattern is visible at a glance.
  - **Default range** changed from Last 6 Months to **Last 12 Months** (`getLast12MonthsRange`, 12 columns inclusive of the current month).
  - Sticky first column (Metric names) so users can scroll the months horizontally on narrow screens without losing context.
  - Handles all 4 filter modes via new `monthsInRange(filter)` helper:
      * `between` — every month from `from` to `to`
      * `on`      — the single month containing `from`
      * `before`  — 12 months ending at `from`
      * `after`   — 12 months starting from `from` (capped at 12 to stop unbounded ranges)
    Cap of 36 columns overall so a pathological range doesn't render a 500-column table.
  - Section header dynamically summarises the active range as e.g. "12 months · Sep 25 → Aug 26"; a footer label reaffirms "Default range: **Last 12 Months**".
  - Test-ids: `cc-activity-pivot`, `cc-activity-row-projects` / `-serviced` / `-calls` / `-revenue`, and the existing `cc-activity-date-filter-*` still work.
  - Accepts an optional `data` prop of shape `{ projects: {"YYYY-MM": n}, serviced: {…}, calls: {…}, revenue: {…} }` — when the backend calc pipeline is added later, wiring is a one-liner (`<ActivitySummary … data={row.activity} />`) and every "0" cell will populate automatically.
- Verified via playwright screenshots at 1600×1000: default view (Sep 25 → Aug 26, 12 columns) and "Before Sep 01 2025" mode (Oct 24 → Sep 25, 12 columns) — both re-render instantly on filter change with 4 rows × 12 months × 1 total column.



## CRM → Client Contacts — Duplicate Detection + Bulk Import/Export (Aug 3 2026)
- **Duplicate detection on create + edit**:
  - `POST /api/client-contacts` and `PATCH /api/client-contacts/{id}` now return **HTTP 409 `DUPLICATE_CLIENT_CONTACT`** with a `duplicates: [...]` payload (each row carries `display_id`, `name`, `email`, `phone`, `client_name`, `designation`, `match_on: ["email"|"phone"]`) when the submitted email or phone collides with any existing contact.
  - Match logic: email is lower-cased/trimmed; phone uses `_phone_key` (trailing 10 digits) so `+91 9876543210` == `9876543210` == `919876543210`.
  - Frontend shows a new `DuplicateWarningDialog` (amber, testid `cc-duplicate-dialog`) listing every conflicting record with its `EMAIL MATCH` / `PHONE MATCH` pill. Two actions: **Cancel** (default) and **Save anyway** which re-submits with `?force=true`.
  - Bonus: new `GET /api/client-contacts/check-duplicate?email=&phone=&exclude_id=` for future live-typing hints — not yet wired into the form.

- **Bulk Upload / Upload History** — mirrors Employee bulk-upload (`ContactListPage.jsx` + `contact_uploads.py`) 1:1:
  - New backend router `backend/routers/client_contact_uploads.py` registered in `server.py` **before** `client_contacts.py` (order matters — the dynamic `/client-contacts/{contact_id}` would otherwise swallow the static routes). Endpoints:
    - `GET  /api/client-contacts/sample-template?format=csv|xlsx` — styled orange-header .xlsx with 2 sample rows + Instructions sheet, or a comment-embedded .csv variant.
    - `POST /api/client-contacts/bulk-upload`                    — accepts `.xlsx` / `.csv`, validates every row (name required, email format, in-file + against-DB uniqueness on email+phone, Client Name must match an existing Segmentation, unknown Industries are dropped and reported as a warning), partial-inserts every valid row via the same `_next_display_id` counter as single-create so numeric IDs stay consecutive.
    - `GET  /api/client-contacts/upload-history`                 — paginated past-sessions list.
    - `GET  /api/client-contacts/upload-history/{id}`            — one session with embedded errors.
    - `GET  /api/client-contacts/upload-history/{id}/error-report.xlsx` — Excel error report (Row / Contact Name / Error Reason + Upload Info sheet).
  - New Mongo collection: `client_contact_uploads` (same shape as `contact_uploads`).
  - Audit logged as `client_contact.bulk_upload` via the existing `log_audit` helper.

- **Frontend additions (`ClientContactsPage.jsx`)**:
  - Two new toolbar buttons: **Upload History** (grey outline, `data-testid="cc-upload-history-btn"`) and **Upload Contacts** (orange outline, `data-testid="cc-open-bulk-upload-btn"`), sitting next to the primary "+ Client Contact" button.
  - `BulkUploadModal` — CSV / XLSX template download buttons, live example-rows table (8 columns), drag-drop dropzone (`cc-upload-dropzone`), XHR progress bar, success/failed/total summary, inline error preview (first 10), and per-session error-report download.
  - `UploadHistoryModal` — sortable table of past sessions (file, uploaded-by, when, totals, status pill, download-report button per row).
  - `DuplicateWarningDialog` — described above.
  - Reused helpers: `downloadBlob`, `authedFetch` (added inline; identical to the Employee page). `API` and `__busyBridge` imports added.

- **Testing agent NOT deployed** per user instruction. Verified end-to-end via playwright + backend curl:
  - Sample template → downloaded (6.6 KB XLSX).
  - Bulk upload of a 3-row CSV → returned `{total:3, success:2, failed:1, status:"Partial"}` with the duplicate-email row rejected (row 4: "Email already exists in the client-contact directory").
  - Upload History correctly lists the just-completed session with a red **Report** button.
  - Duplicate detection dialog fires on single-create when trying to reuse John Doe's email — shows the `#1042 · John Doe · Partner` card with a green **EMAIL MATCH** pill, and Save-anyway succeeds with `?force=true`.
  - Phone dedup verified across ISD-code variations (`+91 9876543210` matches `9876543210`).



## CRM → Client Contacts — spec-verbatim rev-2 (Aug 3 2026)
- New route registered: `/crm/client-contacts` (list) + `/crm/client-contacts/:id` (detail) in `App.js`. Sidebar link already existed.
- `frontend/src/pages/ClientContactsPage.jsx` completely rewritten:
  - Uses `Layout` shell (dropped the stub `PageContainer`) so it matches every other admin page.
  - Toolbar now has: `DeferredSearchInput` + `Client Name` SingleSelect filter (chip-style, L1 segments) + Sort dropdown (5 options: Newest / Oldest / Name A→Z / Name Z→A / ID ascending) + paginated card grid (12 / 24 / 48 / 96 per page, using the shared `Pagination` component).
  - Industry (L2 multi-select) now uses **`MultiSelectFilter` in `searchInTrigger` mode** — same UX as Manage → Teams → Add Team Member — with removable chips rendered below the trigger. Auto-clears industries when the Client Name changes to keep the L2 subset valid.
  - Previous Work Experience Start Date / End Date use a new **`MonthYearPicker`** (two side-by-side Month + Year `<select>` dropdowns). End Date supports a "Present" option. Values are persisted as `"MMM YYYY"` strings so the existing backend schema (`start_month_year`, `end_month_year: Optional[str]`) needed no changes.
  - Card view redone to match the reference screenshot: bold Name + orange initials pill, ID row, meta rows (Client Name / Designation / Base Location), 4-metric row (Revenue / Calls / Serviced / Projects — placeholders), bottom icon bar with Edit / View / Email / Phone / LinkedIn / Delete. Email + Phone icons show the full value via a shadcn Radix `Tooltip` on hover (`TooltipProvider` wraps the page).
  - Detail (View) page keeps the header Edit button, shows all fields, plus `Last Project Receiving Date` + `Last Call Date` placeholders and an `Activity Summary` section powered by the shared **`DateFilter`** — same look/feel as ProfiX's Created At filter, all 4 modes exposed (Between / On / Before / After). Default range = last 6 months (helper `getLast6MonthsRange`). All four metric cards visibly pulse to 50% opacity when the filter changes so the UX contract ("range change → all 4 metrics refresh together") is visible even though the calc pipeline is still a placeholder.
- New file: `frontend/src/components/MonthYearPicker.jsx` — 90 lines, no external deps, testids `{prefix}-month` / `{prefix}-year`.
- Backend `routers/client_contacts.py` was already complete from Phase 1 — no changes needed. Its `?client_name=<L1>` query param drives the new Client Name filter chip on the list page.
- `.env` files were missing on this fresh container; restored `/app/backend/.env` (MongoDB Atlas `cluster0.vmgql1i.mongodb.net` / `DB_NAME=app_db` / user `sakshamsinghal_db_user` per user-supplied credentials) and `/app/frontend/.env` (REACT_APP_BACKEND_URL). Regenerated JWT_SECRET + FERNET_KEY. Login verified end-to-end for `admin@ticketing.com / Admin@123`.
- Testing agent NOT deployed per user instruction. Verified visually via playwright screenshots: list view, create dialog (with Month/Year selects visible), detail view with Activity Summary + DateFilter popup showing all four modes and dual calendars.



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



## Session Sep 05 2026 — CRM → Client → Client Contacts tab → contact detail POP-UP: trackpad swipe navigation
- **Env restore**: recreated `backend/.env` (Atlas `cluster0.vmgql1i` · `app_db` · user `sakshamsinghal_db_user`, fresh JWT_SECRET/FERNET_KEY, APP_PUBLIC_URL) and `frontend/.env` (`REACT_APP_BACKEND_URL` = preview URL). Login `admin@ticketing.com / Admin@123` OK.
- **Scope**: the Client Contact detail **pop-up** (`ClientContactDetailModal`) opened from CRM → Client detail → "Client Contacts" tab (`ClientWorkexContacts`). The standalone `/crm/client-contacts` page is unchanged.
- **New** `hooks/useTrackpadSwipeNav.js`: non-passive `wheel` listener on a target element (the dialog scroll container) → one `onSwipe('next'|'prev')` per horizontal gesture (dominance |dx|>1.5·|dy|, 70px threshold, lock until 350ms idle, vertical-cancel after 30px vertical travel, fresh-swipe-during-inertia detection, preventDefault on horizontal events to stop browser back/forward swipe). Ignores events in OTHER dialogs (e.g. Edit form on top).
- **`ClientWorkexContacts`**: `navIds` = ids of the active sub-tab list (Current / Ex) in on-screen order → `ClientContactDetailModal navIds onNavigate={setOpenContactId}`.
- **`ClientContactDetailModal`**: captures `DialogContent` ref as `scrollEl`; forwards `swipeNav={ids,onNavigate,scrollEl}` to `ClientContactDetail`.
- **`ClientContactDetail`** (`swipeNav` prop): slide out/in on wrapper (`cc-detail-slide`, `data-slide-phase`), silent prefetch (no overlay), scroll pop-up to top, keep tab; boundary bump + hint; `n of N` counter (`cc-swipe-position`) top-right; sticky auto-hiding pill `‹ Swipe to navigate ›` (`cc-swipe-hint`). Disabled while edit/duplicate dialogs open.
- **Bug fix (pre-existing)**: `Shell` was an inline arrow component → `<Layout>` remounted on every render of the full-page view. Replaced with module-level `DetailShell`.
- Testing agent NOT deployed (per user). Verified by Playwright screenshots.
- **Follow-up (same session)**: ← / → keys inside the pop-up navigate like the swipe (ignored while typing / when Edit dialog is open); faint sticky **peek chips** with the previous / next contact name at the pop-up edges (clickable, brighten during a move); prev/next rows are **prefetched** silently on arrival (cache consumed on use) so navigation is ~230 ms even with Atlas latency. `ClientWorkexContacts` passes `navItems=[{id,name}]`.
- **MySQL sync (same session)**: user-supplied read-only MySQL (`172.105.61.195` · `test_infollion` · `test_infollion_user`) added to `backend/.env` as `MYSQL_*` (single-quoted password). Full sync run OK: 800 clients + 1072 client contacts linked/refreshed; 2-hourly scheduler active. Added `refresh_client_contact_counts()` to `crm_sync.run_full_sync` — `client_contact_count` (Clients cards "CONTACTS") was a never-computed placeholder; now counted from Mongo `client_contacts.client_name`.
- **MySQL mirror (same session)**: `crm_sync.py` rewritten — `MIRROR_TABLES` copies the 7 granted tables into `mysql_*` Mongo collections (granted columns only, `_id` = MySQL id, derived `client_contact_ids` / `client_contact_id`, indexes, deletions mirrored). Numbers computed from the mirror per agreed concept; `sync_clients`/`sync_contacts` bulk (~20s). Runs logged in `crm_sync_runs`. Schedule: **11:00 & 15:00 IST** (CronTrigger). New endpoints `GET /api/crm-sync/status`, `GET /api/crm-sync/mysql-export.xlsx` (tab per table). Clients page → **MySQL Excel** button. `backend/scripts/verify_crm_numbers.py` = SQL cross-check (ALL OK).
- **Excel to user (same session)**: in-app "MySQL Excel" button removed per user. Workbook (7 table tabs + `client_numbers`, `contact_numbers`, `definitions`) generated to `/app/exports/<token>/` and served by `GET /api/exports/{token}/{filename}` (unauthenticated, 32-hex token; delete folder to revoke). Source `calls.call_start_time` is NULL everywhere → `last_call_date` empty.
- **Schedule change**: auto-sync now 11:00 & 15:00 IST (was 15:00 & 23:00).
- **Bug fix**: Client detail total-till-date tiles used a seeded demo generator (buildTotals) → always 0; now read client_contact_count + totals_till_date (same as cards). Verified by testing agent.
- **Client Contact detail redesign (same session)**: Employment History = current employer (from contact's client_name/designation, start = end of latest past role) on top + past roles (Overview shows 2, Employment History tab shows all); orange (#ec9324) = current, blue-500 = past icons (also in tables); title renamed, add-button + Source removed; Employment Overlap shows all roles; "Projects/Calls by Client Contact" from new `GET /api/client-contacts/{id}/by-client` (employers from workex + numbers from MySQL mirror); header: POC Active/Dormant chip right-aligned, icon-only Sync/Edit (native title tooltip, Client-card style); sticky profile header + tabs (`cc-detail-sticky-header`, pop-up top-0 / page top-14); tabs overflow scroller removed; Client-tab mini cards show Projects/Serviced/Calls/Revenue. `Layout <main>` overflow-x-hidden → **overflow-x-clip** so sticky (incl. TopBar) works app-wide.


## Session Sep 05 2026 — CRM → Client Contact → Timeline (immutable audit history)
- **Renamed** detail-view tab "Activity Log" → **Timeline** (`cc-tab-timeline`); it was previously an empty placeholder.
- **Backend** `routers/client_contact_timeline.py` (new): collection `client_contact_timeline` — ONE doc per field change `{id, contact_id, batch_id, at (IST), user{id,name,email,emp_id}, event created|updated, field, field_label, action added|edited|deleted, previous_value, new_value}`. Values are string SNAPSHOTS taken at save time (never re-derived). Diff engine `diff_contact(old,new)`: scalars (Name, Email, Phone Number = ISD+number, Client, Designation, Type, City, Country, Web Handle), Industry per-item add/remove, Employment History per-row add/edit/delete (exact → company-name → position pairing; value "Company · Designation · Start – End"), generic fallback for any other editable key. Ignored (not profile): base_location, country_id, phone_isd (folded), sync metrics (totals/activity/last dates), poc cache, mysql_ref, audit stamps.
- **Hooks**: `client_contacts.py` POST → `created` batch (every populated field = Added); PATCH → `updated` batch (no batch when nothing changed); `client_contact_uploads.py` bulk insert → `created` batch. `crm_sync_api` metric sync is intentionally NOT recorded.
- **Read-only API**: only `GET /api/client-contacts/{id}/timeline?page&page_size` (batches newest-first, grouped by batch_id; `total_batches`, `total_changes`). POST/PATCH/DELETE → 405. Index `(contact_id, at desc)`.
- **Frontend** `ClientContactsPage.jsx` → `TimelineTab` / `TimelineBatch` / `TimelineChange`: batch header "Updated by <User> · EMP · Sep 05, 2026 · 03:50 PM" (orange marker = Created, blue = Updated), per-field rows with Added/Edited/Deleted pill and `Previous:` → `New:` chips; "Read-only" lock badge; count label; Load-older paging; refetches on `row.updated_on`. No edit/delete controls.
- Demo record left in DB for review: "Timeline Demo Contact" (display id 2149) with 4 batches.
- Env restored again (backend/.env Atlas creds per user, frontend/.env preview URL; `yarn install`). Smoke-tested via API script + Playwright screenshots. Testing agent NOT deployed (per user instruction).

## Sep 05 2026 — Client Contact detail POP-UP keeps a constant size across tabs
- `ClientContactDetailModal` (`ClientContactsPage.jsx`): `DialogContent` changed from `max-h-[92vh]` to fixed `h-[92vh] max-h-[92vh]` (width already fixed `w-[96vw] max-w-[1500px]`). The pop-up (opened from CRM → Client → Client Contacts) no longer shrinks on short/blank tabs (Employment History, Interactions, Notes, Timeline); content scrolls inside. Verified via Playwright: bounding box identical (1500×994 @1920×800) on all 5 tabs. Testing agent NOT deployed (user instruction).

## Sep 05 2026 — Employment History tab: circular "+" → Add Previous Work Experience (standalone form)
- `EmploymentHistoryTab` (`ClientContactsPage.jsx`) now receives `onSaved={setRow}` and renders a centred circular orange `+` (`cc-employment-add`, 40px, hover tooltip) below the last employment card.
- Click opens NEW `AddWorkExDialog` (`cc-add-workex-dialog`) — ONLY the previous-work-experience form (Company Name*, Designation*, Start Date*, End Date* incl. "Present"; same notched `Field` + `MonthYearPicker` UI as the Edit form). Save → `PATCH /client-contacts/{id}?force=true` with `{previous_work_experience: existing + new}` → row refreshed in place; Timeline records "Employment History — Added". The full Edit Client Contact dialog is NOT opened.
- Bug fix in shared `components/MonthYearPicker.jsx`: `parse()` now round-trips partial values ("Jun" / "2016"), so picking Month first then Year no longer drops the month (previously saved as "2016"). Also benefits the Edit Client Contact form.
- Verified via Playwright (button centred; validation; Mar 2014 – Present saved; Timeline entry). Testing agent NOT deployed (user instruction).

## Sep 05 2026 — Work experience rows: City + Country; Add Work-Ex dialog polish
- `WorkExperience` (backend `client_contacts.py`) gained `city`, `country_id`, `country_name`; validator collapses whitespace in city/company/designation. Timeline `_we_display` appends "· City, Country" when present and diffs on city/country_name.
- Frontend `EMPTY_WORK` + `tidyCity()` helper (collapse spaces + trim on blur/save). City (Input) + Country (`SearchSelect` with `COUNTRY_OPTIONS`, same as the contact's Country field) added to every work-ex row in the Add/Edit Client Contact form (`cc-work-{i}-city|country`) AND to the standalone `AddWorkExDialog` (`cc-add-workex-city|country`). Past-role `EmploymentCard`s show the role's own City, Country as Location (current role keeps the contact's location).
- `AddWorkExDialog`: widened to `max-w-3xl`; removed the subtitle sentence and all "e.g." placeholders per user.

## Sep 05 2026 — Geography (auto from Country) shown in top bar + employment cards
- `ClientContactDetail` name bar: after Location, a globe (`Public`) + region label derived via `getRegionByCountryId(row.country_id)` (`cc-detail-geography`); hidden when no country.
- `EmploymentCard`: meta grid now 4 cols — Primary Email · Primary Phone · Location · **Geography** (current role → contact's country; past role → that row's `country_id`). Never stored; always derived from Country at render time.

## Sep 05 2026 — Client Detail → Client Contacts tab layout
- `ClientDetailPage.jsx` now owns the Client Contacts sub-tab state (`ccSubTab`, `ccCounts`, `ccRef`). Tab row right side (all tabs): per-tab controls + right-aligned "← Back to Clients" (`client-back-link`); the old top-left back link is gone (only shown while loading / not found). Contacts tab: **Current / Former** chips (`workex-subtabs`; "Ex" renamed to "Former", test-ids unchanged) sit next to Back. Link tab: Save/Cancel then Back.
- Top bar (`Layout actions`, before the bell): on the Contacts tab shows the orange "+" (`workex-add-contact-btn`) and Bulk Upload (`workex-bulk-upload-btn`) icon buttons, wired via `ccRef.openAdd()/openBulk()`.
- `ClientWorkexContacts.jsx` → `forwardRef`; props `subTab`, `onCountsChange`; exposes `openAdd/openBulk/reload`; exports `SubTab`, `IconAction`. Removed its in-body header row incl. the "People currently at <client>" helper text.

## Sep 05 2026 — Status + Current/Former chips, bell-style icon buttons, custom Close, persisted .env
- **ENV PERSISTENCE (READ FIRST IN NEW SESSIONS)**: real `.env` files are git-ignored (`*.env`) so they vanish per container. Copies live in `/app/memory/env/backend.env.txt` + `frontend.env.txt`. Restore with `bash /app/scripts/restore_env.sh && sudo supervisorctl restart all` (frontend URL auto-swapped to `$preview_endpoint`). Do NOT regenerate JWT_SECRET/FERNET_KEY — reuse the saved ones.
- New `components/EmploymentRelationChip.jsx` ("Current" blue / "Former" gray pill, same shape as `POCStatusChip`).
- Card view (`ClientWorkexContacts` mini card): right column = POC Status chip (Active/Dormant) with Current/Former chip directly below. Backend `GET /clients/{id}/contacts` now annotates `poc_status` on both lists (`clients.py`).
- Detail view (`ClientContactDetail`): right column stacked = Status → Current/Former (`relation` prop from the opener; default "current" when the contact has a client) → Sync + Edit (+ Close in pop-up). New `BellStyleIconButton` = exact NotificationBell trigger classes (`w-9 h-9 rounded-full hover:bg-gray-100 text-gray-600`, dark tooltip below). Tooltips: "Sync" / "Edit" / "Close".
- Pop-up: default Radix X removed via new `hideClose` prop on `ui/dialog.jsx` `DialogContent`; custom Close (`cc-detail-close`) sits in the icon-button row.

## Sep 05 2026 — Status / Current-Former chips now = ProfiX StatusBadge style
- `POCStatusChip` + `EmploymentRelationChip` re-styled to the exact ProfiX → All Requests → Status pill (`PROFIX_PILL_CLASS`: outlined, white bg, 2px border, FIXED `w-28 h-7`, text-xs semibold). Active = ProfiX Open green `#16a34a`; Dormant = ProfiX Closed red `#dc2626`; Current = green `#16a34a`; Former = blue `#2563eb`. All four states share one fixed size. `size` prop removed (ignored). Applies everywhere POCStatusChip is used (CC list cards, CC detail, Client → Client Contacts cards).
- (follow-up) `EmploymentRelationChip` switched to a SOFT-FILLED pill per user reference (Current: `bg-green-50 border-green-200 text-green-700`; Former: `bg-blue-50 border-blue-200 text-blue-700`), still fixed `w-28 h-7`. POCStatusChip stays ProfiX-outlined.

## Sep 05 2026 — One-time data fix: Client Contact Type by designation (NOT automated)
- Direct DB update on `client_contacts` (Atlas app_db): VP Research → Domain Specific (293), Engagement Manager → Domain Specific (282), Analyst → Domain Agnostic (268), Compliance Head → Central Team (240). 1,083 records updated; all other designations left untouched. Each change recorded on the contact's Timeline as user "System (data migration)" (field Type — Added).
- Note: "Domain Specific" requires ≥1 Industry at API level, so these contacts will need an Industry chosen the next time they are edited via the form.

## Sep 05 2026 — CORRECTION: detail-view icon buttons = Client card Edit button; X back to corner
- `BellStyleIconButton` REMOVED (wrong reference). New `CardStyleIconButton` = exact ClientsPage card Edit button (`w-7 h-7 rounded-md text-gray-500 hover:text-[#ec9324] hover:bg-orange-50 transition-colors`, native `title` tooltip). Used for Sync ("Sync"/"Syncing…"), Edit ("Edit") in `ClientContactDetail`, and Close ("Close").
- Close (X) moved BACK to its original position (absolute `right-4 top-4` inside `DialogContent` of `ClientContactDetailModal`), only re-styled to the card-button look; default Radix X still suppressed via `hideClose`.
- LESSON: when the user says "same as <button>", match that exact element's classes; never relocate elements unless asked.
- (fix) Pop-up Close (X) no longer scrolls away: rendered INSIDE `cc-detail-sticky-header` (`absolute -right-3 top-4`) — `fixed` does NOT work because DialogContent is CSS-transformed + is the scroll container. Also added `!mt-0` to `cc-detail-slide` so the sticky header (and X / counter) no longer jumps 16px on first scroll in swipe mode.

## Sep 05 2026 — Client Contact → Notes tab
- Backend `routers/client_contact_notes.py` (registered in server.py): collection `client_contact_notes` {id, contact_id, text ≤1000 (trimmed), created_by{id,name,email,emp_id}, created_at, updated_by, updated_at}. Routes: GET/POST `/client-contacts/{id}/notes`, PATCH/DELETE `/client-contacts/{id}/notes/{note_id}`. 422 on empty/>1000. Any logged-in user may edit/delete (no author restriction).
- Every add/edit/delete mirrored on the Timeline via new `record_entries()` (`client_contact_timeline.py`) — field "Note", event `note`, action added/edited/deleted with value snapshots; Timeline header shows "Note by <User>".
- Frontend `NotesTab` / `NoteCard` / `NoteEditorDialog` in ClientContactsPage.jsx: orange "+ Add Note" button, dashed empty state (clickable), note cards (avatar initials, author, EMP id, date "Sep 05, 2026 · 10:41 PM", "edited" badge w/ tooltip, pre-wrap text, hover Edit (orange) / Delete (red) icon buttons). Editor pop-up: Textarea capped at 1000 with live counter (amber ≤50 left, red at 0), Submit disabled when empty/unchanged, Ctrl/⌘+Enter submits, Cancel. Delete = confirm dialog showing the note text.

## Sep 06 2026 — Client Contacts header: Sync / Upload History / Upload Contacts → Bell-style icon buttons
- The three text buttons in the Client Contacts page top bar are now icon-only, using new `BellStyleIconButton` (ClientContactsPage.jsx) = EXACT classes of the Notification Bell trigger (`group relative inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-gray-100 text-gray-600`, 22px icon, native `title` + dark `bg-gray-900` tooltip below/right-aligned on hover showing the full name: "Sync" (→ "Syncing…" + spinning icon while running, disabled), "Upload History", "Upload Contacts").
- Handlers, data-testids (`cc-sync-btn`, `cc-upload-history-btn`, `cc-open-bulk-upload-btn`) and the orange "+ Client Contact" button are unchanged.
- Env restored on this container from `memory/env/*` (Atlas cluster0.vmgql1i · app_db · sakshamsinghal_db_user — matches user-supplied creds). `@mui/icons-material` needed a clean reinstall (corrupt yarn cache). Smoke-tested via screenshot only (no testing agent, per user instruction).
- (correction, same day) Per user: header icons must match the **Client card Edit icon**, NOT the bell (bell hover = grey; Edit hover = orange). `BellStyleIconButton` removed again; the three header icons now use the existing `CardStyleIconButton` (`w-7 h-7 rounded-md text-gray-500 hover:text-[#ec9324] hover:bg-orange-50 transition-colors`, 16px icon, native `title` tooltip = full name). Verified computed hover colours equal the reference Edit icon.

## Sep 06 2026 — Bug fix: sidebar no longer auto-expands on navigation
- ROOT CAUSE: every page renders its own `<Layout>` → `<Sidebar>`, so Sidebar re-mounts on each route change; `collapsed` was initialised to `pref === "collapsed"` (→ EXPANDED when no preference) and a 5 s `AUTO_COLLAPSE_MS` timer collapsed it again. Result: any navigation (sidebar link, detail back button, ProfiX request detail…) flashed the sidebar open.
- FIX (`components/Sidebar.jsx`): default = collapsed (`collapsed = pref !== "expanded"`); auto-collapse timer + `userTouched` removed. Sidebar expands ONLY when the user clicks the expand toggle; the choice is persisted in `localStorage["sidebar:userPreference"]` and survives navigation until they collapse it.

## Sep 06 2026 — Infollion Research segmentation = READ-ONLY mirror of MySQL `domains`
- Env: `MYSQL_HOST/PORT/USER/PASSWORD/DB` re-added to `backend/.env` (+ `memory/env/backend.env.txt`) from user-supplied creds (`172.105.61.195` · `test_infollion` · `test_infollion_user`, password single-quoted). Backend startup takes ~35 s (Atlas index creation) — wait before hitting the API after a restart.
- NEW `backend/domain_sync.py` → `sync_domains(mode)`: reads `domains (id,name,parent_id,level L0..L3)`; root "Infollion Research" = Level 1, L0 → Level 2, L1 → Level 3, L2 → Level 4, L3 → Level 5 via `parent_id`. Node identity = `ext_id` (= MySQL id). Names shown exactly as in MySQL (full "A - B - C" names). Children in MySQL id order (tree UI sorts alphabetically anyway). `merge` (scheduled): renames/additions applied; rows missing from MySQL are KEPT with `stale: true` under previous parent; Level-2 renames propagated to `segmentation_links.mappings` keys and `client_contacts.industries` (Timeline entry by "MySQL Sync (domains)") — only when the previous tree was already MySQL-derived. `replace` (one-off): exact MySQL copy, no propagation. Sets `read_only: true`, `source {kind:"mysql_domains", table, synced_at, mode, rows}`, `updated_by = SYSTEM_ACTOR`, and owns `description`.
- Wired into `crm_sync.run_full_sync` (scope=all, isolated try/except) → runs on the existing 11:00 & 15:00 IST schedule and whenever the existing Client/Contact Sync runs. NO new manual button (per user).
- INITIAL LOAD DONE (user chose REPLACE): legacy Excel tree (134 nodes; backup at `/app/exports/backups/infollion_research_segmentation_excel_backup.json`) replaced by 141 MySQL domains (L2 8 / L3 19 / L4 38 / L5 76). Old Level-2 names (Agriculture, BFSI…) no longer exist → existing `segmentation_links` mappings / contact Industries pointing at them now dangle (user accepted). Script: `backend/scripts/replace_infollion_from_domains.py`.
- Read-only enforcement: `routers/segmentations.py` `_assert_writable` → PATCH/DELETE on `read_only` docs = **403** for everyone incl. Super Admin. Frontend `SegmentationsPage.jsx`: lock icon in list, no ⋮ Edit/Delete menu, glass header shows "Read-only · Synced from MySQL" pill (tooltip = last synced) instead of Edit/Delete, edit mode unreachable, Info popover gains a "Last Synced" row.
- Verified via API calls + screenshot smoke test only (no testing agent, per user instruction).

## Sep 06 2026 — Segmentation level NAMING change (display only)
- New user-facing naming: root = **Client Name**, its direct children = **Level 0**, then Level 1, Level 2, … (was Level 1 / Level 2 / Level 3 …). e.g. Boston Consulting Group (Client Name) → Automotive Industry (Level 0).
- INTERNAL numbering untouched (tree depth, backend `levels.nodes["2"]`, Overview `leftLevel/rightLevel` = 2…): only labels changed. `CrossSegmentationOverviewPage.jsx` exports `levelLabel(internal) = "Level " + (internal − 2)` used by `LevelSelect`.
- Updated strings: Overview level dropdowns + disabled tooltip; Client Contact form "Client Name *" (was "(Level 1)"), "Industry (Level 0 of …)", detail "Industries (Level 0)", bulk-upload help "Segmentation (Client Name)"; Client Detail pivot empty-states "Level-0"; backend bulk-upload template instructions (`client_contact_uploads.py`); `domain_sync.py` docs/DESCRIPTION ("L0–L3 → Level 0–3 under the Client Name") and run summary keys `level_0..level_3`.
- NOT changed: user-authored descriptions of PwC/BCG/etc. segmentations that mention "Level 2" (user data; editable via Edit).

## Sep 06 2026 — New / Edit Segmentation: Name → "Client Name" dropdown
- Backend `GET /api/segmentations/client-options` (declared BEFORE `/segmentations/{seg_id}`): every Client from `clients` (de-duped, alphabetical) with `has_segmentation` + `segmentation_id`. `_assert_client_exists()` → POST / PATCH(name change) return **400 "Client Name must be an existing Client from the Clients tab"**. Uniqueness (1 segmentation per client) still via the existing name-dup check.
- `SearchSelect` gained per-option `disabled` (greyed, `cursor-not-allowed`, un-pickable, skipped by ↑/↓) and `hint` (small right-aligned note). Backwards compatible.
- `SegmentationFormDialog` (SegmentationsPage.jsx): `Input` replaced by `SearchSelect` (same component as Country in Add Client Contact), label "Client Name *", placeholder "Select client…". Options: free clients A→Z first, then clients that already own a segmentation A→Z at the BOTTOM, frozen with hint "Segmentation exists". In Edit mode the segmentation's own client stays selectable; a legacy name not found among clients is kept as a selectable option so the form still shows it. Draft-create flow unchanged (name → unsaved draft editor).
- Verified via API + screenshot smoke test (811 clients, 5 frozen at bottom, Edit PwC keeps PwC selectable). No testing agent.

## Sep 06 2026 — Bug fix: clicking a node LABEL in the segmentation tree now expands/collapses
- ROOT CAUSE (`components/CollapsibleTree.jsx`): only the 12 px circle had the toggle handler; the label `<text>` click handler returned early in view mode (`if (!editable) return;`) — it was only wired for edit-mode selection. Users clicking the Client Name / Level 0 text saw nothing happen.
- FIX: toggle + focus logic extracted to `toggleNodeClick` / `focusNodeClick` (shared by circle and label). View mode: label click = expand/collapse one level (same 220 ms debounce), label double-click = focus/zoom. Edit mode unchanged (click = select, double-click = inline rename). Label cursor = pointer when the node has children (or in edit mode).

## Sep 06 2026 — Client Contact "Client Name" = the CRM-wide Clients list (not segmentations)
- ROOT CAUSE: Add/Edit Client Contact built the Client Name dropdown from `/segmentations` (5 manually created segmentations), so MySQL-synced clients (e.g. "Sterling Pharma Partners 46183") were missing and the Edit form showed a blank Client Name for such contacts.
- FIX (`ClientContactsPage.jsx`): `levelOneOptions(segments)` → `clientNameOptions(clients, ensure)` fed by `GET /segmentations/client-options` (same source as Segmentations → Client Name; all 811 Clients incl. MySQL-synced, A→Z, fetched on every dialog open / list load so new synced clients appear automatically). `ensure` = the contact's current client_name so Edit is never blank. Used in AddContactDialog (Clients tab "Add contact"), the list page Add/Edit dialog + "All clients" filter, and the detail-page Edit dialog. Industries still come from the client's Segmentation Level-0 nodes; placeholder "No Segmentation for this client yet" when the client has none.
- Backend `client_contact_uploads.py`: bulk-upload Client Name now validated against `clients` (error "does not exist in Clients"); Industries validated against that client's segmentation if present (warning "this Client has no Segmentation yet"). Template sample row uses "Boston Consulting Group".
- KNOWN: contacts of Type "Domain Specific" at a client WITHOUT a segmentation cannot pick an Industry, and the API requires ≥1 Industry for that type → their Edit form can't be saved until a segmentation exists (or Type is changed). Flagged to user.

## Sep 06 2026 — Edit Client Contact: "Previous Work Experience" section removed
- `ContactFormDialog` renders the repeatable Previous Work Experience block only when `!editing` (Add form). For existing contacts past roles are managed via the detail page → Employment History tab (+ "Add Previous Work Experience" dialog). Edit PATCH still carries the untouched `previous_work_experience` array (no data change).

## Sep 06 2026 — Client Contact Industries = hierarchical Infollion paths (Level 0 → 3)
- Backend `routers/industry_paths.py`: `load_nodes()` flattens the Infollion Research tree (ext_id, name, `short` = name minus "Parent - " prefix, level 0..3, parent_ext_id); `resolve_paths()` validates chains of ext_ids (each must be the child of the previous; first must be Level 0; ≤4 levels; de-dup) → `[{ext_ids, names, shorts, label:"A → B → C"}]`. `client_contacts`: new `industry_paths` on create/update; server DERIVES `industries` = path labels + any legacy free-text strings the user kept (legacy consumers — cards, detail, Overview, Timeline diff, "Domain Specific needs ≥1 Industry" — keep working). New `GET /client-contacts/industry-tree` (declared before `/{contact_id}`).
- Frontend `components/IndustryPathPicker.jsx` used by `ContactFormDialog` (Add + Edit): 4 linked `SearchSelect`s (Level 0 → 1 → 2 → 3, arrows between). L0 always enabled; L1 enabled (children of L0, or ALL L1 with full names when no L0 → picking one auto-fills L0); L2 frozen until L1, L3 frozen until L2 (placeholder "Select Level n-1 first", standard disabled look). Choosing any node auto-populates parents; changing a parent clears non-matching children. "Add" (orange) appends the consecutive path as a chip (dup → Add disabled + tooltip), resets the dropdowns; chips removable via ×; legacy strings shown as grey "LEGACY" chips (removable). Nothing saved until Save. Detail header "Industries (Level 0)" → "Industries". Industries no longer depend on the chosen Client (old client-L0 auto-clear effect removed).
- Verified via API + screenshot smoke tests (cascade, freeze, reverse select, dup, remove, Edit load/save round-trip). No testing agent.
