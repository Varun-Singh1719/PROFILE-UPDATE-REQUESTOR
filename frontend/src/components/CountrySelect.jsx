import React, {
  useState, useRef, useMemo, useEffect, useCallback, useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import ChevronDown from "@mui/icons-material/KeyboardArrowDown";
import Check from "@mui/icons-material/Check";
import Close from "@mui/icons-material/Close";

/* ============================================================
 * CountrySelect — single-select searchable dropdown that mirrors
 * the UI/UX of the CRM → Client → Link Segmentation "Select
 * segmentation" dropdown (SegLinkMultiSelect): orange accent,
 * inline search, portal popup, checkmark on the selected row,
 * outside-click / Esc close, fixed positioning that follows
 * scroll/resize.
 *
 * Props:
 *   options      – [{ value, label }]
 *   value        – selected option value (number|string) or null
 *   onChange     – (value|null, option|null) => void
 *   placeholder  – trigger placeholder text
 *   disabled     – bool
 *   testId       – data-testid prefix
 * ============================================================ */
export default function CountrySelect({
  options = [], value = null, onChange, placeholder = "Select...", disabled = false, testId,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef(null);
  const popRef = useRef(null);
  const inputRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const tid = testId;

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

  // Outside-click / Esc close.
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

  const selected = useMemo(
    () => options.find((o) => String(o.value) === String(value)) || null,
    [options, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const pick = (o) => {
    onChange?.(o.value, o);
    setOpen(false);
    setQuery("");
  };
  const clear = (e) => {
    e.stopPropagation();
    onChange?.(null, null);
    setQuery("");
  };

  return (
    <>
      <div
        ref={boxRef}
        onClick={() => { if (disabled) return; setOpen(true); inputRef.current?.focus(); }}
        data-testid={tid ? `${tid}-trigger` : undefined}
        className={
          "w-full min-h-[42px] rounded-lg border bg-white px-2.5 py-1.5 flex items-center gap-2 transition-colors " +
          (disabled ? "opacity-60 cursor-not-allowed bg-gray-50 " : "cursor-text ") +
          (open ? "border-[#ec9324] ring-2 ring-[#ec9324]/20" : "border-gray-200 hover:border-gray-300")
        }
      >
        <div className="flex-1 min-w-0 flex items-center">
          {selected && !open ? (
            <span className="truncate text-sm text-gray-900" title={selected.label}>
              {selected.label}
            </span>
          ) : (
            <input
              ref={inputRef}
              value={query}
              disabled={disabled}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
              placeholder={selected ? selected.label : placeholder}
              className="w-full bg-transparent outline-none text-sm text-gray-900 placeholder-gray-400 py-0.5"
              data-testid={tid ? `${tid}-search` : undefined}
            />
          )}
        </div>
        {selected && !disabled && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear"
            className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            data-testid={tid ? `${tid}-clear` : undefined}
          >
            <Close sx={{ fontSize: 14 }} />
          </button>
        )}
        <ChevronDown
          sx={{ fontSize: 20 }}
          className={"shrink-0 text-gray-400 transition-transform " + (open ? "rotate-180" : "")}
        />
      </div>

      {open && createPortal(
        <div
          ref={popRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 60 }}
          className="bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden"
          data-testid={tid ? `${tid}-popup` : undefined}
        >
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-400 text-center">No matches</div>
            ) : (
              filtered.map((o) => {
                const sel = String(o.value) === String(value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => pick(o)}
                    className={"w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors " + (sel ? "bg-orange-50" : "hover:bg-orange-50/60")}
                    data-testid={tid ? `${tid}-opt-${o.value}` : undefined}
                  >
                    <span className="shrink-0 w-4 h-4 flex items-center justify-center">
                      {sel && <Check sx={{ fontSize: 15 }} className="text-[#ec9324]" />}
                    </span>
                    <span className={"truncate " + (sel ? "text-[#ec9324] font-medium" : "text-gray-700")}>{o.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
