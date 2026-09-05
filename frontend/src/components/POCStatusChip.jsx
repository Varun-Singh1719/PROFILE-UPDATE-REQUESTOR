/**
 * POCStatusChip — status pill for the Client Contact POC Status.
 *
 * Visual = EXACTLY the ProfiX → All Requests → Status badge (components/Badges.jsx
 * StatusBadge): outlined pill, white background, coloured 2px border + text,
 * FIXED size (w-28 h-7) so the chip never resizes when the status changes.
 *
 *   Active  (color: green) → same as ProfiX "Open"   → #16a34a
 *   Dormant (color: red)   → same as ProfiX "Closed" → #dc2626
 *   amber / gray kept for any future statuses.
 *
 * Takes a `status` object of shape { key, label, color }.
 */
import React from "react";

const COLORS = {
  green: "#16a34a",
  red:   "#dc2626",
  amber: "#ec9324",
  gray:  "#6b7280",
};

// Shared class string — identical to ProfiX StatusBadge.
export const PROFIX_PILL_CLASS =
  "inline-flex items-center justify-center w-28 h-7 text-xs font-semibold rounded-full border-2 select-none whitespace-nowrap";

export default function POCStatusChip({ status }) {
  if (!status) return null;
  const c = COLORS[status.color] || COLORS.gray;
  return (
    <span
      className={PROFIX_PILL_CLASS}
      style={{ color: c, borderColor: c, backgroundColor: "#ffffff" }}
      data-testid={`poc-status-chip-${status.key}`}
      title="POC Status is auto-calculated (read-only)"
    >
      {status.label}
    </span>
  );
}
