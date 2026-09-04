/**
 * ClientDetailPage — /crm/clients/:id
 * =========================================================
 * Similar to Client Contact detail: overview card with inline edit,
 * Segment section (redirects to Segmentations tab), Activity Summary
 * pivot table (L2 rows × Month columns × 5 metric sub-columns).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import api, { formatApiError } from "../lib/api";
import notify from "../lib/notify";
import { confirm as confirmDialog } from "../lib/dialog";
import LinkSegmentationTab from "../components/LinkSegmentationTab";
import ClientWorkexContacts from "../components/ClientWorkexContacts";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import SearchSelect from "../components/SearchSelect";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../components/ui/dialog";
import DateFilter from "../components/DateFilter";
import POCStatusChip from "../components/POCStatusChip";
import ArrowBack from "@mui/icons-material/ArrowBackOutlined";
import BusinessCenter from "@mui/icons-material/BusinessCenterOutlined";
import Check from "@mui/icons-material/CheckCircleOutlined";
import LinkIcon from "@mui/icons-material/LinkOutlined";
import Plus from "@mui/icons-material/AddOutlined";
import Contacts from "@mui/icons-material/ContactsOutlined";
import Assignment from "@mui/icons-material/AssignmentOutlined";
import PieChart from "@mui/icons-material/PieChartOutlineOutlined";
import Timer from "@mui/icons-material/TimerOutlined";
import Pencil from "@mui/icons-material/EditOutlined";
import Autorenew from "@mui/icons-material/Autorenew";
import Save from "@mui/icons-material/SaveOutlined";

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
  const MAX = 72; // support up to 6 years to stay ahead of a 4-5 year range
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
  const [form, setForm] = useState({ name: "", type: "", key_account_manager_ids: [] });
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  // Per-client "Sync from MySQL" — refreshes this client's activity metrics.
  const [syncingOne, setSyncingOne] = useState(false);
  const handleSyncOne = async () => {
    setSyncingOne(true);
    try {
      const r = await api.post(`/clients/${id}/sync`);
      setRow(r.data);
      notify.success("Synced from MySQL");
    } catch (e) {
      notify.error(formatApiError(e, "Sync failed"));
    } finally {
      setSyncingOne(false);
    }
  };
  const [employees, setEmployees] = useState([]);   // employee directory for KAM dropdown

  const [filter, setFilter] = useState(getLast6MonthsRange);

  // ---- Tabs (Overview | Link Segmentation) ----
  const [activeTab, setActiveTab] = useState("overview");
  const linkTabRef = useRef(null);
  const linkDirtyRef = useRef(false);
  const [linkDirty, setLinkDirty] = useState(false);
  const [linkSaving, setLinkSaving] = useState(false);
  const onLinkDirtyChange = (d) => { linkDirtyRef.current = d; setLinkDirty(d); };
  const onLinkSavingChange = (s) => setLinkSaving(s);

  // Unsaved-changes confirmation used whenever the user tries to leave the
  // Link Segmentation tab with pending edits (tab switch / navigate away).
  const confirmLeave = async () => {
    if (!linkDirtyRef.current) return true;
    const ok = await confirmDialog({
      title: "Are you sure you want to leave this page without saving your changes?",
      confirmLabel: "Yes",
      cancelLabel: "Cancel",
      confirmVariant: "destructive",
    });
    return ok;
  };

  // Guarded tab switch — prompts before leaving a dirty Link Segmentation tab.
  const switchTab = async (tab) => {
    if (tab === activeTab) return;
    if (activeTab === "link" && linkDirtyRef.current) {
      const ok = await confirmLeave();
      if (!ok) return;           // Cancel → stay, preserve edits
      linkTabRef.current?.discard?.();
      linkDirtyRef.current = false;
      setLinkDirty(false);
    }
    setActiveTab(tab);
  };

  // Guarded in-app navigation (back button / any leave action).
  const guardedNavigate = async (to) => {
    if (activeTab === "link" && linkDirtyRef.current) {
      const ok = await confirmLeave();
      if (!ok) return;
      linkDirtyRef.current = false;
      setLinkDirty(false);
    }
    navigate(to);
  };

  // Guard hard reloads / tab-close while there are unsaved link edits.
  useEffect(() => {
    const handler = (e) => {
      if (linkDirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // ---- Load ----
  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/clients/${id}`);
      setRow(r.data);
      setForm({
        name: r.data.name || "",
        type: r.data.type || "",
        key_account_manager_ids: r.data.key_account_manager_ids || [],
      });
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

  // Employee directory → Key Account Manager options (same source/UX as
  // Manage → Team → Team Members).
  useEffect(() => {
    api.get("/contacts")
      .then((r) => setEmployees(r.data || []))
      .catch(() => setEmployees([]));
  }, []);

  const kamOptions = useMemo(
    () =>
      (employees || [])
        .filter((e) => e.status === "Active")
        .map((e) => ({
          value: e.id,
          label: e.name,
          meta: e.emp_id || "",
          searchText: `${e.name} ${e.emp_id || ""}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [employees]
  );

  const handleSave = async () => {
    setSaveErr("");
    if (!form.name.trim()) { setSaveErr("Name is required"); return; }
    if (!form.type)         { setSaveErr("Type is required"); return; }
    setSaving(true);
    try {
      await api.patch(`/clients/${id}`, {
        name: form.name.trim(),
        type: form.type,
        key_account_manager_ids: form.key_account_manager_ids || [],
      });
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
        onClick={() => { setEditing(false); setSaveErr(""); setForm({ name: row?.name || "", type: row?.type || "", key_account_manager_ids: row?.key_account_manager_ids || [] }); }}
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
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        onClick={handleSyncOne}
        disabled={syncingOne}
        className="h-9"
        data-testid="client-detail-sync"
      >
        <Autorenew sx={{ fontSize: 16, marginRight: "4px" }} className={syncingOne ? "animate-spin" : ""} />
        {syncingOne ? "Syncing…" : "Sync"}
      </Button>
      <Button
        onClick={() => setEditing(true)}
        className="bg-[#ec9324] hover:bg-[#d3811b] text-white h-9"
        data-testid="client-detail-edit"
      >
        <Pencil sx={{ fontSize: 18, marginRight: "4px" }} />
        Edit
      </Button>
    </div>
  );

  return (
    <Layout title={row ? row.name : "Client"} actions={activeTab === "overview" ? topBarActions : null}>
      <div className="px-6 py-2.5">
        {/* Back link */}
        <button
          onClick={() => guardedNavigate("/crm/clients")}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#ec9324] mb-1.5"
        >
          <ArrowBack sx={{ fontSize: 16 }} />
          Back to Clients
        </button>

        {/* ============ TABS ============ */}
        {!loading && row && (
          <div className="flex items-center justify-between border-b border-gray-200 mb-3">
            <div className="flex items-center gap-1" role="tablist">
              {[
                { key: "overview", label: "Overview" },
                { key: "contacts", label: "Client Contacts" },
                { key: "link", label: "Link Segmentation" },
              ].map((t) => {
                const active = activeTab === t.key;
                return (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={active}
                    onClick={() => switchTab(t.key)}
                    data-testid={`client-tab-${t.key}`}
                    className={
                      "relative px-4 py-2 text-sm font-semibold transition-colors -mb-px border-b-2 " +
                      (active
                        ? "text-[#ec9324] border-[#ec9324]"
                        : "text-gray-500 border-transparent hover:text-gray-800")
                    }
                  >
                    {t.label}
                    {t.key === "link" && linkDirty && (
                      <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-[#ec9324] align-middle" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Save / Cancel parallel to the tab name (Link Segmentation tab only) */}
            {activeTab === "link" && (
              <div className="flex items-center gap-2 pb-1.5">
                <Button
                  variant="outline"
                  onClick={() => linkTabRef.current?.cancel?.()}
                  disabled={!linkDirty || linkSaving}
                  className="h-8"
                  data-testid="link-seg-cancel"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => linkTabRef.current?.save?.()}
                  disabled={!linkDirty || linkSaving}
                  className="bg-[#ec9324] hover:bg-[#d3811b] text-white h-8"
                  data-testid="link-seg-save"
                >
                  {linkSaving ? "Saving…" : "Save"}
                </Button>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-sm text-gray-500">Loading…</div>
        ) : !row ? (
          <div className="text-center py-16 text-sm text-gray-500">Client not found.</div>
        ) : activeTab === "link" ? (
          <LinkSegmentationTab
            ref={linkTabRef}
            clientId={id}
            clientName={row.name}
            onDirtyChange={onLinkDirtyChange}
            onSavingChange={onLinkSavingChange}
            onAddSegmentation={goSegmentationAdd}
          />
        ) : activeTab === "contacts" ? (
          <ClientWorkexContacts clientId={id} clientName={row.name} />
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
                        <div className="mt-1">
                          <SearchSelect
                            options={CLIENT_TYPES.map((t) => ({ value: t, label: t }))}
                            value={form.type || ""}
                            onChange={(v) => setForm(f => ({ ...f, type: v || "" }))}
                            placeholder="Select…"
                            allowClear={false}
                            testId="client-detail-type-select"
                          />
                        </div>
                      </div>
                      <div className="md:col-span-2">
                        <Label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Key Account Manager</Label>
                        <div className="mt-1">
                          <MultiSelectFilter
                            label="Key Account Manager"
                            options={kamOptions}
                            value={form.key_account_manager_ids || []}
                            onChange={(v) => setForm(f => ({ ...f, key_account_manager_ids: v }))}
                            placeholder="Select key account manager(s)…"
                            testIdPrefix="client-detail-kam"
                            hideLabelPrefix
                            fullWidth
                            searchInTrigger
                            countUnitLabel="manager(s) selected"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-xl font-bold text-gray-900">{row.name}</div>
                      {/* Type (left) + Key Account Manager (right-aligned, parallel) on one row */}
                      <div className="mt-1 flex items-start justify-between gap-4 flex-wrap">
                        <div className="text-[13px] text-gray-700">
                          <span className="text-gray-500 font-medium">Type :</span>{" "}
                          <span>{row.type}</span>
                        </div>
                        <div className="text-[13px] text-gray-700 flex items-start gap-1.5 flex-wrap justify-end" data-testid="client-detail-kam">
                          <span className="text-gray-500 font-medium mt-0.5">Key Account Manager :</span>{" "}
                          {(row.key_account_managers || []).length > 0 ? (
                            (row.key_account_managers || []).map((m) => (
                              <span
                                key={m.id}
                                className="inline-flex items-center h-6 px-2.5 rounded-full border-2 border-[#ec9324] bg-white text-[11px] font-semibold text-[#ec9324]"
                                title={m.emp_id ? `${m.name} · ${m.emp_id}` : m.name}
                              >
                                {m.name}
                              </span>
                            ))
                          ) : (
                            <span className="text-gray-400 mt-0.5">—</span>
                          )}
                        </div>
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
                    <div className="text-base font-semibold text-gray-900">
                      Segmentation
                    </div>
                  </div>
                </div>

                {seg?.exists ? (
                  <button
                    onClick={goSegmentationExisting}
                    data-testid="client-detail-segment-available"
                    title="Click to Open"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold hover:bg-emerald-100 transition-colors"
                  >
                    <Check sx={{ fontSize: 18 }} />
                    Available
                  </button>
                ) : (
                  <button
                    onClick={goSegmentationAdd}
                    data-testid="client-detail-segment-add"
                    title="Click to Open"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#ec9324] text-white font-semibold hover:bg-[#d3811b] transition-colors"
                  >
                    <Plus sx={{ fontSize: 18 }} />
                    Add Segmentation
                  </button>
                )}
              </div>
            </div>

            {/* ============ POC STATUS CONFIGURATION BAR ============ */}
            <POCStatusConfigBar clientId={id} />

            {/* ============ ACTIVITY PIVOT TABLE ============ */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <div>
                  <div className="text-base font-semibold text-gray-900">
                    Overview
                  </div>
                </div>
                <DateFilter
                  value={filter}
                  onChange={setFilter}
                  fields={["date"]}
                  title="Select Date"
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
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5" data-testid="client-total-chips">
      {items.map((i) => (
        <div
          key={i.key}
          className={`rounded-xl border ring-1 ring-inset px-3.5 py-2.5 flex items-center justify-between gap-2 shadow-sm ${scheme}`}
          data-testid={`client-total-chip-${i.key}`}
        >
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-semibold opacity-90">
              {i.label}
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
  { key: "contacts", label: "CC", full: "Client Contacts" },
  { key: "projects", label: "P",  full: "Projects" },
  { key: "serviced", label: "S",  full: "Serviced" },
  { key: "calls",    label: "C",  full: "Calls" },
  { key: "revenue",  label: "$",  full: "Revenue", money: true },
];

function PivotTable({ l2Nodes, months, clientId }) {
  const fmt = (val, money) => {
    if (val === 0 || val === null || val === undefined) return money ? "$0" : "0";
    if (money) {
      if (Math.abs(val) >= 1_000_000) return `$${(val / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
      if (Math.abs(val) >= 10_000) return `$${(val / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
      return `$${val.toLocaleString()}`;
    }
    return val.toLocaleString();
  };
  const cellValue = (l2Name, monthKey, metricKey) => {
    const [lo, hi] = RANGES[metricKey] || [0, 0];
    return seededInt(clientId, l2Name, monthKey, metricKey, lo, hi);
  };

  // ---- Precompute row totals, column totals, and grand total ----
  // Cached so we don't re-hash the same (l2, month, metric) tuple multiple times.
  const { rowTotalsByMetric, colTotalsByMetric, grandTotalsByMetric } = React.useMemo(() => {
    const rowT = {}; // rowT[l2.name][metric] = sum across months
    const colT = {}; // colT[monthKey][metric] = sum across l2 nodes
    const gt   = {}; // gt[metric] = grand sum
    METRICS.forEach((mt) => { gt[mt.key] = 0; });
    l2Nodes.forEach((n) => {
      rowT[n.name] = {};
      METRICS.forEach((mt) => { rowT[n.name][mt.key] = 0; });
    });
    months.forEach((m) => {
      colT[m.key] = {};
      METRICS.forEach((mt) => { colT[m.key][mt.key] = 0; });
    });
    l2Nodes.forEach((n) => {
      months.forEach((m) => {
        METRICS.forEach((mt) => {
          const v = cellValue(n.name, m.key, mt.key);
          rowT[n.name][mt.key] += v;
          colT[m.key][mt.key] += v;
          gt[mt.key] += v;
        });
      });
    });
    return { rowTotalsByMetric: rowT, colTotalsByMetric: colT, grandTotalsByMetric: gt };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, l2Nodes, months]);

  return (
    <div className="border border-gray-200 rounded-lg overflow-auto max-h-[640px]">
      <table className="min-w-full border-collapse text-[12px]">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="bg-gray-50">
            <th
              rowSpan={2}
              className="sticky left-0 z-20 bg-gray-50 text-left px-3 py-2 border-b border-r border-gray-200 text-[10px] uppercase tracking-wider text-gray-500 font-semibold min-w-[220px]"
            >
              Segmentations
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
            <th
              colSpan={METRICS.length}
              className="text-center px-2 py-2 border-b border-l-2 border-gray-300 bg-orange-100/80 text-[10px] uppercase tracking-wider text-orange-800 font-bold"
            >
              Total
            </th>
          </tr>
          <tr className="bg-white">
            {months.map((m) =>
              METRICS.map((mt) => (
                <th
                  key={`${m.key}-${mt.key}`}
                  className="text-center px-2 py-1.5 border-b border-gray-200 text-[10px] uppercase tracking-wider text-gray-500 font-semibold cursor-help"
                  title={mt.full}
                >
                  {mt.label}
                </th>
              ))
            )}
            {/* Sub-headers for the Total group */}
            {METRICS.map((mt) => (
              <th
                key={`total-${mt.key}`}
                className={
                  "text-center px-2 py-1.5 border-b bg-orange-100/60 text-[10px] uppercase tracking-wider text-orange-800 font-semibold cursor-help" +
                  (mt.key === "contacts" ? " border-l-2 border-gray-300" : "")
                }
                title={mt.full}
              >
                {mt.label}
              </th>
            ))}
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
              {/* Row totals — one <td> per metric so they align with header sub-cols */}
              {METRICS.map((mt) => (
                <td
                  key={`row-total-${mt.key}`}
                  className={
                    "text-center px-2 py-2 border-b text-[11px] font-bold text-orange-800 tabular-nums" +
                    (mt.key === "contacts" ? " border-l-2 border-gray-300" : "")
                  }
                  style={{ background: ri % 2 ? "rgba(255,237,213,0.55)" : "rgba(255,237,213,0.35)" }}
                >
                  {fmt(rowTotalsByMetric[n.name]?.[mt.key] || 0, mt.money)}
                </td>
              ))}
            </tr>
          ))}

          {/* Grand totals row */}
          <tr className="bg-orange-100/60 border-t-2 border-orange-200">
            <td
              className="sticky left-0 z-10 bg-orange-100/60 px-3 py-2 text-right border-r border-gray-200 text-[11px] font-bold uppercase tracking-wider text-orange-800"
            >
              Total
            </td>
            {months.map((m) =>
              METRICS.map((mt) => {
                const val = colTotalsByMetric[m.key]?.[mt.key] || 0;
                return (
                  <td
                    key={`${m.key}-${mt.key}`}
                    className={
                      "text-center px-2 py-2 text-[11px] font-bold text-orange-800 tabular-nums" +
                      (mt.key === "revenue" ? " border-r border-orange-200" : "")
                    }
                  >
                    {fmt(val, mt.money)}
                  </td>
                );
              })
            )}
            {/* Grand totals — 5 separate cells */}
            {METRICS.map((mt) => (
              <td
                key={`grand-${mt.key}`}
                className={
                  "bg-orange-200/80 text-center px-2 py-2 text-[11px] font-bold text-orange-900 tabular-nums" +
                  (mt.key === "contacts" ? " border-l-2 border-gray-300" : "")
                }
              >
                {fmt(grandTotalsByMetric[mt.key] || 0, mt.money)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// POC Status Configuration Bar (per client)
// ============================================================
// Sits directly below the Segment bar on the Client Detail page.
// Persists a per-client inactivity threshold that drives the
// Active / Dormant status shown on every Client Contact belonging
// to this client.
// ============================================================
const _UNIT_OPTIONS = [
  { value: "days",   label: "Days"   },
  { value: "weeks",  label: "Weeks"  },
  { value: "months", label: "Months" },
  { value: "years",  label: "Years"  },
];
const _NUMBERS = Array.from({ length: 12 }, (_, i) => i + 1);

function POCStatusConfigBar({ clientId }) {
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  // Dialog + draft (editable) values — only committed on Save.
  const [open, setOpen] = useState(false);
  const [draftDuration, setDraftDuration] = useState(3);
  const [draftUnit, setDraftUnit] = useState("months");

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/clients/${clientId}/poc-status/config`);
      setCurrent(r.data?.config || null);
    } catch (e) {
      // silent — bar still renders, just with defaults
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (clientId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const openEditor = () => {
    setSaveErr("");
    setDraftDuration(current?.duration || 3);
    setDraftUnit(current?.unit || "months");
    setOpen(true);
  };

  const save = async () => {
    setSaveErr("");
    setSaving(true);
    try {
      const r = await api.put(`/clients/${clientId}/poc-status/config`, {
        duration: draftDuration,
        unit: draftUnit,
      });
      setCurrent(r.data?.config);
      setOpen(false);
      notify.success(
        `POC Status configuration saved · ${r.data?.recomputed || 0} client contact${
          (r.data?.recomputed || 0) === 1 ? "" : "s"
        } recomputed`
      );
    } catch (e) {
      setSaveErr(formatApiError(e, "Failed to save configuration"));
    } finally {
      setSaving(false);
    }
  };

  // Displayed value (falls back to a sensible default when unset).
  const valueDuration = current?.duration ?? 3;
  const valueUnit = current?.unit ?? "months";
  const valueUnitLabel = _UNIT_OPTIONS.find(u => u.value === valueUnit)?.label || valueUnit;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5" data-testid="client-detail-poc-config">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Left — icon + header with Active / Dormant chips */}
        <div className="flex items-center gap-3 flex-1 min-w-[280px]">
          <div className="w-10 h-10 rounded-lg bg-orange-100 text-[#ec9324] flex items-center justify-center flex-shrink-0">
            <Timer />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-semibold text-gray-900">
                POC Status Configuration
              </span>
              <POCStatusChip status={{ key: "active", label: "Active", color: "green" }} />
              <POCStatusChip status={{ key: "dormant", label: "Dormant", color: "red" }} />
            </div>
          </div>
        </div>

        {/* Right — value showcase + icon-only Edit (bell-style hover tooltip) */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-base font-semibold text-gray-900" data-testid="poc-config-value">
            {loading ? "…" : `${valueDuration} ${valueUnitLabel}`}
          </div>
          <button
            type="button"
            onClick={openEditor}
            disabled={loading}
            aria-label="Edit"
            className="group relative inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-gray-100 text-gray-600 disabled:opacity-50"
            data-testid="poc-config-edit"
          >
            <Pencil sx={{ fontSize: 20 }} />
            <span className="pointer-events-none absolute top-full mt-1.5 right-0 px-2 py-1 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
              Edit
            </span>
          </button>
        </div>
      </div>

      {/* ===== Edit popup — 2 dropdowns (Duration + Unit) ===== */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[420px]" data-testid="poc-config-dialog">
          <DialogHeader>
            <DialogTitle>Edit Time Frame</DialogTitle>
          </DialogHeader>

          <div className="flex items-end gap-3 py-2">
            <div className="flex-1">
              <Label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                Duration
              </Label>
              <div className="mt-1">
                <SearchSelect
                  options={_NUMBERS.map((n) => ({ value: String(n), label: String(n) }))}
                  value={String(draftDuration)}
                  onChange={(v) => setDraftDuration(parseInt(v, 10))}
                  size="sm"
                  allowClear={false}
                  testId="poc-duration-select"
                />
              </div>
            </div>
            <div className="flex-1">
              <Label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                Unit
              </Label>
              <div className="mt-1">
                <SearchSelect
                  options={_UNIT_OPTIONS}
                  value={draftUnit}
                  onChange={(v) => setDraftUnit(v)}
                  size="sm"
                  allowClear={false}
                  testId="poc-unit-select"
                />
              </div>
            </div>
          </div>

          {saveErr && (
            <div className="text-[12px] text-red-600 bg-red-50 px-2 py-1.5 rounded">{saveErr}</div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
              className="h-9"
              data-testid="poc-config-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={saving}
              className="bg-[#ec9324] hover:bg-[#d3811b] text-white h-9 disabled:opacity-50"
              data-testid="poc-config-save"
            >
              <Save sx={{ fontSize: 16, marginRight: "4px" }} />
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

