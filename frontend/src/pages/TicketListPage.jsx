import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import api from "../lib/api";
import Layout from "../components/Layout";
import TicketTable from "../components/TicketTable";
import { useAuth } from "../context/AuthContext";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Search, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "../components/Badges";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "../components/ui/dropdown-menu";

export default function TicketListPage({ scope = "mine", title = "My Tickets", basePath = "/ra/tickets", allowCreate = false }) {
  const [tickets, setTickets] = useState([]);
  const [search, setSearch] = useState("");
  const [params, setParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selected, setSelected] = useState([]);
  const [members, setMembers] = useState([]);

  const status = params.get("status") || "";
  const priority = params.get("priority") || "";
  const assigned_to = params.get("assigned_to") || "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/tickets", {
        params: { scope, status: status || undefined, priority: priority || undefined,
                  assigned_to: assigned_to || undefined, q: search || undefined }
      });
      setTickets(r.data);
    } finally { setLoading(false); }
  }, [scope, status, priority, assigned_to, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (user?.type === "Admin") api.get("/contacts", { params: { type: "DQ Team" }}).then(r => setMembers(r.data));
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
      toast.success(`Assigned ${selected.length} ticket(s) to you`);
      setSelected([]); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const bulkAssignTo = async (memberId) => {
    try {
      await api.post("/tickets/bulk-assign", { ticket_ids: selected, assigned_to: memberId });
      toast.success(`Assigned ${selected.length} ticket(s)`);
      setSelected([]); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const updateStatus = async (id, st) => {
    try {
      await api.patch(`/tickets/${id}`, { status: st });
      toast.success(`Status updated to ${st}`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const assignSelf = async (id) => {
    try {
      await api.patch(`/tickets/${id}`, { assigned_to: user.id });
      toast.success("Assigned to you"); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const reassign = async (id, memberId) => {
    try {
      await api.patch(`/tickets/${id}`, { assigned_to: memberId });
      toast.success("Reassigned"); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const isDQ = user?.type === "DQ Team";
  const isAdmin = user?.type === "Admin";
  const isRA = user?.type === "Research Associate";

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
    <Layout>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">{title}</h1>
          <p className="text-gray-500 mt-1">{tickets.length} ticket(s)</p>
        </div>
        <div className="flex gap-2">
          {selected.length > 0 && isDQ && (
            <Button onClick={bulkAssignSelf} data-testid="bulk-assign-me-btn"
              className="bg-[#ec9324] hover:bg-[#d4811f] text-white">
              Assign Selected to Me ({selected.length})
            </Button>
          )}
          {selected.length > 0 && isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button data-testid="bulk-assign-btn" className="bg-[#ec9324] hover:bg-[#d4811f] text-white">
                  Assign Selected ({selected.length})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {members.map(m => <DropdownMenuItem key={m.id} onClick={() => bulkAssignTo(m.id)}>{m.name}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="outline" onClick={load} data-testid="refresh-btn"><RefreshCw size={16}/></Button>
          {allowCreate && isRA && (
            <Button onClick={() => navigate("/ra/create")} data-testid="create-ticket-btn"
              className="bg-[#ec9324] hover:bg-[#d4811f] text-white">
              <Plus size={16} className="mr-1"/> New Ticket
            </Button>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3 items-center bg-white p-4 rounded-xl shadow-soft border border-gray-100">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16}/>
          <Input placeholder="Search by Ticket ID, Subject..." data-testid="search-input"
            className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status || "all"} onValueChange={(v) => setParam("status", v === "all" ? "" : v)}>
          <SelectTrigger className="w-44" data-testid="filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="Open">Open</SelectItem>
            <SelectItem value="In Progress">In Progress</SelectItem>
            <SelectItem value="Closed">Closed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priority || "all"} onValueChange={(v) => setParam("priority", v === "all" ? "" : v)}>
          <SelectTrigger className="w-44" data-testid="filter-priority"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="High">High</SelectItem>
            <SelectItem value="Medium">Medium</SelectItem>
            <SelectItem value="Low">Low</SelectItem>
          </SelectContent>
        </Select>
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
        />
      </div>
    </Layout>
  );
}
