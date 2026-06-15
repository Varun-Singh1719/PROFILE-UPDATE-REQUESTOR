import React, { useState, useMemo, useEffect, useRef } from 'react';
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
 * requestsBySeat      — map seat_id -> pending workstation request doc (renders seat as black)
 * selectedSeatIds     — currently selected seats (mirrors the form's MultiSelect)
 * onToggleSeat(id)    — flips selection of a seat (only valid for available seats)
 * onOpenBookingDetail(seat, booking)  — invoked when an occupied seat is clicked
 * onOpenRequestDetail(seat, request)  — invoked when a pending seat is clicked
 * loading             — show skeleton when data is being fetched
 * disabled            — when true, all click handlers are no-ops
 * centerOnSeatId      — when set, the map pans + zooms in on this seat with a brief
 *                       highlight pulse (used by Pending Approvals card → focus seat).
 */
const WorkstationFloorMap = ({
  pdfUrl,
  seats = [],
  bookingsBySeat = {},
  requestsBySeat = {},
  selectedSeatIds = [],
  onToggleSeat,
  onOpenBookingDetail,
  onOpenRequestDetail,
  loading = false,
  disabled = false,
  centerOnSeatId = null,
  rooms = [],
  roomBookingsByRoom = {},
}) => {
  const [pageWidth] = useState(1200);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pdfReady, setPdfReady] = useState(false);
  const [focusFlashSeatId, setFocusFlashSeatId] = useState(null);
  const transformRef = useRef(null);

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
      const request = requestsBySeat[s.id];
      let status = 'available';
      let teamColor;
      if (selectedSet.has(s.id)) status = 'selected';
      else if (request) status = 'pending';
      else if (booking) {
        if (booking.team_id && booking.team_color) { status = 'team'; teamColor = booking.team_color; }
        else status = 'occupied';
      }
      const isMatch = debouncedSearch
        ? ((s.label || '').toLowerCase().includes(debouncedSearch) || s.id.toLowerCase().includes(debouncedSearch))
        : false;
      const isFocusFlash = focusFlashSeatId === s.id;
      return { ...s, _status: status, _teamColor: teamColor, _booking: booking, _request: request, _match: isMatch || isFocusFlash };
    });
  }, [seats, bookingsBySeat, requestsBySeat, selectedSeatIds, debouncedSearch, focusFlashSeatId]);

  const matchCount = enrichedSeats.filter((s) => s._match).length;

  // Pan + zoom to a specific seat when `centerOnSeatId` changes. Used by the
  // Pending Approvals page — clicking a card flies the map to that workstation.
  useEffect(() => {
    if (!centerOnSeatId || !pdfReady) return;
    // Defer until next frame so the seat overlay is in the DOM.
    const id = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-testid="ws-seat-${centerOnSeatId}"]`);
      if (el && transformRef.current && transformRef.current.zoomToElement) {
        try {
          transformRef.current.zoomToElement(el, 2.2, 450, 'easeOut');
        } catch {
          /* ignore — library version safety */
        }
      }
      // Add a brief blue search-style highlight pulse for ~2s
      setFocusFlashSeatId(centerOnSeatId);
      const t = setTimeout(() => setFocusFlashSeatId(null), 2200);
      return () => clearTimeout(t);
    });
    return () => cancelAnimationFrame(id);
  }, [centerOnSeatId, pdfReady]);

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
        ref={transformRef}
        initialScale={1}
        minScale={0.5}
        maxScale={4}
        centerOnInit={true}
        wheel={{ step: 0.2, smoothStep: 0.008 }}
        pinch={{ step: 5 }}
        doubleClick={{ mode: 'reset' }}
        panning={{ velocityDisabled: false }}
        velocityAnimation={{ sensitivity: 1, animationTime: 250, animationType: 'easeOut' }}
        zoomAnimation={{ animationTime: 250, animationType: 'easeOut' }}
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
                    <div className="w-4 h-4 rounded-sm bg-white border-2 border-black" />
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
                    <div className="w-4 h-4 rounded-sm bg-[#111111]" />
                    <span>Pending Approval</span>
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
              <button onClick={() => zoomIn(0.25, 250, 'easeOut')} className="p-3 bg-white rounded-lg shadow-lg hover:bg-gray-50" title="Zoom In" data-testid="ws-zoom-in">
                <ZoomIn size={20} />
              </button>
              <button onClick={() => zoomOut(0.25, 250, 'easeOut')} className="p-3 bg-white rounded-lg shadow-lg hover:bg-gray-50" title="Zoom Out" data-testid="ws-zoom-out">
                <ZoomOut size={20} />
              </button>
              <button onClick={() => resetTransform(300, 'easeOut')} className="p-3 bg-white rounded-lg shadow-lg hover:bg-gray-50" title="Reset Zoom" data-testid="ws-zoom-reset">
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
                          request={seat._request}
                          isClickable={!disabled}
                          searchHighlight={seat._match}
                          onClick={onToggleSeat}
                          onOccupiedClick={(s, info) => {
                            if (seat._status === 'pending') {
                              if (onOpenRequestDetail) onOpenRequestDetail(s, info);
                            } else if (onOpenBookingDetail) {
                              onOpenBookingDetail(s, info);
                            }
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Meeting rooms overlay (rendered inside the transform so it pans/zooms with the PDF) */}
                {pdfReady && rooms && rooms.length > 0 && (
                  <div className="absolute inset-0 pointer-events-none" data-testid="ws-rooms-overlay">
                    {rooms.map((r) => {
                      const bookings = roomBookingsByRoom[r.id] || [];
                      const hasBookings = bookings.length > 0;
                      return (
                        <div
                          key={r.id}
                          data-testid={`ws-room-${r.id}`}
                          className="absolute"
                          style={{
                            left: `${r.x}%`,
                            top: `${r.y}%`,
                            width: `${r.w}%`,
                            height: `${r.h}%`,
                            border: `2px solid ${hasBookings ? '#dc2626' : '#10b981'}`,
                            background: hasBookings ? 'rgba(220,38,38,0.10)' : 'rgba(16,185,129,0.06)',
                            boxSizing: 'border-box',
                            zIndex: 5,
                          }}
                        >
                          <div
                            className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-semibold pointer-events-none select-none"
                            style={{
                              background: hasBookings ? 'rgba(220,38,38,0.95)' : 'rgba(16,185,129,0.95)',
                              color: 'white',
                              maxWidth: '90%',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {r.name}{r.capacity ? ` (${r.capacity})` : ''}{hasBookings ? ` · ${bookings.length}` : ''}
                          </div>
                        </div>
                      );
                    })}
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
