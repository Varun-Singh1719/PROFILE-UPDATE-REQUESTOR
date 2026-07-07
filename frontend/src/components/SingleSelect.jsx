import React, { useState, useEffect, useRef } from "react";
import { ChevronsUpDown, X, Search } from "lucide-react";

/**
 * SingleSelect dropdown — plain list style (no checkboxes).
 *
 * Props:
 * - options:      [{ value, label, sublabel? }]
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

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

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
              <X size={12} />
            </span>
          )}
          <ChevronsUpDown size={13} className="text-gray-400" />
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-[#ec9324]/40 rounded-md shadow-lg max-h-72 overflow-hidden flex flex-col">
          {searchable && (
            <div className="px-2 py-2 border-b border-gray-100">
              <div className="relative">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
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
          <div className="overflow-y-auto max-h-60">
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-sm text-gray-400 text-center">No matches</div>
            )}
            {filtered.map((o) => {
              const sel = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => pick(o.value)}
                  data-testid={testId ? `${testId}-option-${o.value}` : undefined}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    sel
                      ? "bg-[#ec9324]/10 text-[#ec9324] font-semibold"
                      : "text-gray-800 hover:bg-orange-50/60"
                  }`}
                >
                  <div className="truncate">{o.label}</div>
                  {o.sublabel && (
                    <div className={`text-xs truncate ${sel ? "text-[#ec9324]/80" : "text-gray-500"}`}>
                      {o.sublabel}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
