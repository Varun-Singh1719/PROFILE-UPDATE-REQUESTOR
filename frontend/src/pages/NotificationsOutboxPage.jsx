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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from "../components/ui/dialog";
import { Search, Mail, RefreshCw, Trash2, Eye, AlertCircle, Clock, CheckCircle2, MoreVertical } from "lucide-react";
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

const STATUS_STYLES = {
  queued: { label: "Queued", cls: "bg-amber-50 text-amber-700 border-amber-200", icon: Clock },
  sent: { label: "Sent", cls: "bg-green-50 text-green-700 border-green-200", icon: CheckCircle2 },
  error: { label: "Error", cls: "bg-rose-50 text-rose-700 border-rose-200", icon: AlertCircle },
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
  const [q, setQ] = useState("");
  const [kind, setKind] = useState([]);
  const [status, setStatus] = useState([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/notifications/outbox", {
        params: {
          q: q || undefined,
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

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, kind, status, page, pageSize]);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); /* eslint-disable-next-line */ }, [q, kind, status]);

  const remove = async (n) => {
    const ok = await confirmDialog({ title: 'Delete log entry', message: 'Delete this notification log entry?', confirmLabel: 'Delete', confirmVariant: 'destructive' });
    if (!ok) return;
    await api.delete(`/notifications/outbox/${n.id}`);
    notify.success("Deleted");
    load();
  };

  return (
    <Layout
      title="Notifications Outbox"
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
          <RefreshCw size={16}/>
        </Button>
      }
    >
      <div className="shrink-0 -mx-4 px-4 pt-1 pb-3 bg-gray-50/95 backdrop-blur">
        <div className="flex flex-wrap gap-3 items-center bg-white p-4 rounded-xl shadow-soft border border-gray-100" data-testid="outbox-filter-bar">
        <DeferredSearchInput
          className="flex-1 min-w-[240px]"
          placeholder="Search recipient or subject…"
          testId="outbox-search"
          value={q}
          onCommit={setQ}
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
      </div>

      <div className="mt-6 flex-1 min-h-0 flex flex-col bg-white rounded-xl shadow-soft border border-gray-100 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 font-bold tracking-wider border-b border-gray-200 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left">When</th>
                <th className="px-4 py-3 text-left">Kind</th>
                <th className="px-4 py-3 text-left">Recipient</th>
                <th className="px-4 py-3 text-left">Subject</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((n) => {
                const st = STATUS_STYLES[n.status] || STATUS_STYLES.queued;
                const StIcon = st.icon;
                return (
                  <tr key={n.id} className="border-b border-gray-100 hover:bg-gray-50/80" data-testid={`outbox-row-${n.id}`}>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmt(n.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-[#ec9324]/10 text-[#ec9324] rounded px-2 py-1">
                        <Mail size={12}/> {KIND_LABEL[n.kind] || n.kind}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <div className="font-medium">{n.to_name}</div>
                      <div className="text-xs text-gray-500">{n.to_email}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{n.subject}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border ${st.cls}`}>
                        <StIcon size={12}/> {st.label}
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
                            <MoreVertical size={15}/>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => setPreview(n)} data-testid={`view-outbox-${n.id}`}>
                            <Eye size={13} className="mr-2 text-gray-500"/> View
                          </DropdownMenuItem>
                          {permDelete.isVisible && (
                            <>
                              <DropdownMenuSeparator/>
                              <DropdownMenuItem
                                onClick={() => remove(n)}
                                data-testid={`delete-outbox-${n.id}`}
                                disabled={!permDelete.canUse}
                                className="text-red-600 focus:text-red-700"
                              >
                                <Trash2 size={13} className="mr-2"/> Delete
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
                <tr><td colSpan={6} className="text-center py-12 text-gray-400">No notifications yet</td></tr>
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
          label="Notifications"
          testIdPrefix="outbox-pg"
          className="mt-auto"
        />
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{preview?.subject}</DialogTitle>
            <DialogDescription>
              To: <span className="font-medium text-gray-700">{preview?.to_name}</span> &lt;{preview?.to_email}&gt;
            </DialogDescription>
          </DialogHeader>
          <pre className="mt-2 whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-md p-4 max-h-[60vh] overflow-y-auto" data-testid="outbox-preview-body">
            {preview?.body}
          </pre>
          {preview?.error && (
            <div className="mt-2 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded p-2">
              Provider error: {preview.error}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
