import React, { useEffect, useState, useCallback, useMemo } from "react";
import api, { formatApiError } from "../lib/api";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Switch } from "../components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import DeferredSearchInput from "../components/DeferredSearchInput";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import notify from "../lib/notify";
import Edit from "@mui/icons-material/EditOutlined";
import Loader2 from "@mui/icons-material/Autorenew";
import Close from "@mui/icons-material/Close";
import Notifications from "@mui/icons-material/NotificationsActive";
import Article from "@mui/icons-material/DescriptionOutlined";
import Bolt from "@mui/icons-material/BoltOutlined";
import Visibility from "@mui/icons-material/VisibilityOutlined";
import CheckCircle from "@mui/icons-material/CheckCircleOutlined";
import Cancel from "@mui/icons-material/CancelOutlined";
import Chair from "@mui/icons-material/Chair";
import EventAvailable from "@mui/icons-material/EventAvailableOutlined";
import { useAuth } from "../context/AuthContext";

/**
 * NotificationTemplatesPage — Redesigned (Jul 2026)
 *
 * Professional card layout using the dashboard orange (#ec9324) as the
 * single accent color. Follows the same filter/search UX as the Email
 * Templates page (DeferredSearchInput + MultiSelectFilter) and reuses the
 * shadcn `Switch` component for On/Off toggling.
 */

// Derive module label from the template `kind`.
function moduleFor(kind) {
  const k = (kind || "").toLowerCase();
  if (k.startsWith("workstation_") || k.startsWith("workspace_") || k.startsWith("seat_"))
    return "Workspace Manager";
  return "Profix";
}

// Human-readable recipient description per template kind. Answers the
// user's question "which user receives this notification?".
const RECIPIENT_BY_KIND = {
  request_closed:               "Created By (request creator)",
  workstation_assigned:         "Assigned employee",
  workstation_request_approved: "Requesting employee",
  workstation_request_declined: "Requesting employee",
};

// Icon/colour used in the bell-dropdown preview — matches NotificationBell
// so the preview renders exactly what the end-user sees.
const BELL_META = {
  workstation_request_approved: { Icon: CheckCircle,    color: "#16a34a", bg: "#f0fdf4" },
  workstation_request_declined: { Icon: Cancel,         color: "#dc2626", bg: "#fef2f2" },
  workstation_assigned:         { Icon: Chair,          color: "#ec9324", bg: "#fff7ed" },
  request_closed:               { Icon: EventAvailable, color: "#0284c7", bg: "#f0f9ff" },
};

export default function NotificationTemplatesPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "Super Admin";

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Filters — same shape as EmailTemplates.
  const [q, setQ] = useState("");
  const [moduleFilter, setModuleFilter] = useState([]);   // empty = All
  const [statusFilter, setStatusFilter] = useState([]);   // empty = All

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/notification-templates");
      setItems(r.data || []);
    } catch (e) {
      notify.error(formatApiError(e?.response?.data?.detail) || "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items
      .filter((t) => {
        if (moduleFilter.length > 0 && !moduleFilter.includes(moduleFor(t.kind))) return false;
        if (statusFilter.length > 0 && !statusFilter.includes(t.status || "Active")) return false;
        if (needle) {
          const hay = `${t.name} ${t.title} ${t.body} ${t.trigger} ${t.kind}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [items, q, moduleFilter, statusFilter]);

  const handleToggle = async (tpl) => {
    if (busyId) return;
    const nextStatus = (tpl.status || "Active") === "Active" ? "Inactive" : "Active";
    setBusyId(tpl.id);
    setItems((prev) => prev.map((x) => (x.id === tpl.id ? { ...x, status: nextStatus } : x)));
    try {
      const r = await api.patch(`/notification-templates/${tpl.id}`, { status: nextStatus });
      setItems((prev) => prev.map((x) => (x.id === tpl.id ? r.data : x)));
      notify.success(`"${tpl.name}" is now ${nextStatus}`);
    } catch (e) {
      setItems((prev) => prev.map((x) => (x.id === tpl.id ? tpl : x)));
      notify.error(formatApiError(e?.response?.data?.detail) || "Failed to update status");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Layout
      title="Notification Templates"
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          disabled={loading}
          className="border-gray-300 hover:border-[#ec9324] hover:text-[#ec9324]"
        >
          {loading ? <Loader2 sx={{ fontSize: 14 }} className="animate-spin mr-1.5" /> : null}
          Refresh
        </Button>
      }
    >
      <TooltipProvider delayDuration={150}>
      <div className="p-4 md:p-6 space-y-4" data-testid="notif-templates-page">
        {/* Hero / summary strip */}
        <div className="rounded-xl border border-[#ec9324]/25 bg-gradient-to-r from-[#fff7ec] to-white px-5 py-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-[#ec9324] text-white grid place-items-center shrink-0 shadow-sm">
            <Notifications sx={{ fontSize: 20 }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-gray-900">In-app Notifications</div>
            <div className="text-[11px] text-gray-500">
              {filtered.length} of {items.length} template{items.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        {/* Filter bar — same shape as EmailTemplatesPage */}
        <div
          className="flex flex-wrap gap-3 items-center bg-white p-3 rounded-xl shadow-soft border border-gray-100"
          data-testid="notif-templates-filter-bar"
        >
          <DeferredSearchInput
            className="flex-1 min-w-[240px]"
            placeholder="Search by name, title or trigger…"
            testId="notif-template-search"
            value={q}
            onCommit={setQ}
          />
          <MultiSelectFilter
            label="Module"
            value={moduleFilter}
            onChange={setModuleFilter}
            options={[
              { value: "Profix", label: "Profix" },
              { value: "Workspace Manager", label: "Workspace Manager" },
            ]}
            testIdPrefix="notif-template-module-filter"
            className="w-52"
          />
          <MultiSelectFilter
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "Active", label: "Active" },
              { value: "Inactive", label: "Inactive" },
            ]}
            testIdPrefix="notif-template-status-filter"
            className="w-40"
          />
        </div>

        {loading && items.length === 0 && (
          <div className="text-sm text-gray-400 py-10 text-center">Loading templates…</div>
        )}

        {!loading && filtered.length === 0 && items.length > 0 && (
          <div className="text-sm text-gray-400 py-10 text-center bg-white border border-dashed border-gray-200 rounded-xl">
            No notifications match your filters.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((t) => {
            const isActive = (t.status || "Active") === "Active";
            const rowBusy = busyId === t.id;
            const modLabel = moduleFor(t.kind);
            const recipient = RECIPIENT_BY_KIND[t.kind] || "Recipient";
            return (
              <div
                key={t.id}
                data-testid={`notif-template-card-${t.kind}`}
                className={`bg-white border rounded-xl overflow-hidden transition-all
                  ${isActive
                    ? "border-gray-200 hover:border-[#ec9324]/50 hover:shadow-sm"
                    : "border-gray-200 opacity-90 hover:opacity-100"}
                `}
              >
                <div className="p-4">
                  {/* Header row */}
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div
                          className="font-semibold text-gray-900 text-[14px] truncate"
                          data-testid={`notif-template-name-${t.kind}`}
                        >
                          {t.name}
                        </div>
                        <span
                          data-testid={`notif-template-module-${t.kind}`}
                          className="inline-flex items-center justify-center h-6 px-2.5 rounded-full border-2 text-[11px] font-semibold bg-white select-none whitespace-nowrap"
                          style={{ color: "#ec9324", borderColor: "#ec9324" }}
                        >
                          {modLabel}
                        </span>
                        <StatusPill on={isActive} />
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPreviewing(t)}
                            data-testid={`notif-template-preview-${t.kind}`}
                            className="h-8 border-gray-300 hover:border-[#ec9324] hover:text-[#ec9324] hover:bg-[#fff7ec]"
                          >
                            <Visibility sx={{ fontSize: 14 }} className="mr-1" /> Preview
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">See how this notification appears in the bell dropdown</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditing(t)}
                            data-testid={`notif-template-edit-${t.kind}`}
                            className="h-8 border-gray-300 hover:border-[#ec9324] hover:text-[#ec9324] hover:bg-[#fff7ec]"
                          >
                            <Edit sx={{ fontSize: 14 }} className="mr-1" /> Edit
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Edit template content</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>

                  {/* Preview box (orange-tinted, professional) */}
                  <div className="mt-4 rounded-lg border border-[#ec9324]/20 bg-[#fff7ec]/50 p-3">
                    <div className="text-[13px] font-semibold text-gray-900 leading-snug">
                      {t.title}
                    </div>
                    <div className="text-[12px] text-gray-600 mt-1 whitespace-pre-line leading-snug">
                      {t.body}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400">
                      <code className="px-1 bg-white border border-gray-200 rounded text-gray-500">
                        {t.kind}
                      </code>
                      {t.action_label ? (
                        <>
                          <span>·</span>
                          <span>
                            CTA:&nbsp;
                            <span className="text-[#ec9324] font-medium">{t.action_label}</span>
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* Trigger + Recipient + Toggle */}
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-dashed border-gray-200 pt-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Trigger icon with tooltip showing the trigger label */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-[#fff7ec] border border-[#ec9324]/30 text-[#ec9324] cursor-help"
                            data-testid={`notif-template-trigger-icon-${t.kind}`}
                          >
                            <Bolt sx={{ fontSize: 14 }} />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <div className="text-[11px]">
                            <div className="uppercase tracking-wider text-[9.5px] font-semibold opacity-70 mb-0.5">
                              Trigger
                            </div>
                            <div>{t.trigger || "—"}</div>
                          </div>
                        </TooltipContent>
                      </Tooltip>

                      {/* Recipient info */}
                      <div className="text-[11px] text-gray-600 truncate">
                        <span className="uppercase tracking-wider text-[9.5px] font-semibold text-gray-400">
                          Sent to
                        </span>
                        <span className="ml-1.5 text-gray-700 font-medium">{recipient}</span>
                      </div>
                    </div>

                    {/* Switch — same style as Email Templates */}
                    <div
                      className="inline-flex items-center gap-2 shrink-0"
                      data-testid={`notif-template-toggle-${t.kind}`}
                    >
                      <Switch
                        checked={isActive}
                        onCheckedChange={() => handleToggle(t)}
                        disabled={rowBusy}
                        className="data-[state=checked]:bg-[#ec9324]"
                        data-testid={`notif-template-switch-${t.kind}`}
                      />
                      <span
                        className={`text-[11px] font-medium ${isActive ? "text-emerald-700" : "text-gray-500"}`}
                      >
                        {isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <EditTemplateModal
        template={editing}
        canEditContent={isSuperAdmin}
        onClose={() => setEditing(null)}
        onSaved={(fresh) => {
          setItems((prev) => prev.map((x) => (x.id === fresh.id ? fresh : x)));
          setEditing(null);
        }}
      />

      <PreviewNotificationModal
        template={previewing}
        onClose={() => setPreviewing(null)}
      />
      </TooltipProvider>
    </Layout>
  );
}

function StatusPill({ on }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
        on
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-gray-100 text-gray-500 border-gray-200"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-gray-400"}`} />
      {on ? "Active" : "Inactive"}
    </span>
  );
}

/**
 * Preview modal — renders the notification exactly like it appears in the
 * bell dropdown (top-bar). Non-editable; just a visual mock.
 */
function PreviewNotificationModal({ template, onClose }) {
  if (!template) return null;
  const meta = BELL_META[template.kind] || { Icon: Article, color: "#6b7280", bg: "#f3f4f6" };
  const { Icon } = meta;
  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden" data-testid="notif-template-preview-modal">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-gray-100 bg-gradient-to-r from-[#fff7ec] to-white">
          <DialogTitle className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Visibility sx={{ fontSize: 16 }} className="text-[#ec9324]" />
            Notification Preview
          </DialogTitle>
          <div className="text-[11px] text-gray-500 mt-0.5">
            How this appears in the bell dropdown
          </div>
        </DialogHeader>

        <div className="p-5 bg-gray-50">
          {/* Fake bell popover container */}
          <div className="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">Notifications</div>
              <div className="text-[10px] text-[#ec9324] font-medium">Mark all read</div>
            </div>
            <div className="flex border-b border-gray-100">
              <div className="flex-1 py-2 text-xs font-semibold text-center text-[#ec9324] border-b-2 border-[#ec9324] bg-[#fff7ed]/50">
                Unread
              </div>
              <div className="flex-1 py-2 text-xs font-semibold text-center text-gray-500 border-b-2 border-transparent">
                Read
              </div>
              <div className="flex-1 py-2 text-xs font-semibold text-center text-gray-500 border-b-2 border-transparent">
                All
              </div>
            </div>
            {/* The row */}
            <div className="flex items-start gap-3 px-4 py-3 bg-[#fff7ed]/40">
              <span
                className="mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full shrink-0"
                style={{ backgroundColor: meta.bg, color: meta.color }}
              >
                <Icon sx={{ fontSize: 16 }} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                  <div className="text-[13px] font-semibold text-gray-900">
                    {template.title || "(untitled)"}
                  </div>
                  <span className="mt-1 w-2 h-2 rounded-full bg-[#ec9324] shrink-0" />
                </div>
                {template.body && (
                  <div className="text-[12px] text-gray-600 leading-snug mt-0.5">
                    {template.body}
                  </div>
                )}
                <div className="text-[10px] text-gray-400 mt-1">just now</div>
              </div>
            </div>
          </div>

          <div className="mt-4 text-[11px] text-gray-500 space-y-1">
            <div>
              <span className="uppercase tracking-wider text-[9.5px] font-semibold text-gray-400">Recipient</span>
              <span className="ml-1.5 text-gray-700">
                {RECIPIENT_BY_KIND[template.kind] || "Recipient"}
              </span>
            </div>
            <div>
              <span className="uppercase tracking-wider text-[9.5px] font-semibold text-gray-400">Trigger</span>
              <span className="ml-1.5 text-gray-700">{template.trigger || "—"}</span>
            </div>
            <div className="text-[10.5px] text-gray-400 italic pt-1">
              Note: placeholders like <code className="px-1 bg-white border border-gray-200 rounded">{`{{seat_label}}`}</code> are replaced with real values when the notification is sent.
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 bg-white">
          <Button variant="outline" onClick={onClose} data-testid="notif-template-preview-close">
            <Close sx={{ fontSize: 14 }} className="mr-1.5" /> Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditTemplateModal({ template, canEditContent, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: "",
    title: "",
    body: "",
    action_label: "",
    status: "Active",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (template) {
      setForm({
        name: template.name || "",
        title: template.title || "",
        body: template.body || "",
        action_label: template.action_label || "",
        status: template.status || "Active",
      });
    }
  }, [template]);

  if (!template) return null;

  const save = async () => {
    setSaving(true);
    try {
      const payload = canEditContent ? form : { status: form.status };
      const r = await api.patch(`/notification-templates/${template.id}`, payload);
      notify.success("Template updated");
      onSaved(r.data);
    } catch (e) {
      notify.error(formatApiError(e?.response?.data?.detail) || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden" data-testid="notif-template-edit-modal">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-gray-100 bg-gradient-to-r from-[#fff7ec] to-white">
          <DialogTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Edit sx={{ fontSize: 16 }} className="text-[#ec9324]" />
            Edit Notification Template
          </DialogTitle>
          <div className="text-[11px] text-gray-500 mt-1">
            Kind <code className="px-1 bg-white border border-gray-200 rounded">{template.kind}</code>
            {" · "}Trigger: {template.trigger}
          </div>
        </DialogHeader>

        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto space-y-4">
          {!canEditContent && (
            <div className="text-[11px] bg-amber-50 border border-amber-200 rounded p-2.5 text-amber-800">
              Only Super Admin can edit content. You can toggle the status.
            </div>
          )}
          <div>
            <Label htmlFor="ntpl-name">Name</Label>
            <Input
              id="ntpl-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              disabled={!canEditContent}
              className="mt-1.5"
              data-testid="notif-template-name-input"
            />
          </div>
          <div>
            <Label htmlFor="ntpl-title">
              Title{" "}
              <span className="text-gray-400 font-normal text-[11px]">
                — appears as the bold headline in the bell row
              </span>
            </Label>
            <Input
              id="ntpl-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              disabled={!canEditContent}
              className="mt-1.5"
              placeholder="e.g. Workstation request approved"
              data-testid="notif-template-title-input"
            />
          </div>
          <div>
            <Label htmlFor="ntpl-body">
              Body{" "}
              <span className="text-gray-400 font-normal text-[11px]">
                — use {`{{variable}}`} placeholders
              </span>
            </Label>
            <Textarea
              id="ntpl-body"
              rows={5}
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              disabled={!canEditContent}
              className="mt-1.5 font-mono text-[12px]"
              placeholder={"e.g. Your workstation request for {{seat_label}} on {{date}} was approved by {{decided_by}}."}
              data-testid="notif-template-body-input"
            />
          </div>
          <div>
            <Label htmlFor="ntpl-action">Action label</Label>
            <Input
              id="ntpl-action"
              value={form.action_label}
              onChange={(e) => setForm((f) => ({ ...f, action_label: e.target.value }))}
              disabled={!canEditContent}
              className="mt-1.5"
              placeholder="e.g. View booking"
              data-testid="notif-template-action-input"
            />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Label className="mb-0">Status</Label>
            <div className="inline-flex items-center gap-2" data-testid="notif-template-status-toggle">
              <Switch
                checked={form.status === "Active"}
                onCheckedChange={(v) => setForm((f) => ({ ...f, status: v ? "Active" : "Inactive" }))}
                className="data-[state=checked]:bg-[#ec9324]"
                data-testid="notif-template-status-switch"
              />
              <span
                className={`text-[12px] font-medium ${form.status === "Active" ? "text-emerald-700" : "text-gray-500"}`}
              >
                {form.status === "Active" ? "Active" : "Inactive"}
              </span>
            </div>
          </div>

          {/* Preview */}
          <div className="pt-3 border-t border-gray-100">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
              Preview (raw, no substitution)
            </div>
            <div className="rounded-lg border border-[#ec9324]/20 bg-[#fff7ec]/40 p-3">
              <div className="text-[13px] font-semibold text-gray-900">
                {form.title || "(title)"}
              </div>
              <div className="text-[12px] text-gray-600 mt-0.5 whitespace-pre-line">
                {form.body || "(body)"}
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-2 bg-gray-50/50">
          <Button variant="outline" onClick={onClose} disabled={saving} data-testid="notif-template-cancel">
            <Close sx={{ fontSize: 14 }} className="mr-1.5" /> Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white"
            data-testid="notif-template-save"
          >
            {saving ? <Loader2 sx={{ fontSize: 14 }} className="mr-1.5 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
