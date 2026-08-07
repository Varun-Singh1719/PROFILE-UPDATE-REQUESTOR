import React, {
  useState, useRef, useEffect, useMemo, useLayoutEffect, useCallback,
} from "react";
import { createPortal } from "react-dom";
import ChevronDown from "@mui/icons-material/KeyboardArrowDown";
import Check from "@mui/icons-material/Check";
import Close from "@mui/icons-material/CloseOutlined";

/**
 * SearchSelect — the single dropdown used across the whole CRM.
 *
 * UX matches CRM → Clients → Client Detail → Link Segmentation → Select
 * segmentations (the `SegLinkMultiSelect` reference):
 *   • the trigger box IS the search field (type to filter) — there is NO
 *     separate search bar inside the popup.
 *   • MULTI select → selected values show as orange chips inside the box.
 *   • SINGLE select → the selected label is shown as plain text (NO chip);
 *     picking an option closes the popup.
 *   • portal popup so it is never clipped by overflow:hidden parents.
 *
 * Props:
 *   options     [{ value, label }]
 *   value       single: value | null      multi: value[]
 *   onChange    single: (value|null)       multi: (value[])
 *   multiple    boolean (default false)
 *   placeholder string
 *   testId      string  (→ `${testId}-trigger` / `-input` / `-popup` / `-opt-*`)
 *   size        "sm" | "md"  (default "md")
 *   allowClear  boolean (default true) — show the × clear button
 *   disabled    boolean
 *   className   extra classes for the trigger box
 */
export default function SearchSelect({
  options = [],
  value,
  onChange,
  multiple = false,
  placeholder = "Select...",
  testId,
  size = "md",
  allowClear = true,
  disabled = false,
  loading = false,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const boxRef = useRef(null);
  const popRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const selectedOpts = useMemo(() => {
    if (multiple) {
      const vals = Array.isArray(value) ? value.map(String) : [];
      return options.filter((o) => vals.includes(String(o.value)));
    }
    const match = options.find((o) => String(o.value) === String(value));
    return match ? [match] : [];
  }, [multiple, value, options]);

  const isSel = useCallback(
    (v) => selectedOpts.some((o) => String(o.value) === String(v)),
    [selectedOpts],
  );

  const place = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const h = () => place();
    window.addEventListener("scroll", h, true);
    window.addEventListener("resize", h);
    return () => {
      window.removeEventListener("scroll", h, true);
      window.removeEventListener("resize", h);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (boxRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => (o.label || "").toLowerCase().includes(q));
  }, [options, query]);

  // reset the keyboard highlight whenever the popup opens or the query changes
  useEffect(() => { setActiveIndex(0); }, [query, open]);
  // keep the highlighted option scrolled into view
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const pick = (v) => {
    if (multiple) {
      const vals = new Set((Array.isArray(value) ? value : []).map(String));
      if (vals.has(String(v))) vals.delete(String(v));
      else vals.add(String(v));
      onChange?.(options.map((o) => o.value).filter((ov) => vals.has(String(ov))));
      inputRef.current?.focus();
    } else {
      onChange?.(v);
      setOpen(false);
      setQuery("");
    }
  };

  const removeVal = (v) => {
    if (multiple) onChange?.((Array.isArray(value) ? value : []).filter((x) => String(x) !== String(v)));
    else onChange?.(null);
  };
  const clearAll = (e) => {
    e.stopPropagation();
    onChange?.(multiple ? [] : null);
  };

  const minH = size === "sm" ? "min-h-[34px]" : "min-h-[40px]";
  const singleLabel = !multiple && selectedOpts.length ? selectedOpts[0].label : "";
  const hasSelection = selectedOpts.length > 0;

  return (
    <>
      <div
        ref={boxRef}
        onClick={() => { if (disabled) return; setOpen(true); inputRef.current?.focus(); }}
        data-testid={testId ? `${testId}-trigger` : undefined}
        className={
          `w-full ${minH} rounded-lg border bg-white px-2.5 py-1 flex items-center gap-2 cursor-text transition-colors ` +
          (open ? "border-[#ec9324] ring-2 ring-[#ec9324]/20 " : "border-gray-300 hover:border-gray-400 ") +
          (disabled ? "opacity-60 cursor-not-allowed " : "") +
          className
        }
      >
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
          {multiple && selectedOpts.map((o) => (
            <span
              key={o.value}
              className="inline-flex items-center gap-1 rounded-md bg-orange-50 border border-[#ec9324]/40 text-[#ec9324] text-xs font-medium pl-2 pr-1 py-0.5 max-w-full"
              title={o.label}
              data-testid={testId ? `${testId}-chip-${o.value}` : undefined}
            >
              <span className="truncate">{o.label}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeVal(o.value); }}
                aria-label={`Remove ${o.label}`}
                className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-[#ec9324]/15"
              >
                <Close sx={{ fontSize: 11 }} />
              </button>
            </span>
          ))}
          <div className="relative flex-1 min-w-[60px] flex items-center">
            {!multiple && singleLabel && query === "" && (
              <span className="pointer-events-none absolute inset-0 flex items-center truncate text-sm text-gray-900">
                {singleLabel}
              </span>
            )}
            <input
              ref={inputRef}
              value={query}
              disabled={disabled}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setOpen(false); return; }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (!open) { setOpen(true); return; }
                  setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  if (!open) { setOpen(true); return; }
                  setActiveIndex((i) => Math.max(0, i - 1));
                } else if (e.key === "Home" && open) {
                  e.preventDefault();
                  setActiveIndex(0);
                } else if (e.key === "End" && open) {
                  e.preventDefault();
                  setActiveIndex(filtered.length - 1);
                } else if (e.key === "Enter") {
                  if (open && filtered.length) {
                    e.preventDefault();
                    pick(filtered[Math.min(activeIndex, filtered.length - 1)].value);
                  }
                } else if (multiple && e.key === "Backspace" && !query && selectedOpts.length) {
                  removeVal(selectedOpts[selectedOpts.length - 1].value);
                }
              }}
              placeholder={(multiple ? selectedOpts.length === 0 : !singleLabel) ? placeholder : ""}
              className="w-full bg-transparent outline-none text-sm text-gray-900 placeholder-gray-400 py-0.5"
              data-testid={testId ? `${testId}-input` : undefined}
            />
          </div>
        </div>
        {allowClear && hasSelection && !disabled && !loading && (
          <button
            type="button"
            onClick={clearAll}
            aria-label="Clear"
            data-testid={testId ? `${testId}-clear` : undefined}
            className="shrink-0 text-gray-400 hover:text-gray-700 p-0.5 rounded"
          >
            <Close sx={{ fontSize: 14 }} />
          </button>
        )}
        {loading ? (
          <span
            data-testid={testId ? `${testId}-spinner` : undefined}
            className="shrink-0 w-4 h-4 border-2 border-gray-200 border-t-[#ec9324] rounded-full animate-spin"
          />
        ) : (
          <ChevronDown
            sx={{ fontSize: 20 }}
            className={"shrink-0 text-gray-400 transition-transform " + (open ? "rotate-180" : "")}
          />
        )}
      </div>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 9999, pointerEvents: "auto" }}
          onPointerDownCapture={(e) => e.stopPropagation()}
          onMouseDownCapture={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          className="bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden"
          data-testid={testId ? `${testId}-popup` : undefined}
        >
          <div ref={listRef} className="max-h-60 overflow-y-auto py-1">
            {loading ? (
              <div className="px-3 py-3 text-xs text-gray-400 flex items-center justify-center gap-2" data-testid={testId ? `${testId}-loading` : undefined}>
                <span className="w-3.5 h-3.5 border-2 border-gray-200 border-t-[#ec9324] rounded-full animate-spin" />
                Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-400 text-center">No matches</div>
            ) : (
              filtered.map((o, idx) => {
                const sel = isSel(o.value);
                const active = idx === activeIndex;
                return (
                  <button
                    key={o.value}
                    type="button"
                    data-index={idx}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => pick(o.value)}
                    className={
                      "w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors " +
                      (active ? "bg-orange-100/70 " : sel ? "bg-orange-50 " : "")
                    }
                    data-testid={testId ? `${testId}-opt-${o.value}` : undefined}
                  >
                    <span
                      className={
                        "shrink-0 w-4 h-4 flex items-center justify-center border " +
                        (multiple ? "rounded " : "rounded-full ") +
                        (sel ? "bg-[#ec9324] border-[#ec9324]" : "border-gray-300 bg-white")
                      }
                    >
                      {sel && (multiple
                        ? <Check sx={{ fontSize: 13 }} className="text-white" />
                        : <span className="w-1.5 h-1.5 rounded-full bg-white" />)}
                    </span>
                    <span className={"truncate " + (sel ? "text-[#ec9324] font-medium" : "text-gray-700")}>
                      {o.label}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
