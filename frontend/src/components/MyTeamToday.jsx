/**
 * MyTeamToday — Manager-only card. Shows every member of the teams the
 * current user manages together with their seat status for today:
 *   • assigned  → green pill + seat label
 *   • requested → amber pill + "Awaiting approval"
 *   • off       → grey pill + "Not on site today"
 *
 * Rendered only when `dashboard.is_manager` is true.
 */
import React, { useMemo, useState } from "react";
import { Users, MapPin, Hourglass, Home, ChevronDown, ChevronUp } from "lucide-react";
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

export default function MyTeamToday({ team = [], managedTeams = [] }) {
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(() => {
    const c = { assigned: 0, requested: 0, off: 0 };
    for (const m of team) c[m.status] = (c[m.status] || 0) + 1;
    return c;
  }, [team]);

  const shown = expanded ? team : team.slice(0, COLLAPSED_LIMIT);
  const teamsLabel = managedTeams.map((t) => t.name).filter(Boolean).join(" · ");

  return (
    <div
      className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden"
      data-testid="my-team-today-card"
    >
      <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-gray-100 flex-wrap gap-2">
        <div className="inline-flex items-center gap-2 flex-wrap">
          <Users size={16} className="text-[#ec9324]" />
          <h3 className="font-semibold text-gray-900">My Team Today</h3>
          {teamsLabel && (
            <span className="text-[11px] text-gray-500">· {teamsLabel}</span>
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

      {team.length === 0 ? (
        <div className="px-5 py-8 text-center text-xs text-gray-400">
          No team members found for the team(s) you manage.
        </div>
      ) : (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {shown.map((m) => (
            <div
              key={m.id}
              className={`rounded-xl border p-3 hover:border-[#ec9324] transition-colors ${
                m.status === "requested" ? "border-amber-200 bg-amber-50/40" :
                m.status === "off"       ? "border-gray-200 bg-gray-50/40" :
                                           "border-gray-200"
              }`}
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
                    <MapPin size={12} className="text-[#ec9324] flex-shrink-0" />
                    <span className="truncate">{m.seat_label || "Seat"}</span>
                    {m.team_name && (
                      <>
                        <span className="text-gray-300 mx-0.5">·</span>
                        <span className="inline-flex items-center gap-1 truncate">
                          <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: m.team_color || "#9ca3af" }} />
                          {m.team_name}
                        </span>
                      </>
                    )}
                  </>
                )}
                {m.status === "requested" && (
                  <>
                    <Hourglass size={12} className="text-amber-600 flex-shrink-0" />
                    <span className="truncate">
                      Awaiting approval{m.seat_label ? ` · ${m.seat_label}` : ""}
                    </span>
                  </>
                )}
                {m.status === "off" && (
                  <>
                    <Home size={12} className="text-gray-400 flex-shrink-0" />
                    <span className="truncate">Not on site today</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {team.length > COLLAPSED_LIMIT && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full text-center py-2.5 text-xs font-semibold text-[#ec9324] hover:bg-orange-50 border-t border-gray-100 inline-flex items-center justify-center gap-1"
          data-testid="my-team-today-toggle"
        >
          {expanded ? (
            <>
              <ChevronUp size={13} /> Show less
            </>
          ) : (
            <>
              <ChevronDown size={13} /> Show {team.length - COLLAPSED_LIMIT} more member{team.length - COLLAPSED_LIMIT > 1 ? "s" : ""}
            </>
          )}
        </button>
      )}
    </div>
  );
}
