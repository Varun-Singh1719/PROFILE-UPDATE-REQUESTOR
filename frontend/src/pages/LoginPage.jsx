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

  const handleGoogleSignIn = () => {
    const redirectUrl = `${window.location.origin}/auth/callback`;
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="min-h-screen flex bg-white">
      <div className="hidden lg:flex w-1/2 relative flex-col items-center" style={{
        backgroundImage: "url(https://customer-assets.emergentagent.com/job_support-core-4/artifacts/5ftyl5zc_Screenshot%202026-05-12%20at%205.39.38%E2%80%AFPM.png)",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundColor: "#1a2332"
      }}>
        <div className="relative z-10 w-full flex flex-col items-center pt-16 px-8">
          <div className="bg-white rounded-2xl p-6 shadow-xl">
            <img
              src="https://customer-assets.emergentagent.com/job_support-core-4/artifacts/w6k7hdz0_Infollion%20Logo.svg"
              alt="Infollion" className="h-20 xl:h-24 w-auto"
            />
          </div>
          <h1 className="mt-10 text-4xl xl:text-5xl font-bold leading-tight text-white text-center max-w-md drop-shadow-md">
            Infollion Expert Profile Update
          </h1>
        </div>
      </div>
      <div className="w-full lg:w-1/2 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <img
              src="https://customer-assets.emergentagent.com/job_support-core-4/artifacts/w6k7hdz0_Infollion%20Logo.svg"
              alt="Infollion" className="h-9 w-auto"
            />
            <div className="font-bold text-gray-900 text-lg">Infollion</div>
          </div>
          <div className="text-xs uppercase tracking-widest text-[#ec9324] font-semibold mb-2">Infollion Expert Profile Update</div>
          <h2 className="text-3xl font-bold text-gray-900 tracking-tight" data-testid="login-title">Sign in</h2>
          <p className="mt-2 text-gray-500">Use your registered email to access your dashboard.</p>

          <Button
            type="button"
            onClick={handleGoogleSignIn}
            data-testid="google-signin-btn"
            variant="outline"
            className="w-full h-11 mt-6 border-gray-300 hover:bg-gray-50 text-gray-700 font-medium"
          >
            <svg className="mr-2" width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </Button>

          <div className="flex items-center my-6">
            <div className="flex-1 h-px bg-gray-200"></div>
            <div className="px-3 text-xs uppercase tracking-wider text-gray-400">or sign in with email</div>
            <div className="flex-1 h-px bg-gray-200"></div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
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
