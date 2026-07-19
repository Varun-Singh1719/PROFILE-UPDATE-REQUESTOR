/**
 * MySeatMiniMap — a small, static thumbnail of the user's floor plan zoomed
 * around their allotted seat. Rendered inside the "My Seat Today" hero card.
 *
 * We do NOT render the PDF (would be too heavy for a thumbnail) — instead we
 * render seat coordinates as an SVG grid, cropping the view around the user's
 * seat. The user seat pulses in red; other seats around it are rendered as
 * neutral dots so the layout gives spatial context.
 */
import React from "react";
import MapPin from "@mui/icons-material/PlaceOutlined";

const PADDING = 220; // world units to show around the user seat

export default function MySeatMiniMap({ mySeat, allSeats = [], onClick }) {
  const anchor = mySeat?.seat;
  if (!anchor || typeof anchor.x !== "number" || typeof anchor.y !== "number") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="h-40 w-56 rounded-xl border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-xs text-gray-400 hover:border-[#ec9324] hover:text-[#ec9324] transition"
        data-testid="my-seat-mini-map-empty"
      >
        <MapPin sx={{ fontSize: 16 }} className="mr-1.5"/> View floor plan
      </button>
    );
  }

  const minX = anchor.x - PADDING;
  const minY = anchor.y - PADDING;
  const w = PADDING * 2;
  const h = PADDING * 2;

  // Filter seats visible in the crop
  const visible = (allSeats || []).filter(
    (s) => s.x >= minX && s.x <= minX + w && s.y >= minY && s.y <= minY + h,
  );

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative h-40 w-56 rounded-xl overflow-hidden border border-gray-200 bg-gradient-to-br from-slate-50 to-white hover:border-[#ec9324] hover:shadow-md transition-all"
      data-testid="my-seat-mini-map"
      aria-label="Open floor plan popup"
      title="Click to see full floor plan"
    >
      <svg viewBox={`${minX} ${minY} ${w} ${h}`} className="w-full h-full">
        {/* faint dot grid for texture */}
        <defs>
          <pattern id="dots" patternUnits="userSpaceOnUse" width="24" height="24">
            <circle cx="1" cy="1" r="0.7" fill="#e5e7eb" />
          </pattern>
        </defs>
        <rect x={minX} y={minY} width={w} height={h} fill="url(#dots)" />

        {/* other seats around */}
        {visible.map((s) =>
          s.id === anchor.id ? null : (
            <rect
              key={s.id}
              x={s.x - 8}
              y={s.y - 8}
              width={16}
              height={16}
              rx={3}
              fill="#e5e7eb"
              stroke="#cbd5e1"
              strokeWidth="0.5"
            />
          ),
        )}

        {/* user seat — big red pin */}
        <g>
          <circle
            cx={anchor.x}
            cy={anchor.y}
            r="14"
            fill="none"
            stroke="#dc2626"
            strokeWidth="1.5"
            opacity="0.4"
          >
            <animate attributeName="r" from="12" to="28" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" from="0.5" to="0" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <rect
            x={anchor.x - 12}
            y={anchor.y - 12}
            width={24}
            height={24}
            rx={5}
            fill="#dc2626"
            stroke="#ffffff"
            strokeWidth={2}
          />
          <text
            x={anchor.x}
            y={anchor.y + 3}
            textAnchor="middle"
            fill="#ffffff"
            fontSize="8"
            fontWeight="900"
            fontFamily="Inter, system-ui, sans-serif"
          >
            {(mySeat?.seat_label || "").slice(0, 4)}
          </text>
        </g>
      </svg>
      <div className="absolute bottom-1.5 right-1.5 text-[9px] font-semibold text-gray-600 bg-white/85 px-1.5 py-0.5 rounded shadow-sm">
        {mySeat?.plan_name || "Floor plan"}
      </div>
      <div className="absolute inset-0 bg-[#ec9324]/0 group-hover:bg-[#ec9324]/5 transition-colors" />
    </button>
  );
}
