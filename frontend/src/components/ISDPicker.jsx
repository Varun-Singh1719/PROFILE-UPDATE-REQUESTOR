/*
 * ISDPicker
 * ─────────
 * Compact searchable dropdown for International Dialling codes. Shows the
 * currently-selected dial code (e.g. "+91") as the trigger, opens a
 * popover with a search input and a virtualised-ish list (max-h + overflow).
 *
 * Search matches BOTH country name and dial code — typing "india" or "91"
 * both surface India. India (+91) is always the first item because the
 * source list already puts it on top.
 */
import React, { useMemo, useRef, useState, useEffect } from "react";
import ArrowDropDown from "@mui/icons-material/ArrowDropDown";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ISD_CODES, filterIsdCodes, DEFAULT_ISD } from "../lib/isdCodes";
import { useWheelScrollIsolation } from "../hooks/useWheelScrollIsolation";

export default function ISDPicker({
  value = DEFAULT_ISD,
  onChange,
  disabled = false,
  testId = "isd-picker",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  // Let the country list scroll with the trackpad / mouse-wheel even when the
  // picker is rendered inside a modal (Radix Dialog otherwise swallows wheel).
  useWheelScrollIsolation(listRef, open);

  // Focus the search input every time the popover is opened so the user
  // can start typing straight away — matches the mock in Screenshot 2.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(t);
    }
  }, [open]);

  const filtered = useMemo(() => filterIsdCodes(query), [query]);

  // Reset the keyboard highlight whenever the list changes / popover opens.
  useEffect(() => { setHighlight(0); }, [query, open]);

  // Scroll the highlighted option into view as the user arrows through.
  const scrollHighlightIntoView = (idx) => {
    const el = listRef.current?.querySelectorAll('[role="option"]')?.[idx];
    if (el) el.scrollIntoView({ block: "nearest" });
  };

  const moveHighlight = (delta) => {
    setHighlight((h) => {
      if (!filtered.length) return 0;
      const next = Math.min(Math.max(h + delta, 0), filtered.length - 1);
      scrollHighlightIntoView(next);
      return next;
    });
  };

  const selectCode = (c) => {
    onChange?.(c.dial, c);
    setOpen(false);
    setQuery("");
  };

  const onSearchKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveHighlight(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveHighlight(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const c = filtered[highlight];
      if (c) selectCode(c);
    } else if (e.key === "Escape") {
      setOpen(false); setQuery("");
    }
  };

  // The dial code alone can match multiple countries (e.g. +1 for US/CA).
  // Prefer the country label for display when we can find one that matches
  // exactly on ISO — but fall back to just the dial code for legacy data.
  const currentCountry = useMemo(
    () => ISD_CODES.find((c) => c.dial === value) || null,
    [value],
  );

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={`flex h-9 w-full items-center justify-between rounded-md border border-input bg-white px-3 py-1 text-sm text-left shadow-sm transition-colors hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-[#ec9324]/40 focus:border-[#ec9324] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
          data-testid={testId}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="truncate">
            {value ? (
              <span className="font-medium text-gray-900">{value}</span>
            ) : (
              <span className="text-gray-400">ISD</span>
            )}
            {currentCountry ? (
              <span className="ml-1.5 text-[11px] text-gray-500 truncate">
                {currentCountry.iso}
              </span>
            ) : null}
          </span>
          <ArrowDropDown className="text-gray-500 flex-shrink-0" sx={{ fontSize: 20 }} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[280px] p-0"
        align="start"
        sideOffset={4}
        data-testid={`${testId}-popover`}
      >
        <div className="p-2 border-b border-gray-100">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Search country or code"
            className="h-8 text-sm"
            data-testid={`${testId}-search`}
          />
        </div>
        <div
          ref={listRef}
          onWheel={(e) => e.stopPropagation()}
          className="max-h-64 overflow-y-auto overscroll-contain py-1"
          role="listbox"
        >
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-gray-400">
              No countries match “{query}”
            </div>
          )}
          {filtered.map((c, idx) => {
            const active = c.dial === value;
            const isHi = idx === highlight;
            return (
              <button
                type="button"
                key={`${c.iso}-${c.dial}`}
                onClick={() => selectCode(c)}
                onMouseEnter={() => setHighlight(idx)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                  active
                    ? "bg-orange-50 text-[#ec9324] font-medium"
                    : isHi
                    ? "bg-orange-50/60 text-gray-900"
                    : "text-gray-800 hover:bg-orange-50"
                }`}
                role="option"
                aria-selected={active}
                data-testid={`${testId}-option-${c.iso}`}
              >
                <span className="truncate">{c.name}</span>
                <span className={`text-xs flex-shrink-0 ${active ? "text-[#ec9324] font-medium" : "text-gray-500"}`}>{c.dial}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
