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
  MousePointerClick, Wand2, CheckCircle2, Pencil,
} from "lucide-react";
import { toast } from "../lib/notify";
import Layout from "../components/Layout";
import api, { formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import MultiSelect from "../components/MultiSelect";
import DateFilter from "../components/DateFilter";
import WorkstationFloorMap from "../components/WorkstationFloorMap";
import { useAuth } from "../context/AuthContext";
import { useEffectivePage } from "../context/EffectivePermissionsContext";

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
  // ── Permissions V3 (Round 3) ──
  // In "request" mode the page maps to `workstation_requests`; in booking mode to
  // `workstation_bookings`. The catalog defines different function keys per page.
  const permPageKey = isRequestMode ? "workstation_requests" : "workstation_bookings";
  const { fn: permFn } = useEffectivePage("desk_booking", permPageKey);
  const permBook    = permFn(isRequestMode ? "create" : "book");
  const permCancel  = permFn(isRequestMode ? "cancel" : "cancel_booking");
  const permRefresh = permFn("refresh");
  const permExport  = permFn("export");
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
  const [recurringEnd, setRecurringEnd] = useState("");  // blank by default — user must pick
  const [recurringDays, setRecurringDays] = useState([]);         // ['Su','M',...]
  const [saving, setSaving] = useState(false);
  const formRef = useRef(null);

  // --------- Booking mode (Manual vs Team Auto Assignment) ---------
  // 'manual' — user picks each seat manually (existing behaviour)
  // 'auto'   — user picks a team, then clicks a STARTING workstation on the
  //            map. The system auto-selects N consecutive available seats
  //            (N = team size) following the seat-numbering sequence.
  const [bookingMode, setBookingMode] = useState("manual");
  // The starting workstation the user clicked (or accepted from a suggestion).
  // Kept alongside `selectedSeatIds` so the Proposed Selection card can label
  // it explicitly, matching the spec's "Starting Workstation" summary field.
  const [autoStartSeatId, setAutoStartSeatId] = useState(null);
  // "Best available block" suggestion dialog state — set when the user's
  // chosen starting workstation cannot accommodate the whole team but the
  // system found a nearby block that can.
  //   { chosenStart:{id,label}, suggestedStart:{id,label}, suggestedSeats:[...], required:N }
  // null means the dialog is closed.
  const [autoSuggestion, setAutoSuggestion] = useState(null);

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

  // Total distinct team-member count (union of member_ids + manager_ids).
  // Drives the "Team Size" shown in the Auto Assignment sidebar and the
  // number of seats picked when the user clicks a starting workstation.
  const teamMemberCount = useMemo(() => {
    if (!selectedTeam) return 0;
    const allIds = new Set([
      ...(selectedTeam.member_ids || []),
      ...(selectedTeam.manager_ids || []),
    ]);
    return allIds.size;
  }, [selectedTeam]);

  // Auto Assignment phase — derived from the mode + form state.
  //   awaiting-team  : mode='auto' & no team picked
  //   awaiting-start : mode='auto' & team picked, no seats yet
  //   proposed       : mode='auto' & seats have been auto-selected
  const autoPhase = useMemo(() => {
    if (bookingMode !== "auto") return null;
    if (!teamId) return "awaiting-team";
    if (selectedSeatIds.length === 0) return "awaiting-start";
    return "proposed";
  }, [bookingMode, teamId, selectedSeatIds]);

  const isSingle = selectedSeatIds.length === 1;
  const isMulti  = selectedSeatIds.length > 1;
  const seatCount = selectedSeatIds.length;

  // -------------------------------------------------- Auto-selection helpers
  // Natural (alphanumeric) sort of seats by label, e.g. G1, G2 … G20, H1, H2 …
  const naturalSortSeats = useCallback((list) => {
    return [...list].sort((a, b) =>
      String(a.label || a.id).localeCompare(
        String(b.label || b.id),
        undefined,
        { numeric: true, sensitivity: "base" }
      )
    );
  }, []);

  // From a starting seat, walk forward through the natural-sort sequence
  // and pick the next `count` AVAILABLE workstations (skipping booked /
  // pending seats). Returns { seats:[...], error?:string }.
  const computeAutoSelection = useCallback((startSeatId, count) => {
    if (count <= 0) return { seats: [], error: "Team has no members." };
    const sorted = naturalSortSeats(allSeats);
    const startIdx = sorted.findIndex((s) => s.id === startSeatId);
    if (startIdx === -1) return { seats: [], error: "Starting workstation not found on this plan." };
    const first = sorted[startIdx];
    if (bookingsBySeat[first.id] || requestsBySeat[first.id]) {
      return { seats: [], error: "The starting workstation is not available. Pick a free (white) seat." };
    }
    const picked = [];
    for (let i = startIdx; i < sorted.length && picked.length < count; i++) {
      const s = sorted[i];
      if (!bookingsBySeat[s.id] && !requestsBySeat[s.id]) picked.push(s);
    }
    if (picked.length < count) {
      return {
        seats: picked,
        error: `Only ${picked.length} available workstation${picked.length === 1 ? "" : "s"} from this starting point. ${count} required. Try a different starting workstation.`,
      };
    }
    return { seats: picked };
  }, [naturalSortSeats, allSeats, bookingsBySeat, requestsBySeat]);

  // Best-available block finder — used when the user's chosen starting seat
  // can't accommodate the whole team. Fans out (forward first, then backward)
  // from the chosen index in the natural-sort order and returns the closest
  // starting seat whose forward-walk yields `count` available workstations.
  // Returns { startSeat, seats:[...] } or null when no block of size N exists.
  const findNearestValidStart = useCallback((chosenStartId, count) => {
    if (count <= 0) return null;
    const sorted = naturalSortSeats(allSeats);
    const chosenIdx = sorted.findIndex((s) => s.id === chosenStartId);
    if (chosenIdx === -1) return null;

    const tryFrom = (startIdx) => {
      const start = sorted[startIdx];
      if (!start) return null;
      if (bookingsBySeat[start.id] || requestsBySeat[start.id]) return null;
      const picked = [];
      for (let i = startIdx; i < sorted.length && picked.length < count; i++) {
        const s = sorted[i];
        if (!bookingsBySeat[s.id] && !requestsBySeat[s.id]) picked.push(s);
      }
      return picked.length >= count ? picked : null;
    };

    const maxOffset = Math.max(chosenIdx, sorted.length - chosenIdx - 1);
    for (let off = 1; off <= maxOffset; off++) {
      // Forward first — usually more likely to succeed since a walk-forward
      // algorithm favours starting closer to the beginning of a free block.
      const fwd = chosenIdx + off;
      if (fwd < sorted.length) {
        const picked = tryFrom(fwd);
        if (picked) return { startSeat: sorted[fwd], seats: picked };
      }
      const back = chosenIdx - off;
      if (back >= 0) {
        const picked = tryFrom(back);
        if (picked) return { startSeat: sorted[back], seats: picked };
      }
    }
    return null;
  }, [naturalSortSeats, allSeats, bookingsBySeat, requestsBySeat]);

  // -------------------------------------------------- Handlers
  const toggleSeat = useCallback((seatId) => {
    // Auto Assignment: first available-seat click triggers the auto-select
    // algorithm. Subsequent clicks toggle individual seats — this doubles as
    // the "Modify" action so users can add/remove seats from the proposal.
    if (bookingMode === "auto") {
      if (!teamId) {
        toast.error("Select a team first to auto-assign workstations.");
        return;
      }
      if (selectedSeatIds.length === 0) {
        const size = teamMemberCount;
        if (size <= 0) {
          toast.error("Selected team has no members.");
          return;
        }
        const result = computeAutoSelection(seatId, size);
        if (result.error && result.seats.length < size) {
          // Not enough consecutive available seats from this start — try to
          // find the nearest block that CAN fit the whole team and offer it
          // as a suggestion instead of silently failing / partial-picking.
          const chosen = allSeats.find((s) => s.id === seatId);
          const suggestion = findNearestValidStart(seatId, size);
          if (suggestion) {
            setAutoSuggestion({
              chosenStart: { id: seatId, label: chosen?.label || seatId },
              suggestedStart: { id: suggestion.startSeat.id, label: suggestion.startSeat.label || suggestion.startSeat.id },
              suggestedSeats: suggestion.seats,
              required: size,
            });
          } else {
            toast.error(`No block of ${size} consecutive available workstations was found on this floor. Try booking on a different date or a smaller team.`);
          }
          return;
        }
        setSelectedSeatIds(result.seats.map((s) => s.id));
        setAutoStartSeatId(seatId);
        setAllocationMode("random");
        setManualEmpIds([]);
        return;
      }
      // seats already proposed — fall through to normal toggle so the user
      // can modify the selection before confirming.
    }
    setSelectedSeatIds((prev) => prev.includes(seatId) ? prev.filter((x) => x !== seatId) : [...prev, seatId]);
  }, [bookingMode, teamId, selectedSeatIds, teamMemberCount, computeAutoSelection, findNearestValidStart, allSeats]);

  // Accept the "best available block" suggestion — replaces the current
  // proposal (empty at this point) with the suggested seats and closes the
  // dialog.
  const acceptSuggestion = useCallback(() => {
    if (!autoSuggestion) return;
    setSelectedSeatIds(autoSuggestion.suggestedSeats.map((s) => s.id));
    setAutoStartSeatId(autoSuggestion.suggestedStart.id);
    setAllocationMode("random");
    setManualEmpIds([]);
    setAutoSuggestion(null);
  }, [autoSuggestion]);

  // Switch between Manual and Team Auto Assignment. Any in-progress selection
  // is cleared so the two flows never contaminate each other.
  const switchMode = useCallback((next) => {
    if (next === bookingMode) return;
    setBookingMode(next);
    setSelectedSeatIds([]);
    setEmployeeId("");
    setManualEmpIds([]);
    setAllocationMode("random");
    setAutoStartSeatId(null);
    setAutoSuggestion(null);
    // teamId is intentionally kept — a Super Admin who already picked a team
    // and switches from Manual → Auto shouldn't have to pick it again.
  }, [bookingMode]);

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
    setAutoStartSeatId(null);
    setAutoSuggestion(null);
  };

  // -------------------------------------------------- Validation + submit
  const validate = () => {
    if (!selectedPlanId)         return "Select a floor plan first.";
    if (seatCount === 0)         return "Select at least one workstation.";
    // Auto Assignment always assigns via the selected team, even when the
    // user has modified the proposal down to a single seat.
    if (bookingMode === "auto") {
      if (!teamId) return "Choose a team for auto-assignment.";
      if (teamPool.length < seatCount) {
        return `Team has only ${teamPool.length} available member(s) but ${seatCount} workstation(s) selected.`;
      }
    } else {
      if (isSingle && !employeeId) return "Choose an employee for this workstation.";
      if (isMulti && !teamId)      return "Choose a team to assign the workstations to.";
      if (isMulti && allocationMode === "manual" && manualEmpIds.length !== seatCount)
        return `Pick exactly ${seatCount} team member(s) for the selected workstations.`;
    }
    if (recurringOn) {
      if (!recurringEnd)         return "Select a recurring end date.";
      if (recurringEnd < date)   return "Recurring end date must be on or after the booking date.";
      // Max 3 months (approx 92 days) from the booking start date
      const startD = new Date(date + "T00:00:00");
      const maxD = new Date(startD); maxD.setMonth(maxD.getMonth() + 3);
      const endD = new Date(recurringEnd + "T00:00:00");
      if (endD > maxD) return "Recurring end date cannot be more than 3 months from the booking date.";
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
    if (bookingMode === "auto") {
      // Auto Assignment path — always books via team, even when the modified
      // proposal ends up as a single seat. Employees are drawn randomly from
      // the team's available pool so the user doesn't have to hand-pick.
      const teamEmps = pickRandom(teamPool.map((e) => e.id), seatCount);
      if (isSingle) {
        payload.employee_id = teamEmps[0];
      } else {
        payload.team_id = teamId;
        payload.team_employee_ids = teamEmps;
      }
    } else if (isSingle) {
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
      title={pageTitle}
      fullBleed
      contentClassName="bg-gray-50"
      actions={
        permRefresh.isVisible ? (
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={() => loadAvailability(selectedPlanId, date)}
          disabled={availLoading || !selectedPlanId || !permRefresh.canUse}
          title="Refresh availability"
          aria-label="Refresh availability"
        >
          <RefreshCw size={16} className={availLoading ? "animate-spin" : ""} />
        </Button>
        ) : null
      }
    >
      <div className="flex flex-col h-[calc(100vh-4rem)] min-h-[560px]">
        {/* ============================== Header ============================== */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 lg:px-6 py-3 border-b bg-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#ec9324]/10 flex items-center justify-center">
              <Armchair className="text-[#ec9324]" size={18} />
            </div>
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
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-600">
                {isRequestMode ? "Request Date" : "Booking Date"}
              </label>
              {isRequestMode ? (
                // Request mode — use the same calendar UI as Bookings, single-date only
                // (no Before/After/Between/On tabs).
                <DateFilter
                  value={{ field: "date", mode: "on", from: date ? new Date(date + "T00:00:00") : null, to: null }}
                  onChange={(v) => {
                    if (!v?.from) { setDateAndClear(""); return; }
                    const d = v.from;
                    const p = (n) => String(n).padStart(2, "0");
                    setDateAndClear(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
                  }}
                  fields={["date"]}
                  singleDate
                  minDate={todayIso()}
                  label="Request Date"
                  testId="ws-date-filter"
                />
              ) : (
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
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setDateAndClear(todayIso())}
                data-testid="ws-date-today"
              >Today</Button>
            </div>
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
                  zoomToSeatIds={bookingMode === "auto" && autoPhase === "proposed" ? selectedSeatIds : null}
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

                  {/* Booking Mode toggle — Manual Selection vs Team Auto Assignment.
                      Both flows share the same submit endpoint and Booking Date /
                      Recurring controls below. Switching modes clears the seat
                      selection so the two flows never contaminate each other. */}
                  {!isRequestMode && (
                    <div
                      className="rounded-lg border border-gray-200 bg-gray-50 p-1 grid grid-cols-2 gap-1"
                      data-testid="ws-booking-mode-toggle"
                    >
                      <button
                        type="button"
                        onClick={() => switchMode("manual")}
                        disabled={!canEdit || saving}
                        className={`text-[12px] font-semibold py-1.5 rounded-md transition flex items-center justify-center gap-1.5 ${
                          bookingMode === "manual"
                            ? "bg-white text-[#ec9324] shadow-sm ring-1 ring-[#ec9324]/30"
                            : "text-gray-600 hover:text-gray-900"
                        }`}
                        data-testid="ws-mode-manual"
                      >
                        <MousePointerClick size={13} /> Manual Selection
                      </button>
                      <button
                        type="button"
                        onClick={() => switchMode("auto")}
                        disabled={!canEdit || saving}
                        className={`text-[12px] font-semibold py-1.5 rounded-md transition flex items-center justify-center gap-1.5 ${
                          bookingMode === "auto"
                            ? "bg-white text-[#ec9324] shadow-sm ring-1 ring-[#ec9324]/30"
                            : "text-gray-600 hover:text-gray-900"
                        }`}
                        data-testid="ws-mode-auto"
                      >
                        <Wand2 size={13} /> Team Auto Assignment
                      </button>
                    </div>
                  )}

                  {/* ============ AUTO ASSIGNMENT (team-first flow) ============ */}
                  {bookingMode === "auto" && (
                    <>
                      {/* Team selector — required before the user can click a
                          starting seat. Changing team resets any proposal. */}
                      <div>
                        <label className="text-xs font-medium text-gray-700">
                          Team <span className="text-red-500">*</span>
                        </label>
                        <select
                          value={teamId}
                          onChange={(e) => {
                            setTeamId(e.target.value);
                            setSelectedSeatIds([]);
                            setManualEmpIds([]);
                            setAutoStartSeatId(null);
                            setAutoSuggestion(null);
                          }}
                          disabled={!canEdit || refLoading}
                          className="mt-1 w-full text-sm rounded-md border border-gray-300 px-2 py-2 bg-white disabled:bg-gray-50 disabled:text-gray-400"
                          data-testid="ws-auto-team-select"
                        >
                          <option value="">{refLoading ? "Loading…" : "Select team"}</option>
                          {teams.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* Team info card — shows total team size + how many are
                          available for booking on the selected date. */}
                      {selectedTeam && (
                        <div
                          className="rounded-md border border-[#ec9324]/30 bg-[#ec9324]/5 p-3 space-y-1.5"
                          data-testid="ws-auto-team-info"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-gray-900 truncate">
                              {selectedTeam.name}
                            </div>
                            <span
                              className="text-[11px] font-semibold bg-white px-2 py-0.5 rounded-full ring-1 ring-[#ec9324]/40 text-[#ec9324] whitespace-nowrap"
                              data-testid="ws-auto-team-size"
                            >
                              {teamMemberCount} member{teamMemberCount === 1 ? "" : "s"}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-600 flex items-center gap-1">
                            <Users size={11} />
                            {teamPool.length} available for booking on {fmtDate(date)}
                          </div>
                        </div>
                      )}

                      {/* Awaiting-team hint */}
                      {autoPhase === "awaiting-team" && (
                        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-[12px] text-gray-600 flex items-start gap-2">
                          <AlertTriangle size={13} className="mt-[1px] flex-shrink-0" />
                          <span>Pick a team above to enable auto-assignment.</span>
                        </div>
                      )}

                      {/* Awaiting-start hint */}
                      {autoPhase === "awaiting-start" && (
                        <div
                          className="rounded-md border border-blue-100 bg-blue-50 p-3 text-[12px] text-blue-900 flex items-start gap-2"
                          data-testid="ws-auto-instruction"
                        >
                          <MousePointerClick size={14} className="mt-[1px] flex-shrink-0" />
                          <div>
                            Click a <strong>starting workstation</strong> on the floor map.
                            {teamMemberCount > 0 && (
                              <>
                                {" "}The system will auto-select the next{" "}
                                <strong>{teamMemberCount}</strong> consecutive
                                available seat{teamMemberCount === 1 ? "" : "s"}.
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Proposed selection summary */}
                      {autoPhase === "proposed" && (
                        <div
                          className="rounded-md border border-emerald-200 bg-emerald-50 p-3 space-y-2"
                          data-testid="ws-auto-proposed"
                        >
                          <div className="flex items-center gap-1.5 text-emerald-800 text-sm font-semibold">
                            <CheckCircle2 size={15} /> Proposed Selection
                          </div>
                          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px]">
                            <div className="text-gray-600">Team</div>
                            <div className="text-gray-900 font-medium truncate">{selectedTeam?.name || "—"}</div>
                            <div className="text-gray-600">Team Size</div>
                            <div className="text-gray-900 font-medium">{teamMemberCount} member{teamMemberCount === 1 ? "" : "s"}</div>
                            <div className="text-gray-600">Starting</div>
                            <div className="text-gray-900 font-medium" data-testid="ws-auto-start-label">
                              {autoStartSeatId ? (allSeats.find(s => s.id === autoStartSeatId)?.label || autoStartSeatId) : "—"}
                            </div>
                            <div className="text-gray-600">Selected</div>
                            <div className={`font-medium ${seatCount < teamMemberCount ? "text-amber-700" : "text-gray-900"}`}>
                              {seatCount} workstation{seatCount === 1 ? "" : "s"}
                              {seatCount !== teamMemberCount && (
                                <span className="ml-1 text-[10px] text-amber-700">
                                  (modified)
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="pt-1.5 border-t border-emerald-100">
                            <div className="text-[11px] text-gray-600 mb-1.5">Workstations</div>
                            <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                              {selectedSeatIds
                                .map((sid) => allSeats.find((x) => x.id === sid) || { id: sid, label: sid })
                                .sort((a, b) =>
                                  String(a.label || a.id).localeCompare(
                                    String(b.label || b.id),
                                    undefined,
                                    { numeric: true, sensitivity: "base" }
                                  )
                                )
                                .map((s) => (
                                  <span
                                    key={s.id}
                                    className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-white ring-1 ring-emerald-300 text-[11px] font-medium text-emerald-900"
                                    data-testid={`ws-auto-chip-${s.id}`}
                                  >
                                    {s.label || s.id}
                                    <button
                                      type="button"
                                      onClick={() => toggleSeat(s.id)}
                                      disabled={!canEdit || saving}
                                      className="text-emerald-500 hover:text-emerald-800 rounded-full hover:bg-emerald-100 w-4 h-4 flex items-center justify-center"
                                      aria-label={`Remove ${s.label || s.id}`}
                                    >
                                      <X size={10} />
                                    </button>
                                  </span>
                                ))}
                            </div>
                            <div className="mt-2 text-[10.5px] text-emerald-800/80 flex items-center gap-1">
                              <Pencil size={10} /> Click Modify (or seats on the map) to add / remove workstations.
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* ============ MANUAL SELECTION (existing flow) ============ */}
                  {bookingMode === "manual" && (
                    <>
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
                    </>
                  )}

                  {/* Booking Date — duplicate of header date for clarity, kept in sync */}
                  <div>
                    <label className="text-xs font-medium text-gray-700">
                      {isRequestMode ? "Request Date" : "Booking Date"}
                    </label>
                    {isRequestMode ? (
                      <div className="mt-1">
                        <DateFilter
                          value={{ field: "date", mode: "on", from: date ? new Date(date + "T00:00:00") : null, to: null }}
                          onChange={(v) => {
                            if (!v?.from) { setDateAndClear(""); return; }
                            const d = v.from;
                            const p = (n) => String(n).padStart(2, "0");
                            setDateAndClear(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
                          }}
                          fields={["date"]}
                          singleDate
                          minDate={todayIso()}
                          label="Request Date"
                          testId="ws-form-date"
                          className="w-full"
                        />
                      </div>
                    ) : (
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDateAndClear(e.target.value)}
                        disabled={!canEdit}
                        className="mt-1 w-full text-sm rounded-md border border-gray-300 px-2 py-2 bg-white"
                        data-testid="ws-form-date"
                      />
                    )}
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
                          <label className="text-[11px] text-gray-600">End Date <span className="text-red-500">*</span></label>
                          <input
                            type="date"
                            value={recurringEnd}
                            min={date}
                            max={(() => {
                              // 3 months from the booking (start) date
                              const d = new Date(date + "T00:00:00");
                              d.setMonth(d.getMonth() + 3);
                              const y = d.getFullYear();
                              const m = String(d.getMonth() + 1).padStart(2, "0");
                              const dd = String(d.getDate()).padStart(2, "0");
                              return `${y}-${m}-${dd}`;
                            })()}
                            onChange={(e) => setRecurringEnd(e.target.value)}
                            disabled={!canEdit}
                            required
                            placeholder="Select end date"
                            className="mt-1 w-full text-sm rounded-md border border-gray-300 px-2 py-1.5 bg-white"
                            data-testid="ws-recurring-end"
                          />
                          <div className="text-[10px] text-gray-500 mt-0.5">Max 3 months from booking date.</div>
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
                    {bookingMode === "auto" && autoPhase === "awaiting-team" && "Pick a team, then click a starting workstation on the map."}
                    {bookingMode === "auto" && autoPhase === "awaiting-start" && `Click any available workstation to auto-select ${teamMemberCount} seats for ${selectedTeam?.name || "the team"}.`}
                    {bookingMode === "auto" && autoPhase === "proposed" && (isRequestMode
                      ? `Requesting ${seatCount} workstation${seatCount === 1 ? "" : "s"} for team "${selectedTeam?.name}" on ${fmtDate(date)}.`
                      : `Booking ${seatCount} workstation${seatCount === 1 ? "" : "s"} for team "${selectedTeam?.name}" on ${fmtDate(date)}.`)}
                    {bookingMode === "manual" && seatCount === 0 && "Click a workstation on the map (or use the dropdown) to start."}
                    {bookingMode === "manual" && isSingle && employeeId && (isRequestMode
                      ? `Requesting 1 workstation for ${employees.find(e => e.id === employeeId)?.name || "employee"} on ${fmtDate(date)}.`
                      : `Booking 1 workstation for ${employees.find(e => e.id === employeeId)?.name || "employee"} on ${fmtDate(date)}.`)}
                    {bookingMode === "manual" && isMulti && teamId && (isRequestMode
                      ? `Requesting ${seatCount} workstations for team "${selectedTeam?.name}" on ${fmtDate(date)} (${allocationMode}).`
                      : `Booking ${seatCount} workstations for team "${selectedTeam?.name}" on ${fmtDate(date)} (${allocationMode}).`)}
                  </div>

                  {/* Actions.
                      Auto Assignment shows an extra "Modify" button when a
                      proposal exists — it clears just the seats so the user
                      can click a new starting workstation while keeping the
                      picked team + date intact.  "Cancel" clears everything.
                  */}
                  <div className="flex gap-2 pt-2 border-t border-gray-200 sticky bottom-0 bg-white">
                    {permBook.isVisible && (
                    <Button
                      onClick={handleSave}
                      disabled={!canEdit || saving || !selectedPlanId || noSeats || (bookingMode === "auto" && autoPhase !== "proposed") || !permBook.canUse}
                      className="flex-1 bg-[#ec9324] hover:bg-[#d8821a] text-white"
                      data-testid="ws-save-button"
                    >
                      {saving ? (
                        <><Loader2 className="animate-spin mr-2" size={14}/>{submitInProgressLabel}</>
                      ) : bookingMode === "auto" ? (
                        <><CheckCircle2 size={14} className="mr-1.5"/>Confirm Booking</>
                      ) : (
                        submitLabel
                      )}
                    </Button>
                    )}
                    {bookingMode === "auto" && autoPhase === "proposed" && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setSelectedSeatIds([]);
                          setManualEmpIds([]);
                          setAutoStartSeatId(null);
                          toast.info("Click a new starting workstation on the map.");
                        }}
                        disabled={!canEdit || saving}
                        data-testid="ws-modify-button"
                        title="Clear the current proposal and pick a new starting workstation"
                      >
                        <Pencil size={13} className="mr-1"/> Modify
                      </Button>
                    )}
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

      {/* ============================================================
          Best-Available Block suggestion dialog.
          Shown when the user's chosen starting workstation cannot fit the
          entire team but the system found a nearby block that can.  Three
          actions: use the suggestion, pick a different start, or cancel.
      ============================================================ */}
      <Dialog
        open={!!autoSuggestion}
        onOpenChange={(open) => { if (!open) setAutoSuggestion(null); }}
      >
        <DialogContent data-testid="ws-auto-suggestion-dialog" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle size={18} /> Not enough consecutive seats
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-700 pt-2">
              {autoSuggestion && (
                <>
                  <span className="font-semibold">
                    {autoSuggestion.required} consecutive workstations are not available from{" "}
                    <span className="text-gray-900">{autoSuggestion.chosenStart.label}</span>.
                  </span>
                  <br />
                  The nearest available block starts at{" "}
                  <span className="font-semibold text-emerald-700">{autoSuggestion.suggestedStart.label}</span>.
                  Would you like to use this instead?
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {autoSuggestion && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 space-y-1.5">
              <div className="text-[11px] font-semibold text-emerald-800">Suggested block</div>
              <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                {autoSuggestion.suggestedSeats.map((s) => (
                  <span
                    key={s.id}
                    className="inline-flex items-center px-2 py-0.5 rounded-full bg-white ring-1 ring-emerald-300 text-[11px] font-medium text-emerald-900"
                  >
                    {s.label || s.id}
                  </span>
                ))}
              </div>
              <div className="text-[11px] text-gray-600 pt-1">
                {autoSuggestion.suggestedSeats.length} workstation{autoSuggestion.suggestedSeats.length === 1 ? "" : "s"} · starting at{" "}
                <strong>{autoSuggestion.suggestedStart.label}</strong>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setAutoSuggestion(null)}
              data-testid="ws-suggestion-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setAutoSuggestion(null);
                toast.info("Click a different starting workstation on the map.");
              }}
              data-testid="ws-suggestion-choose-another"
            >
              Choose Another Starting Workstation
            </Button>
            <Button
              onClick={acceptSuggestion}
              className="bg-[#ec9324] hover:bg-[#d8821a] text-white"
              data-testid="ws-suggestion-use"
            >
              <CheckCircle2 size={14} className="mr-1.5" /> Use Suggested Block
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
