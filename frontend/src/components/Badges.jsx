import React from "react";

/**
 * StatusBadge — outlined pill, transparent background, colored border + text.
 * Fixed width for symmetry: every status pill is the same size regardless of
 * label length. Do NOT let the pill auto-size to its content.
 *
 *   Open        → Green
 *   In Progress → Orange
 *   Closed      → Red
 */
export function StatusBadge({ status }) {
  const map = {
    Open:          { text: "#16a34a", border: "#16a34a", bg: "#ffffff" }, // green
    "In Progress": { text: "#ec9324", border: "#ec9324", bg: "#ffffff" }, // orange
    Closed:        { text: "#dc2626", border: "#dc2626", bg: "#ffffff" }, // red
  };
  const c = map[status] || { text: "#6b7280", border: "#d1d5db", bg: "#ffffff" };
  return (
    <span
      data-testid={`status-badge-${status?.toLowerCase().replace(/\s/g, "-")}`}
      className="inline-flex items-center justify-center w-28 h-7 text-xs font-semibold rounded-full border-2 select-none whitespace-nowrap"
      style={{ color: c.text, borderColor: c.border, backgroundColor: c.bg }}
    >
      {status}
    </span>
  );
}

/**
 * PriorityBadge — solid pill, colored background, white text.
 * Fixed width for symmetry: every priority pill is the same size regardless of
 * label length.
 *
 *   Low    → Green
 *   Medium → Orange
 *   High   → Red
 */
export function PriorityBadge({ priority }) {
  const map = {
    High:   "#dc2626", // red
    Medium: "#ec9324", // orange
    Low:    "#16a34a", // green
  };
  const bg = map[priority] || "#9ca3af";
  return (
    <span
      data-testid={`priority-badge-${priority?.toLowerCase()}`}
      className="inline-flex items-center justify-center w-20 h-7 text-xs font-semibold text-white rounded-full select-none whitespace-nowrap"
      style={{ backgroundColor: bg }}
    >
      {priority}
    </span>
  );
}
