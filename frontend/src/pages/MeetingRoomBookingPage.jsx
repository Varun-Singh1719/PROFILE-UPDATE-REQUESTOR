import React, { useEffect, useMemo, useState, useCallback, useRef, useLayoutEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
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
import MultiSelectFilter from "../components/ui/MultiSelectFilter";

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
  // Removed: `const [myBookings, setMyBookings] = useState([])` — the list
  // is now derived from `myRequests` via useMemo below so we don't
  // duplicate state across two sources of truth.
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

  // Meeting detail popup: when set to a row (booking OR request), we show the
  // MeetingDetailModal overlay with Edit + Delete affordances.
  const [detailRow, setDetailRow] = useState(null);

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
  const addDaysIso = (offset) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  // ─── Unified request list ────────────────────────────────────────────────
  // Since Jul-2026, meeting_room_requests is the source of truth for the
  // Book Meeting Room page. Approved rows are enriched with their booking
  // snapshot server-side, so a single fetch drives the entire list.
  const ALL_STATUSES = ["Pending Approval", "Approved", "Declined", "Cancelled"];
  const DEFAULT_STATUS_FILTER = ["Pending Approval", "Approved"];
  // Peek indicators — one small colored dot per selected status displayed
  // inside the filter trigger. Colors mirror StatusPill so users learn the
  // mapping once and recognise it everywhere. `ring` is a subtle contrast
  // outline so dots stay visible on white backgrounds.
  const STATUS_DOT = {
    "Approved":         { bg: "#10b981", ring: "#059669" }, // emerald
    "Pending Approval": { bg: "#ec9324", ring: "#c2751a" }, // brand orange
    "Declined":         { bg: "#ef4444", ring: "#b91c1c" }, // red
    "Cancelled":        { bg: "#9ca3af", ring: "#6b7280" }, // gray
  };
  const [statusFilter, setStatusFilter] = useState(DEFAULT_STATUS_FILTER);
  const [myRequests, setMyRequests] = useState([]);
  const loadMyRequests = useCallback(async () => {
    try {
      // Always fetch the union of statuses so switching the filter is
      // instant. `mine=true` scopes to rows the caller is organizer OR
      // (direct/team) attendee.
      const params = { mine: true, status: ALL_STATUSES.join(",") };
      const res = await api.get("/meeting-room-requests", { params });
      setMyRequests(res.data || []);
    } catch { setMyRequests([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Legacy aliases — downstream code (form callbacks) still calls these.
  // Both now trigger the single unified refresh.
  const loadBookingsForDate = loadMyRequests;
  const loadPendingRequests = loadMyRequests;

  // Derive the legacy `myBookings` shape (Booking rows) from Approved
  // requests' embedded booking snapshot — so the calendar view + floor
  // map keep working without a bigger rewrite.
  const myBookings = useMemo(() => {
    const out = [];
    for (const r of myRequests) {
      if (r.status !== "Approved") continue;
      const b = r.booking || null;
      if (!b) continue;
      out.push({ ...b, _request_id: r.id, _request_seq_no: r.seq_no });
    }
    return out;
  }, [myRequests]);

  // The row list for the Upcoming Bookings panel, filtered by the status
  // dropdown. We use the request row's `start_at` for date grouping so
  // Pending items still land on the right day.
  // NOTE: An empty statusFilter means "All" (no status filter applied).
  const visibleRequests = useMemo(() => {
    if (!statusFilter || statusFilter.length === 0) return myRequests || [];
    const set = new Set(statusFilter);
    return (myRequests || []).filter(r => set.has(r.status));
  }, [myRequests, statusFilter]);

  // Clears BOTH date + status back to their defaults (today + Approved + Pending Approval).
  const handleClearAllFilters = useCallback(() => {
    setStatusFilter(DEFAULT_STATUS_FILTER);
    setRangeMode("today");
    setFilterDate(todayIso());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Dirty" = filters differ from the default state → show Clear All button.
  const filtersDirty = useMemo(() => {
    const isDefaultStatus =
      statusFilter.length === DEFAULT_STATUS_FILTER.length &&
      DEFAULT_STATUS_FILTER.every(s => statusFilter.includes(s));
    return !isDefaultStatus || rangeMode !== "today" || filterDate !== todayIso();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, rangeMode, filterDate]);

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

  // ─── Deep-link handling ────────────────────────────────────────────────
  // Bell-notification action_urls carry `?bookingId=<id>` (Approved) or
  // `?requestId=<id>` (Pending / Declined) so clicking a Meeting-Room
  // notification lands here with the exact row auto-opened in the detail
  // modal. If the id is not in the current user's visible set (permission,
  // cancelled, older than filter window) we show a toast + strip the query.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkBookingId = searchParams.get("bookingId");
  const deepLinkRequestId = searchParams.get("requestId");
  const deepLinkAppliedRef = useRef(null);
  const hasLoadedOnceRef = useRef(false);
  const seenLoadingRef = useRef(false);
  useEffect(() => {
    if (loading) seenLoadingRef.current = true;
    else if (seenLoadingRef.current) hasLoadedOnceRef.current = true;
  }, [loading, myRequests]);
  useEffect(() => {
    const target = deepLinkBookingId || deepLinkRequestId;
    if (!target) return;
    if (loading) return;                              // wait for first load
    if (!hasLoadedOnceRef.current) return;
    if (deepLinkAppliedRef.current === target) return;
    let row = null;
    if (deepLinkBookingId) {
      const found = (myRequests || []).find(
        (r) => r?.booking?.id === deepLinkBookingId,
      );
      if (found?.booking) {
        row = {
          ...found.booking,
          _request_id: found.id,
          _request_seq_no: found.seq_no,
          organizer: found.requested_by,
          _kind: "booking",
          _status: found.booking.cancelled ? "Cancelled" : "Approved",
        };
      }
    } else if (deepLinkRequestId) {
      const found = (myRequests || []).find((r) => r?.id === deepLinkRequestId);
      if (found) {
        row = {
          ...found,
          organizer: found.requested_by,
          _kind: "request",
          _status: found.status || "Pending Approval",
        };
      }
    }
    if (row) {
      setDetailRow(row);
    } else {
      toast.error("This meeting is no longer available or you don't have access to it");
    }
    deepLinkAppliedRef.current = target;
    const sp = new URLSearchParams(searchParams);
    sp.delete("bookingId");
    sp.delete("requestId");
    setSearchParams(sp, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, deepLinkRequestId, loading, myRequests]);

  // Compute room status sets for the floor map:
  //  • occupiedNowRoomIds — rooms currently mid-meeting (any active booking spans `now`)
  //  • slotConflictRoomIds — rooms whose schedule conflicts with the form-selected date+start+end
  //
  // For each set we ALSO expose a Map<room_id, booking> so the floor-map tooltip
  // can render richly (title / organizer / team / time-range), matching the
  // workstation-seat hover UX. If multiple bookings match, the earliest wins.
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

  const occupiedNowBookingByRoomId = useMemo(() => {
    const now = nowTick;
    const map = new Map();
    for (const b of myBookings) {
      if (b.cancelled) continue;
      const s = new Date(b.start_at).getTime();
      const e = new Date(b.end_at).getTime();
      if (s <= now && now < e) {
        const existing = map.get(b.room_id);
        if (!existing || new Date(existing.start_at).getTime() > s) map.set(b.room_id, b);
      }
    }
    return map;
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

  const slotConflictBookingByRoomId = useMemo(() => {
    const map = new Map();
    if (!formOpen) return map;
    const slotStart = combineDateTime(formDate, formStart);
    const slotEnd = combineDateTime(formDate, formEnd);
    if (!slotStart || !slotEnd) return map;
    const sMs = new Date(slotStart).getTime();
    const eMs = new Date(slotEnd).getTime();
    if (!(eMs > sMs)) return map;
    for (const b of slotBookings) {
      if (b.cancelled) continue;
      const bs = new Date(b.start_at).getTime();
      const be = new Date(b.end_at).getTime();
      if (bs < eMs && be > sMs) {
        const existing = map.get(b.room_id);
        if (!existing || new Date(existing.start_at).getTime() > bs) map.set(b.room_id, b);
      }
    }
    return map;
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

  // Open the form in "Reschedule" mode. Accepts a Booking row (with
  // `_request_id`) OR a Request row directly — we resolve the underlying
  // meeting_room_requests.id and always submit via
  // POST /api/meeting-room-requests/{id}/reschedule.
  const handleReschedule = useCallback((row) => {
    const sd = new Date(row.start_at);
    const ed = new Date(row.end_at);
    const p = (n) => String(n).padStart(2, "0");
    setFormDate(`${sd.getFullYear()}-${p(sd.getMonth() + 1)}-${p(sd.getDate())}`);
    setFormStart(`${p(sd.getHours())}:${p(sd.getMinutes())}`);
    setFormEnd(`${p(ed.getHours())}:${p(ed.getMinutes())}`);
    setSelectedRoomId(row.room_id);
    // `_request_id` is stamped on Booking rows derived from Approved
    // requests; Request rows have their own `id`. Either way `requestId` is
    // the meeting_room_requests id we need to reschedule against.
    const requestId = row._request_id || row.id;
    setEditing({
      request_id: requestId,
      title: row.title,
      attendees: row.attendees || [],
      // If the source row is Approved, keep the booking id around so we
      // know to surface the "was approved" copy in the confirm toast.
      was_approved: !!row._request_id,
    });
    setFormOpen(true);
    setConflict(null);
    requestAnimationFrame(() => {
      formAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => titleInputFocusRef.current?.focus?.(), 200);
    });
  }, []);

  // Cancel a meeting. Accepts either an Approved booking row (with a
  // `_request_id`) or a raw meeting_room_requests row. Cancellation always
  // goes through DELETE /api/meeting-room-requests/{id} which cascades to
  // the linked booking (marks it cancelled).
  const handleCancel = async (row) => {
    // Backwards-compat: some callers still pass just an id string.
    if (typeof row === "string") {
      // Locate the request row from the string id (may be booking id or request id).
      const byBooking = myRequests.find(r => r.approved_booking_id === row);
      const byRequest = myRequests.find(r => r.id === row);
      row = byBooking || byRequest || { id: row };
    }
    const requestId = row._request_id || row.id;
    const ok = await confirmDialog({
      title: 'Cancel meeting',
      message: (row.status === 'Approved' || row._request_id)
        ? 'Cancel this meeting? The approved booking will also be marked cancelled.'
        : 'Cancel this meeting request?',
      confirmLabel: 'Cancel meeting',
      confirmVariant: 'destructive',
    });
    if (!ok) return;
    try {
      await api.delete(`/meeting-room-requests/${requestId}`);
      await Promise.all([
        loadMyRequests(),
        api.get(`/room-bookings?date=${formDate}&include_past=true`).then(r => setSlotBookings(r.data || [])).catch(() => {}),
      ]);
      toast.success("Meeting cancelled");
    } catch (e) {
      toast.error(`Cancel failed: ${e?.response?.data?.detail || e.message}`);
    }
  };

  const handleCreate = async (payload) => {
    setConflict(null);
    try {
      // Reschedule path — hit the request-level endpoint which handles
      // both Pending and Approved sources (cancelling the old booking &
      // re-running auto-approval as needed). Recurring is intentionally
      // ignored — reschedule always targets a single occurrence.
      if (editing?.request_id) {
        const body = {
          title: payload.title,
          plan_id: payload.plan_id,
          room_id: payload.room_id,
          start_at: payload.start_at,
          end_at: payload.end_at,
          attendees: payload.attendees,
        };
        const res = await api.post(`/meeting-room-requests/${editing.request_id}/reschedule`, body);
        await Promise.all([
          loadMyRequests(),
          api.get(`/room-bookings?date=${formDate}&include_past=true`).then(r => setSlotBookings(r.data || [])).catch(() => {}),
        ]);
        setFormOpen(false);
        const wasApproved = editing.was_approved;
        setEditing(null);
        // If the reschedule was auto-approved a fresh booking is in the
        // response; otherwise it's pending review by an admin.
        if (res.data?.booking) {
          toast.success("Meeting rescheduled — new booking auto-approved");
        } else if (wasApproved) {
          toast.success("Reschedule request submitted for approval", { description: "Previous booking cancelled. You'll be notified when the new time is approved." });
        } else {
          toast.success("Meeting rescheduled — pending approval");
        }
        return;
      }
      const res = await api.post("/room-bookings", payload);
      await Promise.all([
        loadMyRequests(),
        api.get(`/room-bookings?date=${formDate}&include_past=true`).then(r => setSlotBookings(r.data || [])).catch(() => {}),
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
        {/* LEFT — Floor Map (uniform with Workstation Booking's map-on-left layout) */}
        <div className="flex-1 relative bg-gray-100 border-r border-gray-200">
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
            occupiedNowBookingByRoomId={occupiedNowBookingByRoomId}
            blockedBookingByRoomId={slotConflictBookingByRoomId}
            onQuickBook={handleQuickBook}
          />
        </div>

        {/* RIGHT panel — Upcoming bookings / Booking form.
            Width bumped to 36% (min 460px) so the compact filter row can
            comfortably fit [Status] · [Date] · [Next 7 days] · [Clear All]
            without truncating the native date input. */}
        <div className="w-[36%] min-w-[460px] max-w-[560px] bg-white flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
            <CalendarClock className="text-[#ec9324] flex-shrink-0" sx={{ fontSize: 22 }}/>
            <span className="text-sm font-semibold text-gray-700">Upcoming bookings</span>
          </div>

          {/* Right panel body: a single flex column that fills the remaining height.
              When the booking form is open, it REPLACES the upcoming list (starts from the
              same "Upcoming Bookings" position) so meeting cards never push the form to the
              bottom. After Submit / Cancel the form closes and the upcoming list returns. */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {formOpen ? (
              /* Form view — occupies the full right-panel body.
                 Subtle slide+fade-in from the left when it takes over. */
              <div
                ref={formAnchorRef}
                key="mrb-form-view"
                className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-4 animate-in fade-in slide-in-from-left-3 duration-300 ease-out"
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
              /* Upcoming bookings — fills the entire remaining height of the right panel.
                 Subtle fade-in (+ slide-in-from-right) when it returns after Submit/Cancel. */
              <section
                data-testid="mrb-upcoming-section"
                key="mrb-upcoming-view"
                className="flex-1 min-h-0 flex flex-col px-5 pt-4 pb-2 animate-in fade-in slide-in-from-right-2 duration-300 ease-out"
              >
                {/* Compact filter bar — everything on ONE line.
                    Order: [Status filter] · [Date input] · [Next 7 days pill] · [Clear All]
                    - No duplicate "Upcoming Bookings" heading here (panel header shows it).
                    - Status X clears to "All" (empty array = all statuses).
                    - Date input stays visible even when Next 7 days is active — its value
                      becomes the START of the 7-day window.
                    - "Clear All" resets both filters back to defaults.
                    - Widths are explicit so nothing gets truncated at ≥ 460px panel width.
                    - Sticky-pinned to the TOP of the panel body: as the meeting list below
                      scrolls, this row stays reachable. `bg-white` + border-b + z-10 keep
                      the seam clean over overlapping content. */}
                <div className="sticky top-0 z-10 bg-white flex items-center gap-2 mb-2 pb-2 pt-0.5 flex-shrink-0 flex-nowrap border-b border-gray-100">
                  <div className="w-[180px] shrink-0">
                    <MultiSelectFilter
                      label="Status"
                      value={statusFilter}
                      onChange={(arr) => setStatusFilter(arr)}
                      options={ALL_STATUSES.map(s => ({ value: s, label: s }))}
                      testIdPrefix="mrb-status-filter"
                      align="left"
                      placeholder="All"
                      showCountOnly
                      countUnitLabel="Selected"
                      maxSelectedLabels={1}
                      renderTriggerAccessory={(opts) => (
                        <span
                          className="inline-flex items-center gap-[3px] shrink-0"
                          data-testid="mrb-status-filter-dots"
                          aria-hidden="true"
                        >
                          {opts.map((o) => (
                            <span
                              key={o.value}
                              title={o.label}
                              data-status-dot={o.value}
                              className="inline-block w-2 h-2 rounded-full ring-1"
                              style={{
                                backgroundColor: STATUS_DOT[o.value]?.bg || "#9ca3af",
                                boxShadow: `0 0 0 1px ${STATUS_DOT[o.value]?.ring || "#e5e7eb"} inset`,
                              }}
                            />
                          ))}
                        </span>
                      )}
                    />
                  </div>
                  <input
                    type="date"
                    value={filterDate}
                    onChange={(e) => { setFilterDate(e.target.value); }}
                    className="w-[140px] shrink-0 text-[11px] px-2 py-[5px] border border-gray-200 rounded focus:outline-none focus:border-[#ec9324]"
                    data-testid="mrb-upcoming-date-filter"
                  />
                  <button
                    type="button"
                    onClick={() => setRangeMode(rangeMode === "next7" ? "today" : "next7")}
                    data-testid="mrb-range-7"
                    aria-pressed={rangeMode === "next7"}
                    title="Show 7 days starting from the selected date"
                    className={`px-2.5 py-1 text-[10px] font-bold rounded border transition-colors whitespace-nowrap shrink-0 ${
                      rangeMode === "next7"
                        ? "bg-[#ec9324] text-white border-[#ec9324] shadow-sm"
                        : "bg-white text-gray-600 border-gray-200 hover:border-[#ec9324] hover:text-[#ec9324]"
                    }`}
                  >Next 7 days</button>
                  {filtersDirty && (
                    <button
                      type="button"
                      onClick={handleClearAllFilters}
                      data-testid="mrb-filter-clear-all"
                      title="Clear all filters"
                      className="ml-auto px-2 py-1 text-[10px] font-semibold text-gray-500 hover:text-[#ec9324] hover:bg-orange-50 rounded whitespace-nowrap shrink-0"
                    >Clear All</button>
                  )}
                </div>
                <UpcomingBookingsList
                  bookings={(statusFilter.length === 0 || statusFilter.includes("Approved")) ? myBookings : []}
                  pendingRequests={visibleRequests.filter(r => r.status !== "Approved")}
                  filterDate={filterDate}
                  rangeMode={rangeMode}
                  statusFilter={statusFilter}
                  loading={loading}
                  onCancel={handleCancel}
                  onReschedule={handleReschedule}
                  onCancelRequest={async (id) => {
                    try {
                      await api.delete(`/meeting-room-requests/${id}`);
                      toast.success("Request cancelled");
                      await loadMyRequests();
                    } catch (e) {
                      toast.error(formatApiError(e?.response?.data?.detail) || "Could not cancel request");
                    }
                  }}
                  onOpenDetail={(row) => setDetailRow(row)}
                />
              </section>
            )}
          </div>
        </div>
      </div>
      )}
      {detailRow && (
        <MeetingDetailModal
          row={detailRow}
          onClose={() => setDetailRow(null)}
          onEdit={(r) => { setDetailRow(null); handleReschedule(r); }}
          onDelete={async (r) => {
            const isRequest = r._kind === "request";
            if (isRequest) {
              try {
                await api.delete(`/meeting-room-requests/${r.id}`);
                toast.success("Request cancelled");
                await loadMyRequests();
              } catch (e) {
                toast.error(formatApiError(e?.response?.data?.detail) || "Could not cancel request");
              }
            } else {
              await handleCancel(r);
            }
            setDetailRow(null);
          }}
          canEdit={
            (detailRow._kind === "request" && detailRow._status === "Pending Approval") ||
            (detailRow._kind === "booking" && detailRow._status === "Approved")
          }
          canDelete={
            (detailRow._kind === "request" && detailRow._status === "Pending Approval") ||
            (detailRow._kind === "booking" && detailRow._status === "Approved")
          }
        />
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
function UpcomingBookingsList({ bookings, pendingRequests = [], filterDate, rangeMode, loading, onCancel, onReschedule, onCancelRequest, onOpenDetail, statusFilter = [] }) {
  const today = todayIso();
  const addDaysIso = (offset) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const isFilterToday = filterDate === today;
  // If the user has explicitly selected an "inactive" status (Declined /
  // Cancelled), the date-window filter would otherwise hide those rows
  // whenever their scheduled date falls outside today/tomorrow/next7 — which
  // is almost always the case for older declined meetings. Detect this and
  // switch to an "all matching, any date" layout so the user actually sees
  // what they filtered for.
  const showAllDates =
    Array.isArray(statusFilter) &&
    statusFilter.length > 0 &&
    (statusFilter.includes("Declined") || statusFilter.includes("Cancelled"));

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
  if (showAllDates) {
    // ALL matching regardless of date. Sort groups chronologically ascending
    // (past → future) so recent declined items sit at the top of a scroll.
    const keys = Object.keys(groups).sort();
    dayGroups = keys.map((key) => ({
      key,
      label: formatDayLabel(key),
      items: groups[key] || [],
    }));
    // Provide a friendlier empty-state day when the filter yields nothing.
    if (dayGroups.length === 0) {
      dayGroups = [{ key: today, label: "Today", items: [] }];
    }
  } else if (rangeMode === "next7") {
    // Anchor the 7-day window on the picked date (not today) so the date
    // input keeps meaning when "Next 7 days" is toggled on.
    const anchor = new Date(filterDate);
    const anchorIso = (offset) => {
      const d = new Date(anchor); d.setDate(d.getDate() + offset);
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    dayGroups = Array.from({ length: 7 }, (_, i) => {
      const key = anchorIso(i);
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
          {dayGroups.map(g => <DayGroup key={g.key} group={g} onCancel={onCancel} onReschedule={onReschedule} onCancelRequest={onCancelRequest} onOpenDetail={onOpenDetail}/>)}
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

function DayGroup({ group, onCancel, onReschedule, onCancelRequest, onOpenDetail }) {
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
        // Rescheduling is allowed while a request is Pending Approval OR
        // an approved booking is still active. In both cases the reschedule
        // submits a fresh Pending Approval request to the approver queue.
        const canReschedule = (isRequest && status === "Pending Approval") || (!isRequest && status === "Approved");
        // Cancel: pending requests → withdraw the request; approved bookings
        // → cascade cancel (booking + request → Cancelled).
        const canCancel = (isRequest && status === "Pending Approval") || (!isRequest && status === "Approved");
        // Booking ID line — only meaningful for Approved bookings. Uses the
        // room_bookings.seq_no when available (from the enriched request row).
        const bookingSeq = !isRequest ? b.seq_no : null;
        return (
        <div
          key={b.id}
          data-testid={`mrb-upcoming-${b.id}`}
          data-kind={b._kind}
          data-status={status}
          role="button"
          tabIndex={0}
          onClick={(e) => {
            // Ignore clicks that originated from an action button inside the card.
            if (e.target.closest("button")) return;
            onOpenDetail?.(b);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenDetail?.(b); }
          }}
          className={`bg-white rounded-md border px-2.5 py-1.5 mb-1 transition-colors cursor-pointer ${
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
              {bookingSeq != null && (
                <div className="text-[10px] text-gray-500" data-testid={`mrb-booking-id-${b.id}`}>
                  Booking ID: <span className="font-mono font-semibold text-gray-700">{bookingSeq}</span>
                </div>
              )}
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
                    onClick={() => isRequest ? onCancelRequest?.(b.id) : onCancel?.(b)}
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
export function FloorMapMeetingRooms({ focusPlan, rooms, selectedRoomId, onPickRoom, occupiedNowRoomIds, blockedRoomIds, occupiedNowBookingByRoomId, blockedBookingByRoomId, onQuickBook }) {
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
                        hoverBooking={blocked ? blockedBookingByRoomId?.get?.(r.room_id)
                          : (occupiedNow ? occupiedNowBookingByRoomId?.get?.(r.room_id) : null)}
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
export function RoomBoxLabel({ room, scale, labelBg, occupiedNow, blocked, hoverBooking = null }) {
  const wrapperRef = useRef(null);
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });
  // Rich tooltip is rendered via a portal so it (a) escapes the transformed
  // floor-map container (no z-index battles, no scale distortion) and (b)
  // stays a fixed on-screen size at any zoom level.
  const [hovered, setHovered] = useState(false);
  const [tipPos, setTipPos] = useState(null);

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

  // Hover tracking — attach mouseenter/leave to the parent .group room box
  // (RoomBoxLabel's wrapper is pointer-events:none so it can't detect its
  // own hover). Portal the tooltip to document.body so it renders at a
  // constant on-screen size regardless of the zoom scale, matching the
  // WorkstationSeat hover UX.
  const updateTipPos = useCallback(() => {
    const parent = wrapperRef.current?.parentElement;
    if (!parent) return;
    const r = parent.getBoundingClientRect();
    setTipPos({
      left: r.left + r.width / 2,
      top: r.bottom + 8,
    });
  }, []);

  useEffect(() => {
    const parent = wrapperRef.current?.parentElement;
    if (!parent) return;
    const onEnter = () => { setHovered(true); };
    const onLeave = () => { setHovered(false); };
    parent.addEventListener('mouseenter', onEnter);
    parent.addEventListener('mouseleave', onLeave);
    return () => {
      parent.removeEventListener('mouseenter', onEnter);
      parent.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  useLayoutEffect(() => {
    if (!hovered) return;
    updateTipPos();
    const onScrollOrResize = () => updateTipPos();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    // The zoom-pan-pinch container animates transforms — re-measure across
    // a few frames so the tooltip stays glued to the room while a zoom or
    // pan is in progress.
    let raf = 0, ticks = 0;
    const loop = () => {
      updateTipPos();
      ticks += 1;
      if (ticks < 8) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      cancelAnimationFrame(raf);
    };
  }, [hovered, updateTipPos]);

  useEffect(() => () => setHovered(false), []);

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
          {/* Name pill. Padding is proportional to the current font-size so
              the pill breathes correctly at every zoom level — otherwise
              at max zoom the sub-pixel padding + tight line-height clipped
              the tops of tall letters ("T", "h", "l", …). Also drops
              `overflow: hidden` because the text is already JS-truncated
              via `displayName`, so there's nothing left to clip. */}
          <div
            className="font-semibold text-white shadow-sm"
            style={{
              background: labelBg,
              fontSize: `${fMap}px`,
              lineHeight: 1.3,
              padding: `${fMap * 0.2}px ${fMap * 0.6}px`,
              borderRadius: `${4 / scale}px`,
              maxWidth: '100%',
              whiteSpace: 'nowrap',
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
          {/* Seats pill — same proportional padding + relaxed line-height
              so it never clips either, regardless of zoom level. */}
          <div
            className="font-medium text-white"
            style={{
              background: 'rgba(17, 24, 39, 0.75)',
              fontSize: `${fMapSmall}px`,
              lineHeight: 1.3,
              padding: `${fMapSmall * 0.2}px ${fMapSmall * 0.6}px`,
              borderRadius: `${4 / scale}px`,
              whiteSpace: 'nowrap',
            }}
          >
            Seats : {room.capacity}
          </div>
        </div>
      )}

      {/* Rich hover tooltip — portaled to document.body so it stays a
          constant on-screen size at any zoom level, mirrors the workstation
          seat hover UX (Person + Team + Date lines), and never fights the
          floor-map z-index stack. When we have a known booking that blocks
          the room (or occupies it right now), show Title + Organizer +
          Team + Date · Time-range. Otherwise fall back to the minimal room
          summary. */}
      {hovered && tipPos && createPortal(
        <RoomHoverTooltip
          room={room}
          booking={hoverBooking}
          occupiedNow={occupiedNow}
          blocked={blocked}
          left={tipPos.left}
          top={tipPos.top}
        />,
        document.body
      )}
    </div>
  );
}

// ---------------------------------------------------------------- hover card
// Extracted so it can be re-used by callers who reference RoomBoxLabel
// through the shared FloorMap wrapper (Pending Approvals + Workstation
// Booking page). The visual design mirrors WorkstationSeat's tooltip so
// the two floor maps feel consistent.
function RoomHoverTooltip({ room, booking, occupiedNow, blocked, left, top }) {
  const state = blocked ? "Booked" : (occupiedNow ? "In use" : "Available");
  const stateClass = blocked
    ? "bg-red-400/20 text-red-300 ring-red-300/30"
    : occupiedNow
      ? "bg-amber-400/20 text-amber-300 ring-amber-300/30"
      : "bg-emerald-400/20 text-emerald-300 ring-emerald-300/30";
  const organizerName = booking?.organizer?.name || null;
  const teamName = booking?.organizer_team_name || null;
  const dateStr = booking?.start_at ? new Date(booking.start_at) : null;
  const dateLabel = dateStr && !Number.isNaN(dateStr.getTime())
    ? dateStr.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
    : null;
  const timeLabel = booking?.start_at && booking?.end_at
    ? `${fmtTime(booking.start_at)} – ${fmtTime(booking.end_at)}`
    : null;
  return (
    <div
      role="tooltip"
      data-testid={`mrb-room-hover-${room.room_id}`}
      style={{
        position: 'fixed',
        left,
        top,
        transform: 'translateX(-50%)',
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <div
        className="relative bg-slate-900/95 backdrop-blur-sm text-white text-[12px] rounded-lg shadow-xl ring-1 ring-white/10 min-w-[200px] max-w-[280px]"
        style={{ fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}
      >
        {/* Header — room name + capacity + state badge */}
        <div className="px-3 pt-2 pb-1.5 border-b border-white/10 flex items-center justify-between gap-2">
          <span className="font-semibold text-[13px] tracking-tight truncate">
            {room.name}
            <span className="ml-1.5 text-white/60 text-[11px] font-normal">· Seats {room.capacity}</span>
          </span>
          <span className={`text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ring-1 whitespace-nowrap ${stateClass}`}>
            {state}
          </span>
        </div>

        {/* Body */}
        <div className="px-3 py-2 space-y-1.5">
          {booking ? (
            <>
              {booking.title && (
                <div className="flex items-center gap-2">
                  <CalendarClock sx={{ fontSize: 13 }} className="text-sky-300 shrink-0"/>
                  <span className="truncate font-medium">{booking.title}</span>
                </div>
              )}
              {organizerName && (
                <div className="flex items-center gap-2">
                  <Users sx={{ fontSize: 13 }} className="text-sky-300 shrink-0"/>
                  <span className="truncate">{organizerName}</span>
                </div>
              )}
              {teamName && (
                <div className="flex items-center gap-2">
                  <Building2 sx={{ fontSize: 13 }} className="text-sky-300 shrink-0"/>
                  <span className="truncate">{teamName}</span>
                </div>
              )}
              {(dateLabel || timeLabel) && (
                <div className="flex items-center gap-2">
                  <CalendarIcon sx={{ fontSize: 13 }} className="text-sky-300 shrink-0"/>
                  <span className="opacity-90 truncate">
                    {dateLabel}{dateLabel && timeLabel ? ' · ' : ''}{timeLabel}
                  </span>
                </div>
              )}
              <div className="text-[10.5px] text-white/60 pt-1 border-t border-white/10 mt-1.5">
                Click for details
              </div>
            </>
          ) : (
            <div className="opacity-80 text-[11.5px]">
              {blocked ? 'Booked at selected time' : (occupiedNow ? 'Meeting in progress' : 'Available')}
            </div>
          )}
        </div>

        {/* Arrow */}
        <div className="absolute left-1/2 -translate-x-1/2 -top-1 w-2 h-2 bg-slate-900/95 rotate-45 ring-1 ring-white/10"/>
      </div>
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

// ============================================================ Meeting Detail Modal
// Opened when a user clicks a card in the Upcoming Bookings list. Displays
// every detail we have for the meeting and surfaces Edit + Delete actions.
function MeetingDetailModal({ row, onClose, onEdit, onDelete, canEdit, canDelete }) {
  if (!row) return null;
  const isRequest = row._kind === "request";
  const status = row._status || (isRequest ? row.status : "Approved");
  const organizer = row.organizer || row.requested_by || {};
  const attendees = row.attendees || [];
  const userAttendees = attendees.filter(a => a.type === "user");
  const teamAttendees = attendees.filter(a => a.type === "team");
  const start = row.start_at ? new Date(row.start_at) : null;
  const end = row.end_at ? new Date(row.end_at) : null;
  const bookingSeq = !isRequest ? row.seq_no : null;
  const requestSeq = isRequest ? row.seq_no : row._request_seq_no;
  const decidedBy = row.decided_by || null;
  const decisionNote = row.decision_note;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="mrb-detail-modal"
    >
      <div className="w-full max-w-[540px] max-h-[90vh] flex flex-col bg-white rounded-lg shadow-2xl border border-gray-200 animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <CalendarClock sx={{ fontSize: 18 }} className="text-[#ec9324] shrink-0"/>
              <h2 className="text-base font-bold text-gray-900 truncate" data-testid="mrb-detail-title">
                {row.title}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill status={status} dataTestId="mrb-detail-status"/>
              {bookingSeq != null && (
                <span className="text-[11px] text-gray-500">
                  Booking&nbsp;ID: <span className="font-mono font-semibold text-gray-700">#{bookingSeq}</span>
                </span>
              )}
              {requestSeq != null && (
                <span className="text-[11px] text-gray-500">
                  Request&nbsp;#<span className="font-mono font-semibold text-gray-700">{requestSeq}</span>
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded text-gray-400 hover:text-gray-800 hover:bg-gray-100"
            data-testid="mrb-detail-close"
          ><X sx={{ fontSize: 16 }}/></button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex-1">
          <dl className="grid grid-cols-1 gap-3 text-[12px] text-gray-800">
            <DetailRow icon={<Clock sx={{ fontSize: 14 }} className="text-[#ec9324]"/>} label="When">
              {start ? (
                <>
                  <span className="font-semibold">{start.toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "short", year: "numeric" })}</span>
                  <span className="text-gray-400 mx-1">·</span>
                  {fmtTime(row.start_at)} – {fmtTime(row.end_at)}
                </>
              ) : "—"}
            </DetailRow>

            <DetailRow icon={<MapPin sx={{ fontSize: 14 }} className="text-[#ec9324]"/>} label="Room">
              <span className="font-semibold">{row.room_name || "—"}</span>
              {row.room_capacity != null && (
                <span className="text-gray-500"> · Capacity {row.room_capacity} Seats</span>
              )}
              {row.plan_name && (
                <div className="text-[11px] text-gray-500">{row.plan_name}</div>
              )}
            </DetailRow>

            <DetailRow icon={<Users sx={{ fontSize: 14 }} className="text-[#ec9324]"/>} label="Organizer">
              <div className="font-semibold text-gray-900">{organizer.name || organizer.email || "—"}</div>
              {organizer.email && <div className="text-[11px] text-gray-500">{organizer.email}</div>}
              {row.organizer_team_name && (
                <div className="text-[11px] text-[#ec9324] font-semibold">{row.organizer_team_name}</div>
              )}
            </DetailRow>

            <DetailRow icon={<UserPlus sx={{ fontSize: 14 }} className="text-[#ec9324]"/>} label={`Attendees${attendees.length ? ` (${attendees.length})` : ""}`}>
              {attendees.length === 0 ? (
                <span className="text-gray-400 italic text-[11px]">No attendees added.</span>
              ) : (
                <div className="flex flex-col gap-2">
                  {userAttendees.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold tracking-wide text-gray-500 uppercase mb-1">People ({userAttendees.length})</div>
                      <div className="flex flex-wrap gap-1.5" data-testid="mrb-detail-user-attendees">
                        {userAttendees.map(a => (
                          <span key={`u-${a.id}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-blue-50 text-blue-700 border-blue-200">
                            {a.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {teamAttendees.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold tracking-wide text-gray-500 uppercase mb-1">Teams ({teamAttendees.length})</div>
                      <div className="flex flex-wrap gap-1.5" data-testid="mrb-detail-team-attendees">
                        {teamAttendees.map(a => (
                          <span key={`t-${a.id}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-purple-50 text-purple-700 border-purple-200">
                            <Users sx={{ fontSize: 10 }}/> {a.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </DetailRow>

            {row.recurring && (
              <DetailRow icon={<Repeat sx={{ fontSize: 14 }} className="text-[#ec9324]"/>} label="Recurring">
                <span className="capitalize">{row.recurring.frequency}</span>
                {row.recurring.end_date && <> · until <span className="font-semibold">{row.recurring.end_date}</span></>}
                {Array.isArray(row.recurring.days) && row.recurring.days.length > 0 && (
                  <> · Days: {row.recurring.days.join(", ")}</>
                )}
              </DetailRow>
            )}

            {(row.requested_on || row.created_at) && (
              <DetailRow icon={<CalendarIcon sx={{ fontSize: 14 }} className="text-[#ec9324]"/>} label="Requested">
                {fmtDateTime(row.requested_on || row.created_at)}
              </DetailRow>
            )}

            {decidedBy && (
              <DetailRow icon={<AlertCircle sx={{ fontSize: 14 }} className="text-[#ec9324]"/>} label={status === "Declined" ? "Declined by" : "Approved by"}>
                <div className="font-semibold">{decidedBy.name || decidedBy.email || "—"}</div>
                {row.decided_on && <div className="text-[11px] text-gray-500">{fmtDateTime(row.decided_on)}</div>}
                {decidedBy.auto_approved && <div className="text-[11px] text-emerald-700 font-semibold">Auto-approved</div>}
                {decisionNote && <div className="text-[11px] text-gray-600 mt-1 italic">&ldquo;{decisionNote}&rdquo;</div>}
              </DetailRow>
            )}
          </dl>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50 rounded-b-lg">
          <Button variant="outline" onClick={onClose} data-testid="mrb-detail-close-btn">Close</Button>
          {canDelete && (
            <Button
              onClick={() => onDelete?.(row)}
              className="bg-red-600 hover:bg-red-700 text-white"
              data-testid="mrb-detail-delete"
            >
              <Trash2 sx={{ fontSize: 14 }} className="mr-1.5"/>
              Delete
            </Button>
          )}
          {canEdit && (
            <Button
              onClick={() => onEdit?.(row)}
              className="bg-[#ec9324] hover:bg-[#d4811f] text-white"
              data-testid="mrb-detail-edit"
            >
              <Pencil sx={{ fontSize: 14 }} className="mr-1.5"/>
              Edit
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon, label, children }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-6 pt-0.5 flex-shrink-0 flex items-center justify-center">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold tracking-wide text-gray-500 uppercase mb-0.5">{label}</div>
        <div className="text-[12px] text-gray-800">{children}</div>
      </div>
    </div>
  );
}

