/**
 * PermissionSetsListTab — the "Permission Sets" tab inside PermissionsPage.
 *
 * Layout (matches Bookings / TicketList pattern):
 *   • Filter bar — sticky at top
 *   • Table — flex-1, only this area scrolls; thead is sticky
 *   • Pagination — fixed at bottom of the flex column
 *
 * Columns: #ID | Name | Description | Created By | Created On | Updated On | # Users | Actions (⋮)
 * Filters: Date (created_on) · Search (name/desc) · Module (multi) · Created By (multi) · Updated By (multi)
 * Actions per row: View, Edit, Duplicate, Delete (soft)
 * # Users column is clickable → /admin/contacts?permission_set=<id>
 *
 * The parent (PermissionsPage) owns the "+ Add Permission Set" button (top bar) and
 * the "Refresh" button (next to the tab bar). It calls this component's `refresh()`
 * via a forwarded ref.
 */
import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState,
} from "react";
import { useNavigate } from "react-router-dom";
import Search from "@mui/icons-material/SearchOutlined";
import MoreVertical from "@mui/icons-material/MoreVert";
import Eye from "@mui/icons-material/Visibility";
import Pencil from "@mui/icons-material/EditOutlined";
import Copy from "@mui/icons-material/ContentCopy";
import Trash2 from "@mui/icons-material/DeleteOutlined";
import Loader2 from "@mui/icons-material/Autorenew";
import Users from "@mui/icons-material/PeopleOutlined";
import X from "@mui/icons-material/Close";
import ArrowUpDown from "@mui/icons-material/SwapVert";
import ArrowUp from "@mui/icons-material/ArrowUpward";
import ArrowDown from "@mui/icons-material/ArrowDownward";
import api from "../../lib/api";
import notify from "../../lib/notify";
import { confirm as confirmDialog } from "../../lib/dialog";
import MultiSelectFilter from "../ui/MultiSelectFilter";
import DateFilter from "../DateFilter";
import DeferredSearchInput from "../DeferredSearchInput";
import Pagination from "../Pagination";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "../ui/dropdown-menu";

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  } catch { return iso; }
}

function isoDay(d) {
  if (!d) return "";
  const dt = new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

const DEFAULT_PAGE_SIZE = 25;

const PermissionSetsListTab = forwardRef(function PermissionSetsListTab({ onView, onEdit }, ref) {
  const navigate = useNavigate();

  // ---- filter state ----
  const [search, setSearch] = useState("");
  const [createdBy, setCreatedBy] = useState([]);
  const [updatedBy, setUpdatedBy] = useState([]);
  const [moduleFilter, setModuleFilter] = useState([]);
  // Status: ["active"] by default → deleted sets hidden. ["deleted"] shows only
  // soft-deleted. ["active","deleted"] (or empty) shows everything.
  const [statusFilter, setStatusFilter] = useState(["active"]);
  // Date filter — { field: "created_on"|"updated_on", from: ISO, to: ISO }
  const [dateField, setDateField] = useState("updated_on");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // ---- sort + pagination ----
  const [sortBy, setSortBy] = useState("updated_on");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // ---- data ----
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  // ---- filter option pools ----
  const [creatorOpts, setCreatorOpts] = useState([]);
  const [updaterOpts, setUpdaterOpts] = useState([]);
  const [moduleOpts, setModuleOpts] = useState([]);

  const loadOptions = useCallback(async () => {
    try {
      const { data } = await api.get("/permission-sets-v3/filter-options");
      setCreatorOpts((data.created_by || []).map((u) => ({ value: u.id, label: u.name || u.email })));
      setUpdaterOpts((data.updated_by || []).map((u) => ({ value: u.id, label: u.name || u.email })));
      setModuleOpts((data.modules || []).map((m) => ({ value: m.key, label: m.label })));
    } catch (e) { /* ignore — filters degrade gracefully */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page,
        page_size: pageSize,
        sort_by: sortBy,
        sort_dir: sortDir,
      };
      if (search.trim()) params.q = search.trim().replace(/^#+/, "").trim();
      if (createdBy.length) params.created_by = createdBy.join(",");
      if (updatedBy.length) params.updated_by = updatedBy.join(",");
      if (moduleFilter.length) params.modules = moduleFilter.join(",");
      // Status — if empty or both, backend returns everything (send both explicitly)
      params.status = statusFilter.length ? statusFilter.join(",") : "active,deleted";
      if (dateFrom) {
        if (dateField === "updated_on") params.updated_from = dateFrom;
        else params.created_from = dateFrom;
      }
      if (dateTo) {
        if (dateField === "updated_on") params.updated_to = dateTo;
        else params.created_to = dateTo;
      }
      const { data } = await api.get("/permission-sets-v3", { params });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      notify.error(e, { what: "Load permission sets" });
    } finally { setLoading(false); }
  }, [page, pageSize, sortBy, sortDir, search, createdBy, updatedBy, moduleFilter, statusFilter, dateField, dateFrom, dateTo]);

  useEffect(() => { loadOptions(); }, [loadOptions]);
  useEffect(() => { load(); }, [load]);

  // Expose refresh() to parent (called by the Refresh button that sits next to the tab bar).
  useImperativeHandle(ref, () => ({
    refresh: () => { loadOptions(); load(); },
    isLoading: () => loading,
    total: () => total,
  }), [loadOptions, load, loading, total]);

  // ---- filter helpers ----
  const dateFilterValue = useMemo(() => {
    const parse = (iso) => (iso ? new Date(`${iso}T00:00:00`) : null);
    const from = parse(dateFrom);
    const to = parse(dateTo);
    let mode = "between";
    if (from && to) mode = from.getTime() === to.getTime() ? "on" : "between";
    else if (from && !to) mode = "after";
    else if (!from && to) mode = "before";
    return { field: dateField, mode, from, to };
  }, [dateField, dateFrom, dateTo]);

  const applyDateFilter = (next) => {
    setPage(1);
    // Field can flip inside the popup — sync it here
    if (next?.field && next.field !== dateField) setDateField(next.field);
    if (!next?.from && !next?.to) { setDateFrom(""); setDateTo(""); return; }
    if (next.mode === "between") { setDateFrom(isoDay(next.from)); setDateTo(isoDay(next.to || next.from)); }
    else if (next.mode === "on") { setDateFrom(isoDay(next.from)); setDateTo(isoDay(next.from)); }
    else if (next.mode === "after") { setDateFrom(isoDay(next.from)); setDateTo(""); }
    else if (next.mode === "before") { setDateFrom(""); setDateTo(isoDay(next.from)); }
  };

  const hasActiveFilters =
    !!search.trim() || createdBy.length > 0 || updatedBy.length > 0 || moduleFilter.length > 0
    || !!dateFrom || !!dateTo
    || !(statusFilter.length === 1 && statusFilter[0] === "active");

  const clearAll = () => {
    setSearch(""); setCreatedBy([]); setUpdatedBy([]); setModuleFilter([]);
    setStatusFilter(["active"]);
    setDateField("updated_on"); setDateFrom(""); setDateTo(""); setPage(1);
  };

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir(col === "title" ? "asc" : "desc"); }
    setPage(1);
  };

  const SortIcon = ({ col }) => {
    if (sortBy !== col) return <ArrowUpDown sx={{ fontSize: 11 }} className="text-gray-300"/>;
    return sortDir === "asc" ? <ArrowUp sx={{ fontSize: 11 }} className="text-[#ec9324]"/> : <ArrowDown sx={{ fontSize: 11 }} className="text-[#ec9324]"/>;
  };

  // ---- row actions ----
  const doDuplicate = async (row) => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      const { data } = await api.post(`/permission-sets-v3/${row.id}/duplicate`);
      notify.success(`Duplicated as "${data.title}" (#${data.seq_no})`);
      if (data.id) onEdit(data.id);
      else load();
    } catch (e) { notify.error(e, { what: "Duplicate permission set" }); }
    finally { setBusyId(null); }
  };

  const doDelete = async (row) => {
    const users = row.assigned_users_count || 0;
    const usersLine = users > 0
      ? `\nIt will also be un-assigned from ${users} ${users === 1 ? "employee" : "employees"}.`
      : "";
    const ok = await confirmDialog({
      title: `Delete "${row.title}"?`,
      message:
        `This is a soft-delete — the set will move to the Deleted tab and can still be viewed from the audit log.${usersLine}`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      confirmVariant: "destructive",
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      const { data } = await api.delete(`/permission-sets-v3/${row.id}`);
      const n = data?.unassigned_count || 0;
      notify.success(`Deleted "${row.title}"` + (n ? ` · un-assigned from ${n} employee(s)` : ""));
      load();
    } catch (e) { notify.error(e, { what: "Delete permission set" }); }
    finally { setBusyId(null); }
  };

  const goToEmployees = (row) => {
    navigate(`/admin/contacts?permission_set=${encodeURIComponent(row.id)}`);
  };

  return (
    // Fill remaining vertical space inside PermissionsPage (which itself is a flex-col).
    // The sticky filter row + sticky thead give the "freeze headers, scroll body" pattern.
    <div className="flex-1 min-h-0 flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden" data-testid="perm-sets-tab">
      {/* FILTERS — sticky (screen freezes here) */}
      <div className="border-b border-gray-200 bg-white px-4 py-3 sticky top-0 z-20">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search — label lives INSIDE the input as placeholder */}
          <DeferredSearchInput
            className="w-64"
            placeholder="Name / Description"
            testId="perm-sets-search"
            value={search}
            onCommit={(v) => { setSearch(v); setPage(1); }}
          />

          {/* Date — DateFilter's own trigger already prefixes with the field name
              ("Updated At: All time" / "Created At: All time") and lets the user
              swap between the two fields inside the popup. */}
          <DateFilter
            value={dateFilterValue}
            onChange={applyDateFilter}
            fields={["updated_on", "created_on"]}
            testId="perm-sets-date-filter"
          />

          {/* Status */}
          <MultiSelectFilter
            label="Status"
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
            options={[
              { value: "active", label: "Active" },
              { value: "deleted", label: "Deleted" },
            ]}
            testIdPrefix="perm-sets-status"
            className="w-40"
          />

          {/* Module — placeholder shows "Module: All" via MultiSelectFilter's built-in label */}
          <MultiSelectFilter
            label="Module"
            value={moduleFilter}
            onChange={(v) => { setModuleFilter(v); setPage(1); }}
            options={moduleOpts}
            testIdPrefix="perm-sets-module"
            className="w-44"
          />

          {/* Created By */}
          <MultiSelectFilter
            label="Created By"
            value={createdBy}
            onChange={(v) => { setCreatedBy(v); setPage(1); }}
            options={creatorOpts}
            testIdPrefix="perm-sets-created-by"
            className="w-48"
          />

          {/* Updated By */}
          <MultiSelectFilter
            label="Updated By"
            value={updatedBy}
            onChange={(v) => { setUpdatedBy(v); setPage(1); }}
            options={updaterOpts}
            testIdPrefix="perm-sets-updated-by"
            className="w-48"
          />

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAll}
              className="h-9 px-3 rounded-md border border-gray-200 text-xs font-semibold text-gray-700 hover:border-[#ec9324] hover:text-[#ec9324] inline-flex items-center gap-1.5"
              data-testid="perm-sets-clear-all"
            >
              <X sx={{ fontSize: 12 }}/> Clear all
            </button>
          )}

          <div className="ml-auto text-xs text-gray-500">
            {loading ? "Loading…" : `${total.toLocaleString(undefined, { timeZone: "Asia/Kolkata" })} ${total === 1 ? "set" : "sets"}`}
          </div>
        </div>
      </div>

      {/* TABLE — the only scrollable region */}
      <div className="flex-1 min-h-0 overflow-auto" data-testid="perm-sets-table-wrapper">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-700 uppercase bg-gray-50 font-bold tracking-wider border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 text-left cursor-pointer select-none" onClick={() => toggleSort("seq_no")} data-testid="perm-sets-sort-id">
                <span className="inline-flex items-center gap-1">System ID <SortIcon col="seq_no"/></span>
              </th>
              <th className="px-4 py-3 text-left cursor-pointer select-none" onClick={() => toggleSort("title")} data-testid="perm-sets-sort-name">
                <span className="inline-flex items-center gap-1">Name <SortIcon col="title"/></span>
              </th>
              <th className="px-4 py-3 text-left">Description</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Created By</th>
              <th className="px-4 py-3 text-left cursor-pointer select-none" onClick={() => toggleSort("created_on")} data-testid="perm-sets-sort-created">
                <span className="inline-flex items-center gap-1">Created On <SortIcon col="created_on"/></span>
              </th>
              <th className="px-4 py-3 text-left">Updated By</th>
              <th className="px-4 py-3 text-left cursor-pointer select-none" onClick={() => toggleSort("updated_on")} data-testid="perm-sets-sort-updated">
                <span className="inline-flex items-center gap-1">Updated On <SortIcon col="updated_on"/></span>
              </th>
              <th className="px-4 py-3 text-right cursor-pointer select-none" onClick={() => toggleSort("assigned_users")} data-testid="perm-sets-sort-users">
                <span className="inline-flex items-center gap-1 justify-end w-full">Users <SortIcon col="assigned_users"/></span>
              </th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {loading ? (
              <tr><td colSpan={10} className="text-center py-16"><Loader2 className="animate-spin inline text-[#ec9324]" sx={{ fontSize: 22 }}/></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-16 text-sm text-gray-500">
                No permission sets found.
              </td></tr>
            ) : items.map((s) => {
              const isDeleted = !!s.deleted_at;
              return (
                <tr key={s.id} className={`hover:bg-gray-50 ${isDeleted ? "opacity-70" : ""}`} data-testid={`perm-sets-row-${s.seq_no}`}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{s.seq_no || s.numeric_id}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onView(s.id)}
                      data-testid={`perm-sets-name-${s.seq_no}`}
                      className={`font-medium text-left hover:text-[#ec9324] hover:underline ${isDeleted ? "text-gray-600 line-through decoration-red-300/70" : "text-gray-900"}`}
                    >{s.title}</button>
                  </td>
                  <td className="px-4 py-3 text-gray-700 max-w-sm">
                    <div className="line-clamp-1">{s.description || <span className="text-gray-400">—</span>}</div>
                  </td>
                  <td className="px-4 py-3">
                    {isDeleted ? (
                      <span
                        data-testid={`perm-sets-status-deleted-${s.seq_no}`}
                        className="inline-flex items-center justify-center w-24 h-6 rounded-full border-2 text-[11px] font-semibold bg-white select-none whitespace-nowrap"
                        style={{ color: "#dc2626", borderColor: "#dc2626" }}
                      >Deleted</span>
                    ) : (
                      <span
                        data-testid={`perm-sets-status-active-${s.seq_no}`}
                        className="inline-flex items-center justify-center w-24 h-6 rounded-full border-2 text-[11px] font-semibold bg-white select-none whitespace-nowrap"
                        style={{ color: "#16a34a", borderColor: "#16a34a" }}
                      >Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-900 text-xs">{s.created_by?.name || "—"}</td>
                  <td className="px-4 py-3 text-gray-700 text-xs">{fmtDate(s.created_on)}</td>
                  <td className="px-4 py-3 text-gray-900 text-xs">{s.updated_by?.name || "—"}</td>
                  <td className="px-4 py-3 text-gray-700 text-xs">{fmtDate(s.updated_on)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => goToEmployees(s)}
                      data-testid={`perm-sets-users-${s.seq_no}`}
                      title="View assigned employees"
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border transition-colors ${
                        (s.assigned_users_count || 0) > 0
                          ? "border-[#ec9324]/40 bg-[#ec9324]/10 text-[#ec9324] hover:bg-[#ec9324]/20"
                          : "border-gray-200 text-gray-500 hover:border-gray-300"
                      }`}
                    >
                      <Users sx={{ fontSize: 11 }}/> {s.assigned_users_count || 0}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          data-testid={`perm-sets-actions-${s.seq_no}`}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-800"
                          aria-label="Row actions"
                        >{busyId === s.id ? <Loader2 sx={{ fontSize: 15 }} className="animate-spin"/> : <MoreVertical sx={{ fontSize: 15 }}/>}</button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => onView(s.id)} data-testid={`perm-sets-view-${s.seq_no}`}>
                          <Eye sx={{ fontSize: 13 }} className="mr-2"/> View
                        </DropdownMenuItem>
                        {!isDeleted && (
                          <>
                            <DropdownMenuItem onClick={() => onEdit(s.id)} data-testid={`perm-sets-edit-${s.seq_no}`}>
                              <Pencil sx={{ fontSize: 13 }} className="mr-2"/> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => doDuplicate(s)} data-testid={`perm-sets-duplicate-${s.seq_no}`}>
                              <Copy sx={{ fontSize: 13 }} className="mr-2"/> Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuSeparator/>
                            <DropdownMenuItem onClick={() => doDelete(s)} data-testid={`perm-sets-delete-${s.seq_no}`} className="text-red-600 focus:text-red-700">
                              <Trash2 sx={{ fontSize: 13 }} className="mr-2"/> Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* PAGINATION — fixed footer of the tab card */}
      {!loading && total > 0 && (
        <div className="shrink-0">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
            pageSizeOptions={[25, 50, 100]}
            label="permission sets"
            testIdPrefix="perm-sets-pg"
          />
        </div>
      )}
    </div>
  );
});

export default PermissionSetsListTab;
