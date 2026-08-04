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
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import AccountTree from "@mui/icons-material/AccountTreeOutlined";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import Check from "@mui/icons-material/CheckOutlined";
import CloseIcon from "@mui/icons-material/CloseOutlined";
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
  // Collapsible sidebar (spec: expand/collapse chevron above the list bar).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
        {/* LEFT — tree chart / detail (moved to the left per spec) */}
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

        {/* Thin expand rail — visible only when the sidebar is collapsed */}
        {sidebarCollapsed && (
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            data-testid="segmentations-sidebar-expand"
            title="Show segmentations list"
            className="w-6 bg-white border-l border-gray-200 hover:bg-[#ec9324]/5 flex items-start justify-center pt-3 group flex-shrink-0"
          >
            <ChevronLeft sx={{ fontSize: 18 }} className="text-gray-400 group-hover:text-[#ec9324]" />
          </button>
        )}

        {/* RIGHT — sidebar list of segmentations (moved to the right per spec) */}
        {!sidebarCollapsed && (
        <aside
          className="w-[320px] min-w-[280px] max-w-[360px] bg-white border-l border-gray-200 flex flex-col"
          data-testid="segmentations-sidebar"
        >
          <div className="px-4 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              {/* Collapse chevron — sits inline before the section icon */}
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                data-testid="segmentations-sidebar-collapse"
                title="Hide segmentations list"
                className="w-5 h-5 rounded-md flex items-center justify-center text-gray-400 hover:bg-[#ec9324]/10 hover:text-[#ec9324] flex-shrink-0 -ml-1"
              >
                <ChevronRight sx={{ fontSize: 16 }} />
              </button>
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
        )}
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
  // Aug 3 2026 rewrite — DRAFT MODE:
  //   • Non-edit mode: tree shows the persisted `row.tree` verbatim.
  //   • Edit mode: user manipulates a LOCAL DRAFT tree (draftTree).
  //     Nothing is written to the backend until the user presses
  //     "Save" and confirms via the Review Changes dialog. "Cancel"
  //     throws the draft away and restores the persisted tree.
  const [treeEditMode, setTreeEditMode] = useState(false);
  const [draftTree, setDraftTree] = useState(null);       // active while editing
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // { added: [name], renamed: [{from, to}], deleted: [{name, subCount}] }
  const [pendingChanges, setPendingChanges] = useState(null);

  // Reset draft state whenever the user switches segmentations.
  useEffect(() => {
    setTreeEditMode(false);
    setDraftTree(null);
    setReviewOpen(false);
    setPendingChanges(null);
  }, [row.id]);

  // Seed the persisted tree (read-only source of truth).
  const seedTree = useMemo(() => {
    const base = row.tree && typeof row.tree === "object"
      ? JSON.parse(JSON.stringify(row.tree))
      : { name: row.name, children: [] };
    base.name = row.name;
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, row.tree]);

  // ------ Enter / exit edit mode ------
  const enterEditMode = () => {
    // Clone the persisted tree into a working draft.
    setDraftTree(JSON.parse(JSON.stringify(seedTree)));
    setTreeEditMode(true);
  };
  const cancelEdit = () => {
    setDraftTree(null);
    setTreeEditMode(false);
    setReviewOpen(false);
    setPendingChanges(null);
  };

  // ------ Diff draft vs. persisted for the review dialog ------
  const computeChanges = (before, after) => {
    // Walk both trees in parallel and, at each parent, compare children
    // by name. A child that exists in AFTER but not BEFORE = added; a
    // child in BEFORE but not AFTER = deleted; a common name recurses.
    //
    // Rename detection: for each parent level where BOTH added and
    // deleted lists are non-empty, we compute a structural signature
    // (recursive sorted subtree names) for every entry. Any add whose
    // signature matches a delete's is promoted to a "renamed" pair
    // and removed from both add/delete lists. This catches the common
    // "user typed Chemical → Chemicals" case cleanly without touching
    // pure adds / deletes.
    const added = [];
    const renamed = [];
    const deleted = [];
    const countDescendants = (n) => {
      if (!n || !Array.isArray(n.children)) return 0;
      let c = n.children.length;
      n.children.forEach((k) => { c += countDescendants(k); });
      return c;
    };
    // Deterministic structural signature — only cares about SUBTREE
    // shape + child names (recursive). A rename changes THIS node's
    // name but leaves its subtree signature untouched.
    const subtreeSig = (n) => {
      if (!n) return "";
      const kids = Array.isArray(n.children) ? n.children.slice() : [];
      kids.sort((a, b) => (a?.name || "").localeCompare(b?.name || ""));
      return "[" + kids.map((k) => (k?.name || "") + subtreeSig(k)).join("|") + "]";
    };

    const walk = (b, a) => {
      const bKids = (b && b.children) || [];
      const aKids = (a && a.children) || [];
      const bByName = new Map(bKids.map((k) => [k.name, k]));
      const aByName = new Map(aKids.map((k) => [k.name, k]));

      // First pass — collect adds/deletes at THIS level.
      const localAdds = [];
      const localDels = [];
      aKids.forEach((k) => { if (!bByName.has(k.name)) localAdds.push(k); });
      bKids.forEach((k) => {
        if (!aByName.has(k.name)) localDels.push(k);
      });

      // Pair by matching signatures for rename detection.
      const delsBySig = new Map();
      localDels.forEach((d) => {
        const s = subtreeSig(d);
        if (!delsBySig.has(s)) delsBySig.set(s, []);
        delsBySig.get(s).push(d);
      });
      const consumedAdds = new Set();
      const consumedDels = new Set();
      localAdds.forEach((addNode, idx) => {
        const s = subtreeSig(addNode);
        const bucket = delsBySig.get(s);
        if (bucket && bucket.length > 0) {
          const paired = bucket.shift();
          consumedAdds.add(idx);
          consumedDels.add(paired);
          renamed.push({ from: paired.name, to: addNode.name });
        }
      });

      // Whatever wasn't paired = a real add / delete.
      localAdds.forEach((k, idx) => {
        if (!consumedAdds.has(idx)) added.push(k.name);
      });
      localDels.forEach((k) => {
        if (!consumedDels.has(k)) {
          deleted.push({ name: k.name, subCount: countDescendants(k) });
        }
      });

      // Recurse into common children.
      aKids.forEach((k) => {
        if (bByName.has(k.name)) walk(bByName.get(k.name), k);
      });
    };
    walk(before, after);
    return { added, renamed, deleted };
  };

  const openReview = () => {
    const changes = computeChanges(seedTree, draftTree);
    setPendingChanges(changes);
    setReviewOpen(true);
  };

  const confirmSave = async () => {
    if (!draftTree) return;
    setSaving(true);
    try {
      const toSave = JSON.parse(JSON.stringify(draftTree));
      toSave.name = row.name; // safety net
      const r = await api.patch(`/segmentations/${row.id}`, { tree: toSave });
      notify.success("Tree saved");
      setDraftTree(null);
      setTreeEditMode(false);
      setReviewOpen(false);
      setPendingChanges(null);
      onTreeSaved?.(r.data);
    } catch (e) {
      notify.error(formatApiError(e, "Failed to save tree"));
    } finally {
      setSaving(false);
    }
  };

  // While in edit mode CollapsibleTree drives its local viewData via
  // this handler — we simply mirror the current draft.
  const handleTreeChange = (next) => {
    if (next && typeof next === "object") next.name = row.name;
    setDraftTree(next);
  };

  return (
    <div
      className="flex-1 min-h-0 flex flex-col bg-gray-50"
      data-testid="segmentation-detail-panel"
    >
      {/* Tree panel takes the ENTIRE space below the app's top bar
          (Aug 2026 spec): no more separate white "row" header — the
          segmentation name + Info/Edit/Delete cluster now float on top
          of the tree canvas as a glass panel, mirroring the zoom toolbar
          UI. This gives the tree the full viewport height for content. */}
      <div className="flex-1 min-h-0 relative bg-white" data-testid="segmentation-tree-panel">
        <CollapsibleTree
          key={treeEditMode ? `edit-${row.id}` : `view-${row.id}-${row.updated_on || ""}`}
          data={treeEditMode ? draftTree : seedTree}
          onChange={handleTreeChange}
          editable={treeEditMode}
          onEditableToggle={setTreeEditMode}
          defaultExpandDepth={1}
        />

        {/* Floating glass panel — Name + Info / Save / Cancel / Delete.
            (Aug 3 2026: Active status pill removed; Save/Cancel added
            in edit mode; auto-save disabled.) */}
        <div
          className="absolute top-3 left-3 z-10 flex items-center gap-2
                     bg-white/40 backdrop-blur-xl backdrop-saturate-150
                     border border-white/70 ring-1 ring-black/5
                     rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.10)]
                     px-2 py-1"
          data-testid="segmentation-glass-header"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="w-7 h-7 rounded-md bg-[#ec9324]/15 text-[#ec9324] flex items-center justify-center flex-shrink-0">
            <PieChart sx={{ fontSize: 16 }} />
          </div>
          {treeEditMode ? (
            <button
              type="button"
              onClick={onEdit}
              data-testid="segmentation-detail-title"
              title="Edit name & description"
              className="text-[14px] font-semibold text-gray-900 truncate max-w-[280px] text-left
                         border-b border-dashed border-[#ec9324] hover:text-[#ec9324]
                         focus:outline-none focus:ring-2 focus:ring-[#ec9324]/40 rounded-sm px-0.5"
            >
              {row.name}
            </button>
          ) : (
            <span
              className="text-[14px] font-semibold text-gray-900 truncate max-w-[280px]"
              data-testid="segmentation-detail-title"
            >
              {row.name}
            </span>
          )}
          {treeEditMode && (
            <span
              data-testid="segmentation-editing-badge"
              className="inline-flex items-center gap-1 text-[9.5px] font-semibold uppercase
                         tracking-wide rounded-full px-1.5 py-0.5 border border-[#ec9324]/40
                         bg-[#ec9324]/10 text-[#ec9324]"
            >
              Editing
            </span>
          )}
          <div className="w-px h-6 bg-black/10 mx-1" />
          <div className="flex items-center gap-0.5">
            <SegmentationInfoPopover row={row} />
            {treeEditMode ? (
              <>
                <IconAction
                  onClick={openReview}
                  title="Save"
                  testid="segmentation-detail-save"
                  className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                >
                  <Check sx={{ fontSize: 18 }} />
                </IconAction>
                <IconAction
                  onClick={cancelEdit}
                  title="Cancel"
                  testid="segmentation-detail-cancel"
                  className="text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                >
                  <CloseIcon sx={{ fontSize: 18 }} />
                </IconAction>
              </>
            ) : (
              <IconAction
                onClick={enterEditMode}
                title="Edit"
                testid="segmentation-detail-edit"
                className="text-gray-700 hover:bg-white/60 hover:text-[#ec9324]"
              >
                <Pencil sx={{ fontSize: 18 }} />
              </IconAction>
            )}
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
      </div>

      {/* Review Changes dialog */}
      <ReviewChangesDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        changes={pendingChanges}
        onConfirm={confirmSave}
        saving={saving}
      />

      {/* Compact footer legend + save status. The "+ Sub-Segment" and
          "+ Sibling" chip legends are only relevant when the user can
          actually add nodes — hide them outside edit mode (Aug 2026). */}
      <div className="px-5 py-2 border-t border-gray-100 bg-white text-[11px] text-gray-500 flex items-center gap-4 flex-wrap flex-shrink-0">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ec9324] inline-block" />
          Has sub-segments (click to collapse)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-white border-2 border-[#ec9324] inline-block" />
          Leaf node
        </span>
        {treeEditMode && (
          <>
            <span className="inline-flex items-center gap-1.5" data-testid="legend-sub-segment">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#ec9324] text-white text-[10px] font-bold leading-none">+</span>
              Add sub-segment
            </span>
            <span className="inline-flex items-center gap-1.5" data-testid="legend-delete">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white border border-red-500 text-red-600 text-[10px] font-bold leading-none">
                <Trash2 sx={{ fontSize: 10 }} />
              </span>
              Delete
            </span>
          </>
        )}
        <span className="ml-auto text-[11px]">
          {treeEditMode && (
            <span className="text-amber-600 font-medium">Draft — click Save to publish</span>
          )}
        </span>
      </div>
    </div>
  );
}

// Tiny icon-button wrapper — consistent hover / focus ring with the rest
// of the top bar. Mirrors the NotificationBell trigger visually AND
// carries a dark hover-tooltip pill that fades in (same UX as the bell).
// The tooltip is positioned BELOW the button so it doesn't clip against
// the page header.
function IconAction({ children, onClick, title, testid, className = "", active = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={title}
      aria-pressed={active}
      data-testid={testid}
      className={`group relative inline-flex items-center justify-center w-9 h-9 rounded-full transition-colors ${className}`}
    >
      {children}
      {/* Hover tooltip — dark pill, fades in on group-hover. Same visual
          language as the Notification Bell tooltip. */}
      <span
        className="pointer-events-none absolute top-full mt-1.5 left-1/2 -translate-x-1/2
                   px-2 py-1 bg-gray-900 text-white text-[11px] font-medium
                   rounded whitespace-nowrap opacity-0 group-hover:opacity-100
                   transition-opacity duration-150 z-50 shadow-lg"
      >
        {title}
      </span>
    </button>
  );
}

// Info (ⓘ) popover — same visual pattern as the top-bar NotificationBell.
// Shows the segmentation description first, then a "Details" pivot
// table with 4 columns: Action, User (Name), Emp ID and Date / Time.
function SegmentationInfoPopover({ row }) {
  const [open, setOpen] = useState(false);
  const detailRows = [
    {
      action: "Created By",
      userName: row.created_by?.name || "—",
      userEmail: row.created_by?.email || "",
      empId: row.created_by?.emp_id || "—",
      date: fmtDateTime(row.created_on),
    },
    {
      action: "Updated By",
      userName: row.updated_by?.name || "—",
      userEmail: row.updated_by?.email || "",
      empId: row.updated_by?.emp_id || "—",
      date: fmtDateTime(row.updated_on),
    },
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="segmentation-detail-info"
          aria-label="Info"
          className="group relative inline-flex items-center justify-center w-9 h-9 rounded-full text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          <InfoOutlined sx={{ fontSize: 20 }} />
          {/* Hover tooltip — same UX as the Notification Bell */}
          <span
            className="pointer-events-none absolute top-full mt-1.5 left-1/2 -translate-x-1/2
                       px-2 py-1 bg-gray-900 text-white text-[11px] font-medium
                       rounded whitespace-nowrap opacity-0 group-hover:opacity-100
                       transition-opacity duration-150 z-50 shadow-lg"
          >
            Info
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[560px] max-w-[92vw] p-0 overflow-hidden"
        data-testid="segmentation-info-popover"
      >
        {/* Description block (formerly rendered in the top bar) */}
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
            Description
          </div>
          {row.description ? (
            <p
              className="text-[13px] text-gray-800 whitespace-pre-wrap"
              data-testid="segmentation-info-description"
            >
              {row.description}
            </p>
          ) : (
            <p
              className="text-[13px] text-gray-400 italic"
              data-testid="segmentation-info-description-empty"
            >
              No description
            </p>
          )}
        </div>

        {/* Details — pivot table. Tighter spacing (px-4 py-2) plus a
            wider popover keeps every row on a SINGLE line — no more
            wrapping of "Created / Updated By" or "EMP-0001". */}
        <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2 bg-gray-50">
          <InfoOutlined className="text-[#ec9324]" sx={{ fontSize: 16 }} />
          <span className="text-[13px] font-semibold text-gray-900">Details</span>
        </div>
        <div className="max-h-[360px] overflow-auto" data-testid="segmentation-info-details">
          <table
            className="w-full text-[12px] table-fixed"
            data-testid="segmentation-details-table"
          >
            <colgroup>
              <col style={{ width: "120px" }} />
              <col />
              <col style={{ width: "96px" }} />
              <col style={{ width: "148px" }} />
            </colgroup>
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-3 py-1.5 font-semibold uppercase tracking-wide text-[10px] whitespace-nowrap text-center">
                  Action
                </th>
                <th className="px-3 py-1.5 font-semibold uppercase tracking-wide text-[10px] whitespace-nowrap text-center">
                  User
                </th>
                <th className="px-3 py-1.5 font-semibold uppercase tracking-wide text-[10px] whitespace-nowrap text-center">
                  Emp ID
                </th>
                <th className="px-3 py-1.5 font-semibold uppercase tracking-wide text-[10px] whitespace-nowrap text-center">
                  Date / Time
                </th>
              </tr>
            </thead>
            <tbody>
              {detailRows.map((r, i) => (
                <tr
                  key={r.action}
                  className={i === 0 ? "" : "border-t border-gray-100"}
                  data-testid={`segmentation-details-row-${i}`}
                >
                  <td className="px-3 py-2 align-middle whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 font-medium text-gray-900">
                      <span className="w-5 h-5 rounded-full bg-[#ec9324]/10 text-[#ec9324] flex items-center justify-center flex-shrink-0">
                        {r.action === "Created By" ? (
                          <Plus sx={{ fontSize: 12 }} />
                        ) : (
                          <Pencil sx={{ fontSize: 11 }} />
                        )}
                      </span>
                      {r.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className="text-gray-900 font-medium truncate">
                      {r.userName}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-middle text-gray-800 font-mono text-[11.5px] whitespace-nowrap">
                    {r.empId}
                  </td>
                  <td className="px-3 py-2 align-middle text-gray-800 whitespace-nowrap">
                    {r.date}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

function ReviewChangesDialog({ open, onOpenChange, changes, onConfirm, saving }) {
  const added = changes?.added || [];
  const renamed = changes?.renamed || [];
  const deleted = changes?.deleted || [];
  const total = added.length + renamed.length + deleted.length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="review-changes-dialog">
        <DialogHeader>
          <DialogTitle>Review Changes</DialogTitle>
        </DialogHeader>
        {total === 0 ? (
          <div className="py-6 text-center text-sm text-gray-500" data-testid="review-empty">
            No changes to save.
          </div>
        ) : (
          <div className="space-y-3 max-h-[400px] overflow-auto pr-1">
            {added.length > 0 && (
              <div data-testid="review-added">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 mb-1.5">
                  Added ({added.length})
                </div>
                <ul className="space-y-1">
                  {added.map((n, i) => (
                    <li
                      key={"a" + i}
                      className="text-[13px] px-2 py-1 rounded bg-emerald-50 text-emerald-900 border border-emerald-200"
                    >
                      + {n}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {renamed.length > 0 && (
              <div data-testid="review-renamed">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-700 mb-1.5">
                  Renamed ({renamed.length})
                </div>
                <ul className="space-y-1">
                  {renamed.map((r, i) => (
                    <li
                      key={"r" + i}
                      className="text-[13px] px-2 py-1 rounded bg-sky-50 text-sky-900 border border-sky-200 flex items-center gap-2 flex-wrap"
                    >
                      <span className="line-through opacity-70">{r.from}</span>
                      <span className="text-sky-500">→</span>
                      <span className="font-semibold">{r.to}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {deleted.length > 0 && (
              <div data-testid="review-deleted">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-red-700 mb-1.5">
                  Deleted ({deleted.length})
                </div>
                <ul className="space-y-1">
                  {deleted.map((d, i) => (
                    <li
                      key={"d" + i}
                      className="text-[13px] px-2 py-1 rounded bg-red-50 text-red-900 border border-red-200"
                    >
                      − {d.name}
                      {d.subCount > 0 && (
                        <span className="text-[11px] text-red-600 ml-1">
                          (with {d.subCount} sub-segment{d.subCount === 1 ? "" : "s"})
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            data-testid="review-changes-cancel"
          >
            Back to editing
          </Button>
          <Button
            onClick={onConfirm}
            disabled={saving || total === 0}
            data-testid="review-changes-confirm"
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white"
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
