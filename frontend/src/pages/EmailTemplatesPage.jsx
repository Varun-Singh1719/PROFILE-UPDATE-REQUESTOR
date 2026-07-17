import React, { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import api from "../lib/api";
import Layout from "../components/Layout";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import SingleSelect from "../components/SingleSelect";
import DeferredSearchInput from "../components/DeferredSearchInput";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "../components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import notify from "../lib/notify";
import {
  Search, Plus, Eye, Pencil, Copy, Trash2, Mail, FileText, Bold, Italic, List, ListOrdered, Link as LinkIcon, RotateCcw,
  ArrowUp, ArrowDown, ChevronsUpDown, MoreVertical,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useEffectivePage } from "../context/EffectivePermissionsContext";
import { confirm as confirmDialog, prompt as promptDialog } from '../lib/dialog';
import ViewEmailTemplateModal from "../components/ViewEmailTemplateModal";
import Pagination from "../components/Pagination";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "../components/ui/dropdown-menu";

function fmt(iso) { if (!iso) return "—"; try { return new Date(iso).toLocaleString(); } catch { return iso; } }

// "Type" is a UI-only grouping derived from the template `kind` so the
// backend contract stays untouched. It maps every seeded/system kind to the
// module that actually consumes the email:
//   Employee  — account/admin lifecycle (welcome, password reset, forgot pwd)
//   Workspace — workstation & seat-booking flows
//   Meeting   — meeting-room flows (frontend-only templates)
//   Profix    — ticketing (request/reply lifecycle) — default
function templateType(tpl) {
  const k = (tpl?.kind || "").toLowerCase();
  if (tpl?.local || k.startsWith("meeting_")) return "Meeting";
  if (k.startsWith("workstation_") || k.startsWith("workspace_") || k.startsWith("seat_")) return "Workspace";
  if (
    k === "new_employee" ||
    k === "admin_password_reset" ||
    k === "forgot_password" ||
    k.startsWith("employee_") ||
    k.startsWith("user_") ||
    k.startsWith("account_")
  ) return "Employee";
  return "Profix";
}

// Type → capsule color (matches the Profix status-badge language used across
// the app: outlined pill, colored border+text on a white bg).
const TYPE_COLORS = {
  Profix:    { text: "#ec9324", border: "#ec9324" }, // brand orange
  Employee:  { text: "#7c3aed", border: "#7c3aed" }, // purple
  Workspace: { text: "#2563eb", border: "#2563eb" }, // blue
  Meeting:   { text: "#16a34a", border: "#16a34a" }, // green
};

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
  const addLink = async () => {
    const url = await promptDialog({ title: 'Insert link', message: 'Enter the destination URL', defaultValue: 'https://' });
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

// Sortable column header. Click toggles asc/desc; visually indicates current sort col/dir.
function SortableTh({ label, col, sortBy, sortDir, onSort, testId, align = "left" }) {
  const active = sortBy === col;
  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <th className={`px-4 py-3 text-${align}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        data-testid={testId}
        className={`inline-flex items-center gap-1 uppercase tracking-wider font-bold text-xs ${active ? "text-[#ec9324]" : "text-gray-700 hover:text-gray-900"}`}
      >
        {label}
        <Icon size={12} className={active ? "" : "text-gray-400"}/>
      </button>
    </th>
  );
}

// Tooltip-wrapped icon action button — shows the action name on hover.
function IconAction({ label, onClick, testId, variant = "outline", className = "", children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="sm" variant={variant} onClick={onClick} className={`h-8 w-8 p-0 ${className}`} data-testid={testId} aria-label={label} title={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export default function EmailTemplatesPage() {
  const { user } = useAuth();
  // Both Admin and Super Admin can edit templates. (Previous code only checked "Admin"
  // which excluded Super Admin — fixed here so the seeded admin can edit meeting templates.)
  const isAdmin = user?.role === "Admin" || user?.role === "Super Admin";
  // ── Permissions V3 (Round 3) ──
  const { fn: permFn } = useEffectivePage("manage", "email_templates");
  const permCreate  = permFn("create");
  const permEdit    = permFn("edit");
  const permDelete  = permFn("delete");
  const permTestSend = permFn("test_send");
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState([]);
  const [status, setStatus] = useState([]);
  const [editing, setEditing] = useState(null); // template or null
  const [form, setForm] = useState(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [view, setView] = useState(null); // Pixel-perfect email preview modal.
  // Sortable column state — default sort is by template Name (asc).
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  // Client-side pagination (list is a merged frontend+backend collection)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const toggleSort = (col) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
  };

  const load = React.useCallback(async () => {
    const r = await api.get("/email-templates", {
      params: {
        q: q || undefined,
        category: category.length ? category.join(",") : undefined,
        status: status.length ? status.join(",") : undefined,
      },
    });
    // Inject the 3 frontend-only meeting templates (with any localStorage overrides) and
    // merge them with backend rows. Default view sorts by Name so meeting + profix rows
    // are interleaved alphabetically rather than always pinned to the top.
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
  }, [q, category, status]);
  // eslint-disable-next-line
  useEffect(() => { load(); }, [load]);

  const filteredKinds = useMemo(() => Array.from(new Set(items.map((i) => i.kind))), [items]);

  // Apply client-side sort on top of the merged list so headers can drive ordering.
  const sortedItems = useMemo(() => {
    const arr = [...items];
    const dir = sortDir === "asc" ? 1 : -1;
    const get = (t) => {
      switch (sortBy) {
        case "name": return (t.name || "").toLowerCase();
        case "type": return templateType(t).toLowerCase();
        case "kind": return (t.kind || "").toLowerCase();
        case "category": return (t.category || "").toLowerCase();
        case "from": return (t.from_email || "").toLowerCase();
        case "status": return (t.status || "").toLowerCase();
        case "updated": return t.updated_at ? new Date(t.updated_at).getTime() : 0;
        default: return "";
      }
    };
    arr.sort((a, b) => {
      const av = get(a), bv = get(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [items, sortBy, sortDir]);

  // Reset to page 1 whenever filters or sort change
  useEffect(() => { setPage(1); }, [q, category, status, sortBy, sortDir]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedItems.slice(start, start + pageSize);
  }, [sortedItems, page, pageSize]);

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
      const ok = await confirmDialog({ title: 'Reset template', message: `Reset "${tpl.name}" back to its default content?`, confirmLabel: 'Reset' });
      if (!ok) return;
      const overrides = loadLocalOverrides();
      delete overrides[tpl.kind];
      saveLocalOverrides(overrides);
      notify.success("Template reset to default");
      load();
      return;
    }
    const ok = await confirmDialog({ title: 'Delete template', message: `Delete "${tpl.name}"? This cannot be undone.`, confirmLabel: 'Delete', confirmVariant: 'destructive' });
    if (!ok) return;
    try {
      await api.delete(`/email-templates/${tpl.id}`);
      notify.success("Deleted");
      load();
    } catch (e) { notify.error(e?.response?.data?.detail || "Failed"); }
  };

  return (
    <Layout
      title="Email Templates"
      contentClassName="w-full px-4 pt-4 pb-3 flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden"
      actions={isAdmin && permCreate.isVisible && (
        <Button onClick={openCreate} className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-9" data-testid="add-template-btn" disabled={!permCreate.canUse}>
          <Plus size={16} className="mr-2"/> New Template
        </Button>
      )}
    >
      <TooltipProvider delayDuration={150}>
      <div className="shrink-0 -mx-4 px-4 pt-1 pb-3 bg-gray-50/95 backdrop-blur">
        <div className="flex flex-wrap gap-3 items-center bg-white p-4 rounded-xl shadow-soft border border-gray-100" data-testid="templates-filter-bar">
        <DeferredSearchInput
          className="flex-1 min-w-[240px]"
          placeholder="Search by name, kind or subject…"
          testId="template-search"
          value={q}
          onCommit={setQ}
        />
        <MultiSelectFilter
          label="Category"
          value={category}
          onChange={setCategory}
          options={CATEGORIES.map((c) => ({ value: c, label: c }))}
          testIdPrefix="template-category-filter"
          className="w-44"
        />
        <MultiSelectFilter
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "Active", label: "Active" },
            { value: "Inactive", label: "Inactive" },
          ]}
          testIdPrefix="template-status-filter"
          className="w-40"
        />
        </div>
      </div>

      <div className="mt-6 flex-1 min-h-0 flex flex-col bg-white rounded-xl shadow-soft border border-gray-100 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 font-bold tracking-wider border-b border-gray-200 sticky top-0 z-10">
              <tr>
                <SortableTh label="Template Name" col="name" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} testId="sort-name"/>
                <SortableTh label="Type" col="type" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} testId="sort-type"/>
                <SortableTh label="Kind" col="kind" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} testId="sort-kind"/>
                <SortableTh label="Category" col="category" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} testId="sort-category"/>
                <SortableTh label="From Email" col="from" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} testId="sort-from"/>
                <SortableTh label="Status" col="status" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} testId="sort-status"/>
                <SortableTh label="Last Updated" col="updated" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} testId="sort-updated"/>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedItems.map((t) => (
                <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50/80" data-testid={`template-row-${t.kind}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <button type="button" onClick={() => setView(t)} className="text-left hover:text-[#ec9324] hover:underline focus:outline-none" data-testid={`preview-${t.kind}`}>
                      {t.name}
                    </button>
                    {t.system && !t.local && <span className="ml-2 inline-flex text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">SYSTEM</span>}
                  </td>
                  <td className="px-4 py-3" data-testid={`type-${t.kind}`}>
                    {(() => {
                      const tt = templateType(t);
                      const c = TYPE_COLORS[tt] || TYPE_COLORS.Profix;
                      return (
                        <span
                          data-testid={`type-badge-${t.kind}`}
                          className="inline-flex items-center justify-center w-24 h-6 rounded-full border-2 text-[11px] font-semibold bg-white select-none whitespace-nowrap"
                          style={{ color: c.text, borderColor: c.border }}
                        >
                          {tt}
                        </span>
                      );
                    })()}
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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 hover:bg-gray-100 focus-visible:ring-1 focus-visible:ring-[#ec9324]/40"
                          data-testid={`row-menu-${t.kind}`}
                          aria-label="Row actions"
                          title="Actions"
                        >
                          <MoreVertical size={16} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onClick={() => setView(t)}
                          data-testid={`view-${t.kind}`}
                          className="cursor-pointer"
                        >
                          <Eye size={14} className="mr-2 text-gray-500" /> View
                        </DropdownMenuItem>
                        {isAdmin && permEdit.isVisible && (
                          <DropdownMenuItem
                            onClick={() => openEdit(t)}
                            data-testid={`edit-${t.kind}`}
                            className="cursor-pointer"
                          >
                            <Pencil size={14} className="mr-2 text-gray-500" /> Edit
                          </DropdownMenuItem>
                        )}
                        {isAdmin && permEdit.isVisible && (
                          <DropdownMenuItem
                            onClick={() => duplicate(t)}
                            data-testid={`duplicate-${t.kind}`}
                            className="cursor-pointer"
                          >
                            <Copy size={14} className="mr-2 text-gray-500" /> Duplicate
                          </DropdownMenuItem>
                        )}
                        {isAdmin && (!t.system || t.local) && permDelete.isVisible && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => remove(t)}
                              data-testid={`delete-${t.kind}`}
                              className="cursor-pointer text-red-600 focus:text-red-700 focus:bg-red-50"
                            >
                              {t.local ? (
                                <><RotateCcw size={14} className="mr-2" /> Reset to default</>
                              ) : (
                                <><Trash2 size={14} className="mr-2" /> Delete</>
                              )}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
              {sortedItems.length === 0 && (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400">No templates</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={sortedItems.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          label="Templates"
          testIdPrefix="templates-pg"
          className="mt-auto"
        />
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
                <div className="mt-1.5">
                  <SingleSelect
                    testId="template-category"
                    options={CATEGORIES.map((c) => ({ value: c, label: c }))}
                    value={form.category}
                    onChange={(v) => setForm({ ...form, category: v || form.category })}
                    allowClear={false}
                    placeholder="Select category"
                  />
                </div>
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

      {/* Pixel-perfect email preview modal — replaces the old plain preview */}
      <ViewEmailTemplateModal
        open={!!view}
        onOpenChange={(o) => { if (!o) setView(null); }}
        template={view}
        canEdit={isAdmin && permEdit.isVisible && permEdit.canUse}
        onEdit={(tpl) => { setView(null); setTimeout(() => openEdit(tpl), 180); }}
      />

      {/* Legacy quick preview modal — kept for the row-name shortcut (still used by
          the "Preview" action in the kebab menu for local/meeting templates). */}
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
      </TooltipProvider>
    </Layout>
  );
}
