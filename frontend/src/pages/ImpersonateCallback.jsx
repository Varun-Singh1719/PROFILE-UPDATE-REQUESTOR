/**
 * ImpersonateCallback — lands in a new browser tab opened by "Login As".
 *
 * The opener passes the impersonation JWT in the URL hash (never a query
 * string, so it doesn't hit server logs). We stash it in this tab's
 * `sessionStorage.access_token` and reload into `/` — the AuthContext's
 * `fetchMe()` then hits `/auth/me` with the impersonation token and boots the
 * app as the target user.
 *
 * `sessionStorage` is per-tab, so:
 *   • The original tab keeps using its `localStorage` token.
 *   • The impersonated tab uses its own session token.
 *   • Closing the impersonated tab ends the impersonation session.
 */
import React, { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";

export default function ImpersonateCallback() {
  const [err, setErr] = useState(null);

  useEffect(() => {
    try {
      // Prefer hash for the token (kept out of server logs). Fall back to
      // querystring so bookmarking works, then remove it from the URL.
      const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
      const query = new URLSearchParams(window.location.search || "");
      const token = hash.get("token") || query.get("token");
      if (!token) {
        setErr("No impersonation token found in the URL.");
        return;
      }
      window.sessionStorage.setItem("access_token", token);
      // Wipe the token from the address bar for hygiene, then hard-navigate
      // so the AuthProvider mounts fresh with `sessionStorage` in place.
      window.history.replaceState({}, "", "/");
      window.location.replace("/");
    } catch (e) {
      setErr(String(e?.message || e));
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm px-6 py-8 max-w-sm w-full text-center">
        {err ? (
          <>
            <ShieldAlert size={32} className="mx-auto text-red-500"/>
            <h2 className="mt-3 text-base font-semibold text-gray-900">Impersonation failed</h2>
            <p className="mt-2 text-sm text-gray-600">{err}</p>
            <a href="/" className="mt-4 inline-block text-sm font-medium text-[#ec9324] hover:underline">Go to home</a>
          </>
        ) : (
          <>
            <Loader2 size={28} className="mx-auto animate-spin text-[#ec9324]"/>
            <h2 className="mt-3 text-base font-semibold text-gray-900">Starting impersonated session…</h2>
            <p className="mt-1 text-sm text-gray-600">Hold on while we log you in as the selected user.</p>
          </>
        )}
      </div>
    </div>
  );
}
