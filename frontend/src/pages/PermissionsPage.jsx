/**
 * PermissionsPage (v3 — Module ▸ Page ▸ Functions)
 *
 * Layout
 *   Each module is an accordion. When expanded it renders a master-detail
 *   split: left rail = pages, right pane = the selected page's config
 *   (View / Edit cards + Functions table + Live preview strip).
 *
 * API
 *   GET /api/permissions/schema/v3
 *   GET/POST/PUT/DELETE /api/permission-sets-v3[/id]
 *   GET /api/permission-sets-v3/{id}/clone-payload
 *   GET /api/permissions/preview/{id}
 *   GET /api/permissions/audit
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Save, Loader2, Search, ChevronDown, ChevronRight, ChevronsDown, ChevronsUp,
  Copy, Eye, EyeOff, Briefcase, Armchair, History, Sparkles, Plus,
  RefreshCw, CheckCircle2, Settings,
} from "lucide-react";
import api from "../lib/api";
import Layout from "../components/Layout";
import notify from "../lib/notify";
import SingleSelect from "../components/SingleSelect";
import OrangeCheckbox from "../components/OrangeCheckbox";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent } from "../components/ui/dialog";

const SCOPE_OPTS = [
  { value: "individual", label: "Individual" },
  { value: "team",       label: "Team" },
  { value: "overall",    label: "Overall" },
];

const emptyRW = () => ({ enabled: false, visible: true, scope: null });

function emptyPageState(page) {
  const functions = {};
  for (const f of page.functions || []) functions[f.key] = emptyRW();
  return { view: emptyRW(), edit: emptyRW(), functions };
}
function emptyModuleState(mod) {
  const pages = {};
  for (const p of mod.pages || []) pages[p.key] = emptyPageState(p);
  return { pages };
}
function emptyStateFromCatalog(mods) {
  const out = {};
  for (const m of mods || []) out[m.key] = emptyModuleState(m);
  return out;
}
function mergeStateWithCatalog(catalog, incoming) {
  const base = emptyStateFromCatalog(catalog);
  if (!incoming) return base;
  for (const m of catalog) {
    const srcModule = incoming[m.key] || {};
    const srcPages = srcModule.pages || {};
    for (const p of m.pages || []) {
      const srcP = srcPages[p.key] || {};
      const dstP = base[m.key].pages[p.key];
      dstP.view = { ...emptyRW(), ...(srcP.view || {}) };
      dstP.edit = { ...emptyRW(), ...(srcP.edit || {}) };
      for (const f of p.functions || []) {
        const srcF = (srcP.functions || {})[f.key] || {};
        dstP.functions[f.key] = { ...emptyRW(), ...srcF };
      }
    }
  }
  return base;
}

// ------------- small controls
function ScopeSelect({ value, onChange, disabled, testId, size = "sm" }) {
  return (
    <SingleSelect
      options={SCOPE_OPTS}
      value={value || null}
      onChange={(v) => onChange(v || null)}
      placeholder="— scope —"
      disabled={disabled}
      testId={testId}
      size={size}
      allowClear
    />
  );
}

function VisChip({ visible, onClick, testId }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      title={visible ? "Visible — click to hide" : "Hidden — click to show"}
      className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded px-2 py-0.5 border ${
        visible ? "border-gray-200 text-gray-700 bg-white hover:border-gray-400"
                : "border-red-200 text-red-700 bg-red-50 hover:bg-red-100"
      }`}>
      {visible ? <Eye size={12} /> : <EyeOff size={12} />}
      {visible ? "Shown" : "Hidden"}
    </button>
  );
}

// ------------- PageDetail (right pane)
function PageDetail({ page, state, onView, onEdit, onFunction, onEnableAll, onHideAll }) {
  const fnCount = (page.functions || []).length;
  const enabledCount = Object.values(state.functions || {}).filter((f) => f.enabled).length;
  return (
    <div className="p-5">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-lg font-bold text-gray-900">{page.label}</h3>
        <span className="text-[10px] font-mono text-gray-500 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded">{page.route}</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={onEnableAll} className="text-[10px] font-semibold px-2 py-0.5 rounded border border-gray-200 text-gray-700 hover:border-[#ec9324]" data-testid="page-enable-all">Enable all</button>
          <button type="button" onClick={onHideAll}   className="text-[10px] font-semibold px-2 py-0.5 rounded border border-gray-200 text-gray-700 hover:border-[#ec9324]" data-testid="page-hide-all">Hide all</button>
        </div>
      </div>

      {/* View / Edit cards */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        {["view", "edit"].map((kind) => {
          const v = state[kind] || emptyRW();
          const onCh = kind === "view" ? onView : onEdit;
          const Icon = kind === "view" ? Eye : (props) => <Sparkles {...props} />;
          return (
            <div key={kind}
                 className={`rounded-lg border p-3 transition-colors ${v.enabled ? "border-[#ec9324]/40 bg-orange-50/50" : "border-gray-200 bg-white"}`}
                 data-testid={`page-${kind}-card`}>
              <div className="flex items-center justify-between mb-2">
                <div className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-900 capitalize">
                  <Icon size={14} className="text-[#ec9324]" /> {kind}
                </div>
                <div className="flex items-center gap-1.5">
                  <VisChip visible={!!v.visible} onClick={() => onCh({ ...v, visible: !v.visible })} testId={`page-${kind}-vis`} />
                  <OrangeCheckbox
                    checked={!!v.enabled}
                    onChange={(c) => onCh({ ...v, enabled: c })}
                    testId={`page-${kind}-enable`}
                    ariaLabel={`Enable ${kind}`}
                  />
                </div>
              </div>
              <ScopeSelect
                value={v.scope}
                onChange={(s) => onCh({ ...v, scope: s })}
                disabled={!v.enabled || !v.visible}
                testId={`page-${kind}-scope`}
                size="md"
              />
            </div>
          );
        })}
      </div>

      {/* Functions */}
      <div className="mt-5">
        <div className="flex items-center gap-2 mb-2">
          <div className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">Functions / Action buttons on this page</div>
          <div className="ml-auto text-[10px] text-gray-500">{enabledCount}/{fnCount} enabled</div>
        </div>
        {fnCount === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-xs text-gray-400">
            No configurable functions on this page.
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm" data-testid="page-functions-table">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-gray-700 w-[40%]">Function</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-700">Enable</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-700">Visibility</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-700">Scope</th>
                </tr>
              </thead>
              <tbody>
                {(page.functions || []).map((f, i) => {
                  const v = state.functions?.[f.key] || emptyRW();
                  return (
                    <tr key={f.key} className={i % 2 ? "bg-white" : "bg-gray-50/40"} data-testid={`fn-row-${f.key}`}>
                      <td className="px-3 py-3 align-middle">
                        <div className="font-medium text-gray-900 text-sm">{f.label}</div>
                      </td>
                      <td className="px-3 py-3">
                        <OrangeCheckbox
                          checked={!!v.enabled}
                          onChange={(c) => onFunction(f.key, { ...v, enabled: c })}
                          testId={`fn-enable-${f.key}`}
                          ariaLabel={`Enable ${f.label}`}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <VisChip visible={!!v.visible}
                          onClick={() => onFunction(f.key, { ...v, visible: !v.visible })}
                          testId={`fn-vis-${f.key}`} />
                      </td>
                      <td className="px-3 py-3">
                        {f.scoped ? (
                          <ScopeSelect
                            value={v.scope}
                            onChange={(s) => onFunction(f.key, { ...v, scope: s })}
                            disabled={!v.enabled || !v.visible}
                            testId={`fn-scope-${f.key}`}
                          />
                        ) : <span className="text-[10px] text-gray-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Live preview strip */}
      <div className="mt-5 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3" data-testid="page-preview-strip">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={14} className="text-[#ec9324]" />
          <div className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">What the user will see on this page</div>
        </div>
        <div className="rounded-md border border-gray-200 bg-white p-2 flex items-center gap-2 flex-wrap">
          <div className="text-sm font-semibold text-gray-800 mr-auto">{page.label}</div>
          {(page.functions || []).filter((f) => {
            const v = state.functions?.[f.key] || emptyRW();
            return v.enabled && v.visible;
          }).map((f) => (
            <span key={f.key} className="inline-flex items-center gap-1 h-7 px-2.5 rounded bg-[#ec9324]/10 text-[#ec9324] border border-[#ec9324]/30 text-[11px] font-semibold">
              {f.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------- ModuleAccordion (master-detail)
function ModuleAccordion({ mod, state, expanded, onToggle, search, onSelectAll, onClear, updateState }) {
  const Icon = mod.key === "profix" ? Briefcase : (mod.key === "manage" ? Settings : Armchair);
  const [selectedPageKey, setSelectedPageKey] = useState((mod.pages || [])[0]?.key);
  const q = search.trim().toLowerCase();

  const filteredPages = useMemo(() => (mod.pages || []).filter((p) => {
    if (!q) return true;
    if (p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)) return true;
    // match nested function name too
    return (p.functions || []).some((f) => f.label.toLowerCase().includes(q));
  }), [mod, q]);

  useEffect(() => {
    if (!filteredPages.find((p) => p.key === selectedPageKey)) {
      setSelectedPageKey(filteredPages[0]?.key);
    }
  }, [filteredPages, selectedPageKey]);

  const pageConfigured = (pk) => {
    const s = state.pages?.[pk];
    if (!s) return false;
    return s.view?.enabled || s.edit?.enabled || Object.values(s.functions || {}).some((f) => f.enabled);
  };
  const configuredCount = (mod.pages || []).filter((p) => pageConfigured(p.key)).length;
  const totalEnabledFns = Object.values(state.pages || {}).reduce(
    (n, ps) => n + Object.values(ps.functions || {}).filter((f) => f.enabled).length, 0);

  const selectedPage = filteredPages.find((p) => p.key === selectedPageKey) || filteredPages[0];
  const pageState = state.pages?.[selectedPage?.key] || emptyPageState(selectedPage || { functions: [] });

  const setPageField = (kind, next) => {
    updateState((prev) => {
      const nm = { ...(prev[mod.key] || { pages: {} }) };
      const np = { ...(nm.pages || {}) };
      const cur = np[selectedPage.key] || emptyPageState(selectedPage);
      np[selectedPage.key] = { ...cur, [kind]: next };
      return { ...prev, [mod.key]: { pages: np } };
    });
  };
  const setPageFunction = (fkey, next) => {
    updateState((prev) => {
      const nm = { ...(prev[mod.key] || { pages: {} }) };
      const np = { ...(nm.pages || {}) };
      const cur = np[selectedPage.key] || emptyPageState(selectedPage);
      np[selectedPage.key] = { ...cur, functions: { ...(cur.functions || {}), [fkey]: next } };
      return { ...prev, [mod.key]: { pages: np } };
    });
  };
  const enableAllOnPage = () => {
    updateState((prev) => {
      const nm = { ...(prev[mod.key] || { pages: {} }) };
      const np = { ...(nm.pages || {}) };
      const fns = {};
      for (const f of selectedPage.functions || []) fns[f.key] = { enabled: true, visible: true, scope: f.scoped ? "overall" : null };
      np[selectedPage.key] = {
        view: { enabled: true, visible: true, scope: "overall" },
        edit: { enabled: true, visible: true, scope: "overall" },
        functions: fns,
      };
      return { ...prev, [mod.key]: { pages: np } };
    });
  };
  const hideAllOnPage = () => {
    updateState((prev) => {
      const nm = { ...(prev[mod.key] || { pages: {} }) };
      const np = { ...(nm.pages || {}) };
      const cur = np[selectedPage.key] || emptyPageState(selectedPage);
      const fns = {};
      for (const [k, v] of Object.entries(cur.functions || {})) fns[k] = { ...v, visible: false };
      np[selectedPage.key] = {
        view: { ...(cur.view || emptyRW()), visible: false },
        edit: { ...(cur.edit || emptyRW()), visible: false },
        functions: fns,
      };
      return { ...prev, [mod.key]: { pages: np } };
    });
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden" data-testid={`perm-mod-${mod.key}`}>
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50" data-testid={`perm-mod-toggle-${mod.key}`}>
        <span className="h-9 w-9 rounded-md inline-flex items-center justify-center" style={{ background: `${mod.color}15`, color: mod.color }}>
          <Icon size={16} />
        </span>
        <div className="flex-1 text-left">
          <div className="font-bold text-sm text-gray-900">{mod.label}</div>
        </div>
        <button type="button" onClick={(e) => { e.stopPropagation(); onSelectAll(); }} className="text-[11px] font-semibold text-[#ec9324] hover:underline px-1.5" data-testid={`mod-select-all-${mod.key}`}>Select all</button>
        <button type="button" onClick={(e) => { e.stopPropagation(); onClear(); }}    className="text-[11px] font-semibold text-gray-500 hover:underline px-1.5" data-testid={`mod-clear-${mod.key}`}>Clear</button>
        {expanded ? <ChevronDown size={16} className="text-gray-400 ml-1" /> : <ChevronRight size={16} className="text-gray-400 ml-1" />}
      </button>

      {expanded && (
        <div className="border-t border-gray-100 grid grid-cols-12 divide-x divide-gray-100">
          {/* LEFT rail: pages */}
          <div className="col-span-12 md:col-span-3 bg-gray-50/60 max-h-[720px] overflow-y-auto">
            <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-gray-500 font-bold">Pages</div>
            {filteredPages.length === 0 && (
              <div className="p-4 text-center text-xs text-gray-400">No pages match your search.</div>
            )}
            {filteredPages.map((p) => {
              const configured = pageConfigured(p.key);
              const active = p.key === selectedPage?.key;
              return (
                <button key={p.key} type="button"
                  onClick={() => setSelectedPageKey(p.key)}
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-2 border-l-2 ${
                    active ? "border-[#ec9324] bg-white" : "border-transparent hover:bg-white"
                  }`}
                  data-testid={`page-item-${mod.key}-${p.key}`}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">{p.label}</div>
                  </div>
                  {configured && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Configured</span>
                  )}
                </button>
              );
            })}
          </div>
          {/* RIGHT pane: selected page detail */}
          <div className="col-span-12 md:col-span-9">
            {selectedPage ? (
              <PageDetail
                page={selectedPage}
                state={pageState}
                onView={(next) => setPageField("view", next)}
                onEdit={(next) => setPageField("edit", next)}
                onFunction={setPageFunction}
                onEnableAll={enableAllOnPage}
                onHideAll={hideAllOnPage}
              />
            ) : (
              <div className="p-12 text-center text-sm text-gray-400">Select a page on the left.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------- Diff helpers (Round 2)
// Compute a flat diff between two `state`-shaped module trees. Returns rows of:
//   { module, page, kind: "view"|"edit"|"function", label, before, after, change }
// where change is "added", "removed", "changed", or "unchanged".
function fmtRW(v) {
  if (!v) return "—";
  const bits = [];
  bits.push(v.enabled ? "on" : "off");
  bits.push(v.visible ? "shown" : "hidden");
  if (v.scope) bits.push(v.scope);
  return bits.join(" · ");
}
function sameRW(a, b) {
  const va = a || emptyRW(), vb = b || emptyRW();
  return !!va.enabled === !!vb.enabled && !!va.visible === !!vb.visible && (va.scope || null) === (vb.scope || null);
}
function computeDiff(catalog, before, after) {
  const rows = [];
  for (const m of catalog || []) {
    for (const p of m.pages || []) {
      const bp = ((before || {})[m.key]?.pages || {})[p.key];
      const ap = ((after  || {})[m.key]?.pages || {})[p.key];
      for (const kind of ["view", "edit"]) {
        const bv = bp?.[kind], av = ap?.[kind];
        if (!bv && !av) continue;
        if (sameRW(bv, av)) continue;
        rows.push({
          module: m.label, page: p.label, kind, label: kind === "view" ? "View" : "Edit",
          before: fmtRW(bv), after: fmtRW(av),
          change: !bv?.enabled && av?.enabled ? "added" : (bv?.enabled && !av?.enabled ? "removed" : "changed"),
        });
      }
      for (const f of p.functions || []) {
        const bf = bp?.functions?.[f.key], af = ap?.functions?.[f.key];
        if (!bf && !af) continue;
        if (sameRW(bf, af)) continue;
        rows.push({
          module: m.label, page: p.label, kind: "function", label: f.label,
          before: fmtRW(bf), after: fmtRW(af),
          change: !bf?.enabled && af?.enabled ? "added" : (bf?.enabled && !af?.enabled ? "removed" : "changed"),
        });
      }
    }
  }
  return rows;
}
function DiffTable({ rows }) {
  if (!rows.length) {
    return <div className="text-xs text-gray-400 text-center py-6">No changes — the two configurations match.</div>;
  }
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden" data-testid="perm-diff-table">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left px-3 py-2 font-semibold text-gray-700">Change</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-700">Where</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-700">Before</th>
            <th className="text-left px-3 py-2 font-semibold text-gray-700">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const badge = {
              added:    "bg-emerald-50 text-emerald-700 border-emerald-200",
              removed:  "bg-red-50 text-red-700 border-red-200",
              changed:  "bg-amber-50 text-amber-700 border-amber-200",
              unchanged:"bg-gray-50 text-gray-500 border-gray-200",
            }[r.change] || "bg-gray-50 text-gray-500 border-gray-200";
            return (
              <tr key={i} className={i % 2 ? "bg-white" : "bg-gray-50/40"}>
                <td className="px-3 py-2 align-top">
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${badge}`}>{r.change}</span>
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="text-[11px] text-gray-500">{r.module} ▸ {r.page}</div>
                  <div className="text-sm font-medium text-gray-900">{r.label}</div>
                </td>
                <td className="px-3 py-2 align-top text-[11px] font-mono text-gray-700">{r.before}</td>
                <td className="px-3 py-2 align-top text-[11px] font-mono text-gray-900">{r.after}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ------------- Copy / Preview / Audit dialogs (small)
function CopyFromDialog({ open, onOpenChange, onCopy, catalog, currentState }) {
  const [items, setItems] = useState([]); const [q, setQ] = useState(""); const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null); // { id, title, description, modules } once user picks a set
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { if (!open) return; setLoading(true); setPreview(null);
    api.get("/permission-sets", { params: { q } }).then((r) => setItems(r.data || [])).finally(() => setLoading(false));
  }, [open, q]);

  const pickSet = async (id) => {
    try {
      const { data } = await api.get(`/permission-sets-v3/${id}/clone-payload`);
      // Normalize incoming modules against the catalog so unknown keys are stripped
      const normalized = mergeStateWithCatalog(catalog || [], data.modules);
      setPreview({ id, title: data.title, description: data.description || "", modules: normalized });
    } catch (e) { notify.error(e, { what: "Load set for copy" }); }
  };

  const applyCopy = () => {
    if (!preview) return;
    setConfirming(true);
    try { onCopy(preview); onOpenChange(false); } finally { setConfirming(false); }
  };

  const diffRows = useMemo(
    () => preview ? computeDiff(catalog, currentState, preview.modules) : [],
    [preview, catalog, currentState]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden" data-testid="perm-copy-dialog">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center gap-2">
          <Copy size={16} className="text-[#ec9324]" />
          <div className="flex-1">
            <div className="font-semibold text-gray-900">
              {preview ? `Review changes — Copy from "${preview.title}"` : "Copy from an existing Permission Set"}
            </div>
            <div className="text-xs text-gray-500">
              {preview
                ? "Confirm the differences that will replace your current draft."
                : "Pick a set to copy from. You'll see a diff before we apply anything."}
            </div>
          </div>
          {preview && (
            <button type="button" onClick={() => setPreview(null)} className="text-[11px] font-semibold text-gray-500 hover:underline">
              ← Pick different set
            </button>
          )}
        </div>

        {!preview ? (
          <>
            <div className="px-5 py-3 border-b border-gray-100">
              <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
                  className="w-full h-9 pl-9 pr-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#ec9324]/30 focus:border-[#ec9324]" /></div>
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              {loading && <div className="p-6 text-center text-xs text-gray-400"><Loader2 className="animate-spin inline mr-1.5" size={13} /> Loading…</div>}
              {!loading && items.length === 0 && <div className="p-8 text-center text-xs text-gray-400">No permission sets found.</div>}
              {!loading && items.map((p) => (
                <button key={p.id} type="button" onClick={() => pickSet(p.id)}
                  className="w-full flex items-start gap-3 px-5 py-3 border-b border-gray-100 hover:bg-orange-50/60 text-left" data-testid={`perm-copy-item-${p.id}`}>
                  <span className="h-8 w-8 rounded-md bg-orange-50 border border-orange-200 inline-flex items-center justify-center text-[#ec9324]"><Copy size={14} /></span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900">{p.title}</div>
                    <div className="text-[11px] text-gray-500 truncate">{p.description || "—"}<span className="ml-2 text-[10px] px-1 py-0.5 rounded bg-gray-100">v{p.version || 1}</span></div>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="p-5 max-h-[440px] overflow-y-auto">
              <div className="text-[11px] uppercase tracking-widest text-gray-500 font-bold mb-2">
                {diffRows.length} change{diffRows.length === 1 ? "" : "s"} will be applied
              </div>
              <DiffTable rows={diffRows} />
            </div>
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/60 flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setPreview(null)} className="rounded-md">Cancel</Button>
              <Button onClick={applyCopy} disabled={confirming} className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="perm-copy-confirm">
                {confirming ? <Loader2 className="animate-spin mr-1.5" size={13} /> : <CheckCircle2 size={13} className="mr-1.5" />}
                Apply copy
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewDialog({ open, onOpenChange, effective, beforeEffective, title, catalog, showDiff }) {
  const [tab, setTab] = useState("effective"); // "effective" | "diff"
  useEffect(() => { if (open) setTab(showDiff ? "diff" : "effective"); }, [open, showDiff]);
  // Build a synthetic module-shaped tree from an "effective" preview so
  // computeDiff (which walks the catalog) can consume it.
  const effToState = (eff) => {
    const out = {};
    for (const [mkey, m] of Object.entries(eff || {})) {
      const pages = {};
      for (const [pkey, p] of Object.entries(m.pages || {})) {
        const fns = {};
        for (const [fkey, fv] of Object.entries(p.functions || {})) {
          fns[fkey] = { enabled: !!fv.enabled, visible: true, scope: fv.scope || null };
        }
        pages[pkey] = {
          view: p.view ? { enabled: !!p.view.enabled, visible: true, scope: p.view.scope || null } : emptyRW(),
          edit: p.edit ? { enabled: !!p.edit.enabled, visible: true, scope: p.edit.scope || null } : emptyRW(),
          functions: fns,
        };
      }
      out[mkey] = { pages };
    }
    return out;
  };
  const diffRows = useMemo(() => {
    if (!showDiff) return [];
    return computeDiff(catalog || [], effToState(beforeEffective || {}), effToState(effective || {}));
  }, [catalog, beforeEffective, effective, showDiff]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden" data-testid="perm-preview-dialog">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center gap-2">
          <Sparkles size={16} className="text-[#ec9324]" />
          <div className="flex-1"><div className="font-semibold text-gray-900">Effective permissions preview</div>
          <div className="text-xs text-gray-500">What a user assigned to <b>{title || "this set"}</b> will actually see & do.</div></div>
          {showDiff && (
            <div className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white p-0.5">
              <button type="button" onClick={() => setTab("effective")} data-testid="preview-tab-effective"
                className={`h-7 px-2.5 rounded text-[11px] font-semibold ${tab === "effective" ? "bg-[#ec9324] text-white" : "text-gray-700 hover:bg-gray-50"}`}>Effective</button>
              <button type="button" onClick={() => setTab("diff")} data-testid="preview-tab-diff"
                className={`h-7 px-2.5 rounded text-[11px] font-semibold ${tab === "diff" ? "bg-[#ec9324] text-white" : "text-gray-700 hover:bg-gray-50"}`}>What changes ({diffRows.length})</button>
            </div>
          )}
        </div>

        <div className="p-5 max-h-[520px] overflow-y-auto space-y-3">
          {tab === "diff" ? (
            <>
              <div className="text-[11px] uppercase tracking-widest text-gray-500 font-bold mb-1">Changes since last save</div>
              <DiffTable rows={diffRows} />
            </>
          ) : (
            <>
              {Object.keys(effective || {}).length === 0 && <div className="text-xs text-gray-400 text-center py-6">Nothing enabled yet.</div>}
              {Object.entries(effective || {}).map(([mkey, m]) => (
                <div key={mkey} className="rounded-lg border border-gray-200">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 text-sm font-bold text-gray-800">{mkey}</div>
                  <div className="p-3 space-y-2">
                    {Object.entries(m.pages || {}).map(([pkey, p]) => (
                      <div key={pkey} className="rounded border border-gray-100 p-2">
                        <div className="text-sm font-semibold text-gray-900">{pkey}</div>
                        <div className="text-[11px] text-gray-600 mt-0.5">
                          {p.view?.enabled ? `View (${p.view.scope || "—"})` : "View ✗"}{" · "}
                          {p.edit?.enabled ? `Edit (${p.edit.scope || "—"})` : "Edit ✗"}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {Object.entries(p.functions || {}).filter(([, v]) => v.enabled).map(([fkey, v]) => (
                            <span key={fkey} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {fkey}{v.scope ? ` · ${v.scope}` : ""}
                            </span>
                          ))}
                          {Object.entries(p.functions || {}).filter(([, v]) => v.enabled).length === 0 && (
                            <span className="text-[10px] text-gray-400">No functions enabled.</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AuditLogTab({ resourceId, catalog, focusResourceId, onClearResource }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expanded, setExpanded] = useState({}); // rowIndex -> bool
  const [setFilter, setSetFilter] = useState(focusResourceId || "");
  const [sets, setSets] = useState([]);

  useEffect(() => { if (focusResourceId) setSetFilter(focusResourceId); }, [focusResourceId]);

  // Load list of permission sets for the filter dropdown
  useEffect(() => {
    api.get("/permission-sets").then((r) => setSets(r.data || [])).catch(() => setSets([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 200 };
      if (setFilter) params.resource_id = setFilter;
      if (q) params.q = q;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const { data } = await api.get("/permissions/audit", { params });
      setRows(data.rows || []);
      setTotal(data.total || 0);
    } catch (e) {
      notify.error(e, { what: "Load audit log" });
      setRows([]); setTotal(0);
    } finally { setLoading(false); }
  }, [setFilter, q, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const actionMeta = (action) => {
    if (action === "permission_set.create") return { label: "Created", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    if (action === "permission_set.update") return { label: "Updated", cls: "bg-amber-50 text-amber-700 border-amber-200" };
    if (action === "permission_set.delete") return { label: "Deleted", cls: "bg-red-50 text-red-700 border-red-200" };
    return { label: action, cls: "bg-gray-50 text-gray-700 border-gray-200" };
  };

  return (
    <div className="mt-3 rounded-2xl border border-gray-200 bg-white shadow-sm" data-testid="perm-audit-tab">
      {/* Filter bar */}
      <div className="p-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search actor, detail or id…"
            className="w-full h-9 pl-9 pr-3 rounded-md border border-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-[#ec9324]/30 focus:border-[#ec9324]"
            data-testid="perm-audit-search" />
        </div>
        <div className="min-w-[220px]">
          <SingleSelect
            testId="perm-audit-set-filter"
            options={[
              { value: "__all__", label: "All permission sets" },
              ...sets.map((s) => ({ value: s.id, label: `#${s.numeric_id || s.seq_no || "?"} · ${s.title}` })),
            ]}
            value={setFilter || "__all__"}
            onChange={(v) => setSetFilter(v === "__all__" ? "" : (v || ""))}
            placeholder="All permission sets"
            size="sm"
            allowClear={false}
            searchable={sets.length > 8}
          />
        </div>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
          className="h-9 px-2 rounded-md border border-gray-300 bg-white text-xs text-gray-800" data-testid="perm-audit-from" />
        <span className="text-[10px] text-gray-400">to</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
          className="h-9 px-2 rounded-md border border-gray-300 bg-white text-xs text-gray-800" data-testid="perm-audit-to" />
        {(q || setFilter || dateFrom || dateTo) && (
          <button type="button" onClick={() => { setQ(""); setSetFilter(""); setDateFrom(""); setDateTo(""); onClearResource?.(); }}
            className="h-9 px-2 rounded-md border border-gray-200 text-[11px] font-semibold text-gray-600 hover:border-[#ec9324] hover:text-[#ec9324]"
            data-testid="perm-audit-clear">Clear filters</button>
        )}
        <button type="button" onClick={load}
          className="ml-auto h-9 px-3 rounded-md border border-gray-200 text-[11px] font-semibold text-gray-700 hover:border-[#ec9324] hover:text-[#ec9324] inline-flex items-center gap-1.5"
          data-testid="perm-audit-refresh"><RefreshCw size={12} /> Refresh</button>
        <div className="text-[10px] text-gray-500 ml-1">{total} entr{total === 1 ? "y" : "ies"}</div>
      </div>

      {/* Timeline body */}
      <div className="p-3 max-h-[calc(100vh-260px)] overflow-y-auto">
        {loading && (
          <div className="text-center text-xs text-gray-400 py-10">
            <Loader2 className="animate-spin inline mr-1.5" size={13} /> Loading audit history…
          </div>
        )}
        {!loading && rows.length === 0 && (
          <div className="text-center text-xs text-gray-400 py-14">No permission changes match these filters.</div>
        )}

        {!loading && rows.length > 0 && (
          <ol className="relative border-l-2 border-gray-100 ml-3 space-y-3">
            {rows.map((r, i) => {
              const meta = actionMeta(r.action);
              const beforeMods = r.metadata?.previous?.modules || null;
              const afterMods  = r.metadata?.next?.modules || null;
              const beforeTitle = r.metadata?.previous?.title;
              const afterTitle  = r.metadata?.next?.title;
              const rows2 = beforeMods || afterMods
                ? computeDiff(catalog, mergeStateWithCatalog(catalog, beforeMods || {}), mergeStateWithCatalog(catalog, afterMods || {}))
                : [];
              const isOpen = !!expanded[i];
              const setLabel = r.target_title || afterTitle || beforeTitle || "(deleted set)";
              return (
                <li key={`${r.created_at}-${i}`} className="ml-4 relative" data-testid={`perm-audit-row-${i}`}>
                  <span className={`absolute -left-[27px] top-2 h-3 w-3 rounded-full border-2 border-white ring-2 ${
                    r.action === "permission_set.create" ? "bg-emerald-500 ring-emerald-200" :
                    r.action === "permission_set.delete" ? "bg-red-500 ring-red-200" :
                    "bg-amber-500 ring-amber-200"
                  }`} />
                  <div className="rounded-lg border border-gray-200 bg-white p-3 hover:border-gray-300">
                    <div className="flex items-start gap-2">
                      <span className={`inline-flex items-center text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${meta.cls}`}>{meta.label}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-900 truncate">
                          {setLabel}
                          {r.resource_id && (
                            <span className="ml-1.5 text-[10px] font-mono text-gray-400">{r.resource_id.slice(0, 12)}…</span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate">{r.detail || r.action}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[11px] text-gray-500">{new Date(r.created_at).toLocaleString()}</div>
                        <div className="text-[10px] text-gray-400">by {r.actor?.name || r.actor?.email || "—"}</div>
                      </div>
                    </div>
                    {(rows2.length > 0 || (beforeTitle && afterTitle && beforeTitle !== afterTitle)) && (
                      <button type="button" onClick={() => setExpanded((e) => ({ ...e, [i]: !e[i] }))}
                        className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[#ec9324] hover:underline"
                        data-testid={`perm-audit-expand-${i}`}>
                        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {isOpen ? "Hide" : "Show"} before/after diff{rows2.length ? ` (${rows2.length})` : ""}
                      </button>
                    )}
                    {isOpen && (
                      <div className="mt-2 space-y-2">
                        {beforeTitle && afterTitle && beforeTitle !== afterTitle && (
                          <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px]">
                            <span className="font-semibold text-amber-800">Title renamed:</span>
                            <span className="ml-1 line-through text-gray-500">{beforeTitle}</span>
                            <span className="mx-1 text-gray-400">→</span>
                            <span className="text-gray-900 font-medium">{afterTitle}</span>
                          </div>
                        )}
                        {rows2.length > 0 && <DiffTable rows={rows2} />}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

// ------------- Main
export default function PermissionsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const editingId = params.get("set");
  const tabParam = params.get("tab") === "audit" ? "audit" : "editor";

  const [tab, setTab] = useState(tabParam);
  useEffect(() => { setTab(tabParam); }, [tabParam]);

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
  const [beforeEffective, setBeforeEffective] = useState(null);
  const [copiedFromId, setCopiedFromId] = useState(null);

  const goToTab = (next) => {
    const p = new URLSearchParams(params);
    if (next === "audit") p.set("tab", "audit"); else p.delete("tab");
    setParams(p);
  };

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/permissions/schema/v3");
        setCatalog(data.modules || []);
        setState(emptyStateFromCatalog(data.modules || []));
        setExpanded(Object.fromEntries((data.modules || []).map((m) => [m.key, true])));
      } catch { notify.error("Could not load permission catalog"); }
    })();
  }, []);

  useEffect(() => {
    if (!editingId || !catalog) return;
    (async () => {
      try {
        const { data } = await api.get(`/permission-sets-v3/${editingId}`);
        setTitle(data.title || "");
        setDescription(data.description || "");
        setState(mergeStateWithCatalog(catalog, data.modules));
      } catch { notify.error("Could not load permission set"); }
    })();
  }, [editingId, catalog]);

  const selectAllInModule = useCallback((mkey) => {
    setState((prev) => {
      const mod = (catalog || []).find((m) => m.key === mkey);
      if (!mod) return prev;
      const pages = {};
      for (const p of mod.pages) {
        const fns = {};
        for (const f of p.functions || []) fns[f.key] = { enabled: true, visible: true, scope: f.scoped ? "overall" : null };
        pages[p.key] = {
          view: { enabled: true, visible: true, scope: "overall" },
          edit: { enabled: true, visible: true, scope: "overall" },
          functions: fns,
        };
      }
      return { ...prev, [mkey]: { pages } };
    });
  }, [catalog]);

  const clearModule = useCallback((mkey) => {
    setState((prev) => {
      const mod = (catalog || []).find((m) => m.key === mkey);
      if (!mod) return prev;
      return { ...prev, [mkey]: emptyModuleState(mod) };
    });
  }, [catalog]);

  const doCopyFrom = async (previewPayload) => {
    // previewPayload: { id, title, description, modules } already normalized
    setTitle(previewPayload.title || "");
    setDescription(previewPayload.description || "");
    setState(previewPayload.modules);
    setCopiedFromId(previewPayload.id);
    setCopyOpen(false);
    notify.success("Permissions copied — you can now tweak & save.");
  };

  const doPreview = async () => {
    // Fetch the saved effective (before) whenever we're editing an existing set
    if (editingId) {
      try {
        const { data } = await api.get(`/permissions/preview/${editingId}`);
        setBeforeEffective(data.effective || {});
      } catch { setBeforeEffective({}); }
    } else {
      setBeforeEffective(null);
    }
    // Compute draft effective locally so it also reflects unsaved edits
    const out = {};
    for (const [mkey, m] of Object.entries(state)) {
      const pages = {};
      for (const [pkey, pdata] of Object.entries(m.pages || {})) {
        if (!pdata.view.visible && !pdata.edit.visible) continue;
        const fns = {};
        for (const [fkey, fdata] of Object.entries(pdata.functions || {})) {
          if (!fdata.visible) continue;
          fns[fkey] = { enabled: fdata.enabled, scope: fdata.scope };
        }
        pages[pkey] = {
          view: pdata.view.visible ? { enabled: pdata.view.enabled, scope: pdata.view.scope } : null,
          edit: pdata.edit.visible ? { enabled: pdata.edit.enabled, scope: pdata.edit.scope } : null,
          functions: fns,
        };
      }
      if (Object.keys(pages).length) out[mkey] = { pages };
    }
    setEffective(out);
    setPreviewOpen(true);
  };

  const doSave = async () => {
    if (!title.trim()) { notify.error("Title is required"); return; }
    setSaving(true);
    try {
      const payload = { title: title.trim(), description, modules: state, copied_from_id: copiedFromId };
      if (editingId) { await api.put(`/permission-sets-v3/${editingId}`, payload); notify.success("Permission set updated"); }
      else {
        const { data } = await api.post("/permission-sets-v3", payload);
        notify.success("Permission set created");
        navigate(`/admin/permissions?set=${data.id}`);
      }
    } catch (e) { notify.error(e, { what: "Save permission set" }); }
    finally { setSaving(false); }
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
          <button type="button" onClick={() => goToTab("audit")} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-200 bg-white text-gray-700 hover:border-[#ec9324] hover:text-[#ec9324] text-xs font-semibold" data-testid="perm-audit-btn"><History size={13} /> Audit log</button>
          {tab === "editor" && (
            <>
              <button type="button" onClick={() => setCopyOpen(true)}  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-200 bg-white text-gray-700 hover:border-[#ec9324] hover:text-[#ec9324] text-xs font-semibold" data-testid="perm-copy-btn"><Copy size={13} /> Copy from set</button>
              <button type="button" onClick={doPreview}                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-200 bg-white text-gray-700 hover:border-[#ec9324] hover:text-[#ec9324] text-xs font-semibold" data-testid="perm-preview-btn"><Sparkles size={13} /> Preview</button>
              <Button onClick={doSave} disabled={saving} className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-9 text-xs font-semibold" data-testid="perm-save-btn">
                {saving ? <Loader2 className="animate-spin mr-1.5" size={13} /> : <Save size={13} className="mr-1.5" />}
                {editingId ? "Update set" : "Save as new set"}
              </Button>
            </>
          )}
        </div>
      }
    >
      {/* Tab bar */}
      <div className="mt-1 mb-3 flex items-end gap-1 border-b border-gray-200" data-testid="perm-tabbar">
        <button type="button" onClick={() => goToTab("editor")} data-testid="perm-tab-editor"
          className={`h-9 px-4 rounded-t-md text-xs font-semibold inline-flex items-center gap-1.5 border border-b-0 ${
            tab === "editor" ? "bg-white border-gray-200 text-[#ec9324]" : "bg-transparent border-transparent text-gray-500 hover:text-gray-800"
          }`}>
          <Sparkles size={13} /> Editor
        </button>
        <button type="button" onClick={() => goToTab("audit")} data-testid="perm-tab-audit"
          className={`h-9 px-4 rounded-t-md text-xs font-semibold inline-flex items-center gap-1.5 border border-b-0 ${
            tab === "audit" ? "bg-white border-gray-200 text-[#ec9324]" : "bg-transparent border-transparent text-gray-500 hover:text-gray-800"
          }`}>
          <History size={13} /> Audit log
        </button>
        <div className="flex-1 border-b border-gray-200 -mb-px" />
      </div>

      {tab === "audit" ? (
        <AuditLogTab
          catalog={catalog}
          focusResourceId={editingId}
          onClearResource={() => {
            const p = new URLSearchParams(params);
            p.delete("set");
            setParams(p);
          }}
        />
      ) : (
        <>
          <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title: e.g. Team Manager — Workspace"
                className="w-full h-9 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#ec9324]/30 focus:border-[#ec9324]"
                data-testid="perm-title"
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description: What this permission set is for"
                className="w-full h-9 px-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#ec9324]/30 focus:border-[#ec9324]"
                data-testid="perm-description"
              />
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search modules, pages, functions…"
                className="w-full h-9 pl-9 pr-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#ec9324]/30 focus:border-[#ec9324]" data-testid="perm-search" />
            </div>
            <button type="button" onClick={() => setExpanded(Object.fromEntries(catalog.map((m) => [m.key, true])))}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-200 bg-white text-gray-700 hover:border-[#ec9324] hover:text-[#ec9324] text-xs font-semibold" data-testid="perm-expand-all"><ChevronsDown size={13} /> Expand all</button>
            <button type="button" onClick={() => setExpanded(Object.fromEntries(catalog.map((m) => [m.key, false])))}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-200 bg-white text-gray-700 hover:border-[#ec9324] hover:text-[#ec9324] text-xs font-semibold" data-testid="perm-collapse-all"><ChevronsUp size={13} /> Collapse all</button>
          </div>

          <div className="mt-3 space-y-3">
            {catalog.map((m) => (
              <ModuleAccordion
                key={m.key} mod={m}
                state={state[m.key] || emptyModuleState(m)}
                expanded={!!expanded[m.key]}
                onToggle={() => setExpanded((e) => ({ ...e, [m.key]: !e[m.key] }))}
                search={search}
                onSelectAll={() => selectAllInModule(m.key)}
                onClear={() => clearModule(m.key)}
                updateState={setState}
              />
            ))}
          </div>
        </>
      )}

      <CopyFromDialog open={copyOpen} onOpenChange={setCopyOpen} onCopy={doCopyFrom} catalog={catalog} currentState={state} />
      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} effective={effective} beforeEffective={beforeEffective} title={title} catalog={catalog} showDiff={!!editingId} />
    </Layout>
  );
}
