import React, { useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "./ui/select";
import { CalendarIcon, X } from "lucide-react";

function toISODate(d) {
  if (!d) return null;
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmt(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

export function getCurrentMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { mode: "between", from, to };
}

/**
 * DateFilter — Metabase-style filter (On / After / Before / Between)
 * value: { mode: 'on'|'after'|'before'|'between', from: Date, to?: Date }
 * onChange(value)
 */
export default function DateFilter({ value, onChange, label = "Created At" }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const display = useMemo(() => {
    if (!value || !value.from) return "All time";
    if (value.mode === "on") return `On ${fmt(value.from)}`;
    if (value.mode === "after") return `After ${fmt(value.from)}`;
    if (value.mode === "before") return `Before ${fmt(value.from)}`;
    if (value.mode === "between") return `${fmt(value.from)} → ${fmt(value.to)}`;
    return "All time";
  }, [value]);

  const apply = () => {
    onChange?.(draft);
    setOpen(false);
  };

  const clear = (e) => {
    e.stopPropagation();
    const next = { mode: "between", from: null, to: null };
    setDraft(next); onChange?.(next); setOpen(false);
  };

  const hasFilter = value?.from || value?.to;

  return (
    <Popover open={open} onOpenChange={(o) => { if (o) setDraft(value); setOpen(o); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" data-testid="date-filter-trigger"
          className="h-10 border-gray-300 text-gray-700 font-medium gap-2">
          <CalendarIcon size={15} className="text-[#ec9324]"/>
          <span className="text-xs uppercase tracking-wide text-gray-400 mr-1">{label}</span>
          <span>{display}</span>
          {hasFilter && (
            <span onClick={clear} data-testid="date-filter-clear"
              className="ml-1 inline-flex w-4 h-4 items-center justify-center rounded-full hover:bg-gray-200">
              <X size={11}/>
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-4" align="end">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Filter mode</span>
          <Select value={draft?.mode || "between"} onValueChange={(m) => setDraft({ ...draft, mode: m })}>
            <SelectTrigger className="h-8 w-32" data-testid="date-filter-mode">
              <SelectValue/>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="on">On</SelectItem>
              <SelectItem value="after">After</SelectItem>
              <SelectItem value="before">Before</SelectItem>
              <SelectItem value="between">Between</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {draft?.mode === "between" ? (
          <Calendar
            mode="range"
            selected={{ from: draft?.from || undefined, to: draft?.to || undefined }}
            onSelect={(r) => setDraft({ mode: "between", from: r?.from || null, to: r?.to || null })}
            numberOfMonths={2}
            initialFocus
          />
        ) : (
          <Calendar
            mode="single"
            selected={draft?.from || undefined}
            onSelect={(d) => setDraft({ ...draft, from: d || null, to: null })}
            initialFocus
          />
        )}

        <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-gray-100">
          <Button variant="ghost" size="sm" onClick={() => { const r = getCurrentMonthRange(); setDraft(r); }} data-testid="date-filter-current-month">
            Current Month
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" onClick={apply} data-testid="date-filter-apply"
            className="bg-[#ec9324] hover:bg-[#d4811f] text-white">Apply</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function dateFilterToParams(v) {
  if (!v || !v.from) return {};
  const from = toISODate(v.from);
  if (v.mode === "on") return { date_from: from, date_to: from };
  if (v.mode === "after") return { date_from: from };
  if (v.mode === "before") return { date_to: from };
  if (v.mode === "between") {
    const to = v.to ? toISODate(v.to) : from;
    return { date_from: from, date_to: to };
  }
  return {};
}
