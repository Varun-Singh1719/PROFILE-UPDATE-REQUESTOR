import React, { useState, useEffect, useRef } from "react";
import Check from "@mui/icons-material/Check";
import ChevronsUpDown from "@mui/icons-material/UnfoldMore";
import X from "@mui/icons-material/Close";
import Search from "@mui/icons-material/SearchOutlined";
import { useWheelScrollIsolation } from "../hooks/useWheelScrollIsolation";

/**
 * MultiSelect dropdown with search.
 *
 * Props:
 * - options: [{ value, label, sublabel? }]
 * - value: string[] (selected values)
 * - onChange: (newValue: string[]) => void
 * - placeholder?: string
 * - testId?: string
 */
export default function MultiSelect({ options = [], value = [], onChange, placeholder = "Select...", testId, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);
  const listRef = useRef(null);

  useWheelScrollIsolation(listRef, open);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedOptions = options.filter((o) => value.includes(o.value));
  const filtered = options.filter((o) => {
    const q = search.toLowerCase();
    return !q || o.label.toLowerCase().includes(q) || (o.sublabel || "").toLowerCase().includes(q);
  });

  const toggle = (val) => {
    if (value.includes(val)) onChange(value.filter((v) => v !== val));
    else onChange([...value, val]);
  };

  const removeChip = (e, val) => {
    e.stopPropagation();
    onChange(value.filter((v) => v !== val));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        data-testid={testId}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`w-full min-h-10 flex items-center justify-between rounded-md border bg-white px-3 py-2 text-sm text-left focus:outline-none focus:ring-2 focus:ring-[#ec9324]/40 transition-colors ${
          disabled ? "opacity-60 cursor-not-allowed border-gray-300" : open ? "border-[#ec9324]" : "border-gray-300 hover:border-gray-400"
        }`}
      >
        <div className="flex flex-wrap gap-1 items-center flex-1">
          {selectedOptions.length === 0 && (
            <span className="text-gray-400">{placeholder}</span>
          )}
          {selectedOptions.map((o) => (
            <span
              key={o.value}
              className="inline-flex items-center gap-1 rounded-md bg-[#ec9324]/10 text-[#ec9324] px-2 py-0.5 text-xs font-medium"
            >
              {o.label}
              {!disabled && (
                <span
                  onClick={(e) => removeChip(e, o.value)}
                  className="hover:bg-[#ec9324]/20 rounded p-0.5 cursor-pointer"
                  data-testid={`${testId}-chip-remove-${o.value}`}
                  role="button"
                  tabIndex={0}
                >
                  <X sx={{ fontSize: 11 }}/>
                </span>
              )}
            </span>
          ))}
        </div>
        <ChevronsUpDown sx={{ fontSize: 14 }} className="ml-2 text-gray-400 flex-shrink-0"/>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-[#ec9324]/40 rounded-md shadow-lg max-h-72 overflow-hidden flex flex-col">
          <div className="px-2 py-2 border-b border-gray-100">
            <div className="relative">
              <Search sx={{ fontSize: 14 }} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input
                type="text"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                data-testid={`${testId}-search`}
                className="w-full text-sm pl-7 pr-2 py-1.5 rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-[#ec9324]/40"
              />
            </div>
          </div>
          <div ref={listRef} className="overflow-y-auto overscroll-contain max-h-56">
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-sm text-gray-400 text-center">No matches</div>
            )}
            {filtered.map((o) => {
              const sel = value.includes(o.value);
              const isDisabled = !!o.disabled;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => !isDisabled && toggle(o.value)}
                  data-testid={`${testId}-option-${o.value}`}
                  title={isDisabled ? (o.disabledReason || "Not selectable") : undefined}
                  disabled={isDisabled}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                    isDisabled
                      ? "opacity-50 cursor-not-allowed bg-gray-50"
                      : sel
                      ? "bg-[#ec9324]/10 hover:bg-[#ec9324]/15"
                      : "hover:bg-orange-50/60"
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                      sel ? "bg-[#ec9324] border-[#ec9324] text-white" : "border-gray-300"
                    }`}
                  >
                    {sel && <Check sx={{ fontSize: 12 }}/>}
                  </span>
                  <div className="flex-1 text-left">
                    <div className="font-medium text-gray-900">{o.label}</div>
                    {o.sublabel && <div className="text-xs text-gray-500">{o.sublabel}</div>}
                    {isDisabled && o.disabledReason && (
                      <div className="text-[10px] text-amber-600 mt-0.5">{o.disabledReason}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
