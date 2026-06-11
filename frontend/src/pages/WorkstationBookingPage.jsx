/**
 * WorkstationBookingPage
 * ----------------------
 * Full-day workstation booking experience built on top of the **Active (Live)
 * Floor Layout**. Strictly isolated from Meeting Room Booking: rooms drawn on
 * the layout are intentionally hidden here.
 *
 * Layout
 *   ┌──────────────────────────────────────────────┐
 *   │   Header: Date filter + plan selector        │
 *   ├──────────────────────────────────┬────────────┤
 *   │  Floor Map (75%)                  │ Booking  │
 *   │  • zoom, search, legend, tooltip │ Form     │
 *   │  • White/Orange/Grey/Team color   │ (25%)    │
 *   └──────────────────────────────────┴────────────┘
 *
 *   On mobile, the form stacks below the map (full-width).
 *
 * Empty states
 *   • No live floor plan with calibrated workstations → an explicit empty card
 *     ("Add Workstation to Floor"), all form controls disabled.
 *   • Several live plans → user picks which one in the header.
 *
 * Color rules (per UX confirmation)
 *   White  — Available
 *   Orange — Selected
 *   Grey   — Occupied / Not available
 *   Team color (from Teams table) — Team-assigned occupied seat
 *
 * Click rules
 *   • Available seat  → toggle into selection (mirrored in workstation dropdown)
 *   • Occupied seat   → navigate to /workspace-manager/bookings?bookingId=<id> (centralised detail)
 *
 * Form rules
 *   • 1 seat   → Employee dropdown enabled, Team disabled
 *   • N seats  → Team dropdown enabled, Employee disabled, allocation = Random | Manual
 *   • Recurring: weekly day-of-week multi-select between booking date and end date
 *   • Validation: no duplicate seat or employee on any expanded date
 *
 * Permissions
 *   Super Admin can create/edit/delete. Admin sees the page (read-only).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Armchair, Calendar as CalendarIcon, Loader2, Users, AlertTriangle,
  Repeat, RefreshCw, Trash2, ChevronDown, X, ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import Layout from "../components/Layout";
import api, { formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import MultiSelect from "../components/MultiSelect";
import WorkstationFloorMap from "../components/WorkstationFloorMap";
import { useAuth } from "../context/AuthContext";

// ---------- date helpers (IST is the local timezone for this module) ----------
const todayIso = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const addDaysIso = (iso, days) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};
const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return iso; }
};

// Day-of-week button codes — matches backend WEEKDAY_CODES exactly
const WEEK_DAYS = [
  { code: "Su", label: "Su" },
  { code: "M",  label: "M"  },
  { code: "T",  label: "T"  },
  { code: "W",  label: "W"  },
  { code: "Th", label: "Th" },
  { code: "F",  label: "F"  },
  { code: "S",  label: "S"  },
];

// ============================================================ Component
//
// `mode` decides whether this page creates a real booking or a request that
// requires approval. Defaults to "booking" so existing routes keep working.
//   • mode="booking"  → POSTs /workstation-bookings,  saves directly
//   • mode="request"  → POSTs /workstation-requests,  goes to Pending Approval
// In "request" mode the Recurring section is hidden (single-date requests only)
// and the page title, breadcrumb and submit button are re-labeled.
export default function WorkstationBookingPage({ mode = "booking" } = {}) {
  const isRequestMode = mode === "request";
  const apiBase = isRequestMode ? "/workstation-requests" : "/workstation-bookings";
  const pageTitle = isRequestMode ? "Request Workstation" : "Workstation Booking";
  const submitLabel = isRequestMode ? "Submit Request" : "Save";
  const submitInProgressLabel = isRequestMode ? "Submitting…" : "Saving…";
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const canEdit = user?.role === "Super Admin";

  // --------- Plan + availability ---------
  const [livePlans, setLivePlans] = useState([]);          // [{id, name, pdfUrl, seat_count}]
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [planLoading, setPlanLoading] = useState(true);

  const [date, setDate] = useState(todayIso());

  const [availability, setAvailability] = useState(null); // {plan, seats[], bookings[], booked_seat_ids[], booked_employee_ids[]}
  const [availLoading, setAvailLoading] = useState(false);

  // --------- Reference data ---------
  const [employees, setEmployees] = useState([]);  // [{id, name, email, emp_id, status, team_ids?}]
  const [teams, setTeams] = useState([]);          // [{id, name, color, member_ids, manager_ids}]
  const [refLoading, setRefLoading] = useState(true);

  // --------- Form state ---------
  const [selectedSeatIds, setSelectedSeatIds] = useState([]); // mirrors floor-map clicks
  const [employeeId, setEmployeeId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [allocationMode, setAllocationMode] = useState("random"); // 'random' | 'manual'
  const [manualEmpIds, setManualEmpIds] = useState([]);            // length == seat count
  const [recurringOn, setRecurringOn] = useState(false);
  const [recurringEnd, setRecurringEnd] = useState(todayIso());
  const [recurringDays, setRecurringDays] = useState([]);         // ['Su','M',...]
  const [saving, setSaving] = useState(false);
  const formRef = useRef(null);

  // -------------------------------------------------- Initial loads
  const loadPlans = useCallback(async () => {
    setPlanLoading(true);
    try {
      const res = await api.get(`${apiBase}/floor-plans`);
      const plans = res.data || [];
      setLivePlans(plans);
      // Pick the first plan unless URL specifies one (deep-link friendly)
      const fromUrl = searchParams.get("plan_id");
      const next = (fromUrl && plans.find(p => p.id === fromUrl)?.id)
        || (plans.length === 1 ? plans[0].id : (plans[0]?.id || ""));
      setSelectedPlanId(next);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Failed to load floor plans");
    } finally {
      setPlanLoading(false);
    }
  }, [searchParams]);

  const loadReference = useCallback(async () => {
    setRefLoading(true);
    try {
      const [empRes, teamRes] = await Promise.all([
        api.get("/contacts?status=Active&limit=2000"),
        api.get("/teams"),
      ]);
      const empItems = (empRes.data?.items || empRes.data || []).filter(c => (c.status || "").toLowerCase() === "active");
      setEmployees(empItems);
      setTeams(teamRes.data || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Failed to load employees/teams");
    } finally {
      setRefLoading(false);
    }
  }, []);

  const loadAvailability = useCallback(async (planId, isoDate) => {
    if (!planId || !isoDate) return;
    setAvailLoading(true);
    try {
      const res = await api.get(`${apiBase}/availability`, { params: { plan_id: planId, date: isoDate } });
      setAvailability(res.data);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || "Failed to load availability");
      setAvailability(null);
    } finally {
      setAvailLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`${apiBase}/floor-plans`);
        if (cancelled) return;
        const plans = res.data || [];
        setLivePlans(plans);
        const fromUrl = searchParams.get("plan_id");
        const next = (fromUrl && plans.find(p => p.id === fromUrl)?.id)
          || (plans.length === 1 ? plans[0].id : (plans[0]?.id || ""));
        setSelectedPlanId(next);
      } catch (e) {
        if (!cancelled) toast.error(formatApiError(e?.response?.data?.detail) || "Failed to load floor plans");
      } finally {
        if (!cancelled) setPlanLoading(false);
      }
    })();
    (async () => {
      try {
        const [empRes, teamRes] = await Promise.all([
          api.get("/contacts?status=Active&limit=2000"),
          api.get("/teams"),
        ]);
        if (cancelled) return;
        const empItems = (empRes.data?.items || empRes.data || []).filter(c => (c.status || "").toLowerCase() === "active");
        setEmployees(empItems);
        setTeams(teamRes.data || []);
      } catch (e) {
        if (!cancelled) toast.error(formatApiError(e?.response?.data?.detail) || "Failed to load employees/teams");
      } finally {
        if (!cancelled) setRefLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wrapper setters used by every plan/date input. These both trigger an
  // availability reload AND clear form state in the same render — keeping all
  // state mutations out of useEffect (lint rule react-hooks/set-state-in-effect).
  const setDateAndClear = useCallback((next) => {
    setDate(next);
    setSelectedSeatIds([]); setEmployeeId(""); setTeamId(""); setManualEmpIds([]);
    if (selectedPlanId && next) loadAvailability(selectedPlanId, next);
  }, [selectedPlanId, loadAvailability]);
  const setPlanAndClear = useCallback((next) => {
    setSelectedPlanId(next);
    setSelectedSeatIds([]); setEmployeeId(""); setTeamId(""); setManualEmpIds([]);
    if (next && date) loadAvailability(next, date);
  }, [date, loadAvailability]);

  // First-load availability fetch — `loadPlans` will pre-select a plan, and a
  // separate effect kicks off the initial availability load once both plan +
  // date are ready.
  const didInitialLoadRef = useRef(false);
  useEffect(() => {
    if (didInitialLoadRef.current) return;
    if (!selectedPlanId || !date) return;
    didInitialLoadRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`${apiBase}/availability`, { params: { plan_id: selectedPlanId, date } });
        if (!cancelled) setAvailability(res.data);
      } catch (e) {
        if (!cancelled) toast.error(formatApiError(e?.response?.data?.detail) || "Failed to load availability");
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPlanId, date]);

  // -------------------------------------------------- Derived data
  // Map seat_id -> active booking (used by both the map and dropdown filter)
  const bookingsBySeat = useMemo(() => {
    const m = {};
    for (const b of (availability?.bookings || [])) m[b.seat_id] = b;
    return m;
  }, [availability]);

  // Map seat_id -> pending workstation request (renders that seat as black on
  // the floor map and excludes it from the available-seats dropdown).
  const requestsBySeat = useMemo(() => {
    const m = {};
    for (const r of (availability?.pending_requests || [])) m[r.seat_id] = r;
    return m;
  }, [availability]);

  const allSeats = availability?.seats || [];

  // Available seats — hide booked AND pending workstations for the selected date
  const availableSeatOptions = useMemo(() => {
    return allSeats
      .filter((s) => !bookingsBySeat[s.id] && !requestsBySeat[s.id])
      .map((s) => ({ value: s.id, label: s.label || s.id, sublabel: "" }));
  }, [allSeats, bookingsBySeat, requestsBySeat]);

  // Active employees + not already booked or with a pending request on this date
  const bookedEmpIds = useMemo(() => {
    const ids = new Set(availability?.booked_employee_ids || []);
    for (const eid of (availability?.pending_employee_ids || [])) ids.add(eid);
    return ids;
  }, [availability]);
  const availableEmployees = useMemo(
    () => employees.filter((e) => !bookedEmpIds.has(e.id)),
    [employees, bookedEmpIds],
  );

  // Team eligible members for the manual allocation modal
  const selectedTeam = useMemo(() => teams.find((t) => t.id === teamId), [teams, teamId]);
  const teamPool = useMemo(() => {
    if (!selectedTeam) return [];
    const allIds = new Set([
      ...(selectedTeam.member_ids || []),
      ...(selectedTeam.manager_ids || []),
    ]);
    return employees.filter((e) => allIds.has(e.id) && !bookedEmpIds.has(e.id));
  }, [selectedTeam, employees, bookedEmpIds]);

  const isSingle = selectedSeatIds.length === 1;
  const isMulti  = selectedSeatIds.length > 1;
  const seatCount = selectedSeatIds.length;

  // -------------------------------------------------- Handlers
  const toggleSeat = useCallback((seatId) => {
    setSelectedSeatIds((prev) => prev.includes(seatId) ? prev.filter((x) => x !== seatId) : [...prev, seatId]);
  }, []);

  const openBookingDetail = useCallback((seat, booking) => {
    if (!booking) return;
    navigate(`/workspace-manager/bookings?bookingId=${encodeURIComponent(booking.id)}`);
  }, [navigate]);

  const toggleRecurringDay = (code) => {
    setRecurringDays((prev) => prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]);
  };

  const resetForm = () => {
    setSelectedSeatIds([]);
    setEmployeeId(""); setTeamId(""); setManualEmpIds([]);
    setAllocationMode("random");
    setRecurringOn(false); setRecurringDays([]); setRecurringEnd(date);
  };

  // -------------------------------------------------- Validation + submit
  const validate = () => {
    if (!selectedPlanId)         return "Select a floor plan first.";
    if (seatCount === 0)         return "Select at least one workstation.";
    if (isSingle && !employeeId) return "Choose an employee for this workstation.";
    if (isMulti && !teamId)      return "Choose a team to assign the workstations to.";
    if (isMulti && allocationMode === "manual" && manualEmpIds.length !== seatCount)
      return `Pick exactly ${seatCount} team member(s) for the selected workstations.`;
    if (recurringOn) {
      if (!recurringEnd)         return "Select a recurring end date.";
      if (recurringEnd < date)   return "Recurring end date must be on or after the booking date.";
      if (recurringDays.length === 0) return "Pick at least one day of the week.";
    }
    return null;
  };

  const pickRandom = (pool, count) => {
    const a = pool.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, count);
  };

  const handleSave = async () => {
    if (!canEdit) {
      toast.error(isRequestMode
        ? "Only Super Admin can submit workstation requests"
        : "Only Super Admin can create workstation bookings");
      return;
    }
    const err = validate();
    if (err) { toast.error(err); return; }

    let payload = {
      plan_id: selectedPlanId,
      date,
      seat_ids: selectedSeatIds,
    };
    // Request mode doesn't support recurring — single date only.
    if (!isRequestMode) {
      payload.recurring = recurringOn ? { end_date: recurringEnd, days: recurringDays } : null;
    }
    if (isSingle) {
      payload.employee_id = employeeId;
    } else {
      payload.team_id = teamId;
      let teamEmps;
      if (allocationMode === "random") {
        if (teamPool.length < seatCount) {
          toast.error(`Team has only ${teamPool.length} available member(s) but ${seatCount} workstation(s) selected.`);
          return;
        }
        teamEmps = pickRandom(teamPool.map((e) => e.id), seatCount);
      } else {
        teamEmps = manualEmpIds.slice(0, seatCount);
      }
      payload.team_employee_ids = teamEmps;
    }

    setSaving(true);
    try {
      const res = await api.post(apiBase, payload);
      const count = res.data?.created || 0;
      if (isRequestMode) {
        toast.success(`Submitted ${count} workstation request${count === 1 ? "" : "s"} — pending approval`);
      } else {
        toast.success(`Booked ${count} workstation${count === 1 ? "" : "s"}`);
      }
      resetForm();
      await loadAvailability(selectedPlanId, date);
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const msg = typeof detail === "object" && detail?.message ? detail.message : formatApiError(detail);
      toast.error(msg || (isRequestMode ? "Failed to submit request" : "Failed to create booking"));
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------- Render
  const noLivePlans = !planLoading && livePlans.length === 0;
  const noSeats = !availLoading && availability && (availability.seats || []).length === 0;

  return (
    <Layout
      breadcrumbs={[{ label: "Workspace Manager" }, { label: pageTitle }]}
      fullBleed
      contentClassName="bg-gray-50"
    >
      <div className="flex flex-col h-[calc(100vh-4rem)] min-h-[560px]">
        {/* ============================== Header ============================== */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 lg:px-6 py-3 border-b bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#ec9324]/10 flex items-center justify-center">
              <Armchair className="text-[#ec9324]" size={20} />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">{pageTitle}</h1>
              <p className="text-xs text-gray-500">Full-day seat booking on the Live floor layout · IST</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {livePlans.length > 1 && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-600">Floor Plan</label>
                <select
                  value={selectedPlanId}
                  onChange={(e) => setPlanAndClear(e.target.value)}
                  className="text-sm rounded-md border border-gray-300 px-2 py-1.5 bg-white"
                  data-testid="ws-plan-selector"
                >
                  {livePlans.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.seat_count} seats)</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-600">Booking Date</label>
              <div className="relative">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDateAndClear(e.target.value)}
                  className="text-sm rounded-md border border-gray-300 pl-8 pr-2 py-1.5 bg-white"
                  data-testid="ws-date-filter"
                />
                <CalendarIcon size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setDateAndClear(todayIso())}
                data-testid="ws-date-today"
              >Today</Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => loadAvailability(selectedPlanId, date)}
              disabled={availLoading || !selectedPlanId}
              title="Refresh availability"
            >
              <RefreshCw size={14} className={availLoading ? "animate-spin" : ""} />
            </Button>
          </div>
        </div>

        {/* ============================== Body ============================== */}
        {planLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="animate-spin text-[#ec9324]" size={28} />
          </div>
        ) : noLivePlans ? (
          <NoLivePlanEmptyState />
        ) : (
          <div className="flex-1 flex flex-col lg:flex-row min-h-0">
            {/* ---------- Floor map (75% / stacked) ---------- */}
            <div className="lg:w-3/4 w-full h-[55vh] lg:h-auto relative border-b lg:border-b-0 lg:border-r border-gray-200">
              {availability?.plan?.pdfUrl ? (
                <WorkstationFloorMap
                  pdfUrl={availability.plan.pdfUrl}
                  seats={allSeats}
                  bookingsBySeat={bookingsBySeat}
                  requestsBySeat={requestsBySeat}
                  selectedSeatIds={selectedSeatIds}
                  onToggleSeat={toggleSeat}
                  onOpenBookingDetail={openBookingDetail}
                  loading={availLoading}
                  disabled={!canEdit}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                  {availLoading ? <Loader2 className="animate-spin" /> : "No floor plan to render"}
                </div>
              )}
            </div>

            {/* ---------- Booking form (25% / stacked) ---------- */}
            <div ref={formRef} className="lg:w-1/4 w-full lg:max-w-[420px] flex flex-col bg-white">
              {!canEdit && (
                <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2 text-xs text-amber-800">
                  <ShieldAlert size={14} /> Only Super Admin can {isRequestMode ? "submit workstation requests" : "create or modify workstation bookings"}.
                </div>
              )}

              {noSeats ? (
                <NoSeatsEmptyState planId={selectedPlanId} navigate={navigate} />
              ) : (
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                  <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <Armchair size={16} /> Booking Form
                  </h2>

                  {/* Workstation multi-select */}
                  <div>
                    <label className="text-xs font-medium text-gray-700">Workstation(s)</label>
                    <div className="mt-1">
                      <MultiSelect
                        options={availableSeatOptions}
                        value={selectedSeatIds}
                        onChange={setSelectedSeatIds}
                        placeholder={availLoading ? "Loading…" : "Select workstation(s)"}
                        testId="ws-workstation-select"
                        disabled={!canEdit || availLoading}
                      />
                    </div>
                    <div className="mt-1 text-[11px] text-gray-500 flex items-center gap-2">
                      <span>{availableSeatOptions.length} available</span>
                      {selectedSeatIds.length > 0 && (
                        <span className="text-[#22C55E]">· {selectedSeatIds.length} selected</span>
                      )}
                    </div>
                  </div>

                  {/* Employee (single) */}
                  <div>
                    <label className="text-xs font-medium text-gray-700">
                      Employee Name {isSingle ? <span className="text-red-500">*</span> : <span className="text-gray-400">(single seat)</span>}
                    </label>
                    <select
                      value={employeeId}
                      onChange={(e) => setEmployeeId(e.target.value)}
                      disabled={!canEdit || !isSingle || refLoading}
                      className="mt-1 w-full text-sm rounded-md border border-gray-300 px-2 py-2 bg-white disabled:bg-gray-50 disabled:text-gray-400"
                      data-testid="ws-employee-select"
                    >
                      <option value="">{refLoading ? "Loading…" : "Select employee"}</option>
                      {availableEmployees.map((e) => (
                        <option key={e.id} value={e.id}>{e.name} {e.emp_id ? `· ${e.emp_id}` : ""}</option>
                      ))}
                    </select>
                  </div>

                  {/* Team (multi) */}
                  <div>
                    <label className="text-xs font-medium text-gray-700">
                      Team Name {isMulti ? <span className="text-red-500">*</span> : <span className="text-gray-400">(multi-seat)</span>}
                    </label>
                    <select
                      value={teamId}
                      onChange={(e) => { setTeamId(e.target.value); setManualEmpIds([]); }}
                      disabled={!canEdit || !isMulti || refLoading}
                      className="mt-1 w-full text-sm rounded-md border border-gray-300 px-2 py-2 bg-white disabled:bg-gray-50 disabled:text-gray-400"
                      data-testid="ws-team-select"
                    >
                      <option value="">{refLoading ? "Loading…" : "Select team"}</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>

                    {isMulti && teamId && (
                      <div className="mt-3 rounded-md border border-gray-200 p-2 bg-gray-50">
                        <div className="text-[11px] font-medium text-gray-700 mb-1">Allocation</div>
                        <div className="flex gap-2 text-xs">
                          <button
                            onClick={() => setAllocationMode("random")}
                            disabled={!canEdit}
                            className={`flex-1 px-2 py-1.5 rounded-md border transition ${
                              allocationMode === "random"
                                ? "bg-[#ec9324] text-white border-[#ec9324]"
                                : "bg-white border-gray-300 hover:bg-gray-100"
                            }`}
                            data-testid="ws-alloc-random"
                          >Random</button>
                          <button
                            onClick={() => setAllocationMode("manual")}
                            disabled={!canEdit}
                            className={`flex-1 px-2 py-1.5 rounded-md border transition ${
                              allocationMode === "manual"
                                ? "bg-[#ec9324] text-white border-[#ec9324]"
                                : "bg-white border-gray-300 hover:bg-gray-100"
                            }`}
                            data-testid="ws-alloc-manual"
                          >Manual</button>
                        </div>

                        <div className="mt-2 text-[11px] text-gray-600 flex items-center gap-1">
                          <Users size={12} /> Team pool: {teamPool.length} available · {seatCount} required
                        </div>

                        {allocationMode === "manual" && (
                          <div className="mt-2">
                            <MultiSelect
                              options={teamPool.map((e) => ({ value: e.id, label: e.name, sublabel: e.emp_id || "" }))}
                              value={manualEmpIds}
                              onChange={(vals) => setManualEmpIds(vals.slice(0, seatCount))}
                              placeholder={`Pick ${seatCount} member(s)`}
                              testId="ws-manual-allocation"
                              disabled={!canEdit}
                            />
                            <div className="mt-1 text-[10px] text-gray-500">
                              {manualEmpIds.length}/{seatCount} selected. Workstations are assigned in the order of selection.
                            </div>
                          </div>
                        )}

                        {teamPool.length < seatCount && (
                          <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-1.5 flex items-start gap-1">
                            <AlertTriangle size={12} className="mt-[1px]" />
                            <span>Not enough available team members ({teamPool.length}) for {seatCount} workstation(s).</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Booking Date — duplicate of header date for clarity, kept in sync */}
                  <div>
                    <label className="text-xs font-medium text-gray-700">Booking Date</label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDateAndClear(e.target.value)}
                      disabled={!canEdit}
                      className="mt-1 w-full text-sm rounded-md border border-gray-300 px-2 py-2 bg-white"
                      data-testid="ws-form-date"
                    />
                  </div>

                  {/* Recurring (booking mode only — requests are single-date) */}
                  {!isRequestMode && (
                  <div className="border border-gray-200 rounded-md p-3 space-y-2 bg-gray-50">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                        <Repeat size={12} /> Recurring
                      </label>
                      <button
                        type="button"
                        onClick={() => setRecurringOn((v) => !v)}
                        disabled={!canEdit}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                          recurringOn ? "bg-[#ec9324]" : "bg-gray-300"
                        }`}
                        data-testid="ws-recurring-toggle"
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                          recurringOn ? "translate-x-4" : "translate-x-0.5"
                        }`} />
                      </button>
                    </div>
                    {recurringOn && (
                      <div className="space-y-2">
                        <div>
                          <label className="text-[11px] text-gray-600">End Date</label>
                          <input
                            type="date"
                            value={recurringEnd}
                            min={date}
                            onChange={(e) => setRecurringEnd(e.target.value)}
                            disabled={!canEdit}
                            className="mt-1 w-full text-sm rounded-md border border-gray-300 px-2 py-1.5 bg-white"
                            data-testid="ws-recurring-end"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-600">Repeat On</label>
                          <div className="mt-1 flex gap-1">
                            {WEEK_DAYS.map((d) => {
                              const active = recurringDays.includes(d.code);
                              return (
                                <button
                                  key={d.code}
                                  type="button"
                                  onClick={() => toggleRecurringDay(d.code)}
                                  disabled={!canEdit}
                                  className={`flex-1 text-[11px] py-1.5 rounded-md border transition ${
                                    active
                                      ? "bg-[#ec9324] text-white border-[#ec9324]"
                                      : "bg-white border-gray-300 hover:bg-gray-100 text-gray-700"
                                  }`}
                                  data-testid={`ws-recurring-day-${d.code}`}
                                >{d.label}</button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  )}

                  {/* Summary line */}
                  <div className="text-[11px] text-gray-500 bg-blue-50 border border-blue-100 rounded p-2">
                    {seatCount === 0 && "Click a workstation on the map (or use the dropdown) to start."}
                    {isSingle && employeeId && (isRequestMode
                      ? `Requesting 1 workstation for ${employees.find(e => e.id === employeeId)?.name || "employee"} on ${fmtDate(date)}.`
                      : `Booking 1 workstation for ${employees.find(e => e.id === employeeId)?.name || "employee"} on ${fmtDate(date)}.`)}
                    {isMulti && teamId && (isRequestMode
                      ? `Requesting ${seatCount} workstations for team "${selectedTeam?.name}" on ${fmtDate(date)} (${allocationMode}).`
                      : `Booking ${seatCount} workstations for team "${selectedTeam?.name}" on ${fmtDate(date)} (${allocationMode}).`)}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-2 border-t border-gray-200 sticky bottom-0 bg-white">
                    <Button
                      onClick={handleSave}
                      disabled={!canEdit || saving || !selectedPlanId || noSeats}
                      className="flex-1 bg-[#ec9324] hover:bg-[#d8821a] text-white"
                      data-testid="ws-save-button"
                    >
                      {saving ? <><Loader2 className="animate-spin mr-2" size={14}/>{submitInProgressLabel}</> : submitLabel}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={resetForm}
                      disabled={!canEdit || saving}
                      data-testid="ws-cancel-button"
                    >Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

// ============================================================ Empty states

function NoLivePlanEmptyState() {
  const navigate = useNavigate();
  return (
    <div className="flex-1 flex items-center justify-center bg-gray-50 px-6 py-12">
      <div className="max-w-md text-center" data-testid="ws-no-active-plan">
        <div className="mx-auto w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
          <AlertTriangle className="text-amber-600" size={32} />
        </div>
        <h2 className="text-lg font-semibold text-gray-900">No Active Floor Plan Available</h2>
        <p className="mt-2 text-sm text-gray-600">
          Workstation Booking requires at least one <strong>Live</strong> floor layout with calibrated
          workstations. Publish a floor layout to enable booking.
        </p>
        <Button
          className="mt-4 bg-[#ec9324] hover:bg-[#d8821a] text-white"
          onClick={() => navigate("/workspace-manager/floor-layout")}
        >Go to Floor Layout</Button>
      </div>
    </div>
  );
}

function NoSeatsEmptyState({ planId, navigate }) {
  return (
    <div className="flex-1 flex items-center justify-center px-6 py-12">
      <div className="text-center max-w-xs" data-testid="ws-no-seats">
        <div className="mx-auto w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-3">
          <Armchair className="text-gray-500" size={28} />
        </div>
        <h3 className="text-sm font-semibold text-gray-900">Add Workstation to Floor</h3>
        <p className="mt-2 text-xs text-gray-600">
          No workstations have been calibrated on this Live floor plan yet. Add seats in
          Floor Calibration to enable booking.
        </p>
        <Button
          size="sm"
          className="mt-3 bg-[#ec9324] hover:bg-[#d8821a] text-white"
          onClick={() => navigate(planId ? `/workspace-manager/calibration/${planId}` : "/workspace-manager/floor-plans")}
        >Open Calibration</Button>
      </div>
    </div>
  );
}
