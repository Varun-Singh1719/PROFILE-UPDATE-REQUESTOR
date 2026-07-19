/**
 * PermissionSetView — read-only detail card for a v3 permission set.
 *
 * Rendered inside PermissionsPage when `?tab=view&set=<id>`. Shows:
 *   • Header with title, description, created/updated meta, assigned-users chip
 *   • Edit button (top-right of the card)
 *   • Per-module accordion listing enabled pages / functions with scope tags
 *
 * Uses the catalog already loaded by PermissionsPage.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ArrowLeft from "@mui/icons-material/ArrowBack";
import Pencil from "@mui/icons-material/EditOutlined";
import Loader2 from "@mui/icons-material/Autorenew";
import Briefcase from "@mui/icons-material/WorkOutlined";
import Armchair from "@mui/icons-material/Chair";
import Shield from "@mui/icons-material/ShieldOutlined";
import LayoutDashboard from "@mui/icons-material/DashboardOutlined";
import ChevronDown from "@mui/icons-material/KeyboardArrowDown";
import ChevronRight from "@mui/icons-material/ChevronRight";
import Users from "@mui/icons-material/PeopleOutlined";
import CalendarClock from "@mui/icons-material/EventOutlined";
import UserIcon from "@mui/icons-material/PersonOutlined";
import Settings from "@mui/icons-material/SettingsOutlined";
import api from "../../lib/api";
import notify from "../../lib/notify";
import { Button } from "../ui/button";

const MODULE_ICON = {
  profix: Briefcase,
  desk_booking: Armchair,
  manage: Settings,
  dashboard: LayoutDashboard,
};

const SCOPE_LABEL = {
  individual: "Individual",
  team: "Team",
  overall: "Overall",
};

const DASHBOARD_LEVEL_LABEL = {
  individual: "Individual",
  manager: "Manager",
  overall: "Overall",
};

function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function MetaCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
      <Icon size={16} className="text-gray-500 mt-0.5 shrink-0"/>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{label}</div>
        <div className="text-sm text-gray-900 truncate">{value}</div>
        {sub && <div className="text-[11px] text-gray-500 truncate">{sub}</div>}
      </div>
    </div>
  );
}

function ScopeTag({ scope }) {
  if (!scope) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-[#ec9324]/10 text-[#ec9324] px-2 py-0.5 text-[10px] font-semibold">
      {SCOPE_LABEL[scope] || scope}
    </span>
  );
}

function ModuleSection({ mod, moduleState, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const isDashboard = mod?.type === "access_level" || mod?.key === "dashboard";
  const Icon = MODULE_ICON[mod.key] || Shield;

  // Rows for display
  const rows = useMemo(() => {
    const out = [];
    for (const p of mod.pages || []) {
      const pState = (moduleState?.pages || {})[p.key];
      if (!pState) continue;
      if (isDashboard) {
        const lvl = pState.access_level;
        if (lvl) out.push({ page: p, kind: "dashboard", level: lvl });
        continue;
      }
      const view = pState.view || {};
      const edit = pState.edit || {};
      const fns = pState.functions || {};
      const enabledFns = Object.entries(fns)
        .filter(([, v]) => v && v.enabled)
        .map(([fk, v]) => {
          const meta = (p.functions || []).find((f) => f.key === fk);
          return { key: fk, label: meta?.label || fk, scope: v.scope };
        });
      // Skip pages with nothing enabled
      if (!view.enabled && !edit.enabled && enabledFns.length === 0) continue;
      out.push({ page: p, kind: "page", view, edit, functions: enabledFns });
    }
    return out;
  }, [mod, moduleState, isDashboard]);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 rounded-t-xl"
        data-testid={`perm-view-mod-${mod.key}`}
      >
        <Icon size={16} className="text-[#ec9324]"/>
        <span className="font-semibold text-gray-900 flex-1">{mod.label || mod.key}</span>
        <span className="text-[11px] text-gray-500">{rows.length} page{rows.length === 1 ? "" : "s"}</span>
        {open ? <ChevronDown sx={{ fontSize: 16 }} className="text-gray-400"/> : <ChevronRight sx={{ fontSize: 16 }} className="text-gray-400"/>}
      </button>
      {open && (
        <div className="border-t border-gray-100 divide-y divide-gray-100">
          {rows.map((row) => (
            <div key={row.page.key} className="px-4 py-3 grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-1 min-w-0">
                <div className="text-sm font-medium text-gray-900">{row.page.label || row.page.key}</div>
                <div className="text-[10px] text-gray-500 font-mono truncate">{row.page.key}</div>
              </div>
              {row.kind === "dashboard" ? (
                <div className="md:col-span-3 flex items-center gap-2">
                  <span className="text-xs text-gray-500">Access level</span>
                  <span className="inline-flex items-center rounded-md bg-[#ec9324]/10 text-[#ec9324] px-2 py-0.5 text-xs font-semibold">
                    {DASHBOARD_LEVEL_LABEL[row.level] || row.level}
                  </span>
                </div>
              ) : (
                <div className="md:col-span-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {row.view.enabled && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 text-green-700 px-2 py-0.5 text-[11px] font-semibold">
                        View <ScopeTag scope={row.view.scope}/>
                      </span>
                    )}
                    {row.edit.enabled && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 text-blue-700 px-2 py-0.5 text-[11px] font-semibold">
                        Edit <ScopeTag scope={row.edit.scope}/>
                      </span>
                    )}
                    {!row.view.enabled && !row.edit.enabled && (
                      <span className="text-[11px] text-gray-400 italic">No View/Edit</span>
                    )}
                  </div>
                  {row.functions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {row.functions.map((f) => (
                        <span key={f.key} className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 text-gray-700 px-2 py-0.5 text-[11px]">
                          {f.label}
                          {f.scope && <ScopeTag scope={f.scope}/>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PermissionSetView({ setId, catalog, onEdit, onBack }) {
  const navigate = useNavigate();
  const [doc, setDoc] = useState(null);
  const [assignedCount, setAssignedCount] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/permission-sets-v3/${setId}`);
        if (cancel) return;
        setDoc(data);
      } catch (e) {
        notify.error(e, { what: "Load permission set" });
      } finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [setId]);

  // Lazy-load the assigned-users count via the list endpoint (uses q=title match).
  useEffect(() => {
    if (!doc) return;
    let cancel = false;
    (async () => {
      try {
        const r = await api.get(`/permission-sets-v3`, {
          params: { page: 1, page_size: 100, q: doc.title || "" },
        });
        if (cancel) return;
        const match = (r.data?.items || []).find((x) => x.id === doc.id);
        setAssignedCount(match?.assigned_users_count ?? 0);
      } catch { if (!cancel) setAssignedCount(0); }
    })();
    return () => { cancel = true; };
  }, [doc]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
        <Loader2 className="animate-spin mr-2" sx={{ fontSize: 16 }}/> Loading permission set…
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        Permission set not found.
      </div>
    );
  }

  const isDeleted = !!doc.deleted_at;

  return (
    <div className="mt-3 space-y-4" data-testid="perm-view-panel">
      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-900"
            aria-label="Back to list"
            data-testid="perm-view-back"
          ><ArrowLeft sx={{ fontSize: 16 }}/></button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-gray-500">#{doc.seq_no || doc.numeric_id}</span>
              <h2 className="text-lg font-semibold text-gray-900 truncate">{doc.title}</h2>
              {isDeleted && (
                <span className="inline-flex items-center rounded-full bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-[10px] font-semibold">Deleted</span>
              )}
            </div>
            {doc.description ? (
              <p className="mt-1 text-sm text-gray-600">{doc.description}</p>
            ) : (
              <p className="mt-1 text-sm text-gray-400 italic">No description</p>
            )}
          </div>
          {!isDeleted && (
            <Button
              onClick={() => onEdit(doc.id)}
              className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-9 text-xs font-semibold"
              data-testid="perm-view-edit-btn"
            >
              <Pencil sx={{ fontSize: 13 }} className="mr-1.5"/> Edit
            </Button>
          )}
        </div>

        {/* Meta grid */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
          <MetaCard icon={UserIcon} label="Created By" value={doc.created_by?.name || "—"} sub={doc.created_by?.email}/>
          <MetaCard icon={CalendarClock} label="Created On" value={fmtDateTime(doc.created_on)}/>
          <MetaCard icon={UserIcon} label="Updated By" value={doc.updated_by?.name || "—"} sub={doc.updated_by?.email}/>
          <MetaCard icon={CalendarClock} label="Updated On" value={fmtDateTime(doc.updated_on)}/>
        </div>

        {/* Assigned users pill */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(`/admin/contacts?permission_set=${encodeURIComponent(doc.id)}`)}
            data-testid="perm-view-users-link"
            className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-semibold border ${
              (assignedCount || 0) > 0
                ? "border-[#ec9324]/40 bg-[#ec9324]/10 text-[#ec9324] hover:bg-[#ec9324]/20"
                : "border-gray-200 text-gray-500 hover:border-gray-300"
            }`}
          >
            <Users sx={{ fontSize: 13 }}/> {assignedCount ?? 0} assigned {(assignedCount === 1) ? "employee" : "employees"} · view list
          </button>
        </div>
      </div>

      {/* Modules & permissions */}
      <div className="space-y-3">
        {(catalog || []).map((mod) => (
          <ModuleSection
            key={mod.key}
            mod={mod}
            moduleState={(doc.modules || {})[mod.key]}
          />
        ))}
        {(catalog || []).every((m) => {
          const s = (doc.modules || {})[m.key];
          if (!s) return true;
          if (m.type === "access_level" || m.key === "dashboard") {
            return Object.values(s.pages || {}).every((p) => !p?.access_level);
          }
          return Object.values(s.pages || {}).every((p) => {
            const v = p?.view?.enabled, e = p?.edit?.enabled;
            const fns = Object.values(p?.functions || {}).some((x) => x.enabled);
            return !v && !e && !fns;
          });
        }) && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
            This permission set has no enabled permissions.
          </div>
        )}
      </div>
    </div>
  );
}
