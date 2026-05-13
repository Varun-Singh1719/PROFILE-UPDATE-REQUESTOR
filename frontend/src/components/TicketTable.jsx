import React from "react";
import { useNavigate } from "react-router-dom";
import { StatusBadge, PriorityBadge } from "./Badges";
import { Checkbox } from "./ui/checkbox";
import { Button } from "./ui/button";
import { Eye } from "lucide-react";

function fmt(iso) { if (!iso) return "-"; try { return new Date(iso).toLocaleDateString(); } catch { return iso; } }
function numericId(tid) {
  if (!tid) return "";
  const m = String(tid).match(/\d+/);
  return m ? m[0] : tid;
}

export default function TicketTable({
  tickets, selectable = false, selected = [], onToggle, onToggleAll,
  showCheckbox = true, basePath = "/tickets", actions = null,
  showView = true, numericIdOnly = false,
}) {
  const navigate = useNavigate();
  const allSelected = tickets.length > 0 && selected.length === tickets.length;
  return (
    <div className="bg-white rounded-xl shadow-soft border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0 z-10 font-bold tracking-wider border-b border-gray-200">
            <tr>
              {selectable && showCheckbox && (
                <th className="px-4 py-3 w-10">
                  <Checkbox
                    data-testid="select-all-checkbox"
                    checked={allSelected}
                    onCheckedChange={(v) => onToggleAll?.(!!v)}
                  />
                </th>
              )}
              <th className="px-4 py-3">Request ID</th>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Created By</th>
              <th className="px-4 py-3">Assigned To</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">No. of Records</th>
              <th className="px-4 py-3">Due Date</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 && (
              <tr><td colSpan={12} className="px-6 py-12 text-center text-gray-400">No requests found</td></tr>
            )}
            {tickets.map((t) => (
              <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50/80 transition-colors" data-testid={`ticket-row-${t.ticket_id}`}>
                {selectable && showCheckbox && (
                  <td className="px-4 py-3">
                    <Checkbox
                      data-testid={`row-checkbox-${t.ticket_id}`}
                      checked={selected.includes(t.id)}
                      onCheckedChange={() => onToggle?.(t.id)}
                    />
                  </td>
                )}
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => navigate(`${basePath}/${t.id}`)}
                    data-testid={`request-id-link-${t.ticket_id}`}
                    className="font-mono text-xs text-[#ec9324] font-semibold hover:underline"
                  >
                    {numericIdOnly ? numericId(t.ticket_id) : t.ticket_id}
                  </button>
                </td>
                <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">{t.subject}</td>
                <td className="px-4 py-3 text-gray-600">{t.created_by_name}</td>
                <td className="px-4 py-3 text-gray-600">{t.assigned_to_name || <span className="text-gray-400 italic">Unassigned</span>}</td>
                <td className="px-4 py-3"><PriorityBadge priority={t.priority} /></td>
                <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                <td className="px-4 py-3 text-gray-700 font-medium">{t.number_of_profiles ?? "-"}</td>
                <td className="px-4 py-3 text-gray-600">{t.due_date || "-"}</td>
                <td className="px-4 py-3 text-gray-500">{fmt(t.created_on)}</td>
                <td className="px-4 py-3 text-gray-500">{fmt(t.updated_on)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    {showView && (
                      <Button size="sm" variant="ghost" data-testid={`view-ticket-${t.ticket_id}`} onClick={() => navigate(`${basePath}/${t.id}`)}>
                        <Eye size={14}/>
                      </Button>
                    )}
                    {actions && actions(t)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
