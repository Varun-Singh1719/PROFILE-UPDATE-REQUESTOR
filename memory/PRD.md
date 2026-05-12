# Ticketing System – PRD

## Original Problem Statement
Multi-role internal ticketing platform with three roles (Admin, Research Associate, DQ Team). Email-only login that auto-detects role and lands user on correct dashboard. Tickets carry Subject, Priority, Due Date, Number of Profiles, Attachment, Status (Open/In Progress/Closed), Assigned To. RA creates tickets, DQ self-assigns and updates status, Admin manages everything. Strict theme: highlight #ec9324, shadow #b2b2b2, flat white background; status & priority color rules.

## Architecture
- **Backend**: FastAPI + MongoDB (motor) + JWT auth (cookie + Bearer), Emergent Object Storage for attachments.
- **Frontend**: React + Tailwind + shadcn UI + Manrope font, role-aware routing/sidebar.
- **Auth**: JWT 12h tokens, bcrypt hashing, admin + 3 demo users seeded on startup.
- **Collections**: contacts, tickets, comments, activity, files.

## User Personas
- **Admin** – full visibility, manages contacts (activate/deactivate), assigns/reassigns/updates any ticket, sees DQ Team performance.
- **Research Associate** – creates tickets, sees only their own tickets, dashboard with personal metrics.
- **DQ Team** – self-assigns Open/unassigned tickets, updates status only on their own tickets, dashboard scoped to assigned tickets.

## Core Requirements (static)
- Email login, no "Select Profile" page, role auto-detected from contact type.
- Priority colors: High=Red, Medium=Yellow, Low=Green.
- Status colors: Open=#ec9324, In Progress=Green, Closed=#b2b2b2.
- Sticky table headers, rounded corners + soft #b2b2b2 shadows.
- Bulk actions (Select All + bulk assign).
- DQ users can ONLY self-assign and only update their own tickets.
- Admin can activate/deactivate users; inactive users cannot log in.
- File attachments (10MB limit) via Emergent Object Storage.

## What's been implemented (2026-05-12)
- Login + role-based redirect (Admin → /admin, RA → /ra, DQ → /dq).
- Admin Dashboard: 4 metric cards, DQ Performance grid (clickable to filter), recently updated tickets cards.
- RA Dashboard: 4 metric cards + recently updated cards.
- DQ Dashboard: 4 metric cards (scoped to user) + new ticket cards.
- Ticket Listing tables: search, status/priority filters, sticky headers, hover, bulk select, per-row actions (View / Assign-to-Me / Status / Manage).
- Ticket Detail: status/priority badges, assignment dropdown (Admin/DQ self), update status, attachment preview, Comments + Activity timeline.
- Create Ticket form with attachment upload.
- Admin Unassigned Tickets, Admin Contact List with Add Contact + Active/Inactive toggle.
- 25/25 backend pytest pass, all frontend flows verified.

## Backlog
- **P1**: Email notifications on assignment / status change (Resend/SendGrid).
- **P1**: CSV export of tickets, pagination/server-side sort.
- **P2**: Saved filter views, SLA breach indicator on overdue tickets, dark mode.
- **P2**: Reset password flow (forgot/reset endpoints already structured).
- **P2**: Concurrency-safe ticket ID generation (atomic counter).
- **P2**: Move auth to cookie-only (drop localStorage token), split server.py into routers.

## Next Tasks
- Email notifications.
- Real-time updates via WebSockets.
- Reporting analytics (closure time, SLA adherence per DQ member).
