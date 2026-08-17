import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import Eye from "@mui/icons-material/Visibility";
import EyeOff from "@mui/icons-material/VisibilityOff";
import KeyRound from "@mui/icons-material/KeyOutlined";
import Loader2 from "@mui/icons-material/Autorenew";
import CheckCircle2 from "@mui/icons-material/CheckCircleOutlined";
import api from "../lib/api";
import notify from "../lib/notify";
import { PASSWORD_POLICY, scorePassword } from "../lib/password";

export default function ChangePasswordModal({ open, onClose, onSuccess }) {
  const [oldP, setOldP] = useState("");
  const [newP, setNewP] = useState("");
  const [confirmP, setConfirmP] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const reset = () => {
    setOldP(""); setNewP(""); setConfirmP("");
    setShowOld(false); setShowNew(false); setShowConfirm(false);
    setSubmitting(false); setErr("");
  };

  const close = () => { if (!submitting) { reset(); onClose(); } };

  const strength = scorePassword(newP);
  const matches = newP && confirmP && newP === confirmP;
  const allRulesMet = PASSWORD_POLICY.every((r) => r.test(newP));
  const sameAsOld = newP && oldP && newP === oldP;
  const canSubmit = oldP && newP && confirmP && matches && allRulesMet && !sameAsOld && !submitting;

  const submit = async () => {
    setErr("");
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const r = await api.post(
        "/auth/change-password",
        { old_password: oldP, new_password: newP },
        { loadingLabel: "Updating password…" },
      );
      notify.success("Password updated successfully");
      onSuccess?.(r.data);
      reset();
      onClose();
    } catch (e) {
      const detail = e?.response?.data?.detail || "Could not change password";
      setErr(typeof detail === "string" ? detail : JSON.stringify(detail));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound sx={{ fontSize: 18 }} className="text-[#ec9324]"/> Change Password
          </DialogTitle>
          <DialogDescription className="sr-only">
            Change your account password.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Old password */}
          <div className="space-y-1">
            <Label htmlFor="cp-old">Old Password</Label>
            <div className="relative">
              <Input
                id="cp-old" type={showOld ? "text" : "password"}
                value={oldP} onChange={(e) => setOldP(e.target.value)}
                disabled={submitting} autoFocus
                data-testid="change-password-old"
              />
              <button type="button" onClick={() => setShowOld(v => !v)} tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                {showOld ? <EyeOff sx={{ fontSize: 15 }}/> : <Eye sx={{ fontSize: 15 }}/>}
              </button>
            </div>
          </div>

          {/* New password + strength */}
          <div className="space-y-1">
            <Label htmlFor="cp-new">New Password</Label>
            <div className="relative">
              <Input
                id="cp-new" type={showNew ? "text" : "password"}
                value={newP} onChange={(e) => setNewP(e.target.value)}
                disabled={submitting}
                data-testid="change-password-new"
              />
              <button type="button" onClick={() => setShowNew(v => !v)} tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                {showNew ? <EyeOff sx={{ fontSize: 15 }}/> : <Eye sx={{ fontSize: 15 }}/>}
              </button>
            </div>
            {newP && (
              <div className="space-y-1" data-testid="password-strength">
                <div className="flex items-center gap-2">
                  <div className="flex-1 grid grid-cols-4 gap-1">
                    {[1,2,3,4].map((i) => (
                      <div key={i} className={`h-1.5 rounded-full ${i <= strength.score ? strength.color : "bg-gray-200"}`}/>
                    ))}
                  </div>
                  <span className="text-xs font-medium text-gray-700 w-12 text-right">{strength.label}</span>
                </div>
                <ul className="text-[11px] space-y-0.5 mt-1.5">
                  {PASSWORD_POLICY.map((r) => {
                    const ok = r.test(newP);
                    return (
                      <li key={r.id} className={`flex items-center gap-1.5 ${ok ? "text-emerald-700" : "text-gray-500"}`}>
                        <CheckCircle2 sx={{ fontSize: 11 }} className={ok ? "" : "opacity-30"}/> {r.label}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {sameAsOld && (
              <p className="text-xs text-red-600">New password must be different from the current password</p>
            )}
          </div>

          {/* Confirm new */}
          <div className="space-y-1">
            <Label htmlFor="cp-confirm">Reconfirm New Password</Label>
            <div className="relative">
              <Input
                id="cp-confirm" type={showConfirm ? "text" : "password"}
                value={confirmP} onChange={(e) => setConfirmP(e.target.value)}
                disabled={submitting}
                data-testid="change-password-confirm"
              />
              <button type="button" onClick={() => setShowConfirm(v => !v)} tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                {showConfirm ? <EyeOff sx={{ fontSize: 15 }}/> : <Eye sx={{ fontSize: 15 }}/>}
              </button>
            </div>
            {confirmP && !matches && (
              <p className="text-xs text-red-600">Passwords do not match</p>
            )}
          </div>

          {err && (
            <div className="bg-red-50 border border-red-200 rounded-md px-3 py-2 text-xs text-red-700" data-testid="change-password-error">
              {err}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={submitting}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white"
            data-testid="change-password-submit"
          >
            {submitting ? (<><Loader2 sx={{ fontSize: 14 }} className="mr-2 animate-spin"/>Updating…</>) : "Update Password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
