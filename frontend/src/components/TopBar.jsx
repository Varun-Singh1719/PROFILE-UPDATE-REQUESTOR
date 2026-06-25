/**
 * TopBar — sticky top header with user dropdown in the top-right.
 *
 * Renders:
 *   • optional page title slot (left)
 *   • user section (right): avatar + name + chevron → dropdown
 *
 * Dropdown items (per spec): Profile, Change Password, Logout.
 * Logout opens a confirmation dialog; on confirm, calls AuthContext.logout()
 * and redirects to /login.
 */
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel,
} from "./ui/dropdown-menu";
import UserAvatar from "./UserAvatar";
import ChangePasswordModal from "./ChangePasswordModal";
import LogoutConfirmModal from "./LogoutConfirmModal";
import { ChevronDown, User as UserIcon, KeyRound, LogOut } from "lucide-react";

export default function TopBar({ title, actions }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [cpOpen, setCpOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  const onConfirmLogout = async () => {
    setLogoutOpen(false);
    await logout();
    navigate("/login");
  };

  if (!user) return null;

  return (
    <>
      <header
        className="sticky top-0 z-20 h-14 bg-white/95 backdrop-blur border-b border-gray-200 flex items-center px-4 gap-3"
        data-testid="app-topbar"
      >
        {/* Page title slot — set via <Layout title="..."/> */}
        <div className="flex-1 min-w-0 flex items-center gap-3 overflow-hidden">
          {title && (
            <h1
              className="text-xl font-bold text-gray-900 tracking-tight truncate leading-none"
              data-testid="topbar-page-title"
              title={title}
            >
              {title}
            </h1>
          )}
        </div>

        {/* Page action buttons — set via <Layout actions={...}/> */}
        {actions && (
          <div
            className="flex items-center gap-1.5 pr-2 mr-1 border-r border-gray-200"
            data-testid="topbar-actions"
          >
            {actions}
          </div>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              data-testid="topbar-user-trigger"
              className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-gray-100 transition-colors"
            >
              <UserAvatar user={user} size={32} online showStatusDot/>
              <span className="text-sm font-medium text-gray-800 max-w-[160px] truncate" data-testid="topbar-user-name">
                {user.name}
              </span>
              <ChevronDown size={14} className="text-gray-500"/>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]" data-testid="topbar-user-menu">
            <DropdownMenuLabel className="font-normal">
              <div className="flex items-center gap-2.5">
                <UserAvatar user={user} size={36} online showStatusDot/>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">{user.name}</div>
                  <div className="text-[11px] text-gray-500 truncate">{user.email}</div>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator/>
            <DropdownMenuItem
              onSelect={() => navigate("/profile")}
              data-testid="topbar-menu-profile"
              className="gap-2 cursor-pointer"
            >
              <UserIcon size={14} className="text-gray-500"/> Profile
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setCpOpen(true)}
              data-testid="topbar-menu-change-password"
              className="gap-2 cursor-pointer"
            >
              <KeyRound size={14} className="text-gray-500"/> Change Password
            </DropdownMenuItem>
            <DropdownMenuSeparator/>
            <DropdownMenuItem
              onSelect={() => setLogoutOpen(true)}
              data-testid="topbar-menu-logout"
              className="gap-2 cursor-pointer text-red-600 focus:text-red-700 focus:bg-red-50"
            >
              <LogOut size={14}/> Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <ChangePasswordModal open={cpOpen} onClose={() => setCpOpen(false)} />
      <LogoutConfirmModal
        open={logoutOpen}
        onCancel={() => setLogoutOpen(false)}
        onConfirm={onConfirmLogout}
      />
    </>
  );
}
