import React from 'react';
import { WORKSTATION_MASK_URL } from './icons/workstationSilhouette';

// Use the shared solid top-down workstation silhouette so the Floor Layout /
// Calibration view stays visually identical to the Booking / Request views.
const SEAT_PNG = WORKSTATION_MASK_URL;

const Seat = ({ seat, onClick, isClickable, debugMode = false, isSelected = false, isOccupied = false }) => {
  const handleClick = () => {
    if (isClickable && onClick) onClick(seat.id);
  };

  const size = seat.size || 10; // px at unscaled zoom, scales with TransformWrapper
  const rotation = seat.rotation || 0;

  // State styling — brand tokens
  // Selected → green glow (#15B867), Occupied → grey overlay (#b2b2b2), Available → orange tint accent
  const glow = isSelected
    ? 'drop-shadow(0 0 4px #15B867)'
    : isOccupied
      ? 'drop-shadow(0 0 3px #b2b2b2)'
      : 'none';

  return (
    <div
      className="absolute group"
      style={{
        left: `${seat.x}%`,
        top: `${seat.y}%`,
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
        <img
          src={SEAT_PNG}
          alt="seat"
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            filter: glow,
            opacity: isOccupied ? 0.55 : 1,
          }}
        />
        {/* Seat label centered on top of the icon */}
        {seat.label && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              fontSize: Math.max(3, size * 0.25) + 'px',
              fontWeight: 'bold',
              color: '#000',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              textShadow: '0 0 3px white, 0 0 3px white, 0 0 3px white',
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
