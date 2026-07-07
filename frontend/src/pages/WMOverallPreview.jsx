/**
 * WMOverallPreview — DESIGN PROPOSAL ONLY (v3).
 *
 * Route: /mockup/wm-overall
 * All numbers are illustrative — nothing is wired to backend.
 * Team colours pulled from the real `TEAM_PALETTES` used in the Teams module.
 */
import React from "react";
import {
  Users,
  Map as MapIcon,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  MapPin,
  Clock,
  Armchair,
} from "lucide-react";
import Layout from "../components/Layout";
import { teamBackground, teamInitials } from "../lib/teamColors";

const ORANGE = "#ec9324";

function longDate(d = new Date()) {
  return d.toLocaleDateString(undefined, {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });
}

// ─────────────── mock data
const MY_WEEK = [
  { d: "Mon", n: 6,  status: "assigned",  seat: "F3-B12" },
  { d: "Tue", n: 7,  status: "assigned",  seat: "F3-B12", today: true },
  { d: "Wed", n: 8,  status: "requested", seat: "F3-B12" },
  { d: "Thu", n: 9,  status: "assigned",  seat: "F3-B12" },
  { d: "Fri", n: 10, status: "off"                       },
  { d: "Sat", n: 11, status: "off"                       },
  { d: "Sun", n: 12, status: "off"                       },
];

const ORG_WEEK = [
  { d: "Mon", n: 6,  cnt: 298 },
  { d: "Tue", n: 7,  cnt: 331, today: true },
  { d: "Wed", n: 8,  cnt: 305 },
  { d: "Thu", n: 9,  cnt: 342 },
  { d: "Fri", n: 10, cnt: 288 },
  { d: "Sat", n: 11, cnt: 108 },
  { d: "Sun", n: 12, cnt: 62  },
];
const maxOrgWeek = Math.max(...ORG_WEEK.map((w) => w.cnt));

const ROOMS = [
  { name: "Aurora", floor: "F4", used: "6h 20m", pct: 89 },
  { name: "Peak",   floor: "F5", used: "5h 40m", pct: 74 },
  { name: "Cove",   floor: "F3", used: "4h 05m", pct: 62 },
  { name: "Horizon",floor: "F2", used: "3h 15m", pct: 48 },
  { name: "Nebula", floor: "F4", used: "2h 45m", pct: 36 },
];

// Team colors mirror the real palette ids stored in the Teams module DB.
const TEAMS = [
  { name: "DQ Team",         color: "tp11", seatFrom: "F3-A01", seatTo: "F3-A08", count: 8  },
  { name: "Design Squad",    color: "tp4",  seatFrom: "F3-B10", seatTo: "F3-B14", count: 5  },
  { name: "Aquaholics",      color: "tp29", seatFrom: "F4-C01", seatTo: "F4-C12", count: 12 },
  { name: "AutoVerse",       color: "tp1",  seatFrom: "F4-D01", seatTo: "F4-D06", count: 6  },
  { name: "BrewBulbs",       color: "tp16", seatFrom: "F2-A01", seatTo: "F2-A11", count: 11 },
  { name: "CareCrew",        color: "tp46", seatFrom: "F2-B01", seatTo: "F2-B12", count: 12 },
  { name: "Chem Catalysts",  color: "tp2",  seatFrom: "F5-A01", seatTo: "F5-A07", count: 7  },
  { name: "Fintech Wizards", color: "tp3",  seatFrom: "F5-B01", seatTo: "F5-B11", count: 11 },
];

const ACTIVITY = [
  { who: "Ritika Singhal",   what: "booked",   target: "F3-B12 · Product",       when: "5m ago" },
  { who: "Nitya Srivastava", what: "requested",target: "F4-C05 for Jul 09",      when: "20m ago" },
  { who: "Yamini Bakshi",    what: "approved", target: "3 workstation requests", when: "1h ago" },
  { who: "Aparajita S.",     what: "cancelled",target: "F3-A08 booking",         when: "2h ago" },
];

// ─────────────── small helpers
function ProgressBar({ value, max, tone = ORANGE, height = 6 }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="w-full rounded-full bg-gray-100 overflow-hidden" style={{ height }}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
    </div>
  );
}

// ─────────────── main
export default function WMOverallPreview() {
  const today = new Date();
  const totalPresent = 303;
  const totalSeats   = 480;
  const occupancyPct = Math.round((totalPresent / totalSeats) * 100);

  return (
    <Layout
      title="Dashboard"
      contentClassName="w-full px-0 pt-0 pb-3 flex flex-col min-h-[calc(100vh-56px)]"
      actions={
        <span className="text-[10px] font-semibold text-[#ec9324] bg-[#ec9324]/10 border border-[#ec9324]/30 rounded-full px-2 py-0.5 mr-2">
          DESIGN PREVIEW · Overall
        </span>
      }
    >
      <div className="w-full px-9 sm:px-12 pt-2 pb-4 space-y-4">
        {/* Greeting — identical to the other two dashboards */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Hi Admin <span>👋</span>
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">{longDate(today)} · organisation-wide view</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Seat allotted · F3-B12
            </div>
            <button className="h-9 w-9 rounded-md border border-gray-200 bg-white text-gray-500 hover:text-[#ec9324] hover:border-[#ec9324] inline-flex items-center justify-center" title="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* Row 1 — My Seat Today (2/3) + Combined [This Week + Presence per day] (1/3) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* My Seat Today (personal hero) */}
          <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-gradient-to-br from-orange-50 via-white to-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] uppercase tracking-widest text-[#ec9324] font-bold">My seat today</div>
                <div className="mt-2 flex items-end gap-3 flex-wrap">
                  <div className="text-4xl sm:text-5xl font-black text-gray-900">F3-B12</div>
                  <div className="pb-1">
                    <div className="text-sm font-semibold text-gray-800">Floor 3 · Wing B</div>
                    <div className="text-xs text-gray-500 flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: ORANGE }} />
                        Product
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex gap-2 flex-wrap">
                  <button className="inline-flex items-center gap-1.5 bg-[#ec9324] hover:bg-[#d4811f] text-white text-xs font-semibold px-3.5 py-2 rounded-md shadow-sm">
                    <MapIcon size={13} /> View floor plan
                  </button>
                  <button className="inline-flex items-center gap-1.5 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold px-3.5 py-2 rounded-md">
                    Book for tomorrow
                  </button>
                  <button className="inline-flex items-center gap-1.5 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold px-3.5 py-2 rounded-md">
                    My bookings
                  </button>
                </div>
              </div>
              <div className="flex-shrink-0 w-32 h-32 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <MapIcon size={22} className="mx-auto text-[#ec9324] mb-1" />
                  <div className="text-[10px]">Mini floor-plan</div>
                </div>
              </div>
            </div>
          </div>

          {/* Combined: This Week (top) + Presence per day (bottom) */}
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col">
            {/* This Week */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">This week</div>
                <div className="inline-flex items-center gap-1">
                  <button className="p-1 rounded hover:bg-gray-100"><ChevronLeft size={13}/></button>
                  <button className="text-[10px] font-semibold text-[#ec9324] px-2 py-0.5 rounded hover:bg-orange-50">Today</button>
                  <button className="p-1 rounded hover:bg-gray-100"><ChevronRight size={13}/></button>
                </div>
              </div>
              <div className="text-[10px] text-gray-500 mb-2 flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500"/>Assigned</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400"/>Requested</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-300"/>None</span>
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {MY_WEEK.map((w) => {
                  const dot =
                    w.status === "assigned"  ? "bg-emerald-500" :
                    w.status === "requested" ? "bg-amber-400"   :
                                               "bg-gray-300";
                  return (
                    <div key={w.d} className={`rounded-lg border p-1.5 text-center ${w.today ? "border-[#ec9324] bg-orange-50" : "border-gray-200"}`}>
                      <div className="text-[10px] font-semibold text-gray-500">{w.d}</div>
                      <div className={`text-sm font-bold ${w.today ? "text-[#ec9324]" : "text-gray-900"}`}>{w.n}</div>
                      <div className="mt-1 inline-flex items-center justify-center">
                        <span className={`h-2 w-2 rounded-full ${dot}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-gray-100" />

            {/* Presence per day — matches the attached screenshot style */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-widest text-gray-500 font-bold">Presence per day</div>
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {ORG_WEEK.map((w) => (
                  <div key={w.d} className={`rounded-lg border p-1.5 text-center ${w.today ? "border-[#ec9324] bg-orange-50" : "border-gray-200"}`}>
                    <div className="text-[10px] font-semibold text-gray-500">{w.d}</div>
                    <div className={`text-sm font-bold ${w.today ? "text-[#ec9324]" : "text-gray-900"}`}>{w.n}</div>
                    <div className="mt-1 h-6 flex items-end justify-center">
                      <div className="w-2 rounded-t" style={{ height: `${(w.cnt / maxOrgWeek) * 100}%`, background: w.today ? ORANGE : "#d1d5db" }} />
                    </div>
                    <div className="text-[9px] text-gray-500 mt-0.5">{w.cnt}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-gray-500 flex items-center justify-between">
                <span>Peak: <b className="text-gray-800">Thu · 342</b></span>
                <span>Avg: <b className="text-gray-800">248/day</b></span>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2 — Occupancy right now (narrow) + Meeting rooms today (wide) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Occupancy right now */}
          <div className="lg:col-span-4 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 pt-4 pb-3 flex items-center gap-2 border-b border-gray-100">
              <Armchair size={16} className="text-[#ec9324]" />
              <h3 className="font-semibold text-gray-900">Occupancy right now</h3>
            </div>
            <div className="p-4 flex items-center gap-5">
              <div className="relative w-28 h-28 flex-shrink-0">
                <svg width="112" height="112" viewBox="0 0 112 112" className="-rotate-90">
                  <circle cx="56" cy="56" r="44" stroke="#f3f4f6" strokeWidth="12" fill="none" />
                  <circle
                    cx="56" cy="56" r="44" stroke={ORANGE} strokeWidth="12" fill="none"
                    strokeDasharray={2 * Math.PI * 44}
                    strokeDashoffset={2 * Math.PI * 44 * (1 - occupancyPct / 100)}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-xl font-bold text-gray-900 leading-none">{occupancyPct}%</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">occupied</div>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-gray-900">{totalPresent}</span>
                  <span className="text-sm text-gray-400 font-bold">/ {totalSeats}</span>
                </div>
                <div className="text-[11px] text-gray-500">seats in use</div>
                <div className="mt-3 space-y-1 text-[11px]">
                  <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500"/>Present</span><b className="text-gray-800">{totalPresent}</b></div>
                  <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-300"/>Free</span><b className="text-gray-800">{totalSeats - totalPresent}</b></div>
                </div>
              </div>
            </div>
          </div>

          {/* Meeting rooms today (wider now) */}
          <div className="lg:col-span-8 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-gray-100">
              <div className="inline-flex items-center gap-2">
                <DoorOpen size={16} className="text-[#ec9324]" />
                <h3 className="font-semibold text-gray-900">Meeting rooms today</h3>
              </div>
              <span className="text-[10px] font-semibold text-gray-500">34/48 booked</span>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ROOMS.map((r) => (
                <div key={r.name} className="flex items-center gap-3 p-2 rounded-lg border border-gray-100 hover:bg-gray-50">
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
              <button className="col-span-1 sm:col-span-2 text-[11px] font-semibold text-[#ec9324] hover:underline mt-1">
                View all meeting rooms →
              </button>
            </div>
          </div>
        </div>

        {/* Row 3 — All teams today (seat range + View on map) — uses real team palette */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-gray-100 flex-wrap gap-2">
            <div className="inline-flex items-center gap-2 flex-wrap">
              <Users size={16} className="text-[#ec9324]" />
              <h3 className="font-semibold text-gray-900">All teams today</h3>
              <span className="text-[11px] text-gray-500">· {TEAMS.length} teams · {TEAMS.reduce((s, t) => s + t.count, 0)} seats allocated</span>
            </div>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {TEAMS.map((t) => (
              <div key={t.name} className="rounded-xl border border-gray-200 p-3 hover:border-[#ec9324] transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-8 w-8 rounded-lg inline-flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                    style={{ background: teamBackground(t.color) }}
                  >
                    {teamInitials(t.name)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">{t.name}</div>
                    <div className="text-[10px] text-gray-500">{t.count} seats</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded px-1.5 py-1">
                    <MapPin size={11} className="text-[#ec9324]" />
                    <span className="truncate">{t.seatFrom} → {t.seatTo}</span>
                  </div>
                  <button className="flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold text-white bg-[#ec9324] hover:bg-[#d4811f] px-2 py-1 rounded">
                    <MapIcon size={11} /> View on map
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Row 4 — Recent activity */}
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
