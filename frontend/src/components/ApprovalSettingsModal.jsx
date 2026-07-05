/**
 * ApprovalSettingsModal — Auto-Approval configuration matrix.
 *
 * Updated Jul 2026:
 *   • Recurring Request row removed.
 *   • Added Date and Time criteria, each rendered as a per-cell settings gear.
 *   • Date gear opens a Date Filter dialog (Between / On / Before / After).
 *   • Time gear opens a Time Filter dialog (On / Before / After / Between,
 *     with HH:MM inputs).
 *   • Configured rules display a small summary chip next to the gear.
 *   • Rules combine via OR: any configured criterion that matches an incoming
 *     request auto-approves it (matches current backend behaviour).
 */
import React, { useEffect, useMemo, useState } from "react";
import { X, RotateCcw, Save, CheckSquare, Square, Info, Settings, Calendar as CalendarIcon, Clock } from "lucide-react";
import api from "../lib/api";
import notify from "../lib/notify";
import { Calendar } from "./ui/calendar";
import { Dialog, DialogContent } from "./ui/dialog";
import { Button } from "./ui/button";

// Column definition — add future resources here.
const RESOURCES = [
  { key: "workstation",  label: "Workstation",   enforced: true  },
  { key: "meeting_room", label: "Meeting Room",  enforced: false },
];

// Bool criteria (checkbox cells)
const BOOL_CRITERIA = [
  { key: "team_member", label: "Team Member Request" },
  { key: "manager",     label: "Manager Request" },
];

// Configurable criteria (gear cells)
const CONFIG_CRITERIA = [
  { key: "date", label: "Date", icon: CalendarIcon },
  { key: "time", label: "Time", icon: Clock },
];

const EMPTY_DATE = () => ({ enabled: false, mode: "on", from: null, to: null });
const EMPTY_TIME = () => ({ enabled: false, operator: "on", from: null, to: null });

const emptyRow = () => ({
  team_member: false,
  manager: false,
  date: EMPTY_DATE(),
  time: EMPTY_TIME(),
});

const emptyMatrix = () =>
  RESOURCES.reduce((acc, r) => ({ ...acc, [r.key]: emptyRow() }), {});

// ---------- formatters for summary chips ----------
function fmtISOtoShort(iso) {
  if (!iso) return "";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return iso; }
}
function summarizeDate(rule) {
  if (!rule || !rule.enabled) return "";
  const f = fmtISOtoShort(rule.from);
  const t = fmtISOtoShort(rule.to);
  if (rule.mode === "on")      return f ? `On ${f}` : "";
  if (rule.mode === "before")  return f ? `Before ${f}` : "";
  if (rule.mode === "after")   return f ? `After ${f}` : "";
  if (rule.mode === "between") return f ? (t ? `${f} → ${t}` : `From ${f}`) : "";
  return "";
}
function summarizeTime(rule) {
  if (!rule || !rule.enabled) return "";
  const f = rule.from || "";
  const t = rule.to || "";
  if (rule.operator === "on")      return f ? `At ${f}` : "";
  if (rule.operator === "before")  return f ? `Before ${f}` : "";
  if (rule.operator === "after")   return f ? `After ${f}` : "";
  if (rule.operator === "between") return f ? (t ? `${f}–${t}` : `From ${f}`) : "";
  return "";
}

// ---------- Sub-dialog: Date rule ----------
function DateRuleDialog({ open, onOpenChange, resourceLabel, value, onSave }) {
  const [draft, setDraft] = useState(value || EMPTY_DATE());
  useEffect(() => { if (open) setDraft(value || EMPTY_DATE()); }, [open, value]);
  const mode = draft.mode || "on";
  const fromDate = draft.from ? new Date(draft.from + "T00:00:00") : null;
  const toDate = draft.to ? new Date(draft.to + "T00:00:00") : null;
  const toISO = (d) => {
    if (!d) return null;
    const dt = new Date(d);
    const p = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden" data-testid="approval-date-rule-dialog">
        <div className="px-6 pt-5 pb-3 border-b border-gray-100">
          <h4 className="text-base font-semibold text-gray-900">Auto-Approve by Date — {resourceLabel}</h4>
          <p className="text-xs text-gray-500 mt-0.5">Requests whose booking date matches this rule will be auto-approved.</p>
        </div>
        <div className="flex gap-2 px-6 border-b border-gray-100 pt-3">
          {["between", "on", "before", "after"].map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`approval-date-mode-${m}`}
              onClick={() => setDraft({ ...draft, mode: m, to: m === "between" ? draft.to : null })}
              className={`px-4 py-2 text-sm font-medium relative ${
                mode === m ? "text-[#ec9324]" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
              {mode === m && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-[#ec9324] rounded-full" />}
            </button>
          ))}
        </div>
        <div className="px-6 py-5">
          {mode === "between" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-xs font-medium text-gray-600 mb-2">From</div>
                <Calendar mode="single" selected={fromDate || undefined}
                  onSelect={(d) => setDraft({ ...draft, from: toISO(d) })} initialFocus />
              </div>
              <div>
                <div className="text-xs font-medium text-gray-600 mb-2">To</div>
                <Calendar mode="single" selected={toDate || undefined}
                  onSelect={(d) => setDraft({ ...draft, to: toISO(d) })} />
              </div>
            </div>
          ) : (
            <div className="max-w-md">
              <div className="text-xs font-medium text-gray-600 mb-2">
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </div>
              <Calendar mode="single" selected={fromDate || undefined}
                onSelect={(d) => setDraft({ ...draft, from: toISO(d) })} initialFocus />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50/60">
          <Button variant="outline" onClick={() => { onSave(EMPTY_DATE()); onOpenChange(false); }}
            data-testid="approval-date-clear" className="rounded-md">Clear rule</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-md">Cancel</Button>
            <Button onClick={() => { onSave({ ...draft, enabled: !!draft.from }); onOpenChange(false); }}
              data-testid="approval-date-save"
              className="bg-[#ec9324] hover:bg-[#d4811f] text-white rounded-md">Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Sub-dialog: Time rule ----------
function TimeRuleDialog({ open, onOpenChange, resourceLabel, value, onSave }) {
  const [draft, setDraft] = useState(value || EMPTY_TIME());
  useEffect(() => { if (open) setDraft(value || EMPTY_TIME()); }, [open, value]);
  const op = draft.operator || "on";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden" data-testid="approval-time-rule-dialog">
        <div className="px-6 pt-5 pb-3 border-b border-gray-100">
          <h4 className="text-base font-semibold text-gray-900">Auto-Approve by Time — {resourceLabel}</h4>
          <p className="text-xs text-gray-500 mt-0.5">Requests whose booking time (or submission time for workstations) matches will be auto-approved.</p>
        </div>
        <div className="flex gap-2 px-6 border-b border-gray-100 pt-3">
          {["on", "before", "after", "between"].map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`approval-time-op-${m}`}
              onClick={() => setDraft({ ...draft, operator: m, to: m === "between" ? draft.to : null })}
              className={`px-4 py-2 text-sm font-medium relative ${
                op === m ? "text-[#ec9324]" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
              {op === m && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-[#ec9324] rounded-full" />}
            </button>
          ))}
        </div>
        <div className="px-6 py-5">
          {op === "between" ? (
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="text-xs font-medium text-gray-600">From</span>
                <input
                  type="time"
                  value={draft.from || ""}
                  onChange={(e) => setDraft({ ...draft, from: e.target.value || null })}
                  className="mt-1 w-full h-10 rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#ec9324]/30 focus:border-[#ec9324]"
                  data-testid="approval-time-from"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">To</span>
                <input
                  type="time"
                  value={draft.to || ""}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value || null })}
                  className="mt-1 w-full h-10 rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#ec9324]/30 focus:border-[#ec9324]"
                  data-testid="approval-time-to"
                />
              </label>
            </div>
          ) : (
            <label className="block max-w-xs">
              <span className="text-xs font-medium text-gray-600">
                {op === "on" ? "At exactly" : op.charAt(0).toUpperCase() + op.slice(1)}
              </span>
              <input
                type="time"
                value={draft.from || ""}
                onChange={(e) => setDraft({ ...draft, from: e.target.value || null })}
                className="mt-1 w-full h-10 rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#ec9324]/30 focus:border-[#ec9324]"
                data-testid="approval-time-from"
              />
            </label>
          )}
        </div>
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50/60">
          <Button variant="outline" onClick={() => { onSave(EMPTY_TIME()); onOpenChange(false); }}
            data-testid="approval-time-clear" className="rounded-md">Clear rule</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-md">Cancel</Button>
            <Button onClick={() => { onSave({ ...draft, enabled: !!draft.from }); onOpenChange(false); }}
              data-testid="approval-time-save"
              className="bg-[#ec9324] hover:bg-[#d4811f] text-white rounded-md">Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Main Modal ----------
export default function ApprovalSettingsModal({ open, onClose, initial, onSaved }) {
  const [enabled, setEnabled] = useState(false);
  const [matrix, setMatrix] = useState(emptyMatrix());
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  // Sub-dialog state
  const [editingRule, setEditingRule] = useState(null); // { resource, criterion } | null

  useEffect(() => {
    if (!open) return;
    setEnabled(Boolean(initial?.enabled));
    const merged = emptyMatrix();
    for (const r of RESOURCES) {
      const src = (initial?.matrix?.[r.key]) || {};
      merged[r.key] = {
        team_member: !!src.team_member,
        manager: !!src.manager,
        date: { ...EMPTY_DATE(), ...(src.date || {}) },
        time: { ...EMPTY_TIME(), ...(src.time || {}) },
      };
    }
    setMatrix(merged);
  }, [open, initial]);

  if (!open) return null;

  const toggleCell = (res, crit) => {
    setMatrix((m) => ({ ...m, [res]: { ...m[res], [crit]: !m[res][crit] } }));
  };

  const columnAllChecked = (res) => {
    const row = matrix[res] || {};
    return (
      BOOL_CRITERIA.every((c) => row[c.key]) &&
      !!row.date?.enabled && !!row.time?.enabled
    );
  };
  const toggleColumnAll = (res) => {
    const next = !columnAllChecked(res);
    setMatrix((m) => ({
      ...m,
      [res]: {
        team_member: next,
        manager: next,
        // For date/time we only toggle the enabled flag (values preserved)
        date: { ...(m[res].date || EMPTY_DATE()), enabled: next && !!m[res].date?.from },
        time: { ...(m[res].time || EMPTY_TIME()), enabled: next && !!m[res].time?.from },
      },
    }));
  };

  const allChecked = RESOURCES.every((r) => columnAllChecked(r.key));
  const toggleAll = () => {
    const next = !allChecked;
    const nxt = {};
    for (const r of RESOURCES) {
      const row = matrix[r.key] || emptyRow();
      nxt[r.key] = {
        team_member: next,
        manager: next,
        date: { ...(row.date || EMPTY_DATE()), enabled: next && !!row.date?.from },
        time: { ...(row.time || EMPTY_TIME()), enabled: next && !!row.time?.from },
      };
    }
    setMatrix(nxt);
  };

  const doReset = async () => {
    setResetting(true);
    try {
      const { data } = await api.post("/approval-settings/reset");
      setEnabled(Boolean(data.enabled));
      const merged = emptyMatrix();
      for (const r of RESOURCES) {
        const src = (data.matrix?.[r.key]) || {};
        merged[r.key] = {
          team_member: !!src.team_member,
          manager: !!src.manager,
          date: { ...EMPTY_DATE(), ...(src.date || {}) },
          time: { ...EMPTY_TIME(), ...(src.time || {}) },
        };
      }
      setMatrix(merged);
      notify.success("Approval settings reset to defaults");
      onSaved?.(data);
    } catch (e) {
      notify.error(e, { what: "Reset approval settings" });
    } finally {
      setResetting(false);
    }
  };

  const doSave = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/approval-settings", { enabled, matrix });
      notify.success("Approval settings saved");
      onSaved?.(data);
      onClose?.();
    } catch (e) {
      notify.error(e, { what: "Save approval settings" });
    } finally {
      setSaving(false);
    }
  };

  const editingResource = editingRule ? RESOURCES.find(r => r.key === editingRule.resource) : null;
  const editingValue = editingRule ? matrix[editingRule.resource]?.[editingRule.criterion] : null;

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4"
      data-testid="approval-settings-modal"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Approval Configuration</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Choose which request types are auto-approved when Auto Approval is ON.
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-md inline-flex items-center justify-center text-gray-500 hover:bg-gray-100"
            aria-label="Close"
            data-testid="settings-close-btn"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto">
          {/* Master toggle + Select all */}
          <div className="flex items-center justify-between mb-4">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-[#ec9324] focus:ring-[#ec9324]"
                data-testid="settings-master-enabled"
              />
              <span className="text-sm font-medium text-gray-900">Auto Approval enabled</span>
            </label>
            <button
              onClick={toggleAll}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50"
              data-testid="settings-select-all"
              type="button"
            >
              {allChecked ? <CheckSquare size={14} /> : <Square size={14} />}
              Select all (Entire Matrix)
            </button>
          </div>

          {/* Matrix */}
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-gray-700 w-[45%]">Approval Criteria</th>
                  {RESOURCES.map((r) => (
                    <th
                      key={r.key}
                      className="text-center px-3 py-2 font-semibold text-gray-700"
                      data-testid={`settings-col-${r.key}`}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span>{r.label}</span>
                        {!r.enforced && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 inline-flex items-center gap-1">
                            <Info size={10} /> Config only
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleColumnAll(r.key)}
                          className="text-[10px] font-normal text-[#ec9324] hover:underline"
                          data-testid={`settings-col-select-all-${r.key}`}
                        >
                          {columnAllChecked(r.key) ? "Deselect all" : "Select all"}
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Bool criteria rows */}
                {BOOL_CRITERIA.map((c, ci) => (
                  <tr key={c.key} className={ci % 2 ? "bg-white" : "bg-gray-50/40"}>
                    <td className="px-3 py-3">
                      <div className="font-medium text-gray-900 text-sm">{c.label}</div>
                    </td>
                    {RESOURCES.map((r) => (
                      <td key={r.key} className="text-center px-3 py-3 align-middle">
                        <input
                          type="checkbox"
                          checked={!!matrix[r.key]?.[c.key]}
                          onChange={() => toggleCell(r.key, c.key)}
                          className="h-4 w-4 rounded border-gray-300 text-[#ec9324] focus:ring-[#ec9324]"
                          data-testid={`settings-cell-${r.key}-${c.key}`}
                          aria-label={`${c.label} for ${r.label}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
                {/* Configurable criteria rows (Date, Time) */}
                {CONFIG_CRITERIA.map((c, ci) => {
                  const stripeIdx = BOOL_CRITERIA.length + ci;
                  const Icon = c.icon;
                  return (
                    <tr key={c.key} className={stripeIdx % 2 ? "bg-white" : "bg-gray-50/40"}>
                      <td className="px-3 py-3">
                        <div className="font-medium text-gray-900 text-sm inline-flex items-center gap-1.5">
                          <Icon size={13} className="text-gray-500" />
                          {c.label}
                        </div>
                      </td>
                      {RESOURCES.map((r) => {
                        const rule = matrix[r.key]?.[c.key];
                        const summary = c.key === "date" ? summarizeDate(rule) : summarizeTime(rule);
                        const configured = !!summary;
                        return (
                          <td key={r.key} className="text-center px-3 py-3 align-middle">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setEditingRule({ resource: r.key, criterion: c.key })}
                                className={`inline-flex items-center justify-center h-7 w-7 rounded-md border transition-colors ${
                                  configured && rule?.enabled
                                    ? "border-[#ec9324] bg-[#ec9324]/10 text-[#ec9324]"
                                    : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                                }`}
                                data-testid={`settings-cell-${r.key}-${c.key}`}
                                aria-label={`Configure ${c.label} for ${r.label}`}
                                title={`Configure ${c.label}`}
                              >
                                <Settings size={13} />
                              </button>
                              {configured && (
                                <button
                                  type="button"
                                  onClick={() => setEditingRule({ resource: r.key, criterion: c.key })}
                                  className={`text-[11px] px-1.5 py-0.5 rounded-full border truncate max-w-[120px] ${
                                    rule?.enabled
                                      ? "border-[#ec9324]/50 bg-[#ec9324]/10 text-[#ec9324]"
                                      : "border-gray-200 bg-gray-50 text-gray-500"
                                  }`}
                                  title={summary}
                                  data-testid={`settings-cell-${r.key}-${c.key}-chip`}
                                >
                                  {summary}
                                </button>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-gray-500 mt-3">
            Rules combine using <b>OR</b> — any configured criterion that matches a new request will auto-approve it.
            Rules apply only to <b>new</b> requests submitted after Save. Existing pending requests keep going through
            the normal approval workflow.
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl flex items-center justify-between">
          <button
            type="button"
            onClick={doReset}
            disabled={resetting || saving}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            data-testid="settings-reset-btn"
          >
            <RotateCcw size={14} /> {resetting ? "Resetting…" : "Reset to Default"}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="text-sm px-4 py-2 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              data-testid="settings-cancel-btn"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-[#ec9324] hover:bg-[#d4811f] text-white disabled:opacity-70"
              data-testid="settings-save-btn"
            >
              <Save size={14} /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      {/* Sub-dialogs */}
      {editingRule?.criterion === "date" && (
        <DateRuleDialog
          open={true}
          onOpenChange={(v) => { if (!v) setEditingRule(null); }}
          resourceLabel={editingResource?.label || ""}
          value={editingValue}
          onSave={(next) => {
            setMatrix((m) => ({ ...m, [editingRule.resource]: { ...m[editingRule.resource], date: next } }));
          }}
        />
      )}
      {editingRule?.criterion === "time" && (
        <TimeRuleDialog
          open={true}
          onOpenChange={(v) => { if (!v) setEditingRule(null); }}
          resourceLabel={editingResource?.label || ""}
          value={editingValue}
          onSave={(next) => {
            setMatrix((m) => ({ ...m, [editingRule.resource]: { ...m[editingRule.resource], time: next } }));
          }}
        />
      )}
    </div>
  );
}
