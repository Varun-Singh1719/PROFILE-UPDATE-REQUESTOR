/**
 * LoginAsDialog — Super-Admin-only "Login As" modal.
 *
 * Opens from the Permissions page top bar. Lists every active user (except the
 * actor), shown as "Name (left-aligned)  email (right-aligned)". Selecting one
 * and clicking Submit mints an impersonation token via
 * `POST /auth/impersonate` and opens the app in a new browser tab, passing the
 * token in the URL hash.
 *
 * See `ImpersonateCallback.jsx` for how the new tab consumes the token.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Search, LogIn, Loader2, X, ExternalLink } from "lucide-react";
import api from "../../lib/api";
import notify from "../../lib/notify";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";

export default function LoginAsDialog({ open, onOpenChange }) {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Fetch candidates each time the dialog opens (cheap; keeps list fresh)
  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setSearch("");
    setLoading(true);
    (async () => {
      try {
        const { data } = await api.get("/auth/impersonation-candidates");
        setCandidates(data.users || []);
      } catch (e) {
        notify.error(e, { what: "Load users for Login As" });
        onOpenChange(false);
      } finally { setLoading(false); }
    })();
  }, [open, onOpenChange]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((u) =>
      (u.name || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.role || "").toLowerCase().includes(q),
    );
  }, [candidates, search]);

  const selected = candidates.find((u) => u.id === selectedId);

  const doSubmit = async () => {
    if (!selectedId || submitting) return;
    setSubmitting(true);
    try {
      const { data } = await api.post("/auth/impersonate", { user_id: selectedId });
      const token = data?.access_token;
      if (!token) throw new Error("Impersonation token missing from response");
      // Open a new tab that will pick up the token from the URL hash and
      // stash it into that tab's sessionStorage (see ImpersonateCallback.jsx).
      const url = `${window.location.origin}/impersonate/callback#token=${encodeURIComponent(token)}`;
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (!win) {
        notify.error(
          "Your browser blocked the new tab. Please allow pop-ups for this site and try again.",
          { what: "Open impersonation tab" },
        );
        return;
      }
      notify.success(`Opened new tab as ${selected?.name || selected?.email}`);
      onOpenChange(false);
    } catch (e) {
      notify.error(e, { what: "Login as user" });
    } finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-gray-100">
          <DialogTitle className="text-[15px] font-semibold text-gray-900 flex items-center gap-2">
            <LogIn size={16} className="text-[#ec9324]"/> Login As
          </DialogTitle>
          <p className="text-xs text-gray-500 mt-1">
            Open a new tab logged in as another user. Your current session stays intact.
          </p>
        </DialogHeader>

        <div className="px-6 py-4 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or role"
              data-testid="login-as-search"
              className="w-full h-9 pl-8 pr-8 rounded-md border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#ec9324]/30 focus:border-[#ec9324]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"
                aria-label="Clear search"
              ><X size={12}/></button>
            )}
          </div>

          {/* Candidate list */}
          <div
            className="border border-gray-200 rounded-md max-h-72 overflow-auto divide-y divide-gray-100"
            data-testid="login-as-list"
          >
            {loading ? (
              <div className="py-12 text-center text-sm text-gray-500">
                <Loader2 size={20} className="mx-auto animate-spin text-[#ec9324] mb-2"/>
                Loading users…
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-500">
                {candidates.length === 0 ? "No eligible users found." : `No users match "${search}".`}
              </div>
            ) : filtered.map((u) => {
              const active = u.id === selectedId;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setSelectedId(u.id)}
                  onDoubleClick={() => { setSelectedId(u.id); setTimeout(doSubmit, 50); }}
                  data-testid={`login-as-option-${u.id}`}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                    active ? "bg-[#ec9324]/10" : "hover:bg-gray-50"
                  }`}
                >
                  {/* Radio */}
                  <span
                    className={`shrink-0 w-4 h-4 rounded-full border flex items-center justify-center ${
                      active ? "border-[#ec9324] bg-white" : "border-gray-300 bg-white"
                    }`}
                    aria-hidden="true"
                  >
                    {active && <span className="w-2 h-2 rounded-full bg-[#ec9324]"/>}
                  </span>

                  {/* Name — left-aligned */}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 truncate">{u.name || "—"}</div>
                    {u.role && <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{u.role}</div>}
                  </div>

                  {/* Email — right-aligned */}
                  <div className="text-xs text-gray-600 truncate max-w-[55%] text-right">{u.email}</div>
                </button>
              );
            })}
          </div>

          <div className="text-[11px] text-gray-500 leading-relaxed">
            You'll open in a new tab. The impersonation session lives only in that tab —
            closing it (or clicking Logout there) ends the impersonation.
          </div>
        </div>

        <DialogFooter className="px-6 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-9 px-4 text-sm"
            data-testid="login-as-cancel"
          >Cancel</Button>
          <Button
            onClick={doSubmit}
            disabled={!selectedId || submitting}
            className="h-9 px-4 text-sm font-semibold bg-[#ec9324] hover:bg-[#d4811f] text-white"
            data-testid="login-as-submit"
          >
            {submitting
              ? <><Loader2 size={13} className="mr-1.5 animate-spin"/> Opening…</>
              : <><ExternalLink size={13} className="mr-1.5"/> Submit</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
