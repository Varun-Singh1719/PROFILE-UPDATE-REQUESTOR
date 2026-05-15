import React, { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import Layout from "../components/Layout";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "../components/ui/select";
import { Checkbox } from "../components/ui/checkbox";
import { toast } from "sonner";
import { Shield, Plus, Trash2, Save, Info } from "lucide-react";

const SUBJECT_TYPES = ["Role", "Team", "Employee"];
const TABLES = ["tickets", "contacts", "teams", "permissions"];
const ACTIONS = ["view", "request", "edit"];

const EMPTY_RULE = {
  id: "",
  subject_type: "Role",
  subject_value: "",
  table: "tickets",
  actions: { view: true, request: false, edit: false },
};

export default function PermissionsPage() {
  const [rules, setRules] = useState([]);
  const [roles] = useState(["Admin", "Manager", "Research Associate", "DQ Team"]);
  const [teams, setTeams] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadAll = async () => {
    const [p, t, e] = await Promise.all([
      api.get("/permissions"),
      api.get("/teams"),
      api.get("/contacts"),
    ]);
    setRules((p.data?.rules || []).map((r, i) => ({ ...EMPTY_RULE, ...r, id: r.id || `r-${i}` })));
    setTeams(t.data || []);
    setEmployees(e.data || []);
  };

  useEffect(() => { loadAll(); }, []);

  const subjectOptions = (st) => {
    if (st === "Role") return roles.map((r) => ({ value: r, label: r }));
    if (st === "Team") return teams.map((t) => ({ value: t.id, label: t.name }));
    if (st === "Employee") return employees.map((e) => ({ value: e.id, label: `${e.name} (${e.email})` }));
    return [];
  };

  const addRule = () => {
    setRules((r) => [...r, { ...EMPTY_RULE, id: `r-${Date.now()}` }]);
  };

  const removeRule = (id) => setRules((r) => r.filter((x) => x.id !== id));

  const updateRule = (id, patch) =>
    setRules((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const toggleAction = (id, action) =>
    setRules((r) =>
      r.map((x) =>
        x.id === id ? { ...x, actions: { ...x.actions, [action]: !x.actions[action] } } : x
      )
    );

  const save = async () => {
    setSaving(true);
    try {
      // Validate
      for (const r of rules) {
        if (!r.subject_value) {
          toast.error(`Pick a subject for the ${r.subject_type} rule on ${r.table}`);
          setSaving(false);
          return;
        }
      }
      await api.put("/permissions", { rules });
      toast.success("Permissions saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <Shield size={26} className="text-[#ec9324]" /> Permissions
          </h1>
          <p className="text-gray-500 mt-1">Configure access on View / Request / Edit basis across roles, teams, employees and tables.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={addRule} variant="outline" data-testid="add-rule-btn" className="border-gray-300">
            <Plus size={16} className="mr-1" /> Add Rule
          </Button>
          <Button onClick={save} disabled={saving} className="bg-[#ec9324] hover:bg-[#d4811f] text-white" data-testid="save-permissions-btn">
            <Save size={16} className="mr-1" /> {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-100 flex items-start gap-2 text-sm text-blue-800">
        <Info size={16} className="mt-0.5 flex-shrink-0" />
        <div>
          Configure permissions in a flexible matrix. Rules are stored centrally — enforcement on resources will be enabled in a follow-up release.
        </div>
      </div>

      <div className="mt-6 bg-white rounded-xl shadow-soft border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 font-bold tracking-wider border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left w-36">Subject Type</th>
                <th className="px-4 py-3 text-left w-56">Subject</th>
                <th className="px-4 py-3 text-left w-40">Table</th>
                <th className="px-4 py-3 text-center w-20">View</th>
                <th className="px-4 py-3 text-center w-20">Request</th>
                <th className="px-4 py-3 text-center w-20">Edit</th>
                <th className="px-4 py-3 text-right w-20"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50/60" data-testid={`rule-row-${r.id}`}>
                  <td className="px-4 py-3">
                    <Select
                      value={r.subject_type}
                      onValueChange={(v) => updateRule(r.id, { subject_type: v, subject_value: "" })}
                    >
                      <SelectTrigger data-testid={`rule-subject-type-${r.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SUBJECT_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={r.subject_value}
                      onValueChange={(v) => updateRule(r.id, { subject_value: v })}
                    >
                      <SelectTrigger data-testid={`rule-subject-${r.id}`}>
                        <SelectValue placeholder={`Select ${r.subject_type.toLowerCase()}...`} />
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        {subjectOptions(r.subject_type).map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={r.table}
                      onValueChange={(v) => updateRule(r.id, { table: v })}
                    >
                      <SelectTrigger data-testid={`rule-table-${r.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TABLES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  {ACTIONS.map((act) => (
                    <td key={act} className="px-4 py-3 text-center">
                      <Checkbox
                        checked={!!r.actions?.[act]}
                        onCheckedChange={() => toggleAction(r.id, act)}
                        data-testid={`rule-${r.id}-${act}`}
                        className="data-[state=checked]:bg-[#ec9324] data-[state=checked]:border-[#ec9324]"
                      />
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => removeRule(r.id)}
                      data-testid={`remove-rule-${r.id}`}
                      className="border-gray-300 text-gray-700 hover:bg-red-50 hover:text-red-600 hover:border-red-300 h-8 w-8 p-0"
                      aria-label="Remove rule"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
              {rules.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">
                    No permission rules yet. Click "Add Rule" to define access.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
