import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ArrowLeft, LayoutGrid, MapPin, Clock, Loader2, FileText, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Users, Building2 } from "lucide-react";
import api from "../lib/api";
import Layout from "../components/Layout";
import WorkstationFloorMap from "../components/WorkstationFloorMap";

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
        onClick={() => shift(-1)}
        className="p-1.5 rounded-md border border-gray-300 hover:bg-gray-50"
        data-testid="floor-layout-prev-date"
        aria-label="Previous day"
      >
        <ChevronLeft size={14}/>
      </button>
      <div className="relative">
        <CalendarIcon size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#ec9324] pointer-events-none"/>
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-7 pr-2 py-1.5 text-sm border border-gray-300 rounded-md focus:border-[#ec9324] focus:ring-1 focus:ring-[#ec9324] outline-none bg-white"
          data-testid="floor-layout-date-input"
        />
      </div>
      <button
        onClick={() => shift(1)}
        className="p-1.5 rounded-md border border-gray-300 hover:bg-gray-50"
        data-testid="floor-layout-next-date"
        aria-label="Next day"
      >
        <ChevronRight size={14}/>
      </button>
      <button
        onClick={() => onChange(todayIso())}
        className="px-2 py-1 text-xs rounded-md border border-[#ec9324] text-[#ec9324] hover:bg-[#ec9324]/10"
        data-testid="floor-layout-today-btn"
      >
        Today
      </button>
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

  const crumbs = [
    { label: "Workspace Manager" },
    { label: "Floor Layout", to: "/workspace-manager/floor-layout" },
    { label: plan.name },
  ];

  const stats = {
    seats: (availability?.seats || []).length,
    booked: (availability?.bookings || []).length,
    pending: (availability?.pending_requests || []).length,
    meetings: roomBookings.length,
  };

  return (
    <Layout
      title={plan.name}
      fullBleed
      breadcrumbs={crumbs}
      contentClassName="flex flex-col h-screen"
      actions={<DateStepper value={date} onChange={setDate}/>}
    >
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {!hideBack && (
              <button
                onClick={onBack}
                data-testid="floor-layout-back-btn"
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
                aria-label="Back to floor plans"
                title="Back to floor plans"
              >
                <ArrowLeft size={18}/>
              </button>
            )}
            <LayoutGrid className="text-[#ec9324] flex-shrink-0" size={20}/>
            <p className="text-xs text-gray-600 inline-flex items-center gap-2 flex-wrap" data-testid="floor-layout-title">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border" style={{ color: "#15B867", backgroundColor: "#15B86715", borderColor: "#15B86755" }}>
                Live · {stats.seats} seats
              </span>
              <span className="text-gray-500" data-testid="floor-layout-stats">
                {stats.booked} booked · {stats.pending} pending · {stats.meetings} meeting{stats.meetings !== 1 ? "s" : ""}
              </span>
            </p>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-gray-500" data-testid="floor-layout-date-label">
          Showing bookings for <span className="font-semibold text-gray-700">{fmtDateLabel(date)}</span>
        </div>
      </div>

      <div className="flex-1 relative flex overflow-hidden">
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
            />
          )}
        </div>
        {/* Meeting bookings side panel */}
        <div className="w-72 border-l border-gray-200 bg-white flex-col hidden lg:flex" data-testid="floor-layout-meetings-panel">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Building2 size={14} className="text-emerald-600"/>
              Meeting Bookings
            </div>
            <span className="text-[11px] text-gray-500">{roomBookings.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {roomBookings.length === 0 ? (
              <div className="text-center text-xs text-gray-400 py-10">No meeting bookings for this day.</div>
            ) : roomBookings.map((rb) => (
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
      </div>
    </Layout>
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
        breadcrumbs={[{ label: "Workspace Manager" }, { label: "Floor Layout" }]}
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
      breadcrumbs={[{ label: "Workspace Manager" }, { label: "Floor Layout" }]}
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
