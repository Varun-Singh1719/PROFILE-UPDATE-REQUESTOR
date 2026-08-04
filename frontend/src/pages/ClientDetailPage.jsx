/**
 * ClientDetailPage — /crm/clients/:id
 * =========================================================
 * Similar to Client Contact detail: overview card with inline edit,
 * Segment section (redirects to Segmentations tab), Activity Summary
 * pivot table (L2 rows × Month columns × 5 metric sub-columns).
 */
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import api, { formatApiError } from "../lib/api";
import notify from "../lib/notify";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import DateFilter from "../components/DateFilter";
import Pencil from "@mui/icons-material/EditOutlined";
import ArrowBack from "@mui/icons-material/ArrowBackOutlined";
import BusinessCenter from "@mui/icons-material/BusinessCenterOutlined";
import Check from "@mui/icons-material/CheckCircleOutlined";
import LinkIcon from "@mui/icons-material/LinkOutlined";
import Plus from "@mui/icons-material/AddOutlined";
import Contacts from "@mui/icons-material/ContactsOutlined";
import Assignment from "@mui/icons-material/AssignmentOutlined";
import PieChart from "@mui/icons-material/PieChartOutlineOutlined";

const CLIENT_TYPES = [
  "Venture Capital/Private Equity",
  "Hedge funds/Public Markets",
  "Research and Consulting",
  "Corporations and Companies",
];

// ---- Date helpers (same behaviour as ClientContacts ActivitySummary) ----
function getLast6MonthsRange() {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth() - 5, 1);
  return { field: "date", mode: "between", from, to };
}
function monthsInRange(filter) {
  const MAX = 24;
  const today = new Date();
  let from, to;
  const mode = filter?.mode || "between";
  if (mode === "on") {
    if (!filter.from) return [];
    from = new Date(filter.from); to = new Date(filter.from);
  } else if (mode === "before") {
    if (!filter.from) return [];
    to = new Date(filter.from); from = new Date(to); from.setMonth(from.getMonth() - 5);
  } else if (mode === "after") {
    if (!filter.from) return [];
    from = new Date(filter.from); to = new Date(today);
    if (to < from) to = from;
    const cap = new Date(from); cap.setMonth(cap.getMonth() + 11);
    if (to > cap) to = cap;
  } else {
    if (!filter?.from || !filter?.to) return [];
    from = new Date(filter.from); to = new Date(filter.to);
    if (to < from) [from, to] = [to, from];
  }
  const out = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cur <= end && out.length < MAX) {
    const y = cur.getFullYear(), m = cur.getMonth();
    out.push({
      key: `${y}-${String(m + 1).padStart(2, "0")}`,
      label: cur.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
    });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}
const fmtDate = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeZone: "Asia/Kolkata" }); }
  catch { return iso; }
};

// ============================================================
export default function ClientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [row, setRow] = useState(null);
  const [seg, setSeg] = useState(null); // {exists, segmentation}
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", type: "" });
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const [filter, setFilter] = useState(getLast6MonthsRange);

  // ---- Load ----
  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/clients/${id}`);
      setRow(r.data);
      setForm({ name: r.data.name || "", type: r.data.type || "" });
      // segmentation lookup
      try {
        const s = await api.get(`/clients/${id}/segmentation`);
        setSeg(s.data);
      } catch { setSeg({ exists: false }); }
    } catch (e) {
      notify.error(formatApiError(e, "Failed to load client"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const handleSave = async () => {
    setSaveErr("");
    if (!form.name.trim()) { setSaveErr("Name is required"); return; }
    if (!form.type)         { setSaveErr("Type is required"); return; }
    setSaving(true);
    try {
      await api.patch(`/clients/${id}`, { name: form.name.trim(), type: form.type });
      notify.success("Client updated");
      setEditing(false);
      load();
    } catch (e) {
      setSaveErr(formatApiError(e, "Failed to save"));
    } finally { setSaving(false); }
  };

  // ---- Segment section handlers ----
  const goSegmentationExisting = () => {
    if (!seg?.segmentation) return;
    navigate(`/crm/segmentations?select=${encodeURIComponent(seg.segmentation.id)}`);
  };
  const goSegmentationAdd = () => {
    navigate(`/crm/segmentations?new=1&name=${encodeURIComponent(row?.name || "")}`);
  };

  // ---- Pivot data ----
  const months = useMemo(() => monthsInRange(filter), [filter]);
  // Rows = deepest / leaf nodes of the client's segmentation tree.
  // Falls back to leaves so segmentations that only go one level deep
  // (industry taxonomies like McKinsey) still populate the pivot.
  const l2Nodes = useMemo(() => {
    if (!seg?.segmentation?.tree) return [];
    const leaves = [];
    const walk = (node, parentName) => {
      const kids = node.children || [];
      if (!kids.length) {
        if (parentName !== null) {
          // exclude the root itself (depth 0). It always has a parentName after first descent.
          leaves.push({ name: node.name, parent: parentName });
        }
        return;
      }
      kids.forEach((c) => walk(c, node.name));
    };
    walk(seg.segmentation.tree, null);
    return leaves;
  }, [seg]);

  // Top-bar action = Edit / Save / Cancel
  const topBarActions = editing ? (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        onClick={() => { setEditing(false); setSaveErr(""); setForm({ name: row?.name || "", type: row?.type || "" }); }}
        disabled={saving}
        className="h-9"
      >
        Cancel
      </Button>
      <Button
        onClick={handleSave}
        disabled={saving}
        className="bg-[#ec9324] hover:bg-[#d3811b] text-white h-9"
        data-testid="client-detail-save"
      >
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </div>
  ) : (
    <Button
      onClick={() => setEditing(true)}
      className="bg-[#ec9324] hover:bg-[#d3811b] text-white h-9"
      data-testid="client-detail-edit"
    >
      <Pencil sx={{ fontSize: 18, marginRight: "4px" }} />
      Edit
    </Button>
  );

  return (
    <Layout title={row ? row.name : "Client"} actions={topBarActions}>
      <div className="px-6 py-5">
        {/* Back link */}
        <button
          onClick={() => navigate("/crm/clients")}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#ec9324] mb-4"
        >
          <ArrowBack sx={{ fontSize: 16 }} />
          Back to Clients
        </button>

        {loading ? (
          <div className="text-center py-16 text-sm text-gray-500">Loading…</div>
        ) : !row ? (
          <div className="text-center py-16 text-sm text-gray-500">Client not found.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {/* ============ OVERVIEW CARD ============ */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-full bg-[#ec9324] text-white flex items-center justify-center text-lg font-bold flex-shrink-0 shadow-sm">
                  {(row.name || "?").trim().split(/\s+/).map(s => s[0]).join("").slice(0,2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  {editing ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Name</Label>
                        <Input
                          value={form.name}
                          onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                          className="mt-1"
                          data-testid="client-detail-name-input"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Type</Label>
                        <Select
                          value={form.type}
                          onValueChange={(v) => setForm(f => ({ ...f, type: v }))}
                        >
                          <SelectTrigger className="mt-1" data-testid="client-detail-type-select">
                            <SelectValue placeholder="Select…" />
                          </SelectTrigger>
                          <SelectContent>
                            {CLIENT_TYPES.map(t => (
                              <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-xl font-bold text-gray-900">{row.name}</div>
                      <div className="text-[13px] text-gray-700 mt-1">
                        <span className="text-gray-500 font-medium">Type :</span>{" "}
                        <span>{row.type}</span>
                      </div>
                    </>
                  )}

                  {saveErr && (
                    <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                      {saveErr}
                    </div>
                  )}

                  {/* Meta strip */}
                  <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
                    <MetaField label="ID" value={row.display_id} mono />
                    <MetaField label="Created" value={fmtDate(row.created_on)} />
                    <MetaField label="Created by" value={row.created_by?.name || "—"} />
                    <MetaField label="Last update" value={fmtDate(row.updated_on)} />
                  </div>
                </div>
              </div>
            </div>

            {/* ============ TOTAL-TILL-DATE CHIPS ============ */}
            <TotalTillDateChips
              totals={buildTotals(seg?.exists ? row.id : null, l2Nodes)}
            />

            {/* ============ SEGMENT SECTION ============ */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-orange-100 text-[#ec9324] flex items-center justify-center">
                    <PieChart />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                      Segment
                    </div>
                    <div className="text-base font-semibold text-gray-900">
                      Segmentation for {row.name}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      Matches a segmentation whose name equals this client&apos;s name.
                    </div>
                  </div>
                </div>

                {seg?.exists ? (
                  <button
                    onClick={goSegmentationExisting}
                    data-testid="client-detail-segment-available"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold hover:bg-emerald-100 transition-colors"
                  >
                    <Check sx={{ fontSize: 18 }} />
                    Available
                    <span className="text-[11px] font-normal text-emerald-600 ml-1">
                      · open in Segmentations
                    </span>
                  </button>
                ) : (
                  <button
                    onClick={goSegmentationAdd}
                    data-testid="client-detail-segment-add"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#ec9324] text-white font-semibold hover:bg-[#d3811b] transition-colors"
                  >
                    <Plus sx={{ fontSize: 18 }} />
                    Add Segmentation
                  </button>
                )}
              </div>

              {/* When available, preview a few L2 nodes as chips */}
              {seg?.exists && l2Nodes.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
                    Level-2 nodes ({l2Nodes.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {l2Nodes.slice(0, 20).map((n, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border border-gray-200 bg-gray-50 text-gray-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        {n.name}
                      </span>
                    ))}
                    {l2Nodes.length > 20 && (
                      <span className="text-[11px] text-gray-500 italic self-center">
                        + {l2Nodes.length - 20} more…
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ============ ACTIVITY PIVOT TABLE ============ */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                    Activity Summary
                  </div>
                  <div className="text-base font-semibold text-gray-900">
                    Level-2 × Month pivot ({months.length} month{months.length === 1 ? "" : "s"})
                  </div>
                </div>
                <DateFilter
                  value={filter}
                  onChange={setFilter}
                  fieldLabels={{ date: "Activity date" }}
                  data-testid="client-detail-date-filter"
                />
              </div>

              {!seg?.exists ? (
                <div className="text-center py-10 text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg bg-gray-50/40">
                  Add a Segmentation for this client to unlock the Level-2 × Month pivot.
                </div>
              ) : l2Nodes.length === 0 ? (
                <div className="text-center py-10 text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg bg-gray-50/40">
                  This segmentation has no Level-2 nodes yet. Open it in Segmentations and add some.
                </div>
              ) : months.length === 0 ? (
                <div className="text-center py-10 text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg bg-gray-50/40">
                  Pick a valid date range to see the pivot.
                </div>
              ) : (
                <PivotTable l2Nodes={l2Nodes} months={months} clientId={row.id} />
              )}

              <div className="mt-3 text-[11px] text-gray-500 italic">
                All cells and totals are seeded pseudo-random placeholders until the activity
                calc pipeline is wired. The same client + node + month combo always renders the
                same value, so screenshots stay stable across reloads.
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

// ============================================================
// Deterministic seeded random helpers
// ============================================================
// Simple string-hash → 32-bit int, then mulberry32 PRNG so the same
// (client, l2, month, metric) tuple always yields the same value.
function _hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function _rand(seed) {
  let s = seed >>> 0;
  s = (s + 0x6D2B79F5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
// Get a seeded random integer in [min, max] inclusive for a given tuple.
function seededInt(clientId, l2, month, metric, min, max) {
  if (!clientId) return 0;
  const seed = _hash(`${clientId}|${l2}|${month}|${metric}`);
  const r = _rand(seed);
  return Math.floor(min + r * (max - min + 1));
}
// Value ranges per metric for the pivot cells
const RANGES = {
  contacts: [0, 4],
  projects: [0, 3],
  serviced: [0, 2],
  calls:    [0, 12],
  revenue:  [0, 25000], // dollars
};

// Build total-till-date sums across all L2 × months (seeded random).
// We use months in the last 12 months window regardless of DateFilter so
// "till date" stays stable while the pivot filter is interactive.
function buildTotals(clientId, l2Nodes) {
  if (!clientId || !l2Nodes?.length) return null;
  const now = new Date();
  const months = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const t = { contacts: 0, projects: 0, serviced: 0, calls: 0, revenue: 0 };
  l2Nodes.forEach((n) => {
    months.forEach((m) => {
      Object.keys(RANGES).forEach((k) => {
        const [lo, hi] = RANGES[k];
        t[k] += seededInt(clientId, n.name, m, k, lo, hi);
      });
    });
  });
  return t;
}

// ============================================================
// Total-till-date chips (5) — same visual as Client Contacts detail
// ============================================================
function TotalTillDateChips({ totals = null }) {
  const items = [
    { key: "contacts", label: "Client Contacts", isMoney: false },
    { key: "projects", label: "Projects",        isMoney: false },
    { key: "serviced", label: "Serviced",        isMoney: false },
    { key: "calls",    label: "Calls",           isMoney: false },
    { key: "revenue",  label: "Revenue",         isMoney: true  },
  ];
  const val = (k) => {
    const v = totals?.[k];
    return Number.isFinite(v) ? v : 0;
  };
  const fmt = (v, money) => {
    if (!v) return money ? "$0" : "0";
    if (money) {
      if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
      if (Math.abs(v) >= 10_000)    return `$${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
      return `$${v.toLocaleString()}`;
    }
    return v.toLocaleString();
  };
  const scheme = "border-[#ec9324]/30 bg-[#ec9324]/5 text-[#ec9324] ring-[#ec9324]/10";
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="client-total-chips">
      {items.map((i) => (
        <div
          key={i.key}
          className={`rounded-xl border ring-1 ring-inset px-4 py-3 flex items-center justify-between gap-3 shadow-sm ${scheme}`}
          data-testid={`client-total-chip-${i.key}`}
        >
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-semibold opacity-90">
              {i.label}
            </div>
            <div className="text-[10px] uppercase tracking-wider opacity-60">
              Total till date
            </div>
          </div>
          <div className="text-2xl font-bold tabular-nums">
            {fmt(val(i.key), i.isMoney)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- MetaField ----
function MetaField({ label, value, mono }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-gray-400 font-bold">{label}</div>
      <div className={`text-gray-800 mt-0.5 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

// ============================================================
// Pivot Table
//   Rows: L2 nodes
//   Columns: Months (each with 5 sub-columns for metrics)
// ============================================================
const METRICS = [
  { key: "contacts", label: "Cnt", full: "Contacts" },
  { key: "projects", label: "Prj", full: "Projects" },
  { key: "serviced", label: "Srv", full: "Serviced" },
  { key: "calls",    label: "Cal", full: "Calls" },
  { key: "revenue",  label: "Rev", full: "Revenue", money: true },
];

function PivotTable({ l2Nodes, months, clientId }) {
  const fmt = (val, money) => {
    if (val === 0 || val === null || val === undefined) return money ? "$0" : "0";
    if (money) {
      if (Math.abs(val) >= 10_000) return `$${(val / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
      return `$${val.toLocaleString()}`;
    }
    return String(val);
  };
  const cellValue = (l2Name, monthKey, metricKey) => {
    const [lo, hi] = RANGES[metricKey] || [0, 0];
    return seededInt(clientId, l2Name, monthKey, metricKey, lo, hi);
  };
  return (
    <div className="border border-gray-200 rounded-lg overflow-auto max-h-[600px]">
      <table className="min-w-full border-collapse text-[12px]">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="bg-gray-50">
            <th
              rowSpan={2}
              className="sticky left-0 z-20 bg-gray-50 text-left px-3 py-2 border-b border-r border-gray-200 text-[10px] uppercase tracking-wider text-gray-500 font-semibold min-w-[200px]"
            >
              Level 2
            </th>
            {months.map((m) => (
              <th
                key={m.key}
                colSpan={METRICS.length}
                className="text-center px-2 py-2 border-b border-r border-gray-200 text-[11px] font-bold text-gray-800 bg-orange-50/60"
              >
                {m.label}
              </th>
            ))}
          </tr>
          <tr className="bg-white">
            {months.map((m) =>
              METRICS.map((mt) => (
                <th
                  key={`${m.key}-${mt.key}`}
                  className="text-center px-2 py-1.5 border-b border-gray-200 text-[9px] uppercase tracking-wider text-gray-500 font-semibold"
                  title={mt.full}
                >
                  {mt.label}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {l2Nodes.map((n, ri) => (
            <tr key={ri} className={ri % 2 ? "bg-gray-50/40" : "bg-white"}>
              <td
                className="sticky left-0 z-10 px-3 py-2 border-b border-r border-gray-100 font-medium text-gray-800"
                style={{ background: ri % 2 ? "#fafafa" : "#fff" }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  {n.name}
                </div>
                {n.parent && (
                  <div className="text-[10px] text-gray-400 pl-3">under {n.parent}</div>
                )}
              </td>
              {months.map((m) =>
                METRICS.map((mt) => {
                  const val = cellValue(n.name, m.key, mt.key);
                  const zero = val === 0;
                  return (
                    <td
                      key={`${m.key}-${mt.key}`}
                      className={
                        "text-center px-2 py-2 border-b border-gray-100 " +
                        (zero ? "text-gray-300" : "text-gray-900 font-semibold") +
                        (mt.key === "revenue" ? " border-r border-gray-100" : "")
                      }
                    >
                      {fmt(val, mt.money)}
                    </td>
                  );
                })
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
