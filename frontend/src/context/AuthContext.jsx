import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import api from "../lib/api";

const AuthContext = createContext(null);

// Decode a JWT payload without verification. Returns null on failure.
function decodeJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const json = atob(b64 + pad);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Get the current token (impersonation-aware).
function getStoredToken() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem("access_token") || window.localStorage.getItem("access_token");
}

/**
 * Auth session — supports two modes in the same app:
 *   • Normal: token persisted in `localStorage.access_token` + httpOnly cookie.
 *   • Impersonation: token persisted in the TAB'S `sessionStorage.access_token`.
 *     Since the api.js interceptor prefers sessionStorage over localStorage and
 *     the backend prefers `Authorization` header over cookie, the impersonated
 *     tab is fully isolated from the original tab.
 *
 * Session expiry (24h):
 *   The backend mints access tokens with `exp = now + 24h`. This provider
 *   decodes the JWT and schedules an automatic logout at that timestamp so
 *   the user is bounced to the login screen exactly when the token dies.
 *   We also react to `401 Token expired` responses defensively.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null=checking, false=anonymous, object=authed
  const [loading, setLoading] = useState(true);
  const expiryTimer = useRef(null);

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
      scheduleAutoLogout();
    } catch (e) {
      setUser(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMe(); }, []);

  // ─── Session-expiry auto-logout ─────────────────────────────────────────
  const clearExpiryTimer = () => {
    if (expiryTimer.current) {
      clearTimeout(expiryTimer.current);
      expiryTimer.current = null;
    }
  };

  const handleSessionExpired = () => {
    // Wipe local session state without hitting /auth/logout (token is dead).
    clearExpiryTimer();
    try {
      localStorage.removeItem("access_token");
      sessionStorage.removeItem("access_token");
    } catch (_) { /* ignore */ }
    setUser(false);
    // Redirect to login with a hint so we can surface a toast/banner.
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login?session_expired=1";
    }
  };

  const scheduleAutoLogout = () => {
    clearExpiryTimer();
    const token = getStoredToken();
    if (!token) return;
    const payload = decodeJwt(token);
    if (!payload || !payload.exp) return;
    const msLeft = payload.exp * 1000 - Date.now();
    if (msLeft <= 0) {
      handleSessionExpired();
      return;
    }
    // setTimeout with very large delays (>24 days) is unreliable; cap at 24h.
    const delay = Math.min(msLeft + 500, 24 * 60 * 60 * 1000 + 500);
    expiryTimer.current = setTimeout(handleSessionExpired, delay);
  };

  useEffect(() => () => clearExpiryTimer(), []);

  // Global 401 interceptor — if any API call fails with 401 "Token expired"
  // we treat it as a session expiry.
  useEffect(() => {
    const id = api.interceptors.response.use(
      (r) => r,
      (error) => {
        const status = error?.response?.status;
        const detail = error?.response?.data?.detail;
        if (status === 401 && (detail === "Token expired" || detail === "Not authenticated")) {
          // Only auto-logout an existing session; anonymous 401s (e.g. the
          // login-page /auth/me probe) should stay silent.
          if (getStoredToken()) {
            handleSessionExpired();
          }
        }
        return Promise.reject(error);
      },
    );
    return () => api.interceptors.response.eject(id);
  }, []);
  // ────────────────────────────────────────────────────────────────────────

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.access_token) localStorage.setItem("access_token", data.access_token);
    setUser(data.user);
    scheduleAutoLogout();
    return data.user;
  };

  const logout = async () => {
    // Impersonated tabs: don't hit /auth/logout — that would clear the shared
    // httpOnly cookie and kick the original user out of their tab too. Just
    // wipe this tab's sessionStorage and land back on /login.
    clearExpiryTimer();
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
