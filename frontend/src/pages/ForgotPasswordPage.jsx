import React, { useState } from "react";
import { Link } from "react-router-dom";
import api, { formatApiError } from "../lib/api";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import Loader2 from "@mui/icons-material/Autorenew";
import ArrowLeft from "@mui/icons-material/ArrowBack";
import MailCheck from "@mui/icons-material/MarkEmailReadOutlined";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (e) {
      setError(formatApiError(e?.response?.data?.detail) || e.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6 py-12">
      <div className="w-full max-w-md bg-white border border-gray-100 shadow-soft rounded-2xl p-8">
        <Link to="/login" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#ec9324]" data-testid="back-to-login">
          <ArrowLeft sx={{ fontSize: 14 }}/> Back to sign in
        </Link>
        {!sent ? (
          <>
            <h1 className="mt-4 text-2xl font-bold text-gray-900 tracking-tight" data-testid="forgot-title">Forgot your password?</h1>
            <p className="text-gray-500 mt-1 text-sm">Enter your registered email and we’ll send you a reset link valid for 60 minutes.</p>
            <form onSubmit={submit} className="space-y-4 mt-6">
              <Input
                type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                data-testid="forgot-email-input"
                className="h-11"
              />
              {error && <div className="text-sm text-red-600" data-testid="forgot-error">{error}</div>}
              <Button type="submit" disabled={loading} data-testid="forgot-submit-btn"
                className="w-full h-11 bg-[#ec9324] hover:bg-[#d4811f] text-white">
                {loading ? <><Loader2 className="animate-spin mr-2" sx={{ fontSize: 16 }}/> Sending…</> : "Send reset link"}
              </Button>
            </form>
          </>
        ) : (
          <div className="mt-6 text-center" data-testid="forgot-success">
            <div className="mx-auto w-12 h-12 rounded-full bg-green-50 text-green-600 flex items-center justify-center">
              <MailCheck sx={{ fontSize: 22 }}/>
            </div>
            <h2 className="mt-4 text-xl font-bold text-gray-900">Check your email</h2>
            <p className="text-gray-500 mt-2 text-sm">
              If an account exists for <span className="font-medium text-gray-700">{email}</span>, a reset link has been sent.
              You can close this tab.
            </p>
            <Link to="/login" className="block mt-6 text-sm text-[#ec9324] hover:underline">Return to sign in</Link>
          </div>
        )}
      </div>
    </div>
  );
}
