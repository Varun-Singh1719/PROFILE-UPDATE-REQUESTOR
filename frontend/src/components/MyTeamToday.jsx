/**
 * MyTeamToday — Manager-only card. Shows every member of the teams the
 * current user manages together with their seat status for today:
 *   • assigned  → green pill + seat label
 *   • requested → amber pill + "Awaiting approval"
 *   • off       → grey pill + "Not on site today"
 *
 * Rendered only when `dashboard.is_manager` is true.
 *
 * Multi-team ergonomics (activated when managedTeams.length >= 2):
 *   • Team filter chips at the top with color dots + per-team occupancy stats.
 *     Click a chip to focus a single team; "All Teams" restores the full view.
 *   • When "All Teams" is active, members are grouped under a per-team ribbon
 *     (team color dot + name + per-team stat line) so a manager of many teams
 *     can scan one team at a time. Single-team focus renders a flat grid.
 *   • Every member card carries a colored left border in the team's colour so
 *     team affiliation stays visible in every state (assigned/requested/off).
 */
import React, { useMemo, useState } from "react";
import Users from "@mui/icons-material/PeopleOutlined";
import MapPin from "@mui/icons-material/PlaceOutlined";
import Hourglass from "@mui/icons-material/HourglassEmpty";
import Home from "@mui/icons-material/HomeOutlined";
import ChevronDown from "@mui/icons-material/KeyboardArrowDown";
import ChevronUp from "@mui/icons-material/KeyboardArrowUp";
import UserAvatar from "./UserAvatar";

const PILL = {
  assigned:  "bg-emerald-100 text-emerald-700 border-emerald-200",
  requested: "bg-amber-100 text-amber-700 border-amber-200",
  off:       "bg-gray-200 text-gray-600 border-gray-300",
};

const LABEL = {
  assigned: "Assigned",
  requested: "Requested",
  off: "Off / WFH",
};

const COLLAPSED_LIMIT = 8;
const ALL_TEAMS = "__all__";

// Fallback for members whose team_id is missing (shouldn't normally happen but
// keeps the UI robust).
const UNASSIGNED_TEAM = { id: "__unassigned__", name: "Unassigned", color: "#9ca3af" };

// ---------------------------------------------------------------------------
// Per-team stat helpers
// ---------------------------------------------------------------------------
function statFor(members) {
  const c = { assigned: 0, requested: 0, off: 0 };
  for (const m of members) c[m.status] = (c[m.status] || 0) + 1;
  return c;
}

// Human-friendly summary line for a team, e.g. "2/5 · 1 requested · 2 off"
function teamSummary(members) {
  const s = statFor(members);
  const total = members.length;
  const parts = [`${s.assigned}/${total}`];
  if (s.requested) parts.push(`${s.requested} requested`);
  if (s.off)       parts.push(`${s.off} off`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Member card — extracted so it can be reused by both flat + grouped layouts.
// A `teamColor` is passed in so we can render a colored left border regardless
// of the member's status (assigned / requested / off).
// ---------------------------------------------------------------------------
function MemberCard({ m, teamColor }) {
  const color = teamColor || m.team_color || "#9ca3af";
  const bgClass =
    m.status === "requested" ? "border-amber-200 bg-amber-50/40" :
    m.status === "off"       ? "border-gray-200 bg-gray-50/40"   :
                               "border-gray-200";
  return (
    <div
      className={`rounded-xl border p-3 hover:border-[#ec9324] transition-colors ${bgClass}`}
      style={{ borderLeft: `4px solid ${color}` }}
      data-testid={`my-team-member-${m.id}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <UserAvatar user={m} size={32} showStatusDot={false} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate" title={m.name}>{m.name}</div>
          <div className="text-[10px] text-gray-500 truncate">
            {m.role || m.emp_id || m.team_name || ""}
          </div>
        </div>
        <span className={`flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded border ${PILL[m.status] || PILL.off}`}>
          {LABEL[m.status] || "—"}
        </span>
      </div>
      <div className="mt-2 text-[11px] text-gray-600 inline-flex items-center gap-1 min-w-0">
        {m.status === "assigned" && (
          <>
            <MapPin sx={{ fontSize: 12 }} className="text-[#ec9324] flex-shrink-0"/>
            <span className="truncate">{m.seat_label || "Seat"}</span>
          </>
        )}
        {m.status === "requested" && (
          <>
            <Hourglass sx={{ fontSize: 12 }} className="text-amber-600 flex-shrink-0"/>
            <span className="truncate">
              Awaiting approval{m.seat_label ? ` · ${m.seat_label}` : ""}
            </span>
          </>
        )}
        {m.status === "off" && (
          <>
            <Home sx={{ fontSize: 12 }} className="text-gray-400 flex-shrink-0"/>
            <span className="truncate">Not on site today</span>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter chip
// ---------------------------------------------------------------------------
function FilterChip({ active, color, label, sub, onClick, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
        active
          ? "bg-white border-2 border-[#ec9324] text-[#ec9324] shadow-sm"
          : "bg-white border border-gray-200 hover:border-gray-300 text-gray-700"
      }`}
      data-testid={testId}
    >
      {color && (
        <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: color }} />
      )}
      <span className="font-semibold">{label}</span>
      {sub && (
        <span className={`text-[10px] rounded px-1.5 py-0.5 ${
          active ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-700"
        }`}>
          {sub}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function MyTeamToday({ team = [], managedTeams = [] }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState(ALL_TEAMS);

  // Global counts (across every team the manager owns)
  const counts = useMemo(() => statFor(team), [team]);

  // Multi-team activates when the manager owns 2+ teams.
  const isMultiTeam = managedTeams.length >= 2;

  // Bucket members by team_id → { teamId: [members] }
  const membersByTeam = useMemo(() => {
    const bucket = {};
    for (const m of team) {
      const tid = m.team_id || UNASSIGNED_TEAM.id;
      (bucket[tid] = bucket[tid] || []).push(m);
    }
    return bucket;
  }, [team]);

  // Ordered list of managed teams for chips + ribbons. Preserve backend order.
  const orderedTeams = useMemo(() => managedTeams.filter(Boolean), [managedTeams]);

  // Members after the "team filter" chip is applied.
  const filtered = useMemo(() => {
    if (!isMultiTeam || selectedTeamId === ALL_TEAMS) return team;
    return team.filter((m) => (m.team_id || UNASSIGNED_TEAM.id) === selectedTeamId);
  }, [team, selectedTeamId, isMultiTeam]);

  const shown = expanded ? filtered : filtered.slice(0, COLLAPSED_LIMIT);

  // For flat (single-team-focus or non-multi) rendering we still want the
  // left border colour to reflect the member's team, so build a fast lookup.
  const teamColorById = useMemo(() => {
    const map = {};
    for (const t of orderedTeams) if (t?.id) map[t.id] = t.color || "#9ca3af";
    return map;
  }, [orderedTeams]);

  // Legacy caption for the header when there's only one team OR when we still
  // want the dot-separated summary alongside the icon.
  const teamsLabel = orderedTeams.map((t) => t.name).filter(Boolean).join(" · ");

  return (
    <div
      className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden"
      data-testid="my-team-today-card"
    >
      {/* Header — icon + title + global stats */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-gray-100 flex-wrap gap-2">
        <div className="inline-flex items-center gap-2 flex-wrap">
          <Users sx={{ fontSize: 16 }} className="text-[#ec9324]"/>
          <h3 className="font-semibold text-gray-900">My Team Today</h3>
          {teamsLabel && !isMultiTeam && (
            <span className="text-[11px] text-gray-500">· {teamsLabel}</span>
          )}
          {isMultiTeam && (
            <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">
              {orderedTeams.length} teams
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-bold">
          <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
            {counts.assigned} on site
          </span>
          {counts.requested > 0 && (
            <span className="text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
              {counts.requested} requested
            </span>
          )}
          <span className="text-gray-600 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full">
            {counts.off} off
          </span>
        </div>
      </div>

      {/* Team filter chips — only when the manager owns 2+ teams */}
      {isMultiTeam && (
        <div
          className="px-5 py-3 bg-gray-50/60 border-b border-gray-100 flex items-center gap-2 overflow-x-auto"
          data-testid="my-team-team-filter"
        >
          <FilterChip
            active={selectedTeamId === ALL_TEAMS}
            label="All Teams"
            sub={String(team.length)}
            onClick={() => { setSelectedTeamId(ALL_TEAMS); setExpanded(false); }}
            testId="team-chip-all"
          />
          {orderedTeams.map((t) => {
            const members = membersByTeam[t.id] || [];
            return (
              <FilterChip
                key={t.id}
                active={selectedTeamId === t.id}
                color={t.color || "#9ca3af"}
                label={t.name}
                sub={teamSummary(members)}
                onClick={() => { setSelectedTeamId(t.id); setExpanded(false); }}
                testId={`team-chip-${t.id}`}
              />
            );
          })}
        </div>
      )}

      {/* Body */}
      {team.length === 0 ? (
        <div className="px-5 py-8 text-center text-xs text-gray-400">
          No team members found for the team(s) you manage.
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-5 py-8 text-center text-xs text-gray-400">
          No members in this team today.
        </div>
      ) : isMultiTeam && selectedTeamId === ALL_TEAMS ? (
        // ------- Grouped layout (multi-team, All Teams selected) -------
        <div className="p-4 space-y-4">
          {orderedTeams.map((t) => {
            const members = membersByTeam[t.id] || [];
            if (members.length === 0) return null;
            return (
              <div key={t.id} data-testid={`team-group-${t.id}`}>
                {/* Team ribbon */}
                <div className="flex items-center gap-2 mb-2 px-1 flex-wrap">
                  <span
                    className="h-2 w-2 rounded-full flex-shrink-0"
                    style={{ background: t.color || "#9ca3af" }}
                  />
                  <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wider">
                    {t.name}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    · {members.length} member{members.length === 1 ? "" : "s"} · {teamSummary(members)}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {members.map((m) => (
                    <MemberCard key={m.id} m={m} teamColor={t.color} />
                  ))}
                </div>
              </div>
            );
          })}
          {/* Any orphan members whose team_id doesn't match any managed team */}
          {(() => {
            const knownIds = new Set(orderedTeams.map((t) => t.id));
            const orphans = team.filter((m) => !knownIds.has(m.team_id));
            if (orphans.length === 0) return null;
            return (
              <div data-testid="team-group-unassigned">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="h-2 w-2 rounded-full flex-shrink-0 bg-gray-400" />
                  <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wider">
                    {UNASSIGNED_TEAM.name}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    · {orphans.length} · {teamSummary(orphans)}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {orphans.map((m) => (
                    <MemberCard key={m.id} m={m} teamColor={UNASSIGNED_TEAM.color} />
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        // ------- Flat layout (single-team OR a team-focus chip selected) -------
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {shown.map((m) => (
            <MemberCard
              key={m.id}
              m={m}
              teamColor={teamColorById[m.team_id] || m.team_color}
            />
          ))}
        </div>
      )}

      {/* Show more toggle — only in flat layouts (grouped layout renders all).
          Hidden when we've grouped everything under All Teams. */}
      {filtered.length > COLLAPSED_LIMIT &&
        !(isMultiTeam && selectedTeamId === ALL_TEAMS) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full text-center py-2.5 text-xs font-semibold text-[#ec9324] hover:bg-orange-50 border-t border-gray-100 inline-flex items-center justify-center gap-1"
          data-testid="my-team-today-toggle"
        >
          {expanded ? (
            <>
              <ChevronUp sx={{ fontSize: 13 }}/> Show less
            </>
          ) : (
            <>
              <ChevronDown sx={{ fontSize: 13 }}/> Show {filtered.length - COLLAPSED_LIMIT} more member{filtered.length - COLLAPSED_LIMIT > 1 ? "s" : ""}
            </>
          )}
        </button>
      )}
    </div>
  );
}
