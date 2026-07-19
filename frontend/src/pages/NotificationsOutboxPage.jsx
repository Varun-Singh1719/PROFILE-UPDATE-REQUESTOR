import React, { useEffect, useState } from "react";
import api from "../lib/api";
import Layout from "../components/Layout";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import DeferredSearchInput from "../components/DeferredSearchInput";
import Pagination from "../components/Pagination";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from "../components/ui/dialog";
import RefreshCw from "@mui/icons-material/Refresh";
import Trash2 from "@mui/icons-material/DeleteOutlined";
import Eye from "@mui/icons-material/Visibility";
import MoreVertical from "@mui/icons-material/MoreVert";
import RestartAlt from "@mui/icons-material/RestartAlt";
import Mail from "@mui/icons-material/MailOutlined";
import DOMPurify from "dompurify";
import notify from "../lib/notify";
import { confirm as confirmDialog } from '../lib/dialog';
import { useEffectivePage } from "../context/EffectivePermissionsContext";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "../components/ui/dropdown-menu";

const KIND_LABEL = {
  new_employee: "New employee credentials",
  admin_password_reset: "Admin password reset",
  forgot_password: "Forgot password",
};

// Kind capsule — same visual language as Email Templates "Type" column:
// outlined pill (border-2 rounded-full) with colored border+text on white bg.
const KIND_COLORS = {
  new_employee:         { text: "#7c3aed", border: "#7c3aed" }, // purple  — onboarding
  admin_password_reset: { text: "#dc2626", border: "#dc2626" }, // red     — security
  forgot_password:      { text: "#2563eb", border: "#2563eb" }, // blue    — auth
};

// Status capsule — same visual language as Profix "Status" column:
// outlined pill (w-24 h-6) with colored border+text on white bg.
const STATUS_PILL = {
  queued: { label: "Queued", text: "#ec9324", border: "#ec9324" }, // orange (like In Progress)
  sent:   { label: "Sent",   text: "#16a34a", border: "#16a34a" }, // green  (like Active)
  error:  { label: "Error",  text: "#dc2626", border: "#dc2626" }, // red    (like Cancelled)
};

function fmt(iso) { if (!iso) return "—"; try { return new Date(iso).toLocaleString(); } catch { return iso; } }

export default function NotificationsOutboxPage() {
  // ── Permissions V3 (Round 3) ──
  const { fn: permFn } = useEffectivePage("manage", "notifications");
  const permDelete = permFn("delete");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [qName, setQName] = useState("");    // Recipient Name search
  const [qEmail, setQEmail] = useState("");  // Recipient Email search
  const [kind, setKind] = useState([]);
  const [status, setStatus] = useState([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/notifications/outbox", {
        params: {
          q_name: qName || undefined,
          q_email: qEmail || undefined,
          kind: kind.length ? kind.join(",") : undefined,
          status: status.length ? status.join(",") : undefined,
          page,
          page_size: pageSize,
        },
      });
      const data = r.data || {};
      setItems(Array.isArray(data) ? data : (data.items || []));
      setTotal(Array.isArray(data) ? data.length : (data.total || 0));
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [qName, qEmail, kind, status, page, pageSize]);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); /* eslint-disable-next-line */ }, [qName, qEmail, kind, status]);

  const remove = async (n) => {
    const ok = await confirmDialog({ title: 'Delete log entry', message: 'Delete this notification log entry?', confirmLabel: 'Delete', confirmVariant: 'destructive' });
    if (!ok) return;
    await api.delete(`/notifications/outbox/${n.id}`);
    notify.success("Deleted");
    load();
  };

  const retry = async (n) => {
    try {
      const r = await api.post(`/notifications/outbox/${n.id}/retry`);
      const newStatus = r?.data?.status || "queued";
      notify.success(newStatus === "sent" ? "Resent — email sent" : "Resent — re-queued");
      load();
    } catch (e) {
      notify.error(e?.response?.data?.detail || "Resend failed");
    }
  };

  // Toggle a single status chip in the multi-status filter array.
  const toggleStatus = (s) => {
    setStatus((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  const STATUS_CHIPS = [
    { key: "queued", label: "Queued", color: "#ec9324", bg: "#fff7ed" },
    { key: "sent",   label: "Sent",   color: "#16a34a", bg: "#f0fdf4" },
    { key: "error",  label: "Failed", color: "#dc2626", bg: "#fef2f2" },
  ];

  return (
    <Layout
      title="Outbox"
      contentClassName="w-full px-4 pt-4 pb-3 flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden"
      actions={
        <Button
          variant="outline"
          onClick={load}
          data-testid="refresh-outbox-btn"
          size="icon"
          className="h-9 w-9"
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw sx={{ fontSize: 16 }}/>
        </Button>
      }
    >
      <div className="shrink-0 -mx-4 px-4 pt-1 pb-3 bg-gray-50/95 backdrop-blur">
        <div className="flex flex-wrap gap-3 items-center bg-white p-4 rounded-xl shadow-soft border border-gray-100" data-testid="outbox-filter-bar">
        <DeferredSearchInput
          className="flex-1 min-w-[220px]"
          placeholder="Search recipient name…"
          testId="outbox-search-name"
          value={qName}
          onCommit={setQName}
        />
        <DeferredSearchInput
          className="flex-1 min-w-[220px]"
          placeholder="Search recipient email…"
          testId="outbox-search-email"
          value={qEmail}
          onCommit={setQEmail}
        />
        <MultiSelectFilter
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: "new_employee", label: "New employee credentials" },
            { value: "admin_password_reset", label: "Admin password reset" },
            { value: "forgot_password", label: "Forgot password" },
          ]}
          testIdPrefix="outbox-kind"
          className="w-56"
        />
        <MultiSelectFilter
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "queued", label: "Queued" },
            { value: "sent", label: "Sent" },
            { value: "error", label: "Error" },
          ]}
          testIdPrefix="outbox-status"
          className="w-40"
        />
        </div>
        {/* Status quick-toggle chips — click to filter Queued / Sent / Failed */}
        <div className="mt-3 flex items-center gap-2" data-testid="outbox-status-chips">
          <span className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mr-1">
            Quick filter
          </span>
          {STATUS_CHIPS.map((c) => {
            const active = status.includes(c.key);
            const count = items.filter((i) => i.status === c.key).length;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => toggleStatus(c.key)}
                data-testid={`outbox-chip-${c.key}`}
                className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[11px] font-semibold border-2 transition-colors ${
                  active ? "text-white" : "bg-white"
                }`}
                style={{
                  color: active ? "#fff" : c.color,
                  borderColor: c.color,
                  backgroundColor: active ? c.color : c.bg,
                }}
                title={active ? `Remove ${c.label} filter` : `Show only ${c.label}`}
              >
                {c.label}
                <span
                  className={`inline-flex items-center justify-center min-w-[18px] h-4 rounded-full text-[10px] ${
                    active ? "bg-white/25 text-white" : "bg-white"
                  }`}
                  style={{ color: active ? "#fff" : c.color, borderColor: c.color }}
                >
                  {count}
                </span>
              </button>
            );
          })}
          {status.length > 0 && (
            <button
              type="button"
              onClick={() => setStatus([])}
              className="text-[11px] text-gray-500 hover:text-gray-800 underline underline-offset-2 ml-1"
              data-testid="outbox-chip-clear"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 flex-1 min-h-0 flex flex-col bg-white rounded-xl shadow-soft border border-gray-100 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 font-bold tracking-wider border-b border-gray-200 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left">When</th>
                <th className="px-4 py-3 text-left">Kind</th>
                <th className="px-4 py-3 text-left">Recipient</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Subject</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((n) => {
                const st = STATUS_PILL[n.status] || STATUS_PILL.queued;
                const kc = KIND_COLORS[n.kind] || { text: "#6b7280", border: "#d1d5db" };
                return (
                  <tr key={n.id} className="border-b border-gray-100 hover:bg-gray-50/80" data-testid={`outbox-row-${n.id}`}>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmt(n.created_at)}</td>
                    <td className="px-4 py-3">
                      <span
                        data-testid={`outbox-kind-${n.kind}`}
                        className="inline-flex items-center justify-center h-6 rounded-full border-2 text-[11px] font-semibold bg-white select-none whitespace-nowrap px-3"
                        style={{ color: kc.text, borderColor: kc.border }}
                      >
                        {KIND_LABEL[n.kind] || n.kind}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-800 font-medium">{n.to_name || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{n.to_email || "—"}</td>
                    <td className="px-4 py-3 text-gray-700">{n.subject}</td>
                    <td className="px-4 py-3">
                      <span
                        data-testid={`outbox-status-${n.status}`}
                        className="inline-flex items-center justify-center w-24 h-6 rounded-full border-2 text-[11px] font-semibold bg-white select-none whitespace-nowrap"
                        style={{ color: st.text, borderColor: st.border }}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-800"
                            data-testid={`row-actions-${n.id}`}
                            aria-label="Row actions"
                            title="Actions"
                          >
                            <MoreVertical sx={{ fontSize: 15 }}/>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => setPreview(n)} data-testid={`view-outbox-${n.id}`}>
                            <Eye sx={{ fontSize: 13 }} className="mr-2 text-gray-500"/> View
                          </DropdownMenuItem>
                          {n.status === "error" && (
                            <DropdownMenuItem
                              onClick={() => retry(n)}
                              data-testid={`retry-outbox-${n.id}`}
                              className="text-[#ec9324] focus:text-[#d4811f]"
                            >
                              <RestartAlt sx={{ fontSize: 14 }} className="mr-2"/> Resend
                            </DropdownMenuItem>
                          )}
                          {permDelete.isVisible && (
                            <>
                              <DropdownMenuSeparator/>
                              <DropdownMenuItem
                                onClick={() => remove(n)}
                                data-testid={`delete-outbox-${n.id}`}
                                disabled={!permDelete.canUse}
                                className="text-red-600 focus:text-red-700"
                              >
                                <Trash2 sx={{ fontSize: 13 }} className="mr-2"/> Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && !loading && (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">No notifications yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          label="Emails"
          testIdPrefix="outbox-pg"
          className="mt-auto"
        />
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent
          className="max-w-3xl p-0 gap-0 overflow-hidden bg-white"
          data-testid="outbox-preview-modal"
        >
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-gray-200 bg-gray-50/60">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-gray-900">
              <Mail sx={{ fontSize: 16 }} className="text-[#ec9324]"/>
              <span className="truncate" data-testid="outbox-preview-title">
                {preview?.subject || "(no subject)"}
              </span>
            </DialogTitle>
            <div className="text-[11px] text-gray-500 mt-1">
              Kind <code className="px-1 bg-gray-100 rounded">{preview?.kind}</code>
              {" · "}Status {preview?.status}
              {preview?.created_at && (
                <>
                  {" · "}Queued {fmt(preview.created_at)}
                </>
              )}
              {preview?.sent_at && (
                <>
                  {" · "}Sent {fmt(preview.sent_at)}
                </>
              )}
            </div>
          </DialogHeader>

          <div className="max-h-[75vh] overflow-y-auto bg-gray-100 p-6">
            <div className="mx-auto max-w-[640px] bg-white rounded-lg shadow-md ring-1 ring-gray-200 overflow-hidden">
              {/* Email chrome header */}
              <div className="border-b border-gray-200 bg-white px-5 py-4">
                <div className="text-[13px] leading-snug space-y-1">
                  <div className="flex gap-2">
                    <span className="w-14 shrink-0 font-semibold text-gray-500 uppercase tracking-wider text-[10px] pt-0.5">
                      From
                    </span>
                    <span className="text-gray-900">
                      <span className="font-medium">Infollion Admin</span>{" "}
                      <span className="text-gray-500">&lt;no-reply@infollion.com&gt;</span>
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-14 shrink-0 font-semibold text-gray-500 uppercase tracking-wider text-[10px] pt-0.5">
                      To
                    </span>
                    <span className="text-gray-900">
                      <span className="font-medium">{preview?.to_name || "—"}</span>{" "}
                      <span className="text-gray-500">&lt;{preview?.to_email}&gt;</span>
                    </span>
                  </div>
                  <div className="flex gap-2 pt-1 border-t border-gray-100 mt-1">
                    <span className="w-14 shrink-0 font-semibold text-gray-500 uppercase tracking-wider text-[10px] pt-1">
                      Subject
                    </span>
                    <span className="text-gray-900 font-semibold pt-0.5" data-testid="outbox-preview-subject">
                      {preview?.subject || <span className="italic text-gray-400">(no subject)</span>}
                    </span>
                  </div>
                </div>
              </div>

              {/* Branded orange strip */}
              <div
                className="px-6 py-4 border-b border-orange-200"
                style={{ background: "linear-gradient(135deg, #ec9324 0%, #f59e0b 100%)" }}
              >
                <div className="flex items-center gap-2 text-white">
                  <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center ring-1 ring-white/30 backdrop-blur-sm">
                    <span className="text-white font-extrabold text-sm">i</span>
                  </div>
                  <div>
                    <div className="text-white font-bold text-sm tracking-wide">
                      Infollion Utilities
                    </div>
                    <div className="text-white/80 text-[10px] uppercase tracking-wider">
                      Notifications
                    </div>
                  </div>
                </div>
              </div>

              {/* Rendered body — sanitized HTML with plain-text fallback */}
              <div
                className="px-8 py-6 text-sm text-gray-800 leading-relaxed email-preview-body"
                data-testid="outbox-preview-body"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(
                    /<[a-z][\s\S]*>/i.test(preview?.body || "")
                      ? (preview?.body || "")
                      : `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${(preview?.body || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</pre>`
                  ),
                }}
              />

              {/* Footer */}
              <div className="border-t border-gray-200 bg-gray-50 px-6 py-4 text-center">
                <div className="text-[11px] text-gray-600 mb-1">
                  You&apos;re receiving this email because your address is registered on Infollion Utilities.
                </div>
                <div className="text-[10px] text-gray-400">
                  © {new Date().getFullYear()} Infollion Utilities
                </div>
              </div>
            </div>

            {preview?.error && (
              <div className="mx-auto max-w-[640px] mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">
                <span className="font-semibold">Provider error:</span> {preview.error}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
