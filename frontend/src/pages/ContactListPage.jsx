import React, { useEffect, useState } from "react";
import api, { API } from "../lib/api";
import Layout from "../components/Layout";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Checkbox } from "../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "../components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator
} from "../components/ui/dropdown-menu";
import MultiSelect from "../components/MultiSelect";
import notify from "../lib/notify";
import { Search, UserPlus, Pencil, Eye, EyeOff, Copy, RefreshCw, KeyRound, X, Mail, Phone, Calendar, IdCard, Briefcase, UsersRound, Download, ChevronLeft, ChevronRight, MoreHorizontal, ShieldCheck } from "lucide-react";

function fmt(iso) { if (!iso) return "Never"; try { return new Date(iso).toLocaleString(); } catch { return iso; } }

// v3 role model — only Super Admin and Admin remain.
const ROLE_OPTIONS = ["Super Admin", "Admin"];
const ALL_ROLE_FILTERS = ["Super Admin", "Admin"];
const EMPTY_FORM = { email: "", name: "", phone: "", role: "Admin", emp_id: "", doj: "", permission_set_ids: [] };

function PasswordField({ contactId, testIdPrefix = "contact" }) {
  const [pwd, setPwd] = useState(null); // decrypted password (or null)
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchPwd = async () => {
    if (pwd) { setShow((s) => !s); return; }
    setLoading(true);
    try {
      const r = await api.get(`/contacts/${contactId}/password`);
      setPwd(r.data.password);
      setShow(true);
    } catch (e) {
      notify.error(e?.response?.data?.detail || "Could not retrieve password. Try Reset.");
    } finally { setLoading(false); }
  };

  const reset = async () => {
    if (!window.confirm("Generate a new password? The old one will stop working.")) return;
    setLoading(true);
    try {
      const r = await api.post(`/contacts/${contactId}/reset-password`);
      setPwd(r.data.password);
      setShow(true);
      notify.success("Password reset");
    } catch (e) {
      notify.error(e?.response?.data?.detail || "Failed");
    } finally { setLoading(false); }
  };

  const copy = async () => {
    if (!pwd) return;
    try { await navigator.clipboard.writeText(pwd); notify.success("Password copied"); }
    catch (e) { console.error("clipboard write failed:", e); notify.error("Could not copy to clipboard"); }
  };

  const displayValue = pwd ? (show ? pwd : "•".repeat(Math.max(pwd.length, 10))) : "••••••••••";

  return (
    <div>
      <Label className="flex items-center gap-1.5">
        <KeyRound size={14} className="text-gray-500"/> Password
      </Label>
      <div className="mt-1 flex items-center gap-2">
        <Input
          readOnly
          value={displayValue}
          className="font-mono"
          data-testid={`${testIdPrefix}-password-display`}
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={fetchPwd}
          disabled={loading}
          data-testid={`${testIdPrefix}-password-toggle`}
          className="border-gray-300"
          aria-label={show ? "Hide password" : "Show password"}
          title={show ? "Hide" : "Show"}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </Button>
        {pwd && (
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={copy}
            data-testid={`${testIdPrefix}-password-copy`}
            className="border-gray-300"
            title="Copy"
            aria-label="Copy password"
          >
            <Copy size={16} />
          </Button>
        )}
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={reset}
          disabled={loading}
          data-testid={`${testIdPrefix}-password-reset`}
          className="border-gray-300"
          title="Reset password"
          aria-label="Reset password"
        >
          <RefreshCw size={16} />
        </Button>
      </div>
      <div className="text-xs text-gray-500 mt-1">Click the eye icon to reveal. Reset generates a new password.</div>
    </div>
  );
}

function EmployeeDetailModal({ contact, open, onClose }) {
  if (!contact) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white"
              style={{ backgroundColor: contact.team_color || "#ec9324" }}
            >
              {contact.name?.[0]?.toUpperCase()}
            </div>
            <div>
              <div className="text-lg font-bold">{contact.name}</div>
              <div className="text-xs text-gray-500 font-normal">{contact.role}</div>
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">Employee details</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2 text-sm">
          <div className="flex items-center gap-2 text-gray-700">
            <Mail size={14} className="text-gray-400"/>
            <span>{contact.email}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-700">
            <Phone size={14} className="text-gray-400"/>
            <span>{contact.phone || <span className="text-gray-400">No phone</span>}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-700">
            <IdCard size={14} className="text-gray-400"/>
            <span><span className="text-gray-500">Emp ID:</span> {contact.emp_id || "—"}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-700">
            <Calendar size={14} className="text-gray-400"/>
            <span><span className="text-gray-500">DOJ:</span> {contact.doj || "—"}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-700">
            <UsersRound size={14} className="text-gray-400"/>
            <span>
              <span className="text-gray-500">Team:</span>{" "}
              {contact.team_name ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: contact.team_color || "#ec9324" }} />
                  {contact.team_name}
                </span>
              ) : <span className="text-gray-400">No team</span>}
            </span>
          </div>
          <div className="flex items-center gap-2 text-gray-700">
            <Briefcase size={14} className="text-gray-400"/>
            <span><span className="text-gray-500">Manager(s):</span> {(contact.manager_names || []).join(", ") || <span className="text-gray-400">—</span>}</span>
          </div>
          <div className="flex items-start gap-2 text-gray-700">
            <ShieldCheck size={14} className="text-gray-400 mt-1"/>
            <div className="flex-1">
              <div className="text-gray-500 mb-1">Permission Sets:</div>
              {(contact.permission_sets || []).length === 0 ? (
                <span className="text-gray-400 text-xs">None assigned</span>
              ) : (
                <div className="flex flex-wrap gap-1.5" data-testid="detail-permission-sets">
                  {(contact.permission_sets || []).map((p) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-[#ec9324]/10 text-[#ec9324] border border-[#ec9324]/20"
                      data-testid={`detail-pset-chip-${p.numeric_id}`}
                    >
                      <span className="font-mono text-[10px] text-[#ec9324]/70">#{p.numeric_id}</span>
                      {p.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="border-t pt-3 mt-3">
            <PasswordField contactId={contact.id} testIdPrefix="detail" />
          </div>
          <div className="pt-2 text-xs text-gray-500">
            <div>Status: <span className={contact.status === "Active" ? "text-green-600 font-medium" : "text-gray-500"}>{contact.status}</span></div>
            <div>Created: {fmt(contact.created_on)}</div>
            <div>Last Login: {fmt(contact.last_login)}</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GeneratedPasswordModal({ password, email, onClose }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(password); notify.success("Password copied"); }
    catch (e) { console.error("clipboard write failed:", e); notify.error("Could not copy to clipboard"); }
  };
  return (
    <Dialog open={!!password} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Employee Created</DialogTitle>
          <DialogDescription>An auto-generated password has been created. You can always view it later from the employee detail/edit screen.</DialogDescription>
        </DialogHeader>
        <div className="mt-3 space-y-3">
          <div className="text-sm text-gray-600">
            Login for <span className="font-semibold">{email}</span>:
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center gap-2 font-mono text-sm">
            <span className="flex-1 break-all" data-testid="generated-password-value">{password}</span>
            <Button size="icon" variant="outline" onClick={copy} className="border-gray-300" aria-label="Copy" data-testid="copy-generated-password">
              <Copy size={16} />
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose} className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="close-generated-password">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ContactListPage() {
  const [contacts, setContacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState([]);
  const [bulkRoleOpen, setBulkRoleOpen] = useState(false);
  const [bulkRole, setBulkRole] = useState("Admin");

  const [detailContact, setDetailContact] = useState(null);
  const [generated, setGenerated] = useState(null); // {password, email}
  const [permissionSets, setPermissionSets] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/permission-sets");
        setPermissionSets(r.data || []);
      } catch {
        setPermissionSets([]);
      }
    })();
  }, []);

  const load = async () => {
    const r = await api.get("/contacts", {
      params: {
        q: q || undefined,
        role: role === "all" ? undefined : role,
        status: status === "all" ? undefined : status,
        page, page_size: pageSize, sort_by: sortBy, sort_dir: sortDir,
      },
    });
    // Paginated shape: { items, total, page, page_size }
    if (r.data && Array.isArray(r.data.items)) {
      setContacts(r.data.items);
      setTotal(r.data.total);
    } else {
      setContacts(r.data);
      setTotal(r.data.length);
    }
    setSelected([]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, role, status, page, pageSize, sortBy, sortDir]);
  useEffect(() => { setPage(1); /* reset on filter change */ }, [q, role, status, pageSize]);

  const toggleSort = (field) => {
    if (sortBy === field) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(field); setSortDir("asc"); }
  };

  const toggleAll = (checked) => {
    setSelected(checked ? contacts.map((c) => c.id) : []);
  };
  const toggleOne = (id, checked) => {
    setSelected((s) => checked ? [...s, id] : s.filter((x) => x !== id));
  };

  const bulkActivate = async (newStatus) => {
    if (selected.length === 0) return;
    try {
      const r = await api.post("/contacts/bulk-status", { contact_ids: selected, status: newStatus });
      notify.success(`${r.data?.updated || 0} employee(s) → ${newStatus}`);
      setSelected([]);
      load();
    } catch (e) { notify.error(e?.response?.data?.detail || "Failed"); }
  };

  const applyBulkRole = async () => {
    if (selected.length === 0) return;
    try {
      const r = await api.post("/contacts/bulk-role", { contact_ids: selected, role: bulkRole });
      notify.success(`${r.data?.updated || 0} employee(s) → ${bulkRole}`);
      setBulkRoleOpen(false);
      setSelected([]);
      load();
    } catch (e) { notify.error(e?.response?.data?.detail || "Failed"); }
  };

  const exportCsv = () => {
    const token = localStorage.getItem("access_token") || "";
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (role !== "all") params.set("role", role);
    if (status !== "all") params.set("status", status);
    // Use fetch to set Authorization header, then trigger a download
    fetch(`${API}/contacts/export.csv?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
    }).then(async (resp) => {
      if (!resp.ok) { notify.error("Export failed"); return; }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `employees_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const toggleStatus = async (c) => {
    const next = c.status === "Active" ? "Inactive" : "Active";
    try {
      await api.patch(`/contacts/${c.id}`, { status: next });
      notify.success(`${c.name} is now ${next}`);
      load();
    } catch (e) { notify.error(e?.response?.data?.detail || "Failed"); }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  };

  const openEdit = (c) => {
    setEditing(c);
    setForm({
      email: c.email,
      name: c.name,
      phone: c.phone || "",
      role: c.role,
      emp_id: c.emp_id || "",
      doj: c.doj || "",
      permission_set_ids: c.permission_set_ids || [],
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        const payload = {
          name: form.name,
          phone: form.phone,
          role: form.role,
          emp_id: form.emp_id || "",
          doj: form.doj || null,
          permission_set_ids: form.permission_set_ids || [],
        };
        await api.patch(`/contacts/${editing.id}`, payload);
        notify.success("Employee updated");
      } else {
        const r = await api.post("/contacts", {
          email: form.email,
          name: form.name,
          phone: form.phone,
          role: form.role,
          emp_id: form.emp_id || "",
          doj: form.doj || null,
          permission_set_ids: form.permission_set_ids || [],
        });
        notify.success("Employee created");
        if (r.data?.generated_password) {
          setGenerated({ password: r.data.generated_password, email: r.data.email });
        }
      }
      setOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      notify.error(err?.response?.data?.detail || "Failed");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const allSelected = contacts.length > 0 && contacts.every((c) => selected.includes(c.id));
  const anySelected = selected.length > 0;

  return (
    <Layout>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Employee List</h1>
          <p className="text-gray-500 mt-1">
            {total} employee{total === 1 ? "" : "s"}
            {anySelected && <span className="ml-2 text-[#ec9324] font-medium">• {selected.length} selected</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {anySelected && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" data-testid="bulk-actions-btn" className="border-[#ec9324] text-[#ec9324] hover:bg-[#ec9324]/10">
                  Bulk actions ({selected.length})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Apply to {selected.length} selected</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => bulkActivate("Active")} data-testid="bulk-activate">Activate</DropdownMenuItem>
                <DropdownMenuItem onClick={() => bulkActivate("Inactive")} data-testid="bulk-deactivate">Deactivate</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setBulkRoleOpen(true)} data-testid="bulk-change-role">Change role…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="outline" onClick={exportCsv} data-testid="export-csv-btn" className="border-gray-300">
            <Download size={14} className="mr-2"/> Export CSV
          </Button>
          <Button onClick={openCreate} className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="add-contact-btn">
            <UserPlus size={16} className="mr-2"/> Add Employee
          </Button>
        </div>
      </div>

      <Dialog open={bulkRoleOpen} onOpenChange={setBulkRoleOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change role for {selected.length} employee(s)</DialogTitle>
            <DialogDescription>This will overwrite the role on every selected employee.</DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <Label>New role</Label>
            <Select value={bulkRole} onValueChange={setBulkRole}>
              <SelectTrigger data-testid="bulk-role-select"><SelectValue/></SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkRoleOpen(false)}>Cancel</Button>
            <Button onClick={applyBulkRole} className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="bulk-role-apply">
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm(EMPTY_FORM); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Employee" : "Add New Employee"}</DialogTitle>
            <DialogDescription className="sr-only">Employee form</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Email {editing ? "" : "*"}</Label>
                <Input
                  type="email" required value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  data-testid="contact-email"
                  disabled={!!editing}
                />
              </div>
              <div className="col-span-2">
                <Label>Name *</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="contact-name"/>
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="contact-phone"/>
              </div>
              <div>
                <Label>Emp ID *</Label>
                <Input required={!editing} value={form.emp_id} onChange={(e) => setForm({ ...form, emp_id: e.target.value })} placeholder="EMP-0001" data-testid="contact-emp-id"/>
              </div>
              <div>
                <Label>DOJ (Date of Joining) *</Label>
                <Input required={!editing} type="date" value={form.doj || ""} onChange={(e) => setForm({ ...form, doj: e.target.value })} data-testid="contact-doj"/>
              </div>
              <div>
                <Label>Role *</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger data-testid="contact-role"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-gray-500" /> Permission Sets
                </Label>
                <MultiSelect
                  options={permissionSets.map((p) => ({
                    value: p.id,
                    label: `#${p.numeric_id} · ${p.name}`,
                  }))}
                  value={form.permission_set_ids || []}
                  onChange={(ids) => setForm({ ...form, permission_set_ids: ids })}
                  placeholder="Assign one or more Permission Sets…"
                  data-testid="contact-permission-sets"
                />
                <div className="text-xs text-gray-500 mt-1">
                  Effective access = OR-union of all assigned sets (allow wins).
                </div>
              </div>
            </div>
            {editing && (
              <div className="border-t pt-4">
                <PasswordField contactId={editing.id} testIdPrefix="edit" />
              </div>
            )}
            {!editing && (
              <div className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-md p-2.5">
                A secure password will be generated automatically and shown after the employee is created.
              </div>
            )}
            <DialogFooter>
              <Button type="submit" className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="submit-contact-btn">
                {editing ? "Save Changes" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="mt-6 flex gap-3 flex-wrap items-center bg-white p-4 rounded-xl shadow-soft border border-gray-100">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16}/>
          <Input placeholder="Search name or email..." className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} data-testid="contact-search"/>
        </div>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Role"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {ALL_ROLE_FILTERS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="Active">Active</SelectItem>
            <SelectItem value="Inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-6 bg-white rounded-xl shadow-soft border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 font-bold tracking-wider border-b border-gray-200 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-3 text-left w-10">
                  <Checkbox checked={allSelected} onCheckedChange={(v) => toggleAll(!!v)} data-testid="select-all-employees" aria-label="Select all"/>
                </th>
                <th className="px-4 py-3 text-left cursor-pointer hover:text-[#ec9324]" onClick={() => toggleSort("name")} data-testid="sort-name">
                  Name {sortBy === "name" && (sortDir === "asc" ? "▲" : "▼")}
                </th>
                <th className="px-4 py-3 text-left cursor-pointer hover:text-[#ec9324]" onClick={() => toggleSort("emp_id")} data-testid="sort-emp-id">
                  Emp ID {sortBy === "emp_id" && (sortDir === "asc" ? "▲" : "▼")}
                </th>
                <th className="px-4 py-3 text-left cursor-pointer hover:text-[#ec9324]" onClick={() => toggleSort("email")} data-testid="sort-email">
                  Email {sortBy === "email" && (sortDir === "asc" ? "▲" : "▼")}
                </th>
                <th className="px-4 py-3 text-left">Team</th>
                <th className="px-4 py-3 text-left cursor-pointer hover:text-[#ec9324]" onClick={() => toggleSort("doj")} data-testid="sort-doj">
                  DOJ {sortBy === "doj" && (sortDir === "asc" ? "▲" : "▼")}
                </th>
                <th className="px-4 py-3 text-left cursor-pointer hover:text-[#ec9324]" onClick={() => toggleSort("role")} data-testid="sort-role">
                  Role {sortBy === "role" && (sortDir === "asc" ? "▲" : "▼")}
                </th>
                <th className="px-4 py-3 text-left">Permission Sets</th>
                <th className="px-4 py-3 text-left">Active</th>
                <th className="px-4 py-3 text-right">Edit</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className={`border-b border-gray-100 hover:bg-gray-50/80 ${selected.includes(c.id) ? "bg-[#ec9324]/5" : ""}`} data-testid={`contact-row-${c.email}`}>
                  <td className="px-3 py-3">
                    <Checkbox
                      checked={selected.includes(c.id)}
                      onCheckedChange={(v) => toggleOne(c.id, !!v)}
                      data-testid={`select-${c.email}`}
                      aria-label="Select row"
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <button
                      type="button"
                      onClick={() => setDetailContact(c)}
                      data-testid={`contact-name-${c.email}`}
                      className="text-left hover:text-[#ec9324] hover:underline focus:outline-none focus:text-[#ec9324]"
                    >
                      {c.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{c.emp_id || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.email}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {c.team_name ? (
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c.team_color || "#ec9324" }} />
                        {c.team_name}
                      </span>
                    ) : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{c.doj || "-"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex text-xs font-semibold rounded-full px-2 py-1 bg-[#ec9324]/10 text-[#ec9324]">{c.role}</span>
                  </td>
                  <td className="px-4 py-3">
                    {(c.permission_sets || []).length === 0 ? (
                      <span className="text-gray-300 text-xs">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1 max-w-[260px]">
                        {(c.permission_sets || []).slice(0, 2).map((p) => (
                          <span
                            key={p.id}
                            title={p.name}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-100 max-w-[120px] truncate"
                            data-testid={`row-pset-chip-${c.email}-${p.numeric_id}`}
                          >
                            <span className="font-mono text-blue-500">#{p.numeric_id}</span>
                            <span className="truncate">{p.name}</span>
                          </span>
                        ))}
                        {(c.permission_sets || []).length > 2 && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                            +{(c.permission_sets || []).length - 2}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Switch
                      checked={c.status === "Active"}
                      onCheckedChange={() => toggleStatus(c)}
                      data-testid={`toggle-${c.email}`}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm" variant="outline" onClick={() => openEdit(c)}
                      data-testid={`edit-${c.email}`}
                      className="border-gray-300 text-gray-700 hover:bg-[#ec9324]/10 hover:text-[#ec9324] hover:border-[#ec9324] h-8 w-8 p-0"
                      aria-label="Edit employee"
                    >
                      <Pencil size={14}/>
                    </Button>
                  </td>
                </tr>
              ))}
              {contacts.length === 0 && <tr><td colSpan={10} className="text-center py-10 text-gray-400">No employees</td></tr>}
            </tbody>
          </table>
        </div>
        {/* Pagination footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>Rows per page</span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="w-20 h-8" data-testid="page-size-select"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
            <span className="ml-2" data-testid="pagination-info">
              {total === 0 ? "0–0 of 0" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} data-testid="prev-page-btn" className="h-8 w-8 p-0">
              <ChevronLeft size={14}/>
            </Button>
            <span className="text-xs text-gray-600 px-2" data-testid="page-indicator">{page} / {totalPages}</span>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} data-testid="next-page-btn" className="h-8 w-8 p-0">
              <ChevronRight size={14}/>
            </Button>
          </div>
        </div>
      </div>

      <EmployeeDetailModal contact={detailContact} open={!!detailContact} onClose={() => setDetailContact(null)} />
      {generated && (
        <GeneratedPasswordModal
          password={generated.password}
          email={generated.email}
          onClose={() => setGenerated(null)}
        />
      )}
    </Layout>
  );
}
