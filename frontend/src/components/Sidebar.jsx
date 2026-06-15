import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { usePermissions } from "../hooks/usePermissions";
import {
  LayoutDashboard, Ticket, Users, Inbox, LogOut, Mail,
  ChevronDown, ChevronRight, Briefcase, Settings, Shield,
  Armchair, Send, MailPlus, PanelLeftClose, PanelLeftOpen,
  Search, Menu, X, CalendarClock, ClipboardList,
  Map, Crosshair, BookUser,
} from "lucide-react";
import AddTaskIcon from "./icons/AddTaskIcon";
import EventSeatRoundedIcon from "./icons/EventSeatRoundedIcon";

// --------------------------------------------------------------------------
// Navigation config (single source of truth)
// --------------------------------------------------------------------------
const NAV_CONFIG = [
  { kind: "link",  to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  {
    kind: "group", label: "ProfiX", icon: Briefcase,
    children: [
      { to: "/admin/open-tickets", label: "Open Requests", icon: Ticket,  perm: { module: "profix", feature: "ticket", action: "view" } },
      { to: "/admin/unassigned",   label: "Unassigned",    icon: Inbox,   perm: { module: "profix", feature: "ticket", action: "assign" } },
    ],
  },
  {
    kind: "group", label: "Workspace Manager", icon: Armchair,
    children: [
      { to: "/workspace-manager/floor-layout", label: "Floor Layout",     icon: Map, perm: { module: "desk_booking", feature: "seat_request", action: "view" } },
      { to: "/workspace-manager/workstation-booking", label: "Workstation Booking", icon: Armchair, perm: { module: "desk_booking", feature: "seat_request", action: "view" } },
      { to: "/workspace-manager/request-workstation", label: "Request Workstation", icon: EventSeatRoundedIcon, perm: { module: "desk_booking", feature: "seat_request", action: "view" } },
      { to: "/workspace-manager/meeting-room-booking", label: "Meeting Room Booking", icon: CalendarClock, perm: { module: "desk_booking", feature: "seat_request", action: "view" } },
      { to: "/workspace-manager/pending-approvals", label: "Pending Approvals", icon: AddTaskIcon, perm: { module: "desk_booking", feature: "seat_request", action: "view" } },
      { to: "/workspace-manager/bookings",     label: "Bookings",          icon: ClipboardList, perm: { module: "desk_booking", feature: "seat_request", action: "view" } },
      { to: "/workspace-manager/floor-plans",  label: "Floor Calibration", icon: Crosshair,   perm: { module: "desk_booking", feature: "seat_request", action: "edit" } },
    ],
  },
  {
    kind: "group", label: "Manage", icon: Settings, superAdminOnly: true,
    children: [
      { to: "/admin/teams",           label: "Teams",           icon: Users },
      { to: "/admin/permissions",     label: "Permissions",     icon: Shield },
      { to: "/admin/email-templates", label: "Email Templates", icon: MailPlus },
      { to: "/admin/notifications",   label: "Notifications",   icon: Send },
      { to: "/admin/contacts",        label: "Employee List",   icon: BookUser },
    ],
  },
];

const STORAGE_KEY = "sidebar:userPreference";   // 'expanded' | 'collapsed' | null
const AUTO_COLLAPSE_MS = 5000;
const MOBILE_BREAKPOINT = 768;

// --------------------------------------------------------------------------
// Flatten config into searchable items
// --------------------------------------------------------------------------
function flattenForSearch(items) {
  const out = [];
  items.forEach(it => {
    if (it.kind === "link") out.push({ to: it.to, label: it.label, icon: it.icon, group: null, perm: it.perm, superAdminOnly: it.superAdminOnly });
    if (it.kind === "group") it.children.forEach(c => out.push({ ...c, group: it.label, superAdminOnly: it.superAdminOnly }));
  });
  return out;
}

// --------------------------------------------------------------------------
// Tooltip wrapper (CSS-only)
// --------------------------------------------------------------------------
function Tip({ label, children, show }) {
  if (!show) return children;
  return (
    <div className="relative group">
      {children}
      <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
        {label}
      </span>
    </div>
  );
}

// --------------------------------------------------------------------------
// Collapsible group (sub-nav)
// --------------------------------------------------------------------------
function NavGroup({ item, collapsed, currentPath, can, isSuperAdmin, onNavigate }) {
  const allowed = item.children.filter(c =>
    item.superAdminOnly ? isSuperAdmin
      : (!c.perm || can(c.perm.module, c.perm.feature, c.perm.action))
  );
  const isChildActive = allowed.some(c => currentPath.startsWith(c.to));
  const [open, setOpen] = useState(isChildActive);
  useEffect(() => { if (isChildActive) setOpen(true); }, [isChildActive]);

  if (allowed.length === 0) return null;
  const GroupIcon = item.icon;
  const groupKey = item.label.toLowerCase().replace(/\s+/g, "-");

  // ---- Collapsed mode: render direct icon links with tooltips (no nesting UI)
  if (collapsed) {
    return (
      <div className="space-y-1">
        {allowed.map(({ to, label, icon: Icon }) => (
          <Tip key={to} label={label} show>
            <NavLink
              to={to}
              onClick={onNavigate}
              data-testid={`sidebar-link-${label.toLowerCase().replace(/\s+/g, "-")}`}
              className={({ isActive }) =>
                `flex items-center justify-center w-10 h-10 mx-auto rounded-lg transition-colors ${
                  isActive ? "bg-[#ec9324]/15 text-[#ec9324]" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                }`
              }
            >
              <Icon size={18} />
            </NavLink>
          </Tip>
        ))}
      </div>
    );
  }

  // ---- Expanded mode: collapsible group
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        data-testid={`sidebar-group-${groupKey}`}
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
          isChildActive ? "bg-[#ec9324]/10 text-[#ec9324] font-semibold" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium"
        }`}
      >
        <span className="flex items-center gap-3"><GroupIcon size={18}/>{item.label}</span>
        {open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
      </button>
      {open && (
        <div className="mt-1 ml-3 pl-3 border-l border-gray-200 space-y-1">
          {allowed.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onNavigate}
              data-testid={`sidebar-link-${label.toLowerCase().replace(/\s+/g, "-")}`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  isActive ? "bg-[#ec9324]/10 text-[#ec9324] font-semibold border-r-4 border-[#ec9324]" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium"
                }`
              }
            >
              <Icon size={15}/>{label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Cmd+K search palette
// --------------------------------------------------------------------------
function SearchPalette({ open, onClose, items }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => { if (open) { setQ(""); setIdx(0); setTimeout(() => inputRef.current?.focus(), 50); } }, [open]);

  const results = useMemo(() => {
    if (!q.trim()) return items.slice(0, 8);
    const needle = q.toLowerCase();
    return items.filter(i =>
      i.label.toLowerCase().includes(needle) ||
      (i.group && i.group.toLowerCase().includes(needle))
    ).slice(0, 12);
  }, [q, items]);

  useEffect(() => { setIdx(0); }, [q]);

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && results[idx]) { navigate(results[idx].to); onClose(); }
    else if (e.key === "Escape") onClose();
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-start justify-center pt-24 px-4" onClick={onClose} data-testid="search-palette">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100">
          <Search size={16} className="text-gray-400"/>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search menu… (try 'seat' or 'floor')"
            data-testid="search-palette-input"
            className="flex-1 outline-none text-sm"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">esc</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-gray-500">No matches</li>
          ) : results.map((r, i) => {
            const Icon = r.icon;
            return (
              <li key={r.to}>
                <button
                  data-testid={`search-result-${r.label.toLowerCase().replace(/\s+/g, "-")}`}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => { navigate(r.to); onClose(); }}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left ${i === idx ? "bg-[#ec9324]/10 text-[#ec9324]" : "text-gray-700 hover:bg-gray-50"}`}
                >
                  <Icon size={15}/>
                  <span className="flex-1">{r.label}</span>
                  {r.group && <span className="text-[10px] text-gray-400">{r.group}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="px-3 py-1.5 border-t border-gray-100 text-[10px] text-gray-500 flex gap-3">
          <span><kbd className="px-1 bg-gray-100 rounded">↑</kbd> <kbd className="px-1 bg-gray-100 rounded">↓</kbd> navigate</span>
          <span><kbd className="px-1 bg-gray-100 rounded">↵</kbd> open</span>
          <span><kbd className="px-1 bg-gray-100 rounded">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// SIDEBAR — single component, handles desktop + mobile
// --------------------------------------------------------------------------
export default function Sidebar() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const isSuperAdmin = user?.role === "Super Admin";

  // ---- Width / collapse state
  const initialPref = (typeof window !== "undefined") ? window.localStorage.getItem(STORAGE_KEY) : null;
  const [collapsed, setCollapsed] = useState(initialPref === "collapsed");
  const [userTouched, setUserTouched] = useState(initialPref !== null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT);
  const [searchOpen, setSearchOpen] = useState(false);

  // Track viewport for mobile
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Auto-collapse after AUTO_COLLAPSE_MS unless user has manually set a preference
  useEffect(() => {
    if (userTouched || isMobile) return;
    const t = setTimeout(() => setCollapsed(true), AUTO_COLLAPSE_MS);
    return () => clearTimeout(t);
  }, [userTouched, isMobile]);

  // Close mobile drawer on route change
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Cmd+K shortcut for quick nav
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const toggle = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      window.localStorage.setItem(STORAGE_KEY, next ? "collapsed" : "expanded");
      setUserTouched(true);
      return next;
    });
  }, []);

  const handleLogout = async () => { navigate("/login"); }; // legacy — logout now lives in TopBar
  const onNavigateMobile = () => setMobileOpen(false);

  const flatItems = useMemo(() => flattenForSearch(NAV_CONFIG).filter(it =>
    it.superAdminOnly ? isSuperAdmin
      : (!it.perm || can(it.perm.module, it.perm.feature, it.perm.action))
  ), [isSuperAdmin, can]);

  // Mobile: hamburger button + drawer
  if (isMobile) {
    return (
      <>
        <button
          onClick={() => setMobileOpen(true)}
          data-testid="sidebar-hamburger"
          className="fixed top-3 left-3 z-40 p-2 rounded-lg bg-white shadow-lg border border-gray-200"
        >
          <Menu size={18}/>
        </button>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 flex" data-testid="sidebar-mobile-drawer">
            <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)}/>
            <aside className="relative w-64 bg-white h-full flex flex-col shadow-2xl">
              <SidebarHeader collapsed={false} user={user} onToggle={() => setMobileOpen(false)} mobile onSearch={() => setSearchOpen(true)}/>
              <SidebarNav collapsed={false} currentPath={location.pathname} can={can} isSuperAdmin={isSuperAdmin} onNavigate={onNavigateMobile}/>
            </aside>
          </div>
        )}
        <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} items={flatItems}/>
      </>
    );
  }

  return (
    <>
      <aside
        data-testid="sidebar"
        data-collapsed={collapsed}
        className={`bg-white border-r border-gray-200 flex flex-col fixed top-0 left-0 h-screen z-30 transition-all duration-200 ${collapsed ? "w-16" : "w-64"}`}
      >
        <SidebarHeader collapsed={collapsed} user={user} onToggle={toggle} onSearch={() => setSearchOpen(true)}/>
        <SidebarNav collapsed={collapsed} currentPath={location.pathname} can={can} isSuperAdmin={isSuperAdmin}/>
      </aside>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} items={flatItems}/>
    </>
  );
}

// --------------------------------------------------------------------------
// Header (brand + collapse toggle + search button)
// --------------------------------------------------------------------------
function SidebarHeader({ collapsed, user, onToggle, mobile, onSearch }) {
  return (
    <div className={`border-b border-gray-100 ${collapsed ? "px-2 py-3" : "px-4 py-4"}`}>
      <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} gap-2`}>
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <img src="https://customer-assets.emergentagent.com/job_support-core-4/artifacts/w6k7hdz0_Infollion%20Logo.svg" alt="Infollion" className="h-7 w-auto flex-shrink-0"/>
            <div className="min-w-0">
              <div className="font-bold text-gray-900 text-base leading-tight truncate">Infollion</div>
              <div className="text-[10px] text-gray-500 truncate">{user?.role}</div>
            </div>
          </div>
        )}
        <Tip label={mobile ? "Close" : (collapsed ? "Expand sidebar" : "Collapse sidebar")} show={collapsed}>
          <button
            onClick={onToggle}
            data-testid="sidebar-toggle"
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {mobile ? <X size={16}/> : (collapsed ? <PanelLeftOpen size={16}/> : <PanelLeftClose size={16}/>)}
          </button>
        </Tip>
      </div>
      <Tip label="Search menu (⌘K)" show={collapsed}>
        <button
          onClick={onSearch}
          data-testid="sidebar-search-btn"
          className={`mt-2 flex items-center gap-2 text-xs text-gray-500 hover:bg-gray-50 border border-gray-200 rounded-md transition-colors ${collapsed ? "justify-center w-10 h-8 mx-auto" : "w-full px-2 py-1.5"}`}
        >
          <Search size={13}/>
          {!collapsed && <>
            <span className="flex-1 text-left">Search…</span>
            <kbd className="text-[9px] px-1 bg-gray-100 rounded">⌘K</kbd>
          </>}
        </button>
      </Tip>
    </div>
  );
}

// --------------------------------------------------------------------------
// Nav list
// --------------------------------------------------------------------------
function SidebarNav({ collapsed, currentPath, can, isSuperAdmin, onNavigate }) {
  // CSS quirk: setting overflow-y on one axis coerces the other to non-visible too.
  // For the collapsed icon-only view we keep `overflow-visible` so hover tooltips
  // (which extend to the right of the sidebar) are not clipped.
  return (
    <nav className={`flex-1 py-3 space-y-1 ${collapsed ? "px-1.5 overflow-visible" : "px-3 overflow-y-auto overflow-x-hidden"}`}>
      {NAV_CONFIG.map(item => {
        if (item.kind === "link") {
          if (item.perm && !isSuperAdmin && !can(item.perm.module, item.perm.feature, item.perm.action)) return null;
          const { to, label, icon: Icon, end } = item;
          const testid = `sidebar-link-${label.toLowerCase().replace(/\s+/g, "-")}`;
          if (collapsed) {
            return (
              <Tip key={to} label={label} show>
                <NavLink
                  to={to} end={end} onClick={onNavigate} data-testid={testid}
                  className={({ isActive }) =>
                    `flex items-center justify-center w-10 h-10 mx-auto rounded-lg transition-colors ${isActive ? "bg-[#ec9324]/15 text-[#ec9324]" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"}`
                  }
                ><Icon size={18}/></NavLink>
              </Tip>
            );
          }
          return (
            <NavLink
              key={to} to={to} end={end} onClick={onNavigate} data-testid={testid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? "bg-[#ec9324]/10 text-[#ec9324] font-semibold border-r-4 border-[#ec9324]" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium"}`
              }
            ><Icon size={17}/>{label}</NavLink>
          );
        }
        return (
          <NavGroup
            key={item.label}
            item={item}
            collapsed={collapsed}
            currentPath={currentPath}
            can={can}
            isSuperAdmin={isSuperAdmin}
            onNavigate={onNavigate}
          />
        );
      })}
    </nav>
  );
}

// --------------------------------------------------------------------------
// Footer (user + logout)
// --------------------------------------------------------------------------
function SidebarFooter({ collapsed, user, onLogout }) {
  if (collapsed) {
    return (
      <div className="border-t border-gray-100 py-2 px-1.5">
        <Tip label={user?.name || "Account"} show>
          <div className="w-10 h-10 mx-auto rounded-full bg-[#ec9324]/15 text-[#ec9324] font-bold flex items-center justify-center text-sm">
            {(user?.name || "?").trim().charAt(0).toUpperCase()}
          </div>
        </Tip>
        <Tip label="Logout" show>
          <button onClick={onLogout} data-testid="logout-btn" className="mt-2 w-10 h-10 mx-auto flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900">
            <LogOut size={16}/>
          </button>
        </Tip>
      </div>
    );
  }
  return (
    <div className="px-3 py-3 border-t border-gray-100">
      <div className="px-2 py-1.5 mb-1.5">
        <div className="text-sm font-semibold text-gray-900 truncate" data-testid="sidebar-user-name">{user?.name}</div>
        <div className="text-xs text-gray-500 truncate flex items-center gap-1"><Mail size={12}/>{user?.email}</div>
      </div>
      <button onClick={onLogout} data-testid="logout-btn" className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium transition-colors">
        <LogOut size={16}/> Logout
      </button>
    </div>
  );
}
