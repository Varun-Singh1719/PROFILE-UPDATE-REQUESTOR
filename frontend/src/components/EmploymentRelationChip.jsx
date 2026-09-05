/**
 * EmploymentRelationChip — "Current" / "Former" pill for a Client Contact.
 *
 * Soft-filled pill (tinted background + light border + dark text) — like the
 * "Current" badge on the Employment History cards — NOT the outlined ProfiX
 * status style used by POCStatusChip. Size is FIXED (w-28 h-7, same footprint
 * as POCStatusChip) so it never changes between Current and Former.
 *
 *   Current → Green (bg-green-50 / border-green-200 / text-green-700)
 *   Former  → Blue  (bg-blue-50  / border-blue-200  / text-blue-700)
 *
 *   relation: "current" | "former"
 */
import React from "react";

const ACCENTS = {
  current: { cls: "bg-green-50 border-green-200 text-green-700", label: "Current", title: "Currently working at this client" },
  former:  { cls: "bg-blue-50 border-blue-200 text-blue-700",   label: "Former",  title: "Previously worked at this client" },
};

export default function EmploymentRelationChip({ relation, className = "" }) {
  const a = ACCENTS[relation];
  if (!a) return null;
  return (
    <span
      className={`inline-flex items-center justify-center w-28 h-7 text-xs font-medium rounded-full border select-none whitespace-nowrap ${a.cls} ${className}`}
      data-testid={`employment-relation-chip-${relation}`}
      title={a.title}
    >
      {a.label}
    </span>
  );
}
