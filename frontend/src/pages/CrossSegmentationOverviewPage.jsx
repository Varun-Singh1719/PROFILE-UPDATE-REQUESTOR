/**
 * CrossSegmentationOverviewPage — CRM → Dynamic "Overview" tab.
 * =========================================================================
 * A READ-ONLY, side-by-side visual mapping between:
 *   • LEFT  — Infollion Research  (always the master / base segmentation)
 *   • RIGHT — the selected client (default: Boston Consulting Group)
 *
 * Data is driven ENTIRELY by the mappings created under
 * CRM → Clients → Link Segmentation (GET /api/clients/{id}/segmentation-link).
 * When a client has no saved mappings yet, realistic DUMMY mappings are shown
 * for Boston Consulting Group only, and they are automatically replaced by the
 * real mappings once any are saved.
 *
 * The user-facing tab name is dynamic (GET /api/crm/overview/meta) so it can
 * be renamed with zero code changes.
 *
 * Segment level shown throughout: LEVEL 2 (the direct-child categories of each
 * segmentation), matching the Cross-Segmentation Level-2 reference design.
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
import ZoomIn from "@mui/icons-material/ZoomInOutlined";
import ZoomOut from "@mui/icons-material/ZoomOutOutlined";
import CenterFocusStrong from "@mui/icons-material/CenterFocusStrongOutlined";
import Fullscreen from "@mui/icons-material/FullscreenOutlined";
import ChevronDown from "@mui/icons-material/KeyboardArrowDown";
import ArrowInward from "@mui/icons-material/SouthEastOutlined";
import ArrowOutward from "@mui/icons-material/NorthEastOutlined";

const BASE_COLOR = "#ec9324";   // Infollion — brand orange
const CLIENT_COLOR = "#8b5cf6"; // client — violet
const BASE_NAME = "Infollion Research";
const BCG_NAME = "Boston Consulting Group";

// ------------------------------------------------------------------
// Dummy-mapping generator (Boston Consulting Group only).
// Keyword themes connect Infollion L2 → whatever client L2 names exist,
// so ribbons always land on REAL right-hand nodes. Replaced automatically
// the moment real mappings are saved under Link Segmentation.
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
  const tabName = meta?.tab_name || "Overview";

  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null); // segmentation-link payload

  // ---- load client list once (default to Boston Consulting Group) ----
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

  // ---- load mapping payload whenever the selected client changes ----
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

  const leftNames = data?.infollion?.level1 || [];
  const rightNames = data?.client_level1 || [];

  // Real vs dummy mappings.
  const realMappings = data?.mappings || {};
  const hasReal = Object.keys(realMappings).some((k) => (realMappings[k] || []).length);
  const isDummy = !hasReal && (clientName || "").toLowerCase() === BCG_NAME.toLowerCase();
  const mappings = hasReal ? realMappings : (isDummy ? buildDummyMappings(leftNames, rightNames) : {});

  return (
    <Layout
      title={tabName}
      fullBleed
      contentClassName="px-4 py-4"
    >
      <div className="max-w-[1700px] mx-auto" data-testid="crm-overview-page">
        <TopBar
          clientName={clientName}
          clients={clients}
          clientId={clientId}
          onSelectClient={setClientId}
          leftNames={leftNames}
          rightNames={rightNames}
          mappings={mappings}
        />
        <MappingCanvas
          key={clientId + ":" + (hasReal ? "real" : "dummy")}
          loading={loading}
          baseName={data?.infollion?.name || BASE_NAME}
          clientName={clientName}
          leftNames={leftNames}
          rightNames={rightNames}
          mappings={mappings}
          infollionExists={data?.infollion?.exists !== false}
        />
      </div>
    </Layout>
  );
}

// ============================================================
// Top bar — base + linked client + summary cards
// ============================================================
function TopBar({ clientName, clients, clientId, onSelectClient, leftNames, rightNames, mappings }) {
  const totalMappings = useMemo(
    () => Object.values(mappings).reduce((n, arr) => n + (arr || []).length, 0),
    [mappings]
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4" data-testid="crm-overview-topbar">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* left cluster */}
        <div className="flex items-center gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">
              Cross-Segmentation
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <h2 className="text-xl font-semibold text-gray-900">Segmentation Links</h2>
            </div>
          </div>

          <div className="flex items-center gap-2 pl-4 border-l border-gray-200">
            {/* Base — fixed to Infollion Research */}
            <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5">
              <span
                className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold"
                style={{ background: BASE_COLOR }}
              >IR</span>
              <div>
                <div className="text-sm font-semibold text-gray-900">{BASE_NAME}</div>
              </div>
            </div>
            <span className="text-gray-400">›</span>
            {/* Linked client selector */}
            <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5">
              <span
                className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold"
                style={{ background: CLIENT_COLOR }}
              >{(clientName || "?").slice(0, 2).toUpperCase()}</span>
              <div>
                <div className="relative flex items-center">
                  <select
                    value={clientId || ""}
                    onChange={(e) => onSelectClient(e.target.value)}
                    data-testid="crm-overview-client-select"
                    className="appearance-none pr-5 text-sm font-semibold bg-transparent border-0 p-0 outline-none cursor-pointer text-gray-900 max-w-[220px] truncate"
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <ChevronDown sx={{ fontSize: 18 }} className="absolute right-0 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* right cluster: summary cards */}
        <div className="flex items-stretch gap-2.5" data-testid="crm-overview-summary">
          <StatCard label="Infollion Segments" value={leftNames.length} />
          <StatCard label="Client Segments" value={rightNames.length} />
          <StatCard label="Total Mappings" value={totalMappings} />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className={"inline-flex flex-col items-start px-3 py-1.5 rounded-lg border " + (accent ? "bg-orange-50 border-orange-100" : "bg-gray-50 border-gray-100")}>
      <div className={"text-[9px] uppercase tracking-wider font-bold " + (accent ? "text-[#ec9324]" : "text-gray-400")}>
        {label}
      </div>
      <div className="text-lg font-bold text-gray-900 leading-tight">{value}</div>
    </div>
  );
}

// ============================================================
// Mapping canvas — SVG ribbons + d3 zoom/pan/fit + info panel
// ============================================================
function MappingCanvas({ loading, baseName, clientName, leftNames, rightNames, mappings, infollionExists }) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const gRef = useRef(null);
  const zoomRef = useRef(null);
  const layoutRef = useRef({ w: 1100, h: 560, contentH: 560 });

  const [dims, setDims] = useState({ w: 1100, h: 560 });
  const [focusId, setFocusId] = useState(null);
  const [hoverId, setHoverId] = useState(null);

  // ----- build nodes + ribbons -----
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

  // ----- geometry (pixel space; viewBox == measured container size) -----
  const geom = useMemo(() => {
    const w = dims.w || 1100;
    const rowH = 30;
    const padTop = 50;
    const padBot = 26;
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

  // ----- fit-to-screen transform (matches CRM tree fit behavior) -----
  const applyFit = useCallback((animate = true) => {
    if (!svgRef.current || !zoomRef.current) return;
    const { w, h, contentH } = layoutRef.current;
    const k = Math.min(1.4, Math.max(0.3, (h - 12) / contentH));
    const tx = (w - w * k) / 2;
    const ty = (h - contentH * k) / 2;
    const t = d3.zoomIdentity.translate(tx, ty).scale(k);
    const sel = d3.select(svgRef.current);
    (animate ? sel.transition().duration(400).ease(d3.easeCubicOut) : sel)
      .call(zoomRef.current.transform, t);
  }, []);

  // keep layoutRef current for the imperative zoom helpers
  useEffect(() => {
    layoutRef.current = { w: dims.w, h: dims.h, contentH: geom.contentH };
  }, [dims, geom.contentH]);

  // ----- attach d3.zoom (cursor-centric wheel + drag pan) -----
  // Depends on [loading, infollionExists] so it (re)attaches once the <svg>
  // is actually mounted — during the initial load the svg isn't rendered yet.
  useEffect(() => {
    if (loading || !infollionExists) return;
    if (!svgRef.current || !gRef.current) return;
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);
    const zoom = d3.zoom()
      .scaleExtent([0.3, 4])
      .filter((event) => {
        // allow wheel zoom + primary-button drag; ignore right-click
        if (event.type === "wheel") return true;
        return !event.button;
      })
      .on("zoom", (event) => { g.attr("transform", event.transform.toString()); });
    zoomRef.current = zoom;
    svg.call(zoom).on("dblclick.zoom", null);
    return () => { svg.on(".zoom", null); zoomRef.current = null; };
  }, [loading, infollionExists]);

  // initial + on-data fit
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

  const { w, contentH, baseX, linkedX, mid, leftY, rightY } = geom;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" data-testid="crm-overview-canvas">
      {/* zoom toolbar */}
      <div className="px-5 py-2.5 border-b border-gray-100 flex items-center justify-end text-[11px]">
        <div className="inline-flex items-center bg-gray-100 rounded-lg text-gray-600">
          <IconBtn onClick={() => zoomBy(1.3)} title="Zoom in" testid="crm-overview-zoom-in"><ZoomIn style={{ fontSize: 16 }} /></IconBtn>
          <IconBtn onClick={() => zoomBy(1 / 1.3)} title="Zoom out" testid="crm-overview-zoom-out"><ZoomOut style={{ fontSize: 16 }} /></IconBtn>
          <IconBtn onClick={() => applyFit(true)} title="Fit to screen" testid="crm-overview-fit"><CenterFocusStrong style={{ fontSize: 16 }} /></IconBtn>
          <IconBtn onClick={() => applyFit(true)} title="Reset view" testid="crm-overview-reset"><Fullscreen style={{ fontSize: 16 }} /></IconBtn>
        </div>
      </div>

      {/* canvas */}
      <div
        ref={wrapRef}
        className="relative bg-gradient-to-br from-orange-50/30 via-white to-violet-50/30"
        style={{ height: "calc(100vh - 300px)", minHeight: 460 }}
      >
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">Loading mapping…</div>
        ) : !infollionExists ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 px-6 text-center">
            The master “Infollion Research” segmentation was not found.
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${dims.w} ${dims.h}`}
            width={dims.w}
            height={dims.h}
            className="block cursor-grab active:cursor-grabbing"
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
              <text x={baseX} y={26} textAnchor="end" fontSize={11} fontWeight={700} fill="#9ca3af" style={{ letterSpacing: 1 }}>
                {baseName.toUpperCase()}
              </text>
              <text x={linkedX} y={26} textAnchor="start" fontSize={11} fontWeight={700} fill="#9ca3af" style={{ letterSpacing: 1 }}>
                {clientName.toUpperCase()}
              </text>

              {/* ribbons — non-highlighted first, highlighted on top */}
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
                    <text x={linkedX + 14} y={y + 4} textAnchor="start" fontSize={13}
                      fontWeight={isFocus ? 700 : hasLink ? 600 : 500}
                      fill={isFocus ? "#111827" : muted ? "#9ca3af" : "#374151"}
                      opacity={muted ? 0.55 : 1}>
                      {n.name}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        {/* info panel */}
        {focusedNode && (
          <InfoPanel
            node={focusedNode}
            baseName={baseName}
            clientName={clientName}
            ribbons={ribbons}
            onClose={() => setFocusId(null)}
          />
        )}

        {/* empty-mapping hint */}
        {!loading && infollionExists && ribbons.length === 0 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-gray-400 bg-white/80 rounded-full px-3 py-1 border border-gray-100">
            No mappings yet — create them under CRM → Clients → Link Segmentation.
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Info panel (read-only)
// ============================================================
function InfoPanel({ node, baseName, clientName, ribbons, onClose }) {
  const isLeft = node.side === "L";
  const touching = ribbons.filter((r) => r.srcId === node.id || r.tgtId === node.id);
  const linked = touching.map((r) => (isLeft ? r.tgtName : r.srcName));
  const linkedUniq = Array.from(new Set(linked));
  const outgoing = ribbons.filter((r) => r.srcId === node.id).length; // left → right
  const incoming = ribbons.filter((r) => r.tgtId === node.id).length; // right ← left
  const otherLabel = isLeft ? clientName : baseName;
  const dotColor = isLeft ? BASE_COLOR : CLIENT_COLOR;

  return (
    <div className="absolute top-4 right-4 w-[300px] bg-white rounded-xl border border-orange-200 shadow-xl overflow-hidden" data-testid="crm-overview-info-panel">
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-start justify-between">
          <div className="text-[10px] uppercase tracking-wider text-[#ec9324] font-bold">Selected Segment</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xs font-medium">Clear</button>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: dotColor }} />
          <div className="text-lg font-semibold text-gray-900 leading-tight">{node.name}</div>
        </div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          Level 2 · {isLeft ? baseName : clientName}
        </div>
      </div>

      {/* incoming / outgoing */}
      <div className="px-4 pb-2 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-gray-400 font-bold flex items-center gap-1">
            <ArrowOutward sx={{ fontSize: 12 }} /> Outgoing
          </div>
          <div className="text-base font-bold text-gray-900 leading-tight">{outgoing}</div>
        </div>
        <div className="rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-gray-400 font-bold flex items-center gap-1">
            <ArrowInward sx={{ fontSize: 12 }} /> Incoming
          </div>
          <div className="text-base font-bold text-gray-900 leading-tight">{incoming}</div>
        </div>
      </div>

      <div className="px-4 pb-3">
        <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-1.5">
          Linked {otherLabel} segments · {linkedUniq.length}
        </div>
        <div className="space-y-1 max-h-44 overflow-y-auto">
          {linkedUniq.length === 0 ? (
            <div className="text-xs italic text-gray-400">No mapped segments.</div>
          ) : linkedUniq.map((name) => (
            <div key={name} className="flex items-center gap-1.5 text-sm text-gray-800">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: isLeft ? CLIENT_COLOR : BASE_COLOR }} />
              <span className="truncate" title={name}>{name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, title, testid }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      data-testid={testid}
      className="w-8 h-8 flex items-center justify-center hover:bg-white hover:text-gray-900 first:rounded-l-lg last:rounded-r-lg transition-colors"
    >
      {children}
    </button>
  );
}
