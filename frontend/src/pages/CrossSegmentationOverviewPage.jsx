/**
 * CrossSegmentationOverviewPage — CRM → Dynamic "Overview" tab.
 * =========================================================================
 * READ-ONLY, full-page, side-by-side visual mapping between:
 *   • LEFT  — Infollion Research  (always the master / base segmentation)
 *   • RIGHT — the selected client (default: Boston Consulting Group)
 *
 * Data is driven ENTIRELY by the mappings created under
 * CRM → Clients → Link Segmentation (GET /api/clients/{id}/segmentation-link).
 * When a client has no saved mappings yet, realistic DUMMY mappings are shown
 * for Boston Consulting Group only, replaced automatically by the real
 * mappings once any are saved.
 *
 * Layout mirrors the CRM Segmentations tree page: the whole viewport below the
 * top bar is a white canvas, with FLOATING GLASS PANELS overlaid on top —
 * a header (top-left), a vertical zoom toolbar (top-right, same ToolButton
 * hover style as the segmentation tree) and a details panel (bottom-right).
 *
 * The user-facing tab name is dynamic (GET /api/crm/overview/meta).
 * Segment level shown throughout: LEVEL 2 (direct-child categories).
 * =========================================================================
 */
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import * as d3 from "d3";
import Layout from "../components/Layout";
import api, { formatApiError } from "../lib/api";
import notify from "../lib/notify";
import { useOverviewMeta } from "../lib/overviewMeta";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import CenterFocusStrong from "@mui/icons-material/CenterFocusStrong";
import ChevronDown from "@mui/icons-material/KeyboardArrowDown";
import AccountTree from "@mui/icons-material/AccountTreeOutlined";
import CloseIcon from "@mui/icons-material/Close";
import SearchSelect from "../components/SearchSelect";

const BASE_COLOR = "#ec9324";   // Infollion — brand orange
const CLIENT_COLOR = "#8b5cf6"; // client — violet
const BASE_NAME = "Infollion Research";
const BCG_NAME = "Boston Consulting Group";

// ------------------------------------------------------------------
// Glass toolbar button — same visual pattern as the Segmentations tree
// (pill hover target, orange tint on hover, dark tooltip fading in to the
// LEFT of the button).
// ------------------------------------------------------------------
const ToolButton = ({ onClick, icon, label, testid, position }) => {
  const round =
    position === "top" ? "rounded-t-lg" :
    position === "bottom" ? "rounded-b-lg" :
    position === "solo" ? "rounded-lg" : "";
  const divider = position === "bottom" || position === "solo" ? "" : "border-b border-white/50";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testid}
      className={"group relative inline-flex items-center justify-center w-9 h-9 transition-colors text-gray-700 hover:text-[#ec9324] hover:bg-white/60 " + round + " " + divider}
    >
      {icon}
      <span className="pointer-events-none absolute right-full mr-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 shadow-lg">
        {label}
      </span>
    </button>
  );
};

// ------------------------------------------------------------------
// Dummy-mapping generator (Boston Consulting Group only).
// ------------------------------------------------------------------
const THEME_MAP = [
  { l: /agricultur/i, r: [/consumer products/i, /industrial/i] },
  { l: /automotive|mobility|vehicle/i, r: [/automotive/i] },
  { l: /bfsi|bank|financ/i, r: [/financial/i, /insurance/i, /private equity|investor|principal/i] },
  { l: /chemical/i, r: [/industrial/i] },
  { l: /commercial|professional service|consulting/i, r: [/public sector/i, /industrial/i] },
  { l: /consumer discretionary/i, r: [/consumer products/i, /retail/i] },
  { l: /consumer durable/i, r: [/consumer products/i] },
  { l: /fmcg|non-durable/i, r: [/consumer products/i] },
  { l: /staples|food|beverage/i, r: [/consumer products/i] },
  { l: /education/i, r: [/education/i] },
  { l: /engineering|capital goods/i, r: [/industrial/i] },
  { l: /healthcare/i, r: [/healthcare/i] },
  { l: /information technology|software/i, r: [/technology/i] },
  { l: /life science|pharma|biotech/i, r: [/healthcare/i] },
  { l: /logistic/i, r: [/transport|logistics/i] },
  { l: /materials/i, r: [/industrial/i] },
  { l: /media|entertainment/i, r: [/technology/i] },
  { l: /metal|mining/i, r: [/industrial/i, /energy/i] },
  { l: /oil|gas/i, r: [/energy/i] },
  { l: /public sector|social service/i, r: [/public sector/i] },
  { l: /utilit|infrastructure|power/i, r: [/energy/i, /urban/i] },
  { l: /real estate/i, r: [/urban/i] },
  { l: /retail|ecommerce|e-commerce/i, r: [/retail/i] },
  { l: /semiconductor/i, r: [/technology/i] },
  { l: /telecom/i, r: [/technology/i] },
];

function buildDummyMappings(leftNames, rightNames) {
  const out = {};
  (leftNames || []).forEach((ln) => {
    const theme = THEME_MAP.find((t) => t.l.test(ln));
    if (!theme) return;
    const targets = (rightNames || []).filter((rn) => theme.r.some((re) => re.test(rn)));
    if (targets.length) out[ln] = Array.from(new Set(targets));
  });
  return out;
}

// ------------------------------------------------------------------
// Level helpers (shared by the page + the mapping canvas).
// Level numbering is USER-FACING: Level 1 = the root/name itself,
// Level 2 = its direct children (the default view), Level 3 = grandchildren.
// The backend `levels` payload only carries Level 2 downward.
// ------------------------------------------------------------------

// Available level options for a side, always Level 2 → max_level.
// Returns [] when the segmentation has no Level-2 nodes at all.
function levelOptions(levels) {
  const max = Number(levels?.max_level || 1);
  if (max < 2) return [];
  const out = [];
  for (let l = 2; l <= max; l += 1) out.push(l);
  return out;
}

// Node items ({ name, path, l2 }) for the chosen level on a side.
// Falls back to the flat Level-2 name list when the richer `levels`
// payload is missing (older backend / safety).
function levelItems(levels, level, fallbackL2Names) {
  const byLevel = levels?.nodes || null;
  if (byLevel) {
    const arr = byLevel[String(level)] || [];
    return arr.map((n) => ({ name: n.name, path: n.path || n.name, l2: n.l2 || n.name }));
  }
  return (fallbackL2Names || []).map((nm) => ({ name: nm, path: nm, l2: nm }));
}

// Project the Level-2 mappings down onto whatever levels are displayed:
// a left item connects to a right item when the left item's Level-2 ancestor
// is mapped to the right item's Level-2 ancestor. At Level 2 on both sides
// this reduces to the original name-to-name mapping.
function computeRibbons(leftItems, rightItems, mappings) {
  const rb = [];
  (leftItems || []).forEach((li) => {
    const targets = (mappings || {})[li.l2] || [];
    if (!targets.length) return;
    const tset = new Set(targets);
    (rightItems || []).forEach((ri) => {
      if (tset.has(ri.l2)) {
        rb.push({
          srcId: `L::${li.path}`, tgtId: `R::${ri.path}`,
          srcName: li.name, tgtName: ri.name,
          srcL2: li.l2, tgtL2: ri.l2,
        });
      }
    });
  });
  return rb;
}

// ============================================================
export default function CrossSegmentationOverviewPage() {
  const meta = useOverviewMeta();
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [segContacts, setSegContacts] = useState({ counts: {}, contacts: {} });
  // Selected display level per side (user-facing; 2 = direct children = default)
  const [leftLevel, setLeftLevel] = useState(2);
  const [rightLevel, setRightLevel] = useState(2);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get("/clients", { params: { page_size: 200, sort: "name_asc" } });
        if (!alive) return;
        const rows = data?.rows || [];
        setClients(rows);
        const bcg = rows.find((c) => (c.name || "").toLowerCase() === BCG_NAME.toLowerCase());
        setClientId(bcg?.id || rows[0]?.id || null);
      } catch (e) {
        notify.error(formatApiError(e, "Failed to load clients"));
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const { data } = await api.get(`/clients/${clientId}/segmentation-link`);
        if (alive) setData(data);
      } catch (e) {
        if (alive) notify.error(formatApiError(e, "Failed to load segmentation mapping"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [clientId]);

  const client = clients.find((c) => c.id === clientId) || null;
  const clientName = data?.client?.name || client?.name || "Selected Client";

  // client contacts grouped by their mapped Level-2 segment
  useEffect(() => {
    if (!clientName || clientName === "Selected Client") return;
    let alive = true;
    api.get("/crm/overview/segment-contacts", { params: { client_name: clientName } })
      .then(({ data }) => { if (alive) setSegContacts(data || { counts: {}, contacts: {} }); })
      .catch(() => { if (alive) setSegContacts({ counts: {}, contacts: {} }); });
    return () => { alive = false; };
  }, [clientName]);

  const leftNames = data?.infollion?.level1 || [];   // Infollion Level-2 names
  const rightNames = data?.client_level1 || [];       // client Level-2 names

  const infollionLevels = data?.infollion?.levels || null;
  const clientLevels = data?.client_levels || null;

  // Level dropdown options for each side (Level 2 → that side's max depth).
  const leftLevelOpts = useMemo(() => levelOptions(infollionLevels), [infollionLevels]);
  const rightLevelOpts = useMemo(() => levelOptions(clientLevels), [clientLevels]);

  // Whenever the loaded segmentation changes, reset both sides to the default
  // Level 2 (the direct-child view).
  useEffect(() => {
    setLeftLevel(2);
    setRightLevel(2);
  }, [infollionLevels, clientLevels]);

  const realMappings = data?.mappings || {};
  const hasReal = Object.keys(realMappings).some((k) => (realMappings[k] || []).length);
  const isDummy = !hasReal && (clientName || "").toLowerCase() === BCG_NAME.toLowerCase();
  const mappings = hasReal ? realMappings : (isDummy ? buildDummyMappings(leftNames, rightNames) : {});

  // Node items for the currently-selected level on each side.
  const leftItems = useMemo(
    () => levelItems(infollionLevels, leftLevel, leftNames),
    [infollionLevels, leftLevel, leftNames],
  );
  const rightItems = useMemo(
    () => levelItems(clientLevels, rightLevel, rightNames),
    [clientLevels, rightLevel, rightNames],
  );

  const totalMappings = useMemo(
    () => computeRibbons(leftItems, rightItems, mappings).length,
    [leftItems, rightItems, mappings],
  );

  return (
    <Layout
      title={meta?.tab_name || "Overview"}
      fullBleed
      contentClassName="h-[calc(100vh-56px)] flex flex-col"
    >
      {/* Full-width summary bar between the top bar and the mapping canvas */}
      <SegmentationLinksBar
        baseName={data?.infollion?.name || BASE_NAME}
        clientName={clientName}
        clients={clients}
        clientId={clientId}
        onSelectClient={setClientId}
        infollionCount={leftItems.length}
        clientCount={rightItems.length}
        totalMappings={totalMappings}
        loading={loading}
        leftLevel={leftLevel}
        rightLevel={rightLevel}
        leftLevelOpts={leftLevelOpts}
        rightLevelOpts={rightLevelOpts}
        onLeftLevel={setLeftLevel}
        onRightLevel={setRightLevel}
      />
      <div className="flex-1 min-h-0 relative bg-white" data-testid="crm-overview-page">
        <MappingCanvas
          key={clientId + ":" + (hasReal ? "real" : "dummy") + ":" + leftLevel + ":" + rightLevel}
          loading={loading}
          baseName={data?.infollion?.name || BASE_NAME}
          clientName={clientName}
          leftItems={leftItems}
          rightItems={rightItems}
          mappings={mappings}
          segContacts={segContacts}
          infollionExists={data?.infollion?.exists !== false}
        />
      </div>
    </Layout>
  );
}

// ============================================================
// Full-page mapping canvas — SVG ribbons + d3 zoom/pan/fit + floating panels
// ============================================================
function MappingCanvas({
  loading, baseName, clientName,
  leftItems, rightItems, mappings, segContacts, infollionExists,
}) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const gRef = useRef(null);
  const zoomRef = useRef(null);
  const layoutRef = useRef({ w: 1100, h: 700, contentH: 700 });

  const [dims, setDims] = useState({ w: 1100, h: 700 });
  const [focusId, setFocusId] = useState(null);
  const [hoverId, setHoverId] = useState(null);

  // ----- nodes + ribbons -----
  // Nodes are keyed by their unique path (names can repeat across parents at
  // deeper levels). Ribbons are projected from the Level-2 mappings via each
  // node's Level-2 ancestor (`l2`).
  const { leftNodes, rightNodes, ribbons } = useMemo(() => {
    const ln = (leftItems || []).map((it, i) => ({ id: `L::${it.path}`, name: it.name, l2: it.l2, side: "L", i }));
    const rn = (rightItems || []).map((it, i) => ({ id: `R::${it.path}`, name: it.name, l2: it.l2, side: "R", i }));
    const rb = computeRibbons(leftItems, rightItems, mappings);
    return { leftNodes: ln, rightNodes: rn, ribbons: rb };
  }, [leftItems, rightItems, mappings]);

  // ----- geometry -----
  const geom = useMemo(() => {
    const w = dims.w || 1100;
    const rowH = 30;
    const padTop = 56;
    const padBot = 30;
    const maxRows = Math.max(leftNodes.length, rightNodes.length, 1);
    const contentH = padTop + maxRows * rowH + padBot;
    const baseX = Math.round(w * 0.40);
    const linkedX = Math.round(w * 0.60);
    const mid = (baseX + linkedX) / 2;
    const colStart = (n) => (contentH - n * rowH) / 2 + rowH / 2;
    const lStart = colStart(leftNodes.length);
    const rStart = colStart(rightNodes.length);
    const leftY = {}; leftNodes.forEach((n) => { leftY[n.id] = lStart + n.i * rowH; });
    const rightY = {}; rightNodes.forEach((n) => { rightY[n.id] = rStart + n.i * rowH; });
    return { w, contentH, baseX, linkedX, mid, leftY, rightY, rowH };
  }, [dims.w, leftNodes, rightNodes]);

  // ----- measure container -----
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setDims({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ----- fit-to-screen (matches CRM tree fit behavior) -----
  const applyFit = useCallback((animate = true) => {
    if (!svgRef.current || !zoomRef.current) return;
    const { w, h, contentH } = layoutRef.current;
    const k = Math.min(1.4, Math.max(0.3, (h - 16) / contentH));
    const tx = (w - w * k) / 2;
    const ty = (h - contentH * k) / 2;
    const t = d3.zoomIdentity.translate(tx, ty).scale(k);
    const sel = d3.select(svgRef.current);
    (animate ? sel.transition().duration(400).ease(d3.easeCubicOut) : sel)
      .call(zoomRef.current.transform, t);
  }, []);

  useEffect(() => {
    layoutRef.current = { w: dims.w, h: dims.h, contentH: geom.contentH };
  }, [dims, geom.contentH]);

  // ----- attach d3.zoom once svg is mounted (cursor-centric wheel + pan) -----
  useEffect(() => {
    if (loading || !infollionExists) return;
    if (!svgRef.current || !gRef.current) return;
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);
    const zoom = d3.zoom()
      .scaleExtent([0.3, 4])
      .filter((event) => (event.type === "wheel" ? true : !event.button))
      .on("zoom", (event) => { g.attr("transform", event.transform.toString()); });
    zoomRef.current = zoom;
    svg.call(zoom).on("dblclick.zoom", null);
    return () => { svg.on(".zoom", null); zoomRef.current = null; };
  }, [loading, infollionExists]);

  useEffect(() => {
    if (loading || !infollionExists) return;
    const id = setTimeout(() => applyFit(false), 80);
    return () => clearTimeout(id);
  }, [applyFit, dims.w, dims.h, geom.contentH, leftNodes.length, rightNodes.length, loading, infollionExists]);

  const zoomBy = (factor) => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(180).ease(d3.easeCubicOut)
      .call(zoomRef.current.scaleBy, factor);
  };

  // ----- highlight logic -----
  // Selection FREEZES the view: once a segment is focused, hover is ignored
  // (focusId wins). Hover only drives highlighting when nothing is selected.
  const activeId = focusId || hoverId;

  // Clearing the selection must INSTANTLY restore the default view — reset both
  // the frozen selection AND any stale hover state on the same click, so the
  // visualization does not wait for a subsequent mousemove/hover to redraw.
  const clearSelection = useCallback(() => {
    setFocusId(null);
    setHoverId(null);
  }, []);

  const relatedIds = useMemo(() => {
    if (!activeId) return null;
    const s = new Set([activeId]);
    ribbons.forEach((r) => {
      if (r.srcId === activeId || r.tgtId === activeId) { s.add(r.srcId); s.add(r.tgtId); }
    });
    return s;
  }, [activeId, ribbons]);

  const isHi = (r) => activeId && (r.srcId === activeId || r.tgtId === activeId);

  const focusedNode = useMemo(() => {
    if (!focusId) return null;
    return [...leftNodes, ...rightNodes].find((n) => n.id === focusId) || null;
  }, [focusId, leftNodes, rightNodes]);

  const { w, baseX, linkedX, mid, leftY, rightY } = geom;

  return (
    <div ref={wrapRef} className="w-full h-full overflow-hidden bg-white relative" data-testid="crm-overview-canvas">
      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">Loading mapping…</div>
      ) : !infollionExists ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 px-6 text-center">
          The master “Infollion Research” segmentation was not found.
        </div>
      ) : (
        <svg
          ref={svgRef}
          width={dims.w}
          height={dims.h}
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          className="block cursor-grab active:cursor-grabbing"
          style={{ font: "13px Inter, system-ui, sans-serif" }}
          data-testid="crm-overview-svg"
          onClick={() => clearSelection()}
        >
          <defs>
            <linearGradient id="ov-ribbon" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor={BASE_COLOR} stopOpacity={0.95} />
              <stop offset="100%" stopColor={CLIENT_COLOR} stopOpacity={0.95} />
            </linearGradient>
          </defs>

          <g ref={gRef}>
            {/* column headers */}
            <text x={baseX} y={30} textAnchor="end" fontSize={11} fontWeight={700} fill="#9ca3af" style={{ letterSpacing: 1 }}>
              {baseName.toUpperCase()}
            </text>
            <text x={linkedX} y={30} textAnchor="start" fontSize={11} fontWeight={700} fill="#9ca3af" style={{ letterSpacing: 1 }}>
              {clientName.toUpperCase()}
            </text>

            {/* ribbons */}
            {ribbons.slice().sort((a, b) => (isHi(a) ? 1 : 0) - (isHi(b) ? 1 : 0)).map((r) => {
              const y1 = leftY[r.srcId];
              const y2 = rightY[r.tgtId];
              if (y1 == null || y2 == null) return null;
              const hi = isHi(r);
              const path = `M ${baseX + 10},${y1} C ${mid},${y1} ${mid},${y2} ${linkedX - 10},${y2}`;
              return (
                <path
                  key={`${r.srcId}__${r.tgtId}`}
                  d={path}
                  fill="none"
                  stroke="url(#ov-ribbon)"
                  strokeWidth={hi ? 6 : 3.5}
                  strokeLinecap="round"
                  opacity={activeId ? (hi ? 0.92 : 0.08) : 0.45}
                  style={{ transition: "opacity .18s, stroke-width .18s" }}
                />
              );
            })}

            {/* LEFT nodes */}
            {leftNodes.map((n) => {
              const y = leftY[n.id];
              const hasLink = ribbons.some((r) => r.srcId === n.id);
              const isFocus = focusId === n.id;
              const muted = activeId && relatedIds && !relatedIds.has(n.id);
              // Tight hit area around the dot + label ONLY (no full-row band),
              // so blank space / margins neither hover-highlight nor select.
              const approxW = (n.name || "").length * 7.2;
              const hitX = baseX - 18 - approxW;
              const hitW = approxW + 32;
              return (
                <g key={n.id} style={{ cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); setFocusId(n.id === focusId ? null : n.id); }}
                  onMouseEnter={() => { if (!focusId) setHoverId(n.id); }}
                  onMouseLeave={() => { if (!focusId) setHoverId(null); }}
                  data-testid={`crm-overview-left-node-${n.i}`}>
                  <rect x={hitX} y={y - 13} width={hitW} height={26} fill="transparent" />
                  <text x={baseX - 14} y={y + 4} textAnchor="end" fontSize={13}
                    fontWeight={isFocus ? 700 : hasLink ? 600 : 500}
                    fill={isFocus ? "#111827" : muted ? "#9ca3af" : "#374151"}
                    opacity={muted ? 0.55 : 1}>
                    {n.name}
                  </text>
                  <circle cx={baseX} cy={y} r={isFocus ? 7 : 5}
                    fill={hasLink || isFocus ? BASE_COLOR : "#e5e7eb"}
                    opacity={muted ? 0.5 : 1}
                    stroke={isFocus ? "#fff" : "none"} strokeWidth={isFocus ? 2 : 0} />
                  {isFocus && <circle cx={baseX} cy={y} r={12} fill="none" stroke={BASE_COLOR} strokeWidth={2} opacity={0.4} />}
                </g>
              );
            })}

            {/* RIGHT nodes */}
            {rightNodes.map((n) => {
              const y = rightY[n.id];
              const hasLink = ribbons.some((r) => r.tgtId === n.id);
              const isFocus = focusId === n.id;
              const muted = activeId && relatedIds && !relatedIds.has(n.id);
              const cnt = (segContacts?.counts || {})[n.l2];
              const hasCnt = cnt != null;
              const nameX = linkedX + 14;
              // rough width estimate so the count pill sits AFTER the name
              const approxNameW = (n.name || "").length * 7.2;
              const pillW = hasCnt ? Math.max(20, 12 + String(cnt).length * 7) : 0;
              const pillX = nameX + approxNameW + 8;
              // Tight hit area around dot + label (+ count pill) ONLY.
              const hitRight = hasCnt ? (pillX + pillW) : (nameX + approxNameW);
              const hitX = linkedX - 12;
              const hitW = hitRight - hitX + 6;
              return (
                <g key={n.id} style={{ cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); setFocusId(n.id === focusId ? null : n.id); }}
                  onMouseEnter={() => { if (!focusId) setHoverId(n.id); }}
                  onMouseLeave={() => { if (!focusId) setHoverId(null); }}
                  data-testid={`crm-overview-right-node-${n.i}`}>
                  <rect x={hitX} y={y - 13} width={hitW} height={26} fill="transparent" />
                  <circle cx={linkedX} cy={y} r={isFocus ? 7 : 5}
                    fill={hasLink || isFocus ? CLIENT_COLOR : "#e5e7eb"}
                    opacity={muted ? 0.5 : 1}
                    stroke={isFocus ? "#fff" : "none"} strokeWidth={isFocus ? 2 : 0} />
                  {isFocus && <circle cx={linkedX} cy={y} r={12} fill="none" stroke={CLIENT_COLOR} strokeWidth={2} opacity={0.4} />}
                  {/* segment name */}
                  <text x={nameX} y={y + 4} textAnchor="start" fontSize={13}
                    fontWeight={isFocus ? 700 : hasLink ? 600 : 500}
                    fill={isFocus ? "#111827" : muted ? "#9ca3af" : "#374151"}
                    opacity={muted ? 0.55 : 1}>
                    {n.name}
                  </text>
                  {/* client-contact count badge — purple bg + white text (matches contact initials) */}
                  {hasCnt && (
                    <g opacity={muted ? 0.45 : 1} data-testid={`crm-overview-count-${n.i}`}>
                      <rect x={pillX} y={y - 8} width={pillW} height={16} rx={8} fill="#7c3aed" />
                      <text x={pillX + pillW / 2} y={y + 3.5} textAnchor="middle"
                        fontSize={10.5} fontWeight={800} fill="#ffffff">{cnt}</text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      )}

      {/* ---- Floating glass ZOOM TOOLBAR (top-right) ---- */}
      {!loading && infollionExists && (
        <div
          className="absolute top-3 right-3 z-30 flex flex-col
                     bg-white/40 backdrop-blur-xl backdrop-saturate-150
                     border border-white/70 ring-1 ring-black/5
                     rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.10)]"
          data-testid="crm-overview-toolbar"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <ToolButton onClick={() => zoomBy(1.3)} icon={<ZoomInIcon sx={{ fontSize: 18 }} />} label="Zoom in" testid="crm-overview-zoom-in" position="top" />
          <ToolButton onClick={() => zoomBy(1 / 1.3)} icon={<ZoomOutIcon sx={{ fontSize: 18 }} />} label="Zoom out" testid="crm-overview-zoom-out" position="middle" />
          <ToolButton onClick={() => applyFit(true)} icon={<CenterFocusStrong sx={{ fontSize: 18 }} />} label="Fit to screen" testid="crm-overview-fit" position="bottom" />
        </div>
      )}

      {/* ---- "Selected Segment" popup ---- */}
      {focusedNode && (
        <SegmentModal
          node={focusedNode}
          ribbons={ribbons}
          segContacts={segContacts}
          onClose={() => clearSelection()}
        />
      )}

      {/* empty hint */}
      {!loading && infollionExists && ribbons.length === 0 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-gray-400 bg-white/80 rounded-full px-3 py-1 border border-gray-100">
          No mappings yet — create them under CRM → Clients → Link Segmentation.
        </div>
      )}
    </div>
  );
}

// ============================================================
// "Selected Segment" panel — floating in the corner (same as before),
// now listing the segment's client contacts.
// ============================================================
function SegmentModal({ node, ribbons, segContacts, onClose }) {
  const isLeft = node.side === "L";
  const dotColor = isLeft ? BASE_COLOR : CLIENT_COLOR;
  const bySeg = segContacts?.contacts || {};

  const { contacts } = useMemo(() => {
    // Client contacts are grouped by their Level-2 segment. For a right-side
    // node we look up by its Level-2 ancestor (`l2`); at Level 2 this is the
    // node itself. For a left-side node we gather the Level-2 segments its
    // (projected) ribbons land on.
    if (!isLeft) {
      const key = node.l2 || node.name;
      return { contacts: bySeg[key] || [], linkedSegs: [key] };
    }
    const segs = Array.from(new Set(
      ribbons.filter((r) => r.srcId === node.id).map((r) => r.tgtL2 || r.tgtName)
    ));
    const seen = new Set();
    const list = [];
    segs.forEach((s) => (bySeg[s] || []).forEach((c) => {
      if (!seen.has(c.id)) { seen.add(c.id); list.push(c); }
    }));
    list.sort((a, b) => (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase()));
    return { contacts: list, linkedSegs: segs };
  }, [isLeft, node, ribbons, bySeg]);

  return (
    <div
      className="absolute top-3 right-16 z-20 w-[300px] max-h-[calc(100%-24px)] bg-white rounded-xl border border-orange-200 shadow-[0_12px_32px_rgba(0,0,0,0.16)] flex flex-col overflow-hidden"
      data-testid="crm-overview-info-panel"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-start justify-between">
          <div className="text-[10px] uppercase tracking-wider text-[#ec9324] font-bold">Selected Segment</div>
          <button
            type="button"
            onClick={onClose}
            data-testid="crm-overview-panel-close"
            aria-label="Close"
            title="Close"
            className="group relative inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-500 hover:text-[#ec9324] hover:bg-white/60 transition-colors -mt-0.5 -mr-1"
          >
            <CloseIcon sx={{ fontSize: 16 }} />
            <span className="pointer-events-none absolute right-full mr-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-900 text-white text-[11px] font-medium rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 shadow-lg">
              Close
            </span>
          </button>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: dotColor }} />
          <div className="text-lg font-semibold text-gray-900 leading-tight">{node.name}</div>
        </div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          Client Contact : <b className="text-gray-800">{contacts.length}</b>
        </div>
      </div>

      {/* contact list */}
      <div className="flex-1 overflow-y-auto px-2 py-1.5 min-h-0">
        {contacts.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-gray-400 italic">
            No client contacts mapped to this segment yet.
          </div>
        ) : (
          <ul className="space-y-0.5">
            {contacts.map((c) => (
              <li key={c.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-50">
                <span className="w-7 h-7 rounded-full bg-violet-600 text-white flex items-center justify-center flex-shrink-0 text-[10px] font-bold">
                  {(c.name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-gray-900 truncate">{c.name}</div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {[c.designation, c.base_location].filter(Boolean).join(" · ") || c.email || "—"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}


// ============================================================
// Full-width summary bar shown BETWEEN the top bar and the mapping canvas.
// Layout mirrors the reference: eyebrow + title on the left, the
// Infollion → client chips in the middle (with the working client selector),
// and the three key counts aligned to the right.
// ============================================================
function initials(name) {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function StatBlock({ label, value }) {
  return (
    <div className="leading-tight">
      <div className="text-[9px] uppercase tracking-[0.1em] text-gray-400 font-bold whitespace-nowrap">{label}</div>
      <div className="text-[18px] font-bold text-gray-900">{value}</div>
    </div>
  );
}

// Small level chooser rendered next to each segmentation chip.
// `options` is a list of user-facing level numbers (Level 2 → max depth).
// When only one level exists it renders disabled (nothing else to pick).
function LevelSelect({ value, options, onChange, accent, testid, ariaLabel }) {
  const opts = options && options.length ? options : [2];
  const disabled = opts.length <= 1;
  return (
    <div className="relative flex-shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        aria-label={ariaLabel}
        data-testid={testid}
        className={
          "appearance-none cursor-pointer disabled:cursor-default " +
          "text-[12px] font-semibold text-gray-700 " +
          "bg-white border border-gray-200 rounded-full " +
          "pl-2.5 pr-6 py-1 leading-tight " +
          "hover:border-gray-300 focus:outline-none focus:ring-2 " +
          "disabled:bg-gray-50 disabled:text-gray-500"
        }
        style={{ boxShadow: `inset 0 0 0 1px ${accent}22` }}
        title={disabled ? "Only Level 2 exists in this segmentation" : "Choose level"}
      >
        {opts.map((l) => (
          <option key={l} value={l}>{`Level ${l}`}</option>
        ))}
      </select>
      <ChevronDown
        sx={{ fontSize: 15 }}
        className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400"
      />
    </div>
  );
}

function SegmentationLinksBar({
  baseName, clientName, clients, clientId, onSelectClient,
  infollionCount, clientCount, totalMappings, loading,
  leftLevel, rightLevel, leftLevelOpts, rightLevelOpts, onLeftLevel, onRightLevel,
}) {
  return (
    <div
      className="flex-shrink-0 bg-white border-b border-gray-200 px-3 sm:px-5 py-2.5 sm:py-3 flex flex-wrap items-center gap-x-3 sm:gap-x-5 gap-y-2"
      data-testid="crm-overview-summary-bar"
    >
      {/* eyebrow + title */}
      <div className="flex items-center gap-2.5 sm:gap-3 flex-shrink-0">
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-[#ec9324]/15 text-[#ec9324] flex items-center justify-center">
          <AccountTree sx={{ fontSize: 20 }} />
        </div>
        <div className="leading-tight">
          <div className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-bold">Cross-Segmentation</div>
          <div className="text-[15px] sm:text-[17px] font-bold text-gray-900">Linked Segmentation</div>
        </div>
      </div>

      {/* divider */}
      <div className="hidden md:block w-px h-9 bg-gray-200 flex-shrink-0" />

      {/* base → client chips (each followed by a Level chooser) */}
      <div className="flex items-center gap-2 min-w-0 flex-1 sm:flex-initial flex-wrap">
        <span className="inline-flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full bg-gray-50 border border-gray-200 min-w-0">
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0" style={{ background: BASE_COLOR }}>
            {initials(baseName)}
          </span>
          <span className="text-[13px] font-semibold text-gray-900 truncate max-w-[100px] sm:max-w-none">{baseName}</span>
        </span>
        <LevelSelect
          value={leftLevel}
          options={leftLevelOpts}
          onChange={onLeftLevel}
          accent={BASE_COLOR}
          testid="crm-overview-left-level"
          ariaLabel="Infollion Research level"
        />
        <ChevronDown sx={{ fontSize: 18 }} className="text-gray-300 -rotate-90 flex-shrink-0" />
        <span className="inline-flex items-center gap-2 min-w-0">
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0" style={{ background: CLIENT_COLOR }}>
            {initials(clientName)}
          </span>
          <div
            className="flex-shrink-0"
            style={{ width: Math.min(360, Math.max(180, (clientName || "").length * 8 + 72)) }}
          >
            <SearchSelect
              options={(clients || []).map((c) => ({ value: c.id, label: c.name }))}
              value={clientId || ""}
              onChange={(v) => onSelectClient(v)}
              placeholder="Select client…"
              size="sm"
              allowClear={false}
              loading={loading && (clients || []).length === 0}
              textClass="text-[13px] font-semibold"
              testId="crm-overview-client-select"
            />
          </div>
        </span>
        <LevelSelect
          value={rightLevel}
          options={rightLevelOpts}
          onChange={onRightLevel}
          accent={CLIENT_COLOR}
          testid="crm-overview-right-level"
          ariaLabel="Client level"
        />
      </div>

      {/* key counts — reflow to their own line on small screens */}
      <div className="w-full md:w-auto md:ml-auto flex items-center gap-5 sm:gap-8 pr-1 flex-shrink-0 overflow-x-auto">
        <StatBlock label="Infollion Segments" value={loading ? "—" : infollionCount} />
        <StatBlock label="Client Segments" value={loading ? "—" : clientCount} />
        <StatBlock label="Total Mappings" value={loading ? "—" : totalMappings} />
      </div>
    </div>
  );
}
