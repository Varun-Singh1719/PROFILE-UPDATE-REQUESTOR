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
import SingleSelect from "../components/SingleSelect";
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
import Timer from "@mui/icons-material/AccessTimeOutlined";
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

// ------- Refresh-rate (bell poll) helpers -------
const UNIT_TO_MS = { sec: 1000, min: 60 * 1000, hr: 60 * 60 * 1000 };
const UNIT_OPTIONS = [
  { value: "sec", label: "Seconds" },
  { value: "min", label: "Minutes" },
  { value: "hr",  label: "Hours"   },
];
const NUM_OPTIONS = Array.from({ length: 20 }, (_, i) => {
  const n = i + 1;
  return { value: String(n), label: String(n) };
});

/**
 * Convert milliseconds → the {number, unit} pair that best matches while
 * staying within the allowed 1..20 range. Prefers larger units when the
 * value divides evenly.
 */
function msToParts(ms) {
  if (!ms || ms < 1000) return { num: 10, unit: "min" };
  const totalSec = Math.round(ms / 1000);
  const totalMin = Math.round(ms / 60000);
  const totalHr  = Math.round(ms / 3600000);
  if (totalHr >= 1 && totalHr <= 20 && totalHr * 3600000 === ms) return { num: totalHr, unit: "hr" };
  if (totalMin >= 1 && totalMin <= 20 && totalMin * 60000 === ms) return { num: totalMin, unit: "min" };
  if (totalSec >= 1 && totalSec <= 20) return { num: totalSec, unit: "sec" };
  // Fallback — clamp to sane values so the modal never opens empty.
  if (totalHr >= 1) return { num: Math.min(20, totalHr), unit: "hr" };
  if (totalMin >= 1) return { num: Math.min(20, totalMin), unit: "min" };
  return { num: Math.min(20, Math.max(1, totalSec)), unit: "sec" };
}
function partsToMs(num, unit) {
  return Math.max(1, parseInt(num, 10)) * (UNIT_TO_MS[unit] || 60000);
}

/**
 * Human-readable label for the current poll interval (e.g. "10 min",
 * "45 sec", "2 hr"). Used in the header chip on the templates page.
 */
function formatPollInterval(ms) {
  if (!ms || ms < 1000) return "—";
  const hr = ms / 3600000;
  if (hr >= 1 && Number.isInteger(hr)) return `${hr} ${hr === 1 ? "hour" : "hours"}`;
  const mn = ms / 60000;
  if (mn >= 1 && Number.isInteger(mn)) return `${mn} ${mn === 1 ? "min" : "min"}`;
  const sc = ms / 1000;
  return `${Math.round(sc)} sec`;
}

// Demo names used in the preview modal so placeholders like {{closed_by}}
// render as actual human names instead of raw template tokens.
const DEMO_NAMES = [
  "John Doe", "Jane Smith", "Michael Chen", "Priya Sharma",
  "Aisha Khan", "Ravi Patel", "Sara O'Neill", "David Kim",
];
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomTicketId() {
  // 4-digit id, avoids leading zero
  return String(1000 + Math.floor(Math.random() * 8999));
}
function randomSeatLabel() {
  const wing = String.fromCharCode(65 + Math.floor(Math.random() * 4)); // A-D
  return `${wing}-${100 + Math.floor(Math.random() * 400)}`;
}
function formatToday() {
  return new Date().toLocaleDateString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
  });
}

/**
 * Builds a preview payload for a given template kind. Values are
 * randomised on every call so admins can hit Preview repeatedly and see
 * that placeholders will be replaced when the notification is sent.
 * Each object exposes {title, rows[{label,value}], actionLabel, subtitle}.
 */
function buildPreviewPayload(kind) {
  const today = formatToday();
  switch (kind) {
    case "request_closed": {
      const id = randomTicketId();
      const name = pickRandom(DEMO_NAMES);
      return {
        title: `Request ${id} : Closed`,
        rows: [
          { label: "Ticket ID", value: id },
          { label: "Status",    value: "Closed" },
          { label: "Closed By", value: name },
          { label: "Date",      value: today },
        ],
        actionLabel: "View request",
      };
    }
    case "workstation_assigned": {
      const id = randomTicketId();
      const seat = randomSeatLabel();
      const name = pickRandom(DEMO_NAMES);
      return {
        title: `Booking ${id} : Workstation Assigned`,
        rows: [
          { label: "Booking ID",  value: id },
          { label: "Seat",        value: seat },
          { label: "Date",        value: today },
          { label: "Assigned By", value: name },
        ],
        actionLabel: "View booking",
      };
    }
    case "workstation_request_approved": {
      const id = randomTicketId();
      const seat = randomSeatLabel();
      const name = pickRandom(DEMO_NAMES);
      return {
        title: `Request ${id} : Approved`,
        rows: [
          { label: "Booking ID",  value: id },
          { label: "Seat",        value: seat },
          { label: "Date",        value: today },
          { label: "Approved By", value: name },
        ],
        actionLabel: "View booking",
      };
    }
    case "workstation_request_declined": {
      const id = randomTicketId();
      const seat = randomSeatLabel();
      const name = pickRandom(DEMO_NAMES);
      return {
        title: `Request ${id} : Declined`,
        rows: [
          { label: "Booking ID",  value: id },
          { label: "Seat",        value: seat },
          { label: "Date",        value: today },
          { label: "Declined By", value: name },
        ],
        actionLabel: "View request",
      };
    }
    default:
      return {
        title: "Notification",
        rows: [{ label: "Date", value: today }],
        actionLabel: null,
      };
  }
}

export default function NotificationTemplatesPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "Super Admin";

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Refresh-rate setting (singleton on the backend). Any authenticated user
  // can read; only Super Admin can edit.
  const [settings, setSettings] = useState(null);
  const [settingsEditOpen, setSettingsEditOpen] = useState(false);

  // Filters — same shape as EmailTemplates.
  const [q, setQ] = useState("");
  const [moduleFilter, setModuleFilter] = useState([]);   // empty = All
  const [statusFilter, setStatusFilter] = useState([]);   // empty = All

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tplRes, setRes] = await Promise.all([
        api.get("/notification-templates"),
        api.get("/notifications/settings").catch(() => ({ data: null })),
      ]);
      setItems(tplRes.data || []);
      if (setRes?.data) setSettings(setRes.data);
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
            <div className="flex items-center gap-3 flex-wrap">
              <div className="text-[15px] font-semibold text-gray-900">In-app Notifications</div>
              {/* Refresh rate display + edit trigger */}
              <div
                className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-white border border-[#ec9324]/30 text-[11px]"
                data-testid="notif-refresh-rate-display"
              >
                <Timer sx={{ fontSize: 12 }} className="text-[#ec9324]" />
                <span className="text-gray-500">Refresh every</span>
                <span className="font-semibold text-gray-900">
                  {formatPollInterval(settings?.poll_interval_ms)}
                </span>
                {isSuperAdmin && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setSettingsEditOpen(true)}
                        aria-label="Edit refresh rate"
                        data-testid="notif-refresh-rate-edit-btn"
                        className="ml-1 inline-flex items-center justify-center h-5 w-5 rounded-full text-[#ec9324] hover:bg-[#fff7ec] focus:outline-none focus:ring-2 focus:ring-[#ec9324]/40"
                      >
                        <Edit sx={{ fontSize: 12 }} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Edit refresh rate</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              {filtered.length} of {items.length} template{items.length === 1 ? "" : "s"}
            </div>
          </div>
          {/* Stat chips — colours mirror the Profix status palette
              (Active = Open = green, Inactive = Closed = red). */}
          <div className="flex items-center gap-2 shrink-0" data-testid="notif-templates-stats">
            <StatChip color="#ec9324" label="Total"    value={items.length} testId="notif-stat-total"/>
            <StatChip color="#16a34a" label="Active"   value={items.filter((t) => (t.status || "Active") === "Active").length} testId="notif-stat-active"/>
            <StatChip color="#dc2626" label="Inactive" value={items.filter((t) => (t.status || "Active") !== "Active").length} testId="notif-stat-inactive"/>
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
                        className={`text-[11px] font-semibold ${isActive ? "text-[#16a34a]" : "text-[#dc2626]"}`}
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

      <RefreshRateModal
        open={settingsEditOpen}
        settings={settings}
        onClose={() => setSettingsEditOpen(false)}
        onSaved={(fresh) => { setSettings(fresh); setSettingsEditOpen(false); }}
      />
      </TooltipProvider>
    </Layout>
  );
}

function StatusPill({ on }) {
  // Same design language as Profix > All Requests StatusBadge:
  // outlined pill, transparent bg, colored border + text.
  //   Active   → Green  (Open  in Profix)
  //   Inactive → Red    (Closed in Profix)
  const c = on
    ? { text: "#16a34a", border: "#16a34a" }
    : { text: "#dc2626", border: "#dc2626" };
  return (
    <span
      className="inline-flex items-center justify-center h-6 px-2.5 text-[11px] font-semibold rounded-full border-2 bg-white select-none whitespace-nowrap"
      style={{ color: c.text, borderColor: c.border }}
      data-testid={`notif-template-status-pill-${on ? "active" : "inactive"}`}
    >
      {on ? "Active" : "Inactive"}
    </span>
  );
}

/**
 * StatChip — small pill used in the hero row to display Total / Active /
 * Inactive counts. Colour dot on the left + uppercase label + bold value.
 */
function StatChip({ color, label, value, testId }) {
  return (
    <div
      className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-white border border-gray-200 shadow-sm"
      data-testid={testId}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
        {label}
      </span>
      <span className="text-[13px] font-bold text-gray-900 leading-none">{value}</span>
    </div>
  );
}

/**
 * Preview modal — renders the notification exactly like it appears in the
 * bell dropdown (top-bar). Placeholders are replaced with realistic sample
 * data (current date, random names, random IDs) so the admin sees what the
 * end user will actually see. Non-editable; just a visual mock.
 */
function PreviewNotificationModal({ template, onClose }) {
  // Freeze the randomised payload for the lifetime of this modal open — so
  // toggling e.g. hover states doesn't re-shuffle the demo values.
  const payload = useMemo(
    () => (template ? buildPreviewPayload(template.kind) : null),
    [template?.id],
  );
  if (!template || !payload) return null;
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
            {/* The row — mimics NotificationBell exactly */}
            <div
              className="flex items-start gap-3 px-4 py-3 bg-[#fff7ed]/40"
              data-testid="notif-template-preview-row"
            >
              <span
                className="mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full shrink-0"
                style={{ backgroundColor: meta.bg, color: meta.color }}
              >
                <Icon sx={{ fontSize: 16 }} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                  <div
                    className="text-[13px] font-semibold text-gray-900"
                    data-testid="notif-template-preview-title"
                  >
                    {payload.title}
                  </div>
                  <span className="mt-1 w-2 h-2 rounded-full bg-[#ec9324] shrink-0" />
                </div>
                <div
                  className="mt-1 space-y-0.5"
                  data-testid="notif-template-preview-body"
                >
                  {payload.rows.map((r) => (
                    <div key={r.label} className="text-[12px] text-gray-700 leading-snug">
                      <span className="text-gray-500">{r.label}&nbsp;:</span>&nbsp;
                      <span className="font-medium">{r.value}</span>
                    </div>
                  ))}
                </div>
                {payload.actionLabel && (
                  <div className="mt-1.5 text-[11px] text-[#ec9324] font-medium">
                    {payload.actionLabel} →
                  </div>
                )}
                <div className="text-[10px] text-gray-400 mt-1">just now</div>
              </div>
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
                className={`text-[12px] font-semibold ${form.status === "Active" ? "text-[#16a34a]" : "text-[#dc2626]"}`}
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


/**
 * RefreshRateModal — small popup with two dropdowns (1..20 + unit) that
 * lets a Super Admin adjust how often the notification bell auto-refreshes
 * its unread count. Save persists to the backend singleton; Cancel discards.
 */
function RefreshRateModal({ open, settings, onClose, onSaved }) {
  const [num, setNum] = useState("10");
  const [unit, setUnit] = useState("min");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const parts = msToParts(settings?.poll_interval_ms);
      setNum(String(parts.num));
      setUnit(parts.unit);
    }
  }, [open, settings?.poll_interval_ms]);

  const save = async () => {
    const ms = partsToMs(num, unit);
    setSaving(true);
    try {
      const r = await api.put("/notifications/settings", { poll_interval_ms: ms });
      notify.success(`Refresh rate set to ${formatPollInterval(r.data?.poll_interval_ms)}`);
      onSaved(r.data);
    } catch (e) {
      notify.error(formatApiError(e?.response?.data?.detail) || "Failed to save refresh rate");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden" data-testid="notif-refresh-rate-modal">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-gray-100 bg-gradient-to-r from-[#fff7ec] to-white">
          <DialogTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Timer sx={{ fontSize: 16 }} className="text-[#ec9324]" />
            Edit Refresh Rate
          </DialogTitle>
          <div className="text-[11px] text-gray-500 mt-1">
            How often the notification bell auto-refreshes its unread count.
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rr-num">Value</Label>
              <div className="mt-1.5">
                <SingleSelect
                  testId="notif-refresh-rate-num"
                  options={NUM_OPTIONS}
                  value={num}
                  onChange={(v) => v && setNum(v)}
                  allowClear={false}
                  placeholder="Select value"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="rr-unit">Unit</Label>
              <div className="mt-1.5">
                <SingleSelect
                  testId="notif-refresh-rate-unit"
                  options={UNIT_OPTIONS}
                  value={unit}
                  onChange={(v) => v && setUnit(v)}
                  allowClear={false}
                  placeholder="Select unit"
                />
              </div>
            </div>
          </div>

          <div className="text-[12px] text-gray-600 bg-[#fff7ec]/60 border border-[#ec9324]/20 rounded-md px-3 py-2">
            The bell will refresh every{" "}
            <span className="font-semibold text-gray-900">
              {num} {UNIT_OPTIONS.find((u) => u.value === unit)?.label.toLowerCase()}
            </span>.
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex justify-end gap-2 bg-gray-50/50">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={saving}
            data-testid="notif-refresh-rate-cancel"
          >
            <Close sx={{ fontSize: 14 }} className="mr-1.5" /> Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white"
            data-testid="notif-refresh-rate-save"
          >
            {saving ? <Loader2 sx={{ fontSize: 14 }} className="mr-1.5 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
