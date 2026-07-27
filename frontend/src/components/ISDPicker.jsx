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

export default function ISDPicker({
  value = DEFAULT_ISD,
  onChange,
  disabled = false,
  testId = "isd-picker",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  // Focus the search input every time the popover is opened so the user
  // can start typing straight away — matches the mock in Screenshot 2.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(t);
    }
  }, [open]);

  const filtered = useMemo(() => filterIsdCodes(query), [query]);

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
            placeholder="Search country or code"
            className="h-8 text-sm"
            data-testid={`${testId}-search`}
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1" role="listbox">
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-gray-400">
              No countries match “{query}”
            </div>
          )}
          {filtered.map((c) => {
            const active = c.dial === value;
            return (
              <button
                type="button"
                key={`${c.iso}-${c.dial}`}
                onClick={() => {
                  onChange?.(c.dial, c);
                  setOpen(false);
                  setQuery("");
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-orange-50 ${
                  active ? "bg-orange-50 text-[#ec9324] font-medium" : "text-gray-800"
                }`}
                role="option"
                aria-selected={active}
                data-testid={`${testId}-option-${c.iso}`}
              >
                <span className="truncate">
                  {c.name.toLowerCase()} <span className="text-gray-500">({c.dial})</span>
                </span>
                <span className="text-[10px] text-gray-400 flex-shrink-0">{c.iso}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
