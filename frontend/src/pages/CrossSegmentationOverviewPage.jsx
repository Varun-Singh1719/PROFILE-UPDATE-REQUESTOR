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

// ============================================================
export default function CrossSegmentationOverviewPage() {
  const meta = useOverviewMeta();
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [segContacts, setSegContacts] = useState({ counts: {}, contacts: {} });

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

  const leftNames = data?.infollion?.level1 || [];
  const rightNames = data?.client_level1 || [];

  const realMappings = data?.mappings || {};
  const hasReal = Object.keys(realMappings).some((k) => (realMappings[k] || []).length);
  const isDummy = !hasReal && (clientName || "").toLowerCase() === BCG_NAME.toLowerCase();
  const mappings = hasReal ? realMappings : (isDummy ? buildDummyMappings(leftNames, rightNames) : {});

  const totalMappings = useMemo(() => {
    let n = 0;
    Object.entries(mappings || {}).forEach(([l, targets]) => {
      (targets || []).forEach((r) => {
        if (leftNames.includes(l) && rightNames.includes(r)) n += 1;
      });
    });
    return n;
  }, [mappings, leftNames, rightNames]);

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
        infollionCount={leftNames.length}
        clientCount={rightNames.length}
        totalMappings={totalMappings}
        loading={loading}
      />
      <div className="flex-1 min-h-0 relative bg-white" data-testid="crm-overview-page">
        <MappingCanvas
          key={clientId + ":" + (hasReal ? "real" : "dummy")}
          loading={loading}
          baseName={data?.infollion?.name || BASE_NAME}
          clientName={clientName}
          leftNames={leftNames}
          rightNames={rightNames}
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
  leftNames, rightNames, mappings, segContacts, infollionExists,
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
  const { leftNodes, rightNodes, ribbons } = useMemo(() => {
    const ln = leftNames.map((name, i) => ({ id: `L::${name}`, name, side: "L", i }));
    const rn = rightNames.map((name, i) => ({ id: `R::${name}`, name, side: "R", i }));
    const rb = [];
    Object.entries(mappings || {}).forEach(([lName, targets]) => {
      (targets || []).forEach((rName) => {
        if (leftNames.includes(lName) && rightNames.includes(rName)) {
          rb.push({ srcId: `L::${lName}`, tgtId: `R::${rName}`, srcName: lName, tgtName: rName });
        }
      });
    });
    return { leftNodes: ln, rightNodes: rn, ribbons: rb };
  }, [leftNames, rightNames, mappings]);

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
  const activeId = hoverId || focusId;
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
          onClick={() => setFocusId(null)}
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
              return (
                <g key={n.id} style={{ cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); setFocusId(n.id === focusId ? null : n.id); }}
                  onMouseEnter={() => setHoverId(n.id)}
                  onMouseLeave={() => setHoverId(null)}
                  data-testid={`crm-overview-left-node-${n.i}`}>
                  <rect x={0} y={y - 15} width={baseX + 10} height={30} fill="transparent" />
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
              const cnt = (segContacts?.counts || {})[n.name];
              const hasCnt = cnt != null;
              const nameX = linkedX + 14;
              // rough width estimate so the count pill sits AFTER the name
              const approxNameW = (n.name || "").length * 7.0;
              const pillW = hasCnt ? Math.max(20, 12 + String(cnt).length * 7) : 0;
              const pillX = nameX + approxNameW + 8;
              return (
                <g key={n.id} style={{ cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); setFocusId(n.id === focusId ? null : n.id); }}
                  onMouseEnter={() => setHoverId(n.id)}
                  onMouseLeave={() => setHoverId(null)}
                  data-testid={`crm-overview-right-node-${n.i}`}>
                  <rect x={linkedX - 10} y={y - 15} width={w - linkedX + 10} height={30} fill="transparent" />
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
                  {/* client-contact count badge — shown AFTER the segment name */}
                  {hasCnt && (
                    <g opacity={muted ? 0.45 : 1} data-testid={`crm-overview-count-${n.i}`}>
                      <rect x={pillX} y={y - 8} width={pillW} height={16} rx={8}
                        fill={CLIENT_COLOR} fillOpacity={0.16} stroke={CLIENT_COLOR} strokeOpacity={0.35} strokeWidth={0.75} />
                      <text x={pillX + pillW / 2} y={y + 3.5} textAnchor="middle"
                        fontSize={10.5} fontWeight={800} fill="#6d28d9">{cnt}</text>
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
          className="absolute top-3 right-3 z-10 flex flex-col
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
          onClose={() => setFocusId(null)}
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

  const { contacts, linkedSegs } = useMemo(() => {
    if (!isLeft) {
      return { contacts: bySeg[node.name] || [], linkedSegs: [node.name] };
    }
    const segs = Array.from(new Set(
      ribbons.filter((r) => r.srcId === node.id).map((r) => r.tgtName)
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
          <button onClick={onClose} data-testid="crm-overview-panel-close" className="text-gray-400 hover:text-gray-700 text-xs font-medium">Clear</button>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: dotColor }} />
          <div className="text-lg font-semibold text-gray-900 leading-tight">{node.name}</div>
        </div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          <b className="text-gray-800">{contacts.length}</b> client contact{contacts.length === 1 ? "" : "s"}
          {isLeft && linkedSegs.length > 0 && (
            <span> · across {linkedSegs.length} linked segment{linkedSegs.length === 1 ? "" : "s"}</span>
          )}
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

function SegmentationLinksBar({
  baseName, clientName, clients, clientId, onSelectClient,
  infollionCount, clientCount, totalMappings, loading,
}) {
  return (
    <div
      className="flex-shrink-0 bg-white border-b border-gray-200 px-5 py-3 flex items-center gap-5"
      data-testid="crm-overview-summary-bar"
    >
      {/* eyebrow + title */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="w-9 h-9 rounded-lg bg-[#ec9324]/15 text-[#ec9324] flex items-center justify-center">
          <AccountTree sx={{ fontSize: 20 }} />
        </div>
        <div className="leading-tight">
          <div className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-bold">Cross-Segmentation</div>
          <div className="text-[17px] font-bold text-gray-900">Linked Segmentation</div>
        </div>
      </div>

      {/* divider */}
      <div className="w-px h-9 bg-gray-200 flex-shrink-0" />

      {/* base → client chips */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="inline-flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full bg-gray-50 border border-gray-200">
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0" style={{ background: BASE_COLOR }}>
            {initials(baseName)}
          </span>
          <span className="text-[13px] font-semibold text-gray-900 whitespace-nowrap">{baseName}</span>
        </span>
        <ChevronDown sx={{ fontSize: 18 }} className="text-gray-300 -rotate-90 flex-shrink-0" />
        <span className="inline-flex items-center gap-2 pl-1 pr-1.5 py-1 rounded-full bg-gray-50 border border-gray-200 min-w-0">
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0" style={{ background: CLIENT_COLOR }}>
            {initials(clientName)}
          </span>
          <div className="relative flex items-center min-w-0">
            <select
              value={clientId || ""}
              onChange={(e) => onSelectClient(e.target.value)}
              data-testid="crm-overview-client-select"
              className="appearance-none pr-6 text-[13px] font-semibold bg-transparent border-0 p-0 outline-none cursor-pointer text-gray-900 max-w-[240px] truncate"
            >
              {(clients || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <ChevronDown sx={{ fontSize: 18 }} className="absolute right-0 text-gray-400 pointer-events-none" />
          </div>
        </span>
      </div>

      {/* key counts aligned to the right */}
      <div className="ml-auto flex items-center gap-8 pr-1 flex-shrink-0">
        <StatBlock label="Infollion Segments" value={loading ? "—" : infollionCount} />
        <StatBlock label="Client Segments" value={loading ? "—" : clientCount} />
        <StatBlock label="Total Mappings" value={loading ? "—" : totalMappings} />
      </div>
    </div>
  );
}
