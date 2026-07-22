import React, { useMemo, useState } from "react";
import CalendarIcon from "@mui/icons-material/CalendarTodayOutlined";
import { Calendar } from "./ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/**
 * SingleDatePicker — matches the DateFilter trigger visual used across the
 * app (Profix filters, etc.) but with **only** a single date picker inside.
 * No "On / After / Before / Between" tabs, no field selector.
 *
 * The trigger renders as a bordered input-like button showing DD/MM/YYYY on
 * the left and the app-orange calendar icon on the right — perfectly the
 * same height as the custom TimePicker / SelectOrange components used
 * elsewhere on the Meeting Room booking form, so they line up on one row.
 *
 * Props:
 *   value            — "YYYY-MM-DD" string (ISO), same shape as native
 *                      <input type="date">
 *   onChange(iso)    — called with the new ISO date string
 *   disabled         — grey out the trigger
 *   min / max        — ISO strings, optional bounds
 *   testId           — data-testid prefix
 *   className        — extra classes on the trigger
 *   placeholder      — text shown when no date selected (default DD/MM/YYYY)
 */

function pad(n) { return String(n).padStart(2, "0"); }
function isoToDate(iso) {
  if (!iso) return undefined;
  // Parse as local (no timezone shift): "2026-07-22" -> local midnight
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}
function dateToISO(d) {
  if (!d) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function isoToDisplay(iso) {
  const d = isoToDate(iso);
  if (!d) return "";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export default function SingleDatePicker({
  value,
  onChange,
  disabled = false,
  min,
  max,
  testId = "single-date",
  className = "",
  placeholder = "DD/MM/YYYY",
  size = "sm",
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => isoToDate(value), [value]);
  const minD = useMemo(() => isoToDate(min), [min]);
  const maxD = useMemo(() => isoToDate(max), [max]);

  const disabledMatcher = (d) => {
    if (minD && d < minD) return true;
    if (maxD && d > maxD) return true;
    return false;
  };

  const pick = (d) => {
    if (!d) return;
    onChange?.(dateToISO(d));
    setOpen(false);
  };

  const sizeCls = size === "md" ? "px-3 py-2 text-sm" : "px-2 py-1.5 text-sm";

  return (
    <Popover open={open} onOpenChange={disabled ? () => {} : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`${testId}-trigger`}
          disabled={disabled}
          className={`w-full inline-flex items-center justify-between gap-2 ${sizeCls} rounded border border-gray-300 bg-white text-gray-800 hover:border-[#ec9324] focus:outline-none focus:border-[#ec9324] focus:ring-2 focus:ring-[#ec9324]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${className}`}
        >
          <span className={value ? "" : "text-gray-400"}>
            {value ? isoToDisplay(value) : placeholder}
          </span>
          <CalendarIcon sx={{ fontSize: 15 }} className="text-[#ec9324] shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-0"
        data-testid={`${testId}-popover`}
      >
        <Calendar
          mode="single"
          selected={selected}
          onSelect={pick}
          initialFocus
          disabled={disabledMatcher}
          classNames={{
            day_selected:
              "bg-[#ec9324] text-white hover:bg-[#d4811f] hover:text-white focus:bg-[#ec9324] focus:text-white",
            day_today: "bg-[#ec9324]/10 text-[#ec9324] font-semibold",
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
