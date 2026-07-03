/**
 * Workstation silhouette — Option 2 "Office Chair (top-down)".
 *
 * Top-down view of an office chair with:
 *   • Curved backrest at the top
 *   • Two small armrest stubs on either side
 *   • Round seat as the main body (where the label sits)
 *
 * IMPORTANT design choices:
 *   1. Rendered as inline SVG (not a mask) so we can paint a real
 *      `stroke="#000"` outline around any fill color. Required so that
 *      the "Available" state (white fill) is still clearly visible on a
 *      white floor-plan background.
 *   2. ViewBox is 100×100 (square) so the icon fits a square grid cell
 *      cleanly without leaving vertical dead-space like the old icon did.
 *   3. The exact center of the round seat (cx=50, cy=62) is exported as
 *      `WORKSTATION_SEAT_CENTER` so every consumer can position the
 *      workstation label (A1 / E5 / F2 / etc.) on the seat itself rather
 *      than the geometric center of the bounding box.
 */
import React from 'react';

// viewBox and key anchor points
export const WORKSTATION_VIEWBOX = '0 0 100 100';

/**
 * Center of the round seat in viewBox coordinates (0..100).
 * Use as a percentage to place the label CSS-side, e.g.
 *   top:  `${WORKSTATION_SEAT_CENTER.y}%`
 *   left: `${WORKSTATION_SEAT_CENTER.x}%`
 */
export const WORKSTATION_SEAT_CENTER = { x: 50, y: 62 };

/**
 * The chair as a React fragment of SVG primitives.
 * Caller supplies `fill`, `stroke`, and `strokeWidth`.
 *
 * Drawn back-to-front so the round seat overlaps the armrests + backrest
 * — the shared `fill` color hides the internal seams, producing a clean
 * single-silhouette outline.
 */
export const WorkstationShape = ({
  fill = '#FFFFFF',
  stroke = '#000000',
  strokeWidth = 4,
}) => (
  <g
    fill={fill}
    stroke={stroke}
    strokeWidth={strokeWidth}
    strokeLinejoin="round"
    strokeLinecap="round"
  >
    {/* Left armrest stub */}
    <rect x="13" y="46" width="9" height="24" rx="3.5" />
    {/* Right armrest stub */}
    <rect x="78" y="46" width="9" height="24" rx="3.5" />
    {/* Curved backrest (above the seat) */}
    <path d="M 18 32 Q 50 10 82 32 L 76 42 Q 50 24 24 42 Z" />
    {/* Round seat (on top so internal seams disappear) */}
    <circle cx="50" cy="62" r="26" />
  </g>
);

/**
 * Full standalone SVG string for the chair — used in the few places that
 * still need a `data:` URL (e.g. CSS background, image fallback).
 * Defaults to a solid black silhouette for backwards compatibility with
 * the previous mask-image API.
 */
export function buildWorkstationSVG({
  fill = '#000000',
  stroke = 'none',
  strokeWidth = 0,
} = {}) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + WORKSTATION_VIEWBOX + '">' +
      '<g fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" stroke-linejoin="round" stroke-linecap="round">' +
        '<rect x="13" y="46" width="9" height="24" rx="3.5"/>' +
        '<rect x="78" y="46" width="9" height="24" rx="3.5"/>' +
        '<path d="M 18 32 Q 50 10 82 32 L 76 42 Q 50 24 24 42 Z"/>' +
        '<circle cx="50" cy="62" r="26"/>' +
      '</g>' +
    '</svg>'
  );
}

// Backward-compatible exports (kept so legacy imports keep working).
export const WORKSTATION_SVG = buildWorkstationSVG({ fill: '#000' });
export const WORKSTATION_MASK_URL =
  'data:image/svg+xml;utf8,' + encodeURIComponent(WORKSTATION_SVG);

/**
 * Convenience wrapper: a complete <svg> for the chair, ready to drop
 * into a flex/absolute container. Caller controls fill/stroke.
 *
 * Pass `gradientStops=[colorA, colorB]` + a unique `gradientId` to render
 * the silhouette with a linear-gradient fill (used to mirror the Teams tab's
 * gradient chips on team-assigned workstations).
 */
export const WorkstationIconSVG = ({
  fill = '#FFFFFF',
  stroke = '#000000',
  strokeWidth = 4,
  gradientStops,
  gradientId,
  style,
  className,
}) => {
  const useGradient = Array.isArray(gradientStops) && gradientStops.length >= 2 && !!gradientId;
  const actualFill = useGradient ? `url(#${gradientId})` : fill;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={WORKSTATION_VIEWBOX}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={style}
      className={className}
      shapeRendering="geometricPrecision"
    >
      {useGradient && (
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={gradientStops[0]} />
            <stop offset="100%" stopColor={gradientStops[1]} />
          </linearGradient>
        </defs>
      )}
      <WorkstationShape fill={actualFill} stroke={stroke} strokeWidth={strokeWidth} />
    </svg>
  );
};
