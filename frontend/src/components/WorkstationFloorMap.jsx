import React, { useState, useMemo, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import WorkstationSeat from './WorkstationSeat';
import { resolvePdfUrl } from '../lib/pdfUrl';
import { ZoomIn, ZoomOut, Maximize2, Search, X } from 'lucide-react';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

/**
 * Workstation-only floor map. Renders only seats from the Live floor plan and
 * deliberately ignores meeting rooms — Workstation Booking is a closed module.
 *
 * Props
 * -----
 * pdfUrl              — Live floor plan PDF
 * seats               — [{id, label, x, y, size, rotation}] from floor plan version
 * bookingsBySeat      — map seat_id -> booking doc (active bookings on the chosen date)
 * selectedSeatIds     — currently selected seats (mirrors the form's MultiSelect)
 * onToggleSeat(id)    — flips selection of a seat (only valid for available seats)
 * onOpenBookingDetail(seat, booking)  — invoked when an occupied seat is clicked
 * loading             — show skeleton when data is being fetched
 * disabled            — when true, all click handlers are no-ops
 */
const WorkstationFloorMap = ({
  pdfUrl,
  seats = [],
  bookingsBySeat = {},
  selectedSeatIds = [],
  onToggleSeat,
  onOpenBookingDetail,
  loading = false,
  disabled = false,
}) => {
  const [pageWidth] = useState(1200);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pdfReady, setPdfReady] = useState(false);

  // Debounce search input (300ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Derive each seat's render-time status
  const enrichedSeats = useMemo(() => {
    const selectedSet = new Set(selectedSeatIds);
    return seats.map((s) => {
      const booking = bookingsBySeat[s.id];
      let status = 'available';
      let teamColor;
      if (selectedSet.has(s.id)) status = 'selected';
      else if (booking) {
        if (booking.team_id && booking.team_color) { status = 'team'; teamColor = booking.team_color; }
        else status = 'occupied';
      }
      const isMatch = debouncedSearch
        ? ((s.label || '').toLowerCase().includes(debouncedSearch) || s.id.toLowerCase().includes(debouncedSearch))
        : false;
      return { ...s, _status: status, _teamColor: teamColor, _booking: booking, _match: isMatch };
    });
  }, [seats, bookingsBySeat, selectedSeatIds, debouncedSearch]);

  const matchCount = enrichedSeats.filter((s) => s._match).length;

  return (
    <div className="w-full h-full bg-gray-100 relative overflow-hidden rounded-lg">
      {loading && (
        // Loading skeleton — pulse blocks while PDF + availability load
        <div className="absolute inset-0 z-30 bg-gray-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full border-4 border-[#ec9324] border-t-transparent animate-spin" />
            <div className="text-sm text-gray-500">Loading workstations…</div>
          </div>
        </div>
      )}

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
            {/* Top-left search + legend */}
            <div className="absolute top-4 left-4 z-20 flex flex-col gap-3" data-testid="ws-map-toolbar">
              <div className="bg-white rounded-lg shadow-lg p-2 flex items-center gap-2 w-64">
                <Search size={16} className="text-gray-400 flex-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search workstation (e.g. A1)"
                  className="flex-1 text-sm bg-transparent outline-none"
                  data-testid="ws-search-input"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-700" aria-label="Clear search">
                    <X size={14} />
                  </button>
                )}
              </div>
              {debouncedSearch && (
                <div className="bg-white rounded-md shadow px-2 py-1 text-[11px] text-gray-600 w-64">
                  {matchCount > 0 ? `${matchCount} match${matchCount > 1 ? 'es' : ''}` : 'No matches'}
                </div>
              )}

              <div className="bg-white rounded-lg shadow-lg p-3" data-testid="ws-map-legend">
                <h3 className="font-semibold text-xs mb-2 text-gray-700">Legend</h3>
                <div className="flex flex-col gap-1.5 text-[11px]">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-white border border-gray-500" />
                    <span>Available</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-[#22C55E]" />
                    <span>Selected</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-gray-400" />
                    <span>Occupied</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm" style={{ background: 'linear-gradient(45deg, #6366F1 50%, #F59E0B 50%)' }} />
                    <span>Team-assigned</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Top-right zoom controls */}
            <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
              <button onClick={() => zoomIn()} className="p-3 bg-white rounded-lg shadow-lg hover:bg-gray-50" title="Zoom In" data-testid="ws-zoom-in">
                <ZoomIn size={20} />
              </button>
              <button onClick={() => zoomOut()} className="p-3 bg-white rounded-lg shadow-lg hover:bg-gray-50" title="Zoom Out" data-testid="ws-zoom-out">
                <ZoomOut size={20} />
              </button>
              <button onClick={() => resetTransform()} className="p-3 bg-white rounded-lg shadow-lg hover:bg-gray-50" title="Reset Zoom" data-testid="ws-zoom-reset">
                <Maximize2 size={20} />
              </button>
            </div>

            <TransformComponent
              wrapperStyle={{ width: '100%', height: '100%' }}
              contentStyle={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
            >
              <div className="relative inline-block">
                <Document
                  file={resolvePdfUrl(pdfUrl)}
                  onLoadSuccess={() => setPdfReady(true)}
                  loading={
                    <div className="flex items-center justify-center w-[800px] h-[600px]">
                      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#ec9324]" />
                    </div>
                  }
                  error={
                    <div className="flex items-center justify-center w-[800px] h-[600px] text-red-500 text-sm">
                      Failed to load floor plan.
                    </div>
                  }
                >
                  <Page
                    pageNumber={1}
                    width={pageWidth}
                    devicePixelRatio={2}
                    renderMode="canvas"
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                </Document>

                {/* Seat overlay — only renders once the PDF is ready to avoid mis-positioning */}
                {pdfReady && (
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="relative w-full h-full pointer-events-auto">
                      {enrichedSeats.map((seat) => (
                        <WorkstationSeat
                          key={seat.id}
                          seat={seat}
                          status={seat._status}
                          teamColor={seat._teamColor}
                          booking={seat._booking}
                          isClickable={!disabled}
                          searchHighlight={seat._match}
                          onClick={onToggleSeat}
                          onOccupiedClick={onOpenBookingDetail}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </TransformComponent>
          </>
        )}
      </TransformWrapper>

      {/* Subtle CSS animation for search pulse */}
      <style>{`
        @keyframes ws-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.5); }
          50%      { box-shadow: 0 0 0 6px rgba(37, 99, 235, 0); }
        }
      `}</style>
    </div>
  );
};

export default WorkstationFloorMap;
