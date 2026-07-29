/**
 * DuplicatePendingConfirmDialog — shown when the user tries to submit a
 * new workstation request but the target employee already has a pending
 * request for the same date.
 *
 * Renders the details of the *existing* pending request (id, workstation,
 * date, requested-on, current status, and "Requested By" only when the
 * request was filed on behalf of someone else) and asks the user to
 * confirm the cancel-and-recreate flow. When the user clicks Confirm, the
 * parent re-submits the payload with `replace_request_id` set — the
 * backend then atomically cancels the old pending request (with audit
 * fields) and creates the new one.
 *
 * Props:
 *   open         — bool
 *   onClose      — () => void
 *   onConfirm    — () => Promise|void
 *   conflict     — object returned by the 409 EMPLOYEE_PENDING response:
 *                    { id, seat_label, date, status, requested_by,
 *                      requested_on, employee, plan_name, team_name }
 *   busy         — bool (disable buttons while the follow-up request is
 *                  in-flight)
 *   currentUserId — id of the currently logged-in user, used to decide
 *                   whether to render the "Requested By" row (only when
 *                   the pending request was filed on behalf of someone
 *                   else, per spec).
 */
import React from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import AlertCircle from "@mui/icons-material/ErrorOutlineOutlined";
import CalendarToday from "@mui/icons-material/CalendarTodayOutlined";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import Loader2 from "@mui/icons-material/HourglassEmpty";

function fmtDateLong(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  } catch { return iso; }
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  } catch { return iso; }
}

export default function DuplicatePendingConfirmDialog({
  open,
  onClose,
  onConfirm,
  conflict,
  busy = false,
  currentUserId = null,
}) {
  if (!conflict) return null;
  const emp = conflict.employee || {};
  const requestedBy = conflict.requested_by || {};
  // Spec: show "Requested By" only when the booking was created on behalf
  // of another user — i.e. the requester is not the employee themselves.
  const onBehalf = requestedBy?.id && emp?.id && requestedBy.id !== emp.id;
  // Also skip the row when the requester is the currently logged-in user
  // AND they're the same as the employee ("you" case).
  const showRequestedBy = onBehalf;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose?.(); }}>
      <DialogContent
        className="max-w-md p-0 gap-0 overflow-hidden bg-white"
        data-testid="dup-pending-dialog"
      >
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-gray-200 bg-amber-50/50">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <AlertCircle sx={{ fontSize: 20 }} className="text-amber-600"/>
            Pending Request Already Exists
          </DialogTitle>
          <DialogDescription className="text-[12.5px] text-gray-700 mt-1.5 leading-snug">
            You already have a workstation booking request pending approval for{" "}
            <span className="font-semibold text-gray-900">
              {fmtDateLong(conflict.date)}
            </span>
            . Would you like to cancel the existing request and create a new one?
          </DialogDescription>
        </DialogHeader>

        {/* Existing request details */}
        <div className="px-6 py-4 space-y-2 text-[12.5px]">
          <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5">
            <div className="text-gray-500">Request ID</div>
            <div className="text-gray-900 font-mono text-[11.5px] break-all" data-testid="dup-pending-id">
              {conflict.id || "—"}
            </div>
            <div className="text-gray-500">Workstation</div>
            <div className="text-gray-900 font-semibold" data-testid="dup-pending-seat">
              {conflict.seat_label || "—"}
            </div>
            <div className="text-gray-500">Booked For Date</div>
            <div className="text-gray-900 inline-flex items-center gap-1.5" data-testid="dup-pending-date">
              <CalendarToday sx={{ fontSize: 12 }} className="text-gray-400"/>
              {fmtDateLong(conflict.date)}
            </div>
            <div className="text-gray-500">Requested On</div>
            <div className="text-gray-900" data-testid="dup-pending-requested-on">
              {fmtDateTime(conflict.requested_on)}
            </div>
            <div className="text-gray-500">Status</div>
            <div data-testid="dup-pending-status">
              <span
                className="inline-flex items-center justify-center h-6 px-2.5 text-[10.5px] font-semibold rounded-full border-2 whitespace-nowrap"
                style={{ color: "#ec9324", borderColor: "#ec9324", backgroundColor: "#ffffff" }}
              >
                {conflict.status || "Pending Approval"}
              </span>
            </div>
            {showRequestedBy && (
              <>
                <div className="text-gray-500">Requested By</div>
                <div className="text-gray-900" data-testid="dup-pending-requested-by">
                  <span className="font-medium">{requestedBy.name || requestedBy.email || "—"}</span>
                  {requestedBy.email && requestedBy.name && (
                    <span className="text-gray-500 ml-1 text-[11px]">({requestedBy.email})</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-3 border-t border-gray-200 bg-gray-50/60 flex-row justify-end gap-2 sm:justify-end">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={busy}
            className="h-9"
            data-testid="dup-pending-cancel"
          >
            <CloseIcon sx={{ fontSize: 14 }} className="mr-1"/> Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={busy}
            className="h-9 bg-[#ec9324] hover:bg-[#d8821a] text-white"
            data-testid="dup-pending-confirm"
          >
            {busy ? (
              <><Loader2 sx={{ fontSize: 14 }} className="animate-spin mr-1.5"/> Replacing…</>
            ) : (
              <><CheckIcon sx={{ fontSize: 15 }} className="mr-1"/> Confirm</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
