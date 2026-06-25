import React, { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import api from "../lib/api";
import Layout from "../components/Layout";
import notify from "../lib/notify";
import {
  ArrowLeft, Pencil, Save, Loader2, Shield, Briefcase, Armchair,
  ChevronDown, ChevronRight, X, HelpCircle,
} from "lucide-react";

/**
 * Permission Set Detail Page (v3)
 *
 * Shows the full editor with all permissions of the set preselected.
 * Toggle Edit ↔ View mode using the Edit button in the top-right corner.
 * In View mode, checkboxes are disabled; in Edit mode they are interactive
 * and a Save button appears.
 *
 * Scoped ProfiX actions (view/edit/assign/approve) show a Respective/Team/All
 * dropdown next to the toggle when enabled.
 */

const MODULE_META = {
  profix: { label: "ProfiX Features", icon: Briefcase, color: "#ec9324" },
  desk_booking: { label: "Desk Booking Features", icon: Armchair, color: "#3b82f6" },
};

const SCOPE_OPTIONS = [
  { value: "respective", label: "Respective" },
  { value: "team", label: "Team" },
  { value: "all", label: "All" },
];

const FALLBACK_SCOPED = { profix: new Set(["view", "edit", "assign", "approve"]) };

function isScopedAction(moduleSchema, feature, action) {
  if (feature && Array.isArray(feature.scoped_actions)) {
    return feature.scoped_actions.includes(action);
  }
  return FALLBACK_SCOPED[moduleSchema?.key]?.has(action) || false;
}

// Action is "on" if its raw value is truthy or any scope string.
const isOn = (v) => v === true || v === "respective" || v === "team" || v === "all";

function emptyModulesFromSchema(schema) {
  const out = {};
  for (const m of (schema || [])) {
    out[m.key] = {};
    for (const g of (m.groups || [])) {
      for (const f of (g.features || [])) {
        out[m.key][f.key] = {};
        for (const a of (f.actions || [])) out[m.key][f.key][a] = false;
      }
    }
  }
  return out;
}

function mergeWithSetData(schemaModules, setModules) {
  // Start with all-false from schema, overlay saved-set values verbatim so
  // scope strings ("respective" / "team" / "all") are preserved for the editor.
  const out = { ...schemaModules };
  for (const [mkey, features] of Object.entries(setModules || {})) {
    out[mkey] = out[mkey] || {};
    for (const [fkey, actions] of Object.entries(features || {})) {
      out[mkey][fkey] = { ...(out[mkey][fkey] || {}) };
      for (const [a, v] of Object.entries(actions || {})) {
        // Preserve scope strings; legacy True on a scoped action becomes "all".
        if (v === "respective" || v === "team" || v === "all") {
          out[mkey][fkey][a] = v;
        } else {
          out[mkey][fkey][a] = !!v;
        }
      }
    }
  }
  return out;
}

function ScopeSelect({ value, onChange, disabled, testId }) {
  return (
    <select
      value={value || "respective"}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      data-testid={testId}
      onClick={(e) => e.stopPropagation()}
      className="text-[11px] font-medium border border-[#ec9324]/30 bg-white text-[#ec9324] rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-[#ec9324]/40 disabled:opacity-70 disabled:cursor-default"
    >
      {SCOPE_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function ScopeHelpTooltip() {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        data-testid="pset-detail-scope-help"
        className="p-1 text-gray-400 hover:text-gray-700"
        aria-label="Scope help"
      >
        <HelpCircle size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-30 w-72 rounded-md bg-gray-900 text-white text-xs leading-5 px-3 py-2 shadow-lg">
          <div className="font-semibold mb-1">Access scope</div>
          <div><b>Respective</b> — Self only.</div>
          <div><b>Team</b> — Team-level access.</div>
          <div><b>All</b> — Organisation-wide.</div>
        </div>
      )}
    </span>
  );
}

function ModuleAccordion({ moduleSchema, value, onChange, disabled, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = MODULE_META[moduleSchema.key] || { label: moduleSchema.label, icon: Shield, color: "#6b7280" };
  const Icon = meta.icon;
  const totals = useMemo(() => {
    let total = 0, on = 0;
    for (const g of moduleSchema.groups || []) {
      for (const f of g.features || []) {
        for (const a of f.actions || []) {
          total += 1;
          if (isOn(((value || {})[f.key] || {})[a])) on += 1;
        }
      }
    }
    return { total, on };
  }, [moduleSchema, value]);

  const toggle = (feature, action, enabled) => {
    if (disabled) return;
    let next;
    if (enabled) {
      next = isScopedAction(moduleSchema, feature, action) ? "respective" : true;
    } else {
      next = false;
    }
    onChange({
      ...(value || {}),
      [feature.key]: { ...((value || {})[feature.key] || {}), [action]: next },
    });
  };

  const setScope = (feature, action, scope) => {
    if (disabled) return;
    onChange({
      ...(value || {}),
      [feature.key]: { ...((value || {})[feature.key] || {}), [action]: scope },
    });
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid={`pset-detail-accordion-${moduleSchema.key}`}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${meta.color}15`, color: meta.color }}>
            <Icon size={20} />
          </div>
          <div className="text-left">
            <div className="font-semibold text-gray-900">{meta.label}</div>
            <div className="text-xs text-gray-500">{totals.on}/{totals.total} permissions enabled</div>
          </div>
        </div>
        {open ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronRight size={18} className="text-gray-400" />}
      </button>
      {open && (
        <div className="border-t border-gray-100">
          {(moduleSchema.groups || []).map((g) => (
            <div key={g.key} className="px-5 py-4 border-b border-gray-100 last:border-b-0">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">{g.label}</div>
              <div className="space-y-2">
                {(g.features || []).map((f) => {
                  const featureVal = (value || {})[f.key] || {};
                  return (
                    <div key={f.key} className="flex items-center justify-between gap-4 py-2.5 px-3 rounded-lg hover:bg-gray-50">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900">{f.label}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        {(f.actions || []).map((a) => {
                          const raw = featureVal[a];
                          const on = isOn(raw);
                          const scoped = isScopedAction(moduleSchema, f, a);
                          return (
                            <span key={a} className="inline-flex items-center gap-1">
                              <label
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                                  on ? "bg-[#ec9324]/10 border-[#ec9324]/30 text-[#ec9324]" : "bg-white border-gray-200 text-gray-600"
                                } ${disabled ? "opacity-80 cursor-default" : "cursor-pointer hover:border-gray-300"}`}
                              >
                                <input
                                  type="checkbox"
                                  className="sr-only"
                                  checked={on}
                                  disabled={disabled}
                                  onChange={(e) => toggle(f, a, e.target.checked)}
                                  data-testid={`pset-detail-cb-${moduleSchema.key}-${f.key}-${a}`}
                                />
                                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center pointer-events-none ${on ? "bg-[#ec9324] border-[#ec9324]" : "border-gray-300"}`}>
                                  {on && <span className="w-1.5 h-1.5 bg-white rounded-sm" />}
                                </span>
                                {a.charAt(0).toUpperCase() + a.slice(1)}
                              </label>
                              {scoped && on && (
                                <ScopeSelect
                                  testId={`pset-detail-scope-${moduleSchema.key}-${f.key}-${a}`}
                                  value={typeof raw === "string" ? raw : "all"}
                                  onChange={(v) => setScope(f, a, v)}
                                  disabled={disabled}
                                />
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PermissionSetDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [schema, setSchema] = useState([]);
  const [pset, setPset] = useState(null);
  const [modules, setModules] = useState({});
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const editMode = params.get("edit") === "1";
  const setEditMode = (on) => {
    const next = new URLSearchParams(params);
    if (on) next.set("edit", "1"); else next.delete("edit");
    setParams(next, { replace: true });
  };

  const load = async () => {
    setLoading(true);
    try {
      const [sRes, pRes] = await Promise.all([
        api.get("/permissions/schema"),
        api.get(`/permission-sets/${id}`),
      ]);
      const sch = Array.isArray(sRes.data) ? sRes.data : (sRes.data?.modules || []);
      const p = pRes.data;
      setSchema(sch);
      setPset(p);
      setName(p.name || "");
      setDescription(p.description || "");
      setModules(mergeWithSetData(emptyModulesFromSchema(sch), p.modules || {}));
    } catch (e) {
      notify.error("Permission Set not found");
      navigate("/admin/permission-sets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const handleSave = async () => {
    if (!name.trim()) { notify.error("Name is required"); return; }
    setSaving(true);
    try {
      const r = await api.patch(`/permission-sets/${id}`, {
        name: name.trim(),
        description: description.trim(),
        modules,
      });
      setPset(r.data);
      notify.success("Permission Set updated");
      setEditMode(false);
    } catch (e) {
      notify.error(e?.response?.data?.detail || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    // Reload original from server and exit edit mode
    setModules(mergeWithSetData(emptyModulesFromSchema(schema), pset?.modules || {}));
    setName(pset?.name || "");
    setDescription(pset?.description || "");
    setEditMode(false);
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-[#ec9324]" size={32} /></div>
      </Layout>
    );
  }

  return (
    <Layout
      title={pset?.name || "Permission Set"}
      actions={
        <div className="flex items-center gap-2">
          <ScopeHelpTooltip />
          {editMode ? (
            <>
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={saving}
                data-testid="pset-detail-cancel"
                className="inline-flex items-center justify-center h-9 w-9 rounded-md text-gray-700 hover:bg-gray-100"
                title="Cancel"
                aria-label="Cancel"
              ><X size={16} /></button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                data-testid="pset-detail-save"
                className="inline-flex items-center gap-2 px-4 h-9 rounded-md text-sm font-medium bg-[#ec9324] text-white hover:bg-[#d8851f] disabled:opacity-50"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                <Save size={14} /> Save Changes
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditMode(true)}
              data-testid="pset-detail-edit"
              className="inline-flex items-center justify-center h-9 w-9 rounded-md bg-[#ec9324] text-white hover:bg-[#d8851f]"
              title="Edit"
              aria-label="Edit"
            ><Pencil size={16} /></button>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <button
            onClick={() => navigate("/admin/permission-sets")}
            data-testid="pset-detail-back"
            className="p-2 rounded-lg hover:bg-gray-100 mt-0.5"
            title="Back to list"
          ><ArrowLeft size={18} /></button>
          <div>
            <div className="text-xs text-gray-500 font-mono mb-1">PERMISSION SET #{pset?.numeric_id}</div>
            {editMode && (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="pset-detail-name-input"
                className="text-xl font-bold text-gray-900 bg-transparent border-b-2 border-[#ec9324]/40 focus:border-[#ec9324] focus:outline-none px-1"
              />
            )}
            <div className="text-sm text-gray-500 mt-1">
              Created by <strong className="text-gray-700">{pset?.created_by?.name || "—"}</strong>
              {" · "}{new Date(pset?.created_at).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Description</div>
          {editMode ? (
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              data-testid="pset-detail-desc-input"
              placeholder="Optional — describe what this set unlocks"
              className="w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#ec9324]/40 text-sm"
            />
          ) : (
            <div className="text-sm text-gray-700">
              {pset?.description || <span className="text-gray-400 italic">No description</span>}
            </div>
          )}
        </div>

        {/* Editor */}
        <div className="space-y-4">
          {schema.map((m) => (
            <ModuleAccordion
              key={m.key}
              moduleSchema={m}
              value={modules[m.key] || {}}
              onChange={(next) => setModules((prev) => ({ ...prev, [m.key]: next }))}
              disabled={!editMode}
            />
          ))}
        </div>
      </div>
    </Layout>
  );
}
