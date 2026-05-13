import React, { useEffect, useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import { Dialog, DialogContent, DialogTrigger } from "./ui/dialog";
import { CalendarIcon, X } from "lucide-react";

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

function fmtShort(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

export function getCurrentMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { field: "created_at", mode: "between", from, to };
}

const FIELD_LABEL = { created_at: "Created At", updated_at: "Updated At" };
const MODE_LABEL = { between: "Between", on: "On", before: "Before", after: "After" };

export default function DateFilter({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { if (open) setDraft(value); }, [open, value]);

  const trigger = useMemo(() => {
    if (!value?.from && !value?.to) return "All time";
    const f = FIELD_LABEL[value.field || "created_at"];
    if (value.mode === "between") return `${f}: ${fmtShort(value.from)} → ${fmtShort(value.to)}`;
    if (value.mode === "on") return `${f}: On ${fmtShort(value.from)}`;
    if (value.mode === "before") return `${f}: Before ${fmtShort(value.from)}`;
    if (value.mode === "after") return `${f}: After ${fmtShort(value.from)}`;
    return "All time";
  }, [value]);

  const submit = () => { onChange?.(draft); setOpen(false); };
  const reset = () => { setDraft({ field: draft?.field || "created_at", mode: "between", from: null, to: null }); };

  const clear = (e) => {
    e.stopPropagation();
    const next = { field: "created_at", mode: "between", from: null, to: null };
    onChange?.(next);
  };

  const hasFilter = value?.from || value?.to;
  const field = draft?.field || "created_at";
  const mode = draft?.mode || "between";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="date-filter-trigger"
          className="h-10 border-gray-300 text-gray-700 font-medium gap-2">
          <CalendarIcon size={15} className="text-[#ec9324]"/>
          <span>{trigger}</span>
          {hasFilter && (
            <span onClick={clear} data-testid="date-filter-clear"
              className="ml-1 inline-flex w-4 h-4 items-center justify-center rounded-full hover:bg-gray-200">
              <X size={11}/>
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl p-0 overflow-hidden">
        {/* Field selector */}
        <div className="flex items-center gap-8 px-8 pt-6 pb-5 border-b border-gray-100">
          {(["updated_at", "created_at"]).map((f) => (
            <label key={f} className="flex items-center gap-2 cursor-pointer" data-testid={`date-field-${f}`}>
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
                {FIELD_LABEL[f]}
              </span>
            </label>
          ))}
        </div>

        {/* Mode tabs */}
        <div className="flex gap-2 px-8 pt-4 border-b border-gray-100">
          {(["between", "on", "before", "after"]).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`date-mode-${m}`}
              onClick={() => setDraft({ ...draft, mode: m, to: m === "between" ? draft?.to : null })}
              className={`px-4 py-3 text-sm font-medium relative ${
                mode === m ? "text-[#ec9324]" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {MODE_LABEL[m]}
              {mode === m && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-[#ec9324] rounded-full"/>}
            </button>
          ))}
        </div>

        {/* Date inputs + calendars */}
        <div className="px-8 py-6">
          {mode === "between" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <DateInput label="From" value={draft?.from} onChange={(d) => setDraft({ ...draft, from: d })} />
                <div className="mt-4">
                  <Calendar
                    mode="single"
                    selected={draft?.from || undefined}
                    onSelect={(d) => setDraft({ ...draft, from: d || null })}
                    initialFocus
                  />
                </div>
              </div>
              <div>
                <DateInput label="To" value={draft?.to} onChange={(d) => setDraft({ ...draft, to: d })} />
                <div className="mt-4">
                  <Calendar
                    mode="single"
                    selected={draft?.to || undefined}
                    onSelect={(d) => setDraft({ ...draft, to: d || null })}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-md">
              <DateInput label={MODE_LABEL[mode]} value={draft?.from} onChange={(d) => setDraft({ ...draft, from: d })}/>
              <div className="mt-4">
                <Calendar
                  mode="single"
                  selected={draft?.from || undefined}
                  onSelect={(d) => setDraft({ ...draft, from: d || null })}
                  initialFocus
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-8 py-4 border-t border-gray-100 bg-gray-50/50">
          <Button variant="outline" onClick={reset} data-testid="date-filter-reset" className="rounded-full px-6">
            Reset
          </Button>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-full px-6">Cancel</Button>
            <Button onClick={submit} data-testid="date-filter-submit"
              className="bg-[#ec9324] hover:bg-[#d4811f] text-white rounded-full px-8">
              Submit
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DateInput({ label, value, onChange }) {
  // Read-only display; calendar drives the value
  return (
    <div className="rounded-xl border border-gray-300 px-4 py-3 bg-white relative">
      <div className="absolute -top-2.5 left-3 px-1.5 bg-white text-xs text-gray-500">{label}</div>
      <div className="text-base text-gray-900">{value ? toDisplayDDMMYYYY(value) : "—"}</div>
    </div>
  );
}

export function dateFilterToParams(v) {
  if (!v || !v.from) return {};
  const from = toISODate(v.from);
  const field = v.field === "updated_at" ? "updated_at" : "created_at";
  if (v.mode === "on") return { date_field: field, date_from: from, date_to: from };
  if (v.mode === "after") return { date_field: field, date_from: from };
  if (v.mode === "before") return { date_field: field, date_to: from };
  if (v.mode === "between") {
    const to = v.to ? toISODate(v.to) : from;
    return { date_field: field, date_from: from, date_to: to };
  }
  return {};
}
