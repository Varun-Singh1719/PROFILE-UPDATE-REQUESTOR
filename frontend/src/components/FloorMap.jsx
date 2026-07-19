import React, { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import Seat from './Seat';
import { resolvePdfUrl } from '../lib/pdfUrl';
import ZoomIn from "@mui/icons-material/ZoomIn";
import ZoomOut from "@mui/icons-material/ZoomOut";
import Maximize2 from "@mui/icons-material/OpenInFull";
import Bug from "@mui/icons-material/BugReportOutlined";
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

const FloorMap = ({ 
  seats,
  rooms = [],
  occupiedSeats = [],
  selectedSeats = [], // Changed from selectedSeat to selectedSeats (array)
  onSeatSelect,
  pdfUrl 
}) => {
  const [numPages, setNumPages] = useState(null);
  const [pageWidth, setPageWidth] = useState(1200);
  const [debugMode, setDebugMode] = useState(false);

  const onDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages);
  };

  // Merge seat data with status
  const enrichedSeats = seats.map(seat => ({
    ...seat,
    status: occupiedSeats.includes(seat.id) 
      ? 'occupied' 
      : selectedSeats.includes(seat.id) // Check if seat is in selectedSeats array
      ? 'selected' 
      : 'available'
  }));

  const handleSeatClick = (seatId) => {
    const seat = enrichedSeats.find(s => s.id === seatId);
    
    if (seat.status === 'occupied') {
      return; // Can't select occupied seats
    }
    
    // Pass the seatId to parent - parent will handle toggle logic
    onSeatSelect(seatId);
  };

  return (
    <div className="w-full h-full bg-gray-100 relative overflow-hidden">
      <TransformWrapper
        initialScale={1}
        minScale={0.5}
        maxScale={4}
        centerOnInit={true}
        wheel={{ step: 0.1 }}
        pinch={{ step: 5 }}
        doubleClick={{ mode: 'reset' }}
      >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            {/* Zoom Controls */}
            <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
              <button
                onClick={() => zoomIn()}
                className="p-3 bg-white rounded-lg shadow-lg hover:bg-gray-50 transition-colors"
                title="Zoom In"
              >
                <ZoomIn sx={{ fontSize: 20 }}/>
              </button>
              <button
                onClick={() => zoomOut()}
                className="p-3 bg-white rounded-lg shadow-lg hover:bg-gray-50 transition-colors"
                title="Zoom Out"
              >
                <ZoomOut sx={{ fontSize: 20 }}/>
              </button>
              <button
                onClick={() => resetTransform()}
                className="p-3 bg-white rounded-lg shadow-lg hover:bg-gray-50 transition-colors"
                title="Reset Zoom"
              >
                <Maximize2 sx={{ fontSize: 20 }}/>
              </button>
              <button
                onClick={() => setDebugMode(!debugMode)}
                className={`p-3 rounded-lg shadow-lg transition-colors ${
                  debugMode ? 'bg-yellow-400 text-white' : 'bg-white hover:bg-gray-50'
                }`}
                title="Toggle Debug Mode"
              >
                <Bug sx={{ fontSize: 20 }}/>
              </button>
            </div>

            {/* Legend */}
            <div className="absolute top-4 left-4 z-20 bg-white rounded-lg shadow-lg p-4">
              <h3 className="font-semibold text-sm mb-2">Legend</h3>
              <div className="flex flex-col gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-white border-2 border-[#FF1493]" />
                  <span>Available</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-[#00FF00] border-2 border-[#FF1493]" />
                  <span>Selected</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-[#808080] border-2 border-[#FF1493]" />
                  <span>Occupied</span>
                </div>
              </div>
              {debugMode && (
                <div className="mt-2 pt-2 border-t border-gray-200">
                  <div className="text-xs text-yellow-600 font-semibold">
                    🐛 Debug Mode Active
                  </div>
                </div>
              )}
            </div>

            {/* PDF and Seat Overlay */}
            <TransformComponent
              wrapperStyle={{
                width: '100%',
                height: '100%',
              }}
              contentStyle={{
                width: '100%',
                height: '100%',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <div className="relative inline-block">
                {/* PDF Background */}
                <Document
                  file={resolvePdfUrl(pdfUrl)}
                  onLoadSuccess={onDocumentLoadSuccess}
                  loading={
                    <div className="flex items-center justify-center h-screen">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#ec9324]" />
                    </div>
                  }
                  error={
                    <div className="flex items-center justify-center h-screen text-red-500">
                      Failed to load floor plan. Please try again.
                    </div>
                  }
                >
                  <Page
                    pageNumber={1}
                    width={pageWidth}
                    devicePixelRatio={4}
                    renderMode="canvas"
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                </Document>

                {/* Seat Overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="relative w-full h-full pointer-events-auto">
                    {enrichedSeats.map((seat) => (
                      <Seat
                        key={seat.id}
                        seat={seat}
                        onClick={handleSeatClick}
                        isClickable={seat.status !== 'occupied'}
                        isSelected={seat.status === 'selected'}
                        isOccupied={seat.status === 'occupied'}
                        debugMode={debugMode}
                      />
                    ))}
                  </div>
                </div>

                {/* Meeting Rooms Overlay (read-only) — only rendered in the consolidated Floor Layout view */}
                {rooms && rooms.length > 0 && (
                  <div className="absolute inset-0 pointer-events-none" data-testid="floor-rooms-overlay">
                    {rooms.map((r) => (
                      <div
                        key={r.id}
                        data-testid={`floor-room-${r.id}`}
                        className="absolute"
                        style={{
                          left: `${r.x}%`, top: `${r.y}%`,
                          width: `${r.w}%`, height: `${r.h}%`,
                          border: '2px solid #10b981',
                          background: 'rgba(16,185,129,0.10)',
                          boxSizing: 'border-box',
                          zIndex: 5,
                        }}
                      >
                        <div
                          className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-semibold pointer-events-none select-none"
                          style={{ background: 'rgba(16,185,129,0.95)', color: 'white', maxWidth: '90%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        >
                          {r.name}{r.capacity ? ` (${r.capacity})` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TransformComponent>
          </>
        )}
      </TransformWrapper>
    </div>
  );
};

export default FloorMap;
