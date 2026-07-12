/**
 * ImpersonationBanner — a thin strip that appears at the top of every page
 * whenever the current tab is running an impersonated session (i.e. its
 * auth token is stored in `sessionStorage.access_token`).
 *
 * Shows the impersonated user's name/email and an "Exit impersonation" button
 * which logs out only this tab (does NOT touch the shared cookie or the
 * original tab's localStorage session).
 */
import React from "react";
import { ShieldAlert, LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function ImpersonationBanner() {
  const { user, isImpersonating, logout } = useAuth();
  if (!isImpersonating || !user) return null;

  const label = user.name || user.email || "another user";

  return (
    <div
      className="w-full bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-1.5 text-xs flex items-center gap-2"
      data-testid="impersonation-banner"
      role="status"
    >
      <ShieldAlert size={13} className="text-amber-700 shrink-0"/>
      <div className="flex-1 min-w-0 truncate">
        You are impersonating <span className="font-semibold">{label}</span>
        {user.email && user.email !== label && <> · <span className="text-amber-800">{user.email}</span></>}
        {user.role && <> · <span className="uppercase tracking-wider font-semibold text-[10px]">{user.role}</span></>}
      </div>
      <button
        type="button"
        onClick={async () => {
          await logout();
          window.location.replace("/login");
        }}
        className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-semibold text-amber-900 bg-white border border-amber-300 hover:bg-amber-100"
        data-testid="impersonation-exit-btn"
      >
        <LogOut size={11}/> Exit impersonation
      </button>
    </div>
  );
}
