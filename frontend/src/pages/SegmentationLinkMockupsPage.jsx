/**
 * SegmentationLinkMockupsPage
 * =========================================================
 * Two visual mockups (no backend calls) for linking Level-2
 * segmentation nodes across segmentations (many-to-many).
 *
 *   View 1 · Inline Pill Tags  — links rendered under each L2
 *                                node right on the tree canvas.
 *   View 2 · Ribbon Flow       — Sankey-style ribbons between
 *                                two parallel columns of L2 nodes
 *                                (light theme, dashboard palette).
 *
 * Both views share a single Edit dialog.
 *
 * Route: /crm/segmentation-link-mockups
 * =========================================================
 */
import React, { useMemo, useRef, useState } from "react";
import Layout from "../components/Layout";
import LinkIcon from "@mui/icons-material/LinkOutlined";
import Close from "@mui/icons-material/CloseOutlined";
import Search from "@mui/icons-material/SearchOutlined";
import ExpandMore from "@mui/icons-material/ExpandMoreOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import ZoomIn from "@mui/icons-material/ZoomInOutlined";
import ZoomOut from "@mui/icons-material/ZoomOutOutlined";
import CenterFocusStrong from "@mui/icons-material/CenterFocusStrongOutlined";
import Fullscreen from "@mui/icons-material/FullscreenOutlined";
import CheckCircle from "@mui/icons-material/CheckCircleOutlined";

// ============================================================
// MOCK DATA
// ============================================================
const SEGMENTATIONS = [
  {
    id: "infollion",
    name: "Infollion Research",
    initials: "IR",
    color: "#ec9324", // brand orange
    l2: [
      { id: "inf-agri",  name: "Agriculture" },
      { id: "inf-auto",  name: "Automotive" },
      { id: "inf-bfsi",  name: "BFSI" },
      { id: "inf-chem",  name: "Chemicals" },
      { id: "inf-cps",   name: "Commercial and Professional Services" },
      { id: "inf-cd",    name: "Consumer Discretionary" },
      { id: "inf-cs",    name: "Consumer Staples · Food & Beverages" },
      { id: "inf-edu",   name: "Education" },
      { id: "inf-eng",   name: "Engineering and Capital Goods" },
      { id: "inf-hlth",  name: "Healthcare System and Services" },
      { id: "inf-it",    name: "Information Technology" },
      { id: "inf-log",   name: "Logistics" },
      { id: "inf-met",   name: "Metals and Mining" },
      { id: "inf-oil",   name: "Oil and Gas" },
      { id: "inf-re",    name: "Real Estate" },
    ],
  },
  {
    id: "mckinsey",
    name: "McKinsey",
    initials: "MC",
    color: "#8b5cf6", // violet
    l2: [
      { id: "mck-aero",  name: "Aerospace & Defense" },
      { id: "mck-agri",  name: "Agriculture" },
      { id: "mck-auto",  name: "Automotive & Assembly" },
      { id: "mck-chem",  name: "Chemicals" },
      { id: "mck-fs",    name: "Financial Services" },
      { id: "mck-ins",   name: "Insurance" },
      { id: "mck-cpg",   name: "Consumer Packaged Goods" },
      { id: "mck-wam",   name: "Wealth and Asset Management" },
      { id: "mck-hlth",  name: "Healthcare" },
      { id: "mck-life",  name: "Life Sciences" },
      { id: "mck-tmt",   name: "Technology, Media & Telecom" },
      { id: "mck-pc",    name: "Private Capital" },
      { id: "mck-semi",  name: "Semiconductors" },
      { id: "mck-re",    name: "Real Estate" },
      { id: "mck-infra", name: "Infrastructure" },
    ],
  },
  {
    id: "gartner",
    name: "Gartner",
    initials: "GA",
    color: "#0ea5e9", // sky
    l2: [
      { id: "gar-fs",     name: "Banking & Investment" },
      { id: "gar-ins",    name: "Insurance" },
      { id: "gar-life",   name: "Life Sciences" },
      { id: "gar-mfg",    name: "Manufacturing" },
      { id: "gar-retail", name: "Retail" },
      { id: "gar-energy", name: "Energy & Utilities" },
    ],
  },
];

const INITIAL_LINKS = [
  { a: "inf-bfsi",  b: "mck-fs" },
  { a: "inf-bfsi",  b: "mck-ins" },
  { a: "inf-bfsi",  b: "mck-wam" },
  { a: "inf-bfsi",  b: "mck-pc" },
  { a: "inf-agri",  b: "mck-agri" },
  { a: "inf-auto",  b: "mck-auto" },
  { a: "inf-chem",  b: "mck-chem" },
  { a: "inf-met",   b: "mck-chem" },
  { a: "inf-cs",    b: "mck-cpg" },
  { a: "inf-hlth",  b: "mck-hlth" },
  { a: "inf-hlth",  b: "mck-life" },
  { a: "inf-it",    b: "mck-tmt" },
  { a: "inf-eng",   b: "mck-semi" },
  { a: "inf-re",    b: "mck-re" },
  { a: "inf-re",    b: "mck-infra" },
  { a: "inf-oil",   b: "mck-infra" },
  { a: "inf-cd",    b: "mck-cpg" },
  { a: "inf-log",   b: "mck-infra" },
  // Gartner cross-links (shown as "also referenced by")
  { a: "inf-bfsi",  b: "gar-fs" },
  { a: "inf-bfsi",  b: "gar-ins" },
  { a: "inf-hlth",  b: "gar-life" },
];

// ------------- helpers ----------------------
const nodeById = (id) => {
  for (const s of SEGMENTATIONS) {
    const n = s.l2.find((x) => x.id === id);
    if (n) return { ...n, seg: s };
  }
  return null;
};

const linksFor = (id, links) =>
  links
    .filter((l) => l.a === id || l.b === id)
    .map((l) => (l.a === id ? l.b : l.a))
    .map(nodeById)
    .filter(Boolean);

// ============================================================
// PAGE SHELL
// ============================================================
export default function SegmentationLinkMockupsPage() {
  const [view, setView] = useState("overview"); // 'overview' | 'inline' | 'ribbon'
  const [links, setLinks] = useState(INITIAL_LINKS);
  const [editOpen, setEditOpen] = useState(false);
  const [editSourceId, setEditSourceId] = useState("inf-bfsi");

  const openEditFor = (sourceId) => {
    setEditSourceId(sourceId);
    setEditOpen(true);
  };

  const applyLinks = (sourceId, newTargetIds) => {
    setLinks((prev) => {
      const kept = prev.filter((l) => l.a !== sourceId && l.b !== sourceId);
      return [...kept, ...newTargetIds.map((id) => ({ a: sourceId, b: id }))];
    });
    setEditOpen(false);
  };

  return (
    <Layout>
      <div className="px-6 py-6 max-w-[1700px] mx-auto">
        {/* Page header */}
        <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-100 text-[#ec9324] flex items-center justify-center">
              <LinkIcon />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Cross-Segmentation Level-2 Linking
              </h1>
              <p className="text-sm text-gray-500">
                Two view modes for the same many-to-many link data. Both share
                the same Edit dialog.
              </p>
            </div>
          </div>

          {/* View switcher */}
          <div className="inline-flex bg-gray-100 rounded-lg p-1">
            {[
              { k: "overview", label: "Overview" },
              { k: "inline", label: "Inline Pill Tags" },
              { k: "ribbon", label: "Ribbon Flow" },
            ].map((t) => (
              <button
                key={t.k}
                onClick={() => setView(t.k)}
                className={
                  "px-4 py-1.5 text-sm font-medium rounded-md transition-colors " +
                  (view === t.k
                    ? "bg-white shadow-sm text-gray-900"
                    : "text-gray-500 hover:text-gray-800")
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {view === "overview" && (
          <OverviewView
            links={links}
            onEdit={openEditFor}
            onOpenView={setView}
          />
        )}
        {view === "inline" && (
          <InlinePillTagsView
            links={links}
            setLinks={setLinks}
            onEdit={openEditFor}
          />
        )}
        {view === "ribbon" && (
          <RibbonFlowView
            links={links}
            setLinks={setLinks}
            onEdit={openEditFor}
          />
        )}

        {editOpen && (
          <EditLinksDialog
            sourceId={editSourceId}
            setSourceId={setEditSourceId}
            links={links}
            onClose={() => setEditOpen(false)}
            onApply={applyLinks}
          />
        )}
      </div>
    </Layout>
  );
}

// ============================================================
// SHARED EDIT DIALOG
// (Same edit page used by both views)
// ============================================================
function EditLinksDialog({ sourceId, setSourceId, links, onClose, onApply }) {
  const sourceNode = nodeById(sourceId);
  const linkedIds = new Set(
    links
      .filter((l) => l.a === sourceId || l.b === sourceId)
      .map((l) => (l.a === sourceId ? l.b : l.a))
  );
  const [checked, setChecked] = useState(linkedIds);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState(
    () => new Set(SEGMENTATIONS.filter((s) => s.id !== sourceNode?.seg.id).map((s) => s.id))
  );

  // React to sourceId change — reset checked set
  const sourceIdRef = useRef(sourceId);
  if (sourceIdRef.current !== sourceId) {
    sourceIdRef.current = sourceId;
    const newLinked = new Set(
      links
        .filter((l) => l.a === sourceId || l.b === sourceId)
        .map((l) => (l.a === sourceId ? l.b : l.a))
    );
    // eslint-disable-next-line react-hooks/rules-of-hooks
    setChecked(newLinked);
  }

  const toggle = (id) => {
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const others = SEGMENTATIONS.filter((s) => s.id !== sourceNode?.seg.id);
  if (!sourceNode) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden">
        {/* header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-orange-50 to-white">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
              Edit cross-links
            </div>
            <div className="text-lg font-semibold text-gray-900">
              Links for{" "}
              <span className="text-[#ec9324]">{sourceNode.name}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 text-gray-500 flex items-center justify-center"
          >
            <Close />
          </button>
        </div>

        {/* Source picker */}
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3 bg-gray-50/60">
          <span className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
            Source
          </span>
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="text-sm font-medium bg-white border border-gray-200 rounded-md px-2 py-1"
          >
            {SEGMENTATIONS.map((s) => (
              <optgroup key={s.id} label={s.name}>
                {s.l2.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-100 text-[#ec9324] text-xs font-semibold">
            <LinkIcon style={{ fontSize: 14 }} />
            {checked.size} linked
          </span>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <Search style={{ fontSize: 18, color: "#9ca3af" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="flex-1 outline-none text-sm placeholder-gray-400"
            placeholder="Search Level-2 nodes across all segmentations"
          />
        </div>

        {/* body */}
        <div className="max-h-[460px] overflow-y-auto">
          {others.map((s) => {
            const nodes = s.l2.filter((n) =>
              n.name.toLowerCase().includes(q.toLowerCase())
            );
            if (!nodes.length) return null;
            const isOpen = expanded.has(s.id);
            const selCount = nodes.filter((n) => checked.has(n.id)).length;
            return (
              <div key={s.id}>
                <button
                  onClick={() => {
                    setExpanded((prev) => {
                      const n = new Set(prev);
                      if (n.has(s.id)) n.delete(s.id);
                      else n.add(s.id);
                      return n;
                    });
                  }}
                  className="w-full px-5 py-2.5 flex items-center justify-between bg-gray-50 hover:bg-gray-100"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold"
                      style={{ background: s.color }}
                    >
                      {s.initials}
                    </span>
                    <span className="text-sm font-semibold text-gray-800">
                      {s.name}
                    </span>
                    <span className="text-[11px] text-gray-500">
                      {selCount} / {nodes.length} selected
                    </span>
                  </div>
                  <ExpandMore
                    style={{
                      fontSize: 20,
                      color: "#9ca3af",
                      transform: isOpen ? "rotate(0)" : "rotate(-90deg)",
                      transition: "transform 120ms",
                    }}
                  />
                </button>
                {isOpen &&
                  nodes.map((n) => (
                    <label
                      key={n.id}
                      className="px-6 py-2.5 flex items-center gap-3 hover:bg-gray-50 cursor-pointer border-b border-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked.has(n.id)}
                        onChange={() => toggle(n.id)}
                        className="w-4 h-4 accent-[#ec9324]"
                      />
                      <div className="flex-1 text-sm font-medium text-gray-800">
                        {n.name}
                      </div>
                      {checked.has(n.id) && (
                        <span className="text-[10px] uppercase text-[#ec9324] font-semibold">
                          Linked
                        </span>
                      )}
                    </label>
                  ))}
              </div>
            );
          })}
        </div>

        {/* footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50">
          <div className="text-xs text-gray-500">
            Changes apply to <span className="font-semibold">{sourceNode.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-sm text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={() => onApply(sourceId, Array.from(checked))}
              className="px-4 py-1.5 rounded-md bg-[#ec9324] text-white text-sm font-medium hover:bg-[#d3811b]"
            >
              Save links
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// VIEW 0 — OVERVIEW (summary dashboard)
// ============================================================
function OverviewView({ links, onEdit, onOpenView }) {
  // ---- Aggregate stats ----
  const totalLinks = links.length;
  const allL2Nodes = SEGMENTATIONS.flatMap((s) =>
    s.l2.map((n) => ({ ...n, seg: s }))
  );
  const linkedNodeIds = new Set(links.flatMap((l) => [l.a, l.b]));
  const nodesWithLinks = allL2Nodes.filter((n) => linkedNodeIds.has(n.id));
  const orphans = allL2Nodes.filter((n) => !linkedNodeIds.has(n.id));
  const coveragePct = Math.round(
    (nodesWithLinks.length / allL2Nodes.length) * 100
  );

  // Per-segmentation pair link count matrix
  const pairMatrix = useMemo(() => {
    const m = {};
    SEGMENTATIONS.forEach((s) => {
      m[s.id] = {};
      SEGMENTATIONS.forEach((t) => (m[s.id][t.id] = 0));
    });
    links.forEach((l) => {
      const a = nodeById(l.a);
      const b = nodeById(l.b);
      if (!a || !b) return;
      m[a.seg.id][b.seg.id] += 1;
      if (a.seg.id !== b.seg.id) m[b.seg.id][a.seg.id] += 1;
    });
    return m;
  }, [links]);

  // Top linked nodes
  const linkCounts = useMemo(() => {
    const cnt = {};
    links.forEach((l) => {
      cnt[l.a] = (cnt[l.a] || 0) + 1;
      cnt[l.b] = (cnt[l.b] || 0) + 1;
    });
    return allL2Nodes
      .map((n) => ({ ...n, count: cnt[n.id] || 0 }))
      .filter((n) => n.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links]);

  // Recent links (mock — last 5 in the array with fake timestamps)
  const recent = useMemo(() => {
    const now = Date.now();
    return links
      .slice(-6)
      .reverse()
      .map((l, i) => {
        const a = nodeById(l.a);
        const b = nodeById(l.b);
        return {
          a,
          b,
          when: new Date(now - i * 1000 * 60 * (18 + i * 12)).toLocaleString(
            undefined,
            { dateStyle: "medium", timeStyle: "short" }
          ),
          by: i % 2 === 0 ? "Admin User" : "Aarushi Sharma",
        };
      });
  }, [links]);

  const maxPairCount = Math.max(
    1,
    ...SEGMENTATIONS.flatMap((s) =>
      SEGMENTATIONS.map((t) => (s.id === t.id ? 0 : pairMatrix[s.id][t.id]))
    )
  );

  return (
    <div className="grid grid-cols-1 gap-4">
      {/* HERO STATS ROW */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <BigStat
          label="Total Links"
          value={totalLinks}
          sub="across all segmentations"
          accent="orange"
          icon={<LinkIcon />}
        />
        <BigStat
          label="Segmentations"
          value={SEGMENTATIONS.length}
          sub="connected in the graph"
          accent="sky"
          icon={<span className="text-lg font-bold">§</span>}
        />
        <BigStat
          label="Linked Nodes"
          value={nodesWithLinks.length}
          sub={`of ${allL2Nodes.length} Level-2 nodes`}
          accent="emerald"
          icon={<CheckCircle />}
        />
        <BigStat
          label="Orphans"
          value={orphans.length}
          sub="nodes with zero links"
          accent="rose"
          icon={<Close />}
        />
        <BigStat
          label="Coverage"
          value={`${coveragePct}%`}
          sub="Level-2 nodes linked"
          accent="violet"
          icon={<EditOutlined />}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
        {/* LEFT column */}
        <div className="grid grid-cols-1 gap-4">
          {/* SEGMENTATION PAIR MATRIX */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
                  Cross-Segmentation
                </div>
                <div className="text-lg font-semibold text-gray-900">
                  Pair link volume
                </div>
              </div>
              <button
                onClick={() => onOpenView("ribbon")}
                className="text-xs font-semibold text-[#ec9324] hover:bg-orange-50 rounded px-2 py-1"
              >
                Open Ribbon view →
              </button>
            </div>
            <div className="p-5 overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-[11px] uppercase tracking-wider text-gray-400 font-medium px-3 py-2"></th>
                    {SEGMENTATIONS.map((s) => (
                      <th
                        key={s.id}
                        className="px-3 py-2 text-center text-[11px] font-semibold text-gray-700"
                      >
                        <div className="inline-flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ background: s.color }}
                          />
                          {s.name}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SEGMENTATIONS.map((s) => (
                    <tr key={s.id} className="border-t border-gray-50">
                      <td className="px-3 py-3 text-sm font-semibold text-gray-800">
                        <div className="inline-flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ background: s.color }}
                          />
                          {s.name}
                        </div>
                      </td>
                      {SEGMENTATIONS.map((t) => {
                        if (s.id === t.id) {
                          return (
                            <td
                              key={t.id}
                              className="px-3 py-3 text-center text-gray-300"
                            >
                              —
                            </td>
                          );
                        }
                        const c = pairMatrix[s.id][t.id];
                        const intensity = c / maxPairCount;
                        return (
                          <td key={t.id} className="px-3 py-3 text-center">
                            <div
                              className="inline-flex items-center justify-center min-w-[56px] h-10 rounded-lg font-bold text-sm"
                              style={{
                                background:
                                  c === 0
                                    ? "#f3f4f6"
                                    : `rgba(236,147,36,${0.15 + intensity * 0.7})`,
                                color: c === 0 ? "#9ca3af" : intensity > 0.55 ? "#fff" : "#b45309",
                              }}
                            >
                              {c}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/60 text-[11px] text-gray-500 flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-4 h-4 rounded bg-gray-100" />
                0 links
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block w-4 h-4 rounded"
                  style={{ background: "rgba(236,147,36,0.25)" }}
                />
                Few
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block w-4 h-4 rounded"
                  style={{ background: "rgba(236,147,36,0.85)" }}
                />
                Many
              </span>
              <span className="ml-auto">
                Symmetric — each cell counts every link between the two segmentations.
              </span>
            </div>
          </div>

          {/* TOP LINKED NODES */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
                  Leaderboard
                </div>
                <div className="text-lg font-semibold text-gray-900">
                  Most-linked Level-2 nodes
                </div>
              </div>
              <button
                onClick={() => onOpenView("inline")}
                className="text-xs font-semibold text-[#ec9324] hover:bg-orange-50 rounded px-2 py-1"
              >
                Open Inline Pill Tags view →
              </button>
            </div>
            <div className="p-5 space-y-2">
              {linkCounts.length === 0 && (
                <div className="text-sm italic text-gray-400 py-4">
                  No links yet.
                </div>
              )}
              {linkCounts.map((n, i) => {
                const barW = (n.count / linkCounts[0].count) * 100;
                return (
                  <div
                    key={n.id}
                    className="flex items-center gap-3 py-1.5 group"
                  >
                    <div className="w-6 text-center text-xs font-bold text-gray-400">
                      {i + 1}
                    </div>
                    <div className="flex items-center gap-2 min-w-[220px]">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: n.seg.color }}
                      />
                      <div>
                        <div className="text-sm font-semibold text-gray-900">
                          {n.name}
                        </div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider">
                          {n.seg.name}
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#ec9324] to-[#f4b559]"
                        style={{ width: `${barW}%` }}
                      />
                    </div>
                    <div className="w-14 text-right text-sm font-bold text-[#ec9324]">
                      {n.count}
                    </div>
                    <button
                      onClick={() => onEdit(n.id)}
                      className="opacity-0 group-hover:opacity-100 text-[11px] font-semibold text-gray-500 hover:text-[#ec9324] hover:bg-orange-50 rounded px-1.5 py-0.5"
                    >
                      Edit
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT column */}
        <div className="grid grid-cols-1 gap-4">
          {/* SEGMENTATION BREAKDOWN */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
                Per Segmentation
              </div>
              <div className="text-lg font-semibold text-gray-900">
                Coverage breakdown
              </div>
            </div>
            <div className="p-5 space-y-4">
              {SEGMENTATIONS.map((s) => {
                const nodes = s.l2;
                const linked = nodes.filter((n) => linkedNodeIds.has(n.id)).length;
                const pct = Math.round((linked / nodes.length) * 100);
                return (
                  <div key={s.id}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span
                        className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                        style={{ background: s.color }}
                      >
                        {s.initials}
                      </span>
                      <div className="text-sm font-semibold text-gray-800 flex-1 truncate">
                        {s.name}
                      </div>
                      <div className="text-sm font-bold text-gray-900">
                        {linked} <span className="text-xs text-gray-400 font-medium">/ {nodes.length}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: s.color,
                        }}
                      />
                    </div>
                    <div className="mt-1 text-[10px] text-gray-500 uppercase tracking-wider">
                      {pct}% linked · {nodes.length - linked} orphan{nodes.length - linked === 1 ? "" : "s"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* RECENT ACTIVITY */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
                Recent
              </div>
              <div className="text-lg font-semibold text-gray-900">
                Latest link activity
              </div>
            </div>
            <div className="max-h-[280px] overflow-y-auto">
              {recent.map((r, i) => (
                <div
                  key={i}
                  className="px-5 py-2.5 border-b border-gray-50 hover:bg-gray-50/60 flex items-start gap-3"
                >
                  <div className="w-6 h-6 rounded-full bg-orange-100 text-[#ec9324] flex items-center justify-center flex-shrink-0 mt-0.5">
                    <LinkIcon style={{ fontSize: 14 }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-800">
                      <span className="font-semibold">{r.a?.name || "—"}</span>{" "}
                      <span className="text-gray-400">linked to</span>{" "}
                      <span className="font-semibold">{r.b?.name || "—"}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: r.a?.seg.color }}
                        />
                        {r.a?.seg.name}
                      </span>
                      <span className="text-gray-300">→</span>
                      <span className="inline-flex items-center gap-1">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: r.b?.seg.color }}
                        />
                        {r.b?.seg.name}
                      </span>
                      <span className="text-gray-300">·</span>
                      <span>by {r.by}</span>
                      <span className="text-gray-300">·</span>
                      <span>{r.when}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* QUICK NAV CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => onOpenView("inline")}
          className="group text-left bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:border-orange-300 hover:shadow-md transition-all"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-100 text-[#ec9324] flex items-center justify-center flex-shrink-0">
              <LinkIcon />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                Inline Pill Tags
                <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">
                  Editor
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Level-2 nodes shown as cards with coloured link pills beneath.
                Fast in-place editing with an autocomplete search.
              </div>
            </div>
            <span className="text-[#ec9324] font-bold group-hover:translate-x-1 transition-transform">→</span>
          </div>
        </button>
        <button
          onClick={() => onOpenView("ribbon")}
          className="group text-left bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:border-orange-300 hover:shadow-md transition-all"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-100 to-violet-100 text-[#ec9324] flex items-center justify-center flex-shrink-0">
              <span className="text-lg">≈</span>
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                Ribbon Flow
                <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">
                  Visual
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Two parallel columns with Sankey-style curved ribbons. Great
                for spotting many-to-many mappings between two segmentations.
              </div>
            </div>
            <span className="text-[#ec9324] font-bold group-hover:translate-x-1 transition-transform">→</span>
          </div>
        </button>
      </div>
    </div>
  );
}

// small hero-stat card used by Overview
function BigStat({ label, value, sub, accent = "orange", icon }) {
  const tones = {
    orange:  { bg: "bg-orange-50",   border: "border-orange-100",  text: "text-[#ec9324]" },
    sky:     { bg: "bg-sky-50",      border: "border-sky-100",     text: "text-sky-600" },
    emerald: { bg: "bg-emerald-50",  border: "border-emerald-100", text: "text-emerald-600" },
    rose:    { bg: "bg-rose-50",     border: "border-rose-100",    text: "text-rose-600" },
    violet:  { bg: "bg-violet-50",   border: "border-violet-100",  text: "text-violet-600" },
  }[accent];
  return (
    <div className={`${tones.bg} ${tones.border} border rounded-xl p-4`}>
      <div className="flex items-start justify-between">
        <div>
          <div className={`text-[10px] uppercase tracking-wider ${tones.text} font-bold`}>
            {label}
          </div>
          <div className="text-2xl font-bold text-gray-900 mt-1 leading-none">
            {value}
          </div>
          <div className="text-[11px] text-gray-500 mt-1">{sub}</div>
        </div>
        <div className={`${tones.text} opacity-70`}>{icon}</div>
      </div>
    </div>
  );
}

// ============================================================
// VIEW 1 — INLINE PILL TAGS
// ============================================================
function InlinePillTagsView({ links, setLinks, onEdit }) {
  const seg = SEGMENTATIONS[0];
  // We render a simple flat list of Level-2 nodes with chips beneath.
  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
              Segmentation
            </div>
            <div className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <span
                className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold"
                style={{ background: seg.color }}
              >
                {seg.initials}
              </span>
              {seg.name}
            </div>
          </div>
          <span className="text-xs text-gray-500">
            Every link appears as a coloured pill directly under its Level-2 node.
            Coloured dots at the start of each pill show which segmentation it
            points to.
          </span>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {seg.l2.map((n) => {
            const chips = linksFor(n.id, links);
            return (
              <div
                key={n.id}
                className="group rounded-lg border border-gray-200 hover:border-orange-300 hover:shadow-sm p-3 transition-colors bg-white"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#22c55e" }} />
                    <div className="font-semibold text-gray-800 text-sm truncate">{n.name}</div>
                  </div>
                  <button
                    onClick={() => onEdit(n.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-[11px] text-[#ec9324] font-semibold hover:bg-orange-50 rounded px-1.5 py-0.5"
                  >
                    <EditOutlined style={{ fontSize: 14 }} />
                    Edit
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {chips.length === 0 && (
                    <span className="text-[11px] italic text-gray-400">No links</span>
                  )}
                  {chips.map((c) => (
                    <span
                      key={c.id}
                      className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full text-[11px] font-medium border shadow-sm bg-white"
                      style={{ borderColor: c.seg.color + "80", color: "#374151" }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: c.seg.color }}
                      />
                      <span className="truncate max-w-[140px]">{c.name}</span>
                      <button
                        onClick={() =>
                          setLinks((prev) =>
                            prev.filter(
                              (l) =>
                                !(
                                  (l.a === n.id && l.b === c.id) ||
                                  (l.b === n.id && l.a === c.id)
                                )
                            )
                          )
                        }
                        className="w-3.5 h-3.5 rounded-full opacity-50 hover:opacity-100 hover:bg-red-100 hover:text-red-600 flex items-center justify-center"
                      >
                        <span style={{ fontSize: 11, lineHeight: 1 }}>×</span>
                      </button>
                    </span>
                  ))}
                  <button
                    onClick={() => onEdit(n.id)}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] font-semibold border border-dashed border-[#ec9324] text-[#ec9324] bg-orange-50/60 hover:bg-orange-100"
                  >
                    + Link
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/60 flex items-center gap-4 text-[11px] text-gray-600 flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: "#22c55e" }} />
            Level-2 node
          </span>
          {SEGMENTATIONS.slice(1).map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
              Chip → {s.name}
            </span>
          ))}
          <span className="ml-auto text-gray-400">
            Click <span className="font-semibold text-[#ec9324]">+ Link</span> or the Edit chip on
            any node to open the shared Edit dialog.
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// VIEW 2 — RIBBON FLOW (Sankey-style)
// ============================================================
function RibbonFlowView({ links, setLinks, onEdit }) {
  const [baseId, setBaseId] = useState("infollion");
  const [linkedId, setLinkedId] = useState("mckinsey");
  const [focusId, setFocusId] = useState("inf-bfsi");
  const [query, setQuery] = useState("");

  const base = SEGMENTATIONS.find((s) => s.id === baseId);
  const linked = SEGMENTATIONS.find((s) => s.id === linkedId);

  // Ribbons currently between base<->linked
  const ribbons = useMemo(() => {
    return links
      .map((l) => {
        const a = nodeById(l.a);
        const b = nodeById(l.b);
        const src = a && a.seg.id === base.id ? a : b && b.seg.id === base.id ? b : null;
        const tgt = a && a.seg.id === linked.id ? a : b && b.seg.id === linked.id ? b : null;
        if (!src || !tgt) return null;
        return { src, tgt };
      })
      .filter(Boolean);
  }, [links, base, linked]);

  // Stats
  const coverageBase = new Set(ribbons.map((r) => r.src.id)).size;
  const coverageLinked = new Set(ribbons.map((r) => r.tgt.id)).size;
  const totalBaseNodes = base.l2.length;
  const totalLinkedNodes = linked.l2.length;

  const manyLinkCount = useMemo(() => {
    const counts = {};
    ribbons.forEach((r) => {
      counts[r.src.id] = (counts[r.src.id] || 0) + 1;
    });
    return Object.values(counts).filter((c) => c >= 2).length;
  }, [ribbons]);

  // Layout
  const width = 1400;
  const height = 640;
  const padTop = 60;
  const padBot = 40;
  const baseX = 470; // right edge of base column labels
  const linkedX = width - 470; // left edge of linked column labels
  const rowHeight = (height - padTop - padBot) / Math.max(base.l2.length, linked.l2.length, 1);

  const baseYs = {};
  base.l2.forEach((n, i) => {
    baseYs[n.id] = padTop + i * rowHeight + rowHeight / 2;
  });
  const linkedYs = {};
  linked.l2.forEach((n, i) => {
    linkedYs[n.id] = padTop + i * rowHeight + rowHeight / 2;
  });

  const focusedNode = focusId ? nodeById(focusId) : null;
  const focusedMappedIds = useMemo(() => {
    if (!focusId) return new Set();
    return new Set(
      ribbons
        .filter((r) => r.src.id === focusId || r.tgt.id === focusId)
        .flatMap((r) => [r.src.id, r.tgt.id])
    );
  }, [focusId, ribbons]);

  // Extra: cross-references from Gartner (or any 3rd segmentation) to the focused node
  const alsoRefs = useMemo(() => {
    if (!focusId) return [];
    return links
      .filter((l) => l.a === focusId || l.b === focusId)
      .map((l) => nodeById(l.a === focusId ? l.b : l.a))
      .filter((n) => n && n.seg.id !== base.id && n.seg.id !== linked.id);
  }, [focusId, links, base, linked]);

  // Determine if a ribbon should be highlighted
  const isHi = (r) =>
    focusId && (r.src.id === focusId || r.tgt.id === focusId);

  return (
    <div className="grid grid-cols-1 gap-4">
      {/* ---------- HEADER ---------- */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          {/* left cluster */}
          <div className="flex items-start gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
                Cross-Segmentation
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <h2 className="text-2xl font-semibold text-gray-900">
                  Segmentation Links
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live
                </span>
              </div>
            </div>

            {/* segmentation pair selector */}
            <div className="flex items-center gap-1.5 pl-4 border-l border-gray-200 mt-1">
              <SegPill segId={baseId} setSegId={setBaseId} role="Base" />
              <span className="text-gray-400 mx-1">›</span>
              <SegPill
                segId={linkedId}
                setSegId={setLinkedId}
                role="Linked"
                exclude={baseId}
              />
            </div>
          </div>

          {/* right cluster: stats + edit */}
          <div className="flex items-stretch gap-3">
            <StatCard label="Coverage" value={`${coverageBase} / ${totalBaseNodes}`} />
            <StatCard label="Ribbons" value={ribbons.length} />
            <StatCard label="Many-Links" value={manyLinkCount} />
            <button
              onClick={() => onEdit(focusId || base.l2[0].id)}
              className="inline-flex items-center gap-1.5 px-4 rounded-lg bg-[#ec9324] text-white text-sm font-semibold hover:bg-[#d3811b] shadow-sm"
            >
              <EditOutlined style={{ fontSize: 18 }} />
              Edit Links
            </button>
          </div>
        </div>
      </div>

      {/* ---------- CANVAS ---------- */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Top ribbon: legend + zoom */}
        <div className="px-5 py-2.5 border-b border-gray-100 flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5 text-gray-600">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: base.color }}
              />
              {base.name} L2
            </span>
            <span className="inline-flex items-center gap-1.5 text-gray-600">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: linked.color }}
              />
              {linked.name} L2
            </span>
            <span className="text-gray-400">Ribbon = link</span>
          </div>
          <div className="inline-flex items-center bg-gray-100 rounded-lg text-gray-600">
            <IconBtn><ZoomIn style={{ fontSize: 16 }} /></IconBtn>
            <IconBtn><ZoomOut style={{ fontSize: 16 }} /></IconBtn>
            <IconBtn><CenterFocusStrong style={{ fontSize: 16 }} /></IconBtn>
            <IconBtn><Fullscreen style={{ fontSize: 16 }} /></IconBtn>
          </div>
        </div>

        {/* SVG ribbons */}
        <div className="relative bg-gradient-to-br from-orange-50/30 via-white to-sky-50/30">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
            <defs>
              {ribbons.map((r, i) => (
                <linearGradient
                  key={i}
                  id={`ribbon-grad-${i}`}
                  x1="0"
                  x2="1"
                  y1="0"
                  y2="0"
                >
                  <stop offset="0%" stopColor={base.color} stopOpacity={0.9} />
                  <stop offset="100%" stopColor={linked.color} stopOpacity={0.9} />
                </linearGradient>
              ))}
            </defs>

            {/* Column headers */}
            <text x={baseX} y={30} textAnchor="end" fontSize={11} fontWeight={700}
              fill="#6b7280" style={{ letterSpacing: 1 }}>
              {base.name.toUpperCase()} · L2
            </text>
            <text x={linkedX} y={30} textAnchor="start" fontSize={11} fontWeight={700}
              fill="#6b7280" style={{ letterSpacing: 1 }}>
              {linked.name.toUpperCase()} · L2
            </text>

            {/* Ribbons (draw non-highlighted first, then highlighted on top) */}
            {ribbons
              .slice()
              .sort((a, b) => (isHi(a) ? 1 : 0) - (isHi(b) ? 1 : 0))
              .map((r, i) => {
                const y1 = baseYs[r.src.id];
                const y2 = linkedYs[r.tgt.id];
                const hi = isHi(r);
                const mid = (baseX + linkedX) / 2;
                const path = `M ${baseX + 20},${y1} C ${mid},${y1} ${mid},${y2} ${linkedX - 20},${y2}`;
                const gradId = ribbons.indexOf(r);
                return (
                  <path
                    key={`${r.src.id}-${r.tgt.id}`}
                    d={path}
                    fill="none"
                    stroke={`url(#ribbon-grad-${gradId})`}
                    strokeWidth={hi ? 9 : 6}
                    strokeLinecap="round"
                    opacity={focusId ? (hi ? 0.85 : 0.12) : 0.4}
                  />
                );
              })}

            {/* BASE column labels + dots */}
            {base.l2.map((n) => {
              const y = baseYs[n.id];
              const hasLink = ribbons.some((r) => r.src.id === n.id);
              const isFocus = focusId === n.id;
              const isMuted = focusId && !isFocus && !focusedMappedIds.has(n.id);
              const fill = isFocus ? "#111827" : isMuted ? "#9ca3af" : "#374151";
              const weight = isFocus ? 700 : hasLink ? 600 : 500;
              return (
                <g
                  key={n.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => setFocusId(n.id)}
                >
                  {/* invisible hit area */}
                  <rect
                    x={0}
                    y={y - rowHeight / 2}
                    width={baseX + 20}
                    height={rowHeight}
                    fill="transparent"
                  />
                  <text
                    x={baseX - 12}
                    y={y + 4}
                    textAnchor="end"
                    fontSize={13}
                    fontWeight={weight}
                    fill={fill}
                    opacity={isMuted ? 0.6 : 1}
                  >
                    {n.name}
                  </text>
                  <circle
                    cx={baseX}
                    cy={y}
                    r={isFocus ? 7 : 5}
                    fill={hasLink || isFocus ? base.color : "#e5e7eb"}
                    stroke={isFocus ? "#fff" : "none"}
                    strokeWidth={isFocus ? 2 : 0}
                  />
                  {isFocus && (
                    <circle
                      cx={baseX}
                      cy={y}
                      r={12}
                      fill="none"
                      stroke={base.color}
                      strokeWidth={2}
                      opacity={0.4}
                    />
                  )}
                </g>
              );
            })}

            {/* LINKED column labels + dots */}
            {linked.l2.map((n) => {
              const y = linkedYs[n.id];
              const hasLink = ribbons.some((r) => r.tgt.id === n.id);
              const isFocus = focusId === n.id;
              const isMappedToFocus =
                focusId && focusedMappedIds.has(n.id) && !isFocus;
              const isMuted =
                focusId && !isFocus && !isMappedToFocus && !focusedMappedIds.has(n.id);
              const fill = isFocus || isMappedToFocus ? "#111827" : isMuted ? "#9ca3af" : "#374151";
              const weight = isFocus || isMappedToFocus ? 700 : hasLink ? 600 : 500;
              return (
                <g
                  key={n.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => setFocusId(n.id)}
                >
                  <rect
                    x={linkedX - 20}
                    y={y - rowHeight / 2}
                    width={width - linkedX + 20}
                    height={rowHeight}
                    fill="transparent"
                  />
                  <circle
                    cx={linkedX}
                    cy={y}
                    r={isFocus ? 7 : 5}
                    fill={hasLink || isFocus ? linked.color : "#e5e7eb"}
                    stroke={isFocus ? "#fff" : "none"}
                    strokeWidth={isFocus ? 2 : 0}
                  />
                  <text
                    x={linkedX + 12}
                    y={y + 4}
                    textAnchor="start"
                    fontSize={13}
                    fontWeight={weight}
                    fill={fill}
                    opacity={isMuted ? 0.6 : 1}
                  >
                    {n.name}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Focused segment card — overlaid to the right */}
          {focusedNode && (
            <div className="absolute top-16 right-6 w-[280px] bg-white rounded-xl border border-orange-200 shadow-lg overflow-hidden">
              <div className="px-4 pt-3 pb-2">
                <div className="text-[10px] uppercase tracking-wider text-[#ec9324] font-bold">
                  Focused Segment
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: focusedNode.seg.color }}
                  />
                  <div className="text-lg font-semibold text-gray-900 leading-tight">
                    {focusedNode.name}
                  </div>
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  Level 2 · {focusedNode.seg.name}
                </div>
              </div>
              <div className="px-4 pb-3">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-1.5">
                  Mapped {focusedNode.seg.id === base.id ? linked.name : base.name} segments
                </div>
                <div className="space-y-1">
                  {ribbons
                    .filter(
                      (r) =>
                        r.src.id === focusedNode.id || r.tgt.id === focusedNode.id
                    )
                    .map((r, i) => {
                      const other = r.src.id === focusedNode.id ? r.tgt : r.src;
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-1.5 text-sm text-gray-800"
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ background: other.seg.color }}
                          />
                          {other.name}
                        </div>
                      );
                    })}
                  {ribbons.filter(
                    (r) =>
                      r.src.id === focusedNode.id || r.tgt.id === focusedNode.id
                  ).length === 0 && (
                    <div className="text-xs italic text-gray-400">
                      No mapped segments yet.
                    </div>
                  )}
                </div>
              </div>
              <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50">
                <div className="text-[10px] text-gray-500">
                  Also referenced by{" "}
                  <span className="font-bold text-gray-800">
                    {alsoRefs.length}
                  </span>{" "}
                  other{" "}
                  {focusedNode.seg.id === base.id ? linked.name : base.name === base.name ? base.name : linked.name}{" "}
                  segments.
                </div>
                {alsoRefs.length > 0 && (
                  <div className="mt-1 text-[11px] text-gray-700">
                    {alsoRefs.map((n) => (
                      <span key={n.id} className="inline-flex items-center gap-1 mr-2">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: n.seg.color }} />
                        {n.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-end">
                <button
                  onClick={() => onEdit(focusedNode.id)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#ec9324] hover:bg-orange-50 rounded px-2 py-1"
                >
                  <EditOutlined style={{ fontSize: 14 }} />
                  Edit this segment&apos;s links
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/60 flex items-center gap-3 flex-wrap">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-gray-200 text-sm text-gray-500 min-w-[280px]">
            <Search style={{ fontSize: 16, color: "#9ca3af" }} />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                const q = e.target.value.trim().toLowerCase();
                if (!q) return;
                const hit = [...base.l2, ...linked.l2].find((n) =>
                  n.name.toLowerCase().includes(q)
                );
                if (hit) setFocusId(hit.id);
              }}
              className="flex-1 outline-none bg-transparent placeholder-gray-400 text-sm"
              placeholder="Search or focus a segment"
            />
            <span className="text-[10px] text-gray-400 px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 font-mono">
              ⌘K
            </span>
          </div>

          <div className="ml-auto flex items-center gap-4 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-gray-400 font-bold">
                Focused
              </div>
              <div className="text-sm font-semibold text-gray-800">
                {focusedNode ? focusedNode.name : "—"}
              </div>
            </div>
            <div className="w-px h-8 bg-gray-200" />
            <div>
              <div className="text-[9px] uppercase tracking-wider text-gray-400 font-bold">
                Maps to
              </div>
              <div className="text-sm font-semibold text-[#ec9324]">
                {focusedNode
                  ? `${
                      ribbons.filter(
                        (r) =>
                          r.src.id === focusedNode.id || r.tgt.id === focusedNode.id
                      ).length
                    } ${
                      focusedNode.seg.id === base.id ? linked.name : base.name
                    } segments`
                  : "—"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Explainer */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MiniCard
          heading="Best for"
          tone="orange"
          items={[
            "Executive / stakeholder view — instantly see which base segments carry weight",
            "Visualising many-to-many mappings between two client taxonomies",
            "Spotting orphan nodes (both sides show grey unlinked dots)",
          ]}
        />
        <MiniCard
          heading="Not ideal for"
          tone="gray"
          items={[
            "Bulk data entry — use the shared Edit Links dialog instead",
            "Comparing 3+ segmentations in one view",
          ]}
        />
        <MiniCard
          heading="Interaction model"
          tone="blue"
          items={[
            "Click a segment name (either column) to focus — other ribbons fade to 12%",
            "Focused Segment card lists the mapped targets on the right",
            "Search bar (⌘K) jumps focus to any segment",
            "Edit Links opens the SAME dialog used by the Inline Pill Tags view",
          ]}
        />
      </div>
    </div>
  );
}

// ---------- small subcomponents used by the ribbon view ----------
function SegPill({ segId, setSegId, role, exclude }) {
  const seg = SEGMENTATIONS.find((s) => s.id === segId);
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5">
      <span
        className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
        style={{ background: seg.color }}
      >
        {seg.initials}
      </span>
      <div>
        <div className="text-[9px] uppercase tracking-wider text-gray-400 font-bold leading-none mb-0.5">
          {role}
        </div>
        <select
          value={segId}
          onChange={(e) => setSegId(e.target.value)}
          className="text-sm font-semibold bg-transparent border-0 p-0 outline-none cursor-pointer text-gray-900"
        >
          {SEGMENTATIONS.filter((s) => s.id !== exclude).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="inline-flex flex-col items-start px-3 py-1.5 rounded-lg bg-orange-50 border border-orange-100">
      <div className="text-[9px] uppercase tracking-wider text-[#ec9324] font-bold">
        {label}
      </div>
      <div className="text-lg font-bold text-gray-900 leading-tight">{value}</div>
    </div>
  );
}

function IconBtn({ children }) {
  return (
    <button className="w-8 h-8 flex items-center justify-center hover:bg-white hover:text-gray-900 first:rounded-l-lg last:rounded-r-lg">
      {children}
    </button>
  );
}

function MiniCard({ heading, items, tone = "orange" }) {
  const tones = {
    orange: { bg: "bg-orange-50/60", border: "border-orange-200", title: "text-[#ec9324]", icon: <CheckCircle style={{ fontSize: 16 }} className="text-[#ec9324]" /> },
    gray:   { bg: "bg-gray-50",       border: "border-gray-200",   title: "text-gray-600",  icon: <Close style={{ fontSize: 16 }} className="text-gray-500" /> },
    blue:   { bg: "bg-sky-50/60",     border: "border-sky-200",    title: "text-sky-700",   icon: <LinkIcon style={{ fontSize: 16 }} className="text-sky-600" /> },
  }[tone];
  return (
    <div className={`${tones.bg} ${tones.border} border rounded-lg p-4`}>
      <div className={`text-sm font-semibold ${tones.title} flex items-center gap-1.5 mb-2`}>
        {tones.icon}
        {heading}
      </div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="text-[13px] text-gray-700 flex items-start gap-1.5">
            <span className="text-gray-400 mt-0.5">•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
