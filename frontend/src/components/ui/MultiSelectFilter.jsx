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
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ChevronDown from "@mui/icons-material/KeyboardArrowDown";
import ChevronUp from "@mui/icons-material/KeyboardArrowUp";
import Check from "@mui/icons-material/Check";
import Search from "@mui/icons-material/SearchOutlined";
import X from "@mui/icons-material/Close";

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
  // Optional render-prop that returns a node to display INSIDE the trigger,
  // just before the "N selected" text. Ideal for peek-indicators like tiny
  // colored dots that summarise which options are currently on.
  // Signature: (selectedOptions) => ReactNode
  renderTriggerAccessory = null,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popupRef = useRef(null);
  const inputRef = useRef(null);
  // Portal-based popup position (viewport coords, will be turned into fixed inset).
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0, width: 0, direction: "down" });

  // Recompute popup position — called on open, scroll, resize.
  const updatePosition = () => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const vpH = window.innerHeight;
    const spaceBelow = vpH - rect.bottom;
    const estimatedHeight = 320; // rough max popup height (search + list)
    const direction = spaceBelow < estimatedHeight && rect.top > spaceBelow ? "up" : "down";
    setPopupPos({
      top: direction === "down" ? rect.bottom + 4 : rect.top - 4,
      left: align === "right" ? rect.right : rect.left,
      width: rect.width,
      direction,
    });
  };

  // Outside click + Escape to close (popup lives in a portal, so we must
  // treat clicks inside popupRef as inside too).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      const inTrigger = rootRef.current && rootRef.current.contains(e.target);
      const inPopup = popupRef.current && popupRef.current.contains(e.target);
      if (!inTrigger && !inPopup) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onScrollOrResize = () => updatePosition();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    // Auto-focus the search field only when we actually show one
    if (options.length > searchThreshold) {
      setTimeout(() => inputRef.current?.focus(), 30);
    }
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, options.length, searchThreshold, align]);

  // Position the popup right before the browser paints it — prevents the
  // initial "jump" from (0,0) to the anchor rect.
  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open]);

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
    // typically rendered as chips below the field. Optional accessory
    // (e.g. tiny colored dots) sits immediately before the count text so
    // callers can offer an at-a-glance peek of what's selected.
    triggerNode = (
      <span className="truncate text-gray-900 font-medium inline-flex items-center gap-1.5 min-w-0">
        {renderTriggerAccessory ? renderTriggerAccessory(selectedOptions) : null}
        <span className="truncate">{selectedOptions.length} {countUnitLabel}</span>
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
        ref={triggerRef}
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
              <X sx={{ fontSize: 12 }}/>
            </span>
          )}
          {open
            ? <ChevronUp sx={{ fontSize: 14 }} className="text-gray-500"/>
            : <ChevronDown sx={{ fontSize: 14 }} className="text-gray-500"/>}
        </span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popupRef}
          role="listbox"
          aria-multiselectable="true"
          data-testid={tid ? `${tid}-popup` : undefined}
          data-multiselect-popup="1"
          // Stop pointer/mouse events from bubbling to document so Radix
          // Dialog's DismissableLayer (which listens at document level) never
          // sees them as "outside" the dialog. Fixes the popup collapsing on
          // option click when the MultiSelectFilter is used inside a modal.
          //
          // NOTE: we intentionally do NOT capture the `click` event — capturing
          // it would stop it from reaching the option button's own onClick and
          // the row would never toggle. pointerdown/mousedown are enough to
          // shield Radix's dismiss layer.
          onPointerDownCapture={(e) => e.stopPropagation()}
          onMouseDownCapture={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: popupPos.direction === "down" ? popupPos.top : undefined,
            bottom: popupPos.direction === "up"
              ? Math.max(0, window.innerHeight - popupPos.top)
              : undefined,
            left: align === "right" ? undefined : popupPos.left,
            right: align === "right" ? Math.max(0, window.innerWidth - popupPos.left) : undefined,
            // Popup sizes to its content (`width: max-content`) so option
            // labels are never truncated by an arbitrary cap. Bounded below
            // by the trigger's own width (never look narrower than the chip)
            // and above by 480px / the right edge of the viewport so it can
            // never overflow the screen. Same rule everywhere the component
            // is used → uniform behaviour across every screen.
            width: "max-content",
            minWidth: popupPos.width,
            maxWidth: Math.min(
              480,
              (typeof window !== "undefined" ? window.innerWidth : 1440) -
                (align === "right" ? window.innerWidth - popupPos.left : popupPos.left) -
                16,
            ),
            zIndex: 9999,
            // Force-enable pointer events — Radix modal Dialog can set
            // pointer-events:none on siblings of the dialog's portal.
            pointerEvents: "auto",
          }}
          className="bg-white border border-gray-200 shadow-lg rounded-md py-1"
        >
          {showSearch && (
            <div className="px-2 pt-1 pb-2 border-b border-gray-100">
              <div className="relative">
                <Search sx={{ fontSize: 12 }} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"/>
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
                      : <Check sx={{ fontSize: 12 }}/>}
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
        </div>,
        document.body,
      )}
    </div>
  );
}
