import React from "react";
import { useNavigate } from "react-router-dom";
import { StatusBadge, PriorityBadge } from "./Badges";
import { Calendar, User, Clock } from "lucide-react";

function fmt(iso) {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function TicketCard({ ticket, basePath = "/tickets" }) {
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(`${basePath}/${ticket.id}`)}
      data-testid={`ticket-card-${ticket.ticket_id}`}
      className="cursor-pointer bg-white rounded-xl p-5 border border-gray-100 shadow-soft hover:shadow-soft-hover transition-all duration-200 relative"
    >
      <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
        <StatusBadge status={ticket.status} />
        <PriorityBadge priority={ticket.priority} />
      </div>
      <div className="text-xs font-mono text-[#ec9324] font-semibold">{ticket.ticket_id}</div>
      <h3 className="mt-1 text-base font-semibold text-gray-900 line-clamp-2 pr-24">{ticket.subject}</h3>
      <div className="mt-4 space-y-1.5 text-xs text-gray-500">
        <div className="flex items-center gap-1.5"><User size={12}/> Assigned: <span className="text-gray-700 font-medium">{ticket.assigned_to_name || "Unassigned"}</span></div>
        <div className="flex items-center gap-1.5"><Clock size={12}/> Updated: <span className="text-gray-700">{fmt(ticket.updated_on)}</span></div>
        {ticket.due_date && <div className="flex items-center gap-1.5"><Calendar size={12}/> Due: <span className="text-gray-700">{ticket.due_date}</span></div>}
      </div>
    </div>
  );
}
