/**
 * Custom top-down workstation silhouette used by Workstation Booking, Request
 * Workstation, Pending Approvals, Floor Calibration etc.
 *
 * Replaces the previous outline-only PNG (pngegg.png) which could only be
 * partially tinted. This SVG is a single combined SOLID silhouette so when
 * used as a CSS `mask-image` (or rendered inline) the entire workstation
 * shape can be filled with any color — white / green / grey / black / etc.
 *
 * Components (top → bottom, viewBox 100 × 130):
 *   • Monitor / screen (small rounded rect at top)
 *   • Desk surface  (wider rounded rect)
 *   • Backrest connector (small block between desk and chair)
 *   • Two armrests (vertical rounded rects on the sides)
 *   • Chair seat (rounded "U" body)
 *
 * Two exports are provided:
 *   • WORKSTATION_SVG    — raw SVG markup, useful for inline render
 *   • WORKSTATION_MASK_URL — `data:image/svg+xml,...` URL ready for use as a
 *                            CSS `mask-image` / `-webkit-mask-image` source.
 */

// NOTE: The SVG below is intentionally a single <g> of filled primitives so
// that mask-image consumers get a solid silhouette in their chosen color.
// The fill in the SVG itself is irrelevant (only the alpha channel matters
// for masking), but we set it to '#000' for inline-render fallbacks.
export const WORKSTATION_SVG = (
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 130">' +
    '<g fill="#000">' +
      // Monitor / screen
      '<rect x="30" y="2" width="40" height="14" rx="2.5"/>' +
      // Desk surface (wider)
      '<rect x="8" y="17" width="84" height="22" rx="3"/>' +
      // Backrest connector
      '<rect x="40" y="41" width="20" height="8" rx="2"/>' +
      // Left armrest
      '<rect x="12" y="50" width="9" height="48" rx="3"/>' +
      // Right armrest
      '<rect x="79" y="50" width="9" height="48" rx="3"/>' +
      // Chair seat body (rounded U)
      '<path d="M 22 54 L 78 54 Q 82 54 82 58 L 82 110 Q 82 126 60 126 L 40 126 Q 18 126 18 110 L 18 58 Q 18 54 22 54 Z"/>' +
    '</g>' +
  '</svg>'
);

export const WORKSTATION_MASK_URL =
  'data:image/svg+xml;utf8,' + encodeURIComponent(WORKSTATION_SVG);
