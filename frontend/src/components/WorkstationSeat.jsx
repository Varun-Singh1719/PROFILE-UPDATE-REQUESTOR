import React, { useRef, useState, useLayoutEffect, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  WorkstationIconSVG,
  WORKSTATION_SEAT_CENTER,
} from './icons/workstationSilhouette';
import PersonIcon from './icons/PersonIcon';
import WorkspacesIcon from './icons/WorkspacesIcon';
import CalendarMonthIcon from './icons/CalendarMonthIcon';
import { teamSolid, paletteForTeam } from '../lib/teamColors';

// Format an ISO date string (e.g. "2026-07-03") into a compact, human friendly
// label like "Fri, 03 Jul 2026". Falls back to the raw string on parse errors.
const formatTipDate = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString(undefined, {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch {
    return String(iso);
  }
};

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
          <div
            className="relative bg-slate-900/95 backdrop-blur-sm text-white text-[12px] rounded-lg shadow-xl ring-1 ring-white/10 min-w-[180px] max-w-[260px]"
            style={{ fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}
          >
            {/* Header */}
            <div className="px-3 pt-2 pb-1.5 border-b border-white/10 flex items-center justify-between gap-2">
              <span className="font-semibold text-[13px] tracking-tight">
                Workstation {seat.label}
              </span>
              {isPending && (
                <span className="text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 ring-1 ring-amber-300/30">
                  Pending
                </span>
              )}
            </div>

            {/* Body */}
            <div className="px-3 py-2 space-y-1.5">
              {isPending && request ? (
                <>
                  <div className="flex items-center gap-2">
                    <PersonIcon size={14} color="#93c5fd" className="flex-shrink-0" />
                    <span className="truncate">{(request.employee || {}).name || '—'}</span>
                  </div>
                  {request.team_name && (
                    <div className="flex items-center gap-2">
                      <WorkspacesIcon size={14} color="#93c5fd" className="flex-shrink-0" />
                      <span className="truncate">{request.team_name}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <CalendarMonthIcon size={14} color="#93c5fd" className="flex-shrink-0" />
                    <span className="opacity-90">{formatTipDate(request.date)}</span>
                  </div>
                  <div className="text-[10.5px] text-white/60 pt-1 border-t border-white/10 mt-1.5">
                    Requested by {(request.requested_by || {}).name || '—'}
                  </div>
                </>
              ) : isOccupied && booking ? (
                <>
                  <div className="flex items-center gap-2">
                    <PersonIcon size={14} color="#93c5fd" className="flex-shrink-0" />
                    <span className="truncate">{(booking.employee || {}).name || '—'}</span>
                  </div>
                  {booking.team_name && (
                    <div className="flex items-center gap-2">
                      <WorkspacesIcon size={14} color="#93c5fd" className="flex-shrink-0" />
                      <span className="truncate">{booking.team_name}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <CalendarMonthIcon size={14} color="#93c5fd" className="flex-shrink-0" />
                    <span className="opacity-90">{formatTipDate(booking.date)}</span>
                  </div>
                  <div className="text-[10.5px] text-white/60 pt-1 border-t border-white/10 mt-1.5">
                    Click for details
                  </div>
                </>
              ) : (
                <div className="opacity-80 text-[11.5px]">
                  {isPending ? 'Pending Approval' : isSelected ? 'Selected' : 'Available'}
                </div>
              )}
            </div>

            {/* Arrow */}
            <div className="absolute left-1/2 -translate-x-1/2 -top-1 w-2 h-2 bg-slate-900/95 rotate-45 ring-1 ring-white/10 ring-b-0 ring-r-0" />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default WorkstationSeat;
