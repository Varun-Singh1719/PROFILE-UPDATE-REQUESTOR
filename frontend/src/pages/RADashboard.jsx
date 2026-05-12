import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../lib/api";
import Layout from "../components/Layout";
import MetricCard from "../components/MetricCard";
import TicketCard from "../components/TicketCard";
import { Ticket, AlertCircle, CheckCircle2, Loader } from "lucide-react";

export default function RADashboard() {
  const [stats, setStats] = useState({});
  const [recent, setRecent] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/dashboard/stats").then((r) => setStats(r.data));
    api.get("/dashboard/recent", { params: { kind: "updated", limit: 6 } }).then((r) => setRecent(r.data));
  }, []);

  const goto = (status) => navigate(`/ra/tickets${status ? `?status=${encodeURIComponent(status)}` : ""}`);

  return (
    <Layout>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Dashboard</h1>
          <p className="text-gray-500 mt-1">Your ticket activity at a glance.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-8">
        <MetricCard label="Total Tickets" value={stats.total} icon={Ticket} onClick={() => goto()} />
        <MetricCard label="Open" value={stats.open} color="#ec9324" icon={AlertCircle} onClick={() => goto("Open")} />
        <MetricCard label="In Progress" value={stats.in_progress} color="#22c55e" icon={Loader} onClick={() => goto("In Progress")} />
        <MetricCard label="Closed" value={stats.closed} color="#b2b2b2" icon={CheckCircle2} onClick={() => goto("Closed")} />
      </div>

      <h2 className="text-xl font-semibold text-gray-900 mt-12 mb-4">Recently Updated Tickets</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {recent.length === 0 && <div className="text-sm text-gray-400">No tickets yet. Create your first ticket.</div>}
        {recent.map((t) => <TicketCard key={t.id} ticket={t} basePath="/ra/tickets" />)}
      </div>
    </Layout>
  );
}
