import React, { useEffect, useMemo, useState } from "react";
import Close from "@mui/icons-material/CloseOutlined";
import Plus from "@mui/icons-material/AddOutlined";
import ArrowRight from "@mui/icons-material/ArrowForwardOutlined";
import api from "../lib/api";
import SearchSelect from "./SearchSelect";

/**
 * IndustryPathPicker — hierarchical Industry selection for Client Contacts.
 *
 * Four linked dropdowns (Level 0 → Level 1 → Level 2 → Level 3) populated from
 * the Infollion Research segmentation (GET /client-contacts/industry-tree —
 * nothing hard-coded).
 *   • Level 0 always enabled (all Level 0 segments). Level 1 is enabled too:
 *     with a Level 0 chosen it lists only that branch, otherwise every Level 1
 *     segment (picking one auto-fills its Level 0 — "reverse selection").
 *   • Level 2 stays frozen until Level 1 is chosen; Level 3 until Level 2.
 *   • Choosing any node auto-populates its parents; changing a parent clears
 *     children that no longer belong to it.
 *   • "Add" appends the current path as a chip (no duplicates); chips are
 *     removable with ×. Parent state owns the list — nothing is saved until
 *     the form's Save button.
 *
 * Props:
 *   value      [{ ext_ids:[...], names:[...], shorts:[...], label }]  saved paths
 *   onChange   (nextPaths) => void
 *   legacy     [string]  old free-text industries (shown as removable chips)
 *   onLegacyChange (nextStrings) => void
 *   required   boolean — show the red asterisk
 *   testId     string prefix (default "cc-industry")
 */
const LEVELS = [0, 1, 2, 3];
const SEP = " → ";

export default function IndustryPathPicker({
  value = [],
  onChange,
  legacy = [],
  onLegacyChange,
  required = false,
  testId = "cc-industry",
}) {
  const [nodes, setNodes] = useState([]);
  const [segName, setSegName] = useState("Infollion Research");
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState({ 0: null, 1: null, 2: null, 3: null });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get("/client-contacts/industry-tree")
      .then((r) => {
        if (cancelled) return;
        setNodes(r.data?.nodes || []);
        if (r.data?.segmentation_name) setSegName(r.data.segmentation_name);
      })
      .catch(() => { if (!cancelled) setNodes([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const byId = useMemo(() => {
    const m = new Map();
    nodes.forEach((n) => m.set(n.ext_id, n));
    return m;
  }, [nodes]);

  const optionsFor = (level) => {
    const parent = level > 0 ? sel[level - 1] : null;
    let list;
    if (level === 0) list = nodes.filter((n) => n.level === 0);
    else if (parent != null) list = nodes.filter((n) => n.level === level && n.parent_ext_id === parent);
    else if (level === 1) list = nodes.filter((n) => n.level === 1);   // reverse selection entry point
    else list = [];
    return list
      .filter((n) => !n.stale)
      .map((n) => ({
        value: n.ext_id,
        // Without a chosen parent, show the full MySQL name so the branch is clear.
        label: parent == null && level > 0 ? n.name : n.short,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  };

  const isFrozen = (level) => level >= 2 && sel[level - 1] == null;

  const handleLevel = (level, id) => {
    setSel((prev) => {
      const next = { ...prev, [level]: id };
      if (id == null) {
        // Clearing a level clears everything below it.
        LEVELS.filter((l) => l > level).forEach((l) => { next[l] = null; });
        return next;
      }
      // Auto-populate parents by walking up the tree.
      let cur = byId.get(id);
      let l = level - 1;
      while (cur && cur.parent_ext_id != null && l >= 0) {
        next[l] = cur.parent_ext_id;
        cur = byId.get(cur.parent_ext_id);
        l -= 1;
      }
      // Drop children that no longer descend from the new selection.
      for (let d = level + 1; d <= 3; d += 1) {
        const child = next[d] != null ? byId.get(next[d]) : null;
        if (!child || child.parent_ext_id !== next[d - 1]) {
          LEVELS.filter((x) => x >= d).forEach((x) => { next[x] = null; });
          break;
        }
      }
      return next;
    });
  };

  // Current path = consecutive selections from Level 0 downward.
  const currentIds = useMemo(() => {
    const ids = [];
    for (const l of LEVELS) {
      if (sel[l] == null) break;
      ids.push(sel[l]);
    }
    return ids;
  }, [sel]);
  const currentKey = currentIds.join(">");
  const isDuplicate = (value || []).some((p) => (p.ext_ids || []).join(">") === currentKey);
  const canAdd = currentIds.length > 0 && !isDuplicate;

  const addPath = () => {
    if (!canAdd) return;
    const chain = currentIds.map((id) => byId.get(id)).filter(Boolean);
    const path = {
      ext_ids: chain.map((n) => n.ext_id),
      names: chain.map((n) => n.name),
      shorts: chain.map((n) => n.short),
      label: chain.map((n) => n.short).join(SEP),
    };
    onChange?.([...(value || []), path]);
    setSel({ 0: null, 1: null, 2: null, 3: null });
  };
  const removePath = (idx) => onChange?.((value || []).filter((_, i) => i !== idx));
  const removeLegacy = (idx) => onLegacyChange?.((legacy || []).filter((_, i) => i !== idx));

  const hasAny = (value || []).length > 0 || (legacy || []).length > 0;

  return (
    <div className="relative border border-gray-200 rounded-md px-3 pt-4 pb-3 bg-white" data-testid={`${testId}-picker`}>
      <label className="absolute -top-2 left-3 px-1.5 bg-white text-[11px] font-medium text-gray-500 z-10 pointer-events-none">
        Industries ({segName}: Level 0 → Level 1 → Level 2 → Level 3)
        {required && <span className="text-red-500"> *</span>}
      </label>

      {/* Cascading dropdowns — hierarchy shown left → right with arrows */}
      <div className="flex items-center gap-1.5 flex-wrap md:flex-nowrap">
        {LEVELS.map((level) => (
          <React.Fragment key={level}>
            {level > 0 && <ArrowRight sx={{ fontSize: 14 }} className="text-gray-300 shrink-0" />}
            <div className="flex-1 min-w-[140px]">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5 pl-0.5">
                Level {level}
              </div>
              <SearchSelect
                size="sm"
                options={optionsFor(level)}
                value={sel[level]}
                onChange={(v) => handleLevel(level, v)}
                placeholder={isFrozen(level) ? `Select Level ${level - 1} first` : `Select Level ${level}…`}
                disabled={isFrozen(level) || loading}
                loading={loading && level === 0}
                testId={`${testId}-l${level}`}
              />
            </div>
          </React.Fragment>
        ))}
        <button
          type="button"
          onClick={addPath}
          disabled={!canAdd}
          data-testid={`${testId}-add`}
          title={isDuplicate ? "This path is already added" : "Add this segmentation path"}
          className="self-end h-[34px] shrink-0 inline-flex items-center gap-1 px-3 rounded-md text-xs font-semibold
                     bg-[#ec9324] text-white hover:bg-[#d4811f] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus sx={{ fontSize: 15 }} /> Add
        </button>
      </div>

      {/* Added paths — chips, same chip style as the app's multi-select */}
      <div className="mt-2.5 flex flex-wrap gap-1.5" data-testid={`${testId}-chips`}>
        {!hasAny && (
          <span className="text-[11px] text-gray-400 italic">No industry added yet — build a path above and click Add.</span>
        )}
        {(value || []).map((p, i) => (
          <span
            key={(p.ext_ids || []).join(">") + i}
            data-testid={`${testId}-chip-${i}`}
            className="inline-flex items-center gap-1 max-w-full rounded-full border border-[#ec9324]/40 bg-[#ec9324]/10 text-[#b4691a] text-[12px] font-medium pl-2.5 pr-1 py-0.5"
            title={(p.names || []).join(SEP)}
          >
            <span className="truncate">{p.label || (p.shorts || p.names || []).join(SEP)}</span>
            <button
              type="button"
              onClick={() => removePath(i)}
              aria-label={`Remove ${p.label}`}
              data-testid={`${testId}-chip-remove-${i}`}
              className="rounded-full p-0.5 hover:bg-[#ec9324]/20 text-[#b4691a]"
            >
              <Close sx={{ fontSize: 13 }} />
            </button>
          </span>
        ))}
        {(legacy || []).map((name, i) => (
          <span
            key={"legacy-" + name + i}
            data-testid={`${testId}-legacy-${i}`}
            className="inline-flex items-center gap-1 max-w-full rounded-full border border-gray-300 bg-gray-50 text-gray-600 text-[12px] font-medium pl-2.5 pr-1 py-0.5"
            title="Saved before hierarchical industries existed — not linked to the Infollion hierarchy"
          >
            <span className="truncate">{name}</span>
            <span className="text-[9px] uppercase tracking-wide text-gray-400">legacy</span>
            <button
              type="button"
              onClick={() => removeLegacy(i)}
              aria-label={`Remove ${name}`}
              className="rounded-full p-0.5 hover:bg-gray-200 text-gray-500"
            >
              <Close sx={{ fontSize: 13 }} />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
