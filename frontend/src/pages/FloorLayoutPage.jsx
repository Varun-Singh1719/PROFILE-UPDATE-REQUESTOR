import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, LayoutGrid, MapPin, Clock, Loader2, X, FileText } from "lucide-react";
import FloorMap from "../components/FloorMap";
import api from "../lib/api";
import Layout from "../components/Layout";

function fmt(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
  catch { return iso; }
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
          <img
            src={plan.thumbnail}
            alt={`${plan.name} preview`}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="flex flex-col items-center text-gray-400">
            <FileText size={32} />
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

// ---------- Interactive view (per plan) ----------
function PlanInteractiveView({ plan, onBack }) {
  const [seats, setSeats] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [occupiedSeats] = useState(["H7", "B2", "K3", "V1"]); // demo

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/floor-plans/${plan.id}`);
        if (cancelled) return;
        setSeats(res.data.live_seats || []);
        setRooms(res.data.live_rooms || []);
        setPdfUrl(res.data.pdfUrl);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [plan.id]);

  const handleSeatSelect = (seatId) => setSelectedSeats(prev =>
    prev.includes(seatId) ? prev.filter(id => id !== seatId) : [...prev, seatId]);

  const crumbs = [
    { label: "Workspace Manager" },
    { label: "Floor Layout", to: "/workspace-manager/floor-layout" },
    { label: plan.name },
  ];

  return (
    <Layout fullBleed breadcrumbs={crumbs} contentClassName="flex flex-col h-screen">
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onBack}
              data-testid="floor-layout-back-btn"
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
              aria-label="Back to floor plans"
            >
              <ArrowLeft size={18}/>
            </button>
            <LayoutGrid className="text-[#ec9324] flex-shrink-0" size={24}/>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-gray-900 truncate" data-testid="floor-layout-title">{plan.name}</h1>
              <p className="text-xs text-gray-600 inline-flex items-center gap-1">
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border"
                  style={{ color: "#15B867", backgroundColor: "#15B86715", borderColor: "#15B86755" }}
                >
                  Live · {seats.length} seats
                </span>
              </p>
            </div>
          </div>
          {selectedSeats.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="bg-[#ec9324] text-white px-3 py-1.5 rounded-lg text-sm">
                <span className="font-semibold">Selected:</span> <span className="font-bold">{selectedSeats.length}</span>
              </div>
              <button
                onClick={() => setSelectedSeats([])}
                data-testid="clear-selection-btn"
                className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 flex items-center gap-1.5"
              ><X size={14}/> Clear</button>
            </div>
          )}
        </div>
        {selectedSeats.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedSeats.map(seatId => (
              <div key={seatId} className="bg-green-100 text-green-800 px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1.5">
                {seatId}
                <button onClick={() => handleSeatSelect(seatId)} className="hover:bg-green-200 rounded-full p-0.5"><X size={12}/></button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500">
            <Loader2 className="animate-spin mr-2" size={20}/> Loading floor plan…
          </div>
        ) : (
          <FloorMap
            seats={seats}
            rooms={rooms}
            pdfUrl={pdfUrl}
            occupiedSeats={occupiedSeats}
            selectedSeats={selectedSeats}
            onSeatSelect={handleSeatSelect}
          />
        )}
      </div>
    </Layout>
  );
}

// ============================================================ MAIN
export default function FloorLayoutPage() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null); // selected plan to view interactively

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/floor-plans");
        if (cancelled) return;
        const all = res.data || [];
        // Show only plans that are explicitly Live (excludes Draft + Inactive)
        const live = all.filter(p => (p.status || (p.live_version_id ? "live" : "draft")) === "live");
        setPlans(live);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Sort by most recently published first
  const sortedPlans = useMemo(() => {
    return [...plans].sort((a, b) =>
      (b.last_published_at || "").localeCompare(a.last_published_at || "")
    );
  }, [plans]);

  if (active) {
    return <PlanInteractiveView plan={active} onBack={() => setActive(null)}/>;
  }

  // Empty state: no Live floor calibrations published yet → show centered, prominent message
  if (!loading && sortedPlans.length === 0) {
    return (
      <Layout
        breadcrumbs={[{ label: "Workspace Manager" }, { label: "Floor Layout" }]}
        contentClassName="flex flex-col"
      >
        <div
          className="flex flex-col items-center justify-center text-center min-h-[70vh] px-6"
          data-testid="floor-layout-empty-state"
        >
          <LayoutGrid className="text-gray-300 mb-5" size={56} aria-hidden="true" />
          <h1
            className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-500"
            data-testid="floor-layout-empty-title"
          >
            NO FLOOR LAYOUT AVAILABLE
          </h1>
          <p
            className="mt-3 text-sm sm:text-base text-gray-500 max-w-md"
            data-testid="floor-layout-empty-subtitle"
          >
            No active floor calibration has been published yet.
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout breadcrumbs={[{ label: "Workspace Manager" }, { label: "Floor Layout" }]}>
      <div className="flex items-center gap-3 mb-5">
        <LayoutGrid className="text-[#ec9324]" size={28}/>
        <div>
          <h1 className="text-2xl font-bold text-gray-900" data-testid="floor-layout-title">Floor Layout</h1>
          <p className="text-sm text-gray-600">Select a floor plan to view its live seating arrangement.</p>
        </div>
      </div>

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

// Fallback removed: when no Live floor plan exists, the empty-state message above
// "NO FLOOR LAYOUT AVAILABLE" is shown instead of the legacy demo layout.
