import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import CalendarClock from "@mui/icons-material/EventOutlined";
import Plus from "@mui/icons-material/Add";
import Trash2 from "@mui/icons-material/DeleteOutlined";
import MapPin from "@mui/icons-material/PlaceOutlined";
import Clock from "@mui/icons-material/AccessTime";
import Loader2 from "@mui/icons-material/Autorenew";
import Users from "@mui/icons-material/PeopleOutlined";
import Building2 from "@mui/icons-material/ApartmentOutlined";
import X from "@mui/icons-material/Close";
import Search from "@mui/icons-material/SearchOutlined";
import UserPlus from "@mui/icons-material/PersonAddOutlined";
import ChevronDown from "@mui/icons-material/KeyboardArrowDown";
import ChevronUp from "@mui/icons-material/KeyboardArrowUp";
import AlertCircle from "@mui/icons-material/ErrorOutlined";
import Repeat from "@mui/icons-material/RepeatOutlined";
import Pencil from "@mui/icons-material/EditOutlined";
import CalendarIcon from "@mui/icons-material/CalendarTodayOutlined";
import Layout from "../components/Layout";
import api, { formatApiError } from "../lib/api";
import { resolvePdfUrl } from "../lib/pdfUrl";
import { Button } from "../components/ui/button";
import { toast } from "../lib/notify";
import { useAuth } from "../context/AuthContext";
import { useEffectivePage } from "../context/EffectivePermissionsContext";
import MRBCalendarView from "../components/MRBCalendarView";
import TimePickerOrange from "../components/ui/TimePickerOrange";
import SelectOrange from "../components/ui/SelectOrange";
import SingleDatePicker from "../components/SingleDatePicker";
import { confirm as confirmDialog } from '../lib/dialog';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

// ============================================================ Helpers
const fmtDateTime = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
  catch { return iso; }
};
const fmtTime = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
};
const todayIso = () => {
  const d = new Date(); const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const combineDateTime = (dateStr, timeStr) => {
  if (!dateStr || !timeStr) return null;
  const dt = new Date(`${dateStr}T${timeStr}:00`);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
};
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

// ============================================================ MAIN
export default function MeetingRoomBookingPage() {
  const { user } = useAuth();
  // ── Permissions V3 (Round 3) ──
  const { fn: permFn } = useEffectivePage("desk_booking", "meeting_room_bookings");
  const permBook       = permFn("book");
  const permCancel     = permFn("cancel_booking");
  const permReschedule = permFn("reschedule");
  const permRefresh    = permFn("refresh");
  // 'default' = existing split-panel view, 'calendar' = Check Availability schedule view.
  const [viewMode, setViewMode] = useState("default");
  const [rooms, setRooms] = useState([]);
  const [myBookings, setMyBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [conflict, setConflict] = useState(null);
  const [filterDate, setFilterDate] = useState(todayIso());
  const [rangeMode, setRangeMode] = useState("today");  // 'today' | 'next7'
  const formAnchorRef = useRef(null);
  const titleInputFocusRef = useRef(null);

  // When set, the form is in "Reschedule" mode editing this booking instead of creating a new one.
  // Carries enough info to pre-fill the form (title, attendees) and to know which booking to PATCH.
  const [editing, setEditing] = useState(null); // { id, title, attendees }

  // Booking form's date+time (lifted) — used by the floor map to dim conflicting rooms
  const [formDate, setFormDate] = useState(todayIso());
  const [formStart, setFormStart] = useState("10:00");
  const [formEnd, setFormEnd] = useState("11:00");

  // Bookings for the form's selected date (used to dim conflicting rooms on the map)
  const [slotBookings, setSlotBookings] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/room-bookings?date=${formDate}&include_past=true`);
        if (!cancelled) setSlotBookings(res.data || []);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [formDate]);

  // Heartbeat for "occupied right now" so the map auto-refreshes badges
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const loadRooms = useCallback(async () => {
    const res = await api.get("/room-bookings/rooms");
    setRooms(res.data || []);
  }, []);
  // Bookings for the visible range. Three modes: 'today' (today + tomorrow), 'next7' (7 days),
  // or a single date when the user picks something in the date filter.
  const addDaysIso = (offset) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const loadBookingsForDate = useCallback(async (dateIso, mode) => {
    if (mode === "next7") {
      const dates = Array.from({ length: 7 }, (_, i) => addDaysIso(i));
      const results = await Promise.all(dates.map(d => api.get(`/room-bookings?date=${d}&include_past=true`).catch(() => ({ data: [] }))));
      const merged = results.flatMap(r => r.data || []);
      const seen = new Set();
      setMyBookings(merged.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true; }));
      return;
    }
    const isToday = dateIso === todayIso();
    if (isToday) {
      const tomorrow = addDaysIso(1);
      const [a, b] = await Promise.all([
        api.get(`/room-bookings?date=${dateIso}&include_past=true`),
        api.get(`/room-bookings?date=${tomorrow}&include_past=true`),
      ]);
      const merged = [...(a.data || []), ...(b.data || [])];
      const seen = new Set();
      setMyBookings(merged.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true; }));
    } else {
      const res = await api.get(`/room-bookings?date=${dateIso}&include_past=true`);
      setMyBookings(res.data || []);
    }
  }, []);

  // My own pending/declined meeting-room requests — shown alongside bookings
  // in the "Upcoming Bookings" list with a status pill so users can see the
  // state of every request they've submitted.
  const [myPendingRequests, setMyPendingRequests] = useState([]);
  const loadPendingRequests = useCallback(async () => {
    try {
      const [pRes, dRes] = await Promise.all([
        api.get("/meeting-room-requests", { params: { status: "Pending Approval" } }).catch(() => ({ data: [] })),
        api.get("/meeting-room-requests", { params: { status: "Declined" } }).catch(() => ({ data: [] })),
      ]);
      setMyPendingRequests([...(pRes.data || []), ...(dRes.data || [])]);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { await Promise.all([loadRooms(), loadBookingsForDate(filterDate, rangeMode), loadPendingRequests()]); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRooms]);

  useEffect(() => { loadBookingsForDate(filterDate, rangeMode); }, [filterDate, rangeMode, loadBookingsForDate]);
  // Refresh pending requests whenever filter date changes
  useEffect(() => { loadPendingRequests(); }, [filterDate, loadPendingRequests]);

  // Compute room status sets for the floor map:
  //  • occupiedNowRoomIds — rooms currently mid-meeting (any active booking spans `now`)
  //  • slotConflictRoomIds — rooms whose schedule conflicts with the form-selected date+start+end
  const occupiedNowRoomIds = useMemo(() => {
    const now = nowTick;
    const set = new Set();
    for (const b of myBookings) {
      if (b.cancelled) continue;
      const s = new Date(b.start_at).getTime();
      const e = new Date(b.end_at).getTime();
      if (s <= now && now < e) set.add(b.room_id);
    }
    return set;
  }, [myBookings, nowTick]);

  const slotConflictRoomIds = useMemo(() => {
    const set = new Set();
    if (!formOpen) return set;
    const slotStart = combineDateTime(formDate, formStart);
    const slotEnd = combineDateTime(formDate, formEnd);
    if (!slotStart || !slotEnd) return set;
    const sMs = new Date(slotStart).getTime();
    const eMs = new Date(slotEnd).getTime();
    if (!(eMs > sMs)) return set;
    for (const b of slotBookings) {
      if (b.cancelled) continue;
      const bs = new Date(b.start_at).getTime();
      const be = new Date(b.end_at).getTime();
      if (bs < eMs && be > sMs) set.add(b.room_id);
    }
    return set;
  }, [formOpen, formDate, formStart, formEnd, slotBookings]);

  // Index bookings by room for today (used by the floor map's Quick-Book feature)
  const bookingsByRoom = useMemo(() => {
    const map = {};
    for (const b of myBookings) {
      if (b.cancelled) continue;
      (map[b.room_id] = map[b.room_id] || []).push(b);
    }
    return map;
  }, [myBookings]);

  // Compute the next free 30-minute slot for a given room starting at `now` (rounded up to 5 min).
  // Walks forward in 5-min increments up to 24h. Returns { startIso, endIso } or null.
  const computeNextFreeSlot = useCallback((roomId) => {
    const start = new Date();
    const minutes = start.getMinutes();
    const nextStart = new Date(start);
    nextStart.setMinutes(minutes + (5 - (minutes % 5)) % 5 || (minutes % 5 === 0 ? 0 : 5), 0, 0);
    if (nextStart < start) nextStart.setMinutes(nextStart.getMinutes() + 5);
    const SLOT_MS = 30 * 60 * 1000;
    const STEP_MS = 5 * 60 * 1000;
    const MAX_STEPS = (24 * 60) / 5; // up to 24h ahead
    const todays = bookingsByRoom[roomId] || [];
    const intervals = todays.map(b => [new Date(b.start_at).getTime(), new Date(b.end_at).getTime()]);
    for (let i = 0; i < MAX_STEPS; i++) {
      const s = nextStart.getTime() + i * STEP_MS;
      const e = s + SLOT_MS;
      const clash = intervals.some(([bs, be]) => bs < e && be > s);
      if (!clash) return { startIso: new Date(s).toISOString(), endIso: new Date(e).toISOString() };
    }
    return null;
  }, [bookingsByRoom]);

  const handleQuickBook = useCallback((room) => {
    const slot = computeNextFreeSlot(room.room_id);
    if (!slot) { toast.error("No free 30-min slot in the next 24h for this room"); return; }
    const sd = new Date(slot.startIso);
    const ed = new Date(slot.endIso);
    const p = (n) => String(n).padStart(2, "0");
    setFormDate(`${sd.getFullYear()}-${p(sd.getMonth() + 1)}-${p(sd.getDate())}`);
    setFormStart(`${p(sd.getHours())}:${p(sd.getMinutes())}`);
    setFormEnd(`${p(ed.getHours())}:${p(ed.getMinutes())}`);
    setSelectedRoomId(room.room_id);
    setFormOpen(true);
    setConflict(null);
    requestAnimationFrame(() => {
      formAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => titleInputFocusRef.current?.focus?.(), 250);
    });
    toast.info(`Quick-booked the next free 30 min for ${room.name}`, {
      description: `${sd.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${ed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Add a title and Submit.`,
    });
  }, [computeNextFreeSlot]);

  const selectedRoom = useMemo(() => rooms.find(r => r.room_id === selectedRoomId), [rooms, selectedRoomId]);
  // Floor plan currently shown on the right panel = plan of the selected room, else first available
  const focusPlan = useMemo(() => {
    if (selectedRoom) return { plan_id: selectedRoom.plan_id, pdfUrl: selectedRoom.pdfUrl, plan_name: selectedRoom.plan_name };
    if (rooms[0]) return { plan_id: rooms[0].plan_id, pdfUrl: rooms[0].pdfUrl, plan_name: rooms[0].plan_name };
    return null;
  }, [selectedRoom, rooms]);
  const roomsOnFocusPlan = useMemo(() => {
    if (!focusPlan) return [];
    return rooms.filter(r => r.plan_id === focusPlan.plan_id);
  }, [rooms, focusPlan]);

  // Button click: always open the form, scroll into view, focus title input.
  // Per spec: do NOT toggle closed via this button — form has its own X close.
  const openBookingForm = useCallback(() => {
    setEditing(null);
    setFormOpen(true);
    setConflict(null);
    requestAnimationFrame(() => {
      formAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => titleInputFocusRef.current?.focus?.(), 200);
    });
  }, []);

  // Open the form in "Reschedule" mode pre-filled with this booking's data.
  // Pre-fills: title, room, date, start, end, attendees. Submitting will PATCH instead of POST.
  const handleReschedule = useCallback((b) => {
    const sd = new Date(b.start_at);
    const ed = new Date(b.end_at);
    const p = (n) => String(n).padStart(2, "0");
    setFormDate(`${sd.getFullYear()}-${p(sd.getMonth() + 1)}-${p(sd.getDate())}`);
    setFormStart(`${p(sd.getHours())}:${p(sd.getMinutes())}`);
    setFormEnd(`${p(ed.getHours())}:${p(ed.getMinutes())}`);
    setSelectedRoomId(b.room_id);
    setEditing({ id: b.id, title: b.title, attendees: b.attendees || [] });
    setFormOpen(true);
    setConflict(null);
    requestAnimationFrame(() => {
      formAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => titleInputFocusRef.current?.focus?.(), 200);
    });
  }, []);

  const handleCancel = async (id) => {
    const ok = await confirmDialog({ title: 'Cancel booking', message: 'Cancel this booking?', confirmLabel: 'Cancel booking', confirmVariant: 'destructive' });
    if (!ok) return;
    try {
      await api.delete(`/room-bookings/${id}`);
      await Promise.all([
        loadBookingsForDate(filterDate, rangeMode),
        // refresh slot bookings so the map's dimming reflects the cancellation
        api.get(`/room-bookings?date=${formDate}&include_past=true`).then(r => setSlotBookings(r.data || [])).catch(() => {}),
      ]);
      toast.success("Booking cancelled");
    } catch (e) {
      toast.error(`Cancel failed: ${e?.response?.data?.detail || e.message}`);
    }
  };

  const handleCreate = async (payload) => {
    setConflict(null);
    try {
      // Edit / Reschedule path → PATCH the existing booking. Only fields the form lets the user
      // change for a reschedule are sent: title, room, slot, attendees. The recurring spec is
      // intentionally ignored here because reschedule operates on a single occurrence.
      if (editing?.id) {
        const patchBody = {
          title: payload.title,
          plan_id: payload.plan_id,
          room_id: payload.room_id,
          start_at: payload.start_at,
          end_at: payload.end_at,
          attendees: payload.attendees,
        };
        await api.patch(`/room-bookings/${editing.id}`, patchBody);
        await Promise.all([
          loadBookingsForDate(filterDate, rangeMode),
          api.get(`/room-bookings?date=${formDate}&include_past=true`).then(r => setSlotBookings(r.data || [])).catch(() => {}),
        ]);
        setFormOpen(false);
        setEditing(null);
        toast.success("Booking Rescheduled Successfully");
        return;
      }
      const res = await api.post("/room-bookings", payload);
      await Promise.all([
        loadBookingsForDate(filterDate, rangeMode),
        api.get(`/room-bookings?date=${formDate}&include_past=true`).then(r => setSlotBookings(r.data || [])).catch(() => {}),
        loadPendingRequests(),
      ]);
      setFormOpen(false);
      const n = res.data?.created || 1;
      const autoApproved = (res.data?.auto_approved || []).length;
      // Approval flow: if any occurrence was auto-approved, show "booked";
      // otherwise it went into Pending Approval and awaits admin action.
      if (autoApproved > 0 && autoApproved === n) {
        toast.success("Meeting Room Booked Successfully", { description: n > 1 ? `${n} recurring occurrences created.` : undefined });
      } else if (autoApproved > 0) {
        toast.success(`${autoApproved} of ${n} occurrences booked — the rest are pending approval.`);
      } else {
        toast.success("Meeting request submitted for approval", { description: n > 1 ? `${n} recurring occurrences awaiting approval.` : "You'll be notified when an admin reviews it." });
      }
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (detail && typeof detail === "object" && detail.code === "BOOKING_CONFLICT") {
        setConflict(detail);
      } else {
        toast.error(typeof detail === "string" ? detail : (editing ? "Reschedule failed" : "Booking failed"));
      }
    }
  };

  // Triggered from the calendar's empty-slot click. Pre-fills date / room / time and
  // opens the booking form WITHOUT leaving the calendar view — the form renders as a
  // modal overlay on top of the calendar (see `viewMode === 'calendar' && formOpen` JSX).
  const handleCalendarPickSlot = useCallback(({ roomId, date, start, end }) => {
    setEditing(null);
    setConflict(null);
    setSelectedRoomId(roomId);
    setFormDate(date);
    setFormStart(start);
    setFormEnd(end);
    setFormOpen(true);
    requestAnimationFrame(() => {
      setTimeout(() => titleInputFocusRef.current?.focus?.(), 200);
    });
  }, []);

  // Reschedule from the calendar's preview/details card — keep user inside the calendar
  // and open the existing booking form in modal mode.
  const handleCalendarReschedule = useCallback((b) => {
    handleReschedule(b);
  }, [handleReschedule]);

  return (
    <Layout
      title="Meeting Room Booking"
      fullBleed
      contentClassName="h-[calc(100vh-56px)] flex flex-col"
      actions={
        viewMode === "calendar" ? null : (
          permBook.isVisible ? (
            <Button
              onClick={openBookingForm}
              data-testid="mrb-book-meeting-room-btn"
              className="bg-[#ec9324] hover:bg-[#d4811f] text-white shadow-sm flex-shrink-0 h-9"
              disabled={!permBook.canUse}
            >
              <Plus sx={{ fontSize: 16 }} className="mr-1.5"/>
              Book Meeting Room
            </Button>
          ) : null
        )
      }
    >
      {viewMode === "calendar" ? (
        <>
          <MRBCalendarView
            user={user}
            onClose={() => setViewMode("default")}
            onPickSlot={handleCalendarPickSlot}
            onReschedule={handleCalendarReschedule}
            onCancelBooking={() => loadBookingsForDate(filterDate, rangeMode)}
          />
          {/* Booking form rendered as a modal overlay on top of the calendar so the
              user never leaves the schedule view while filling in meeting details. */}
          {formOpen && (
            <div
              className="fixed inset-0 z-[55] bg-black/40 backdrop-blur-sm flex items-center justify-center overflow-y-auto p-4 sm:p-8 animate-in fade-in duration-150"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) {
                  setFormOpen(false); setConflict(null); setEditing(null);
                }
              }}
              data-testid="mrb-calendar-form-modal"
            >
              <div className="relative w-full max-w-[640px] max-h-[90vh] flex flex-col bg-white rounded-lg shadow-2xl border border-gray-200 animate-in zoom-in-95 duration-200">
                <div className="px-5 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between gap-3 bg-white z-10 rounded-t-lg flex-shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Plus sx={{ fontSize: 18 }} className="text-[#ec9324] flex-shrink-0"/>
                    <h2 className="text-base font-bold text-gray-900 truncate">
                      {editing ? "Reschedule Meeting" : "Book Meeting Room"}
                    </h2>
                  </div>
                  <button
                    onClick={() => { setFormOpen(false); setConflict(null); setEditing(null); }}
                    className="p-1.5 rounded text-gray-400 hover:text-gray-800 hover:bg-gray-100"
                    aria-label="Close form"
                    data-testid="mrb-calendar-form-close"
                  ><X sx={{ fontSize: 16 }}/></button>
                </div>
                <div className="px-5 pb-5 pt-3 overflow-y-auto flex-1 min-h-0">
                  <BookingForm
                    rooms={rooms}
                    selectedRoomId={selectedRoomId}
                    setSelectedRoomId={setSelectedRoomId}
                    onSubmit={handleCreate}
                    onCancel={() => { setFormOpen(false); setConflict(null); setEditing(null); }}
                    conflict={conflict}
                    clearConflict={() => setConflict(null)}
                    titleInputFocusRef={titleInputFocusRef}
                    bDate={formDate} setBDate={setFormDate}
                    startTime={formStart} setStartTime={setFormStart}
                    endTime={formEnd} setEndTime={setFormEnd}
                    slotConflictRoomIds={slotConflictRoomIds}
                    editing={editing}
                    hideHeader
                  />
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT panel — 32% of viewport (reduced 20% from previous 40%) */}
        <div className="w-[32%] min-w-[340px] border-r border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
            <CalendarClock className="text-[#ec9324] flex-shrink-0" sx={{ fontSize: 22 }}/>
            <span className="text-sm font-semibold text-gray-700">Upcoming bookings</span>
          </div>

          {/* Left panel body: a single flex column that fills the remaining height.
              When the booking form is open, it REPLACES the upcoming list (starts from the
              same "Upcoming Bookings" position) so meeting cards never push the form to the
              bottom. After Submit / Cancel the form closes and the upcoming list returns. */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {formOpen ? (
              /* Form view — occupies the full left-panel body.
                 Subtle slide+fade-in from the right when it takes over. */
              <div
                ref={formAnchorRef}
                key="mrb-form-view"
                className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-4 animate-in fade-in slide-in-from-right-3 duration-300 ease-out"
              >
                <BookingForm
                  rooms={rooms}
                  selectedRoomId={selectedRoomId}
                  setSelectedRoomId={setSelectedRoomId}
                  onSubmit={handleCreate}
                  onCancel={() => { setFormOpen(false); setConflict(null); setEditing(null); }}
                  conflict={conflict}
                  clearConflict={() => setConflict(null)}
                  titleInputFocusRef={titleInputFocusRef}
                  bDate={formDate} setBDate={setFormDate}
                  startTime={formStart} setStartTime={setFormStart}
                  endTime={formEnd} setEndTime={setFormEnd}
                  slotConflictRoomIds={slotConflictRoomIds}
                  editing={editing}
                />
              </div>
            ) : (
              /* Upcoming bookings — fills the entire remaining height of the left panel.
                 Subtle fade-in (+ slide-in-from-left) when it returns after Submit/Cancel. */
              <section
                data-testid="mrb-upcoming-section"
                key="mrb-upcoming-view"
                className="flex-1 min-h-0 flex flex-col px-5 pt-4 pb-2 animate-in fade-in slide-in-from-left-2 duration-300 ease-out"
              >
                <div className="flex items-center justify-between mb-2 gap-2 flex-shrink-0">
                  <h2 className="text-[11px] font-bold tracking-wide text-gray-500 uppercase" data-testid="mrb-upcoming-title">Upcoming Bookings</h2>
                  <div className="flex items-center gap-2">
                    <div className="inline-flex bg-gray-100 rounded p-0.5" data-testid="mrb-range-toggle">
                      <button
                        onClick={() => { setRangeMode("today"); setFilterDate(todayIso()); }}
                        data-testid="mrb-range-today"
                        className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${rangeMode === "today" ? "bg-white text-[#ec9324] shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
                      >Today</button>
                      <button
                        onClick={() => setRangeMode("next7")}
                        data-testid="mrb-range-7"
                        className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${rangeMode === "next7" ? "bg-white text-[#ec9324] shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
                      >Next 7 days</button>
                    </div>
                    {rangeMode === "today" && (
                      <input
                        type="date"
                        value={filterDate}
                        onChange={(e) => { setFilterDate(e.target.value); }}
                        className="text-[11px] px-2 py-1 border border-gray-200 rounded focus:outline-none focus:border-[#ec9324]"
                        data-testid="mrb-upcoming-date-filter"
                      />
                    )}
                  </div>
                </div>
                <UpcomingBookingsList
                  bookings={myBookings}
                  pendingRequests={myPendingRequests}
                  filterDate={filterDate}
                  rangeMode={rangeMode}
                  loading={loading}
                  onCancel={handleCancel}
                  onReschedule={handleReschedule}
                  onCancelRequest={async (id) => {
                    try {
                      await api.delete(`/meeting-room-requests/${id}`);
                      toast.success("Request cancelled");
                      await loadPendingRequests();
                    } catch (e) {
                      toast.error(formatApiError(e?.response?.data?.detail) || "Could not cancel request");
                    }
                  }}
                />
              </section>
            )}
          </div>
        </div>

        {/* RIGHT 60% — Floor Map */}
        <div className="flex-1 relative bg-gray-100">
          {/* Top-right floating action: opens the Google-Calendar-style schedule view.
              Also closes any currently-open booking form so the calendar loads clean
              — the form should only open when the user picks a slot in the calendar. */}
          <Button
            onClick={() => {
              setFormOpen(false);
              setEditing(null);
              setConflict(null);
              setViewMode("calendar");
            }}
            data-testid="mrb-check-availability-btn"
            className="absolute top-3 right-4 z-20 bg-[#ec9324] hover:bg-[#d4811f] text-white shadow"
          >
            <CalendarIcon sx={{ fontSize: 16 }} className="mr-1.5"/>
            Check Availability
          </Button>
          <FloorMapMeetingRooms
            focusPlan={focusPlan}
            rooms={roomsOnFocusPlan}
            selectedRoomId={selectedRoomId}
            onPickRoom={(id) => setSelectedRoomId(id)}
            occupiedNowRoomIds={occupiedNowRoomIds}
            blockedRoomIds={slotConflictRoomIds}
            onQuickBook={handleQuickBook}
          />
        </div>
      </div>
      )}
    </Layout>
  );
}

// ============================================================ Booking Form
function BookingForm({ rooms, selectedRoomId, setSelectedRoomId, onSubmit, onCancel, conflict, clearConflict, titleInputFocusRef,
  bDate, setBDate, startTime, setStartTime, endTime, setEndTime, slotConflictRoomIds, editing, hideHeader }) {
  const isEdit = !!editing?.id;
  const [title, setTitle] = useState(editing?.title || "");
  const localTitleRef = useRef(null);
  // expose this input's focus to parent so the +Book Meeting Room button can focus it
  useEffect(() => {
    if (titleInputFocusRef) {
      titleInputFocusRef.current = () => localTitleRef.current?.focus();
    }
    return () => { if (titleInputFocusRef) titleInputFocusRef.current = null; };
  }, [titleInputFocusRef]);
  const selectedRoom = useMemo(() => rooms.find(r => r.room_id === selectedRoomId), [rooms, selectedRoomId]);
  const dropdownDisabled = rooms.length === 0;
  const dropdownPlaceholder =
    rooms.length === 0
      ? "No Active Floor Plan / No Meeting Room Available"
      : "Select a Meeting Room…";
  const isSelectedRoomBlocked = !!(selectedRoomId && slotConflictRoomIds?.has?.(selectedRoomId));
  // Local-only fields (lifted state owns date/start/end via props)
  const [attendees, setAttendees] = useState(editing?.attendees || []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [freq, setFreq] = useState("daily");
  const [days, setDays] = useState([]);
  const [endDate, setEndDate] = useState(todayIso());
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    clearConflict();
    if (!title.trim()) { toast.error("Title is required"); return; }
    if (!selectedRoomId) { toast.error("Please select a meeting room"); return; }
    const s = combineDateTime(bDate, startTime);
    const e = combineDateTime(bDate, endTime);
    if (!s || !e) { toast.error("Invalid date/time"); return; }
    if (new Date(e) <= new Date(s)) { toast.error("End must be after start"); return; }
    if (recurring && !endDate) { toast.error("Recurring end date is required"); return; }
    if (recurring && freq === "weekly" && days.length === 0) { toast.error("Select at least one weekday"); return; }
    setSubmitting(true);
    try {
      await onSubmit({
        plan_id: selectedRoom.plan_id,
        room_id: selectedRoom.room_id,
        title: title.trim(),
        start_at: s,
        end_at: e,
        attendees,
        recurring: recurring ? { frequency: freq, end_date: endDate, days: freq === "weekly" ? days : [] } : null,
      });
    } finally { setSubmitting(false); }
  };

  return (
    <section className={hideHeader ? "" : "border border-gray-200 rounded-lg p-4 bg-gray-50"} data-testid="mrb-booking-form">
      {!hideHeader && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-900" data-testid="mrb-form-heading">
            {isEdit ? "Reschedule Meeting" : "New Meeting"}
          </h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700" data-testid="mrb-form-close"><X sx={{ fontSize: 14 }}/></button>
        </div>
      )}

      <Field label="Title" required>
        <input
          ref={localTitleRef}
          value={title} onChange={(e) => setTitle(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-[#ec9324]"
          placeholder="e.g. Sprint Planning"
          data-testid="mrb-form-title" maxLength={120}/>
      </Field>

      <Field label="Meeting Room" required>
        {/* Typeable searchable dropdown — the trigger itself is the search
            input (no separate search bar inside the popup). Each option
            shows the room name (left) and its capacity (right-aligned).
            The floor / tower sublabel is intentionally omitted here per
            product spec (2 fields only for visual symmetry). */}
        <SelectOrange
          value={selectedRoomId}
          onChange={(v) => setSelectedRoomId(v)}
          disabled={dropdownDisabled}
          placeholder={dropdownPlaceholder}
          variant="typeable"
          testIdPrefix="mrb-form-room"
          options={rooms.map((r) => ({
            value: r.room_id,
            label: r.name,
            right: `${r.capacity} Seats`,
            // Still allow the plan/tower name to match while searching,
            // even though it is not shown in the option row.
            searchExtra: r.plan_name,
          }))}
        />
        {selectedRoom && (
          <div className="mt-1.5 text-[11px] text-gray-600 inline-flex items-center gap-1.5" data-testid="mrb-form-capacity">
            <Users sx={{ fontSize: 11 }} className="text-emerald-600"/>
            <span className="font-semibold">{selectedRoom.name}</span> · Capacity: <span className="font-bold text-gray-900">{selectedRoom.capacity}</span> Seats
          </div>
        )}
        {isSelectedRoomBlocked && (
          <div className="mt-1.5 px-2 py-1 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-800 inline-flex items-center gap-1.5" data-testid="mrb-form-blocked-hint">
            <AlertCircle sx={{ fontSize: 11 }}/> This room is already booked at the selected time. Pick another slot or room.
          </div>
        )}
      </Field>

      <div className="grid grid-cols-3 gap-2 mt-3 items-start" data-testid="mrb-form-datetime-row">
        <Field label="Date" noStack>
          <SingleDatePicker
            value={bDate}
            onChange={setBDate}
            testId="mrb-form-date"
          />
        </Field>
        <Field label="Start Time" noStack>
          {/* Custom orange-highlighted time picker (native <input type="time">
              always uses the browser's blue selection color which cannot be
              themed via CSS). */}
          <TimePickerOrange
            value={startTime}
            onChange={setStartTime}
            minuteStep={5}
            testIdPrefix="mrb-form-start"
          />
        </Field>
        <Field label="End Time" noStack>
          <TimePickerOrange
            value={endTime}
            onChange={setEndTime}
            minuteStep={5}
            testIdPrefix="mrb-form-end"
          />
        </Field>
      </div>

      {/* Attendees */}
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11px] font-semibold text-gray-700">Attendees <span className="text-gray-400 font-normal">(optional)</span></label>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1 text-[11px] text-[#ec9324] hover:text-[#d4811f] font-semibold"
            data-testid="mrb-form-add-attendees"
          ><UserPlus sx={{ fontSize: 12 }}/> Add Attendees</button>
        </div>
        {attendees.length === 0 ? (
          <div className="text-[11px] text-gray-400 italic">No attendees added yet.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5" data-testid="mrb-attendee-chips">
            {attendees.map(a => (
              <span key={`${a.type}-${a.id}`} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${a.type === 'team' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                {a.type === 'team' ? <Users sx={{ fontSize: 9 }}/> : null}
                {a.name}
                <button onClick={() => setAttendees(prev => prev.filter(x => !(x.type === a.type && x.id === a.id)))} className="hover:bg-black/5 rounded-full p-0.5" data-testid={`mrb-attendee-remove-${a.type}-${a.id}`}><X sx={{ fontSize: 9 }}/></button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Recurring — hidden in Reschedule mode because rescheduling targets a single occurrence */}
      {!isEdit && (
      <div className="mt-3 p-2 bg-white rounded border border-gray-200">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-[11px] font-semibold text-gray-700 inline-flex items-center gap-1"><Repeat sx={{ fontSize: 11 }}/> Recurring</span>
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="accent-[#ec9324]" data-testid="mrb-form-recurring-toggle"/>
        </label>
        {recurring && (
          <div className="mt-2 space-y-2" data-testid="mrb-form-recurring-panel">
            <div className="grid grid-cols-2 gap-2 items-start">
              <div>
                <div className="text-[10px] font-semibold text-gray-600 mb-1">Frequency</div>
                <SelectOrange
                  value={freq}
                  onChange={setFreq}
                  testIdPrefix="mrb-form-freq"
                  options={[
                    { value: 'daily',       label: 'Daily' },
                    { value: 'weekly',      label: 'Weekly' },
                    { value: 'fortnightly', label: 'Fortnightly' },
                    { value: 'monthly',     label: 'Monthly' },
                  ]}
                />
              </div>
              <div>
                <div className="text-[10px] font-semibold text-gray-600 mb-1">End Date</div>
                <SingleDatePicker
                  value={endDate}
                  onChange={setEndDate}
                  min={bDate}
                  testId="mrb-form-end-date"
                  size="md"
                />
              </div>
            </div>
            {freq === "weekly" && (
              <div>
                <div className="text-[10px] font-semibold text-gray-600 mb-1">Days of week</div>
                <div className="flex gap-1" data-testid="mrb-form-weekdays">
                  {DOW.map(d => {
                    const on = days.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])}
                        data-testid={`mrb-form-weekday-${d}`}
                        className={`w-7 h-7 rounded-full text-[10px] font-bold border transition-colors ${on ? 'bg-[#ec9324] text-white border-[#ec9324]' : 'bg-white text-gray-600 border-gray-300 hover:border-[#ec9324]'}`}
                      >{d[0]}</button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Conflict */}
      {conflict && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded" data-testid="mrb-conflict">
          <div className="flex items-start gap-2">
            <AlertCircle sx={{ fontSize: 14 }} className="text-red-600 mt-0.5"/>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-red-700 mb-1">Conflict Found</div>
              <div className="text-[11px] text-red-700 mb-1">{conflict.room_name} already booked</div>
              {(conflict.conflicts || []).slice(0, 3).map((c, i) => (
                <div key={i} className="text-[11px] text-gray-700 mb-0.5">
                  <span className="font-semibold">{fmtTime(c.with?.start_at)} – {fmtTime(c.with?.end_at)}</span>
                  {c.with?.title && <> · "{c.with.title}"</>}
                  <div className="text-[10px] text-gray-500">Booked By: {c.with?.organizer?.name || '—'}</div>
                </div>
              ))}
              {(conflict.conflicts || []).length > 3 && (
                <div className="text-[10px] text-gray-500">+{conflict.conflicts.length - 3} more conflicts</div>
              )}
              <div className="text-[10px] text-red-700 mt-1.5">Please select another room or time slot.</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" onClick={onCancel} data-testid="mrb-form-cancel-btn">Cancel</Button>
        <Button onClick={submit} disabled={submitting || !selectedRoomId || isSelectedRoomBlocked} className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="mrb-form-submit">
          {submitting ? (isEdit ? "Rescheduling…" : "Booking…") : (isEdit ? "Save Changes" : "Submit")}
        </Button>
      </div>

      {pickerOpen && (
        <AttendeePicker
          selected={attendees}
          onClose={() => setPickerOpen(false)}
          onChange={setAttendees}
        />
      )}
    </section>
  );
}

function Field({ label, required, children, className = "", noStack = false }) {
  return (
    <div className={`${noStack ? "" : "mt-3 first:mt-0"} ${className}`}>
      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

// ============================================================ Upcoming bookings list
// - Capped to ~33% of viewport so the floor map stays the primary focus.
// - rangeMode="today" → "Today" + "Tomorrow" groups (or single date when filter ≠ today).
// - rangeMode="next7" → 7 day groups starting from today.
// - Per-day pagination: first PAGE_SIZE shown, "+N more" expands the rest.
const PAGE_SIZE = 4;
function UpcomingBookingsList({ bookings, pendingRequests = [], filterDate, rangeMode, loading, onCancel, onReschedule, onCancelRequest }) {
  const today = todayIso();
  const addDaysIso = (offset) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const isFilterToday = filterDate === today;

  // Merge approved bookings + pending / declined meeting-room requests into a
  // single list. Each entry gains a `_kind` ("booking" | "request") and a
  // `_status` used to render the pill. Bookings are tagged "Approved" (they
  // only make it into the list once the request was approved). Requests
  // carry their own status ("Pending Approval" / "Declined").
  const merged = useMemo(() => {
    const list = [];
    for (const b of bookings) {
      list.push({ ...b, _kind: "booking", _status: b.cancelled ? "Cancelled" : "Approved" });
    }
    for (const r of pendingRequests) {
      list.push({
        ...r,
        organizer: r.requested_by,     // normalise so the same JSX renders both
        _kind: "request",
        _status: r.status || "Pending Approval",
      });
    }
    return list;
  }, [bookings, pendingRequests]);

  const groups = useMemo(() => {
    const map = {};
    for (const b of merged) {
      const d = new Date(b.start_at);
      const p = (n) => String(n).padStart(2, "0");
      const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      (map[key] = map[key] || []).push(b);
    }
    Object.values(map).forEach(arr => arr.sort((a, b) => (a.start_at || "").localeCompare(b.start_at || "")));
    return map;
  }, [merged]);

  const formatDayLabel = (key, idx) => {
    if (key === today) return "Today";
    if (key === addDaysIso(1)) return "Tomorrow";
    const d = new Date(key);
    return d.toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "short" });
  };

  let dayGroups;
  if (rangeMode === "next7") {
    dayGroups = Array.from({ length: 7 }, (_, i) => {
      const key = addDaysIso(i);
      return { key, label: formatDayLabel(key, i), items: groups[key] || [] };
    });
  } else if (isFilterToday) {
    dayGroups = [
      { key: today, label: "Today", items: groups[today] || [] },
      { key: addDaysIso(1), label: "Tomorrow", items: groups[addDaysIso(1)] || [] },
    ];
  } else {
    dayGroups = [{ key: filterDate, label: new Date(filterDate).toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "short", year: "numeric" }), items: groups[filterDate] || [] }];
  }

  const totalForView = dayGroups.reduce((s, g) => s + g.items.length, 0);

  if (loading) {
    return <div className="flex items-center text-gray-500 text-xs"><Loader2 className="animate-spin mr-2" sx={{ fontSize: 14 }}/> Loading…</div>;
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-1" data-testid="mrb-upcoming-list-wrapper">
      {totalForView === 0 ? (
        <div className="flex items-center justify-center text-center bg-gray-50 border border-dashed border-gray-200 rounded-lg py-8 px-4" data-testid="mrb-no-upcoming">
          <div>
            <div className="text-sm font-bold text-gray-500">No Meeting Room Bookings Available</div>
            <div className="text-[11px] text-gray-400 mt-0.5">Click "Book Meeting Room" to create one.</div>
          </div>
        </div>
      ) : (
        <div className="space-y-3" data-testid="mrb-upcoming-list">
          {dayGroups.map(g => <DayGroup key={g.key} group={g} onCancel={onCancel} onReschedule={onReschedule} onCancelRequest={onCancelRequest}/>)}
        </div>
      )}
    </div>
  );
}

// ==================================================================== Status pill
// Same design language as Workstation Booking: capsule with 2-px colored border
// on a white background. Colours map to the workstation-request approval states.
function StatusPill({ status, dataTestId }) {
  const map = {
    "Approved":         { fg: "#059669", bg: "#ffffff", bd: "#10b981", label: "Approved"  },
    "Pending Approval": { fg: "#ec9324", bg: "#ffffff", bd: "#ec9324", label: "Pending"   },
    "Declined":         { fg: "#dc2626", bg: "#ffffff", bd: "#ef4444", label: "Declined"  },
    "Cancelled":        { fg: "#6b7280", bg: "#ffffff", bd: "#9ca3af", label: "Cancelled" },
  };
  const s = map[status] || map["Approved"];
  return (
    <span
      data-testid={dataTestId}
      data-status={status}
      className="inline-flex items-center justify-center h-5 px-2 text-[10px] font-semibold rounded-full border-2 select-none whitespace-nowrap shrink-0"
      style={{ color: s.fg, borderColor: s.bd, backgroundColor: s.bg }}
    >
      {s.label}
    </span>
  );
}

function DayGroup({ group, onCancel, onReschedule, onCancelRequest }) {
  const [expanded, setExpanded] = useState(false);
  const list = expanded ? group.items : group.items.slice(0, PAGE_SIZE);
  const hidden = group.items.length - list.length;
  return (
    <div data-testid={`mrb-day-section-${group.key}`}>
      <div className="text-[10px] font-bold tracking-wide text-gray-400 uppercase mb-1" data-testid={`mrb-day-${group.key}`}>{group.label}</div>
      {group.items.length === 0 ? (
        <div className="text-[11px] text-gray-400 italic px-2 py-1">No bookings</div>
      ) : list.map(b => {
        const isRequest = b._kind === "request";
        const status = b._status || "Approved";
        // Reschedule is only meaningful for approved bookings (or you'd
        // reschedule a pending request, which we don't support yet).
        const canReschedule = !isRequest && status === "Approved";
        // Cancel button: bookings → cancel booking; pending requests → cancel request; declined → hide (no action)
        const canCancel = (isRequest && status === "Pending Approval") || (!isRequest && status === "Approved");
        return (
        <div
          key={b.id}
          data-testid={`mrb-upcoming-${b.id}`}
          data-kind={b._kind}
          data-status={status}
          className={`bg-white rounded-md border px-2.5 py-1.5 mb-1 transition-colors ${
            status === "Declined" ? "border-red-200 opacity-80" :
            status === "Pending Approval" ? "border-amber-200 bg-amber-50/40" :
            status === "Cancelled" ? "border-gray-200 opacity-70" :
            "border-gray-200 hover:border-[#ec9324]/40"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="font-semibold text-[12px] text-gray-900 truncate flex-1" title={b.title}>{b.title}</div>
                <StatusPill status={status} dataTestId={`mrb-status-${b.id}`} />
              </div>
              <div className="text-[10px] text-gray-600">
                {fmtTime(b.start_at)} – {fmtTime(b.end_at)}
                <span className="text-gray-300 mx-1">·</span>{b.room_name}
              </div>
              <div className="text-[10px] text-gray-500 truncate" data-testid={`mrb-organizer-${b.id}`}>{b.organizer?.name || b.organizer?.email || "—"}</div>
              {b.organizer_team_name ? (
                <div className="text-[10px] text-[#ec9324] font-semibold truncate" data-testid={`mrb-organizer-team-${b.id}`}>{b.organizer_team_name}</div>
              ) : null}
            </div>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {canReschedule && (
                <div className="relative group/edit">
                  <button
                    onClick={() => onReschedule?.(b)}
                    aria-label="Reschedule"
                    className="p-1 text-gray-600 hover:text-[#ec9324] hover:bg-orange-50 rounded"
                    data-testid={`mrb-reschedule-${b.id}`}
                  ><Pencil sx={{ fontSize: 12 }}/></button>
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute right-1/2 translate-x-1/2 -top-7 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] font-medium whitespace-nowrap shadow opacity-0 group-hover/edit:opacity-100 transition-opacity"
                  >Reschedule</span>
                </div>
              )}
              {canCancel && (
                <div className="relative group/cancel">
                  <button
                    onClick={() => isRequest ? onCancelRequest?.(b.id) : onCancel(b.id)}
                    aria-label="Cancel"
                    className="p-1 text-red-600 hover:bg-red-50 rounded"
                    data-testid={`mrb-cancel-${b.id}`}
                  ><Trash2 sx={{ fontSize: 12 }}/></button>
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute right-1/2 translate-x-1/2 -top-7 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] font-medium whitespace-nowrap shadow opacity-0 group-hover/cancel:opacity-100 transition-opacity"
                  >{isRequest ? "Withdraw request" : "Cancel"}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })}
      {hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-[10px] text-[#ec9324] hover:underline font-semibold px-1 py-0.5"
          data-testid={`mrb-day-show-more-${group.key}`}
        >+ Show {hidden} more</button>
      )}
      {expanded && group.items.length > PAGE_SIZE && (
        <button
          onClick={() => setExpanded(false)}
          className="text-[10px] text-gray-500 hover:underline px-1 py-0.5"
          data-testid={`mrb-day-show-less-${group.key}`}
        >Show less</button>
      )}
    </div>
  );
}

// ============================================================ Attendee picker (Employees / Teams)
function AttendeePicker({ selected, onChange, onClose }) {
  const [tab, setTab] = useState("user");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loadingList, setLoadingList] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [uRes, tRes] = await Promise.all([
          api.get("/contacts?limit=200").catch(() => ({ data: [] })),
          api.get("/teams").catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        const ulist = Array.isArray(uRes.data) ? uRes.data : (uRes.data?.rows || uRes.data?.items || []);
        setUsers(ulist);
        setTeams(Array.isArray(tRes.data) ? tRes.data : (tRes.data?.rows || []));
      } finally { if (!cancelled) setLoadingList(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const q = query.trim().toLowerCase();
  const filteredUsers = useMemo(() => users.filter(u => {
    if (!q) return true;
    return (u.name || u.full_name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q);
  }), [users, q]);
  const filteredTeams = useMemo(() => teams.filter(t => !q || (t.name || "").toLowerCase().includes(q)), [teams, q]);

  const isSelected = (type, id) => selected.some(s => s.type === type && s.id === id);
  const toggle = (item, type) => {
    const id = item.id;
    const name = item.name || item.full_name || item.email;
    if (isSelected(type, id)) {
      onChange(selected.filter(s => !(s.type === type && s.id === id)));
    } else {
      onChange([...selected, { type, id, name, email: item.email }]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="mrb-attendee-picker" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-xl w-[460px] max-h-[70vh] flex flex-col">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="text-sm font-bold text-gray-900">Add Attendees</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" data-testid="mrb-picker-close"><X sx={{ fontSize: 16 }}/></button>
        </div>
        <div className="px-4 pt-3 flex items-center gap-1">
          <TabBtn active={tab === 'user'} onClick={() => setTab('user')} testId="mrb-picker-tab-user">Add Employee</TabBtn>
          <TabBtn active={tab === 'team'} onClick={() => setTab('team')} testId="mrb-picker-tab-team">Add Team</TabBtn>
        </div>
        <div className="px-4 pt-3">
          <div className="relative">
            <Search sx={{ fontSize: 13 }} className="absolute left-2.5 top-2.5 text-gray-400"/>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === 'user' ? 'Search employees…' : 'Search teams…'} className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:border-[#ec9324]" data-testid="mrb-picker-search"/>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3" data-testid="mrb-picker-list">
          {loadingList ? (
            <div className="flex items-center justify-center py-6 text-gray-400 text-xs"><Loader2 className="animate-spin mr-2" sx={{ fontSize: 14 }}/> Loading…</div>
          ) : tab === 'user' ? (
            filteredUsers.length === 0 ? (
              <div className="text-center text-xs text-gray-400 py-6">No employees found.</div>
            ) : filteredUsers.map(u => {
              const id = u.id;
              const name = u.name || u.full_name || u.email;
              const sel = isSelected('user', id);
              return (
                <button
                  key={id}
                  onClick={() => toggle(u, 'user')}
                  data-testid={`mrb-picker-user-${id}`}
                  className={`w-full text-left flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-gray-50 ${sel ? 'bg-emerald-50' : ''}`}
                >
                  {/* Only the name is shown in the row — email is intentionally
                      hidden per product spec but IS matched by the search
                      filter above (`filteredUsers` checks u.email). */}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-800 truncate">{name}</div>
                  </div>
                  {sel && <span className="text-emerald-600 text-[10px] font-bold shrink-0">Added</span>}
                </button>
              );
            })
          ) : (
            filteredTeams.length === 0 ? (
              <div className="text-center text-xs text-gray-400 py-6">No teams found.</div>
            ) : filteredTeams.map(t => {
              const sel = isSelected('team', t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => toggle(t, 'team')}
                  data-testid={`mrb-picker-team-${t.id}`}
                  className={`w-full text-left flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-gray-50 ${sel ? 'bg-emerald-50' : ''}`}
                >
                  {/* Team name (left) + members count (right) on a single
                      straight line for visual symmetry with the meeting-room
                      dropdown rows. */}
                  <div className="text-sm font-semibold text-gray-800 truncate flex-1 min-w-0">{t.name}</div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-semibold text-gray-600 tabular-nums">
                      {(t.members || []).length} member{(t.members || []).length === 1 ? '' : 's'}
                    </span>
                    {sel && <span className="text-emerald-600 text-[10px] font-bold">Added</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between gap-3">
          {/* Selected count — bottom-left, parallel to Submit */}
          <span
            className="text-[12px] text-gray-700 font-semibold"
            data-testid="mrb-picker-selected-count"
          >
            {selected.length} Selected
          </span>
          <Button
            onClick={onClose}
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white"
            data-testid="mrb-picker-done"
          >Submit</Button>
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, testId, children }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`px-3 py-1.5 text-[11px] font-bold rounded-t border-b-2 transition-colors ${active ? 'border-[#ec9324] text-[#ec9324]' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
    >{children}</button>
  );
}

// ============================================================ Floor map (right panel) — rooms-only view
export function FloorMapMeetingRooms({ focusPlan, rooms, selectedRoomId, onPickRoom, occupiedNowRoomIds, blockedRoomIds, onQuickBook }) {
  const transformRef = useRef(null);
  const initDoneRef = useRef(false);
  const containerRef = useRef(null);
  const viewportRef = useRef(null);
  const [pageWidth] = useState(1200);
  // Current zoom scale of the TransformComponent. Used by RoomBoxLabel to
  // (a) keep the text visually a similar size regardless of zoom and
  // (b) show more characters (or the full name) once space permits.
  const [scale, setScale] = useState(1);

  // Center the view on the selected room when it changes.
  //   • Zoom to a mild target scale (1.35×) so the room is clearly the focus.
  //   • Position the room at the viewport centre.
  //   • Clamp the translation so the floor-plan edges stay flush against
  //     the viewport — no blank margins peek in on any side.
  useEffect(() => {
    if (!selectedRoomId || !transformRef.current) return;
    const room = rooms.find(r => r.room_id === selectedRoomId);
    if (!room) return;
    const vp = viewportRef.current?.getBoundingClientRect();
    const content = containerRef.current?.getBoundingClientRect();
    if (!vp || !content) return;
    const state = transformRef.current.instance?.transformState || transformRef.current.state;
    const curScale = state?.scale || 1;
    // Un-transformed content dimensions. Guard against a 0-sized rect (can
    // happen if the PDF hasn't painted yet) to avoid pathological zoom.
    const contentW = content.width / curScale;
    const contentH = content.height / curScale;
    if (!contentW || !contentH || contentW < 100 || contentH < 100) return;
    // Mild zoom-in — enough for the room to feel highlighted, but small
    // enough that the map continues to cover the viewport in both
    // dimensions (assuming the initial fit already had the plan filling
    // the viewport, which centerOnInit / centerView(1,0) provides).
    const targetScale = Math.max(curScale, 1.35);
    const scaledW = contentW * targetScale;
    const scaledH = contentH * targetScale;
    // Room center in content-space pixels.
    const cx = (room.x + room.w / 2) / 100 * contentW;
    const cy = (room.y + room.h / 2) / 100 * contentH;
    // Ideal: room center at viewport center.
    let newX = vp.width / 2 - cx * targetScale;
    let newY = vp.height / 2 - cy * targetScale;
    // Clamp so plan edges stay outside (or flush with) the viewport bounds.
    // If plan is smaller than viewport in a dimension (rare after zoom-in),
    // fall back to centering the plan in that dimension.
    if (scaledW >= vp.width) {
      newX = Math.min(0, Math.max(newX, vp.width - scaledW));
    } else {
      newX = (vp.width - scaledW) / 2;
    }
    if (scaledH >= vp.height) {
      newY = Math.min(0, Math.max(newY, vp.height - scaledH));
    } else {
      newY = (vp.height - scaledH) / 2;
    }
    if (transformRef.current.setTransform) {
      transformRef.current.setTransform(newX, newY, targetScale, 350, "easeOut");
    }
  }, [selectedRoomId, rooms]);

  if (!focusPlan) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-center text-gray-500 px-6" data-testid="mrb-map-empty">
        <div>
          <Building2 sx={{ fontSize: 48 }} className="mx-auto mb-3 text-gray-300"/>
          <div className="text-base font-bold text-gray-500">NO ACTIVE FLOOR PLAN</div>
          <div className="text-xs text-gray-400 mt-1">Publish a calibrated floor plan to see meeting rooms here.</div>
        </div>
      </div>
    );
  }

  return (
    <div ref={viewportRef} className="absolute inset-0 overflow-hidden">
      <TransformWrapper
        initialScale={1} minScale={0.5} maxScale={4}
        wheel={{ step: 0.15 }} pinch={{ step: 5 }}
        doubleClick={{ disabled: true }}
        centerOnInit={true}
        smooth={true}
        limitToBounds={false}
        ref={transformRef}
        onTransformed={(_ref, state) => setScale(state?.scale || 1)}
      >
        {() => (
          <TransformComponent
            wrapperStyle={{ width: "100%", height: "100%" }}
            contentStyle={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
          >
            <div ref={containerRef} className="relative inline-block" data-testid="mrb-map-canvas">
              <Document file={resolvePdfUrl(focusPlan.pdfUrl)}
                onLoadSuccess={() => {
                  if (initDoneRef.current) return;
                  initDoneRef.current = true;
                  // No forced `centerView(1, 0)` — the flex-centered
                  // `contentStyle` above plus `centerOnInit` keeps the plan
                  // horizontally + vertically centered inside the viewport
                  // by default (mirrors the workstation floor map init).
                }}>
                <Page
                  pageNumber={1}
                  width={pageWidth}
                  devicePixelRatio={4}
                  renderMode="canvas"
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                />
              </Document>

              {/* Meeting rooms overlay only — workstations intentionally NOT rendered */}
              <div className="absolute inset-0">
                {rooms.map(r => {
                  const selected = r.room_id === selectedRoomId;
                  const blocked = blockedRoomIds?.has?.(r.room_id);
                  const occupiedNow = occupiedNowRoomIds?.has?.(r.room_id);
                  // State priority: Selected (orange) > Blocked-for-slot (grey + disabled) > Available (green)
                  let bg = 'rgba(16,185,129,0.10)'; // available
                  let borderColor = '#10b981';
                  let cursor = 'pointer';
                  if (selected) {
                    bg = 'rgba(236,147,36,0.55)'; borderColor = '#ec9324';
                  } else if (blocked) {
                    bg = 'rgba(156,163,175,0.45)'; borderColor = '#6b7280'; cursor = 'not-allowed';
                  }
                  const labelBg = selected ? '#ec9324' : blocked ? '#6b7280' : 'rgba(16,185,129,0.95)';
                  return (
                    <div
                      key={r.room_id}
                      data-testid={`mrb-map-room-${r.room_id}`}
                      data-blocked={blocked ? "true" : "false"}
                      data-occupied-now={occupiedNow ? "true" : "false"}
                      onClick={() => { if (!blocked) onPickRoom(r.room_id); }}
                      className="absolute group"
                      style={{
                        left: `${r.x}%`, top: `${r.y}%`,
                        width: `${r.w}%`, height: `${r.h}%`,
                        background: bg,
                        border: `2px solid ${borderColor}`,
                        boxSizing: 'border-box',
                        cursor,
                        opacity: blocked && !selected ? 0.85 : 1,
                        transition: 'background 150ms, border-color 150ms, opacity 150ms',
                      }}
                      onMouseEnter={(e) => {
                        if (selected || blocked) return;
                        e.currentTarget.style.background = 'rgba(16,185,129,0.25)';
                      }}
                      onMouseLeave={(e) => {
                        if (selected || blocked) return;
                        e.currentTarget.style.background = 'rgba(16,185,129,0.10)';
                      }}
                    >
                      <RoomBoxLabel
                        room={r}
                        scale={scale}
                        labelBg={labelBg}
                        occupiedNow={occupiedNow}
                        blocked={blocked}
                      />

                      {/* Quick-Book 30 min button — only on available rooms */}
                      {!blocked && (
                        <button
                          type="button"
                          data-testid={`mrb-map-quickbook-${r.room_id}`}
                          title="Quick-book the next free 30-minute slot"
                          onClick={(e) => { e.stopPropagation(); onQuickBook?.(r); }}
                          className="absolute bottom-1 right-1 rounded font-bold bg-white/95 border border-emerald-500 text-emerald-700 hover:bg-emerald-500 hover:text-white shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{
                            pointerEvents: 'auto',
                            padding: `${1 / scale}px ${4 / scale}px`,
                            fontSize: `${9 / scale}px`,
                            borderRadius: `${4 / scale}px`,
                            borderWidth: `${1 / scale}px`,
                          }}
                        >+30 min</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </TransformComponent>
        )}
      </TransformWrapper>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 bg-white border border-gray-200 rounded-lg p-2 text-[10px] shadow-sm" data-testid="mrb-map-legend">
        <div className="font-bold text-gray-700 mb-1">Legend</div>
        <div className="space-y-1">
          <Legend color="#10b981" label="Available"/>
          <Legend color="#ec9324" label="Selected"/>
          <Legend color="#6b7280" label="Booked at slot"/>
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center px-1 py-[1px] rounded-full bg-red-500 text-white text-[8px] font-bold">NOW</span>
            <span className="text-gray-600">Occupied right now</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * RoomBoxLabel — the centered "Alpha / Seats : 14" label inside every
 * meeting-room box on the floor map.
 *
 * Design goals (from product spec):
 *   • Both lines (name + seats) are centered horizontally & vertically.
 *   • Text auto-sizes so it never overflows the box AND — even when the
 *     user zooms in a lot — never grows into a giant billboard. This is
 *     achieved by dividing the CSS font-size by the current zoom scale so
 *     the on-screen size stays in a tight target band (≈ 9–13 px).
 *   • If the box is too narrow to render the full name at the target font
 *     size, the name is truncated with an ellipsis (e.g. "Alpha" → "Al…",
 *     "Alp…"). Because the on-screen width grows with zoom, the visible
 *     characters increase automatically as the user zooms in, and the
 *     full name reappears once space permits.
 *   • Hover tooltip uses the same dark-pill design as the Notification
 *     Bell in the TopBar: rounded, dark grey, small white text. It always
 *     shows the FULL name and seat count, regardless of truncation.
 */
function RoomBoxLabel({ room, scale, labelBg, occupiedNow, blocked }) {
  const wrapperRef = useRef(null);
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });

  // The wrapper is `w-full h-full` inside the room's absolutely-positioned
  // div, so its offsetWidth/offsetHeight give us the box dimensions IN MAP
  // pixels (i.e. before the CSS transform scale is applied). This is
  // constant across zoom changes, which is exactly what we want to plan
  // the text layout.
  useEffect(() => {
    if (!wrapperRef.current) return;
    const el = wrapperRef.current;
    const update = () => setBoxSize({ w: el.offsetWidth, h: el.offsetHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const name = room.name || '';
  const seatsText = `Seats : ${room.capacity}`;

  // ── Font-size selection ────────────────────────────────────────────
  // Target on-screen font size in px, clamped tight so zoom-in doesn't
  // create huge labels.
  const TARGET_MAX = 13;
  const TARGET_MIN = 8;
  // Rough character width factor for a sans-serif at font-size f.
  const CHAR_W = 0.58;
  // Screen-pixel dimensions of the box at the current zoom scale.
  const screenW = boxSize.w * scale;
  const screenH = boxSize.h * scale;

  // Height budget: 2 lines with a bit of leading + a couple of pixels of
  // padding. Solve for f from `2 * f * 1.2 + 4 <= screenH`.
  const fFromHeight = Math.max(TARGET_MIN, Math.min(TARGET_MAX, (screenH - 6) / (2 * 1.2)));

  // Width budget: seats line is usually the longer of the two, so make
  // sure it fits. Solve `seatsText.length * f * CHAR_W <= screenW - 8`.
  const fFromWidth =
    seatsText.length > 0
      ? Math.max(TARGET_MIN, Math.min(TARGET_MAX, (screenW - 8) / (seatsText.length * CHAR_W)))
      : TARGET_MAX;

  const fScreen = Math.max(TARGET_MIN, Math.min(TARGET_MAX, Math.min(fFromHeight, fFromWidth)));

  // Convert to map-pixel font-size (inside the transformed container,
  // dividing by scale keeps the on-screen size ≈ fScreen).
  const fMap = fScreen / Math.max(0.01, scale);
  const fMapSmall = (fScreen * 0.85) / Math.max(0.01, scale);

  // ── Name truncation ────────────────────────────────────────────────
  // How many characters of the name can we show at fScreen while
  // respecting the box's on-screen width? Leave 8 screen-px of padding.
  const maxNameCharsRaw = Math.floor((screenW - 8) / Math.max(1, fScreen * CHAR_W));
  const maxNameChars = Number.isFinite(maxNameCharsRaw) ? Math.max(1, maxNameCharsRaw) : name.length;
  const isTruncated = name.length > maxNameChars;
  const displayName = isTruncated
    ? `${name.slice(0, Math.max(1, maxNameChars - 1))}…`
    : name;

  // Hide the label entirely if the box is basically a dot — otherwise a
  // sliver of pill would show up and look messy.
  const tooSmall = screenW < 18 || screenH < 18;

  return (
    <div
      ref={wrapperRef}
      className="w-full h-full pointer-events-none select-none flex items-center justify-center relative"
      data-testid={`mrb-map-label-${room.room_id}`}
    >
      {!tooSmall && (
        <div
          className="flex flex-col items-center justify-center text-center"
          style={{
            gap: `${1 / Math.max(0.01, scale)}px`,
            maxWidth: '100%',
            maxHeight: '100%',
          }}
        >
          {/* Name pill */}
          <div
            className="font-semibold text-white shadow-sm"
            style={{
              background: labelBg,
              fontSize: `${fMap}px`,
              lineHeight: 1.15,
              padding: `${1 / scale}px ${5 / scale}px`,
              borderRadius: `${4 / scale}px`,
              maxWidth: '100%',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {occupiedNow && (
              <span
                data-testid={`mrb-map-now-${room.room_id}`}
                className="inline-flex items-center bg-red-500 text-white font-bold"
                style={{
                  fontSize: `${fMapSmall * 0.85}px`,
                  padding: `${0.5 / scale}px ${3 / scale}px`,
                  borderRadius: `${999 / scale}px`,
                  marginRight: `${3 / scale}px`,
                  verticalAlign: 'middle',
                }}
              >NOW</span>
            )}
            {displayName}
          </div>
          {/* Seats line */}
          <div
            className="font-medium text-white"
            style={{
              background: 'rgba(17, 24, 39, 0.75)',
              fontSize: `${fMapSmall}px`,
              lineHeight: 1.15,
              padding: `${0.5 / scale}px ${5 / scale}px`,
              borderRadius: `${4 / scale}px`,
              whiteSpace: 'nowrap',
            }}
          >
            Seats : {room.capacity}
          </div>
        </div>
      )}

      {/* Hover tooltip — same visual language as the NotificationBell
          tooltip. Uses inverse scaling so it stays a constant on-screen
          size regardless of the current zoom level. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 -bottom-1 opacity-0 group-hover:opacity-100 transition-opacity z-50"
        style={{
          transform: `translate(-50%, 100%) scale(${1 / Math.max(0.01, scale)})`,
          transformOrigin: 'top center',
        }}
      >
        <span className="inline-block px-2 py-1 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap shadow-lg">
          {room.name} · Seats: {room.capacity}
          {blocked ? ' · Booked at selected time' : ''}
        </span>
      </span>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded" style={{ background: color }}/>
      <span className="text-gray-600">{label}</span>
    </div>
  );
}
