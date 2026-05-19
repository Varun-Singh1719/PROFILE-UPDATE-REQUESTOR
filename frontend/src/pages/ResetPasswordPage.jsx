import React, { useState, useMemo } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import api, { formatApiError } from "../lib/api";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => params.get("token") || "", [params]);
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (pwd.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (pwd !== pwd2) { setError("Passwords do not match"); return; }
    if (!token) { setError("Missing reset token in URL"); return; }
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: pwd });
      setDone(true);
      toast.success("Password updated");
      setTimeout(() => navigate("/login", { replace: true }), 1800);
    } catch (e) {
      setError(formatApiError(e?.response?.data?.detail) || e.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6 py-12">
      <div className="w-full max-w-md bg-white border border-gray-100 shadow-soft rounded-2xl p-8">
        {!done ? (
          <>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight" data-testid="reset-title">Set a new password</h1>
            <p className="text-gray-500 mt-1 text-sm">Choose a strong password (minimum 8 characters).</p>
            {!token && (
              <div className="mt-4 p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-700 text-xs flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5"/> No reset token detected in URL. Please use the link from your email.
              </div>
            )}
            <form onSubmit={submit} className="space-y-4 mt-6">
              <Input type="password" required value={pwd} onChange={(e) => setPwd(e.target.value)}
                placeholder="New password" data-testid="reset-pwd-input" className="h-11"/>
              <Input type="password" required value={pwd2} onChange={(e) => setPwd2(e.target.value)}
                placeholder="Confirm new password" data-testid="reset-pwd2-input" className="h-11"/>
              {error && <div className="text-sm text-red-600" data-testid="reset-error">{error}</div>}
              <Button type="submit" disabled={loading || !token} data-testid="reset-submit-btn"
                className="w-full h-11 bg-[#ec9324] hover:bg-[#d4811f] text-white">
                {loading ? <><Loader2 className="animate-spin mr-2" size={16}/> Updating…</> : "Update password"}
              </Button>
              <Link to="/login" className="block text-center text-sm text-gray-500 hover:text-[#ec9324]">Back to sign in</Link>
            </form>
          </>
        ) : (
          <div className="text-center" data-testid="reset-success">
            <div className="mx-auto w-12 h-12 rounded-full bg-green-50 text-green-600 flex items-center justify-center">
              <CheckCircle2 size={22}/>
            </div>
            <h2 className="mt-4 text-xl font-bold text-gray-900">Password updated</h2>
            <p className="text-gray-500 mt-2 text-sm">Redirecting you to sign in…</p>
          </div>
        )}
      </div>
    </div>
  );
}
