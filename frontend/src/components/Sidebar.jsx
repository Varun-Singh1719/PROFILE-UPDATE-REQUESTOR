import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  LayoutDashboard, Ticket, Users, Inbox, FilePlus, LogOut, ListChecks, Mail
} from "lucide-react";

const linksByRole = {
  Admin: [
    { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/admin/open-tickets", label: "Open Tickets", icon: Ticket },
    { to: "/admin/unassigned", label: "Unassigned", icon: Inbox },
    { to: "/admin/contacts", label: "Contact List", icon: Users },
  ],
  "Research Associate": [
    { to: "/ra", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/ra/tickets", label: "My Tickets", icon: ListChecks },
    { to: "/ra/create", label: "Create Ticket", icon: FilePlus },
  ],
  "DQ Team": [
    { to: "/dq", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/dq/tickets", label: "My Tickets", icon: ListChecks },
    { to: "/dq/unassigned", label: "Unassigned", icon: Inbox },
  ],
};

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const links = linksByRole[user?.type] || [];

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <aside data-testid="sidebar" className="w-64 bg-white h-screen border-r border-gray-200 flex flex-col sticky top-0">
      <div className="px-6 py-6 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-[#ec9324] flex items-center justify-center text-white font-bold">T</div>
          <div>
            <div className="font-bold text-gray-900 text-lg leading-none">TicketDesk</div>
            <div className="text-xs text-gray-500 mt-0.5">{user?.type}</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            data-testid={`sidebar-link-${label.toLowerCase().replace(/\s/g, "-")}`}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-[#ec9324]/10 text-[#ec9324] font-semibold border-r-4 border-[#ec9324]"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium"
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="px-3 py-3 border-t border-gray-100">
        <div className="px-3 py-2 mb-2">
          <div className="text-sm font-semibold text-gray-900 truncate" data-testid="sidebar-user-name">{user?.name}</div>
          <div className="text-xs text-gray-500 truncate flex items-center gap-1"><Mail size={12}/>{user?.email}</div>
        </div>
        <button
          onClick={handleLogout}
          data-testid="logout-btn"
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium transition-colors"
        >
          <LogOut size={18} /> Logout
        </button>
      </div>
    </aside>
  );
}
