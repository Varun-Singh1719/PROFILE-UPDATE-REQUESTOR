import React, { useState, useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { usePermissions } from "../hooks/usePermissions";
import {
  LayoutDashboard, Ticket, Users, Inbox, LogOut, Mail,
  ChevronDown, ChevronRight, Briefcase, Settings, Shield, UsersRound, Armchair, Send, MailPlus
} from "lucide-react";

// v3 role model — two canonical roles: Super Admin, Admin.
// Common nav (ProfiX + Desk Booking) is shown to everyone; items are further hidden
// when the user lacks the corresponding permission on their assigned Permission Sets.
// The "Manage" group (employee/team/permission-set administration) is Super Admin only.
const COMMON_LINKS = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  {
    label: "ProfiX",
    icon: Briefcase,
    group: true,
    children: [
      { to: "/admin/open-tickets", label: "Open Requests", icon: Ticket, perm: { module: "profix", feature: "ticket", action: "view" } },
      { to: "/admin/unassigned", label: "Unassigned", icon: Inbox, perm: { module: "profix", feature: "ticket", action: "assign" } },
    ],
  },
  { to: "/desk-booking", label: "Desk Booking", icon: Armchair, perm: { module: "desk_booking", feature: "seat_request", action: "view" } },
];

const SUPER_ADMIN_MANAGE_GROUP = {
  label: "Manage",
  icon: Settings,
  group: true,
  superAdminOnly: true,
  children: [
    { to: "/admin/teams", label: "Teams", icon: UsersRound },
    { to: "/admin/permissions", label: "Permissions", icon: Shield },
    { to: "/admin/email-templates", label: "Email Templates", icon: MailPlus },
    { to: "/admin/notifications", label: "Notifications", icon: Send },
    { to: "/admin/contacts", label: "Employee List", icon: Users },
  ],
};

function CollapsibleGroup({ item, currentPath, can }) {
  // Items inside the Manage group are Super-Admin-only and ignore permission gating.
  const isSuperAdminGroup = !!item.superAdminOnly;
  const allowedChildren = (item.children || []).filter(
    (c) => isSuperAdminGroup || !c.perm || can(c.perm.module, c.perm.feature, c.perm.action)
  );
  const childPaths = allowedChildren.map((c) => c.to);
  const isChildActive = childPaths.some((p) => currentPath.startsWith(p));
  const [open, setOpen] = useState(isChildActive);

  useEffect(() => {
    if (isChildActive) setOpen(true);
  }, [isChildActive]);

  if (allowedChildren.length === 0) return null;

  const GroupIcon = item.icon;
  const groupKey = item.label.toLowerCase().replace(/\s/g, "-");

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid={`sidebar-group-${groupKey}`}
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
          isChildActive
            ? "bg-[#ec9324]/10 text-[#ec9324] font-semibold"
            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium"
        }`}
      >
        <span className="flex items-center gap-3">
          <GroupIcon size={18} />
          {item.label}
        </span>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && (
        <div className="mt-1 ml-3 pl-3 border-l border-gray-200 space-y-1">
          {allowedChildren.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              data-testid={`sidebar-link-${label.toLowerCase().replace(/\s/g, "-")}`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-[#ec9324]/10 text-[#ec9324] font-semibold border-r-4 border-[#ec9324]"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium"
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();

  const isSuperAdmin = user?.role === "Super Admin";
  const links = [...COMMON_LINKS, ...(isSuperAdmin ? [SUPER_ADMIN_MANAGE_GROUP] : [])];

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <aside data-testid="sidebar" className="w-64 bg-white h-screen border-r border-gray-200 flex flex-col sticky top-0">
      <div className="px-6 py-6 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <img
            src="https://customer-assets.emergentagent.com/job_support-core-4/artifacts/w6k7hdz0_Infollion%20Logo.svg"
            alt="Infollion"
            className="h-8 w-auto"
          />
          <div>
            <div className="font-bold text-gray-900 text-lg leading-none">Infollion</div>
            <div className="text-xs text-gray-500 mt-0.5">{user?.role}</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {links.map((item) => {
          if (item.group) {
            return (
              <CollapsibleGroup
                key={item.label}
                item={item}
                currentPath={location.pathname}
                can={can}
              />
            );
          }
          // Top-level link, check permission if set. Super Admin bypasses gating via usePermissions hook.
          if (item.perm && !isSuperAdmin && !can(item.perm.module, item.perm.feature, item.perm.action)) return null;
          const { to, label, icon: Icon, end } = item;
          return (
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
          );
        })}
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
