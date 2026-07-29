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
  // When true, the trigger itself becomes a text input that filters options
  // as the user types (searchbox-in-trigger pattern, matches typical form
  // combobox UX). In that mode the popup's internal search box is hidden
  // — the trigger IS the search box. Adds arrow-key nav (↑ / ↓ move a
  // highlight, Enter toggles the highlighted row, Esc closes).
  searchInTrigger = false,
  // In `searchInTrigger` mode, controls whether removable chips are rendered
  // below the trigger. Set to `false` when the caller wants to render its
  // own chip strip (e.g. to use a different colour tone) or wants a plain
  // filter-style trigger with no chips at all.
  renderChipsBelow = true,
  // In `searchInTrigger` mode, controls whether the small "N unit(s) selected"
  // pill is shown inside the trigger. Set to `false` for classic filter
  // triggers where the summary of picked options is preferred.
  showCountBadge = true,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(-1);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popupRef = useRef(null);
  const inputRef = useRef(null);
  const searchInputRef = useRef(null); // the in-trigger search input (searchInTrigger only)
  const listRef = useRef(null);
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
    if (searchInTrigger) {
      // in-trigger mode: the input already has focus (user opened by typing/focusing)
    } else if (options.length > searchThreshold) {
      setTimeout(() => inputRef.current?.focus(), 30);
    }
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, options.length, searchThreshold, align, searchInTrigger]);

  // Position the popup right before the browser paints it — prevents the
  // initial "jump" from (0,0) to the anchor rect.
  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open]);

  // Reset search + highlight whenever the popup closes so re-opening is fresh
  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlight(-1);
    }
  }, [open]);

  const selected = useMemo(() => new Set(value || []), [value]);

  const selectedOptions = useMemo(
    () => options.filter((o) => selected.has(o.value)),
    [options, selected],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      // Search matches the visible label OR an optional hidden `searchText`
      // hint provided by the caller (useful when the label omits data that
      // users may still type — e.g. permission-set IDs shown in the `meta`
      // column but not in the label).
      const hay = (o.searchText != null ? o.searchText : o.label) || "";
      return hay.toString().toLowerCase().includes(q);
    });
  }, [options, query]);

  // In-trigger mode always suppresses the in-popup search box.
  const showSearch = !searchInTrigger && options.length > searchThreshold;

  // Clamp the highlight index whenever the filtered list changes.
  useEffect(() => {
    if (!open) return;
    if (filtered.length === 0) { setHighlight(-1); return; }
    setHighlight((h) => {
      if (h < 0) return 0;
      if (h >= filtered.length) return filtered.length - 1;
      return h;
    });
  }, [filtered, open]);

  // Scroll the highlighted row into view when it moves via keyboard.
  useEffect(() => {
    if (highlight < 0 || !listRef.current) return;
    const row = listRef.current.querySelector(`[data-idx="${highlight}"]`);
    if (row && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [highlight]);

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

  // Keyboard navigation inside the popup / in-trigger input.
  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setHighlight((h) => Math.min((filtered.length - 1), h < 0 ? 0 : h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      const opt = filtered[highlight >= 0 ? highlight : 0];
      if (opt && !opt.disabled) toggle(opt.value);
    } else if (e.key === "Escape") {
      if (open) { e.preventDefault(); setOpen(false); }
    } else if (e.key === "Home") {
      if (open) { e.preventDefault(); setHighlight(0); }
    } else if (e.key === "End") {
      if (open) { e.preventDefault(); setHighlight(filtered.length - 1); }
    }
  };

  // Remove a single value from the selection (used by chip × buttons).
  const removeValue = (val) => {
    if (single) { onChange([]); return; }
    onChange((value || []).filter((v) => v !== val));
  };

  // Common right-side icons (clear + chevron), used by both trigger variants.
  const rightIcons = (
    <span className="flex items-center gap-1 shrink-0">
      {selectedOptions.length > 0 && !disabled && (
        <span
          onClick={clearAll}
          onMouseDown={(e) => e.preventDefault()} // don't steal focus from input
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
  );

  return (
    <div ref={rootRef} className={`relative ${fullWidth ? "block w-full" : "inline-block"} ${className}`} data-testid={tid}>
      {searchInTrigger ? (
        // -----------------------------------------------------------------
        // Search-in-trigger variant — the input IS the filter box. Selected
        // items are surfaced as removable chips BELOW the input (each with
        // a per-chip × button) so nothing is hidden from view, and a small
        // count badge sits inside the input on the right for at-a-glance
        // "how many did I pick?" feedback.
        // -----------------------------------------------------------------
        <>
          <div
            ref={triggerRef}
            data-testid={tid ? `${tid}-trigger` : undefined}
            onClick={() => {
              if (disabled) return;
              setOpen(true);
              searchInputRef.current?.focus();
            }}
            className={`relative w-full h-9 px-3 py-1.5 text-xs bg-white border rounded-md
                       inline-flex items-center gap-2 cursor-text
                       ${open ? "border-[#ec9324] ring-2 ring-[#ec9324]/30" : "border-gray-200 hover:border-gray-300"}
                       ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <span className="relative flex-1 min-w-0 flex items-center">
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                disabled={disabled}
                placeholder={selectedOptions.length === 0 || (!showCountBadge && !renderChipsBelow) ? placeholder : ""}
                onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
                onFocus={() => { if (!disabled) setOpen(true); }}
                onKeyDown={handleKeyDown}
                aria-label={label}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-autocomplete="list"
                role="combobox"
                data-testid={tid ? `${tid}-search` : undefined}
                className="w-full h-full bg-transparent outline-none text-gray-900 placeholder-gray-400
                           disabled:cursor-not-allowed"
              />
              {/* Ghost overlay — shows a summary of the selection when the
                  caller has opted out of BOTH the count badge and the chip
                  strip (classic filter-style trigger). Hidden the moment the
                  user starts typing so it never fights the input value. */}
              {!showCountBadge && !renderChipsBelow && query === "" && selectedOptions.length > 0 && (
                <span
                  className="pointer-events-none absolute inset-0 flex items-center truncate text-gray-900 font-medium"
                  title={selectedOptions.map((o) => o.label).join(", ")}
                  aria-hidden="true"
                >
                  {selectedOptions.length <= maxSelectedLabels
                    ? selectedOptions.map((o) => o.label).join(", ")
                    : `${selectedOptions.slice(0, maxSelectedLabels).map((o) => o.label).join(", ")} +${selectedOptions.length - maxSelectedLabels}`}
                </span>
              )}
            </span>
            {/* Selected-count badge — sits inside the input, before the icons. */}
            {showCountBadge && selectedOptions.length > 0 && (
              <span
                className="shrink-0 inline-flex items-center h-5 px-2 rounded-full text-[10px] font-semibold
                           bg-[#ec9324]/10 text-[#ec9324] border border-[#ec9324]/30 tabular-nums whitespace-nowrap"
                aria-label={`${selectedOptions.length} ${countUnitLabel}`}
                title={`${selectedOptions.length} ${countUnitLabel}`}
                data-testid={tid ? `${tid}-count` : undefined}
              >
                {selectedOptions.length} {countUnitLabel}
              </span>
            )}
            {rightIcons}
          </div>

          {/* Chip strip — one removable pill per selected option. Skipped when
              the caller wants to render its own chips (renderChipsBelow=false). */}
          {renderChipsBelow && selectedOptions.length > 0 && (
            <div
              className="mt-2 flex flex-wrap gap-1.5"
              data-testid={tid ? `${tid}-chips` : undefined}
            >
              {selectedOptions.map((o) => {
                // Sub-label — if the caller provided a `chipMeta` string,
                // append it after a middle dot. Otherwise, if `meta` looks
                // like plain text, use it (we only try `.toString()` on
                // string-like meta so JSX meta is skipped safely).
                const chipMeta = typeof o.chipMeta === "string" ? o.chipMeta : null;
                return (
                  <span
                    key={o.value}
                    className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full
                               border-2 border-[#ec9324] bg-white text-[11px] font-semibold text-[#ec9324]
                               whitespace-nowrap max-w-full"
                    data-testid={tid ? `${tid}-chip-${o.value}` : undefined}
                    title={o.label}
                  >
                    <span className="truncate max-w-[220px]">{o.label}</span>
                    {chipMeta && (
                      <span className="text-gray-500 font-normal">· {chipMeta}</span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeValue(o.value); }}
                      onMouseDown={(e) => e.preventDefault()}
                      aria-label={`Remove ${o.label}`}
                      data-testid={tid ? `${tid}-chip-remove-${o.value}` : undefined}
                      className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full
                                 hover:bg-[#ec9324]/10 transition-colors"
                    >
                      <X sx={{ fontSize: 12 }} className="text-[#ec9324]"/>
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </>
      ) : (
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
          {rightIcons}
        </button>
      )}

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
          // Radix Dialog's RemoveScroll can block wheel events on portalled
          // siblings; stopping propagation on wheel+touchmove keeps the
          // popup's own scroll container fully usable (trackpad two-finger
          // scroll, wheel, touch). We don't preventDefault so the scroll
          // container still receives the wheel.
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
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

          <div
            ref={listRef}
            className="max-h-64 overflow-y-auto overscroll-contain"
            // Explicit wheel handler so browsers that route wheel to the
            // outermost scrollable ancestor (some Chromium builds when a
            // Radix Dialog is open) still let this list scroll on trackpad.
            onWheel={(e) => e.stopPropagation()}
          >
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-xs text-gray-500 text-center">No matches</div>
            )}
            {filtered.map((o, idx) => {
              const checked = selected.has(o.value);
              const optDisabled = !!o.disabled;
              const isHighlighted = idx === highlight;
              // Middle column: prefer explicit `middle`, else if disabled and has
              // `disabledReason`, use that. Kept as its own column so the row is
              // symmetric — empty middle simply leaves the gap.
              const middleText = o.middle || (optDisabled ? o.disabledReason : "") || "";
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { if (!optDisabled) toggle(o.value); }}
                  onMouseEnter={() => setHighlight(idx)}
                  onMouseDown={(e) => {
                    // In searchInTrigger mode, don't steal focus from the
                    // trigger input on click — keeps the input focused so
                    // typing continues to work after picking a row.
                    if (searchInTrigger) e.preventDefault();
                  }}
                  role="option"
                  aria-selected={checked}
                  aria-disabled={optDisabled}
                  disabled={optDisabled}
                  data-idx={idx}
                  title={optDisabled ? (o.disabledReason || "Not available") : undefined}
                  data-testid={tid ? `${tid}-opt-${o.value}` : undefined}
                  className={`w-full text-left grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto]
                              items-center gap-4 px-3 py-2 text-xs transition-colors
                              ${checked ? "bg-orange-50" : (isHighlighted ? "bg-gray-100" : "hover:bg-gray-50")}
                              ${isHighlighted && checked ? "bg-orange-100" : ""}
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
