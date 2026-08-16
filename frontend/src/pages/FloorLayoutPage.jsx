import React, { useEffect, useMemo, useState, useCallback } from "react";
import ArrowLeft from "@mui/icons-material/ArrowBack";
import LayoutGrid from "@mui/icons-material/GridViewOutlined";
import MapPin from "@mui/icons-material/PlaceOutlined";
import Clock from "@mui/icons-material/AccessTime";
import Loader2 from "@mui/icons-material/Autorenew";
import FileText from "@mui/icons-material/DescriptionOutlined";
import CalendarIcon from "@mui/icons-material/CalendarTodayOutlined";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import Users from "@mui/icons-material/PeopleOutlined";
import Building2 from "@mui/icons-material/ApartmentOutlined";
import Check from "@mui/icons-material/Check";
import X from "@mui/icons-material/Close";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import Layout from "../components/Layout";
import { useEffectivePage } from "../context/EffectivePermissionsContext";
import WorkstationFloorMap from "../components/WorkstationFloorMap";
import FloorSeatDetailDialog from "../components/FloorSeatDetailDialog";
import RoomBookingDetailDialog from "../components/RoomBookingDetailDialog";
import { paletteForTeam, teamBackground } from "../lib/teamColors";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import PersonIcon from "../components/icons/PersonIcon";
import WorkspacesIcon from "../components/icons/WorkspacesIcon";
import CalendarMonthIcon from "../components/icons/CalendarMonthIcon";

// Local wrapper used by the team-filter chips/menu; guards against palette
// lookups that might return a single stop for legacy hex team colors.
const paletteForTeamStops = (color) => {
  const stops = paletteForTeam(color);
  if (Array.isArray(stops) && stops.length >= 2) return stops;
  const only = Array.isArray(stops) ? stops[0] : color;
  return [only || "#ec9324", only || "#d4811f"];
};

const todayIso = () => {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
};

function fmt(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }); }
  catch { return iso; }
}

function fmtDateLabel(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  } catch { return iso; }
}

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
  } catch { return iso; }
}

// ---------- Card grid (entry view) ----------
function FloorPlanCard({ plan, onOpen }) {
  return (
    <button
      onClick={() => onOpen(plan)}
      data-testid={`floor-layout-card-${plan.id}`}
      className="text-left bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all group"
    >
      <div className="relative h-40 bg-gradient-to-br from-gray-50 to-gray-100 border-b border-gray-100 flex items-center justify-center overflow-hidden">
        {plan.thumbnail ? (
          <img src={plan.thumbnail} alt={`${plan.name} preview`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"/>
        ) : (
          <div className="flex flex-col items-center text-gray-400">
            <FileText sx={{ fontSize: 32 }}/>
            <span className="text-[11px] mt-1">No preview yet</span>
          </div>
        )}
        {plan.has_draft && (
          <span className="absolute top-2 left-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-semibold rounded-full border border-blue-200">
            Draft pending
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-bold text-gray-900 truncate text-base group-hover:text-[#ec9324] transition-colors">{plan.name}</h3>
        <div className="mt-1.5 text-xs text-gray-500 flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1"><MapPin sx={{ fontSize: 11 }}/> {plan.live_seat_count} live seats</span>
          <span className="inline-flex items-center gap-1"><Clock sx={{ fontSize: 11 }}/> {fmt(plan.last_published_at || plan.updated_at)}</span>
        </div>
      </div>
    </button>
  );
}

// ---------- Date stepper ----------
// Compact date navigator used INSIDE the right panel (previously sat in the
// topbar which caused layout crowding + click-interception on the Next arrow
// depending on the viewport width). Rendered in an open panel container so
// nothing can overlap it.
//
// Implementation note (bug fix Jul 2026, round 4 — after troubleshoot_agent):
// Chrome's Transient-User-Activation model requires the click that triggers
// `input.showPicker()` to land DIRECTLY on the <input type=date> element
// itself. Every earlier attempt (sr-only off-screen input, hidden input +
// button.showPicker(), overlay input + button underneath) failed because the
// user gesture was consumed by the button on top / the input was invisible
// to the layout engine. Fixed version: the visual display is a plain <div>
// (with `pointer-events:none`), and the ONLY interactive layer is the
// transparent native <input type=date> laid on top with `z-10 opacity-0
// cursor-pointer`.  The browser opens its own date picker for the direct
// click, no `showPicker()` call needed.
function DateStepper({ value, onChange }) {
  const shift = (days) => {
    if (!value) return;
    const d = new Date(value + "T00:00:00");
    if (Number.isNaN(d.getTime())) return;
    d.setDate(d.getDate() + days);
    const out = d.toISOString().slice(0, 10);
    onChange(out);
  };
  const displayLabel = React.useMemo(() => {
    if (!value) return "Select date";
    const d = new Date(value + "T00:00:00");
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  }, [value]);
  // Show the "Today" shortcut only when the current selection isn't already today.
  const isToday = value === todayIso();

  return (
    <div className="w-full" data-testid="floor-layout-date-stepper">
      <div className="flex items-stretch gap-1.5">
        <button
          type="button"
          onClick={() => shift(-1)}
          className="flex items-center justify-center w-8 rounded-md border border-gray-300 hover:bg-gray-50 hover:border-[#ec9324] bg-white flex-shrink-0 transition-colors"
          data-testid="floor-layout-prev-date"
          aria-label="Previous Date"
          title="Previous Date"
        >
          <ChevronLeft sx={{ fontSize: 16 }}/>
        </button>

        {/* Date pill.
            The visible display is a NON-INTERACTIVE div (`pointer-events:none`).
            The only element that receives clicks is the native <input type=date>
            overlaid on top (`z-10`, transparent, full-size, cursor:pointer).
            This is the industry-standard pattern for custom-styled native
            date pickers because Chrome requires a DIRECT user gesture on the
            input itself in order to open its picker.  Any wrapping button
            that captured the click first would trip Chrome's
            Transient-User-Activation guard and silently block the picker. */}
        <div
          className="relative flex-1 min-w-0"
          data-testid="floor-layout-date-picker-btn"
          role="group"
          aria-label="Change date"
          title="Pick a date"
        >
          <div className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-[13px] font-medium border border-gray-300 rounded-md bg-white min-w-0 pointer-events-none">
            <CalendarIcon sx={{ fontSize: 14 }} className="text-[#ec9324] flex-shrink-0"/>
            <span className="tabular-nums truncate">{displayLabel}</span>
          </div>
          <input
            type="date"
            value={value}
            onChange={(e) => e.target.value && onChange(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            data-testid="floor-layout-date-input"
            aria-label="Date picker"
          />
        </div>

        <button
          type="button"
          onClick={() => shift(1)}
          className="flex items-center justify-center w-8 rounded-md border border-gray-300 hover:bg-gray-50 hover:border-[#ec9324] bg-white flex-shrink-0 transition-colors"
          data-testid="floor-layout-next-date"
          aria-label="Next Date"
          title="Next Date"
        >
          <ChevronRight sx={{ fontSize: 16 }}/>
        </button>
      </div>
      {!isToday && (
        <button
          type="button"
          onClick={() => onChange(todayIso())}
          className="mt-1.5 w-full text-[11px] font-semibold text-[#ec9324] hover:underline"
          data-testid="floor-layout-today-btn"
        >
          Jump to Today
        </button>
      )}
    </div>
  );
}

// ---------- Interactive combined view (per plan) ----------
function PlanInteractiveView({ plan, onBack, hideBack = false, embedded = false }) {
  const navigate = useNavigate();
  // v3 permission gating for the Floor Layout filters (desk_booking.floor_layout).
  const { fn: flPermFn } = useEffectivePage("desk_booking", "floor_layout");
  const permTeamFilter = flPermFn("filter_team");
  const [date, setDate] = useState(todayIso());
  const [availability, setAvailability] = useState(null);
  const [roomBookings, setRoomBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  // Detail modal state — populated when the user clicks a booked (or pending)
  // workstation on the floor map. `kind` distinguishes an active booking from
  // a pending workstation request so the modal can label & link accordingly.
  const [detail, setDetail] = useState(null); // { kind:'booking'|'request', seat, data }
  // Meeting-room booking detail modal state — opened from the room click on
  // the floor map. `data` holds the bookings array we already have in
  // `roomBookingsByRoom` so the modal renders instantly with no extra fetch.
  const [roomDetail, setRoomDetail] = useState(null); // { room, bookings }
  const openRoomDetail = useCallback((room, bookings) => {
    setRoomDetail({ room, bookings: bookings || [] });
  }, []);
  const closeRoomDetail = useCallback(() => setRoomDetail(null), []);

  const openBookingDetail = useCallback((seat, booking) => {
    if (!booking) return;
    setDetail({ kind: "booking", seat, data: booking });
  }, []);
  const openRequestDetail = useCallback((seat, request) => {
    if (!request) return;
    setDetail({ kind: "request", seat, data: request });
  }, []);
  const closeDetail = useCallback(() => setDetail(null), []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Combined: workstation seats + bookings + pending requests + meeting rooms + room bookings
      const [availRes, roomRes, planRes] = await Promise.all([
        api.get("/workstation-requests/availability", { params: { plan_id: plan.id, date } }),
        api.get("/room-bookings", { params: { plan_id: plan.id, date, include_past: true } }),
        api.get(`/floor-plans/${plan.id}`),
      ]);
      // Combine seats/avail with rooms from plan detail
      setAvailability({
        ...availRes.data,
        rooms: planRes.data.live_rooms || [],
      });
      setRoomBookings(roomRes.data || []);
    } catch (e) {
      console.error("Floor layout load failed", e);
    } finally {
      setLoading(false);
    }
  }, [plan.id, date]);

  useEffect(() => { loadData(); }, [loadData]);

  const bookingsBySeat = useMemo(() => {
    const m = {};
    for (const b of (availability?.bookings || [])) m[b.seat_id] = b;
    return m;
  }, [availability]);

  const requestsBySeat = useMemo(() => {
    const m = {};
    for (const r of (availability?.pending_requests || [])) m[r.seat_id] = r;
    return m;
  }, [availability]);

  // Group room bookings by room_id
  const roomBookingsByRoom = useMemo(() => {
    const m = {};
    for (const rb of roomBookings) {
      if (!m[rb.room_id]) m[rb.room_id] = [];
      m[rb.room_id].push(rb);
    }
    // Sort each room's bookings chronologically
    Object.values(m).forEach(arr => arr.sort((a, b) => (a.start_at || "").localeCompare(b.start_at || "")));
    return m;
  }, [roomBookings]);

  // Build the team list from the day's bookings (each team appears once) —
  // used to pull the per-team COLOUR that shows up on the map for that date.
  const teamsInBookings = useMemo(() => {
    const map = new Map();
    for (const b of (availability?.bookings || [])) {
      if (!b.team_id) continue;
      if (!map.has(b.team_id)) {
        map.set(b.team_id, {
          id: b.team_id,
          name: b.team_name || "Team",
          color: b.team_color,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [availability]);

  // ALL teams (loaded once) — the Team filter should list every team by
  // default, not only the teams that happen to have a booking on the selected
  // date. Colours are taken from the day's bookings when available, else the
  // team's own configured colour.
  const [allTeams, setAllTeams] = useState([]);
  useEffect(() => {
    let cancelled = false;
    api.get("/teams").then((res) => {
      if (cancelled) return;
      const arr = Array.isArray(res.data) ? res.data : (res.data?.items || res.data?.teams || []);
      setAllTeams(arr.map((t) => ({ id: t.id, name: t.name, color: t.color })));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Merge: prefer the booking-derived colour (matches the map) but list every team.
  const teamOptions = useMemo(() => {
    const colorById = new Map(teamsInBookings.map((t) => [t.id, t.color]));
    const source = allTeams.length ? allTeams : teamsInBookings;
    return source
      .map((t) => ({ id: t.id, name: t.name, color: colorById.get(t.id) || t.color }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [allTeams, teamsInBookings]);

  // Multi-select team filter state — controls both the dim-map effect and the
  // Meeting Bookings list filter.
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  // Reset the filter only when the PLAN changes — NOT on date change, so a
  // user's selected team(s) stay put as they step through dates.
  useEffect(() => { setSelectedTeamIds([]); }, [plan.id]);

  // Which seats to zoom to (only when exactly one team is selected).
  const zoomTargetSeatIds = useMemo(() => {
    if (selectedTeamIds.length !== 1) return null;
    const tid = selectedTeamIds[0];
    return (availability?.bookings || [])
      .filter((b) => b.team_id === tid)
      .map((b) => b.seat_id);
  }, [selectedTeamIds, availability]);

  // Which seats to keep un-dimmed when any teams are selected. When no team is
  // selected we keep the full map at full opacity.
  const highlightedSeatIds = useMemo(() => {
    if (selectedTeamIds.length === 0) return null;
    const set = new Set(selectedTeamIds);
    return new Set(
      (availability?.bookings || [])
        .filter((b) => set.has(b.team_id))
        .map((b) => b.seat_id),
    );
  }, [selectedTeamIds, availability]);

  const stats = useMemo(() => {
    const total = (availability?.seats || []).length;
    const booked = (availability?.bookings || []).length;
    const pending = (availability?.pending_requests || []).length;
    const meetings = roomBookings.length;
    const available = Math.max(0, total - booked - pending);
    return { total, booked, pending, meetings, available };
  }, [availability, roomBookings]);

  // Meetings list respects the team filter AND drops any meeting whose end
  // time is already in the past (Upcoming Meetings only). Ticks the "now"
  // reference every minute so items disappear naturally as they end.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Map<room_id, activeBooking> for rooms currently mid-meeting. Drives the
  // meeting-room colour on the floor: RED when a booking's [start_at, end_at]
  // window spans "now", GREEN otherwise. Recomputes every minute via nowTick
  // so rooms auto-flip back to green when a meeting ends.
  const roomOccupiedNowByRoom = useMemo(() => {
    const now = nowTick;
    const map = {};
    for (const rb of (roomBookings || [])) {
      if (rb.cancelled) continue;
      if (!rb.start_at || !rb.end_at) continue;
      const s = new Date(rb.start_at).getTime();
      const e = new Date(rb.end_at).getTime();
      if (isNaN(s) || isNaN(e)) continue;
      if (s <= now && now < e) {
        const existing = map[rb.room_id];
        // Prefer the earliest-starting active booking (deterministic display).
        if (!existing || new Date(existing.start_at).getTime() > s) {
          map[rb.room_id] = rb;
        }
      }
    }
    return map;
  }, [roomBookings, nowTick]);

  const filteredMeetings = useMemo(() => {
    const now = new Date(nowTick);
    const upcoming = (roomBookings || []).filter((rb) => {
      const end = rb.end_at ? new Date(rb.end_at) : null;
      // Keep the meeting while it is still running (end > now).
      return !end || end.getTime() > now.getTime();
    });
    if (selectedTeamIds.length === 0) return upcoming;
    const set = new Set(selectedTeamIds);
    return upcoming.filter((rb) => {
      if (rb.organizer_team_id && set.has(rb.organizer_team_id)) return true;
      if (Array.isArray(rb.attendees)) {
        return rb.attendees.some((a) => a?.type === "team" && set.has(a.id));
      }
      return false;
    });
  }, [roomBookings, selectedTeamIds, nowTick]);

  // Right-side "Upcoming Meetings" panel — user-collapsible.
  const [meetingsCollapsed, setMeetingsCollapsed] = useState(false);

  // Inner content (map + right side panel + detail modal) — reused whether
  // embedded inside another shell or rendered as a full page inside Layout.
  const innerContent = (
    <>
      <div className="flex-1 relative flex overflow-hidden">
        {/* CENTER — full-width floor map. */}
        <div className="flex-1 relative min-w-0">
          {loading || !availability ? (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500">
              <Loader2 className="animate-spin mr-2" sx={{ fontSize: 20 }}/> Loading floor plan…
            </div>
          ) : (
            <WorkstationFloorMap
              pdfUrl={availability.plan?.pdfUrl}
              seats={availability.seats || []}
              bookingsBySeat={bookingsBySeat}
              requestsBySeat={requestsBySeat}
              selectedSeatIds={[]}
              onToggleSeat={() => { /* read-only — available seats do nothing */ }}
              onOpenBookingDetail={openBookingDetail}
              onOpenRequestDetail={openRequestDetail}
              loading={false}
              disabled={false}
              rooms={availability.rooms || []}
              roomBookingsByRoom={roomBookingsByRoom}
              roomOccupiedNowByRoom={roomOccupiedNowByRoom}
              onRoomClick={openRoomDetail}
              legendPreset="floor-layout"
              zoomToSeatIds={zoomTargetSeatIds}
              dimSeatsNotIn={highlightedSeatIds}
            />
          )}
        </div>

        {/* RIGHT panel */}
        {meetingsCollapsed ? (
          <button
            type="button"
            onClick={() => setMeetingsCollapsed(false)}
            className="hidden lg:flex flex-col items-center justify-center w-7 border-l border-gray-200 bg-white hover:bg-gray-50 text-gray-500 flex-shrink-0 group"
            data-testid="floor-layout-meetings-expand"
            aria-label="Expand panel"
            title="Show panel"
          >
            <ChevronLeft sx={{ fontSize: 14 }} className="text-[#ec9324]"/>
            <span className="mt-2 text-[10px] font-semibold tracking-wide text-gray-600 [writing-mode:vertical-rl] rotate-180 select-none whitespace-nowrap">
              Upcoming Meetings
              {filteredMeetings.length > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-4 rounded-full text-[9px] bg-emerald-100 text-emerald-700 px-1 align-middle">
                  {filteredMeetings.length}
                </span>
              )}
            </span>
          </button>
        ) : (
          <div className="w-80 border-l border-gray-200 bg-white flex-col hidden lg:flex flex-shrink-0" data-testid="floor-layout-meetings-side-panel">
            {/* Collapse handle on top */}
            <div className="px-3 pt-2 pb-1 flex items-center justify-between border-b border-gray-100 flex-shrink-0">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Floor Details</span>
              <button
                type="button"
                onClick={() => setMeetingsCollapsed(true)}
                className="p-1 rounded-md hover:bg-gray-100 text-gray-500"
                data-testid="floor-layout-meetings-collapse"
                aria-label="Collapse panel"
                title="Collapse"
              >
                <ChevronRight sx={{ fontSize: 16 }}/>
              </button>
            </div>

            {/* Date navigator */}
            <div className="px-4 pt-3 pb-3 border-b border-gray-100" data-testid="floor-layout-date-section">
              <DateStepper value={date} onChange={setDate}/>
            </div>

            {/* Filter by Team (multi-select) — v3-gated by desk_booking.floor_layout.filter_team */}
            {permTeamFilter.isVisible && (
            <div className="px-4 pt-3 pb-3 border-b border-gray-100" data-testid="floor-layout-team-filter">
              <div className="text-[11px] font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
                <Users sx={{ fontSize: 12 }} className="text-[#ec9324]"/>
                Filter by Team
              </div>
              <TeamFilter
                teams={teamOptions}
                value={selectedTeamIds}
                onChange={setSelectedTeamIds}
                disabled={!permTeamFilter.canUse}
              />
              {selectedTeamIds.length === 1 && (
                <div className="mt-1 text-[10px] text-[#ec9324]">Zoomed in on selected team.</div>
              )}
              {selectedTeamIds.length > 1 && (
                <div className="mt-1 text-[10px] text-gray-500">Filtering {selectedTeamIds.length} teams — pan/zoom manually.</div>
              )}
            </div>
            )}

            {/* Total Seats stats card */}
            <div className="px-4 pt-3 pb-3 border-b border-gray-100" data-testid="floor-layout-stats-card">
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-[#ec9324]/10 to-transparent">
                  <div className="inline-flex items-center gap-2">
                    <LayoutGrid sx={{ fontSize: 14 }} className="text-[#ec9324]"/>
                    <span className="text-[12px] font-semibold text-gray-800">Total Seats</span>
                  </div>
                  <span className="text-lg font-extrabold text-gray-900 tabular-nums" data-testid="floor-layout-stat-total">
                    {stats.total}
                  </span>
                </div>
                <div className="divide-y divide-gray-100">
                  <StatRow label="Available" value={stats.available} color="#15B867" testId="floor-layout-stat-available"/>
                  <StatRow label="Pending"   value={stats.pending}   color="#111111" testId="floor-layout-stat-pending"/>
                  <StatRow label="Meetings"  value={stats.meetings}  color="#10b981" testId="floor-layout-stat-meetings"/>
                </div>
              </div>
            </div>

            {/* Upcoming Meetings */}
            <div className="px-4 pt-3 pb-1 flex items-center justify-between flex-shrink-0">
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 min-w-0">
                <Building2 sx={{ fontSize: 14 }} className="text-emerald-600 flex-shrink-0"/>
                <span className="truncate">Upcoming Meetings</span>
              </div>
              <span className="text-[11px] font-medium text-gray-500">{filteredMeetings.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pt-1 pb-3 space-y-2 min-h-0" data-testid="floor-layout-meetings-panel">
              {filteredMeetings.length === 0 ? (
                <div className="text-center text-xs text-gray-400 py-8">
                  {selectedTeamIds.length > 0 && roomBookings.length > 0
                    ? "No upcoming meetings match the selected team(s)."
                    : "No upcoming meetings."}
                </div>
              ) : filteredMeetings.map((rb) => (
                <div key={rb.id} className="border border-gray-200 rounded-lg p-2.5 hover:border-emerald-300 transition" data-testid={`floor-meeting-${rb.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-sm text-gray-900 truncate">{rb.title}</div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100 whitespace-nowrap">{rb.room_name}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-600">
                    <Clock sx={{ fontSize: 11 }}/>
                    {fmtTime(rb.start_at)} – {fmtTime(rb.end_at)}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-600">
                    <Users sx={{ fontSize: 11 }}/>
                    {(rb.organizer || {}).name || "—"}
                    {rb.attendees?.length ? ` · ${rb.attendees.length} attendee${rb.attendees.length > 1 ? "s" : ""}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Booking / Request detail modal */}
      <FloorSeatDetailDialog detail={detail} onClose={closeDetail} />
      <RoomBookingDetailDialog
        room={roomDetail?.room || null}
        date={date}
        bookings={roomDetail?.bookings || []}
        onClose={closeRoomDetail}
      />
    </>
  );

  if (embedded) {
    return (
      <div className="flex flex-col h-[calc(100vh-8.5rem)] min-h-[560px]" data-testid="floor-layout-embedded">
        {innerContent}
      </div>
    );
  }

  return (
    <Layout
      title={plan.name}
      fullBleed
      contentClassName="flex flex-col h-screen"
      actions={!hideBack ? (
        <button
          onClick={onBack}
          data-testid="floor-layout-back-btn"
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 flex items-center gap-1 text-xs"
          aria-label="Back to floor plans"
          title="Back to floor plans"
        >
          <ArrowLeft sx={{ fontSize: 14 }}/> Back
        </button>
      ) : null}
    >
      {innerContent}
    </Layout>
  );
}


// ---------- Small helpers used by the interactive view ----------
function StatRow({ label, value, color, testId }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 text-[12px]" data-testid={testId}>
      <div className="inline-flex items-center gap-2 text-gray-700">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} aria-hidden="true"/>
        <span>{label}</span>
      </div>
      <span className="font-bold text-gray-900 tabular-nums">{value}</span>
    </div>
  );
}

function TeamFilter({ teams, value, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const toggle = (id) => {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  };
  const clear = (e) => { e.stopPropagation(); onChange([]); };
  const selectedTeams = teams.filter((t) => value.includes(t.id));
  return (
    <div ref={ref} className={`relative ${disabled ? "opacity-50" : ""}`} data-testid="floor-layout-team-filter-dropdown">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="w-full min-h-[34px] px-2 py-1 border border-gray-300 rounded-md text-left text-xs bg-white hover:border-[#ec9324] transition-colors flex items-center gap-1.5 flex-wrap disabled:cursor-not-allowed disabled:hover:border-gray-300"
        data-testid="floor-layout-team-filter-toggle"
      >
        {selectedTeams.length === 0 ? (
          <span className="text-gray-400">All teams</span>
        ) : selectedTeams.map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold text-white"
            style={{ background: `linear-gradient(135deg, ${(paletteForTeamStops(t.color))[0]} 0%, ${(paletteForTeamStops(t.color))[1]} 100%)` }}
          >
            {t.name}
            <span
              role="button"
              tabIndex={0}
              aria-label={`Remove ${t.name}`}
              onClick={(e) => { e.stopPropagation(); toggle(t.id); }}
              className="hover:bg-black/20 rounded-full p-0.5 cursor-pointer"
            >
              <X sx={{ fontSize: 9 }}/>
            </span>
          </span>
        ))}
        <span className="ml-auto text-gray-400 flex items-center gap-1">
          {selectedTeams.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={clear}
              className="text-[10px] text-gray-500 hover:text-gray-800 cursor-pointer"
              title="Clear selection"
            >Clear</span>
          )}
          <ChevronRight sx={{ fontSize: 14 }} className={`transform transition ${open ? "rotate-90" : ""}`}/>
        </span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-y-auto" data-testid="floor-layout-team-filter-menu">
          {teams.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-gray-400">No teams found.</div>
          ) : teams.map((t) => {
            const active = value.includes(t.id);
            const stops = paletteForTeamStops(t.color);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggle(t.id)}
                className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 ${active ? "bg-orange-50" : ""}`}
                data-testid={`floor-layout-team-filter-option-${t.id}`}
              >
                <span
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ background: `linear-gradient(135deg, ${stops[0]} 0%, ${stops[1]} 100%)` }}
                  aria-hidden="true"
                />
                <span className="flex-1 truncate">{t.name}</span>
                {active && <Check sx={{ fontSize: 12 }} className="text-[#ec9324]"/>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Meeting room overlay rendered inline by WorkstationFloorMap ----------
// (rooms are rendered inside WorkstationFloorMap so they pan/zoom with the PDF)

// ============================================================ MAIN
export default function FloorLayoutPage(props) {
  return <FloorLayoutView {...props} />;
}

// Reusable view — can be embedded (no Layout wrapper) inside the Dashboard.
export function FloorLayoutView({ embedded = false } = {}) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);
  // Tracks whether the current `active` plan was auto-opened because it is the
  // only live plan. In that case pressing "Back" should not drop the user onto
  // a single-card grid — we simply keep them on the auto-opened plan (or the
  // user can navigate away via the sidebar / breadcrumbs).
  const [autoOpened, setAutoOpened] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/floor-plans");
        if (cancelled) return;
        const all = res.data || [];
        const live = all.filter(p => (p.status || (p.live_version_id ? "live" : "draft")) === "live");
        setPlans(live);
        // Auto-open when exactly one live floor exists — skip the card view.
        if (live.length === 1) {
          const only = [...live].sort((a, b) =>
            (b.last_published_at || "").localeCompare(a.last_published_at || "")
          )[0];
          setActive(only);
          setAutoOpened(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const sortedPlans = useMemo(() => {
    return [...plans].sort((a, b) =>
      (b.last_published_at || "").localeCompare(a.last_published_at || "")
    );
  }, [plans]);

  if (active) {
    return (
      <PlanInteractiveView
        plan={active}
        onBack={() => {
          // When auto-opened (single live plan), a "Back" action would land on
          // an unnecessary single-card grid — hide the back button by making
          // it a no-op if there is nothing to go back to.
          if (autoOpened || sortedPlans.length <= 1) return;
          setActive(null);
        }}
        hideBack={autoOpened || sortedPlans.length <= 1 || embedded}
        embedded={embedded}
      />
    );
  }

  if (!loading && sortedPlans.length === 0) {
    const emptyBody = (
      <div className="flex flex-col items-center justify-center text-center min-h-[70vh] px-6" data-testid="floor-layout-empty-state">
        <LayoutGrid className="text-gray-300 mb-5" sx={{ fontSize: 56 }} aria-hidden="true"/>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-500" data-testid="floor-layout-empty-title">
          NO FLOOR LAYOUT AVAILABLE
        </h1>
        <p className="mt-3 text-sm sm:text-base text-gray-500 max-w-md" data-testid="floor-layout-empty-subtitle">
          No active floor calibration has been published yet.
        </p>
      </div>
    );
    if (embedded) return emptyBody;
    return (
      <Layout contentClassName="flex flex-col">{emptyBody}</Layout>
    );
  }

  const gridBody = (
    <>
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-500">
          <Loader2 className="animate-spin mr-2"/> Loading floor plans…
        </div>
      ) : (
        <>
          <div className="mb-4 text-xs text-gray-500">{sortedPlans.length} live plan{sortedPlans.length !== 1 ? "s" : ""}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5" data-testid="floor-layout-grid">
            {sortedPlans.map(p => (
              <FloorPlanCard key={p.id} plan={p} onOpen={setActive}/>
            ))}
          </div>
        </>
      )}
    </>
  );

  if (embedded) return <div className="p-4">{gridBody}</div>;
  return <Layout title="Floor Layout">{gridBody}</Layout>;
}
