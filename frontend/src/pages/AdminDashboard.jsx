import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import Layout from "../components/Layout";
import MetricCard from "../components/MetricCard";
import TicketCard from "../components/TicketCard";
import { Ticket, AlertCircle, CheckCircle2, Loader, Users } from "lucide-react";

export default function AdminDashboard() {
  const [stats, setStats] = useState({});
  const [dqs, setDqs] = useState([]);
  const [recent, setRecent] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/dashboard/stats").then((r) => setStats(r.data));
    api.get("/dashboard/dq-performance").then((r) => setDqs(r.data));
    api.get("/dashboard/recent", { params: { kind: "updated", limit: 6 } }).then((r) => setRecent(r.data));
  }, []);

  const goto = (status) => navigate(`/admin/open-tickets${status ? `?status=${encodeURIComponent(status)}` : ""}`);
  const gotoMember = (id) => navigate(`/admin/open-tickets?assigned_to=${id}`);

  return (
    <Layout>
      <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Admin Dashboard</h1>
      <p className="text-gray-500 mt-1">Organization-wide ticket overview.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-8">
        <MetricCard label="Total Tickets" value={stats.total} icon={Ticket} onClick={() => goto()} />
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
            <div className="grid grid-cols-4 gap-2 mt-4 text-center">
              <div><div className="text-lg font-bold text-gray-900">{m.total}</div><div className="text-[10px] uppercase tracking-wide text-gray-500">Total</div></div>
              <div><div className="text-lg font-bold text-[#ec9324]">{m.open}</div><div className="text-[10px] uppercase tracking-wide text-gray-500">Open</div></div>
              <div><div className="text-lg font-bold text-green-600">{m.in_progress}</div><div className="text-[10px] uppercase tracking-wide text-gray-500">In Prog</div></div>
              <div><div className="text-lg font-bold text-gray-500">{m.closed}</div><div className="text-[10px] uppercase tracking-wide text-gray-500">Closed</div></div>
            </div>
          </button>
        ))}
      </div>

      <h2 className="text-xl font-semibold text-gray-900 mt-12 mb-4">Recently Updated Tickets</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {recent.map((t) => <TicketCard key={t.id} ticket={t} basePath="/admin/tickets" />)}
      </div>
    </Layout>
  );
}
