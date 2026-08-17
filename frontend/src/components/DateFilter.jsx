import React, { useEffect, useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import { Dialog, DialogContent, DialogTrigger } from "./ui/dialog";
import CalendarIcon from "@mui/icons-material/CalendarTodayOutlined";
import X from "@mui/icons-material/Close";

function pad(n) { return String(n).padStart(2, "0"); }

function toISODate(d) {
  if (!d) return null;
  const dt = new Date(d);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function toDisplayDDMMYYYY(d) {
  if (!d) return "";
  const dt = new Date(d);
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}

// Parse a "DD/MM/YYYY" string into a Date (or null if invalid).
function parseDDMMYYYY(text) {
  const m = String(text).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(year, month, 0).getDate();
  if (day < 1 || day > lastDay) return null;
  const d = new Date(year, month - 1, day);
  return isNaN(d.getTime()) ? null : d;
}

function fmtShort(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

export function getCurrentMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { field: "created_at", mode: "between", from, to };
}

const FIELD_LABEL = { created_at: "Created At", updated_at: "Updated At", created_on: "Created On", updated_on: "Updated On", date: "Date" };
const MODE_LABEL = { between: "Between", on: "On", before: "Before", after: "After" };

// Tighter calendar spacing overrides — reduces the large vertical gap between
// week rows so the picker doesn't feel airy. Scoped to this component only
// (does not touch the shared Calendar defaults used elsewhere).
const CAL_CLASSNAMES = {
  month: "space-y-2",
  table: "w-full border-collapse",
  row: "flex w-full mt-0.5",
  caption: "flex justify-center pt-1 pb-1 relative items-center",
};

/**
 * DateFilter — Metabase-style date range picker in a modal popup.
 *
 * Trigger: compact button `[Label]: <value>` with a calendar icon and × clear
 * (when a filter is active). Never shows two inline date inputs.
 *
 * Popup (matches screenshot):
 *   • Optional field radio group (Updated At / Created At / …) at the top
 *   • Tabs: Between · On · Before · After  (orange underline for active)
 *   • Between → two side-by-side calendars (From / To) with labelled boxes above
 *   • On/Before/After → single calendar
 *   • Footer: Reset (left) · Cancel + Submit (right, orange)
 *
 * Props:
 *   value              — { field, mode, from, to } (see getCurrentMonthRange)
 *   onChange(next)     — fires when Submit is pressed with the new value
 *   fields             — array of field keys to expose in the top radio group.
 *                        Defaults to ["updated_at", "created_at"]. Pass a single
 *                        entry to lock the field and auto-hide the group.
 *   label              — trigger label prefix. Defaults to the current field's
 *                        label (e.g. "Created At"), or "Date" if only one field.
 *   testId             — data-testid prefix (defaults to "date-filter").
 *   className          — extra classes for the trigger button.
 */
export default function DateFilter({
  value,
  onChange,
  fields = ["updated_at", "created_at"],
  label,
  testId = "date-filter",
  className = "",
  // Optional heading shown at the top of the popup (e.g. "Select Date").
  // When provided, it replaces the field radio group visually.
  title,
  // singleDate = true → hide the mode tabs and expose only a single-date
  //   picker (used for the "Booking Date" / "Request Workstation Date"
  //   pickers where "Before/After/Between" don't make sense).
  singleDate = false,
  // Optional min/max date constraints (Date | ISO string) — used when
  // singleDate is true to disable out-of-range days on the calendar.
  minDate,
  maxDate,
  // When true, the whole filter trigger is disabled (greyed out, can't open).
  // Used by permission gating: filter is Shown but its Enable flag is off.
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (open) {
      setDraft(value);
    }
  }, [open, value]);

  const showFieldSelector = !singleDate && fields.length > 1;
  // Ensure the value's field is always one of the allowed fields
  const currentField = value?.field && fields.includes(value.field) ? value.field : fields[0];

  const trigger = useMemo(() => {
    const prefix = label || (showFieldSelector ? (FIELD_LABEL[currentField] || "Date") : (FIELD_LABEL[fields[0]] || "Date"));
    if (!value?.from && !value?.to) return singleDate ? `${prefix}: —` : `${prefix}: All time`;
    if (singleDate) return `${prefix}: ${fmtShort(value.from)}`;
    if (value.mode === "between") return `${prefix}: ${fmtShort(value.from)} → ${fmtShort(value.to)}`;
    if (value.mode === "on") return `${prefix}: On ${fmtShort(value.from)}`;
    if (value.mode === "before") return `${prefix}: Before ${fmtShort(value.from)}`;
    if (value.mode === "after") return `${prefix}: After ${fmtShort(value.from)}`;
    return `${prefix}: All time`;
  }, [value, label, showFieldSelector, currentField, fields, singleDate]);

  const submit = () => { onChange?.(draft); setOpen(false); };
  const reset = () => {
    if (singleDate) setDraft({ field: fields[0], mode: "on", from: null, to: null });
    else setDraft({ field: draft?.field || fields[0], mode: "between", from: null, to: null });
  };

  const clear = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const next = singleDate
      ? { field: fields[0], mode: "on", from: null, to: null }
      : { field: fields[0], mode: "between", from: null, to: null };
    onChange?.(next);
  };

  const hasFilter = !!(value?.from || value?.to);
  const field = draft?.field && fields.includes(draft.field) ? draft.field : fields[0];
  const mode = singleDate ? "on" : (draft?.mode || "between");

  // Disable dates outside [minDate, maxDate] on the calendar
  const disabledMatcher = useMemo(() => {
    if (!minDate && !maxDate) return undefined;
    const min = minDate ? (typeof minDate === "string" ? new Date(minDate + "T00:00:00") : minDate) : null;
    const max = maxDate ? (typeof maxDate === "string" ? new Date(maxDate + "T00:00:00") : maxDate) : null;
    return (day) => {
      if (min && day < min) return true;
      if (max && day > max) return true;
      return false;
    };
  }, [minDate, maxDate]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (disabled) return; setOpen(o); }}>
      <DialogTrigger asChild>
        <button
          type="button"
          data-testid={`${testId}-trigger`}
          disabled={disabled}
          className={`inline-flex items-center gap-2 h-9 px-3 rounded-md border border-gray-200 bg-white
                      hover:border-gray-300 text-xs text-gray-700 focus:outline-none focus:ring-2
                      focus:ring-[#ec9324]/30 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
        >
          <CalendarIcon sx={{ fontSize: 14 }} className="text-[#ec9324] shrink-0"/>
          <span className="truncate max-w-[280px]">{trigger}</span>
          {hasFilter && (
            <span
              onClick={clear}
              role="button"
              aria-label="Clear date filter"
              data-testid={`${testId}-clear`}
              className="ml-1 inline-flex w-4 h-4 items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100"
            >
              <X sx={{ fontSize: 11 }}/>
            </span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent
        className={`${mode === "between" ? "max-w-xl" : "max-w-sm"} p-0 gap-0 overflow-hidden`}
      >
        {/* Optional heading (e.g. "Select Date") */}
        {title && (
          <div className="px-5 pt-4 pb-3 border-b border-gray-100 text-base font-semibold text-gray-900">
            {title}
          </div>
        )}

        {/* Field selector (hidden when only one field is exposed or a title is set) */}
        {showFieldSelector && !title && (
          <div className="flex items-center gap-8 px-5 pt-4 pb-3 border-b border-gray-100">
            {fields.map((f) => (
              <label key={f} className="flex items-center gap-2 cursor-pointer" data-testid={`${testId}-field-${f}`}>
                <span
                  className={`inline-flex w-5 h-5 rounded-full border-2 items-center justify-center ${
                    field === f ? "border-[#ec9324]" : "border-gray-300"
                  }`}
                  onClick={() => setDraft({ ...draft, field: f })}
                >
                  {field === f && <span className="w-2.5 h-2.5 rounded-full bg-[#ec9324]" />}
                </span>
                <span
                  className={`text-base ${field === f ? "text-gray-900 font-medium" : "text-gray-600"}`}
                  onClick={() => setDraft({ ...draft, field: f })}
                >
                  {FIELD_LABEL[f] || f}
                </span>
              </label>
            ))}
          </div>
        )}

        {/* Mode tabs + date inputs + calendars — shared panel (also used by
            the Auto-Approval "by Date" dialog so the two are pixel-identical). */}
        <DateRangePanel
          draft={draft}
          onDraft={setDraft}
          singleDate={singleDate}
          testId={testId}
          disabledMatcher={disabledMatcher}
        />

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/50">
          <Button variant="outline" onClick={reset} data-testid={`${testId}-reset`} className="rounded-full px-6">
            Reset
          </Button>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-full px-6">Cancel</Button>
            <Button onClick={submit} data-testid={`${testId}-submit`}
              className="bg-[#ec9324] hover:bg-[#d4811f] text-white rounded-full px-8">
              Submit
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Shared inner panel: mode tabs (Between/On/Before/After) + labelled date
// input boxes + calendar(s). Extracted so DateFilter AND the Auto-Approval
// "by Date" dialog render the exact same picker (size, spacing, inputs,
// solid-orange selected day). `draft.from`/`draft.to` are Date objects.
export function DateRangePanel({
  draft,
  onDraft,
  singleDate = false,
  testId = "date-filter",
  disabledMatcher,
}) {
  const [fromMonth, setFromMonth] = useState(() => draft?.from || new Date());
  const [toMonth, setToMonth] = useState(() => draft?.to || new Date());
  useEffect(() => { if (draft?.from) setFromMonth(draft.from); }, [draft?.from]);
  useEffect(() => { if (draft?.to) setToMonth(draft.to); }, [draft?.to]);
  const mode = singleDate ? "on" : (draft?.mode || "between");
  const set = (patch) => onDraft?.({ ...draft, ...patch });
  return (
    <>
      {!singleDate && (
        <div className="flex gap-1 px-5 border-b border-gray-100 pt-2">
          {(["between", "on", "before", "after"]).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`${testId}-mode-${m}`}
              onClick={() => set({ mode: m, to: m === "between" ? draft?.to : null })}
              className={`px-3 py-2.5 text-sm font-medium relative ${
                mode === m ? "text-[#ec9324]" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {MODE_LABEL[m]}
              {mode === m && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-[#ec9324] rounded-full"/>}
            </button>
          ))}
        </div>
      )}
      <div className="px-4 py-3">
        {mode === "between" ? (
          <div className="flex flex-wrap justify-center gap-5">
            <div className="w-[248px]">
              <DateInput label="From" testId={`${testId}-from`} value={draft?.from} onChange={(d) => set({ from: d })} />
              <div className="mt-2 flex justify-center">
                <Calendar
                  mode="single"
                  month={fromMonth}
                  onMonthChange={setFromMonth}
                  selected={draft?.from || undefined}
                  onSelect={(d) => set({ from: d || null })}
                  initialFocus
                  disabled={disabledMatcher}
                  classNames={CAL_CLASSNAMES}
                />
              </div>
            </div>
            <div className="w-[248px]">
              <DateInput label="To" testId={`${testId}-to`} value={draft?.to} onChange={(d) => set({ to: d })} />
              <div className="mt-2 flex justify-center">
                <Calendar
                  mode="single"
                  month={toMonth}
                  onMonthChange={setToMonth}
                  selected={draft?.to || undefined}
                  onSelect={(d) => set({ to: d || null })}
                  disabled={disabledMatcher}
                  classNames={CAL_CLASSNAMES}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="w-[248px] mx-auto">
            <DateInput label={singleDate ? "Date" : MODE_LABEL[mode]} testId={`${testId}-single`} value={draft?.from} onChange={(d) => set({ from: d })}/>
            <div className="mt-2 flex justify-center">
              <Calendar
                mode="single"
                month={fromMonth}
                onMonthChange={setFromMonth}
                selected={draft?.from || undefined}
                onSelect={(d) => set({ from: d || null, mode: singleDate ? "on" : (draft?.mode || "on") })}
                initialFocus
                disabled={disabledMatcher}
                classNames={CAL_CLASSNAMES}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function DateInput({ label, value, onChange, testId }) {
  const inputRef = React.useRef(null);
  const pendingSel = React.useRef(null); // [start, end] to reselect after arrow edits
  const [text, setText] = React.useState(value ? toDisplayDDMMYYYY(value) : "");

  // Sync the text box when the bound value changes externally (calendar click).
  // Skip the overwrite while the field is focused and holds an in-progress edit
  // that doesn't yet parse, so typing isn't clobbered.
  React.useEffect(() => {
    const focused = document.activeElement === inputRef.current;
    const parsed = parseDDMMYYYY(text);
    if (focused && !parsed && text !== "") return;
    setText(value ? toDisplayDDMMYYYY(value) : "");
  }, [value]);

  // Restore the caret to the edited segment after an arrow-key change.
  React.useLayoutEffect(() => {
    if (pendingSel.current && inputRef.current) {
      const [s, e] = pendingSel.current;
      inputRef.current.focus();
      inputRef.current.setSelectionRange(s, e);
      pendingSel.current = null;
    }
  });

  const commit = (t) => {
    setText(t);
    if (t.trim() === "") { onChange(null); return; }
    const d = parseDDMMYYYY(t);
    if (d) onChange(d);
  };

  // Segment helpers for "DD/MM/YYYY" (caret 0-2 = day, 3-5 = month, 6-10 = year)
  const segmentAt = (pos) => (pos <= 2 ? "day" : pos <= 5 ? "month" : "year");
  const segmentRange = (s) => (s === "day" ? [0, 2] : s === "month" ? [3, 5] : [6, 10]);

  const handleKeyDown = (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const el = inputRef.current;
    const pos = el?.selectionStart ?? 0;
    const seg = segmentAt(pos);
    const delta = e.key === "ArrowUp" ? 1 : -1;

    const base = parseDDMMYYYY(text) || (value ? new Date(value) : new Date());
    const y = base.getFullYear();
    const mIdx = base.getMonth();
    const d = base.getDate();

    let next;
    if (seg === "day") {
      next = new Date(y, mIdx, d + delta);
    } else if (seg === "month") {
      const targetIdx = mIdx + delta;
      const lastDay = new Date(y, ((targetIdx % 12) + 12) % 12 + 1, 0).getDate();
      next = new Date(y, targetIdx, Math.min(d, lastDay));
    } else {
      const lastDay = new Date(y + delta, mIdx + 1, 0).getDate();
      next = new Date(y + delta, mIdx, Math.min(d, lastDay));
    }

    setText(toDisplayDDMMYYYY(next));
    onChange(next);
    pendingSel.current = segmentRange(seg);
  };

  const handleFocus = (e) => {
    // Select the day segment on focus for immediate arrow-key stepping.
    const el = e.target;
    requestAnimationFrame(() => {
      try { el.setSelectionRange(0, 2); } catch (_) { /* noop */ }
    });
  };

  return (
    <div className="rounded-xl border border-gray-300 px-4 py-2.5 bg-white relative focus-within:border-[#ec9324] focus-within:ring-2 focus-within:ring-[#ec9324]/20 transition-colors">
      <div className="absolute -top-2.5 left-3 px-1.5 bg-white text-xs text-gray-500">{label}</div>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        placeholder="DD/MM/YYYY"
        value={text}
        onChange={(e) => commit(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        data-testid={testId ? `${testId}-input` : undefined}
        aria-label={`${label} date, format DD/MM/YYYY`}
        className="w-full text-base text-gray-900 outline-none bg-transparent placeholder:text-gray-400"
      />
    </div>
  );
}

export function dateFilterToParams(v) {
  if (!v || !v.from) return {};
  const from = toISODate(v.from);
  const field = v.field === "updated_at" ? "updated_at" : (v.field === "date" ? "date" : "created_at");
  if (v.mode === "on") return { date_field: field, date_from: from, date_to: from };
  if (v.mode === "after") return { date_field: field, date_from: from };
  if (v.mode === "before") return { date_field: field, date_to: from };
  if (v.mode === "between") {
    const to = v.to ? toISODate(v.to) : from;
    return { date_field: field, date_from: from, date_to: to };
  }
  return {};
}
