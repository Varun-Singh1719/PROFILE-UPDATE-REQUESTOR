/**
 * ClientsPage
 * =========================================================
 * CRM → Clients (Aug 04 2026, MVP)
 *
 * Card-view directory of client organisations. Sits between
 * Segmentations and Client Contacts in the sidebar.
 *
 * Features (this phase):
 *   * "+ New Client" top-bar button opens a create dialog
 *     (Name + Type dropdown, 4 fixed types).
 *   * Auto-incrementing numeric ID (system-generated).
 *   * Card view mirrors Client Contacts (initials pill, name,
 *     ID line, meta row, 3 metric placeholders, Edit + Delete
 *     action bar).
 *   * Edit button opens the same dialog pre-filled.
 *   * Placeholder counts: Client Contacts / Projects / Serviced.
 *   * Search + Type filter + Sort.
 *
 * Detail view — deferred to next phase (clicking name shows a
 * toast for now).
 */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import api, { formatApiError } from "../lib/api";
import notify from "../lib/notify";
import { confirm as confirmDialog } from "../lib/dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import Plus from "@mui/icons-material/AddOutlined";
import Search from "@mui/icons-material/SearchOutlined";
import Pencil from "@mui/icons-material/EditOutlined";
import Eye from "@mui/icons-material/VisibilityOutlined";
import Trash from "@mui/icons-material/DeleteOutlined";
import BusinessCenter from "@mui/icons-material/BusinessCenterOutlined";
import ContactsIcon from "@mui/icons-material/ContactsOutlined";
import Assignment from "@mui/icons-material/AssignmentOutlined";
import CheckCircle from "@mui/icons-material/CheckCircleOutlined";

// ---- constants ----
const CLIENT_TYPES = [
  "Venture Capital/Private Equity",
  "Hedge funds/Public Markets",
  "Research and Consulting",
  "Corporations and Companies",
];

const TYPE_ACCENTS = {
  "Venture Capital/Private Equity": { bg: "bg-orange-50",  text: "text-[#ec9324]", border: "border-orange-200" },
  "Hedge funds/Public Markets":     { bg: "bg-sky-50",     text: "text-sky-700",   border: "border-sky-200" },
  "Research and Consulting":        { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  "Corporations and Companies":     { bg: "bg-violet-50",  text: "text-violet-700",  border: "border-violet-200" },
};

const EMPTY_FORM = { name: "", type: "" };

// ============================================================
export default function ClientsPage() {
  const navigate = useNavigate();
  const [rows, setRows]         = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [typeFilter, setTypeFilter] = useState(""); // "" = all
  const [sort, setSort]         = useState("newest");
  const [page, setPage]         = useState(1);
  const [pageSize]              = useState(24);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]       = useState(null); // client row or null
  const [form, setForm]             = useState(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [formErr, setFormErr]       = useState("");

  // ---- Fetch list ----
  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/clients", {
        params: {
          search: search || undefined,
          type: typeFilter || undefined,
          sort,
          page,
          page_size: pageSize,
        },
      });
      setRows(r.data?.rows || []);
      setTotal(r.data?.total || 0);
    } catch (e) {
      notify.error(formatApiError(e, "Failed to load clients"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [search, typeFilter, sort, page]);

  // ---- Create / Edit ----
  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormErr("");
    setDialogOpen(true);
  };
  const openEdit = (row) => {
    setEditing(row);
    setForm({ name: row.name || "", type: row.type || "" });
    setFormErr("");
    setDialogOpen(true);
  };
  const handleSave = async () => {
    setFormErr("");
    if (!form.name.trim()) {
      setFormErr("Name is required");
      return;
    }
    if (!form.type) {
      setFormErr("Type is required");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/clients/${editing.id}`, {
          name: form.name.trim(),
          type: form.type,
        });
        notify.success("Client updated");
      } else {
        await api.post("/clients", {
          name: form.name.trim(),
          type: form.type,
        });
        notify.success("Client created");
      }
      setDialogOpen(false);
      load();
    } catch (e) {
      setFormErr(formatApiError(e, "Failed to save client"));
    } finally {
      setSaving(false);
    }
  };
  const handleDelete = async (row) => {
    const ok = await confirmDialog({
      title: `Delete "${row.name}"?`,
      body: "This will remove the client from the directory. Placeholder counts (contacts / projects / serviced) will be reset.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.delete(`/clients/${row.id}`);
      notify.success("Client deleted");
      load();
    } catch (e) {
      notify.error(formatApiError(e, "Failed to delete"));
    }
  };
  const handleView = (row) => {
    navigate(`/crm/clients/${row.id}`);
  };

  // ---- pagination ----
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Action button rendered in the global top bar (parallel to notification bell + user avatar)
  const topBarActions = (
    <Button
      onClick={openCreate}
      className="bg-[#ec9324] hover:bg-[#d3811b] text-white h-9"
      data-testid="new-client-btn"
    >
      <Plus sx={{ fontSize: 18, marginRight: "4px" }} />
      New Client
    </Button>
  );

  return (
    <Layout title="Clients" actions={topBarActions}>
      <div className="px-6 py-5">

        {/* ============ TOOLBAR ============ */}
        <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-md">
            <Search sx={{ fontSize: 18, color: "#9ca3af" }} />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="flex-1 outline-none text-sm placeholder-gray-400 bg-transparent"
              placeholder="Search by client name or type…"
              data-testid="clients-search"
            />
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            <TypeChip label="All" active={!typeFilter} onClick={() => { setTypeFilter(""); setPage(1); }} />
            {CLIENT_TYPES.map((t) => (
              <TypeChip
                key={t}
                label={t}
                active={typeFilter === t}
                onClick={() => { setTypeFilter(t); setPage(1); }}
              />
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">Sort</span>
            <select
              value={sort}
              onChange={(e) => { setSort(e.target.value); setPage(1); }}
              className="text-sm border border-gray-200 rounded-md px-2 py-1 bg-white"
              data-testid="clients-sort"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="name_asc">Name A → Z</option>
              <option value="name_desc">Name Z → A</option>
              <option value="id_asc">ID ascending</option>
            </select>
            <span className="text-xs text-gray-500 pl-2 border-l border-gray-200">
              {total} client{total === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {/* ============ CARD GRID ============ */}
        {loading ? (
          <div className="text-center text-sm text-gray-500 py-16">Loading clients…</div>
        ) : rows.length === 0 ? (
          <EmptyState onCreate={openCreate} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {rows.map((row) => (
              <ClientCard
                key={row.id}
                row={row}
                onView={() => handleView(row)}
                onEdit={() => openEdit(row)}
                onDelete={() => handleDelete(row)}
              />
            ))}
          </div>
        )}

        {/* ============ PAGINATION ============ */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2 text-sm">
            <button
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
              className="px-3 py-1.5 border border-gray-200 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              ← Previous
            </button>
            <span className="text-gray-600">
              Page <b>{page}</b> of <b>{totalPages}</b>
            </span>
            <button
              disabled={page === totalPages}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1.5 border border-gray-200 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}

        {/* ============ CREATE / EDIT DIALOG ============ */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md" data-testid="client-form-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <BusinessCenter sx={{ color: "#ec9324" }} />
                {editing ? "Edit Client" : "New Client"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div>
                <Label htmlFor="client-name" className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
                  Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="client-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., Sequoia India"
                  data-testid="client-form-name"
                  className="mt-1"
                  autoFocus
                />
              </div>

              <div>
                <Label className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
                  Type <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}
                >
                  <SelectTrigger
                    className="mt-1"
                    data-testid="client-form-type"
                  >
                    <SelectValue placeholder="Select a client type…" />
                  </SelectTrigger>
                  <SelectContent>
                    {CLIENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t} data-testid={`client-form-type-${t.replace(/\s+/g, '-')}`}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {editing && (
                <div className="text-[11px] text-gray-500 border border-gray-100 rounded-md px-3 py-2 bg-gray-50">
                  <div>
                    <span className="uppercase tracking-wider font-semibold">ID</span>
                    &nbsp;·&nbsp;
                    <span className="font-mono text-gray-800">{editing.display_id}</span>
                  </div>
                  <div className="mt-0.5">
                    Created by{" "}
                    <span className="text-gray-700 font-semibold">
                      {editing.created_by?.name || "—"}
                    </span>
                  </div>
                </div>
              )}

              {formErr && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                  {formErr}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-[#ec9324] hover:bg-[#d3811b] text-white"
                data-testid="client-form-submit"
              >
                {saving ? "Saving…" : editing ? "Save changes" : "Create Client"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}

// ============================================================
// Card
// ============================================================
function ClientCard({ row, onView, onEdit, onDelete }) {
  const initials = (row.name || "?")
    .trim()
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-[#ec9324]/40 transition-all p-4 flex flex-col"
      data-testid={`client-card-${row.display_id}`}
    >
      {/* Header — initials + name/id + edit in top-right */}
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-full bg-[#ec9324] text-white flex items-center justify-center text-sm font-bold flex-shrink-0 shadow-sm">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <button
            onClick={onView}
            className="text-[15px] font-bold text-gray-900 truncate hover:text-[#ec9324] transition-colors block text-left w-full leading-tight"
            data-testid={`client-name-${row.display_id}`}
          >
            {row.name}
          </button>
          <div className="text-[11px] text-gray-500 mt-0.5">
            ID: <span className="font-mono text-gray-700">{row.display_id}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          title="Edit"
          aria-label="Edit"
          data-testid={`client-edit-${row.display_id}`}
          className="w-7 h-7 rounded-md flex items-center justify-center text-gray-500 hover:text-[#ec9324] hover:bg-orange-50 transition-colors flex-shrink-0"
        >
          <Pencil sx={{ fontSize: 16 }} />
        </button>
      </div>

      {/* Type — plain text row */}
      <div className="mt-3 text-[12px] text-gray-700">
        <span className="text-gray-500 font-medium">Type :</span>{" "}
        <span className="text-gray-900">{row.type}</span>
      </div>

      {/* Metrics row — 3 placeholders, no icons */}
      <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-3 gap-1 text-center">
        <MetricMini value={row.client_contact_count ?? 0} label="Contacts" />
        <MetricMini value={row.project_count ?? 0}        label="Projects" />
        <MetricMini value={row.serviced_count ?? 0}       label="Serviced" />
      </div>
    </div>
  );
}

// ============================================================
// tiny helpers
// ============================================================
function MetricMini({ value, label }) {
  return (
    <div className="flex flex-col items-center">
      <div className="text-base font-bold text-gray-900 leading-none">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mt-1">
        {label}
      </div>
    </div>
  );
}

function ActionIcon({ children, label, onClick, tone = "default", testId }) {
  const cls =
    tone === "danger"
      ? "text-gray-400 hover:text-red-600 hover:bg-red-50"
      : "text-gray-500 hover:text-[#ec9324] hover:bg-orange-50";
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      data-testid={testId}
      className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${cls}`}
    >
      {children}
    </button>
  );
}

function TypeChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={
        "px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors whitespace-nowrap " +
        (active
          ? "bg-[#ec9324] text-white border-[#ec9324]"
          : "bg-white text-gray-600 border-gray-200 hover:border-orange-300 hover:text-[#ec9324]")
      }
    >
      {label}
    </button>
  );
}

function EmptyState({ onCreate }) {
  return (
    <div className="bg-white border border-dashed border-gray-300 rounded-xl py-16 text-center">
      <div className="w-14 h-14 rounded-full bg-orange-100 text-[#ec9324] mx-auto flex items-center justify-center">
        <BusinessCenter sx={{ fontSize: 30 }} />
      </div>
      <div className="text-lg font-semibold text-gray-900 mt-3">No clients yet</div>
      <div className="text-sm text-gray-500 mt-1">
        Add your first client organisation to get started.
      </div>
      <Button
        onClick={onCreate}
        className="mt-4 bg-[#ec9324] hover:bg-[#d3811b] text-white"
        data-testid="clients-empty-create"
      >
        <Plus sx={{ fontSize: 18, marginRight: "4px" }} />
        New Client
      </Button>
    </div>
  );
}
