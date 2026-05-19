import React, { useEffect, useMemo, useState, useCallback } from "react";
import api from "../lib/api";
import Layout from "../components/Layout";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "../components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "../components/ui/dialog";
import { toast } from "sonner";
import {
  Shield, Briefcase, Armchair, Users, UserCheck, UserCog, FileText, ChevronDown, ChevronRight,
  Filter, Search, Save, RotateCcw, Copy, History, Eye, Sparkles, Info, Plus, Trash2,
  CheckCircle2, XCircle, ArrowRight, Layers, BadgeCheck, AlertTriangle, Check
} from "lucide-react";

// ============== Helpers ==============
const ACTION_META = {
  view: { label: "View", color: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  create: { label: "Create", color: "bg-green-50 text-green-700 border-green-200", dot: "bg-green-500" },
  edit: { label: "Edit", color: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  assign: { label: "Assign", color: "bg-purple-50 text-purple-700 border-purple-200", dot: "bg-purple-500" },
  approve: { label: "Approve", color: "bg-teal-50 text-teal-700 border-teal-200", dot: "bg-teal-500" },
  delete: { label: "Delete", color: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" },
};

const MODULE_ICONS = { profix: Briefcase, desk_booking: Armchair };
const SUBJECT_ICONS = { role: UserCog, team: Users, employee: UserCheck };

function fmt(iso) { if (!iso) return ""; try { return new Date(iso).toLocaleString(); } catch { return iso; } }

function ruleKey(subject_type, subject_id, module, feature) {
  return `${subject_type}::${subject_id}::${module}::${feature}`;
}

// ============== Stat Card ==============
function StatCard({ label, value, icon: Icon, color = "#ec9324", trend }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-soft p-5 hover:shadow-soft-hover transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">{label}</div>
          <div className="text-3xl font-bold text-gray-900 mt-2">{value ?? "—"}</div>
          {trend && <div className="text-xs text-gray-500 mt-1">{trend}</div>}
        </div>
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}15`, color }}
        >
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

// ============== Audit Log Drawer ==============
function AuditLogDrawer({ open, onClose }) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [resource, setResource] = useState("all");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (q) params.q = q;
      if (resource !== "all") params.resource = resource;
      const r = await api.get("/audit-log", { params });
      setItems(r.data);
    } finally { setLoading(false); }
  }, [q, resource]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const sevColor = (s) => s === "warning" ? "text-amber-600 bg-amber-50 border-amber-200"
    : s === "error" ? "text-rose-600 bg-rose-50 border-rose-200"
    : "text-blue-600 bg-blue-50 border-blue-200";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History size={20} className="text-[#ec9324]"/> Audit Log</DialogTitle>
          <DialogDescription>Org-wide change history.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 pt-3 pb-2 border-b">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <Input placeholder="Search action, actor, details..." className="pl-9 h-9" value={q} onChange={(e) => setQ(e.target.value)} data-testid="audit-search"/>
          </div>
          <Select value={resource} onValueChange={setResource}>
            <SelectTrigger className="w-40 h-9" data-testid="audit-resource"><SelectValue/></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All resources</SelectItem>
              <SelectItem value="auth">Auth</SelectItem>
              <SelectItem value="contact">Contacts</SelectItem>
              <SelectItem value="team">Teams</SelectItem>
              <SelectItem value="permissions">Permissions</SelectItem>
              <SelectItem value="permission_preset">Presets</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={load} variant="outline" className="h-9 border-gray-300">Refresh</Button>
        </div>
        <div className="overflow-y-auto flex-1 mt-2">
          {loading && <div className="text-center text-sm text-gray-400 py-10">Loading...</div>}
          {!loading && items.length === 0 && <div className="text-center text-sm text-gray-400 py-10">No audit events.</div>}
          <ul className="divide-y divide-gray-100">
            {items.map((it) => (
              <li key={it.id} className="py-3 px-2 flex items-start gap-3 hover:bg-gray-50 rounded" data-testid={`audit-entry-${it.id}`}>
                <div className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 border ${sevColor(it.severity)}`}>
                  {it.severity}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="font-semibold text-gray-900">{it.actor_name || "System"}</span>
                    <span className="text-gray-400">{it.actor_role}</span>
                    <ArrowRight size={12} className="text-gray-300"/>
                    <span className="font-mono text-xs bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">{it.action}</span>
                  </div>
                  <div className="text-sm text-gray-700 mt-0.5">{it.detail}</div>
                  <div className="text-xs text-gray-400 mt-1">{fmt(it.at)} · {it.resource}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============== Effective Access Panel ==============
function EffectiveAccessPanel({ schema, employee, effective, sources, counts, modules }) {
  const [openEmp, setOpenEmp] = useState(null);

  if (!employee) {
    return (
      <div className="text-sm text-gray-500 p-4">
        Select an employee in filters to preview effective access.
      </div>
    );
  }
  const moduleData = schema?.modules || [];

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-[#ec9324] to-[#f5a942] rounded-xl p-4 text-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-bold">
            {employee.name?.[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-bold truncate">{employee.name}</div>
            <div className="text-xs text-white/85 truncate">{employee.email}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs mt-3">
          <span className="bg-white/20 rounded-full px-2 py-0.5">Role: {employee.role}</span>
          {employee.team_name && <span className="bg-white/20 rounded-full px-2 py-0.5">Team: {employee.team_name}</span>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-2">
          <div className="font-bold text-blue-700 text-base">{counts?.role_rules ?? 0}</div>
          <div className="text-gray-600">Role rules</div>
        </div>
        <div className="bg-purple-50 border border-purple-100 rounded-lg p-2">
          <div className="font-bold text-purple-700 text-base">{counts?.team_rules ?? 0}</div>
          <div className="text-gray-600">Team rules</div>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-lg p-2">
          <div className="font-bold text-amber-700 text-base">{counts?.employee_overrides ?? 0}</div>
          <div className="text-gray-600">Overrides</div>
        </div>
      </div>

      <div className="space-y-3">
        {moduleData.map((m) => {
          const me = effective?.[m.key] || {};
          const features = m.groups.flatMap((g) => g.features);
          const hasAny = features.some((f) => me[f.key]);
          if (!hasAny) return null;
          const ModIcon = MODULE_ICONS[m.key] || Briefcase;
          return (
            <div key={m.key} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 flex items-center gap-2 border-b border-gray-200">
                <ModIcon size={14} style={{ color: m.color }}/>
                <span className="text-sm font-semibold text-gray-800">{m.label}</span>
              </div>
              <ul className="divide-y divide-gray-100">
                {features.map((f) => {
                  const a = me[f.key];
                  if (!a) return null;
                  const enabled = Object.entries(a).filter(([k, v]) => v && f.actions.includes(k)).map(([k]) => k);
                  if (enabled.length === 0) return null;
                  const srcList = (sources?.[m.key]?.[f.key]) || [];
                  return (
                    <li key={f.key} className="px-3 py-2">
                      <div className="text-xs font-semibold text-gray-700">{f.label}</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {enabled.map((act) => {
                          const meta = ACTION_META[act] || { label: act, color: "bg-gray-50 text-gray-700 border-gray-200" };
                          return (
                            <span key={act} className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 border ${meta.color}`}>
                              {meta.label}
                            </span>
                          );
                        })}
                      </div>
                      {srcList.length > 0 && (
                        <div className="text-[10px] text-gray-500 mt-1">
                          From: {srcList.map((s) => s.level === "override" ? `override` : s.level).join(", ")}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {(!effective || Object.keys(effective).length === 0) && (
          <div className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg p-3 flex gap-2">
            <Info size={14} className="text-blue-600 flex-shrink-0 mt-0.5"/>
            <span>No permission rules configured yet. The employee will use system defaults.</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============== Clone Preset Dialog ==============
function ClonePresetDialog({ open, onClose, presets, onCloned }) {
  const [sourceId, setSourceId] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (open) { setSourceId(""); setName(""); } }, [open]);

  const submit = async () => {
    const src = presets.find((p) => p.id === sourceId);
    if (!src || !name.trim()) { toast.error("Pick a preset and enter a name"); return; }
    setLoading(true);
    try {
      const r = await api.post("/permissions/presets", {
        name: name.trim(),
        description: `Cloned from "${src.name}"`,
        module: src.module,
        rules: src.rules,
      });
      toast.success("Preset cloned");
      onCloned(r.data);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Copy size={18} className="text-[#ec9324]"/> Clone Preset</DialogTitle>
          <DialogDescription>Duplicate a preset so you can tweak it without altering the original.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <Label>Source preset</Label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger data-testid="clone-source"><SelectValue placeholder="Choose preset..."/></SelectTrigger>
              <SelectContent>
                {presets.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.module})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>New name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. DQ Manager (North)" data-testid="clone-name"/>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={loading} className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="clone-submit">
            {loading ? "Cloning..." : "Clone Preset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============== Main Permissions Page ==============
export default function PermissionsPage() {
  const [schema, setSchema] = useState({ modules: [], actions: [] });
  const [allRules, setAllRules] = useState([]);          // server-state rules
  const [draftRules, setDraftRules] = useState({});      // key -> rule (in-memory edits, scoped to current view)
  const [presets, setPresets] = useState([]);
  const [stats, setStats] = useState({});
  const [contacts, setContacts] = useState([]);
  const [teams, setTeams] = useState([]);

  // Filters
  const [moduleKey, setModuleKey] = useState("profix");
  const [subjectType, setSubjectType] = useState("role"); // role | team | employee
  const [subjectId, setSubjectId] = useState("DQ Team");
  const [employeeQuery, setEmployeeQuery] = useState("");

  const [expandedGroups, setExpandedGroups] = useState({});
  const [auditOpen, setAuditOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [previewEmpId, setPreviewEmpId] = useState(""); // for "Preview as Employee"
  const [previewData, setPreviewData] = useState(null);
  const [dirty, setDirty] = useState(false);

  // Load schema, presets, contacts, teams, rules, stats
  const refreshAll = useCallback(async () => {
    const [s, p, c, t, r, st] = await Promise.all([
      api.get("/permissions/schema"),
      api.get("/permissions/presets"),
      api.get("/contacts"),
      api.get("/teams"),
      api.get("/permissions/v2"),
      api.get("/permissions/stats"),
    ]);
    setSchema(s.data);
    setPresets(p.data);
    setContacts(c.data);
    setTeams(t.data);
    setAllRules(r.data);
    setStats(st.data);
    // Default expand all groups for current module
    const initialExpanded = {};
    (s.data.modules || []).forEach((m) => {
      m.groups.forEach((g) => { initialExpanded[`${m.key}/${g.key}`] = true; });
    });
    setExpandedGroups(initialExpanded);
  }, []);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  const currentModule = useMemo(
    () => (schema.modules || []).find((m) => m.key === moduleKey),
    [schema, moduleKey]
  );

  // Subject options based on type
  const subjectOptions = useMemo(() => {
    if (subjectType === "role") return ["Admin", "Manager", "Research", "DQ Team"].map((r) => ({ value: r, label: r }));
    if (subjectType === "team") return teams.map((t) => ({ value: t.id, label: t.name, sublabel: t.color }));
    if (subjectType === "employee") {
      const q = employeeQuery.toLowerCase();
      return contacts
        .filter((e) => !q || e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q))
        .map((e) => ({ value: e.id, label: e.name, sublabel: `${e.role} • ${e.email}` }));
    }
    return [];
  }, [subjectType, teams, contacts, employeeQuery]);

  // Reset subjectId when subjectType changes
  useEffect(() => {
    if (subjectOptions.length === 0) { setSubjectId(""); return; }
    if (!subjectOptions.find((o) => o.value === subjectId)) {
      setSubjectId(subjectOptions[0].value);
    }
  }, [subjectType, subjectOptions, subjectId]);

  // Build "rules for current view" map (subject_type, subject_id, module)
  const currentViewRulesByFeature = useMemo(() => {
    const map = {};
    for (const r of allRules) {
      if (r.subject_type === subjectType && r.subject_id === subjectId && r.module === moduleKey) {
        map[r.feature] = r;
      }
    }
    // Overlay draft edits scoped to this view
    Object.values(draftRules).forEach((dr) => {
      if (dr.subject_type === subjectType && dr.subject_id === subjectId && dr.module === moduleKey) {
        map[dr.feature] = dr;
      }
    });
    return map;
  }, [allRules, draftRules, subjectType, subjectId, moduleKey]);

  const toggleAction = (feature, action) => {
    if (!subjectId) { toast.error("Pick a subject first"); return; }
    const key = ruleKey(subjectType, subjectId, moduleKey, feature.key);
    const existing = currentViewRulesByFeature[feature.key];
    const baseActions = {};
    feature.actions.forEach((a) => { baseActions[a] = existing?.actions?.[a] ?? false; });
    baseActions[action] = !baseActions[action];
    const draft = {
      id: existing?.id || `draft-${key}`,
      module: moduleKey,
      feature: feature.key,
      subject_type: subjectType,
      subject_id: subjectId,
      actions: baseActions,
      note: existing?.note || "",
      _dirty: true,
    };
    setDraftRules((dm) => ({ ...dm, [key]: draft }));
    setDirty(true);
  };

  const setActionScope = (feature, action, scope) => {
    if (!subjectId) { toast.error("Pick a subject first"); return; }
    const key = ruleKey(subjectType, subjectId, moduleKey, feature.key);
    const existing = currentViewRulesByFeature[feature.key];
    const baseActions = {};
    feature.actions.forEach((a) => { baseActions[a] = existing?.actions?.[a] ?? false; });
    // scope: "none" | "respective" | "all"
    baseActions[action] = scope === "none" ? false : scope;
    const draft = {
      id: existing?.id || `draft-${key}`,
      module: moduleKey,
      feature: feature.key,
      subject_type: subjectType,
      subject_id: subjectId,
      actions: baseActions,
      note: existing?.note || "",
      _dirty: true,
    };
    setDraftRules((dm) => ({ ...dm, [key]: draft }));
    setDirty(true);
  };

  const setAllForFeature = (feature, value) => {
    if (!subjectId) return;
    const key = ruleKey(subjectType, subjectId, moduleKey, feature.key);
    const acts = {};
    feature.actions.forEach((a) => { acts[a] = value; });
    setDraftRules((dm) => ({
      ...dm,
      [key]: {
        id: currentViewRulesByFeature[feature.key]?.id || `draft-${key}`,
        module: moduleKey,
        feature: feature.key,
        subject_type: subjectType,
        subject_id: subjectId,
        actions: acts,
        note: "",
        _dirty: true,
      }
    }));
    setDirty(true);
  };

  const discardChanges = () => {
    if (!window.confirm("Discard all unsaved changes?")) return;
    setDraftRules({});
    setDirty(false);
    toast.info("Changes discarded");
  };

  const saveChanges = async () => {
    // Merge draft into all rules then PUT bulk
    const map = {};
    for (const r of allRules) {
      map[ruleKey(r.subject_type, r.subject_id, r.module, r.feature)] = r;
    }
    Object.entries(draftRules).forEach(([k, dr]) => {
      // Drop entries where no action is true (treated as "no rule")
      const anyTrue = Object.values(dr.actions).some(Boolean);
      const anyFalse = Object.values(dr.actions).some((v) => v === false);
      if (!anyTrue && !anyFalse) {
        delete map[k];
      } else {
        map[k] = { ...dr };
      }
    });
    const rules = Object.values(map).map(({ _dirty, id, ...rest }) => rest);
    try {
      await api.put("/permissions/v2/bulk", { rules });
      toast.success("Permissions saved");
      setDraftRules({});
      setDirty(false);
      refreshAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    }
  };

  const applyPreset = async (presetId) => {
    if (!presetId || !subjectId) { toast.error("Pick subject + preset"); return; }
    if (dirty) { toast.error("Save or discard unsaved changes first"); return; }
    try {
      const r = await api.post(`/permissions/presets/${presetId}/apply`, {
        subject_type: subjectType,
        subject_id: subjectId,
      });
      toast.success(`Preset applied (${r.data.count} rules)`);
      refreshAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  const previewEmployee = async (empId) => {
    if (!empId) { setPreviewData(null); return; }
    setPreviewEmpId(empId);
    try {
      const r = await api.get(`/permissions/effective/${empId}`);
      setPreviewData(r.data);
    } catch (e) {
      toast.error("Failed to preview");
    }
  };

  // Auto-set preview to default first employee with overrides if subjectType=employee
  useEffect(() => {
    if (subjectType === "employee" && subjectId) {
      previewEmployee(subjectId);
    }
  }, [subjectType, subjectId]);

  const totalDraftChanges = Object.keys(draftRules).length;
  const subjectLabel = subjectOptions.find((s) => s.value === subjectId)?.label || subjectId;

  return (
    <Layout>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <Shield className="text-[#ec9324]" size={28}/> Permissions
          </h1>
          <p className="text-gray-500 mt-1">Configure granular access across modules, teams, roles and employees.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="border-gray-300" onClick={() => setAuditOpen(true)} data-testid="open-audit-btn">
            <History size={14} className="mr-1.5"/> Audit Log
          </Button>
          <Button variant="outline" className="border-gray-300" onClick={() => setCloneOpen(true)} data-testid="open-clone-btn">
            <Copy size={14} className="mr-1.5"/> Clone Preset
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <StatCard label="Total Roles" value={stats.total_roles} icon={UserCog} color="#ec9324"/>
        <StatCard label="Permission Rules" value={stats.total_rules} icon={Shield} color="#3b82f6"/>
        <StatCard label="Employees w/ Overrides" value={stats.employees_with_overrides} icon={BadgeCheck} color="#a855f7"/>
        <StatCard label="Restricted Actions" value={stats.restricted_actions} icon={AlertTriangle} color="#ef4444"/>
      </div>

      {/* Three-panel layout */}
      <div className="grid grid-cols-12 gap-4 mt-6">
        {/* LEFT FILTER PANEL */}
        <aside className="col-span-12 lg:col-span-3">
          <div className="bg-white rounded-xl border border-gray-100 shadow-soft p-4 sticky top-4">
            <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
              <Filter size={14} className="text-[#ec9324]"/>
              <span className="font-semibold text-gray-900 text-sm">Filters</span>
            </div>
            <div className="space-y-4 mt-4">
              <div>
                <Label className="text-xs uppercase tracking-wide text-gray-500">Module</Label>
                <Select value={moduleKey} onValueChange={setModuleKey}>
                  <SelectTrigger data-testid="filter-module"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    {(schema.modules || []).map((m) => {
                      const Icon = MODULE_ICONS[m.key] || Briefcase;
                      return (
                        <SelectItem key={m.key} value={m.key}>
                          <span className="inline-flex items-center gap-2"><Icon size={14} style={{ color: m.color }}/> {m.label}</span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs uppercase tracking-wide text-gray-500">Subject Type</Label>
                <div className="grid grid-cols-3 gap-1 mt-1.5 bg-gray-100 rounded-lg p-1">
                  {["role", "team", "employee"].map((st) => {
                    const Icon = SUBJECT_ICONS[st];
                    const active = subjectType === st;
                    return (
                      <button
                        key={st}
                        onClick={() => setSubjectType(st)}
                        data-testid={`subject-type-${st}`}
                        className={`flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-md capitalize transition-colors ${
                          active ? "bg-white text-[#ec9324] shadow-sm" : "text-gray-600 hover:text-gray-900"
                        }`}
                      >
                        <Icon size={12}/> {st}
                      </button>
                    );
                  })}
                </div>
              </div>

              {subjectType === "employee" && (
                <div>
                  <Label className="text-xs uppercase tracking-wide text-gray-500">Employee search</Label>
                  <div className="relative mt-1.5">
                    <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                    <Input className="pl-8 h-9 text-sm" placeholder="Search name or email..." value={employeeQuery} onChange={(e) => setEmployeeQuery(e.target.value)} data-testid="employee-search"/>
                  </div>
                </div>
              )}

              <div>
                <Label className="text-xs uppercase tracking-wide text-gray-500">{subjectType === "role" ? "Role" : subjectType === "team" ? "Team" : "Employee"}</Label>
                <Select value={subjectId} onValueChange={setSubjectId}>
                  <SelectTrigger data-testid="filter-subject"><SelectValue placeholder="Select..."/></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {subjectOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        <div>
                          <div>{o.label}</div>
                          {o.sublabel && subjectType === "employee" && <div className="text-xs text-gray-500">{o.sublabel}</div>}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="pt-3 border-t border-gray-100">
                <Label className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1"><Sparkles size={12}/> Preset</Label>
                <Select onValueChange={(v) => applyPreset(v)} value="">
                  <SelectTrigger data-testid="apply-preset"><SelectValue placeholder="Apply a preset..."/></SelectTrigger>
                  <SelectContent>
                    {presets.filter((p) => p.module === moduleKey).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <div>
                          <div className="font-medium">{p.name} {p.system && <span className="ml-1 text-[10px] bg-gray-100 text-gray-600 px-1 rounded">system</span>}</div>
                          <div className="text-xs text-gray-500">{p.description}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="text-[11px] text-gray-500 mt-1.5">Applying replaces rules for this subject within {currentModule?.label}.</div>
              </div>

              <div className="pt-3 border-t border-gray-100">
                <Label className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1"><Eye size={12}/> Preview as</Label>
                <Select onValueChange={(v) => previewEmployee(v)} value={previewEmpId}>
                  <SelectTrigger data-testid="preview-as"><SelectValue placeholder="Pick employee..."/></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name} · {c.role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </aside>

        {/* CENTER MATRIX */}
        <main className="col-span-12 lg:col-span-6">
          <div className="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white flex items-center justify-between sticky top-0 z-10">
              <div>
                <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Editing</div>
                <div className="flex items-center gap-2 mt-0.5">
                  {currentModule && (() => {
                    const Icon = MODULE_ICONS[currentModule.key] || Briefcase;
                    return <Icon size={16} style={{ color: currentModule.color }}/>;
                  })()}
                  <span className="font-bold text-gray-900">{currentModule?.label}</span>
                  <ChevronRight size={14} className="text-gray-300"/>
                  <span className="text-sm text-gray-700 capitalize">{subjectType}</span>
                  <ChevronRight size={14} className="text-gray-300"/>
                  <span className="text-sm font-semibold text-[#ec9324]">{subjectLabel || "—"}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 text-[10px] flex-wrap">
                {(schema.actions || []).map((a) => (
                  <span key={a} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${ACTION_META[a]?.color || ""}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${ACTION_META[a]?.dot || "bg-gray-400"}`}/> {ACTION_META[a]?.label || a}
                  </span>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-600 sticky top-[57px] z-[5]">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-bold w-1/3">Feature</th>
                    {(schema.actions || []).map((a) => (
                      <th key={a} className="px-2 py-2.5 text-center font-bold w-14">{ACTION_META[a]?.label || a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(currentModule?.groups || []).map((g) => {
                    const expKey = `${currentModule.key}/${g.key}`;
                    const expanded = expandedGroups[expKey] !== false;
                    return (
                      <React.Fragment key={g.key}>
                        <tr className="bg-gray-50/70 border-y border-gray-200" data-testid={`group-${g.key}`}>
                          <td className="px-5 py-2" colSpan={(schema.actions || []).length + 1}>
                            <button
                              type="button"
                              onClick={() => setExpandedGroups((s) => ({ ...s, [expKey]: !expanded }))}
                              className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700 hover:text-[#ec9324]"
                            >
                              {expanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                              <Layers size={12}/>
                              {g.label}
                              <span className="text-[10px] font-normal text-gray-400">({g.features.length} features)</span>
                            </button>
                          </td>
                        </tr>
                        {expanded && g.features.map((f) => {
                          const rule = currentViewRulesByFeature[f.key];
                          const allChecked = f.actions.every((a) => rule?.actions?.[a]);
                          const someChecked = f.actions.some((a) => rule?.actions?.[a]);
                          return (
                            <tr key={f.key} className="border-b border-gray-100 hover:bg-gray-50/40" data-testid={`feature-row-${f.key}`}>
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-3">
                                  <FileText size={14} className="text-gray-400 flex-shrink-0"/>
                                  <div className="min-w-0">
                                    <div className="font-medium text-gray-900 text-sm truncate">{f.label}</div>
                                    <button
                                      type="button"
                                      onClick={() => setAllForFeature(f, !allChecked)}
                                      data-testid={`bulk-toggle-${f.key}`}
                                      className="text-[10px] text-gray-500 hover:text-[#ec9324] mt-0.5"
                                    >
                                      {allChecked ? "Deselect all" : someChecked ? "Select all" : "Select all"}
                                    </button>
                                  </div>
                                </div>
                              </td>
                              {(schema.actions || []).map((a) => {
                                const applicable = f.actions.includes(a);
                                if (!applicable) return <td key={a} className="px-2 py-3 text-center text-gray-200">—</td>;
                                const value = rule?.actions?.[a];
                                const isScoped = (schema.scoped_actions || []).includes(a);
                                if (isScoped) {
                                  // Convert any "truthy" legacy value to "all"
                                  const sel = value === "all" || value === "respective" ? value : (value ? "all" : "none");
                                  return (
                                    <td key={a} className="px-2 py-3 text-center">
                                      <Select value={sel} onValueChange={(v) => setActionScope(f, a, v)}>
                                        <SelectTrigger className="h-8 w-[110px] text-xs mx-auto" data-testid={`scope-${f.key}-${a}`}>
                                          <SelectValue/>
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="none">None</SelectItem>
                                          <SelectItem value="respective">Respective</SelectItem>
                                          <SelectItem value="all">All</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </td>
                                  );
                                }
                                const checked = !!value;
                                return (
                                  <td key={a} className="px-2 py-3 text-center">
                                    <Switch
                                      checked={checked}
                                      onCheckedChange={() => toggleAction(f, a)}
                                      data-testid={`toggle-${f.key}-${a}`}
                                      className="data-[state=checked]:bg-[#ec9324]"
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                  {(!currentModule || (currentModule.groups || []).length === 0) && (
                    <tr><td colSpan={(schema.actions || []).length + 1} className="text-center py-10 text-gray-400">No features in this module.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>

        {/* RIGHT PANEL: EFFECTIVE ACCESS */}
        <aside className="col-span-12 lg:col-span-3">
          <div className="bg-white rounded-xl border border-gray-100 shadow-soft p-4 sticky top-4">
            <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
              <BadgeCheck size={14} className="text-[#ec9324]"/>
              <span className="font-semibold text-gray-900 text-sm">Effective Access</span>
            </div>
            <div className="mt-4">
              <EffectiveAccessPanel
                schema={schema}
                employee={previewData?.employee}
                effective={previewData?.effective}
                sources={previewData?.sources}
                counts={previewData?.counts}
              />
            </div>
            <div className="mt-4 pt-3 border-t border-gray-100 text-[11px] text-gray-500 space-y-1">
              <div className="font-semibold text-gray-700 text-xs flex items-center gap-1"><Info size={12}/> How it works</div>
              <div>Permissions are inherited from <strong>Role</strong> + <strong>Team</strong> rules. <strong>Employee overrides</strong> take precedence. Toggles set what each subject can do — saving updates the central rules table.</div>
            </div>
          </div>
        </aside>
      </div>

      {/* Floating Save Bar */}
      {dirty && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white border border-gray-200 shadow-2xl rounded-full pl-5 pr-2 py-2 flex items-center gap-3 z-50" data-testid="save-bar">
          <span className="inline-flex items-center gap-2 text-sm text-gray-700">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"/>
            <span className="font-semibold">{totalDraftChanges}</span> unsaved change{totalDraftChanges !== 1 ? "s" : ""}
          </span>
          <Button onClick={discardChanges} variant="outline" size="sm" className="rounded-full border-gray-300 h-9 px-4" data-testid="discard-changes-btn">
            <RotateCcw size={14} className="mr-1"/> Discard
          </Button>
          <Button onClick={saveChanges} size="sm" className="rounded-full bg-[#ec9324] hover:bg-[#d4811f] text-white h-9 px-5" data-testid="save-changes-btn">
            <Save size={14} className="mr-1.5"/> Save Changes
          </Button>
        </div>
      )}

      <AuditLogDrawer open={auditOpen} onClose={() => setAuditOpen(false)}/>
      <ClonePresetDialog
        open={cloneOpen}
        onClose={() => setCloneOpen(false)}
        presets={presets}
        onCloned={(p) => setPresets((arr) => [p, ...arr])}
      />
    </Layout>
  );
}
