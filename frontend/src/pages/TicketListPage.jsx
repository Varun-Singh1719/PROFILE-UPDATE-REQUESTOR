import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import api, { API } from "../lib/api";
import Layout from "../components/Layout";
import TicketTable from "../components/TicketTable";
import { useAuth } from "../context/AuthContext";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Search, Plus, RefreshCw, Download } from "lucide-react";
import Pagination from "../components/Pagination";
import notify from "../lib/notify";
import { StatusBadge } from "../components/Badges";
import DateFilter, { dateFilterToParams } from "../components/DateFilter";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "../components/ui/dropdown-menu";

export default function TicketListPage({ scope = "mine", title = "My Tickets", basePath = "/ra/tickets", allowCreate = false }) {
  const [tickets, setTickets] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [params, setParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selected, setSelected] = useState([]);
  const [members, setMembers] = useState([]);
  const [creators, setCreators] = useState([]);
  const [createdBy, setCreatedBy] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [dateFilter, setDateFilter] = useState({ field: "created_at", mode: "between", from: null, to: null });

  const status = params.get("status") || "";
  const priority = params.get("priority") || "";
  const urlAssignedTo = params.get("assigned_to") || "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const dateParams = dateFilterToParams(dateFilter);
      const r = await api.get("/tickets", {
        params: {
          scope,
          status: status || undefined,
          priority: priority || undefined,
          assigned_to: assigneeFilter || urlAssignedTo || undefined,
          created_by: createdBy || undefined,
          q: search || undefined,
          page, page_size: pageSize,
          ...dateParams,
        }
      });
      if (r.data && Array.isArray(r.data.items)) {
        setTickets(r.data.items); setTotal(r.data.total);
      } else {
        setTickets(r.data); setTotal(r.data.length);
      }
    } finally { setLoading(false); }
  }, [scope, status, priority, urlAssignedTo, assigneeFilter, createdBy, search, dateFilter, page, pageSize]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [scope, status, priority, urlAssignedTo, assigneeFilter, createdBy, search, dateFilter, pageSize]);

  const exportCsv = () => {
    const token = localStorage.getItem("access_token") || "";
    const p = new URLSearchParams();
    p.set("scope", scope);
    if (status) p.set("status", status);
    if (priority) p.set("priority", priority);
    if (assigneeFilter || urlAssignedTo) p.set("assigned_to", assigneeFilter || urlAssignedTo);
    if (createdBy) p.set("created_by", createdBy);
    if (search) p.set("q", search);
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
  }, [user]);

  const setParam = (k, v) => {
    const np = new URLSearchParams(params);
    if (v) np.set(k, v); else np.delete(k);
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

  const rowActions = (t) => (
    <>
      {isDQ && !t.assigned_to_id && (
        <Button size="sm" className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid={`assign-me-${t.ticket_id}`}
          onClick={() => assignSelf(t.id)}>Assign to Me</Button>
      )}
      {isDQ && t.assigned_to_id === user.id && t.status !== "Closed" && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" data-testid={`update-status-${t.ticket_id}`}>Status</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => updateStatus(t.id, "Open")}>Open</DropdownMenuItem>
            <DropdownMenuItem onClick={() => updateStatus(t.id, "In Progress")}>In Progress</DropdownMenuItem>
            <DropdownMenuItem onClick={() => updateStatus(t.id, "Closed")}>Closed</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {isAdmin && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" data-testid={`admin-actions-${t.ticket_id}`}>Manage</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-gray-500">Update Status</div>
            <DropdownMenuItem onClick={() => updateStatus(t.id, "Open")}>Open</DropdownMenuItem>
            <DropdownMenuItem onClick={() => updateStatus(t.id, "In Progress")}>In Progress</DropdownMenuItem>
            <DropdownMenuItem onClick={() => updateStatus(t.id, "Closed")}>Closed</DropdownMenuItem>
            <div className="px-2 py-1 mt-1 text-[10px] uppercase tracking-wider text-gray-500">Assign</div>
            {members.map(m => (
              <DropdownMenuItem key={m.id} onClick={() => reassign(t.id, m.id)}>{m.name}</DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={() => reassign(t.id, "")}>Unassign</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );

  const selectable = isDQ || isAdmin;

  return (
    <Layout
      title={title}
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
          {selected.length > 0 && isAdmin && (
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
          <Button variant="outline" onClick={load} data-testid="refresh-btn" size="icon" className="h-9 w-9" title="Refresh" aria-label="Refresh">
            <RefreshCw size={16}/>
          </Button>
          <Button variant="outline" onClick={exportCsv} data-testid="export-tickets-csv" size="icon" className="h-9 w-9 border-gray-300" title="Export CSV" aria-label="Export CSV">
            <Download size={16}/>
          </Button>
          {(isRA || isAdmin) && (
            <Button onClick={() => navigate(isAdmin ? "/admin/create" : "/ra/create")} data-testid="create-new-ticket-btn"
              className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-9">
              <Plus size={16} className="mr-1"/> New Request
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-wrap gap-3 items-center bg-white p-4 rounded-xl shadow-soft border border-gray-100">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16}/>
          <Input placeholder="Search by Request ID, Subject..." data-testid="search-input"
            className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status || "all"} onValueChange={(v) => setParam("status", v === "all" ? "" : v)}>
          <SelectTrigger className="w-40" data-testid="filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="Open">Open</SelectItem>
            <SelectItem value="In Progress">In Progress</SelectItem>
            <SelectItem value="Closed">Closed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priority || "all"} onValueChange={(v) => setParam("priority", v === "all" ? "" : v)}>
          <SelectTrigger className="w-40" data-testid="filter-priority"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="High">High</SelectItem>
            <SelectItem value="Medium">Medium</SelectItem>
            <SelectItem value="Low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={createdBy || "all"} onValueChange={(v) => setCreatedBy(v === "all" ? "" : v)}>
          <SelectTrigger className="w-44" data-testid="filter-created-by"><SelectValue placeholder="Created By" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Creators</SelectItem>
            {creators.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {!isDQ && (
          <Select value={assigneeFilter || "all"} onValueChange={(v) => setAssigneeFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-44" data-testid="filter-assigned-to"><SelectValue placeholder="Assigned To" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assignees</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {members.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <DateFilter value={dateFilter} onChange={setDateFilter} />
      </div>

      <div className="mt-6">
        <TicketTable
          tickets={tickets}
          selectable={selectable}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          actions={rowActions}
          basePath={basePath}
          showView={!isDQ}
          numericIdOnly={isDQ}
        />
        {/* Pagination footer */}
        <div className="mt-3 bg-white rounded-xl shadow-soft border border-gray-100">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            label="Tickets"
            testIdPrefix="tickets-pg"
            className="border-t-0"
          />
        </div>
      </div>
    </Layout>
  );
}
