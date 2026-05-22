import React, { useEffect, useState, useMemo } from "react";
import api from "../lib/api";
import Layout from "../components/Layout";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  Save, Loader2, Shield, ChevronDown, ChevronRight, Briefcase, Armchair, X,
  ListChecks, Sparkles,
} from "lucide-react";

/**
 * Permissions Page (v3)
 *
 * A single editor with two top-level accordions:
 *   - ProfiX Features
 *   - Desk Booking Features
 *
 * Each accordion lists configurable feature/action checkboxes. Clicking
 * "Save Changes" opens a modal asking for the Permission Set Title and saves
 * the configuration as a new Permission Set via POST /api/permission-sets.
 *
 * The Permission Sets count chip at the top is clickable and navigates to the
 * dedicated list view at /admin/permission-sets.
 */

const MODULE_META = {
  profix: { label: "ProfiX Features", icon: Briefcase, color: "#ec9324" },
  desk_booking: { label: "Desk Booking Features", icon: Armchair, color: "#3b82f6" },
};

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

function ModuleAccordion({ moduleSchema, value, onChange, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = MODULE_META[moduleSchema.key] || { label: moduleSchema.label, icon: Shield, color: "#6b7280" };
  const Icon = meta.icon;
  const totalActions = useMemo(() => {
    let total = 0;
    let on = 0;
    for (const g of moduleSchema.groups || []) {
      for (const f of g.features || []) {
        for (const a of f.actions || []) {
          total += 1;
          if (((value || {})[f.key] || {})[a]) on += 1;
        }
      }
    }
    return { total, on };
  }, [moduleSchema, value]);

  const toggle = (featureKey, action, val) => {
    onChange({
      ...(value || {}),
      [featureKey]: {
        ...((value || {})[featureKey] || {}),
        [action]: val,
      },
    });
  };

  const selectAllFeature = (featureKey, actions, allOn) => {
    const next = {};
    for (const a of actions) next[a] = !allOn;
    onChange({
      ...(value || {}),
      [featureKey]: next,
    });
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid={`pset-accordion-${moduleSchema.key}`}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: `${meta.color}15`, color: meta.color }}
          >
            <Icon size={20} />
          </div>
          <div className="text-left">
            <div className="font-semibold text-gray-900">{meta.label}</div>
            <div className="text-xs text-gray-500">
              {totalActions.on}/{totalActions.total} permissions enabled
            </div>
          </div>
        </div>
        {open ? <ChevronDown size={18} className="text-gray-400" /> : <ChevronRight size={18} className="text-gray-400" />}
      </button>
      {open && (
        <div className="border-t border-gray-100">
          {(moduleSchema.groups || []).map((g) => (
            <div key={g.key} className="px-5 py-4 border-b border-gray-100 last:border-b-0">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
                {g.label}
              </div>
              <div className="space-y-2">
                {(g.features || []).map((f) => {
                  const featureVal = (value || {})[f.key] || {};
                  const allOn = (f.actions || []).every((a) => !!featureVal[a]);
                  return (
                    <div
                      key={f.key}
                      className="flex items-center justify-between gap-4 py-2.5 px-3 rounded-lg hover:bg-gray-50"
                      data-testid={`pset-feature-row-${moduleSchema.key}-${f.key}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900">{f.label}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        {(f.actions || []).map((a) => {
                          const on = !!featureVal[a];
                          return (
                            <label
                              key={a}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md cursor-pointer text-xs font-medium border transition-colors ${
                                on
                                  ? "bg-[#ec9324]/10 border-[#ec9324]/30 text-[#ec9324]"
                                  : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={on}
                                onChange={(e) => toggle(f.key, a, e.target.checked)}
                                data-testid={`pset-cb-${moduleSchema.key}-${f.key}-${a}`}
                              />
                              <span
                                className={`w-3.5 h-3.5 rounded border flex items-center justify-center pointer-events-none ${
                                  on ? "bg-[#ec9324] border-[#ec9324]" : "border-gray-300"
                                }`}
                              >
                                {on && <span className="w-1.5 h-1.5 bg-white rounded-sm" />}
                              </span>
                              {a.charAt(0).toUpperCase() + a.slice(1)}
                            </label>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => selectAllFeature(f.key, f.actions || [], allOn)}
                          className="text-[11px] font-medium text-gray-500 hover:text-[#ec9324] ml-1"
                          data-testid={`pset-select-all-${moduleSchema.key}-${f.key}`}
                        >
                          {allOn ? "Clear" : "All"}
                        </button>
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

function SaveSetModal({ open, onClose, onConfirm, busy, defaultName = "" }) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  useEffect(() => { if (open) { setName(defaultName); setDescription(""); } }, [open, defaultName]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" data-testid="pset-save-modal">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-lg font-semibold text-gray-900">Save Permission Set</div>
            <div className="text-sm text-gray-500 mt-0.5">Give this set a name so you can assign it to employees later.</div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100" data-testid="pset-save-modal-close"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1">Title *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ticket Triage — Senior"
              autoFocus
              data-testid="pset-save-modal-name"
              className="w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#ec9324]/40 focus:border-[#ec9324]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional — describe what this set unlocks"
              rows={3}
              data-testid="pset-save-modal-desc"
              className="w-full px-3 py-2 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#ec9324]/40 focus:border-[#ec9324]"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            data-testid="pset-save-modal-cancel"
            className="px-4 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100"
          >Cancel</button>
          <button
            type="button"
            onClick={() => onConfirm({ name: name.trim(), description: description.trim() })}
            disabled={busy || !name.trim()}
            data-testid="pset-save-modal-confirm"
            className="px-4 py-2 rounded-md text-sm font-medium bg-[#ec9324] text-white hover:bg-[#d8851f] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Save Permission Set
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PermissionsPage() {
  const navigate = useNavigate();
  const [schema, setSchema] = useState([]);
  const [stats, setStats] = useState({ total_sets: 0 });
  const [modules, setModules] = useState({});
  const [loading, setLoading] = useState(true);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, st] = await Promise.all([
        api.get("/permissions/schema"),
        api.get("/permission-sets/stats"),
      ]);
      const sch = Array.isArray(s.data) ? s.data : (s.data?.modules || []);
      setSchema(sch);
      setStats(st.data || { total_sets: 0 });
      setModules(emptyModulesFromSchema(sch));
    } catch (e) {
      toast.error("Failed to load permissions schema");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const totalsByModule = useMemo(() => {
    const out = {};
    for (const m of schema) {
      let on = 0;
      let total = 0;
      for (const g of m.groups || []) {
        for (const f of g.features || []) {
          for (const a of f.actions || []) {
            total += 1;
            if (((modules[m.key] || {})[f.key] || {})[a]) on += 1;
          }
        }
      }
      out[m.key] = { on, total };
    }
    return out;
  }, [schema, modules]);
  const overallOn = Object.values(totalsByModule).reduce((s, v) => s + v.on, 0);

  const clearAll = () => setModules(emptyModulesFromSchema(schema));

  const handleConfirmSave = async ({ name, description }) => {
    if (!name) return;
    setSaving(true);
    try {
      await api.post("/permission-sets", { name, description, modules });
      toast.success(`Permission Set "${name}" created`);
      setSaveOpen(false);
      // Refresh stats and reset modules to a blank slate for the next set
      const st = await api.get("/permission-sets/stats");
      setStats(st.data || { total_sets: 0 });
      setModules(emptyModulesFromSchema(schema));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save Permission Set");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Shield size={24} className="text-[#ec9324]" /> Permissions
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              Configure feature access and save reusable Permission Sets to assign to employees.
            </p>
          </div>
          <button
            onClick={() => navigate("/admin/permission-sets")}
            data-testid="pset-count-chip"
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white border border-gray-200 hover:border-[#ec9324]/40 hover:shadow-md transition-all cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-lg bg-[#ec9324]/10 text-[#ec9324] flex items-center justify-center">
              <ListChecks size={20} />
            </div>
            <div className="text-left">
              <div className="text-2xl font-bold text-gray-900 group-hover:text-[#ec9324] transition-colors leading-none" data-testid="pset-count-number">
                {stats.total_sets || 0}
              </div>
              <div className="text-xs text-gray-500 mt-1">Permission Sets →</div>
            </div>
          </button>
        </div>

        {/* Editor */}
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-[#ec9324]" size={32} /></div>
        ) : (
          <>
            <div className="flex items-center justify-between bg-gradient-to-r from-[#ec9324]/5 to-transparent border border-[#ec9324]/20 rounded-xl px-5 py-3.5">
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Sparkles size={16} className="text-[#ec9324]" />
                <span><strong>{overallOn}</strong> permission{overallOn === 1 ? "" : "s"} enabled in this set</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={clearAll}
                  data-testid="pset-clear-btn"
                  className="px-3 py-1.5 rounded-md text-xs font-medium text-gray-600 hover:bg-gray-100"
                >Clear All</button>
                <button
                  type="button"
                  onClick={() => setSaveOpen(true)}
                  disabled={overallOn === 0}
                  data-testid="pset-save-btn"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-[#ec9324] text-white hover:bg-[#d8851f] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save size={14} /> Save Changes
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {schema.map((m) => (
                <ModuleAccordion
                  key={m.key}
                  moduleSchema={m}
                  value={modules[m.key] || {}}
                  onChange={(next) => setModules((prev) => ({ ...prev, [m.key]: next }))}
                />
              ))}
              {schema.length === 0 && (
                <div className="text-sm text-gray-500 text-center py-12 border border-dashed rounded-xl">
                  No permission modules configured.
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <SaveSetModal
        open={saveOpen}
        onClose={() => !saving && setSaveOpen(false)}
        onConfirm={handleConfirmSave}
        busy={saving}
      />
    </Layout>
  );
}
