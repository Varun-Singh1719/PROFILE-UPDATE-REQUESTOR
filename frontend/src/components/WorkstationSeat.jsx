import React from 'react';

/**
 * Color-coded workstation seat used by the Workstation Booking floor map.
 *
 * Color rules (spec):
 *   White  — Available
 *   Orange — Selected
 *   Grey   — Occupied / Not available
 *   Team color (from teams table) — Team-assigned (when occupied as part of a team)
 *
 * Rendering trick: we use the same workstation PNG that calibration uses, but
 * load it as a CSS `mask-image` so the silhouette can be tinted to any color.
 * This keeps the recognisable workstation shape while honoring the new palette.
 */
const SEAT_PNG = "https://customer-assets.emergentagent.com/job_workspace-manager-19/artifacts/96yixbn4_pngegg.png";

const COLOR = {
  available: "#FFFFFF",
  selected:  "#22C55E", // green — used as the "selected" indicator per UX update
  occupied:  "#9CA3AF", // grey-400
};

const WorkstationSeat = ({
  seat,
  status = "available",   // 'available' | 'selected' | 'occupied' | 'team'
  teamColor,              // hex, only when status === 'team'
  booking,                // optional booking object for the tooltip (when occupied/team)
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
  const isSelected = status === "selected";

  const handleClick = (e) => {
    e.stopPropagation();
    if (!isClickable) return;
    if (isOccupied && onOccupiedClick) {
      onOccupiedClick(seat, booking);
      return;
    }
    if (!isOccupied && onClick) onClick(seat.id);
  };

  return (
    <div
      className="absolute group"
      style={{
        left: `${seat.x}%`,
        top: `${seat.y}%`,
        transform: 'translate(-50%, -50%)',
        cursor: isClickable ? (isOccupied ? 'help' : 'pointer') : 'not-allowed',
        zIndex: 10,
      }}
      onClick={handleClick}
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
        {/* Black outline silhouette (scaled slightly larger than the fill so it
            peeks out around the edge — produces a guaranteed-visible black border
            around the workstation shape, regardless of fill colour). */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: '#000',
            transform: 'scale(1.18)',
            transformOrigin: 'center',
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
        {/* Coloured fill silhouette on top — the visible workstation colour. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: fill,
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
        {/* Seat label — always black, regardless of fill colour */}
        {seat.label && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              fontSize: Math.max(3, size * 0.25) + 'px',
              fontWeight: 'bold',
              color: '#000000',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              textShadow: '0 0 2px #ffffff, 0 0 2px #ffffff',
              zIndex: 10,
            }}
          >
            {seat.label}
          </div>
        )}
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

      {/* Hover tooltip — Workstation X + employee/team/date when occupied */}
      <div
        className="absolute left-1/2 -translate-x-1/2 top-full mt-2
                   opacity-0 group-hover:opacity-100 transition-opacity
                   bg-gray-900 text-white text-[11px] rounded-md px-2 py-1.5
                   whitespace-nowrap pointer-events-none z-50 shadow-lg"
      >
        <div className="font-semibold">Workstation {seat.label}</div>
        {isOccupied && booking ? (
          <>
            <div>👤 {(booking.employee || {}).name || '—'}</div>
            {booking.team_name && <div>👥 {booking.team_name}</div>}
            <div className="opacity-80">📅 {booking.date}</div>
            <div className="opacity-60 italic text-[10px] mt-0.5">Click for details</div>
          </>
        ) : (
          <div className="opacity-80">{isSelected ? 'Selected' : 'Available'}</div>
        )}
        <div className="absolute left-1/2 -translate-x-1/2 -top-1 w-2 h-2 bg-gray-900 rotate-45" />
      </div>
    </div>
  );
};

export default WorkstationSeat;
