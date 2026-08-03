import React, { useEffect, useMemo, useState, useRef } from "react";
import Layout from "../components/Layout";
import api, { formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import notify from "../lib/notify";
import { confirm as confirmDialog } from "../lib/dialog";
import Plus from "@mui/icons-material/Add";
import Search from "@mui/icons-material/SearchOutlined";
import PieChart from "@mui/icons-material/PieChartOutlineOutlined";
import Pencil from "@mui/icons-material/EditOutlined";
import Trash2 from "@mui/icons-material/DeleteOutlined";
import MoreVertical from "@mui/icons-material/MoreVert";
import Circle from "@mui/icons-material/FiberManualRecord";
import AccountTree from "@mui/icons-material/AccountTreeOutlined";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import CollapsibleTree from "../components/CollapsibleTree";
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

const EMPTY_FORM = { name: "", description: "" };

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
      };
      let saved;
      if (editing) {
        const r = await api.patch(`/segmentations/${editing.id}`, payload);
        saved = r.data;
        notify.success("Segmentation updated");
        setFormOpen(false);
        await load();
        if (saved?.id) setSelectedId(saved.id);
      } else {
        const r = await api.post("/segmentations", payload);
        saved = r.data;
        notify.success("Segmentation created");
        setSelectedId(saved?.id || null);
        setFormOpen(false);
        await load();
      }
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
        <main className="flex-1 bg-gray-50 overflow-hidden flex flex-col" data-testid="segmentations-detail">
          {selected ? (
            <SegmentationDetail
              row={selected}
              onEdit={() => openEdit(selected)}
              onDelete={() => remove(selected)}
              onTreeSaved={async (updated) => {
                await load();
                if (updated?.id) setSelectedId(updated.id);
              }}
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
function SegmentationDetail({ row, onEdit, onDelete, onTreeSaved }) {
  // -------- Auto-saving tree state ----------
  // We hold a local scratchpad of the tree so on-canvas edits (add / rename /
  // reorder) don't need a modal Save button — they're auto-persisted with a
  // small debounce. `saveState` drives the tiny status text in the header.
  const [saveState, setSaveState] = useState("saved"); // "saved" | "saving" | "dirty" | "error"

  // The right-side tree is VIEW-ONLY by default. Chips (+Child / +Peer) and
  // inline rename only appear once the user explicitly enters edit mode via
  // the pencil icon in the tree toolbar (top-right of the canvas). Turning
  // edit mode OFF also cancels any in-flight inline edit.
  const [treeEditMode, setTreeEditMode] = useState(false);
  const pendingTreeRef = useRef(null);
  const saveTimerRef = useRef(null);
  const lastSavedTreeRef = useRef(null);

  // Reset local state when we switch to a different segmentation.
  useEffect(() => {
    pendingTreeRef.current = null;
    lastSavedTreeRef.current = null;
    setSaveState("saved");
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, [row.id]);

  const doSave = async () => {
    const tree = pendingTreeRef.current;
    if (!tree) return;
    pendingTreeRef.current = null;
    setSaveState("saving");
    try {
      const r = await api.patch(`/segmentations/${row.id}`, { tree });
      lastSavedTreeRef.current = tree;
      setSaveState("saved");
      // Refresh the outer list silently to update updated_by/updated_on
      onTreeSaved?.(r.data);
    } catch (e) {
      setSaveState("error");
      notify.error(formatApiError(e, "Failed to save tree"));
    }
  };

  const handleTreeChange = (next) => {
    // Root name must always mirror the segmentation name (safety net).
    if (next && typeof next === "object") next.name = row.name;
    pendingTreeRef.current = next;
    setSaveState("dirty");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(doSave, 600); // debounce
  };

  // Seed the tree data (defensively): stitch together `row.tree` with the
  // current segmentation name at the root.
  const seedTree = useMemo(() => {
    const base = row.tree && typeof row.tree === "object"
      ? JSON.parse(JSON.stringify(row.tree))
      : { name: row.name, children: [] };
    base.name = row.name;
    return base;
    // We deliberately depend on row.id (not row.tree) so the tree component
    // only remounts when the user switches segmentations — collapsing /
    // expanding a node shouldn't reset the whole canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);

  return (
    <div
      className="flex-1 min-h-0 flex flex-col bg-gray-50"
      data-testid="segmentation-detail-panel"
    >
      {/* Header — name / status + action cluster (Info · Edit · Delete) */}
      <div className="px-6 py-4 bg-white border-b border-gray-200 flex items-start gap-4 flex-shrink-0">
        <div className="w-11 h-11 rounded-lg bg-[#ec9324]/10 text-[#ec9324] flex items-center justify-center flex-shrink-0">
          <PieChart sx={{ fontSize: 22 }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold text-gray-900 truncate" data-testid="segmentation-detail-title">
              {row.name}
            </h2>
            <StatusPill status={row.status} />
          </div>
          {row.description ? (
            <p className="mt-0.5 text-xs text-gray-600 line-clamp-2">{row.description}</p>
          ) : (
            <p className="mt-0.5 text-xs text-gray-400 italic">No description</p>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <SegmentationInfoPopover row={row} />
          <IconAction
            onClick={onEdit}
            title="Edit"
            testid="segmentation-detail-edit"
            className="text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          >
            <Pencil sx={{ fontSize: 18 }} />
          </IconAction>
          <IconAction
            onClick={onDelete}
            title="Delete"
            testid="segmentation-detail-delete"
            className="text-red-500 hover:bg-red-50 hover:text-red-700"
          >
            <Trash2 sx={{ fontSize: 18 }} />
          </IconAction>
        </div>
      </div>

      {/* Right-side Tree View Panel */}
      <div className="flex-1 min-h-0 relative bg-white" data-testid="segmentation-tree-panel">
        <CollapsibleTree
          data={seedTree}
          onChange={handleTreeChange}
          editable={treeEditMode}
          onEditableToggle={setTreeEditMode}
          defaultExpandDepth={1}
        />
      </div>

      {/* Compact footer legend + save status (mirrors the previous modal) */}
      <div className="px-5 py-2 border-t border-gray-100 bg-white text-[11px] text-gray-500 flex items-center gap-4 flex-wrap flex-shrink-0">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ec9324] inline-block" />
          Has children (click to collapse)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-white border-2 border-[#ec9324] inline-block" />
          Leaf node
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block px-1.5 py-0.5 rounded-full bg-[#ec9324] text-white text-[9px] font-bold leading-none">+ Child</span>
          deeper level
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block px-1.5 py-0.5 rounded-full bg-[#0ea5e9] text-white text-[9px] font-bold leading-none">+ Peer</span>
          same level (sibling)
        </span>
        <span className="ml-auto text-[11px]">
          {saveState === "saving" && <span className="text-amber-600 font-medium">Saving…</span>}
          {saveState === "dirty" && <span className="text-amber-600 font-medium">● Unsaved changes</span>}
          {saveState === "saved" && <span className="text-gray-400">All changes saved</span>}
          {saveState === "error" && <span className="text-red-600 font-medium">Save failed</span>}
        </span>
      </div>
    </div>
  );
}

// Tiny icon-button wrapper — consistent hover / focus ring with the rest
// of the top bar. Mirrors the NotificationBell trigger visually.
function IconAction({ children, onClick, title, testid, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      data-testid={testid}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-full transition-colors ${className}`}
    >
      {children}
    </button>
  );
}

// Info (ⓘ) popover — same visual pattern as the top-bar NotificationBell.
// Shows Created By / Created On and Updated By / Updated On.
function SegmentationInfoPopover({ row }) {
  const [open, setOpen] = useState(false);
  const rows = [
    {
      label: "Created By",
      userName: row.created_by?.name || "—",
      userEmail: row.created_by?.email || "",
      date: fmtDateTime(row.created_on),
    },
    {
      label: "Updated By",
      userName: row.updated_by?.name || "—",
      userEmail: row.updated_by?.email || "",
      date: fmtDateTime(row.updated_on),
    },
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="segmentation-detail-info"
          title="Details"
          aria-label="Details"
          className="inline-flex items-center justify-center w-9 h-9 rounded-full text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          <InfoOutlined sx={{ fontSize: 20 }} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[340px] p-0 overflow-hidden"
        data-testid="segmentation-info-popover"
      >
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <InfoOutlined className="text-[#ec9324]" sx={{ fontSize: 18 }} />
          <span className="text-sm font-semibold text-gray-900">Details</span>
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {rows.map((r, i) => (
            <div
              key={r.label}
              className={`px-4 py-3 flex items-start gap-3 ${
                i === 0 ? "" : "border-t border-gray-100"
              }`}
              data-testid={`segmentation-info-row-${i}`}
            >
              <div className="w-9 h-9 rounded-full bg-[#ec9324]/10 text-[#ec9324] flex items-center justify-center flex-shrink-0 mt-0.5">
                {r.label === "Created By" ? (
                  <Plus sx={{ fontSize: 18 }} />
                ) : (
                  <Pencil sx={{ fontSize: 16 }} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Action
                </div>
                <div className="text-[13px] font-medium text-gray-900">{r.label}</div>

                <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  User
                </div>
                <div className="text-[13px] text-gray-900 truncate">{r.userName}</div>
                {r.userEmail && (
                  <div className="text-[11px] text-gray-500 truncate">{r.userEmail}</div>
                )}

                <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Date
                </div>
                <div className="text-[13px] text-gray-900">{r.date}</div>
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
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
