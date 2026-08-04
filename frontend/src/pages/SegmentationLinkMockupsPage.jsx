/**
 * SegmentationLinkMockupsPage
 * =========================================================
 * Static visual mockups (no backend calls) demonstrating three
 * candidate UI/UX approaches for linking Level-2 segmentation
 * nodes across different segmentations (many-to-many tag).
 *
 * Route: /crm/segmentation-link-mockups
 * =========================================================
 */
import React, { useMemo, useState } from "react";
import Layout from "../components/Layout";
import LinkIcon from "@mui/icons-material/LinkOutlined";
import LinkOff from "@mui/icons-material/LinkOffOutlined";
import ChevronRight from "@mui/icons-material/ChevronRight";
import Search from "@mui/icons-material/SearchOutlined";
import Close from "@mui/icons-material/CloseOutlined";
import Plus from "@mui/icons-material/AddOutlined";
import ExpandMore from "@mui/icons-material/ExpandMoreOutlined";
import Business from "@mui/icons-material/BusinessOutlined";
import DragIndicator from "@mui/icons-material/DragIndicatorOutlined";
import BubbleChart from "@mui/icons-material/BubbleChartOutlined";
import CenterFocus from "@mui/icons-material/CenterFocusStrongOutlined";
import Info from "@mui/icons-material/InfoOutlined";
import CheckCircle from "@mui/icons-material/CheckCircleOutlined";
import CancelIcon from "@mui/icons-material/CancelOutlined";

// ============================================================
// MOCK DATA — 3 segmentations (companies) × Level-2 nodes each
// ============================================================
const SEGMENTATIONS = [
  {
    id: "infollion",
    name: "Infollion Research",
    color: "#ec9324", // brand orange
    l2: [
      { id: "inf-banking",  name: "Banking",         parent: "BFSI" },
      { id: "inf-fintech",  name: "Fintech",         parent: "BFSI" },
      { id: "inf-insur",    name: "Insurance",       parent: "BFSI" },
      { id: "inf-nbfc",     name: "NBFC",            parent: "BFSI" },
      { id: "inf-fmcg",     name: "Consumer Staples",parent: "Consumer" },
      { id: "inf-chem",     name: "Chemicals",       parent: "Materials" },
    ],
  },
  {
    id: "techcorp",
    name: "TechCorp Advisory",
    color: "#0ea5e9", // sky
    l2: [
      { id: "tc-fs",        name: "Financial Services", parent: "Finance" },
      { id: "tc-insurtech", name: "Insurtech",          parent: "Finance" },
      { id: "tc-lending",   name: "Consumer Lending",   parent: "Finance" },
      { id: "tc-fmcg",      name: "FMCG",               parent: "Retail" },
      { id: "tc-spchem",    name: "Specialty Chemicals",parent: "Industrials" },
      { id: "tc-metals",    name: "Metals & Mining",    parent: "Industrials" },
    ],
  },
  {
    id: "globex",
    name: "Globex Capital",
    color: "#22c55e", // green
    l2: [
      { id: "gx-retail",    name: "Retail Banking", parent: "Finance" },
      { id: "gx-payments",  name: "Payments",       parent: "Finance" },
      { id: "gx-insur",     name: "Life Insurance", parent: "Finance" },
      { id: "gx-materials", name: "Basic Materials",parent: "Materials" },
    ],
  },
];

const INITIAL_LINKS = [
  { a: "inf-banking", b: "tc-fs" },
  { a: "inf-banking", b: "gx-retail" },
  { a: "inf-insur",   b: "tc-insurtech" },
  { a: "inf-insur",   b: "gx-insur" },
  { a: "inf-chem",    b: "tc-spchem" },
  { a: "inf-fintech", b: "tc-fs" },
];

// helpers ---------------------------------------------------
const nodeById = (id) => {
  for (const s of SEGMENTATIONS) {
    const n = s.l2.find((x) => x.id === id);
    if (n) return { ...n, seg: s };
  }
  return null;
};

const linksFor = (nodeId, links) =>
  links
    .filter((l) => l.a === nodeId || l.b === nodeId)
    .map((l) => (l.a === nodeId ? l.b : l.a))
    .map(nodeById)
    .filter(Boolean);

// ============================================================
// PAGE SHELL
// ============================================================
export default function SegmentationLinkMockupsPage() {
  const [tab, setTab] = useState("A");

  return (
    <Layout>
      <div className="px-6 py-6 max-w-[1700px] mx-auto">
        {/* Page header */}
        <div className="mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-100 text-[#ec9324] flex items-center justify-center">
              <LinkIcon />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Cross-Segmentation Level-2 Linking — UI/UX Concepts
              </h1>
              <p className="text-sm text-gray-500">
                Three candidate approaches for connecting a Level-2 node of one
                segmentation to Level-2 nodes of other segmentations
                (many-to-many).
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 border-b border-gray-200 mb-6 overflow-x-auto">
          {[
            { k: "A", label: "Concept A · Chip Drawer" },
            { k: "B", label: "Concept B · Dual-Tree Linker" },
            { k: "C", label: "Concept C · Constellation Graph" },
            { k: "D", label: "Concept D · Inline Pill Tags" },
            { k: "E", label: "Concept E · Equivalency Matrix" },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={
                "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap " +
                (tab === t.k
                  ? "border-[#ec9324] text-[#ec9324]"
                  : "border-transparent text-gray-500 hover:text-gray-800")
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "A" && <ConceptA />}
        {tab === "B" && <ConceptB />}
        {tab === "C" && <ConceptC />}
        {tab === "D" && <ConceptD />}
        {tab === "E" && <ConceptE />}
      </div>
    </Layout>
  );
}

// ============================================================
// CONCEPT A — Chip Drawer
// ============================================================
function ConceptA() {
  const [links, setLinks] = useState(INITIAL_LINKS);
  const [selected, setSelected] = useState("inf-banking");
  const [pickerOpen, setPickerOpen] = useState(false);

  const selNode = nodeById(selected);
  const currentLinks = useMemo(() => linksFor(selected, links), [selected, links]);
  const currentLinkedIds = new Set(currentLinks.map((n) => n.id));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6">
      {/* LEFT — Segmentation tree (source) */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
              Segmentation
            </div>
            <div className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ec9324]" />
              Infollion Research
            </div>
          </div>
          <div className="text-xs text-gray-500">
            Click any Level-2 node to view/edit its cross-links
          </div>
        </div>
        <div className="p-6">
          <MiniTree
            segmentation={SEGMENTATIONS[0]}
            selectedId={selected}
            linkedIds={new Set(links.flatMap((l) => [l.a, l.b]))}
            onSelect={setSelected}
          />
        </div>
      </div>

      {/* RIGHT — Chip drawer */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm sticky top-4 self-start">
        {selNode ? (
          <>
            {/* drawer header */}
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                    Level 2 · in {selNode.seg.name}
                  </div>
                  <div className="text-xl font-semibold text-gray-900">
                    {selNode.name}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Parent: {selNode.parent}
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-100 text-[#ec9324]">
                  <LinkIcon style={{ fontSize: 12 }} />
                  {currentLinks.length} link{currentLinks.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>

            {/* Linked chips */}
            <div className="px-5 py-4">
              <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium mb-2">
                Linked Level-2 nodes
              </div>
              {currentLinks.length === 0 ? (
                <div className="text-sm text-gray-400 italic py-3">
                  No links yet — click <span className="font-medium">+ Link Node</span> to
                  connect this to nodes in other segmentations.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {currentLinks.map((n) => (
                    <span
                      key={n.id}
                      className="group inline-flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-lg border shadow-sm text-sm bg-white"
                      style={{ borderColor: n.seg.color + "80" }}
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: n.seg.color }}
                      />
                      <span className="font-medium text-gray-800">{n.name}</span>
                      <span className="text-[10px] uppercase tracking-wider text-gray-400">
                        {n.seg.name}
                      </span>
                      <button
                        onClick={() =>
                          setLinks((prev) =>
                            prev.filter(
                              (l) =>
                                !(
                                  (l.a === selected && l.b === n.id) ||
                                  (l.b === selected && l.a === n.id)
                                )
                            )
                          )
                        }
                        className="ml-1 w-5 h-5 rounded-full text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center"
                        title="Unlink"
                      >
                        <Close style={{ fontSize: 14 }} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <button
                onClick={() => setPickerOpen(true)}
                className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#ec9324] text-white text-sm font-medium hover:bg-[#d3811b]"
              >
                <Plus style={{ fontSize: 16 }} />
                Link Node
              </button>
            </div>

            {/* Meta */}
            <div className="px-5 py-4 border-t border-gray-100 grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-gray-400 uppercase tracking-wider">Created</div>
                <div className="text-gray-700 mt-0.5">Aug 03 2026 · 14:20</div>
              </div>
              <div>
                <div className="text-gray-400 uppercase tracking-wider">Updated</div>
                <div className="text-gray-700 mt-0.5">Aug 04 2026 · 10:05</div>
              </div>
            </div>

            {/* Picker modal */}
            {pickerOpen && (
              <PickerModal
                sourceNode={selNode}
                linkedIds={currentLinkedIds}
                onClose={() => setPickerOpen(false)}
                onApply={(ids) => {
                  setLinks((prev) => {
                    // Remove existing L2 links from selected then re-add ids
                    const kept = prev.filter(
                      (l) => l.a !== selected && l.b !== selected
                    );
                    const additions = ids.map((id) => ({ a: selected, b: id }));
                    return [...kept, ...additions];
                  });
                  setPickerOpen(false);
                }}
              />
            )}
          </>
        ) : (
          <div className="p-6 text-sm text-gray-500">Select a Level-2 node to view links.</div>
        )}
      </div>

      {/* Bottom explainer */}
      <div className="xl:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
        <ProCon
          heading="Best for"
          tone="orange"
          items={[
            "Fast, everyday tagging while editing a segmentation",
            "Discoverable — links appear next to the node inline",
            "Zero learning curve",
          ]}
        />
        <ProCon
          heading="Not ideal for"
          tone="gray"
          items={[
            "Users linking many nodes across many segmentations at once",
            "Understanding the 'big picture' of relationships",
          ]}
        />
        <ProCon
          heading="Interaction model"
          tone="blue"
          items={[
            "Click node → drawer opens on the right",
            "'+ Link Node' opens a picker grouped by segmentation with search + checkboxes",
            "Each linked node is a coloured chip with an × to unlink",
          ]}
        />
      </div>
    </div>
  );
}

// -------- Picker modal used by Concept A -----------
function PickerModal({ sourceNode, linkedIds, onClose, onApply }) {
  const [checked, setChecked] = useState(new Set(linkedIds));
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState(
    () => new Set(SEGMENTATIONS.filter((s) => s.id !== sourceNode.seg.id).map((s) => s.id))
  );

  const toggle = (id) => {
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const others = SEGMENTATIONS.filter((s) => s.id !== sourceNode.seg.id);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
              Link Level-2 node
            </div>
            <div className="text-lg font-semibold text-gray-900">
              Link <span className="text-[#ec9324]">{sourceNode.name}</span> to…
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 text-gray-500 flex items-center justify-center"
          >
            <Close />
          </button>
        </div>

        {/* search */}
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
        <div className="max-h-[420px] overflow-y-auto">
          {others.map((s) => {
            const nodes = s.l2.filter((n) =>
              n.name.toLowerCase().includes(q.toLowerCase())
            );
            if (!nodes.length) return null;
            const isOpen = expanded.has(s.id);
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
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: s.color }}
                    />
                    <span className="text-sm font-semibold text-gray-800">
                      {s.name}
                    </span>
                    <span className="text-[11px] text-gray-500">
                      {nodes.length} nodes
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
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-800">
                          {n.name}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          under {n.parent}
                        </div>
                      </div>
                      {checked.has(n.id) && (
                        <span className="text-[10px] uppercase text-[#ec9324] font-medium">
                          Selected
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
            {checked.size} node{checked.size === 1 ? "" : "s"} selected
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-sm text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={() => onApply(Array.from(checked))}
              className="px-4 py-1.5 rounded-md bg-[#ec9324] text-white text-sm font-medium hover:bg-[#d3811b]"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------- Mini tree used in Concept A left panel -----------
function MiniTree({ segmentation, selectedId, linkedIds, onSelect }) {
  // Simple SVG tree: root -> 3 L1 parents -> Level-2 leaves
  const width = 780;
  const height = 480;
  const rootX = 60;
  const rootY = height / 2;

  const l1Groups = useMemo(() => {
    const map = {};
    segmentation.l2.forEach((n) => {
      if (!map[n.parent]) map[n.parent] = [];
      map[n.parent].push(n);
    });
    return Object.entries(map).map(([parent, nodes]) => ({ parent, nodes }));
  }, [segmentation]);

  const l1X = 260;
  const l2X = 520;
  const l1YStart = 60;
  const l1Slot = (height - 120) / Math.max(l1Groups.length, 1);

  const l1Positions = l1Groups.map((_, i) => ({
    x: l1X,
    y: l1YStart + l1Slot * i + l1Slot / 2,
  }));

  const l2Positions = [];
  l1Groups.forEach((g, gi) => {
    const parentY = l1Positions[gi].y;
    const spacing = 44;
    g.nodes.forEach((n, i) => {
      l2Positions.push({
        id: n.id,
        name: n.name,
        x: l2X,
        y: parentY - ((g.nodes.length - 1) * spacing) / 2 + i * spacing,
        parentIndex: gi,
      });
    });
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[480px]">
      {/* root -> l1 */}
      {l1Positions.map((p, i) => (
        <path
          key={`r-${i}`}
          d={`M ${rootX + 22},${rootY} C ${(rootX + p.x) / 2},${rootY} ${
            (rootX + p.x) / 2
          },${p.y} ${p.x - 22},${p.y}`}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={1.5}
        />
      ))}
      {/* l1 -> l2 */}
      {l2Positions.map((n) => {
        const p = l1Positions[n.parentIndex];
        return (
          <path
            key={`l-${n.id}`}
            d={`M ${p.x + 22},${p.y} C ${(p.x + n.x) / 2},${p.y} ${
              (p.x + n.x) / 2
            },${n.y} ${n.x - 22},${n.y}`}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={1.5}
          />
        );
      })}

      {/* root */}
      <g>
        <circle cx={rootX} cy={rootY} r={12} fill={segmentation.color} />
        <text
          x={rootX + 22}
          y={rootY + 4}
          fontSize={13}
          fontWeight={600}
          fill="#111827"
        >
          {segmentation.name}
        </text>
      </g>

      {/* l1 */}
      {l1Groups.map((g, i) => (
        <g key={g.parent}>
          <circle cx={l1Positions[i].x} cy={l1Positions[i].y} r={8} fill="#0ea5e9" />
          <text
            x={l1Positions[i].x + 16}
            y={l1Positions[i].y + 4}
            fontSize={12}
            fontWeight={600}
            fill="#374151"
          >
            {g.parent}
          </text>
        </g>
      ))}

      {/* l2 */}
      {l2Positions.map((n) => {
        const isSel = n.id === selectedId;
        const isLinked = linkedIds.has(n.id);
        return (
          <g
            key={n.id}
            style={{ cursor: "pointer" }}
            onClick={() => onSelect(n.id)}
          >
            {isSel && (
              <circle
                cx={n.x}
                cy={n.y}
                r={12}
                fill="rgba(236,147,36,0.15)"
                stroke="#ec9324"
                strokeWidth={2}
              />
            )}
            <circle
              cx={n.x}
              cy={n.y}
              r={6}
              fill="#fff"
              stroke="#22c55e"
              strokeWidth={2}
            />
            <text
              x={n.x + 14}
              y={n.y + 4}
              fontSize={12}
              fontWeight={isSel ? 700 : 500}
              fill={isSel ? "#ec9324" : "#111827"}
            >
              {n.name}
            </text>
            {isLinked && (
              <g>
                <circle cx={n.x + 118} cy={n.y - 8} r={7} fill="#ec9324" />
                <text
                  x={n.x + 118}
                  y={n.y - 5}
                  fontSize={9}
                  fontWeight={700}
                  fill="#fff"
                  textAnchor="middle"
                >
                  L
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* Legend */}
      <g transform="translate(20, 440)">
        <circle cx={0} cy={0} r={5} fill="#fff" stroke="#22c55e" strokeWidth={2} />
        <text x={10} y={4} fontSize={11} fill="#6b7280">
          Level-2 node
        </text>
        <circle cx={110} cy={0} r={7} fill="#ec9324" />
        <text x={122} y={4} fontSize={11} fill="#6b7280">
          Has cross-links
        </text>
        <rect
          x={220}
          y={-6}
          width={12}
          height={12}
          fill="rgba(236,147,36,0.15)"
          stroke="#ec9324"
          strokeWidth={1.5}
        />
        <text x={238} y={4} fontSize={11} fill="#6b7280">
          Selected
        </text>
      </g>
    </svg>
  );
}

// ============================================================
// CONCEPT B — Dual-Tree Linker (drag to link)
// ============================================================
function ConceptB() {
  const [links, setLinks] = useState(INITIAL_LINKS);
  const [rightSegId, setRightSegId] = useState("techcorp");
  const [dragging, setDragging] = useState(null); // {id, name, x, y}
  const [pointer, setPointer] = useState(null);

  const leftSeg = SEGMENTATIONS[0];
  const rightSeg = SEGMENTATIONS.find((s) => s.id === rightSegId);

  const nodeCoords = (side, index, total) => {
    const y = 90 + index * 60;
    const x = side === "left" ? 100 : 520;
    return { x, y };
  };

  const linksBetween = links
    .map((l) => {
      const a = nodeById(l.a);
      const b = nodeById(l.b);
      const left =
        a && a.seg.id === leftSeg.id ? a : b && b.seg.id === leftSeg.id ? b : null;
      const right =
        a && a.seg.id === rightSeg.id ? a : b && b.seg.id === rightSeg.id ? b : null;
      if (!left || !right) return null;
      return { left, right };
    })
    .filter(Boolean);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-orange-50/60 to-sky-50/60">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white shadow-sm text-xs font-medium text-gray-700">
              <span className="w-2 h-2 rounded-full" style={{ background: leftSeg.color }} />
              {leftSeg.name}
            </span>
            <ChevronRight style={{ color: "#9ca3af" }} />
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">
                Link into
              </span>
              <select
                value={rightSegId}
                onChange={(e) => setRightSegId(e.target.value)}
                className="text-sm font-medium bg-white border border-gray-200 rounded-md px-2 py-1"
              >
                {SEGMENTATIONS.filter((s) => s.id !== leftSeg.id).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="text-xs text-gray-500 flex items-center gap-1.5">
            <DragIndicator style={{ fontSize: 14 }} />
            Drag a Level-2 node from the left onto a node on the right to link
          </div>
        </div>

        <div
          className="relative bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] bg-[length:20px_20px]"
          style={{ height: 560 }}
          onMouseMove={(e) => {
            if (!dragging) return;
            const rect = e.currentTarget.getBoundingClientRect();
            setPointer({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          }}
          onMouseUp={() => {
            setDragging(null);
            setPointer(null);
          }}
        >
          <svg viewBox="0 0 640 560" className="w-full h-full">
            {/* header labels */}
            <text x={100} y={50} textAnchor="middle" fontSize={12} fontWeight={700} fill={leftSeg.color}>
              {leftSeg.name.toUpperCase()}
            </text>
            <text x={520} y={50} textAnchor="middle" fontSize={12} fontWeight={700} fill={rightSeg.color}>
              {rightSeg.name.toUpperCase()}
            </text>

            {/* Existing links — orange dashed arcs */}
            {linksBetween.map(({ left, right }, i) => {
              const li = leftSeg.l2.findIndex((n) => n.id === left.id);
              const ri = rightSeg.l2.findIndex((n) => n.id === right.id);
              const a = nodeCoords("left", li);
              const b = nodeCoords("right", ri);
              return (
                <g key={i}>
                  <path
                    d={`M ${a.x + 90},${a.y} C 300,${a.y} 320,${b.y} ${b.x - 90},${b.y}`}
                    fill="none"
                    stroke="#ec9324"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    opacity={0.7}
                  />
                  <circle cx={310} cy={(a.y + b.y) / 2} r={6} fill="#ec9324" />
                  <LinkIconGlyph cx={310} cy={(a.y + b.y) / 2} />
                </g>
              );
            })}

            {/* live drag line */}
            {dragging && pointer && (
              <path
                d={`M ${dragging.x + 90},${dragging.y} L ${pointer.x},${pointer.y}`}
                stroke="#ec9324"
                strokeWidth={2}
                strokeDasharray="4 3"
              />
            )}

            {/* LEFT column nodes */}
            {leftSeg.l2.map((n, i) => {
              const p = nodeCoords("left", i);
              return (
                <g key={n.id} style={{ cursor: "grab" }}>
                  <rect
                    x={p.x - 90}
                    y={p.y - 18}
                    rx={9}
                    width={180}
                    height={36}
                    fill="#fff"
                    stroke={leftSeg.color}
                    strokeWidth={2}
                    onMouseDown={() =>
                      setDragging({ id: n.id, name: n.name, x: p.x, y: p.y })
                    }
                  />
                  <text
                    x={p.x}
                    y={p.y + 4}
                    textAnchor="middle"
                    fontSize={13}
                    fontWeight={600}
                    fill="#111827"
                    style={{ pointerEvents: "none" }}
                  >
                    {n.name}
                  </text>
                  <DragIndicatorSvg cx={p.x - 78} cy={p.y} />
                </g>
              );
            })}

            {/* RIGHT column nodes */}
            {rightSeg.l2.map((n, i) => {
              const p = nodeCoords("right", i);
              const highlighted =
                dragging && pointer && Math.abs(pointer.x - p.x) < 100 && Math.abs(pointer.y - p.y) < 22;
              return (
                <g
                  key={n.id}
                  onMouseUp={() => {
                    if (!dragging) return;
                    setLinks((prev) => {
                      const exists = prev.some(
                        (l) =>
                          (l.a === dragging.id && l.b === n.id) ||
                          (l.b === dragging.id && l.a === n.id)
                      );
                      if (exists) return prev;
                      return [...prev, { a: dragging.id, b: n.id }];
                    });
                    setDragging(null);
                    setPointer(null);
                  }}
                  style={{ cursor: dragging ? "cell" : "default" }}
                >
                  <rect
                    x={p.x - 90}
                    y={p.y - 18}
                    rx={9}
                    width={180}
                    height={36}
                    fill={highlighted ? "rgba(236,147,36,0.15)" : "#fff"}
                    stroke={rightSeg.color}
                    strokeWidth={2}
                    strokeDasharray={dragging ? "4 3" : "0"}
                  />
                  <text
                    x={p.x}
                    y={p.y + 4}
                    textAnchor="middle"
                    fontSize={13}
                    fontWeight={600}
                    fill="#111827"
                    style={{ pointerEvents: "none" }}
                  >
                    {n.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Right sidebar */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm sticky top-4 self-start">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
            Active Links · this session
          </div>
          <div className="text-lg font-semibold text-gray-900">
            {linksBetween.length} cross-links
          </div>
        </div>
        <div className="max-h-[440px] overflow-y-auto">
          {linksBetween.length === 0 && (
            <div className="p-6 text-sm text-gray-400 italic">
              No links between these two segmentations yet — drag from the left
              onto the right to create one.
            </div>
          )}
          {linksBetween.map(({ left, right }, i) => (
            <div key={i} className="px-5 py-3 border-b border-gray-50 flex items-center gap-2">
              <span className="text-sm font-medium text-gray-800">
                {left.name}
              </span>
              <span className="text-[#ec9324]">
                <LinkIcon style={{ fontSize: 16 }} />
              </span>
              <span className="text-sm font-medium text-gray-800">
                {right.name}
              </span>
              <button
                onClick={() =>
                  setLinks((prev) =>
                    prev.filter(
                      (l) =>
                        !(
                          (l.a === left.id && l.b === right.id) ||
                          (l.b === left.id && l.a === right.id)
                        )
                    )
                  )
                }
                className="ml-auto text-gray-400 hover:text-red-500"
                title="Unlink"
              >
                <LinkOff style={{ fontSize: 18 }} />
              </button>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 text-[11px] text-gray-500 flex items-center gap-1">
          <Info style={{ fontSize: 14 }} />
          Switch the right dropdown to link with another segmentation
        </div>
      </div>

      {/* Bottom explainer */}
      <div className="xl:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
        <ProCon
          heading="Best for"
          tone="orange"
          items={[
            "Bulk-linking many nodes between two segmentations at once",
            "Users who think spatially — draw → connect",
            "Client-mapping / equivalency workflows",
          ]}
        />
        <ProCon
          heading="Not ideal for"
          tone="gray"
          items={[
            "Linking across 3+ segmentations in one flow",
            "Casual edits from inside the normal tree editor",
          ]}
        />
        <ProCon
          heading="Interaction model"
          tone="blue"
          items={[
            "Split canvas — source on left, target segmentation picker on right",
            "Drag a source card and drop onto a target card to create a link",
            "Dashed orange arcs show existing links; unlink from the side list",
          ]}
        />
      </div>
    </div>
  );
}

const LinkIconGlyph = ({ cx, cy }) => (
  <g transform={`translate(${cx - 5},${cy - 5})`}>
    <path
      d="M3 5.5a2.5 2.5 0 0 1 2.5-2.5H7v1H5.5A1.5 1.5 0 0 0 4 5.5v1A1.5 1.5 0 0 0 5.5 8H7v1H5.5A2.5 2.5 0 0 1 3 6.5v-1zm4 0h1v1H7v-1zM6 5.5A1.5 1.5 0 0 1 7.5 4H9v1H7.5A.5.5 0 0 0 7 5.5v1a.5.5 0 0 0 .5.5H9v1H7.5A1.5 1.5 0 0 1 6 6.5v-1z"
      fill="#fff"
      transform="scale(0.85)"
    />
  </g>
);

const DragIndicatorSvg = ({ cx, cy }) => (
  <g transform={`translate(${cx - 4},${cy - 6})`} opacity={0.45}>
    <circle cx={2} cy={2} r={1.2} fill="#6b7280" />
    <circle cx={6} cy={2} r={1.2} fill="#6b7280" />
    <circle cx={2} cy={6} r={1.2} fill="#6b7280" />
    <circle cx={6} cy={6} r={1.2} fill="#6b7280" />
    <circle cx={2} cy={10} r={1.2} fill="#6b7280" />
    <circle cx={6} cy={10} r={1.2} fill="#6b7280" />
  </g>
);

// ============================================================
// CONCEPT C — Constellation graph
// ============================================================
function ConceptC() {
  const [links, setLinks] = useState(INITIAL_LINKS);
  const [selected, setSelected] = useState("inf-banking");
  const [hoverId, setHoverId] = useState(null);
  const [filter, setFilter] = useState("all"); // all | linked | unlinked

  // Compute positions: cluster nodes by their segmentation around three anchor points
  const width = 1000;
  const height = 620;
  const anchors = {
    infollion: { x: 280, y: 220 },
    techcorp:  { x: 720, y: 220 },
    globex:    { x: 500, y: 480 },
  };

  const positions = useMemo(() => {
    const out = {};
    SEGMENTATIONS.forEach((s) => {
      const anchor = anchors[s.id];
      const n = s.l2.length;
      s.l2.forEach((node, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const r = 110 + (i % 2) * 12;
        out[node.id] = {
          x: anchor.x + Math.cos(angle) * r,
          y: anchor.y + Math.sin(angle) * r,
          seg: s,
          node,
        };
      });
    });
    return out;
    // eslint-disable-next-line
  }, []);

  const nodeIsVisible = (id) => {
    if (filter === "all") return true;
    const hasLink = links.some((l) => l.a === id || l.b === id);
    return filter === "linked" ? hasLink : !hasLink;
  };

  const highlightNode = hoverId || selected;
  const highlightLinks = new Set(
    links
      .filter((l) => l.a === highlightNode || l.b === highlightNode)
      .flatMap((l) => [l.a, l.b])
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-gradient-to-r from-orange-100 to-sky-100 text-xs font-semibold text-gray-800">
              <BubbleChart style={{ fontSize: 16 }} />
              Cross-Segmentation Map
            </span>
            <span className="text-xs text-gray-500">
              {Object.keys(positions).length} Level-2 nodes · {links.length} links
            </span>
          </div>
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            {["all", "linked", "unlinked"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={
                  "px-3 py-1 text-xs font-medium rounded-md capitalize " +
                  (filter === f
                    ? "bg-white shadow-sm text-gray-900"
                    : "text-gray-500 hover:text-gray-800")
                }
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="relative bg-gradient-to-br from-slate-50 to-white" style={{ height }}>
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
            {/* Cluster boundary circles */}
            {SEGMENTATIONS.map((s) => (
              <g key={s.id}>
                <circle
                  cx={anchors[s.id].x}
                  cy={anchors[s.id].y}
                  r={150}
                  fill={s.color + "10"}
                  stroke={s.color + "50"}
                  strokeDasharray="6 6"
                  strokeWidth={1.5}
                />
                <text
                  x={anchors[s.id].x}
                  y={anchors[s.id].y - 158}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={700}
                  fill={s.color}
                  style={{ textTransform: "uppercase", letterSpacing: 1 }}
                >
                  {s.name}
                </text>
              </g>
            ))}

            {/* Links */}
            {links.map((l, i) => {
              const a = positions[l.a];
              const b = positions[l.b];
              if (!a || !b) return null;
              if (!nodeIsVisible(l.a) || !nodeIsVisible(l.b)) return null;
              const isHi =
                highlightNode && (l.a === highlightNode || l.b === highlightNode);
              return (
                <path
                  key={i}
                  d={`M ${a.x},${a.y} Q ${(a.x + b.x) / 2},${(a.y + b.y) / 2 - 50} ${b.x},${b.y}`}
                  fill="none"
                  stroke={isHi ? "#ec9324" : "#cbd5e1"}
                  strokeWidth={isHi ? 2.5 : 1.5}
                  opacity={isHi ? 1 : 0.55}
                  strokeDasharray={isHi ? "0" : "5 4"}
                />
              );
            })}

            {/* Nodes */}
            {Object.values(positions).map(({ x, y, seg, node }) => {
              if (!nodeIsVisible(node.id)) return null;
              const isSel = node.id === selected;
              const isHi = highlightLinks.has(node.id);
              const isHover = hoverId === node.id;
              return (
                <g
                  key={node.id}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHoverId(node.id)}
                  onMouseLeave={() => setHoverId(null)}
                  onClick={() => setSelected(node.id)}
                >
                  {isSel && (
                    <circle
                      cx={x}
                      cy={y}
                      r={22}
                      fill="rgba(236,147,36,0.15)"
                      stroke="#ec9324"
                      strokeWidth={2}
                    />
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={isSel || isHover ? 11 : 9}
                    fill={seg.color}
                    stroke={isHi ? "#ec9324" : "#fff"}
                    strokeWidth={isHi ? 3 : 2}
                  />
                  <text
                    x={x}
                    y={y + 26}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={isSel ? 700 : 500}
                    fill="#111827"
                  >
                    {node.name}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Floating toolbar */}
          <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur rounded-lg shadow-md border border-gray-200 flex items-center overflow-hidden text-gray-600">
            <button className="w-9 h-9 flex items-center justify-center hover:bg-gray-100">
              <CenterFocus style={{ fontSize: 18 }} />
            </button>
            <div className="w-px h-6 bg-gray-200" />
            <button className="w-9 h-9 flex items-center justify-center hover:bg-gray-100 text-lg font-bold">
              +
            </button>
            <div className="w-px h-6 bg-gray-200" />
            <button className="w-9 h-9 flex items-center justify-center hover:bg-gray-100 text-lg font-bold">
              −
            </button>
          </div>

          {/* Legend */}
          <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur rounded-lg shadow-md border border-gray-200 px-3 py-2 flex items-center gap-4 text-[11px] text-gray-600">
            {SEGMENTATIONS.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Right — details panel */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm sticky top-4 self-start">
        {(() => {
          const sel = nodeById(selected);
          if (!sel) return <div className="p-5 text-sm text-gray-500">Click a node in the graph to see its links.</div>;
          const sLinks = linksFor(selected, links);
          return (
            <>
              <div className="px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                  <span className="w-2 h-2 rounded-full" style={{ background: sel.seg.color }} />
                  {sel.seg.name} · Level 2
                </div>
                <div className="text-xl font-semibold text-gray-900">{sel.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">under {sel.parent}</div>
              </div>
              <div className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
                    Connected to
                  </div>
                  <span className="text-xs text-gray-500">{sLinks.length} nodes</span>
                </div>
                {sLinks.length === 0 && (
                  <div className="text-sm text-gray-400 italic">
                    Not connected to any other segmentation yet.
                  </div>
                )}
                <div className="space-y-2">
                  {sLinks.map((n) => (
                    <div
                      key={n.id}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-gray-200 hover:border-orange-300 hover:bg-orange-50/50"
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: n.seg.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">
                          {n.name}
                        </div>
                        <div className="text-[10px] text-gray-500">{n.seg.name}</div>
                      </div>
                      <button
                        onClick={() =>
                          setLinks((prev) =>
                            prev.filter(
                              (l) =>
                                !(
                                  (l.a === selected && l.b === n.id) ||
                                  (l.b === selected && l.a === n.id)
                                )
                            )
                          )
                        }
                        className="text-gray-400 hover:text-red-500"
                        title="Unlink"
                      >
                        <LinkOff style={{ fontSize: 16 }} />
                      </button>
                    </div>
                  ))}
                </div>
                <button className="mt-3 w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-md border border-dashed border-[#ec9324] text-[#ec9324] text-sm font-medium hover:bg-orange-50">
                  <Plus style={{ fontSize: 16 }} />
                  Drag another node onto {sel.name} to connect
                </button>
              </div>
            </>
          );
        })()}
      </div>

      {/* Explainer */}
      <div className="xl:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
        <ProCon
          heading="Best for"
          tone="orange"
          items={[
            "Exploring the big picture of relationships across all segmentations",
            "Discovering hidden clusters / equivalencies",
            "Analytics / reporting audiences",
          ]}
        />
        <ProCon
          heading="Not ideal for"
          tone="gray"
          items={[
            "First-time or bulk data entry (initial linking)",
            "Users who want the linking to happen inline while editing a tree",
          ]}
        />
        <ProCon
          heading="Interaction model"
          tone="blue"
          items={[
            "Dedicated view — all Level-2 nodes on one canvas",
            "Nodes clustered around their parent segmentation",
            "Hover a node to highlight its links; click to focus + edit in the side panel",
            "Filter: All / Linked / Unlinked",
          ]}
        />
      </div>
    </div>
  );
}

// ============================================================
// CONCEPT D — Inline Pill Tags on Tree
// ============================================================
function ConceptD() {
  const [links, setLinks] = useState(INITIAL_LINKS);
  const [openNodeId, setOpenNodeId] = useState(null);
  const [query, setQuery] = useState("");

  const seg = SEGMENTATIONS[0]; // Infollion Research
  const width = 1100;
  const height = 640;
  const rootX = 60;
  const rootY = height / 2;

  const l1Groups = useMemo(() => {
    const map = {};
    seg.l2.forEach((n) => {
      if (!map[n.parent]) map[n.parent] = [];
      map[n.parent].push(n);
    });
    return Object.entries(map).map(([parent, nodes]) => ({ parent, nodes }));
  }, [seg]);

  const l1X = 240;
  const l2X = 500;
  const l1YStart = 60;
  const l1Slot = (height - 120) / Math.max(l1Groups.length, 1);
  const l1Positions = l1Groups.map((_, i) => ({
    x: l1X,
    y: l1YStart + l1Slot * i + l1Slot / 2,
  }));
  const l2Positions = [];
  l1Groups.forEach((g, gi) => {
    const parentY = l1Positions[gi].y;
    const spacing = 90; // extra room for chips row
    g.nodes.forEach((n, i) => {
      l2Positions.push({
        id: n.id,
        name: n.name,
        x: l2X,
        y: parentY - ((g.nodes.length - 1) * spacing) / 2 + i * spacing,
        parentIndex: gi,
      });
    });
  });

  const findSuggestions = () => {
    const q = query.trim().toLowerCase();
    const already = new Set(
      links
        .filter((l) => l.a === openNodeId || l.b === openNodeId)
        .flatMap((l) => [l.a, l.b])
    );
    const out = [];
    SEGMENTATIONS.forEach((s) => {
      if (s.id === seg.id) return;
      s.l2.forEach((n) => {
        if (already.has(n.id)) return;
        if (q && !n.name.toLowerCase().includes(q)) return;
        out.push({ ...n, seg: s });
      });
    });
    return out.slice(0, 6);
  };

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
              Segmentation
            </div>
            <div className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: seg.color }} />
              {seg.name}
            </div>
          </div>
          <div className="text-xs text-gray-500">
            Links appear as coloured pills directly under each Level-2 node
          </div>
        </div>
        <div className="p-6 relative">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
            {/* root -> l1 */}
            {l1Positions.map((p, i) => (
              <path
                key={`r-${i}`}
                d={`M ${rootX + 22},${rootY} C ${(rootX + p.x) / 2},${rootY} ${(rootX + p.x) / 2},${p.y} ${p.x - 22},${p.y}`}
                fill="none"
                stroke="#e5e7eb"
                strokeWidth={1.5}
              />
            ))}
            {/* l1 -> l2 */}
            {l2Positions.map((n) => {
              const p = l1Positions[n.parentIndex];
              return (
                <path
                  key={`l-${n.id}`}
                  d={`M ${p.x + 22},${p.y} C ${(p.x + n.x) / 2},${p.y} ${(p.x + n.x) / 2},${n.y} ${n.x - 22},${n.y}`}
                  fill="none"
                  stroke="#e5e7eb"
                  strokeWidth={1.5}
                />
              );
            })}
            {/* root */}
            <circle cx={rootX} cy={rootY} r={12} fill={seg.color} />
            <text x={rootX + 22} y={rootY + 4} fontSize={13} fontWeight={700} fill="#111827">
              {seg.name}
            </text>
            {/* l1 groups */}
            {l1Groups.map((g, i) => (
              <g key={g.parent}>
                <circle cx={l1Positions[i].x} cy={l1Positions[i].y} r={9} fill="#0ea5e9" />
                <text
                  x={l1Positions[i].x + 16}
                  y={l1Positions[i].y + 4}
                  fontSize={12}
                  fontWeight={600}
                  fill="#374151"
                >
                  {g.parent}
                </text>
              </g>
            ))}
            {/* l2 nodes with chip rows */}
            {l2Positions.map((n) => {
              const nodeLinks = linksFor(n.id, links);
              const isOpen = openNodeId === n.id;
              return (
                <g key={n.id}>
                  <circle cx={n.x} cy={n.y} r={7} fill="#fff" stroke="#22c55e" strokeWidth={2} />
                  <text
                    x={n.x + 14}
                    y={n.y + 4}
                    fontSize={13}
                    fontWeight={600}
                    fill="#111827"
                  >
                    {n.name}
                  </text>
                  {/* Chips row via foreignObject */}
                  <foreignObject x={n.x + 14} y={n.y + 10} width={520} height={40}>
                    <div
                      xmlns="http://www.w3.org/1999/xhtml"
                      className="flex flex-wrap items-center gap-1"
                    >
                      {nodeLinks.map((ln) => (
                        <span
                          key={ln.id}
                          className="group inline-flex items-center gap-1 pl-1.5 pr-0.5 py-0.5 rounded-full text-[10px] font-medium border shadow-sm bg-white"
                          style={{
                            borderColor: ln.seg.color + "70",
                            color: "#374151",
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: ln.seg.color }}
                          />
                          {ln.name}
                          <button
                            onClick={() =>
                              setLinks((prev) =>
                                prev.filter(
                                  (l) =>
                                    !(
                                      (l.a === n.id && l.b === ln.id) ||
                                      (l.b === n.id && l.a === ln.id)
                                    )
                                )
                              )
                            }
                            className="w-3 h-3 rounded-full opacity-40 hover:opacity-100 hover:bg-red-100 hover:text-red-600 flex items-center justify-center"
                          >
                            <span style={{ fontSize: 10, lineHeight: 1 }}>×</span>
                          </button>
                        </span>
                      ))}
                      <button
                        onClick={() => {
                          setOpenNodeId(isOpen ? null : n.id);
                          setQuery("");
                        }}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border border-dashed border-[#ec9324] text-[#ec9324] bg-orange-50/60 hover:bg-orange-100"
                      >
                        + Link
                      </button>
                    </div>
                  </foreignObject>

                  {/* Inline autocomplete popover */}
                  {isOpen && (
                    <foreignObject x={n.x + 14} y={n.y + 44} width={340} height={260}>
                      <div
                        xmlns="http://www.w3.org/1999/xhtml"
                        className="bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden"
                      >
                        <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
                          <span style={{ fontSize: 12, color: "#9ca3af" }}>🔎</span>
                          <input
                            autoFocus
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="flex-1 outline-none text-xs placeholder-gray-400"
                            placeholder="Search Level-2 nodes to link…"
                          />
                          <button
                            className="text-[10px] text-gray-400 hover:text-gray-700"
                            onClick={() => setOpenNodeId(null)}
                          >
                            ESC
                          </button>
                        </div>
                        <div className="max-h-[210px] overflow-y-auto">
                          {findSuggestions().length === 0 ? (
                            <div className="px-3 py-3 text-[11px] italic text-gray-400">
                              No matching nodes
                            </div>
                          ) : (
                            findSuggestions().map((s) => (
                              <button
                                key={s.id}
                                onClick={() => {
                                  setLinks((prev) => [
                                    ...prev,
                                    { a: n.id, b: s.id },
                                  ]);
                                  setQuery("");
                                }}
                                className="w-full px-3 py-2 flex items-center gap-2 hover:bg-orange-50 border-b border-gray-50 text-left"
                              >
                                <span
                                  className="w-2 h-2 rounded-full"
                                  style={{ background: s.seg.color }}
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-semibold text-gray-800">
                                    {s.name}
                                  </div>
                                  <div className="text-[10px] text-gray-500">
                                    {s.seg.name} · under {s.parent}
                                  </div>
                                </div>
                                <span className="text-[10px] text-[#ec9324] font-semibold">
                                  Link ↵
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </foreignObject>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ProCon
          heading="Best for"
          tone="orange"
          items={[
            "Everyday CRM linking — see and edit links without leaving the tree",
            "Analysts who scan a tree top-down and add tags in place",
            "Zero context-switch: no drawer, no modal, no navigation",
          ]}
        />
        <ProCon
          heading="Not ideal for"
          tone="gray"
          items={[
            "Very dense trees (many chips can clutter the row)",
            "Bulk operations across many nodes",
          ]}
        />
        <ProCon
          heading="Interaction model"
          tone="blue"
          items={[
            "Chips (coloured by target segmentation) render under each Level-2 label",
            "'+ Link' pill opens an inline autocomplete right on the node",
            "Type-ahead search filters across all other segmentations",
            "Enter / click a suggestion → link created instantly; × on a chip removes",
          ]}
        />
      </div>
    </div>
  );
}

// ============================================================
// CONCEPT E — Equivalency Matrix (checkbox grid)
// ============================================================
function ConceptE() {
  const [links, setLinks] = useState(INITIAL_LINKS);
  const [rowSegId, setRowSegId] = useState("infollion");
  const [colSegId, setColSegId] = useState("techcorp");

  const rowSeg = SEGMENTATIONS.find((s) => s.id === rowSegId);
  const colSeg = SEGMENTATIONS.find((s) => s.id === colSegId);

  const isLinked = (aId, bId) =>
    links.some(
      (l) => (l.a === aId && l.b === bId) || (l.b === aId && l.a === bId)
    );

  const toggle = (aId, bId) => {
    setLinks((prev) => {
      const exists = prev.some(
        (l) => (l.a === aId && l.b === bId) || (l.b === aId && l.a === bId)
      );
      if (exists) {
        return prev.filter(
          (l) => !((l.a === aId && l.b === bId) || (l.b === aId && l.a === bId))
        );
      }
      return [...prev, { a: aId, b: bId }];
    });
  };

  const rowCoverage = (rowNode) =>
    colSeg.l2.filter((c) => isLinked(rowNode.id, c.id)).length;
  const colCoverage = (colNode) =>
    rowSeg.l2.filter((r) => isLinked(r.id, colNode.id)).length;

  const totalCells = rowSeg.l2.length * colSeg.l2.length;
  const linkedCells = rowSeg.l2.reduce(
    (acc, r) => acc + rowCoverage(r),
    0
  );

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* header controls */}
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-4 bg-gradient-to-r from-orange-50/40 to-sky-50/40">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
              Rows
            </span>
            <select
              value={rowSegId}
              onChange={(e) => setRowSegId(e.target.value)}
              className="text-sm font-semibold bg-white border border-gray-200 rounded-md px-2 py-1"
            >
              {SEGMENTATIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <span className="text-gray-300">×</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
              Columns
            </span>
            <select
              value={colSegId}
              onChange={(e) => setColSegId(e.target.value)}
              className="text-sm font-semibold bg-white border border-gray-200 rounded-md px-2 py-1"
            >
              {SEGMENTATIONS.filter((s) => s.id !== rowSegId).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-100 text-[#ec9324] text-xs font-semibold">
              <LinkIcon style={{ fontSize: 14 }} />
              {linkedCells} / {totalCells} cells linked
            </span>
            <span className="text-xs text-gray-500">
              {Math.round((linkedCells / totalCells) * 100)}% coverage
            </span>
          </div>
        </div>

        {/* Matrix */}
        <div className="overflow-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white z-10 px-3 py-3 border-b border-gray-200 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 min-w-[220px]">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: rowSeg.color }} />
                    {rowSeg.name}
                  </div>
                </th>
                {colSeg.l2.map((c) => (
                  <th
                    key={c.id}
                    className="px-2 py-3 border-b border-gray-200 text-center align-bottom text-[11px] font-semibold text-gray-700"
                    style={{ minWidth: 96 }}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: colSeg.color }}
                      />
                      <span
                        className="whitespace-nowrap"
                        style={{
                          writingMode: "horizontal-tb",
                          transform: "rotate(-30deg)",
                          transformOrigin: "center",
                        }}
                      >
                        {c.name}
                      </span>
                      <span className="text-[9px] text-gray-400 font-normal">
                        {colCoverage(c)} link{colCoverage(c) === 1 ? "" : "s"}
                      </span>
                    </div>
                  </th>
                ))}
                <th className="px-3 py-3 border-b border-l border-gray-200 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500 bg-orange-50/60">
                  Row total
                </th>
              </tr>
            </thead>
            <tbody>
              {rowSeg.l2.map((r, ri) => (
                <tr key={r.id} className={ri % 2 ? "bg-gray-50/40" : "bg-white"}>
                  <td className="sticky left-0 z-10 px-3 py-2 border-b border-gray-100 text-sm font-medium text-gray-800"
                      style={{ background: ri % 2 ? "#fafafa" : "#fff" }}>
                    <div className="flex flex-col">
                      <span>{r.name}</span>
                      <span className="text-[10px] text-gray-400 font-normal">
                        under {r.parent}
                      </span>
                    </div>
                  </td>
                  {colSeg.l2.map((c) => {
                    const linked = isLinked(r.id, c.id);
                    return (
                      <td
                        key={c.id}
                        className={
                          "px-2 py-2 border-b border-gray-100 text-center cursor-pointer transition-colors " +
                          (linked ? "bg-orange-50 hover:bg-orange-100" : "hover:bg-orange-50/40")
                        }
                        onClick={() => toggle(r.id, c.id)}
                      >
                        {linked ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#ec9324] text-white shadow-sm">
                            <CheckCircle style={{ fontSize: 16 }} />
                          </span>
                        ) : (
                          <span className="inline-block w-5 h-5 rounded border border-gray-300 hover:border-[#ec9324] hover:bg-white" />
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 border-b border-l border-gray-100 text-center text-sm font-semibold bg-orange-50/60 text-[#ec9324]">
                    {rowCoverage(r)}
                  </td>
                </tr>
              ))}
              {/* Column totals footer */}
              <tr className="bg-orange-50/40">
                <td className="sticky left-0 z-10 bg-orange-50/60 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500 border-t border-gray-200">
                  Col total
                </td>
                {colSeg.l2.map((c) => (
                  <td
                    key={c.id}
                    className="px-2 py-2 text-center text-sm font-semibold text-[#ec9324] border-t border-gray-200"
                  >
                    {colCoverage(c)}
                  </td>
                ))}
                <td className="px-3 py-2 text-center text-sm font-bold text-[#ec9324] border-t border-l border-gray-200 bg-orange-100/60">
                  {linkedCells}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Footer legend */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center gap-4 text-[11px] text-gray-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 h-4 rounded-full bg-[#ec9324] text-white text-[10px] flex items-center justify-center">
              ✓
            </span>
            Linked
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 h-4 rounded border border-gray-300" />
            Not linked
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Info style={{ fontSize: 14 }} />
            Click any cell to toggle the link. Row / column totals give you instant coverage insight.
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ProCon
          heading="Best for"
          tone="orange"
          items={[
            "QA / bulk-verify mapping between two client taxonomies",
            "Coverage gap analysis (which nodes have zero cross-links?)",
            "Reviewers scanning row/column totals to catch imbalance",
          ]}
        />
        <ProCon
          heading="Not ideal for"
          tone="gray"
          items={[
            "Ad-hoc, one-off linking while inside a normal tree edit",
            "Understanding hierarchy — the parent (Level-1) context is stripped",
          ]}
        />
        <ProCon
          heading="Interaction model"
          tone="blue"
          items={[
            "Row / Column dropdowns pick any 2 segmentations",
            "Click a cell → toggles the link on/off",
            "Row & column totals refresh live",
            "Header pill shows overall coverage % of the grid",
          ]}
        />
      </div>
    </div>
  );
}

// ============================================================
// SHARED — Pro/con card
// ============================================================
function ProCon({ heading, items, tone = "orange" }) {
  const tones = {
    orange: {
      bg: "bg-orange-50/60",
      border: "border-orange-200",
      dot: "text-[#ec9324]",
      icon: <CheckCircle style={{ fontSize: 16 }} className="text-[#ec9324]" />,
      title: "text-[#ec9324]",
    },
    gray: {
      bg: "bg-gray-50",
      border: "border-gray-200",
      dot: "text-gray-500",
      icon: <CancelIcon style={{ fontSize: 16 }} className="text-gray-500" />,
      title: "text-gray-600",
    },
    blue: {
      bg: "bg-sky-50/60",
      border: "border-sky-200",
      dot: "text-sky-600",
      icon: <Info style={{ fontSize: 16 }} className="text-sky-600" />,
      title: "text-sky-700",
    },
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
            <span className={`${tones.dot} mt-0.5`}>•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
