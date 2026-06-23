import React, { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import Layout from "../components/Layout";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "../components/ui/dialog";
import notify from "../lib/notify";
import MultiSelect from "../components/MultiSelect";
import { Plus, Pencil, Users, Trash2, Search, Sparkles, Check } from "lucide-react";
import {
  TEAM_PALETTES,
  teamBackground,
  suggestNextPalette,
  teamInitials,
} from "../lib/teamColors";

const EMPTY_FORM = { name: "", manager_ids: [], member_ids: [], color: "" };

export default function TeamsPage() {
  const [teams, setTeams] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [usedColors, setUsedColors] = useState([]);

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

  // employee_id -> team they belong to (for disabling in MultiSelect)
  const employeeTeamMap = useMemo(() => {
    const m = {};
    for (const t of teams) {
      for (const id of (t.member_ids || [])) m[id] = t;
      for (const id of (t.manager_ids || [])) m[id] = t;
    }
    return m;
  }, [teams]);

  const memberOptions = useMemo(
    () =>
      employees
        .filter((e) => e.status === "Active")
        .map((e) => {
          const team = employeeTeamMap[e.id];
          const inOtherTeam = team && team.id !== editing?.id;
          return {
            value: e.id,
            label: e.name,
            sublabel: `${e.role} • ${e.email}`,
            disabled: !!inOtherTeam,
            disabledReason: inOtherTeam ? `Already assigned to "${team.name}"` : "",
          };
        }),
    [employees, employeeTeamMap, editing]
  );

  // Manager options: Manager or Admin role only
  const managerOptions = useMemo(
    () =>
      employees
        .filter((e) => e.status === "Active" && (e.role === "Super Admin" || e.role === "Admin"))
        .map((e) => {
          const team = employeeTeamMap[e.id];
          const inOtherTeam = team && team.id !== editing?.id;
          return {
            value: e.id,
            label: e.name,
            sublabel: `${e.role} • ${e.email}`,
            disabled: !!inOtherTeam,
            disabledReason: inOtherTeam ? `Already manages "${team.name}"` : "",
          };
        }),
    [employees, employeeTeamMap, editing]
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

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, color: suggestNextPalette(usedColors) });
    setOpen(true);
  };

  const openEdit = (t) => {
    setEditing(t);
    setForm({
      name: t.name,
      manager_ids: t.manager_ids || [],
      member_ids: t.member_ids || [],
      color: t.color || suggestNextPalette(usedColors),
    });
    setOpen(true);
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
    if (!window.confirm(`Delete team "${t.name}"?`)) return;
    try {
      await api.delete(`/teams/${t.id}`);
      notify.success("Team deleted");
      loadAll();
    } catch (e) {
      notify.error(e?.response?.data?.detail || "Failed");
    }
  };

  return (
    <Layout>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Teams</h1>
          <p className="text-gray-500 mt-1">Organize employees into teams with managers and members.</p>
        </div>
        <Button onClick={openCreate} className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="add-team-btn">
          <Plus size={16} className="mr-2" /> Add New Team
        </Button>
      </div>

      <div className="mt-6 bg-white p-4 rounded-xl shadow-soft border border-gray-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16}/>
          <Input
            placeholder="Search teams by name, manager, or member…"
            className="pl-9 max-w-md"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="team-search"
          />
        </div>
      </div>

      <div className="mt-6 bg-white rounded-xl shadow-soft border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 font-bold tracking-wider border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left">Color</th>
                <th className="px-4 py-3 text-left">Team Name</th>
                <th className="px-4 py-3 text-left">Managers</th>
                <th className="px-4 py-3 text-left">Members</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-right">Edit</th>
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
                      {teamInitials(t.name)}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900">{t.name}</td>
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(t)}
                        data-testid={`edit-team-${t.name}`}
                        className="border-gray-300 text-gray-700 hover:bg-[#ec9324]/10 hover:text-[#ec9324] hover:border-[#ec9324] h-8 w-8 p-0"
                        aria-label="Edit team"
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => remove(t)}
                        data-testid={`delete-team-${t.name}`}
                        className="border-gray-300 text-gray-700 hover:bg-red-50 hover:text-red-600 hover:border-red-300 h-8 w-8 p-0"
                        aria-label="Delete team"
                      >
                        <Trash2 size={14} />
                      </Button>
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Team" : "Add New Team"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>Team Name *</Label>
              <Input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. ProfiX North"
                data-testid="team-name"
              />
            </div>
            <div>
              <Label>Manager(s)</Label>
              <MultiSelect
                options={managerOptions}
                value={form.manager_ids}
                onChange={(v) => setForm({ ...form, manager_ids: v })}
                placeholder="Select one or more managers..."
                testId="team-managers"
              />
            </div>
            <div>
              <Label>Team Members</Label>
              <MultiSelect
                options={memberOptions}
                value={form.member_ids}
                onChange={(v) => setForm({ ...form, member_ids: v })}
                placeholder="Select team members..."
                testId="team-members"
              />
              <div className="text-xs text-gray-500 mt-1">An employee can belong to only one team. Members already assigned elsewhere appear greyed out.</div>
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
              <div className="text-xs text-gray-500 mt-1 mb-2">
                Pick a two-shade gradient for <span className="font-semibold">{form.name || "your team"}</span>.
                Colours already assigned to other teams are locked.
              </div>
              <div
                className="grid grid-cols-10 gap-2 max-h-56 overflow-y-auto p-1 -m-1"
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
                      {teamInitials(form.name)}
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
              <div className="text-[11px] text-gray-500 mt-2">
                {TEAM_PALETTES.length}+ two-shade gradients available. A new team auto-picks the next unused shade — you can override before saving. Each colour can belong to only one team.
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
    </Layout>
  );
}
