/*
 * CRM → Client Contacts page.
 *
 * Aug 3 2026 — Phase 1 delivery:
 *   • Card-based list (search + pagination)
 *   • Create / Edit dialog with all fields incl. repeatable Previous Work Experience
 *   • Detail View page (routed via /crm/client-contacts/:id)
 *   • Client Name — SingleSelect populated from Segmentations (Level 1 = root names)
 *   • Industries  — MultiSelect populated from Level-2 children of the chosen Client Name
 *     (mirrors the Teams → Team Member dropdown UX 1:1)
 *   • Placeholder columns for Projects / Serviced / Calls / Revenue (Phase 2 will
 *     replace these with a real calendar-filtered activity summary).
 */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageContainer, PageHeader } from "../components/PageContainer";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../components/ui/dialog";
import SingleSelect from "../components/SingleSelect";
import MultiSelect from "../components/MultiSelect";
import notify from "../lib/notify";
import api, { formatApiError } from "../lib/api";
import { confirm as confirmDialog } from "../lib/dialog";

import Plus from "@mui/icons-material/AddOutlined";
import SearchIcon from "@mui/icons-material/SearchOutlined";
import Mail from "@mui/icons-material/MailOutline";
import Phone from "@mui/icons-material/PhoneOutlined";
import Pencil from "@mui/icons-material/EditOutlined";
import Eye from "@mui/icons-material/VisibilityOutlined";
import Trash from "@mui/icons-material/DeleteOutlined";
import LinkedIn from "@mui/icons-material/LinkedIn";
import Business from "@mui/icons-material/BusinessOutlined";
import Place from "@mui/icons-material/PlaceOutlined";
import Badge from "@mui/icons-material/BadgeOutlined";
import BackArrow from "@mui/icons-material/ArrowBackOutlined";

const EMPTY_WORK = { company_name: "", designation: "", start_month_year: "", end_month_year: "" };
const EMPTY_FORM = {
  name: "", email: "", phone: "", client_name: "", designation: "", base_location: "",
  linkedin_url: "", industries: [], previous_work_experience: [],
};

// -------- helpers --------
function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
}

// Collect Level-1 names (root names) from segmentations list.
function levelOneOptions(segRows) {
  return (segRows || [])
    .map((s) => ({ value: s.name, label: s.name, sublabel: s.description || "" }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Level-2 = direct children of the chosen segmentation's root tree.
function levelTwoOptions(segRows, clientName) {
  if (!clientName) return [];
  const seg = (segRows || []).find((s) => s.name === clientName);
  const kids = (seg?.tree?.children || []).map((c) => (c?.name || "").trim()).filter(Boolean);
  const uniq = [...new Set(kids)].sort((a, b) => a.localeCompare(b));
  return uniq.map((n) => ({ value: n, label: n }));
}

// Placeholder metric cell used inside cards + detail Activity Summary.
function Metric({ label, value = "—", accent = "gray" }) {
  const bg = accent === "orange" ? "bg-[#ec9324]/10 text-[#ec9324]" :
             accent === "emerald" ? "bg-emerald-50 text-emerald-700" :
             accent === "blue" ? "bg-blue-50 text-blue-700" :
             accent === "purple" ? "bg-purple-50 text-purple-700" :
             "bg-gray-100 text-gray-700";
  return (
    <div className="flex-1 min-w-0 text-center">
      <div className={`text-sm font-bold rounded-md py-1 px-2 ${bg} inline-block min-w-[54px]`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-gray-500 mt-1 font-medium">
        {label}
      </div>
    </div>
  );
}

// ============================================================ LIST PAGE
export default function ClientContactsPage() {
  const { id } = useParams();          // if present → detail mode
  if (id) return <ClientContactDetail contactId={id} />;
  return <ClientContactsList />;
}

// ============================================================ LIST
function ClientContactsList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [segments, setSegments] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null); // full row when editing
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = async (q = "") => {
    setLoading(true);
    try {
      const [contactsRes, segRes] = await Promise.all([
        api.get(`/client-contacts?search=${encodeURIComponent(q)}&page_size=200`),
        api.get(`/segmentations`),
      ]);
      setRows(contactsRes.data.rows || []);
      setSegments(segRes.data.rows || []);
    } catch (e) {
      notify.error(formatApiError(e, "Failed to load client contacts"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(""); }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => load(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const l1Options = useMemo(() => levelOneOptions(segments), [segments]);
  const l2Options = useMemo(() => levelTwoOptions(segments, form.client_name), [segments, form.client_name]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      name: row.name || "",
      email: row.email || "",
      phone: row.phone || "",
      client_name: row.client_name || "",
      designation: row.designation || "",
      base_location: row.base_location || "",
      linkedin_url: row.linkedin_url || "",
      industries: row.industries || [],
      previous_work_experience: row.previous_work_experience || [],
    });
    setDialogOpen(true);
  };

  const onSave = async () => {
    if (!form.name.trim()) { notify.error("Name is required"); return; }
    setSaving(true);
    try {
      const payload = { ...form };
      if (editing) {
        await api.patch(`/client-contacts/${editing.id}`, payload);
        notify.success("Client contact updated");
      } else {
        await api.post(`/client-contacts`, payload);
        notify.success("Client contact created");
      }
      setDialogOpen(false);
      load(search);
    } catch (e) {
      notify.error(formatApiError(e, "Failed to save client contact"));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (row) => {
    const ok = await confirmDialog({
      title: "Delete client contact?",
      message: `This will remove ${row.name} permanently. Proceed?`,
      confirmLabel: "Delete", tone: "danger",
    });
    if (!ok) return;
    try {
      await api.delete(`/client-contacts/${row.id}`);
      notify.success("Deleted");
      load(search);
    } catch (e) {
      notify.error(formatApiError(e, "Failed to delete"));
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Client Contacts"
        subtitle="Directory of client-side contacts across all segmentations"
        actions={
          <Button
            onClick={openCreate}
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white flex items-center gap-1"
            data-testid="client-contact-add-btn"
          >
            <Plus sx={{ fontSize: 18 }} /> Client Contact
          </Button>
        }
      />

      {/* Search bar */}
      <div className="px-6 pt-2 pb-4">
        <div className="relative max-w-md">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" sx={{ fontSize: 18 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone, designation…"
            data-testid="client-contact-search"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#ec9324]"
          />
        </div>
      </div>

      {/* Card grid */}
      <div className="px-6 pb-8">
        {loading && rows.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-16">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-16">
            No client contacts yet. Click <b>+ Client Contact</b> to add the first one.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="client-contact-cards">
            {rows.map((r) => (
              <ContactCard
                key={r.id} row={r}
                onView={() => navigate(`/crm/client-contacts/${r.id}`)}
                onEdit={() => openEdit(r)}
                onDelete={() => onDelete(r)}
              />
            ))}
          </div>
        )}
      </div>

      <ContactFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        form={form}
        setForm={setForm}
        l1Options={l1Options}
        l2Options={l2Options}
        onSubmit={onSave}
        saving={saving}
      />
    </PageContainer>
  );
}

// ============================================================ Card
function ContactCard({ row, onView, onEdit, onDelete }) {
  return (
    <div
      className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-[#ec9324]/40 transition-all p-4 flex flex-col"
      data-testid={`client-contact-card-${row.display_id}`}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#ec9324] to-[#d97706] text-white flex items-center justify-center font-semibold flex-shrink-0">
          {(row.name || "?").slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold text-gray-900 truncate">{row.name}</h3>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">#{row.display_id}</span>
          </div>
          <div className="text-xs text-gray-500 truncate">
            {row.designation || "—"}
            {row.client_name && <span className="text-gray-400"> · {row.client_name}</span>}
          </div>
          {row.base_location && (
            <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">
              <Place sx={{ fontSize: 12 }} /> {row.base_location}
            </div>
          )}
        </div>

        {/* Icon meta (email / phone / linkedin) */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {row.email && (
            <a href={`mailto:${row.email}`} title={row.email}
               className="w-7 h-7 rounded-full text-gray-500 hover:bg-[#ec9324]/10 hover:text-[#ec9324] flex items-center justify-center">
              <Mail sx={{ fontSize: 16 }} />
            </a>
          )}
          {row.phone && (
            <a href={`tel:${row.phone}`} title={row.phone}
               className="w-7 h-7 rounded-full text-gray-500 hover:bg-[#ec9324]/10 hover:text-[#ec9324] flex items-center justify-center">
              <Phone sx={{ fontSize: 16 }} />
            </a>
          )}
          {row.linkedin_url && (
            <a href={row.linkedin_url} target="_blank" rel="noreferrer" title={row.linkedin_url}
               className="w-7 h-7 rounded-full text-[#0a66c2] hover:bg-[#0a66c2]/10 flex items-center justify-center">
              <LinkedIn sx={{ fontSize: 16 }} />
            </a>
          )}
        </div>
      </div>

      {/* Industries chips */}
      {row.industries?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {row.industries.slice(0, 3).map((ind) => (
            <span key={ind} className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#ec9324]/10 text-[#ec9324] border border-[#ec9324]/30 font-medium">
              {ind}
            </span>
          ))}
          {row.industries.length > 3 && (
            <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200 font-medium">
              +{row.industries.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Placeholder metrics row */}
      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between gap-1">
        <Metric label="Projects" value="—" accent="orange" />
        <Metric label="Serviced" value="—" accent="emerald" />
        <Metric label="Calls" value="—" accent="blue" />
        <Metric label="Revenue" value="—" accent="purple" />
      </div>

      {/* Actions footer */}
      <div className="mt-4 flex items-center gap-2">
        <button onClick={onView}
                data-testid={`client-contact-view-${row.display_id}`}
                className="flex-1 h-8 rounded-md border border-gray-200 hover:border-[#ec9324] hover:text-[#ec9324] text-xs font-medium text-gray-700 flex items-center justify-center gap-1">
          <Eye sx={{ fontSize: 14 }} /> View
        </button>
        <button onClick={onEdit}
                data-testid={`client-contact-edit-${row.display_id}`}
                className="flex-1 h-8 rounded-md border border-gray-200 hover:border-[#ec9324] hover:text-[#ec9324] text-xs font-medium text-gray-700 flex items-center justify-center gap-1">
          <Pencil sx={{ fontSize: 14 }} /> Edit
        </button>
        <button onClick={onDelete}
                data-testid={`client-contact-delete-${row.display_id}`}
                className="w-8 h-8 rounded-md border border-gray-200 hover:border-red-400 hover:text-red-600 text-gray-500 flex items-center justify-center">
          <Trash sx={{ fontSize: 14 }} />
        </button>
      </div>
    </div>
  );
}

// ============================================================ Form Dialog
function ContactFormDialog({ open, onOpenChange, editing, form, setForm, l1Options, l2Options, onSubmit, saving }) {
  const patch = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setWork = (idx, k, v) => setForm((f) => {
    const arr = [...(f.previous_work_experience || [])];
    arr[idx] = { ...arr[idx], [k]: v };
    return { ...f, previous_work_experience: arr };
  });
  const addWork = () => setForm((f) => ({
    ...f, previous_work_experience: [...(f.previous_work_experience || []), { ...EMPTY_WORK }],
  }));
  const removeWork = (idx) => setForm((f) => ({
    ...f, previous_work_experience: (f.previous_work_experience || []).filter((_, i) => i !== idx),
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="client-contact-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Client Contact" : "Add Client Contact"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name *"><Input value={form.name} onChange={(e) => patch("name", e.target.value)} placeholder="Full name" data-testid="cc-name" /></Field>
            <Field label="Designation"><Input value={form.designation} onChange={(e) => patch("designation", e.target.value)} placeholder="e.g. Partner, Director" /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => patch("email", e.target.value)} placeholder="name@company.com" /></Field>
            <Field label="Phone No."><Input value={form.phone} onChange={(e) => patch("phone", e.target.value)} placeholder="+91 …" /></Field>
            <Field label="Client Name (Level 1 Segment)">
              <SingleSelect
                options={l1Options}
                value={form.client_name || null}
                onChange={(v) => patch("client_name", v)}
                placeholder="Select client…"
                searchable
                testId="cc-client-name"
              />
            </Field>
            <Field label="Base Location"><Input value={form.base_location} onChange={(e) => patch("base_location", e.target.value)} placeholder="City / country" /></Field>
          </div>

          <Field label="LinkedIn URL">
            <div className="flex items-center gap-2">
              <LinkedIn className="text-[#0a66c2]" />
              <Input value={form.linkedin_url} onChange={(e) => patch("linkedin_url", e.target.value)} placeholder="https://linkedin.com/in/…" />
            </div>
          </Field>

          <Field label={`Industry (Level 2 of ${form.client_name || "chosen client"})`}>
            <MultiSelect
              options={l2Options}
              value={form.industries || []}
              onChange={(v) => patch("industries", v)}
              placeholder={form.client_name ? "Pick one or more industries…" : "Choose a Client Name first"}
              disabled={!form.client_name}
              testId="cc-industries"
            />
          </Field>

          {/* Previous work experience — repeatable */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Previous Work Experience</span>
              <button type="button" onClick={addWork}
                      data-testid="cc-add-work"
                      className="text-xs text-[#ec9324] font-semibold hover:underline flex items-center gap-0.5">
                <Plus sx={{ fontSize: 14 }} /> Add another
              </button>
            </div>
            <div className="space-y-2">
              {(form.previous_work_experience || []).length === 0 && (
                <div className="text-[11px] text-gray-400 italic border border-dashed border-gray-200 rounded p-3 text-center">
                  None added yet
                </div>
              )}
              {(form.previous_work_experience || []).map((w, i) => (
                <div key={i} className="border border-gray-200 rounded-lg p-3 bg-gray-50" data-testid={`cc-work-${i}`}>
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={w.company_name || ""} onChange={(e) => setWork(i, "company_name", e.target.value)} placeholder="Company name" />
                    <Input value={w.designation || ""} onChange={(e) => setWork(i, "designation", e.target.value)} placeholder="Designation" />
                    <Input value={w.start_month_year || ""} onChange={(e) => setWork(i, "start_month_year", e.target.value)} placeholder="Start (e.g. Jan 2020)" />
                    <div className="flex items-center gap-2">
                      <Input value={w.end_month_year || ""} onChange={(e) => setWork(i, "end_month_year", e.target.value)} placeholder="End (e.g. Aug 2024 or Present)" />
                      <button type="button" onClick={() => removeWork(i)}
                              className="w-8 h-8 rounded-md border border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-600 flex items-center justify-center flex-shrink-0"
                              title="Remove"><Trash sx={{ fontSize: 15 }} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={onSubmit} disabled={saving} data-testid="cc-submit"
                  className="bg-[#ec9324] hover:bg-[#d4811f] text-white">
            {saving ? "Saving…" : (editing ? "Save changes" : "Create contact")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

// ============================================================ DETAIL PAGE
function ClientContactDetail({ contactId }) {
  const navigate = useNavigate();
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [segments, setSegments] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const [c, s] = await Promise.all([
        api.get(`/client-contacts/${contactId}`),
        api.get(`/segmentations`),
      ]);
      setRow(c.data);
      setSegments(s.data.rows || []);
    } catch (e) {
      notify.error(formatApiError(e, "Failed to load"));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contactId]);

  const l1Options = useMemo(() => levelOneOptions(segments), [segments]);
  const l2Options = useMemo(() => levelTwoOptions(segments, form.client_name), [segments, form.client_name]);

  const openEdit = () => {
    setForm({
      name: row.name || "", email: row.email || "", phone: row.phone || "",
      client_name: row.client_name || "", designation: row.designation || "",
      base_location: row.base_location || "", linkedin_url: row.linkedin_url || "",
      industries: row.industries || [], previous_work_experience: row.previous_work_experience || [],
    });
    setDialogOpen(true);
  };
  const onSave = async () => {
    if (!form.name.trim()) { notify.error("Name is required"); return; }
    setSaving(true);
    try {
      const r = await api.patch(`/client-contacts/${contactId}`, form);
      setRow(r.data);
      setDialogOpen(false);
      notify.success("Saved");
    } catch (e) {
      notify.error(formatApiError(e, "Failed to save"));
    } finally { setSaving(false); }
  };

  if (loading || !row) return <div className="p-10 text-sm text-gray-500">Loading…</div>;

  return (
    <PageContainer>
      <div className="px-6 pt-5">
        <button onClick={() => navigate("/crm/client-contacts")}
                className="text-xs text-gray-500 hover:text-[#ec9324] flex items-center gap-1 mb-3">
          <BackArrow sx={{ fontSize: 14 }} /> Back to Client Contacts
        </button>

        {/* Header card */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-start gap-4 shadow-sm">
          <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-[#ec9324] to-[#d97706] text-white flex items-center justify-center font-semibold flex-shrink-0 text-lg">
            {(row.name || "?").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">{row.name}</h1>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-500">#{row.display_id}</span>
              {row.client_name && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#ec9324]/10 text-[#ec9324] border border-[#ec9324]/30 font-medium">
                  {row.client_name}
                </span>
              )}
            </div>
            <div className="text-sm text-gray-600 mt-0.5">{row.designation || "—"}</div>
            <div className="flex items-center gap-4 text-[12px] text-gray-500 mt-2 flex-wrap">
              {row.email && <span className="flex items-center gap-1"><Mail sx={{ fontSize: 14 }} /> {row.email}</span>}
              {row.phone && <span className="flex items-center gap-1"><Phone sx={{ fontSize: 14 }} /> {row.phone}</span>}
              {row.base_location && <span className="flex items-center gap-1"><Place sx={{ fontSize: 14 }} /> {row.base_location}</span>}
              {row.linkedin_url && (
                <a href={row.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[#0a66c2] hover:underline">
                  <LinkedIn sx={{ fontSize: 14 }} /> LinkedIn
                </a>
              )}
            </div>
          </div>
          <button onClick={openEdit}
                  data-testid="cc-detail-edit"
                  className="px-3 py-1.5 rounded-md bg-[#ec9324] text-white text-sm font-medium hover:bg-[#d4811f] flex items-center gap-1">
            <Pencil sx={{ fontSize: 15 }} /> Edit
          </button>
        </div>

        {/* Industries */}
        {row.industries?.length > 0 && (
          <div className="mt-4 bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">Industries (Level-2)</div>
            <div className="flex flex-wrap gap-1.5">
              {row.industries.map((i) => (
                <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-[#ec9324]/10 text-[#ec9324] border border-[#ec9324]/30 font-medium">
                  {i}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Additional placeholder fields */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Last Project Receiving Date</div>
            <div className="text-lg font-semibold text-gray-400 mt-1">— <span className="text-[11px] text-gray-400 font-normal ml-2">(placeholder)</span></div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Last Call Date</div>
            <div className="text-lg font-semibold text-gray-400 mt-1">— <span className="text-[11px] text-gray-400 font-normal ml-2">(placeholder)</span></div>
          </div>
        </div>

        {/* Activity Summary — Phase 2 will add calendar filter */}
        <div className="mt-4 bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Activity Summary</div>
              <div className="text-sm text-gray-800 font-semibold">Last 6 Months (default)</div>
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded bg-yellow-50 text-yellow-700 border border-yellow-200 font-semibold">
              Calendar filter — coming in Phase 2
            </span>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <MetricBig label="Projects" value="—" accent="orange" />
            <MetricBig label="Serviced" value="—" accent="emerald" />
            <MetricBig label="Calls" value="—" accent="blue" />
            <MetricBig label="Revenue" value="—" accent="purple" />
          </div>
        </div>

        {/* Previous work experience */}
        {row.previous_work_experience?.length > 0 && (
          <div className="mt-4 bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-3">Previous Work Experience</div>
            <div className="space-y-3">
              {row.previous_work_experience.map((w, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <div className="w-8 h-8 rounded-md bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0">
                    <Business sx={{ fontSize: 16 }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-900">{w.designation || "—"} · {w.company_name || "—"}</div>
                    <div className="text-[11px] text-gray-500">
                      {w.start_month_year || "—"} → {w.end_month_year || "Present"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 text-[11px] text-gray-500 flex items-center justify-between">
          <span>Created {fmtDate(row.created_on)} · Updated {fmtDate(row.updated_on)}</span>
          <span>Created by <b>{row.created_by?.name}</b></span>
        </div>
      </div>

      <ContactFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={row}
        form={form}
        setForm={setForm}
        l1Options={l1Options}
        l2Options={l2Options}
        onSubmit={onSave}
        saving={saving}
      />
    </PageContainer>
  );
}

function MetricBig({ label, value, accent = "gray" }) {
  const bg = accent === "orange" ? "bg-[#ec9324]/10 text-[#ec9324] border-[#ec9324]/30" :
             accent === "emerald" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
             accent === "blue" ? "bg-blue-50 text-blue-700 border-blue-200" :
             accent === "purple" ? "bg-purple-50 text-purple-700 border-purple-200" :
             "bg-gray-100 text-gray-700 border-gray-200";
  return (
    <div className={`rounded-lg border ${bg} px-4 py-3 text-center`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wider font-semibold mt-1 opacity-80">{label}</div>
    </div>
  );
}
