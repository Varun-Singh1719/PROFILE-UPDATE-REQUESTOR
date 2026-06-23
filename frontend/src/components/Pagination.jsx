/**
 * Pagination — global pagination control matching the app-wide spec.
 *
 *   << First   < Previous   1 2 3 … 12   Next >   Last >>      Showing 1-50 of 2,450    Show: [50 ▼]
 *
 * Props:
 *   page                 — current 1-based page index           (required)
 *   pageSize             — current page size                    (required)
 *   total                — total record count                   (required)
 *   onPageChange(n)      — handler                              (required)
 *   onPageSizeChange(n)  — handler                              (required)
 *   pageSizeOptions      — defaults to [50, 100, 150]
 *   label                — record-noun, default "Records"
 *   className            — wrapper class
 *   compact              — drop First/Last buttons and the X-Y-of-Z line into one row
 *   testIdPrefix         — prefix for all data-testids on this instance (default "pg")
 *
 * Behaviour baked in:
 *   • Page size change → calls onPageChange(1) to reset to page 1 (per spec).
 *   • Filters / search / sort are owned by the parent — this component never
 *     touches them; the parent passes them into its server query alongside
 *     `page` and `pageSize`.
 *   • Numbered pages render with a smart sliding window so long ranges
 *     stay one row: 1 … 4 5 [6] 7 8 … 25.
 */
import React from "react";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "./ui/select";

const DEFAULT_OPTIONS = [50, 100, 150];

/**
 * Build the numbered-button window.
 * Returns an array of either page numbers (1-based) or the string "…".
 */
function pageWindow(current, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const out = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(totalPages - 1, current + 1);
  if (left > 2) out.push("…");
  for (let p = left; p <= right; p++) out.push(p);
  if (right < totalPages - 1) out.push("…");
  out.push(totalPages);
  return out;
}

function formatNumber(n) {
  return new Intl.NumberFormat("en-US").format(n);
}

export default function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_OPTIONS,
  label = "Records",
  className = "",
  compact = false,
  testIdPrefix = "pg",
}) {
  const safeTotal = Math.max(0, total | 0);
  const safePageSize = Math.max(1, pageSize | 0);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const current = Math.min(Math.max(1, page | 0), totalPages);

  const start = safeTotal === 0 ? 0 : (current - 1) * safePageSize + 1;
  const end = Math.min(current * safePageSize, safeTotal);

  const goto = (n) => {
    if (n === current) return;
    onPageChange(Math.min(Math.max(1, n), totalPages));
  };
  const changeSize = (v) => {
    const next = Number(v) || pageSizeOptions[0];
    onPageSizeChange(next);
    // Spec: return to page 1 after page-size change.
    onPageChange(1);
  };

  const showFirstLast = !compact;
  const win = pageWindow(current, totalPages);

  return (
    <div
      data-testid={`${testIdPrefix}-root`}
      className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 bg-gray-50/50 text-xs text-gray-600 ${className}`}
    >
      {/* Left — record range */}
      <div className="flex items-center gap-3" data-testid={`${testIdPrefix}-info`}>
        <span>
          {safeTotal === 0
            ? `0 ${label}`
            : <>Showing <b className="text-gray-800">{formatNumber(start)}-{formatNumber(end)}</b> of <b className="text-gray-800">{formatNumber(safeTotal)}</b> {label}</>}
        </span>
      </div>

      {/* Center — controls */}
      <div className="flex items-center gap-1" data-testid={`${testIdPrefix}-controls`}>
        {showFirstLast && (
          <Button
            size="sm" variant="outline"
            disabled={current <= 1}
            onClick={() => goto(1)}
            aria-label="First page"
            className="h-8 w-8 p-0"
            data-testid={`${testIdPrefix}-first`}
          ><ChevronsLeft size={14}/></Button>
        )}
        <Button
          size="sm" variant="outline"
          disabled={current <= 1}
          onClick={() => goto(current - 1)}
          aria-label="Previous page"
          className="h-8 w-8 p-0"
          data-testid={`${testIdPrefix}-prev`}
        ><ChevronLeft size={14}/></Button>

        {win.map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="px-1 text-gray-400 select-none">…</span>
          ) : (
            <Button
              key={p}
              size="sm"
              variant={p === current ? "default" : "outline"}
              onClick={() => goto(p)}
              className={`h-8 min-w-[2rem] px-2 ${p === current ? "bg-[#ec9324] hover:bg-[#d4811f] text-white" : ""}`}
              data-testid={`${testIdPrefix}-page-${p}`}
              aria-current={p === current ? "page" : undefined}
            >{p}</Button>
          )
        )}

        <Button
          size="sm" variant="outline"
          disabled={current >= totalPages}
          onClick={() => goto(current + 1)}
          aria-label="Next page"
          className="h-8 w-8 p-0"
          data-testid={`${testIdPrefix}-next`}
        ><ChevronRight size={14}/></Button>
        {showFirstLast && (
          <Button
            size="sm" variant="outline"
            disabled={current >= totalPages}
            onClick={() => goto(totalPages)}
            aria-label="Last page"
            className="h-8 w-8 p-0"
            data-testid={`${testIdPrefix}-last`}
          ><ChevronsRight size={14}/></Button>
        )}
      </div>

      {/* Right — page-size selector */}
      <div className="flex items-center gap-2" data-testid={`${testIdPrefix}-page-size`}>
        <span>Show:</span>
        <Select value={String(safePageSize)} onValueChange={changeSize}>
          <SelectTrigger className="w-20 h-8" data-testid={`${testIdPrefix}-page-size-trigger`}>
            <SelectValue/>
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((opt) => (
              <SelectItem key={opt} value={String(opt)} data-testid={`${testIdPrefix}-page-size-${opt}`}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
