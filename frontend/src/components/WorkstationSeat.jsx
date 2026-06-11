import React, { useRef, useState, useLayoutEffect, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { WORKSTATION_MASK_URL } from './icons/workstationSilhouette';

/**
 * Color-coded workstation seat used by the Workstation Booking floor map.
 *
 * Color rules (spec):
 *   White  — Available
 *   Green  — Selected
 *   Grey   — Occupied / Not available
 *   Black  — Pending Approval (locked by a workstation request)
 *   Team color (from teams table) — Team-assigned (when occupied as part of a team)
 *
 * Rendering trick: we render a single SOLID top-down workstation silhouette
 * (see `icons/workstationSilhouette.js`) as a CSS `mask-image`. Because the
 * silhouette is fully filled (not just an outline), the whole workstation
 * shape can be tinted to any color we want — including pure black for the
 * Pending Approval state.
 */
const SEAT_PNG = WORKSTATION_MASK_URL;

const COLOR = {
  available: "#FFFFFF",
  selected:  "#22C55E", // green — used as the "selected" indicator per UX update
  occupied:  "#9CA3AF", // grey-400
  pending:   "#111111", // near-black — locked by a pending workstation request
};

const WorkstationSeat = ({
  seat,
  status = "available",   // 'available' | 'selected' | 'occupied' | 'team' | 'pending'
  teamColor,              // hex, only when status === 'team'
  booking,                // optional booking object for the tooltip (when occupied/team)
  request,                // optional request object for the tooltip (when pending)
  onClick,
  onOccupiedClick,
  isClickable = true,
  searchHighlight = false,
}) => {
  const size = seat.size || 10;
  const rotation = seat.rotation || 0;
  const fill = status === "team"
    ? (teamColor || COLOR.occupied)
    : COLOR[status] || COLOR.available;
  const isOccupied = status === "occupied" || status === "team";
  const isPending = status === "pending";
  const isSelected = status === "selected";

  // -----------------------------------------------------------------
  // Hover tooltip — rendered via a portal into document.body so it
  // (a) sits on top of every other seat regardless of stacking order
  // (b) keeps a constant on-screen size, immune to the floor-map zoom.
  // -----------------------------------------------------------------
  const seatRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [tipPos, setTipPos] = useState(null);

  const updateTipPos = useCallback(() => {
    const el = seatRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTipPos({
      left: r.left + r.width / 2,
      top: r.bottom + 8,
    });
  }, []);

  useLayoutEffect(() => {
    if (!hovered) return;
    updateTipPos();
    const handler = () => updateTipPos();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    // The zoom-pan-pinch container animates transforms, so re-measure on rAF
    // for a couple of frames to stay in sync if a zoom is in progress.
    let raf = 0;
    let ticks = 0;
    const loop = () => {
      updateTipPos();
      ticks += 1;
      if (ticks < 8) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
      cancelAnimationFrame(raf);
    };
  }, [hovered, updateTipPos]);

  // Hide tooltip if the seat unmounts while hovered
  useEffect(() => () => setHovered(false), []);

  const handleClick = (e) => {
    e.stopPropagation();
    if (!isClickable) return;
    if (isPending && onOccupiedClick) {
      // Pending seats are locked but clicking shows details (passing request as 2nd arg)
      onOccupiedClick(seat, request || booking);
      return;
    }
    if (isOccupied && onOccupiedClick) {
      onOccupiedClick(seat, booking);
      return;
    }
    if (!isOccupied && !isPending && onClick) onClick(seat.id);
  };

  return (
    <div
      ref={seatRef}
      className="absolute"
      style={{
        left: `${seat.x}%`,
        top: `${seat.y}%`,
        transform: 'translate(-50%, -50%)',
        cursor: isClickable ? ((isOccupied || isPending) ? 'help' : 'pointer') : 'not-allowed',
        zIndex: hovered ? 50 : 10,
      }}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid={`ws-seat-${seat.id}`}
      data-status={status}
    >
      <div
        style={{
          width: size,
          height: size,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `rotate(${rotation}deg)`,
          transition: 'transform .15s ease',
        }}
      >
        {/* ----------------------------------------------------------------
            All seat states render the same chair silhouette so the on-floor
            footprint stays identical to the Floor Layout view.
              • Outer layer: black silhouette at scale 1.0 (the outline rim)
              • Inner layer: fill-coloured silhouette at scale 0.86
            For Pending Approval the fill is pure black, so the entire chair
            silhouette appears solid black with the workstation label in white.
        ---------------------------------------------------------------- */}
        {/* Black outline silhouette — kept at the exact same size as the
            calibrated <img> in Seat.jsx so the on-floor footprint matches the
            Floor Layout view 1:1. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: '#000',
            WebkitMaskImage: `url(${SEAT_PNG})`,
            WebkitMaskRepeat: 'no-repeat',
            WebkitMaskSize: 'contain',
            WebkitMaskPosition: 'center',
            maskImage: `url(${SEAT_PNG})`,
            maskRepeat: 'no-repeat',
            maskSize: 'contain',
            maskPosition: 'center',
            // Outer glow for selected / search-highlighted seats sits on the
            // outline layer so it surrounds the entire seat shape.
            filter: [
              isSelected ? 'drop-shadow(0 0 4px rgba(34,197,94,0.8))' : '',
              searchHighlight ? 'drop-shadow(0 0 5px #2563eb)' : '',
            ].filter(Boolean).join(' '),
          }}
        />
        {/* Coloured fill silhouette — shrunk to ~0.86 so the black outline
            below peeks around it as a crisp rim. The overall visible
            footprint stays at `size × size`, matching calibration exactly.
            For pending state the fill is pure black so the whole chair
            silhouette ends up solid black. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: isPending ? '#000000' : fill,
            transform: 'scale(0.86)',
            transformOrigin: 'center',
            WebkitMaskImage: `url(${SEAT_PNG})`,
            WebkitMaskRepeat: 'no-repeat',
            WebkitMaskSize: 'contain',
            WebkitMaskPosition: 'center',
            maskImage: `url(${SEAT_PNG})`,
            maskRepeat: 'no-repeat',
            maskSize: 'contain',
            maskPosition: 'center',
          }}
        />
        {/* Seat label — black on light fills; white on the black "pending"
            silhouette so the workstation number stays readable. The label is
            centred on the chair body (≈69% down the silhouette viewBox), not
            on the geometric centre of the bounding box, so it sits squarely
            inside the visible chair area rather than floating over the
            backrest connector.

            Font size auto-shrinks for 3+ character labels (e.g. H22, H24) so
            they fit inside the chair body width instead of spilling over the
            outline. */}
        {seat.label && (() => {
          const labelLen = String(seat.label).length;
          const fontSize = labelLen >= 3
            ? Math.max(3.5, size * 0.18)
            : Math.max(4, size * 0.22);
          return (
            <div
              style={{
                position: 'absolute',
                top: '69%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: fontSize + 'px',
                fontWeight: 900,
                color: isPending ? '#FFFFFF' : '#000000',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                textShadow: isPending
                  ? '0 0 2px #000000, 0 0 2px #000000'
                  : '0 0 2px #ffffff, 0 0 2px #ffffff',
                zIndex: 10,
              }}
            >
              {seat.label}
            </div>
          );
        })()}
        {/* Search highlight ring */}
        {searchHighlight && (
          <div
            style={{
              position: 'absolute',
              inset: -3,
              border: '2px solid #2563eb',
              borderRadius: '6px',
              animation: 'ws-pulse 1.2s ease-in-out infinite',
              pointerEvents: 'none',
            }}
          />
        )}
        {/* Selected ring */}
        {isSelected && (
          <div
            style={{
              position: 'absolute',
              inset: -2,
              border: '2px solid #22C55E',
              borderRadius: '4px',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      {/* Hover tooltip — Workstation X + employee/team/date when occupied.
          Rendered via a portal to document.body so it sits above every other
          seat (no z-index battles inside the transformed map) and keeps a
          constant on-screen size regardless of the floor-map zoom level. */}
      {hovered && tipPos && createPortal(
        <div
          style={{
            position: 'fixed',
            left: tipPos.left,
            top: tipPos.top,
            transform: 'translateX(-50%)',
            zIndex: 9999,
            pointerEvents: 'none',
          }}
        >
          <div className="relative bg-gray-900 text-white text-[11px] rounded-md px-2 py-1.5 whitespace-nowrap shadow-lg">
            <div className="font-semibold">Workstation {seat.label}</div>
            {isPending && request ? (
              <>
                <div>⏳ <span className="font-semibold">Pending Approval</span></div>
                <div>👤 {(request.employee || {}).name || '—'}</div>
                {request.team_name && <div>👥 {request.team_name}</div>}
                <div className="opacity-80">📅 {request.date}</div>
                <div className="opacity-60 italic text-[10px] mt-0.5">
                  Requested by {(request.requested_by || {}).name || '—'}
                </div>
              </>
            ) : isOccupied && booking ? (
              <>
                <div>👤 {(booking.employee || {}).name || '—'}</div>
                {booking.team_name && <div>👥 {booking.team_name}</div>}
                <div className="opacity-80">📅 {booking.date}</div>
                <div className="opacity-60 italic text-[10px] mt-0.5">Click for details</div>
              </>
            ) : (
              <div className="opacity-80">
                {isPending ? 'Pending Approval' : isSelected ? 'Selected' : 'Available'}
              </div>
            )}
            <div className="absolute left-1/2 -translate-x-1/2 -top-1 w-2 h-2 bg-gray-900 rotate-45" />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default WorkstationSeat;
