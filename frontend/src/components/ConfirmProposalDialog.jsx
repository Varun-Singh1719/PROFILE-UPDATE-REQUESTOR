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

// Weekday code helpers — codes come from the recurring config on the
// WorkstationBookingPage: Su, M, T, W, Th, F, S (Sunday .. Saturday).
const DAY_ORDER = ["Su", "M", "T", "W", "Th", "F", "S"];
const DAY_SHORT_LABELS = {
  Su: "Su", M: "M", T: "T", W: "W", Th: "Th", F: "F", S: "S",
};
const FULL_DAY_NAMES = {
  Su: "Sunday",
  M:  "Monday",
  T:  "Tuesday",
  W:  "Wednesday",
  Th: "Thursday",
  F:  "Friday",
  S:  "Saturday",
};
// Sort selected day codes into calendar order (Su → S) so a user who picked
// F, M, W sees them rendered as M W F (not the order they clicked).
function sortDayCodes(codes) {
  const set = new Set(codes || []);
  return DAY_ORDER.filter((c) => set.has(c));
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
  recurring = null,   // { end_date, days: ['Su','M','T','W','Th','F','S'] } | null
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
  // used in ANOTHER row are shown but disabled. Order: Unalloted first
  // (alphabetical), then Alloted (alphabetical) at the bottom.
  const employeeOptionsFor = (currentEmpId) => {
    return teamPool
      .map((e) => {
        const takenElsewhere = usedEmpIds.has(e.id) && e.id !== currentEmpId;
        return {
          value: e.id,
          label: e.name || e.email || e.emp_id || "Unknown",
          sublabel: e.emp_id || e.email || "",
          disabled: takenElsewhere,
          chip: takenElsewhere ? "Alloted" : undefined,
          _alloted: takenElsewhere,
        };
      })
      .sort((a, b) => {
        if (a._alloted !== b._alloted) return a._alloted ? 1 : -1;
        return String(a.label || "").localeCompare(
          String(b.label || ""),
          undefined,
          { sensitivity: "base" }
        );
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
            Review : Proposed Plan
          </DialogTitle>
          <DialogDescription className="sr-only">
            Review the proposed workstation plan before confirming.
          </DialogDescription>
          <div className="mt-2 flex items-center flex-wrap gap-3 text-[11.5px] text-gray-600">
            <span className="inline-flex items-center gap-1">
              <Users sx={{ fontSize: 13 }} className="text-gray-400"/>
              Team <span className="font-semibold text-gray-900">{team?.name || "—"}</span>
            </span>
            {recurring ? (
              <>
                <span className="inline-flex items-center gap-1">
                  <CalendarToday sx={{ fontSize: 12 }} className="text-gray-400"/>
                  <span>Start</span>
                  <span className="font-semibold text-gray-900">{fmtDateLong(date)}</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <CalendarToday sx={{ fontSize: 12 }} className="text-gray-400"/>
                  <span>End</span>
                  <span className="font-semibold text-gray-900">{fmtDateLong(recurring.end_date)}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 flex-wrap">
                  <span className="text-gray-600">Days</span>
                  {sortDayCodes(recurring.days || []).map((code) => (
                    <span
                      key={code}
                      className="group relative inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded text-[11px] font-bold text-white select-none cursor-default"
                      style={{ backgroundColor: "#ec9324" }}
                      data-testid={`proposal-day-${code}`}
                      aria-label={FULL_DAY_NAMES[code] || code}
                    >
                      {DAY_SHORT_LABELS[code] || code}
                      <span className="pointer-events-none absolute top-full mt-1.5 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                        {FULL_DAY_NAMES[code] || code}
                      </span>
                    </span>
                  ))}
                </span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1">
                <CalendarToday sx={{ fontSize: 12 }} className="text-gray-400"/>
                {fmtDateLong(date)}
              </span>
            )}
            <span className="ml-auto inline-flex items-center gap-2">
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white whitespace-nowrap"
                style={{ backgroundColor: "#ec9324" }}
              >
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
                    className="text-[11px] font-bold text-white rounded px-2 py-1"
                    style={{ backgroundColor: "#ec9324" }}
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
                    <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900 truncate" title={nameOf(r.empId)}>
                        {nameOf(r.empId)}
                      </span>
                      {subOf(r.empId) && (
                        <span className="text-[11px] text-gray-500 truncate">
                          {subOf(r.empId)}
                        </span>
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
                    <button
                      type="button"
                      onClick={() => setEditingSeatId(null)}
                      disabled={saving || !r.empId}
                      className="group relative inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
                      data-testid={`proposal-row-${r.seatId}-done`}
                      aria-label="Done"
                      title="Done"
                    >
                      <Check sx={{ fontSize: 18 }}/>
                      <span className="pointer-events-none absolute top-full mt-1.5 right-0 px-2 py-1 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                        Done
                      </span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => (r.empId ? clearRow(r.seatId) : setEditingSeatId(r.seatId))}
                        disabled={saving}
                        className="group relative inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
                        data-testid={`proposal-row-${r.seatId}-edit`}
                        aria-label="Edit"
                      >
                        <Pencil sx={{ fontSize: 17 }}/>
                        <span className="pointer-events-none absolute top-full mt-1.5 right-0 px-2 py-1 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                          Edit
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRow(r.seatId)}
                        disabled={saving}
                        className="group relative inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-red-50 text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                        data-testid={`proposal-row-${r.seatId}-remove`}
                        aria-label="Remove"
                      >
                        <Trash sx={{ fontSize: 17 }}/>
                        <span className="pointer-events-none absolute top-full mt-1.5 right-0 px-2 py-1 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                          Remove
                        </span>
                      </button>
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
