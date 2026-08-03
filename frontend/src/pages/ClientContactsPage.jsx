/*
 * CRM → Client Contacts page (Aug 2026 rev-2).
 *
 * Sections:
 *   • ClientContactsList — top-bar action, search + Client-Name filter +
 *     sort dropdown, card grid, pagination, create/edit dialog.
 *   • ContactCard        — one row per contact. Layout follows the
 *     reference screenshot (title, ID row, meta table, metrics row,
 *     bottom icon action bar).
 *   • ContactFormDialog  — all fields including the repeatable
 *     Previous Work Experience section (Month + Year dropdown-pair) and
 *     the L2 Industries multi-select whose UX matches Teams → Team Member.
 *   • ClientContactDetail (routed from /crm/client-contacts/:id) — full
 *     view page with Edit button in the header, all captured info,
 *     Last Project Receiving Date + Last Call Date placeholders, and
 *     an Activity Summary section powered by the ProfiX-style DateFilter
 *     (default = Last 6 Months; all four modes: between/on/before/after).
 */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "../components/ui/tooltip";
import SingleSelect from "../components/SingleSelect";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import DateFilter from "../components/DateFilter";
import Pagination from "../components/Pagination";
import DeferredSearchInput from "../components/DeferredSearchInput";
import MonthYearPicker from "../components/MonthYearPicker";
import notify from "../lib/notify";
import api, { formatApiError } from "../lib/api";
import { confirm as confirmDialog } from "../lib/dialog";

import Plus from "@mui/icons-material/AddOutlined";
import Mail from "@mui/icons-material/EmailOutlined";
import Phone from "@mui/icons-material/PhoneOutlined";
import Pencil from "@mui/icons-material/EditOutlined";
import Eye from "@mui/icons-material/VisibilityOutlined";
import Trash from "@mui/icons-material/DeleteOutlined";
import LinkedIn from "@mui/icons-material/LinkedIn";
import Business from "@mui/icons-material/BusinessOutlined";
import Place from "@mui/icons-material/PlaceOutlined";
import BackArrow from "@mui/icons-material/ArrowBackOutlined";
import Close from "@mui/icons-material/Close";

// -------- constants --------
const EMPTY_WORK = {
  company_name: "",
  designation: "",
  start_month_year: "",
  end_month_year: "",
};
const EMPTY_FORM = {
  name: "",
  email: "",
  phone: "",
  client_name: "",
  designation: "",
  base_location: "",
  linkedin_url: "",
  industries: [],
  previous_work_experience: [],
};

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name_asc", label: "Name (A → Z)" },
  { value: "name_desc", label: "Name (Z → A)" },
  { value: "id_asc", label: "ID (ascending)" },
];

// -------- helpers --------
function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch {
    return iso;
  }
}

// Level 1 = segmentation names (each Segmentation record IS a client).
function levelOneOptions(segRows) {
  return (segRows || [])
    .map((s) => ({ value: s.name, label: s.name, sublabel: s.description || "" }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Level 2 = tree.children of the chosen Segmentation.
function levelTwoOptions(segRows, clientName) {
  if (!clientName) return [];
  const seg = (segRows || []).find((s) => s.name === clientName);
  const kids = (seg?.tree?.children || [])
    .map((c) => (c?.name || "").trim())
    .filter(Boolean);
  return [...new Set(kids)]
    .sort((a, b) => a.localeCompare(b))
    .map((n) => ({ value: n, label: n }));
}

// Default filter for Activity Summary — last 6 months, Between mode.
function getLast6MonthsRange() {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - 6);
  return { field: "date", mode: "between", from, to };
}

// Client-side sort of rows returned by /client-contacts.
function sortRows(rows, key) {
  const out = [...rows];
  const byName = (a, b) => (a.name || "").localeCompare(b.name || "");
  const byCreated = (a, b) =>
    new Date(a.created_on || 0) - new Date(b.created_on || 0);
  const byDisplayId = (a, b) => (a.display_id || 0) - (b.display_id || 0);
  switch (key) {
    case "name_asc":  return out.sort(byName);
    case "name_desc": return out.sort((a, b) => byName(b, a));
    case "oldest":    return out.sort(byCreated);
    case "id_asc":    return out.sort(byDisplayId);
    case "newest":
    default:          return out.sort((a, b) => byCreated(b, a));
  }
}

// Route dispatcher (list vs detail).
export default function ClientContactsPage() {
  const { id } = useParams();
  if (id) return <ClientContactDetail contactId={id} />;
  return <ClientContactsList />;
}

// ================================================================ LIST
function ClientContactsList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [segments, setSegments] = useState([]);
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState(""); // Level-1 chip
  const [sortKey, setSortKey] = useState("newest");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [loading, setLoading] = useState(false);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const l1Options = useMemo(() => levelOneOptions(segments), [segments]);
  const l2Options = useMemo(
    () => levelTwoOptions(segments, form.client_name),
    [segments, form.client_name]
  );

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (clientFilter) params.set("client_name", clientFilter);
      params.set("page", String(page));
      params.set("page_size", String(pageSize));
      const [contactsRes, segRes] = await Promise.all([
        api.get(`/client-contacts?${params.toString()}`),
        api.get(`/segmentations`),
      ]);
      setRows(contactsRes.data.rows || []);
      setTotal(contactsRes.data.total || 0);
      setSegments(segRes.data.rows || []);
    } catch (e) {
      notify.error(formatApiError(e, "Failed to load client contacts"));
    } finally {
      setLoading(false);
    }
  };

  // Debounced search — reset to page 1 on any query change.
  useEffect(() => {
    setPage(1);
  }, [search, clientFilter, pageSize]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, clientFilter, page, pageSize]);

  // Client-side sort (backend returns newest-first by default).
  const displayed = useMemo(() => sortRows(rows, sortKey), [rows, sortKey]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, previous_work_experience: [] });
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
    if (!form.name.trim()) {
      notify.error("Name is required");
      return;
    }
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
      load();
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
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.delete(`/client-contacts/${row.id}`);
      notify.success("Deleted");
      load();
    } catch (e) {
      notify.error(formatApiError(e, "Failed to delete"));
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
      <Layout
        title="Client Contacts"
        contentClassName="w-full px-4 pt-4 pb-3 flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden"
        actions={
          <Button
            onClick={openCreate}
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-9"
            data-testid="client-contact-add-btn"
          >
            <Plus sx={{ fontSize: 16 }} className="mr-1.5" /> Client Contact
          </Button>
        }
      >
        {/* Toolbar */}
        <div className="shrink-0 -mx-4 px-4 pt-1 pb-3 bg-gray-50/95 backdrop-blur">
          <div className="bg-white p-3 rounded-xl shadow-soft border border-gray-100 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[240px] max-w-md">
              <DeferredSearchInput
                placeholder="Search name, email, phone, designation…"
                value={search}
                onCommit={setSearch}
                testId="client-contact-search"
              />
            </div>
            <div className="w-56">
              <SingleSelect
                options={[{ value: "", label: "All clients" }, ...l1Options]}
                value={clientFilter || ""}
                onChange={(v) => setClientFilter(v || "")}
                placeholder="Filter by Client Name"
                searchable
                allowClear={false}
                testId="client-contact-client-filter"
              />
            </div>
            <div className="w-52">
              <SingleSelect
                options={SORT_OPTIONS}
                value={sortKey}
                onChange={(v) => setSortKey(v || "newest")}
                placeholder="Sort by"
                allowClear={false}
                testId="client-contact-sort"
              />
            </div>
          </div>
        </div>

        {/* Card grid */}
        <div className="flex-1 min-h-0 flex flex-col bg-white rounded-xl shadow-soft border border-gray-100 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {loading && rows.length === 0 ? (
              <div className="text-sm text-gray-500 text-center py-16">Loading…</div>
            ) : displayed.length === 0 ? (
              <div className="text-sm text-gray-500 text-center py-16">
                {search || clientFilter
                  ? "No client contacts match your filters."
                  : (
                    <>
                      No client contacts yet. Click <b>+ Client Contact</b> to add the first one.
                    </>
                  )}
              </div>
            ) : (
              <div
                className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                data-testid="client-contact-cards"
              >
                {displayed.map((r) => (
                  <ContactCard
                    key={r.id}
                    row={r}
                    onView={() => navigate(`/crm/client-contacts/${r.id}`)}
                    onEdit={() => openEdit(r)}
                    onDelete={() => onDelete(r)}
                  />
                ))}
              </div>
            )}
          </div>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[12, 24, 48, 96]}
            label="Contacts"
            testIdPrefix="client-contact-pg"
          />
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
      </Layout>
    </TooltipProvider>
  );
}

// ================================================================ Card
function ContactCard({ row, onView, onEdit, onDelete }) {
  const initials = (row.name || "?").trim().split(/\s+/)
    .map((s) => s[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div
      className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-[#ec9324]/40 transition-all p-4 flex flex-col"
      data-testid={`client-contact-card-${row.display_id}`}
    >
      {/* Header — name + orange initials pill */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3
            className="text-[15px] font-bold text-gray-900 truncate leading-tight cursor-pointer hover:text-[#ec9324]"
            onClick={onView}
            data-testid={`client-contact-name-${row.display_id}`}
          >
            {row.name}
          </h3>
          <div className="text-[11px] text-gray-500 mt-0.5">
            <span>ID: <span className="font-mono text-gray-700">{row.display_id}</span></span>
          </div>
        </div>
        <div className="w-9 h-9 rounded-full bg-[#ec9324] text-white flex items-center justify-center text-xs font-bold flex-shrink-0 shadow-sm">
          {initials}
        </div>
      </div>

      {/* Info meta table */}
      <div className="mt-3 text-[12px] text-gray-700 space-y-1">
        <MetaRow label="Client Name" value={row.client_name} />
        <MetaRow label="Designation" value={row.designation} />
        <MetaRow label="Base Location" value={row.base_location} />
      </div>

      {/* Metrics row */}
      <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-4 gap-1 text-center">
        <MetricMini value="—" label="Revenue" accent="orange" />
        <MetricMini value="—" label="Calls" />
        <MetricMini value="—" label="Serviced" />
        <MetricMini value="—" label="Projects" />
      </div>

      {/* Bottom action bar */}
      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
        <ActionIcon label="Edit" onClick={onEdit} testId={`client-contact-edit-${row.display_id}`}>
          <Pencil sx={{ fontSize: 16 }} />
        </ActionIcon>
        <ActionIcon label="View" onClick={onView} testId={`client-contact-view-${row.display_id}`}>
          <Eye sx={{ fontSize: 16 }} />
        </ActionIcon>
        {row.email ? (
          <ActionIcon
            label={row.email}
            as="a"
            href={`mailto:${row.email}`}
            testId={`client-contact-mail-${row.display_id}`}
          >
            <Mail sx={{ fontSize: 16 }} />
          </ActionIcon>
        ) : (
          <ActionIcon label="No email on file" disabled>
            <Mail sx={{ fontSize: 16 }} />
          </ActionIcon>
        )}
        {row.phone ? (
          <ActionIcon
            label={row.phone}
            as="a"
            href={`tel:${row.phone}`}
            testId={`client-contact-phone-${row.display_id}`}
          >
            <Phone sx={{ fontSize: 16 }} />
          </ActionIcon>
        ) : (
          <ActionIcon label="No phone on file" disabled>
            <Phone sx={{ fontSize: 16 }} />
          </ActionIcon>
        )}
        {row.linkedin_url && (
          <ActionIcon
            label="Open LinkedIn"
            as="a"
            href={row.linkedin_url}
            target="_blank"
            rel="noreferrer"
            testId={`client-contact-linkedin-${row.display_id}`}
            tone="linkedin"
          >
            <LinkedIn sx={{ fontSize: 16 }} />
          </ActionIcon>
        )}
        <div className="flex-1" />
        <ActionIcon
          label="Delete"
          tone="danger"
          onClick={onDelete}
          testId={`client-contact-delete-${row.display_id}`}
        >
          <Trash sx={{ fontSize: 16 }} />
        </ActionIcon>
      </div>
    </div>
  );
}

function MetaRow({ label, value }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-gray-500 shrink-0 w-24">{label}:</span>
      <span className="font-medium text-gray-900 truncate flex-1">{value || "—"}</span>
    </div>
  );
}

function MetricMini({ value, label, accent = "gray" }) {
  const color =
    accent === "orange" ? "text-[#ec9324]" :
    accent === "emerald" ? "text-emerald-600" :
    accent === "blue" ? "text-blue-600" :
    "text-gray-800";
  return (
    <div>
      <div className={`text-base font-bold ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function ActionIcon({
  children, label, onClick, testId, tone = "default",
  disabled = false, as = "button", ...rest
}) {
  const toneCls =
    tone === "danger"
      ? "text-gray-400 hover:text-red-600 hover:bg-red-50"
      : tone === "linkedin"
      ? "text-[#0a66c2] hover:bg-[#0a66c2]/10"
      : "text-gray-500 hover:text-[#ec9324] hover:bg-[#ec9324]/10";
  const Comp = as;
  const commonProps = {
    onClick,
    "data-testid": testId,
    className: `w-8 h-8 rounded-md flex items-center justify-center transition-colors ${toneCls} ${disabled ? "opacity-40 pointer-events-none" : ""}`,
    ...rest,
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {Comp === "a" ? (
          <a {...commonProps}>{children}</a>
        ) : (
          <button type="button" disabled={disabled} {...commonProps}>{children}</button>
        )}
      </TooltipTrigger>
      <TooltipContent side="top" className="bg-gray-900 text-white">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// ================================================================ Form Dialog
function ContactFormDialog({
  open, onOpenChange, editing, form, setForm,
  l1Options, l2Options, onSubmit, saving,
}) {
  const patch = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const setWork = (idx, k, v) => setForm((f) => {
    const arr = [...(f.previous_work_experience || [])];
    arr[idx] = { ...arr[idx], [k]: v };
    return { ...f, previous_work_experience: arr };
  });
  const addWork = () => setForm((f) => ({
    ...f,
    previous_work_experience: [...(f.previous_work_experience || []), { ...EMPTY_WORK }],
  }));
  const removeWork = (idx) => setForm((f) => ({
    ...f,
    previous_work_experience: (f.previous_work_experience || []).filter((_, i) => i !== idx),
  }));

  // Auto-clear industries when Client Name changes (they were L2 children of
  // the previous client and are no longer valid).
  useEffect(() => {
    if (!form.client_name) return;
    const valid = new Set(l2Options.map((o) => o.value));
    const filtered = (form.industries || []).filter((i) => valid.has(i));
    if (filtered.length !== (form.industries || []).length) {
      setForm((f) => ({ ...f, industries: filtered }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.client_name, l2Options.length]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-y-auto"
        data-testid="client-contact-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit Client Contact" : "Add Client Contact"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Primary fields */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name *">
              <Input
                value={form.name}
                onChange={(e) => patch("name", e.target.value)}
                placeholder="Full name"
                data-testid="cc-name"
              />
            </Field>
            <Field label="Designation">
              <Input
                value={form.designation}
                onChange={(e) => patch("designation", e.target.value)}
                placeholder="e.g. Partner, Director"
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => patch("email", e.target.value)}
                placeholder="name@company.com"
              />
            </Field>
            <Field label="Phone No.">
              <Input
                value={form.phone}
                onChange={(e) => patch("phone", e.target.value)}
                placeholder="+91 …"
              />
            </Field>
            <Field label="Client Name (Level 1)">
              <SingleSelect
                options={l1Options}
                value={form.client_name || null}
                onChange={(v) => patch("client_name", v)}
                placeholder="Select client…"
                searchable
                testId="cc-client-name"
              />
            </Field>
            <Field label="Base Location">
              <Input
                value={form.base_location}
                onChange={(e) => patch("base_location", e.target.value)}
                placeholder="City / country"
              />
            </Field>
          </div>

          {/* Web handle */}
          <div>
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
              Web Handle
            </div>
            <div className="flex items-center gap-2 border border-gray-200 rounded-md px-2 py-1.5 bg-white focus-within:border-[#ec9324]">
              <LinkedIn className="text-[#0a66c2] shrink-0" sx={{ fontSize: 18 }} />
              <input
                className="flex-1 text-sm outline-none"
                value={form.linkedin_url}
                onChange={(e) => patch("linkedin_url", e.target.value)}
                placeholder="https://linkedin.com/in/…"
                data-testid="cc-linkedin"
              />
            </div>
          </div>

          {/* Industry (L2) — same UX as Teams → Team Member */}
          <div className="relative">
            <label className="absolute -top-2 left-3 px-1.5 bg-white text-[11px] font-medium text-gray-500 z-10 pointer-events-none">
              Industry (Level 2 of {form.client_name || "chosen client"})
            </label>
            <MultiSelectFilter
              label="Industries"
              options={l2Options.map((o) => ({ ...o, searchText: o.label }))}
              value={form.industries || []}
              onChange={(v) => patch("industries", v)}
              placeholder={
                form.client_name
                  ? "Select one or more industries…"
                  : "Choose a Client Name first"
              }
              testIdPrefix="cc-industries"
              hideLabelPrefix
              fullWidth
              searchInTrigger
              renderChipsBelow={false}
              countUnitLabel="industry(ies) selected"
              disabled={!form.client_name}
            />
            {(form.industries || []).length > 0 && (
              <div
                className="flex flex-wrap gap-1.5 mt-2"
                data-testid="cc-industries-chips"
              >
                {(form.industries || []).sort((a, b) => a.localeCompare(b)).map((i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 max-w-full text-xs font-medium rounded-full border bg-[#ec9324]/10 text-[#ec9324] border-[#ec9324]/30 pl-2.5 pr-1 py-0.5"
                    data-testid={`cc-industry-chip-${i}`}
                    title={i}
                  >
                    <span className="truncate">{i}</span>
                    <button
                      type="button"
                      onClick={() => patch(
                        "industries",
                        (form.industries || []).filter((x) => x !== i)
                      )}
                      aria-label={`Remove ${i}`}
                      className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-black/10"
                    >
                      <Close sx={{ fontSize: 11 }} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Previous work experience — repeatable */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                Previous Work Experience
              </span>
              <button
                type="button"
                onClick={addWork}
                data-testid="cc-add-work"
                className="text-xs text-[#ec9324] font-semibold hover:underline flex items-center gap-0.5"
              >
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
                <div
                  key={i}
                  className="border border-gray-200 rounded-lg p-3 bg-gray-50"
                  data-testid={`cc-work-${i}`}
                >
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Company Name">
                      <Input
                        value={w.company_name || ""}
                        onChange={(e) => setWork(i, "company_name", e.target.value)}
                        placeholder="Company name"
                        data-testid={`cc-work-${i}-company`}
                      />
                    </Field>
                    <Field label="Designation">
                      <Input
                        value={w.designation || ""}
                        onChange={(e) => setWork(i, "designation", e.target.value)}
                        placeholder="Designation"
                      />
                    </Field>
                    <Field label="Start Date (Month & Year)">
                      <MonthYearPicker
                        value={w.start_month_year || ""}
                        onChange={(v) => setWork(i, "start_month_year", v)}
                        testId={`cc-work-${i}-start`}
                      />
                    </Field>
                    <Field label="End Date (Month & Year)">
                      <div className="flex items-center gap-2">
                        <MonthYearPicker
                          value={w.end_month_year || ""}
                          onChange={(v) => setWork(i, "end_month_year", v)}
                          allowPresent
                          testId={`cc-work-${i}-end`}
                          className="flex-1"
                        />
                        <button
                          type="button"
                          onClick={() => removeWork(i)}
                          className="w-8 h-8 rounded-md border border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-600 flex items-center justify-center flex-shrink-0"
                          title="Remove work entry"
                          data-testid={`cc-work-${i}-remove`}
                        >
                          <Trash sx={{ fontSize: 15 }} />
                        </button>
                      </div>
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={saving}
            data-testid="cc-submit"
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white"
          >
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
      <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

// ================================================================ DETAIL
function ClientContactDetail({ contactId }) {
  const navigate = useNavigate();
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [segments, setSegments] = useState([]);

  // Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Activity summary DateFilter (default = last 6 months, Between mode)
  const [activityFilter, setActivityFilter] = useState(getLast6MonthsRange());

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
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contactId]);

  const l1Options = useMemo(() => levelOneOptions(segments), [segments]);
  const l2Options = useMemo(
    () => levelTwoOptions(segments, form.client_name),
    [segments, form.client_name]
  );

  const openEdit = () => {
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
      const r = await api.patch(`/client-contacts/${contactId}`, form);
      setRow(r.data);
      setDialogOpen(false);
      notify.success("Saved");
    } catch (e) {
      notify.error(formatApiError(e, "Failed to save"));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !row) {
    return (
      <Layout title="Client Contact">
        <div className="p-10 text-sm text-gray-500">Loading…</div>
      </Layout>
    );
  }

  const initials = (row.name || "?").trim().split(/\s+/)
    .map((s) => s[0]).join("").slice(0, 2).toUpperCase();

  return (
    <TooltipProvider delayDuration={150}>
      <Layout title="Client Contact">
        <div className="px-6 pt-4 pb-8 space-y-4 max-w-6xl">
          {/* Back link */}
          <button
            onClick={() => navigate("/crm/client-contacts")}
            className="text-xs text-gray-500 hover:text-[#ec9324] flex items-center gap-1"
          >
            <BackArrow sx={{ fontSize: 14 }} /> Back to Client Contacts
          </button>

          {/* Header card */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-start gap-4 shadow-sm">
            <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-[#ec9324] to-[#d97706] text-white flex items-center justify-center font-semibold flex-shrink-0 text-lg">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-gray-900">{row.name}</h1>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-500">
                  ID: {row.display_id}
                </span>
                {row.client_name && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#ec9324]/10 text-[#ec9324] border border-[#ec9324]/30 font-medium">
                    {row.client_name}
                  </span>
                )}
              </div>
              <div className="text-sm text-gray-600 mt-0.5">
                {row.designation || "—"}
              </div>
              <div className="flex items-center gap-4 text-[12px] text-gray-500 mt-2 flex-wrap">
                {row.email && (
                  <span className="flex items-center gap-1">
                    <Mail sx={{ fontSize: 14 }} /> {row.email}
                  </span>
                )}
                {row.phone && (
                  <span className="flex items-center gap-1">
                    <Phone sx={{ fontSize: 14 }} /> {row.phone}
                  </span>
                )}
                {row.base_location && (
                  <span className="flex items-center gap-1">
                    <Place sx={{ fontSize: 14 }} /> {row.base_location}
                  </span>
                )}
                {row.linkedin_url && (
                  <a
                    href={row.linkedin_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[#0a66c2] hover:underline"
                  >
                    <LinkedIn sx={{ fontSize: 14 }} /> LinkedIn
                  </a>
                )}
              </div>
            </div>
            <button
              onClick={openEdit}
              data-testid="cc-detail-edit"
              className="px-3 py-1.5 rounded-md bg-[#ec9324] text-white text-sm font-medium hover:bg-[#d4811f] flex items-center gap-1"
            >
              <Pencil sx={{ fontSize: 15 }} /> Edit
            </button>
          </div>

          {/* Industries */}
          {row.industries?.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
                Industries (Level 2)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {row.industries.map((i) => (
                  <span
                    key={i}
                    className="text-xs px-2.5 py-1 rounded-full bg-[#ec9324]/10 text-[#ec9324] border border-[#ec9324]/30 font-medium"
                  >
                    {i}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Placeholder date fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                Last Project Receiving Date
              </div>
              <div className="text-lg font-semibold text-gray-400 mt-1">
                — <span className="text-[11px] text-gray-400 font-normal ml-2">(placeholder)</span>
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                Last Call Date
              </div>
              <div className="text-lg font-semibold text-gray-400 mt-1">
                — <span className="text-[11px] text-gray-400 font-normal ml-2">(placeholder)</span>
              </div>
            </div>
          </div>

          {/* Activity Summary */}
          <ActivitySummary
            filter={activityFilter}
            onFilterChange={setActivityFilter}
          />

          {/* Previous work experience */}
          {row.previous_work_experience?.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-3">
                Previous Work Experience
              </div>
              <div className="space-y-3">
                {row.previous_work_experience.map((w, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="w-8 h-8 rounded-md bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0">
                      <Business sx={{ fontSize: 16 }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-gray-900">
                        {w.designation || "—"} · {w.company_name || "—"}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {w.start_month_year || "—"} → {w.end_month_year || "Present"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Audit footer */}
          <div className="text-[11px] text-gray-500 flex items-center justify-between flex-wrap gap-2">
            <span>Created {fmtDate(row.created_on)} · Updated {fmtDate(row.updated_on)}</span>
            {row.created_by?.name && (
              <span>Created by <b>{row.created_by.name}</b></span>
            )}
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
      </Layout>
    </TooltipProvider>
  );
}

// ================================================================ Activity Summary
function ActivitySummary({ filter, onFilterChange }) {
  // NOTE: metric values are placeholders. When the backend calc pipeline
  // is added later, this component will re-fetch on `filter` change and
  // populate the values below. The filter change ALREADY drives the
  // "all four metrics refresh together" UX contract.
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    // Simulate a "refresh all four metrics" pulse when the filter changes.
    setRefreshing(true);
    const t = setTimeout(() => setRefreshing(false), 350);
    return () => clearTimeout(t);
  }, [filter?.field, filter?.mode, filter?.from, filter?.to]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            Activity Summary
          </div>
          <div className="text-sm text-gray-800 font-semibold">
            Last 6 Months (default)
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DateFilter
            value={filter}
            onChange={onFilterChange}
            fields={["date"]}
            label="Range"
            testId="cc-activity-date-filter"
          />
        </div>
      </div>
      <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 transition-opacity ${refreshing ? "opacity-50" : "opacity-100"}`}>
        <MetricBig label="Projects" value="—" accent="orange" />
        <MetricBig label="Serviced" value="—" accent="emerald" />
        <MetricBig label="Calls" value="—" accent="blue" />
        <MetricBig label="Revenue" value="—" accent="purple" />
      </div>
      <div className="mt-3 text-[11px] text-gray-400 italic">
        Values are placeholders — the calculation pipeline will be enabled in a later phase. The range filter above already refreshes all four metrics simultaneously.
      </div>
    </div>
  );
}

function MetricBig({ label, value, accent = "gray" }) {
  const bg =
    accent === "orange" ? "bg-[#ec9324]/10 text-[#ec9324] border-[#ec9324]/30" :
    accent === "emerald" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    accent === "blue" ? "bg-blue-50 text-blue-700 border-blue-200" :
    accent === "purple" ? "bg-purple-50 text-purple-700 border-purple-200" :
    "bg-gray-100 text-gray-700 border-gray-200";
  return (
    <div className={`rounded-lg border ${bg} px-4 py-3 text-center`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wider font-semibold mt-1 opacity-80">
        {label}
      </div>
    </div>
  );
}
