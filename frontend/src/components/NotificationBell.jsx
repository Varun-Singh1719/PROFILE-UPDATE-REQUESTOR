import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import NotificationsIcon from "@mui/icons-material/NotificationsNone";
import CheckCircle from "@mui/icons-material/CheckCircleOutlined";
import EventAvailable from "@mui/icons-material/EventAvailableOutlined";
import Chair from "@mui/icons-material/Chair";
import Cancel from "@mui/icons-material/CancelOutlined";
import Bolt from "@mui/icons-material/BoltOutlined";
import Article from "@mui/icons-material/DescriptionOutlined";
import DoneAll from "@mui/icons-material/DoneAll";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./ui/popover";
import { numericId } from "../lib/ticketId";

/**
 * Auto-refresh cadence for the bell (unread count + open list).
 * Default is 10 minutes but the actual interval is fetched from
 * `/api/notifications/settings` on mount and re-used until the page
 * reloads. See `NotificationTemplatesPage → RefreshRateModal` for how
 * Super Admin edits this value.
 */
export const NOTIFICATION_POLL_MS = 10 * 60 * 1000; // 10 minutes — fallback

/**
 * Kind → { icon component, colour } used for the small circular icon on the
 * left of each notification row. New kinds should be added here; unknown
 * kinds fall back to the neutral Article icon.
 */
const KIND_META = {
  workstation_request_submitted: { Icon: Bolt,          color: "#ec9324", bg: "#fff7ed" },
  workstation_request_approved: { Icon: CheckCircle,   color: "#16a34a", bg: "#f0fdf4" },
  workstation_request_declined: { Icon: Cancel,        color: "#dc2626", bg: "#fef2f2" },
  workstation_assigned:         { Icon: Chair,         color: "#ec9324", bg: "#fff7ed" },
  meeting_room_request_submitted: { Icon: Bolt,        color: "#ec9324", bg: "#fff7ed" },
  meeting_room_request_approved:  { Icon: CheckCircle, color: "#16a34a", bg: "#f0fdf4" },
  meeting_room_request_declined:  { Icon: Cancel,      color: "#dc2626", bg: "#fef2f2" },
  request_closed:               { Icon: EventAvailable,color: "#0284c7", bg: "#f0f9ff" },
};

const TABS = [
  { key: "unread", label: "Unread" },
  { key: "read",   label: "Read"   },
  { key: "all",    label: "All"    },
];

function relativeTime(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const now = Date.now();
  const diff = Math.max(0, now - then) / 1000;
  if (diff < 45) return "just now";
  if (diff < 90) return "a minute ago";
  const m = Math.round(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { timeZone: "Asia/Kolkata" });
}

/**
 * Nicely format an ISO date-string (or a raw YYYY-MM-DD) as e.g.
 * "20 Jul 2026". Returns the original string when parsing fails so we never
 * hide the value from the user.
 */
function formatDate(s) {
  if (!s) return "";
  const t = Date.parse(s);
  if (Number.isNaN(t)) return String(s);
  return new Date(t).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

/**
 * Format an ISO datetime as e.g. "20 Aug 2026, 10:00 AM". If the input has
 * no time component we return the same output as {@link formatDate}.
 */
function formatDateTime(s) {
  if (!s) return "";
  const t = Date.parse(s);
  if (Number.isNaN(t)) return String(s);
  const hasTime = /T\d/.test(String(s));
  if (!hasTime) return formatDate(s);
  const d = new Date(t);
  const datePart = d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
  return `${datePart}, ${timePart}`;
}

/**
 * Parse a notification into the structured "Key : Value" format the user
 * asked for. Regex-based extraction from the existing prose bodies (kept
 * backward-compatible with legacy rows). Falls back to `{title, body}` when
 * no parser matches so a new kind never looks blank.
 *
 * Output: { title, rows: [{ label, value }], done }
 *   `done` = true when we managed to structure the row; used only for
 *   debugging / analytics if ever needed.
 */
function formatNotification(n) {
  const kind = n.kind;
  const body = n.body || "";
  const dateStr = formatDate(n.created_at);

  // request_closed
  //   title: "Request TCK-00512 closed"
  //   body : "Your request TCK-00512 was closed by <name>."
  if (kind === "request_closed") {
    const idMatch  = body.match(/request\s+([A-Za-z0-9-]+)/i) || (n.title || "").match(/Request\s+([A-Za-z0-9-]+)/i);
    const byMatch  = body.match(/closed\s+by\s+([^.]+?)\.?\s*$/i);
    // Only render the numeric portion — matches the "All Requests" table.
    const ticketIdRaw = idMatch ? idMatch[1] : null;
    const ticketId    = ticketIdRaw ? numericId(ticketIdRaw) : null;
    const closedBy = byMatch ? byMatch[1].trim() : null;
    return {
      title: `Request ${ticketId || "—"} : Closed`,
      rows: [
        { label: "Ticket ID", value: ticketId || "—" },
        { label: "Status",    value: "Closed" },
        { label: "Closed By", value: closedBy || "—" },
        { label: "Date",      value: dateStr },
      ],
      done: !!(ticketId || closedBy),
    };
  }

  // workstation_assigned
  //   title: "You've been assigned a workstation"
  //   body : "You have been assigned <seat> on <date> by <name>."
  if (kind === "workstation_assigned") {
    const m = body.match(/assigned\s+([A-Za-z0-9-]+)\s+on\s+([\d-]+)\s+by\s+([^.]+?)\.?\s*$/i);
    const seat   = m ? m[1] : null;
    const on     = m ? m[2] : null;
    const byName = m ? m[3].trim() : null;
    return {
      title: `${seat || "Workstation"} : Assigned`,
      rows: [
        { label: "Seat",        value: seat  || "—" },
        { label: "Date",        value: formatDate(on) || dateStr },
        { label: "Assigned By", value: byName || "—" },
      ],
      done: !!m,
    };
  }

  // workstation_request_approved / declined
  //   title: "Workstation request approved" | "Workstation request declined"
  //   body : "Your workstation request for <seat> on <date> was approved|declined by <name>."
  if (kind === "workstation_request_approved" || kind === "workstation_request_declined") {
    const verb = kind === "workstation_request_approved" ? "Approved" : "Declined";
    const decidedLabel = kind === "workstation_request_approved" ? "Approved By" : "Declined By";
    const m = body.match(/for\s+([A-Za-z0-9-]+)\s+on\s+([\d-]+)\s+was\s+(?:approved|declined)\s+by\s+([^.]+?)\.?\s*$/i);
    const seat   = m ? m[1] : null;
    const on     = m ? m[2] : null;
    const byName = m ? m[3].trim() : null;
    return {
      title: `${seat || "Request"} : ${verb}`,
      rows: [
        { label: "Seat",        value: seat  || "—" },
        { label: "Date",        value: formatDate(on) || dateStr },
        { label: decidedLabel,  value: byName || "—" },
      ],
      done: !!m,
    };
  }

  // workstation_request_submitted
  //   title: "Pending Approval — Workstation Requested"
  //   body : "<requester> submitted a workstation request for <employee> — seat <seat> on <date>. It is awaiting your approval."
  if (kind === "workstation_request_submitted") {
    const m = body.match(/^(.+?)\s+submitted\s+a\s+workstation\s+request\s+for\s+(.+?)\s+[—-]\s+seat\s+(\S+)\s+on\s+([\d-]+)\.?/i);
    const requester = m ? m[1].trim() : null;
    const employee  = m ? m[2].trim() : null;
    const seat      = m ? m[3] : null;
    const on        = m ? m[4] : null;
    return {
      title: `${seat || "Workstation"} : Pending Approval`,
      rows: [
        { label: "Requested By", value: requester || "—" },
        { label: "Employee",     value: employee  || "—" },
        { label: "Seat",         value: seat      || "—" },
        { label: "Date",         value: formatDate(on) || dateStr },
      ],
      done: !!m,
    };
  }

  // meeting_room_request_submitted
  //   title: "Pending Approval — Meeting Room Requested"
  //   body : "<requester> submitted a meeting room request \"<title>\" for <room> on <start_at>. It is awaiting your approval."
  if (kind === "meeting_room_request_submitted") {
    const m = body.match(/^(.+?)\s+submitted\s+a\s+meeting\s+room\s+request\s+"([^"]*)"\s+for\s+(.+?)\s+on\s+(\S+?)\.?\s+It\s+is/i);
    const requester = m ? m[1].trim() : null;
    const title     = m ? m[2].trim() : null;
    const room      = m ? m[3].trim() : null;
    const startAt   = m ? m[4] : null;
    return {
      title: `${room || "Meeting Room"} : Pending Approval`,
      rows: [
        { label: "Requested By", value: requester || "—" },
        { label: "Meeting",      value: title     || "—" },
        { label: "Room",         value: room      || "—" },
        { label: "Starts",       value: formatDateTime(startAt) || dateStr },
      ],
      done: !!m,
    };
  }

  // meeting_room_request_approved / declined
  //   title: "Meeting room request approved" | "Meeting room request declined"
  //   body : "Your meeting room request \"<title>\" for <room> on <start_at> was approved|declined by <name>."
  if (kind === "meeting_room_request_approved" || kind === "meeting_room_request_declined") {
    const verb = kind === "meeting_room_request_approved" ? "Approved" : "Declined";
    const decidedLabel = kind === "meeting_room_request_approved" ? "Approved By" : "Declined By";
    const m = body.match(/meeting\s+room\s+request\s+"([^"]*)"\s+for\s+(.+?)\s+on\s+(\S+?)\s+was\s+(?:approved|declined)\s+by\s+([^.]+?)\.?\s*$/i);
    const title    = m ? m[1].trim() : null;
    const room     = m ? m[2].trim() : null;
    const startAt  = m ? m[3] : null;
    const byName   = m ? m[4].trim() : null;
    return {
      title: `${room || "Meeting Room"} : ${verb}`,
      rows: [
        { label: "Meeting",      value: title    || "—" },
        { label: "Room",         value: room     || "—" },
        { label: "Starts",       value: formatDateTime(startAt) || dateStr },
        { label: decidedLabel,   value: byName   || "—" },
      ],
      done: !!m,
    };
  }

  // Fallback for unknown kinds — keep title/body prose so we never render
  // a blank row when the schema evolves ahead of the bell.
  return {
    title: n.title || "Notification",
    rows: body ? [{ label: null, value: body }] : [],
    done: false,
  };
}

/**
 * <NotificationBell/> — bell icon + badge that renders in the top-bar next
 * to the user avatar. Opens a 3-tab (Unread / Read / All) popover listing
 * the current user's notifications. Auto-refreshes every 10 minutes and
 * also on tab-focus / popover open so counts stay accurate.
 */
export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("unread");
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pollMs, setPollMs] = useState(NOTIFICATION_POLL_MS);
  const pollRef = useRef(null);

  const fetchUnreadCount = useCallback(async () => {
    try {
      // silent:true → do NOT trigger the global BusyOverlay. This is a
      // background poll scoped to the bell — the underlying page must stay
      // untouched (no flicker, no loading spinner over the content).
      const r = await api.get("/notifications/inapp/unread-count", { silent: true });
      setUnread(r.data?.count || 0);
    } catch {
      // Fail silently — the bell shouldn't crash the top-bar
    }
  }, []);

  const fetchList = useCallback(
    async (which = tab) => {
      setLoading(true);
      try {
        // silent:true → same reason as above. Tab clicks (Read/Unread/All)
        // must NEVER visually affect the underlying page.
        const r = await api.get("/notifications/inapp", {
          params: { status: which, limit: 50 },
          silent: true,
        });
        setItems(r.data || []);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [tab],
  );

  // Initial poll + set up auto-refresh at the configured cadence
  useEffect(() => {
    // Fetch the configured poll interval once on mount. Failures fall back
    // to the exported default (10 min).
    (async () => {
      try {
        // silent:true → don't flash the page overlay just to read a config.
        const r = await api.get("/notifications/settings", { silent: true });
        const ms = r?.data?.poll_interval_ms;
        if (typeof ms === "number" && ms >= 1000) setPollMs(ms);
      } catch {
        /* keep default */
      }
    })();
    fetchUnreadCount();
    // Also refresh whenever the tab becomes visible again (long-idle users)
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchUnreadCount();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchUnreadCount]);

  // (Re-)schedule the poll timer whenever the interval changes
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(fetchUnreadCount, pollMs);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pollMs, fetchUnreadCount]);

  // When popover opens OR tab changes → refetch the list for that tab
  useEffect(() => {
    if (open) fetchList(tab);
  }, [open, tab, fetchList]);

  const markAsRead = useCallback(
    async (n) => {
      if (n.read) return;
      // Optimistic UI: flip locally so the row moves out of Unread instantly
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((c) => Math.max(0, c - 1));
      try {
        // silent:true → do NOT trigger the full-page MutationBlocker.
        // Marking-as-read is an implicit side-effect scoped to the bell.
        await api.post(`/notifications/inapp/${n.id}/read`, null, { silent: true });
      } catch {
        // Roll back on failure
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: false } : x)));
        setUnread((c) => c + 1);
      }
    },
    [],
  );

  const markAllRead = useCallback(async () => {
    if (!unread) return;
    setUnread(0);
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    try {
      // silent:true → same reason as markAsRead.
      await api.post("/notifications/inapp/read-all", null, { silent: true });
      // Reload the current tab so the Unread list empties out
      fetchList(tab);
    } catch {
      fetchUnreadCount();
    }
  }, [unread, fetchList, tab, fetchUnreadCount]);

  const onRowClick = useCallback(
    async (n) => {
      await markAsRead(n);
      if (n.action_url) {
        setOpen(false);
        navigate(n.action_url);
      }
    },
    [markAsRead, navigate],
  );

  const badge = useMemo(() => {
    if (!unread) return null;
    return (
      <span
        className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 ring-2 ring-white"
        data-testid="notif-bell-badge"
      >
        {unread > 99 ? "99+" : unread}
      </span>
    );
  }, [unread]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="notif-bell-trigger"
          aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
          title={unread ? `Notifications (${unread} unread)` : "Notifications"}
          className="group relative inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-gray-100 text-gray-600"
        >
          <NotificationsIcon sx={{ fontSize: 22 }} />
          {badge}
          <span className="pointer-events-none absolute top-full mt-1.5 right-0 px-2 py-1 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
            {unread ? `Notifications (${unread} unread)` : "Notifications"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[380px] p-0 overflow-hidden"
        data-testid="notif-bell-popover"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="text-sm font-semibold text-gray-900">Notifications</div>
          <button
            type="button"
            onClick={markAllRead}
            disabled={!unread}
            data-testid="notif-mark-all-read"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#ec9324] hover:text-[#d4811f] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <DoneAll sx={{ fontSize: 14 }} /> Mark all read
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100" data-testid="notif-tabs">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                data-testid={`notif-tab-${t.key}`}
                className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                  active
                    ? "text-[#ec9324] border-b-2 border-[#ec9324] bg-[#fff7ed]/50"
                    : "text-gray-500 hover:text-gray-700 border-b-2 border-transparent"
                }`}
              >
                {t.label}
                {t.key === "unread" && unread > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] px-1">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* List */}
        <div className="max-h-[420px] overflow-y-auto" data-testid="notif-list">
          {loading && items.length === 0 && (
            <div className="p-8 text-center text-xs text-gray-400">Loading…</div>
          )}
          {!loading && items.length === 0 && (
            <div className="p-8 text-center text-xs text-gray-400">
              {tab === "unread" ? "You're all caught up 🎉" : "No notifications yet"}
            </div>
          )}
          {items.map((n) => {
            const meta = KIND_META[n.kind] || {
              Icon: Article,
              color: "#6b7280",
              bg: "#f3f4f6",
            };
            const { Icon } = meta;
            const clickable = !!n.action_url;
            const view = formatNotification(n);
            return (
              <div
                key={n.id}
                onClick={() => onRowClick(n)}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={(e) => {
                  if (clickable && (e.key === "Enter" || e.key === " ")) onRowClick(n);
                }}
                data-testid={`notif-row-${n.id}`}
                data-read={n.read ? "true" : "false"}
                className={`flex items-start gap-3 px-4 py-3 border-b border-gray-50 cursor-pointer transition-colors ${
                  n.read ? "bg-white" : "bg-[#fff7ed]/40"
                } hover:bg-gray-50`}
              >
                <span
                  className="mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full shrink-0"
                  style={{ backgroundColor: meta.bg, color: meta.color }}
                >
                  <Icon sx={{ fontSize: 16 }} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <div className="text-[13px] font-semibold text-gray-900 truncate">
                      {view.title}
                    </div>
                    {!n.read && (
                      <span className="mt-1 w-2 h-2 rounded-full bg-[#ec9324] shrink-0" />
                    )}
                  </div>
                  {view.rows.length > 0 && (
                    <div className="mt-0.5 space-y-0.5">
                      {view.rows.map((r, i) =>
                        r.label ? (
                          <div key={i} className="text-[12px] text-gray-700 leading-snug">
                            <span className="text-gray-500">{r.label}&nbsp;:</span>&nbsp;
                            <span className="font-medium">{r.value}</span>
                          </div>
                        ) : (
                          <div
                            key={i}
                            className="text-[12px] text-gray-600 leading-snug line-clamp-2"
                          >
                            {r.value}
                          </div>
                        ),
                      )}
                    </div>
                  )}
                  <div className="text-[10px] text-gray-400 mt-1">
                    {relativeTime(n.created_at)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
