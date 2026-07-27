/*
 * RoomBookingDetailDialog
 * ───────────────────────
 * Centered modal that renders the meeting-room bookings for a room clicked
 * on any Floor Map / calendar screen (Floor Layout, and future surfaces that
 * render clickable meeting rooms). Mirrors the workstation
 * FloorSeatDetailDialog so the two flows stay visually consistent.
 *
 * Behaviour (July-2026 spec):
 *   • Opens without navigating away from the current screen.
 *   • Closes on ✕ button, Esc key, or clicking outside the dialog.
 *   • NEVER redirects the user to another module — respects the
 *     "user may not have Meeting-Rooms access" constraint.
 *   • Handles both cases:
 *       – the room has 1..N bookings for the selected date → list every one,
 *       – the room has NO bookings → show a friendly "Available" empty state.
 *
 * Props:
 *   room       – { id, name, capacity, floor?, plan_name? } | null
 *   date       – ISO date the parent screen is displaying (YYYY-MM-DD) — used
 *                for the "on <date>" line in the header
 *   bookings   – array of room-booking rows for this room on `date`, shape:
 *                  { id, seq_no?, title, start_at, end_at, organizer,
 *                    attendees[], status? }
 *   onClose    – () => void
 */
import React from "react";
import X from "@mui/icons-material/Close";
import Clock from "@mui/icons-material/AccessTime";
import User from "@mui/icons-material/PersonOutlined";
import Users from "@mui/icons-material/PeopleOutlined";
import DoorClosed from "@mui/icons-material/MeetingRoomOutlined";
import CalendarIcon from "@mui/icons-material/CalendarTodayOutlined";
import CheckCircle from "@mui/icons-material/CheckCircleOutlined";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";

const fmtIsoDate = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString(undefined, {
      weekday: "short", day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return String(iso); }
};

const fmtTime = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
};

const fmtRange = (start, end) => `${fmtTime(start)} – ${fmtTime(end)}`;

// Sort earliest → latest so the timeline reads naturally.
const byStart = (a, b) => (a?.start_at || "").localeCompare(b?.start_at || "");

// Booking status → pill colours (mirrors the badges used across the module).
const STATUS_STYLE = {
  "Approved":         { bg: "bg-emerald-100", text: "text-emerald-700", ring: "ring-emerald-200", label: "Approved" },
  "Pending Approval": { bg: "bg-amber-100",   text: "text-amber-700",   ring: "ring-amber-200",   label: "Pending" },
  "Declined":         { bg: "bg-red-100",     text: "text-red-700",     ring: "ring-red-200",     label: "Declined" },
  "Cancelled":        { bg: "bg-slate-100",   text: "text-slate-600",   ring: "ring-slate-200",   label: "Cancelled" },
};

function StatusPill({ status }) {
  const s = STATUS_STYLE[status];
  if (!s) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ring-1 ${s.bg} ${s.text} ${s.ring}`}
      data-testid={`room-booking-status-${status?.toLowerCase().replace(/ /g, "-")}`}
    >
      {s.label}
    </span>
  );
}

function BookingRow({ b, testId }) {
  const attendeeCount = Array.isArray(b.attendees) ? b.attendees.length : 0;
  return (
    <div
      className="rounded-lg border border-gray-200 bg-white p-3 space-y-2 shadow-sm"
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-900 truncate" data-testid={`${testId}-title`}>
            {b.title || "Untitled meeting"}
          </div>
          {b.seq_no && (
            <div className="text-[10.5px] text-gray-500 tabular-nums mt-0.5">
              Booking #{b.seq_no}
            </div>
          )}
        </div>
        {b.status && <StatusPill status={b.status} />}
      </div>

      <div className="flex items-center gap-2 text-[12.5px] text-gray-700">
        <Clock sx={{ fontSize: 14 }} className="text-[#ec9324]" />
        <span className="tabular-nums" data-testid={`${testId}-time`}>{fmtRange(b.start_at, b.end_at)}</span>
      </div>

      {(b.organizer?.name || b.organizer_name) && (
        <div className="flex items-center gap-2 text-[12.5px] text-gray-700">
          <User sx={{ fontSize: 14 }} className="text-slate-500" />
          <span data-testid={`${testId}-organizer`}>
            {b.organizer?.name || b.organizer_name}
          </span>
        </div>
      )}

      {attendeeCount > 0 && (
        <div className="flex items-center gap-2 text-[12px] text-gray-600">
          <Users sx={{ fontSize: 14 }} className="text-slate-500" />
          <span data-testid={`${testId}-attendees`}>
            {attendeeCount} attendee{attendeeCount === 1 ? "" : "s"}
          </span>
        </div>
      )}
    </div>
  );
}

export default function RoomBookingDetailDialog({ room, date, bookings = [], onClose }) {
  if (!room) return null;
  // Defensive: some callers may pass unsorted arrays.
  const sorted = [...(bookings || [])].sort(byStart);
  const hasBookings = sorted.length > 0;

  return (
    <Dialog open={!!room} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="room-booking-detail-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-gray-900 pr-6">
            <div
              className={`w-2.5 h-2.5 rounded-full ring-1 ring-black/10 flex-shrink-0 ${hasBookings ? "bg-red-500" : "bg-emerald-500"}`}
            />
            <DoorClosed sx={{ fontSize: 18 }} className="text-gray-500" />
            <span className="truncate" data-testid="room-detail-name">{room.name || "Meeting Room"}</span>
            {hasBookings ? (
              <span className="ml-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-100 text-red-700 ring-1 ring-red-200">
                Booked
              </span>
            ) : (
              <span className="ml-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200">
                Available
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Meta row — capacity + date */}
        <div className="flex items-center gap-3 text-[12px] text-gray-600 border-b border-gray-100 pb-2.5">
          {room.capacity ? (
            <span className="inline-flex items-center gap-1">
              <Users sx={{ fontSize: 14 }} className="text-slate-500" />
              <span data-testid="room-detail-capacity">{room.capacity} pax</span>
            </span>
          ) : null}
          {date ? (
            <span className="inline-flex items-center gap-1">
              <CalendarIcon sx={{ fontSize: 14 }} className="text-slate-500" />
              <span data-testid="room-detail-date">{fmtIsoDate(date)}</span>
            </span>
          ) : null}
          {(room.floor || room.plan_name) && (
            <span className="text-slate-500 truncate">
              {room.floor || room.plan_name}
            </span>
          )}
        </div>

        <div className="pt-1 space-y-2 max-h-[55vh] overflow-y-auto">
          {hasBookings ? (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                {sorted.length} Booking{sorted.length === 1 ? "" : "s"} for this day
              </div>
              {sorted.map((b, i) => (
                <BookingRow key={b.id || i} b={b} testId={`room-booking-row-${i}`} />
              ))}
            </>
          ) : (
            <div
              className="rounded-lg border border-dashed border-emerald-200 bg-emerald-50/40 p-4 text-center"
              data-testid="room-detail-empty"
            >
              <CheckCircle sx={{ fontSize: 24 }} className="text-emerald-500 mx-auto mb-1" />
              <div className="text-sm font-medium text-emerald-800">Room is available</div>
              <div className="text-[12px] text-emerald-700/80 mt-0.5">No bookings scheduled for this day.</div>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-3 border-t border-gray-100 mt-1">
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="room-detail-close"
          >
            <X sx={{ fontSize: 14 }} className="mr-1.5" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
