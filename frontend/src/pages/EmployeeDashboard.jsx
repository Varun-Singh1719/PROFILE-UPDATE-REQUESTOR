import React from "react";
import Layout from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { Briefcase, Mail, Calendar, IdCard, UsersRound, ShieldCheck } from "lucide-react";

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 text-sm py-2">
      <div className="w-9 h-9 rounded-lg bg-[#ec9324]/10 text-[#ec9324] flex items-center justify-center shrink-0">
        <Icon size={16}/>
      </div>
      <div className="flex-1">
        <div className="text-xs text-gray-500 uppercase tracking-wider">{label}</div>
        <div className="font-medium text-gray-900 mt-0.5">{value || <span className="text-gray-400">—</span>}</div>
      </div>
    </div>
  );
}

export default function EmployeeDashboard() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <Layout>
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight" data-testid="employee-dashboard-title">
          Welcome, {user.name?.split(" ")[0]}
        </h1>
        <p className="text-gray-500 mt-1">
          Your access to modules is permission-driven. Reach out to your admin if a feature is missing from the sidebar.
        </p>

        <div className="mt-8 bg-white rounded-xl shadow-soft border border-gray-100 p-6">
          <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-lg"
              style={{ backgroundColor: user.team_color || "#ec9324" }}
            >
              {user.name?.[0]?.toUpperCase()}
            </div>
            <div>
              <div className="font-bold text-gray-900 text-lg">{user.name}</div>
              <div className="text-xs text-gray-500">{user.role}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 mt-2">
            <InfoRow icon={Mail} label="Email" value={user.email}/>
            <InfoRow icon={IdCard} label="Employee ID" value={user.emp_id}/>
            <InfoRow icon={Calendar} label="Date of Joining" value={user.doj}/>
            <InfoRow icon={Briefcase} label="Role" value={user.role}/>
            <InfoRow icon={UsersRound} label="Team" value={user.team_name}/>
            <InfoRow icon={ShieldCheck} label="Status" value={user.status}/>
          </div>
        </div>
      </div>
    </Layout>
  );
}
