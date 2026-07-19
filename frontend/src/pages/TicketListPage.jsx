import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import api, { API } from "../lib/api";
import Layout from "../components/Layout";
import TicketTable from "../components/TicketTable";
import { useAuth } from "../context/AuthContext";
import { useEffectivePage } from "../context/EffectivePermissionsContext";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import DeferredSearchInput from "../components/DeferredSearchInput";
import { Search, Plus, RefreshCw, Download, X, Send } from "lucide-react";
import Pagination from "../components/Pagination";
import CreateTicketModal from "../components/CreateTicketModal";
import notify from "../lib/notify";
import { StatusBadge } from "../components/Badges";
import DateFilter, { dateFilterToParams } from "../components/DateFilter";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "../components/ui/dropdown-menu";

export default function TicketListPage({
  scope = "mine",
  title = "My Tickets",
  basePath = "/ra/tickets",
  allowCreate = false,
  // If set, this status is force-applied to every query and the Status
  // dropdown is hidden. Used by the "Open Requests" route to lock the
  // listing to status=Open while keeping every other filter available.
  lockedStatus = null,
}) {
  const [tickets, setTickets] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  // Split search — legacy `search` kept only for URL/deep-link compat with
  // "clear all" ergonomics. Actual queries go via id_q / desc_q.
  const [search, setSearch] = useState("");
  // What the user is TYPING (does not trigger requests):
  const [idInput, setIdInput] = useState("");
  const [descInput, setDescInput] = useState("");
  // What has been COMMITTED (Enter or arrow-click); this triggers the request:
  const [idQuery, setIdQuery] = useState("");
  const [descQuery, setDescQuery] = useState("");
  const [params, setParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selected, setSelected] = useState([]);
  const [members, setMembers] = useState([]);
  const [creators, setCreators] = useState([]);
  const [teams, setTeams] = useState([]);
  const [createdBy, setCreatedBy] = useState([]);       // arrays for multi-select
  const [assigneeFilter, setAssigneeFilter] = useState([]);
  const [teamFilter, setTeamFilter] = useState([]);
  const [dateFilter, setDateFilter] = useState({ field: "created_at", mode: "between", from: null, to: null });
  const [createOpen, setCreateOpen] = useState(false);

  // URL-backed multi-select filters (status / priority / assigned_to via URL param)
  // Parse comma-separated URL params into arrays.
  const parseCsv = (s) => (s ? s.split(",").filter(Boolean) : []);
  const statusArr = lockedStatus ? [lockedStatus] : parseCsv(params.get("status"));
  const priorityArr = parseCsv(params.get("priority"));
  const urlAssignedToArr = parseCsv(params.get("assigned_to"));
  // Keep legacy singletons for compat with the rest of the page & export code
  const status = statusArr.join(",");
  const priority = priorityArr.join(",");
  const urlAssignedTo = urlAssignedToArr.join(",");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const dateParams = dateFilterToParams(dateFilter);
      const r = await api.get("/tickets", {
        params: {
          scope,
          status: status || undefined,
          priority: priority || undefined,
          assigned_to: (assigneeFilter.length ? assigneeFilter.join(",") : "") || urlAssignedTo || undefined,
          created_by: createdBy.length ? createdBy.join(",") : undefined,
          team: teamFilter.length ? teamFilter.join(",") : undefined,
          id_q: idQuery || undefined,
          desc_q: descQuery || undefined,
          page, page_size: pageSize,
          // Default sort — status ordinal ascending (Open → In Progress → Closed).
          // Backend adds a secondary tiebreak on updated_on desc.
          sort_by: "status",
          sort_dir: "asc",
          ...dateParams,
        }
      });
      if (r.data && Array.isArray(r.data.items)) {
        setTickets(r.data.items); setTotal(r.data.total);
      } else {
        setTickets(r.data); setTotal(r.data.length);
      }
    } finally { setLoading(false); }
  }, [scope, status, priority, urlAssignedTo, assigneeFilter, createdBy, teamFilter, idQuery, descQuery, dateFilter, page, pageSize]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [scope, status, priority, urlAssignedTo, assigneeFilter, createdBy, teamFilter, idQuery, descQuery, dateFilter, pageSize]);

  const exportCsv = () => {
    const token = localStorage.getItem("access_token") || "";
    const p = new URLSearchParams();
    p.set("scope", scope);
    if (status) p.set("status", status);
    if (priority) p.set("priority", priority);
    const assignedCsv = (assigneeFilter.length ? assigneeFilter.join(",") : "") || urlAssignedTo;
    if (assignedCsv) p.set("assigned_to", assignedCsv);
    if (createdBy.length) p.set("created_by", createdBy.join(","));
    if (teamFilter.length) p.set("team", teamFilter.join(","));
    if (idQuery) p.set("id_q", idQuery);
    if (descQuery) p.set("desc_q", descQuery);
    const dateParams = dateFilterToParams(dateFilter);
    Object.entries(dateParams).forEach(([k, v]) => { if (v) p.set(k, v); });
    fetch(`${API}/tickets/export.csv?${p.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
    }).then(async (resp) => {
      if (!resp.ok) { notify.error("Export failed"); return; }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tickets_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };
  useEffect(() => {
    // v3 role model — fetch admin users (assignment candidates) for the picker.
    api.get("/contacts", { params: { role: "Admin" }}).then(r => setMembers(r.data)).catch(() => {});
    // Creators = all admin users (both Super Admin and Admin).
    api.get("/contacts").then(r => {
      const list = (r.data?.items || r.data || []).filter(c => c.role === "Super Admin" || c.role === "Admin");
      setCreators(list);
    }).catch(() => {});
    // Teams — used for the Team filter dropdown.
    api.get("/teams").then(r => setTeams(r.data || [])).catch(() => {});
  }, [user]);

  const setParam = (k, v) => {
    const np = new URLSearchParams(params);
    if (v) np.set(k, v); else np.delete(k);
    setParams(np);
  };

  // Filter helpers — visible only when at least one filter is active, keeps the
  // toolbar compact in the default state.
  const isDateFilterActive = !!(dateFilter && (dateFilter.from || dateFilter.to || dateFilter.mode === "preset"));
  // status counts as an active filter only when the user picked it; if the
  // route locks status (e.g. Open Requests) it should not show "Clear all".
  const userPickedStatus = !lockedStatus && !!status;
  const hasActiveFilters = !!(idQuery || descQuery || userPickedStatus || priority || createdBy.length || assigneeFilter.length || teamFilter.length || urlAssignedTo || isDateFilterActive);
  const clearAllFilters = () => {
    setSearch("");
    setIdInput(""); setDescInput("");
    setIdQuery(""); setDescQuery("");
    setCreatedBy([]);
    setAssigneeFilter([]);
    setTeamFilter([]);
    setDateFilter({ field: "created_at", mode: "between", from: null, to: null });
    const np = new URLSearchParams(params);
    np.delete("status"); np.delete("priority"); np.delete("assigned_to");
    setParams(np);
  };

  const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const toggleAll = (v) => setSelected(v ? tickets.map(t => t.id) : []);

  const bulkAssignSelf = async () => {
    try {
      await api.post("/tickets/bulk-assign", { ticket_ids: selected });
      notify.success(`Assigned ${selected.length} ticket(s) to you`);
      setSelected([]); load();
    } catch (e) { notify.error(e?.response?.data?.detail || "Failed"); }
  };

  const bulkAssignTo = async (memberId) => {
    try {
      await api.post("/tickets/bulk-assign", { ticket_ids: selected, assigned_to: memberId });
      notify.success(`Assigned ${selected.length} ticket(s)`);
      setSelected([]); load();
    } catch (e) { notify.error(e?.response?.data?.detail || "Failed"); }
  };

  const bulkUpdateStatus = async (st) => {
    try {
      const r = await api.post("/tickets/bulk-status", { ticket_ids: selected, status: st });
      notify.success(`Updated ${r.data?.updated || 0} request(s) to ${st}`);
      setSelected([]); load();
    } catch (e) { notify.error(e?.response?.data?.detail || "Failed"); }
  };

  const updateStatus = async (id, st) => {
    try {
      await api.patch(`/tickets/${id}`, { status: st });
      notify.success(`Status updated to ${st}`);
      load();
    } catch (e) { notify.error(e?.response?.data?.detail || "Failed"); }
  };

  const assignSelf = async (id) => {
    try {
      await api.patch(`/tickets/${id}`, { assigned_to: user.id });
      notify.success("Assigned to you"); load();
    } catch (e) { notify.error(e?.response?.data?.detail || "Failed"); }
  };

  const reassign = async (id, memberId) => {
    try {
      await api.patch(`/tickets/${id}`, { assigned_to: memberId });
      notify.success("Reassigned"); load();
    } catch (e) { notify.error(e?.response?.data?.detail || "Failed"); }
  };

  // v3 role model: only Super Admin and Admin exist. DQ/RA branches retained as
  // defensive no-ops in case legacy data is encountered.
  const isDQ = false;
  const isAdmin = user?.role === "Super Admin" || user?.role === "Admin";
  const isRA = false;

  // ── Client-side permission gating (Permissions V3, Round 3) ──────────────
  const permPageKey = useMemo(() => {
    if (scope === "unassigned") return "unassigned";
    if (lockedStatus === "Open") return "open_requests";
    return "all_requests";
  }, [scope, lockedStatus]);
  const { fn: permFn } = useEffectivePage("profix", permPageKey);
  const permRefresh    = permFn("refresh_list");
  const permExport     = permFn("export_tickets");
  const permCreate     = permFn("create_ticket");
  const permBulkAssign = permFn("bulk_assign");

  // Row actions are now rendered inside TicketTable (single triple-dot menu).
  // We pass the callbacks + role hints through props below.

  const selectable = isDQ || isAdmin;

  return (
    <Layout
      title={title}
      contentClassName="w-full px-4 pt-4 pb-3 flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden"
      actions={
        <div className="flex gap-2 items-center">
          {selected.length > 0 && isDQ && (
            <>
              <Button onClick={bulkAssignSelf} data-testid="bulk-assign-me-btn"
                className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-9">
                Assign Selected to Me ({selected.length})
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" data-testid="bulk-status-btn" className="h-9">
                    Update Status ({selected.length})
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => bulkUpdateStatus("In Progress")} data-testid="bulk-status-in-progress">In Progress</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => bulkUpdateStatus("Closed")} data-testid="bulk-status-closed">Closed</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          {selected.length > 0 && isAdmin && permBulkAssign.isVisible && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button data-testid="bulk-assign-btn" className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-9">
                    Assign Selected ({selected.length})
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {members.map(m => <DropdownMenuItem key={m.id} onClick={() => bulkAssignTo(m.id)}>{m.name}</DropdownMenuItem>)}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" data-testid="bulk-status-btn" className="h-9">
                    Update Status ({selected.length})
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => bulkUpdateStatus("Open")}>Open</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => bulkUpdateStatus("In Progress")}>In Progress</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => bulkUpdateStatus("Closed")}>Closed</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          {permRefresh.isVisible && (
            <Button variant="outline" onClick={load} data-testid="refresh-btn" size="icon" className="h-9 w-9" title="Refresh" aria-label="Refresh" disabled={!permRefresh.canUse}>
              <RefreshCw size={16}/>
            </Button>
          )}
          {permExport.isVisible && (
            <Button variant="outline" onClick={exportCsv} data-testid="export-tickets-csv" size="icon" className="h-9 w-9 border-gray-300" title="Export CSV" aria-label="Export CSV" disabled={!permExport.canUse}>
              <Download size={16}/>
            </Button>
          )}
          {(isRA || isAdmin) && permCreate.isVisible && (
            <Button onClick={() => setCreateOpen(true)} data-testid="create-new-ticket-btn"
              className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-9" disabled={!permCreate.canUse}>
              <Plus size={16} className="mr-1"/> New Request
            </Button>
          )}
        </div>
      }
    >
      <div className="shrink-0 -mx-4 px-4 pt-1 pb-3 bg-gray-50/95 backdrop-blur">
        <div className="flex flex-nowrap gap-2 items-center bg-white p-3 rounded-xl shadow-soft border border-gray-100 overflow-x-auto" data-testid="tickets-filter-bar">
        {/* ── ID search (numeric, exact match) ───────────────────────────── */}
        <DeferredSearchInput
          className="w-28 shrink-0"
          placeholder="ID"
          testId="search-id-input"
          value={idQuery}
          onCommit={(v) => { setIdInput(v); setIdQuery(v); }}
          showLeftIcon={false}
          numericOnly
          ariaLabel="Search by ID"
        />
        {/* ── Description search (substring, all chars allowed) ──────────── */}
        <DeferredSearchInput
          className="flex-1 min-w-[200px] shrink"
          placeholder="Search description..."
          testId="search-desc-input"
          value={descQuery}
          onCommit={(v) => { setDescInput(v); setDescQuery(v); }}
          ariaLabel="Search by description"
        />
        {!lockedStatus && (
          <MultiSelectFilter
            label="Status"
            value={statusArr}
            onChange={(arr) => setParam("status", arr.join(","))}
            options={[
              { value: "Open", label: "Open" },
              { value: "In Progress", label: "In Progress" },
              { value: "Closed", label: "Closed" },
            ]}
            testIdPrefix="filter-status"
            className="w-32 shrink-0"
          />
        )}
        <MultiSelectFilter
          label="Priority"
          value={priorityArr}
          onChange={(arr) => setParam("priority", arr.join(","))}
          options={[
            { value: "High", label: "High" },
            { value: "Medium", label: "Medium" },
            { value: "Low", label: "Low" },
          ]}
          testIdPrefix="filter-priority"
          className="w-32 shrink-0"
        />
        <MultiSelectFilter
          label="Team"
          value={teamFilter}
          onChange={setTeamFilter}
          options={teams.map(t => ({ value: t.id, label: t.name }))}
          testIdPrefix="filter-team"
          className="w-32 shrink-0"
        />
        <MultiSelectFilter
          label="Created By"
          value={createdBy}
          onChange={setCreatedBy}
          options={creators.map(c => ({ value: c.id, label: c.name }))}
          testIdPrefix="filter-created-by"
          className="w-36 shrink-0"
        />
        {!isDQ && (
          <MultiSelectFilter
            label="Assigned To"
            value={assigneeFilter}
            onChange={setAssigneeFilter}
            options={[
              { value: "unassigned", label: "Unassigned" },
              ...members.map(m => ({ value: m.id, label: m.name })),
            ]}
            testIdPrefix="filter-assigned-to"
            className="w-36 shrink-0"
          />
        )}
        <div className="shrink-0"><DateFilter value={dateFilter} onChange={setDateFilter} /></div>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            data-testid="clear-all-filters"
            className="h-9 text-xs text-gray-600 hover:text-[#ec9324] hover:bg-[#ec9324]/10 px-2 gap-1 shrink-0"
            title="Clear all filters"
          >
            <X size={14}/> Clear all
          </Button>
        )}
      </div>
      </div>

      <div className="mt-3 flex-1 min-h-0 flex flex-col bg-white rounded-xl shadow-soft border border-gray-100 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
          <TicketTable
            tickets={tickets}
            selectable={selectable}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            basePath={basePath}
            showView={!isDQ}
            members={members}
            isAdmin={isAdmin}
            isDQ={isDQ}
            currentUserId={user?.id || ""}
            onUpdateStatus={updateStatus}
            onReassign={reassign}
            onAssignSelf={assignSelf}
          />
        </div>
        {/* Pagination footer — pinned inside the card, above the viewport bottom */}
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          label="Tickets"
          testIdPrefix="tickets-pg"
          className="mt-auto border-t border-gray-100"
        />
      </div>
      <CreateTicketModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => load()}
      />
    </Layout>
  );
}
