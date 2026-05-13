import React from "react";
import { useNavigate } from "react-router-dom";
import { StatusBadge, PriorityBadge } from "./Badges";

function fmtDate(iso) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    const day = d.getDate().toString().padStart(2, "0");
    const month = d.toLocaleString("en-US", { month: "short" });
    const year = d.getFullYear();
    let hours = d.getHours();
    const mins = d.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${day} ${month} ${year}, ${hours.toString().padStart(2, "0")}:${mins} ${ampm}`;
  } catch {
    return iso;
  }
}

function numericId(ticketId) {
  if (!ticketId) return "";
  const m = String(ticketId).match(/\d+/);
  return m ? m[0] : ticketId;
}

function truncate(text, n = 120) {
  if (!text) return "";
  const t = String(text).trim();
  return t.length > n ? t.slice(0, n).trim() + "..." : t + (t.endsWith("...") ? "" : "...");
}

export default function RecentUpdateCard({ ticket, basePath = "/tickets" }) {
  const navigate = useNavigate();
  const preview = ticket.description?.trim() || ticket.subject;
  return (
    <div
      onClick={() => navigate(`${basePath}/${ticket.id}`)}
      data-testid={`recent-update-${ticket.ticket_id}`}
      className="cursor-pointer bg-white rounded-xl p-5 border border-gray-100 shadow-soft hover:shadow-soft-hover transition-all duration-200"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-gray-900 truncate">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); navigate(`${basePath}/${ticket.id}`); }}
              className="text-[#ec9324] font-bold hover:underline"
              data-testid={`recent-id-link-${ticket.ticket_id}`}
            >{numericId(ticket.ticket_id)}</button>
            <span className="text-gray-400 mx-2">:</span>
            <span>{ticket.subject}</span>
          </div>
          <div className="mt-2 text-sm text-gray-600 line-clamp-2">{truncate(preview, 140)}</div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
            <span>
              <span className="font-medium text-gray-700">Assigned To:</span>{" "}
              {ticket.assigned_to_name || <span className="italic text-gray-400">Unassigned</span>}
            </span>
            <span>
              <span className="font-medium text-gray-700">Created By:</span> {ticket.created_by_name}
            </span>
            <span>
              <span className="font-medium text-gray-700">Updated At:</span> {fmtDate(ticket.updated_on)}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <StatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
        </div>
      </div>
    </div>
  );
}
