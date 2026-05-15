import React, { useEffect, useState } from "react";
import api from "../lib/api";
import Layout from "../components/Layout";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "../components/ui/dialog";
import { toast } from "sonner";
import { Search, UserPlus, Pencil, Eye, EyeOff, Copy, RefreshCw, KeyRound, X, Mail, Phone, Calendar, IdCard, Briefcase, UsersRound } from "lucide-react";

function fmt(iso) { if (!iso) return "Never"; try { return new Date(iso).toLocaleString(); } catch { return iso; } }

const ROLE_OPTIONS = ["Admin", "Manager", "Research Associate", "DQ Team"];
const EMPTY_FORM = { email: "", name: "", phone: "", role: "DQ Team", emp_id: "", doj: "" };

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
      toast.error(e?.response?.data?.detail || "Could not retrieve password. Try Reset.");
    } finally { setLoading(false); }
  };

  const reset = async () => {
    if (!window.confirm("Generate a new password? The old one will stop working.")) return;
    setLoading(true);
    try {
      const r = await api.post(`/contacts/${contactId}/reset-password`);
      setPwd(r.data.password);
      setShow(true);
      toast.success("Password reset");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally { setLoading(false); }
  };

  const copy = async () => {
    if (!pwd) return;
    try { await navigator.clipboard.writeText(pwd); toast.success("Password copied"); } catch {}
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
    try { await navigator.clipboard.writeText(password); toast.success("Password copied"); } catch {}
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
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);

  const [detailContact, setDetailContact] = useState(null);
  const [generated, setGenerated] = useState(null); // {password, email}

  const load = async () => {
    const r = await api.get("/contacts", {
      params: { q: q || undefined, role: role === "all" ? undefined : role, status: status === "all" ? undefined : status }
    });
    setContacts(r.data);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, role, status]);

  const toggleStatus = async (c) => {
    const next = c.status === "Active" ? "Inactive" : "Active";
    try {
      await api.patch(`/contacts/${c.id}`, { status: next });
      toast.success(`${c.name} is now ${next}`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
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
        };
        await api.patch(`/contacts/${editing.id}`, payload);
        toast.success("Employee updated");
      } else {
        const r = await api.post("/contacts", {
          email: form.email,
          name: form.name,
          phone: form.phone,
          role: form.role,
          emp_id: form.emp_id || "",
          doj: form.doj || null,
        });
        toast.success("Employee created");
        if (r.data?.generated_password) {
          setGenerated({ password: r.data.generated_password, email: r.data.email });
        }
      }
      setOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
  };

  return (
    <Layout>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Employee List</h1>
          <p className="text-gray-500 mt-1">Manage all employees in the system.</p>
        </div>
        <Button onClick={openCreate} className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="add-contact-btn">
          <UserPlus size={16} className="mr-2"/> Add Employee
        </Button>
      </div>

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
                <Label>Emp ID</Label>
                <Input value={form.emp_id} onChange={(e) => setForm({ ...form, emp_id: e.target.value })} placeholder="EMP-0001" data-testid="contact-emp-id"/>
              </div>
              <div>
                <Label>DOJ (Date of Joining)</Label>
                <Input type="date" value={form.doj || ""} onChange={(e) => setForm({ ...form, doj: e.target.value })} data-testid="contact-doj"/>
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
            {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 font-bold tracking-wider border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Emp ID</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Phone</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Team</th>
                <th className="px-4 py-3 text-left">Manager</th>
                <th className="px-4 py-3 text-left">DOJ</th>
                <th className="px-4 py-3 text-left">Last Login</th>
                <th className="px-4 py-3 text-left">Active</th>
                <th className="px-4 py-3 text-right">Edit</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50/80" data-testid={`contact-row-${c.email}`}>
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
                  <td className="px-4 py-3 text-gray-600">{c.phone || "-"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex text-xs font-semibold rounded-full px-2 py-1 bg-[#ec9324]/10 text-[#ec9324]">{c.role}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {c.team_name ? (
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c.team_color || "#ec9324" }} />
                        {c.team_name}
                      </span>
                    ) : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {(c.manager_names && c.manager_names.length) ? c.manager_names.join(", ") : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{c.doj || "-"}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmt(c.last_login)}</td>
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
              {contacts.length === 0 && <tr><td colSpan={11} className="text-center py-10 text-gray-400">No employees</td></tr>}
            </tbody>
          </table>
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
