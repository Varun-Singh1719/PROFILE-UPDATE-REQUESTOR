import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { formatApiError } from "../lib/api";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const u = await login(email, password);
      toast.success(`Welcome, ${u.name}`);
      const dest = u.type === "Admin" ? "/admin" : u.type === "Research Associate" ? "/ra" : "/dq";
      navigate(dest);
    } catch (e) {
      const msg = formatApiError(e?.response?.data?.detail) || e.message;
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-white">
      <div className="hidden lg:flex w-1/2 relative" style={{
        backgroundImage: "url(https://images.pexels.com/photos/30179908/pexels-photo-30179908.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=1080&w=1920)",
        backgroundSize: "cover", backgroundPosition: "center"
      }}>
        <div className="absolute inset-0 bg-gradient-to-br from-[#ec9324]/30 to-black/30" />
        <div className="relative z-10 m-auto text-white p-12 max-w-md">
          <div className="w-12 h-12 rounded-xl bg-white text-[#ec9324] flex items-center justify-center font-bold text-2xl mb-6">T</div>
          <h1 className="text-4xl font-bold leading-tight">Streamline your ticket workflow.</h1>
          <p className="mt-4 text-lg opacity-90">Manage profiles, assignments and team performance — all in one place.</p>
        </div>
      </div>
      <div className="w-full lg:w-1/2 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-9 h-9 rounded-lg bg-[#ec9324] flex items-center justify-center text-white font-bold">T</div>
            <div className="font-bold text-gray-900 text-lg">TicketDesk</div>
          </div>
          <h2 className="text-3xl font-bold text-gray-900 tracking-tight" data-testid="login-title">Sign in</h2>
          <p className="mt-2 text-gray-500">Use your registered email to access your dashboard.</p>
          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" data-testid="login-email-input" className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" data-testid="login-password-input" className="mt-1.5" />
            </div>
            {error && <div className="text-sm text-red-600" data-testid="login-error">{error}</div>}
            <Button type="submit" disabled={loading} data-testid="login-submit-btn"
              className="w-full bg-[#ec9324] hover:bg-[#d4811f] text-white">
              {loading ? <><Loader2 className="animate-spin mr-2" size={16}/> Signing in...</> : "Sign in"}
            </Button>
          </form>
          <div className="mt-8 p-4 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-600">
            <div className="font-semibold text-gray-700 mb-1">Demo accounts</div>
            <div>Admin: admin@ticketing.com / Admin@123</div>
            <div>RA: ra@ticketing.com / Test@123</div>
            <div>DQ: dq1@ticketing.com / Test@123</div>
          </div>
        </div>
      </div>
    </div>
  );
}
