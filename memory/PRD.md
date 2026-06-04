# PRD — Workspace Manager

## Original Problem Statement
- Rename "Desk App booking" to "Workspace Manager" in the sidebar and add a "Floor layout" sub-heading.
- Build an Interactive Office Floor Map component using provided PDF floor plans.
- Build an Interactive Seat Calibration Tool (Figma/AutoCAD-like) for admins to manually map seats onto the PDF floor plan with extreme precision (pan, zoom, rotation, draft states, auto-align, bulk generation, etc.).
- Link calibrated seats to the booking system (single source of truth).

## Tech Stack
- Frontend: React + react-pdf + react-zoom-pan-pinch + Tailwind/shadcn
- Backend: FastAPI + MongoDB (Motor)
- Auth: JWT in localStorage (no withCredentials, wildcard CORS for iframe previews)

## Completed (CHANGELOG)
- 2026-02 Sidebar rename to "Workspace Manager" + Floor layout sub-heading
- 2026-02 Base FloorMap + Seat components
- 2026-02 Backend CORS fix for emergent iframe previews
- 2026-02 Initial Seat Calibration Page with PDF background
- 2026-02 16-point UX enhancements: draft size/rotation, undo/redo, alignment H/V, auto-generate, multi-select, keyboard shortcuts, accuracy mode, preview mode
- 2026-02 **Fixed P0 seat-placement bug**: onMouseDown/onMouseUp + 4px drag threshold prevents pan gestures from swallowing clicks; doubleClick zoom disabled.
- 2026-02 **Fixed bay-numbering bug (HIGH)**: removed `nextSeatNumber` state — now derived from current bay's existing seats. Bay switching resets the counter correctly (A1,A2,A3 → switch to B → next is B1).
- 2026-02 **Fixed Auto Generate lexicographic sort (MEDIUM)**: `getSeatsInBay` now sorts numerically so bays with ≥10 seats use the correct first/last anchors.
- 2026-02 **Phase 2: Persistence + Single Source of Truth**
  - New backend module `routers/floor_plans.py` with `GET /api/floor-plans/active` (auth) and `PUT /api/floor-plans/active` (admin-only). Audit-logged.
  - Calibration page: "Save to Server" button (✓ animated success state). Loads existing plan on mount so admins can iteratively edit.
  - Floor Layout page now reads seats + pdfUrl from backend, with a "Live · N seats" badge. Falls back to legacy `seatMaster.js` when no plan saved.

## Backlog
### P1
- Desk Booking module (currently `DeskBookingPage` is "Coming Soon" placeholder). Click-to-book flow + bookings collection.
- Display real `occupiedSeats` from bookings on Floor Layout (currently a demo array).
- Replace alert() in Calibration page with non-blocking toast (sonner).
- Auto-fit PDF to canvas viewport on first load (call `resetTransform`/`centerView` in `onPageLoadSuccess`).

### P2
- Refactor `SeatCalibrationPage.jsx` (now ~880 lines) into Toolbar / Canvas / PropertiesPanel sub-components.
- Bay management UI (rename, reorder, delete entire bay).
- Snap-to-grid + dimensional measurements.
- Versioning: keep history of saved floor plans (currently single `active` doc is overwritten).

## API Surface (Floor Plans)
| Method | Path                          | Auth         | Body / Returns                                                 |
|--------|-------------------------------|--------------|-----------------------------------------------------------------|
| GET    | /api/floor-plans/active       | any user     | `{ id, name, pdfUrl, seats[], updated_at, updated_by }` or null |
| PUT    | /api/floor-plans/active       | Super Admin / Admin | `{ name, pdfUrl, seats[] }` → same shape as GET          |

## Critical Files
- `/app/frontend/src/pages/SeatCalibrationPage.jsx` — main calibration tool
- `/app/frontend/src/pages/FloorLayoutPage.jsx` — backend-driven floor map view
- `/app/frontend/src/components/FloorMap.jsx`, `Seat.jsx`, `Sidebar.jsx`
- `/app/backend/routers/floor_plans.py` — REST endpoints
- `/app/backend/server.py` — custom CORS for iframe previews + router registration

## Test Credentials
See `/app/memory/test_credentials.md`. Super admin: `admin@ticketing.com` / `Admin@123`

## Known Constraints
- DO NOT add `withCredentials: true` back to Axios — breaks wildcard CORS preflight in iframes.
- Single active floor plan (no versioning yet) — `PUT` overwrites.
