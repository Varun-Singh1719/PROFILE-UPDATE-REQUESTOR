import React, { useState, useEffect } from "react";
import { LayoutGrid, X, AlertCircle, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import FloorMap from "../components/FloorMap";
import { FLOOR_PLAN_CONFIG } from "../config/seatMaster";
import api from "../lib/api";

export default function FloorLayoutPage() {
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [occupiedSeats] = useState(["H7", "B2", "K3", "V1"]); // Demo occupied (no booking module yet)
  const [plan, setPlan] = useState(null); // backend floor plan
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/floor-plans/active");
        if (cancelled) return;
        setPlan(res.data || null);
      } catch (err) {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSeatSelect = (seatId) => {
    setSelectedSeats(prev =>
      prev.includes(seatId) ? prev.filter(id => id !== seatId) : [...prev, seatId]
    );
  };

  const handleClearSelection = () => setSelectedSeats([]);

  // Resolve seats + pdfUrl: backend plan wins, otherwise fall back to legacy static config
  const seats = plan?.seats?.length ? plan.seats : FLOOR_PLAN_CONFIG.seats;
  const pdfUrl = plan?.pdfUrl || FLOOR_PLAN_CONFIG.pdfUrl;
  const usingBackend = !!(plan?.seats?.length);

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LayoutGrid className="text-[#ec9324]" size={32} />
            <div>
              <h1 className="text-2xl font-bold text-gray-900" data-testid="floor-layout-title">Floor Layout</h1>
              <p className="text-sm text-gray-600">
                Select workstations from the interactive floor map
                {usingBackend && (
                  <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200">
                    Live · {seats.length} seats
                  </span>
                )}
              </p>
            </div>
          </div>

          {selectedSeats.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="bg-[#ec9324] text-white px-4 py-2 rounded-lg flex items-center gap-2">
                <span className="font-semibold">Selected: </span>
                <span className="text-lg font-bold">{selectedSeats.length}</span>
                <span className="text-sm">{selectedSeats.length === 1 ? 'seat' : 'seats'}</span>
              </div>
              <button
                onClick={handleClearSelection}
                data-testid="clear-selection-btn"
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center gap-2"
              >
                <X size={16} />
                Clear All
              </button>
            </div>
          )}
        </div>

        {selectedSeats.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedSeats.map(seatId => (
              <div key={seatId} className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium flex items-center gap-2">
                {seatId}
                <button onClick={() => handleSeatSelect(seatId)} className="hover:bg-green-200 rounded-full p-0.5 transition-colors">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {!loading && !usingBackend && (
          <div className="mt-3 flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              No calibrated floor plan saved yet. Showing the legacy demo layout.
              <Link to="/workspace-manager/calibration" className="ml-1 underline font-semibold">Open Seat Calibration</Link> to map seats and save to server.
            </div>
          </div>
        )}
      </div>

      {/* Floor Map */}
      <div className="flex-1 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500">
            <Loader2 className="animate-spin mr-2" size={20} /> Loading floor plan…
          </div>
        ) : (
          <FloorMap
            seats={seats}
            pdfUrl={pdfUrl}
            occupiedSeats={occupiedSeats}
            selectedSeats={selectedSeats}
            onSeatSelect={handleSeatSelect}
          />
        )}
      </div>

      {/* Instructions */}
      <div className="bg-white border-t border-gray-200 px-6 py-3">
        <div className="flex items-center justify-center gap-8 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <kbd className="px-2 py-1 bg-gray-100 border border-gray-300 rounded text-xs">Scroll</kbd>
            <span>Zoom</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="px-2 py-1 bg-gray-100 border border-gray-300 rounded text-xs">Drag</kbd>
            <span>Pan</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="px-2 py-1 bg-gray-100 border border-gray-300 rounded text-xs">Click</kbd>
            <span>Select/Deselect Seat</span>
          </div>
        </div>
      </div>
    </div>
  );
}
