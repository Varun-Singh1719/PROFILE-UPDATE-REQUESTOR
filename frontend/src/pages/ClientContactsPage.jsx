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
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import useTrackpadSwipeNav from "../hooks/useTrackpadSwipeNav";
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
import IndustryPathPicker from "../components/IndustryPathPicker";
import { COUNTRY_OPTIONS, getRegionByCountryId, getCountryName } from "../data/countries";
import DateFilter from "../components/DateFilter";
import Pagination from "../components/Pagination";
import DeferredSearchInput from "../components/DeferredSearchInput";
import MonthYearPicker from "../components/MonthYearPicker";
import ISDPicker from "../components/ISDPicker";
import { DEFAULT_ISD } from "../lib/isdCodes";
import notify from "../lib/notify";
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as RechartsTooltip, Legend,
} from "recharts";
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
import Public from "@mui/icons-material/PublicOutlined";
import BackArrow from "@mui/icons-material/ArrowBackOutlined";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import Upload from "@mui/icons-material/CloudUploadOutlined";
import FileDown from "@mui/icons-material/DownloadOutlined";
import FileSpreadsheet from "@mui/icons-material/DescriptionOutlined";
import History from "@mui/icons-material/HistoryOutlined";
import LockOutlined from "@mui/icons-material/LockOutlined";
import Loader2 from "@mui/icons-material/Autorenew";
import CheckCircle2 from "@mui/icons-material/CheckCircleOutlineOutlined";
import AlertTriangle from "@mui/icons-material/WarningAmberOutlined";
import AlertOctagon from "@mui/icons-material/ReportGmailerrorredOutlined";
import WorkOutline from "@mui/icons-material/WorkOutlineOutlined";
import Payments from "@mui/icons-material/PaymentsOutlined";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import POCStatusChip from "../components/POCStatusChip";
import EmploymentRelationChip from "../components/EmploymentRelationChip";
import { Textarea } from "../components/ui/textarea";
import NotesIcon from "@mui/icons-material/StickyNote2Outlined";
import LockIcon from "@mui/icons-material/LockOutlined";
import CloseIcon from "@mui/icons-material/Close";

// -------- constants --------
const EMPTY_WORK = {
  company_name: "",
  designation: "",
  start_month_year: "",
  end_month_year: "",
  city: "",
  country_id: null,
  country_name: "",
};
// City text: collapse runs of whitespace + trim (applied on blur / save).
const tidyCity = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const EMPTY_FORM = {
  name: "",
  email: "",
  phone: "",
  phone_isd: DEFAULT_ISD,
  client_name: "",
  designation: "",
  type: "",
  base_location: "",
  city: "",
  country_id: null,
  country_name: "",
  linkedin_url: "",
  industries: [],
  industry_paths: [],   // hierarchical Infollion paths [{ext_ids, names, shorts, label}]
  previous_work_experience: [],
};

// Client-contact "Type" — single-select, three fixed options. When set to
// "Domain Specific" the Industry field becomes mandatory (see validation).
const CONTACT_TYPE_OPTIONS = [
  { value: "Domain Specific", label: "Domain Specific" },
  { value: "Domain Agnostic", label: "Domain Agnostic" },
  { value: "Central Team", label: "Central Team" },
];

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

// Required fields for a client contact (everything EXCEPT Web Handle,
// Industry and Previous Work Experience). Order = validation message order.
const REQUIRED_CC_FIELDS = [
  ["name", "Name"],
  ["designation", "Designation"],
  ["email", "Email"],
  ["phone", "Phone No."],
  ["client_name", "Client Name"],
  ["country_id", "Country"],
];

// Returns the label of the first missing required field, or null when valid.
function firstMissingContactField(form) {
  const miss = REQUIRED_CC_FIELDS.find(([k]) => !String(form[k] || "").trim());
  if (miss) return miss[1];
  // Conditional: "Domain Specific" contacts must have at least one Industry.
  if (form.type === "Domain Specific" && !(form.industries || []).length && !(form.industry_paths || []).length) {
    return "Industry";
  }
  return null;
}

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

// ---- Month-Year parsing helpers (format emitted by MonthYearPicker: "MMM YYYY" | "Present" | "") ----
const MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Returns a Date (1st of the month) for a "MMM YYYY" string, or null.
// "Present" / empty => null (caller treats as "now").
function parseMonthYear(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (s.toLowerCase() === "present") return null;
  const parts = s.split(/\s+/);
  if (parts.length !== 2) return null;
  const mi = MONTH_ABBR.indexOf(parts[0].toLowerCase().slice(0, 3));
  const yr = /^\d{4}$/.test(parts[1]) ? Number(parts[1]) : NaN;
  if (mi < 0 || Number.isNaN(yr)) return null;
  return new Date(yr, mi, 1);
}

// Whole-month count between two dates (end exclusive-ish, min 1 when same month).
function monthsBetween(start, end) {
  if (!start || !end) return 0;
  let m = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return m < 0 ? 0 : m;
}

// "3 yrs 9 mos" | "1 mo" | "1 month+" style duration label.
function fmtDuration(months, plus = false) {
  if (!months || months < 1) return plus ? "1 month+" : "—";
  const y = Math.floor(months / 12);
  const mo = months % 12;
  const bits = [];
  if (y) bits.push(`${y} yr${y > 1 ? "s" : ""}`);
  if (mo) bits.push(`${mo} mo${mo > 1 ? "s" : ""}`);
  return (bits.join(" ") || "—") + (plus ? "+" : "");
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

// Client Name options — the SAME client list used across the whole CRM module
// (Clients tab, Segmentations → "Client Name"): every Client, including the
// ones synced from MySQL, alphabetical. Source: GET /segmentations/client-options.
// `ensure` = a value that must always be present (e.g. the contact's current
// client while editing) so the field is never blank.
function clientNameOptions(clientRows, ensure = "") {
  const opts = (clientRows || [])
    .map((c) => ({ value: c.name, label: c.name }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  const cur = (ensure || "").trim();
  if (cur && !opts.some((o) => o.value.toLowerCase() === cur.toLowerCase())) {
    opts.unshift({ value: cur, label: cur });
  }
  return opts;
}
const fetchClientOptions = () =>
  api.get(`/segmentations/client-options`).then((r) => r.data?.rows || []).catch(() => []);

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

// ============================================================ Reusable modals
// Popup detail view — renders the exact same Client Contact detail body inside a
// dialog (used from the Client → Client Contacts tab, no page redirect).
export function ClientContactDetailModal({ contactId, open, onClose, navItems = null, navIds = null, onNavigate = null, relation = null }) {
  // The dialog body is the scroll container; the swipe listener attaches to it
  // and it is scrolled back to the top when the contact changes.
  const [scrollEl, setScrollEl] = useState(null);
  const swipeNav = useMemo(() => {
    if (typeof onNavigate !== "function") return null;
    // Accept either [{id, name}] (preferred — names feed the peek chips) or bare ids.
    const items = Array.isArray(navItems)
      ? navItems.filter((it) => it && it.id)
      : Array.isArray(navIds) ? navIds.map((id) => ({ id, name: "" })) : null;
    if (!items) return null;
    return { ids: items.map((it) => it.id), items, onNavigate, scrollEl };
  }, [navItems, navIds, onNavigate, scrollEl]);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <DialogContent
        ref={setScrollEl}
        // Fixed height (not max-h) so the pop-up keeps the SAME size on every
        // tab — short / blank tabs (Employment History, Interactions, Notes,
        // Timeline) must not shrink the dialog; content scrolls inside.
        className="w-[96vw] max-w-[1500px] h-[92vh] max-h-[92vh] overflow-y-auto px-4 sm:px-6 pb-4 sm:pb-6 pt-0"
        data-testid="cc-detail-modal"
        hideClose
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Client Contact</DialogTitle>
        </DialogHeader>
        {contactId && (
          <ClientContactDetail contactId={contactId} inModal onClose={onClose} swipeNav={swipeNav} relation={relation} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Self-contained "Add Client Contact" dialog (loads its own segmentation options
// and handles create + duplicate detection). `defaultClientName` pre-fills the
// Client field — used when adding from within a specific Client's page.
export function AddContactDialog({ open, onClose, defaultClientName = "", onSaved }) {
  const [segments, setSegments] = useState([]);
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState({ ...EMPTY_FORM, previous_work_experience: [] });
  const [saving, setSaving] = useState(false);
  const [dupState, setDupState] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY_FORM, previous_work_experience: [], client_name: defaultClientName || "" });
    setDupState(null);
    api.get(`/segmentations`).then((r) => setSegments(r.data.rows || [])).catch(() => {});
    fetchClientOptions().then(setClients);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultClientName]);

  const l1Options = useMemo(
    () => clientNameOptions(clients, defaultClientName),
    [clients, defaultClientName]
  );
  const l2Options = useMemo(() => levelTwoOptions(segments, form.client_name), [segments, form.client_name]);

  const onSave = async (opts = {}) => {
    const missing = firstMissingContactField(form);
    if (missing) { notify.error(`${missing} is required`); return; }
    setSaving(true);
    const forceParam = opts.force ? "?force=true" : "";
    try {
      const payload = { ...form };
      payload.base_location = [payload.city, payload.country_name].filter(Boolean).join(", ");
      await api.post(`/client-contacts${forceParam}`, payload);
      notify.success("Client contact created");
      setDupState(null);
      onClose?.();
      onSaved?.();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (e?.response?.status === 409 && detail?.code === "DUPLICATE_CLIENT_CONTACT" && Array.isArray(detail.duplicates)) {
        setDupState({ duplicates: detail.duplicates });
        return;
      }
      notify.error(formatApiError(e, "Failed to save client contact"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ContactFormDialog
        open={open}
        onOpenChange={(o) => { if (!o) { setDupState(null); onClose?.(); } }}
        editing={null}
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
    </>
  );
}

// ================================================================ LIST
function ClientContactsList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [segments, setSegments] = useState([]);
  const [clients, setClients] = useState([]);   // Client Name options (all Clients)
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState(""); // Client Name chip
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

  // Manual "Sync from MySQL" (runs in background on the server)
  const [syncing, setSyncing] = useState(false);
  const handleSyncFromMysql = async () => {
    setSyncing(true);
    try {
      await api.post(`/crm-sync/run?scope=contacts`);
      notify.success("Sync started — new records & metrics will refresh in a few minutes.");
    } catch (e) {
      notify.error(formatApiError(e, "Failed to start sync"));
    } finally {
      setSyncing(false);
    }
  };

  // Client Name list = every Client (incl. MySQL-synced); while editing, the
  // contact's current client is always included so the field is never blank.
  const l1Options = useMemo(
    () => clientNameOptions(clients, form.client_name),
    [clients, form.client_name]
  );
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
      const [contactsRes, segRes, clientRows] = await Promise.all([
        api.get(`/client-contacts?${params.toString()}`),
        api.get(`/segmentations`),
        fetchClientOptions(),
      ]);
      setRows(contactsRes.data.rows || []);
      setTotal(contactsRes.data.total || 0);
      setSegments(segRes.data.rows || []);
      setClients(clientRows);
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
      type: row.type || "",
      city: (row.city != null || row.country_id != null) ? (row.city || "") : (row.base_location || ""),
      country_id: row.country_id ?? null,
      country_name: row.country_name || (row.country_id != null ? getCountryName(row.country_id) : ""),
      base_location: row.base_location || "",
      linkedin_url: row.linkedin_url || "",
      industries: row.industries || [],
      industry_paths: row.industry_paths || [],
      previous_work_experience: row.previous_work_experience || [],
    });
    setDialogOpen(true);
  };

  const onSave = async (opts = {}) => {
    const missing = firstMissingContactField(form);
    if (missing) {
      notify.error(`${missing} is required`);
      return;
    }
    setSaving(true);
    const forceParam = opts.force ? "?force=true" : "";
    try {
      const payload = { ...form };
      // Keep the legacy `base_location` in sync (City, Country) so list/card
      // displays and exports that still read it continue to work.
      payload.base_location = [payload.city, payload.country_name].filter(Boolean).join(", ");
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
            {/* Sync / Upload History / Upload Contacts → icon-only buttons with the
                exact UI/UX of the Edit (pencil) icon on the Client card view
                (grey → orange + light-orange bg on hover, full name as tooltip). */}
            <CardStyleIconButton
              icon={<Loader2 sx={{ fontSize: 16 }} className={syncing ? "animate-spin" : ""} />}
              tooltip={syncing ? "Syncing…" : "Sync"}
              onClick={handleSyncFromMysql}
              disabled={syncing}
              testId="cc-sync-btn"
            />
            <CardStyleIconButton
              icon={<History sx={{ fontSize: 16 }} />}
              tooltip="Upload History"
              onClick={() => setHistoryOpen(true)}
              testId="cc-upload-history-btn"
            />
            <CardStyleIconButton
              icon={<Upload sx={{ fontSize: 16 }} />}
              tooltip="Upload Contacts"
              onClick={() => setBulkOpen(true)}
              testId="cc-open-bulk-upload-btn"
            />
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
function ContactCard({ row, onView }) {
  const initials = (row.name || "?").trim().split(/\s+/)
    .map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  const fullPhone = (() => {
    if (!row.phone) return "";
    if (row.phone_isd) return `${row.phone_isd} ${row.phone}`.trim();
    return String(row.phone).trim();
  })();
  const location = [row.city, row.country_name].filter(Boolean).join(", ") || row.base_location || "";

  return (
    <div
      className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-[#ec9324]/40 transition-all p-4 flex flex-col"
      data-testid={`client-contact-card-${row.display_id}`}
    >
      {/* Header — initials, name, LinkedIn + contact icons; Status pill top-right */}
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
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
                  e.preventDefault();
                  onView();
                }}
                className="text-[15px] font-bold text-gray-900 truncate leading-tight cursor-pointer hover:text-[#ec9324] min-w-0 no-underline"
                data-testid={`client-contact-name-${row.display_id}`}
              >
                {row.name}
              </a>
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
            <div className="text-[11px] text-gray-500 mt-0.5">
              ID: <span className="font-mono text-gray-700">{row.display_id}</span>
            </div>
          </div>
        </div>
        {/* Status pill — top-right corner, parallel to name */}
        {row.poc_status && (
          <div className="flex-shrink-0">
            <POCStatusChip status={row.poc_status} />
          </div>
        )}
      </div>

      {/* Info meta table */}
      <div className="mt-3 text-[12px] text-gray-700 space-y-1">
        <MetaRow label="Client Name" value={row.client_name} />
        <MetaRow label="Type" value={row.type || "—"} />
        {/* Designation + Location parallel; long designation wraps to a new
            line while Location keeps its place on the right. */}
        <div className="flex items-start gap-2">
          <span className="text-gray-500 shrink-0 w-24">Designation:</span>
          <span className="font-medium text-gray-900 flex-1 min-w-0 break-words">{row.designation || "—"}</span>
          {location && (
            <span className="text-gray-600 flex items-start gap-1 shrink-0 max-w-[46%] text-right leading-tight" data-testid={`client-contact-location-${row.display_id}`}>
              <Place sx={{ fontSize: 13 }} className="mt-[1px] shrink-0" />
              <span className="break-words">{location}</span>
            </span>
          )}
        </div>
      </div>

      {/* Metrics row — all in orange (single accent). Reads totals_till_date
          when the backend supplies it; falls back to "—" otherwise. */}
      <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-4 gap-1 text-center">
        <MetricMini value={fmtMetric(row.totals_till_date?.projects)}                  label="Projects" />
        <MetricMini value={fmtMetric(row.totals_till_date?.serviced)}                  label="Serviced" />
        <MetricMini value={fmtMetric(row.totals_till_date?.calls)}                     label="Calls" />
        <MetricMini value={fmtMetric(row.totals_till_date?.revenue, { money: true })}  label="Revenue" />
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
  l1Options, onSubmit, saving,
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

  // Industries are hierarchical paths through the Infollion Research
  // segmentation (independent of the chosen Client). Legacy free-text
  // industries (saved before the hierarchy existed) are shown as removable
  // "legacy" chips; they are dropped only when the user removes them.
  const pathLabels = new Set((form.industry_paths || []).map((p) => p.label));
  const legacyIndustries = (form.industries || []).filter((i) => !pathLabels.has(i));

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

        <div className="space-y-5 pt-2">
          {/* Primary fields */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-5">
            <Field label="Name *">
              <Input
                value={form.name}
                onChange={(e) => patch("name", e.target.value)}
                placeholder="Full name"
                data-testid="cc-name"
              />
            </Field>
            <Field label="Designation *">
              <Input
                value={form.designation}
                onChange={(e) => patch("designation", e.target.value)}
                placeholder="e.g. Partner, Director"
              />
            </Field>
            <Field label="Email *">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => patch("email", e.target.value)}
              />
            </Field>
            <Field label="Phone No. *">
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
            <Field label="Client Name *">
              <SearchSelect
                options={l1Options}
                value={form.client_name || ""}
                onChange={(v) => patch("client_name", v || "")}
                placeholder="Select client…"
                testId="cc-client-name"
              />
            </Field>
            <Field label="City">
              <Input
                value={form.city}
                onChange={(e) => patch("city", e.target.value)}
                data-testid="cc-city"
              />
            </Field>
            <Field label="Country *">
              <SearchSelect
                options={COUNTRY_OPTIONS}
                value={form.country_id}
                onChange={(v) => {
                  patch("country_id", v);
                  patch("country_name", v != null ? getCountryName(v) : "");
                }}
                placeholder="Select country…"
                testId="cc-country"
              />
            </Field>
            <Field label="Type">
              <SearchSelect
                options={CONTACT_TYPE_OPTIONS}
                value={form.type || ""}
                onChange={(v) => patch("type", v || "")}
                placeholder="Select type…"
                testId="cc-type"
              />
            </Field>
          </div>

          {/* Web handle */}
          <Field label="Web Handle">
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
          </Field>

          {/* Industries — hierarchical Infollion Segmentation paths
              (Level 0 → 1 → 2 → 3), multiple paths as chips. REQUIRED when
              Type is "Domain Specific". */}
          <div>
            <IndustryPathPicker
              value={form.industry_paths || []}
              onChange={(paths) => {
                // `industries` keeps ONLY legacy strings from here on — the
                // server derives the path labels itself.
                setForm((f) => ({ ...f, industry_paths: paths, industries: legacyIndustries }));
              }}
              legacy={legacyIndustries}
              onLegacyChange={(kept) => patch("industries", kept)}
              required={form.type === "Domain Specific"}
              testId="cc-industry"
            />
            {form.type === "Domain Specific" && (form.industry_paths || []).length === 0 && legacyIndustries.length === 0 && (
              <div className="mt-1 text-[11px] text-red-500">
                {'Industry is required for "Domain Specific" contacts.'}
              </div>
            )}
          </div>

          {/* Previous work experience — repeatable. ADD form only: for an
              existing contact past roles are managed from the detail page's
              Employment History tab, so the Edit form does not repeat them. */}
          {!editing && (
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
                  <div className="grid grid-cols-2 gap-x-2 gap-y-4">
                    <Field label="Company Name" labelBg="bg-gray-50">
                      <Input
                        value={w.company_name || ""}
                        onChange={(e) => setWork(i, "company_name", e.target.value)}
                        data-testid={`cc-work-${i}-company`}
                      />
                    </Field>
                    <Field label="Designation" labelBg="bg-gray-50">
                      <Input
                        value={w.designation || ""}
                        onChange={(e) => setWork(i, "designation", e.target.value)}
                      />
                    </Field>
                    <Field label="Start Date" labelBg="bg-gray-50">
                      <MonthYearPicker
                        value={w.start_month_year || ""}
                        onChange={(v) => setWork(i, "start_month_year", v)}
                        testId={`cc-work-${i}-start`}
                      />
                    </Field>
                    <Field label="End Date" labelBg="bg-gray-50">
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
                    <Field label="City" labelBg="bg-gray-50">
                      <Input
                        value={w.city || ""}
                        onChange={(e) => setWork(i, "city", e.target.value)}
                        onBlur={(e) => setWork(i, "city", tidyCity(e.target.value))}
                        placeholder="e.g. Mumbai"
                        data-testid={`cc-work-${i}-city`}
                      />
                    </Field>
                    <Field label="Country" labelBg="bg-gray-50">
                      <SearchSelect
                        options={COUNTRY_OPTIONS}
                        value={w.country_id ?? null}
                        onChange={(v) => {
                          setWork(i, "country_id", v);
                          setWork(i, "country_name", v != null ? getCountryName(v) : "");
                        }}
                        placeholder="Select country…"
                        testId={`cc-work-${i}-country`}
                      />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}
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

// HoverTip — dark hover tooltip matching CRM → Client Detail → POC Status
// Configuration (group-hover reveal, gray-900 bubble). `side` = top | bottom.
function HoverTip({ label, children, side = "top", align = "center", className = "" }) {
  const vert = side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5";
  const horiz =
    align === "start" ? "left-0"
    : align === "end" ? "right-0"
    : "left-1/2 -translate-x-1/2";
  return (
    <span className={`group relative inline-flex items-center ${className}`}>
      {children}
      <span
        className={`pointer-events-none absolute ${vert} ${horiz} px-2 py-1 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg`}
      >
        {label}
      </span>
    </span>
  );
}

function Field({ label, labelBg = "bg-white", children }) {
  return (
    <div className="relative">
      {label != null && label !== "" && (
        <label
          className={`absolute -top-2 left-3 px-1.5 ${labelBg} text-[11px] font-medium text-gray-500 leading-none z-10 pointer-events-none`}
        >
          {label}
        </label>
      )}
      {children}
    </div>
  );
}

// ================================================================ DETAIL
function ClientContactDetail({ contactId, inModal = false, onClose, swipeNav = null, relation = null }) {
  const navigate = useNavigate();
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [segments, setSegments] = useState([]);
  const [clients, setClients] = useState([]);   // Client Name options (all Clients)

  // Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Activity summary DateFilter (default = last 6 months, Between mode)
  const [activityFilter, setActivityFilter] = useState(getLast12MonthsRange());

  // Detail-view tabs. Only "overview" has content; the rest are blank pages.
  const [activeTab, setActiveTab] = useState("overview");

  // Per-contact "Sync from MySQL" — refreshes this contact's activity metrics.
  const [syncingOne, setSyncingOne] = useState(false);
  const handleSyncOne = async () => {
    setSyncingOne(true);
    try {
      const r = await api.post(`/client-contacts/${contactId}/sync`);
      setRow(r.data);
      notify.success("Synced from MySQL");
    } catch (e) {
      notify.error(formatApiError(e, "Sync failed"));
    } finally {
      setSyncingOne(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [c, s, clientRows] = await Promise.all([
        api.get(`/client-contacts/${contactId}`),
        api.get(`/segmentations`),
        fetchClientOptions(),
      ]);
      setRow(c.data);
      setSegments(s.data.rows || []);
      setClients(clientRows);
    } catch (e) {
      notify.error(formatApiError(e, "Failed to load"));
    } finally {
      setLoading(false);
    }
  };
  // Skip the network round-trip when the row was already prefetched by a
  // trackpad swipe (see goToNeighbour) — avoids the "Loading…" flicker.
  const prefetchedRef = useRef(null);
  useEffect(() => {
    const pre = prefetchedRef.current;
    if (pre && pre.id === contactId) {
      prefetchedRef.current = null;
      return;
    }
    load();
    /* eslint-disable-next-line */
  }, [contactId]);

  // ------------------------------------------------------------------
  // Trackpad swipe navigation between contacts — POP-UP detail view opened
  // from CRM → Client → Client Contacts tab. The parent passes `swipeNav`:
  //   { ids: string[] (order of the list the user is looking at),
  //     onNavigate(id), scrollEl (the dialog's scroll container) }
  // Swipe left → next, swipe right → previous. No wrap-around.
  // ------------------------------------------------------------------
  const navIds = Array.isArray(swipeNav?.ids) ? swipeNav.ids : null;
  const busyRef = useRef(false);
  const [slide, setSlide] = useState({ phase: "idle", dir: "next" });
  const [hint, setHint] = useState(null); // { kind: 'intro'|'moved'|'edge', dir? }
  const hintTimerRef = useRef(null);

  // The id we are *showing* (row.id flips in the same render as the slide).
  const curId = row?.id || contactId;
  const swipeEnabled = !!navIds && navIds.length > 0 && navIds.includes(curId) && typeof swipeNav?.onNavigate === "function";
  const navIdx = swipeEnabled ? navIds.indexOf(curId) : -1;
  const navPos = swipeEnabled ? navIdx + 1 : 0;
  const navTotal = swipeEnabled ? navIds.length : 0;
  // Neighbouring contacts (for the faint "peek" chips at the pop-up edges).
  const navItems = Array.isArray(swipeNav?.items) ? swipeNav.items : null;
  const prevItem = swipeEnabled && navIdx > 0 ? (navItems ? navItems[navIdx - 1] : { id: navIds[navIdx - 1], name: "" }) : null;
  const nextItem = swipeEnabled && navIdx < navIds.length - 1 ? (navItems ? navItems[navIdx + 1] : { id: navIds[navIdx + 1], name: "" }) : null;

  const showHint = useCallback((kind, dir, ms) => {
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    setHint({ kind, dir });
    hintTimerRef.current = setTimeout(() => setHint(null), ms);
  }, []);

  // Discoverability cue: show once when the pop-up opens with swipe context.
  useEffect(() => {
    if (!swipeEnabled) return undefined;
    const t = setTimeout(() => showHint("intro", null, 4200), 400);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, []);
  useEffect(() => () => { if (hintTimerRef.current) clearTimeout(hintTimerRef.current); }, []);

  // Stop macOS/Chrome from turning a horizontal swipe into history back/forward.
  useEffect(() => {
    if (!swipeEnabled) return undefined;
    const html = document.documentElement;
    const body = document.body;
    const prev = [html.style.overscrollBehaviorX, body.style.overscrollBehaviorX];
    html.style.overscrollBehaviorX = "none";
    body.style.overscrollBehaviorX = "none";
    return () => {
      html.style.overscrollBehaviorX = prev[0];
      body.style.overscrollBehaviorX = prev[1];
    };
  }, [swipeEnabled]);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Prefetch the immediate neighbours (prev / next) as soon as a profile is
  // shown so a swipe / arrow key feels instant even on a slow DB round-trip.
  // Entries are consumed (deleted) when used so a later revisit re-fetches
  // fresh data (e.g. after an edit).
  const neighbourCacheRef = useRef(new Map());
  useEffect(() => {
    if (!swipeEnabled) return undefined;
    const cache = neighbourCacheRef.current;
    cache.delete(curId);
    [prevItem?.id, nextItem?.id].filter(Boolean).forEach((id) => {
      if (cache.has(id)) return;
      cache.set(id, api.get(`/client-contacts/${id}`, { silent: true })
        .then((r) => r.data)
        .catch(() => null)
        .then((d) => { if (!d) cache.delete(id); return d; }));
    });
    return undefined;
    /* eslint-disable-next-line */
  }, [swipeEnabled, curId]);

  const goToNeighbour = useCallback(async (dir) => {
    if (busyRef.current || !swipeEnabled) return;
    busyRef.current = true;
    try {
      const i = navIds.indexOf(curId);
      const targetId = dir === "next" ? navIds[i + 1] : navIds[i - 1];
      if (!targetId) {
        // Boundary: subtle bump, no wrap-around.
        setSlide({ phase: "bump", dir });
        showHint("edge", dir, 1600);
        await sleep(160);
        setSlide({ phase: "idle", dir });
        return;
      }
      // 1) slide the current profile out while the next one loads (silently —
      //    no global "Loading…" overlay, no flicker)
      setSlide({ phase: "out", dir });
      const fetchTarget = async () => {
        const cache = neighbourCacheRef.current;
        const pending = cache.get(targetId);
        if (pending) {
          cache.delete(targetId);
          const d = await pending;
          if (d) return d;
        }
        return api.get(`/client-contacts/${targetId}`, { silent: true }).then((r) => r.data).catch(() => null);
      };
      const [data] = await Promise.all([fetchTarget(), sleep(220)]);
      if (!data) {
        notify.error("Could not load the next client contact");
        setSlide({ phase: "idle", dir });
        return;
      }
      // 2) swap content while invisible, reposition on the opposite side,
      //    scroll the pop-up back to the top
      const scroller = swipeNav?.scrollEl || null;
      if (scroller && typeof scroller.scrollTo === "function") scroller.scrollTo({ top: 0, left: 0, behavior: "auto" });
      prefetchedRef.current = { id: targetId, data };
      setRow(data);
      setSlide({ phase: "enter", dir });
      swipeNav.onNavigate(targetId);
      // 3) slide the new profile in
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      setSlide({ phase: "in", dir });
      showHint("moved", dir, 1800);
      await sleep(260);
      setSlide({ phase: "idle", dir });
    } finally {
      busyRef.current = false;
    }
    /* eslint-disable-next-line */
  }, [swipeEnabled, curId, navIds, swipeNav, showHint]);

  const SLIDE_PX = 56;
  const slideStyle = (() => {
    const sign = slide.dir === "next" ? -1 : 1; // next → content exits to the left
    switch (slide.phase) {
      case "out":
        return { transform: `translateX(${sign * SLIDE_PX}px)`, opacity: 0, transition: "transform 220ms ease-in, opacity 200ms ease-in" };
      case "enter":
        return { transform: `translateX(${-sign * SLIDE_PX}px)`, opacity: 0, transition: "none" };
      case "in":
        return { transform: "translateX(0)", opacity: 1, transition: "transform 260ms cubic-bezier(.22,.61,.36,1), opacity 220ms ease-out" };
      case "bump":
        return { transform: `translateX(${sign * 14}px)`, opacity: 1, transition: "transform 140ms ease-out" };
      default:
        return { transform: "translateX(0)", opacity: 1, transition: "transform 160ms ease-out, opacity 160ms ease-out" };
    }
  })();

  const l1Options = useMemo(
    () => clientNameOptions(clients, form.client_name),
    [clients, form.client_name]
  );
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
      type: row.type || "",
      city: (row.city != null || row.country_id != null) ? (row.city || "") : (row.base_location || ""),
      country_id: row.country_id ?? null,
      country_name: row.country_name || (row.country_id != null ? getCountryName(row.country_id) : ""),
      base_location: row.base_location || "",
      linkedin_url: row.linkedin_url || "",
      industries: row.industries || [],
      industry_paths: row.industry_paths || [],
      previous_work_experience: row.previous_work_experience || [],
    });
    setDialogOpen(true);
  };
  // Duplicate detection state (mirrors the list-page flow).
  const [dupState, setDupState] = useState(null);

  useTrackpadSwipeNav({
    enabled: swipeEnabled && !dialogOpen && !dupState,
    onSwipe: goToNeighbour,
    isBusy: () => busyRef.current,
    threshold: 70,
    idleMs: 350,
    // Listen on the pop-up's own scroll container (falls back to document).
    target: swipeNav?.scrollEl || null,
  });

  // Keyboard: ← previous / → next — same behaviour as the swipe. Ignored while
  // typing in a field, while the Edit form (another dialog) is open, or with
  // modifier keys held (so browser/OS shortcuts keep working).
  const keysEnabled = swipeEnabled && !dialogOpen && !dupState;
  useEffect(() => {
    if (!keysEnabled) return undefined;
    const ownDialog = swipeNav?.scrollEl?.closest?.("[role='dialog']") || null;
    const onKey = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.defaultPrevented || e.repeat) return;
      const t = e.target;
      if (t && typeof t.closest === "function") {
        if (t.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='combobox'], [role='listbox']")) return;
        const dlg = t.closest("[role='dialog']");
        if (dlg && ownDialog && dlg !== ownDialog) return;
      }
      e.preventDefault();
      goToNeighbour(e.key === "ArrowRight" ? "next" : "prev");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [keysEnabled, goToNeighbour, swipeNav]);

  const onSave = async (opts = {}) => {
    const missing = firstMissingContactField(form);
    if (missing) { notify.error(`${missing} is required`); return; }
    setSaving(true);
    const forceParam = opts.force ? "?force=true" : "";
    try {
      const payload = { ...form };
      payload.base_location = [payload.city, payload.country_name].filter(Boolean).join(", ");
      const r = await api.patch(`/client-contacts/${contactId}${forceParam}`, payload);
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
    const body = <div className="p-10 text-sm text-gray-500">Loading…</div>;
    return inModal ? body : <Layout title="Client Contact">{body}</Layout>;
  }

  const initials = (row.name || "?").trim().split(/\s+/)
    .map((s) => s[0]).join("").slice(0, 2).toUpperCase();

  // Current / Former chip: explicit `relation` from the opener (Client → Client
  // Contacts card view) wins; otherwise the contact is "Current" with its own
  // client when one is mapped.
  const effectiveRelation = relation || (row.client_name ? "current" : null);

  // NOTE: `Shell` is a stable module-level component (see DetailShell below).
  // Defining it inline here created a NEW component type on every render,
  // which remounted <Layout> (Sidebar / NotificationBell) on each state
  // change and re-fired their API calls + the global "Loading…" overlay.
  const Shell = DetailShell;

  return (
    <TooltipProvider delayDuration={150}>
      <Shell inModal={inModal}>
        <div className={inModal ? "px-1 pb-2 space-y-4 w-full [&>*:first-child]:!mt-0" : "px-6 pt-4 pb-8 space-y-4 w-full"}>
          {/* Back link (full-page view only) */}
          {!inModal && (
            <button
              onClick={() => navigate("/crm/client-contacts")}
              className="text-xs text-gray-500 hover:text-[#ec9324] flex items-center gap-1"
            >
              <BackArrow sx={{ fontSize: 14 }} /> Back to Client Contacts
            </button>
          )}

          {/* Pop-up: faint prev / next "peek" chips pinned to the edges */}
          {swipeEnabled && (
            <PeekNeighbours
              prev={prevItem}
              next={nextItem}
              slide={slide}
              onGo={goToNeighbour}
            />
          )}

          {/* Sliding container — everything below animates when swiping */}
          <div
            className="space-y-4 will-change-transform !mt-0"
            style={slideStyle}
            data-testid="cc-detail-slide"
            data-slide-phase={slide.phase}
          >
          {/* Sticky header (profile card + tabs): stays pinned while the content
              below scrolls. In the pop-up it sticks to the dialog's scroll area;
              on the full page it sits right under the 56px top bar. */}
          <div
            className={`sticky z-20 !mt-0 space-y-4 pb-2 ${inModal ? "top-0 pt-3 sm:pt-4 bg-white" : "top-14 pt-4 bg-background"}`}
            data-testid="cc-detail-sticky-header"
          >
          {/* Pop-up: Close (X) in its original top-right corner of the dialog
              (16px inset). It lives INSIDE the sticky header so it stays pinned
              while the content scrolls. UI/UX identical to the Edit button. */}
          {inModal && (
            <CardStyleIconButton
              icon={<CloseIcon sx={{ fontSize: 16 }} />}
              tooltip="Close"
              onClick={() => onClose?.()}
              testId="cc-detail-close"
              className="absolute -right-3 top-4 z-30"
            />
          )}
          {/* Pop-up: tiny position counter (top-right, next to the dialog close) */}
          {swipeEnabled && (
            <div className="flex justify-end !mt-0 -mb-2 pr-8 h-4">
              <span
                className="text-[11px] text-gray-400 tabular-nums select-none"
                data-testid="cc-swipe-position"
                title="Swipe horizontally on your trackpad to move between contacts"
              >
                {navPos} of {navTotal}
              </span>
            </div>
          )}
          {/* Header card */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-start gap-4 shadow-sm">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#ec9324] to-[#d97706] text-white flex items-center justify-center font-semibold flex-shrink-0 text-lg">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-gray-900">{row.name}</h1>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-500">
                  ID: {row.display_id}
                </span>
              </div>
              <div className="mt-0.5 text-sm text-gray-600">
                {row.designation || "—"}
                {row.client_name ? <span className="text-gray-400"> • </span> : null}
                {row.client_name || ""}
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
                {(row.city || row.country_name || row.base_location) && (
                  <span className="flex items-center gap-1" title="Location">
                    <Place sx={{ fontSize: 14 }} /> {[row.city, row.country_name].filter(Boolean).join(", ") || row.base_location}
                  </span>
                )}
                {/* Geography — auto-derived from Country (never stored) */}
                {getRegionByCountryId(row.country_id) && (
                  <span className="flex items-center gap-1" title="Geography" data-testid="cc-detail-geography">
                    <Public sx={{ fontSize: 14 }} /> {getRegionByCountryId(row.country_id)}
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

            {/* Right column (top → bottom): POC Status chip → Current / Former chip
                → Sync + Edit icon buttons (same UI/UX as the Client card Edit button). */}
            <div className="flex-shrink-0 flex flex-col items-end gap-1.5" data-testid="cc-detail-right-column">
              {row.poc_status && (
                <div data-testid="cc-detail-status">
                  <POCStatusChip status={row.poc_status} />
                </div>
              )}
              {effectiveRelation && (
                <div data-testid="cc-detail-relation">
                  <EmploymentRelationChip relation={effectiveRelation} />
                </div>
              )}
              <div className="flex items-center gap-1 mt-0.5">
                <CardStyleIconButton
                  icon={<Loader2 sx={{ fontSize: 16 }} className={syncingOne ? "animate-spin" : ""} />}
                  tooltip={syncingOne ? "Syncing…" : "Sync"}
                  onClick={handleSyncOne}
                  disabled={syncingOne}
                  testId="cc-detail-sync"
                />
                <CardStyleIconButton
                  icon={<Pencil sx={{ fontSize: 16 }} />}
                  tooltip="Edit"
                  onClick={openEdit}
                  testId="cc-detail-edit"
                />
              </div>
            </div>
          </div>

          {/* Tabs (no overflow scroller — it only produced a stray scrollbar) */}
          <div className="border-b border-gray-200 flex items-center gap-6 flex-wrap">
            {[
              { key: "overview", label: "Overview" },
              { key: "employment", label: "Employment History" },
              { key: "interactions", label: "Interactions" },
              { key: "notes", label: "Notes" },
              { key: "timeline", label: "Timeline" },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                data-testid={`cc-tab-${t.key}`}
                className={`relative py-2.5 whitespace-nowrap text-sm font-medium transition-colors ${
                  activeTab === t.key ? "text-[#ec9324]" : "text-gray-500 hover:text-gray-800"
                }`}
              >
                {t.label}
                {activeTab === t.key && (
                  <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-[#ec9324] rounded-full" />
                )}
              </button>
            ))}
          </div>
          </div>{/* /sticky header */}

          {/* Tab content */}
          {activeTab === "overview" ? (
            <OverviewTab row={row} />
          ) : activeTab === "employment" ? (
            <EmploymentHistoryTab row={row} onSaved={setRow} />
          ) : activeTab === "timeline" ? (
            <TimelineTab row={row} />
          ) : activeTab === "notes" ? (
            <NotesTab row={row} />
          ) : (
            <div data-testid={`cc-tabpanel-${activeTab}`} className="min-h-[240px]" />
          )}
          </div>{/* /sliding container */}

          {/* Unobtrusive swipe cue (auto-hides). Sticky to the bottom of the
              pop-up's scroll area so it stays visible while scrolling. */}
          {swipeEnabled && (
            <SwipeHint hint={hint} pos={navPos} total={navTotal} />
          )}
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
      </Shell>
    </TooltipProvider>
  );
}

// Icon button — EXACT same UI/UX as the Edit (pencil) button on the Client
// card view (ClientsPage): w-7 h-7 rounded-md, gray icon that turns orange with
// a light-orange background on hover, native "title" tooltip.
function CardStyleIconButton({ icon, tooltip, onClick, disabled = false, testId, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      aria-label={tooltip}
      data-testid={testId}
      className={`w-7 h-7 rounded-md flex items-center justify-center text-gray-500 hover:text-[#ec9324] hover:bg-orange-50 transition-colors flex-shrink-0 disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-gray-500 ${className}`}
    >
      {icon}
    </button>
  );
}

// Stable shell for the detail view: full-page → wrapped in <Layout>, modal → bare.
function DetailShell({ inModal, children }) {
  if (inModal) return <>{children}</>;
  return <Layout title="Client Contact">{children}</Layout>;
}

// ================================================================ Peek neighbours
// Faint prev / next contact names pinned to the left / right edges of the
// pop-up (sticky at mid-height so they stay put while the body scrolls).
// They brighten while a swipe in that direction is in flight, and are
// clickable as a mouse fallback.
function PeekChip({ item, side, active, onClick }) {
  if (!item) return null;
  const isLeft = side === "prev";
  const name = (item.name || "").trim() || "Previous";
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${isLeft ? "Previous" : "Next"}: ${name}`}
      data-testid={`cc-peek-${side}`}
      className={`pointer-events-auto absolute top-0 -translate-y-1/2 ${
        isLeft ? "left-0 -translate-x-2 rounded-r-full pl-1.5 pr-3" : "right-0 translate-x-2 rounded-l-full pr-1.5 pl-3"
      } flex items-center gap-1 h-7 max-w-[180px] bg-white/85 backdrop-blur border border-gray-200 shadow-sm text-[11px] font-medium text-gray-500 transition-all duration-200 hover:text-[#ec9324] hover:border-[#ec9324]/50 hover:opacity-100 ${
        active ? "opacity-100 text-[#ec9324] border-[#ec9324]/50" : "opacity-45"
      }`}
    >
      {isLeft && <ChevronLeftIcon sx={{ fontSize: 15 }} />}
      <span className="truncate">{name}</span>
      {!isLeft && <ChevronRightIcon sx={{ fontSize: 15 }} />}
    </button>
  );
}

function PeekNeighbours({ prev, next, slide, onGo }) {
  const moving = slide?.phase === "out" || slide?.phase === "enter" || slide?.phase === "in" || slide?.phase === "bump";
  return (
    <div
      className="sticky top-[45%] z-30 h-0 -mt-4 pointer-events-none"
      data-testid="cc-peek-neighbours"
      aria-hidden="true"
    >
      <div className="relative w-full h-0">
        <PeekChip item={prev} side="prev" active={moving && slide.dir === "prev"} onClick={() => onGo("prev")} />
        <PeekChip item={next} side="next" active={moving && slide.dir === "next"} onClick={() => onGo("next")} />
      </div>
    </div>
  );
}

// ================================================================ Swipe hint
// Small floating pill that tells the user they can swipe horizontally on the
// trackpad to move between contacts. Auto-hides; re-appears briefly after each
// navigation (with the new position) and at the first/last boundary.
function SwipeHint({ hint, pos, total }) {
  const visible = !!hint;
  let body;
  if (hint?.kind === "edge") {
    body = (
      <span className="flex items-center gap-1.5">
        {hint.dir === "prev" ? <ChevronLeftIcon sx={{ fontSize: 15 }} /> : null}
        {hint.dir === "prev" ? "First contact in this list" : "Last contact in this list"}
        {hint.dir === "next" ? <ChevronRightIcon sx={{ fontSize: 15 }} /> : null}
      </span>
    );
  } else if (hint?.kind === "moved") {
    body = (
      <span className="flex items-center gap-1.5 tabular-nums">
        <ChevronLeftIcon sx={{ fontSize: 15 }} />
        {pos} of {total}
        <ChevronRightIcon sx={{ fontSize: 15 }} />
      </span>
    );
  } else {
    body = (
      <span className="flex items-center gap-1.5">
        <ChevronLeftIcon sx={{ fontSize: 15 }} />
        Swipe or use
        <kbd className="px-1 py-px rounded bg-white/15 text-[10px] font-mono leading-none">←</kbd>
        <kbd className="px-1 py-px rounded bg-white/15 text-[10px] font-mono leading-none">→</kbd>
        to navigate
        <ChevronRightIcon sx={{ fontSize: 15 }} />
        <span className="text-white/60 tabular-nums">· {pos} of {total}</span>
      </span>
    );
  }
  return (
    <div
      aria-live="polite"
      data-testid="cc-swipe-hint"
      data-visible={visible ? "1" : "0"}
      className="sticky bottom-2 z-40 flex justify-center pointer-events-none h-0 -mt-2"
    >
      <div
        className={`-translate-y-full transition-all duration-300 ${
          visible ? "opacity-100" : "opacity-0 translate-y-[-80%]"
        }`}
      >
        <div
          className={`px-3 py-1.5 rounded-full text-[11px] font-medium text-white shadow-lg backdrop-blur ${
            hint?.kind === "edge" ? "bg-gray-800/90 animate-[ccShake_.35s_ease-in-out]" : "bg-gray-900/85"
          }`}
        >
          {body}
        </div>
      </div>
    </div>
  );
}

// ================================================================ Overview Tab (detail view)
// Overview tab content: Industries (top) → Employment History + Summary/Overlap
// → Projects by Client + Calls by Client. Only tab with content; the rest are blank.
// Build the contact's employment timeline: CURRENT employer (client_name +
// designation on the contact itself — the edit form captures the current
// details on the contact and only PAST roles in previous_work_experience),
// followed by past roles, most recent first. The current role's start is the
// end of the most recent past role (no separate field exists for it).
function buildEmployment(row) {
  const past = (row.previous_work_experience || [])
    .map((w, i) => ({ ...w, _i: i, _start: parseMonthYear(w.start_month_year), _end: parseMonthYear(w.end_month_year) }))
    .sort((a, b) => {
      const ea = a._end || a._start || 0, eb = b._end || b._start || 0;
      if (eb - ea !== 0) return eb - ea;
      return (b._start || 0) - (a._start || 0);
    });
  const list = [];
  if (row.client_name) {
    const latestEnd = past.find((w) => w.end_month_year && String(w.end_month_year).toLowerCase() !== "present");
    list.push({
      company_name: row.client_name,
      designation: row.designation || "",
      start_month_year: latestEnd ? latestEnd.end_month_year : "",
      end_month_year: "Present",
      current: true,
    });
  }
  past.forEach((w) => list.push({ ...w, current: false }));
  return list;
}

function OverviewTab({ row }) {
  const totals = row.totals_till_date || {};
  const employment = useMemo(() => buildEmployment(row), [row]);
  const overlap = computeEmploymentOverlap(employment);

  // Activity Summary (bottom overview) DateFilter — default last 12 months.
  const [actFilter, setActFilter] = useState(getLast12MonthsRange());

  // Projects / Calls by Client Contact — auto-populated from the contact's
  // employers (current + past) using the MySQL mirror.
  const [byClient, setByClient] = useState(null);
  useEffect(() => {
    let alive = true;
    setByClient(null);
    api.get(`/client-contacts/${row.id}/by-client`, { silent: true })
      .then((r) => { if (alive) setByClient(r.data?.rows || []); })
      .catch(() => { if (alive) setByClient([]); });
    return () => { alive = false; };
  }, [row.id, row.client_name, row.previous_work_experience]);

  const projectsRows = (byClient || []).map((r) => ({
    client: r.client, current: r.current, unlisted: r.unlisted,
    count: r.projects, last: r.last_project_date ? fmtDate(r.last_project_date) : "—",
  }));
  const callsRows = (byClient || []).map((r) => ({
    client: r.client, current: r.current, unlisted: r.unlisted,
    count: r.calls, last: r.last_call_date ? fmtDate(r.last_call_date) : "—",
  }));

  return (
    <div className="space-y-4" data-testid="cc-tabpanel-overview">
      {/* Industries — placed above Employment History & Summary */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
          Industries
        </div>
        {row.industries?.length > 0 ? (
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
        ) : (
          <div className="text-sm text-gray-400">—</div>
        )}
      </div>

      {/* Employment History (left) + Summary/Overlap (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Employment History — current on top, then the one previous to it */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm" data-testid="cc-employment-box">
          <SectionTitle>Employment History</SectionTitle>
          <EmploymentTimeline items={employment.slice(0, 2)} row={row} />
        </div>

        {/* Summary + Employment Overlap */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <SectionTitle>Summary</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
              <SummaryCard icon={<WorkOutline sx={{ fontSize: 18 }} />} label="Projects" value={fmtMetric(totals.projects)} />
              <SummaryCard icon={<CheckCircle2 sx={{ fontSize: 18 }} />} label="Serviced" value={fmtMetric(totals.serviced)} />
              <SummaryCard icon={<PhoneCall sx={{ fontSize: 18 }} />} label="Calls" value={fmtMetric(totals.calls)} />
              <SummaryCard icon={<Payments sx={{ fontSize: 18 }} />} label="Revenue" value={fmtMetric(totals.revenue, { money: true })} />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm" data-testid="cc-employment-overlap">
            <SectionTitle>Employment Overlap</SectionTitle>
            {overlap ? (
              <div className="mt-3">
                <div className="text-sm text-gray-700 mb-3">{overlap.rangeLabel}</div>
                <div className="flex w-full h-2 rounded-full overflow-hidden bg-gray-100 gap-px">
                  {overlap.segs.map((s, i) => (
                    <div
                      key={i}
                      className={s.current ? "bg-[#ec9324]" : "bg-blue-500"}
                      style={{ width: `${s.pct}%`, opacity: s.current ? 1 : Math.max(0.45, 1 - i * 0.15) }}
                      title={`${s.company}: ${s.durationLabel}`}
                    />
                  ))}
                </div>
                <div className="flex justify-between gap-2 mt-2 flex-wrap">
                  {overlap.segs.map((s, i) => (
                    <div key={i} className={`text-center min-w-0 ${s.current ? "text-[#ec9324]" : "text-blue-600"}`} data-testid={`cc-overlap-seg-${i}`}>
                      <div className="text-[12px] font-semibold">{s.durationLabel}</div>
                      <div className="text-[11px] text-gray-500 truncate">{s.company}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-400 mt-3">—</div>
            )}
          </div>
        </div>
      </div>

      {/* Projects by Client Contact (left) + Calls by Client Contact (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ByClientTable
          title="Projects by Client Contact"
          countHeader="Projects"
          dateHeader="Last Project Date"
          rows={projectsRows}
          loading={byClient === null}
          testId="cc-projects-by-client"
        />
        <ByClientTable
          title="Calls by Client Contact"
          countHeader="Calls"
          dateHeader="Last Call Date"
          rows={callsRows}
          loading={byClient === null}
          testId="cc-calls-by-client"
        />
      </div>

      {/* Activity Summary — bottom overview of numbers (Projects/Serviced/Calls/Revenue) */}
      <ActivitySummary
        filter={actFilter}
        onFilterChange={setActFilter}
        data={row.activity_by_month}
      />

      {/* CPR-Monthly — Calls / Revenue $ / Projects trend, driven by the SAME
          DateFilter as the Activity Summary above (default = Last 12 Months). */}
      <CprMonthlyChart
        filter={actFilter}
        onFilterChange={setActFilter}
        data={row.activity_by_month}
      />
    </div>
  );
}

// Employment History tab — the full timeline (current + every past role) plus
// a centred circular "+" below the last entry that opens ONLY the
// "Add Previous Work Experience" form (not the full Edit Client Contact dialog).
function EmploymentHistoryTab({ row, onSaved }) {
  const employment = useMemo(() => buildEmployment(row), [row]);
  const [addOpen, setAddOpen] = useState(false);
  return (
    <div className="space-y-4" data-testid="cc-tabpanel-employment">
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <SectionTitle>Employment History</SectionTitle>
        <EmploymentTimeline items={employment} row={row} />
        {/* Add previous work experience — circular, centred, below the last entry */}
        <div className="flex justify-center mt-4">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            title="Add previous work experience"
            aria-label="Add previous work experience"
            data-testid="cc-employment-add"
            className="group relative w-10 h-10 rounded-full bg-[#ec9324] hover:bg-[#d3811b] text-white shadow-md hover:shadow-lg flex items-center justify-center transition-all focus:outline-none focus:ring-2 focus:ring-[#ec9324]/40 focus:ring-offset-2"
          >
            <Plus sx={{ fontSize: 22 }} />
            <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
              Add previous work experience
            </span>
          </button>
        </div>
      </div>

      <AddWorkExDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        row={row}
        onSaved={onSaved}
      />
    </div>
  );
}

// Standalone "Add Previous Work Experience" dialog — same four fields as the
// work-experience rows inside the Edit Client Contact form, but it PATCHes
// ONLY `previous_work_experience` (existing rows + the new one). The change
// flows through the normal save path, so the Timeline records it as well.
const EMPTY_WORKEX = { ...EMPTY_WORK };

function AddWorkExDialog({ open, onOpenChange, row, onSaved }) {
  const [w, setW] = useState(EMPTY_WORKEX);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setW((prev) => ({ ...prev, [k]: v }));

  // Reset the form every time the dialog opens.
  useEffect(() => { if (open) setW(EMPTY_WORKEX); }, [open]);

  const save = async () => {
    const fullDate = (v) => /^[A-Za-z]{3} \d{4}$/.test((v || "").trim());
    if (!(w.company_name || "").trim()) { notify.error("Company Name is required"); return; }
    if (!(w.designation || "").trim()) { notify.error("Designation is required"); return; }
    if (!fullDate(w.start_month_year)) { notify.error("Start Date needs both month and year"); return; }
    if (!fullDate(w.end_month_year) && (w.end_month_year || "").trim().toLowerCase() !== "present") {
      notify.error("End Date needs both month and year (or Present)"); return;
    }
    setSaving(true);
    try {
      const next = [
        ...((row.previous_work_experience || []).map((x) => ({ ...x }))),
        {
          company_name: w.company_name.trim(),
          designation: w.designation.trim(),
          start_month_year: w.start_month_year,
          end_month_year: w.end_month_year,
          city: tidyCity(w.city),
          country_id: w.country_id ?? null,
          country_name: w.country_id != null ? (w.country_name || getCountryName(w.country_id)) : "",
        },
      ];
      // force=true: only the work-experience list changes here, so the
      // email/phone duplicate check is irrelevant for this save.
      const r = await api.patch(`/client-contacts/${row.id}?force=true`, { previous_work_experience: next });
      onSaved?.(r.data);
      notify.success("Work experience added");
      onOpenChange(false);
    } catch (e) {
      notify.error(formatApiError(e, "Failed to add work experience"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-3xl" data-testid="cc-add-workex-dialog">
        <DialogHeader>
          <DialogTitle>Add Previous Work Experience</DialogTitle>
          <DialogDescription className="sr-only">Add a previous work experience entry</DialogDescription>
        </DialogHeader>

        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 mt-1">
          <div className="grid grid-cols-2 gap-x-3 gap-y-5">
            <Field label="Company Name *" labelBg="bg-gray-50">
              <Input
                value={w.company_name}
                onChange={(e) => set("company_name", e.target.value)}
                data-testid="cc-add-workex-company"
                autoFocus
              />
            </Field>
            <Field label="Designation *" labelBg="bg-gray-50">
              <Input
                value={w.designation}
                onChange={(e) => set("designation", e.target.value)}
                data-testid="cc-add-workex-designation"
              />
            </Field>
            <Field label="Start Date *" labelBg="bg-gray-50">
              <MonthYearPicker
                value={w.start_month_year}
                onChange={(v) => set("start_month_year", v)}
                testId="cc-add-workex-start"
              />
            </Field>
            <Field label="End Date *" labelBg="bg-gray-50">
              <MonthYearPicker
                value={w.end_month_year}
                onChange={(v) => set("end_month_year", v)}
                allowPresent
                testId="cc-add-workex-end"
              />
            </Field>
            <Field label="City" labelBg="bg-gray-50">
              <Input
                value={w.city || ""}
                onChange={(e) => set("city", e.target.value)}
                onBlur={(e) => set("city", tidyCity(e.target.value))}
                data-testid="cc-add-workex-city"
              />
            </Field>
            <Field label="Country" labelBg="bg-gray-50">
              <SearchSelect
                options={COUNTRY_OPTIONS}
                value={w.country_id ?? null}
                onChange={(v) => {
                  set("country_id", v);
                  set("country_name", v != null ? getCountryName(v) : "");
                }}
                placeholder="Select country…"
                testId="cc-add-workex-country"
              />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            data-testid="cc-add-workex-submit"
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white"
          >
            {saving ? "Saving…" : "Add work experience"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================================================================ Notes
// Free-text notes (max 1000 chars) on a Client Contact. Add / Edit / Delete go
// through /client-contacts/{id}/notes and are mirrored on the Timeline.
const NOTE_MAX = 1000;

function NotesTab({ row }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editor, setEditor] = useState(null);       // null | { mode: "add" } | { mode: "edit", note }
  const [confirmDel, setConfirmDel] = useState(null); // note | null
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get(`/client-contacts/${row.id}/notes`, { silent: true });
      setNotes(r.data?.rows || []);
    } catch (e) {
      setError(formatApiError(e, "Failed to load notes"));
    } finally {
      setLoading(false);
    }
  }, [row.id]);

  useEffect(() => { load(); }, [load]);

  const onSaved = (saved, mode) => {
    setNotes((prev) => (mode === "add" ? [saved, ...prev] : prev.map((n) => (n.id === saved.id ? saved : n))));
    setEditor(null);
    notify.success(mode === "add" ? "Note added" : "Note updated");
  };

  const doDelete = async () => {
    if (!confirmDel) return;
    setDeleting(true);
    try {
      await api.delete(`/client-contacts/${row.id}/notes/${confirmDel.id}`);
      setNotes((prev) => prev.filter((n) => n.id !== confirmDel.id));
      setConfirmDel(null);
      notify.success("Note deleted");
    } catch (e) {
      notify.error(formatApiError(e, "Failed to delete note"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="cc-tabpanel-notes">
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <SectionTitle>Notes</SectionTitle>
            <div className="text-[11px] text-gray-500 mt-0.5">
              {notes.length ? `${notes.length} note${notes.length === 1 ? "" : "s"}` : "Internal notes about this contact"}
            </div>
          </div>
          <Button
            type="button"
            onClick={() => setEditor({ mode: "add" })}
            className="bg-[#ec9324] hover:bg-[#d3811b] text-white h-8 px-3 text-xs gap-1 shadow-sm"
            data-testid="cc-notes-add"
          >
            <Plus sx={{ fontSize: 16 }} /> Add Note
          </Button>
        </div>

        {error && <div className="mt-3 text-[12px] text-red-600 border border-red-200 bg-red-50 rounded p-3">{error}</div>}
        {!error && loading && notes.length === 0 && <div className="mt-3 text-[12px] text-gray-400 italic">Loading…</div>}

        {!error && !loading && notes.length === 0 && (
          <button
            type="button"
            onClick={() => setEditor({ mode: "add" })}
            className="mt-4 w-full border-2 border-dashed border-gray-200 hover:border-[#ec9324]/60 hover:bg-orange-50/40 rounded-xl py-10 flex flex-col items-center gap-2 text-gray-400 hover:text-[#ec9324] transition-colors"
            data-testid="cc-notes-empty"
          >
            <NotesIcon sx={{ fontSize: 30 }} />
            <span className="text-[12px] font-medium">No notes yet — click to add the first one</span>
          </button>
        )}

        {notes.length > 0 && (
          <ul className="mt-4 space-y-3">
            {notes.map((n) => (
              <NoteCard
                key={n.id}
                note={n}
                onEdit={() => setEditor({ mode: "edit", note: n })}
                onDelete={() => setConfirmDel(n)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Add / Edit pop-up */}
      <NoteEditorDialog
        open={!!editor}
        mode={editor?.mode || "add"}
        note={editor?.note || null}
        contactId={row.id}
        onClose={() => setEditor(null)}
        onSaved={onSaved}
      />

      {/* Delete confirmation */}
      <Dialog open={!!confirmDel} onOpenChange={(o) => { if (!o && !deleting) setConfirmDel(null); }}>
        <DialogContent className="max-w-md" data-testid="cc-note-delete-dialog">
          <DialogHeader>
            <DialogTitle>Delete this note?</DialogTitle>
            <DialogDescription>This removes the note from the contact. The deletion is recorded on the Timeline.</DialogDescription>
          </DialogHeader>
          {confirmDel && (
            <div className="text-[12px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {confirmDel.text}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDel(null)} disabled={deleting}>Cancel</Button>
            <Button onClick={doDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white" data-testid="cc-note-delete-confirm">
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NoteCard({ note, onEdit, onDelete }) {
  const author = note.created_by || {};
  const name = author.name || author.email || "Unknown user";
  const initials = name.trim().split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase() || "?";
  const edited = !!note.updated_at;
  return (
    <li
      className="group relative rounded-xl border border-gray-200 bg-white hover:border-[#ec9324]/50 hover:shadow-md transition-all p-4"
      data-testid={`cc-note-${note.id}`}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-[#ec9324] text-white text-[12px] font-semibold flex items-center justify-center flex-shrink-0 shadow-sm" title={name}>
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-gray-900" data-testid="cc-note-author">{name}</span>
            {author.emp_id ? <span className="text-[11px] text-gray-400">· {author.emp_id}</span> : null}
            <span className="text-[11px] text-gray-500 flex items-center gap-1" data-testid="cc-note-date">
              <History sx={{ fontSize: 12 }} className="text-gray-400" /> {fmtTimelineStamp(note.created_at)}
            </span>
            {edited && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200"
                title={`Edited by ${note.updated_by?.name || "—"} · ${fmtTimelineStamp(note.updated_at)}`}
                data-testid="cc-note-edited"
              >
                edited
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[13px] text-gray-800 leading-relaxed whitespace-pre-wrap break-words" data-testid="cc-note-text">
            {note.text}
          </p>
        </div>
        {/* Edit / Delete — only for the author, Admin or Super Admin (server-enforced too).
            Everyone else sees the note read-only with a small lock hint. */}
        {note.can_manage ? (
          <div className="flex items-center gap-0.5 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
            <CardStyleIconButton icon={<Pencil sx={{ fontSize: 16 }} />} tooltip="Edit" onClick={onEdit} testId={`cc-note-edit-${note.id}`} />
            <button
              type="button"
              onClick={onDelete}
              title="Delete"
              aria-label="Delete"
              data-testid={`cc-note-delete-${note.id}`}
              className="w-7 h-7 rounded-md flex items-center justify-center text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors flex-shrink-0"
            >
              <Trash sx={{ fontSize: 16 }} />
            </button>
          </div>
        ) : (
          <span
            className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Read-only — only the author, an Admin or a Super Admin can edit or delete this note"
            data-testid={`cc-note-readonly-${note.id}`}
          >
            <LockIcon sx={{ fontSize: 15 }} />
          </span>
        )}
      </div>
    </li>
  );
}

function NoteEditorDialog({ open, mode, note, contactId, onClose, onSaved }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const isEdit = mode === "edit";

  useEffect(() => {
    if (open) setText(isEdit ? (note?.text || "") : "");
  }, [open, isEdit, note]);

  const trimmed = text.trim();
  const remaining = NOTE_MAX - text.length;
  const unchanged = isEdit && trimmed === (note?.text || "");
  const canSubmit = trimmed.length > 0 && text.length <= NOTE_MAX && !unchanged && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const r = isEdit
        ? await api.patch(`/client-contacts/${contactId}/notes/${note.id}`, { text: trimmed })
        : await api.post(`/client-contacts/${contactId}/notes`, { text: trimmed });
      onSaved(r.data, mode);
    } catch (e) {
      notify.error(formatApiError(e, "Failed to save note"));
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); submit(); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-2xl" data-testid="cc-note-dialog">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Note" : "Add Note"}</DialogTitle>
          <DialogDescription className="sr-only">{isEdit ? "Edit an existing note" : "Add a note to this client contact"}</DialogDescription>
        </DialogHeader>

        <div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, NOTE_MAX))}
            onKeyDown={onKeyDown}
            maxLength={NOTE_MAX}
            rows={7}
            autoFocus
            placeholder="Write your note…"
            className="resize-y min-h-[160px] text-[13px] leading-relaxed focus-visible:ring-[#ec9324]/40"
            data-testid="cc-note-text-input"
          />
          <div className="mt-1.5 flex items-center justify-between text-[11px]">
            <span className="text-gray-400">Ctrl / ⌘ + Enter to submit</span>
            <span
              className={remaining <= 50 ? (remaining <= 0 ? "text-red-600 font-semibold" : "text-[#ec9324] font-medium") : "text-gray-500"}
              data-testid="cc-note-counter"
            >
              {text.length} / {NOTE_MAX}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving} data-testid="cc-note-cancel">Cancel</Button>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            className="bg-[#ec9324] hover:bg-[#d3811b] text-white"
            data-testid="cc-note-submit"
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================================================================ Timeline (read-only audit history)
// Every profile change is recorded server-side (routers/client_contact_timeline.py)
// as ONE immutable entry per field, grouped into "batches" — one batch per Save
// (same user + timestamp). Values are snapshots taken at the time of the
// change; nothing here is derived from the current record, and there are no
// edit / delete controls by design.
const TIMELINE_PAGE_SIZE = 25;

// "Sep 05, 2026 · 03:42 PM" (IST)
function fmtTimelineStamp(v) {
  const d = v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("en-US", { timeZone: "Asia/Kolkata", month: "short", day: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true });
  return `${date} · ${time}`;
}

const TL_ACTION_STYLE = {
  added:   { label: "Added",   cls: "bg-green-50 text-green-700 border-green-200" },
  edited:  { label: "Edited",  cls: "bg-blue-50 text-blue-700 border-blue-200" },
  deleted: { label: "Deleted", cls: "bg-red-50 text-red-700 border-red-200" },
};

function TimelineTab({ row }) {
  const [batches, setBatches] = useState([]);
  const [total, setTotal] = useState({ batches: 0, changes: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Reload from page 1 whenever the contact is saved (updated_on changes).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setPage(1);
    api.get(`/client-contacts/${row.id}/timeline`, { params: { page: 1, page_size: TIMELINE_PAGE_SIZE }, silent: true })
      .then((r) => {
        if (!alive) return;
        setBatches(r.data?.batches || []);
        setTotal({ batches: r.data?.total_batches || 0, changes: r.data?.total_changes || 0 });
      })
      .catch((e) => { if (alive) setError(formatApiError(e, "Failed to load timeline")); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [row.id, row.updated_on]);

  const loadMore = async () => {
    const next = page + 1;
    setLoading(true);
    try {
      const r = await api.get(`/client-contacts/${row.id}/timeline`, { params: { page: next, page_size: TIMELINE_PAGE_SIZE }, silent: true });
      setBatches((prev) => [...prev, ...(r.data?.batches || [])]);
      setPage(next);
    } catch (e) {
      setError(formatApiError(e, "Failed to load timeline"));
    } finally {
      setLoading(false);
    }
  };

  const hasMore = batches.length < total.batches;

  return (
    <div className="space-y-4" data-testid="cc-tabpanel-timeline">
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <SectionTitle>Timeline</SectionTitle>
            <div className="text-[11px] text-gray-500 mt-0.5">
              Complete history of every change made to this contact&apos;s profile — who, what, when, previous and new value.
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {total.changes > 0 && (
              <span className="text-[11px] text-gray-500" data-testid="cc-timeline-count">
                {total.changes} change{total.changes === 1 ? "" : "s"} · {total.batches} update{total.batches === 1 ? "" : "s"}
              </span>
            )}
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200"
              title="This history is immutable. Entries cannot be added, edited or deleted."
              data-testid="cc-timeline-readonly"
            >
              <LockOutlined sx={{ fontSize: 12 }} /> Read-only
            </span>
          </div>
        </div>

        {error && (
          <div className="mt-3 text-[12px] text-red-600 border border-red-200 bg-red-50 rounded p-3">{error}</div>
        )}

        {!error && loading && batches.length === 0 && (
          <div className="mt-3 text-[12px] text-gray-400 italic">Loading…</div>
        )}

        {!error && !loading && batches.length === 0 && (
          <div className="mt-3 text-[11px] text-gray-400 italic border border-dashed border-gray-200 rounded p-4 text-center" data-testid="cc-timeline-empty">
            No changes recorded yet. Edits made to this contact will appear here automatically.
          </div>
        )}

        {batches.length > 0 && (
          <div className="relative mt-4 space-y-5">
            {batches.length > 1 && (
              <div className="absolute left-[15px] top-8 bottom-6 w-px bg-gray-200" aria-hidden="true" />
            )}
            {batches.map((b, i) => (
              <TimelineBatch key={b.batch_id} batch={b} idx={i} />
            ))}
          </div>
        )}

        {hasMore && (
          <div className="mt-4 flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={loadMore}
              disabled={loading}
              data-testid="cc-timeline-load-more"
              className="text-xs"
            >
              {loading ? "Loading…" : `Load older changes (${total.batches - batches.length} more)`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineBatch({ batch, idx }) {
  const user = batch.user || {};
  const name = user.name || user.email || "Unknown user";
  const initials = name.trim().split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase() || "?";
  const isCreate = batch.event === "created";
  const changes = batch.changes || [];
  return (
    <div className="relative flex items-start gap-3" data-testid={`cc-timeline-batch-${idx}`} data-event={batch.event}>
      {/* Marker — user initials (orange for create, blue for update) */}
      <div
        className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white text-[11px] font-semibold shadow-sm ring-4 ring-white ${
          isCreate ? "bg-[#ec9324]" : "bg-blue-500"
        }`}
        title={name}
      >
        {initials}
      </div>

      <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white">
        {/* Batch header — Who · When */}
        <div className="flex items-center justify-between gap-2 flex-wrap px-3 py-2 border-b border-gray-100 bg-gray-50/60 rounded-t-lg">
          <div className="text-[12px] text-gray-700 min-w-0">
            <span className="text-gray-500">{isCreate ? "Created by" : batch.event === "note" ? "Note by" : "Updated by"}</span>{" "}
            <span className="font-semibold text-gray-900" data-testid="cc-timeline-user">{name}</span>
            {user.emp_id ? <span className="text-gray-400"> · {user.emp_id}</span> : null}
          </div>
          <div className="text-[11px] text-gray-500 whitespace-nowrap flex items-center gap-1" data-testid="cc-timeline-at">
            <History sx={{ fontSize: 13 }} className="text-gray-400" />
            {fmtTimelineStamp(batch.at)}
          </div>
        </div>

        {/* Field-level changes (same time + user) */}
        <ul className="divide-y divide-gray-100">
          {changes.map((c) => <TimelineChange key={c.id} change={c} />)}
        </ul>
      </div>
    </div>
  );
}

function TimelineChange({ change }) {
  const a = TL_ACTION_STYLE[change.action] || { label: change.action, cls: "bg-gray-50 text-gray-600 border-gray-200" };
  const prev = change.previous_value;
  const next = change.new_value;
  return (
    <li className="px-3 py-2" data-testid="cc-timeline-change" data-field={change.field} data-action={change.action}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] font-semibold text-gray-900">{change.field_label}</span>
        <span className="text-gray-300 text-[12px]">—</span>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${a.cls}`}>{a.label}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 flex-wrap text-[12px]">
        {change.action === "edited" && (
          <>
            <TLValue label="Previous" value={prev} tone="prev" />
            <span className="text-gray-400">→</span>
            <TLValue label="New" value={next} tone="new" />
          </>
        )}
        {change.action === "added" && <TLValue label="Added" value={next} tone="new" />}
        {change.action === "deleted" && <TLValue label="Previous" value={prev} tone="prev" />}
      </div>
    </li>
  );
}

function TLValue({ label, value, tone }) {
  const cls = tone === "new"
    ? "bg-orange-50 border-orange-200 text-gray-900"
    : "bg-gray-50 border-gray-200 text-gray-600";
  return (
    <span className="inline-flex items-baseline gap-1 min-w-0 max-w-full">
      <span className="text-[11px] text-gray-500 flex-shrink-0">{label}:</span>
      <code className={`px-1.5 py-0.5 rounded border text-[11.5px] font-mono break-all ${cls}`}>
        {value === null || value === undefined || value === "" ? "—" : String(value)}
      </code>
    </span>
  );
}

// Vertical timeline of EmploymentCards (current = orange, past = blue).
function EmploymentTimeline({ items, row }) {
  if (!items.length) {
    return (
      <div className="mt-3 text-[11px] text-gray-400 italic border border-dashed border-gray-200 rounded p-4 text-center">
        No employment history added yet.
      </div>
    );
  }
  return (
    <div className="relative mt-3 space-y-3">
      {items.length > 1 && <div className="absolute left-[19px] top-6 bottom-6 w-px bg-blue-200" aria-hidden="true" />}
      {items.map((w, i) => (
        <EmploymentCard key={`${w.company_name}-${i}`} w={w} row={row} idx={i} />
      ))}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
      {children}
      <InfoOutlined sx={{ fontSize: 14 }} className="text-gray-300" />
    </div>
  );
}

function SummaryCard({ icon, label, value }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/60">
      <div className="w-8 h-8 rounded-md bg-white border border-gray-200 text-[#ec9324] flex items-center justify-center mb-2">
        {icon}
      </div>
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-lg font-bold text-gray-900 leading-tight">{value}</div>
    </div>
  );
}

function EmploymentCard({ w, row, idx }) {
  const isCurrent = w.current === true || !w.end_month_year || String(w.end_month_year).trim().toLowerCase() === "present";
  const start = parseMonthYear(w.start_month_year);
  const end = isCurrent ? new Date() : parseMonthYear(w.end_month_year);
  const months = start ? monthsBetween(start, end || new Date()) : 0;
  return (
    <div
      className={`relative rounded-lg border p-3 bg-white ${isCurrent ? "border-[#ec9324]/40" : "border-gray-200"}`}
      data-testid={`cc-employment-${idx}`}
      data-current={isCurrent ? "1" : "0"}
    >
      <div className="flex items-start gap-3">
        {/* Industry / company icon — orange for the current employer, blue for past */}
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-white shadow-sm ${isCurrent ? "bg-[#ec9324]" : "bg-blue-500"}`}
          data-testid={`cc-employment-icon-${idx}`}
        >
          <Business sx={{ fontSize: 18 }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className={`text-sm font-semibold ${isCurrent ? "text-[#ec9324]" : "text-blue-600"}`}>
                {w.company_name || "—"}
              </div>
              <div className="text-[12px] text-gray-600">{w.designation || "—"}</div>
            </div>
            <div className="text-right flex-shrink-0">
              {isCurrent && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium">
                  Current
                </span>
              )}
              <div className="text-[11px] text-gray-500 mt-0.5">
                {w.start_month_year || "—"} – {isCurrent ? "Present" : (w.end_month_year || "—")}
              </div>
              {months > 0 && <div className="text-[11px] text-gray-400">{isCurrent ? fmtDuration(months, true) : fmtDuration(months)}</div>}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-2 gap-x-3 mt-3 pt-3 border-t border-gray-100">
            <MetaCell label="Primary Email" value={row.email} />
            <MetaCell label="Primary Phone" value={row.phone ? `${row.phone_isd ? row.phone_isd + " " : ""}${row.phone}` : ""} />
            <MetaCell
              label="Location"
              value={
                w.current === true
                  ? ([row.city, row.country_name].filter(Boolean).join(", ") || row.base_location)
                  : [w.city, w.country_name].filter(Boolean).join(", ")
              }
            />
            {/* Geography — auto-derived from the role's Country (contact's Country for the current role) */}
            <MetaCell
              label="Geography"
              value={getRegionByCountryId(w.current === true ? row.country_id : w.country_id)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaCell({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-[12px] text-gray-700 truncate">{value || "—"}</div>
    </div>
  );
}

function ByClientTable({ title, countHeader, dateHeader, rows, loading = false, testId }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm" data-testid={testId}>
      <SectionTitle>{title}</SectionTitle>
      <div className="mt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th className="text-left font-medium py-2">Client</th>
              <th className="text-left font-medium py-2">{countHeader}</th>
              <th className="text-left font-medium py-2">{dateHeader}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={3} className="py-3 text-[12px] text-gray-400 italic">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={3} className="py-3 text-[12px] text-gray-400 italic">No employer on record.</td></tr>
            )}
            {!loading && rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 last:border-0" data-testid={`${testId}-row-${i}`}>
                <td className="py-2.5">
                  <div className="flex items-center gap-2">
                    {/* Same colour code as Employment History: current = orange, past = blue */}
                    <div
                      className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 text-white ${
                        r.current ? "bg-[#ec9324]" : r.unlisted ? "bg-gray-300" : "bg-blue-500"
                      }`}
                    >
                      <Business sx={{ fontSize: 13 }} />
                    </div>
                    <span className={`truncate ${r.current ? "text-[#ec9324] font-medium" : "text-gray-800"}`}>{r.client}</span>
                  </div>
                </td>
                <td className="py-2.5 text-gray-700 tabular-nums">{r.count}</td>
                <td className="py-2.5 text-gray-700">{r.last}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Employment-overlap visual: ONE segment per role (current + every past
// role), proportional to its duration, oldest → newest.
function computeEmploymentOverlap(work) {
  const parsed = (work || [])
    .map((w) => {
      const present = w.current === true || !w.end_month_year || String(w.end_month_year).trim().toLowerCase() === "present";
      const start = parseMonthYear(w.start_month_year);
      const end = present ? new Date() : parseMonthYear(w.end_month_year);
      if (!start && !present) return null;
      return { company: w.company_name || "—", start: start || end || new Date(), end: end || new Date(), present };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  if (parsed.length === 0) return null;

  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = (d) => `${MON[d.getMonth()]} ${d.getFullYear()}`;
  const overallStart = parsed[0].start;
  const overallEnd = parsed.reduce((mx, p) => (p.end > mx ? p.end : mx), parsed[0].end);
  const totalMonths = Math.max(monthsBetween(overallStart, overallEnd), 1);
  const anyPresent = parsed.some((p) => p.present);

  const sumMonths = parsed.reduce((s, p) => s + Math.max(monthsBetween(p.start, p.end), 1), 0) || 1;
  const segs = parsed.map((p) => {
    const m = Math.max(monthsBetween(p.start, p.end), 1);
    return {
      company: p.company,
      current: p.present,
      durationLabel: p.present ? fmtDuration(m, true) : fmtDuration(m),
      pct: Math.max(4, Math.round((m / sumMonths) * 100)),
    };
  });

  return {
    rangeLabel: `${fmt(overallStart)} – ${anyPresent ? "Present" : fmt(overallEnd)} (${fmtDuration(totalMonths)})`,
    segs,
  };
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

// ================================================================ CPR-Monthly chart
// A multi-series monthly trend of the contact's Calls / Revenue $ / Projects,
// mirroring the ProfiX "CPR-Monthly" widget. Reads the same `activity_by_month`
// data ({ projects|calls|revenue: { "YYYY-MM": n } }) and honours the SAME
// DateFilter passed down from the Overview tab (default = Last 12 Months).
//
// Dual Y-axis: left = counts (Calls & Projects), right = Revenue in $.
const CPR_COLORS = { calls: "#7cb342", revenue: "#e8776f", projects: "#f2c94c" };

function fmtMoneyAxis(v) {
  if (!v) return "$0";
  const a = Math.abs(v);
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (a >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${v}`;
}

function CprTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const get = (k) => payload.find((p) => p.dataKey === k)?.value ?? 0;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl px-3 py-2 text-xs">
      <div className="font-semibold text-white mb-1.5">{label}</div>
      <div className="flex items-center gap-2 text-gray-300">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: CPR_COLORS.calls }} />
        Calls<span className="ml-auto font-semibold text-white tabular-nums">{get("calls").toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-2 text-gray-300 mt-1">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: CPR_COLORS.revenue }} />
        Revenue $<span className="ml-auto font-semibold text-white tabular-nums">${get("revenue").toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-2 text-gray-300 mt-1">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: CPR_COLORS.projects }} />
        Projects<span className="ml-auto font-semibold text-white tabular-nums">{get("projects").toLocaleString()}</span>
      </div>
    </div>
  );
}

function CprMonthlyChart({ filter, onFilterChange, data = null }) {
  const months = useMemo(() => monthsInRange(filter), [filter]);

  const chartData = useMemo(
    () =>
      months.map((m) => ({
        label: m.label,
        calls: (data?.calls?.[m.key]) || 0,
        revenue: (data?.revenue?.[m.key]) || 0,
        projects: (data?.projects?.[m.key]) || 0,
      })),
    [months, data]
  );

  const hasData = chartData.some((d) => d.calls || d.revenue || d.projects);

  const renderCountLabel = (props) => {
    const { x, y, value } = props;
    if (!value) return null;
    return (
      <text x={x} y={y - 9} textAnchor="middle" fontSize={10} fontWeight={600} fill="#4b5563">
        {value.toLocaleString()}
      </text>
    );
  };
  const renderMoneyLabel = (props) => {
    const { x, y, value } = props;
    if (!value) return null;
    return (
      <text x={x} y={y - 9} textAnchor="middle" fontSize={10} fontWeight={600} fill="#c2544c">
        {`$${value.toLocaleString()}`}
      </text>
    );
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm" data-testid="cc-cpr-monthly">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            CPR-Monthly
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
            testId="cc-cpr-date-filter"
          />
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center flex-wrap gap-x-5 gap-y-1.5 mb-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
          <span className="inline-block w-3 h-3 rounded-full" style={{ background: CPR_COLORS.calls }} /> Calls
        </span>
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
          <span className="inline-block w-3 h-3 rounded-full" style={{ background: CPR_COLORS.revenue }} /> Revenue $
        </span>
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
          <span className="inline-block w-3 h-3 rounded-full" style={{ background: CPR_COLORS.projects }} /> Projects - Monthly Trend - N
        </span>
      </div>

      {hasData ? (
        <div className="w-full" style={{ height: 420 }} data-testid="cc-cpr-chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 24, right: 20, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="4 4" stroke="#eef0f2" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={{ stroke: "#e5e7eb" }}
                interval="preserveStartEnd"
                minTickGap={8}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(v) => v.toLocaleString()}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                width={60}
                tickFormatter={fmtMoneyAxis}
                label={{ value: "Revenue $", angle: 90, position: "insideRight", fontSize: 11, fill: "#9ca3af" }}
              />
              <RechartsTooltip
                content={<CprTooltip />}
                isAnimationActive={false}
                wrapperStyle={{ transition: "none", pointerEvents: "none" }}
                cursor={{ stroke: "#d1d5db", strokeWidth: 1, strokeDasharray: "3 3" }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="revenue"
                name="Revenue $"
                stroke={CPR_COLORS.revenue}
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#fff", stroke: CPR_COLORS.revenue, strokeWidth: 2 }}
                activeDot={{ r: 5 }}
                label={renderMoneyLabel}
                isAnimationActive={false}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="calls"
                name="Calls"
                stroke={CPR_COLORS.calls}
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#fff", stroke: CPR_COLORS.calls, strokeWidth: 2 }}
                activeDot={{ r: 5 }}
                label={renderCountLabel}
                isAnimationActive={false}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="projects"
                name="Projects - Monthly Trend - N"
                stroke={CPR_COLORS.projects}
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#fff", stroke: CPR_COLORS.projects, strokeWidth: 2 }}
                activeDot={{ r: 5 }}
                label={renderCountLabel}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-[240px] flex flex-col items-center justify-center text-center">
          <div className="text-sm text-gray-500 font-medium">No activity in this range</div>
          <div className="text-[11px] text-gray-400 mt-1">
            Calls, Revenue &amp; Projects will plot here once there is data for the selected months.
          </div>
        </div>
      )}

      <div className="mt-3 text-[11px] text-gray-400 italic flex items-center justify-end">
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
export function BulkUploadModal({ open, onClose, onComplete }) {
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
                <b> Client Name</b> must exactly match a Segmentation (Client Name). Unknown <b>Industries</b> are dropped and reported per row.
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
