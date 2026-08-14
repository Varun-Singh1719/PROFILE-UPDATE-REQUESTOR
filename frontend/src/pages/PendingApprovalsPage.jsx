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
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Check from "@mui/icons-material/Check";
import X from "@mui/icons-material/Close";
import Loader2 from "@mui/icons-material/Autorenew";
import Calendar from "@mui/icons-material/CalendarTodayOutlined";
import User from "@mui/icons-material/PersonOutlined";
import Clock from "@mui/icons-material/AccessTime";
import RefreshCw from "@mui/icons-material/Refresh";
import ShieldAlert from "@mui/icons-material/GppMaybeOutlined";
import CheckSquare from "@mui/icons-material/CheckBoxOutlined";
import Square from "@mui/icons-material/CheckBoxOutlineBlank";
import Settings from "@mui/icons-material/SettingsOutlined";
import Sparkles from "@mui/icons-material/AutoAwesomeOutlined";
import { toast } from "../lib/notify";
import Layout from "../components/Layout";
import api, { formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { BulkSelectCheckbox } from "../components/ui/bulk-select-checkbox";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "../components/ui/dialog";
import WorkstationFloorMap from "../components/WorkstationFloorMap";
import ApprovalSettingsModal from "../components/ApprovalSettingsModal";
import SingleSelect from "../components/SingleSelect";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import { useAuth } from "../context/AuthContext";
import { useEffectivePage } from "../context/EffectivePermissionsContext";

// ----- helpers -----
const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  } catch { return iso; }
};

const fmtDateTime = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
  } catch { return iso; }
};

export default function PendingApprovalsPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "Super Admin";
  // ── Permissions V3 (Round 3) ──
  const { fn: permFn } = useEffectivePage("desk_booking", "pending_approvals");
  const permApprove   = permFn("approve");
  const permReject    = permFn("reject");
  const permConfigure = permFn("configure_auto_approval");
  const permRefresh   = permFn("refresh");
  // `canApprove` is the coarse "can act on approvals at all" gate used to show
  // the approve/decline controls and the settings gear. It now honours the v3
  // permission set (approve OR reject function granted) instead of being
  // hard-locked to Super Admin. Per-button gates still check the specific
  // function (permApprove.canUse / permReject.canUse / permConfigure.canUse),
  // and the backend enforces the same via require_v3_function.
  const canApprove = isSuperAdmin || permApprove.canUse || permReject.canUse || permConfigure.canUse;

  // ----- floor plans -----
  const [plans, setPlans] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [plansLoading, setPlansLoading] = useState(true);

  // ----- pending requests on the selected plan/date -----
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [decidingId, setDecidingId] = useState(null);

  // Type filter (workstation / meeting_room / all) — default "all" so the
  // approver sees the full queue.
  const [typeFilter, setTypeFilter] = useState("all"); // 'all' | 'workstation' | 'meeting_room'

  // ----- availability (so the floor map can render bookings + pendings) -----
  // We hydrate this per (plan, date) on demand. The right-side card list is
  // global (all pending requests across dates) so users can scan the full
  // queue, but the map only shows the seats for the request the user is
  // focusing on. When a card is clicked, we sync (plan, date) to that request
  // and pan to the seat.
  const [focusDate, setFocusDate] = useState(() => {
    // Default to today (YYYY-MM-DD) so the floor map loads immediately when
    // the page opens — matches the Request Workstation UX where the plan is
    // visible right away, before the user has picked a request.
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const [availability, setAvailability] = useState(null);
  const [availLoading, setAvailLoading] = useState(false);

  // Selected card → drives map pan/highlight. We keep ONE floor map mounted
  // for the currently-selected plan; card clicks just shift the camera
  // between a workstation (`centerSeatId`) and a meeting room (`centerRoomId`).
  const [focusRequest, setFocusRequest] = useState(null);
  const [centerSeatId, setCenterSeatId] = useState(null);
  const [centerRoomId, setCenterRoomId] = useState(null);

  // Full list of meeting rooms across all live plans (lazy). We filter down
  // to the currently-selected plan when passing to the map so both
  // workstations and meeting rooms show on the SAME PDF.
  const [mrRooms, setMrRooms] = useState([]);
  const [mrRoomsLoading, setMrRoomsLoading] = useState(false);
  const loadMrRoomsOnce = useCallback(async () => {
    if (mrRooms.length || mrRoomsLoading) return;
    setMrRoomsLoading(true);
    try {
      const res = await api.get("/room-bookings/rooms");
      setMrRooms(res.data || []);
    } catch { /* non-fatal */ } finally {
      setMrRoomsLoading(false);
    }
  }, [mrRooms.length, mrRoomsLoading]);
  useEffect(() => { loadMrRoomsOnce(); }, [loadMrRoomsOnce]);

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
      // Load workstation and/or meeting-room pending requests based on the
      // current type filter. Each row is tagged with `_type` so the card
      // renderer + approve/decline handlers know which endpoint to hit.
      const wantWorkstation = typeFilter === "all" || typeFilter === "workstation";
      const wantMeeting     = typeFilter === "all" || typeFilter === "meeting_room";
      const promises = [];
      if (wantWorkstation) {
        promises.push(
          api.get("/workstation-requests", { params: { status: "Pending Approval" } })
             .then((r) => (r.data || []).map((x) => ({ ...x, _type: "workstation" })))
             .catch(() => []),
        );
      }
      if (wantMeeting) {
        promises.push(
          api.get("/meeting-room-requests", { params: { status: "Pending Approval" } })
             .then((r) => (r.data || []).map((x) => ({ ...x, _type: "meeting_room" })))
             .catch(() => []),
        );
      }
      const results = await Promise.all(promises);
      const combined = results.flat();
      // Newest first (workstation uses `requested_on`, so does meeting-room).
      combined.sort((a, b) => String(b.requested_on || "").localeCompare(String(a.requested_on || "")));
      setRequests(combined);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Failed to load pending requests");
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => { loadPlans(); }, [loadPlans]);
  useEffect(() => { loadRequests(); }, [loadRequests]);

  // ─── Deep-link handling ────────────────────────────────────────────────
  // Bell-notification action_urls carry `?requestId=<id>` so opening a
  // "Pending Approval — …" alert lands here with the exact request auto-
  // focused (camera panned + card visually highlighted). If the id is not
  // in the currently-loaded queue (already approved / declined by someone
  // else, or user has no access) we show a toast and strip the query so
  // refreshing doesn't keep retrying.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkRequestId = searchParams.get("requestId");
  const deepLinkAppliedRef = useRef(null);
  const cardRefs = useRef({});
  // Marked true once loadRequests() has settled — prevents "not found"
  // errors from firing on the very first render before the fetch resolves.
  const hasLoadedOnceRef = useRef(false);
  const seenLoadingRef = useRef(false);
  useEffect(() => {
    if (loading) seenLoadingRef.current = true;
    else if (seenLoadingRef.current) hasLoadedOnceRef.current = true;
  }, [loading, requests]);
  useEffect(() => {
    if (!deepLinkRequestId) return;
    if (loading) return; // wait for the queue to load
    if (!hasLoadedOnceRef.current) return;
    if (deepLinkAppliedRef.current === deepLinkRequestId) return;
    const match = requests.find((r) => r.id === deepLinkRequestId);
    if (match) {
      deepLinkAppliedRef.current = deepLinkRequestId;
      handleCardClick(match);
      // Scroll the highlighted card into the visible pane
      setTimeout(() => {
        const el = cardRefs.current[match.id];
        if (el && typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 120);
      const sp = new URLSearchParams(searchParams);
      sp.delete("requestId");
      setSearchParams(sp, { replace: true });
    } else {
      // Requests are loaded but this id isn't in the queue — likely already
      // decided or the current user cannot see it. Fall back to the listing.
      deepLinkAppliedRef.current = deepLinkRequestId;
      toast.error("Request no longer pending or unavailable");
      const sp = new URLSearchParams(searchParams);
      sp.delete("requestId");
      setSearchParams(sp, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkRequestId, loading, requests]);

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

  // Extract the "YYYY-MM-DD" part of an ISO string (used for meeting-room
  // requests whose slot is stored in `start_at`).
  const isoDate = (iso) => (iso ? String(iso).slice(0, 10) : null);

  // When focus request set, sync plan + date and trigger the camera pan.
  // The SAME map (`WorkstationFloorMap`) stays mounted; we just flip which
  // pin the camera zooms to (workstation seat vs. meeting room).
  //
  // Important: only touch `selectedPlanId` / `focusDate` when they actually
  // change. That keeps the availability effect from firing and re-rendering
  // the floor map — the user then sees a smooth camera pan instead of a
  // spinner every time they click a card.
  const handleCardClick = (req) => {
    setFocusRequest(req);
    const nextDate = req._type === "meeting_room" ? isoDate(req.start_at) : req.date;
    if (req.plan_id && req.plan_id !== selectedPlanId) setSelectedPlanId(req.plan_id);
    if (nextDate && nextDate !== focusDate) setFocusDate(nextDate);
    if (req._type === "meeting_room") {
      setCenterSeatId(null);
      setCenterRoomId(req.room_id);
    } else {
      setCenterRoomId(null);
      setCenterSeatId(req.seat_id);
    }
  };

  // Re-trigger pan once the seats/rooms are rendered for the new plan/date.
  // Toggling the seat/room id off then on forces the WorkstationFloorMap
  // zoom effect to re-fire against the freshly-mounted overlays.
  useEffect(() => {
    if (!focusRequest || !availability) return;
    if (focusRequest._type === "meeting_room") {
      setCenterRoomId(null);
      const t = setTimeout(() => setCenterRoomId(focusRequest.room_id), 60);
      return () => clearTimeout(t);
    }
    setCenterSeatId(null);
    const t = setTimeout(() => setCenterSeatId(focusRequest.seat_id), 60);
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
    if (!canApprove) { toast.error("You don't have permission to approve requests"); return; }
    setDecidingId(req.id);
    try {
      const isMR = req._type === "meeting_room";
      const url = isMR
        ? `/meeting-room-requests/${req.id}/approve`
        : `/workstation-requests/${req.id}/approve`;
      await api.post(url);
      if (isMR) {
        toast.success(`Approved meeting request for ${req.room_name || "the room"}`);
      } else {
        toast.success(`Approved request for workstation ${req.seat_label} (${fmtDate(req.date)})`);
      }
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
      if (focusRequest?.id === req.id) setFocusRequest(null);
      if (availability && !isMR) {
        // refresh workstation map data so the seat now shows as Occupied
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
    if (!canApprove) { toast.error("You don't have permission to decline requests"); return; }
    setDecidingId(req.id);
    try {
      const isMR = req._type === "meeting_room";
      const url = isMR
        ? `/meeting-room-requests/${req.id}/decline`
        : `/workstation-requests/${req.id}/decline`;
      await api.post(url);
      if (isMR) {
        toast.success(`Declined meeting request for ${req.room_name || "the room"}`);
      } else {
        toast.success(`Declined request for workstation ${req.seat_label} (${fmtDate(req.date)})`);
      }
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
      if (focusRequest?.id === req.id) setFocusRequest(null);
      if (availability && !isMR) {
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

  // Meeting rooms to overlay on the currently-focused plan. Shape must
  // match what WorkstationFloorMap expects: `{ id, name, x, y, w, h, capacity }`.
  const roomsForCurrentPlan = useMemo(() => {
    if (!selectedPlanId) return [];
    return mrRooms
      .filter((r) => r.plan_id === selectedPlanId)
      .map((r) => ({
        id: r.room_id,
        name: r.name || r.room_name || "Room",
        x: r.x, y: r.y, w: r.w, h: r.h,
        capacity: r.capacity,
      }));
  }, [mrRooms, selectedPlanId]);

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
            <div className="w-56">
              <SingleSelect
                options={plans.map((p) => ({ value: p.id, label: p.name }))}
                value={selectedPlanId}
                onChange={(v) => setSelectedPlanId(v || "")}
                placeholder="Floor plan"
                testId="pa-plan-selector"
                allowClear={false}
                searchable={plans.length > 8}
                size="md"
              />
            </div>
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
            <RefreshCw sx={{ fontSize: 16 }} className={loading ? "animate-spin" : ""}/>
          </button>
        </>
      }
    >
      <div className="flex flex-col h-[calc(100vh-4rem)] min-h-[560px]">
        {/* Header — pending count + Auto-Approval toggle + settings */}
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap" data-testid="pa-header">
          <span className="text-xs text-gray-700 font-medium" data-testid="pa-pending-count">
            Pending - {pendingCount}
          </span>

          {/* Auto Approval toggle */}
          <div className="ml-auto flex items-center gap-2">
            <div className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-gray-200 bg-white">
              <Sparkles sx={{ fontSize: 14 }} className="text-[#ec9324]"/>
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
              title={canApprove ? "Approval settings" : "You don't have permission to configure"}
              aria-label="Approval settings"
              data-testid="approval-settings-btn"
            >
              <Settings sx={{ fontSize: 16 }}/>
            </button>
            )}
          </div>
        </div>

        {!canApprove && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2 text-xs text-amber-800">
            <ShieldAlert sx={{ fontSize: 14 }}/> You don't have permission to approve or decline requests.
          </div>
        )}

        {/* Body: 70% map | 30% cards */}
        <div className="flex-1 flex overflow-hidden">
          {/* ============ Left — floor map (70%) ============ */}
          <div className="flex-1 min-w-0 relative bg-gray-100" style={{ flexBasis: "70%" }}>
            {plansLoading ? (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                <Loader2 className="animate-spin mr-2"/> Loading floor plans…
              </div>
            ) : plans.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                No live floor plans available.
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
                // Only surface the full-map loading overlay on the very
                // first fetch. Subsequent refetches (e.g. clicking another
                // card that changes the date) keep the existing map on
                // screen so we get a smooth camera pan instead of a spinner.
                loading={false}
                disabled={true}
                centerOnSeatId={centerSeatId}
                centerOnRoomId={centerRoomId}
                highlightRoomId={centerRoomId}
                rooms={roomsForCurrentPlan}
              />
            ) : availLoading ? (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                <Loader2 className="animate-spin mr-2"/> Loading floor plan…
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                {availLoading ? <Loader2 className="animate-spin"/> : "No floor plan to render"}
              </div>
            )}
          </div>

          {/* ============ Right — approval cards (30%) ============ */}
          <div
            className="border-l border-gray-200 bg-white flex flex-col"
            style={{ flexBasis: "30%", minWidth: 320 }}
          >
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-700">Approval Queue</div>
              <div className="shrink-0">
                <MultiSelectFilter
                  label="Type"
                  value={typeFilter === "all" ? [] : [typeFilter]}
                  onChange={(arr) => setTypeFilter(arr[0] || "all")}
                  options={[
                    { value: "workstation",  label: "Workstation" },
                    { value: "meeting_room", label: "Meeting Room" },
                  ]}
                  testIdPrefix="pa-type-filter"
                  className="w-40"
                  align="right"
                  single
                />
              </div>
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
                  {isAllSelected ? <CheckSquare sx={{ fontSize: 14 }} className="text-[#ec9324]"/> : <Square sx={{ fontSize: 14 }}/>}
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
                    className="h-7 px-2 bg-[#ec9324] hover:bg-[#d4811f] text-white text-[11px]"
                    data-testid="pa-bulk-approve"
                  >
                    <Check sx={{ fontSize: 12 }} className="mr-1"/> Approve
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
                    <X sx={{ fontSize: 12 }} className="mr-1"/> Decline
                  </Button>
                  )}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {loading ? (
                <div className="text-center text-sm text-gray-500 py-10">
                  <Loader2 className="inline animate-spin mr-2"/> Loading…
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
                      const isMR = req._type === "meeting_room";
                      // Format a friendly time-range for meeting-room requests
                      const fmtTimeRange = () => {
                        try {
                          const s = new Date(req.start_at);
                          const e = new Date(req.end_at);
                          const dateLabel = s.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
                          const t = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
                          return `${dateLabel} · ${t(s)} – ${t(e)}`;
                        } catch { return "—"; }
                      };
                      return (
                        <div
                          key={req.id}
                          ref={(el) => { if (el) cardRefs.current[req.id] = el; else delete cardRefs.current[req.id]; }}
                          onClick={() => handleCardClick(req)}
                          className={`rounded-lg border p-3 cursor-pointer transition shadow-sm ${
                            focused
                              ? "border-[#ec9324] ring-2 ring-[#ec9324]/30 bg-orange-50"
                              : "border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50"
                          }`}
                          data-testid={`pa-card-${req.id}`}
                          data-request-type={req._type}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 min-w-0 flex-1">
                              {/* Bulk-select only supported for workstation requests today.
                                  Meeting-room rows hide the checkbox to avoid confusion. */}
                              {canApprove && !isMR && (
                                <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                                  <BulkSelectCheckbox
                                    checked={effectiveSelectedIds.has(req.id)}
                                    onCheckedChange={() => toggleSelect(req.id)}
                                    data-testid={`pa-select-${req.id}`}
                                    aria-label="Select request"
                                  />
                                </div>
                              )}
                              {/* All content (title → ID → detail rows) lives in the
                                  left column so it flows without the tall right-side
                                  stack (Pending pill + M/W circle) leaving a gap.
                                  Each detail row uses the "group" tooltip pattern
                                  from `NotificationBell` — instant hover, dark pill. */}
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="font-semibold text-sm text-gray-900 truncate">
                                  {isMR ? (
                                    <span className="truncate">{req.room_name || "Room"} : {req.title}</span>
                                  ) : (
                                    <span>Workstation {req.seat_label}</span>
                                  )}
                                </div>
                                {req.seq_no != null && (
                                  <div className="text-[12px] text-gray-600" data-testid={`pa-seq-${req.id}`}>
                                    ID: <span className="font-mono font-semibold text-gray-800">{req.seq_no}</span>
                                  </div>
                                )}
                                <div className="pt-1 space-y-1 text-[12px] text-gray-700">
                                  {isMR ? (
                                    <>
                                      <div className="group relative flex items-center gap-1.5 w-fit max-w-full">
                                        <Calendar sx={{ fontSize: 12 }} className="text-gray-400 shrink-0"/>
                                        <span className="truncate"><strong>{fmtTimeRange()}</strong></span>
                                        <span className="pointer-events-none absolute left-4 -top-6 px-2 py-0.5 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-75 z-30 shadow-lg">
                                          Booked For
                                        </span>
                                      </div>
                                      <div className="group relative flex items-center gap-1.5 w-fit max-w-full">
                                        <User sx={{ fontSize: 12 }} className="text-gray-400 shrink-0"/>
                                        <span className="truncate">Capacity: <strong>{req.room_capacity} seats</strong> · Attendees: <strong>{(req.attendees || []).length}</strong></span>
                                        <span className="pointer-events-none absolute left-4 -top-6 px-2 py-0.5 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-75 z-30 shadow-lg">
                                          Capacity & Attendees
                                        </span>
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <div className="group relative flex items-center gap-1.5 w-fit max-w-full">
                                        <User sx={{ fontSize: 12 }} className="text-gray-400 shrink-0"/>
                                        <span className="truncate">For: <strong>{(req.employee || {}).name || "—"}</strong></span>
                                        <span className="pointer-events-none absolute left-4 -top-6 px-2 py-0.5 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-75 z-30 shadow-lg">
                                          Requested For
                                        </span>
                                      </div>
                                      <div className="group relative flex items-center gap-1.5 w-fit max-w-full">
                                        <Calendar sx={{ fontSize: 12 }} className="text-gray-400 shrink-0"/>
                                        <span>For date: <strong>{fmtDate(req.date)}</strong></span>
                                        <span className="pointer-events-none absolute left-4 -top-6 px-2 py-0.5 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-75 z-30 shadow-lg">
                                          Booked For
                                        </span>
                                      </div>
                                    </>
                                  )}
                                  <div className="group relative flex items-center gap-1.5 w-fit max-w-full">
                                    <User sx={{ fontSize: 12 }} className="text-gray-400 shrink-0"/>
                                    <span className="truncate">Requested by: {(req.requested_by || {}).name || "—"}</span>
                                    <span className="pointer-events-none absolute left-4 -top-6 px-2 py-0.5 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-75 z-30 shadow-lg">
                                      Requested By
                                    </span>
                                  </div>
                                  <div className="group relative flex items-center gap-1.5 w-fit max-w-full">
                                    <Clock sx={{ fontSize: 12 }} className="text-gray-400 shrink-0"/>
                                    <span>{fmtDateTime(req.requested_on)}</span>
                                    <span className="pointer-events-none absolute left-4 -top-6 px-2 py-0.5 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-75 z-30 shadow-lg">
                                      Requested On
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                            {/* Right column — Status pill on top, Type circle below.
                                • Status: outlined "Pending" pill (unchanged).
                                • Type circle: solid orange gradient with initial
                                  ("W" for Workstation / "M" for Meeting), hover
                                  reveals a dark tooltip with the full name —
                                  same pattern as NotificationBell tooltip. */}
                            <div className="flex flex-col items-end gap-1.5 shrink-0">
                              <span
                                data-testid="pa-status-badge"
                                className="inline-flex items-center justify-center w-24 h-6 text-[11px] font-semibold rounded-full border-2 select-none whitespace-nowrap"
                                style={{ color: "#ec9324", borderColor: "#ec9324", backgroundColor: "#ffffff" }}
                              >
                                Pending
                              </span>
                              <div
                                className="group relative"
                                data-testid={`pa-type-circle-${req._type}`}
                                aria-label={isMR ? "Meeting Room" : "Workstation"}
                              >
                                <span
                                  className="inline-flex items-center justify-center w-8 h-8 rounded-full text-white text-[13px] font-bold select-none shadow-sm ring-2 ring-white"
                                  style={{ background: "linear-gradient(135deg, #f5a94b 0%, #ec9324 55%, #d4811f 100%)" }}
                                >
                                  {isMR ? "M" : "W"}
                                </span>
                                <span className="pointer-events-none absolute top-full mt-1.5 right-0 px-2 py-1 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-75 z-30 shadow-lg">
                                  {isMR ? "Meeting Room" : "Workstation"}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                            {permApprove.isVisible && (
                            <Button
                              size="sm"
                              disabled={!canApprove || busy || !permApprove.canUse}
                              onClick={() => approve(req)}
                              className="flex-1 bg-[#ec9324] hover:bg-[#d4811f] text-white"
                              data-testid={`pa-approve-${req.id}`}
                            >
                              {busy ? <Loader2 className="animate-spin" sx={{ fontSize: 14 }}/> : <><Check sx={{ fontSize: 14 }} className="mr-1"/> Approve</>}
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
                              {busy ? <Loader2 className="animate-spin" sx={{ fontSize: 14 }}/> : <><X sx={{ fontSize: 14 }} className="mr-1"/> Decline</>}
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
                ? "bg-[#ec9324] hover:bg-[#d4811f] text-white"
                : "bg-red-600 hover:bg-red-700 text-white"}
              data-testid="pa-bulk-confirm"
            >
              {bulkProcessing ? <Loader2 className="animate-spin mr-2" sx={{ fontSize: 14 }}/> : null}
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
