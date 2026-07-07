/**
 * AdminDashboard — Unified dashboard with two tabs:
 *   • Workspace Manager (default) — personal workspace dashboard
 *   • Profix                       — ticketing stats + DQ team + recent updates
 *
 * The star icon INSIDE each tab is the toggle for the default view:
 *   • filled star (orange when inactive, white when active) = current default
 *   • outlined star = "Set as Default" — clicking makes that tab the default
 * Hover tooltips: "Default View" (when it's the default) / "Set as Default"
 * (when it isn't). Preference is persisted via /api/profile/preferences.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import Layout from "../components/Layout";
import MetricCard from "../components/MetricCard";
import RecentUpdateCard from "../components/RecentUpdateCard";
import DateFilter, { getCurrentMonthRange, dateFilterToParams } from "../components/DateFilter";
import { Button } from "../components/ui/button";
import UserAvatar from "../components/UserAvatar";
import { Ticket, AlertCircle, CheckCircle2, Loader, Users, Plus, LayoutGrid, ClipboardList, Star, RefreshCw } from "lucide-react";
import { toast } from "../lib/notify";
import { useAuth } from "../context/AuthContext";
import MyWorkspaceDashboard from "../components/MyWorkspaceDashboard";
import WorkspaceOverallDashboard from "../components/WorkspaceOverallDashboard";

const TABS = [
  { key: "workspace_manager", label: "Workspace Manager", icon: LayoutGrid },
  { key: "profix",            label: "Profix",            icon: ClipboardList },
];

function longDate(d = new Date()) {
  return d.toLocaleDateString(undefined, {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("workspace_manager");
  const [defaultTab, setDefaultTab] = useState("workspace_manager");
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [savingPref, setSavingPref] = useState(false);

  // Users whose role has organisation-wide workspace visibility see the
  // "Overall" dashboard in place of the Individual/Team-Manager variants.
  const isOverallUser = ["Super Admin", "Admin"].includes(user?.role || "");

  // Load user preference on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/profile/me");
        if (cancelled) return;
        const pref = (data?.preferences?.default_dashboard) || "workspace_manager";
        setDefaultTab(pref);
        setActiveTab(pref);
      } catch {
        // fallback silently — default is already "workspace_manager"
      } finally {
        if (!cancelled) setPrefsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setDefaultDashboard = useCallback(async (key) => {
    if (savingPref || key === defaultTab) return;
    setSavingPref(true);
    try {
      await api.patch("/profile/preferences", { default_dashboard: key });
      setDefaultTab(key);
      toast.success(`Default dashboard set to ${TABS.find(t => t.key === key)?.label}`);
    } catch (e) {
      toast.error("Could not save preference");
    } finally {
      setSavingPref(false);
    }
  }, [savingPref, defaultTab]);

  // Tab bar — each tab has an inline, clickable star that toggles the "default"
  // dashboard for the current user. Star + tab-label share the same button-row
  // but are separate clickable regions (nested buttons are avoided by using two
  // adjacent buttons inside the tab container).
  const tabBar = (
    <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5" data-testid="dashboard-tabs">
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = activeTab === t.key;
        const isDefault = defaultTab === t.key;
        return (
          <div
            key={t.key}
            className={`inline-flex items-center rounded-md overflow-hidden ${
              active ? "bg-[#ec9324] shadow-sm" : "hover:bg-gray-50"
            }`}
          >
            <button
              type="button"
              onClick={() => setActiveTab(t.key)}
              data-testid={`dashboard-tab-${t.key}`}
              className={`inline-flex items-center gap-1.5 pl-3 pr-2 h-8 text-xs font-medium transition-colors ${
                active ? "text-white" : "text-gray-700"
              }`}
              aria-pressed={active}
            >
              <Icon size={13} />
              {t.label}
            </button>
            {/* Clickable star — toggles default */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDefaultDashboard(t.key);
              }}
              disabled={savingPref || isDefault}
              data-testid={`dashboard-tab-star-${t.key}`}
              title={isDefault ? "Default View" : "Set as Default"}
              aria-label={isDefault ? "Default View" : "Set as Default"}
              className={`group relative h-8 w-7 inline-flex items-center justify-center transition-colors ${
                isDefault
                  ? "cursor-default"
                  : (active
                      ? "hover:bg-white/15 cursor-pointer"
                      : "hover:bg-orange-50 cursor-pointer")
              }`}
            >
              <Star
                size={13}
                className={`transition-all ${
                  isDefault
                    ? (active ? "text-white fill-current" : "text-[#ec9324] fill-current")
                    : (active ? "text-white/70" : "text-gray-400 group-hover:text-[#ec9324]")
                }`}
              />
              {/* Tooltip */}
              <span
                className="pointer-events-none absolute top-full mt-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-gray-800 text-white text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 shadow-md"
              >
                {isDefault ? "Default View" : "Set as Default"}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );

  if (!prefsLoaded) {
    return (
      <Layout title="Dashboard">
        <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
          <Loader className="animate-spin mr-2" size={16} /> Loading…
        </div>
      </Layout>
    );
  }

  if (activeTab === "workspace_manager") {
    return (
      <Layout
        title="Dashboard"
        contentClassName="w-full px-0 pt-0 pb-3 flex flex-col min-h-[calc(100vh-56px)]"
        actions={tabBar}
      >
        {isOverallUser ? <WorkspaceOverallDashboard /> : <MyWorkspaceDashboard />}
      </Layout>
    );
  }

  // Profix tab — legacy stats dashboard with new compact header
  return (
    <ProfixDashboardBody
      navigate={navigate}
      headerActions={tabBar}
    />
  );
}

// ---------- Profix dashboard content ----------
function ProfixDashboardBody({ navigate, headerActions }) {
  const { user } = useAuth();
  const [stats, setStats] = useState({});
  const [dqs, setDqs] = useState([]);
  const [recent, setRecent] = useState([]);
  const [dateFilter, setDateFilter] = useState(getCurrentMonthRange());
  const [refreshTick, setRefreshTick] = useState(0);
  const [loading, setLoading] = useState(false);

  const params = useMemo(() => dateFilterToParams(dateFilter), [dateFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      api.get("/dashboard/stats", { params }),
      api.get("/dashboard/dq-performance", { params }),
      api.get("/dashboard/recent", { params: { kind: "updated", limit: 6, ...params } }),
    ]).then(([s, d, r]) => {
      if (cancelled) return;
      if (s.status === "fulfilled") setStats(s.value.data);
      if (d.status === "fulfilled") setDqs(d.value.data);
      if (r.status === "fulfilled") setRecent(r.value.data);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [params, refreshTick]);

  const goto = (status) => navigate(`/admin/open-tickets${status ? `?status=${encodeURIComponent(status)}` : ""}`);
  const gotoMember = (id) => navigate(`/admin/open-tickets?assigned_to=${id}`);

  const firstName = (user?.name || "").split(" ")[0] || "there";

  return (
    <Layout
      title="Dashboard"
      contentClassName="w-full px-9 sm:px-12 pt-2 pb-4 flex flex-col min-h-[calc(100vh-56px)]"
      actions={headerActions}
    >
      {/* Compact page header — greeting + inline actions (New Request,
          DateFilter, Refresh) sit together on one row, matching the
          personal-dashboard pattern. */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4" data-testid="profix-header">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" data-testid="profix-greeting">
            Hi {firstName} 👋
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{longDate()}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateFilter value={dateFilter} onChange={setDateFilter} className="h-9" />
          <Button
            onClick={() => navigate("/admin/create")}
            data-testid="create-new-ticket-btn"
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white shadow-sm h-9"
          >
            <Plus size={16} className="mr-1.5" /> New Request
          </Button>
          <button
            type="button"
            onClick={() => setRefreshTick((v) => v + 1)}
            className="h-9 w-9 rounded-md border border-gray-200 bg-white text-gray-500 hover:text-[#ec9324] hover:border-[#ec9324] inline-flex items-center justify-center"
            title="Refresh"
            data-testid="profix-refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Total Requests" value={stats.total} icon={Ticket} onClick={() => goto()} />
        <MetricCard label="Open" value={stats.open} color="#ec9324" icon={AlertCircle} onClick={() => goto("Open")} />
        <MetricCard label="In Progress" value={stats.in_progress} color="#22c55e" icon={Loader} onClick={() => goto("In Progress")} />
        <MetricCard label="Closed" value={stats.closed} color="#b2b2b2" icon={CheckCircle2} onClick={() => goto("Closed")} />
      </div>

      <h2 className="text-lg font-semibold text-gray-900 mt-8 mb-3 flex items-center gap-2">
        <Users size={18} className="text-[#ec9324]"/> DQ Team Performance
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {dqs.length === 0 && <div className="text-sm text-gray-400">No DQ members yet.</div>}
        {dqs.map((m) => (
          <button
            key={m.id}
            onClick={() => gotoMember(m.id)}
            data-testid={`dq-perf-${m.email}`}
            className="text-left bg-white rounded-xl p-4 border border-gray-100 shadow-soft hover:shadow-soft-hover transition-all duration-200"
          >
            <div className="flex items-center gap-3">
              <UserAvatar user={m} size={40} showStatusDot={false}/>
              <div>
                <div className="font-semibold text-gray-900">{m.name}</div>
                <div className="text-xs text-gray-500">{m.email}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4 text-center">
              <div className="bg-[#ec9324]/5 rounded-lg py-2">
                <div className="text-2xl font-bold text-[#ec9324]">{m.open}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-500 mt-0.5">Open</div>
              </div>
              <div className="bg-green-50 rounded-lg py-2">
                <div className="text-2xl font-bold text-green-600">{m.in_progress}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-500 mt-0.5">In Progress</div>
              </div>
            </div>
            <div className="mt-3 bg-gray-50 rounded-lg py-2.5 px-3"
              data-testid={`dq-profiles-assigned-${m.email}`}>
              <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium mb-1.5">Profiles Assigned</div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div>
                  <div className="text-base font-bold text-[#ec9324]">{m.open_profiles ?? 0}</div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 mt-0.5">Open</div>
                </div>
                <div>
                  <div className="text-base font-bold text-green-600">{m.in_progress_profiles ?? 0}</div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 mt-0.5">In Progress</div>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <h2 className="text-lg font-semibold text-gray-900 mt-8 mb-3">Recent Updates</h2>
      <div className="grid grid-cols-1 gap-3">
        {recent.length === 0 && <div className="text-sm text-gray-400">No recent updates.</div>}
        {recent.map((t) => <RecentUpdateCard key={t.id} ticket={t} basePath="/admin/tickets" />)}
      </div>
    </Layout>
  );
}
