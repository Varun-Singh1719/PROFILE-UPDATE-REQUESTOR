/**
 * EmploymentRelationChip — "Current" / "Former" pill for a Client Contact,
 * shaped exactly like POCStatusChip so the two stack neatly (Status on top,
 * employment relation right below it) on the card view and the detail view.
 *
 *   relation: "current" | "former"
 */
import React from "react";

const ACCENTS = {
  current: { bg: "bg-blue-50",  text: "text-blue-700", dot: "bg-blue-500", border: "border-blue-200", label: "Current" },
  former:  { bg: "bg-gray-100", text: "text-gray-600", dot: "bg-gray-400", border: "border-gray-200", label: "Former" },
};

export default function EmploymentRelationChip({ relation, size = "sm", className = "" }) {
  const a = ACCENTS[relation];
  if (!a) return null;
  const cls = size === "lg" ? "px-2.5 py-1 text-[12px]" : "px-2 py-0.5 text-[11px]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold border ${cls} ${a.bg} ${a.text} ${a.border} ${className}`}
      data-testid={`employment-relation-chip-${relation}`}
      title={relation === "current" ? "Currently working at this client" : "Previously worked at this client"}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${a.dot}`} />
      {a.label}
    </span>
  );
}
