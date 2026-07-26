/**
 * ConfirmProposalDialog — final review popup for Team Auto Assignment.
 *
 * When a Workspace Manager clicks "Confirm Booking" in Auto mode, this
 * dialog opens BEFORE the API call so the manager can review each
 * workstation's proposed occupant, swap in a different team member, or
 * remove a workstation from the batch.
 *
 * Props:
 *   open        — bool
 *   onClose     — () => void  (Cancel / X)
 *   onConfirm   — (rows: [{seatId, seatLabel, empId}]) => Promise|void
 *   team        — {id, name}
 *   date        — "YYYY-MM-DD" (display only)
 *   seats       — [{id, label}] — the auto-selected workstations
 *   initialAssignment — {seatId: empId}  starting occupant map (usually random)
 *   teamPool    — [{id, name, email, emp_id}] — bookable team members
 *                 (already filtered against existing bookings for the date)
 *   saving      — bool (disables buttons while API call is in-flight)
 */
import React, { useMemo, useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import Pencil from "@mui/icons-material/EditOutlined";
import Trash from "@mui/icons-material/DeleteOutlined";
import Check from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import UserPlus from "@mui/icons-material/PersonAddAlt1Outlined";
import Users from "@mui/icons-material/PeopleOutlined";
import Loader2 from "@mui/icons-material/HourglassEmpty";
import CalendarToday from "@mui/icons-material/CalendarTodayOutlined";
import SingleSelect from "./SingleSelect";

function fmtDateLong(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
}

export default function ConfirmProposalDialog({
  open,
  onClose,
  onConfirm,
  team,
  date,
  seats = [],
  initialAssignment = {},
  teamPool = [],
  saving = false,
}) {
  // Local mutable state: one row per seat with the currently chosen employee.
  // Row shape: { seatId, seatLabel, empId }
  const [rows, setRows] = useState([]);
  // Which row is currently in "edit" mode (shows the employee picker).
  // Stores the seatId of the row being edited (null = none).
  const [editingSeatId, setEditingSeatId] = useState(null);

  // Reset local state whenever the dialog is (re)opened so a stale proposal
  // from a previous flow doesn't leak in.
  useEffect(() => {
    if (!open) return;
    const initial = seats.map((s) => ({
      seatId: s.id,
      seatLabel: s.label || s.id,
      empId: initialAssignment[s.id] || null,
    }));
    setRows(initial);
    setEditingSeatId(null);
  }, [open, seats, initialAssignment]);

  // Employees currently used somewhere in the proposal — used to freeze them
  // in the picker for every OTHER row.
  const usedEmpIds = useMemo(() => {
    const s = new Set();
    for (const r of rows) if (r.empId) s.add(r.empId);
    return s;
  }, [rows]);

  // Quick lookup by empId → team-pool row (name, email, emp_id).
  const empById = useMemo(() => {
    const m = {};
    for (const e of teamPool) m[e.id] = e;
    return m;
  }, [teamPool]);

  const nameOf = (empId) => {
    if (!empId) return "";
    const e = empById[empId];
    return e ? (e.name || e.email || e.emp_id || "Unknown") : "Unknown";
  };

  const subOf = (empId) => {
    if (!empId) return "";
    const e = empById[empId];
    if (!e) return "";
    return e.emp_id || e.email || "";
  };

  // Build employee options for the picker of a given row. Employees already
  // used in ANOTHER row are shown but disabled.
  const employeeOptionsFor = (currentEmpId) => {
    return teamPool.map((e) => {
      const takenElsewhere = usedEmpIds.has(e.id) && e.id !== currentEmpId;
      return {
        value: e.id,
        label: e.name || e.email || e.emp_id || "Unknown",
        sublabel: e.emp_id || e.email || "",
        disabled: takenElsewhere,
        chip: takenElsewhere ? "Alloted" : undefined,
      };
    });
  };

  // Members from the team who are NOT yet placed in the proposal — used to
  // populate a row that has been "removed" (empId=null) and to allow
  // swapping in a fresh person.
  const unassignedCount = useMemo(() => {
    return teamPool.filter((e) => !usedEmpIds.has(e.id)).length;
  }, [teamPool, usedEmpIds]);

  // Row actions ---------------------------------------------------------------
  const removeRow = (seatId) => {
    setRows((prev) => prev.filter((r) => r.seatId !== seatId));
    if (editingSeatId === seatId) setEditingSeatId(null);
  };

  const clearRow = (seatId) => {
    setRows((prev) => prev.map((r) => r.seatId === seatId ? { ...r, empId: null } : r));
    setEditingSeatId(seatId);
  };

  const setRowEmp = (seatId, empId) => {
    setRows((prev) => prev.map((r) => r.seatId === seatId ? { ...r, empId } : r));
  };

  // Confirm gate — every remaining row must have an employee assigned.
  const missingCount = rows.filter((r) => !r.empId).length;
  const canConfirm = rows.length > 0 && missingCount === 0 && !saving;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm?.(rows);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <DialogContent
        className="max-w-2xl p-0 gap-0 overflow-hidden bg-white"
        data-testid="confirm-proposal-dialog"
      >
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-gray-200 bg-gray-50/60">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <Users sx={{ fontSize: 18 }} className="text-[#ec9324]"/>
            Review proposed workstation plan
          </DialogTitle>
          <DialogDescription className="text-[12px] text-gray-600 mt-1">
            Confirm which team member will sit at each workstation before the
            booking is created. You can swap or remove any row.
          </DialogDescription>
          <div className="mt-2 flex items-center flex-wrap gap-3 text-[11.5px] text-gray-600">
            <span className="inline-flex items-center gap-1">
              <Users sx={{ fontSize: 13 }} className="text-gray-400"/>
              Team <span className="font-semibold text-gray-900">{team?.name || "—"}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarToday sx={{ fontSize: 12 }} className="text-gray-400"/>
              {fmtDateLong(date)}
            </span>
            <span className="ml-auto inline-flex items-center gap-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                {rows.length} workstation{rows.length === 1 ? "" : "s"}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-gray-100 text-gray-600 border-gray-200">
                {unassignedCount} unassigned member{unassignedCount === 1 ? "" : "s"}
              </span>
            </span>
          </div>
        </DialogHeader>

        {/* Body — proposal rows */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-2">
          {rows.length === 0 && (
            <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-[12px] text-gray-500">
              No workstations left in the plan. Cancel and rebuild the proposal.
            </div>
          )}
          {rows.map((r, idx) => {
            const isEditing = editingSeatId === r.seatId;
            return (
              <div
                key={r.seatId}
                className={`rounded-lg border p-3 flex items-center gap-3 ${
                  !r.empId ? "border-amber-200 bg-amber-50/40" : "border-gray-200 bg-white"
                }`}
                data-testid={`proposal-row-${r.seatId}`}
              >
                {/* Serial # + seat label */}
                <div className="flex-shrink-0 flex items-center gap-2 min-w-[92px]">
                  <span className="text-[10px] font-bold text-gray-400 w-4 text-right">
                    {idx + 1}
                  </span>
                  <span
                    className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1"
                    data-testid={`proposal-row-${r.seatId}-seat`}
                  >
                    {r.seatLabel}
                  </span>
                </div>

                {/* Employee — either read view or the picker */}
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <SingleSelect
                      options={employeeOptionsFor(r.empId)}
                      value={r.empId}
                      onChange={(v) => {
                        setRowEmp(r.seatId, v || null);
                        if (v) setEditingSeatId(null);
                      }}
                      placeholder="Choose team member…"
                      searchable={teamPool.length > 8}
                      allowClear={false}
                      size="sm"
                      testId={`proposal-emp-select-${r.seatId}`}
                    />
                  ) : r.empId ? (
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 truncate" title={nameOf(r.empId)}>
                        {nameOf(r.empId)}
                      </div>
                      {subOf(r.empId) && (
                        <div className="text-[11px] text-gray-500 truncate">{subOf(r.empId)}</div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[12px] text-amber-700 font-medium inline-flex items-center gap-1">
                      <UserPlus sx={{ fontSize: 13 }}/>
                      Pick a team member
                    </div>
                  )}
                </div>

                {/* Row actions */}
                <div className="flex-shrink-0 flex items-center gap-1">
                  {isEditing ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingSeatId(null)}
                      disabled={saving || !r.empId}
                      className="h-7 px-2 text-[11px]"
                      data-testid={`proposal-row-${r.seatId}-done`}
                    >
                      <Check sx={{ fontSize: 14 }} className="mr-1"/> Done
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => (r.empId ? clearRow(r.seatId) : setEditingSeatId(r.seatId))}
                        disabled={saving}
                        className="h-7 px-2 text-[11px] text-gray-700"
                        data-testid={`proposal-row-${r.seatId}-edit`}
                        title={r.empId ? "Change occupant" : "Pick occupant"}
                      >
                        <Pencil sx={{ fontSize: 13 }} className="mr-1"/> Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => removeRow(r.seatId)}
                        disabled={saving}
                        className="h-7 px-2 text-[11px] text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                        data-testid={`proposal-row-${r.seatId}-remove`}
                        title="Remove this workstation from the proposal"
                      >
                        <Trash sx={{ fontSize: 13 }} className="mr-1"/> Remove
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {missingCount > 0 && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
              {missingCount} workstation{missingCount === 1 ? "" : "s"} still need an occupant.
              Click <strong>Edit</strong> on the highlighted row{missingCount === 1 ? "" : "s"} to pick a team member.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50/60 flex items-center justify-end gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={saving}
            className="h-9"
            data-testid="confirm-proposal-cancel"
          >
            <CloseIcon sx={{ fontSize: 14 }} className="mr-1"/> Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="h-9 bg-[#ec9324] hover:bg-[#d8821a] text-white"
            data-testid="confirm-proposal-confirm"
          >
            {saving ? (
              <><Loader2 sx={{ fontSize: 14 }} className="animate-spin mr-1.5"/> Booking…</>
            ) : (
              <><Check sx={{ fontSize: 15 }} className="mr-1"/> Confirm Booking</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
