import React, { useMemo } from "react";

/**
 * MonthYearPicker — two side-by-side dropdowns (Month + Year) that emit
 * a "MMM YYYY" string on change (e.g., "Jan 2024"). Empty selection returns
 * an empty string so the caller can preserve the "not set" state.
 *
 * Purpose:
 *   Used inside the Client Contacts "Previous Work Experience" repeatable
 *   rows for Start Date and End Date. Keeps the storage format compatible
 *   with the current backend schema (`start_month_year` / `end_month_year`
 *   are `Optional[str]`).
 *
 * Props:
 *   value      : string ("MMM YYYY" | "Present" | "")
 *   onChange   : (str) => void
 *   allowPresent : if true, adds a "Present" option to the month dropdown
 *                  (only used on End Date). When "Present" is picked, the
 *                  emitted value is literally "Present".
 *   placeholder: string ("Month year")
 *   testId     : string
 *   className  : extra classes for the wrapper
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Range of years to expose. Currently: current year + 4 forward, back to 1970.
function buildYears() {
  const cy = new Date().getFullYear();
  const out = [];
  for (let y = cy + 4; y >= 1970; y--) out.push(String(y));
  return out;
}

function parse(value) {
  if (!value) return { month: "", year: "", present: false };
  if (String(value).trim().toLowerCase() === "present") {
    return { month: "", year: "", present: true };
  }
  const parts = String(value).trim().split(/\s+/);
  if (parts.length === 2) {
    const m = MONTHS.find((mm) => mm.toLowerCase() === parts[0].toLowerCase().slice(0, 3));
    return { month: m || "", year: /^\d{4}$/.test(parts[1]) ? parts[1] : "", present: false };
  }
  return { month: "", year: "", present: false };
}

export default function MonthYearPicker({
  value = "",
  onChange,
  allowPresent = false,
  testId,
  className = "",
  disabled = false,
}) {
  const { month, year, present } = useMemo(() => parse(value), [value]);
  const years = useMemo(buildYears, []);

  const emit = (nextMonth, nextYear, nextPresent) => {
    if (nextPresent) {
      onChange && onChange("Present");
      return;
    }
    if (nextMonth && nextYear) {
      onChange && onChange(`${nextMonth} ${nextYear}`);
    } else if (!nextMonth && !nextYear) {
      onChange && onChange("");
    } else {
      // Partial selection — keep as-is but still emit so the caller sees the draft.
      onChange && onChange(`${nextMonth} ${nextYear}`.trim());
    }
  };

  const baseSelect =
    "border border-gray-300 rounded-md text-sm px-2 py-1.5 bg-white focus:outline-none focus:border-[#ec9324] focus:ring-1 focus:ring-[#ec9324]/40 disabled:bg-gray-50 disabled:text-gray-400";

  return (
    <div className={`flex items-center gap-1.5 ${className}`} data-testid={testId}>
      <select
        className={`${baseSelect} flex-1 min-w-0`}
        value={present ? "__present__" : month}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__present__") emit("", "", true);
          else emit(v, year, false);
        }}
        disabled={disabled}
        data-testid={testId ? `${testId}-month` : undefined}
      >
        <option value="">Month</option>
        {allowPresent && <option value="__present__">Present</option>}
        {MONTHS.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <select
        className={`${baseSelect} w-24`}
        value={present ? "" : year}
        onChange={(e) => emit(month, e.target.value, false)}
        disabled={disabled || present}
        data-testid={testId ? `${testId}-year` : undefined}
      >
        <option value="">Year</option>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}
