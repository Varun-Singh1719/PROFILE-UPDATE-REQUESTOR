/**
 * WMOverallPreview — DESIGN PROPOSAL ONLY.
 *
 * A UI-only prototype of the "Overall" (organisation-wide) dashboard for the
 * Workspace Manager tab. Matches the visual language of the existing
 * `MyWorkspaceDashboard` (Individual) + `MyTeamToday` (Team Manager) blocks.
 *
 * Mounted at:  /mockup/wm-overall
 *
 * All numbers here are illustrative. Nothing is wired to the backend.
 */
import React from "react";
import {
  Armchair,
  Users,
  Map as MapIcon,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  CalendarPlus,
  DoorOpen,
  Building2,
  FileBarChart,
  ClipboardCheck,
  MapPin,
  Clock,
} from "lucide-react";
import Layout from "../components/Layout";

const ORANGE = "#ec9324";

// ─────────────── mock helpers
function longDate(d = new Date()) {
  return d.toLocaleDateString(undefined, {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });
}

const WEEK = [
  { d: "Mon", n: 6,  cnt: 298 },
  { d: "Tue", n: 7,  cnt: 331, today: true },
  { d: "Wed", n: 8,  cnt: 305 },
  { d: "Thu", n: 9,  cnt: 342 },
  { d: "Fri", n: 10, cnt: 288 },
  { d: "Sat", n: 11, cnt: 108 },
  { d: "Sun", n: 12, cnt: 62  },
];
const maxWeek = Math.max(...WEEK.map((w) => w.cnt));

const FLOORS = [
  { name: "Floor 1", present: 34, cap: 80 },
  { name: "Floor 2", present: 61, cap: 100 },
  { name: "Floor 3", present: 98, cap: 120 },
  { name: "Floor 4", present: 66, cap: 120 },
  { name: "Floor 5", present: 44, cap: 60  },
];

const ROOMS = [
  { name: "Aurora", floor: "F4", used: "6h 20m", pct: 89 },
  { name: "Peak",   floor: "F5", used: "5h 40m", pct: 74 },
  { name: "Cove",   floor: "F3", used: "4h 05m", pct: 62 },
];

const TEAMS = [
  { name: "DQ Team",         color: "#ec9324", present: 3, total: 4  },
  { name: "Design Squad",    color: "#3b82f6", present: 1, total: 1  },
  { name: "Aquaholics",      color: "#10b981", present: 8, total: 12 },
  { name: "AutoVerse",       color: "#8b5cf6", present: 4, total: 6  },
  { name: "BrewBulbs",       color: "#ef4444", present: 7, total: 11 },
  { name: "CareCrew",        color: "#0ea5e9", present: 9, total: 12 },
  { name: "Chem Catalysts",  color: "#f59e0b", present: 5, total: 7  },
  { name: "Fintech Wizards", color: "#22c55e", present: 6, total: 11 },
];

const ACTIVITY = [
  { who: "Ritika Singhal",   what: "booked",  target: "F3-B12 · Product",  when: "5m ago" },
  { who: "Nitya Srivastava", what: "requested", target: "F4-C05 for Jul 09", when: "20m ago" },
  { who: "Yamini Bakshi",    what: "approved", target: "3 workstation requests", when: "1h ago" },
  { who: "Aparajita S.",     what: "cancelled", target: "F3-A08 booking",   when: "2h ago" },
];

// ─────────────── mini pieces
function ProgressBar({ value, max, tone = ORANGE, height = 6 }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="w-full rounded-full bg-gray-100 overflow-hidden" style={{ height }}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
    </div>
  );
}

// ─────────────── main component
export default function WMOverallPreview() {
  const today = new Date();

  const totalSeats = FLOORS.reduce((s, f) => s + f.cap, 0);
  const totalPresent = FLOORS.reduce((s, f) => s + f.present, 0);
  const occupancyPct = Math.round((totalPresent / totalSeats) * 100);

  return (
    <Layout
      title="Dashboard"
      contentClassName="w-full px-0 pt-0 pb-3 flex flex-col min-h-[calc(100vh-56px)]"
      actions={
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-semibold text-[#ec9324] bg-[#ec9324]/10 border border-[#ec9324]/30 rounded-full px-2 py-0.5 mr-2">
            DESIGN PREVIEW · Overall
          </span>
        </div>
      }
    >
      <div className="w-full px-9 sm:px-12 pt-2 pb-4 space-y-4">
        {/* Greeting — matches existing style */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Overall Workspace <span>🏢</span>
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">{longDate(today)} · organisation-wide view</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              {totalPresent} on site · {occupancyPct}% occupancy
            </div>
            <button className="h-9 w-9 rounded-md border border-gray-200 bg-white text-gray-500 hover:text-[#ec9324] hover:border-[#ec9324] inline-flex items-center justify-center" title="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* Row 1 — Occupancy hero + This Week strip */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Hero: Occupancy today (mirrors "My Seat Today" hero card) */}
          <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-gradient-to-br from-orange-50 via-white to-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] uppercase tracking-widest text-[#ec9324] font-bold">Occupancy right now</div>
                <div className="mt-2 flex items-end gap-3 flex-wrap">
                  <div className="text-4xl sm:text-5xl font-black text-gray-900">
                    {totalPresent}<span className="text-gray-400 font-bold">/{totalSeats}</span>
                  </div>
                  <div className="pb-1">
                    <div className="text-sm font-semibold text-gray-800">{occupancyPct}% of seats in use</div>
                    <div className="text-xs text-gray-500 flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        {totalPresent} present
                      </span>
                      <span className="text-gray-300">·</span>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-gray-300" />
                        {totalSeats - totalPresent} free
                      </span>
                    </div>
                  </div>
                </div>
                {/* stacked bar */}
                <div className="mt-4 w-full h-2 rounded-full bg-gray-100 overflow-hidden flex">
                  <div style={{ width: `${occupancyPct}%`, background: ORANGE }} />
                  <div style={{ width: `${100 - occupancyPct}%`, background: "#e5e7eb" }} />
                </div>
                <div className="mt-4 flex gap-2 flex-wrap">
                  <button className="inline-flex items-center gap-1.5 bg-[#ec9324] hover:bg-[#d4811f] text-white text-xs font-semibold px-3.5 py-2 rounded-md shadow-sm">
                    <MapIcon size={13} /> View live floor plan
                  </button>
                  <button className="inline-flex items-center gap-1.5 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold px-3.5 py-2 rounded-md">
                    <FileBarChart size={13} /> Utilisation report
                  </button>
                </div>
              </div>
              {/* Mini donut visual (kept minimal to match MySeatMiniMap footprint) */}
              <div className="flex-shrink-0 w-32 h-32 rounded-lg border border-gray-200 bg-white flex items-center justify-center">
                <svg width="120" height="120" viewBox="0 0 120 120" className="-rotate-90">
                  <circle cx="60" cy="60" r="46" stroke="#f3f4f6" strokeWidth="12" fill="none" />
                  <circle
                    cx="60" cy="60" r="46" stroke={ORANGE} strokeWidth="12" fill="none"
                    strokeDasharray={2 * Math.PI * 46}
                    strokeDashoffset={2 * Math.PI * 46 * (1 - occupancyPct / 100)}
                    strokeLinecap="round"
                  />
                  <text x="60" y="64" textAnchor="middle" fontSize="22" fontWeight="800" fill="#111827" transform="rotate(90 60 60)">
                    {occupancyPct}%
                  </text>
                </svg>
              </div>
            </div>
          </div>

          {/* This Week (mirrors existing 7-day strip) */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">This week</div>
              <div className="inline-flex items-center gap-1">
                <button className="p-1 rounded hover:bg-gray-100"><ChevronLeft size={13}/></button>
                <button className="text-[10px] font-semibold text-[#ec9324] px-2 py-0.5 rounded hover:bg-orange-50">Today</button>
                <button className="p-1 rounded hover:bg-gray-100"><ChevronRight size={13}/></button>
              </div>
            </div>
            <div className="text-[11px] text-gray-500 mb-2">Presence per day</div>
            <div className="grid grid-cols-7 gap-1.5">
              {WEEK.map((w) => (
                <div key={w.d} className={`rounded-lg border p-1.5 text-center ${w.today ? "border-[#ec9324] bg-orange-50" : "border-gray-200"}`}>
                  <div className="text-[10px] font-semibold text-gray-500">{w.d}</div>
                  <div className={`text-sm font-bold ${w.today ? "text-[#ec9324]" : "text-gray-900"}`}>{w.n}</div>
                  <div className={`h-8 flex items-end justify-center mt-0.5`}>
                    <div className="w-2.5 rounded-t" style={{ height: `${(w.cnt / maxWeek) * 100}%`, background: w.today ? ORANGE : "#d1d5db" }} />
                  </div>
                  <div className="text-[9px] text-gray-500 mt-0.5">{w.cnt}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-[10px] text-gray-500 flex items-center justify-between">
              <span>Peak: <b className="text-gray-800">Thu · 342</b></span>
              <span>Avg: <b className="text-gray-800">248/day</b></span>
            </div>
          </div>
        </div>

        {/* Row 2 — Floor Occupancy | Quick actions | Meeting Rooms */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Floor occupancy card */}
          <div className="lg:col-span-5 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-gray-100">
              <div className="inline-flex items-center gap-2">
                <Building2 size={16} className="text-[#ec9324]" />
                <h3 className="font-semibold text-gray-900">Floor occupancy</h3>
              </div>
              <span className="text-[10px] font-semibold text-gray-500">{FLOORS.length} floors</span>
            </div>
            <div className="p-4 space-y-3">
              {FLOORS.map((f) => {
                const pct = Math.round((f.present / f.cap) * 100);
                const tone = pct >= 80 ? "#ef4444" : pct >= 60 ? ORANGE : "#10b981";
                return (
                  <div key={f.name}>
                    <div className="flex items-center justify-between text-[12px] mb-1">
                      <div className="font-semibold text-gray-800">{f.name}</div>
                      <div className="text-gray-500">
                        <b className="text-gray-900">{f.present}</b> / {f.cap} · {pct}%
                      </div>
                    </div>
                    <ProgressBar value={f.present} max={f.cap} tone={tone} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick actions — same tile styling as the Individual dashboard */}
          <div className="lg:col-span-3 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 pt-4 pb-3 border-b border-gray-100">
              <div className="inline-flex items-center gap-2">
                <MapIcon size={16} className="text-[#ec9324]" />
                <h3 className="font-semibold text-gray-900">Quick actions</h3>
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">Manage the workspace</div>
            </div>
            <div className="p-4 grid grid-cols-1 gap-2">
              {[
                { icon: MapIcon,       label: "Manage floor plans",   sub: "layouts & seats" },
                { icon: ClipboardCheck,label: "Approvals",           sub: "pending requests" },
                { icon: FileBarChart,  label: "Utilisation report",  sub: "download PDF/CSV" },
              ].map((a) => (
                <button key={a.label} className="rounded-lg border border-gray-200 hover:border-[#ec9324] hover:bg-orange-50/50 p-3 text-left inline-flex items-center gap-3">
                  <span className="h-8 w-8 rounded-md bg-[#ec9324]/10 text-[#ec9324] inline-flex items-center justify-center">
                    <a.icon size={15} />
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{a.label}</div>
                    <div className="text-[10px] text-gray-500">{a.sub}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Meeting rooms today */}
          <div className="lg:col-span-4 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-gray-100">
              <div className="inline-flex items-center gap-2">
                <DoorOpen size={16} className="text-[#ec9324]" />
                <h3 className="font-semibold text-gray-900">Meeting rooms today</h3>
              </div>
              <span className="text-[10px] font-semibold text-gray-500">34/48 booked</span>
            </div>
            <div className="p-4 space-y-2">
              {ROOMS.map((r) => (
                <div key={r.name} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                  <span className="h-9 w-9 rounded-md bg-[#ec9324]/10 text-[#ec9324] inline-flex items-center justify-center">
                    <DoorOpen size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <div className="text-sm font-semibold text-gray-900">{r.name}</div>
                      <div className="text-[10px] text-gray-500">{r.floor}</div>
                    </div>
                    <ProgressBar value={r.pct} max={100} height={4} />
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-gray-900">{r.used}</div>
                    <div className="text-[10px] text-gray-500">{r.pct}% used</div>
                  </div>
                </div>
              ))}
              <button className="w-full text-[11px] font-semibold text-[#ec9324] hover:underline mt-1">
                View all meeting rooms →
              </button>
            </div>
          </div>
        </div>

        {/* Row 2.5 — All Teams Today (mirrors "My Team Today" card) */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-gray-100 flex-wrap gap-2">
            <div className="inline-flex items-center gap-2 flex-wrap">
              <Users size={16} className="text-[#ec9324]" />
              <h3 className="font-semibold text-gray-900">All teams today</h3>
              <span className="text-[11px] text-gray-500">· {TEAMS.length} teams</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-bold">
              <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                {TEAMS.reduce((s, t) => s + t.present, 0)} on site
              </span>
              <span className="text-gray-600 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full">
                {TEAMS.reduce((s, t) => s + (t.total - t.present), 0)} off
              </span>
            </div>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {TEAMS.map((t) => {
              const pct = Math.round((t.present / t.total) * 100);
              return (
                <div key={t.name} className="rounded-xl border border-gray-200 p-3 hover:border-[#ec9324] transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-8 w-8 rounded-lg inline-flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0" style={{ background: t.color }}>
                      {t.name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-900 truncate">{t.name}</div>
                      <div className="text-[10px] text-gray-500">{t.present} on site · {t.total - t.present} off</div>
                    </div>
                    <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded border bg-emerald-100 text-emerald-700 border-emerald-200">
                      {pct}%
                    </span>
                  </div>
                  <div className="mt-2">
                    <ProgressBar value={t.present} max={t.total} tone={t.color} height={5} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Row 3 — Recent activity (mirrors existing empty state style but with items) */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center gap-2">
            <Clock size={16} className="text-[#ec9324]" />
            <h3 className="font-semibold text-gray-900">Recent activity</h3>
            <span className="ml-auto text-[10px] font-semibold text-gray-500">last 4h</span>
          </div>
          <div className="p-4 divide-y divide-gray-100">
            {ACTIVITY.map((a, i) => (
              <div key={i} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <span className="h-8 w-8 rounded-full bg-[#ec9324]/10 text-[#ec9324] inline-flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                  {a.who.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()}
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
        </div>
      </div>
    </Layout>
  );
}
