import React, { useCallback, useEffect, useMemo, useState } from "react";
import api, { formatApiError } from "../../lib/api";
import notify from "../../lib/notify";
import { useAuth } from "../../context/AuthContext";
import DateFilter, { dateFilterToParams } from "../../components/DateFilter";
import EventNote from "@mui/icons-material/EventNoteOutlined";
import Chair from "@mui/icons-material/Chair";
import CalendarToday from "@mui/icons-material/CalendarTodayOutlined";
import CheckCircle from "@mui/icons-material/CheckCircleOutlined";
import Cancel from "@mui/icons-material/CancelOutlined";
import Refresh from "@mui/icons-material/Refresh";
import HourglassEmpty from "@mui/icons-material/HourglassEmpty";
import RemoveCircle from "@mui/icons-material/RemoveCircleOutlineOutlined";
import Person from "@mui/icons-material/PersonOutlined";
import LocationOn from "@mui/icons-material/PlaceOutlined";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "../../components/ui/dialog";

/**
 * getCurrentMonthRange — returns {from, to} as ISO date strings covering
 * the current calendar month. Matches the "Default view: current month"
 * requirement of the My Bookings tab.
 */
function getCurrentMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

const STATUS_META = {
  "Pending Approval": { Icon: HourglassEmpty, color: "#ec9324", bg: "#fff7ed", border: "#fed7aa" },
  Approved:           { Icon: CheckCircle,    color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
  Declined:           { Icon: Cancel,         color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
  Cancelled:          { Icon: RemoveCircle,   color: "#64748b", bg: "#f1f5f9", border: "#cbd5e1" },
};

/**
 * MyRequestsTab — lists the current user's workstation requests inside the
 * right-hand pane of the Request Workstation page.
 *
 *   • Default range: current month (via DateFilter with `date` field).
 *   • Rows show seat, plan, date, status and are click-to-open in a
 *     detail dialog.
 *   • Auto-refresh button lives at the top-right of the tab body.
 */
export default function MyRequestsTab() {
  const { user } = useAuth();
  const [range, setRange] = useState(() => {
    const r = getCurrentMonthRange();
    return { field: "date", mode: "between", from: r.from, to: r.to };
  });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openReq, setOpenReq] = useState(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const params = { requested_by: user.id };
      const dq = dateFilterToParams(range) || {};
      // dateFilterToParams returns { date_field, date_from, date_to }. We
      // don't forward date_field — the requests endpoint filters purely on
      // the booking `date` column.
      if (dq.date_from) params.date_from = dq.date_from;
      if (dq.date_to)   params.date_to   = dq.date_to;
      const r = await api.get("/workstation-requests", { params });
      setItems(r.data || []);
    } catch (e) {
      notify.error(
        formatApiError(e?.response?.data?.detail) || "Failed to load your requests"
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, range]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    // Group by status, and inside each group sort by date desc so the most
    // recent request the user cares about is at the top.
    const g = { "Pending Approval": [], Approved: [], Declined: [], Cancelled: [] };
    for (const it of items) {
      const s = it.status || "Pending Approval";
      (g[s] = g[s] || []).push(it);
    }
    Object.values(g).forEach((arr) =>
      arr.sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    );
    return g;
  }, [items]);

  const totalCount = items.length;

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="my-bookings-tab">
      {/* Toolbar: date filter + refresh */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 bg-gray-50/50">
        <div className="flex-1 min-w-0">
          <DateFilter
            testId="my-bookings-date"
            fieldOptions={[{ value: "date", label: "Booking Date" }]}
            value={range}
            onChange={setRange}
            className="w-full"
          />
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          data-testid="my-bookings-refresh"
          className="inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-gray-100 text-gray-500 disabled:opacity-40"
          title="Refresh"
        >
          <Refresh sx={{ fontSize: 16 }} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* List body */}
      <div className="flex-1 overflow-y-auto px-3 py-3" data-testid="my-bookings-list">
        {loading && items.length === 0 && (
          <div className="text-center text-xs text-gray-400 py-8">Loading your requests…</div>
        )}
        {!loading && totalCount === 0 && (
          <div className="text-center text-xs text-gray-400 py-10 space-y-1">
            <EventNote sx={{ fontSize: 26 }} className="opacity-40" />
            <div>No requests in this range.</div>
            <div className="text-gray-400">Switch to the <span className="font-medium">Booking Form</span> tab to raise one.</div>
          </div>
        )}
        {!loading && totalCount > 0 && (
          <div className="space-y-4">
            {Object.entries(grouped).map(([status, arr]) =>
              arr.length ? (
                <div key={status}>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5 px-1 flex items-center gap-1">
                    {status} · {arr.length}
                  </div>
                  <div className="space-y-2">
                    {arr.map((r) => (
                      <RequestRow key={r.id} req={r} onClick={() => setOpenReq(r)} />
                    ))}
                  </div>
                </div>
              ) : null
            )}
          </div>
        )}
      </div>

      <RequestDetailDialog
        req={openReq}
        onOpenChange={(o) => !o && setOpenReq(null)}
      />
    </div>
  );
}

function RequestRow({ req, onClick }) {
  const meta = STATUS_META[req.status] || STATUS_META["Pending Approval"];
  const { Icon } = meta;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`my-booking-row-${req.id}`}
      className="w-full text-left rounded-lg border border-gray-200 bg-white hover:border-[#ec9324]/50 hover:shadow-sm transition-all px-3 py-2.5 flex items-start gap-2.5"
    >
      <span
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}
      >
        <Icon sx={{ fontSize: 15 }} />
      </span>
      <div className="flex-1 min-w-0 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div
            className="text-[13px] font-semibold text-gray-900 truncate"
            title="Workstation"
          >
            <Chair sx={{ fontSize: 12 }} className="inline mr-0.5 text-[#ec9324]" />
            {req.seat_label || "—"}
          </div>
          <div
            className="text-[11px] text-gray-500 mt-0.5 inline-flex items-center gap-0.5"
            title="Requested For"
          >
            <CalendarToday sx={{ fontSize: 10 }} /> {req.date || "—"}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold border whitespace-nowrap"
            style={{ color: meta.color, backgroundColor: meta.bg, borderColor: meta.border }}
            title="Status"
          >
            {req.status}
          </span>
          <span
            className="text-[11px] text-gray-500 truncate max-w-[160px] text-right"
            title="Floor"
          >
            {req.plan_name || "—"}
          </span>
        </div>
      </div>
    </button>
  );
}

function RequestDetailDialog({ req, onOpenChange }) {
  if (!req) return null;
  const meta = STATUS_META[req.status] || STATUS_META["Pending Approval"];
  const emp = req.employee || {};
  const requestedBy = req.requested_by || {};
  return (
    <Dialog open={!!req} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg p-0 gap-0 overflow-hidden"
        data-testid="my-booking-detail-dialog"
      >
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-gray-100">
          <DialogTitle className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Chair sx={{ fontSize: 16 }} className="text-[#ec9324]" />
            Workstation request · {req.seat_label || "—"}
          </DialogTitle>
        </DialogHeader>
        <div className="px-5 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <span
              className="text-[11px] px-2 py-0.5 rounded-full font-semibold border"
              style={{ color: meta.color, backgroundColor: meta.bg, borderColor: meta.border }}
            >
              {req.status}
            </span>
            <span className="text-[11px] text-gray-500">
              Requested {req.requested_on ? new Date(req.requested_on).toLocaleString() : "—"}
            </span>
          </div>

          <Field label="Date" icon={CalendarToday}>{req.date || "—"}</Field>
          <Field label="Floor plan" icon={LocationOn}>{req.plan_name || "—"}</Field>
          <Field label="Seat" icon={Chair}>{req.seat_label || "—"}</Field>
          <Field label="Employee" icon={Person}>
            {emp.name || "—"}
            {emp.emp_code && (
              <span className="ml-1 text-[11px] text-gray-500">({emp.emp_code})</span>
            )}
          </Field>
          {requestedBy?.name && requestedBy?.id !== emp.id && (
            <Field label="Requested by" icon={Person}>{requestedBy.name}</Field>
          )}
          {req.reason && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
                Reason
              </div>
              <div className="text-[12px] text-gray-700 whitespace-pre-line rounded border border-gray-100 bg-gray-50 p-2">
                {req.reason}
              </div>
            </div>
          )}
          {req.decided_at && (
            <div className="text-[11px] text-gray-500 border-t border-gray-100 pt-2">
              {req.status === "Approved" ? "Approved" : req.status === "Declined" ? "Declined" : "Decided"}{" "}
              by <span className="font-medium">{req.decided_by?.name || "—"}</span>{" "}
              on {new Date(req.decided_at).toLocaleString()}
              {req.decision_note && (
                <div className="mt-1 italic text-gray-600">“{req.decision_note}”</div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, icon: Icon, children }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-6 shrink-0 pt-0.5 text-gray-400">
        <Icon sx={{ fontSize: 14 }} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
          {label}
        </div>
        <div className="text-[13px] text-gray-900 mt-0.5">{children}</div>
      </div>
    </div>
  );
}
