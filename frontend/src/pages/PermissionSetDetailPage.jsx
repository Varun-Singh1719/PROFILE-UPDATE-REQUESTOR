import React, { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import api from "../lib/api";
import Layout from "../components/Layout";
import { toast } from "sonner";
import {
  ArrowLeft, Pencil, Save, Loader2, Shield, Briefcase, Armchair,
  ChevronDown, ChevronRight, X,
} from "lucide-react";

/**
 * Permission Set Detail Page (v3)
 *
 * Shows the full editor with all permissions of the set preselected.
 * Toggle Edit ↔ View mode using the Edit button in the top-right corner.
 * In View mode, checkboxes are disabled; in Edit mode they are interactive
 * and a Save button appears.
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

function mergeWithSetData(schemaModules, setModules) {
  // Start with all-false from schema, overlay saved-set values
  const out = { ...schemaModules };
  for (const [mkey, features] of Object.entries(setModules || {})) {
    out[mkey] = out[mkey] || {};
    for (const [fkey, actions] of Object.entries(features || {})) {
      out[mkey][fkey] = { ...(out[mkey][fkey] || {}) };
      for (const [a, v] of Object.entries(actions || {})) {
        // Coerce scope strings to bool true
        out[mkey][fkey][a] = (v === true || v === "all" || v === "respective");
      }
    }
  }
  return out;
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
          if (((value || {})[f.key] || {})[a]) on += 1;
        }
      }
    }
    return { total, on };
  }, [moduleSchema, value]);

  const toggle = (featureKey, action, val) => {
    if (disabled) return;
    onChange({
      ...(value || {}),
      [featureKey]: { ...((value || {})[featureKey] || {}), [action]: val },
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
                          const on = !!featureVal[a];
                          return (
                            <label
                              key={a}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                                on ? "bg-[#ec9324]/10 border-[#ec9324]/30 text-[#ec9324]" : "bg-white border-gray-200 text-gray-600"
                              } ${disabled ? "opacity-80 cursor-default" : "cursor-pointer hover:border-gray-300"}`}
                            >
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={on}
                                disabled={disabled}
                                onChange={(e) => toggle(f.key, a, e.target.checked)}
                                data-testid={`pset-detail-cb-${moduleSchema.key}-${f.key}-${a}`}
                              />
                              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center pointer-events-none ${on ? "bg-[#ec9324] border-[#ec9324]" : "border-gray-300"}`}>
                                {on && <span className="w-1.5 h-1.5 bg-white rounded-sm" />}
                              </span>
                              {a.charAt(0).toUpperCase() + a.slice(1)}
                            </label>
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
      toast.error("Permission Set not found");
      navigate("/admin/permission-sets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const r = await api.patch(`/permission-sets/${id}`, {
        name: name.trim(),
        description: description.trim(),
        modules,
      });
      setPset(r.data);
      toast.success("Permission Set updated");
      setEditMode(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Update failed");
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
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <button
              onClick={() => navigate("/admin/permission-sets")}
              data-testid="pset-detail-back"
              className="p-2 rounded-lg hover:bg-gray-100 mt-0.5"
              title="Back to list"
            ><ArrowLeft size={18} /></button>
            <div>
              <div className="text-xs text-gray-500 font-mono mb-1">PERMISSION SET #{pset?.numeric_id}</div>
              {editMode ? (
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="pset-detail-name-input"
                  className="text-2xl font-bold text-gray-900 bg-transparent border-b-2 border-[#ec9324]/40 focus:border-[#ec9324] focus:outline-none px-1"
                />
              ) : (
                <h1 className="text-2xl font-bold text-gray-900" data-testid="pset-detail-name">{pset?.name}</h1>
              )}
              <div className="text-sm text-gray-500 mt-1">
                Created by <strong className="text-gray-700">{pset?.created_by?.name || "—"}</strong>
                {" · "}{new Date(pset?.created_at).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {editMode ? (
              <>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  disabled={saving}
                  data-testid="pset-detail-cancel"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100"
                ><X size={14} /> Cancel</button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  data-testid="pset-detail-save"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-[#ec9324] text-white hover:bg-[#d8851f] disabled:opacity-50"
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
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-[#ec9324] text-white hover:bg-[#d8851f]"
              ><Pencil size={14} /> Edit</button>
            )}
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
