/**
 * Pending Approvals page — approval queue for workstation requests.
 *
 * Layout (per spec):
 *   ┌─────────────────────────────────────┬─────────────────────────┐
 *   │ Interactive floor map (70%)         │  Approval cards (30%)   │
 *   │                                     │  scrollable list        │
 *   │                                     │  - Workstation ID       │
 *   │                                     │  - Requested by         │
 *   │                                     │  - Requested on         │
 *   │                                     │  - Requested for date   │
 *   │                                     │  - Approve / Decline    │
 *   └─────────────────────────────────────┴─────────────────────────┘
 *
 * Click a card → the floor map pans + zooms in on that workstation with a
 * brief highlight pulse (handled inside WorkstationFloorMap via centerOnSeatId).
 *
 * Only requests with status "Pending Approval" are shown here. Approved /
 * declined requests live in the Request History tab (Request Workstation page)
 * and approved requests also appear as bookings in the Bookings module.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, X, Loader2, Calendar, User, Clock, MapPin, RefreshCw, ShieldAlert, CheckSquare, Square, Settings, Sparkles } from "lucide-react";
import { toast } from "../lib/notify";
import Layout from "../components/Layout";
import api, { formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "../components/ui/dialog";
import WorkstationFloorMap from "../components/WorkstationFloorMap";
import ApprovalSettingsModal from "../components/ApprovalSettingsModal";
import { useAuth } from "../context/AuthContext";
import { useEffectivePage } from "../context/EffectivePermissionsContext";

// ----- helpers -----
const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
};

const fmtDateTime = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch { return iso; }
};

export default function PendingApprovalsPage() {
  const { user } = useAuth();
  // Until the Permissions module lands, gate to Super Admin (mirrors WS Booking).
  const canApprove = user?.role === "Super Admin";
  // ── Permissions V3 (Round 3) ──
  const { fn: permFn } = useEffectivePage("desk_booking", "pending_approvals");
  const permApprove   = permFn("approve");
  const permReject    = permFn("reject");
  const permConfigure = permFn("configure_auto_approval");
  const permRefresh   = permFn("refresh");

  // ----- floor plans -----
  const [plans, setPlans] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [plansLoading, setPlansLoading] = useState(true);

  // ----- pending requests on the selected plan/date -----
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [decidingId, setDecidingId] = useState(null);

  // ----- availability (so the floor map can render bookings + pendings) -----
  // We hydrate this per (plan, date) on demand. The right-side card list is
  // global (all pending requests across dates) so users can scan the full
  // queue, but the map only shows the seats for the request the user is
  // focusing on. When a card is clicked, we sync (plan, date) to that request
  // and pan to the seat.
  const [focusDate, setFocusDate] = useState(null);   // "YYYY-MM-DD"
  const [availability, setAvailability] = useState(null);
  const [availLoading, setAvailLoading] = useState(false);

  // Selected card → drives map pan/highlight
  const [focusRequest, setFocusRequest] = useState(null);
  const [centerSeatId, setCenterSeatId] = useState(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null); // 'approve' | 'decline' | null
  const [bulkProcessing, setBulkProcessing] = useState(false);

  // ----- Auto-Approval settings -----
  const [approvalSettings, setApprovalSettings] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [togglingAuto, setTogglingAuto] = useState(false);

  const loadApprovalSettings = useCallback(async () => {
    try {
      const { data } = await api.get("/approval-settings");
      setApprovalSettings(data);
    } catch (e) {
      // Not fatal — page still works, just no toggle state.
    }
  }, []);
  useEffect(() => { loadApprovalSettings(); }, [loadApprovalSettings]);

  const toggleAutoApproval = async (next) => {
    if (!canApprove) return;
    setTogglingAuto(true);
    try {
      const { data } = await api.put("/approval-settings", { enabled: next });
      setApprovalSettings(data);
      toast.success(`Auto Approval turned ${next ? "ON" : "OFF"}`);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Could not update setting");
    } finally {
      setTogglingAuto(false);
    }
  };

  // ----- initial load -----
  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    try {
      const res = await api.get("/workstation-requests/floor-plans");
      const list = res.data || [];
      setPlans(list);
      if (list.length && !selectedPlanId) setSelectedPlanId(list[0].id);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Failed to load floor plans");
    } finally {
      setPlansLoading(false);
    }
  }, [selectedPlanId]);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/workstation-requests", { params: { status: "Pending Approval" } });
      setRequests(res.data || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Failed to load pending requests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPlans(); }, [loadPlans]);
  useEffect(() => { loadRequests(); }, [loadRequests]);

  // When plan / focus date change → fetch availability for that combo
  useEffect(() => {
    if (!selectedPlanId || !focusDate) { setAvailability(null); return; }
    let cancelled = false;
    (async () => {
      setAvailLoading(true);
      try {
        const res = await api.get(`/workstation-requests/availability`, {
          params: { plan_id: selectedPlanId, date: focusDate },
        });
        if (!cancelled) setAvailability(res.data);
      } catch (e) {
        if (!cancelled) toast.error(formatApiError(e?.response?.data?.detail) || "Failed to load floor map");
      } finally {
        if (!cancelled) setAvailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPlanId, focusDate]);

  // When focus request set, sync plan + date and trigger pan
  const handleCardClick = (req) => {
    setFocusRequest(req);
    setSelectedPlanId(req.plan_id);
    setFocusDate(req.date);
    // setCenterSeatId is fired again with the same value after availability
    // loads (see the next effect), to ensure the pan happens after the seat
    // overlay is mounted.
    setCenterSeatId(req.seat_id);
  };

  // Re-trigger pan once the seats are rendered for the new plan/date
  useEffect(() => {
    if (!focusRequest || !availability) return;
    // Toggle to force the WorkstationFloorMap effect to re-fire.
    setCenterSeatId(null);
    const t = setTimeout(() => setCenterSeatId(focusRequest.seat_id), 40);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availability]);

  // -------- Bulk selection --------
  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const isAllSelected = requests.length > 0 && requests.every((r) => selectedIds.has(r.id));
  const toggleSelectAll = () => {
    if (isAllSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(requests.map((r) => r.id)));
  };
  // Filter out stale ids whenever the queue changes (derived, not effect)
  const activeRequestIds = useMemo(() => new Set(requests.map((r) => r.id)), [requests]);
  const effectiveSelectedIds = useMemo(() => {
    const out = new Set();
    selectedIds.forEach((id) => { if (activeRequestIds.has(id)) out.add(id); });
    return out;
  }, [selectedIds, activeRequestIds]);

  const performBulk = async (action) => {
    const ids = Array.from(effectiveSelectedIds);
    if (ids.length === 0) return;
    setBulkProcessing(true);
    try {
      const path = action === "approve" ? "/workstation-requests/bulk-approve" : "/workstation-requests/bulk-decline";
      const res = await api.post(path, { request_ids: ids });
      const okCount = res.data?.approved ?? res.data?.declined ?? 0;
      const failCount = res.data?.failed ?? 0;
      const verbPast = action === "approve" ? "approved" : "declined";
      if (failCount === 0) {
        toast.success(`${okCount} ${verbPast}`);
      } else {
        const reasons = (res.data?.results || []).filter((r) => !r.ok).slice(0, 3)
          .map((r) => `${r.seat_label || r.request_id}: ${r.reason}`).join("; ");
        toast.warning(`${okCount} ${verbPast}, ${failCount} failed${reasons ? ` — ${reasons}` : ""}`);
      }
      setSelectedIds(new Set());
      setBulkAction(null);
      await loadRequests();
      // refresh map if needed
      if (selectedPlanId && focusDate) {
        try {
          const r = await api.get(`/workstation-requests/availability`, {
            params: { plan_id: selectedPlanId, date: focusDate },
          });
          setAvailability(r.data);
        } catch { /* swallow */ }
      }
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || `Bulk ${action} failed`);
    } finally {
      setBulkProcessing(false);
    }
  };

  // -------- Approve / Decline actions --------
  const approve = async (req) => {
    if (!canApprove) { toast.error("Only Super Admin can approve workstation requests"); return; }
    setDecidingId(req.id);
    try {
      await api.post(`/workstation-requests/${req.id}/approve`);
      toast.success(`Approved request for workstation ${req.seat_label} (${fmtDate(req.date)})`);
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
      if (focusRequest?.id === req.id) setFocusRequest(null);
      if (availability) {
        // refresh map data so the seat now shows as Occupied
        const res = await api.get(`/workstation-requests/availability`, {
          params: { plan_id: selectedPlanId, date: focusDate },
        });
        setAvailability(res.data);
      }
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const msg = typeof detail === "object" && detail?.message ? detail.message : formatApiError(detail);
      toast.error(msg || "Failed to approve request");
    } finally {
      setDecidingId(null);
    }
  };

  const decline = async (req) => {
    if (!canApprove) { toast.error("Only Super Admin can decline workstation requests"); return; }
    setDecidingId(req.id);
    try {
      await api.post(`/workstation-requests/${req.id}/decline`);
      toast.success(`Declined request for workstation ${req.seat_label} (${fmtDate(req.date)})`);
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
      if (focusRequest?.id === req.id) setFocusRequest(null);
      if (availability) {
        const res = await api.get(`/workstation-requests/availability`, {
          params: { plan_id: selectedPlanId, date: focusDate },
        });
        setAvailability(res.data);
      }
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const msg = typeof detail === "object" && detail?.message ? detail.message : formatApiError(detail);
      toast.error(msg || "Failed to decline request");
    } finally {
      setDecidingId(null);
    }
  };

  // -------- Derived data for the floor map --------
  const bookingsBySeat = useMemo(() => {
    const m = {};
    for (const b of (availability?.bookings || [])) m[b.seat_id] = b;
    return m;
  }, [availability]);
  const requestsBySeat = useMemo(() => {
    const m = {};
    for (const r of (availability?.pending_requests || [])) m[r.seat_id] = r;
    return m;
  }, [availability]);

  // Group pending requests by plan for display headers
  const groupedRequests = useMemo(() => {
    const map = new Map();
    for (const r of requests) {
      const key = r.plan_id;
      if (!map.has(key)) map.set(key, { plan_id: r.plan_id, plan_name: r.plan_name, items: [] });
      map.get(key).items.push(r);
    }
    return Array.from(map.values());
  }, [requests]);

  const pendingCount = requests.length;

  return (
    <Layout
      title="Pending Approvals"
      fullBleed
      contentClassName="bg-gray-50"
      actions={
        <>
          {plans.length > 1 && (
            <select
              value={selectedPlanId}
              onChange={(e) => setSelectedPlanId(e.target.value)}
              className="text-sm rounded-md border border-gray-300 px-2 h-9 bg-white"
              data-testid="pa-plan-selector"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={loadRequests}
            className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
            title="Refresh"
            aria-label="Refresh"
            data-testid="pa-refresh"
            disabled={!permRefresh.canUse}
            hidden={!permRefresh.isVisible}
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </>
      }
    >
      <div className="flex flex-col h-[calc(100vh-4rem)] min-h-[560px]">
        {/* Header — pending count + Auto-Approval toggle + settings */}
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap" data-testid="pa-header">
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
            {pendingCount} pending
          </span>

          {/* Auto Approval toggle */}
          <div className="ml-auto flex items-center gap-2">
            <div className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-gray-200 bg-white">
              <Sparkles size={14} className="text-[#ec9324]" />
              <span className="text-xs font-medium text-gray-700">Auto Approval</span>
              <button
                type="button"
                role="switch"
                aria-checked={!!approvalSettings?.enabled}
                aria-label="Toggle Auto Approval"
                disabled={!canApprove || togglingAuto || !approvalSettings}
                onClick={() => toggleAutoApproval(!approvalSettings?.enabled)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#ec9324] focus:ring-offset-1 disabled:opacity-50 ${
                  approvalSettings?.enabled ? "bg-[#ec9324]" : "bg-gray-300"
                }`}
                data-testid="auto-approval-toggle"
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    approvalSettings?.enabled ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
              <span className={`text-[10px] font-semibold ${approvalSettings?.enabled ? "text-[#ec9324]" : "text-gray-400"}`}>
                {approvalSettings?.enabled ? "ON" : "OFF"}
              </span>
            </div>
            {permConfigure.isVisible && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              disabled={!canApprove || !permConfigure.canUse}
              className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
              title={canApprove ? "Approval settings" : "Only Super Admin can configure"}
              aria-label="Approval settings"
              data-testid="approval-settings-btn"
            >
              <Settings size={16} />
            </button>
            )}
          </div>
        </div>

        {!canApprove && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2 text-xs text-amber-800">
            <ShieldAlert size={14} /> Only Super Admin can approve or decline workstation requests.
          </div>
        )}

        {/* Body: 70% map | 30% cards */}
        <div className="flex-1 flex overflow-hidden">
          {/* ============ Left — floor map (70%) ============ */}
          <div className="flex-1 min-w-0 relative bg-gray-100" style={{ flexBasis: "70%" }}>
            {plansLoading ? (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                <Loader2 className="animate-spin mr-2" /> Loading floor plans…
              </div>
            ) : plans.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                No live floor plans available.
              </div>
            ) : !focusRequest ? (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm px-6 text-center">
                <div>
                  <MapPin className="mx-auto mb-2 text-gray-400" />
                  Select a pending request on the right to view it on the floor plan.
                </div>
              </div>
            ) : availability?.plan?.pdfUrl ? (
              <WorkstationFloorMap
                pdfUrl={availability.plan.pdfUrl}
                seats={availability.seats || []}
                bookingsBySeat={bookingsBySeat}
                requestsBySeat={requestsBySeat}
                selectedSeatIds={[]}
                onToggleSeat={() => { /* no selection on approval page */ }}
                onOpenBookingDetail={() => { /* booking details not needed here */ }}
                onOpenRequestDetail={(seat, req) => { if (req) handleCardClick(req); }}
                loading={availLoading}
                disabled={true}
                centerOnSeatId={centerSeatId}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                {availLoading ? <Loader2 className="animate-spin" /> : "No floor plan to render"}
              </div>
            )}
          </div>

          {/* ============ Right — approval cards (30%) ============ */}
          <div
            className="border-l border-gray-200 bg-white flex flex-col"
            style={{ flexBasis: "30%", minWidth: 320 }}
          >
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-700">Approval Queue</div>
              <span className="text-[11px] text-gray-500">Newest first</span>
            </div>

            {/* Bulk selection toolbar */}
            {canApprove && requests.length > 0 && (
              <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="inline-flex items-center gap-1.5 text-[12px] text-gray-700 hover:text-[#ec9324]"
                  data-testid="pa-select-all"
                >
                  {isAllSelected ? <CheckSquare size={14} className="text-[#ec9324]"/> : <Square size={14}/>}
                  {isAllSelected ? "Unselect all" : "Select all"}
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-500" data-testid="pa-selected-count">
                    {effectiveSelectedIds.size} selected
                  </span>
                  {permApprove.isVisible && (
                  <Button
                    size="sm"
                    disabled={effectiveSelectedIds.size === 0 || bulkProcessing || !permApprove.canUse}
                    onClick={() => setBulkAction("approve")}
                    className="h-7 px-2 bg-green-600 hover:bg-green-700 text-white text-[11px]"
                    data-testid="pa-bulk-approve"
                  >
                    <Check size={12} className="mr-1"/> Approve
                  </Button>
                  )}
                  {permReject.isVisible && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={effectiveSelectedIds.size === 0 || bulkProcessing || !permReject.canUse}
                    onClick={() => setBulkAction("decline")}
                    className="h-7 px-2 text-red-600 border-red-200 hover:bg-red-50 text-[11px]"
                    data-testid="pa-bulk-decline"
                  >
                    <X size={12} className="mr-1"/> Decline
                  </Button>
                  )}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {loading ? (
                <div className="text-center text-sm text-gray-500 py-10">
                  <Loader2 className="inline animate-spin mr-2" /> Loading…
                </div>
              ) : requests.length === 0 ? (
                <div className="text-center text-sm text-gray-400 py-10">
                  No pending approvals. 🎉
                </div>
              ) : (
                groupedRequests.map((grp) => (
                  <div key={grp.plan_id} className="space-y-2">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold px-1">
                      {grp.plan_name || "Floor Plan"}
                    </div>
                    {grp.items.map((req) => {
                      const focused = focusRequest?.id === req.id;
                      const busy = decidingId === req.id;
                      return (
                        <div
                          key={req.id}
                          onClick={() => handleCardClick(req)}
                          className={`rounded-lg border p-3 cursor-pointer transition shadow-sm ${
                            focused
                              ? "border-[#ec9324] ring-2 ring-[#ec9324]/30 bg-orange-50"
                              : "border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50"
                          }`}
                          data-testid={`pa-card-${req.id}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                              {canApprove && (
                                <div onClick={(e) => e.stopPropagation()}>
                                  <Checkbox
                                    checked={effectiveSelectedIds.has(req.id)}
                                    onCheckedChange={() => toggleSelect(req.id)}
                                    data-testid={`pa-select-${req.id}`}
                                    aria-label="Select request"
                                  />
                                </div>
                              )}
                              <div className="font-semibold text-sm text-gray-900 truncate">
                                Workstation {req.seat_label}
                              </div>
                            </div>
                            <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 whitespace-nowrap">
                              Pending
                            </span>
                          </div>

                          <div className="mt-2 space-y-1 text-[12px] text-gray-700">
                            <div className="flex items-center gap-1.5">
                              <User size={12} className="text-gray-400" />
                              <span className="truncate">For: <strong>{(req.employee || {}).name || "—"}</strong></span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Calendar size={12} className="text-gray-400" />
                              <span>For date: <strong>{fmtDate(req.date)}</strong></span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <User size={12} className="text-gray-400" />
                              <span className="truncate">Requested by: {(req.requested_by || {}).name || "—"}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Clock size={12} className="text-gray-400" />
                              <span>{fmtDateTime(req.requested_on)}</span>
                            </div>
                          </div>

                          <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                            {permApprove.isVisible && (
                            <Button
                              size="sm"
                              disabled={!canApprove || busy || !permApprove.canUse}
                              onClick={() => approve(req)}
                              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                              data-testid={`pa-approve-${req.id}`}
                            >
                              {busy ? <Loader2 className="animate-spin" size={14} /> : <><Check size={14} className="mr-1" /> Approve</>}
                            </Button>
                            )}
                            {permReject.isVisible && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canApprove || busy || !permReject.canUse}
                              onClick={() => decline(req)}
                              className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                              data-testid={`pa-decline-${req.id}`}
                            >
                              {busy ? <Loader2 className="animate-spin" size={14} /> : <><X size={14} className="mr-1" /> Decline</>}
                            </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bulk action confirmation dialog */}
      <Dialog open={!!bulkAction} onOpenChange={(o) => !o && setBulkAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle data-testid="pa-bulk-confirm-title">
              {bulkAction === "approve" ? "Approve" : "Decline"} {effectiveSelectedIds.size} request{effectiveSelectedIds.size !== 1 ? "s" : ""}?
            </DialogTitle>
            <DialogDescription>
              {bulkAction === "approve"
                ? `This will approve ${effectiveSelectedIds.size} workstation request${effectiveSelectedIds.size !== 1 ? "s" : ""} and create the corresponding booking${effectiveSelectedIds.size !== 1 ? "s" : ""}.`
                : `This will decline ${effectiveSelectedIds.size} workstation request${effectiveSelectedIds.size !== 1 ? "s" : ""} and release the workstation${effectiveSelectedIds.size !== 1 ? "s" : ""}.`}
              {" "}If any item can&apos;t be processed (seat already booked by someone else), the rest will still be processed and a summary will be shown.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkAction(null)}
              disabled={bulkProcessing}
              data-testid="pa-bulk-cancel"
            >Cancel</Button>
            <Button
              onClick={() => performBulk(bulkAction)}
              disabled={bulkProcessing}
              className={bulkAction === "approve"
                ? "bg-green-600 hover:bg-green-700 text-white"
                : "bg-red-600 hover:bg-red-700 text-white"}
              data-testid="pa-bulk-confirm"
            >
              {bulkProcessing ? <Loader2 className="animate-spin mr-2" size={14}/> : null}
              Confirm {bulkAction === "approve" ? "Approve" : "Decline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approval Settings modal */}
      <ApprovalSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initial={approvalSettings}
        onSaved={(fresh) => setApprovalSettings(fresh)}
      />
    </Layout>
  );
}
