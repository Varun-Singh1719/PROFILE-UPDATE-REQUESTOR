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
  // Rows = Level-2 nodes of the client's segmentation tree
  const l2Nodes = useMemo(() => {
    if (!seg?.segmentation?.tree) return [];
    const nodes = [];
    const walk = (node, depth) => {
      if (depth === 2) nodes.push({ name: node.name, parent: node.__parent });
      (node.children || []).forEach((c) => walk({ ...c, __parent: node.name }, depth + 1));
    };
    walk(seg.segmentation.tree, 0);
    return nodes;
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
                <PivotTable l2Nodes={l2Nodes} months={months} />
              )}

              <div className="mt-3 text-[11px] text-gray-500 italic">
                All cells are placeholders (0 / $0) until the activity calc pipeline is wired.
                Values will refresh automatically when the DateFilter is changed.
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
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

function PivotTable({ l2Nodes, months }) {
  const fmt = (val, money) => {
    if (val === 0 || val === null || val === undefined) return money ? "$0" : "0";
    return money ? `$${val}` : String(val);
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
                  const val = 0; // placeholder
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
