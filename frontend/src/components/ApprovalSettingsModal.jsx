/**
 * ApprovalSettingsModal — Auto-Approval configuration matrix.
 *
 * Shape mirrors the backend singleton:
 *   { enabled: bool, matrix: { workstation: {…}, meeting_room: {…} } }
 *
 * Phase-1 UI notes:
 *   • Matrix is a proper table so new resources (parking, lockers, visitor pass)
 *     can slot in as additional columns without redesign.
 *   • "Select all" pills for each column + one "Select all (Entire Matrix)".
 *   • "Reset to Default" clears everything and disables the master switch.
 *   • Save / Cancel at the bottom. Cancel discards unsaved changes.
 *   • Meeting Room enforcement is TBD (backend saves but doesn't act) — the
 *     column shows a small "Config only" pill so admins know rules aren't
 *     applied yet.
 */
import React, { useEffect, useState } from "react";
import { X, RotateCcw, Save, CheckSquare, Square, Info } from "lucide-react";
import api from "../lib/api";
import notify from "../lib/notify";

// Column definition — add future resources here.
const RESOURCES = [
  { key: "workstation",  label: "Workstation",   enforced: true  },
  { key: "meeting_room", label: "Meeting Room",  enforced: false },
];
const CRITERIA = [
  { key: "team_member", label: "Team Member Request" },
  { key: "manager",     label: "Manager Request" },
  { key: "recurring",   label: "Recurring Request" },
];

const EMPTY_MATRIX = RESOURCES.reduce(
  (acc, r) => ({ ...acc, [r.key]: CRITERIA.reduce((a, c) => ({ ...a, [c.key]: false }), {}) }),
  {},
);

export default function ApprovalSettingsModal({ open, onClose, initial, onSaved }) {
  const [enabled, setEnabled] = useState(false);
  const [matrix, setMatrix] = useState(EMPTY_MATRIX);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Sync from parent whenever the modal opens with fresh settings.
  useEffect(() => {
    if (!open) return;
    setEnabled(Boolean(initial?.enabled));
    const merged = { ...EMPTY_MATRIX };
    for (const r of RESOURCES) {
      merged[r.key] = { ...merged[r.key], ...((initial?.matrix?.[r.key]) || {}) };
    }
    setMatrix(merged);
  }, [open, initial]);

  if (!open) return null;

  const toggleCell = (res, crit) => {
    setMatrix((m) => ({ ...m, [res]: { ...m[res], [crit]: !m[res][crit] } }));
  };

  const columnAllChecked = (res) => CRITERIA.every((c) => matrix[res]?.[c.key]);
  const toggleColumnAll = (res) => {
    const next = !columnAllChecked(res);
    setMatrix((m) => ({ ...m, [res]: CRITERIA.reduce((a, c) => ({ ...a, [c.key]: next }), {}) }));
  };

  const allChecked = RESOURCES.every((r) => columnAllChecked(r.key));
  const toggleAll = () => {
    const next = !allChecked;
    const nxt = {};
    for (const r of RESOURCES) {
      nxt[r.key] = CRITERIA.reduce((a, c) => ({ ...a, [c.key]: next }), {});
    }
    setMatrix(nxt);
  };

  const doReset = async () => {
    setResetting(true);
    try {
      const { data } = await api.post("/approval-settings/reset");
      setEnabled(Boolean(data.enabled));
      const merged = { ...EMPTY_MATRIX };
      for (const r of RESOURCES) merged[r.key] = { ...merged[r.key], ...((data.matrix?.[r.key]) || {}) };
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
                {CRITERIA.map((c, ci) => (
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
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-gray-500 mt-3">
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
    </div>
  );
}
