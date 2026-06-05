import React, { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import Seat from './Seat';
import { resolvePdfUrl } from '../lib/pdfUrl';
import { ZoomIn, ZoomOut, Maximize2, Bug } from 'lucide-react';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

const FloorMap = ({ 
  seats,
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
                <ZoomIn size={20} />
              </button>
              <button
                onClick={() => zoomOut()}
                className="p-3 bg-white rounded-lg shadow-lg hover:bg-gray-50 transition-colors"
                title="Zoom Out"
              >
                <ZoomOut size={20} />
              </button>
              <button
                onClick={() => resetTransform()}
                className="p-3 bg-white rounded-lg shadow-lg hover:bg-gray-50 transition-colors"
                title="Reset Zoom"
              >
                <Maximize2 size={20} />
              </button>
              <button
                onClick={() => setDebugMode(!debugMode)}
                className={`p-3 rounded-lg shadow-lg transition-colors ${
                  debugMode ? 'bg-yellow-400 text-white' : 'bg-white hover:bg-gray-50'
                }`}
                title="Toggle Debug Mode"
              >
                <Bug size={20} />
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
                        debugMode={debugMode}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </TransformComponent>
          </>
        )}
      </TransformWrapper>
    </div>
  );
};

export default FloorMap;
