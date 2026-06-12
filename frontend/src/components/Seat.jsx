import React from 'react';
import {
  WorkstationIconSVG,
  WORKSTATION_SEAT_CENTER,
} from './icons/workstationSilhouette';

/**
 * Floor-layout view seat. Uses the shared top-down office-chair silhouette
 * so this view stays visually identical to the calibration screen.
 *
 * Color rules (inline SVG fill/stroke):
 *   Available  →  white fill + black outline   (visible on white floor plan)
 *   Selected   →  green fill + black outline   + green selection ring
 *   Occupied   →  grey  fill + black outline   (slightly dimmed)
 *
 * The label sits on the center of the round seat (not the geometric centre
 * of the bounding box) and is rendered bold.
 */
const Seat = ({ seat, onClick, isClickable, debugMode = false, isSelected = false, isOccupied = false }) => {
  const handleClick = () => {
    if (isClickable && onClick) onClick(seat.id);
  };

  const size = seat.size || 10;
  const rotation = seat.rotation || 0;

  // Fill & glow per state
  const fill =
    isSelected ? '#22C55E' :
    isOccupied ? '#B2B2B2' : '#FFFFFF';
  const glow =
    isSelected ? 'drop-shadow(0 0 4px #15B867)' :
    isOccupied ? 'drop-shadow(0 0 3px #b2b2b2)' : 'none';

  // Label font size — auto-shrink for 3+ chars
  const labelLen = seat.label ? String(seat.label).length : 0;
  const fontSize = labelLen >= 3
    ? Math.max(3.5, size * 0.22)
    : Math.max(4, size * 0.28);

  return (
    <div
      className="absolute group"
      style={{
        left: `${seat.x}%`,
        top:  `${seat.y}%`,
        transform: 'translate(-50%, -50%)',
        cursor: isClickable ? 'pointer' : 'not-allowed',
        zIndex: 10,
      }}
      onClick={handleClick}
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
        <WorkstationIconSVG
          fill={fill}
          stroke="#000000"
          strokeWidth={4}
          style={{
            width: '100%',
            height: '100%',
            filter: glow,
            opacity: isOccupied ? 0.8 : 1,
          }}
        />
        {/* Workstation label — centred on the round seat (not the bbox) */}
        {seat.label && (
          <div
            style={{
              position: 'absolute',
              top:  `${WORKSTATION_SEAT_CENTER.y}%`,
              left: `${WORKSTATION_SEAT_CENTER.x}%`,
              transform: `translate(-50%, -50%) rotate(${-rotation}deg)`,
              fontSize: fontSize + 'px',
              fontWeight: 900,
              color: '#000',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              letterSpacing: '0.02em',
              zIndex: 10,
            }}
          >
            {seat.label}
          </div>
        )}
        {/* Selection ring */}
        {isSelected && (
          <div
            style={{
              position: 'absolute',
              inset: -2,
              border: '2px solid #15B867',
              borderRadius: '4px',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      {/* Debug Mode: Show Seat Label below */}
      {debugMode && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-full mt-1 text-xs font-bold bg-yellow-300 px-1 rounded"
          style={{ pointerEvents: 'none' }}
        >
          {seat.label}
        </div>
      )}

      {/* Tooltip on hover */}
      {!debugMode && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-full mt-2
                     opacity-0 group-hover:opacity-100 transition-opacity
                     bg-gray-900 text-white text-xs rounded px-2 py-1
                     whitespace-nowrap pointer-events-none z-50"
        >
          <div>Seat: {seat.label}</div>
          <div>Status: {isOccupied ? 'Occupied' : isSelected ? 'Selected' : 'Available'}</div>
          <div className="absolute left-1/2 -translate-x-1/2 -top-1 w-2 h-2 bg-gray-900 rotate-45" />
        </div>
      )}
    </div>
  );
};

export default Seat;
