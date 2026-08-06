/**
 * POCStatusChip — reusable status chip for the Client Contact POC Status.
 *
 * Kept intentionally dumb: takes a `status` object of shape
 *   { key, label, color }
 * where `color` is one of green | red | amber | gray so future statuses
 * (Warm / Cold / Inactive / Archived) drop in without code changes.
 */
import React from "react";

const STATUS_ACCENTS = {
  green:  { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-500", border: "border-emerald-200" },
  red:    { bg: "bg-red-100",     text: "text-red-700",     dot: "bg-red-500",     border: "border-red-200" },
  amber:  { bg: "bg-amber-100",   text: "text-amber-700",   dot: "bg-amber-500",   border: "border-amber-200" },
  gray:   { bg: "bg-gray-100",    text: "text-gray-700",    dot: "bg-gray-400",    border: "border-gray-200" },
};

export default function POCStatusChip({ status, size = "sm" }) {
  if (!status) return null;
  const a = STATUS_ACCENTS[status.color] || STATUS_ACCENTS.gray;
  const cls =
    size === "lg"
      ? "px-2.5 py-1 text-[12px]"
      : "px-2 py-0.5 text-[11px]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold border ${cls} ${a.bg} ${a.text} ${a.border}`}
      data-testid={`poc-status-chip-${status.key}`}
      title="POC Status is auto-calculated (read-only)"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${a.dot}`} />
      {status.label}
    </span>
  );
}
