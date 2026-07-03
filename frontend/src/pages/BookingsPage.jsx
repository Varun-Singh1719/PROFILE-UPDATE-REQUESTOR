/**
 * BookingsPage.jsx
 * ----------------
 * Centralized Bookings module. Aggregates every booking the system knows about
 * (today: meeting-room only; workstation is a future addition) into one screen
 * with filtering, search, pagination, sorting, row selection, bulk cancel,
 * export, and a right-side details drawer.
 *
 * Data source: GET /api/bookings  (see backend/routers/bookings.py)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardList, Search, RefreshCw, Download, X, Eye, Pencil, Trash2,
  Calendar, ChevronDown, Loader2, ArrowUp, ArrowDown,
  AlertCircle, Repeat, ChevronUp,
} from "lucide-react";
import Layout from "../components/Layout";
import Pagination from "../components/Pagination";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import DateFilter from "../components/DateFilter";
import api from "../lib/api";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { toast } from "../lib/notify";
import { useNavigate, useSearchParams } from "react-router-dom";
import { confirm as confirmDialog } from '../lib/dialog';

// ---------------------------------------------------------------------------- helpers
const todayIso = () => {
  const d = new Date(); const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const todayIsoOf = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${months[d.getMonth()]}-${d.getFullYear()}`;
};
const fmtDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${months[d.getMonth()]}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmtTime = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  } catch { return iso; }
};
const fmtTimeRange = (s, e) => `${fmtTime(s)} – ${fmtTime(e)}`;

const STATUS_PILL = {
  Active:    { bg: "bg-emerald-50",  fg: "text-emerald-700",  ring: "ring-emerald-200" },
  Cancelled: { bg: "bg-gray-100",    fg: "text-gray-600",     ring: "ring-gray-200"    },
  Completed: { bg: "bg-orange-50",   fg: "text-[#ec9324]",    ring: "ring-orange-200"  },
};

const useDebounced = (value, delay = 300) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
};

// ---------------------------------------------------------------------------- MAIN
export default function BookingsPage() {
  const navigate = useNavigate();

  // Filters — all multi-select filters use arrays of ids
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [typeFilter, setTypeFilter] = useState([]);       // [] = all types
  const [status, setStatus] = useState([]);               // [] = all statuses
  const [teamId, setTeamId] = useState([]);               // [] = all teams
  const [employeeId, setEmployeeId] = useState([]);       // [] = all employees
  const [createdById, setCreatedById] = useState([]);     // [] = all
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 350);

  // Sort/page
  const [sort, setSort] = useState("date");
  const [direction, setDirection] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Data
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filter options
  const [filterOptions, setFilterOptions] = useState({ teams: [], employees: [], creators: [] });

  // Selection
  const [selected, setSelected] = useState(new Set());

  // Drawer
  const [drawerBooking, setDrawerBooking] = useState(null);

  // Deep-link: ?bookingId=<id|seq_no> opens the detail drawer once the data loads.
  // Used by Workstation Booking floor map when an occupied seat is clicked.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const bid = searchParams.get("bookingId");
    if (!bid) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get(`/bookings/${encodeURIComponent(bid)}`);
        if (!cancelled && r.data) setDrawerBooking(r.data);
      } catch {
        if (!cancelled) toast.error("Booking not found");
      } finally {
        // Strip the query so refreshing doesn't keep reopening the drawer
        if (!cancelled) {
          const sp = new URLSearchParams(searchParams);
          sp.delete("bookingId");
          setSearchParams(sp, { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bulk cancel confirm
  const [confirmBulkCancel, setConfirmBulkCancel] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Export menu
  const [exportOpen, setExportOpen] = useState(false);
  const exportMenuRef = useRef(null);
  useEffect(() => {
    if (!exportOpen) return;
    const onDoc = (e) => { if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setExportOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [exportOpen]);

  // ---- Data loading ----------------------------------------------------------
  // Filter options (one-shot)
  const loadFilters = useCallback(async () => {
    try {
      const r = await api.get("/bookings/filters");
      setFilterOptions(r.data || { teams: [], employees: [], creators: [] });
    } catch { /* non-fatal */ }
  }, []);

  const buildParams = useCallback(() => {
    const p = { page, page_size: pageSize, sort, direction };
    p.type = typeFilter.length > 0 ? typeFilter.join(",") : "all";
    p.status = status.length > 0 ? status.join(",") : "all";
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    if (teamId.length > 0) p.team_id = teamId.join(",");
    if (employeeId.length > 0) p.employee_id = employeeId.join(",");
    if (createdById.length > 0) p.created_by_id = createdById.join(",");
    if (debouncedSearch) p.search = debouncedSearch;
    return p;
  }, [page, pageSize, sort, direction, status, typeFilter, dateFrom, dateTo, teamId, employeeId, createdById, debouncedSearch]);

  // Manual refresh button (no effect — caller can mark `refreshing` itself)
  const refreshNow = useCallback(() => {
    setRefreshing(true);
    api.get("/bookings", { params: buildParams() })
      .then(r => {
        setRows(r.data?.items || []);
        setTotal(r.data?.total || 0);
      })
      .catch(e => toast.error(e?.response?.data?.detail || "Failed to load bookings"))
      .finally(() => setRefreshing(false));
  }, [buildParams]);

  // Data effect: state updates happen inside promise callbacks (not synchronously in the effect)
  useEffect(() => {
    let cancelled = false;
    const params = buildParams();
    api.get("/bookings", { params })
      .then(r => {
        if (cancelled) return;
        setRows(r.data?.items || []);
        setTotal(r.data?.total || 0);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        toast.error(e?.response?.data?.detail || "Failed to load bookings");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [buildParams]);

  useEffect(() => { loadFilters(); }, [loadFilters]);

  // Wrap each filter setter to also reset pagination + selection in the same render.
  const onFilterChange = useCallback((setter) => (val) => {
    setter(val);
    setPage(1);
    setSelected(new Set());
  }, []);

  // ---- Sorting ---------------------------------------------------------------
  const onSort = (field) => {
    if (sort === field) setDirection(direction === "asc" ? "desc" : "asc");
    else { setSort(field); setDirection("asc"); }
    setPage(1);
  };

  // ---- Selection -------------------------------------------------------------
  const allOnPageSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  const toggleAllOnPage = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) rows.forEach(r => next.delete(r.id));
      else rows.forEach(r => next.add(r.id));
      return next;
    });
  };
  const toggleOne = (id) => {
    setSelected(prev => {
      const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  // ---- Actions ---------------------------------------------------------------
  const onView = (b) => setDrawerBooking(b);
  const onEdit = (b) => {
    // Route to Meeting Room Booking page with the booking id pre-loaded for reschedule.
    // We pass via query param; the MRB page can read it on mount (future enhancement).
    navigate(`/workspace-manager/meeting-room-booking?reschedule=${b.id}`);
  };
  const onCancel = async (b) => {
    if (b.status === "Cancelled") { toast.info("Already cancelled"); return; }
    const ok = await confirmDialog({ title: 'Cancel booking', message: `Cancel booking #${b.seq_no} (${b.title})?`, confirmLabel: 'Cancel booking', confirmVariant: 'destructive' });
    if (!ok) return;
    try {
      await api.delete(`/room-bookings/${b.id}`);
      toast.success("Booking cancelled");
      refreshNow();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Cancel failed");
    }
  };
  const onBulkCancel = async () => {
    setBulkBusy(true);
    try {
      const ids = Array.from(selected);
      const r = await api.post("/bookings/bulk-cancel", { booking_ids: ids });
      const n = r.data?.count || 0;
      toast.success(`${n} booking${n === 1 ? "" : "s"} cancelled`);
      clearSelection();
      setConfirmBulkCancel(false);
      refreshNow();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Bulk cancel failed");
    } finally {
      setBulkBusy(false);
    }
  };
  const downloadExport = (format, selectedOnly = false) => {
    const params = { ...buildParams(), format };
    delete params.page; delete params.page_size; delete params.sort; delete params.direction;
    if (selectedOnly) {
      params.ids = Array.from(selected).join(",");
    }
    const qs = new URLSearchParams(params).toString();
    // Use the same backend URL the api client uses.
    const base = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
    const url = `${base}/api/bookings/export?${qs}`;
    const token = localStorage.getItem("token") || "";
    // Use fetch + blob so we can include the Authorization header
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (!r.ok) throw new Error("Export failed"); return r.blob(); })
      .then(blob => {
        const a = document.createElement("a");
        const objectUrl = URL.createObjectURL(blob);
        a.href = objectUrl;
        a.download = `bookings.${format}`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(objectUrl);
      })
      .catch(() => toast.error("Export failed"));
    setExportOpen(false);
  };

  // ---- Reset filters ---------------------------------------------------------
  const resetFilters = () => {
    setDateFrom(todayIso()); setDateTo(todayIso());
    setStatus([]); setTeamId([]); setEmployeeId([]); setCreatedById([]);
    setTypeFilter([]); setSearch("");
    setPage(1); setSelected(new Set());
  };

  // ---- Date filter adapter (feeds the shared <DateFilter/> popup) ------------
  const dateFilterValue = useMemo(() => {
    // ISO "YYYY-MM-DD" → local Date at midnight; empty → null
    const parse = (iso) => (iso ? new Date(`${iso}T00:00:00`) : null);
    const from = parse(dateFrom);
    const to = parse(dateTo);
    let mode = "between";
    if (from && to) mode = from.getTime() === to.getTime() ? "on" : "between";
    else if (from && !to) mode = "after";
    else if (!from && to) mode = "before";
    return { field: "date", mode, from, to };
  }, [dateFrom, dateTo]);

  const applyDateFilter = (next) => {
    const iso = (d) => (d ? todayIsoOf(d) : "");
    if (!next?.from && !next?.to) { setDateFrom(""); setDateTo(""); setPage(1); return; }
    if (next.mode === "between") {
      setDateFrom(iso(next.from));
      setDateTo(iso(next.to || next.from));
    } else if (next.mode === "on") {
      setDateFrom(iso(next.from)); setDateTo(iso(next.from));
    } else if (next.mode === "after") {
      setDateFrom(iso(next.from)); setDateTo("");
    } else if (next.mode === "before") {
      setDateFrom(""); setDateTo(iso(next.from));
    }
    setPage(1);
  };

  return (
    <Layout
      title="Bookings"
      actions={
        <>
          {/* Export */}
          <div className="relative" ref={exportMenuRef}>
            <Button
              variant="outline" size="icon"
              onClick={() => setExportOpen(o => !o)}
              data-testid="bookings-export-btn"
              className="h-9 w-9"
              title="Export"
              aria-label="Export"
            ><Download size={16}/></Button>
            {exportOpen && (
              <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-md shadow-lg z-30 py-1 text-xs" data-testid="bookings-export-menu">
                <button onClick={() => downloadExport("csv")} className="w-full text-left px-3 py-1.5 hover:bg-gray-50" data-testid="bookings-export-csv">CSV (all filtered)</button>
                <button onClick={() => downloadExport("xlsx")} className="w-full text-left px-3 py-1.5 hover:bg-gray-50" data-testid="bookings-export-xlsx">Excel (all filtered)</button>
                {selected.size > 0 && (
                  <>
                    <div className="border-t border-gray-100 my-1"/>
                    <button onClick={() => downloadExport("csv", true)} className="w-full text-left px-3 py-1.5 hover:bg-gray-50" data-testid="bookings-export-selected-csv">CSV (selected {selected.size})</button>
                    <button onClick={() => downloadExport("xlsx", true)} className="w-full text-left px-3 py-1.5 hover:bg-gray-50" data-testid="bookings-export-selected-xlsx">Excel (selected {selected.size})</button>
                  </>
                )}
              </div>
            )}
          </div>
          {/* Refresh */}
          <Button
            variant="outline" size="icon"
            onClick={() => refreshNow()}
            disabled={refreshing}
            data-testid="bookings-refresh-btn"
            className="h-9 w-9"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""}/>
          </Button>
        </>
      }
    >
      <div className="flex-1 min-h-0 flex flex-col bg-gray-50 -mx-4 -mt-4 -mb-3">
        {/* FILTERS — single row, sticky */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 sticky top-0 z-20" data-testid="bookings-filters">
          <div className="flex flex-wrap items-center gap-2">
            {/* Date range */}
            <div data-testid="bookings-date-range">
              <DateFilter
                value={dateFilterValue}
                onChange={applyDateFilter}
                fields={["date"]}
                label="Date"
                testId="bookings-date-filter"
              />
            </div>
            {/* Search */}
            <div className="relative w-56">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={14}/>
              <input
                type="text"
                placeholder="Search seat / room…"
                value={search}
                onChange={e => onFilterChange(setSearch)(e.target.value)}
                data-testid="bookings-search"
                className="w-full h-9 pl-7 pr-3 py-1.5 border border-gray-200 rounded-md text-xs focus:outline-none focus:border-[#ec9324]"
              />
            </div>
            {/* Type */}
            <MultiSelectFilter
              label="Type"
              value={typeFilter}
              onChange={onFilterChange(setTypeFilter)}
              options={[
                { value: "workstation", label: "Workstation" },
                { value: "meeting_room", label: "Meeting Room" },
              ]}
              testIdPrefix="bookings-type-filter"
              className="w-40"
            />
            {/* Status */}
            <MultiSelectFilter
              label="Status"
              value={status}
              onChange={onFilterChange(setStatus)}
              options={[
                { value: "active", label: "Active" },
                { value: "cancelled", label: "Cancelled" },
                { value: "completed", label: "Completed" },
              ]}
              testIdPrefix="bookings-status-filter"
              className="w-44"
            />
            {/* Team */}
            <MultiSelectFilter
              label="Team"
              value={teamId}
              onChange={onFilterChange(setTeamId)}
              options={(filterOptions.teams || []).map(t => ({ value: t.id, label: t.name }))}
              testIdPrefix="bookings-team-filter"
              className="w-48"
            />
            {/* Employee */}
            <MultiSelectFilter
              label="Employee"
              value={employeeId}
              onChange={onFilterChange(setEmployeeId)}
              options={(filterOptions.employees || []).map(e => ({
                value: e.id,
                label: e.name + (e.emp_id ? ` (${e.emp_id})` : ""),
              }))}
              testIdPrefix="bookings-employee-filter"
              className="w-52"
            />
            {/* Created by */}
            <MultiSelectFilter
              label="Created By"
              value={createdById}
              onChange={onFilterChange(setCreatedById)}
              options={(filterOptions.creators || []).map(c => ({ value: c.id, label: c.name }))}
              testIdPrefix="bookings-creator-filter"
              className="w-48"
              align="right"
            />
            {/* Reset */}
            <button
              onClick={resetFilters}
              className="ml-auto text-[11px] text-gray-500 hover:text-[#ec9324] underline"
              data-testid="bookings-reset-filters"
            >Reset</button>
            {refreshing && <Loader2 size={14} className="animate-spin text-gray-400"/>}
          </div>
        </div>

        {/* BULK ACTION BAR */}
        {selected.size > 0 && (
          <div className="bg-[#ec9324]/10 border-b border-[#ec9324]/30 px-6 py-2 flex items-center justify-between" data-testid="bookings-bulk-bar">
            <div className="text-xs text-gray-800">
              <strong>{selected.size}</strong> booking{selected.size === 1 ? "" : "s"} selected
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => downloadExport("xlsx", true)} data-testid="bookings-bulk-export">
                <Download size={12} className="mr-1"/> Export Selected
              </Button>
              <Button size="sm" variant="destructive" className="text-xs h-7" onClick={() => setConfirmBulkCancel(true)} data-testid="bookings-bulk-cancel">
                <Trash2 size={12} className="mr-1"/> Bulk Cancel
              </Button>
              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={clearSelection} data-testid="bookings-bulk-clear">Clear</Button>
            </div>
          </div>
        )}

        {/* TABLE */}
        <div className="flex-1 min-h-0 overflow-auto" data-testid="bookings-table-wrapper">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="animate-spin" size={24}/>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState />
          ) : (
            <table className="w-full text-xs" data-testid="bookings-table">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
                <tr className="text-left text-gray-600 uppercase tracking-wide text-[10px] font-bold">
                  <th className="px-3 py-2 w-8">
                    <Checkbox checked={allOnPageSelected} onCheckedChange={toggleAllOnPage} data-testid="bookings-select-all"/>
                  </th>
                  <ThSort label="Booking ID" field="seq_no" currentSort={sort} currentDir={direction} onSort={onSort}/>
                  <th className="px-3 py-2">Type</th>
                  <ThSort label="Seat / Room" field="room_name" currentSort={sort} currentDir={direction} onSort={onSort}/>
                  <ThSort label="Employee" field="organizer" currentSort={sort} currentDir={direction} onSort={onSort}/>
                  <th className="px-3 py-2">Team</th>
                  <ThSort label="Date" field="date" currentSort={sort} currentDir={direction} onSort={onSort}/>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Recurring</th>
                  <ThSort label="Status" field="status" currentSort={sort} currentDir={direction} onSort={onSort}/>
                  <th className="px-3 py-2">Created By</th>
                  <ThSort label="Created On" field="created_at" currentSort={sort} currentDir={direction} onSort={onSort}/>
                  <th className="px-3 py-2 w-24 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {rows.map(b => (
                  <BookingRow
                    key={b.id}
                    booking={b}
                    selected={selected.has(b.id)}
                    onToggle={() => toggleOne(b.id)}
                    onView={() => onView(b)}
                    onEdit={() => onEdit(b)}
                    onCancel={() => onCancel(b)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* PAGINATION */}
        {!loading && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            label="Bookings"
            testIdPrefix="bookings-pg"
          />
        )}
      </div>

      {/* RIGHT DRAWER */}
      {drawerBooking && (
        <BookingDetailsDrawer booking={drawerBooking} onClose={() => setDrawerBooking(null)} onEdit={() => { setDrawerBooking(null); onEdit(drawerBooking); }} onCancel={() => { onCancel(drawerBooking); setDrawerBooking(null); }} />
      )}

      {/* BULK CANCEL CONFIRM */}
      {confirmBulkCancel && (
        <ConfirmModal
          title="Cancel selected bookings?"
          message={`This will cancel ${selected.size} booking${selected.size === 1 ? "" : "s"}. This action cannot be undone.`}
          confirmLabel="Cancel Bookings"
          confirmVariant="destructive"
          busy={bulkBusy}
          onCancel={() => setConfirmBulkCancel(false)}
          onConfirm={onBulkCancel}
        />
      )}
    </Layout>
  );
}

// ----------------------------------------------------------------- Filter label
function FilterLabel({ children }) {
  return <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1">{children}</div>;
}

// ----------------------------------------------------------------- Sortable header
function ThSort({ label, field, currentSort, currentDir, onSort }) {
  const active = currentSort === field;
  return (
    <th className="px-3 py-2 cursor-pointer select-none hover:text-gray-900" onClick={() => onSort(field)} data-testid={`bookings-th-${field}`}>
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (currentDir === "asc" ? <ArrowUp size={10}/> : <ArrowDown size={10}/>)}
      </span>
    </th>
  );
}

// ----------------------------------------------------------------- Row
function BookingRow({ booking: b, selected, onToggle, onView, onEdit, onCancel }) {
  const isCancelled = b.status === "Cancelled";
  return (
    <tr className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${isCancelled ? "opacity-70" : ""}`} data-testid={`bookings-row-${b.id}`}>
      <td className="px-3 py-2">
        <Checkbox checked={selected} onCheckedChange={onToggle} data-testid={`bookings-row-checkbox-${b.id}`}/>
      </td>
      <td className="px-3 py-2 font-mono">
        <button onClick={onView} className="text-[#ec9324] hover:underline font-semibold" data-testid={`bookings-row-id-${b.id}`}>
          #{b.seq_no}
        </button>
      </td>
      <td className="px-3 py-2">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-semibold ring-1 ring-blue-200">
          {b.type}
        </span>
      </td>
      <td className="px-3 py-2 font-medium text-gray-900 max-w-[180px] truncate" title={b.room_name}>{b.room_name}</td>
      <td className="px-3 py-2 text-gray-800 max-w-[160px] truncate" title={b.organizer?.name}>{b.organizer?.name || "—"}</td>
      <td className="px-3 py-2 text-gray-600">{b.organizer_team_name || "—"}</td>
      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtDate(b.start_at)}</td>
      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtTimeRange(b.start_at, b.end_at)}</td>
      <td className="px-3 py-2">
        {b.recurring ? (
          <span className="relative group inline-flex items-center gap-1 text-emerald-700 font-semibold">
            Yes <Repeat size={11}/>
            <span className="pointer-events-none absolute left-0 top-5 z-20 px-2 py-1 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap shadow opacity-0 group-hover:opacity-100 transition-opacity">
              {(b.recurring.frequency || "").toUpperCase()} · until {b.recurring.end_date}
              {b.recurring.days?.length ? ` · ${b.recurring.days.join(",")}` : ""}
            </span>
          </span>
        ) : <span className="text-gray-400">No</span>}
      </td>
      <td className="px-3 py-2">
        <StatusBadge status={b.status}/>
      </td>
      <td className="px-3 py-2 text-gray-600 max-w-[140px] truncate" title={b.created_by?.name}>{b.created_by?.name || "—"}</td>
      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{fmtDateTime(b.created_at)}</td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-center gap-0.5">
          <IconBtn label="View" onClick={onView} icon={Eye} testid={`bookings-action-view-${b.id}`} color="gray"/>
          <IconBtn label="Edit / Reschedule" onClick={onEdit} icon={Pencil} testid={`bookings-action-edit-${b.id}`} color="orange" disabled={isCancelled}/>
          <IconBtn label="Cancel" onClick={onCancel} icon={Trash2} testid={`bookings-action-cancel-${b.id}`} color="red" disabled={isCancelled}/>
        </div>
      </td>
    </tr>
  );
}

function StatusBadge({ status }) {
  const s = STATUS_PILL[status] || STATUS_PILL.Active;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full ${s.bg} ${s.fg} text-[10px] font-bold ring-1 ${s.ring}`}>
      {status}
    </span>
  );
}

function IconBtn({ label, onClick, icon: Icon, testid, color = "gray", disabled = false }) {
  const colors = {
    gray:   "text-gray-600 hover:bg-gray-100",
    orange: "text-gray-600 hover:text-[#ec9324] hover:bg-orange-50",
    red:    "text-red-600 hover:bg-red-50",
  };
  return (
    <div className="relative group">
      <button
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        aria-label={label}
        className={`p-1 rounded ${colors[color]} ${disabled ? "opacity-30 cursor-not-allowed" : ""}`}
        data-testid={testid}
      ><Icon size={13}/></button>
      <span className="pointer-events-none absolute right-1/2 translate-x-1/2 -top-7 z-20 px-2 py-0.5 rounded bg-gray-900 text-white text-[10px] font-medium whitespace-nowrap shadow opacity-0 group-hover:opacity-100 transition-opacity">
        {label}
      </span>
    </div>
  );
}

// ----------------------------------------------------------------- Empty state
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center" data-testid="bookings-empty">
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-3">
        <ClipboardList className="text-gray-400" size={28}/>
      </div>
      <div className="text-sm font-bold text-gray-800 uppercase tracking-wide">No Bookings Available</div>
      <div className="text-xs text-gray-500 mt-1 max-w-sm">
        No workstation or meeting room bookings match the selected filters.
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Drawer
function BookingDetailsDrawer({ booking: b, onClose, onEdit, onCancel }) {
  const isCancelled = b.status === "Cancelled";
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40 animate-in fade-in duration-200" onClick={onClose} data-testid="bookings-drawer-backdrop"/>
      <aside
        className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-xl z-50 flex flex-col animate-in slide-in-from-right duration-300"
        data-testid="bookings-drawer"
      >
        <header className="border-b border-gray-200 px-5 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 font-bold">Booking</div>
            <h2 className="text-base font-bold text-gray-900 truncate">#{b.seq_no} · {b.title}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100" data-testid="bookings-drawer-close">
            <X size={16}/>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          <DrawerSection title="Booking Information">
            <DrawerRow label="Booking ID" value={`#${b.seq_no}`}/>
            <DrawerRow label="Type" value={<span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded font-semibold">{b.type}</span>}/>
            <DrawerRow label="Status" value={<StatusBadge status={b.status}/>}/>
            <DrawerRow label="Created By" value={b.created_by?.name || "—"}/>
            <DrawerRow label="Created On" value={fmtDateTime(b.created_at)}/>
          </DrawerSection>

          <DrawerSection title="Resource Information">
            <DrawerRow label="Room Name" value={b.room_name}/>
            <DrawerRow label="Capacity" value={`${b.room_capacity || "—"} people`}/>
            <DrawerRow label="Floor / Plan" value={b.plan_name || "—"}/>
          </DrawerSection>

          <DrawerSection title="Meeting Details">
            <DrawerRow label="Title" value={b.title}/>
            <DrawerRow label="Organizer" value={`${b.organizer?.name || "—"}${b.organizer?.email ? ` · ${b.organizer.email}` : ""}`}/>
            <DrawerRow label="Team" value={b.organizer_team_name || "—"}/>
            <DrawerRow label="Date" value={fmtDate(b.start_at)}/>
            <DrawerRow label="Time" value={fmtTimeRange(b.start_at, b.end_at)}/>
            {b.recurring && (
              <DrawerRow label="Recurring" value={
                <div className="text-emerald-700">
                  <div className="font-semibold capitalize">{b.recurring.frequency}</div>
                  <div className="text-[10px] text-gray-500">Until {b.recurring.end_date}{b.recurring.days?.length ? ` · ${b.recurring.days.join(",")}` : ""}</div>
                </div>
              }/>
            )}
          </DrawerSection>

          {(b.attendees && b.attendees.length > 0) && (
            <DrawerSection title={`Attendees (${b.attendees.length})`}>
              <div className="space-y-1">
                {b.attendees.map((a, i) => (
                  <div key={i} className="flex items-center justify-between border border-gray-100 rounded px-2 py-1">
                    <div>
                      <div className="text-gray-800 font-medium">{a.name || a.email || "—"}</div>
                      {a.email && <div className="text-[10px] text-gray-500">{a.email}</div>}
                    </div>
                    <span className="text-[10px] uppercase text-gray-400 font-bold">{a.type}</span>
                  </div>
                ))}
              </div>
            </DrawerSection>
          )}
        </div>
        <footer className="border-t border-gray-200 px-5 py-3 flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose} className="text-xs">Close</Button>
          <Button size="sm" variant="outline" disabled={isCancelled} onClick={onEdit} className="text-xs" data-testid="bookings-drawer-edit">
            <Pencil size={12} className="mr-1"/> Reschedule
          </Button>
          <Button size="sm" variant="destructive" disabled={isCancelled} onClick={onCancel} className="text-xs" data-testid="bookings-drawer-cancel">
            <Trash2 size={12} className="mr-1"/> Cancel
          </Button>
        </footer>
      </aside>
    </>
  );
}

function DrawerSection({ title, children }) {
  return (
    <section>
      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-2">{title}</div>
      <div className="bg-gray-50 border border-gray-100 rounded p-2 space-y-1.5">
        {children}
      </div>
    </section>
  );
}

function DrawerRow({ label, value }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-28 flex-shrink-0 text-gray-500">{label}</div>
      <div className="flex-1 text-gray-900 break-words">{value}</div>
    </div>
  );
}

// ----------------------------------------------------------------- Confirm modal
function ConfirmModal({ title, message, confirmLabel, confirmVariant = "default", busy, onCancel, onConfirm }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50 animate-in fade-in duration-150" onClick={busy ? undefined : onCancel}/>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5 pointer-events-auto animate-in zoom-in-95 duration-150" data-testid="bookings-confirm-modal">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
              <AlertCircle size={18} className="text-red-600"/>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-900">{title}</h3>
              <p className="text-xs text-gray-600 mt-1">{message}</p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 mt-4">
            <Button size="sm" variant="outline" onClick={onCancel} disabled={busy} className="text-xs">Back</Button>
            <Button size="sm" variant={confirmVariant} onClick={onConfirm} disabled={busy} className="text-xs" data-testid="bookings-confirm-yes">
              {busy ? "Cancelling…" : confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
