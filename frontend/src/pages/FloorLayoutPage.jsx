import React, { useState } from "react";
import { LayoutGrid, X, Settings, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import FloorMap from "../components/FloorMap";
import { FLOOR_PLAN_CONFIG } from "../config/seatMaster";

export default function FloorLayoutPage() {
  const [selectedSeats, setSelectedSeats] = useState([]); // Changed to array
  const [occupiedSeats, setOccupiedSeats] = useState(["H7", "B2", "K3", "V1"]); // Demo occupied seats
  const [showCalibrationAlert, setShowCalibrationAlert] = useState(true);

  const handleSeatSelect = (seatId) => {
    setSelectedSeats(prev => {
      // Toggle logic: if seat is already selected, remove it; otherwise add it
      if (prev.includes(seatId)) {
        return prev.filter(id => id !== seatId);
      } else {
        return [...prev, seatId];
      }
    });
  };

  const handleClearSelection = () => {
    setSelectedSeats([]);
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
                Select workstations from the interactive floor map
              </p>
            </div>
          </div>
          
          {selectedSeats.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="bg-[#ec9324] text-white px-4 py-2 rounded-lg flex items-center gap-2">
                <span className="font-semibold">Selected: </span>
                <span className="text-lg font-bold">{selectedSeats.length}</span>
                <span className="text-sm">
                  {selectedSeats.length === 1 ? 'seat' : 'seats'}
                </span>
              </div>
              <button
                onClick={handleClearSelection}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center gap-2"
              >
                <X size={16} />
                Clear All
              </button>
            </div>
          )}
        </div>

        {/* Selected Seats List */}
        {selectedSeats.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedSeats.map(seatId => (
              <div
                key={seatId}
                className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium flex items-center gap-2"
              >
                {seatId}
                <button
                  onClick={() => handleSeatSelect(seatId)}
                  className="hover:bg-green-200 rounded-full p-0.5 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floor Map */}
      <div className="flex-1 relative">
        <FloorMap
          seats={FLOOR_PLAN_CONFIG.seats}
          pdfUrl={FLOOR_PLAN_CONFIG.pdfUrl}
          occupiedSeats={occupiedSeats}
          selectedSeats={selectedSeats} // Pass array instead of single value
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
            <span>Select/Deselect Seat</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="px-2 py-1 bg-gray-100 border border-gray-300 rounded text-xs">🐛</kbd>
            <span>Debug Mode</span>
          </div>
        </div>
      </div>
    </div>
  );
}
