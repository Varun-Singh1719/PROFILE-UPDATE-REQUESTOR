import React, { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import Layout from "../components/Layout";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "../components/ui/dialog";
import notify from "../lib/notify";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import DeferredSearchInput from "../components/DeferredSearchInput";
import ViewTeamDrawer from "../components/ViewTeamDrawer";
import { Plus, Pencil, Users, Trash2, Sparkles, Check, X } from "lucide-react";
import { confirm as confirmDialog } from '../lib/dialog';
import { useEffectivePage } from "../context/EffectivePermissionsContext";
import {
  TEAM_PALETTES,
  teamBackground,
  suggestNextPalette,
  teamInitials,
} from "../lib/teamColors";

const EMPTY_FORM = {
  name: "",
  description: "",
  manager_ids: [],
  member_ids: [],
  color: "",
  initials: "",
};

// Strip to A-Z/0-9, uppercase, cap 2 chars — matches backend normaliser.
const sanitizeInitials = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2);

/* ── Chip primitive used to render selected managers / members with a remove x ── */
function SelectionChip({ label, sublabel, onRemove, tone = "member", testId }) {
  const toneCls =
    tone === "manager"
      ? "bg-[#ec9324]/10 text-[#ec9324] border-[#ec9324]/30"
      : "bg-gray-100 text-gray-700 border-gray-200";
  return (
    <span
      className={`inline-flex items-center gap-1.5 max-w-full text-xs font-medium rounded-full border ${toneCls} pl-2.5 pr-1 py-0.5`}
      data-testid={testId}
      title={sublabel ? `${label} — ${sublabel}` : label}
    >
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-black/10"
      >
        <X size={11} strokeWidth={2.5} />
      </button>
    </span>
  );
}

export default function TeamsPage() {
  // ── Permissions V3 (Round 3) ──
  const { fn: permFn } = useEffectivePage("manage", "teams");
  const permCreate = permFn("create");
  const permEdit   = permFn("edit");
  const permDelete = permFn("delete");
  const [teams, setTeams] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [usedColors, setUsedColors] = useState([]);

  // View drawer state
  const [viewOpen, setViewOpen] = useState(false);
  const [viewTeamId, setViewTeamId] = useState(null);

  const loadAll = async () => {
    const [t, e, cm] = await Promise.all([
      api.get("/teams"),
      api.get("/contacts"),
      api.get("/teams/colors"),
    ]);
    setTeams(t.data);
    setEmployees(e.data);
    setUsedColors(cm.data?.used || []);
  };

  useEffect(() => { loadAll(); }, []);

  // employee_id -> team they're a *member* of. Managers are NOT tracked here
  // because a manager may belong to multiple teams (per Jul-2026 spec).
  const memberTeamMap = useMemo(() => {
    const m = {};
    for (const t of teams) {
      for (const id of (t.member_ids || [])) m[id] = t;
    }
    return m;
  }, [teams]);

  // Quick lookup for chip labels
  const employeeById = useMemo(() => {
    const m = {};
    for (const e of employees) m[e.id] = e;
    return m;
  }, [employees]);

  const memberOptions = useMemo(
    () =>
      employees
        .filter((e) => e.status === "Active")
        .map((e) => {
          const team = memberTeamMap[e.id];
          const inOtherTeam = team && team.id !== editing?.id;
          return {
            value: e.id,
            label: e.name,
            meta: e.emp_id || "",
            disabled: !!inOtherTeam,
            disabledReason: inOtherTeam ? `Already in "${team.name}"` : "",
          };
        })
        // Sort: enabled first (alpha), then disabled (alpha) — keeps disabled rows
        // visible at the bottom of the list per spec.
        .sort((a, b) => {
          if (!!a.disabled === !!b.disabled) return a.label.localeCompare(b.label);
          return a.disabled ? 1 : -1;
        }),
    [employees, memberTeamMap, editing]
  );

  // Manager options: Manager/Admin/Super Admin role only.
  // Managers are NOT restricted by other teams (they can manage multiple teams).
  const managerOptions = useMemo(
    () =>
      employees
        .filter((e) => e.status === "Active" && (e.role === "Super Admin" || e.role === "Admin"))
        .map((e) => ({
          value: e.id,
          label: e.name,
          meta: e.emp_id || "",
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [employees]
  );

  const filteredTeams = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return teams;
    return teams.filter((t) => {
      if (t.name.toLowerCase().includes(q)) return true;
      if ((t.managers || []).some((m) => m.name.toLowerCase().includes(q))) return true;
      if ((t.members || []).some((m) => m.name.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [teams, search]);

  const openCreate = async () => {
    setEditing(null);
    // Always refetch the latest used colours right before opening so we never
    // auto-assign a palette id that another team has already taken.
    let freshUsed = usedColors;
    try {
      const { data } = await api.get("/teams/colors");
      freshUsed = data?.used || [];
      setUsedColors(freshUsed);
    } catch (_) { /* fall back to existing state */ }
    setForm({ ...EMPTY_FORM, color: suggestNextPalette(freshUsed) });
    setOpen(true);
  };

  const openEdit = (t) => {
    setEditing(t);
    setForm({
      name: t.name,
      description: t.description || "",
      manager_ids: t.manager_ids || [],
      member_ids: t.member_ids || [],
      color: t.color || suggestNextPalette(usedColors),
      initials: t.initials || "",
    });
    setOpen(true);
  };

  const openView = (t) => {
    setViewTeamId(t.id);
    setViewOpen(true);
  };

  // Wired to the Edit button *inside* the view drawer. Closes the drawer
  // first, then hops over to the edit dialog so the two never overlap.
  const editFromView = (team) => {
    setViewOpen(false);
    // Slight delay lets the sheet finish its slide-out before the dialog
    // fades in — feels less abrupt.
    setTimeout(() => openEdit(team), 180);
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editing) {
        await api.patch(`/teams/${editing.id}`, form);
        notify.success("Team updated");
      } else {
        await api.post("/teams", form);
        notify.success("Team created");
      }
      setOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      loadAll();
    } catch (err) {
      notify.error(err?.response?.data?.detail || "Failed");
    } finally {
      setLoading(false);
    }
  };

  const remove = async (t) => {
    const ok = await confirmDialog({ title: 'Delete team', message: `Delete team "${t.name}"?`, confirmLabel: 'Delete', confirmVariant: 'destructive' });
    if (!ok) return;
    try {
      await api.delete(`/teams/${t.id}`);
      notify.success("Team deleted");
      loadAll();
    } catch (e) {
      notify.error(e?.response?.data?.detail || "Failed");
    }
  };

  // Chip helpers
  const removeManager = (id) =>
    setForm((f) => ({ ...f, manager_ids: f.manager_ids.filter((x) => x !== id) }));
  const removeMember = (id) =>
    setForm((f) => ({ ...f, member_ids: f.member_ids.filter((x) => x !== id) }));

  return (
    <Layout
      title="Teams"
      actions={
        permCreate.isVisible ? (
        <Button
          onClick={openCreate}
          className="bg-[#ec9324] hover:bg-[#d4811f] text-white h-9"
          data-testid="add-team-btn"
          disabled={!permCreate.canUse}
        >
          <Plus size={16} className="mr-2" /> Add New Team
        </Button>
        ) : null
      }
    >
      <div className="sticky top-14 z-30 -mx-4 px-4 pt-1 pb-3 bg-gray-50/95 backdrop-blur">
      <div className="bg-white p-4 rounded-xl shadow-soft border border-gray-100">
        <DeferredSearchInput
          className="max-w-md"
          placeholder="Search teams by name, manager, or member…"
          testId="team-search"
          value={search}
          onCommit={setSearch}
        />
      </div>
      </div>

      <div className="mt-6 bg-white rounded-xl shadow-soft border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-14rem)] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 font-bold tracking-wider border-b border-gray-200 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left">Color</th>
                <th className="px-4 py-3 text-left">Team Name</th>
                <th className="px-4 py-3 text-left">Managers</th>
                <th className="px-4 py-3 text-left">Members</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTeams.map((t) => (
                <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50/80" data-testid={`team-row-${t.name}`}>
                  <td className="px-4 py-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white font-extrabold text-xs shadow-sm ring-1 ring-black/5"
                      style={{ background: teamBackground(t.color), letterSpacing: "0.02em" }}
                      data-testid={`team-swatch-${t.name}`}
                      aria-label={`Color for ${t.name}`}
                    >
                      {t.initials || teamInitials(t.name)}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900">
                    <button
                      type="button"
                      onClick={() => openView(t)}
                      className="text-left hover:text-[#ec9324] hover:underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-[#ec9324]/30 rounded"
                      data-testid={`team-name-${t.name}`}
                      aria-label={`View team ${t.name}`}
                    >
                      {t.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <div className="flex flex-wrap gap-1">
                      {(t.managers || []).map((m) => (
                        <span key={m.id} className="inline-flex items-center text-xs font-medium bg-[#ec9324]/10 text-[#ec9324] rounded px-2 py-0.5">
                          {m.name}
                        </span>
                      ))}
                      {(!t.managers || t.managers.length === 0) && <span className="text-gray-400 text-xs">No managers</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <div className="flex items-center gap-1.5 text-xs">
                      <Users size={14} className="text-gray-400" />
                      <span className="font-medium">{(t.members || []).length}</span>
                      {(t.members || []).slice(0, 3).map((m) => (
                        <span key={m.id} className="bg-gray-100 text-gray-700 rounded px-1.5 py-0.5">{m.name}</span>
                      ))}
                      {(t.members || []).length > 3 && (
                        <span className="text-gray-500">+{t.members.length - 3} more</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{t.created_on?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-2">
                      {permEdit.isVisible && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(t)}
                        data-testid={`edit-team-${t.name}`}
                        className="border-gray-300 text-gray-700 hover:bg-[#ec9324]/10 hover:text-[#ec9324] hover:border-[#ec9324] h-8 w-8 p-0"
                        aria-label="Edit team"
                        disabled={!permEdit.canUse}
                      >
                        <Pencil size={14} />
                      </Button>
                      )}
                      {permDelete.isVisible && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => remove(t)}
                        data-testid={`delete-team-${t.name}`}
                        className="border-gray-300 text-gray-700 hover:bg-red-50 hover:text-red-600 hover:border-red-300 h-8 w-8 p-0"
                        aria-label="Delete team"
                        disabled={!permDelete.canUse}
                      >
                        <Trash2 size={14} />
                      </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredTeams.length === 0 && <tr><td colSpan={6} className="text-center py-12 text-gray-400">{search ? "No teams match your search." : "No teams yet. Click \"Add New Team\" to create one."}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm(EMPTY_FORM); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Team" : "Add New Team"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-[1fr_96px] gap-3 items-start">
              <div>
                <Label htmlFor="team-name-input">Team Name *</Label>
                <Input
                  id="team-name-input"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. ProfiX North"
                  data-testid="team-name"
                />
              </div>
              <div>
                <Label htmlFor="team-initials-input">Initials</Label>
                <Input
                  id="team-initials-input"
                  value={form.initials}
                  onChange={(e) => setForm({ ...form, initials: sanitizeInitials(e.target.value) })}
                  placeholder={teamInitials(form.name)}
                  maxLength={2}
                  className="uppercase"
                  data-testid="team-initials"
                  aria-label="Team initials override"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="team-description-input">Description</Label>
              <Textarea
                id="team-description-input"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What does this team do?"
                rows={3}
                data-testid="team-description"
              />
            </div>

            <div>
              <Label>Manager(s)</Label>
              <MultiSelectFilter
                label="Managers"
                options={managerOptions}
                value={form.manager_ids}
                onChange={(v) => setForm({ ...form, manager_ids: v })}
                placeholder="Select one or more managers..."
                testIdPrefix="team-managers"
                hideLabelPrefix
                fullWidth
                showCountOnly
                countUnitLabel="manager(s) selected"
              />
              {form.manager_ids.length > 0 && (
                <div
                  className="flex flex-wrap gap-1.5 mt-2"
                  data-testid="team-managers-chips"
                >
                  {form.manager_ids
                    .map((id) => ({ id, emp: employeeById[id] }))
                    .sort((a, b) =>
                      (a.emp?.name || "").localeCompare(b.emp?.name || "")
                    )
                    .map(({ id, emp }) => (
                      <SelectionChip
                        key={id}
                        label={emp?.name || "Unknown"}
                        sublabel={emp?.emp_id}
                        tone="manager"
                        onRemove={() => removeManager(id)}
                        testId={`team-manager-chip-${id}`}
                      />
                    ))}
                </div>
              )}
            </div>

            <div>
              <Label>Team Members</Label>
              <MultiSelectFilter
                label="Members"
                options={memberOptions}
                value={form.member_ids}
                onChange={(v) => setForm({ ...form, member_ids: v })}
                placeholder="Select team members..."
                testIdPrefix="team-members"
                hideLabelPrefix
                fullWidth
                showCountOnly
                countUnitLabel="member(s) selected"
              />
              {form.member_ids.length > 0 && (
                <div
                  className="flex flex-wrap gap-1.5 mt-2"
                  data-testid="team-members-chips"
                >
                  {form.member_ids
                    .map((id) => ({ id, emp: employeeById[id] }))
                    .sort((a, b) =>
                      (a.emp?.name || "").localeCompare(b.emp?.name || "")
                    )
                    .map(({ id, emp }) => (
                      <SelectionChip
                        key={id}
                        label={emp?.name || "Unknown"}
                        sublabel={emp?.emp_id}
                        onRemove={() => removeMember(id)}
                        testId={`team-member-chip-${id}`}
                      />
                    ))}
                </div>
              )}
            </div>

            <div>
              <Label className="flex items-center gap-1.5">
                Team Colour
                {!editing && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-normal text-[#ec9324] bg-[#ec9324]/10 rounded px-1.5 py-0.5">
                    <Sparkles size={10}/> auto-assigned
                  </span>
                )}
              </Label>
              <div
                className="grid grid-cols-10 gap-2 max-h-56 overflow-y-auto p-1 -m-1 mt-2"
                data-testid="team-color-grid"
              >
                {TEAM_PALETTES.map((p) => {
                  const isCurrent = form.color === p.id;
                  const taken = usedColors.includes(p.id) && !isCurrent;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => { if (!taken) setForm({ ...form, color: p.id }); }}
                      disabled={taken}
                      data-testid={`team-color-${p.id}`}
                      title={taken ? "Already assigned to another team" : p.id}
                      className={`relative rounded-full overflow-hidden transition-all flex items-center justify-center font-extrabold text-white ring-2 ${
                        isCurrent ? "ring-[#ec9324] scale-110" : "ring-transparent hover:ring-gray-300"
                      } ${taken ? "opacity-30 cursor-not-allowed grayscale" : "cursor-pointer"}`}
                      style={{
                        width: 36, height: 36,
                        background: `linear-gradient(135deg, ${p.stops[0]} 0%, ${p.stops[1]} 100%)`,
                        fontSize: 11,
                        letterSpacing: "0.02em",
                      }}
                      aria-label={`Color ${p.id}${taken ? " (taken)" : ""}`}
                      aria-disabled={taken}
                    >
                      {form.initials || teamInitials(form.name)}
                      {isCurrent && (
                        <span className="absolute inset-0 bg-black/30 flex items-center justify-center rounded-full">
                          <Check size={14} className="text-white"/>
                        </span>
                      )}
                      {taken && (
                        <span className="absolute inset-0 flex items-center justify-center rounded-full">
                          <span className="block w-[70%] h-[2px] bg-white/90 rotate-45 rounded-full"/>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={loading} className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="submit-team-btn">
                {loading ? "Saving..." : editing ? "Save Changes" : "Create Team"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Right-side slide-out view drawer */}
      <ViewTeamDrawer
        open={viewOpen}
        onOpenChange={setViewOpen}
        teamId={viewTeamId}
        canEdit={permEdit.isVisible && permEdit.canUse}
        onEdit={editFromView}
      />
    </Layout>
  );
}
