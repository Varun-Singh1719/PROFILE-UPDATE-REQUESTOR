import React, { useEffect, useRef, useState, useCallback, useMemo, useContext } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { usePermissions } from "../hooks/usePermissions";
import { useEffectivePermissionsState } from "../context/EffectivePermissionsContext";
import LayoutDashboard from "@mui/icons-material/DashboardOutlined";
import Ticket from "@mui/icons-material/ConfirmationNumberOutlined";
import Users from "@mui/icons-material/PeopleOutlined";
import Inbox from "@mui/icons-material/InboxOutlined";
import LogOut from "@mui/icons-material/LogoutOutlined";
import Mail from "@mui/icons-material/MailOutlined";
import ChevronDown from "@mui/icons-material/KeyboardArrowDown";
import ChevronRight from "@mui/icons-material/ChevronRight";
import Briefcase from "@mui/icons-material/WorkOutlined";
import Settings from "@mui/icons-material/SettingsOutlined";
import Shield from "@mui/icons-material/ShieldOutlined";
import Armchair from "@mui/icons-material/Chair";
import Send from "@mui/icons-material/Send";
import OutboxIcon from "@mui/icons-material/Outbox";
import NotificationsIcon from "@mui/icons-material/NotificationsNone";
import MailPlus from "@mui/icons-material/ForwardToInboxOutlined";
import PanelLeftClose from "@mui/icons-material/KeyboardDoubleArrowLeft";
import PanelLeftOpen from "@mui/icons-material/KeyboardDoubleArrowRight";
import Search from "@mui/icons-material/SearchOutlined";
import Menu from "@mui/icons-material/Menu";
import X from "@mui/icons-material/Close";
import CalendarClock from "@mui/icons-material/EventOutlined";
import ClipboardList from "@mui/icons-material/AssignmentOutlined";
import Map from "@mui/icons-material/MapOutlined";
import Crosshair from "@mui/icons-material/GpsFixed";
import BookUser from "@mui/icons-material/ContactPageOutlined";
import CircleDot from "@mui/icons-material/RadioButtonChecked";
import AddTaskIcon from "./icons/AddTaskIcon";
import EventSeatRoundedIcon from "./icons/EventSeatRoundedIcon";

// --------------------------------------------------------------------------
// Navigation config (single source of truth)
// --------------------------------------------------------------------------
// `v3` = { module, page } — when the current user's effective page-level view
// is HIDDEN (visible=false), the link is dropped from the sidebar. Absent means
// the item isn't gated by v3 visibility.
const NAV_CONFIG = [
  { kind: "link",  to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  {
    kind: "group", label: "ProfiX", icon: Briefcase,
    children: [
      { to: "/admin/open-tickets", label: "All Requests", icon: Ticket,  perm: { module: "profix", feature: "ticket", action: "view" }, v3: { module: "profix", page: "all_requests" } },
      { to: "/admin/open-requests", label: "Open Requests", icon: CircleDot, perm: { module: "profix", feature: "ticket", action: "view" }, v3: { module: "profix", page: "open_requests" } },
      { to: "/admin/unassigned",   label: "Unassigned",    icon: Inbox,   perm: { module: "profix", feature: "ticket", action: "assign" }, v3: { module: "profix", page: "unassigned" } },
    ],
  },
  {
    kind: "group", label: "Workspace Manager", icon: Armchair,
    children: [
      { to: "/workspace-manager/floor-layout", label: "Floor Layout",     icon: Map, perm: { module: "desk_booking", feature: "seat_request", action: "view" }, v3: { module: "desk_booking", page: "floor_layout" } },
      { to: "/workspace-manager/workstation-booking", label: "Workstation Booking", icon: Armchair, perm: { module: "desk_booking", feature: "seat_request", action: "view" }, v3: { module: "desk_booking", page: "workstation_bookings" } },
      { to: "/workspace-manager/request-workstation", label: "Request Workstation", icon: EventSeatRoundedIcon, perm: { module: "desk_booking", feature: "seat_request", action: "view" }, v3: { module: "desk_booking", page: "workstation_requests" } },
      { to: "/workspace-manager/meeting-room-booking", label: "Meeting Room Booking", icon: CalendarClock, perm: { module: "desk_booking", feature: "seat_request", action: "view" }, v3: { module: "desk_booking", page: "meeting_room_bookings" } },
      { to: "/workspace-manager/pending-approvals", label: "Pending Approvals", icon: AddTaskIcon, perm: { module: "desk_booking", feature: "seat_request", action: "view" }, v3: { module: "desk_booking", page: "pending_approvals" } },
      { to: "/workspace-manager/bookings",     label: "Bookings",          icon: ClipboardList, perm: { module: "desk_booking", feature: "seat_request", action: "view" } },
      { to: "/workspace-manager/floor-plans",  label: "Floor Calibration", icon: Crosshair,   perm: { module: "desk_booking", feature: "seat_request", action: "edit" }, v3: { module: "desk_booking", page: "floor_plans" } },
    ],
  },
  {
    kind: "group", label: "Manage", icon: Settings, superAdminOnly: true,
    children: [
      { to: "/admin/teams",           label: "Teams",           icon: Users,    v3: { module: "manage", page: "teams" } },
      { to: "/admin/permissions",     label: "Permissions",     icon: Shield },
      { to: "/admin/email-templates", label: "Email Templates", icon: MailPlus, v3: { module: "manage", page: "email_templates" } },
      { to: "/admin/notification-templates", label: "Notifications", icon: NotificationsIcon, v3: { module: "manage", page: "email_templates" } },
      { to: "/admin/notifications",   label: "Outbox",          icon: OutboxIcon, v3: { module: "manage", page: "notifications" } },
      { to: "/admin/contacts",        label: "Employee List",   icon: BookUser, v3: { module: "manage", page: "employees" } },
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
function NavGroup({ item, collapsed, currentPath, can, isSuperAdmin, isPageViewVisible, onNavigate }) {
  const allowed = item.children.filter(c => {
    if (item.superAdminOnly && !isSuperAdmin) return false;
    if (c.perm && !isSuperAdmin && !can(c.perm.module, c.perm.feature, c.perm.action)) return false;
    if (c.v3 && !isPageViewVisible(c.v3.module, c.v3.page)) return false;
    return true;
  });
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
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
          isChildActive ? "bg-[#ec9324]/10 text-[#ec9324] font-semibold" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium"
        }`}
      >
        <span className="flex items-center gap-2.5 min-w-0"><GroupIcon sx={{ fontSize: 18 }} className="flex-shrink-0"/><span className="truncate whitespace-nowrap">{item.label}</span></span>
        {open ? <ChevronDown sx={{ fontSize: 14 }} className="flex-shrink-0"/> : <ChevronRight sx={{ fontSize: 14 }} className="flex-shrink-0"/>}
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
                `flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  isActive ? "bg-[#ec9324]/10 text-[#ec9324] font-semibold border-r-4 border-[#ec9324]" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium"
                }`
              }
            >
              <Icon sx={{ fontSize: 15 }} className="flex-shrink-0"/><span className="truncate whitespace-nowrap">{label}</span>
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
          <Search sx={{ fontSize: 16 }} className="text-gray-400"/>
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
  const { isPageViewVisible, hasAnySet, ready: permsReady } = useEffectivePermissionsState();
  const navigate = useNavigate();
  const location = useLocation();
  const isSuperAdmin = user?.role === "Super Admin";
  // STRICT gating: any non-Super-Admin without an assigned Permission Set
  // sees an empty sidebar + the "No Module Assigned" hint. Wait for
  // `permsReady` so we don't flash the empty state during the initial
  // /api/me/permissions load.
  const noAccess = permsReady && !isSuperAdmin && !hasAnySet;

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

  const flatItems = useMemo(() => {
    if (noAccess) return [];
    return flattenForSearch(NAV_CONFIG).filter(it => {
      if (it.superAdminOnly && !isSuperAdmin) return false;
      if (it.perm && !isSuperAdmin && !can(it.perm.module, it.perm.feature, it.perm.action)) return false;
      if (it.v3 && !isPageViewVisible(it.v3.module, it.v3.page)) return false;
      return true;
    });
  }, [isSuperAdmin, can, isPageViewVisible, noAccess]);

  // Mobile: hamburger button + drawer
  if (isMobile) {
    return (
      <>
        <button
          onClick={() => setMobileOpen(true)}
          data-testid="sidebar-hamburger"
          className="fixed top-3 left-3 z-40 p-2 rounded-lg bg-white shadow-lg border border-gray-200"
        >
          <Menu sx={{ fontSize: 18 }}/>
        </button>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 flex" data-testid="sidebar-mobile-drawer">
            <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)}/>
            <aside className="relative w-64 bg-white h-full flex flex-col shadow-2xl">
              <SidebarHeader collapsed={false} user={user} onToggle={() => setMobileOpen(false)} mobile onSearch={() => setSearchOpen(true)}/>
              <SidebarNav collapsed={false} currentPath={location.pathname} can={can} isSuperAdmin={isSuperAdmin} isPageViewVisible={isPageViewVisible} onNavigate={onNavigateMobile} noAccess={noAccess}/>
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
        <SidebarNav collapsed={collapsed} currentPath={location.pathname} can={can} isSuperAdmin={isSuperAdmin} isPageViewVisible={isPageViewVisible} noAccess={noAccess}/>
      </aside>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} items={flatItems}/>
    </>
  );
}

// --------------------------------------------------------------------------
// Header (brand + collapse toggle + search button)
// --------------------------------------------------------------------------
function SidebarHeader({ collapsed, user, onToggle, mobile, onSearch }) {
  const toggleLabel = mobile ? "Close" : (collapsed ? "Expand sidebar" : "Collapse sidebar");
  const ToggleIcon = mobile ? X : (collapsed ? PanelLeftOpen : PanelLeftClose);
  return (
    <div className={`border-b border-gray-100 ${collapsed ? "px-2 py-3" : "px-3 py-3"}`}>
      <div className="relative flex items-center justify-center">
        {!collapsed && (
          <img
            src="https://customer-assets.emergentagent.com/job_support-core-4/artifacts/w6k7hdz0_Infollion%20Logo.svg"
            alt="Infollion"
            className="h-10 w-auto"
          />
        )}
        <div className={collapsed ? "" : "absolute right-0 top-1/2 -translate-y-1/2"}>
          <Tip label={toggleLabel} show={true}>
            <button
              onClick={onToggle}
              data-testid="sidebar-toggle"
              title={toggleLabel}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-500 inline-flex items-center justify-center"
              aria-label={toggleLabel}
            >
              <ToggleIcon sx={{ fontSize: 18 }}/>
            </button>
          </Tip>
        </div>
      </div>
      <Tip label="Search menu (⌘K)" show={collapsed}>
        <button
          onClick={onSearch}
          data-testid="sidebar-search-btn"
          className={`mt-2 flex items-center gap-2 text-xs text-gray-500 hover:bg-gray-50 border border-gray-200 rounded-md transition-colors ${collapsed ? "justify-center w-10 h-8 mx-auto" : "w-full px-2 py-1.5"}`}
        >
          <Search sx={{ fontSize: 13 }}/>
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
function SidebarNav({ collapsed, currentPath, can, isSuperAdmin, isPageViewVisible, onNavigate, noAccess = false }) {
  // CSS quirk: setting overflow-y on one axis coerces the other to non-visible too.
  // For the collapsed icon-only view we keep `overflow-visible` so hover tooltips
  // (which extend to the right of the sidebar) are not clipped.

  // STRICT gating: when the current user has no assigned Permission Sets
  // (and is not Super Admin) render a friendly empty state instead of the
  // nav list. Nothing is clickable so they can't stumble into gated pages.
  if (noAccess) {
    if (collapsed) {
      return (
        <nav className="flex-1 py-3 px-1.5 overflow-visible" data-testid="sidebar-no-access-collapsed">
          <Tip label="No Module Assigned. Contact Super Admin." show>
            <div className="w-10 h-10 mx-auto rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
              <Shield sx={{ fontSize: 18 }}/>
            </div>
          </Tip>
        </nav>
      );
    }
    return (
      <nav
        className="flex-1 py-6 px-4 overflow-y-auto"
        data-testid="sidebar-no-access"
      >
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4 text-center">
          <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-2.5">
            <Shield sx={{ fontSize: 20 }}/>
          </div>
          <div className="text-sm font-semibold text-amber-900 mb-1">
            No Module Assigned
          </div>
          <div className="text-[12px] text-amber-800/80 leading-relaxed">
            Please contact your Super&nbsp;Admin to request access.
          </div>
        </div>
      </nav>
    );
  }

  return (
    <nav className={`flex-1 py-3 space-y-1 ${collapsed ? "px-1.5 overflow-visible" : "px-3 overflow-y-auto overflow-x-hidden"}`}>
      {NAV_CONFIG.map(item => {
        if (item.kind === "link") {
          if (item.perm && !isSuperAdmin && !can(item.perm.module, item.perm.feature, item.perm.action)) return null;
          if (item.v3 && !isPageViewVisible(item.v3.module, item.v3.page)) return null;
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
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? "bg-[#ec9324]/10 text-[#ec9324] font-semibold border-r-4 border-[#ec9324]" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium"}`
              }
            ><Icon sx={{ fontSize: 18 }} className="flex-shrink-0"/><span className="truncate whitespace-nowrap">{label}</span></NavLink>
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
            isPageViewVisible={isPageViewVisible}
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
            <LogOut sx={{ fontSize: 16 }}/>
          </button>
        </Tip>
      </div>
    );
  }
  return (
    <div className="px-3 py-3 border-t border-gray-100">
      <div className="px-2 py-1.5 mb-1.5">
        <div className="text-sm font-semibold text-gray-900 truncate" data-testid="sidebar-user-name">{user?.name}</div>
        <div className="text-xs text-gray-500 truncate flex items-center gap-1"><Mail sx={{ fontSize: 12 }}/>{user?.email}</div>
      </div>
      <button onClick={onLogout} data-testid="logout-btn" className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium transition-colors">
        <LogOut sx={{ fontSize: 16 }}/> Logout
      </button>
    </div>
  );
}
