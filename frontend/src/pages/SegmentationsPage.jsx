import React, { useEffect, useMemo, useState } from "react";
import Layout from "../components/Layout";
import api, { formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../components/ui/dialog";
import notify from "../lib/notify";
import { confirm as confirmDialog } from "../lib/dialog";
import Plus from "@mui/icons-material/Add";
import Search from "@mui/icons-material/SearchOutlined";
import PieChart from "@mui/icons-material/PieChartOutlineOutlined";
import Pencil from "@mui/icons-material/EditOutlined";
import Trash2 from "@mui/icons-material/DeleteOutlined";
import MoreVertical from "@mui/icons-material/MoreVert";
import Circle from "@mui/icons-material/FiberManualRecord";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "../components/ui/dropdown-menu";

// ============================================================ Helpers
const fmtDateTime = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
    });
  } catch { return iso; }
};

const EMPTY_FORM = { name: "", description: "", status: "Active" };

// ============================================================ MAIN
export default function SegmentationsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);      // segmentation being edited (null = create)
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // ---- Fetch list ----
  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/segmentations");
      setRows(r.data?.rows || []);
    } catch (e) {
      notify.error(formatApiError(e, "Failed to load segmentations"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // ---- Filtered list ----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.name || "").toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  // Auto-select first row if nothing selected (or the selected one disappeared)
  useEffect(() => {
    if (rows.length === 0) { setSelectedId(null); return; }
    if (!selectedId || !rows.find((r) => r.id === selectedId)) {
      setSelectedId(rows[0].id);
    }
  }, [rows, selectedId]);

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) || null,
    [rows, selectedId]
  );

  // ---- Form open/close ----
  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      name: row.name || "",
      description: row.description || "",
      status: row.status || "Active",
    });
    setFormOpen(true);
  };

  const submit = async () => {
    const name = (form.name || "").trim();
    if (!name) {
      notify.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name,
        description: (form.description || "").trim(),
        status: form.status || "Active",
      };
      let saved;
      if (editing) {
        const r = await api.patch(`/segmentations/${editing.id}`, payload);
        saved = r.data;
        notify.success("Segmentation updated");
      } else {
        const r = await api.post("/segmentations", payload);
        saved = r.data;
        notify.success("Segmentation created");
        setSelectedId(saved?.id || null);
      }
      setFormOpen(false);
      await load();
      if (saved?.id) setSelectedId(saved.id);
    } catch (e) {
      notify.error(formatApiError(e, "Failed to save segmentation"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    const ok = await confirmDialog({
      title: "Delete Segmentation?",
      description: `"${row.name}" will be permanently removed. This cannot be undone.`,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/segmentations/${row.id}`);
      notify.success("Segmentation deleted");
      if (selectedId === row.id) setSelectedId(null);
      await load();
    } catch (e) {
      notify.error(formatApiError(e, "Failed to delete segmentation"));
    }
  };

  // ============================================================ Render
  return (
    <Layout
      title="Segmentations"
      fullBleed
      contentClassName="h-[calc(100vh-56px)] flex flex-col"
      actions={
        <Button
          onClick={openCreate}
          data-testid="segmentation-new-btn"
          className="bg-[#ec9324] hover:bg-[#d4811f] text-white shadow-sm flex-shrink-0 h-9"
        >
          <Plus sx={{ fontSize: 16 }} className="mr-1.5" />
          New Segmentation
        </Button>
      }
    >
      <div className="flex-1 flex overflow-hidden" data-testid="segmentations-shell">
        {/* LEFT — sidebar list of segmentations */}
        <aside
          className="w-[320px] min-w-[280px] max-w-[360px] bg-white border-r border-gray-200 flex flex-col"
          data-testid="segmentations-sidebar"
        >
          <div className="px-4 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <PieChart className="text-[#ec9324] flex-shrink-0" sx={{ fontSize: 20 }} />
              <span className="text-sm font-semibold text-gray-700">Segmentations</span>
              <span className="ml-auto text-xs text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">
                {rows.length}
              </span>
            </div>
            <div className="relative">
              <Search
                sx={{ fontSize: 16 }}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                data-testid="segmentations-search"
                className="pl-8 h-9 text-sm"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto" data-testid="segmentations-list">
            {loading ? (
              <div className="px-4 py-6 text-center text-sm text-gray-500">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <PieChart className="text-gray-300 mx-auto mb-2" sx={{ fontSize: 32 }} />
                <div className="text-sm text-gray-600 font-medium">
                  {search ? "No matches" : "No segmentations yet"}
                </div>
                {!search && (
                  <div className="text-xs text-gray-400 mt-1">
                    Click <span className="font-medium">New Segmentation</span> to create one.
                  </div>
                )}
              </div>
            ) : (
              <ul className="py-1.5">
                {filtered.map((r) => {
                  const active = selectedId === r.id;
                  return (
                    <li key={r.id}>
                      <button
                        onClick={() => setSelectedId(r.id)}
                        data-testid={`segmentation-row-${r.id}`}
                        className={`group w-full text-left px-4 py-2.5 flex items-center gap-2 border-l-2 transition-colors ${
                          active
                            ? "bg-[#ec9324]/10 border-[#ec9324]"
                            : "border-transparent hover:bg-gray-50"
                        }`}
                      >
                        <Circle
                          sx={{ fontSize: 8 }}
                          className={
                            r.status === "Inactive"
                              ? "text-gray-300"
                              : active
                              ? "text-[#ec9324]"
                              : "text-emerald-500"
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <div
                            className={`text-sm truncate ${
                              active ? "font-semibold text-[#ec9324]" : "font-medium text-gray-800"
                            }`}
                          >
                            {r.name}
                          </div>
                          {r.description && (
                            <div className="text-[11px] text-gray-500 truncate">
                              {r.description}
                            </div>
                          )}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <span
                              role="button"
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`segmentation-menu-${r.id}`}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-200 text-gray-500"
                            >
                              <MoreVertical sx={{ fontSize: 16 }} />
                            </span>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuItem
                              onClick={(e) => { e.stopPropagation(); openEdit(r); }}
                              data-testid={`segmentation-edit-${r.id}`}
                            >
                              <Pencil sx={{ fontSize: 15 }} className="mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={(e) => { e.stopPropagation(); remove(r); }}
                              data-testid={`segmentation-delete-${r.id}`}
                              className="text-red-600 focus:text-red-600"
                            >
                              <Trash2 sx={{ fontSize: 15 }} className="mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* MAIN — detail / placeholder */}
        <main className="flex-1 bg-gray-50 overflow-y-auto" data-testid="segmentations-detail">
          {selected ? (
            <SegmentationDetail
              row={selected}
              onEdit={() => openEdit(selected)}
              onDelete={() => remove(selected)}
            />
          ) : (
            <EmptyDetail onCreate={openCreate} hasAny={rows.length > 0} />
          )}
        </main>
      </div>

      {/* Create / Edit dialog */}
      <SegmentationFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        form={form}
        setForm={setForm}
        onSubmit={submit}
        saving={saving}
      />
    </Layout>
  );
}

// ============================================================ Sub-components
function SegmentationDetail({ row, onEdit, onDelete }) {
  return (
    <div className="max-w-3xl mx-auto px-8 py-8" data-testid="segmentation-detail-card">
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-6 py-5 border-b border-gray-100 flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-[#ec9324]/10 text-[#ec9324] flex items-center justify-center flex-shrink-0">
            <PieChart sx={{ fontSize: 22 }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-gray-900 truncate">{row.name}</h2>
              <StatusPill status={row.status} />
            </div>
            {row.description ? (
              <p className="mt-1 text-sm text-gray-600">{row.description}</p>
            ) : (
              <p className="mt-1 text-sm text-gray-400 italic">No description</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={onEdit}
              data-testid="segmentation-detail-edit"
              className="h-8"
            >
              <Pencil sx={{ fontSize: 14 }} className="mr-1.5" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onDelete}
              data-testid="segmentation-detail-delete"
              className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
            >
              <Trash2 sx={{ fontSize: 14 }} className="mr-1.5" />
              Delete
            </Button>
          </div>
        </div>

        <dl className="px-6 py-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <MetaField label="Created by" value={row.created_by?.name || "—"} sub={row.created_by?.email} />
          <MetaField label="Created on" value={fmtDateTime(row.created_on)} />
          <MetaField label="Updated by" value={row.updated_by?.name || "—"} sub={row.updated_by?.email} />
          <MetaField label="Updated on" value={fmtDateTime(row.updated_on)} />
        </dl>
      </div>

      <div className="mt-6 rounded-lg border border-dashed border-gray-300 bg-white/60 px-6 py-8 text-center">
        <div className="text-sm text-gray-500">
          Functionality for this segmentation will appear here.
        </div>
      </div>
    </div>
  );
}

function EmptyDetail({ onCreate, hasAny }) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="text-center max-w-sm">
        <div className="w-14 h-14 rounded-full bg-[#ec9324]/10 text-[#ec9324] flex items-center justify-center mx-auto mb-4">
          <PieChart sx={{ fontSize: 28 }} />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-1">
          {hasAny ? "Select a segmentation" : "No segmentations yet"}
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          {hasAny
            ? "Choose one from the sidebar to view its details."
            : "Create your first segmentation to get started."}
        </p>
        {!hasAny && (
          <Button
            onClick={onCreate}
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white"
            data-testid="segmentation-empty-create-btn"
          >
            <Plus sx={{ fontSize: 16 }} className="mr-1.5" />
            New Segmentation
          </Button>
        )}
      </div>
    </div>
  );
}

function MetaField({ label, value, sub }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{value}</dd>
      {sub && <dd className="text-xs text-gray-500 truncate">{sub}</dd>}
    </div>
  );
}

function StatusPill({ status }) {
  const active = status !== "Inactive";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 border ${
        active
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-gray-100 text-gray-600 border-gray-200"
      }`}
      data-testid="segmentation-status-pill"
    >
      <Circle sx={{ fontSize: 7 }} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function SegmentationFormDialog({ open, onOpenChange, editing, form, setForm, onSubmit, saving }) {
  const patch = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="segmentation-form-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Segmentation" : "New Segmentation"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label htmlFor="seg-name">
              Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="seg-name"
              value={form.name}
              onChange={(e) => patch("name", e.target.value)}
              placeholder="e.g. Enterprise Clients"
              data-testid="segmentation-form-name"
              maxLength={120}
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="seg-description">Description</Label>
            <Textarea
              id="seg-description"
              value={form.description}
              onChange={(e) => patch("description", e.target.value)}
              placeholder="Short description (optional)"
              data-testid="segmentation-form-description"
              rows={3}
              maxLength={2000}
            />
          </div>

          <div>
            <Label>Status</Label>
            <div className="mt-1 flex gap-2">
              {["Active", "Inactive"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => patch("status", s)}
                  data-testid={`segmentation-form-status-${s.toLowerCase()}`}
                  className={`flex-1 px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
                    form.status === s
                      ? s === "Active"
                        ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                        : "bg-gray-100 border-gray-300 text-gray-700"
                      : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            data-testid="segmentation-form-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={saving || !form.name.trim()}
            data-testid="segmentation-form-submit"
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
