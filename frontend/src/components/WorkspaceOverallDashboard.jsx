/**
 * WorkspaceOverallDashboard — organisation-wide dashboard for the
 * Workspace Manager tab. Rendered in place of `MyWorkspaceDashboard`
 * for users whose role has organisation-wide access (Super Admin, admin).
 *
 * Data:
 *   GET /api/my-workspace/overall-dashboard
 *   GET /api/my-workspace/week
 *
 * Section layout mirrors the existing MyWorkspaceDashboard so the visual
 * language stays the same across Individual / Team Manager / Overall.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Users from "@mui/icons-material/PeopleOutlined";
import MapIcon from "@mui/icons-material/MapOutlined";
import RefreshCw from "@mui/icons-material/Refresh";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import DoorOpen from "@mui/icons-material/MeetingRoomOutlined";
import MapPin from "@mui/icons-material/PlaceOutlined";
import Clock from "@mui/icons-material/AccessTime";
import Armchair from "@mui/icons-material/Chair";
import api from "../lib/api";
import { teamBackground, teamInitials } from "../lib/teamColors";
import { useAuth } from "../context/AuthContext";
import MySeatMiniMap from "./MySeatMiniMap";
import MySeatFloorDialog from "./MySeatFloorDialog";

const ORANGE = "#ec9324";

// ── helpers ────────────────────────────────────────────────────────────────
// Jul 2025: "today" resolves in IST so the dashboard header matches the
// timezone the backend persists booking dates in. `toISO` for other Date
// instances (e.g. week arithmetic) uses local calendar fields — arithmetic
// on JS Date is timezone-independent as long as we consistently read
// `getFullYear / getMonth / getDate` (browser-local).
function toISO(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function istTodayISO() {
  // en-CA gives "YYYY-MM-DD" natively.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function longDate(iso) {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  } catch { return iso; }
}

function isoWeekMondayFor(iso) {
  const d = new Date(iso + "T00:00:00");
  const day = (d.getDay() + 6) % 7; // 0=Mon
  d.setDate(d.getDate() - day);
  return toISO(d);
}

// ── small pieces ───────────────────────────────────────────────────────────
function ProgressBar({ value, max, tone = ORANGE, height = 6 }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className="w-full rounded-full bg-gray-100 overflow-hidden" style={{ height }}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
    </div>
  );
}

export default function WorkspaceOverallDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [today] = useState(istTodayISO());

  const [overall, setOverall] = useState(null);
  const [loading, setLoading] = useState(false);

  const [weekStart, setWeekStart] = useState(() => isoWeekMondayFor(istTodayISO()));
  const [weekData, setWeekData] = useState({ days: [], start: "" });
  const [weekLoading, setWeekLoading] = useState(false);
  // Org presence-per-day for the SELECTED week (Mon–Sun), so it stays aligned
  // with the "This week" strip above. The overall-dashboard endpoint returns
  // the 7 days ENDING on the given date, so we query the week's Sunday to get
  // exactly Mon…Sun of the displayed week.
  const [weekOrg, setWeekOrg] = useState([]);

  // Popup: full floor plan (reuse existing one)
  const [floorOpen, setFloorOpen] = useState(false);
  const [floorData, setFloorData] = useState(null);
  const [floorLoading, setFloorLoading] = useState(false);

  // Popup: "View all meeting rooms" — lists every room across live floor
  // plans (booked & unbooked) with today's usage.
  const [allRoomsOpen, setAllRoomsOpen] = useState(false);
  const [allRooms, setAllRooms] = useState(null); // { rooms, total_rooms, booked_count } or null
  const [allRoomsLoading, setAllRoomsLoading] = useState(false);
  useEffect(() => {
    if (!allRoomsOpen) return;
    let cancelled = false;
    setAllRoomsLoading(true);
    api.get(`/my-workspace/meeting-rooms-all`, { params: { date: today } })
       .then((r) => { if (!cancelled) setAllRooms(r.data || null); })
       .catch(() => { if (!cancelled) setAllRooms({ rooms: [], total_rooms: 0, booked_count: 0 }); })
       .finally(() => { if (!cancelled) setAllRoomsLoading(false); });
    return () => { cancelled = true; };
  }, [allRoomsOpen, today]);

  const load = () => {
    setLoading(true);
    api.get(`/my-workspace/overall-dashboard`, { params: { date: today } })
       .then((r) => setOverall(r.data || null))
       .catch(() => setOverall(null))
       .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [today]);

  useEffect(() => {
    setWeekLoading(true);
    api.get(`/my-workspace/week`, { params: { start: weekStart } })
       .then((r) => setWeekData(r.data || { days: [], start: weekStart }))
       .catch(() => setWeekData({ days: [], start: weekStart }))
       .finally(() => setWeekLoading(false));
  }, [weekStart]);

  // Presence-per-day for the displayed week — fetch the org week ending on the
  // Sunday of `weekStart` so the chart shows Mon…Sun of the SAME week as the
  // strip above (and updates on prev/next/Today navigation).
  useEffect(() => {
    const sunday = toISO(new Date(new Date(weekStart + "T00:00:00").getTime() + 6 * 86400000));
    let cancelled = false;
    api.get(`/my-workspace/overall-dashboard`, { params: { date: sunday } })
       .then((r) => { if (!cancelled) setWeekOrg(r.data?.org_week || []); })
       .catch(() => { if (!cancelled) setWeekOrg([]); });
    return () => { cancelled = true; };
  }, [weekStart]);

  const openFloor = () => {
    if (!overall?.my_seat?.plan_id && !overall?.org_occupancy?.total_seats) return;
    setFloorOpen(true);
    setFloorLoading(true);
    api.get(`/my-workspace/floor`, { params: { date: today } })
       .then((r) => setFloorData(r.data))
       .catch(() => setFloorData(null))
       .finally(() => setFloorLoading(false));
  };

  const mySeat  = overall?.my_seat || null;
  const occ     = overall?.org_occupancy || { total_seats: 0, present: 0, free: 0, occupancy_pct: 0 };
  const orgWeek = weekOrg;
  const rooms   = overall?.meeting_rooms_today || [];
  const teams   = overall?.all_teams || [];
  const activity= overall?.recent_activity || [];

  const maxOrgWeek = useMemo(
    () => Math.max(1, ...orgWeek.map((w) => w.count || 0)),
    [orgWeek],
  );

  const myWeekDays = weekData?.days || [];

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-12 pt-2 pb-4 space-y-4" data-testid="workspace-overall-dashboard">
      {/* Greeting */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Hi {(user?.name || "").split(" ")[0] || "there"} <span>👋</span>
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{longDate(today)} · organisation-wide view</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            {occ.present} on site · {occ.occupancy_pct}% occupancy
          </div>
          <button
            type="button"
            onClick={load}
            className="h-9 w-9 rounded-md border border-gray-200 bg-white text-gray-500 hover:text-[#ec9324] hover:border-[#ec9324] inline-flex items-center justify-center"
            title="Refresh"
            data-testid="workspace-overall-refresh"
          >
            <RefreshCw sx={{ fontSize: 14 }} className={loading ? "animate-spin" : ""}/>
          </button>
        </div>
      </div>

      {/* Combined Row 1 + 2 — Left column: My Seat Today (top) + Occupancy/Meeting rooms (bottom) · Right column: This Week + Presence per day, stretched full height */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
        {/* LEFT COLUMN — My Seat Today (row 1) + [Occupancy + Meeting rooms] (row 2) */}
        <div className="xl:col-span-2 flex flex-col gap-4">
          {/* Hero: My Seat Today (mirrors MyWorkspaceDashboard exactly) */}
          <div
            className="rounded-2xl border border-gray-200 bg-gradient-to-br from-orange-50 via-white to-white p-5 shadow-sm"
            data-testid="my-seat-today-card"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] uppercase tracking-widest text-[#ec9324] font-bold">My seat today</div>
                {mySeat ? (
                  <>
                    <div className="mt-2 flex items-end gap-3 flex-wrap">
                      <div className="text-4xl sm:text-5xl font-black text-gray-900">{mySeat.seat_label || "—"}</div>
                      <div className="pb-1">
                        <div className="text-sm font-semibold text-gray-800">{mySeat.plan_name || "Floor plan"}</div>
                        <div className="text-xs text-gray-500 flex items-center gap-1.5 flex-wrap">
                          {mySeat.team_name && (
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ background: `linear-gradient(135deg, ${teamBackground(mySeat.team_color).split(",")[1].trim()} 0%, ${teamBackground(mySeat.team_color).split(",")[2]?.split(")")[0].trim() || "#d4811f"} 100%)` }}
                              />
                              {mySeat.team_name}
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
                    </div>
                  </>
                ) : (
                  <div className="mt-3">
                    <div className="text-lg font-bold text-gray-800">No seat allotted today</div>
                    <p className="text-xs text-gray-500 mt-1 max-w-md">
                      You don't have a workstation booked for today. Book one now or view the live floor plan.
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
              {/* Mini map thumbnail (same component used in MyWorkspaceDashboard) */}
              <div className="flex-shrink-0">
                <MySeatMiniMap
                  mySeat={mySeat}
                  allSeats={floorData?.seats || []}
                  onClick={openFloor}
                />
              </div>
            </div>
          </div>

          {/* Row 2 — Occupancy right now + Meeting rooms today */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col">
              <div className="px-5 pt-4 pb-3 flex items-center gap-2 border-b border-gray-100 flex-shrink-0">
                <Armchair sx={{ fontSize: 16 }} className="text-[#ec9324]"/>
                <h3 className="font-semibold text-gray-900">Occupancy right now</h3>
              </div>
              <div className="p-5 flex-1 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="relative w-32 h-32 sm:w-36 sm:h-36 flex-shrink-0">
                  <svg width="144" height="144" viewBox="0 0 144 144" className="-rotate-90 drop-shadow-sm">
                    <circle cx="72" cy="72" r="58" stroke="#f3f4f6" strokeWidth="14" fill="none" />
                    <circle
                      cx="72" cy="72" r="58" stroke={ORANGE} strokeWidth="14" fill="none"
                      strokeDasharray={2 * Math.PI * 58}
                      strokeDashoffset={2 * Math.PI * 58 * (1 - (occ.occupancy_pct || 0) / 100)}
                      strokeLinecap="round"
                      style={{ transition: "stroke-dashoffset 600ms ease-out" }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-3xl font-extrabold text-gray-900 leading-none tracking-tight">{occ.occupancy_pct || 0}%</div>
                    <div className="text-[11px] uppercase tracking-wider text-gray-500 mt-1 font-medium">occupied</div>
                  </div>
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="flex flex-col items-center">
                    <div className="flex items-baseline gap-2">
                      <span className="text-5xl font-black text-gray-900 leading-none tracking-tight">{occ.present}</span>
                      <span className="text-xl text-gray-400 font-bold leading-none">/ {occ.total_seats}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1.5 font-medium">seats in use</div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 hover:bg-emerald-100/60 transition-colors">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-emerald-500"/>
                        <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">Present</span>
                      </div>
                      <div className="text-xl font-bold text-emerald-800 mt-0.5 leading-none">{occ.present}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 hover:bg-gray-100 transition-colors">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-gray-400"/>
                        <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Available</span>
                      </div>
                      <div className="text-xl font-bold text-gray-800 mt-0.5 leading-none">{occ.free}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-gray-100">
                <div className="inline-flex items-center gap-2">
                  <DoorOpen sx={{ fontSize: 16 }} className="text-[#ec9324]"/>
                  <h3 className="font-semibold text-gray-900">Meeting rooms today</h3>
                </div>
                <span className="text-[10px] font-semibold text-gray-500">
                  {overall?.meeting_rooms_bookings_today || 0}/{overall?.meeting_rooms_total || 0} booked
                </span>
              </div>
              <div className="p-4 grid grid-cols-1 gap-2">
                {rooms.length === 0 && (
                  <div className="text-center text-xs text-gray-400 py-6">
                    No meeting rooms in use today.
                  </div>
                )}
                {/* Show only the top-3 rooms in the card. The "View all"
                    button below opens a modal listing every meeting room. */}
                {rooms.slice(0, 3).map((r) => (
                  <div key={r.room_id || r.room_name} className="flex items-center gap-3 p-2 rounded-lg border border-gray-100 hover:bg-gray-50">
                    <span className="h-9 w-9 rounded-md bg-[#ec9324]/10 text-[#ec9324] inline-flex items-center justify-center flex-shrink-0">
                      <DoorOpen sx={{ fontSize: 16 }}/>
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col min-w-0">
                        <div className="text-sm font-semibold text-gray-900 truncate">{r.room_name || "Room"}</div>
                        {r.plan_name && <div className="text-[10px] text-gray-500 truncate">{r.plan_name}</div>}
                      </div>
                      <ProgressBar value={r.pct} max={100} height={4} />
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-bold text-gray-900">{r.used}</div>
                      <div className="text-[10px] text-gray-500">{r.pct}% used</div>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => setAllRoomsOpen(true)}
                  className="text-[11px] font-semibold text-[#ec9324] hover:underline mt-1"
                  data-testid="wm-view-all-meeting-rooms"
                >
                  View all meeting rooms →
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN — This week (top) + Presence per day (bottom, flex-1 stretches to fill remaining height) */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col">
          {/* This Week */}
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">This week</div>
                <div className="text-xs text-gray-500 mt-0.5">{(() => {
                  if (!weekData?.week_start && !weekData?.start) return "";
                  const startISO = weekData.week_start || weekData.start;
                  const start = new Date(startISO + "T00:00:00");
                  const end = new Date(start.getTime() + 6 * 86400000);
                  const sameMonth = start.getMonth() === end.getMonth();
                  const fmtStart = start.toLocaleDateString(undefined, { day: "2-digit", month: sameMonth ? undefined : "short", timeZone: "Asia/Kolkata" });
                  const fmtEnd = end.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
                  return `${fmtStart} – ${fmtEnd}`;
                })()}</div>
              </div>
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setWeekStart(toISO(new Date(new Date(weekStart).getTime() - 7 * 86400000)))}
                  className="h-8 w-8 rounded-md border border-gray-200 bg-white text-gray-600 hover:text-[#ec9324] hover:border-[#ec9324] inline-flex items-center justify-center relative group"
                  title="Previous Week"
                  aria-label="Previous Week"
                >
                  <ChevronLeft sx={{ fontSize: 15 }}/>
                </button>
                <button
                  type="button"
                  onClick={() => setWeekStart(isoWeekMondayFor(toISO(new Date())))}
                  className="h-8 px-2 rounded-md border border-gray-200 bg-white text-gray-600 hover:text-[#ec9324] hover:border-[#ec9324] text-[11px] font-semibold"
                  title="Jump to current week"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setWeekStart(toISO(new Date(new Date(weekStart).getTime() + 7 * 86400000)))}
                  className="h-8 w-8 rounded-md border border-gray-200 bg-white text-gray-600 hover:text-[#ec9324] hover:border-[#ec9324] inline-flex items-center justify-center relative group"
                  title="Next Week"
                  aria-label="Next Week"
                >
                  <ChevronRight sx={{ fontSize: 15 }}/>
                </button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-7 gap-1.5">
              {(myWeekDays.length ? myWeekDays : Array.from({ length: 7 }).map((_, i) => ({}))).slice(0, 7).map((d, i) => {
                const isToday = d?.date === today;
                const status = d?.status || "none";
                let cls = "bg-white border border-gray-200 text-gray-500";
                if (status === "assigned") cls = "bg-[#ec9324] border-[#ec9324] text-white shadow-sm";
                else if (status === "requested") cls = "bg-orange-50 border-2 border-dashed border-[#ec9324] text-[#ec9324]";
                const dayLabel = d?.date
                  ? new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", timeZone: "Asia/Kolkata" }).slice(0, 3)
                  : "—";
                const dayNum = d?.date ? new Date(d.date + "T00:00:00").getDate() : "";
                return (
                  <div
                    key={d?.date || i}
                    className={`flex flex-col items-center justify-center rounded-lg h-16 relative ${cls} ${isToday ? "ring-2 ring-[#ec9324]/40 ring-offset-2 ring-offset-white" : ""}`}
                    title={d?.date ? `${dayLabel} ${d.date}${status !== "none" && d.seat_label ? " · " + d.seat_label : ""}${status !== "none" ? " · " + (status === "assigned" ? "Assigned" : "Requested") : ""}` : undefined}
                  >
                    <div className={`text-[10px] font-semibold uppercase tracking-wide ${status === "assigned" ? "text-white/90" : status === "requested" ? "text-[#ec9324]" : "text-gray-400"}`}>
                      {dayLabel}
                    </div>
                    <div className={`text-lg font-bold ${status === "assigned" ? "text-white" : status === "requested" ? "text-[#ec9324]" : "text-gray-700"}`}>
                      {dayNum}
                    </div>
                    {d?.seat_label && status !== "none" && (
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
              <div className="mt-2 text-[10px] text-gray-400 inline-flex items-center gap-1"><RefreshCw sx={{ fontSize: 11 }} className="animate-spin"/> Updating…</div>
            )}
          </div>

          <div className="border-t border-gray-100" />

          {/* Presence per day — stretches to fill remaining height */}
          <div className="p-4 flex-1 flex flex-col min-h-0">
            <div className="text-[11px] uppercase tracking-widest text-gray-500 font-bold mb-2">Presence per day</div>
            <div className="grid grid-cols-7 gap-1.5 flex-1 min-h-0">
              {orgWeek.map((w) => {
                const isToday = w.date === today;
                return (
                <div
                  key={w.date}
                  className={`rounded-lg border p-1.5 text-center flex flex-col ${isToday ? "border-[#ec9324] bg-orange-50" : "border-gray-200"}`}
                >
                  <div className="text-[10px] font-semibold text-gray-500">{w.day}</div>
                  <div className={`text-sm font-bold ${isToday ? "text-[#ec9324]" : "text-gray-900"}`}>{w.n}</div>
                  <div className="mt-1 flex-1 flex items-end justify-center min-h-[24px]">
                    <div
                      className="w-2.5 rounded-t"
                      style={{
                        height: `${(w.count / maxOrgWeek) * 100}%`,
                        background: isToday ? ORANGE : "#d1d5db",
                      }}
                    />
                  </div>
                  <div className="text-[9px] text-gray-500 mt-0.5">{w.count}</div>
                </div>
                );
              })}
            </div>
            <div className="mt-2 text-[10px] text-gray-500 flex items-center justify-between">
              <span>Peak: <b className="text-gray-800">{peakOf(orgWeek)}</b></span>
              <span>Avg: <b className="text-gray-800">{avgOf(orgWeek)}/day</b></span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3 — All teams today */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-gray-100 flex-wrap gap-2">
          <div className="inline-flex items-center gap-2 flex-wrap">
            <Users sx={{ fontSize: 16 }} className="text-[#ec9324]"/>
            <h3 className="font-semibold text-gray-900">All teams today</h3>
            <span className="text-[11px] text-gray-500">
              · {teams.length} teams · {teams.reduce((s, t) => s + (t.seat_count || 0), 0)} seats allocated
            </span>
          </div>
        </div>
        {teams.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No teams found.</div>
        ) : (
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {teams.map((t) => (
              <div key={t.id} className="rounded-xl border border-gray-200 p-3 hover:border-[#ec9324] transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-8 w-8 rounded-lg inline-flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                    style={{ background: teamBackground(t.color) }}
                  >
                    {teamInitials(t.name)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">{t.name}</div>
                    <div className="text-[10px] text-gray-500">
                      {t.seat_count > 0 ? `${t.seat_count} seats` : "no seats allocated"}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded px-1.5 py-1 min-w-0">
                    <MapPin sx={{ fontSize: 11 }} className="text-[#ec9324] flex-shrink-0"/>
                    <span className="truncate">
                      {t.seat_from ? `${t.seat_from}${t.seat_to && t.seat_to !== t.seat_from ? ` → ${t.seat_to}` : ""}` : "—"}
                    </span>
                  </div>
                  <button
                    onClick={() => navigate(`/workspace-manager/floor-layout?team=${encodeURIComponent(t.id || "")}`)}
                    disabled={!t.seat_from}
                    className={`flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold text-white px-2 py-1 rounded ${
                      t.seat_from ? "bg-[#ec9324] hover:bg-[#d4811f]" : "bg-gray-300 cursor-not-allowed"
                    }`}
                    title={t.seat_from ? "View on floor plan" : "No seats to show"}
                  >
                    <MapIcon sx={{ fontSize: 11 }}/> View on map
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Row 4 — Recent activity */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center gap-2">
          <Clock sx={{ fontSize: 16 }} className="text-[#ec9324]"/>
          <h3 className="font-semibold text-gray-900">Recent activity</h3>
          <span className="ml-auto text-[10px] font-semibold text-gray-500">last few</span>
        </div>
        {activity.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No recent activity.</div>
        ) : (
          <div className="p-4 divide-y divide-gray-100">
            {activity.map((a, i) => (
              <div key={i} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <span className="h-8 w-8 rounded-full bg-[#ec9324]/10 text-[#ec9324] inline-flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                  {(a.who || "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()}
                </span>
                <div className="flex-1 min-w-0 text-sm">
                  <b className="text-gray-900">{a.who}</b>
                  <span className="text-gray-600"> {a.what} </span>
                  <span className="text-gray-800">{a.target}</span>
                </div>
                <div className="text-[10px] text-gray-500 flex-shrink-0">{a.when}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floor plan popup (reused component) */}
      <MySeatFloorDialog
        open={floorOpen}
        onClose={() => setFloorOpen(false)}
        floorData={floorLoading ? null : floorData}
        dateLabel={longDate(today)}
        mySeat={mySeat}
      />

      {/* "View all meeting rooms" modal */}
      <AllMeetingRoomsModal
        open={allRoomsOpen}
        onClose={() => setAllRoomsOpen(false)}
        loading={allRoomsLoading}
        data={allRooms}
        dateLabel={longDate(today)}
      />
    </div>
  );
}

// ============================================================ All-meeting-rooms modal
function AllMeetingRoomsModal({ open, onClose, loading, data, dateLabel }) {
  const [query, setQuery] = useState("");
  useEffect(() => { if (!open) setQuery(""); }, [open]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const rooms = (data?.rooms || []).filter((r) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      String(r.room_name || "").toLowerCase().includes(q) ||
      String(r.plan_name || "").toLowerCase().includes(q)
    );
  });
  const total = data?.total_rooms || 0;
  const booked = data?.booked_count || 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="wm-all-rooms-modal"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="inline-flex items-center gap-2">
              <span className="h-8 w-8 rounded-md bg-[#ec9324]/10 text-[#ec9324] inline-flex items-center justify-center">
                <DoorOpen sx={{ fontSize: 18 }} />
              </span>
              <h3 className="font-bold text-gray-900 text-base">All meeting rooms</h3>
            </div>
            <div className="text-[11px] text-gray-500 mt-1 ml-10">
              {dateLabel} · {booked}/{total} booked today
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            aria-label="Close"
            data-testid="wm-all-rooms-close"
          >
            ×
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-3 pb-2 border-b border-gray-100 flex-shrink-0">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search room or floor plan…"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-[#ec9324] focus:ring-1 focus:ring-[#ec9324]/30"
            data-testid="wm-all-rooms-search"
          />
        </div>

        {/* Room list */}
        <div className="flex-1 overflow-y-auto px-5 py-3" style={{ scrollbarWidth: "thin" }}>
          {loading && (
            <div className="text-center text-xs text-gray-400 py-10">Loading meeting rooms…</div>
          )}
          {!loading && rooms.length === 0 && (
            <div className="text-center text-xs text-gray-400 py-10">
              {query ? "No rooms match your search." : "No meeting rooms available."}
            </div>
          )}
          <div className="grid grid-cols-1 gap-2">
            {rooms.map((r) => (
              <div
                key={r.room_id || r.room_name}
                data-testid={`wm-all-rooms-row-${r.room_id || r.room_name}`}
                className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
              >
                <span className="h-10 w-10 rounded-md bg-[#ec9324]/10 text-[#ec9324] inline-flex items-center justify-center flex-shrink-0">
                  <DoorOpen sx={{ fontSize: 18 }} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">{r.room_name || "Room"}</div>
                    {r.capacity != null && (
                      <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 rounded px-1.5 py-[1px]">
                        {r.capacity} seats
                      </span>
                    )}
                    {r.bookings === 0 && (
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Unbooked</span>
                    )}
                  </div>
                  {r.plan_name && (
                    <div className="text-[10px] text-gray-500 truncate">{r.plan_name}</div>
                  )}
                  <div className="mt-1.5">
                    <ProgressBar value={r.pct} max={100} height={4} />
                  </div>
                </div>
                <div className="text-right flex-shrink-0 min-w-[64px]">
                  <div className="text-sm font-bold text-gray-900">{r.used}</div>
                  <div className="text-[10px] text-gray-500">
                    {r.pct}% used
                    {r.bookings > 0 && (
                      <> · {r.bookings} meeting{r.bookings === 1 ? "" : "s"}</>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── small aggregates for peak/avg ─────────────────────────────────────────
function peakOf(days) {
  if (!days.length) return "—";
  const p = [...days].sort((a, b) => (b.count || 0) - (a.count || 0))[0];
  return p ? `${p.day} · ${p.count}` : "—";
}
function avgOf(days) {
  if (!days.length) return 0;
  const s = days.reduce((n, d) => n + (d.count || 0), 0);
  return Math.round(s / days.length);
}
