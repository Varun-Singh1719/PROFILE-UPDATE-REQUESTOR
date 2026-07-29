/**
 * PendingConflictConfirmDialog — shown from Workstation Booking when the
 * server responds with HTTP 409 `code: PENDING_REQUESTS_WILL_BE_DECLINED`.
 *
 * The user is about to allot workstations to one or more employees who
 * already have an active workstation REQUEST in "Pending Approval" state
 * on the same date. Instead of silently declining them, we ask the user
 * to confirm; on confirm the payload is re-sent with
 * `confirm_auto_decline_pending: true` and the backend performs the
 * "decline pending + insert bookings" atomically inside a Mongo
 * transaction.
 *
 * Props:
 *   open               — bool
 *   onClose            — () => void
 *   onConfirm          — () => Promise|void
 *   pendingCount       — number  (X in the summary)
 *   proposedCount      — number  (Y in the summary)
 *   conflicts          — [{ id, employee:{name,emp_id}, seat_label,
 *                          proposed_seat:{seat_label}, date,
 *                          requested_on, status, requested_by }]
 *   busy               — bool (disable buttons while retry is in-flight)
 */
import React from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import AlertCircle from "@mui/icons-material/ErrorOutlineOutlined";
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

export default function PendingConflictConfirmDialog({
  open,
  onClose,
  onConfirm,
  pendingCount = 0,
  proposedCount = 0,
  conflicts = [],
  busy = false,
}) {
  if (!conflicts || conflicts.length === 0) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose?.(); }}>
      <DialogContent
        className="max-w-3xl p-0 gap-0 overflow-hidden bg-white"
        data-testid="pending-conflict-dialog"
      >
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-gray-200 bg-amber-50/50">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <AlertCircle sx={{ fontSize: 20 }} className="text-amber-600"/>
            Pending Approval requests will be declined
          </DialogTitle>
          <DialogDescription className="sr-only">
            Confirm the auto-decline of the listed pending workstation
            requests before the new bookings are created.
          </DialogDescription>
          {/* Spec-mandated summary */}
          <div className="mt-2 text-[13px] font-semibold text-gray-900">
            <span
              className="inline-flex items-center justify-center h-6 px-2 mr-1 rounded text-white text-[11.5px] font-bold"
              style={{ backgroundColor: "#ec9324" }}
              data-testid="pending-conflict-summary-count"
            >
              {pendingCount}
            </span>
            Pending Approval request{pendingCount === 1 ? "" : "s"} will be
            automatically declined and{" "}
            <span
              className="inline-flex items-center justify-center h-6 px-2 mx-1 rounded text-white text-[11.5px] font-bold"
              style={{ backgroundColor: "#ec9324" }}
            >
              {proposedCount}
            </span>
            workstation booking{proposedCount === 1 ? "" : "s"} will be created.
          </div>
          <div className="mt-2 text-[12px] text-gray-700 leading-snug">
            The following users have Workstation Requests in Pending
            Approval for the selected date. If you continue, these requests
            will be automatically declined and new workstation bookings
            will be created.
          </div>
        </DialogHeader>

        {/* Conflicts table */}
        <div className="px-6 py-3 max-h-[54vh] overflow-y-auto">
          <div className="border border-gray-200 rounded-md overflow-hidden">
            <table className="w-full text-[12px]" data-testid="pending-conflict-table">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-gray-600 font-semibold">
                  <th className="px-3 py-2 whitespace-nowrap">Employee Name</th>
                  <th className="px-3 py-2 whitespace-nowrap">Employee ID</th>
                  <th className="px-3 py-2 whitespace-nowrap">Requested Workstation</th>
                  <th className="px-3 py-2 whitespace-nowrap">Proposed Workstation</th>
                  <th className="px-3 py-2 whitespace-nowrap">Booked For Date</th>
                  <th className="px-3 py-2 whitespace-nowrap">Requested On</th>
                  <th className="px-3 py-2 whitespace-nowrap">Current Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {conflicts.map((c) => {
                  const emp = c.employee || {};
                  const proposed = c.proposed_seat || {};
                  return (
                    <tr key={c.id} data-testid={`pending-conflict-row-${c.id}`} className="text-gray-800 hover:bg-gray-50/60">
                      <td className="px-3 py-2 font-semibold text-gray-900">{emp.name || "—"}</td>
                      <td className="px-3 py-2 text-gray-600">{emp.emp_id || "—"}</td>
                      <td className="px-3 py-2">
                        <span
                          className="inline-flex items-center justify-center h-6 px-2 rounded text-[11px] font-bold text-white"
                          style={{ backgroundColor: "#ec9324" }}
                        >
                          {c.seat_label || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {proposed.seat_label ? (
                          <span
                            className="inline-flex items-center justify-center h-6 px-2 rounded text-[11px] font-bold text-white"
                            style={{ backgroundColor: "#059669" }}
                            title="New seat this employee will be assigned"
                          >
                            {proposed.seat_label}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDateLong(c.date)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(c.requested_on)}</td>
                      <td className="px-3 py-2">
                        <span
                          className="inline-flex items-center justify-center h-6 px-2 text-[10.5px] font-semibold rounded-full border-2 whitespace-nowrap"
                          style={{ color: "#ec9324", borderColor: "#ec9324", backgroundColor: "#ffffff" }}
                        >
                          {c.status || "Pending Approval"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-3 border-t border-gray-200 bg-gray-50/60 flex-row justify-end gap-2 sm:justify-end">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={busy}
            className="h-9"
            data-testid="pending-conflict-cancel"
          >
            <CloseIcon sx={{ fontSize: 14 }} className="mr-1"/> Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={busy}
            className="h-9 bg-[#ec9324] hover:bg-[#d8821a] text-white"
            data-testid="pending-conflict-confirm"
          >
            {busy ? (
              <><Loader2 sx={{ fontSize: 14 }} className="animate-spin mr-1.5"/> Processing…</>
            ) : (
              <><CheckIcon sx={{ fontSize: 15 }} className="mr-1"/> Confirm</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
