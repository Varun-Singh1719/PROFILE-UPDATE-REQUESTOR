/**
 * MultiSelectFilter — reusable filter dropdown with checkbox-style multi-select.
 *
 * Look & feel (matches app-wide spec):
 *   • Trigger  →  "Label: All"                  when nothing selected
 *                 "opt1, opt2"                  when one or more selected
 *                 chevron ⌄ on the right; ⌃ when open
 *   • Popup    →  optional search box (auto-shown when options > threshold)
 *                 rows with a rounded orange checkbox on the left
 *                 selected rows use bg-orange-50 to highlight the choice
 *   • Behaviour → toggles by click, closes on Escape / outside-click,
 *                 auto-focuses the search field on open, "Clear" (×) chip
 *                 on the trigger when any selection is active.
 *
 * Props:
 *   label            — required visible label used in placeholder ("Status")
 *   value            — array of currently selected option `value`s
 *   onChange(next)   — fires with the new array of values (order preserved)
 *   options          — [{ value, label, meta? }]
 *   placeholder      — text after "Label: " when empty (default "All")
 *   testIdPrefix     — data-testid stem for trigger / popup / options
 *   searchThreshold  — show search when options.length > this (default 8)
 *   className        — extra classes for the outer wrapper
 *   align            — "left" (default) or "right" — popup horizontal anchor
 *   disabled         — disable the trigger
 *   maxSelectedLabels— truncate the label list beyond this count (default 3)
 *   hideLabelPrefix  — when true, hides the "Label:" prefix on the trigger.
 *                      Use for form-field usage (label sits above the field)
 *                      so the trigger just shows the placeholder / selected list.
 *                      Default: false (filter-bar usage).
 *   fullWidth        — when true, wrapper takes 100% width (form-field usage).
 *                      Default: false (inline filter-chip usage).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Check, Search, X } from "lucide-react";

export default function MultiSelectFilter({
  label,
  value = [],
  onChange,
  options = [],
  placeholder = "All",
  className = "",
  testIdPrefix,
  searchThreshold = 8,
  disabled = false,
  align = "left",
  maxSelectedLabels = 3,
  hideLabelPrefix = false,
  fullWidth = false,
  showCountOnly = false, // when true, trigger shows "N selected" instead of listing selected names
  countUnitLabel = "selected", // label appended to the count when showCountOnly is on
  single = false, // when true, only one value can be selected; renders radio-style row
  closeOnSelectSingle = true,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  // Outside click + Escape to close
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    // Auto-focus the search field only when we actually show one
    if (options.length > searchThreshold) {
      setTimeout(() => inputRef.current?.focus(), 30);
    }
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, options.length, searchThreshold]);

  // Reset search whenever the popup closes so re-opening is fresh
  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const selected = useMemo(() => new Set(value || []), [value]);

  const selectedOptions = useMemo(
    () => options.filter((o) => selected.has(o.value)),
    [options, selected],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => (o.label || "").toString().toLowerCase().includes(q));
  }, [options, query]);

  const showSearch = options.length > searchThreshold;

  const toggle = (val) => {
    if (single) {
      // Single-choice: clicking the currently-selected row clears; otherwise replaces
      if (selected.has(val)) {
        onChange([]);
      } else {
        onChange([val]);
      }
      if (closeOnSelectSingle) setOpen(false);
      return;
    }
    const next = new Set(selected);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    // Preserve original options order for stable label rendering
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value));
  };

  const clearAll = (e) => {
    e.stopPropagation();
    onChange([]);
  };

  // Build the trigger text
  let triggerNode;
  if (selectedOptions.length === 0) {
    triggerNode = hideLabelPrefix ? (
      <span className="truncate text-gray-400">{placeholder}</span>
    ) : (
      <span className="truncate text-gray-500">
        <span className="text-gray-600">{label}:</span> <span className="text-gray-500">{placeholder}</span>
      </span>
    );
  } else if (showCountOnly) {
    // Compact mode — trigger just reports the count. Selected names are
    // typically rendered as chips below the field.
    triggerNode = (
      <span className="truncate text-gray-900 font-medium">
        {selectedOptions.length} {countUnitLabel}
      </span>
    );
  } else if (selectedOptions.length <= maxSelectedLabels) {
    triggerNode = (
      <span className="truncate text-gray-900 font-medium">
        {selectedOptions.map((o) => o.label).join(", ")}
      </span>
    );
  } else {
    const shown = selectedOptions.slice(0, maxSelectedLabels).map((o) => o.label).join(", ");
    const extra = selectedOptions.length - maxSelectedLabels;
    triggerNode = (
      <span className="truncate text-gray-900 font-medium">
        {shown} <span className="text-gray-500 font-normal">+{extra}</span>
      </span>
    );
  }

  const tid = testIdPrefix || undefined;

  return (
    <div ref={rootRef} className={`relative ${fullWidth ? "block w-full" : "inline-block"} ${className}`} data-testid={tid}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={tid ? `${tid}-trigger` : undefined}
        className="w-full h-9 px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-md
                   inline-flex items-center justify-between gap-2 hover:border-gray-300
                   focus:outline-none focus:ring-2 focus:ring-[#ec9324]/30
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {triggerNode}
        <span className="flex items-center gap-1 shrink-0">
          {selectedOptions.length > 0 && !disabled && (
            <span
              onClick={clearAll}
              role="button"
              aria-label={`Clear ${label} filter`}
              data-testid={tid ? `${tid}-clear` : undefined}
              className="text-gray-400 hover:text-gray-700 cursor-pointer inline-flex"
            >
              <X size={12} />
            </span>
          )}
          {open
            ? <ChevronUp size={14} className="text-gray-500" />
            : <ChevronDown size={14} className="text-gray-500" />}
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          data-testid={tid ? `${tid}-popup` : undefined}
          className={`absolute z-50 mt-1 bg-white border border-gray-200 shadow-lg rounded-md py-1
                      ${fullWidth ? "w-full" : "min-w-[240px] max-w-[360px]"}
                      ${align === "right" ? "right-0" : "left-0"}`}
        >
          {showSearch && (
            <div className="px-2 pt-1 pb-2 border-b border-gray-100">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${label.toLowerCase()}…`}
                  className="w-full h-8 pl-6 pr-2 text-xs border border-gray-200 rounded
                             focus:outline-none focus:border-[#ec9324]"
                  data-testid={tid ? `${tid}-search` : undefined}
                />
              </div>
            </div>
          )}

          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-xs text-gray-500 text-center">No matches</div>
            )}
            {filtered.map((o) => {
              const checked = selected.has(o.value);
              const optDisabled = !!o.disabled;
              // Middle column: prefer explicit `middle`, else if disabled and has
              // `disabledReason`, use that. Kept as its own column so the row is
              // symmetric — empty middle simply leaves the gap.
              const middleText = o.middle || (optDisabled ? o.disabledReason : "") || "";
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { if (!optDisabled) toggle(o.value); }}
                  role="option"
                  aria-selected={checked}
                  aria-disabled={optDisabled}
                  disabled={optDisabled}
                  title={optDisabled ? (o.disabledReason || "Not available") : undefined}
                  data-testid={tid ? `${tid}-opt-${o.value}` : undefined}
                  className={`w-full text-left grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto]
                              items-center gap-4 px-3 py-2 text-xs transition-colors
                              ${checked ? "bg-orange-50" : "hover:bg-gray-50"}
                              ${optDisabled ? "opacity-60 cursor-not-allowed hover:bg-transparent" : ""}`}
                >
                  <span
                    className={`shrink-0 inline-flex items-center justify-center w-4 h-4 border
                                ${single ? "rounded-full" : "rounded"}
                                ${checked
                                  ? "bg-[#ec9324] border-[#ec9324] text-white"
                                  : "bg-white border-gray-300 text-transparent"}`}
                  >
                    {single
                      ? (checked && <span className="w-1.5 h-1.5 rounded-full bg-white" />)
                      : <Check size={12} strokeWidth={3} />}
                  </span>

                  {/* Column 1 — Name (left aligned) */}
                  <span
                    className={`truncate ${checked ? "text-gray-900 font-medium" : "text-gray-700"}`}
                    title={o.label}
                  >
                    {o.label}
                  </span>

                  {/* Column 2 — Middle: team / info pill (centered) */}
                  <span className="justify-self-center min-w-0 max-w-full">
                    {middleText ? (
                      <span
                        className={`inline-block truncate max-w-full text-[10px] font-medium rounded-full px-2 py-0.5
                                    ${optDisabled
                                      ? "bg-gray-100 text-gray-500 border border-gray-200"
                                      : "bg-[#ec9324]/10 text-[#ec9324] border border-[#ec9324]/20"}`}
                        title={middleText}
                      >
                        {middleText}
                      </span>
                    ) : null}
                  </span>

                  {/* Column 3 — Meta / emp id (right aligned) */}
                  {o.meta ? (
                    <span
                      className={`justify-self-end shrink-0 tabular-nums font-mono
                                  ${optDisabled ? "text-gray-400" : "text-gray-500"} text-[11px]`}
                    >
                      {o.meta}
                    </span>
                  ) : <span />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
