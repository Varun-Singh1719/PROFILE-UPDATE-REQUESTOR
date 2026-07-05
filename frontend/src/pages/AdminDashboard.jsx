/**
 * AdminDashboard — Unified dashboard with two tabs:
 *   • Workspace Manager (default) — Floor Layout view
 *   • Profix                       — legacy stats + DQ + recent-updates dashboard
 *
 * Users can pick their preferred default tab; the preference is persisted
 * server-side via /api/profile/preferences and re-loaded on every mount.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import Layout from "../components/Layout";
import MetricCard from "../components/MetricCard";
import RecentUpdateCard from "../components/RecentUpdateCard";
import DateFilter, { getCurrentMonthRange, dateFilterToParams } from "../components/DateFilter";
import { Button } from "../components/ui/button";
import UserAvatar from "../components/UserAvatar";
import { Ticket, AlertCircle, CheckCircle2, Loader, Users, Plus, LayoutGrid, ClipboardList, Star, Check } from "lucide-react";
import { toast } from "../lib/notify";
import { FloorLayoutView } from "./FloorLayoutPage";

const TABS = [
  { key: "workspace_manager", label: "Workspace Manager", icon: LayoutGrid },
  { key: "profix",            label: "Profix",            icon: ClipboardList },
];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("workspace_manager");
  const [defaultTab, setDefaultTab] = useState("workspace_manager");
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [savingPref, setSavingPref] = useState(false);

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

  // Tab bar renders inside the actions region so it stays at the top on all tabs.
  const tabBar = (
    <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5" data-testid="dashboard-tabs">
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = activeTab === t.key;
        const isDefault = defaultTab === t.key;
        return (
          <div key={t.key} className="relative">
            <button
              type="button"
              onClick={() => setActiveTab(t.key)}
              data-testid={`dashboard-tab-${t.key}`}
              className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium transition-colors ${
                active
                  ? "bg-[#ec9324] text-white shadow-sm"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
              aria-pressed={active}
            >
              <Icon size={13} />
              {t.label}
              {isDefault && (
                <Star size={11} className={active ? "text-white/90 fill-current" : "text-[#ec9324] fill-current"} />
              )}
            </button>
          </div>
        );
      })}
    </div>
  );

  // "Set as default" action (only relevant when the active tab isn't already default)
  const setDefaultButton = (
    activeTab !== defaultTab ? (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setDefaultDashboard(activeTab)}
        disabled={savingPref}
        data-testid="set-default-dashboard-btn"
        className="h-9 text-xs"
        title="Make this tab the default dashboard view"
      >
        <Star size={13} className="mr-1" />
        Set as default
      </Button>
    ) : (
      <div className="inline-flex items-center gap-1 h-9 px-2 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-medium"
           data-testid="default-dashboard-badge">
        <Check size={12} /> Default
      </div>
    )
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
        fullBleed
        contentClassName="flex flex-col min-h-[calc(100vh-56px)]"
        actions={
          <>
            {tabBar}
            {setDefaultButton}
          </>
        }
      >
        <div className="flex-1 flex flex-col">
          <FloorLayoutView embedded />
        </div>
      </Layout>
    );
  }

  // Profix tab — legacy stats dashboard
  return (
    <ProfixDashboardBody
      navigate={navigate}
      headerActions={
        <>
          {tabBar}
          {setDefaultButton}
        </>
      }
    />
  );
}

// ---------- Profix dashboard content ----------
function ProfixDashboardBody({ navigate, headerActions }) {
  const [stats, setStats] = useState({});
  const [dqs, setDqs] = useState([]);
  const [recent, setRecent] = useState([]);
  const [dateFilter, setDateFilter] = useState(getCurrentMonthRange());

  useEffect(() => {
    const params = dateFilterToParams(dateFilter);
    api.get("/dashboard/stats", { params }).then((r) => setStats(r.data));
    api.get("/dashboard/dq-performance", { params }).then((r) => setDqs(r.data));
    api.get("/dashboard/recent", { params: { kind: "updated", limit: 6, ...params } }).then((r) => setRecent(r.data));
  }, [dateFilter]);

  const goto = (status) => navigate(`/admin/open-tickets${status ? `?status=${encodeURIComponent(status)}` : ""}`);
  const gotoMember = (id) => navigate(`/admin/open-tickets?assigned_to=${id}`);

  return (
    <Layout
      title="Dashboard"
      actions={
        <>
          {headerActions}
          <DateFilter value={dateFilter} onChange={setDateFilter} />
          <Button
            onClick={() => navigate("/admin/create")}
            data-testid="create-new-ticket-btn"
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white shadow-sm h-9"
          >
            <Plus size={16} className="mr-1.5" /> New Request
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard label="Total Requests" value={stats.total} icon={Ticket} onClick={() => goto()} />
        <MetricCard label="Open" value={stats.open} color="#ec9324" icon={AlertCircle} onClick={() => goto("Open")} />
        <MetricCard label="In Progress" value={stats.in_progress} color="#22c55e" icon={Loader} onClick={() => goto("In Progress")} />
        <MetricCard label="Closed" value={stats.closed} color="#b2b2b2" icon={CheckCircle2} onClick={() => goto("Closed")} />
      </div>

      <h2 className="text-xl font-semibold text-gray-900 mt-12 mb-4 flex items-center gap-2">
        <Users size={20} className="text-[#ec9324]"/> DQ Team Performance
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {dqs.length === 0 && <div className="text-sm text-gray-400">No DQ members yet.</div>}
        {dqs.map((m) => (
          <button
            key={m.id}
            onClick={() => gotoMember(m.id)}
            data-testid={`dq-perf-${m.email}`}
            className="text-left bg-white rounded-xl p-5 border border-gray-100 shadow-soft hover:shadow-soft-hover transition-all duration-200"
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

      <h2 className="text-xl font-semibold text-gray-900 mt-12 mb-4">Recent Updates</h2>
      <div className="grid grid-cols-1 gap-4">
        {recent.length === 0 && <div className="text-sm text-gray-400">No recent updates.</div>}
        {recent.map((t) => <RecentUpdateCard key={t.id} ticket={t} basePath="/admin/tickets" />)}
      </div>
    </Layout>
  );
}
