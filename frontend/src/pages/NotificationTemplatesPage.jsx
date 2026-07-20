import React, { useEffect, useState, useCallback, useMemo } from "react";
import api, { formatApiError } from "../lib/api";
import Layout from "../components/Layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import notify from "../lib/notify";
import Edit from "@mui/icons-material/EditOutlined";
import Loader2 from "@mui/icons-material/Autorenew";
import Close from "@mui/icons-material/Close";
import Notifications from "@mui/icons-material/NotificationsActive";
import NotificationsOff from "@mui/icons-material/NotificationsOff";
import EventAvailable from "@mui/icons-material/EventAvailableOutlined";
import EventBusy from "@mui/icons-material/EventBusyOutlined";
import Assignment from "@mui/icons-material/AssignmentTurnedInOutlined";
import Task from "@mui/icons-material/TaskAltOutlined";
import Bolt from "@mui/icons-material/BoltOutlined";
import Search from "@mui/icons-material/SearchOutlined";
import { useAuth } from "../context/AuthContext";

/**
 * NotificationTemplatesPage — Redesigned (Jul 2026)
 *
 * Modern card-based layout matching the dashboard color palette
 * (Profix orange #ec9324 as primary). Each card now exposes an
 * inline On/Off radio-button toggle so admins can enable/disable
 * a notification format instantly without opening the modal.
 */

// Per-kind visual metadata — accent stripe + icon + soft bg
const KIND_META = {
  workstation_request_approved: {
    icon: EventAvailable,
    accent: "#16a34a", // green
    tint: "bg-emerald-50",
    label: "Approval",
  },
  workstation_request_declined: {
    icon: EventBusy,
    accent: "#dc2626", // red
    tint: "bg-rose-50",
    label: "Declined",
  },
  workstation_assigned: {
    icon: Assignment,
    accent: "#7c3aed", // purple
    tint: "bg-violet-50",
    label: "Assignment",
  },
  request_closed: {
    icon: Task,
    accent: "#2563eb", // blue
    tint: "bg-blue-50",
    label: "Profix",
  },
};

const DEFAULT_META = {
  icon: Bolt,
  accent: "#ec9324",
  tint: "bg-amber-50",
  label: "Notification",
};

export default function NotificationTemplatesPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "Super Admin";
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [query, setQuery] = useState("");

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

  useEffect(() => {
    load();
  }, [load]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (t) =>
        (t.name || "").toLowerCase().includes(q) ||
        (t.title || "").toLowerCase().includes(q) ||
        (t.body || "").toLowerCase().includes(q) ||
        (t.trigger || "").toLowerCase().includes(q) ||
        (t.kind || "").toLowerCase().includes(q),
    );
  }, [sorted, query]);

  const activeCount = items.filter((t) => (t.status || "Active") === "Active").length;
  const inactiveCount = items.length - activeCount;

  const handleToggle = async (tpl, nextStatus) => {
    if (busyId) return;
    if ((tpl.status || "Active") === nextStatus) return;
    setBusyId(tpl.id);
    // Optimistic update
    setItems((prev) =>
      prev.map((x) => (x.id === tpl.id ? { ...x, status: nextStatus } : x)),
    );
    try {
      const r = await api.patch(`/notification-templates/${tpl.id}`, { status: nextStatus });
      setItems((prev) => prev.map((x) => (x.id === tpl.id ? r.data : x)));
      notify.success(`Notification turned ${nextStatus === "Active" ? "On" : "Off"}`);
    } catch (e) {
      // rollback
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
          {loading ? (
            <Loader2 sx={{ fontSize: 14 }} className="animate-spin mr-1.5" />
          ) : null}
          Refresh
        </Button>
      }
    >
      <div className="p-4 md:p-6 space-y-5" data-testid="notif-templates-page">
        {/* Hero / summary strip */}
        <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-r from-[#fff7ec] via-white to-white p-5 md:p-6">
          <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-[#ec9324]/10 blur-2xl" />
          <div className="relative flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-[#ec9324] text-white grid place-items-center shadow-sm">
                <Notifications sx={{ fontSize: 22 }} />
              </div>
              <div>
                <div className="text-base font-semibold text-gray-900">In-app Notifications</div>
                <div className="text-[12px] text-gray-500 mt-0.5 max-w-lg">
                  Manage the notifications that appear in the bell dropdown. Toggle a
                  format On/Off instantly, or edit its wording. Use{" "}
                  <code className="px-1 bg-white border border-gray-200 rounded text-[10.5px]">{`{{variables}}`}</code>{" "}
                  for dynamic values.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 md:ml-auto">
              <StatBadge color="#ec9324" label="Total" value={items.length} />
              <StatBadge color="#16a34a" label="Active" value={activeCount} />
              <StatBadge color="#94a3b8" label="Inactive" value={inactiveCount} />
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="flex items-center gap-3">
          <div className="relative w-full max-w-md">
            <Search
              sx={{ fontSize: 16 }}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, title, trigger…"
              className="pl-9 h-9 bg-white"
              data-testid="notif-template-search"
            />
          </div>
          <div className="text-[12px] text-gray-500">
            {filtered.length} of {items.length}
          </div>
        </div>

        {loading && items.length === 0 && (
          <div className="text-sm text-gray-400 py-10 text-center">Loading templates…</div>
        )}

        {!loading && filtered.length === 0 && items.length > 0 && (
          <div className="text-sm text-gray-400 py-10 text-center bg-white border border-dashed border-gray-200 rounded-xl">
            No notifications match your search.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((t) => {
            const meta = KIND_META[t.kind] || DEFAULT_META;
            const Icon = meta.icon;
            const isActive = (t.status || "Active") === "Active";
            const rowBusy = busyId === t.id;

            return (
              <div
                key={t.id}
                data-testid={`notif-template-card-${t.kind}`}
                className={`group relative bg-white border rounded-xl overflow-hidden transition-all
                  ${isActive ? "border-gray-200 hover:border-[#ec9324]/40 hover:shadow-md" : "border-gray-200 opacity-90 hover:opacity-100"}
                `}
              >
                {/* Accent stripe */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-1"
                  style={{ backgroundColor: meta.accent }}
                />

                <div className="pl-5 pr-4 pt-4 pb-4">
                  {/* Header row */}
                  <div className="flex items-start gap-3">
                    <div
                      className={`h-10 w-10 rounded-lg ${meta.tint} grid place-items-center shrink-0`}
                    >
                      <Icon sx={{ fontSize: 20 }} style={{ color: meta.accent }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div
                          className="font-semibold text-gray-900 text-[14px] truncate"
                          data-testid={`notif-template-name-${t.kind}`}
                        >
                          {t.name}
                        </div>
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                          style={{
                            color: meta.accent,
                            borderColor: meta.accent + "55",
                            backgroundColor: meta.accent + "12",
                          }}
                        >
                          {meta.label}
                        </span>
                        {isActive ? (
                          <StatusDot on />
                        ) : (
                          <StatusDot />
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1.5">
                        <span className="uppercase tracking-wider font-semibold text-gray-400">
                          Trigger
                        </span>
                        <span className="text-gray-600 truncate">{t.trigger || "—"}</span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(t)}
                      data-testid={`notif-template-edit-${t.kind}`}
                      className="shrink-0 h-8 border-gray-300 hover:border-[#ec9324] hover:text-[#ec9324] hover:bg-[#fff7ec]"
                    >
                      <Edit sx={{ fontSize: 14 }} className="mr-1" /> Edit
                    </Button>
                  </div>

                  {/* Preview */}
                  <div className="mt-4 rounded-lg bg-gradient-to-br from-gray-50 to-white border border-gray-100 p-3">
                    <div className="text-[13px] font-semibold text-gray-900 leading-snug">
                      {t.title}
                    </div>
                    <div className="text-[12px] text-gray-600 mt-1 whitespace-pre-line leading-snug line-clamp-3">
                      {t.body}
                    </div>
                    <div className="mt-2 text-[10px] text-gray-400 flex items-center gap-1">
                      <code className="px-1 bg-white border border-gray-200 rounded text-[10px] text-gray-500">
                        {t.kind}
                      </code>
                      {t.action_label ? (
                        <>
                          <span className="mx-0.5">·</span>
                          <span className="text-gray-500">
                            CTA:&nbsp;<span className="text-[#ec9324] font-medium">{t.action_label}</span>
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* On/Off Radio Toggle Row */}
                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-dashed border-gray-200 pt-3">
                    <div className="flex items-center gap-2 text-[11px] text-gray-500">
                      {isActive ? (
                        <Notifications sx={{ fontSize: 14 }} className="text-[#ec9324]" />
                      ) : (
                        <NotificationsOff sx={{ fontSize: 14 }} className="text-gray-400" />
                      )}
                      <span>
                        {isActive
                          ? "Notification is being sent to users."
                          : "Notification is paused — nothing will be sent."}
                      </span>
                    </div>

                    <RadioGroup
                      value={isActive ? "Active" : "Inactive"}
                      onValueChange={(v) => handleToggle(t, v)}
                      className="flex items-center gap-1 bg-gray-100 rounded-full p-1"
                      data-testid={`notif-template-toggle-${t.kind}`}
                    >
                      <ToggleOption
                        value="Active"
                        selected={isActive}
                        label="On"
                        color="#16a34a"
                        disabled={rowBusy}
                        testId={`notif-template-toggle-on-${t.kind}`}
                      />
                      <ToggleOption
                        value="Inactive"
                        selected={!isActive}
                        label="Off"
                        color="#6b7280"
                        disabled={rowBusy}
                        testId={`notif-template-toggle-off-${t.kind}`}
                      />
                    </RadioGroup>
                  </div>

                  {t.description && (
                    <div className="text-[11px] text-gray-500 mt-3 italic leading-snug">
                      {t.description}
                    </div>
                  )}
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
    </Layout>
  );
}

function StatBadge({ color, label, value }) {
  return (
    <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-1.5 shadow-sm">
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="text-[11px] uppercase font-semibold tracking-wider text-gray-500">
        {label}
      </span>
      <span className="text-sm font-bold text-gray-900">{value}</span>
    </div>
  );
}

function StatusDot({ on }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
        on
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-gray-100 text-gray-500 border-gray-200"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-gray-400"}`}
      />
      {on ? "Active" : "Inactive"}
    </span>
  );
}

/**
 * A styled radio-button option that shows an outer ring + inner dot when
 * selected. Used to render an inline On/Off toggle for each template.
 */
function ToggleOption({ value, selected, label, color, disabled, testId }) {
  return (
    <label
      htmlFor={`${testId}`}
      className={`flex items-center gap-1.5 px-3 h-7 rounded-full cursor-pointer text-[11px] font-semibold transition-all select-none
        ${selected ? "bg-white shadow-sm" : "hover:bg-white/50"}
        ${disabled ? "opacity-60 cursor-not-allowed" : ""}
      `}
      style={selected ? { color } : { color: "#6b7280" }}
      data-testid={testId}
    >
      <RadioGroupItem
        id={testId}
        value={value}
        disabled={disabled}
        className="h-3.5 w-3.5"
        style={selected ? { borderColor: color, color } : {}}
      />
      {label}
    </label>
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
      const payload = canEditContent
        ? form
        : { status: form.status }; // Admin: status-only
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
      <DialogContent
        className="max-w-2xl p-0 gap-0 overflow-hidden"
        data-testid="notif-template-edit-modal"
      >
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
            <RadioGroup
              value={form.status}
              onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
              className="flex items-center gap-1 bg-gray-100 rounded-full p-1"
              data-testid="notif-template-status-toggle"
            >
              <ToggleOption
                value="Active"
                selected={form.status === "Active"}
                label="On"
                color="#16a34a"
                testId={`notif-template-status-btn-Active`}
              />
              <ToggleOption
                value="Inactive"
                selected={form.status === "Inactive"}
                label="Off"
                color="#6b7280"
                testId={`notif-template-status-btn-Inactive`}
              />
            </RadioGroup>
          </div>

          {/* Preview */}
          <div className="pt-3 border-t border-gray-100">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
              Preview (raw, no substitution)
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
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
          <Button
            variant="outline"
            onClick={onClose}
            disabled={saving}
            data-testid="notif-template-cancel"
          >
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
