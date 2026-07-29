import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import WorkstationSeat from './WorkstationSeat';
import { RoomBoxLabel } from '../pages/MeetingRoomBookingPage';
import { resolvePdfUrl } from '../lib/pdfUrl';
import ZoomIn from "@mui/icons-material/ZoomIn";
import ZoomOut from "@mui/icons-material/ZoomOut";
import Maximize2 from "@mui/icons-material/OpenInFull";
import Search from "@mui/icons-material/SearchOutlined";
import X from "@mui/icons-material/Close";
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
 * centerOnRoomId      — when set, pan + zoom to the meeting room with matching id
 *                       (used by Pending Approvals card → focus meeting room).
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
  centerOnRoomId = null,
  highlightRoomId = null,
  rooms = [],
  roomBookingsByRoom = {},
  // Optional map of room_id → currently-active booking (a booking whose
  // [start_at, end_at] spans "now"). When provided, room boxes are colored
  // RED only for rooms currently occupied at the present moment (rather than
  // "has any booking today"). Rooms with no active booking right now render
  // GREEN, even if they have earlier/later bookings on the same date.
  roomOccupiedNowByRoom = null,
  // Optional callback fired when the user clicks a meeting-room box on the
  // floor. Signature: `(room, bookingsForThatRoom) => void`. When provided,
  // room boxes render with a pointer cursor so their affordance is clear.
  onRoomClick,
  // Floor Layout view — only shows Available / Pending Approval / Teams
  legendPreset,
  // Multi-seat zoom target: when a single team filter is active, the parent
  // passes the seat ids for that team and we pan+zoom to their bounding box.
  zoomToSeatIds = null,
  // Dims (opacity) any seat NOT in this set (used by the team filter to keep
  // context but visually highlight the selected team's seats).
  dimSeatsNotIn = null,
}) => {
  const [pageWidth] = useState(1200);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pdfReady, setPdfReady] = useState(false);
  const [focusFlashSeatId, setFocusFlashSeatId] = useState(null);
  // Current zoom scale of the TransformComponent — used by RoomBoxLabel to
  // keep the room name/seats text a consistent on-screen size regardless
  // of how far the user has zoomed in.
  const [scale, setScale] = useState(1);
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

  // Pan + zoom to a specific meeting room when `centerOnRoomId` changes.
  // Used by the Pending Approvals page so we don't have to swap in a
  // separate meeting-room map component — the workstation map already
  // renders both seats and rooms on the same PDF; here we just shift the
  // camera between them.
  useEffect(() => {
    if (!centerOnRoomId || !pdfReady) return;
    const id = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-testid="ws-room-${centerOnRoomId}"]`);
      if (el && transformRef.current && transformRef.current.zoomToElement) {
        try {
          transformRef.current.zoomToElement(el, 1.8, 450, 'easeOut');
        } catch {
          /* ignore — library version safety */
        }
      }
    });
    return () => cancelAnimationFrame(id);
  }, [centerOnRoomId, pdfReady]);

  // Bounding box of team-filtered seats — computed as %s so we can render a
  // hidden anchor element inside the transform and call zoomToElement on it.
  const zoomBBox = useMemo(() => {
    if (!zoomToSeatIds || zoomToSeatIds.length === 0) return null;
    const set = new Set(zoomToSeatIds);
    const pts = seats.filter((s) => set.has(s.id));
    if (pts.length === 0) return null;
    const xs = pts.map((s) => s.x);
    const ys = pts.map((s) => s.y);
    const sizePct = 6; // seats occupy ~6% width visually; pad the bbox by half
    const minX = Math.max(0, Math.min(...xs) - sizePct / 2);
    const maxX = Math.min(100, Math.max(...xs) + sizePct / 2);
    const minY = Math.max(0, Math.min(...ys) - sizePct / 2);
    const maxY = Math.min(100, Math.max(...ys) + sizePct / 2);
    return { minX, maxX, minY, maxY };
  }, [zoomToSeatIds, seats]);

  const bboxAnchorRef = useRef(null);

  // Pan + zoom to the bbox anchor whenever the filtered team's seat set
  // changes (single-team filter). Uses a stable key from seat ids so we don't
  // re-zoom when the parent recomputes arrays with identical content.
  const zoomKey = useMemo(
    () => (zoomToSeatIds ? [...zoomToSeatIds].sort().join(",") : ""),
    [zoomToSeatIds],
  );
  useEffect(() => {
    if (!zoomBBox || !pdfReady || !bboxAnchorRef.current) return;
    const raf = requestAnimationFrame(() => {
      try {
        transformRef.current?.zoomToElement?.(bboxAnchorRef.current, undefined, 500, 'easeOut');
      } catch {
        /* ignore */
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [zoomKey, zoomBBox, pdfReady]);

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
        onTransformed={(_ref, state) => setScale(state?.scale || 1)}
      >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            {/* Top-left search + legend */}
            <div className="absolute top-4 left-4 z-20 flex flex-col gap-3" data-testid="ws-map-toolbar">
              {legendPreset !== "floor-layout" && (
                <>
                  <div className="bg-white rounded-lg shadow-lg p-2 flex items-center gap-2 w-64">
                    <Search sx={{ fontSize: 16 }} className="text-gray-400 flex-none"/>
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
                        <X sx={{ fontSize: 14 }}/>
                      </button>
                    )}
                  </div>
                  {debouncedSearch && (
                    <div className="bg-white rounded-md shadow px-2 py-1 text-[11px] text-gray-600 w-64">
                      {matchCount > 0 ? `${matchCount} match${matchCount > 1 ? 'es' : ''}` : 'No matches'}
                    </div>
                  )}
                </>
              )}

              <div className="bg-white rounded-lg shadow-lg p-3" data-testid="ws-map-legend">
                <h3 className="font-semibold text-xs mb-2 text-gray-700">Legend</h3>
                <div className="flex flex-col gap-1.5 text-[11px]">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-white border-2 border-black" />
                    <span>Available</span>
                  </div>
                  {legendPreset !== "floor-layout" && (
                    <>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-sm bg-[#22C55E]" />
                        <span>Selected</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-sm bg-gray-400" />
                        <span>Occupied</span>
                      </div>
                    </>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm bg-[#111111]" />
                    <span>Pending Approval</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-sm" style={{ background: 'linear-gradient(45deg, #6366F1 50%, #F59E0B 50%)' }} />
                    <span>{legendPreset === "floor-layout" ? "Teams" : "Team-assigned"}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Top-right zoom controls */}
            <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
              <button onClick={() => zoomIn(0.25, 250, 'easeOut')} className="p-3 bg-white rounded-lg shadow-lg hover:bg-gray-50" title="Zoom In" data-testid="ws-zoom-in">
                <ZoomIn sx={{ fontSize: 20 }}/>
              </button>
              <button onClick={() => zoomOut(0.25, 250, 'easeOut')} className="p-3 bg-white rounded-lg shadow-lg hover:bg-gray-50" title="Zoom Out" data-testid="ws-zoom-out">
                <ZoomOut sx={{ fontSize: 20 }}/>
              </button>
              <button onClick={() => resetTransform(300, 'easeOut')} className="p-3 bg-white rounded-lg shadow-lg hover:bg-gray-50" title="Reset Zoom" data-testid="ws-zoom-reset">
                <Maximize2 sx={{ fontSize: 20 }}/>
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
                      {enrichedSeats.map((seat) => {
                        const dimmed = dimSeatsNotIn && !dimSeatsNotIn.has(seat.id);
                        return (
                          <div
                            key={seat.id}
                            style={{ opacity: dimmed ? 0.25 : 1, transition: 'opacity 250ms' }}
                          >
                            <WorkstationSeat
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
                          </div>
                        );
                      })}
                      {/* Invisible anchor for team-filter zoom-to-bbox */}
                      {zoomBBox && (
                        <div
                          ref={bboxAnchorRef}
                          aria-hidden="true"
                          style={{
                            position: 'absolute',
                            left: `${zoomBBox.minX}%`,
                            top: `${zoomBBox.minY}%`,
                            width: `${Math.max(0.5, zoomBBox.maxX - zoomBBox.minX)}%`,
                            height: `${Math.max(0.5, zoomBBox.maxY - zoomBBox.minY)}%`,
                            pointerEvents: 'none',
                          }}
                          data-testid="ws-map-zoom-anchor"
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* Meeting rooms overlay (rendered inside the transform so it pans/zooms with the PDF) */}
                {pdfReady && rooms && rooms.length > 0 && (
                  <div className="absolute inset-0 pointer-events-none" data-testid="ws-rooms-overlay">
                    {rooms.map((r) => {
                      const bookings = roomBookingsByRoom[r.id] || [];
                      const hasBookings = bookings.length > 0;
                      // When a `roomOccupiedNowByRoom` map is provided, use
                      // current-time occupancy (RED only if a booking is
                      // running RIGHT NOW). Otherwise fall back to the legacy
                      // "has any booking on this date" behavior so callers
                      // that don't opt-in remain unchanged.
                      const activeNowBooking = roomOccupiedNowByRoom
                        ? (roomOccupiedNowByRoom[r.id] || null)
                        : null;
                      const isOccupiedNow = roomOccupiedNowByRoom
                        ? Boolean(activeNowBooking)
                        : hasBookings;
                      const isHighlighted = highlightRoomId && r.id === highlightRoomId;
                      // Highlighted (currently-focused via approval card) wins
                      // over booking/available colours to make the focus obvious.
                      const borderColor = isHighlighted ? '#ec9324' : (isOccupiedNow ? '#dc2626' : '#10b981');
                      const bg = isHighlighted
                        ? 'rgba(236,147,36,0.28)'
                        : (isOccupiedNow ? 'rgba(220,38,38,0.10)' : 'rgba(16,185,129,0.06)');
                      const labelBg = isHighlighted
                        ? 'rgba(236,147,36,0.95)'
                        : (isOccupiedNow ? 'rgba(220,38,38,0.95)' : 'rgba(16,185,129,0.95)');
                      // Shape the room object for RoomBoxLabel — it expects
                      // `{ room_id, name, capacity }` (label uses name + seats
                      // and the tooltip uses `room.name`).
                      const roomForLabel = { room_id: r.id, name: r.name, capacity: r.capacity };
                      // Prefer the currently-running booking for the hover
                      // tooltip (so users see WHY it is red right now). When
                      // the room is Available, DO NOT show upcoming meeting
                      // details in the hover — only reveal them on click.
                      const hoverBooking = activeNowBooking || null;
                      return (
                        <div
                          key={r.id}
                          data-testid={`ws-room-${r.id}`}
                          className={`absolute group${onRoomClick ? " cursor-pointer" : ""}`}
                          onClick={onRoomClick ? (e) => { e.stopPropagation(); onRoomClick(r, bookings); } : undefined}
                          role={onRoomClick ? "button" : undefined}
                          tabIndex={onRoomClick ? 0 : undefined}
                          onKeyDown={onRoomClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRoomClick(r, bookings); } } : undefined}
                          title={onRoomClick ? `${r.name || "Meeting Room"} — click for bookings` : undefined}
                          style={{
                            left: `${r.x}%`,
                            top: `${r.y}%`,
                            width: `${r.w}%`,
                            height: `${r.h}%`,
                            border: `2px solid ${borderColor}`,
                            background: bg,
                            boxSizing: 'border-box',
                            zIndex: isHighlighted ? 6 : 5,
                            transition: 'background 200ms, border-color 200ms',
                            pointerEvents: 'auto',
                          }}
                        >
                          <RoomBoxLabel
                            room={roomForLabel}
                            scale={scale}
                            labelBg={labelBg}
                            occupiedNow={isOccupiedNow}
                            blocked={false}
                            hoverBooking={hoverBooking}
                          />
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
