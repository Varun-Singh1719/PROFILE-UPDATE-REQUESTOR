import React, { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
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
import notify from "../lib/notify";
import {
  Search, Plus, Eye, Pencil, Copy, Trash2, Mail, FileText, Bold, Italic, List, ListOrdered, Link as LinkIcon, RotateCcw,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

function fmt(iso) { if (!iso) return "—"; try { return new Date(iso).toLocaleString(); } catch { return iso; } }

const CATEGORIES = ["transactional", "onboarding", "security", "notification", "marketing"];

// ============================================================ Frontend-only meeting templates
// These 3 templates live on the frontend and are persisted in localStorage. The backend
// source email is left as "TBD" — wire-up will happen when the meeting-email pipeline is
// implemented server-side.
const LOCAL_TPL_STORAGE_KEY = "infollion.email_templates.local.v1";

const DEFAULT_LOCAL_TEMPLATES = [
  {
    id: "local:meeting_room_booked",
    kind: "meeting_room_booked",
    name: "Meeting Room Booked",
    category: "notification",
    subject: "Your meeting room is confirmed — {{room_name}} on {{meeting_date}}",
    body:
      "<p>Hi {{attendee_name}},</p>" +
      "<p>Your meeting room booking has been <strong>confirmed</strong>.</p>" +
      "<ul>" +
      "<li><strong>Meeting:</strong> {{meeting_title}}</li>" +
      "<li><strong>Room:</strong> {{room_name}}</li>" +
      "<li><strong>Date:</strong> {{meeting_date}}</li>" +
      "<li><strong>Time:</strong> {{start_time}} – {{end_time}}</li>" +
      "<li><strong>Organizer:</strong> {{organizer_name}} ({{organizer_team}})</li>" +
      "</ul>" +
      "<p>You can review or cancel the booking from the <a href=\"{{booking_url}}\">Meeting Room Booking</a> page.</p>" +
      "<p>Thanks,<br/>Workspace Team</p>",
    from_email: "TBD",
    status: "Active",
    system: true,
    local: true,
    updated_at: null,
  },
  {
    id: "local:meeting_rescheduled",
    kind: "meeting_rescheduled",
    name: "Meeting Rescheduled",
    category: "notification",
    subject: "Meeting rescheduled — {{meeting_title}} now on {{meeting_date}}",
    body:
      "<p>Hi {{attendee_name}},</p>" +
      "<p>The following meeting has been <strong>rescheduled</strong>.</p>" +
      "<ul>" +
      "<li><strong>Meeting:</strong> {{meeting_title}}</li>" +
      "<li><strong>Room:</strong> {{room_name}}</li>" +
      "<li><strong>New Date:</strong> {{meeting_date}}</li>" +
      "<li><strong>New Time:</strong> {{start_time}} – {{end_time}}</li>" +
      "<li><strong>Previous slot:</strong> {{previous_date}} {{previous_start_time}} – {{previous_end_time}}</li>" +
      "<li><strong>Organizer:</strong> {{organizer_name}}</li>" +
      "</ul>" +
      "<p>Please update your calendar. View the updated booking <a href=\"{{booking_url}}\">here</a>.</p>" +
      "<p>Thanks,<br/>Workspace Team</p>",
    from_email: "TBD",
    status: "Active",
    system: true,
    local: true,
    updated_at: null,
  },
  {
    id: "local:meeting_cancelled",
    kind: "meeting_cancelled",
    name: "Meeting Cancelled",
    category: "notification",
    subject: "Meeting cancelled — {{meeting_title}}",
    body:
      "<p>Hi {{attendee_name}},</p>" +
      "<p>The meeting <strong>{{meeting_title}}</strong> scheduled for {{meeting_date}} at {{start_time}} in {{room_name}} has been <strong>cancelled</strong>.</p>" +
      "<p><em>Reason:</em> {{cancel_reason}}</p>" +
      "<p>If you have any questions, please contact the organizer ({{organizer_name}}).</p>" +
      "<p>Thanks,<br/>Workspace Team</p>",
    from_email: "TBD",
    status: "Active",
    system: true,
    local: true,
    updated_at: null,
  },
];

function loadLocalOverrides() {
  try { return JSON.parse(localStorage.getItem(LOCAL_TPL_STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveLocalOverrides(overrides) {
  localStorage.setItem(LOCAL_TPL_STORAGE_KEY, JSON.stringify(overrides));
}
function mergeLocalTemplates() {
  const overrides = loadLocalOverrides();
  return DEFAULT_LOCAL_TEMPLATES.map((t) => ({ ...t, ...(overrides[t.kind] || {}) }));
}

// ---------- Mini RichText editor (contentEditable + toolbar) ----------
function RichTextEditor({ value, onChange, testId = "rte" }) {
  const ref = React.useRef(null);
  // Sync initial value (sanitized) on first mount only.
  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = DOMPurify.sanitize(value || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exec = (cmd, arg) => {
    document.execCommand(cmd, false, arg);
    if (ref.current) onChange(ref.current.innerHTML);
  };
  const addLink = () => {
    // eslint-disable-next-line no-alert
    const url = window.prompt("Link URL", "https://");
    if (url) exec("createLink", url);
  };

  return (
    <div className="border border-gray-300 rounded-md overflow-hidden">
      <div className="flex items-center gap-1 bg-gray-50 border-b border-gray-200 px-2 py-1.5">
        <button type="button" onClick={() => exec("bold")} title="Bold" className="p-1.5 rounded hover:bg-gray-200" data-testid={`${testId}-bold`}>
          <Bold size={14}/>
        </button>
        <button type="button" onClick={() => exec("italic")} title="Italic" className="p-1.5 rounded hover:bg-gray-200" data-testid={`${testId}-italic`}>
          <Italic size={14}/>
        </button>
        <span className="w-px h-5 bg-gray-300 mx-1"/>
        <button type="button" onClick={() => exec("insertUnorderedList")} title="Bullet list" className="p-1.5 rounded hover:bg-gray-200" data-testid={`${testId}-ul`}>
          <List size={14}/>
        </button>
        <button type="button" onClick={() => exec("insertOrderedList")} title="Numbered list" className="p-1.5 rounded hover:bg-gray-200" data-testid={`${testId}-ol`}>
          <ListOrdered size={14}/>
        </button>
        <span className="w-px h-5 bg-gray-300 mx-1"/>
        <button type="button" onClick={addLink} title="Link" className="p-1.5 rounded hover:bg-gray-200" data-testid={`${testId}-link`}>
          <LinkIcon size={14}/>
        </button>
        <span className="ml-auto text-[10px] text-gray-400">Use <code className="px-1 bg-gray-100 rounded">{`{{name}}`}</code> for placeholders</span>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        data-testid={`${testId}-area`}
        className="min-h-[180px] max-h-[360px] overflow-y-auto px-3 py-2 text-sm prose prose-sm max-w-none focus:outline-none"
      />
    </div>
  );
}

const EMPTY_FORM = {
  name: "", kind: "", category: "transactional", subject: "", body: "", status: "Active", from_email: "",
};

export default function EmailTemplatesPage() {
  const { user } = useAuth();
  // Both Admin and Super Admin can edit templates. (Previous code only checked "Admin"
  // which excluded Super Admin — fixed here so the seeded admin can edit meeting templates.)
  const isAdmin = user?.role === "Admin" || user?.role === "Super Admin";
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState(null); // template or null
  const [form, setForm] = useState(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);

  const load = async () => {
    const r = await api.get("/email-templates", {
      params: {
        q: q || undefined,
        category: category === "all" ? undefined : category,
        status: status === "all" ? undefined : status,
      },
    });
    // Inject the 3 frontend-only meeting templates (with any localStorage overrides) at
    // the top of the list. Filter them by the same search/category/status criteria so the
    // page-level filter UI behaves consistently.
    const locals = mergeLocalTemplates().filter((t) => {
      if (status !== "all" && t.status !== status) return false;
      if (category !== "all" && t.category !== category) return false;
      if (q) {
        const needle = q.toLowerCase();
        const hay = `${t.name} ${t.kind} ${t.subject}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    setItems([...locals, ...(r.data || [])]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, category, status]);

  const filteredKinds = useMemo(() => Array.from(new Set(items.map((i) => i.kind))), [items]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, kind: `custom-${Math.random().toString(36).slice(2, 8)}` });
    setOpen(true);
  };

  const openEdit = (tpl) => {
    setEditing(tpl);
    setForm({
      name: tpl.name, kind: tpl.kind, category: tpl.category || "transactional",
      subject: tpl.subject, body: tpl.body, status: tpl.status || "Active",
      from_email: tpl.from_email || "",
    });
    setOpen(true);
  };

  const toggleStatus = async (tpl) => {
    const next = tpl.status === "Active" ? "Inactive" : "Active";
    // Local/frontend-only templates persist their state in localStorage instead of the API.
    if (tpl.local) {
      const overrides = loadLocalOverrides();
      overrides[tpl.kind] = { ...(overrides[tpl.kind] || {}), status: next, updated_at: new Date().toISOString() };
      saveLocalOverrides(overrides);
      notify.success(`"${tpl.name}" is now ${next}`);
      load();
      return;
    }
    try {
      await api.patch(`/email-templates/${tpl.id}`, { status: next });
      notify.success(`"${tpl.name}" is now ${next}`);
      load();
    } catch (e) { notify.error(e?.response?.data?.detail || "Failed"); }
  };

  const submit = async (e) => {
    e.preventDefault();
    // Editing a frontend-only template — save to localStorage, never call the API.
    if (editing?.local) {
      const overrides = loadLocalOverrides();
      overrides[editing.kind] = {
        ...(overrides[editing.kind] || {}),
        name: form.name,
        subject: form.subject,
        body: form.body,
        category: form.category,
        status: form.status,
        from_email: form.from_email || "TBD",
        updated_at: new Date().toISOString(),
      };
      saveLocalOverrides(overrides);
      notify.success("Template updated");
      setOpen(false); setEditing(null); setForm(EMPTY_FORM);
      load();
      return;
    }
    try {
      if (editing) {
        await api.patch(`/email-templates/${editing.id}`, form);
        notify.success("Template updated");
      } else {
        await api.post("/email-templates", form);
        notify.success("Template created");
      }
      setOpen(false); setEditing(null); setForm(EMPTY_FORM);
      load();
    } catch (err) { notify.error(err?.response?.data?.detail || "Failed"); }
  };

  const duplicate = async (tpl) => {
    if (tpl.local) {
      notify.error("Frontend-only meeting templates can't be duplicated yet.");
      return;
    }
    try {
      await api.post(`/email-templates/${tpl.id}/duplicate`);
      notify.success("Duplicated");
      load();
    } catch (e) { notify.error(e?.response?.data?.detail || "Failed"); }
  };

  const remove = async (tpl) => {
    if (tpl.local) {
      // Resetting a local template (restore defaults) is friendlier than blocking outright.
      if (!window.confirm(`Reset "${tpl.name}" back to its default content?`)) return;
      const overrides = loadLocalOverrides();
      delete overrides[tpl.kind];
      saveLocalOverrides(overrides);
      notify.success("Template reset to default");
      load();
      return;
    }
    if (!window.confirm(`Delete template "${tpl.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/email-templates/${tpl.id}`);
      notify.success("Deleted");
      load();
    } catch (e) { notify.error(e?.response?.data?.detail || "Failed"); }
  };

  return (
    <Layout>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <Mail className="text-[#ec9324]" size={26}/> Email Templates
          </h1>
          <p className="text-gray-500 mt-1">
            {items.length} template{items.length === 1 ? "" : "s"} — toggle status to start/stop a notification kind.
            {!isAdmin && <span className="ml-2 inline-flex items-center gap-1 text-[11px] bg-amber-50 border border-amber-200 text-amber-700 rounded px-1.5 py-0.5">View + toggle only (Admin can edit)</span>}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate} className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="add-template-btn">
            <Plus size={16} className="mr-2"/> New Template
          </Button>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-3 items-center bg-white p-4 rounded-xl shadow-soft border border-gray-100">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16}/>
          <Input placeholder="Search by name, kind or subject…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} data-testid="template-search"/>
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-44" data-testid="template-category-filter"><SelectValue placeholder="Category"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40" data-testid="template-status-filter"><SelectValue placeholder="Status"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
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
                <th className="px-4 py-3 text-left">Template Name</th>
                <th className="px-4 py-3 text-left">Kind</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">From Email</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Last Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50/80" data-testid={`template-row-${t.kind}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <button type="button" onClick={() => setPreview(t)} className="text-left hover:text-[#ec9324] hover:underline focus:outline-none" data-testid={`preview-${t.kind}`}>
                      {t.name}
                    </button>
                    {t.local && <span className="ml-2 inline-flex text-[10px] bg-orange-50 border border-orange-200 text-[#ec9324] rounded px-1.5 py-0.5 font-bold tracking-wider">MEETING</span>}
                    {t.system && !t.local && <span className="ml-2 inline-flex text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">SYSTEM</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{t.kind}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex text-xs font-medium bg-[#ec9324]/10 text-[#ec9324] rounded px-2 py-0.5">{t.category}</span>
                  </td>
                  <td className="px-4 py-3 text-xs" data-testid={`from-${t.kind}`}>
                    {t.from_email === "TBD" ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-bold tracking-wider bg-amber-50 border border-amber-200 text-amber-700 text-[10px]">TBD</span>
                    ) : t.from_email ? (
                      <span className="text-gray-700">{t.from_email}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="inline-flex items-center gap-2">
                      <Switch
                        checked={t.status === "Active"}
                        onCheckedChange={() => toggleStatus(t)}
                        data-testid={`status-toggle-${t.kind}`}
                        className="data-[state=checked]:bg-[#ec9324]"
                      />
                      <span className={`text-xs ${t.status === "Active" ? "text-green-700" : "text-gray-500"}`}>{t.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmt(t.updated_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setPreview(t)} className="h-8 w-8 p-0" data-testid={`view-${t.kind}`} aria-label="Preview">
                        <Eye size={14}/>
                      </Button>
                      {isAdmin && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => openEdit(t)} className="h-8 w-8 p-0" data-testid={`edit-${t.kind}`} aria-label="Edit">
                            <Pencil size={14}/>
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => duplicate(t)} className="h-8 w-8 p-0" data-testid={`duplicate-${t.kind}`} aria-label="Duplicate">
                            <Copy size={14}/>
                          </Button>
                          {(!t.system || t.local) && (
                            <Button size="sm" variant="outline" onClick={() => remove(t)} className="h-8 w-8 p-0 hover:bg-red-50 hover:text-red-600 hover:border-red-300" data-testid={`delete-${t.kind}`} aria-label={t.local ? "Reset to default" : "Delete"} title={t.local ? "Reset to default" : "Delete"}>
                              {t.local ? <RotateCcw size={14}/> : <Trash2 size={14}/>}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400">No templates</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit / Create modal */}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm(EMPTY_FORM); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Template" : "New Email Template"}</DialogTitle>
            <DialogDescription>Available placeholders: <code>{`{{name}} {{email}} {{password}} {{login_url}} {{reset_link}}`}</code></DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Template Name *</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="template-name"/>
              </div>
              <div>
                <Label>Kind (slug) *</Label>
                <Input required disabled={!!editing?.system} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} data-testid="template-kind"/>
                <div className="text-[10px] text-gray-500 mt-1">{editing?.system ? "System kinds cannot be renamed." : "Unique identifier used when sending."}</div>
              </div>
              <div>
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger data-testid="template-category"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>From Email {editing?.local && <span className="text-[10px] text-amber-700 ml-1">(backend wiring pending — leave as TBD for now)</span>}</Label>
                <Input
                  placeholder="TBD"
                  value={form.from_email}
                  onChange={(e) => setForm({ ...form, from_email: e.target.value })}
                  data-testid="template-from-email"
                />
              </div>
              <div className="col-span-2">
                <Label>Subject *</Label>
                <Input required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} data-testid="template-subject"/>
              </div>
              <div className="col-span-2">
                <Label>Body</Label>
                <RichTextEditor value={form.body} onChange={(html) => setForm({ ...form, body: html })} testId="template-body"/>
              </div>
              <div className="col-span-2 flex items-center gap-2 pt-2">
                <Switch checked={form.status === "Active"} onCheckedChange={(v) => setForm({ ...form, status: v ? "Active" : "Inactive" })} data-testid="template-status-toggle" className="data-[state=checked]:bg-[#ec9324]"/>
                <span className="text-sm text-gray-700">Active — send this template when its kind is triggered</span>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="save-template-btn">
                {editing ? "Save Changes" : "Create Template"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Preview modal */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText size={16}/> {preview?.name}</DialogTitle>
            <DialogDescription>Kind: <code>{preview?.kind}</code> • Category: {preview?.category} • Status: {preview?.status}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="border border-gray-200 rounded-md">
              <div className="bg-gray-50 border-b border-gray-200 px-3 py-2 text-xs text-gray-500">Subject</div>
              <div className="px-3 py-2 font-medium text-gray-900" data-testid="preview-subject">{preview?.subject}</div>
            </div>
            <div className="border border-gray-200 rounded-md">
              <div className="bg-gray-50 border-b border-gray-200 px-3 py-2 text-xs text-gray-500">Body (rendered)</div>
              <div className="prose prose-sm max-w-none px-3 py-3" data-testid="preview-body" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(preview?.body || "") }}/>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
