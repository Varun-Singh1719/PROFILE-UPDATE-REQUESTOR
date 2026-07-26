/*
 * FloorSeatDetailDialog
 * ─────────────────────
 * Centered modal that renders the booking / pending-request details for a
 * workstation clicked on any Floor Map screen (Floor Layout, Workstation
 * Booking, Request Workstation). Shared across all three screens so the
 * design and behaviour stay consistent.
 *
 * Behaviour (per July-2026 spec):
 *   • Opens without navigating away from the current screen.
 *   • Closes on ✕ button, Esc key, or clicking outside the dialog.
 *   • NEVER redirects the user to the Bookings module — respects the
 *     "user may not have Bookings access" constraint.
 *
 * Props:
 *   detail   – { kind: 'booking' | 'request', seat, data } or null
 *   onClose  – () => void
 */
import React from "react";
import X from "@mui/icons-material/Close";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import PersonIcon from "./icons/PersonIcon";
import WorkspacesIcon from "./icons/WorkspacesIcon";
import CalendarMonthIcon from "./icons/CalendarMonthIcon";
import { paletteForTeam, teamBackground } from "../lib/teamColors";

// Fallback for legacy hex team colours where paletteForTeam returns a
// single stop or a raw string.
const teamBg = (color) => {
  if (!color) return "#ec9324";
  const stops = paletteForTeam(color);
  if (Array.isArray(stops) && stops.length >= 2) return teamBackground(color);
  return teamBackground(color) || color;
};

const fmtIsoDate = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString(undefined, {
      weekday: "short", day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return String(iso); }
};
const fmtIsoDateTime = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch { return String(iso); }
};

function Row({ icon, label, value, valueClass = "" , testId }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 text-slate-600">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-gray-500">{label}</div>
        <div
          className={`text-sm font-medium text-gray-900 ${valueClass}`.trim()}
          data-testid={testId}
        >
          {value || "—"}
        </div>
      </div>
    </div>
  );
}

export default function FloorSeatDetailDialog({ detail, onClose }) {
  if (!detail) return null;
  const { kind, seat, data } = detail;
  const isPending = kind === "request";
  const employee = data.employee || {};
  const requestedBy = data.requested_by || {};
  const teamColor = data.team_color;
  const teamName = data.team_name || "—";
  const bg = teamColor ? teamBg(teamColor) : "#ec9324";

  // Booking id shown to end-users — prefer seq_no (short, human-friendly).
  const displayId = data.seq_no || data.id || "—";
  const idPrefix = isPending ? "Request #" : "Booking #";

  return (
    <Dialog open={!!detail} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="sm:max-w-md"
        data-testid={isPending ? "floor-request-detail-dialog" : "floor-booking-detail-dialog"}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-gray-900 pr-6">
            <div
              className="w-2.5 h-2.5 rounded-full ring-1 ring-black/10 flex-shrink-0"
              style={{ background: isPending ? "#111111" : bg }}
            />
            Workstation {seat?.label || data.seat_label || "—"}
            {isPending && (
              <span className="ml-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 ring-1 ring-amber-200">
                Pending
              </span>
            )}
            {!isPending && (
              <span className="ml-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200">
                Booked
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {/* Booking / Request identifier */}
          <Row
            icon={<span className="text-xs font-bold">#</span>}
            label={isPending ? "Request ID" : "Booking ID"}
            value={<span className="tabular-nums">{idPrefix}{displayId}</span>}
            testId="floor-detail-id"
          />

          {/* Employee */}
          <Row
            icon={<PersonIcon size={16} />}
            label="Employee"
            value={
              <div className="min-w-0">
                <div className="truncate" data-testid="floor-detail-employee">
                  {employee.name || "—"}
                </div>
                {(employee.emp_id || employee.email) && (
                  <div className="text-[11px] text-gray-500 truncate font-normal">
                    {employee.emp_id || ""}{employee.emp_id && employee.email ? " · " : ""}{employee.email || ""}
                  </div>
                )}
              </div>
            }
          />

          {/* Team */}
          {(data.team_name || data.team_id) && (
            <div className="flex items-start gap-2.5">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white ring-1 ring-black/5"
                style={{ background: bg }}
              >
                <WorkspacesIcon size={16} color="#ffffff" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-gray-500">Team</div>
                <div className="text-sm font-medium text-gray-900 truncate" data-testid="floor-detail-team">
                  {teamName}
                </div>
              </div>
            </div>
          )}

          {/* Date */}
          <Row
            icon={<CalendarMonthIcon size={16} />}
            label={isPending ? "Requested For" : "Booking Date"}
            value={<span data-testid="floor-detail-date">{fmtIsoDate(data.date)}</span>}
          />

          {/* Floor / Plan */}
          {(data.plan_name || data.plan) && (
            <Row
              icon={<span className="text-xs font-bold">P</span>}
              label="Floor Plan"
              value={data.plan_name || data.plan?.name}
              testId="floor-detail-plan"
            />
          )}

          {/* Meta — booked by / requested by / created */}
          {(data.created_at || requestedBy.name || (data.decided_by || {}).name) && (
            <div className="pt-2 mt-1 border-t border-gray-100 text-[11.5px] text-gray-500 space-y-1">
              {isPending && requestedBy.name && (
                <div>
                  Requested by <span className="text-gray-800 font-medium">{requestedBy.name}</span>
                </div>
              )}
              {!isPending && requestedBy.name && (
                <div>
                  Booked by <span className="text-gray-800 font-medium">{requestedBy.name}</span>
                </div>
              )}
              {data.created_at && (
                <div>
                  {isPending ? "Requested on " : "Booked on "}
                  <span className="text-gray-800">{fmtIsoDateTime(data.created_at)}</span>
                </div>
              )}
              {(data.decided_by || {}).name && (
                <div>
                  Decided by <span className="text-gray-800 font-medium">{data.decided_by.name}</span>
                  {data.decided_on ? (
                    <> on <span className="text-gray-800">{fmtIsoDateTime(data.decided_on)}</span></>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-3 border-t border-gray-100 mt-1">
          <Button
            variant="outline"
            onClick={onClose}
            data-testid="floor-detail-close"
          >
            <X sx={{ fontSize: 14 }} className="mr-1.5" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
