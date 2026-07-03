import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ArrowLeft, LayoutGrid, MapPin, Clock, Loader2, FileText, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Users, Building2, Check, X } from "lucide-react";
import api from "../lib/api";
import Layout from "../components/Layout";
import WorkstationFloorMap from "../components/WorkstationFloorMap";
import { paletteForTeam } from "../lib/teamColors";

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
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
  catch { return iso; }
}

function fmtDateLabel(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
}

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });
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
            <FileText size={32}/>
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
          <span className="inline-flex items-center gap-1"><MapPin size={11}/> {plan.live_seat_count} live seats</span>
          <span className="inline-flex items-center gap-1"><Clock size={11}/> {fmt(plan.last_published_at || plan.updated_at)}</span>
        </div>
      </div>
    </button>
  );
}

// ---------- Date stepper ----------
function DateStepper({ value, onChange }) {
  const shift = (days) => {
    const d = new Date(value + "T00:00:00");
    d.setDate(d.getDate() + days);
    const out = d.toISOString().slice(0, 10);
    onChange(out);
  };
  return (
    <div className="flex items-center gap-2" data-testid="floor-layout-date-stepper">
      <button
        type="button"
        onClick={() => shift(-1)}
        className="p-1.5 rounded-md border border-gray-300 hover:bg-gray-50 relative group/prev"
        data-testid="floor-layout-prev-date"
        aria-label="Previous Date"
      >
        <ChevronLeft size={14}/>
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-30 px-1.5 py-0.5 rounded bg-gray-900 text-white text-[10px] font-medium whitespace-nowrap shadow opacity-0 group-hover/prev:opacity-100 transition-opacity"
        >Previous Date</span>
      </button>
      <div className="relative">
        <CalendarIcon size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#ec9324] pointer-events-none z-[1]"/>
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="floor-layout-date-input pl-7 pr-2 py-1.5 text-sm border border-gray-300 rounded-md focus:border-[#ec9324] focus:ring-1 focus:ring-[#ec9324] outline-none bg-white"
          data-testid="floor-layout-date-input"
        />
      </div>
      <button
        type="button"
        onClick={() => shift(1)}
        className="p-1.5 rounded-md border border-gray-300 hover:bg-gray-50 relative group/next"
        data-testid="floor-layout-next-date"
        aria-label="Next Date"
      >
        <ChevronRight size={14}/>
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 z-30 px-1.5 py-0.5 rounded bg-gray-900 text-white text-[10px] font-medium whitespace-nowrap shadow opacity-0 group-hover/next:opacity-100 transition-opacity"
        >Next Date</span>
      </button>
      <button
        type="button"
        onClick={() => onChange(todayIso())}
        className="px-2 py-1 text-xs rounded-md border border-[#ec9324] text-[#ec9324] hover:bg-[#ec9324]/10"
        data-testid="floor-layout-today-btn"
      >
        Today
      </button>
      {/* Hide the native date-picker indicator so it can't overlap the Next button */}
      <style>{`
        .floor-layout-date-input::-webkit-calendar-picker-indicator {
          opacity: 0;
          position: absolute;
          left: 0; top: 0; width: 100%; height: 100%;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

// ---------- Interactive combined view (per plan) ----------
function PlanInteractiveView({ plan, onBack, hideBack = false }) {
  const [date, setDate] = useState(todayIso());
  const [availability, setAvailability] = useState(null);
  const [roomBookings, setRoomBookings] = useState([]);
  const [loading, setLoading] = useState(true);

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

  // Build the team list from the day's bookings (each team appears once).
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

  // Multi-select team filter state — controls both the dim-map effect and the
  // Meeting Bookings list filter.
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  // Reset the filter when the plan/date changes (list may no longer match)
  useEffect(() => { setSelectedTeamIds([]); }, [plan.id, date]);

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

  // Meetings list respects the team filter — if the meeting organizer's team
  // is one of the selected teams, keep it. When nothing is selected, show all.
  const filteredMeetings = useMemo(() => {
    if (selectedTeamIds.length === 0) return roomBookings;
    const set = new Set(selectedTeamIds);
    return roomBookings.filter((rb) => {
      // Try common shapes from the API: organizer_team_id or attendees carrying team refs
      if (rb.organizer_team_id && set.has(rb.organizer_team_id)) return true;
      if (Array.isArray(rb.attendees)) {
        return rb.attendees.some((a) => a?.type === "team" && set.has(a.id));
      }
      return false;
    });
  }, [roomBookings, selectedTeamIds]);

  return (
    <Layout
      title={plan.name}
      fullBleed
      contentClassName="flex flex-col h-screen"
      actions={<DateStepper value={date} onChange={setDate}/>}
    >
      <div className="flex-1 relative flex overflow-hidden">
        {/* LEFT PANEL — team filter + stats card + Meeting Bookings.
            Kept narrow so the floor map (right) stays the primary focus. */}
        <div className="w-80 border-r border-gray-200 bg-white flex-col hidden lg:flex flex-shrink-0" data-testid="floor-layout-side-panel">
          {/* Panel header — back button + title + date label */}
          <div className="px-4 py-3 border-b border-gray-200 flex items-start gap-2">
            {!hideBack && (
              <button
                onClick={onBack}
                data-testid="floor-layout-back-btn"
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 flex-shrink-0"
                aria-label="Back to floor plans"
                title="Back to floor plans"
              >
                <ArrowLeft size={16}/>
              </button>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-gray-500 uppercase tracking-wide font-semibold">Floor Layout</div>
              <div className="text-sm font-bold text-gray-900 truncate" title={plan.name}>{plan.name}</div>
              <div className="mt-1 text-[10px] text-gray-500" data-testid="floor-layout-date-label">
                Showing bookings for <span className="font-semibold text-gray-700">{fmtDateLabel(date)}</span>
              </div>
            </div>
          </div>

          {/* Team filter (multi-select) */}
          <div className="px-4 pt-3 pb-2 border-b border-gray-100" data-testid="floor-layout-team-filter">
            <div className="text-[11px] font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
              <Users size={12} className="text-[#ec9324]"/>
              Filter by Team
            </div>
            <TeamFilter
              teams={teamsInBookings}
              value={selectedTeamIds}
              onChange={setSelectedTeamIds}
            />
            {selectedTeamIds.length === 1 && (
              <div className="mt-1 text-[10px] text-[#ec9324]">Zoomed in on selected team.</div>
            )}
            {selectedTeamIds.length > 1 && (
              <div className="mt-1 text-[10px] text-gray-500">Filtering {selectedTeamIds.length} teams — pan/zoom manually.</div>
            )}
          </div>

          {/* Stats card */}
          <div className="px-4 py-3 border-b border-gray-100" data-testid="floor-layout-stats-card">
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-[#ec9324]/10 to-transparent">
                <div className="inline-flex items-center gap-2">
                  <LayoutGrid size={14} className="text-[#ec9324]"/>
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

          {/* Meeting bookings list */}
          <div className="px-4 pt-2 pb-1 flex items-center justify-between flex-shrink-0">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Building2 size={14} className="text-emerald-600"/>
              Meeting Bookings
            </div>
            <span className="text-[11px] text-gray-500">{filteredMeetings.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pt-1 pb-3 space-y-2 min-h-0" data-testid="floor-layout-meetings-panel">
            {filteredMeetings.length === 0 ? (
              <div className="text-center text-xs text-gray-400 py-8">
                {selectedTeamIds.length > 0 && roomBookings.length > 0
                  ? "No meetings match the selected team(s)."
                  : "No meeting bookings for this day."}
              </div>
            ) : filteredMeetings.map((rb) => (
              <div key={rb.id} className="border border-gray-200 rounded-lg p-2.5 hover:border-emerald-300 transition" data-testid={`floor-meeting-${rb.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-sm text-gray-900 truncate">{rb.title}</div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100 whitespace-nowrap">{rb.room_name}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-600">
                  <Clock size={11}/>
                  {fmtTime(rb.start_at)} – {fmtTime(rb.end_at)}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-600">
                  <Users size={11}/>
                  {(rb.organizer || {}).name || "—"}
                  {rb.attendees?.length ? ` · ${rb.attendees.length} attendee${rb.attendees.length > 1 ? "s" : ""}` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — full-bleed floor map (no header banner on top). */}
        <div className="flex-1 relative min-w-0">
          {loading || !availability ? (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500">
              <Loader2 className="animate-spin mr-2" size={20}/> Loading floor plan…
            </div>
          ) : (
            <WorkstationFloorMap
              pdfUrl={availability.plan?.pdfUrl}
              seats={availability.seats || []}
              bookingsBySeat={bookingsBySeat}
              requestsBySeat={requestsBySeat}
              selectedSeatIds={[]}
              onToggleSeat={() => { /* read-only */ }}
              onOpenBookingDetail={() => { /* no detail dialog in layout view */ }}
              onOpenRequestDetail={() => { /* no detail dialog */ }}
              loading={false}
              disabled={true}
              rooms={availability.rooms || []}
              roomBookingsByRoom={roomBookingsByRoom}
              legendPreset="floor-layout"
              zoomToSeatIds={zoomTargetSeatIds}
              dimSeatsNotIn={highlightedSeatIds}
            />
          )}
        </div>
      </div>
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

function TeamFilter({ teams, value, onChange }) {
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
    <div ref={ref} className="relative" data-testid="floor-layout-team-filter-dropdown">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full min-h-[34px] px-2 py-1 border border-gray-300 rounded-md text-left text-xs bg-white hover:border-[#ec9324] transition-colors flex items-center gap-1.5 flex-wrap"
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
              <X size={9}/>
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
          <ChevronRight size={14} className={`transform transition ${open ? "rotate-90" : ""}`}/>
        </span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-y-auto" data-testid="floor-layout-team-filter-menu">
          {teams.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-gray-400">No team bookings for this day.</div>
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
                {active && <Check size={12} className="text-[#ec9324]"/>}
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
export default function FloorLayoutPage() {
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
        hideBack={autoOpened || sortedPlans.length <= 1}
      />
    );
  }

  if (!loading && sortedPlans.length === 0) {
    return (
      <Layout
        contentClassName="flex flex-col"
      >
        <div className="flex flex-col items-center justify-center text-center min-h-[70vh] px-6" data-testid="floor-layout-empty-state">
          <LayoutGrid className="text-gray-300 mb-5" size={56} aria-hidden="true"/>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-500" data-testid="floor-layout-empty-title">
            NO FLOOR LAYOUT AVAILABLE
          </h1>
          <p className="mt-3 text-sm sm:text-base text-gray-500 max-w-md" data-testid="floor-layout-empty-subtitle">
            No active floor calibration has been published yet.
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      title="Floor Layout"
    >
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
    </Layout>
  );
}
