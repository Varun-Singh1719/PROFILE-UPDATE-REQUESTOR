import React from "react";

export function StatusBadge({ status }) {
  const map = {
    Open: "bg-[#ec9324]/10 text-[#ec9324] border border-[#ec9324]/30",
    "In Progress": "bg-green-100 text-green-700 border border-green-200",
    Closed: "bg-[#b2b2b2]/15 text-gray-600 border border-[#b2b2b2]/30",
  };
  return (
    <span
      data-testid={`status-badge-${status?.toLowerCase().replace(/\s/g, "-")}`}
      className={`inline-flex items-center text-xs font-semibold uppercase tracking-wide rounded-full px-2.5 py-1 ${map[status] || ""}`}
    >
      <span className="w-1.5 h-1.5 rounded-full mr-1.5"
        style={{ backgroundColor: status === "Open" ? "#ec9324" : status === "In Progress" ? "#22c55e" : "#b2b2b2" }} />
      {status}
    </span>
  );
}

export function PriorityBadge({ priority }) {
  const map = {
    High: "bg-red-100 text-red-700 border border-red-200",
    Medium: "bg-yellow-100 text-yellow-700 border border-yellow-200",
    Low: "bg-green-100 text-green-700 border border-green-200",
  };
  return (
    <span
      data-testid={`priority-badge-${priority?.toLowerCase()}`}
      className={`inline-flex items-center text-xs font-semibold uppercase tracking-wide rounded-full px-2.5 py-1 ${map[priority] || ""}`}
    >
      {priority}
    </span>
  );
}
