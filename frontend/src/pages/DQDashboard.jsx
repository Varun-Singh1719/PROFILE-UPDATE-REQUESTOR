import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import Layout from "../components/Layout";
import MetricCard from "../components/MetricCard";
import RecentUpdateCard from "../components/RecentUpdateCard";
import DateFilter, { getCurrentMonthRange, dateFilterToParams } from "../components/DateFilter";
import { Ticket, AlertCircle, CheckCircle2, Loader } from "lucide-react";

export default function DQDashboard() {
  const [stats, setStats] = useState({});
  const [recent, setRecent] = useState([]);
  const [dateFilter, setDateFilter] = useState(getCurrentMonthRange());
  const navigate = useNavigate();

  useEffect(() => {
    const params = dateFilterToParams(dateFilter);
    api.get("/dashboard/stats", { params }).then((r) => setStats(r.data));
    api.get("/dashboard/recent", { params: { kind: "new", limit: 6, ...params } }).then((r) => setRecent(r.data));
  }, [dateFilter]);

  const goto = (status) => navigate(`/dq/tickets${status ? `?status=${encodeURIComponent(status)}` : ""}`);

  return (
    <Layout title="DQ Dashboard" description="Requests assigned to you.">
      <div className="flex items-start justify-end flex-wrap gap-4">
        <DateFilter value={dateFilter} onChange={setDateFilter} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-4">
        <MetricCard label="Total Requests" value={stats.total} icon={Ticket} onClick={() => goto()} />
        <MetricCard label="Open" value={stats.open} color="#ec9324" icon={AlertCircle} onClick={() => goto("Open")} />
        <MetricCard label="In Progress" value={stats.in_progress} color="#22c55e" icon={Loader} onClick={() => goto("In Progress")} />
        <MetricCard label="Closed" value={stats.closed} color="#b2b2b2" icon={CheckCircle2} onClick={() => goto("Closed")} />
      </div>

      <h2 className="text-xl font-semibold text-gray-900 mt-12 mb-4">Recent Updates</h2>
      <div className="grid grid-cols-1 gap-4">
        {recent.length === 0 && <div className="text-sm text-gray-400">No requests assigned yet.</div>}
        {recent.map((t) => <RecentUpdateCard key={t.id} ticket={t} basePath="/dq/tickets" />)}
      </div>
    </Layout>
  );
}
