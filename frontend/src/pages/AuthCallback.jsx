import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export default function AuthCallback() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const hasProcessed = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const hash = window.location.hash || "";
    const m = hash.match(/session_id=([^&]+)/);
    if (!m) {
      setError("No session token found in URL.");
      setTimeout(() => navigate("/login", { replace: true }), 1200);
      return;
    }
    const sessionId = decodeURIComponent(m[1]);

    (async () => {
      try {
        const { data } = await api.post("/auth/google-session", { session_id: sessionId });
        if (data?.access_token) localStorage.setItem("access_token", data.access_token);
        await refresh();
        toast.success(`Welcome, ${data.user.name}`);
        // Clear the hash and route to unified admin shell (v3 role model)
        window.history.replaceState(null, "", window.location.pathname);
        navigate("/admin", { replace: true });
      } catch (e) {
        const msg = formatApiError(e?.response?.data?.detail) || "Google sign-in failed.";
        setError(msg);
        toast.error(msg);
        setTimeout(() => navigate("/login", { replace: true }), 1500);
      }
    })();
  }, [navigate, refresh]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <Loader2 className="animate-spin text-[#ec9324] mx-auto" size={32} />
        <div className="mt-3 text-sm text-gray-600" data-testid="auth-callback-status">
          {error || "Completing sign-in..."}
        </div>
      </div>
    </div>
  );
}
