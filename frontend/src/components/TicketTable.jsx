import React from "react";
import { useNavigate } from "react-router-dom";
import { StatusBadge, PriorityBadge } from "./Badges";
import { Checkbox } from "./ui/checkbox";
import { BulkSelectCheckbox } from "./ui/bulk-select-checkbox";
import { Button } from "./ui/button";
import { numericId } from "../lib/ticketId";
import MoreVertical from "@mui/icons-material/MoreVert";
import Eye from "@mui/icons-material/Visibility";
import EditIcon from "@mui/icons-material/EditOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub,
  DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuSeparator, DropdownMenuLabel,
} from "./ui/dropdown-menu";

function fmt(iso) { if (!iso) return "-"; try { return new Date(iso).toLocaleDateString(undefined, { timeZone: "Asia/Kolkata" }); } catch { return iso; } }

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
  onEdit,         // (ticket)             => void — open the Edit Ticket modal
  onReopen,       // (ticket)             => void — open the Reopen dialog
  canView = true,          // gate visibility of the View menu item (v3-driven)
  canEdit = false,         // gate visibility of the Edit menu item (v3-driven)
  editMaxStatus = null,    // "open" | "in_progress" | "closed" | null — status-lock from v3 edit fn
  canReopen = false,       // gate visibility of the Reopen menu item (v3-driven)
  canUpdateStatus = false, // gate visibility of Update Status (v3-driven)
  canAssign = false,       // gate visibility of Assign submenu (v3-driven)
}) {
  const navigate = useNavigate();
  // "Select all" reflects only whether every *visible* row is selected — the
  // selection may also contain rows hidden by the active filter, so a simple
  // length comparison would be wrong.
  const allSelected = tickets.length > 0 && tickets.every((t) => selected.includes(t.id));

  // Rank tables for the `max_editable_status` gate — must stay in sync with
  // backend/routers/permissions_v3.py::_MAX_EDITABLE_STATUS_RANK. Edit is
  // hidden once the ticket's current status rank exceeds the allowed rank
  // (e.g. editMaxStatus="open" hides Edit for "In Progress" and "Closed"
  // tickets). Backend still enforces this — this is the UI layer.
  const TICKET_STATUS_RANK = { "Open": 1, "In Progress": 2, "Closed": 3 };
  const MAX_EDIT_RANK = { "open": 1, "in_progress": 2, "closed": 3 };
  const isEditAllowedForStatus = (t) => {
    if (!editMaxStatus) return true; // no lock configured → allow
    const cur = TICKET_STATUS_RANK[t?.status || "Open"] || 1;
    const lim = MAX_EDIT_RANK[editMaxStatus] || 2;
    return cur <= lim;
  };

  const renderRowActions = (t) => {
    // Compute per-row visibility for all 4 items up-front so we can hide the
    // trigger entirely when nothing would render (Aug 14 2026 auto-hide UX
    // request: no empty popovers). Mirrors the individual gates below.
    const showViewItem   = !!(showView && canView);
    const showEditItem   = !!(onEdit && canEdit && isEditAllowedForStatus(t) && t.status !== "Closed");
    const showReopenItem = !!(onReopen && canReopen && t.status === "Closed");
    const showStatusItem = !!(onUpdateStatus && (canUpdateStatus || (isDQ && t.assigned_to_id === currentUserId && t.status !== "Closed")));
    const showAssignItem = !!(canAssign && onReassign);
    const anyVisible = showViewItem || showEditItem || showReopenItem || showStatusItem || showAssignItem;
    if (!anyVisible) return null;
    return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" data-testid={`row-actions-${t.ticket_id}`} className="h-8 w-8 p-0" title="Actions" aria-label="Actions">
          <MoreVertical sx={{ fontSize: 16 }}/>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* View — hidden either by the legacy `showView` prop (kept for
            backwards-compat) or by lack of v3 `profix.ticket_detail.view`
            visibility. */}
        {showViewItem && (
          <DropdownMenuItem
            onClick={() => navigate(`${basePath}/${t.id}`)}
            data-testid={`row-action-view-${t.ticket_id}`}
          >
            <Eye sx={{ fontSize: 14 }} className="mr-2"/> View
          </DropdownMenuItem>
        )}

        {/* Edit — v3-gated by profix.ticket_detail.edit.visible AND the
            per-set `max_editable_status` lock. Backend still enforces both;
            UI hides the item once the ticket's status rank exceeds the
            allowed rank (e.g. lock=Open hides Edit for In Progress + Closed).
            The legacy `t.status !== "Closed"` guard is preserved for the
            default (no-lock) case. */}
        {onEdit && showEditItem && (
          <DropdownMenuItem
            onClick={() => onEdit(t)}
            data-testid={`row-action-edit-${t.ticket_id}`}
          >
            <EditIcon sx={{ fontSize: 14 }} className="mr-2"/> Edit
          </DropdownMenuItem>
        )}

        {/* Reopen — only when the ticket is Closed. Permission-gated by
            profix.ticket_detail.reopen; creators are also allowed at the
            backend but we still show the item to admins here so it appears
            in every "actions" list. */}
        {onReopen && showReopenItem && (
          <DropdownMenuItem
            onClick={() => onReopen(t)}
            data-testid={`row-action-reopen-${t.ticket_id}`}
          >
            <RefreshIcon sx={{ fontSize: 14 }} className="mr-2 text-[#ec9324]"/> Reopen Request
          </DropdownMenuItem>
        )}

        {/* Update Status — v3-gated by `profix.ticket_detail.change_status`
            (canUpdateStatus). Legacy DQ carve-out kept for backwards-compat:
            DQ users still get their own-ticket status flow even when the v3
            catalog entry is missing. */}
        {showStatusItem && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid={`row-action-status-${t.ticket_id}`}>Update Status</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => onUpdateStatus(t.id, "Open")}>Open</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onUpdateStatus(t.id, "In Progress")}>In Progress</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onUpdateStatus(t.id, "Closed")}>Closed</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {/* Assign — v3-gated by `profix.ticket_detail.assign` (canAssign).
            Legacy DQ self-assign carve-out is unchanged below. */}
        {canAssign && onReassign && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid={`row-action-assign-${t.ticket_id}`}>Assign</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              {members.length === 0 ? (
                <div
                  className="px-2 py-1.5 text-xs text-gray-500 italic max-w-[220px]"
                  data-testid={`row-action-assign-empty-${t.ticket_id}`}
                >
                  No eligible users available for assignment.
                </div>
              ) : (
                members.map((m) => (
                  <DropdownMenuItem key={m.id} onClick={() => onReassign(t.id, m.id)}>{m.name}</DropdownMenuItem>
                ))
              )}
              {members.length > 0 && <DropdownMenuSeparator />}
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
  };

  return (
    <div className="w-full">
      {/* Sticky thead — references the nearest scrolling ancestor (usually
          the parent card in TicketListPage, or the page for legacy pages). */}
      <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0 z-20 font-bold tracking-wider border-b border-gray-200 shadow-[0_1px_0_rgba(0,0,0,0.05)]">
            <tr>
              {selectable && showCheckbox && (
                <th className="px-4 py-3 w-10">
                  <BulkSelectCheckbox
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
                    <BulkSelectCheckbox
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
