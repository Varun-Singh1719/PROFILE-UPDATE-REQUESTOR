/**
 * PermissionsPage (v3) — redesigned matrix editor.
 *
 * Layout
 *   • Two product accordions (Profix + Workspace Manager)
 *   • Each accordion body renders a permission MATRIX:
 *       row  = feature / page / table
 *       cols = View  (checkbox + Show/Hide + scope select)
 *              Edit  (checkbox + Show/Hide + scope select)
 *   • Below the matrix: an Action-Buttons section (Create, Edit, Delete, …)
 *     with per-action: Enable + Visibility + Scope (where applicable)
 *
 * Extras
 *   • Search-as-you-type across module/feature/action labels
 *   • Expand-all / Collapse-all
 *   • Select-all / Deselect-all per module
 *   • Copy permissions from an existing Permission Set (clone-payload)
 *   • Preview effective permissions before saving
 *   • Save creates a new v3 Permission Set (or updates one when editing)
 *
 * API surface
 *   GET  /api/permissions/schema/v3
 *   GET  /api/permission-sets-v3
 *   GET  /api/permission-sets-v3/{id}
 *   GET  /api/permission-sets-v3/{id}/clone-payload
 *   GET  /api/permissions/preview/{id}
 *   POST /api/permission-sets-v3
 *   PUT  /api/permission-sets-v3/{id}
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Save, Loader2, Search, ChevronDown, ChevronRight, ChevronsDown, ChevronsUp,
  Copy, Eye, EyeOff, CheckSquare, Square, Trash2, Info, X, Briefcase, Armchair,
  History, Sparkles,
} from "lucide-react";
import api from "../lib/api";
import Layout from "../components/Layout";
import notify from "../lib/notify";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent } from "../components/ui/dialog";

// -------------------------------------------------------------------- helpers
const SCOPE_OPTS = [
  { value: "individual", label: "Individual", hint: "Own information only" },
  { value: "team",       label: "Team",       hint: "Team-scoped access" },
  { value: "overall",    label: "Overall",    hint: "All users & teams" },
];

const emptyRW = () => ({ enabled: false, visible: true, scope: null });

function emptyModuleState(mod) {
  const features = {};
  for (const f of mod.features || []) features[f.key] = { view: emptyRW(), edit: emptyRW() };
  const actions = {};
  for (const a of mod.actions || []) actions[a.key] = emptyRW();
  return { features, actions };
}
function emptyStateFromCatalog(modules) {
  const out = {};
  for (const m of modules || []) out[m.key] = emptyModuleState(m);
  return out;
}
function mergeStateWithCatalog(catalog, incoming) {
  const base = emptyStateFromCatalog(catalog);
  if (!incoming) return base;
  for (const m of catalog) {
    const src = incoming[m.key] || {};
    const dst = base[m.key];
    for (const f of m.features || []) {
      const s = (src.features || {})[f.key] || {};
      dst.features[f.key] = {
        view: { ...emptyRW(), ...(s.view || {}) },
        edit: { ...emptyRW(), ...(s.edit || {}) },
      };
    }
    for (const a of m.actions || []) {
      const s = (src.actions || {})[a.key] || {};
      dst.actions[a.key] = { ...emptyRW(), ...s };
    }
  }
  return base;
}

// -------------------------------------------------------------------- ScopeSelect
function ScopeSelect({ value, onChange, disabled, testId }) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      data-testid={testId}
      className={`h-7 min-w-[92px] text-[11px] px-1.5 rounded border bg-white transition-colors ${
        disabled
          ? "border-gray-200 text-gray-300 cursor-not-allowed"
          : "border-gray-300 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#ec9324]/30 focus:border-[#ec9324]"
      }`}
      title={disabled ? "Enable View or Edit first" : "Access scope"}
    >
      <option value="">— scope —</option>
      {SCOPE_OPTS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// -------------------------------------------------------------------- RWCell
// One cell rendering the Enable checkbox + Show/Hide + Scope select.
function RWCell({ value, onChange, scoped = true, testIdPrefix }) {
  const v = value || emptyRW();
  return (
    <div className="inline-flex items-center gap-1.5" data-testid={testIdPrefix}>
      <input
        type="checkbox"
        checked={!!v.enabled}
        onChange={(e) => onChange({ ...v, enabled: e.target.checked })}
        className="h-4 w-4 rounded border-gray-300 text-[#ec9324] focus:ring-[#ec9324]"
        data-testid={`${testIdPrefix}-enable`}
        aria-label="Enable"
      />
      <button
        type="button"
        onClick={() => onChange({ ...v, visible: !v.visible })}
        title={v.visible ? "Visible — click to hide" : "Hidden — click to show"}
        data-testid={`${testIdPrefix}-vis`}
        className={`h-6 w-6 inline-flex items-center justify-center rounded hover:bg-gray-100 ${
          v.visible ? "text-gray-600" : "text-red-500"
        }`}
      >
        {v.visible ? <Eye size={13} /> : <EyeOff size={13} />}
      </button>
      {scoped ? (
        <ScopeSelect
          value={v.scope}
          onChange={(s) => onChange({ ...v, scope: s })}
          disabled={!v.enabled}
          testId={`${testIdPrefix}-scope`}
        />
      ) : (
        <span className="text-[10px] text-gray-300 min-w-[92px]">—</span>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- ModuleAccordion
function ModuleAccordion({
  mod,
  state,
  onChangeFeature,
  onChangeAction,
  expanded,
  onToggle,
  search,
  onSelectAll,
  onDeselectAll,
}) {
  const Icon = mod.key === "profix" ? Briefcase : Armchair;
  const q = search.trim().toLowerCase();
  const featureMatch = (f) => !q || f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q);
  const actionMatch  = (a) => !q || a.label.toLowerCase().includes(q) || a.key.toLowerCase().includes(q);
  const filteredFeatures = (mod.features || []).filter(featureMatch);
  const filteredActions  = (mod.actions  || []).filter(actionMatch);
  const anyFeaturesEnabled = Object.values(state.features || {}).some((f) => f.view?.enabled || f.edit?.enabled);
  const anyActionsEnabled  = Object.values(state.actions  || {}).some((a) => a?.enabled);

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden" data-testid={`perm-mod-${mod.key}`}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50"
        data-testid={`perm-mod-toggle-${mod.key}`}
      >
        <span className="h-8 w-8 rounded-md inline-flex items-center justify-center" style={{ background: `${mod.color}15`, color: mod.color }}>
          <Icon size={16} />
        </span>
        <div className="flex-1 text-left min-w-0">
          <div className="font-bold text-sm text-gray-900 truncate">{mod.label}</div>
          <div className="text-[11px] text-gray-500 truncate">
            {filteredFeatures.length}/{(mod.features || []).length} rows · {filteredActions.length}/{(mod.actions || []).length} actions
            {anyFeaturesEnabled || anyActionsEnabled ? (
              <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 rounded-full">
                Configured
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelectAll(); }}
            className="text-[10px] font-semibold text-[#ec9324] hover:underline px-1.5"
            data-testid={`perm-mod-select-all-${mod.key}`}
            title="Enable everything in this product"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDeselectAll(); }}
            className="text-[10px] font-semibold text-gray-500 hover:underline px-1.5"
            data-testid={`perm-mod-deselect-all-${mod.key}`}
            title="Disable everything in this product"
          >
            Clear
          </button>
          {expanded ? <ChevronDown size={16} className="text-gray-400 ml-1" /> : <ChevronRight size={16} className="text-gray-400 ml-1" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100">
          {/* Features matrix */}
          <div className="p-3">
            <div className="text-[11px] uppercase tracking-widest text-gray-500 font-bold px-2 mb-1.5">
              Modules & Pages
            </div>
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm" data-testid={`perm-features-table-${mod.key}`}>
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-gray-700 w-[42%]">Feature</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-700">View</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-700">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFeatures.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-xs text-gray-400">
                        No feature matches your search.
                      </td>
                    </tr>
                  )}
                  {filteredFeatures.map((f, i) => {
                    const s = state.features?.[f.key] || { view: emptyRW(), edit: emptyRW() };
                    return (
                      <tr key={f.key} className={i % 2 ? "bg-white" : "bg-gray-50/40"}
                          data-testid={`perm-feature-row-${mod.key}-${f.key}`}>
                        <td className="px-3 py-2 align-middle">
                          <div className="font-medium text-gray-900 text-sm">{f.label}</div>
                          <div className="text-[10px] text-gray-400">{f.key}</div>
                        </td>
                        <td className="px-3 py-2">
                          <RWCell
                            value={s.view}
                            onChange={(v) => onChangeFeature(f.key, "view", v)}
                            testIdPrefix={`perm-cell-${mod.key}-${f.key}-view`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <RWCell
                            value={s.edit}
                            onChange={(v) => onChangeFeature(f.key, "edit", v)}
                            testIdPrefix={`perm-cell-${mod.key}-${f.key}-edit`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action buttons */}
          <div className="p-3 pt-1">
            <div className="text-[11px] uppercase tracking-widest text-gray-500 font-bold px-2 mb-1.5">
              Action buttons
            </div>
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm" data-testid={`perm-actions-table-${mod.key}`}>
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-gray-700 w-[42%]">Action</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-700">Enable · Visibility · Scope</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActions.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-3 py-6 text-center text-xs text-gray-400">
                        No action matches your search.
                      </td>
                    </tr>
                  )}
                  {filteredActions.map((a, i) => {
                    const val = state.actions?.[a.key] || emptyRW();
                    return (
                      <tr key={a.key} className={i % 2 ? "bg-white" : "bg-gray-50/40"}
                          data-testid={`perm-action-row-${mod.key}-${a.key}`}>
                        <td className="px-3 py-2 align-middle">
                          <div className="font-medium text-gray-900 text-sm">{a.label}</div>
                          <div className="text-[10px] text-gray-400">{a.key}{a.scoped ? "" : " · unscoped"}</div>
                        </td>
                        <td className="px-3 py-2">
                          <RWCell
                            value={val}
                            onChange={(v) => onChangeAction(a.key, v)}
                            scoped={!!a.scoped}
                            testIdPrefix={`perm-cell-${mod.key}-action-${a.key}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- CopyFromDialog
function CopyFromDialog({ open, onOpenChange, onCopy }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get("/permission-sets", { params: { q } })
      .then((r) => setItems(r.data || []))
      .finally(() => setLoading(false));
  }, [open, q]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden" data-testid="perm-copy-dialog">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center gap-2">
          <Copy size={16} className="text-[#ec9324]" />
          <div className="flex-1">
            <div className="font-semibold text-gray-900">Copy from an existing Permission Set</div>
            <div className="text-xs text-gray-500">Prefills the matrix with the chosen set's permissions. You can then tweak & save as new.</div>
          </div>
        </div>
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search permission sets…"
              className="w-full h-9 pl-9 pr-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#ec9324]/30 focus:border-[#ec9324]"
              data-testid="perm-copy-search"
            />
          </div>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {loading && <div className="p-6 text-center text-xs text-gray-400"><Loader2 className="animate-spin inline mr-1.5" size={13} /> Loading…</div>}
          {!loading && items.length === 0 && (
            <div className="p-8 text-center text-xs text-gray-400">No permission sets found.</div>
          )}
          {!loading && items.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onCopy(p.id)}
              className="w-full flex items-start gap-3 px-5 py-3 border-b border-gray-100 hover:bg-orange-50/60 text-left"
              data-testid={`perm-copy-item-${p.id}`}
            >
              <span className="h-8 w-8 rounded-md bg-orange-50 border border-orange-200 inline-flex items-center justify-center text-[#ec9324]"><Copy size={14} /></span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-900">{p.title}</div>
                <div className="text-[11px] text-gray-500 truncate">
                  {p.description || "—"}
                  <span className="ml-2 text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-500">v{p.version || 1}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------- PreviewDialog
function PreviewDialog({ open, onOpenChange, effective, title }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden" data-testid="perm-preview-dialog">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center gap-2">
          <Sparkles size={16} className="text-[#ec9324]" />
          <div>
            <div className="font-semibold text-gray-900">Effective permissions preview</div>
            <div className="text-xs text-gray-500">What a user assigned to <b>{title || "this set"}</b> will actually see and do.</div>
          </div>
        </div>
        <div className="p-5 max-h-[520px] overflow-y-auto space-y-4">
          {Object.keys(effective || {}).length === 0 && (
            <div className="text-xs text-gray-400 text-center py-6">Nothing enabled yet — the user will see nothing.</div>
          )}
          {Object.entries(effective || {}).map(([mkey, m]) => (
            <div key={mkey} className="rounded-lg border border-gray-200">
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 text-sm font-bold text-gray-800">{mkey}</div>
              <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">Features visible</div>
                  <ul className="text-xs text-gray-700 space-y-0.5">
                    {Object.entries(m.features || {}).map(([fkey, v]) => (
                      <li key={fkey} className="flex items-center gap-2">
                        <span className="font-mono text-[11px]">{fkey}</span>
                        <span className="text-gray-400">·</span>
                        <span>{v.view?.enabled ? `View (${v.view.scope || "—"})` : "View ✗"}</span>
                        <span className="text-gray-400">·</span>
                        <span>{v.edit?.enabled ? `Edit (${v.edit.scope || "—"})` : "Edit ✗"}</span>
                      </li>
                    ))}
                    {Object.keys(m.features || {}).length === 0 && <li className="text-gray-400">No features enabled.</li>}
                  </ul>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">Action buttons visible</div>
                  <ul className="text-xs text-gray-700 space-y-0.5">
                    {Object.entries(m.actions || {}).map(([akey, v]) => (
                      <li key={akey} className="flex items-center gap-2">
                        <span className="font-mono text-[11px]">{akey}</span>
                        <span className="text-gray-400">·</span>
                        <span>{v.enabled ? `On (${v.scope || "unscoped"})` : "Off"}</span>
                      </li>
                    ))}
                    {Object.keys(m.actions || {}).length === 0 && <li className="text-gray-400">No actions enabled.</li>}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------- AuditDialog
function AuditDialog({ open, onOpenChange, resourceId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const params = resourceId ? { resource_id: resourceId, limit: 50 } : { limit: 50 };
    api.get("/permissions/audit", { params })
      .then((r) => setRows(r.data || []))
      .finally(() => setLoading(false));
  }, [open, resourceId]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden" data-testid="perm-audit-dialog">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center gap-2">
          <History size={16} className="text-[#ec9324]" />
          <div>
            <div className="font-semibold text-gray-900">Permission changes — audit log</div>
            <div className="text-xs text-gray-500">
              {resourceId ? "History for this permission set." : "Recent activity across all permission sets."}
            </div>
          </div>
        </div>
        <div className="max-h-[520px] overflow-y-auto p-3 space-y-2">
          {loading && <div className="text-center text-xs text-gray-400 py-6"><Loader2 className="animate-spin inline mr-1.5" size={13} /> Loading…</div>}
          {!loading && rows.length === 0 && <div className="text-center text-xs text-gray-400 py-6">No changes yet.</div>}
          {rows.map((r, i) => (
            <div key={i} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-900">{r.detail || r.action}</div>
                <div className="text-[11px] text-gray-500">{new Date(r.created_at).toLocaleString()}</div>
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                by {r.actor?.name || r.actor?.email || "—"}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------- Main
export default function PermissionsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editingId = params.get("set");

  const [catalog, setCatalog] = useState(null);
  const [state, setState] = useState({});
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState({});
  const [saving, setSaving] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [effective, setEffective] = useState({});
  const [auditOpen, setAuditOpen] = useState(false);
  const [copiedFromId, setCopiedFromId] = useState(null);

  // ---- Load schema
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/permissions/schema/v3");
        if (cancelled) return;
        setCatalog(data.modules || []);
        const empty = emptyStateFromCatalog(data.modules || []);
        setState(empty);
        // expand all by default
        const exp = {};
        for (const m of data.modules) exp[m.key] = true;
        setExpanded(exp);
      } catch {
        notify.error("Could not load permission catalog");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- Load set for edit
  useEffect(() => {
    if (!editingId || !catalog) return;
    (async () => {
      try {
        const { data } = await api.get(`/permission-sets-v3/${editingId}`);
        setTitle(data.title || "");
        setDescription(data.description || "");
        setState(mergeStateWithCatalog(catalog, data.modules));
      } catch {
        notify.error("Could not load permission set");
      }
    })();
  }, [editingId, catalog]);

  // ---- Handlers
  const changeFeature = useCallback((mkey, fkey, rw, next) => {
    setState((prev) => ({
      ...prev,
      [mkey]: {
        ...prev[mkey],
        features: {
          ...prev[mkey].features,
          [fkey]: { ...(prev[mkey].features[fkey] || { view: emptyRW(), edit: emptyRW() }), [rw]: next },
        },
      },
    }));
  }, []);

  const changeAction = useCallback((mkey, akey, next) => {
    setState((prev) => ({
      ...prev,
      [mkey]: {
        ...prev[mkey],
        actions: { ...prev[mkey].actions, [akey]: next },
      },
    }));
  }, []);

  const selectAllInModule = useCallback((mkey) => {
    setState((prev) => {
      const mod = (catalog || []).find((m) => m.key === mkey);
      if (!mod) return prev;
      const nf = {};
      for (const f of mod.features) nf[f.key] = {
        view: { enabled: true, visible: true, scope: "overall" },
        edit: { enabled: true, visible: true, scope: "overall" },
      };
      const na = {};
      for (const a of mod.actions) na[a.key] = { enabled: true, visible: true, scope: a.scoped ? "overall" : null };
      return { ...prev, [mkey]: { features: nf, actions: na } };
    });
  }, [catalog]);

  const clearModule = useCallback((mkey) => {
    setState((prev) => {
      const mod = (catalog || []).find((m) => m.key === mkey);
      if (!mod) return prev;
      return { ...prev, [mkey]: emptyModuleState(mod) };
    });
  }, [catalog]);

  const expandAll = () => setExpanded(Object.fromEntries((catalog || []).map((m) => [m.key, true])));
  const collapseAll = () => setExpanded(Object.fromEntries((catalog || []).map((m) => [m.key, false])));

  const doCopyFrom = async (id) => {
    try {
      const { data } = await api.get(`/permission-sets-v3/${id}/clone-payload`);
      setTitle(data.title || "");
      setDescription(data.description || "");
      setState(mergeStateWithCatalog(catalog, data.modules));
      setCopiedFromId(id);
      setCopyOpen(false);
      notify.success("Permissions copied — you can now tweak & save.");
    } catch (e) {
      notify.error(e, { what: "Copy permission set" });
    }
  };

  const doPreview = async () => {
    if (editingId) {
      // Preview saved set
      try {
        const { data } = await api.get(`/permissions/preview/${editingId}`);
        setEffective(data.effective || {});
      } catch { setEffective({}); }
    } else {
      // Compute preview locally from current draft
      const out = {};
      for (const [mkey, m] of Object.entries(state)) {
        const feats = {};
        for (const [fkey, fdata] of Object.entries(m.features || {})) {
          if (!fdata.view.visible && !fdata.edit.visible) continue;
          feats[fkey] = {
            view: fdata.view.visible ? { enabled: fdata.view.enabled, scope: fdata.view.scope } : null,
            edit: fdata.edit.visible ? { enabled: fdata.edit.enabled, scope: fdata.edit.scope } : null,
          };
        }
        const acts = {};
        for (const [akey, adata] of Object.entries(m.actions || {})) {
          if (!adata.visible) continue;
          acts[akey] = { enabled: adata.enabled, scope: adata.scope };
        }
        if (Object.keys(feats).length || Object.keys(acts).length) out[mkey] = { features: feats, actions: acts };
      }
      setEffective(out);
    }
    setPreviewOpen(true);
  };

  const doSave = async () => {
    if (!title.trim()) { notify.error("Title is required"); return; }
    setSaving(true);
    try {
      const payload = { title: title.trim(), description, modules: state, copied_from_id: copiedFromId };
      if (editingId) {
        await api.put(`/permission-sets-v3/${editingId}`, payload);
        notify.success("Permission set updated");
      } else {
        const { data } = await api.post("/permission-sets-v3", payload);
        notify.success("Permission set created");
        navigate(`/admin/permissions?set=${data.id}`);
      }
    } catch (e) {
      notify.error(e, { what: "Save permission set" });
    } finally {
      setSaving(false);
    }
  };

  if (!catalog) {
    return (
      <Layout title="Permissions">
        <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
          <Loader2 className="animate-spin mr-2" size={16} /> Loading catalog…
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      title="Permissions"
      contentClassName="w-full px-9 sm:px-12 pt-2 pb-6 flex flex-col min-h-[calc(100vh-56px)]"
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAuditOpen(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-200 bg-white text-gray-700 hover:border-[#ec9324] hover:text-[#ec9324] text-xs font-semibold"
            data-testid="perm-audit-btn"
          >
            <History size={13} /> Audit
          </button>
          <button
            type="button"
            onClick={() => setCopyOpen(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-200 bg-white text-gray-700 hover:border-[#ec9324] hover:text-[#ec9324] text-xs font-semibold"
            data-testid="perm-copy-btn"
          >
            <Copy size={13} /> Copy from set
          </button>
          <button
            type="button"
            onClick={doPreview}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-200 bg-white text-gray-700 hover:border-[#ec9324] hover:text-[#ec9324] text-xs font-semibold"
            data-testid="perm-preview-btn"
          >
            <Sparkles size={13} /> Preview
          </button>
          <Button
            onClick={doSave}
            disabled={saving}
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-9 text-xs font-semibold"
            data-testid="perm-save-btn"
          >
            {saving ? <Loader2 className="animate-spin mr-1.5" size={13} /> : <Save size={13} className="mr-1.5" />}
            {editingId ? "Update set" : "Save as new set"}
          </Button>
        </div>
      }
    >
      {/* Meta */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">Title *</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Team Manager — Workspace"
              className="mt-1 w-full h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#ec9324]/30 focus:border-[#ec9324]"
              data-testid="perm-title"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this permission set is for"
              className="mt-1 w-full h-10 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#ec9324]/30 focus:border-[#ec9324]"
              data-testid="perm-description"
            />
          </label>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search modules, pages, actions…"
            className="w-full h-9 pl-9 pr-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#ec9324]/30 focus:border-[#ec9324]"
            data-testid="perm-search"
          />
        </div>
        <button
          type="button"
          onClick={expandAll}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-200 bg-white text-gray-700 hover:border-[#ec9324] hover:text-[#ec9324] text-xs font-semibold"
          data-testid="perm-expand-all"
        >
          <ChevronsDown size={13} /> Expand all
        </button>
        <button
          type="button"
          onClick={collapseAll}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-200 bg-white text-gray-700 hover:border-[#ec9324] hover:text-[#ec9324] text-xs font-semibold"
          data-testid="perm-collapse-all"
        >
          <ChevronsUp size={13} /> Collapse all
        </button>
        <div className="ml-auto text-[11px] text-gray-500 inline-flex items-center gap-1">
          <Info size={12} /> Hidden rows won't be shown to the user. Disabled rows are shown as read-only.
        </div>
      </div>

      {/* Accordions */}
      <div className="mt-3 space-y-3">
        {catalog.map((m) => (
          <ModuleAccordion
            key={m.key}
            mod={m}
            state={state[m.key] || emptyModuleState(m)}
            expanded={!!expanded[m.key]}
            onToggle={() => setExpanded((e) => ({ ...e, [m.key]: !e[m.key] }))}
            onChangeFeature={(fkey, rw, next) => changeFeature(m.key, fkey, rw, next)}
            onChangeAction={(akey, next) => changeAction(m.key, akey, next)}
            search={search}
            onSelectAll={() => selectAllInModule(m.key)}
            onDeselectAll={() => clearModule(m.key)}
          />
        ))}
      </div>

      {/* Modals */}
      <CopyFromDialog open={copyOpen} onOpenChange={setCopyOpen} onCopy={doCopyFrom} />
      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} effective={effective} title={title} />
      <AuditDialog open={auditOpen} onOpenChange={setAuditOpen} resourceId={editingId} />
    </Layout>
  );
}
