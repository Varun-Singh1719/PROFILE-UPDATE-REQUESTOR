/**
 * MySeatFloorDialog — Popup that renders the full floor plan with:
 *   • the current user's allotted seat coloured RED
 *   • team-member seats coloured with the team colour
 *   • other occupied seats coloured GREY
 *   • available seats coloured WHITE
 *
 * Feeds the existing WorkstationFloorMap by synthesising a `bookingsBySeat`
 * mapping that leverages its native "team"/"occupied" render paths.
 */
import React, { useMemo } from "react";
import { X } from "lucide-react";
import WorkstationFloorMap from "./WorkstationFloorMap";

const USER_SEAT_COLOR = "#dc2626"; // red-600 — reserved for the current user

export default function MySeatFloorDialog({ open, onClose, floorData, dateLabel }) {
  const bookingsBySeat = useMemo(() => {
    if (!floorData) return {};
    const out = {};
    const meta = floorData.seat_meta || {};

    // 1) the user's own seat → red "team" so the map renders it with a coloured
    //    silhouette and lets us pass a custom hex.
    if (floorData.user_seat_id) {
      const m = meta[floorData.user_seat_id] || {};
      out[floorData.user_seat_id] = {
        id: "my-seat",
        seat_id: floorData.user_seat_id,
        seat_label: m.seat_label,
        team_id: "__me__",
        team_name: "You",
        team_color: USER_SEAT_COLOR,
        employee: { name: m.employee_name || "You" },
      };
    }

    // 2) team-members' seats → real team colour
    for (const sid of floorData.team_seat_ids || []) {
      const m = meta[sid] || {};
      out[sid] = {
        id: `t-${sid}`,
        seat_id: sid,
        seat_label: m.seat_label,
        team_id: "team",
        team_name: m.team_name || floorData.team_name || "Team",
        team_color: m.team_color || floorData.team_color || "#3b82f6",
        employee: { name: m.employee_name },
      };
    }

    // 3) other occupied seats → grey (no team_color triggers "occupied" render)
    for (const sid of floorData.occupied_seat_ids || []) {
      const m = meta[sid] || {};
      out[sid] = {
        id: `o-${sid}`,
        seat_id: sid,
        seat_label: m.seat_label,
        // no team_id / team_color → floor map renders as "occupied" grey
        employee: { name: m.employee_name || "Someone" },
      };
    }
    return out;
  }, [floorData]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-stretch justify-center bg-black/60 p-3 sm:p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid="my-seat-floor-dialog"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[#ec9324] font-bold">Floor Plan</div>
            <div className="mt-0.5 font-bold text-gray-900">
              {floorData?.plan?.name || "Floor plan"}
              <span className="ml-2 text-xs font-medium text-gray-500">{dateLabel}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm border border-red-600 bg-red-600" /> Your seat
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm border border-blue-500"
                      style={{ background: floorData?.team_color || "#3b82f6" }} /> Team
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-gray-400 border border-gray-500" /> Occupied
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-white border border-gray-400" /> Available
              </span>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-md inline-flex items-center justify-center text-gray-500 hover:bg-gray-100"
              aria-label="Close"
              data-testid="my-seat-floor-close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 relative min-h-[560px]">
          {!floorData ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
              Loading floor plan…
            </div>
          ) : (
            <WorkstationFloorMap
              pdfUrl={floorData.plan?.pdfUrl}
              seats={floorData.seats || []}
              bookingsBySeat={bookingsBySeat}
              requestsBySeat={{}}
              selectedSeatIds={[]}
              onToggleSeat={() => {}}
              onOpenBookingDetail={() => {}}
              onOpenRequestDetail={() => {}}
              loading={false}
              disabled={true}
              rooms={[]}
              roomBookingsByRoom={{}}
              zoomToSeatIds={floorData.user_seat_id ? [floorData.user_seat_id] : null}
            />
          )}
        </div>
      </div>
    </div>
  );
}
