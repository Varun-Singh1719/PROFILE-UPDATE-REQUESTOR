import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import ChevronsLeft from "@mui/icons-material/KeyboardDoubleArrowLeft";
import ChevronsRight from "@mui/icons-material/KeyboardDoubleArrowRight";
import X from "@mui/icons-material/Close";
import CalendarIcon from "@mui/icons-material/CalendarTodayOutlined";
import Users from "@mui/icons-material/PeopleOutlined";
import MapPin from "@mui/icons-material/PlaceOutlined";
import Clock from "@mui/icons-material/AccessTime";
import User from "@mui/icons-material/PersonOutlined";
import Building2 from "@mui/icons-material/ApartmentOutlined";
import Pencil from "@mui/icons-material/EditOutlined";
import Trash2 from "@mui/icons-material/DeleteOutlined";
import AlertCircle from "@mui/icons-material/ErrorOutlined";
import Loader2 from "@mui/icons-material/Autorenew";
import api from "../lib/api";
import { Button } from "./ui/button";
import { Calendar as UICalendar } from "./ui/calendar";
import RoomBookingDetailDialog from "./RoomBookingDetailDialog";
import { toast } from "../lib/notify";
import { confirm as confirmDialog } from '../lib/dialog';

// ============================================================ Date helpers
const pad = (n) => String(n).padStart(2, "0");
const toIsoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const fmtTime = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
};
const fmtLongDate = (d) =>
  d.toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

// Day grid configuration: 30-min slots across a full 24-hour day so the grid is
// always taller than the viewport (guarantees the time frame scrolls).
const START_HOUR = 0;
const END_HOUR = 24;
const SLOT_MINUTES = 30;
const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;
const SLOT_PX = 30;                  // visual height of one 30-min row
const HEADER_PX = 48;                // sticky room-header row height
const GUTTER_PX = 64;                // sticky time-gutter column width
const DEFAULT_SCROLL_HOUR = 7;       // initial scroll lands at ~7AM (business hours)
const TOTAL_SLOTS = (END_HOUR - START_HOUR) * SLOTS_PER_HOUR;

// Convert an ISO datetime to a fractional row index (0 == START_HOUR:00).
// Values < 0 or > TOTAL_SLOTS are clamped — bookings that extend beyond the visible
// range still render but get clipped at the edges.
const isoToRowOffset = (iso) => {
  const d = new Date(iso);
  const minutes = d.getHours() * 60 + d.getMinutes() - START_HOUR * 60;
  return minutes / SLOT_MINUTES;
};

// ============================================================ Mini month calendar (sidebar)
// Renders the same react-day-picker calendar used everywhere else in the
// Meeting Room booking module (via <SingleDatePicker/>), so the sidebar UI
// stays visually consistent. Single-date selection; the surrounding page
// controls date navigation and clicking a day fires onChange(Date).
function MiniMonth({ value, onChange }) {
  return (
    <div className="select-none" data-testid="mrb-mini-month">
      <UICalendar
        mode="single"
        selected={value}
        onSelect={(d) => { if (d) onChange(d); }}
        initialFocus={false}
        showOutsideDays
        className="p-0"
        classNames={{
          // Compact sizing to fit the 240px sidebar comfortably.
          months: "flex flex-col",
          month: "space-y-2",
          caption: "flex justify-center pt-1 relative items-center text-[12px] font-bold text-gray-800",
          caption_label: "text-[12px] font-bold",
          nav_button: "h-6 w-6 rounded text-gray-500 hover:text-[#ec9324] hover:bg-orange-50 inline-flex items-center justify-center",
          nav_button_previous: "absolute left-1",
          nav_button_next: "absolute right-1",
          head_cell: "text-[9px] font-bold text-gray-400 w-7",
          cell: "text-center text-[11px] p-0",
          day: "h-7 w-7 p-0 font-normal text-gray-700 rounded-full hover:bg-orange-50 hover:text-[#ec9324] transition-colors inline-flex items-center justify-center",
          day_selected:
            "bg-[#ec9324] text-white hover:bg-[#d4811f] hover:text-white focus:bg-[#ec9324] focus:text-white font-bold",
          day_today: "ring-1 ring-[#ec9324] text-[#ec9324] font-bold",
          day_outside: "text-gray-300",
        }}
      />
    </div>
  );
}

// ============================================================ Event preview card (popover)
function EventPreview({ booking, anchor, onClose, onMore, onEdit, onCancel, canEdit, canCancel }) {
  const cardRef = useRef(null);
  useEffect(() => {
    const onDocClick = (e) => { if (cardRef.current && !cardRef.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [onClose]);

  if (!booking || !anchor) return null;
  // Position to the right of the event card; fall back to the left if no space.
  const padding = 8;
  let left = anchor.right + padding;
  let top = anchor.top;
  const maxLeft = window.innerWidth - 340 - padding;
  if (left > maxLeft) left = Math.max(padding, anchor.left - 340 - padding);
  const maxTop = window.innerHeight - 240 - padding;
  if (top > maxTop) top = Math.max(padding, maxTop);

  const attendees = booking.attendees || [];
  const firstThree = attendees.slice(0, 3);
  const more = Math.max(0, attendees.length - 3);

  return (
    <div
      ref={cardRef}
      data-testid="mrb-preview-card"
      role="dialog"
      className="fixed z-50 w-[320px] bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      style={{ left, top }}
    >
      <div className="flex items-start justify-between gap-2 px-3 py-2 border-b border-gray-100">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#ec9324]">Meeting</div>
          <div className="text-sm font-bold text-gray-900 truncate" title={booking.title}>{booking.title}</div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-0.5" data-testid="mrb-preview-close"><X sx={{ fontSize: 14 }}/></button>
      </div>
      <div className="px-3 py-2 space-y-1.5 text-[12px]">
        <div className="flex items-center gap-1.5 text-gray-700"><MapPin sx={{ fontSize: 12 }} className="text-gray-400"/> {booking.room_name}</div>
        <div className="flex items-center gap-1.5 text-gray-700"><Clock sx={{ fontSize: 12 }} className="text-gray-400"/>
          {new Date(booking.start_at).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" })}
          <span className="text-gray-300">·</span>
          {fmtTime(booking.start_at)} – {fmtTime(booking.end_at)}
        </div>
        <div className="flex items-center gap-1.5 text-gray-700"><User sx={{ fontSize: 12 }} className="text-gray-400"/>
          {booking.organizer?.name || booking.organizer?.email || "—"}
        </div>
        {booking.organizer_team_name ? (
          <div className="flex items-center gap-1.5 text-[#ec9324] font-semibold"><Building2 sx={{ fontSize: 12 }}/> {booking.organizer_team_name}</div>
        ) : null}
        {attendees.length > 0 && (
          <div className="pt-1.5 border-t border-gray-100 mt-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1 flex items-center gap-1"><Users sx={{ fontSize: 10 }}/> Attendees</div>
            <div className="flex flex-wrap gap-1">
              {firstThree.map(a => (
                <span key={`${a.type}-${a.id}`} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${a.type === 'team' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-orange-50 text-[#ec9324] border-orange-200'}`}>
                  {a.name}
                </span>
              ))}
              {more > 0 && (
                <button
                  onClick={onMore}
                  className="text-[10px] font-semibold text-[#ec9324] hover:underline"
                  data-testid="mrb-preview-more"
                >+ {more} More</button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-2">
        <button
          onClick={onMore}
          className="text-[11px] font-semibold text-gray-700 hover:text-[#ec9324]"
          data-testid="mrb-preview-more-btn"
        >More details</button>
        <div className="flex items-center gap-1">
          {canEdit && (
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1 text-[11px] text-gray-700 hover:text-[#ec9324] px-2 py-1 rounded hover:bg-orange-50"
              data-testid="mrb-preview-edit"
            ><Pencil sx={{ fontSize: 11 }}/> Edit</button>
          )}
          {canCancel && (
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-1 text-[11px] text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
              data-testid="mrb-preview-cancel"
            ><Trash2 sx={{ fontSize: 11 }}/> Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================ Event detail modal
function EventDetails({ booking, onClose, onEdit, onCancel, canEdit, canCancel }) {
  if (!booking) return null;
  const attendees = booking.attendees || [];
  const teamAttendees = attendees.filter(a => a.type === "team");
  const userAttendees = attendees.filter(a => a.type !== "team");
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="mrb-details-modal">
      <div className="bg-white rounded-lg shadow-2xl w-[520px] max-h-[80vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#ec9324]">Meeting Details</div>
            <div className="text-base font-bold text-gray-900 truncate">{booking.title}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1" data-testid="mrb-details-close"><X sx={{ fontSize: 16 }}/></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 text-[13px]">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase text-gray-500 mb-0.5">Meeting Room</div>
              <div className="text-gray-800 flex items-center gap-1.5"><MapPin sx={{ fontSize: 12 }} className="text-gray-400"/> {booking.room_name}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase text-gray-500 mb-0.5">Date</div>
              <div className="text-gray-800">{new Date(booking.start_at).toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase text-gray-500 mb-0.5">Time</div>
              <div className="text-gray-800 flex items-center gap-1.5"><Clock sx={{ fontSize: 12 }} className="text-gray-400"/> {fmtTime(booking.start_at)} – {fmtTime(booking.end_at)}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase text-gray-500 mb-0.5">Organizer</div>
              <div className="text-gray-800">{booking.organizer?.name || booking.organizer?.email || "—"}</div>
              {booking.organizer_team_name && <div className="text-[#ec9324] text-[11px] font-semibold">{booking.organizer_team_name}</div>}
            </div>
          </div>
          {teamAttendees.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase text-gray-500 mb-1">Teams Invited</div>
              <div className="flex flex-wrap gap-1.5">
                {teamAttendees.map(t => (
                  <span key={`t-${t.id}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-purple-50 text-purple-700 border-purple-200">
                    <Users sx={{ fontSize: 10 }}/> {t.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="text-[10px] font-bold uppercase text-gray-500 mb-1">Attendees ({userAttendees.length})</div>
            {userAttendees.length === 0 ? (
              <div className="text-[12px] text-gray-400 italic">No individual attendees.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {userAttendees.map(u => (
                  <span key={`u-${u.id}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-orange-50 text-[#ec9324] border-orange-200">
                    {u.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} data-testid="mrb-details-close-btn">Close</Button>
          {canEdit && (
            <Button onClick={onEdit} className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="mrb-details-edit">
              <Pencil sx={{ fontSize: 14 }} className="mr-1.5"/> Edit
            </Button>
          )}
          {canCancel && (
            <Button onClick={onCancel} variant="outline" className="text-red-600 hover:bg-red-50 border-red-200" data-testid="mrb-details-cancel">
              <Trash2 sx={{ fontSize: 14 }} className="mr-1.5"/> Cancel Meeting
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================ Day schedule grid (resource columns)
function DayGrid({ rooms, bookings, date, onPickSlot, onPickEvent, onPickRoom, hoverSlot, setHoverSlot }) {
  const roomCount = rooms.length;

  // Index bookings by room id and sort each set by start.
  const byRoom = useMemo(() => {
    const m = new Map();
    rooms.forEach(r => m.set(r.room_id, []));
    for (const b of bookings) {
      if (b.cancelled) continue;
      // include only bookings overlapping `date`
      const s = new Date(b.start_at);
      if (s.getFullYear() !== date.getFullYear() || s.getMonth() !== date.getMonth() || s.getDate() !== date.getDate()) continue;
      if (!m.has(b.room_id)) continue;
      m.get(b.room_id).push(b);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.start_at || "").localeCompare(b.start_at || ""));
    return m;
  }, [rooms, bookings, date]);

  // Build a quick lookup: which slots are "occupied" for tinting empty backgrounds.
  // (Each booking already overlays the slots — this is just to grey the cell behind it.)
  const occupiedCells = useMemo(() => {
    const set = new Set();
    for (const [roomId, list] of byRoom.entries()) {
      for (const b of list) {
        const startOff = Math.max(0, Math.floor(isoToRowOffset(b.start_at)));
        const endOff = Math.min(TOTAL_SLOTS, Math.ceil(isoToRowOffset(b.end_at)));
        for (let i = startOff; i < endOff; i++) set.add(`${roomId}|${i}`);
      }
    }
    return set;
  }, [byRoom]);

  // ── Past-time detection ────────────────────────────────────────────
  // Slots strictly before "now" (on today) are visually disabled and cannot
  // be selected. Days entirely in the past are all disabled; days in the
  // future have no past slots at all.
  const now = new Date();
  const showNow = sameDay(now, date);
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const isPastDay = date < startOfToday;
  const isFutureDay = !isPastDay && !showNow;
  const nowSlotFloor = showNow ? Math.floor((now.getHours() * 60 + now.getMinutes() - START_HOUR * 60) / SLOT_MINUTES) : 0;
  const isPastSlot = useCallback((slot) => {
    if (isPastDay) return true;
    if (isFutureDay) return false;
    return slot < nowSlotFloor;
  }, [isPastDay, isFutureDay, nowSlotFloor]);

  // ── Drag-to-select state ────────────────────────────────────────────
  // A single click starts and ends the drag on the same cell → default
  // 30-min duration. Dragging across cells extends the selection.
  //   dragState = { roomId, startSlot, endSlot } while the mouse is held.
  const [dragState, setDragState] = useState(null);

  // Slot-range covered by the current drag (inclusive of endSlot).
  const dragRange = useMemo(() => {
    if (!dragState) return null;
    const a = Math.min(dragState.startSlot, dragState.endSlot);
    const b = Math.max(dragState.startSlot, dragState.endSlot);
    return { roomId: dragState.roomId, from: a, to: b };
  }, [dragState]);

  // Any occupied cell inside the current drag range? Used to render the
  // preview overlay in red so the user immediately sees "this range is
  // invalid" before releasing the mouse.
  const dragHasConflict = useMemo(() => {
    if (!dragRange) return false;
    for (let i = dragRange.from; i <= dragRange.to; i++) {
      if (occupiedCells.has(`${dragRange.roomId}|${i}`)) return true;
      if (isPastSlot(i)) return true;
    }
    return false;
  }, [dragRange, occupiedCells, isPastSlot]);

  // Commit or discard the drag on mouseup (or when the pointer leaves the
  // window). Attached to `window` so releasing anywhere ends the drag.
  useEffect(() => {
    if (!dragState) return;
    const commit = () => {
      const ds = dragState;
      setDragState(null);
      if (!ds) return;
      const a = Math.min(ds.startSlot, ds.endSlot);
      const b = Math.max(ds.startSlot, ds.endSlot);
      // Validate: no occupied cell inside range, no past cell inside range.
      for (let i = a; i <= b; i++) {
        if (occupiedCells.has(`${ds.roomId}|${i}`)) {
          toast.error("Selected time overlaps with an existing meeting. Please pick a free time frame.");
          return;
        }
        if (isPastSlot(i)) {
          toast.error("You can't book a meeting in the past. Please pick a future time slot.");
          return;
        }
      }
      // Compute start / end datetimes. End is exclusive (b + 1) so a single
      // click (a === b) defaults to a 30-min duration.
      const startDt = new Date(date);
      startDt.setHours(0, 0, 0, 0);
      startDt.setMinutes(START_HOUR * 60 + a * SLOT_MINUTES);
      const endDt = new Date(date);
      endDt.setHours(0, 0, 0, 0);
      endDt.setMinutes(START_HOUR * 60 + (b + 1) * SLOT_MINUTES);
      onPickSlot({
        roomId: ds.roomId,
        date: toIsoDate(startDt),
        start: `${pad(startDt.getHours())}:${pad(startDt.getMinutes())}`,
        end: `${pad(endDt.getHours())}:${pad(endDt.getMinutes())}`,
      });
    };
    window.addEventListener("mouseup", commit);
    // Cancel drag if the user drags out of the window (blur) so we don't
    // stay in a "phantom drag" state.
    window.addEventListener("blur", () => setDragState(null));
    return () => window.removeEventListener("mouseup", commit);
  }, [dragState, occupiedCells, isPastSlot, date, onPickSlot]);

  // Scroll container ref — on first mount we jump to DEFAULT_SCROLL_HOUR so the user
  // sees business hours without needing to scroll, but the full 24h grid is reachable.
  // Declared BEFORE the empty-state early return so hook order stays stable.
  const scrollRef = useRef(null);
  const didInitialScroll = useRef(false);

  // Now indicator (orange line) when viewing today
  const nowOffset = showNow ? Math.max(0, Math.min(TOTAL_SLOTS, (now.getHours() * 60 + now.getMinutes() - START_HOUR * 60) / SLOT_MINUTES)) : null;

  useEffect(() => {
    if (didInitialScroll.current) return;
    if (!scrollRef.current) return;
    if (roomCount === 0) return;
    const targetHour = showNow ? Math.max(START_HOUR, Math.min(END_HOUR - 1, now.getHours() - 1)) : DEFAULT_SCROLL_HOUR;
    scrollRef.current.scrollTop = (targetHour - START_HOUR) * SLOTS_PER_HOUR * SLOT_PX;
    didInitialScroll.current = true;
  });

  if (roomCount === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-10 text-center text-gray-500">
        <div>
          <Building2 sx={{ fontSize: 32 }} className="mx-auto text-gray-300 mb-2"/>
          <div className="text-sm font-semibold text-gray-700">No meeting rooms available</div>
          <div className="text-[12px] text-gray-500 mt-1">Add rooms in <span className="font-semibold">Floor Calibration → Meeting Room Calibration</span> and publish a Live floor plan.</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-auto bg-white relative"
      data-testid="mrb-day-grid"
    >
      <div
        className="relative inline-grid min-w-full"
        style={{ gridTemplateColumns: `${GUTTER_PX}px repeat(${roomCount}, minmax(180px, 1fr))` }}
      >
        {/* Top-left corner: sticky on BOTH axes so it never moves while scrolling. */}
        <div
          className="sticky top-0 left-0 z-30 bg-white border-b border-r border-gray-200"
          style={{ height: HEADER_PX }}
        />
        {/* Sticky room headers — pin to top of the scroll container during vertical scroll.
            Clicking a header opens the shared Room Booking Detail dialog with
            every booking scheduled on this day for that room. */}
        {rooms.map((r) => (
          <button
            key={`h-${r.room_id}`}
            type="button"
            onClick={() => onPickRoom?.(r, byRoom.get(r.room_id) || [])}
            className="sticky top-0 z-20 bg-white border-b border-l border-gray-200 px-3 flex flex-col items-center justify-center text-center hover:bg-orange-50 focus:outline-none focus:bg-orange-50 transition-colors"
            style={{ height: HEADER_PX }}
            data-testid={`mrb-cal-room-header-${r.room_id}`}
            title={`${r.name} — click for bookings`}
          >
            <div className="text-[12px] font-bold text-gray-900 truncate max-w-full">{r.name}</div>
            <div className="text-[10px] text-gray-500 truncate max-w-full">{r.capacity} seats</div>
          </button>
        ))}

        {/* Body rows. We render one row per 30-min slot per column. */}
        {Array.from({ length: TOTAL_SLOTS }, (_, slotIdx) => {
          const hour = START_HOUR + Math.floor(slotIdx / SLOTS_PER_HOUR);
          const minute = (slotIdx % SLOTS_PER_HOUR) * SLOT_MINUTES;
          const onTheHour = minute === 0;
          return (
            <React.Fragment key={`row-${slotIdx}`}>
              {/* Time gutter cell — sticky-left so labels stay visible during horizontal scroll. */}
              <div
                className={`sticky left-0 z-10 bg-white border-r border-gray-200 text-right pr-2 text-[10px] font-semibold text-gray-400 ${onTheHour ? "border-t border-gray-200" : ""}`}
                style={{ height: SLOT_PX }}
              >
                {onTheHour && (
                  <span className="absolute -top-1.5 right-2 bg-white px-1">{pad(hour)}:00</span>
                )}
              </div>

              {/* One cell per room column */}
              {rooms.map((r) => {
                const key = `${r.room_id}|${slotIdx}`;
                const occupied = occupiedCells.has(key);
                const past = isPastSlot(slotIdx);
                const disabled = occupied || past;
                const hovered = !dragState && hoverSlot && hoverSlot.roomId === r.room_id && hoverSlot.slot === slotIdx;
                const inDrag = dragRange && dragRange.roomId === r.room_id && slotIdx >= dragRange.from && slotIdx <= dragRange.to;
                let cellClass;
                if (past) {
                  // Past — visually dimmed, cannot be selected. Same "greyed" look
                  // Google Calendar uses for elapsed time.
                  cellClass = "bg-gray-50 cursor-not-allowed";
                } else if (occupied) {
                  cellClass = "bg-gray-100 cursor-default";
                } else if (inDrag) {
                  cellClass = dragHasConflict
                    ? "bg-red-100 cursor-not-allowed"
                    : "bg-orange-200 cursor-grabbing";
                } else if (hovered) {
                  cellClass = "bg-orange-100 cursor-pointer";
                } else {
                  cellClass = "bg-white hover:bg-orange-50 cursor-pointer";
                }
                return (
                  <div
                    key={key}
                    role="button"
                    tabIndex={disabled ? -1 : 0}
                    onMouseEnter={() => {
                      if (dragState && dragState.roomId === r.room_id) {
                        setDragState((prev) => (prev ? { ...prev, endSlot: slotIdx } : prev));
                        return;
                      }
                      if (!disabled) setHoverSlot({ roomId: r.room_id, slot: slotIdx });
                    }}
                    onMouseLeave={() => { if (!dragState) setHoverSlot(null); }}
                    onMouseDown={(e) => {
                      if (disabled) return;
                      // Only left mouse button starts a drag.
                      if (e.button !== 0) return;
                      e.preventDefault();
                      setDragState({ roomId: r.room_id, startSlot: slotIdx, endSlot: slotIdx });
                    }}
                    aria-disabled={disabled}
                    data-testid={`mrb-cal-slot-${r.room_id}-${pad(hour)}${pad(minute)}`}
                    data-past={past ? "true" : "false"}
                    data-occupied={occupied ? "true" : "false"}
                    className={[
                      "relative w-full border-l border-gray-200 text-left transition-colors select-none",
                      onTheHour ? "border-t border-gray-200" : "border-t border-gray-100",
                      cellClass,
                    ].join(" ")}
                    style={{ height: SLOT_PX }}
                  />
                );
              })}
            </React.Fragment>
          );
        })}

        {/* Event cards & now-indicator are layered INSIDE the inline-grid wrapper so
            they translate together with the grid when the user scrolls in either axis. */}
        <EventOverlay
          rooms={rooms}
          bookings={bookings}
          date={date}
          showNow={showNow}
          nowOffset={nowOffset}
          onPickEvent={onPickEvent}
          dragRange={dragRange}
          dragHasConflict={dragHasConflict}
        />
      </div>
    </div>
  );
}

// ============================================================ Event overlay (absolute-positioned)
// Renders booking cards and the "now" line INSIDE the inline-grid wrapper so they
// translate together with the grid during both vertical and horizontal scrolling.
function EventOverlay({ rooms, bookings, date, showNow, nowOffset, onPickEvent, dragRange, dragHasConflict }) {
  const overlayRef = useRef(null);

  // Read each room column's left/width relative to the inline-grid wrapper. Because
  // the overlay is itself inside the wrapper, no scroll math is required — offsets
  // are intrinsic to the wrapper's layout.
  const [colMetrics, setColMetrics] = useState(null);
  useEffect(() => {
    if (!overlayRef.current) return;
    const updateMetrics = () => {
      const wrapper = overlayRef.current?.parentElement;
      if (!wrapper) return;
      const headers = wrapper.querySelectorAll('[data-testid^="mrb-cal-room-header-"]');
      const cols = [];
      headers.forEach((h) => {
        cols.push({
          id: h.getAttribute("data-testid").replace("mrb-cal-room-header-", ""),
          left: h.offsetLeft,
          width: h.offsetWidth,
        });
      });
      setColMetrics(cols);
    };
    updateMetrics();
    const ro = new ResizeObserver(updateMetrics);
    ro.observe(overlayRef.current.parentElement);
    window.addEventListener("resize", updateMetrics);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateMetrics);
    };
  }, [rooms.length]);

  const dayBookings = useMemo(() => {
    return bookings.filter(b => {
      if (b.cancelled) return false;
      const s = new Date(b.start_at);
      return s.getFullYear() === date.getFullYear() && s.getMonth() === date.getMonth() && s.getDate() === date.getDate();
    });
  }, [bookings, date]);

  // The overlay must cover the same area as the inline-grid (header + all slot rows).
  const totalHeight = HEADER_PX + TOTAL_SLOTS * SLOT_PX;

  return (
    <div
      ref={overlayRef}
      className="absolute top-0 left-0 right-0 pointer-events-none"
      style={{ height: totalHeight }}
      data-testid="mrb-event-overlay"
    >
      {colMetrics && dayBookings.map(b => {
        const col = colMetrics.find(c => c.id === b.room_id);
        if (!col) return null;
        const startOff = isoToRowOffset(b.start_at);
        const endOff = isoToRowOffset(b.end_at);
        const top = HEADER_PX + Math.max(0, startOff) * SLOT_PX;
        const heightSlots = Math.max(1, Math.min(TOTAL_SLOTS, endOff) - Math.max(0, startOff));
        const height = Math.max(22, heightSlots * SLOT_PX - 2);
        return (
          <button
            type="button"
            key={b.id}
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              onPickEvent(b, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
            }}
            data-testid={`mrb-cal-event-${b.id}`}
            className="pointer-events-auto absolute rounded-md border border-gray-300 bg-gray-100 hover:border-[#ec9324] hover:ring-2 hover:ring-[#ec9324]/30 hover:bg-orange-50 transition-colors text-left px-2 py-1 overflow-hidden shadow-sm"
            style={{
              top,
              left: col.left + 4,
              width: col.width - 8,
              height,
              borderLeft: "3px solid #ec9324",
            }}
            title={b.title}
          >
            <div className="text-[11px] font-bold text-gray-800 truncate leading-tight">{b.title}</div>
            <div className="text-[10px] text-gray-600 leading-tight truncate">{fmtTime(b.start_at)} – {fmtTime(b.end_at)}</div>
          </button>
        );
      })}

      {showNow && nowOffset !== null && colMetrics && colMetrics.length > 0 && (
        <div
          className="absolute pointer-events-none flex items-center"
          style={{
            top: HEADER_PX + nowOffset * SLOT_PX,
            left: GUTTER_PX,
            width: (colMetrics[colMetrics.length - 1].left + colMetrics[colMetrics.length - 1].width) - GUTTER_PX,
          }}
          data-testid="mrb-cal-now-line"
        >
          <div className="w-2 h-2 rounded-full bg-[#ec9324] -ml-1"></div>
          <div className="flex-1 h-px bg-[#ec9324]"></div>
        </div>
      )}

      {/* Drag preview — a floating pill showing the currently-selected duration
          while the user is dragging across cells. Follows the drag range's
          column & vertical extent. Turns red when the range collides with
          an existing meeting or a past slot so the user knows it's invalid. */}
      {dragRange && colMetrics && (() => {
        const col = colMetrics.find(c => c.id === dragRange.roomId);
        if (!col) return null;
        const slotCount = dragRange.to - dragRange.from + 1;
        const totalMinutes = slotCount * SLOT_MINUTES;
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        const durationLabel = hours && mins ? `${hours}h ${mins}m` : hours ? `${hours}h` : `${mins}m`;
        const startMinutes = START_HOUR * 60 + dragRange.from * SLOT_MINUTES;
        const endMinutes = startMinutes + totalMinutes;
        const fmt = (mn) => `${pad(Math.floor(mn / 60))}:${pad(mn % 60)}`;
        return (
          <div
            className={[
              "absolute rounded-md border-2 pointer-events-none flex flex-col items-center justify-center text-center overflow-hidden shadow-sm",
              dragHasConflict
                ? "bg-red-100/70 border-red-500 text-red-800"
                : "bg-orange-200/70 border-[#ec9324] text-[#7c3f00]",
            ].join(" ")}
            style={{
              top: HEADER_PX + dragRange.from * SLOT_PX,
              left: col.left + 4,
              width: col.width - 8,
              height: Math.max(22, slotCount * SLOT_PX - 2),
            }}
            data-testid="mrb-cal-drag-preview"
          >
            <div className="text-[11px] font-bold leading-tight">
              {fmt(startMinutes)} – {fmt(endMinutes)}
            </div>
            <div className="text-[10px] font-semibold leading-tight">
              {dragHasConflict ? "Conflicts with an existing meeting" : durationLabel}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ============================================================ Main Calendar View
export default function MRBCalendarView({ user, onClose, onPickSlot, onReschedule, onCancelBooking }) {
  const [date, setDate] = useState(new Date());
  const [rooms, setRooms] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [hoverSlot, setHoverSlot] = useState(null);
  const [preview, setPreview] = useState(null); // { booking, anchor }
  const [details, setDetails] = useState(null); // booking
  // Meeting-room booking detail modal — opened when a room-header on the
  // DayGrid is clicked. Shows every booking scheduled for that room on the
  // currently-visible date.
  const [roomDetail, setRoomDetail] = useState(null); // { room, bookings }
  const [tick, setTick] = useState(0);          // bumped after mutations to refresh

  // Permission helpers — admins can edit/cancel any meeting; owners only their own.
  const isAdmin = user?.role === "Super Admin" || user?.role === "Admin";
  const isOwner = (b) => b?.organizer?.id && user?.id && b.organizer.id === user.id;
  const canEdit = (b) => isAdmin || isOwner(b);
  const canCancel = (b) => isAdmin || isOwner(b);

  // Load rooms once
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/room-bookings/rooms");
        setRooms(r.data || []);
      } catch (e) { /* non-fatal */ }
    })();
  }, []);

  // Load bookings for the visible date
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const iso = toIsoDate(date);
        const r = await api.get(`/room-bookings?date=${iso}&include_past=true`);
        if (!cancelled) setBookings(r.data || []);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [date, tick]);

  // Refresh "now" line every minute (only matters when viewing today)
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const goPrevDay = () => { const d = new Date(date); d.setDate(d.getDate() - 1); setDate(d); };
  const goNextDay = () => { const d = new Date(date); d.setDate(d.getDate() + 1); setDate(d); };
  const goToday   = () => setDate(new Date());

  const handlePickEvent = useCallback((booking, anchor) => {
    setPreview({ booking, anchor });
  }, []);

  const handleCancelFromCard = useCallback(async (b) => {
    if (!b) return;
    const ok = await confirmDialog({ title: 'Cancel booking', message: `Cancel "${b.title}"?`, confirmLabel: 'Cancel booking', confirmVariant: 'destructive' });
    if (!ok) return;
    try {
      await api.delete(`/room-bookings/${b.id}`);
      toast.success("Booking cancelled");
      setPreview(null); setDetails(null);
      setTick(t => t + 1);
      onCancelBooking?.();
    } catch (e) {
      toast.error(`Cancel failed: ${e?.response?.data?.detail || e.message}`);
    }
  }, [onCancelBooking]);

  const handleEditFromCard = useCallback((b) => {
    setPreview(null); setDetails(null);
    onReschedule?.(b);
  }, [onReschedule]);

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden" data-testid="mrb-calendar-view">
      {/* Top bar */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarIcon sx={{ fontSize: 20 }} className="text-[#ec9324]"/>
          <div className="text-lg font-bold text-gray-900 truncate">Check Availability</div>
          <span className="ml-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Day View</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center bg-gray-100 rounded-md p-0.5">
            <button onClick={goPrevDay} className="p-1 hover:bg-white rounded text-gray-700" aria-label="Previous day" data-testid="mrb-cal-prev"><ChevronLeft sx={{ fontSize: 16 }}/></button>
            <button onClick={goToday}   className="px-2 text-[11px] font-bold uppercase tracking-wider text-gray-700 hover:text-[#ec9324]" data-testid="mrb-cal-today">Today</button>
            <button onClick={goNextDay} className="p-1 hover:bg-white rounded text-gray-700" aria-label="Next day" data-testid="mrb-cal-next"><ChevronRight sx={{ fontSize: 16 }}/></button>
          </div>
          <div className="text-sm font-semibold text-gray-700 px-2 hidden md:block" data-testid="mrb-cal-current-date">{fmtLongDate(date)}</div>
          <Button
            variant="outline"
            onClick={onClose}
            className="border-gray-200 text-gray-700 hover:bg-gray-50"
            data-testid="mrb-cal-close"
          >
            <X sx={{ fontSize: 14 }} className="mr-1.5"/> Close
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* LEFT: collapsible sidebar with mini month */}
        <div
          className={`relative border-r border-gray-200 bg-gray-50 transition-all duration-200 ease-out overflow-hidden flex-shrink-0 ${sidebarOpen ? "w-[240px]" : "w-[44px]"}`}
          data-testid="mrb-cal-sidebar"
          data-collapsed={!sidebarOpen}
        >
          {/* Collapse toggle */}
          <button
            type="button"
            onClick={() => setSidebarOpen(v => !v)}
            className="absolute top-2 right-2 z-10 p-1 rounded text-gray-500 hover:text-[#ec9324] hover:bg-orange-50"
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            data-testid="mrb-cal-sidebar-toggle"
          >
            {sidebarOpen ? <ChevronsLeft sx={{ fontSize: 14 }}/> : <ChevronsRight sx={{ fontSize: 14 }}/>}
          </button>

          {sidebarOpen ? (
            // The sidebar itself does NOT scroll — only the mini-month is shown.
            <div className="absolute inset-0 pt-9 px-4 pb-4 flex flex-col gap-4 overflow-hidden">
              <div className="flex-shrink-0">
                <MiniMonth value={date} onChange={setDate}/>
              </div>
            </div>
          ) : (
            <div className="pt-12 flex flex-col items-center text-gray-400">
              <CalendarIcon sx={{ fontSize: 16 }}/>
            </div>
          )}
        </div>

        {/* RIGHT: day grid */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {loading && (
            <div className="absolute top-2 right-3 text-[11px] text-gray-500 inline-flex items-center gap-1 z-30 bg-white/80 px-2 py-0.5 rounded">
              <Loader2 sx={{ fontSize: 11 }} className="animate-spin"/> Loading…
            </div>
          )}
          <DayGrid
            rooms={rooms}
            bookings={bookings}
            date={date}
            onPickSlot={(slot) => onPickSlot?.(slot)}
            onPickEvent={handlePickEvent}
            onPickRoom={(room, roomBookings) => setRoomDetail({ room, bookings: roomBookings })}
            hoverSlot={hoverSlot}
            setHoverSlot={setHoverSlot}
          />
        </div>
      </div>

      {/* Preview popover */}
      {preview && (
        <EventPreview
          booking={preview.booking}
          anchor={preview.anchor}
          onClose={() => setPreview(null)}
          onMore={() => { setDetails(preview.booking); setPreview(null); }}
          onEdit={() => handleEditFromCard(preview.booking)}
          onCancel={() => handleCancelFromCard(preview.booking)}
          canEdit={canEdit(preview.booking)}
          canCancel={canCancel(preview.booking)}
        />
      )}

      {/* Details modal */}
      {details && (
        <EventDetails
          booking={details}
          onClose={() => setDetails(null)}
          onEdit={() => handleEditFromCard(details)}
          onCancel={() => handleCancelFromCard(details)}
          canEdit={canEdit(details)}
          canCancel={canCancel(details)}
        />
      )}

      {/* Room-level booking detail (from clicking a room header on the day grid) */}
      <RoomBookingDetailDialog
        room={roomDetail?.room ? { id: roomDetail.room.room_id, name: roomDetail.room.name, capacity: roomDetail.room.capacity } : null}
        date={toIsoDate(date)}
        bookings={roomDetail?.bookings || []}
        onClose={() => setRoomDetail(null)}
      />
    </div>
  );
}
