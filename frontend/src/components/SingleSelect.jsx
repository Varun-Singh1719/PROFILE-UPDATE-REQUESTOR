import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import ChevronsUpDown from "@mui/icons-material/UnfoldMore";
import X from "@mui/icons-material/Close";
import Search from "@mui/icons-material/SearchOutlined";
import { useWheelScrollIsolation } from "../hooks/useWheelScrollIsolation";

/**
 * SingleSelect dropdown — plain list style (no checkboxes).
 *
 * Props:
 * - options:      [{ value, label, sublabel?, chip?, disabled? }]
 *                 • chip     — optional right-aligned pill label
 *                 • disabled — grey the option out and prevent selection
 * - value:        string | null (selected value)
 * - onChange:     (newValue: string | null) => void
 * - placeholder?: string
 * - testId?:      string
 * - disabled?:    boolean
 * - size?:        "sm" | "md"    (default "md")
 * - allowClear?:  boolean (default true)
 * - searchable?:  boolean (default false — pass true if the option list is long)
 */
export default function SingleSelect({
  options = [],
  value = null,
  onChange,
  placeholder = "Select...",
  testId,
  disabled = false,
  size = "md",
  allowClear = true,
  searchable = false,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);
  const triggerRef = useRef(null);
  const popupRef = useRef(null);
  const listRef = useRef(null);
  // Portal-based popup position — same pattern as MultiSelectFilter so the
  // dropdown can never be clipped by a parent with `overflow: hidden` (e.g.
  // the Permission Sets edit page table rows).
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0, width: 0, direction: "down" });

  const updatePosition = () => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const vpH = window.innerHeight;
    const spaceBelow = vpH - rect.bottom;
    const estimatedHeight = 320;
    const direction = spaceBelow < estimatedHeight && rect.top > spaceBelow ? "up" : "down";
    setPopupPos({
      top: direction === "down" ? rect.bottom + 4 : rect.top - 4,
      left: rect.left,
      width: rect.width,
      direction,
    });
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      const inTrigger = ref.current && ref.current.contains(e.target);
      const inPopup = popupRef.current && popupRef.current.contains(e.target);
      if (!inTrigger && !inPopup) {
        setOpen(false);
        setSearch("");
      }
    };
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); setSearch(""); } };
    const onScrollOrResize = () => updatePosition();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open]);

  // Trackpad / wheel scrolling for the portalled popup list — works even when
  // this dropdown is opened inside a Radix Dialog (react-remove-scroll).
  useWheelScrollIsolation(listRef, open);

  const selected = options.find((o) => o.value === value) || null;

  const filtered = searchable
    ? options.filter((o) => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return (
          (o.label || "").toLowerCase().includes(q) ||
          (o.sublabel || "").toLowerCase().includes(q)
        );
      })
    : options;

  const clear = (e) => {
    e.stopPropagation();
    onChange?.(null);
  };

  const pick = (v) => {
    onChange?.(v);
    setOpen(false);
    setSearch("");
  };

  const h = size === "sm" ? "h-8 text-xs" : "h-9 text-sm";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        data-testid={testId}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`w-full ${h} flex items-center justify-between rounded-md border bg-white px-3 text-left focus:outline-none focus:ring-2 focus:ring-[#ec9324]/40 focus:border-[#ec9324] transition-colors ${
          disabled
            ? "border-gray-200 text-gray-400 cursor-not-allowed opacity-70"
            : open
            ? "border-[#ec9324]"
            : "border-gray-300 hover:border-gray-400"
        }`}
      >
        <span className={`truncate ${selected ? "text-gray-900" : "text-gray-400"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="flex items-center gap-1 ml-2 flex-shrink-0">
          {allowClear && selected && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={clear}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && clear(e)}
              className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 cursor-pointer"
              data-testid={testId ? `${testId}-clear` : undefined}
              aria-label="Clear"
            >
              <X sx={{ fontSize: 12 }}/>
            </span>
          )}
          <ChevronsUpDown sx={{ fontSize: 13 }} className="text-gray-400"/>
        </span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popupRef}
          data-testid={testId ? `${testId}-popup` : undefined}
          // Same pointer-shielding pattern as MultiSelectFilter so this
          // dropdown works inside Radix Dialogs (Permission Sets edit modal,
          // etc.) — the dialog's DismissableLayer won't treat clicks as
          // outside.
          onPointerDownCapture={(e) => e.stopPropagation()}
          onMouseDownCapture={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: popupPos.direction === "down" ? popupPos.top : undefined,
            bottom: popupPos.direction === "up"
              ? Math.max(0, window.innerHeight - popupPos.top)
              : undefined,
            left: popupPos.left,
            width: popupPos.width,
            zIndex: 9999,
            pointerEvents: "auto",
          }}
          className="bg-white border border-[#ec9324]/40 rounded-md shadow-lg max-h-72 overflow-hidden flex flex-col"
        >
          {searchable && (
            <div className="px-2 py-2 border-b border-gray-100">
              <div className="relative">
                <Search sx={{ fontSize: 13 }} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input
                  type="text"
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                  data-testid={testId ? `${testId}-search` : undefined}
                  className="w-full text-sm pl-7 pr-2 py-1.5 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-[#ec9324]/40"
                />
              </div>
            </div>
          )}
          <div ref={listRef} className="overflow-y-auto overscroll-contain max-h-60" onWheel={(e) => e.stopPropagation()}>
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-sm text-gray-400 text-center">No matches</div>
            )}
            {filtered.map((o) => {
              const sel = o.value === value;
              const optDisabled = !!o.disabled;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { if (!optDisabled) pick(o.value); }}
                  disabled={optDisabled}
                  data-testid={testId ? `${testId}-option-${o.value}` : undefined}
                  title={optDisabled && o.chip ? `${o.label} — ${o.chip}` : undefined}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${
                    optDisabled
                      ? "bg-gray-50 text-gray-400 cursor-not-allowed"
                      : sel
                      ? "bg-[#ec9324]/10 text-[#ec9324] font-semibold"
                      : "text-gray-800 hover:bg-orange-50/60"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{o.label}</div>
                    {o.sublabel && (
                      <div className={`text-xs truncate ${
                        optDisabled ? "text-gray-400" : sel ? "text-[#ec9324]/80" : "text-gray-500"
                      }`}>
                        {o.sublabel}
                      </div>
                    )}
                  </div>
                  {o.chip && (
                    <span
                      className="ml-auto flex-shrink-0 inline-flex items-center justify-center w-24 h-6 text-[10px] font-semibold uppercase tracking-wider rounded-full border-2 select-none whitespace-nowrap bg-white"
                      style={
                        // "Pending" (replaceable) → amber outlined; anything
                        // else (Alloted, generic) → app-orange outlined.
                        String(o.chip).toLowerCase() === "pending"
                          ? { color: "#b45309", borderColor: "#f59e0b" }
                          : { color: "#ec9324", borderColor: "#ec9324" }
                      }
                      data-testid={testId ? `${testId}-option-${o.value}-chip` : undefined}
                    >
                      {o.chip}
                    </span>
                  )}
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
