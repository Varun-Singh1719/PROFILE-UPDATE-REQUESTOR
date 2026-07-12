import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import api from "../lib/api";

const AuthContext = createContext(null);

/**
 * Auth session — supports two modes in the same app:
 *   • Normal: token persisted in `localStorage.access_token` + httpOnly cookie.
 *   • Impersonation: token persisted in the TAB'S `sessionStorage.access_token`.
 *     Since the api.js interceptor prefers sessionStorage over localStorage and
 *     the backend prefers `Authorization` header over cookie, the impersonated
 *     tab is fully isolated from the original tab.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null=checking, false=anonymous, object=authed
  const [loading, setLoading] = useState(true);

  const isImpersonating =
    typeof window !== "undefined" && !!window.sessionStorage.getItem("access_token");

  const fetchMe = async () => {
    // If returning from OAuth callback, skip /me check; AuthCallback will set the session.
    if (typeof window !== "undefined" && window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch (e) {
      setUser(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMe(); }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.access_token) localStorage.setItem("access_token", data.access_token);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    // Impersonated tabs: don't hit /auth/logout — that would clear the shared
    // httpOnly cookie and kick the original user out of their tab too. Just
    // wipe this tab's sessionStorage and land back on /login.
    if (isImpersonating) {
      sessionStorage.removeItem("access_token");
      setUser(false);
      return;
    }
    try { await api.post("/auth/logout", null, { loadingLabel: "Logging out…" }); }
    catch (e) { console.warn("logout API call failed (continuing local logout):", e); }
    localStorage.removeItem("access_token");
    setUser(false);
  };

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh: fetchMe, isImpersonating }),
    [user, loading, isImpersonating],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
