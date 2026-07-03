import React, { useRef, useState, useLayoutEffect, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  WorkstationIconSVG,
  WORKSTATION_SEAT_CENTER,
} from './icons/workstationSilhouette';
import { teamSolid, paletteForTeam } from '../lib/teamColors';

/**
 * Color-coded workstation seat used by the Workstation Booking floor map.
 *
 * Color rules (spec):
 *   White  — Available           (white fill + visible BLACK outline)
 *   Green  — Selected
 *   Grey   — Occupied / Not available
 *   Black  — Pending Approval (locked by a workstation request)
 *   Team color (from teams table) — Team-assigned (when occupied as part of a team)
 *
 * Rendering: a single inline SVG (top-down office chair) where `fill` is the
 * status color and `stroke` is black. Doing it inline (instead of via a CSS
 * mask) is what lets the Available state stay clearly visible on the white
 * floor-plan background — the black stroke draws a crisp rim around the
 * white fill.
 */

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
    ? (teamColor ? teamSolid(teamColor) : COLOR.occupied)
    : COLOR[status] || COLOR.available;
  // For team-assigned seats, render the full two-stop gradient (mirrors the
  // Teams tab's gradient chips instead of only showing the first stop as a
  // solid color).
  const gradientStops = status === "team" && teamColor ? paletteForTeam(teamColor) : null;
  const gradientId = gradientStops ? `wsg-${String(seat.id).replace(/[^a-zA-Z0-9_-]/g, "_")}` : undefined;
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
            Single inline SVG (top-down office chair) — `fill` is the state
            color and `stroke` is always black. The black stroke is what
            keeps the "Available" (white) state clearly visible against the
            white floor-plan background. The "Pending" state uses a
            near-black fill so the whole symbol reads as solid black with
            the label drawn in white on top.
        ---------------------------------------------------------------- */}
        <WorkstationIconSVG
          fill={isPending ? '#000000' : fill}
          stroke="#000000"
          strokeWidth={4}
          gradientStops={gradientStops}
          gradientId={gradientId}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            // Glow around the whole silhouette for selected / searched seats.
            filter: [
              isSelected ? 'drop-shadow(0 0 4px rgba(34,197,94,0.8))' : '',
              searchHighlight ? 'drop-shadow(0 0 5px #2563eb)' : '',
            ].filter(Boolean).join(' ') || undefined,
          }}
        />
        {/* Seat label — black on light fills; white on the black "pending"
            silhouette so the workstation number stays readable. The label
            is centred on the round seat (cx=50, cy=62 in the SVG viewBox),
            NOT on the geometric centre of the bounding box, so it sits
            squarely inside the visible seat circle.

            Font size auto-shrinks for 3+ character labels (e.g. H22, H24)
            so they fit inside the seat width instead of spilling over the
            outline. */}
        {seat.label && (() => {
          const labelLen = String(seat.label).length;
          const fontSize = labelLen >= 3
            ? Math.max(3.5, size * 0.22)
            : Math.max(4, size * 0.28);
          return (
            <div
              style={{
                position: 'absolute',
                top:  `${WORKSTATION_SEAT_CENTER.y}%`,
                left: `${WORKSTATION_SEAT_CENTER.x}%`,
                transform: `translate(-50%, -50%)`,
                fontSize: fontSize + 'px',
                fontWeight: 900,
                color: isPending ? '#FFFFFF' : '#000000',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                letterSpacing: '0.02em',
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
        {/* Selected state — visualised purely via the green fill on the chair
            SVG (status colour) plus the soft drop-shadow glow on the SVG
            silhouette. No bounding-box rectangle is drawn around the seat
            so the selection follows the chair shape exactly. */}
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
