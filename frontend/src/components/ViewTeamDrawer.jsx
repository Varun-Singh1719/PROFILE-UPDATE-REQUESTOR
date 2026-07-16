/**
 * ViewTeamDrawer — right-side slide-out sheet showing a team's details.
 *
 * Fetches the freshest data from GET /api/teams/{id} on open so counts,
 * managers/members, description and audit fields are always current.
 *
 * Props:
 *   open, onOpenChange, teamId
 *   onEdit(team)  — callback wired to the "Edit" button in the top-right.
 *                   The parent is expected to close this drawer and open the
 *                   edit dialog in the same flow.
 */
import React, { useEffect, useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "./ui/sheet";
import { Button } from "./ui/button";
import { Pencil, Users, UserCog, Calendar, User as UserIcon } from "lucide-react";
import api from "../lib/api";
import notify from "../lib/notify";
import { teamBackground, teamInitials } from "../lib/teamColors";

const fmtDateTime = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

const NameChip = ({ name, tone = "member" }) => (
  <span
    className={`inline-flex items-center text-xs font-medium rounded px-2 py-1 ${
      tone === "manager"
        ? "bg-[#ec9324]/10 text-[#ec9324] border border-[#ec9324]/20"
        : "bg-gray-100 text-gray-700 border border-gray-200"
    }`}
    title={name}
  >
    {name}
  </span>
);

const SectionTitle = ({ icon: Icon, children, count }) => (
  <div className="flex items-center gap-2 mb-2">
    {Icon && <Icon size={14} className="text-gray-500" />}
    <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-600">
      {children}
    </h3>
    {typeof count === "number" && (
      <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">
        {count}
      </span>
    )}
  </div>
);

const MetaLine = ({ label, value }) => (
  <div className="flex items-start justify-between gap-3 py-1.5 text-xs">
    <span className="text-gray-500">{label}</span>
    <span className="text-gray-800 font-medium text-right break-words">{value ?? "—"}</span>
  </div>
);

export default function ViewTeamDrawer({ open, onOpenChange, teamId, onEdit, canEdit = true }) {
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !teamId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/teams/${teamId}`);
        if (!cancelled) setTeam(data);
      } catch (e) {
        if (!cancelled) {
          notify.error(e?.response?.data?.detail || "Failed to load team");
          onOpenChange?.(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, teamId, onOpenChange]);

  // Reset team when drawer closes so re-opening always shows a spinner (avoids
  // flashing a stale team when switching between rows).
  useEffect(() => {
    if (!open) setTeam(null);
  }, [open]);

  const managers = team?.managers || [];
  const members  = team?.members || [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md md:max-w-lg p-0 bg-white overflow-hidden flex flex-col"
        data-testid="view-team-drawer"
      >
        {/* Header (sticky) */}
        <div className="border-b border-gray-200 px-6 pt-5 pb-4 bg-gradient-to-b from-gray-50 to-white shrink-0">
          <SheetHeader className="pr-10">
            <SheetTitle asChild>
              <div className="flex items-start gap-3">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-white font-extrabold text-sm shadow-sm ring-1 ring-black/5 shrink-0"
                  style={{ background: team ? teamBackground(team.color) : "#9ca3af" }}
                >
                  {team ? (team.initials || teamInitials(team.name)) : "…"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Team
                  </div>
                  <div
                    className="text-lg font-bold text-gray-900 truncate"
                    data-testid="view-team-name"
                    title={team?.name}
                  >
                    {team?.name || (loading ? "Loading…" : "—")}
                  </div>
                </div>
                {canEdit && (
                  <Button
                    size="sm"
                    onClick={() => team && onEdit?.(team)}
                    disabled={!team}
                    className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-8"
                    data-testid="view-team-edit-btn"
                  >
                    <Pencil size={14} className="mr-1.5" /> Edit
                  </Button>
                )}
              </div>
            </SheetTitle>
          </SheetHeader>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {!team && !loading && (
            <div className="text-center text-gray-400 py-12 text-sm">No team selected.</div>
          )}
          {loading && !team && (
            <div className="space-y-3 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-1/2" />
              <div className="h-4 bg-gray-100 rounded w-3/4" />
              <div className="h-4 bg-gray-100 rounded w-1/3" />
            </div>
          )}

          {team && (
            <>
              {/* Description */}
              <section>
                <SectionTitle>Description</SectionTitle>
                <p
                  className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed"
                  data-testid="view-team-description"
                >
                  {team.description?.trim() || (
                    <span className="text-gray-400 italic">No description provided.</span>
                  )}
                </p>
              </section>

              {/* Managers */}
              <section>
                <SectionTitle icon={UserCog} count={managers.length}>Managers</SectionTitle>
                <div className="flex flex-wrap gap-1.5" data-testid="view-team-managers">
                  {managers.length === 0 && (
                    <span className="text-xs text-gray-400 italic">No managers assigned.</span>
                  )}
                  {managers.map((m) => (
                    <NameChip key={m.id} name={m.name} tone="manager" />
                  ))}
                </div>
              </section>

              {/* Members */}
              <section>
                <SectionTitle icon={Users} count={members.length}>Team Members</SectionTitle>
                <div className="flex flex-wrap gap-1.5" data-testid="view-team-members">
                  {members.length === 0 && (
                    <span className="text-xs text-gray-400 italic">No members yet.</span>
                  )}
                  {members.map((m) => (
                    <NameChip key={m.id} name={m.name} />
                  ))}
                </div>
              </section>

              {/* Counts */}
              <section className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                    <UserCog size={12} /> Total Managers
                  </div>
                  <div
                    className="text-xl font-bold text-gray-900"
                    data-testid="view-team-total-managers"
                  >
                    {managers.length}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                    <Users size={12} /> Total Members
                  </div>
                  <div
                    className="text-xl font-bold text-gray-900"
                    data-testid="view-team-total-members"
                  >
                    {members.length}
                  </div>
                </div>
              </section>

              {/* Audit */}
              <section className="rounded-lg border border-gray-200 divide-y divide-gray-100 bg-white">
                <div className="px-3 py-2 bg-gray-50 rounded-t-lg">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                    <Calendar size={12} /> Audit
                  </div>
                </div>
                <div className="px-3 py-2">
                  <MetaLine
                    label="Created by"
                    value={
                      <span className="inline-flex items-center gap-1">
                        <UserIcon size={12} className="text-gray-400" />
                        {team.created_by?.name || "System"}
                      </span>
                    }
                  />
                  <MetaLine label="Created on" value={fmtDateTime(team.created_on)} />
                  <MetaLine
                    label="Updated by"
                    value={
                      <span className="inline-flex items-center gap-1">
                        <UserIcon size={12} className="text-gray-400" />
                        {team.updated_by?.name || team.created_by?.name || "—"}
                      </span>
                    }
                  />
                  <MetaLine label="Updated on" value={fmtDateTime(team.updated_on)} />
                </div>
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
