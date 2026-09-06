import React, { useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as RechartsTooltip,
} from "recharts";
import DateFilter from "./DateFilter";

// ================================================================ CPR-Monthly chart
// A multi-series monthly trend of Calls / Revenue $ / Projects, mirroring the
// ProfiX "CPR-Monthly" widget. Reads `activity_by_month`
// ({ projects|calls|revenue: { "YYYY-MM": n } }) and honours the SAME DateFilter
// passed down from the host page (default = Last 12 Months).
//
// Dual Y-axis: left = counts (Calls & Projects), right = Revenue in $.
export const CPR_COLORS = { calls: "#7cb342", revenue: "#e8776f", projects: "#f2c94c" };

// Default filter — last 12 months, Between mode (11 months back → 12 columns).
export function getLast12MonthsRange() {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - 11);
  from.setDate(1);
  return { field: "date", mode: "between", from, to };
}

// Build the ordered list of month keys (YYYY-MM) spanned by a DateFilter value,
// honouring all four modes (between / on / before / after). Caps at 36 months.
function monthsInRange(filter) {
  const MAX = 36;
  const today = new Date();
  let from, to;
  const mode = filter?.mode || "between";
  if (mode === "on") {
    if (!filter.from) return [];
    from = new Date(filter.from);
    to = new Date(filter.from);
  } else if (mode === "before") {
    if (!filter.from) return [];
    to = new Date(filter.from);
    from = new Date(to);
    from.setMonth(from.getMonth() - 11);
  } else if (mode === "after") {
    if (!filter.from) return [];
    from = new Date(filter.from);
    to = new Date(today);
    if (to < from) to = from;
    const cap = new Date(from);
    cap.setMonth(cap.getMonth() + 11);
    if (to > cap) to = cap;
  } else {
    if (!filter?.from || !filter?.to) return [];
    from = new Date(filter.from);
    to = new Date(filter.to);
    if (to < from) [from, to] = [to, from];
  }
  const out = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cur <= end && out.length < MAX) {
    const y = cur.getFullYear();
    const m = cur.getMonth();
    out.push({
      key: `${y}-${String(m + 1).padStart(2, "0")}`,
      label: cur.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
    });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

function fmtMoneyAxis(v) {
  if (!v) return "$0";
  const a = Math.abs(v);
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (a >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${v}`;
}

function CprTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const get = (k) => payload.find((p) => p.dataKey === k)?.value ?? 0;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl px-3 py-2 text-xs">
      <div className="font-semibold text-white mb-1.5">{label}</div>
      <div className="flex items-center gap-2 text-gray-300">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: CPR_COLORS.calls }} />
        Calls<span className="ml-auto font-semibold text-white tabular-nums">{get("calls").toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-2 text-gray-300 mt-1">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: CPR_COLORS.revenue }} />
        Revenue $<span className="ml-auto font-semibold text-white tabular-nums">${get("revenue").toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-2 text-gray-300 mt-1">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: CPR_COLORS.projects }} />
        Projects<span className="ml-auto font-semibold text-white tabular-nums">{get("projects").toLocaleString()}</span>
      </div>
    </div>
  );
}

export default function CprMonthlyChart({ filter, onFilterChange, data = null, testId = "cpr" }) {
  const months = useMemo(() => monthsInRange(filter), [filter]);

  const chartData = useMemo(
    () =>
      months.map((m) => ({
        label: m.label,
        calls: (data?.calls?.[m.key]) || 0,
        revenue: (data?.revenue?.[m.key]) || 0,
        projects: (data?.projects?.[m.key]) || 0,
      })),
    [months, data]
  );

  const hasData = chartData.some((d) => d.calls || d.revenue || d.projects);

  const renderCountLabel = (props) => {
    const { x, y, value } = props;
    if (!value) return null;
    return (
      <text x={x} y={y - 9} textAnchor="middle" fontSize={10} fontWeight={600} fill="#4b5563">
        {value.toLocaleString()}
      </text>
    );
  };
  const renderMoneyLabel = (props) => {
    const { x, y, value } = props;
    if (!value) return null;
    return (
      <text x={x} y={y - 9} textAnchor="middle" fontSize={10} fontWeight={600} fill="#c2544c">
        {`$${value.toLocaleString()}`}
      </text>
    );
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm" data-testid={`${testId}-cpr-monthly`}>
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            CPR-Monthly
          </div>
          <div className="text-sm text-gray-800 font-semibold">
            {months.length > 0
              ? `${months.length} month${months.length === 1 ? "" : "s"} · ${months[0].label} → ${months[months.length - 1].label}`
              : "Last 12 Months (default)"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DateFilter
            value={filter}
            onChange={onFilterChange}
            fields={["date"]}
            label="Range"
            testId={`${testId}-cpr-date-filter`}
          />
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center flex-wrap gap-x-5 gap-y-1.5 mb-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
          <span className="inline-block w-3 h-3 rounded-full" style={{ background: CPR_COLORS.calls }} /> Calls
        </span>
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
          <span className="inline-block w-3 h-3 rounded-full" style={{ background: CPR_COLORS.revenue }} /> Revenue $
        </span>
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
          <span className="inline-block w-3 h-3 rounded-full" style={{ background: CPR_COLORS.projects }} /> Projects
        </span>
      </div>

      {hasData ? (
        <div className="w-full" style={{ height: 420 }} data-testid={`${testId}-cpr-chart`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 24, right: 20, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="4 4" stroke="#eef0f2" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={{ stroke: "#e5e7eb" }}
                interval="preserveStartEnd"
                minTickGap={8}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(v) => v.toLocaleString()}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                width={60}
                tickFormatter={fmtMoneyAxis}
                label={{ value: "Revenue $", angle: 90, position: "insideRight", fontSize: 11, fill: "#9ca3af" }}
              />
              <RechartsTooltip
                content={<CprTooltip />}
                isAnimationActive={false}
                wrapperStyle={{ transition: "none", pointerEvents: "none" }}
                cursor={{ stroke: "#d1d5db", strokeWidth: 1, strokeDasharray: "3 3" }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="revenue"
                name="Revenue $"
                stroke={CPR_COLORS.revenue}
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#fff", stroke: CPR_COLORS.revenue, strokeWidth: 2 }}
                activeDot={{ r: 5 }}
                label={renderMoneyLabel}
                isAnimationActive={false}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="calls"
                name="Calls"
                stroke={CPR_COLORS.calls}
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#fff", stroke: CPR_COLORS.calls, strokeWidth: 2 }}
                activeDot={{ r: 5 }}
                label={renderCountLabel}
                isAnimationActive={false}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="projects"
                name="Projects"
                stroke={CPR_COLORS.projects}
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#fff", stroke: CPR_COLORS.projects, strokeWidth: 2 }}
                activeDot={{ r: 5 }}
                label={renderCountLabel}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-[240px] flex flex-col items-center justify-center text-center">
          <div className="text-sm text-gray-500 font-medium">No activity in this range</div>
          <div className="text-[11px] text-gray-400 mt-1">
            Calls, Revenue &amp; Projects will plot here once there is data for the selected months.
          </div>
        </div>
      )}

      <div className="mt-3 text-[11px] text-gray-400 italic flex items-center justify-end">
        <span className="text-gray-500">Default range: <b className="text-gray-700">Last 12 Months</b></span>
      </div>
    </div>
  );
}
