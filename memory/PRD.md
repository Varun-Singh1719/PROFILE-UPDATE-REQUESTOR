# PRD — Workspace Manager

## Original Problem Statement
- Rename "Desk App booking" to "Workspace Manager" in the sidebar and add a "Floor layout" sub-heading.
- Build an Interactive Office Floor Map component using provided PDF floor plans.
- Build an Interactive Seat Calibration Tool (Figma/AutoCAD-like) for admins to manually map seats onto the PDF floor plan with extreme precision (pan, zoom, rotation, draft states, auto-align, bulk generation, etc.).

## Tech Stack
- Frontend: React + react-pdf + react-zoom-pan-pinch + Tailwind/shadcn
- Backend: FastAPI + MongoDB
- Auth: JWT in localStorage (no withCredentials, wildcard CORS for iframe previews)

## Completed (CHANGELOG)
- 2026-02 Sidebar rename to "Workspace Manager" + Floor layout sub-heading
- 2026-02 Base FloorMap + Seat components
- 2026-02 Backend CORS fix for emergent iframe previews
- 2026-02 Initial Seat Calibration Page with PDF background
- 2026-02 16-point UX enhancements: draft size/rotation, undo/redo, alignment H/V, auto-generate, multi-select, keyboard shortcuts, accuracy mode, preview mode
- 2026-02 **Fixed P0 seat-placement bug**: replaced `onClick` with `onMouseDown`/`onMouseUp` + 4px drag-threshold so panning gestures no longer swallow seat-placement clicks; disabled doubleClick zoom to prevent jumps. Verified via screenshot test (Total Seats 0 → 2).

## Backlog
### P1
- Integrate Floor Map with booking system (link seats to booking entities)
- Validate Apply/Cancel draft-state workflow end-to-end for size + rotation
- Persist seat configuration to backend (currently only client-side import/export)

### P2
- Refactor `SeatCalibrationPage.jsx` (808 lines) into Toolbar / Canvas / PropertiesPanel sub-components
- Bay management UI (rename, reorder, delete entire bay)
- Snap-to-grid + dimensional measurements

## Critical Files
- `/app/frontend/src/pages/SeatCalibrationPage.jsx` — main calibration tool
- `/app/frontend/src/components/FloorMap.jsx`, `Seat.jsx`, `Sidebar.jsx`
- `/app/backend/server.py` — custom CORS for iframe previews

## Test Credentials
See `/app/memory/test_credentials.md`. Super admin: admin@ticketing.com / Admin@123

## Known Constraints
- DO NOT add `withCredentials: true` back to Axios — breaks wildcard CORS preflight in iframes
- PDF source of truth: `Without seat floor map.pdf` (https://customer-assets.emergentagent.com/job_workspace-manager-19/artifacts/m9mpuhb8_Without%20seat%20floor%20map.pdf)
