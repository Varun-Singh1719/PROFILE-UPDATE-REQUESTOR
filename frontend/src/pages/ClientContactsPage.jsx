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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "../components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "../components/ui/tooltip";
import {
  Popover, PopoverTrigger, PopoverContent,
} from "../components/ui/popover";
import SearchSelect from "../components/SearchSelect";
import DateFilter from "../components/DateFilter";
import Pagination from "../components/Pagination";
import DeferredSearchInput from "../components/DeferredSearchInput";
import MonthYearPicker from "../components/MonthYearPicker";
import ISDPicker from "../components/ISDPicker";
import { DEFAULT_ISD } from "../lib/isdCodes";
import notify from "../lib/notify";
import api, { API, formatApiError } from "../lib/api";
import { confirm as confirmDialog } from "../lib/dialog";
import { __busyBridge } from "../context/BusyContext";

import Plus from "@mui/icons-material/AddOutlined";
import Mail from "@mui/icons-material/EmailOutlined";
import Phone from "@mui/icons-material/PhoneOutlined";
import PhoneCall from "@mui/icons-material/PermPhoneMsgOutlined";
import Pencil from "@mui/icons-material/EditOutlined";
import Eye from "@mui/icons-material/VisibilityOutlined";
import Trash from "@mui/icons-material/DeleteOutlined";
import LinkedIn from "@mui/icons-material/LinkedIn";
import Business from "@mui/icons-material/BusinessOutlined";
import Place from "@mui/icons-material/PlaceOutlined";
import BackArrow from "@mui/icons-material/ArrowBackOutlined";
import Upload from "@mui/icons-material/CloudUploadOutlined";
import FileDown from "@mui/icons-material/DownloadOutlined";
import FileSpreadsheet from "@mui/icons-material/DescriptionOutlined";
import History from "@mui/icons-material/HistoryOutlined";
import Loader2 from "@mui/icons-material/Autorenew";
import CheckCircle2 from "@mui/icons-material/CheckCircleOutlineOutlined";
import AlertTriangle from "@mui/icons-material/WarningAmberOutlined";
import AlertOctagon from "@mui/icons-material/ReportGmailerrorredOutlined";
import POCStatusChip from "../components/POCStatusChip";

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
  phone_isd: DEFAULT_ISD,
  client_name: "",
  designation: "",
  base_location: "",
  linkedin_url: "",
  industries: [],
  previous_work_experience: [],
};

// If a legacy record stores phone as "+91 9999900000" (ISD baked into the
// phone string), split it into { phone_isd, phone } on the fly so the edit
// dialog renders cleanly. Never mutates the caller — returns a new pair.
function splitLegacyPhone(row) {
  const isd = row?.phone_isd || "";
  const p = String(row?.phone || "").trim();
  if (isd || !p) return { phone_isd: isd || DEFAULT_ISD, phone: p };
  // "+CC digits" — pick up to 4 leading "+digits" tokens as the ISD.
  const m = p.match(/^\+(\d{1,4})\s*(.*)$/);
  if (m) return { phone_isd: `+${m[1]}`, phone: (m[2] || "").replace(/\D/g, "") };
  // No leading '+', keep as-is.
  return { phone_isd: DEFAULT_ISD, phone: p.replace(/\D/g, "") };
}

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

// Compact metric formatter for the card mini-tiles.
//   fmtMetric(12)                -> "12"
//   fmtMetric(1450000, {money})  -> "$1.5M"
//   fmtMetric(null)              -> "—"
function fmtMetric(v, opts = {}) {
  if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  if (opts.money) {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
    if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
    return `$${n.toLocaleString()}`;
  }
  return n.toLocaleString();
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

// Default filter for Activity Summary — last 12 months, Between mode.
function getLast12MonthsRange() {
  const to = new Date();
  const from = new Date();
  // 11 months back → gives 12 columns inclusive (current + 11 previous).
  from.setMonth(from.getMonth() - 11);
  from.setDate(1);
  return { field: "date", mode: "between", from, to };
}

// Build the ordered list of month "keys" (YYYY-MM) spanned by a DateFilter
// value, honouring all four modes (between / on / before / after). Caps at
// 36 months so a pathological range doesn't render a 500-column table.
function monthsInRange(filter) {
  const MAX = 36;
  const today = new Date();
  let from, to;
  const mode = filter?.mode || "between";
  if (mode === "on") {
    if (!filter.from) return [];
    from = new Date(filter.from);
    to = new Date(filter.from);
  } else if (mode === "before") {
    if (!filter.from) return [];
    to = new Date(filter.from);
    from = new Date(to);
    from.setMonth(from.getMonth() - 11);
  } else if (mode === "after") {
    if (!filter.from) return [];
    from = new Date(filter.from);
    to = new Date(today);
    if (to < from) to = from;
    // Cap at 12 months forward if the range is unbounded going forward.
    const cap = new Date(from);
    cap.setMonth(cap.getMonth() + 11);
    if (to > cap) to = cap;
  } else {
    // between
    if (!filter?.from || !filter?.to) return [];
    from = new Date(filter.from);
    to = new Date(filter.to);
    if (to < from) [from, to] = [to, from];
  }
  const out = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cur <= end && out.length < MAX) {
    const y = cur.getFullYear();
    const m = cur.getMonth();
    out.push({
      key: `${y}-${String(m + 1).padStart(2, "0")}`,
      label: cur.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
      year: y,
      month: m + 1,
    });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
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

  // Duplicate detection dialog
  const [dupState, setDupState] = useState(null);
  //  ↑ null | { duplicates: [...], pendingForce: true }

  // Bulk upload / history modals
  const [bulkOpen, setBulkOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

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
    const { phone_isd, phone } = splitLegacyPhone(row);
    setForm({
      name: row.name || "",
      email: row.email || "",
      phone,
      phone_isd,
      client_name: row.client_name || "",
      designation: row.designation || "",
      base_location: row.base_location || "",
      linkedin_url: row.linkedin_url || "",
      industries: row.industries || [],
      previous_work_experience: row.previous_work_experience || [],
    });
    setDialogOpen(true);
  };

  const onSave = async (opts = {}) => {
    if (!form.name.trim()) {
      notify.error("Name is required");
      return;
    }
    setSaving(true);
    const forceParam = opts.force ? "?force=true" : "";
    try {
      const payload = { ...form };
      if (editing) {
        await api.patch(`/client-contacts/${editing.id}${forceParam}`, payload);
        notify.success("Client contact updated");
      } else {
        await api.post(`/client-contacts${forceParam}`, payload);
        notify.success("Client contact created");
      }
      setDupState(null);
      setDialogOpen(false);
      load();
    } catch (e) {
      // Backend returns HTTP 409 with detail.code === "DUPLICATE_CLIENT_CONTACT"
      // and a `duplicates: [...]` list. Show the dialog and let the user pick
      // between "Save anyway" (force=true) and "Cancel".
      const detail = e?.response?.data?.detail;
      if (
        e?.response?.status === 409 &&
        detail &&
        detail.code === "DUPLICATE_CLIENT_CONTACT" &&
        Array.isArray(detail.duplicates)
      ) {
        setDupState({ duplicates: detail.duplicates });
        return;
      }
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
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setHistoryOpen(true)}
              className="h-9 border-gray-300 text-gray-700 hover:border-[#ec9324] hover:text-[#ec9324]"
              data-testid="cc-upload-history-btn"
            >
              <History sx={{ fontSize: 16 }} className="mr-1.5" /> Upload History
            </Button>
            <Button
              variant="outline"
              onClick={() => setBulkOpen(true)}
              className="h-9 border-[#ec9324] text-[#ec9324] hover:bg-[#ec9324]/10"
              data-testid="cc-open-bulk-upload-btn"
            >
              <Upload sx={{ fontSize: 16 }} className="mr-1.5" /> Upload Contacts
            </Button>
            <Button
              onClick={openCreate}
              className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-9"
              data-testid="client-contact-add-btn"
            >
              <Plus sx={{ fontSize: 16 }} className="mr-1.5" /> Client Contact
            </Button>
          </div>
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
              <SearchSelect
                options={[{ value: "", label: "All clients" }, ...l1Options]}
                value={clientFilter || ""}
                onChange={(v) => setClientFilter(v || "")}
                placeholder="Filter by Client Name"
                size="sm"
                allowClear={false}
                loading={loading && l1Options.length === 0}
                testId="client-contact-client-filter"
              />
            </div>
            <div className="w-52">
              <SearchSelect
                options={SORT_OPTIONS}
                value={sortKey}
                onChange={(v) => setSortKey(v || "newest")}
                placeholder="Sort by"
                size="sm"
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
          onOpenChange={(o) => { setDialogOpen(o); if (!o) setDupState(null); }}
          editing={editing}
          form={form}
          setForm={setForm}
          l1Options={l1Options}
          l2Options={l2Options}
          onSubmit={onSave}
          saving={saving}
        />

        <DuplicateWarningDialog
          state={dupState}
          onClose={() => setDupState(null)}
          onSaveAnyway={() => onSave({ force: true })}
          saving={saving}
        />

        <BulkUploadModal
          open={bulkOpen}
          onClose={() => setBulkOpen(false)}
          onComplete={() => load()}
        />

        <UploadHistoryModal
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
        />
      </Layout>
    </TooltipProvider>
  );
}

// ================================================================ Card
function ContactCard({ row, onView, onEdit, onDelete }) {
  const initials = (row.name || "?").trim().split(/\s+/)
    .map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  // Handles both new (phone_isd + phone) and legacy ("+91 9999900000" in phone).
  const fullPhone = (() => {
    if (!row.phone) return "";
    if (row.phone_isd) return `${row.phone_isd} ${row.phone}`.trim();
    return String(row.phone).trim();
  })();

  return (
    <div
      className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-[#ec9324]/40 transition-all p-4 flex flex-col"
      data-testid={`client-contact-card-${row.display_id}`}
    >
      {/* Header — initials, name, firm logo, LinkedIn + contact icons */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-[#ec9324] text-white flex items-center justify-center text-xs font-bold flex-shrink-0 shadow-sm">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <a
                href={`/crm/client-contacts/${row.id}`}
                onClick={(e) => {
                  // Plain-click stays inside the SPA. Ctrl/Cmd/middle-click
                  // is left to the browser so it opens a new tab natively.
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
                  e.preventDefault();
                  onView();
                }}
                className="text-[15px] font-bold text-gray-900 truncate leading-tight cursor-pointer hover:text-[#ec9324] min-w-0 no-underline"
                data-testid={`client-contact-name-${row.display_id}`}
              >
                {row.name}
              </a>
              <FirmLogo name={row.client_name} />
              <LinkedInIconBtn
                url={row.linkedin_url}
                testId={`client-contact-linkedin-${row.display_id}`}
              />
              <CopyableContactIcon
                email={row.email}
                phone={fullPhone}
                testId={`client-contact-contactinfo-${row.display_id}`}
              />
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>ID: <span className="font-mono text-gray-700">{row.display_id}</span></span>
              {row.poc_status && <POCStatusChip status={row.poc_status} />}
            </div>
          </div>
        </div>
      </div>

      {/* Info meta table */}
      <div className="mt-3 text-[12px] text-gray-700 space-y-1">
        <MetaRow label="Client Name" value={row.client_name} />
        <MetaRow label="Designation" value={row.designation} />
        <MetaRow label="Base Location" value={row.base_location} />
      </div>

      {/* Metrics row — all in orange (single accent). Reads totals_till_date
          when the backend supplies it; falls back to "—" otherwise. */}
      <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-4 gap-1 text-center">
        <MetricMini value={fmtMetric(row.totals_till_date?.projects)}                  label="Projects" />
        <MetricMini value={fmtMetric(row.totals_till_date?.serviced)}                  label="Serviced" />
        <MetricMini value={fmtMetric(row.totals_till_date?.calls)}                     label="Calls" />
        <MetricMini value={fmtMetric(row.totals_till_date?.revenue, { money: true })}  label="Revenue" />
      </div>

      {/* Bottom action bar — just Edit / View / Delete now
          (email/phone/linkedin moved to the header) */}
      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
        <ActionIcon label="Edit" onClick={onEdit} testId={`client-contact-edit-${row.display_id}`}>
          <Pencil sx={{ fontSize: 16 }} />
        </ActionIcon>
        <ActionIcon label="View" onClick={onView} testId={`client-contact-view-${row.display_id}`}>
          <Eye sx={{ fontSize: 16 }} />
        </ActionIcon>
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

// ---------- header-icon: combined email+phone with copyable popover ----------
function CopyableContactIcon({ email, phone, testId }) {
  const [open, setOpen] = useState(false);
  const has = !!(email || phone);
  const tooltipLabel = has ? "Available" : "Not Available";
  const iconBg = has
    ? "bg-green-100 text-green-600 hover:bg-green-200"
    : "bg-gray-100 text-gray-400";

  // If nothing to show, keep the tooltip but no popover.
  if (!has) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${iconBg}`}
            data-testid={testId}
            onClick={(e) => e.stopPropagation()}
          >
            <PhoneCall sx={{ fontSize: 14 }} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="bg-gray-900 text-white">
          {tooltipLabel}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${iconBg}`}
              data-testid={testId}
              onClick={(e) => e.stopPropagation()}
            >
              <PhoneCall sx={{ fontSize: 14 }} />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        {!open && (
          <TooltipContent side="top" className="bg-gray-900 text-white">
            {tooltipLabel}
          </TooltipContent>
        )}
      </Tooltip>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-72 p-2"
        onClick={(e) => e.stopPropagation()}
        data-testid={`${testId}-popover`}
      >
        <div className="space-y-1">
          {phone && (
            <CopyRow
              icon={<Phone sx={{ fontSize: 16 }} />}
              value={phone}
              hoverLabel="Copy mobile number"
              successLabel="Mobile number copied"
              testId={`${testId}-copy-phone`}
            />
          )}
          {email && (
            <CopyRow
              icon={<Mail sx={{ fontSize: 16 }} />}
              value={email}
              hoverLabel="Copy email address"
              successLabel="Email copied"
              testId={`${testId}-copy-email`}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CopyRow({ icon, value, hoverLabel, successLabel, testId }) {
  const [copied, setCopied] = useState(false);
  const doCopy = async (e) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // Fallback for older browsers / non-secure origins.
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      notify.success(successLabel);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) {
      notify.error("Could not copy to clipboard");
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={doCopy}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-gray-800 hover:bg-gray-50 transition-colors text-left"
          data-testid={testId}
        >
          <span className="w-7 h-7 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0">
            {icon}
          </span>
          <span className="font-medium truncate flex-1 min-w-0">{value}</span>
          {copied && (
            <span className="text-[10px] font-semibold text-green-600 uppercase tracking-wider flex-shrink-0">Copied</span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="bg-gray-900 text-white">
        {hoverLabel}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------- header-icon: LinkedIn (blue when available, grey when not) ----------
function LinkedInIconBtn({ url, testId }) {
  const has = !!url;
  const bg = has
    ? "bg-[#0a66c2] text-white hover:bg-[#084d94]"
    : "bg-gray-200 text-white cursor-not-allowed";
  const handleClick = (e) => {
    e.stopPropagation();
    if (has) window.open(url, "_blank", "noopener,noreferrer");
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          disabled={!has}
          className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${bg}`}
          data-testid={testId}
        >
          <LinkedIn sx={{ fontSize: 14 }} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="bg-gray-900 text-white">
        {has ? "Click to Open" : "Not Available"}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------- header-icon: firm brand logo pill ----------
// Small text-based "logo" styled with each consulting firm's brand colours.
// Renders nothing if the firm has no mapping (falls back gracefully so
// unmapped clients don't break the card layout).
const FIRM_BRAND = {
  "McKinsey":                 { text: "McK",   bg: "#003A70", fg: "#FFFFFF" }, // MBB navy
  "Boston Consulting Group":  { text: "BCG",   bg: "#00532F", fg: "#FFFFFF" }, // BCG green
  "A T Kearney":              { text: "K",     bg: "#00A9E0", fg: "#FFFFFF" }, // Kearney blue
  "Alvarez & Marsal":         { text: "A&M",   bg: "#00263A", fg: "#F0B323" }, // A&M navy + gold
  "PwC":                      { text: "pwc",   bg: "#D04A02", fg: "#FFFFFF" }, // PwC orange
  "EY":                       { text: "EY",    bg: "#2E2E38", fg: "#FFE600" }, // EY charcoal + yellow
  "Infollion Research":       { text: "IR",    bg: "#ec9324", fg: "#FFFFFF" }, // Infollion orange
};

function FirmLogo({ name }) {
  const brand = FIRM_BRAND[name];
  if (!brand) return null;
  const wide = brand.text.length > 2; // slightly wider pill for BCG / A&M / pwc
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center justify-center rounded-md flex-shrink-0 shadow-sm select-none ${
            wide ? "px-1.5 h-5 text-[9px]" : "w-5 h-5 text-[10px]"
          } font-bold tracking-tight leading-none`}
          style={{ backgroundColor: brand.bg, color: brand.fg }}
          data-testid={`firm-logo-${(name || "").replace(/\s+/g, "-").toLowerCase()}`}
          aria-label={name}
        >
          {brand.text}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="bg-gray-900 text-white">
        {name}
      </TooltipContent>
    </Tooltip>
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

function MetricMini({ value, label }) {
  // Single orange accent for all four metrics (per spec — no rainbow).
  return (
    <div>
      <div className="text-base font-bold text-[#ec9324]">{value}</div>
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
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <ISDPicker
                  value={form.phone_isd || DEFAULT_ISD}
                  onChange={(dial) => patch("phone_isd", dial)}
                  testId="cc-phone-isd"
                />
                <Input
                  value={form.phone}
                  onChange={(e) => patch("phone", e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="Mobile number"
                  inputMode="numeric"
                  data-testid="cc-phone"
                />
              </div>
            </Field>
            <Field label="Client Name (Level 1)">
              <SearchSelect
                options={l1Options}
                value={form.client_name || ""}
                onChange={(v) => patch("client_name", v || "")}
                placeholder="Select client…"
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
            <SearchSelect
              multiple
              options={l2Options}
              value={form.industries || []}
              onChange={(v) => patch("industries", v)}
              placeholder={
                form.client_name
                  ? "Select one or more industries…"
                  : "Choose a Client Name first"
              }
              testId="cc-industries"
              disabled={!form.client_name}
            />
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
  const [activityFilter, setActivityFilter] = useState(getLast12MonthsRange());

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
    const { phone_isd, phone } = splitLegacyPhone(row);
    setForm({
      name: row.name || "",
      email: row.email || "",
      phone,
      phone_isd,
      client_name: row.client_name || "",
      designation: row.designation || "",
      base_location: row.base_location || "",
      linkedin_url: row.linkedin_url || "",
      industries: row.industries || [],
      previous_work_experience: row.previous_work_experience || [],
    });
    setDialogOpen(true);
  };
  // Duplicate detection state (mirrors the list-page flow).
  const [dupState, setDupState] = useState(null);

  const onSave = async (opts = {}) => {
    if (!form.name.trim()) { notify.error("Name is required"); return; }
    setSaving(true);
    const forceParam = opts.force ? "?force=true" : "";
    try {
      const r = await api.patch(`/client-contacts/${contactId}${forceParam}`, form);
      setRow(r.data);
      setDupState(null);
      setDialogOpen(false);
      notify.success("Saved");
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (
        e?.response?.status === 409 &&
        detail?.code === "DUPLICATE_CLIENT_CONTACT" &&
        Array.isArray(detail.duplicates)
      ) {
        setDupState({ duplicates: detail.duplicates });
        return;
      }
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
        <div className="px-6 pt-4 pb-8 space-y-4 w-full">          {/* Back link */}
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
                {row.poc_status && (
                  <span title="POC Status is auto-calculated (read-only)">
                    <POCStatusChip status={row.poc_status} size="lg" />
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
                    <Phone sx={{ fontSize: 14 }} /> {row.phone_isd ? `${row.phone_isd} ` : ""}{row.phone}
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

          {/* Total-till-date chips — placeholder counts, wired later when the
              calc pipeline lands. Sits between the name-bar and Industries.  */}
          <TotalTillDateChips totals={row.totals_till_date} />

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

          {/* Placeholder date fields (backend now supplies dummy values on
              seeded rows; falls back to "—" when absent). */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                Last Project Receiving Date
              </div>
              <div className={`text-lg font-semibold mt-1 ${row.last_project_receiving_date ? "text-gray-900" : "text-gray-400"}`}>
                {row.last_project_receiving_date ? fmtDate(row.last_project_receiving_date) : "—"}
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                Last Call Date
              </div>
              <div className={`text-lg font-semibold mt-1 ${row.last_call_date ? "text-gray-900" : "text-gray-400"}`}>
                {row.last_call_date ? fmtDate(row.last_call_date) : "—"}
              </div>
            </div>
          </div>

          {/* Activity Summary */}
          <ActivitySummary
            filter={activityFilter}
            onFilterChange={setActivityFilter}
            data={row.activity_by_month}
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
          onOpenChange={(o) => { setDialogOpen(o); if (!o) setDupState(null); }}
          editing={row}
          form={form}
          setForm={setForm}
          l1Options={l1Options}
          l2Options={l2Options}
          onSubmit={onSave}
          saving={saving}
        />

        <DuplicateWarningDialog
          state={dupState}
          onClose={() => setDupState(null)}
          onSaveAnyway={() => onSave({ force: true })}
          saving={saving}
        />
      </Layout>
    </TooltipProvider>
  );
}

// ================================================================ Activity Summary (pivot table)
// Rows:    Projects / Serviced / Calls / Revenue
// Columns: one per month spanned by the DateFilter range, followed by "Total".
// Cells:   0 by default (placeholder until the backend calc pipeline lands).
//          If a real `data` object is passed (shape:
//          { projects: { "YYYY-MM": n, … }, serviced: {…}, calls: {…}, revenue: {…} })
//          those numbers replace the zeros — missing months are still shown as 0.
function ActivitySummary({ filter, onFilterChange, data = null }) {
  const [refreshing, setRefreshing] = useState(false);
  const months = useMemo(() => monthsInRange(filter), [filter]);

  useEffect(() => {
    setRefreshing(true);
    const t = setTimeout(() => setRefreshing(false), 350);
    return () => clearTimeout(t);
  }, [filter?.field, filter?.mode, filter?.from, filter?.to]);

  const ROWS = [
    { key: "projects", label: "Projects", accent: "orange" },
    { key: "serviced", label: "Serviced", accent: "orange" },
    { key: "calls",    label: "Calls",    accent: "orange" },
    { key: "revenue",  label: "Revenue",  accent: "orange", isMoney: true },
  ];

  const getCell = (rowKey, monthKey) => {
    // Placeholder pipeline: `data` will populate real numbers later.
    const v = data && data[rowKey] ? data[rowKey][monthKey] : 0;
    return Number.isFinite(v) ? v : 0;
  };

  const rowTotal = (rowKey) =>
    months.reduce((sum, m) => sum + getCell(rowKey, m.key), 0);

  const fmtCell = (v, isMoney) => {
    if (!v) return isMoney ? "$0" : "0";
    if (isMoney) {
      // Abbreviate large revenue numbers so the pivot cells don't blow up.
      if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
      if (Math.abs(v) >= 10_000)    return `$${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
      return `$${v.toLocaleString()}`;
    }
    return v.toLocaleString();
  };

  const accentTextCls = {
    orange: "text-[#ec9324]",
    emerald: "text-emerald-700",
    blue: "text-blue-700",
    purple: "text-purple-700",
  };
  const accentDotCls = {
    orange: "bg-[#ec9324]",
    emerald: "bg-emerald-500",
    blue: "bg-blue-500",
    purple: "bg-purple-500",
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            Activity Summary
          </div>
          <div className="text-sm text-gray-800 font-semibold">
            {months.length > 0
              ? `${months.length} month${months.length === 1 ? "" : "s"} · ${months[0].label} → ${months[months.length - 1].label}`
              : "Last 12 Months (default)"}
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

      <div
        className={`border border-gray-200 rounded-lg overflow-hidden transition-opacity ${refreshing ? "opacity-40" : "opacity-100"}`}
        data-testid="cc-activity-pivot"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="sticky left-0 bg-gray-50 z-10 px-4 py-2.5 text-left text-[10px] font-bold text-gray-600 uppercase tracking-wider border-r border-gray-200 min-w-[140px]">
                  Metric
                </th>
                {months.map((m) => (
                  <th
                    key={m.key}
                    className="px-3 py-2.5 text-right text-[10px] font-bold text-gray-600 uppercase tracking-wider min-w-[70px] whitespace-nowrap"
                  >
                    {m.label}
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right text-[10px] font-bold text-[#ec9324] uppercase tracking-wider bg-[#ec9324]/5 border-l border-[#ec9324]/20 min-w-[90px] whitespace-nowrap">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r, idx) => {
                const total = rowTotal(r.key);
                return (
                  <tr
                    key={r.key}
                    className={`${idx % 2 === 1 ? "bg-gray-50/40" : ""} border-b border-gray-100 last:border-b-0`}
                    data-testid={`cc-activity-row-${r.key}`}
                  >
                    <td className={`sticky left-0 ${idx % 2 === 1 ? "bg-gray-50/40" : "bg-white"} z-10 px-4 py-2.5 font-semibold ${accentTextCls[r.accent] || "text-gray-800"} border-r border-gray-200`}>
                      <span className="flex items-center gap-2">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${accentDotCls[r.accent]}`} />
                        {r.label}
                      </span>
                    </td>
                    {months.map((m) => {
                      const v = getCell(r.key, m.key);
                      const zero = !v;
                      return (
                        <td
                          key={m.key}
                          className={`px-3 py-2.5 text-right tabular-nums ${zero ? "text-gray-300" : "text-gray-800 font-medium"}`}
                        >
                          {fmtCell(v, r.isMoney)}
                        </td>
                      );
                    })}
                    <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${accentTextCls[r.accent] || "text-gray-900"} bg-[#ec9324]/5 border-l border-[#ec9324]/20 whitespace-nowrap`}>
                      {fmtCell(total, r.isMoney)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-gray-400 italic flex items-center justify-between flex-wrap gap-2">
        <span>
          Months with no activity show <span className="font-mono">0</span>.
        </span>
        <span className="text-gray-500">Default range: <b className="text-gray-700">Last 12 Months</b></span>
      </div>
    </div>
  );
}

// ================================================================ Total-till-date chips
// Small pill-style summary that sits between the header card and Industries
// section on the detail page. `totals` may be null → falls back to 0 for
// every metric (placeholder until the calc pipeline lands).
function TotalTillDateChips({ totals = null }) {
  const items = [
    { key: "projects", label: "Projects", isMoney: false },
    { key: "serviced", label: "Serviced", isMoney: false },
    { key: "calls",    label: "Calls",    isMoney: false },
    { key: "revenue",  label: "Revenue",  isMoney: true  },
  ];
  const val = (k) => {
    const v = totals?.[k];
    return Number.isFinite(v) ? v : 0;
  };
  const fmt = (v, money) => {
    if (!v) return money ? "$0" : "0";
    if (money) {
      if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
      if (Math.abs(v) >= 10_000)    return `$${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
      return `$${v.toLocaleString()}`;
    }
    return v.toLocaleString();
  };
  // Single orange colour scheme for all four chips (per spec).
  const scheme = "border-[#ec9324]/30 bg-[#ec9324]/5 text-[#ec9324] ring-[#ec9324]/10";
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="cc-total-chips">
      {items.map((i) => (
        <div
          key={i.key}
          className={`rounded-xl border ring-1 ring-inset px-4 py-3 flex items-center justify-between gap-3 shadow-sm ${scheme}`}
          data-testid={`cc-total-chip-${i.key}`}
        >
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-semibold opacity-90">
              {i.label}
            </div>
            <div className="text-[10px] uppercase tracking-wider opacity-60">
              Total till date
            </div>
          </div>
          <div className="text-2xl font-bold tabular-nums">
            {fmt(val(i.key), i.isMoney)}
          </div>
        </div>
      ))}
    </div>
  );
}



// ================================================================ Helpers (bulk upload)
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { document.body.removeChild(a); } catch (_) { /* noop */ }
    URL.revokeObjectURL(url);
  }, 150);
}

function authedFetch(path, opts = {}) {
  const token = localStorage.getItem("access_token") || "";
  return fetch(`${API}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

// ================================================================ Duplicate Warning Dialog
function DuplicateWarningDialog({ state, onClose, onSaveAnyway, saving }) {
  const open = !!state;
  const dups = state?.duplicates || [];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="cc-duplicate-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-800">
            <AlertTriangle sx={{ fontSize: 20 }} className="text-amber-500" />
            Possible duplicate found
          </DialogTitle>
          <DialogDescription>
            {dups.length === 1
              ? "A client contact with the same email or phone already exists in the directory. Please review before saving."
              : `${dups.length} client contacts with the same email or phone already exist in the directory. Please review before saving.`}
          </DialogDescription>
        </DialogHeader>

        <div className="border border-amber-200 bg-amber-50/40 rounded-lg overflow-hidden">
          <div className="bg-amber-100/60 px-3 py-2 text-[11px] font-semibold text-amber-800 uppercase tracking-wide flex items-center justify-between">
            <span>Existing records</span>
            <span className="normal-case text-[10px] text-amber-700 font-medium">Matched on: email / phone</span>
          </div>
          <div className="max-h-60 overflow-y-auto divide-y divide-amber-100">
            {dups.map((d) => (
              <div key={d.id} className="p-3 flex items-start gap-3" data-testid={`cc-dup-row-${d.display_id}`}>
                <div className="w-8 h-8 rounded-md bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                  #{d.display_id}
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-semibold text-gray-900 truncate">
                    {d.name}
                    {d.designation && <span className="text-gray-500 font-normal"> · {d.designation}</span>}
                  </div>
                  <div className="text-[12px] text-gray-600 flex items-center flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
                    {d.email && (
                      <span className={`flex items-center gap-1 ${d.match_on?.includes("email") ? "text-amber-800 font-semibold" : ""}`}>
                        <Mail sx={{ fontSize: 12 }} /> {d.email}
                      </span>
                    )}
                    {d.phone && (
                      <span className={`flex items-center gap-1 ${d.match_on?.includes("phone") ? "text-amber-800 font-semibold" : ""}`}>
                        <Phone sx={{ fontSize: 12 }} /> {d.phone_isd ? `${d.phone_isd} ` : ""}{d.phone}
                      </span>
                    )}
                    {d.client_name && (
                      <span className="flex items-center gap-1 text-gray-500">
                        <Business sx={{ fontSize: 12 }} /> {d.client_name}
                      </span>
                    )}
                  </div>
                  {d.match_on?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {d.match_on.map((m) => (
                        <span key={m} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-800 font-semibold">
                          {m.toUpperCase()} MATCH
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-xs text-gray-500 italic">
          If this is genuinely a different person (same phone shared by two contacts, generic support email, etc.) you can still save it — otherwise cancel and update the existing record instead.
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            onClick={onSaveAnyway}
            disabled={saving}
            className="bg-amber-600 hover:bg-amber-700 text-white"
            data-testid="cc-dup-save-anyway"
          >
            {saving ? "Saving…" : "Save anyway"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================================================================ Bulk Upload Modal
function BulkUploadModal({ open, onClose, onComplete }) {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  const reset = () => { setFile(null); setProgress(0); setResult(null); setUploading(false); };
  const close = () => { reset(); onClose(); };

  const pickFile = (f) => {
    if (!f) return;
    const lower = f.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) {
      notify.error("Only .xlsx or .csv files are supported");
      return;
    }
    setFile(f);
    setResult(null);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    pickFile(f);
  };

  const downloadTemplate = async (fmt = "xlsx") => {
    const busyToken = __busyBridge.start("Downloading template…");
    try {
      const r = await authedFetch(`/client-contacts/sample-template?format=${fmt}`);
      if (!r.ok) {
        let detail = `HTTP ${r.status}`;
        try { const j = await r.json(); if (j?.detail) detail = j.detail; } catch (_) { /* not JSON */ }
        notify.error(`Could not download template: ${detail}`);
        return;
      }
      const blob = await r.blob();
      downloadBlob(blob, `client_contacts_upload_template.${fmt}`);
    } catch (e) {
      notify.error(`Could not download template: ${e?.message || "network error"}`);
    } finally {
      __busyBridge.stop(busyToken);
    }
  };

  const startUpload = () => {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    const busyToken = __busyBridge.start("Uploading client contacts…");
    const xhr = new XMLHttpRequest();
    const token = localStorage.getItem("access_token") || "";
    xhr.open("POST", `${API}/client-contacts/bulk-upload`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    const finish = () => { __busyBridge.stop(busyToken); };
    xhr.onload = () => {
      setUploading(false);
      setProgress(100);
      finish();
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          setResult(data);
          notify.success(`Upload complete — ${data.success} succeeded, ${data.failed} failed`);
          onComplete?.();
        } else {
          notify.error(data?.detail || "Upload failed");
        }
      } catch {
        notify.error("Upload failed");
      }
    };
    xhr.onerror = () => { setUploading(false); finish(); notify.error("Network error during upload"); };
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  };

  const downloadErrorReport = async () => {
    if (!result?.upload_id) return;
    try {
      const r = await authedFetch(`/client-contacts/upload-history/${result.upload_id}/error-report.xlsx`);
      if (!r.ok) { notify.error("Could not download error report"); return; }
      const blob = await r.blob();
      downloadBlob(blob, `cc_error_report_${result.filename || "upload"}.xlsx`);
    } catch (_) { notify.error("Could not download error report"); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-3xl overflow-hidden" data-testid="cc-bulk-upload-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload sx={{ fontSize: 18 }} className="text-[#ec9324]" /> Upload Client Contacts
          </DialogTitle>
          <DialogDescription className="sr-only">Upload client contacts from a CSV or Excel file</DialogDescription>
        </DialogHeader>

        {!result && (
          <div className="space-y-4 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button
                  type="button" variant="outline" onClick={() => downloadTemplate("csv")}
                  className="border-[#ec9324] text-[#ec9324] hover:bg-[#ec9324]/10"
                  data-testid="cc-download-sample-template-csv-btn"
                >
                  <FileDown sx={{ fontSize: 14 }} className="mr-2" /> CSV Template
                </Button>
                <Button
                  type="button" variant="outline" onClick={() => downloadTemplate("xlsx")}
                  className="border-[#ec9324] text-[#ec9324] hover:bg-[#ec9324]/10"
                  data-testid="cc-download-sample-template-btn"
                >
                  <FileSpreadsheet sx={{ fontSize: 14 }} className="mr-2" /> XLSX Template
                </Button>
              </div>
              <span className="text-xs text-gray-500">Max ~500 rows</span>
            </div>

            {/* Example rows — horizontal scroll on tight widths */}
            <div className="border border-gray-200 rounded-lg overflow-hidden min-w-0">
              <div className="bg-gray-50 px-3 py-2 text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                Example rows
              </div>
              <div className="overflow-x-auto min-w-0">
                <table className="text-[11px] min-w-full w-max">
                  <thead className="bg-gray-100 text-gray-700">
                    <tr>
                      {["Name","Email","Phone","Client Name","Designation","Base Location","LinkedIn URL","Industries"].map((h) => (
                        <th key={h} className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="text-gray-700">
                    <tr className="border-t border-gray-100">
                      <td className="px-2 py-1.5 whitespace-nowrap">Priya Sharma</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">priya.sharma@boston-consulting.com</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">+91 9876543210</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">McKinsey</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">Partner</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">Mumbai, IN</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">https://linkedin.com/in/priya-sharma-cxo</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">Financial Services; Insurance</td>
                    </tr>
                    <tr className="border-t border-gray-100">
                      <td className="px-2 py-1.5 whitespace-nowrap">Rahul Menon</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">rahul.menon@acme.com</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">+91 9812345678</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">Infollion Research</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">Vice President — Strategy</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">Bengaluru, IN</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">https://linkedin.com/in/rahul-menon</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">BFSI; Chemicals</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => document.getElementById("cc-bulk-upload-input")?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                dragOver ? "border-[#ec9324] bg-[#ec9324]/5" : "border-gray-300 hover:border-[#ec9324]"
              }`}
              data-testid="cc-upload-dropzone"
            >
              <Upload sx={{ fontSize: 32 }} className="mx-auto text-gray-400 mb-2" />
              <div className="text-sm font-medium text-gray-700">
                {file ? file.name : "Drag & drop your .csv or .xlsx file here"}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {file ? `${(file.size / 1024).toFixed(1)} KB` : "or click to browse"}
              </div>
              <input
                id="cc-bulk-upload-input" type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="hidden" onChange={(e) => pickFile(e.target.files?.[0])}
                data-testid="cc-upload-file-input"
              />
            </div>

            <div className="rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2 text-[11px] text-blue-800 flex items-start gap-2">
              <AlertOctagon sx={{ fontSize: 14 }} className="mt-[1px] text-blue-500" />
              <div>
                Rows sharing an email or phone with an existing contact are rejected so the directory stays clean.
                <b> Client Name</b> must exactly match a Segmentation (Level 1) name. Unknown <b>Industries</b> are dropped and reported per row.
              </div>
            </div>

            {uploading && (
              <div data-testid="cc-upload-progress" className="space-y-1">
                <div className="flex justify-between text-xs text-gray-600">
                  <span>Uploading…</span><span>{progress}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-[#ec9324] transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={uploading}>Cancel</Button>
              <Button
                onClick={startUpload}
                disabled={!file || uploading}
                className="bg-[#ec9324] hover:bg-[#d4811f] text-white"
                data-testid="cc-start-upload-btn"
              >
                {uploading
                  ? (<><Loader2 sx={{ fontSize: 14 }} className="mr-2 animate-spin" />Uploading…</>)
                  : (<><Upload sx={{ fontSize: 14 }} className="mr-2" />Upload</>)}
              </Button>
            </DialogFooter>
          </div>
        )}

        {result && (
          <div className="space-y-4" data-testid="cc-upload-result">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-gray-900" data-testid="cc-upload-total">{result.total}</div>
                <div className="text-xs text-gray-500 uppercase tracking-wider">Total</div>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-700 flex items-center justify-center gap-1" data-testid="cc-upload-success">
                  <CheckCircle2 sx={{ fontSize: 20 }} /> {result.success}
                </div>
                <div className="text-xs text-green-600 uppercase tracking-wider">Success</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-700 flex items-center justify-center gap-1" data-testid="cc-upload-failed">
                  <AlertTriangle sx={{ fontSize: 20 }} /> {result.failed}
                </div>
                <div className="text-xs text-red-600 uppercase tracking-wider">Failed</div>
              </div>
            </div>

            <div className="text-xs text-gray-500">
              Status: <span className="font-medium text-gray-700">{result.status}</span> · File: <span className="font-mono">{result.filename}</span>
            </div>

            {result.failed > 0 && (
              <>
                <div className="border border-red-100 rounded-lg overflow-hidden">
                  <div className="bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 flex items-center justify-between">
                    <span>Error preview ({Math.min(result.errors.length, 10)} of {result.failed})</span>
                    {result.has_more_errors && <span className="text-red-600">Download full report below</span>}
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-600">
                        <tr>
                          <th className="px-2 py-1 text-left">Row</th>
                          <th className="px-2 py-1 text-left">Name</th>
                          <th className="px-2 py-1 text-left">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(result.errors || []).slice(0, 10).map((e, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            <td className="px-2 py-1 text-gray-600 font-mono">{e.row}</td>
                            <td className="px-2 py-1 text-gray-700">{e.name || "—"}</td>
                            <td className="px-2 py-1 text-red-700">{e.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <Button
                  variant="outline" onClick={downloadErrorReport}
                  className="border-red-300 text-red-700 hover:bg-red-50 w-full"
                  data-testid="cc-download-error-report-btn"
                >
                  <FileDown sx={{ fontSize: 14 }} className="mr-2" /> Download Error Report (.xlsx)
                </Button>
              </>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={reset} data-testid="cc-upload-another-btn">Upload Another</Button>
              <Button onClick={close} className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="cc-close-upload-result-btn">Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ================================================================ Upload History Modal
function UploadHistoryModal({ open, onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/client-contacts/upload-history", { params: { page_size: 50 } });
      setItems(r.data.items || []);
      setTotal(r.data.total || 0);
    } catch (e) {
      notify.error("Could not load upload history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open]);

  const downloadErrorReport = async (id, filename) => {
    try {
      const r = await authedFetch(`/client-contacts/upload-history/${id}/error-report.xlsx`);
      if (!r.ok) { notify.error("Could not download error report"); return; }
      const blob = await r.blob();
      downloadBlob(blob, `cc_error_report_${(filename || "upload").replace(/\.(xlsx|csv)$/i, "")}.xlsx`);
    } catch (_) { notify.error("Could not download error report"); }
  };

  const statusPill = (s) => {
    const map = {
      Completed: "bg-green-100 text-green-700 border-green-200",
      Partial: "bg-amber-100 text-amber-700 border-amber-200",
      Failed: "bg-red-100 text-red-700 border-red-200",
      Empty: "bg-gray-100 text-gray-600 border-gray-200",
    };
    return <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${map[s] || map.Empty}`}>{s}</span>;
  };

  const fmtWhen = (iso) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString(undefined, {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    } catch { return iso; }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl" data-testid="cc-upload-history-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History sx={{ fontSize: 18 }} className="text-[#ec9324]" /> Upload History
          </DialogTitle>
          <DialogDescription>
            Past bulk-upload sessions. Click the Report button to download the per-row error report.
          </DialogDescription>
        </DialogHeader>

        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="max-h-[55vh] overflow-y-auto">
            <table className="w-full text-sm" data-testid="cc-upload-history-table">
              <thead className="text-xs text-gray-700 uppercase bg-gray-50 font-bold tracking-wider border-b border-gray-200 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 text-left">File</th>
                  <th className="px-4 py-3 text-left">Uploaded By</th>
                  <th className="px-4 py-3 text-left">When</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Success</th>
                  <th className="px-4 py-3 text-right">Failed</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Errors</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">
                    <Loader2 sx={{ fontSize: 18 }} className="inline animate-spin mr-2" /> Loading…
                  </td></tr>
                )}
                {!loading && items.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">No uploads yet</td></tr>
                )}
                {!loading && items.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50/80" data-testid={`cc-upload-row-${u.id}`}>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700 max-w-[220px] truncate" title={u.filename}>{u.filename}</td>
                    <td className="px-3 py-2 text-gray-700">{u.uploaded_by?.name || "—"}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{fmtWhen(u.uploaded_at)}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{u.total_rows}</td>
                    <td className="px-3 py-2 text-right text-green-700 font-medium">{u.success_count}</td>
                    <td className="px-3 py-2 text-right text-red-700 font-medium">{u.failed_count}</td>
                    <td className="px-3 py-2">{statusPill(u.status)}</td>
                    <td className="px-3 py-2 text-right">
                      {u.failed_count > 0 ? (
                        <Button
                          size="sm" variant="outline"
                          onClick={() => downloadErrorReport(u.id, u.filename)}
                          className="border-red-300 text-red-700 hover:bg-red-50 h-7"
                          data-testid={`cc-download-error-${u.id}`}
                        >
                          <FileDown sx={{ fontSize: 12 }} className="mr-1" /> Report
                        </Button>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="text-xs text-gray-500">{total} upload{total === 1 ? "" : "s"} total</div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
