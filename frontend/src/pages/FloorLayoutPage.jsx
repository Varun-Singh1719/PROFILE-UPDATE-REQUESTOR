import React, { useState } from "react";
import { LayoutGrid } from "lucide-react";
import FloorMap from "../components/FloorMap";
import { FLOOR_PLAN_CONFIG } from "../config/seatMaster";

export default function FloorLayoutPage() {
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [occupiedSeats, setOccupiedSeats] = useState(["H7", "2", "K3", "L1"]); // Demo occupied seats

  const handleSeatSelect = (seatId) => {
    setSelectedSeat(seatId);
    console.log('Selected seat:', seatId);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LayoutGrid className="text-[#ec9324]" size={32} />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Floor Layout</h1>
              <p className="text-sm text-gray-600">
                Select a workstation from the interactive floor map
              </p>
            </div>
          </div>
          
          {selectedSeat && (
            <div className="bg-[#ec9324] text-white px-4 py-2 rounded-lg">
              <span className="font-semibold">Selected: </span>
              <span className="text-lg">{selectedSeat}</span>
            </div>
          )}
        </div>
      </div>

      {/* Floor Map */}
      <div className="flex-1 relative">
        <FloorMap
          seats={FLOOR_PLAN_CONFIG.seats}
          pdfUrl={FLOOR_PLAN_CONFIG.pdfUrl}
          occupiedSeats={occupiedSeats}
          selectedSeat={selectedSeat}
          onSeatSelect={handleSeatSelect}
        />
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
            <span>Select Seat</span>
          </div>
        </div>
      </div>
    </div>
  );
}
