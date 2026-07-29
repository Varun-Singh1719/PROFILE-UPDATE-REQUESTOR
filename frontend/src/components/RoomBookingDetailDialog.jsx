/*
 * RoomBookingDetailDialog
 * ───────────────────────
 * Centered modal opened when the user clicks a meeting-room box on the
 * Floor Layout view. Shows all UPCOMING bookings (including the one currently
 * in progress) for the room on the selected date, as an accordion:
 *
 *   • Colour ribbon (dot) beside each item:
 *       – RED  = meeting currently in progress
 *       – AMBER = meeting scheduled later today
 *   • Collapsed row: title + time-range (+ "Now" pill when live)
 *   • Expanded row: booking #, organizer, team, attendees, status, notes
 *
 * The modal opens for both Available and Booked rooms, replacing the older
 * "1 Bookings for this day" list.
 */
import React, { useMemo, useState } from "react";
import X from "@mui/icons-material/Close";
import Clock from "@mui/icons-material/AccessTime";
import User from "@mui/icons-material/PersonOutlined";
import Users from "@mui/icons-material/PeopleOutlined";
import DoorClosed from "@mui/icons-material/MeetingRoomOutlined";
import CalendarIcon from "@mui/icons-material/CalendarTodayOutlined";
import CheckCircle from "@mui/icons-material/CheckCircleOutlined";
import Building2 from "@mui/icons-material/BusinessOutlined";
import NotesIcon from "@mui/icons-material/DescriptionOutlined";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./ui/accordion";

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

// Small round indicator + label used both on the accordion header and in
// the modal title.
function StateDot({ state }) {
  // state: "ongoing" | "upcoming"
  const color = state === "ongoing" ? "bg-red-500" : "bg-amber-500";
  const pulse = state === "ongoing" ? "animate-pulse" : "";
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ring-1 ring-black/10 flex-shrink-0 ${color} ${pulse}`}
      aria-hidden="true"
    />
  );
}

function MeetingAccordionItem({ b, state, index }) {
  const attendeeCount = Array.isArray(b.attendees) ? b.attendees.length : 0;
  const organizerName = b.organizer?.name || b.organizer_name || null;
  const organizerEmail = b.organizer?.email || null;
  const teamName = b.organizer_team_name || null;
  const testId = `room-booking-row-${index}`;
  return (
    <AccordionItem
      value={String(b.id || index)}
      className="rounded-lg border border-gray-200 bg-white shadow-sm data-[state=open]:border-[#ec9324]/40"
      data-testid={testId}
    >
      <AccordionTrigger className="px-3 py-2.5 hover:no-underline">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <StateDot state={state}/>
          <div className="min-w-0 flex-1 text-left">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900 truncate" data-testid={`${testId}-title`}>
                {b.title || "Untitled meeting"}
              </span>
              {state === "ongoing" && (
                <span className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-100 text-red-700 ring-1 ring-red-200 whitespace-nowrap">
                  Now
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[12px] text-gray-600 mt-0.5">
              <Clock sx={{ fontSize: 13 }} className="text-[#ec9324]"/>
              <span className="tabular-nums" data-testid={`${testId}-time`}>
                {fmtRange(b.start_at, b.end_at)}
              </span>
            </div>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-3 pb-3 pt-0">
        <div className="pt-2 border-t border-gray-100 space-y-2">
          {b.seq_no && (
            <div className="text-[11px] text-gray-500 tabular-nums">
              Booking #{b.seq_no}
            </div>
          )}
          {organizerName && (
            <div className="flex items-center gap-2 text-[12.5px] text-gray-700">
              <User sx={{ fontSize: 14 }} className="text-slate-500"/>
              <span data-testid={`${testId}-organizer`}>
                {organizerName}
                {organizerEmail && (
                  <span className="text-gray-500"> · {organizerEmail}</span>
                )}
              </span>
            </div>
          )}
          {teamName && (
            <div className="flex items-center gap-2 text-[12.5px] text-gray-700">
              <Building2 sx={{ fontSize: 14 }} className="text-slate-500"/>
              <span data-testid={`${testId}-team`}>{teamName}</span>
            </div>
          )}
          {attendeeCount > 0 && (
            <div className="flex items-start gap-2 text-[12.5px] text-gray-700">
              <Users sx={{ fontSize: 14 }} className="text-slate-500 mt-0.5"/>
              <span data-testid={`${testId}-attendees`}>
                {attendeeCount} attendee{attendeeCount === 1 ? "" : "s"}
              </span>
            </div>
          )}
          {b.notes && (
            <div className="flex items-start gap-2 text-[12.5px] text-gray-700">
              <NotesIcon sx={{ fontSize: 14 }} className="text-slate-500 mt-0.5"/>
              <span className="whitespace-pre-wrap break-words" data-testid={`${testId}-notes`}>
                {b.notes}
              </span>
            </div>
          )}
          {b.status && (
            <div>
              <StatusPill status={b.status}/>
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export default function RoomBookingDetailDialog({ room, date, bookings = [], onClose }) {
  // Freeze "now" once the modal opens so the ongoing/upcoming classification
  // doesn't flicker across renders while the user is interacting with it.
  const now = useMemo(() => Date.now(), [room?.id]);

  // Filter out cancelled + already-finished bookings, then annotate each with
  // its temporal state ("ongoing" or "upcoming"). Past meetings are hidden
  // per the spec ("all the upcoming meeting scheduled").
  const enriched = useMemo(() => {
    const rows = (bookings || []).filter((b) => {
      if (!b || b.cancelled) return false;
      if (b.status === "Cancelled") return false;
      const endMs = b.end_at ? new Date(b.end_at).getTime() : NaN;
      if (isNaN(endMs)) return false;
      return endMs > now; // keep ongoing + future
    });
    return rows
      .map((b) => {
        const s = new Date(b.start_at).getTime();
        const e = new Date(b.end_at).getTime();
        const state = (s <= now && now < e) ? "ongoing" : "upcoming";
        return { b, state };
      })
      .sort((a, b) => byStart(a.b, b.b));
  }, [bookings, now]);

  const hasOngoing = enriched.some((x) => x.state === "ongoing");
  const total = enriched.length;

  // Default-open the ongoing item(s) so users immediately see the live
  // meeting's details. If nothing is live, keep everything collapsed.
  const defaultOpen = useMemo(() => {
    return enriched
      .filter((x) => x.state === "ongoing")
      .map((x, i) => String(x.b.id || i));
  }, [enriched]);

  if (!room) return null;

  return (
    <Dialog open={!!room} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="room-booking-detail-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-gray-900 pr-6">
            <StateDot state={hasOngoing ? "ongoing" : "upcoming"}/>
            <DoorClosed sx={{ fontSize: 18 }} className="text-gray-500"/>
            <span className="truncate" data-testid="room-detail-name">
              {room.name || "Meeting Room"}
            </span>
            {hasOngoing ? (
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
              <Users sx={{ fontSize: 14 }} className="text-slate-500"/>
              <span data-testid="room-detail-capacity">{room.capacity} pax</span>
            </span>
          ) : null}
          {date ? (
            <span className="inline-flex items-center gap-1">
              <CalendarIcon sx={{ fontSize: 14 }} className="text-slate-500"/>
              <span data-testid="room-detail-date">{fmtIsoDate(date)}</span>
            </span>
          ) : null}
          {(room.floor || room.plan_name) && (
            <span className="text-slate-500 truncate">
              {room.floor || room.plan_name}
            </span>
          )}
        </div>

        {/* Body */}
        <div className="pt-1 max-h-[55vh] overflow-y-auto">
          {total > 0 ? (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-3">
                <span data-testid="room-detail-count">
                  {total} Upcoming meeting{total === 1 ? "" : "s"}
                </span>
                <span className="ml-auto flex items-center gap-3 normal-case tracking-normal text-gray-500 font-normal">
                  <span className="inline-flex items-center gap-1.5">
                    <StateDot state="ongoing"/>
                    <span>Ongoing</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <StateDot state="upcoming"/>
                    <span>Upcoming</span>
                  </span>
                </span>
              </div>
              <Accordion
                type="multiple"
                defaultValue={defaultOpen}
                className="space-y-2"
                data-testid="room-booking-accordion"
              >
                {enriched.map(({ b, state }, i) => (
                  <MeetingAccordionItem
                    key={b.id || i}
                    b={b}
                    state={state}
                    index={i}
                  />
                ))}
              </Accordion>
            </>
          ) : (
            <div
              className="rounded-lg border border-dashed border-emerald-200 bg-emerald-50/40 p-4 text-center"
              data-testid="room-detail-empty"
            >
              <CheckCircle sx={{ fontSize: 24 }} className="text-emerald-500 mx-auto mb-1"/>
              <div className="text-sm font-medium text-emerald-800">Room is available</div>
              <div className="text-[12px] text-emerald-700/80 mt-0.5">
                No upcoming meetings scheduled.
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-3 border-t border-gray-100 mt-1">
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="room-detail-close"
          >
            <X sx={{ fontSize: 14 }} className="mr-1.5"/>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
