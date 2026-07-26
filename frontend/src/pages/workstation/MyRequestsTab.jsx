import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import EditOutlined from "@mui/icons-material/EditOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutlineOutlined";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";

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
  const [editReq, setEditReq] = useState(null);
  const [deleteReq, setDeleteReq] = useState(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const params = { requested_by: user.id, include_hidden: false };
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

  // ─── Deep-link handling ────────────────────────────────────────────────
  // Bell notifications for workstation_request_approved / declined route to
  // /workspace-manager/request-workstation?requestId=<id>. We wait for the
  // request list to load, find the matching row, and pop the detail dialog.
  // If the id isn't in the current visible range we broaden the date range
  // to "All" (whole year) so the notification can still be inspected.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkRequestId = searchParams.get("requestId");
  const deepLinkAppliedRef = useRef(null);
  const deepLinkExpandedRef = useRef(false);
  // Marked true once the very first load() completes (regardless of item
  // count) — prevents the deep-link effect from mistaking the pre-fetch
  // empty state for "target not found".
  const hasLoadedOnceRef = useRef(false);
  // Tracks whether we've observed a full load cycle (loading true → false).
  // Prevents the deep-link effect from running before the initial fetch
  // even starts (initial state has loading=false but items=[]).
  const seenLoadingRef = useRef(false);
  // True from the moment we call setRange (widening the search window)
  // until the next load() cycle finishes — so the effect doesn't hit the
  // "still missing → error" branch before the new fetch resolves.
  const justWidenedRef = useRef(false);
  useEffect(() => {
    if (loading) {
      seenLoadingRef.current = true;
    } else if (seenLoadingRef.current) {
      hasLoadedOnceRef.current = true;
      justWidenedRef.current = false;   // load cycle completed
    }
  }, [loading, items]);
  useEffect(() => {
    if (!deepLinkRequestId) return;
    if (loading) return;
    if (!hasLoadedOnceRef.current) return;                 // wait for 1st fetch
    if (justWidenedRef.current) return;                    // widen fetch pending
    if (deepLinkAppliedRef.current === deepLinkRequestId) return;
    const match = items.find((r) => r.id === deepLinkRequestId);
    if (match) {
      deepLinkAppliedRef.current = deepLinkRequestId;
      setOpenReq(match);
      const sp = new URLSearchParams(searchParams);
      sp.delete("requestId");
      setSearchParams(sp, { replace: true });
      return;
    }
    // Not in the currently-loaded window — try widening the date range once
    // before giving up. This handles the "declined last month" case.
    if (!deepLinkExpandedRef.current) {
      deepLinkExpandedRef.current = true;
      justWidenedRef.current = true;
      seenLoadingRef.current = false;      // wait for new load cycle
      const today = new Date();
      const from = new Date(today.getFullYear() - 1, 0, 1).toISOString().slice(0, 10);
      const to = new Date(today.getFullYear() + 1, 11, 31).toISOString().slice(0, 10);
      setRange((prev) => ({ ...prev, mode: "between", from, to }));
      return;
    }
    // Still missing after widening → deleted / no permission.
    deepLinkAppliedRef.current = deepLinkRequestId;
    notify.error("Request no longer available");
    const sp = new URLSearchParams(searchParams);
    sp.delete("requestId");
    setSearchParams(sp, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkRequestId, loading, items]);

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
            fields={["date"]}
            label="Requested For"
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
                      <RequestRow
                        key={r.id}
                        req={r}
                        onClick={() => setOpenReq(r)}
                        onEdit={() => setEditReq(r)}
                        onDelete={() => setDeleteReq(r)}
                      />
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
        onEdit={(r) => { setOpenReq(null); setEditReq(r); }}
        onDelete={(r) => { setOpenReq(null); setDeleteReq(r); }}
      />
      <EditRequestDialog
        req={editReq}
        onClose={() => setEditReq(null)}
        onSaved={() => { setEditReq(null); load(); }}
      />
      <DeleteRequestDialog
        req={deleteReq}
        onClose={() => setDeleteReq(null)}
        onDeleted={() => { setDeleteReq(null); load(); }}
      />
    </div>
  );
}

/** Small dark chip that appears on hover — same visual as the topbar
 *  Notification Bell tooltip. `side` controls whether it renders above or
 *  below the trigger; use "below" inside overflow-clipped containers like
 *  Dialogs so the chip isn't cropped.
 */
function HoverChip({ label, align = "left", side = "above" }) {
  const alignCls = align === "right" ? "right-0" : "left-0";
  const sideCls = side === "below" ? "top-full mt-1" : "bottom-full mb-1";
  return (
    <span
      className={`pointer-events-none absolute ${sideCls} ${alignCls} px-2 py-1 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg`}
    >
      {label}
    </span>
  );
}

function RequestRow({ req, onClick, onEdit, onDelete }) {
  const meta = STATUS_META[req.status] || STATUS_META["Pending Approval"];
  const { Icon } = meta;
  const isPending = req.status === "Pending Approval";

  const handleKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  };
  const stop = (e) => e.stopPropagation();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKey}
      data-testid={`my-booking-row-${req.id}`}
      className="w-full text-left rounded-lg border border-gray-200 bg-white hover:border-[#ec9324]/50 hover:shadow-sm transition-all px-3 py-2.5 flex items-start gap-2.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#ec9324]/40"
    >
      <span
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}
      >
        <Icon sx={{ fontSize: 15 }} />
      </span>
      <div className="flex-1 min-w-0 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="group relative w-fit max-w-full">
            <div className="text-[13px] font-semibold text-gray-900 truncate flex items-center gap-1.5">
              <Chair sx={{ fontSize: 12 }} className="text-[#ec9324]" />
              <span>{req.seat_label || "—"}</span>
              {req.seq_no != null && (
                <span
                  className="font-mono text-[10px] font-medium text-gray-500 bg-gray-100 rounded px-1.5 py-0.5"
                  data-testid={`my-booking-seq-${req.id}`}
                >
                  {req.seq_no}
                </span>
              )}
            </div>
            <HoverChip label="Workstation" align="left" />
          </div>
          <div className="group relative w-fit mt-0.5">
            <div className="inline-flex items-center gap-0.5 text-[11px] text-gray-500">
              <CalendarToday sx={{ fontSize: 10 }} /> {req.date || "—"}
            </div>
            <HoverChip label="Requested For" align="left" />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
          <div className="group relative">
            <span
              className="inline-block text-[9px] px-1.5 py-0.5 rounded-full font-semibold border whitespace-nowrap"
              style={{ color: meta.color, backgroundColor: meta.bg, borderColor: meta.border }}
            >
              {req.status}
            </span>
            <HoverChip label="Status" align="right" />
          </div>
          <div className="group relative max-w-[160px]">
            <span className="block text-[11px] text-gray-500 truncate text-right">
              {req.plan_name || "—"}
            </span>
            <HoverChip label="Floor" align="right" />
          </div>
          {isPending && (
            <div className="flex items-center gap-0.5 mt-0.5" onClick={stop}>
              <button
                type="button"
                onClick={(e) => { stop(e); onEdit?.(); }}
                data-testid={`my-booking-edit-${req.id}`}
                aria-label="Edit request"
                className="group relative w-6 h-6 inline-flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 hover:text-[#ec9324]"
              >
                <EditOutlined sx={{ fontSize: 14 }} />
                <HoverChip label="Edit" align="right" />
              </button>
              <button
                type="button"
                onClick={(e) => { stop(e); onDelete?.(); }}
                data-testid={`my-booking-delete-${req.id}`}
                aria-label="Delete request"
                className="group relative w-6 h-6 inline-flex items-center justify-center rounded hover:bg-[#fff7ed] text-gray-500 hover:text-[#ec9324]"
              >
                <DeleteOutline sx={{ fontSize: 14 }} />
                <HoverChip label="Delete" align="right" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RequestDetailDialog({ req, onOpenChange, onEdit, onDelete }) {
  if (!req) return null;
  const meta = STATUS_META[req.status] || STATUS_META["Pending Approval"];
  const emp = req.employee || {};
  const requestedBy = req.requested_by || {};
  const isPending = req.status === "Pending Approval";
  return (
    <Dialog open={!!req} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg p-0 gap-0 overflow-hidden"
        data-testid="my-booking-detail-dialog"
      >
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-gray-100">
          <DialogTitle className="text-sm font-semibold text-gray-900 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 min-w-0">
              <Chair sx={{ fontSize: 16 }} className="text-[#ec9324] shrink-0" />
              <span className="truncate">Workstation request · {req.seat_label || "—"}</span>
              {req.seq_no != null && (
                <span
                  className="font-mono text-[11px] font-medium text-gray-500 bg-gray-100 rounded px-1.5 py-0.5"
                  data-testid="my-booking-detail-seq"
                >
                  {req.seq_no}
                </span>
              )}
            </span>
            {isPending && (
              <span className="flex items-center gap-1 mr-6">
                <button
                  type="button"
                  onClick={() => onEdit?.(req)}
                  data-testid="my-booking-detail-edit"
                  aria-label="Edit request"
                  className="group relative w-7 h-7 inline-flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 hover:text-[#ec9324]"
                >
                  <EditOutlined sx={{ fontSize: 16 }} />
                  <HoverChip label="Edit" align="right" side="below" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete?.(req)}
                  data-testid="my-booking-detail-delete"
                  aria-label="Delete request"
                  className="group relative w-7 h-7 inline-flex items-center justify-center rounded hover:bg-[#fff7ed] text-gray-500 hover:text-[#ec9324]"
                >
                  <DeleteOutline sx={{ fontSize: 16 }} />
                  <HoverChip label="Delete" align="right" side="below" />
                </button>
              </span>
            )}
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


/**
 * EditRequestDialog — allows the requester (or a Super Admin) to change the
 * booking date and/or seat on a Pending Approval workstation request. The
 * new seat must belong to the same floor plan. Availability for the target
 * date is fetched live so unavailable seats are marked in the dropdown.
 */
function EditRequestDialog({ req, onClose, onSaved }) {
  const [date, setDate] = useState("");
  const [seatId, setSeatId] = useState("");
  const [seats, setSeats] = useState([]);
  const [bookedSeatIds, setBookedSeatIds] = useState([]);
  const [pendingSeatIds, setPendingSeatIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!req) return;
    setDate(req.date || "");
    setSeatId(req.seat_id || "");
    setSeats([]);
    setBookedSeatIds([]);
    setPendingSeatIds([]);
  }, [req?.id]);

  // Load seats + availability for the current plan on the selected date.
  useEffect(() => {
    if (!req || !date) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await api.get("/workstation-requests/availability", {
          params: { plan_id: req.plan_id, date },
        });
        if (cancelled) return;
        setSeats(r.data?.seats || []);
        setBookedSeatIds(r.data?.booked_seat_ids || []);
        // Exclude this request itself from the "pending" lock so the user can
        // keep the same seat when only changing the date.
        setPendingSeatIds(
          (r.data?.pending_seat_ids || []).filter(
            (sid) => sid !== req.seat_id || date !== req.date,
          ),
        );
      } catch (e) {
        if (!cancelled) {
          notify.error(formatApiError(e?.response?.data?.detail) || "Failed to load seats");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [req?.id, req?.plan_id, req?.seat_id, req?.date, date]);

  const seatOptions = useMemo(() => {
    return (seats || []).map((s) => {
      const unavailable =
        bookedSeatIds.includes(s.id) ||
        pendingSeatIds.filter((sid) => sid !== req?.seat_id).includes(s.id);
      const isCurrent = s.id === req?.seat_id;
      return {
        id: s.id,
        label: s.label || s.id,
        unavailable: unavailable && !isCurrent,
      };
    }).sort((a, b) => (a.label || "").localeCompare(b.label || ""));
  }, [seats, bookedSeatIds, pendingSeatIds, req?.seat_id]);

  const dirty = req && (date !== req.date || seatId !== req.seat_id);

  const save = async () => {
    if (!req) return;
    if (!dirty) { onClose?.(); return; }
    setSaving(true);
    try {
      await api.patch(`/workstation-requests/${req.id}`, {
        date, seat_id: seatId,
      });
      notify.success("Request updated");
      onSaved?.();
    } catch (e) {
      notify.error(formatApiError(e?.response?.data?.detail) || "Failed to update request");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!req} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden" data-testid="my-booking-edit-dialog">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-gray-100">
          <DialogTitle className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <EditOutlined sx={{ fontSize: 16 }} className="text-[#ec9324]" />
            Edit workstation request
          </DialogTitle>
        </DialogHeader>
        <div className="px-5 py-4 space-y-4">
          <div className="text-[11px] text-gray-500">
            Floor plan · <span className="font-medium text-gray-700">{req?.plan_name || "—"}</span>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold block mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              data-testid="my-booking-edit-date"
              className="w-full text-sm rounded-md border border-gray-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#ec9324]/40"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold block mb-1">
              Workstation {loading && <span className="text-gray-400 normal-case">· loading…</span>}
            </label>
            <select
              value={seatId}
              onChange={(e) => setSeatId(e.target.value)}
              disabled={loading || seatOptions.length === 0}
              data-testid="my-booking-edit-seat"
              className="w-full text-sm rounded-md border border-gray-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#ec9324]/40 disabled:bg-gray-50"
            >
              {seatOptions.length === 0 && <option value={seatId}>{req?.seat_label || "—"}</option>}
              {seatOptions.map((s) => (
                <option key={s.id} value={s.id} disabled={s.unavailable}>
                  {s.label}{s.unavailable ? " (occupied)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter className="px-5 py-3 border-t border-gray-100 bg-gray-50/50">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={saving}
            data-testid="my-booking-edit-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving || !dirty}
            className="bg-[#ec9324] hover:bg-[#d47f10] text-white"
            data-testid="my-booking-edit-save"
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/**
 * DeleteRequestDialog — confirms a soft-delete of a Pending Approval request.
 * On confirm, the request is set to Cancelled and hidden from both the
 * requester's My Bookings tab and the admin's Workstation Requests table.
 * It continues to appear in the aggregated Bookings module.
 */
function DeleteRequestDialog({ req, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const del = async () => {
    if (!req) return;
    setBusy(true);
    try {
      await api.delete(`/workstation-requests/${req.id}`);
      notify.success("Request deleted");
      onDeleted?.();
    } catch (e) {
      notify.error(formatApiError(e?.response?.data?.detail) || "Failed to delete request");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!req} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden" data-testid="my-booking-delete-dialog">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-gray-100">
          <DialogTitle className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <DeleteOutline sx={{ fontSize: 16 }} className="text-[#ec9324]" />
            Delete workstation request?
          </DialogTitle>
        </DialogHeader>
        <div className="px-5 py-4 text-[13px] text-gray-700">
          Do you wanna proceed with Deleting your request
        </div>
        <DialogFooter className="px-5 py-3 border-t border-gray-100 bg-gray-50/50">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={busy}
            data-testid="my-booking-delete-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={del}
            disabled={busy}
            className="bg-[#ec9324] hover:bg-[#d47f10] text-white"
            data-testid="my-booking-delete-confirm"
          >
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
