import React from 'react';
import { SEAT_COLORS } from '../config/seatMaster';

const Seat = ({ seat, onClick, isClickable, debugMode = false }) => {
  const colors = SEAT_COLORS[seat.status];
  
  const handleClick = () => {
    if (isClickable && onClick) {
      onClick(seat.id);
    }
  };

  return (
    <div
      className="absolute group"
      style={{
        left: `${seat.x}%`,
        top: `${seat.y}%`,
        transform: 'translate(-50%, -50%)',
        cursor: isClickable ? 'pointer' : 'not-allowed',
        zIndex: 10
      }}
      onClick={handleClick}
    >
      {/* Seat Circle */}
      <div
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          backgroundColor: colors.fill,
          border: `${colors.borderWidth}px solid ${colors.border}`,
          transition: 'all 0.2s ease',
        }}
        className="hover:scale-110 shadow-sm"
      />
      
      {/* Debug Mode: Show Seat Label */}
      {debugMode && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-full mt-1
                     text-xs font-bold bg-yellow-300 px-1 rounded"
          style={{ pointerEvents: 'none' }}
        >
          {seat.label}
        </div>
      )}
      
      {/* Tooltip */}
      {!debugMode && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-full mt-2 
                     opacity-0 group-hover:opacity-100 transition-opacity
                     bg-gray-900 text-white text-xs rounded px-2 py-1 
                     whitespace-nowrap pointer-events-none z-50"
        >
          <div>Seat: {seat.label}</div>
          <div>Status: {seat.status.charAt(0).toUpperCase() + seat.status.slice(1)}</div>
          <div 
            className="absolute left-1/2 -translate-x-1/2 -top-1 
                       w-2 h-2 bg-gray-900 rotate-45"
          />
        </div>
      )}
    </div>
  );
};

export default Seat;
