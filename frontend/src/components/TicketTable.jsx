import React from "react";
import { useNavigate } from "react-router-dom";
import { StatusBadge, PriorityBadge } from "./Badges";
import { Checkbox } from "./ui/checkbox";
import { Button } from "./ui/button";
import { MoreVertical, Eye } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub,
  DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuSeparator, DropdownMenuLabel,
} from "./ui/dropdown-menu";

function fmt(iso) { if (!iso) return "-"; try { return new Date(iso).toLocaleDateString(); } catch { return iso; } }

/**
 * Extract the numeric portion of a ticket ID.
 * "TKT-1102" → "1102"  |  "1102" → "1102"
 */
function numericId(tid) {
  if (!tid) return "";
  const m = String(tid).match(/\d+/);
  return m ? m[0] : tid;
}

/**
 * TicketTable (Jul 2026 refresh)
 *   • "Subject" column removed (see PRD).
 *   • Request ID displayed as numeric-only ("1102" not "TKT-1102").
 *   • Cells stay on a single line — long text truncates with ellipsis.
 *   • Actions collapsed into a single triple-dot (⋮) menu (View / Update Status / Assign).
 *   • Table header freezes when the body scrolls (sticky top-0 inside the
 *     inner scroll container).
 */
export default function TicketTable({
  tickets, selectable = false, selected = [], onToggle, onToggleAll,
  showCheckbox = true, basePath = "/tickets", actions = null,
  showView = true,
  members = [],
  isAdmin = false,
  isDQ = false,
  currentUserId = "",
  onUpdateStatus, // (ticketId, newStatus) => void
  onReassign,     // (ticketId, memberId | "") => void
  onAssignSelf,   // (ticketId) => void
}) {
  const navigate = useNavigate();
  const allSelected = tickets.length > 0 && selected.length === tickets.length;

  const renderRowActions = (t) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" data-testid={`row-actions-${t.ticket_id}`} className="h-8 w-8 p-0" title="Actions" aria-label="Actions">
          <MoreVertical size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* View */}
        {showView && (
          <DropdownMenuItem
            onClick={() => navigate(`${basePath}/${t.id}`)}
            data-testid={`row-action-view-${t.ticket_id}`}
          >
            <Eye size={14} className="mr-2" /> View
          </DropdownMenuItem>
        )}

        {/* Update Status — Admin can always; DQ only for own open tickets */}
        {(isAdmin || (isDQ && t.assigned_to_id === currentUserId && t.status !== "Closed")) && onUpdateStatus && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid={`row-action-status-${t.ticket_id}`}>Update Status</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => onUpdateStatus(t.id, "Open")}>Open</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onUpdateStatus(t.id, "In Progress")}>In Progress</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onUpdateStatus(t.id, "Closed")}>Closed</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {/* Assign — Admin can reassign to any DQ member; DQ can only self-assign when unassigned */}
        {isAdmin && onReassign && members.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid={`row-action-assign-${t.ticket_id}`}>Assign</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              {members.map((m) => (
                <DropdownMenuItem key={m.id} onClick={() => onReassign(t.id, m.id)}>{m.name}</DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onReassign(t.id, "")}>Unassign</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {isDQ && !t.assigned_to_id && onAssignSelf && (
          <DropdownMenuItem onClick={() => onAssignSelf(t.id)} data-testid={`row-action-assign-me-${t.ticket_id}`}>
            Assign to Me
          </DropdownMenuItem>
        )}

        {/* Legacy: any extra actions the caller passes still render here */}
        {actions && actions(t)}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="bg-white rounded-xl shadow-soft border border-gray-100">
      {/* NO nested overflow at all — thead's `sticky` references the page-level
          scroll container so it stays visible below the sticky filter. */}
      <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="text-xs text-gray-700 uppercase bg-gray-50 sticky top-[72px] z-20 font-bold tracking-wider border-b border-gray-200 shadow-[0_1px_0_rgba(0,0,0,0.05)]">
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
              <th className="px-4 py-3">Created By</th>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3">Assigned To</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Records</th>
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
                    title={t.ticket_id}
                  >
                    {numericId(t.ticket_id)}
                  </button>
                </td>
                <td className="px-4 py-3 text-gray-600 truncate max-w-[180px]" title={t.created_by_name || ""}>{t.created_by_name}</td>
                <td className="px-4 py-3 text-gray-600 truncate max-w-[160px]" title={t.team_name || ""}>
                  {t.team_name ? (
                    <span data-testid={`team-cell-${t.ticket_id}`}>{t.team_name}</span>
                  ) : (
                    <span className="text-gray-400 italic">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600 truncate max-w-[180px]" title={t.assigned_to_name || "Unassigned"}>
                  {t.assigned_to_name || <span className="text-gray-400 italic">Unassigned</span>}
                </td>
                <td className="px-4 py-3"><PriorityBadge priority={t.priority} /></td>
                <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                <td className="px-4 py-3 text-gray-700 font-medium">{t.number_of_profiles ?? "-"}</td>
                <td className="px-4 py-3 text-gray-600">{t.due_date || "-"}</td>
                <td className="px-4 py-3 text-gray-500">{fmt(t.created_on)}</td>
                <td className="px-4 py-3 text-gray-500">{fmt(t.updated_on)}</td>
                <td className="px-4 py-3 text-right">{renderRowActions(t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
    </div>
  );
}
