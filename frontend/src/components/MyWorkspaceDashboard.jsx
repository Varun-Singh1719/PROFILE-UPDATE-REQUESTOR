/**
 * MyWorkspaceDashboard — Personal dashboard rendered inside the Workspace
 * Manager tab of the admin dashboard. Fully data-driven; consumes:
 *   • GET /api/my-workspace/dashboard   (My seat + upcoming meetings + team + activity)
 *   • GET /api/my-workspace/week?start= (This week strip data — with prev/next paging)
 *   • GET /api/my-workspace/floor?date= (Popup floor plan)
 *
 * Design spec (Jul 2026):
 *   - Cards on a light bg, orange accent (#ec9324).
 *   - Quick actions use lucide (Material-style) icons.
 *   - "This week" uses orange highlights, prev/next week arrows.
 *   - "My Seat Today" mini map opens a full-floor popup with:
 *       user seat  → red
 *       team seats → team colour
 *       occupied   → grey
 *       available  → white
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Armchair from "@mui/icons-material/Chair";
import CalendarPlus from "@mui/icons-material/EventNoteOutlined";
import MapIcon from "@mui/icons-material/MapOutlined";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import Clock from "@mui/icons-material/AccessTime";
import Users from "@mui/icons-material/PeopleOutlined";
import CheckCircle2 from "@mui/icons-material/CheckCircleOutlined";
import RefreshCw from "@mui/icons-material/Refresh";
import Info from "@mui/icons-material/InfoOutlined";
import BadgeCheck from "@mui/icons-material/VerifiedOutlined";
import api from "../lib/api";
import UserAvatar from "./UserAvatar";
import { useAuth } from "../context/AuthContext";
import MySeatMiniMap from "./MySeatMiniMap";
import MySeatFloorDialog from "./MySeatFloorDialog";
import MyTeamToday from "./MyTeamToday";
import EventSeatRoundedIcon from "./icons/EventSeatRoundedIcon";
import { teamSolid } from "../lib/teamColors";

// -------------------------------------------------------------- Date helpers
function toISO(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function shortWeekday(dateISO) {
  return new Date(dateISO + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" });
}
function shortDay(dateISO) {
  return new Date(dateISO + "T00:00:00").getDate();
}
function longDate(dateISO) {
  return new Date(dateISO + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });
}
function fmtTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}
function relativeTimeUntil(iso) {
  if (!iso) return "";
  try {
    const target = new Date(iso).getTime();
    const now = Date.now();
    const diffMs = target - now;
    if (diffMs < -30 * 60 * 1000) return "";
    if (diffMs < 60 * 60 * 1000 && diffMs > -30 * 60 * 1000) return "Now";
    const hours = Math.round(diffMs / (60 * 60 * 1000));
    if (hours < 24) return `in ${hours}h`;
    const days = Math.round(hours / 24);
    if (days === 1) return "Tomorrow";
    return `in ${days}d`;
  } catch { return ""; }
}
function relativeAgo(iso) {
  if (!iso) return "";
  try {
    const t = new Date(iso).getTime();
    const diff = (Date.now() - t) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)} hr ago`;
    return `${Math.round(diff / 86400)}d ago`;
  } catch { return ""; }
}

// -------------------------------------------------------------- Main component
/**
 * MyWorkspaceDashboard
 *
 * Props:
 *   showTeamSection (boolean, default = false)
 *     — When TRUE, renders the "My Team Today" section (populated from the
 *       user's team mapping, whether the user is a member or manager).
 *     — When FALSE, hides the team section entirely (Individual view).
 *
 *   The prop is driven by the caller (AdminDashboard.jsx) based on the
 *   assigned Permission Set — NOT by any team-role check on the user record.
 */
export default function MyWorkspaceDashboard({ showTeamSection = false } = {}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const today = toISO(new Date());

  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState(today);
  const [weekData, setWeekData] = useState(null);
  const [weekLoading, setWeekLoading] = useState(false);
  const [floorOpen, setFloorOpen] = useState(false);
  const [floorData, setFloorData] = useState(null);
  const [floorLoading, setFloorLoading] = useState(false);

  // Load main dashboard payload
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/my-workspace/dashboard", { params: { date: today } });
      setDashboard(data);
    } catch {
      setDashboard({ my_seat: null, upcoming_meetings: [], team_on_floor: [], recent_activity: [] });
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => { load(); }, [load]);

  // Load week payload whenever the anchor date changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setWeekLoading(true);
      try {
        const { data } = await api.get("/my-workspace/week", { params: { start: weekStart } });
        if (!cancelled) setWeekData(data);
      } catch {
        if (!cancelled) setWeekData({ week_start: weekStart, days: [] });
      } finally {
        if (!cancelled) setWeekLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [weekStart]);

  const openFloor = useCallback(async () => {
    setFloorOpen(true);
    if (floorData) return;
    setFloorLoading(true);
    try {
      const { data } = await api.get("/my-workspace/floor", { params: { date: today } });
      setFloorData(data);
    } catch {
      setFloorData(null);
    } finally {
      setFloorLoading(false);
    }
  }, [today, floorData]);

  const mySeat = dashboard?.my_seat;
  const isCheckedIn = !!mySeat && mySeat.status === "assigned";

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-12 pt-2 pb-4 space-y-4" data-testid="my-workspace-dashboard">
      {/* Greeting */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" data-testid="my-workspace-greeting">
            Hi {(user?.name || "").split(" ")[0] || "there"} 👋
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{longDate(today)}</p>
        </div>
        <div className="flex items-center gap-2">
          {isCheckedIn && (
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200"
              data-testid="my-workspace-checked-in-pill"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Seat allotted · {mySeat.seat_label}
            </div>
          )}
          <button
            type="button"
            onClick={load}
            className="h-9 w-9 rounded-md border border-gray-200 bg-white text-gray-500 hover:text-[#ec9324] hover:border-[#ec9324] inline-flex items-center justify-center"
            title="Refresh"
            data-testid="my-workspace-refresh"
          >
            <RefreshCw sx={{ fontSize: 14 }} className={loading ? "animate-spin" : ""}/>
          </button>
        </div>
      </div>

      {/* Row 1 — My Seat Today (hero) + This Week */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* My Seat Today */}
        <div className="xl:col-span-2 rounded-2xl border border-gray-200 bg-gradient-to-br from-orange-50 via-white to-white p-5 shadow-sm"
             data-testid="my-seat-today-card">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-widest text-[#ec9324] font-bold">My seat today</div>
              {mySeat ? (
                <>
                  <div className="mt-2 flex items-end gap-3 flex-wrap">
                    <div className="text-4xl sm:text-5xl font-black text-gray-900" data-testid="my-seat-label">
                      {mySeat.seat_label || "—"}
                    </div>
                    <div className="pb-1">
                      <div className="text-sm font-semibold text-gray-800">
                        {mySeat.plan_name || "Floor plan"}
                      </div>
                      <div className="text-xs text-gray-500 flex items-center gap-1.5 flex-wrap">
                        {mySeat.team_name && (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ background: mySeat.team_color || teamSolid(mySeat.team_name) }} />
                            {mySeat.team_name}
                          </span>
                        )}
                        {mySeat.status === "requested" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                            Pending approval
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={openFloor}
                      className="inline-flex items-center gap-1.5 bg-[#ec9324] hover:bg-[#d4811f] text-white text-xs font-semibold px-3.5 py-2 rounded-md shadow-sm"
                      data-testid="my-seat-view-floor-btn"
                    >
                      <MapIcon sx={{ fontSize: 13 }}/> View floor plan
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate("/workspace-manager/workstation-booking")}
                      className="inline-flex items-center gap-1.5 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold px-3.5 py-2 rounded-md"
                    >
                      Book for tomorrow
                    </button>
                    {mySeat.booking_id && (
                      <button
                        type="button"
                        onClick={() => navigate("/workspace-manager/floor-layout")}
                        className="inline-flex items-center gap-1.5 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold px-3.5 py-2 rounded-md"
                      >
                        My bookings
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="mt-3">
                  <div className="text-lg font-bold text-gray-800">No seat allotted today</div>
                  <p className="text-xs text-gray-500 mt-1 max-w-md">
                    You don't have a workstation booked for today. Book one now or request one from the manager.
                  </p>
                  <div className="mt-4 flex gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => navigate("/workspace-manager/workstation-booking")}
                      className="inline-flex items-center gap-1.5 bg-[#ec9324] hover:bg-[#d4811f] text-white text-xs font-semibold px-3.5 py-2 rounded-md shadow-sm"
                    >
                      <Armchair sx={{ fontSize: 13 }}/> Book a desk
                    </button>
                    <button
                      type="button"
                      onClick={openFloor}
                      className="inline-flex items-center gap-1.5 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold px-3.5 py-2 rounded-md"
                    >
                      <MapIcon sx={{ fontSize: 13 }}/> View floor plan
                    </button>
                  </div>
                </div>
              )}
            </div>
            {/* Mini map thumbnail */}
            <div className="flex-shrink-0">
              <MySeatMiniMap
                mySeat={mySeat}
                allSeats={floorData?.seats || []}
                onClick={openFloor}
              />
            </div>
          </div>
        </div>

        {/* This Week strip */}
        <ThisWeekCard
          weekData={weekData}
          weekLoading={weekLoading}
          onPrev={() => setWeekStart(toISO(new Date(new Date(weekStart).getTime() - 7 * 86400000)))}
          onNext={() => setWeekStart(toISO(new Date(new Date(weekStart).getTime() + 7 * 86400000)))}
          onToday={() => setWeekStart(today)}
          today={today}
        />
      </div>

      {/* Row 2 — Upcoming Meetings + Quick Actions + Team on Floor */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <UpcomingMeetingsCard meetings={dashboard?.upcoming_meetings || []} loading={loading} />

        <QuickActionsCard navigate={navigate} openFloor={openFloor} />

        <TeamOnFloorCard team={dashboard?.team_on_floor || []} navigate={navigate} />
      </div>

      {/* Row 2.5 — "My Team Today" (renders only when the caller sets
          showTeamSection=true — driven by Dashboard permission = Manager). */}
      {showTeamSection && (
        <MyTeamToday
          team={dashboard?.my_team_today || []}
          managedTeams={dashboard?.managed_teams || []}
        />
      )}

      {/* Row 3 — Recent activity */}
      <RecentActivityCard activity={dashboard?.recent_activity || []} loading={loading} />

      {/* Popup: full floor plan */}
      <MySeatFloorDialog
        open={floorOpen}
        onClose={() => setFloorOpen(false)}
        floorData={floorLoading ? null : floorData}
        dateLabel={longDate(today)}
      />
    </div>
  );
}

// ============================================================ ThisWeekCard
function ThisWeekCard({ weekData, weekLoading, onPrev, onNext, onToday, today }) {
  const days = weekData?.days || [];
  const weekStartLabel = useMemo(() => {
    if (!weekData?.week_start) return "";
    const start = new Date(weekData.week_start + "T00:00:00");
    const end = new Date(start.getTime() + 6 * 86400000);
    const sameMonth = start.getMonth() === end.getMonth();
    const fmtStart = start.toLocaleDateString(undefined, { day: "2-digit", month: sameMonth ? undefined : "short" });
    const fmtEnd = end.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
    return `${fmtStart} – ${fmtEnd}`;
  }, [weekData]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm flex flex-col"
         data-testid="my-workspace-week-card">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">This week</div>
          <div className="text-xs text-gray-500 mt-0.5">{weekStartLabel}</div>
        </div>
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={onPrev}
            className="h-8 w-8 rounded-md border border-gray-200 bg-white text-gray-600 hover:text-[#ec9324] hover:border-[#ec9324] inline-flex items-center justify-center relative group"
            data-testid="my-workspace-week-prev"
            title="Previous Week"
            aria-label="Previous Week"
          >
            <ChevronLeft sx={{ fontSize: 15 }}/>
            <span className="pointer-events-none absolute top-full right-0 mt-1 px-1.5 py-0.5 rounded bg-gray-800 text-white text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
              Previous Week
            </span>
          </button>
          <button
            type="button"
            onClick={onToday}
            className="h-8 px-2 rounded-md border border-gray-200 bg-white text-gray-600 hover:text-[#ec9324] hover:border-[#ec9324] text-[11px] font-semibold"
            data-testid="my-workspace-week-today"
            title="Jump to current week"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onNext}
            className="h-8 w-8 rounded-md border border-gray-200 bg-white text-gray-600 hover:text-[#ec9324] hover:border-[#ec9324] inline-flex items-center justify-center relative group"
            data-testid="my-workspace-week-next"
            title="Next Week"
            aria-label="Next Week"
          >
            <ChevronRight sx={{ fontSize: 15 }}/>
            <span className="pointer-events-none absolute top-full right-0 mt-1 px-1.5 py-0.5 rounded bg-gray-800 text-white text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
              Next Week
            </span>
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1.5" data-testid="my-workspace-week-strip">
        {(days.length ? days : Array.from({ length: 7 })).map((d, i) => {
          const isToday = d?.date === today;
          const status = d?.status || "none";
          // color rule per spec:
          //   assigned / requested → orange (assigned=solid, requested=dashed)
          //   none → white
          let cls = "bg-white border border-gray-200 text-gray-500";
          if (status === "assigned") cls = "bg-[#ec9324] border-[#ec9324] text-white shadow-sm";
          else if (status === "requested") cls = "bg-orange-50 border-2 border-dashed border-[#ec9324] text-[#ec9324]";
          return (
            <div
              key={d?.date || i}
              className={`flex flex-col items-center justify-center rounded-lg h-16 relative ${cls} ${isToday ? "ring-2 ring-[#ec9324]/40 ring-offset-2 ring-offset-white" : ""}`}
              data-testid={`week-day-${i}`}
              title={d ? `${shortWeekday(d.date)} ${d.date}${status !== "none" && d.seat_label ? " · " + d.seat_label : ""}${status !== "none" ? " · " + (status === "assigned" ? "Assigned" : "Requested") : ""}` : undefined}
            >
              <div className={`text-[10px] font-semibold uppercase tracking-wide ${status === "assigned" ? "text-white/90" : status === "requested" ? "text-[#ec9324]" : "text-gray-400"}`}>
                {d ? shortWeekday(d.date).slice(0, 3) : "—"}
              </div>
              <div className={`text-lg font-bold ${status === "assigned" ? "text-white" : status === "requested" ? "text-[#ec9324]" : "text-gray-700"}`}>
                {d ? shortDay(d.date) : ""}
              </div>
              {d && status !== "none" && d.seat_label && (
                <div className={`text-[9px] font-bold ${status === "assigned" ? "text-white/95" : "text-[#ec9324]"} leading-none`}>
                  {d.seat_label}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3 text-[10px] text-gray-500">
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#ec9324]" /> Assigned</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border-2 border-dashed border-[#ec9324] bg-orange-50" /> Requested</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-gray-300 bg-white" /> None</span>
      </div>

      {weekLoading && (
        <div className="mt-2 text-[11px] text-gray-400 inline-flex items-center gap-1"><RefreshCw sx={{ fontSize: 11 }} className="animate-spin"/> Updating…</div>
      )}
    </div>
  );
}

// ============================================================ UpcomingMeetingsCard
function UpcomingMeetingsCard({ meetings, loading }) {
  return (
    <div className="xl:col-span-5 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden"
         data-testid="my-workspace-meetings-card">
      <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-gray-100">
        <div className="inline-flex items-center gap-2">
          <CalendarPlus sx={{ fontSize: 16 }} className="text-emerald-600"/>
          <h3 className="font-semibold text-gray-900">Upcoming Meetings</h3>
        </div>
        <span className="text-[11px] font-medium text-gray-500">{meetings.length}</span>
      </div>
      <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
        {loading ? (
          <div className="px-5 py-8 text-center text-xs text-gray-400">Loading…</div>
        ) : meetings.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-gray-400">No upcoming meetings.</div>
        ) : meetings.map((m) => {
          const rel = relativeTimeUntil(m.start_at);
          return (
            <div key={m.id} className="px-5 py-3 flex items-start gap-3" data-testid={`my-meeting-${m.id}`}>
              <div className="text-center flex-shrink-0 w-14">
                <div className="text-[10px] font-bold text-gray-400 uppercase">{rel || fmtTime(m.start_at).slice(0, 5)}</div>
                <div className="text-sm font-bold text-gray-900">{fmtTime(m.start_at)}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-semibold text-sm text-gray-900 truncate">{m.title}</div>
                  {m.room_name && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100 flex-shrink-0">
                      {m.room_name}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-gray-500">
                  {fmtTime(m.start_at)} – {fmtTime(m.end_at)}
                  {m.organizer?.name && ` · ${m.organizer.name}`}
                  {m.attendees?.length ? ` · ${m.attendees.length} attendee${m.attendees.length > 1 ? "s" : ""}` : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => (window.location.href = "/workspace-manager/meeting-room-booking")}
        className="w-full text-center py-2.5 text-xs font-semibold text-[#ec9324] hover:bg-orange-50 border-t border-gray-100"
        data-testid="my-workspace-book-meeting"
      >
        + Book a meeting room
      </button>
    </div>
  );
}

// ============================================================ QuickActionsCard
function QuickActionsCard({ navigate, openFloor }) {
  const items = [
    { key: "room",   label: "Book meeting room", sub: "check availability",       Icon: CalendarPlus,        onClick: () => navigate("/workspace-manager/meeting-room-booking") },
    { key: "req",    label: "Request workstation", sub: "needs manager approval", Icon: EventSeatRoundedIcon, onClick: () => navigate("/workspace-manager/request-workstation") },
    { key: "floor",  label: "View floor plan",   sub: "who's on site today",      Icon: MapIcon,             onClick: openFloor },
  ];
  return (
    <div className="xl:col-span-4 rounded-2xl border border-gray-200 bg-white shadow-sm p-5"
         data-testid="my-workspace-quick-actions-card">
      <h3 className="font-semibold text-gray-900">Quick actions</h3>
      <p className="text-xs text-gray-500 mt-0.5">Everything you need in one tap.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        {items.map(({ key, label, sub, Icon, onClick }) => (
          <button
            key={key}
            type="button"
            onClick={onClick}
            className="group border border-gray-200 rounded-lg p-3 text-left hover:border-[#ec9324] hover:bg-orange-50/60 transition-colors"
            data-testid={`quick-action-${key}`}
          >
            <div className="h-9 w-9 rounded-md bg-gray-50 group-hover:bg-white border border-gray-200 group-hover:border-[#ec9324]/40 inline-flex items-center justify-center text-gray-700 group-hover:text-[#ec9324] transition-colors">
              <Icon size={18} strokeWidth={1.75} />
            </div>
            <div className="font-semibold text-sm text-gray-900 mt-2">{label}</div>
            <div className="text-[11px] text-gray-500">{sub}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================ TeamOnFloorCard
function TeamOnFloorCard({ team, navigate }) {
  return (
    <div className="xl:col-span-3 rounded-2xl border border-gray-200 bg-white shadow-sm p-5"
         data-testid="my-workspace-team-card">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 inline-flex items-center gap-1.5">
          <Users sx={{ fontSize: 15 }} className="text-[#ec9324]"/> Team on floor
        </h3>
        {team.length > 0 && (
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
            {team.length}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-0.5">Colleagues checked in today</p>
      <div className="mt-4 flex flex-wrap gap-2 min-h-[36px]">
        {team.length === 0 && (
          <div className="text-xs text-gray-400">No one else on the floor yet.</div>
        )}
        {team.slice(0, 12).map((m) => (
          <div key={m.id} title={`${m.name || "Colleague"}${m.seat_label ? " · " + m.seat_label : ""}${m.team_name ? " · " + m.team_name : ""}`}>
            <UserAvatar user={m} size={32} showStatusDot={false} />
          </div>
        ))}
        {team.length > 12 && (
          <div className="h-8 w-8 rounded-full bg-gray-50 border border-dashed border-gray-300 flex items-center justify-center text-[10px] font-bold text-gray-500">
            +{team.length - 12}
          </div>
        )}
      </div>
      {team.length > 0 && (
        <button
          type="button"
          onClick={() => navigate("/workspace-manager/floor-layout")}
          className="mt-4 w-full border border-gray-200 rounded-md py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          data-testid="my-workspace-see-floor-map"
        >
          See on floor map
        </button>
      )}
    </div>
  );
}

// ============================================================ RecentActivityCard
function RecentActivityCard({ activity, loading }) {
  const icon = (action) => {
    const a = (action || "").toLowerCase();
    if (a.includes("cancel") || a.includes("delete")) return { Icon: Info, cls: "bg-red-50 text-red-600" };
    if (a.includes("approve")) return { Icon: BadgeCheck, cls: "bg-emerald-50 text-emerald-700" };
    if (a.includes("update") || a.includes("edit")) return { Icon: RefreshCw, cls: "bg-orange-50 text-[#ec9324]" };
    if (a.includes("create") || a.includes("book")) return { Icon: CheckCircle2, cls: "bg-blue-50 text-blue-700" };
    return { Icon: Clock, cls: "bg-gray-50 text-gray-600" };
  };
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5"
         data-testid="my-workspace-activity-card">
      <h3 className="font-semibold text-gray-900">Recent activity</h3>
      <div className="mt-3 divide-y divide-gray-100">
        {loading ? (
          <div className="py-4 text-center text-xs text-gray-400">Loading…</div>
        ) : activity.length === 0 ? (
          <div className="py-4 text-center text-xs text-gray-400">No recent activity.</div>
        ) : activity.map((a, i) => {
          const { Icon, cls } = icon(a.action);
          return (
            <div key={i} className="py-2.5 flex items-center gap-3 text-sm" data-testid={`activity-${i}`}>
              <span className={`h-7 w-7 rounded-full inline-flex items-center justify-center ${cls}`}>
                <Icon size={13} />
              </span>
              <span className="text-gray-800 flex-1 min-w-0 truncate">{a.detail || a.action}</span>
              <span className="text-[11px] text-gray-400 flex-shrink-0">{relativeAgo(a.created_at)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
