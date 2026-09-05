/**
 * EmploymentRelationChip — "Current" / "Former" pill for a Client Contact.
 *
 * Same chip as ProfiX → All Requests → Status (outlined, white bg, fixed
 * w-28 h-7) so it stacks flush under POCStatusChip and never changes size.
 *
 *   Current → Green (#16a34a)
 *   Former  → Blue  (#2563eb)
 *
 *   relation: "current" | "former"
 */
import React from "react";
import { PROFIX_PILL_CLASS } from "./POCStatusChip";

const ACCENTS = {
  current: { color: "#16a34a", label: "Current", title: "Currently working at this client" },
  former:  { color: "#2563eb", label: "Former",  title: "Previously worked at this client" },
};

export default function EmploymentRelationChip({ relation, className = "" }) {
  const a = ACCENTS[relation];
  if (!a) return null;
  return (
    <span
      className={`${PROFIX_PILL_CLASS} ${className}`}
      style={{ color: a.color, borderColor: a.color, backgroundColor: "#ffffff" }}
      data-testid={`employment-relation-chip-${relation}`}
      title={a.title}
    >
      {a.label}
    </span>
  );
}
