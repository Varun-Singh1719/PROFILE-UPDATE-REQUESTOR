import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import Layout from "../components/Layout";
import MetricCard from "../components/MetricCard";
import RecentUpdateCard from "../components/RecentUpdateCard";
import DateFilter, { getCurrentMonthRange, dateFilterToParams } from "../components/DateFilter";
import { Button } from "../components/ui/button";
import { Ticket, AlertCircle, CheckCircle2, Loader, Users, Plus } from "lucide-react";

export default function ManagerDashboard() {
  const [stats, setStats] = useState({});
  const [dqs, setDqs] = useState([]);
  const [recent, setRecent] = useState([]);
  const [dateFilter, setDateFilter] = useState(getCurrentMonthRange());
  const navigate = useNavigate();

  useEffect(() => {
    const params = dateFilterToParams(dateFilter);
    api.get("/dashboard/stats", { params }).then((r) => setStats(r.data));
    api.get("/dashboard/dq-performance", { params }).then((r) => setDqs(r.data));
    api.get("/dashboard/recent", { params: { kind: "updated", limit: 6, ...params } }).then((r) => setRecent(r.data));
  }, [dateFilter]);

  const goto = (status) => navigate(`/manager/open-tickets${status ? `?status=${encodeURIComponent(status)}` : ""}`);
  const gotoMember = (id) => navigate(`/manager/open-tickets?assigned_to=${id}`);

  return (
    <Layout
      title="Manager Dashboard"
      actions={
        <>
          <DateFilter value={dateFilter} onChange={setDateFilter} />
          <Button
            onClick={() => navigate("/manager/create")}
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
              <div className="w-10 h-10 rounded-full bg-[#ec9324]/10 text-[#ec9324] flex items-center justify-center font-bold">
                {m.name?.[0]?.toUpperCase()}
              </div>
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
            <div className="mt-3 bg-gray-50 rounded-lg py-2.5 px-3">
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
        {recent.map((t) => <RecentUpdateCard key={t.id} ticket={t} basePath="/manager/tickets" />)}
      </div>
    </Layout>
  );
}
