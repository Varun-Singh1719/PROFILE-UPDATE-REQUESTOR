import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import Download from "@mui/icons-material/FileDownloadOutlined";
import Upload from "@mui/icons-material/FileUploadOutlined";
import X from "@mui/icons-material/Close";
import ZoomIn from "@mui/icons-material/ZoomIn";
import ZoomOut from "@mui/icons-material/ZoomOut";
import Maximize2 from "@mui/icons-material/OpenInFull";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import Minus from "@mui/icons-material/Remove";
import MoreVertical from "@mui/icons-material/MoreVert";
import Wand2 from "@mui/icons-material/AutoFixHighOutlined";
import MapPin from "@mui/icons-material/PlaceOutlined";
import Trash2 from "@mui/icons-material/DeleteOutlined";
import Square from "@mui/icons-material/CheckBoxOutlineBlank";
import Lasso from "@mui/icons-material/SelectAll";
import Undo2 from "@mui/icons-material/Undo";
import Redo2 from "@mui/icons-material/Redo";
import Maximize from "@mui/icons-material/OpenInFull";
import Settings from "@mui/icons-material/SettingsOutlined";
import Check from "@mui/icons-material/Check";
import Cloud from "@mui/icons-material/CloudOutlined";
import Lock from "@mui/icons-material/LockOutlined";
import Unlock from "@mui/icons-material/LockOpenOutlined";
import History from "@mui/icons-material/HistoryOutlined";
import Activity from "@mui/icons-material/Timeline";
import ArrowLeft from "@mui/icons-material/ArrowBack";
import Save from "@mui/icons-material/SaveOutlined";
import Send from "@mui/icons-material/Send";
import AlertCircle from "@mui/icons-material/ErrorOutlined";
import Grid from "@mui/icons-material/GridOn";
import ChevronsLeft from "@mui/icons-material/KeyboardDoubleArrowLeft";
import ChevronsRight from "@mui/icons-material/KeyboardDoubleArrowRight";
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import api from '../lib/api';
import notify from '../lib/notify';
import { confirm as confirmDialog, prompt as promptDialog } from '../lib/dialog';
import { resolvePdfUrl } from '../lib/pdfUrl';
import Layout from '../components/Layout';
import PublishDialog from '../components/calibration/PublishDialog';
import VersionHistoryPanel from '../components/calibration/VersionHistoryPanel';
import AuditLogPanel from '../components/calibration/AuditLogPanel';
import {
  WorkstationIconSVG,
  WORKSTATION_SEAT_CENTER,
} from '../components/icons/workstationSilhouette';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

// ---------------------------------------------------------------- Bay list
// Ordered list of bay prefixes shown in the calibration side-tool "Bay" picker.
// Extends past the single-letter A–Z range into double-letter AA–AI so
// large floors can address up to 35 bays.
const BAY_LIST = [
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),        // A..Z
  ...Array.from({ length: 9 },  (_, i) => 'A' + String.fromCharCode(65 + i)),  // AA..AI
];

// ---------------------------------------------------------------- Seat icon
// Top-down office-chair silhouette (Option 2) rendered inline so we can use
// a true black stroke around a white fill — required so unmapped /
// "available" seats stay visible on the white floor-plan background.
// The workstation label (A1 / E5 / F2 / …) is anchored to the center of the
// round seat (see WORKSTATION_SEAT_CENTER) rather than the bounding box.
const SeatIcon = ({ size = 10, label, rotation = 0, isSelected = false, isLocked = false, isOverlap = false, isDup = false }) => {
  const glow = isSelected ? 'drop-shadow(0 0 4px #00FF00)' :
               isDup      ? 'drop-shadow(0 0 4px #ef4444)' :
               isOverlap  ? 'drop-shadow(0 0 4px #f59e0b)' : 'none';

  // The selection ring uses green, so when selected we also tint the chair
  // body green so the whole symbol reads as "selected" at a glance.
  const fill   = isSelected ? '#22C55E' : '#FFFFFF';
  const stroke = '#000000';

  // Label font size: scale with the icon, but auto-shrink for 3+ char labels
  // (e.g. "H22") so they still fit inside the round seat instead of spilling
  // over the outline.
  const labelLen = label ? String(label).length : 0;
  const fontSize = labelLen >= 3
    ? Math.max(3.5, size * 0.22)
    : Math.max(4, size * 0.28);

  return (
    <div style={{ width: size, height: size, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `rotate(${rotation}deg)` }}>
      <WorkstationIconSVG
        fill={fill}
        stroke={stroke}
        strokeWidth={4}
        style={{ width: '100%', height: '100%', filter: glow }}
      />
      {label && (
        <div style={{
          position: 'absolute',
          top:  `${WORKSTATION_SEAT_CENTER.y}%`,
          left: `${WORKSTATION_SEAT_CENTER.x}%`,
          transform: `translate(-50%, -50%)`,
          fontSize: fontSize + 'px',
          fontWeight: 900,
          color: '#000',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          letterSpacing: '0.02em',
          zIndex: 10,
        }}>{label}</div>
      )}
      {isLocked && (
        <Lock size={Math.max(6, size * 0.4)} style={{ position: 'absolute', top: -size * 0.15, right: -size * 0.15, color: '#475569', background: 'white', borderRadius: '50%', padding: 1 }}/>
      )}
      {/* Selected state — no bounding-box border. The green chair fill + the
          green drop-shadow glow on the SVG silhouette are the only visual
          cues, so the selection follows the chair shape, not its bbox. */}
      {isDup && <div style={{ position: 'absolute', inset: -2, border: '2px dashed #ef4444', borderRadius: '4px', pointerEvents: 'none' }} />}
      {isOverlap && !isDup && <div style={{ position: 'absolute', inset: -2, border: '2px dashed #f59e0b', borderRadius: '4px', pointerEvents: 'none' }} />}
    </div>
  );
};

const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const GRID_SIZES = [0, 1, 2, 5, 10, 20];  // 0 = off
const AUTOSAVE_DEBOUNCE_MS = 30000;       // 30s spec
const OVERLAP_THRESHOLD_PERCENT = 0.5;    // seats within 0.5% are "overlapping"

// ------------------------------------------------------------ Diff helper
const r2 = (n) => Math.round(parseFloat(n) * 100) / 100;
const computeLocalDiff = (prev = [], curr = []) => {
  const a = Object.fromEntries(prev.map(s => [s.id, s]));
  const b = Object.fromEntries(curr.map(s => [s.id, s]));
  const added = Object.keys(b).filter(k => !(k in a));
  const removed = Object.keys(a).filter(k => !(k in b));
  const moved = [], rotated = [], resized = [];
  Object.keys(a).filter(k => k in b).forEach(k => {
    if (r2(a[k].x) !== r2(b[k].x) || r2(a[k].y) !== r2(b[k].y)) moved.push(k);
    if (r2(a[k].rotation || 0) !== r2(b[k].rotation || 0)) rotated.push(k);
    if (r2(a[k].size || 10) !== r2(b[k].size || 10)) resized.push(k);
  });
  return {
    added: added.sort(), removed: removed.sort(), moved: moved.sort(), rotated: rotated.sort(), resized: resized.sort(),
    counts: { added: added.length, removed: removed.length, moved: moved.length, rotated: rotated.length, resized: resized.length },
  };
};

// ============================================================ MAIN PAGE
export default function SeatCalibrationPage() {
  const { planId } = useParams();
  const navigate = useNavigate();

  // ----------------------------------------------------------- View-only mode
  // When the URL contains `?view=1` we render this page as a READ-ONLY viewer
  // of the published floor plan: the PDF, seat markings, room boundaries and
  // labels are visible, but every editing affordance (toolbar, save/publish,
  // drag handles, drawing modes, JSON import) is hidden / disabled.
  // This is what the "View" eye icon on the Floor Plans list opens.
  const viewOnly = (() => {
    try {
      return new URLSearchParams(window.location.search).get('view') === '1';
    } catch (_) { return false; }
  })();

  // ---- plan + persistence state
  const [plan, setPlan] = useState(null);            // backend doc
  const [liveSeats, setLiveSeats] = useState([]);    // baseline for diff
  const [pdfUrl, setPdfUrl] = useState('');
  const [pageWidth] = useState(1200);
  const [loadingPlan, setLoadingPlan] = useState(true);

  // ---- editing state
  const [mappedSeats, setMappedSeats] = useState({});
  const [currentBay, setCurrentBay] = useState('A');
  const [toolMode, setToolMode] = useState(null); // null|place|select|delete|box|lasso — null = default cursor (no tool)
  const [isCalibrating, setIsCalibrating] = useState(true);
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [previewMode, setPreviewMode] = useState(false);
  const [mouseCoords, setMouseCoords] = useState({ x: 0, y: 0 });
  const [currentZoom, setCurrentZoom] = useState(1);

  // -----------------------------------------------------------------------
  // Dynamic PDF render resolution
  //
  // The PDF is rasterised to a <canvas> whose pixel buffer is
  //     width  (CSS px)   ×   devicePixelRatio   →   canvas backing pixels
  //
  // When the user zooms in via CSS transform (TransformWrapper), the canvas
  // is stretched: at maxScale=4 on a Retina (window.devicePixelRatio=2)
  // screen the browser needs 1200·4·2 = 9600 backing pixels to stay sharp.
  //
  // To avoid blur at high zoom we re-rasterise the PDF at a higher
  // devicePixelRatio whenever the user zooms in beyond a bucket boundary.
  // Re-rasterisation is debounced so it only fires after the zoom settles,
  // and we never DECREASE the DPR — once we've spent the time to make a
  // high-res render we keep it cached for the rest of the session.
  //
  // Buckets are powers/multiples of 2 so the canvas pixel count grows
  // predictably (memory: ~4 bytes × width² × ratio²).
  // -----------------------------------------------------------------------
  const [pdfRenderDpr, setPdfRenderDpr] = useState(6); // starting baseline (sharper than the old hard-coded 4)
  const dprBumpTimerRef = useRef(null);

  useEffect(() => {
    // What DPR do we need so the canvas backing is at least 1:1 with the
    // physical screen pixels at this zoom level (plus a 25% safety margin)?
    const screenDpr =
      (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const need = Math.max(1, currentZoom) * screenDpr * 1.25;
    let bucket;
    if (need <= 4) bucket = 4;
    else if (need <= 6) bucket = 6;
    else if (need <= 8) bucket = 8;
    else bucket = 10;

    // Debounce: wait for the user to stop zooming before re-rasterising.
    if (dprBumpTimerRef.current) clearTimeout(dprBumpTimerRef.current);
    dprBumpTimerRef.current = setTimeout(() => {
      setPdfRenderDpr((prev) => (bucket > prev ? bucket : prev));
    }, 350);
    return () => {
      if (dprBumpTimerRef.current) clearTimeout(dprBumpTimerRef.current);
    };
  }, [currentZoom]);

  // ---- Floor Calibration mode (workstation seats vs meeting rooms)
  const [calibMode, setCalibMode] = useState('workstation'); // 'workstation' | 'room'
  const [roomTool, setRoomTool] = useState('select');        // 'draw' | 'select' | 'delete'
  const [mappedRooms, setMappedRooms] = useState({});        // { [id]: {id,name,x,y,w,h} }
  const [selectedRooms, setSelectedRooms] = useState([]);    // [id]
  const [drawingRoom, setDrawingRoom] = useState(null);      // {x0,y0,x1,y1} in % while drawing
  const [roomNameDialog, setRoomNameDialog] = useState(null);// {x,y,w,h,suggested}
  const [renameRoomDialog, setRenameRoomDialog] = useState(null); // {id,name}
  const dragRoomRef = useRef(null);                          // {ids,startMouseX,startMouseY,rectW,rectH,startPositions,moved}
  const resizeRoomRef = useRef(null);                        // {id,handle,startMouseX,startMouseY,rectW,rectH,startBox}
  const drawingRoomRef = useRef(null);                       // {x0,y0}
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem("calib_panel_collapsed") === "1"
  );
  useEffect(() => {
    try { window.localStorage.setItem("calib_panel_collapsed", rightPanelCollapsed ? "1" : "0"); } catch {}
  }, [rightPanelCollapsed]);
  const [snapGrid, setSnapGrid] = useState(0); // 0=off

  // ---- selection state
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [selectionRect, setSelectionRect] = useState(null); // {x1,y1,x2,y2} in %
  const [lassoPath, setLassoPath] = useState([]);           // [{x,y}] in %

  // ---- draft for selected size/rotation
  const [pendingSize, setPendingSize] = useState(10);
  const [pendingRotation, setPendingRotation] = useState(0);

  // ---- history (in-memory undo/redo of mappedSeats)
  const [history, setHistory] = useState([{}]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // ---- save state
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showVersionPanel, setShowVersionPanel] = useState(false);
  const [showAuditPanel, setShowAuditPanel] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [validationError, setValidationError] = useState('');

  const containerRef = useRef(null);
  const transformRef = useRef(null);
  const mouseDownPosRef = useRef(null);
  const dragModeRef = useRef(null); // 'box' | 'lasso' | null
  const dragSeatRef = useRef(null); // { ids[], startMouseX, startMouseY, rectW, rectH, startPositions, moved }
  const viewportInitDoneRef = useRef(false); // whether the canvas has been auto-centered once for this mount
  const canvasViewportRef = useRef(null);    // <div> that wraps TransformWrapper (used to read viewport size for zoom-around-center)

  // Center the floor plan in the visible viewport. Robust to PDF loading async.
  const centerFloorPlan = useCallback((animate = false) => {
    const ref = transformRef.current;
    if (!ref?.centerView) return;
    // Use a short animation when explicitly requested, otherwise snap immediately.
    ref.centerView(1, animate ? 250 : 0);
  }, []);

  // ------------ Helpers: bay prefix + renumbering
  const bayOf = (id) => id.match(/^[A-Z]+/)?.[0] || id[0];
  const renumberBay = useCallback((seats, bay) => {
    const ns = { ...seats };
    const re = new RegExp(`^${bay}(\\d+)$`);
    const ids = Object.keys(ns).filter(id => re.test(id)).sort(
      (a, b) => parseInt(a.match(re)[1]) - parseInt(b.match(re)[1])
    );
    const remap = [];
    ids.forEach((id, i) => {
      const newId = `${bay}${i + 1}`;
      if (id !== newId) remap.push([id, newId]);
    });
    if (remap.length === 0) return ns;
    // Two-phase swap to avoid ID collisions
    remap.forEach(([oldId], i) => {
      ns[`__tmp_${i}__`] = { ...ns[oldId], id: `__tmp_${i}__` };
      delete ns[oldId];
    });
    remap.forEach(([, newId], i) => {
      ns[newId] = { ...ns[`__tmp_${i}__`], id: newId, label: newId };
      delete ns[`__tmp_${i}__`];
    });
    return ns;
  }, []);

  // ---------------------------- Load plan
  const loadPlan = useCallback(async (silent = false) => {
    if (!silent) setLoadingPlan(true);
    try {
      const res = await api.get(`/floor-plans/${planId}`);
      setPlan(res.data);
      setPdfUrl(res.data.pdfUrl);
      const seatsSrc = res.data.draft?.seats || res.data.live_seats || [];
      const seatsObj = Object.fromEntries(seatsSrc.map(s => [s.id, s]));
      setMappedSeats(seatsObj);
      setLiveSeats(res.data.live_seats || []);
      // rooms: prefer draft.rooms over live_rooms (backward-compatible defaults to [])
      const roomsSrc = res.data.draft?.rooms || res.data.live_rooms || [];
      // Backfill capacity (older rooms saved before capacity field existed)
      const roomsNormalized = roomsSrc.map(r => ({ capacity: r.capacity || 1, ...r, capacity: r.capacity || 1 }));
      setMappedRooms(Object.fromEntries(roomsNormalized.map(r => [r.id, r])));
      setSelectedRooms([]);
      setHistory([seatsObj]);
      setHistoryIndex(0);
      setDraftDirty(false);
      setLastSaved(res.data.draft_updated_at || null);
    } catch (e) {
      notify.error(e, { what: "Load plan" });
    } finally { if (!silent) setLoadingPlan(false); }
  }, [planId]);
  useEffect(() => { loadPlan(); }, [loadPlan]);

  // Reset auto-centering flag when switching to a different plan so the new plan centers correctly.
  useEffect(() => { viewportInitDoneRef.current = false; }, [planId]);

  // ---------------------------- Derived
  const seatsArray = useMemo(() => Object.values(mappedSeats), [mappedSeats]);
  const totalMapped = seatsArray.length;
  const getSeatsInBay = useCallback((bay) =>
    Object.keys(mappedSeats).filter(id => id.startsWith(bay)).sort((a, b) =>
      (parseInt(a.slice(bay.length), 10) || 0) - (parseInt(b.slice(bay.length), 10) || 0)
    ), [mappedSeats]);
  const currentBaySeats = useMemo(() => getSeatsInBay(currentBay), [getSeatsInBay, currentBay]);
  const nextSeatNumberFor = useCallback((bay) => {
    const nums = Object.keys(mappedSeats)
      .filter(id => id.startsWith(bay))
      .map(id => parseInt(id.slice(bay.length), 10))
      .filter(n => !isNaN(n));
    return nums.length ? Math.max(...nums) + 1 : 1;
  }, [mappedSeats]);
  const nextSeatNumber = nextSeatNumberFor(currentBay);

  // Locked seats / bays
  const lockedBays = useMemo(() => {
    const byBay = {};
    seatsArray.forEach(s => {
      const bay = s.id.match(/^[A-Z]+/)?.[0] || s.id[0];
      byBay[bay] = byBay[bay] || { total: 0, locked: 0 };
      byBay[bay].total++;
      if (s.locked) byBay[bay].locked++;
    });
    return new Set(Object.entries(byBay).filter(([, v]) => v.total > 0 && v.locked === v.total).map(([k]) => k));
  }, [seatsArray]);
  const isBayLocked = (bay) => lockedBays.has(bay);

  // Validation: duplicate + overlap
  const validation = useMemo(() => {
    const dupes = new Set();
    const seen = {};
    seatsArray.forEach(s => {
      if (seen[s.id]) dupes.add(s.id);
      seen[s.id] = true;
    });
    const overlaps = new Set();
    for (let i = 0; i < seatsArray.length; i++) {
      for (let j = i + 1; j < seatsArray.length; j++) {
        const a = seatsArray[i], b = seatsArray[j];
        if (Math.abs(a.x - b.x) < OVERLAP_THRESHOLD_PERCENT && Math.abs(a.y - b.y) < OVERLAP_THRESHOLD_PERCENT) {
          overlaps.add(a.id); overlaps.add(b.id);
        }
      }
    }
    return { dupes, overlaps };
  }, [seatsArray]);

  // Diff vs live
  const localDiff = useMemo(() => computeLocalDiff(liveSeats, seatsArray), [liveSeats, seatsArray]);

  // ---------------------------- Helpers: history + mutate
  const commit = useCallback((newSeats) => {
    setMappedSeats(newSeats);
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      return [...trimmed, newSeats];
    });
    setHistoryIndex(i => i + 1);
    setDraftDirty(true);
  }, [historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(i => i - 1);
      setMappedSeats(history[historyIndex - 1]);
      setDraftDirty(true);
    }
  }, [history, historyIndex]);
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(i => i + 1);
      setMappedSeats(history[historyIndex + 1]);
      setDraftDirty(true);
    }
  }, [history, historyIndex]);

  // Snap helper
  const snap = (val) => {
    if (!snapGrid) return val;
    return Math.round(val / snapGrid) * snapGrid;
  };

  // ---------------------------- Room helpers
  const roomsArray = useMemo(() => Object.values(mappedRooms), [mappedRooms]);

  // Live meeting rooms (baseline) — used for publish diff & confirmation summary
  const liveRooms = useMemo(() => plan?.live_rooms || [], [plan]);
  const roomDiff = useMemo(() => {
    const prevIds = new Set(liveRooms.map(r => r.id));
    const currIds = new Set(roomsArray.map(r => r.id));
    const added = roomsArray.filter(r => !prevIds.has(r.id)).map(r => r.name);
    const removed = liveRooms.filter(r => !currIds.has(r.id)).map(r => r.name);
    return { added, removed, total: roomsArray.length };
  }, [liveRooms, roomsArray]);
  const nextRoomDefaultName = useCallback(() => {
    const taken = new Set(Object.values(mappedRooms).map(r => r.name));
    let i = 1;
    while (taken.has(`Meeting Room ${i}`)) i++;
    return `Meeting Room ${i}`;
  }, [mappedRooms]);
  const ridGen = () => `room-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;

  const commitRooms = useCallback((next) => {
    setMappedRooms(next);
    setDraftDirty(true);
  }, []);

  const clampRoom = (r) => {
    // keep within 0..100 and minimum 0.5% size
    const minSize = 0.5;
    let { x, y, w, h } = r;
    if (w < minSize) w = minSize;
    if (h < minSize) h = minSize;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + w > 100) x = 100 - w;
    if (y + h > 100) y = 100 - h;
    return { ...r, x: r2(x), y: r2(y), w: r2(w), h: r2(h) };
  };

  const deleteSelectedRooms = useCallback(() => {
    if (selectedRooms.length === 0) return;
    const ns = { ...mappedRooms };
    selectedRooms.forEach(id => { delete ns[id]; });
    commitRooms(ns);
    setSelectedRooms([]);
  }, [selectedRooms, mappedRooms, commitRooms]);

  // ---------------------------- Drag-vs-click PDF interaction
  const handlePdfMouseDown = (e) => {
    if (!isCalibrating) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;

    // ---- Meeting Room mode mouse handling
    if (calibMode === 'room') {
      if (roomTool === 'draw') {
        drawingRoomRef.current = { x0: px, y0: py };
        setDrawingRoom({ x0: px, y0: py, x1: px, y1: py });
        e.preventDefault();
      } else if (roomTool === 'select' || roomTool === 'delete') {
        // click on empty area clears selection
        if (!(e.shiftKey || e.ctrlKey || e.metaKey)) setSelectedRooms([]);
      }
      mouseDownPosRef.current = { sx: e.clientX, sy: e.clientY, px, py };
      return;
    }

    mouseDownPosRef.current = {
      sx: e.clientX, sy: e.clientY,
      px, py,
    };
    if (toolMode === 'box') {
      dragModeRef.current = 'box';
      setSelectionRect({ x1: mouseDownPosRef.current.px, y1: mouseDownPosRef.current.py, x2: mouseDownPosRef.current.px, y2: mouseDownPosRef.current.py });
    } else if (toolMode === 'lasso') {
      dragModeRef.current = 'lasso';
      setLassoPath([{ x: mouseDownPosRef.current.px, y: mouseDownPosRef.current.py }]);
    }
  };

  const handlePdfMouseMove = (e) => {
    if (!containerRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPercent = ((e.clientX - rect.left) / rect.width) * 100;
    const yPercent = ((e.clientY - rect.top) / rect.height) * 100;
    setMouseCoords({ x: xPercent.toFixed(2), y: yPercent.toFixed(2) });

    // ---- Meeting Room mode
    if (calibMode === 'room') {
      // Drawing a new room
      if (drawingRoomRef.current) {
        const d = drawingRoomRef.current;
        setDrawingRoom({ x0: d.x0, y0: d.y0, x1: xPercent, y1: yPercent });
        return;
      }
      // Moving selected rooms
      if (dragRoomRef.current) {
        const drag = dragRoomRef.current;
        const dxPx = e.clientX - drag.startMouseX;
        const dyPx = e.clientY - drag.startMouseY;
        if (!drag.moved && Math.abs(dxPx) < 3 && Math.abs(dyPx) < 3) return;
        drag.moved = true;
        const dxPct = (dxPx / drag.rectW) * 100;
        const dyPct = (dyPx / drag.rectH) * 100;
        setMappedRooms(prev => {
          const ns = { ...prev };
          drag.ids.forEach(id => {
            const sp = drag.startPositions[id];
            if (!sp || !ns[id]) return;
            ns[id] = clampRoom({ ...ns[id], x: sp.x + dxPct, y: sp.y + dyPct });
          });
          return ns;
        });
        setDraftDirty(true);
        return;
      }
      // Resizing a single room
      if (resizeRoomRef.current) {
        const rz = resizeRoomRef.current;
        const dxPct = ((e.clientX - rz.startMouseX) / rz.rectW) * 100;
        const dyPct = ((e.clientY - rz.startMouseY) / rz.rectH) * 100;
        const { x, y, w, h } = rz.startBox;
        let nx = x, ny = y, nw = w, nh = h;
        if (rz.handle.includes('w')) { nx = x + dxPct; nw = w - dxPct; }
        if (rz.handle.includes('e')) { nw = w + dxPct; }
        if (rz.handle.includes('n')) { ny = y + dyPct; nh = h - dyPct; }
        if (rz.handle.includes('s')) { nh = h + dyPct; }
        // Prevent flipping
        if (nw < 0.5) { nw = 0.5; if (rz.handle.includes('w')) nx = x + w - 0.5; }
        if (nh < 0.5) { nh = 0.5; if (rz.handle.includes('n')) ny = y + h - 0.5; }
        setMappedRooms(prev => ({ ...prev, [rz.id]: clampRoom({ ...prev[rz.id], x: nx, y: ny, w: nw, h: nh }) }));
        setDraftDirty(true);
        return;
      }
      return;
    }

    // Seat-drag in progress?
    if (dragSeatRef.current) {
      const drag = dragSeatRef.current;
      const dxPx = e.clientX - drag.startMouseX;
      const dyPx = e.clientY - drag.startMouseY;
      if (!drag.moved && Math.abs(dxPx) < 3 && Math.abs(dyPx) < 3) return;
      drag.moved = true;
      const dxPct = (dxPx / drag.rectW) * 100;
      const dyPct = (dyPx / drag.rectH) * 100;
      setMappedSeats(prev => {
        const ns = { ...prev };
        drag.ids.forEach(id => {
          const sp = drag.startPositions[id];
          if (!sp || !ns[id]) return;
          let nx = sp.x + dxPct, ny = sp.y + dyPct;
          if (snapGrid > 0) { nx = snap(nx); ny = snap(ny); }
          ns[id] = { ...ns[id], x: r2(nx), y: r2(ny) };
        });
        return ns;
      });
      setDraftDirty(true);
      return;
    }

    if (dragModeRef.current === 'box' && mouseDownPosRef.current) {
      setSelectionRect({ x1: mouseDownPosRef.current.px, y1: mouseDownPosRef.current.py, x2: xPercent, y2: yPercent });
    } else if (dragModeRef.current === 'lasso' && mouseDownPosRef.current) {
      setLassoPath(p => [...p, { x: xPercent, y: yPercent }]);
    }
  };

  // Point-in-polygon test (ray casting)
  const pointInPolygon = (point, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > point.y) !== (yj > point.y)) && (point.x < (xj - xi) * (point.y - yi) / (yj - yi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const handlePdfMouseUp = (e) => {
    // ---- Meeting Room mode mouse-up
    if (calibMode === 'room') {
      // Finish drawing
      if (drawingRoomRef.current) {
        const d = drawingRoomRef.current;
        drawingRoomRef.current = null;
        const rect = e.currentTarget.getBoundingClientRect();
        const xP = ((e.clientX - rect.left) / rect.width) * 100;
        const yP = ((e.clientY - rect.top) / rect.height) * 100;
        const x = Math.min(d.x0, xP), y = Math.min(d.y0, yP);
        const w = Math.abs(xP - d.x0), h = Math.abs(yP - d.y0);
        setDrawingRoom(null);
        if (w >= 1 && h >= 1) {
          setRoomNameDialog({ x, y, w, h, suggested: nextRoomDefaultName() });
        }
        mouseDownPosRef.current = null;
        return;
      }
      // Finish move
      if (dragRoomRef.current) {
        const drag = dragRoomRef.current;
        dragRoomRef.current = null;
        if (!drag.moved) {
          // click-only on a room → toggle/select
          const id = drag.ids[0];
          if (e.shiftKey || e.ctrlKey || e.metaKey) {
            setSelectedRooms(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
          } else {
            setSelectedRooms([id]);
          }
        }
        mouseDownPosRef.current = null;
        return;
      }
      // Finish resize
      if (resizeRoomRef.current) {
        resizeRoomRef.current = null;
        mouseDownPosRef.current = null;
        return;
      }
      mouseDownPosRef.current = null;
      return;
    }

    // Seat-drag completed?
    if (dragSeatRef.current) {
      const drag = dragSeatRef.current;
      dragSeatRef.current = null;
      if (drag.moved) {
        // Push the current state to history (positions already applied during move)
        setHistory(prev => {
          const trimmed = prev.slice(0, historyIndex + 1);
          return [...trimmed, mappedSeats];
        });
        setHistoryIndex(i => i + 1);
        return;
      }
      // Treat as click-on-seat in select mode → select that seat
      const seatId = drag.ids[0];
      if (seatId && mappedSeats[seatId]) {
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          setSelectedSeats(prev => prev.includes(seatId) ? prev.filter(id => id !== seatId) : [...prev, seatId]);
        } else {
          setSelectedSeats([seatId]);
          setPendingSize(mappedSeats[seatId].size || 10);
          setPendingRotation(mappedSeats[seatId].rotation || 0);
        }
      }
      return;
    }

    const start = mouseDownPosRef.current;
    mouseDownPosRef.current = null;
    const dragMode = dragModeRef.current;
    dragModeRef.current = null;

    // Box selection completed?
    if (dragMode === 'box' && start) {
      const rect = e.currentTarget.getBoundingClientRect();
      const xP = ((e.clientX - rect.left) / rect.width) * 100;
      const yP = ((e.clientY - rect.top) / rect.height) * 100;
      const x1 = Math.min(start.px, xP), x2 = Math.max(start.px, xP);
      const y1 = Math.min(start.py, yP), y2 = Math.max(start.py, yP);
      const inside = seatsArray.filter(s => s.x >= x1 && s.x <= x2 && s.y >= y1 && s.y <= y2).map(s => s.id);
      setSelectionRect(null);
      setSelectedSeats(prev => {
        if (e.shiftKey) return Array.from(new Set([...prev, ...inside]));
        if (e.ctrlKey || e.metaKey) return prev.filter(id => !inside.includes(id));
        return inside;
      });
      return;
    }
    // Lasso completed?
    if (dragMode === 'lasso' && start && lassoPath.length > 2) {
      const inside = seatsArray.filter(s => pointInPolygon({ x: s.x, y: s.y }, lassoPath)).map(s => s.id);
      setLassoPath([]);
      setSelectedSeats(prev => {
        if (e.shiftKey) return Array.from(new Set([...prev, ...inside]));
        if (e.ctrlKey || e.metaKey) return prev.filter(id => !inside.includes(id));
        return inside;
      });
      return;
    }
    setLassoPath([]);

    if (!start || !isCalibrating) return;

    const dx = Math.abs(e.clientX - start.sx);
    const dy = Math.abs(e.clientY - start.sy);
    if (dx > 4 || dy > 4) return; // it was a drag — ignore

    const rect = e.currentTarget.getBoundingClientRect();
    const xPercent = snap(((e.clientX - rect.left) / rect.width) * 100);
    const yPercent = snap(((e.clientY - rect.top) / rect.height) * 100);

    if (toolMode === 'place') {
      if (isBayLocked(currentBay)) {
        setValidationError(`Bay ${currentBay} is locked. Unlock it to add seats.`);
        return;
      }
      const seatId = `${currentBay}${nextSeatNumberFor(currentBay)}`;
      commit({
        ...mappedSeats,
        [seatId]: { id: seatId, label: seatId, x: r2(xPercent), y: r2(yPercent), size: 10, rotation: 0, status: 'available', locked: false }
      });
    } else if (toolMode === 'delete') {
      const clicked = seatsArray.find(s => Math.abs(s.x - xPercent) < 1 && Math.abs(s.y - yPercent) < 1);
      if (clicked) {
        if (clicked.locked) { setValidationError(`Seat ${clicked.id} is locked.`); return; }
        const ns = { ...mappedSeats };
        delete ns[clicked.id];
        commit(renumberBay(ns, bayOf(clicked.id)));
      }
    } else if (toolMode === 'select') {
      const clicked = seatsArray.find(s => Math.abs(s.x - xPercent) < 1 && Math.abs(s.y - yPercent) < 1);
      if (clicked) {
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          setSelectedSeats(prev => prev.includes(clicked.id) ? prev.filter(id => id !== clicked.id) : [...prev, clicked.id]);
        } else {
          setSelectedSeats([clicked.id]);
          setPendingSize(clicked.size || 10);
          setPendingRotation(clicked.rotation || 0);
        }
      } else {
        setSelectedSeats([]);
      }
    }
  };

  // ---------------------------- Per-seat drag handler
  const handleSeatMouseDown = (seat, e) => {
    if (!isCalibrating || previewMode) return;
    // Allow drag in select mode (any seat) AND in box/lasso mode (only if seat is already selected)
    const isPartOfSelection = selectedSeats.includes(seat.id);
    const canDrag =
      toolMode === "select" ||
      ((toolMode === "box" || toolMode === "lasso") && isPartOfSelection);
    if (!canDrag) return;
    if (seat.locked) return;
    e.stopPropagation();
    e.preventDefault();

    const dragIds = isPartOfSelection ? [...selectedSeats] : [seat.id];
    if (!isPartOfSelection) {
      setSelectedSeats([seat.id]);
      setPendingSize(seat.size || 10);
      setPendingRotation(seat.rotation || 0);
    }

    const rect = containerRef.current.getBoundingClientRect();
    const startPositions = {};
    dragIds.forEach(id => {
      const s = mappedSeats[id];
      if (s && !s.locked) startPositions[id] = { x: s.x, y: s.y };
    });

    dragSeatRef.current = {
      ids: Object.keys(startPositions),
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      rectW: rect.width,
      rectH: rect.height,
      startPositions,
      moved: false,
    };
  };

  // ---------------------------- Bulk operations
  const applyToSelected = (mutator, requireUnlocked = true) => {
    if (selectedSeats.length === 0) return;
    const ns = { ...mappedSeats };
    let blocked = 0;
    selectedSeats.forEach(id => {
      if (!ns[id]) return;
      if (requireUnlocked && ns[id].locked) { blocked++; return; }
      ns[id] = { ...ns[id], ...mutator(ns[id]) };
    });
    if (blocked > 0) setValidationError(`${blocked} locked seat(s) skipped.`);
    commit(ns);
  };

  const applyDraftChanges = () => applyToSelected(() => ({ size: pendingSize, rotation: pendingRotation }));
  const cancelDraftChanges = () => {
    if (selectedSeats[0] && mappedSeats[selectedSeats[0]]) {
      setPendingSize(mappedSeats[selectedSeats[0]].size || 10);
      setPendingRotation(mappedSeats[selectedSeats[0]].rotation || 0);
    }
  };

  const deleteSelected = () => {
    if (selectedSeats.length === 0) return;
    const ns = { ...mappedSeats };
    let blocked = 0;
    const affectedBays = new Set();
    selectedSeats.forEach(id => {
      if (ns[id]?.locked) { blocked++; return; }
      if (ns[id]) {
        affectedBays.add(bayOf(id));
        delete ns[id];
      }
    });
    if (blocked > 0) setValidationError(`${blocked} locked seat(s) skipped.`);
    let result = ns;
    affectedBays.forEach(b => { result = renumberBay(result, b); });
    commit(result);
    setSelectedSeats([]);
  };

  const lockSelected = (lock) => applyToSelected(() => ({ locked: lock }), false);
  const renamePrefix = async () => {
    if (selectedSeats.length === 0) return;
    const newPrefix = await promptDialog({ title: 'Rename bay prefix', message: 'Enter the new bay prefix (uppercase letters only, e.g. "Z"):', placeholder: 'Z' });
    if (!newPrefix || !/^[A-Z]+$/.test(newPrefix.trim())) { setValidationError('Prefix must be uppercase letters.'); return; }
    const ns = { ...mappedSeats };
    let counter = nextSeatNumberFor(newPrefix.trim());
    selectedSeats.forEach(id => {
      if (!ns[id] || ns[id].locked) return;
      const newId = `${newPrefix.trim()}${counter++}`;
      ns[newId] = { ...ns[id], id: newId, label: newId };
      delete ns[id];
    });
    commit(ns);
    setSelectedSeats([]);
  };

  const renameSeat = (oldId, rawNewId) => {
    const newId = (rawNewId || '').trim().toUpperCase();
    if (!/^[A-Z]+\d+$/.test(newId)) {
      setValidationError('Seat name must be uppercase letters followed by digits (e.g. A12).');
      return false;
    }
    if (newId === oldId) return true;
    if (mappedSeats[newId]) {
      setValidationError(`Seat "${newId}" already exists.`);
      return false;
    }
    const ns = { ...mappedSeats };
    ns[newId] = { ...ns[oldId], id: newId, label: newId };
    delete ns[oldId];
    commit(ns);
    setSelectedSeats([newId]);
    setValidationError('');
    return true;
  };

  // Smart, rotation-aware alignment with overlap avoidance.
  // Detects whether selected seats form a horizontal or vertical row using
  // the spread along each axis, then equalises spacing along the dominant
  // axis and snaps the perpendicular axis to the mean coordinate.
  const smartAlign = () => {
    if (selectedSeats.length < 2) return;
    const arr = selectedSeats.map(id => mappedSeats[id]).filter(Boolean);
    if (arr.length < 2) return;

    // Mean rotation, snapped to 0° or 90° (since rows are 1-D)
    const meanRot = arr.reduce((s, a) => s + (a.rotation || 0), 0) / arr.length;
    const snappedRot = (Math.round(meanRot / 90) * 90) % 180;
    const rad = (snappedRot * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);

    // Project to rotated axes
    let proj = arr.map(s => ({
      s,
      u: s.x * cos + s.y * sin,
      v: -s.x * sin + s.y * cos,
    }));

    // Decide axis from greater spread
    const usSpread = Math.max(...proj.map(p => p.u)) - Math.min(...proj.map(p => p.u));
    const vsSpread = Math.max(...proj.map(p => p.v)) - Math.min(...proj.map(p => p.v));
    let useU = usSpread >= vsSpread;
    // If rotation indicates a non-zero axis, prefer u
    if (snappedRot !== 0) useU = true;

    if (!useU) {
      // Swap roles
      proj = proj.map(p => ({ s: p.s, u: p.v, v: p.u }));
    }

    proj.sort((a, b) => a.u - b.u);
    const minU = proj[0].u, maxU = proj[proj.length - 1].u;
    const meanV = proj.reduce((s, p) => s + p.v, 0) / proj.length;

    // Minimum spacing to prevent overlaps (size is in px @ zoom 1)
    const w = containerRef.current?.getBoundingClientRect().width || pageWidth;
    const avgSize = arr.reduce((s, a) => s + (a.size || 10), 0) / arr.length;
    const minSpacingPct = (avgSize * 1.05) / w * 100;
    let spacing = (maxU - minU) / (proj.length - 1);
    if (spacing < minSpacingPct) spacing = minSpacingPct;

    const ns = { ...mappedSeats };
    proj.forEach((p, i) => {
      if (p.s.locked) return;
      const u = minU + spacing * i;
      const v = meanV;
      // Inverse rotation back to world coords
      let wx, wy;
      if (useU) {
        wx = u * cos - v * sin;
        wy = u * sin + v * cos;
      } else {
        // We had swapped u/v earlier — swap back before un-rotating
        wx = v * cos - u * sin;
        wy = v * sin + u * cos;
      }
      ns[p.s.id] = { ...p.s, x: r2(wx), y: r2(wy) };
    });
    commit(ns);
  };

  const autoGenerateBay = () => {
    if (isBayLocked(currentBay)) { setValidationError(`Bay ${currentBay} is locked.`); return; }
    const ids = currentBaySeats;
    if (ids.length < 2) { setValidationError('Place at least 2 seats in the bay first.'); return; }
    const first = mappedSeats[ids[0]], last = mappedSeats[ids[ids.length - 1]];
    const count = ids.length;
    const ns = { ...mappedSeats };
    for (let i = 1; i < count - 1; i++) {
      if (ns[ids[i]].locked) continue;
      const ratio = i / (count - 1);
      ns[ids[i]] = { ...ns[ids[i]], x: r2(first.x + (last.x - first.x) * ratio), y: r2(first.y + (last.y - first.y) * ratio) };
    }
    commit(ns);
  };

  // ---------------------------- Lock entire bay
  const toggleBayLock = (bay, lock) => {
    const ns = { ...mappedSeats };
    Object.keys(ns).filter(id => id.startsWith(bay)).forEach(id => { ns[id] = { ...ns[id], locked: lock }; });
    commit(ns);
  };

  // ---------------------------- Save draft / publish
  const saveDraft = useCallback(async (silent = false) => {
    if (!plan) return;
    setSaving(true);
    try {
      await api.put(`/floor-plans/${planId}/draft`, {
        name: plan.name, pdfUrl,
        seats: Object.values(mappedSeats),
        rooms: Object.values(mappedRooms),
      });
      setLastSaved(new Date().toISOString());
      setDraftDirty(false);
      if (!silent) setValidationError('');
    } catch (e) {
      if (!silent) notify.error(e, { what: 'Save draft' });
    } finally { setSaving(false); }
  }, [plan, planId, pdfUrl, mappedSeats, mappedRooms]);

  // ---------------------------- Thumbnail (PDF page 1 + seat dots → small PNG)
  const generateThumbnail = useCallback(() => {
    try {
      const pdfCanvas = containerRef.current?.querySelector('canvas');
      if (!pdfCanvas) return null;
      const targetW = 320;
      const ratio = targetW / pdfCanvas.width;
      const tcanvas = document.createElement('canvas');
      tcanvas.width = targetW;
      tcanvas.height = Math.max(60, Math.round(pdfCanvas.height * ratio));
      const ctx = tcanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, tcanvas.width, tcanvas.height);
      ctx.drawImage(pdfCanvas, 0, 0, tcanvas.width, tcanvas.height);
      // overlay seat dots
      ctx.fillStyle = '#ec9324';
      Object.values(mappedSeats).forEach(s => {
        const x = (s.x / 100) * tcanvas.width;
        const y = (s.y / 100) * tcanvas.height;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      });
      return tcanvas.toDataURL('image/jpeg', 0.7);
    } catch (e) {
      console.warn('Thumbnail generation failed', e);
      return null;
    }
  }, [mappedSeats]);

  const handlePublish = async (comments) => {
    setPublishing(true);
    try {
      // Persist current state as draft first — include both seats AND rooms so
      // publishing creates a version that preserves the meeting-room calibration.
      await api.put(`/floor-plans/${planId}/draft`, {
        name: plan.name,
        pdfUrl,
        seats: Object.values(mappedSeats),
        rooms: Object.values(mappedRooms),
      });
      await api.post(`/floor-plans/${planId}/publish`, { comments });
      // Best-effort thumbnail
      const thumb = generateThumbnail();
      if (thumb) {
        try { await api.put(`/floor-plans/${planId}/thumbnail`, { thumbnail: thumb }); } catch (e) { /* non-blocking */ }
      }
      setShowPublishDialog(false);
      await loadPlan(true);  // silent reload — keep canvas viewport intact
      notify.success("Changes published and floor plan is now Live");
    } catch (e) {
      notify.error(e, { what: 'Publish plan' });
    } finally { setPublishing(false); }
  };

  // ---------------------------- Auto-save draft (debounced)
  useEffect(() => {
    if (!draftDirty || !plan) return;
    const t = setTimeout(() => { saveDraft(true); }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draftDirty, plan, saveDraft]);

  // ---------------------------- Unsaved-changes warning
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (draftDirty) { e.preventDefault(); e.returnValue = ''; return ''; }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [draftDirty]);

  // ---------------------------- Keyboard shortcuts
  useEffect(() => {
    const ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (e.key === 'Delete' && !inField) {
        if (calibMode === 'room' && selectedRooms.length > 0) { e.preventDefault(); deleteSelectedRooms(); return; }
        if (selectedSeats.length > 0) { e.preventDefault(); deleteSelected(); }
      }
      else if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.shiftKey) { e.preventDefault(); saveDraft(); }
      else if (ARROWS[e.key] && !inField) {
        // Room nudge takes priority when in room mode with selection
        if (calibMode === 'room' && selectedRooms.length > 0) {
          e.preventDefault();
          const stepPx = (e.ctrlKey || e.metaKey) ? 10 : (e.shiftKey ? 5 : 1);
          const rect = containerRef.current?.getBoundingClientRect();
          const w = rect?.width || pageWidth;
          const h = rect?.height || pageWidth;
          const [dxDir, dyDir] = ARROWS[e.key];
          const dxPct = (dxDir * stepPx / w) * 100;
          const dyPct = (dyDir * stepPx / h) * 100;
          const ns = { ...mappedRooms };
          selectedRooms.forEach(id => {
            if (!ns[id]) return;
            ns[id] = clampRoom({ ...ns[id], x: ns[id].x + dxPct, y: ns[id].y + dyPct });
          });
          commitRooms(ns);
          return;
        }
        if (selectedSeats.length > 0) {
          e.preventDefault();
          const stepPx = (e.ctrlKey || e.metaKey) ? 10 : (e.shiftKey ? 5 : 1);
          const rect = containerRef.current?.getBoundingClientRect();
          const w = rect?.width || pageWidth;
          const h = rect?.height || pageWidth;
          const [dxDir, dyDir] = ARROWS[e.key];
          const dxPct = (dxDir * stepPx / w) * 100;
          const dyPct = (dyDir * stepPx / h) * 100;
          const ns = { ...mappedSeats };
          let moved = 0;
          selectedSeats.forEach(id => {
            if (!ns[id] || ns[id].locked) return;
            ns[id] = { ...ns[id], x: r2(ns[id].x + dxPct), y: r2(ns[id].y + dyPct) };
            moved++;
          });
          if (moved > 0) commit(ns);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, selectedSeats, mappedSeats, saveDraft, calibMode, selectedRooms, mappedRooms]);

  // ---------------------------- Import/Export
  const exportConfig = () => {
    const config = { pdfUrl, name: plan?.name, seats: Object.values(mappedSeats) };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${plan?.name || 'floor-plan'}.json`; a.click();
    URL.revokeObjectURL(url);
  };
  const importConfig = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const cfg = JSON.parse(ev.target.result);
        const obj = Object.fromEntries(cfg.seats.map(s => [s.id, s]));
        commit(obj);
      } catch (err) { setValidationError(`Import failed: ${err.message}`); }
    };
    reader.readAsText(file);
  };

  if (loadingPlan) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading floor plan…</div>;
  }
  if (!plan) {
    return <div className="min-h-screen flex items-center justify-center text-red-600">Plan not found.</div>;
  }

  const lockedCount = seatsArray.filter(s => s.locked).length;

  // ============================================================ RENDER
  return (
    <Layout
      title={plan?.name || "Calibration"}
      fullBleed
      contentClassName="h-screen flex flex-col bg-gray-50"
    >
    <div className="flex-1 flex flex-row-reverse overflow-hidden">
      {/* ────────────────────────────── Right collapsible toolbar
          In view-only mode the whole calibration toolbar (drawing modes,
          save/publish, history, etc.) is hidden — the user just sees the
          floor plan with seats, rooms, and labels overlaid. */}
      {viewOnly ? null : (
      rightPanelCollapsed ? (
        <button
          onClick={() => setRightPanelCollapsed(false)}
          data-testid="expand-calibration-panel"
          title="Expand calibration panel"
          className="w-10 bg-white border-l flex flex-col items-center pt-3 gap-2 hover:bg-gray-50"
        >
          <ChevronsLeft sx={{ fontSize: 18 }} className="text-gray-600"/>
          <span className="text-[9px] uppercase tracking-wide text-gray-400 [writing-mode:vertical-rl]">Tools</span>
        </button>
      ) : (
      <div className="w-80 bg-white border-l overflow-y-auto" data-testid="calibration-toolbar">
        <div className="p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h1 className="text-lg font-bold truncate" title={plan.name}>{plan.name}</h1>
            <button
              onClick={() => setRightPanelCollapsed(true)}
              data-testid="collapse-calibration-panel"
              title="Collapse panel"
              className="p-1 hover:bg-gray-100 rounded flex-shrink-0 text-gray-500 hover:text-gray-700"
            >
              <ChevronsRight sx={{ fontSize: 16 }}/>
            </button>
          </div>
          <div className="text-xs text-gray-500 mb-3">
            v{plan?.live_version_id ? '(live exists)' : 'unpublished'} · {totalMapped} seats · {roomsArray.length} rooms
            {draftDirty && <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-semibold">Draft</span>}
          </div>

          {/* Floor Calibration mode tabs */}
          <div className="mb-3 grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded" data-testid="calib-mode-tabs">
            <button
              onClick={() => { setCalibMode('workstation'); setSelectedRooms([]); }}
              data-testid="tab-workstation"
              className={`py-1.5 text-[11px] font-semibold rounded transition-colors ${calibMode === 'workstation' ? 'bg-white text-[#ec9324] shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >Workstation Calibration</button>
            <button
              onClick={() => { setCalibMode('room'); setSelectedSeats([]); setRoomTool('select'); }}
              data-testid="tab-room"
              className={`py-1.5 text-[11px] font-semibold rounded transition-colors ${calibMode === 'room' ? 'bg-white text-[#ec9324] shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >Meeting Room Calibration</button>
          </div>

          {/* Save / Live toggle */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <button onClick={() => saveDraft()} disabled={saving || !draftDirty} data-testid="save-draft-btn"
              className="py-2 bg-white border border-gray-200 hover:border-[#ec9324] hover:text-[#ec9324] text-gray-700 rounded text-xs flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              <Save sx={{ fontSize: 13 }}/>{saving ? 'Saving…' : 'Save Draft'}
            </button>
            <LiveToggle
              plan={plan}
              draftDirty={draftDirty}
              totalMapped={totalMapped}
              hasDupes={validation.dupes.size > 0}
              onPublishRequested={() => setShowPublishDialog(true)}
              onAutoPublish={() => handlePublish("Published on Live toggle")}
              onSetStatus={async (next) => {
                try {
                  await api.patch(`/floor-plans/${planId}/status`, { status: next });
                  await loadPlan(true);  // silent reload — keep canvas viewport intact
                } catch (e) {
                  notify.error(e, { what: 'Update plan status' });
                }
              }}
            />
          </div>
          <div className="text-[10px] text-gray-500 mb-3">
            {lastSaved ? `Saved ${new Date(lastSaved).toLocaleTimeString(undefined, { timeZone: "Asia/Kolkata" })}` : 'Not saved yet'} · auto-save every 30s
          </div>

          {/* Diff vs live preview */}
          {(localDiff.counts.added + localDiff.counts.removed + localDiff.counts.moved + localDiff.counts.rotated + localDiff.counts.resized) > 0 && (
            <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded text-[10px]" data-testid="diff-summary">
              <div className="font-semibold text-amber-900 mb-1">Changes since live:</div>
              <div className="grid grid-cols-5 gap-1 text-center">
                {Object.entries(localDiff.counts).filter(([, n]) => n > 0).map(([k, n]) => (
                  <span key={k} className="px-1 py-0.5 bg-white rounded text-amber-900 font-bold">+{n} {k}</span>
                ))}
              </div>
            </div>
          )}

          {/* Validation errors */}
          {(validation.dupes.size > 0 || validation.overlaps.size > 0 || validationError) && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-800" data-testid="validation-banner">
              {validation.dupes.size > 0 && <div className="font-semibold">⚠️ Duplicate seat IDs: {[...validation.dupes].join(', ')}</div>}
              {validation.overlaps.size > 0 && <div className="text-amber-700">⚠️ {validation.overlaps.size} overlapping seat(s)</div>}
              {validationError && (
                <div className="flex items-start justify-between gap-2 mt-1">
                  <span>{validationError}</span>
                  <button onClick={() => setValidationError('')} className="text-red-700"><X sx={{ fontSize: 12 }}/></button>
                </div>
              )}
            </div>
          )}

          {/* History / Audit toggles */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button onClick={() => { setShowAuditPanel(false); setShowVersionPanel(true); }} className="py-1.5 text-xs border border-gray-200 hover:bg-gray-50 rounded flex items-center justify-center gap-1" data-testid="open-versions-btn">
              <History sx={{ fontSize: 12 }}/> Versions
            </button>
            <button onClick={() => { setShowVersionPanel(false); setShowAuditPanel(true); }} className="py-1.5 text-xs border border-gray-200 hover:bg-gray-50 rounded flex items-center justify-center gap-1" data-testid="open-audit-btn">
              <Activity sx={{ fontSize: 12 }}/> Audit
            </button>
          </div>

          {/* Tool mode */}
          {calibMode === 'workstation' && (<>
          <div className="mb-3 p-2 bg-gray-50 rounded">
            <div className="text-[10px] font-semibold mb-1.5 text-gray-700">TOOL MODE</div>
            <div className="grid grid-cols-5 gap-1">
              {[
                { mode: 'place',  Icon: MapPin,   label: 'Place' },
                { mode: 'select', Icon: Settings, label: 'Select' },
                { mode: 'box',    Icon: Square,   label: 'Multi Select' },
                { mode: 'lasso',  Icon: Lasso,    label: 'Lasso' },
                { mode: 'delete', Icon: Trash2,   label: 'Delete' },
              ].map(({ mode, Icon, label }) => {
                const active = toolMode === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => {
                      // Toggle: clicking the active tool deselects it
                      // (returns to default cursor / no-tool mode).
                      setToolMode(prev => (prev === mode ? null : mode));
                      setIsCalibrating(true);
                    }}
                    data-testid={`tool-${mode}`}
                    title={label}
                    className={`p-1.5 rounded text-[9px] flex flex-col items-center gap-0.5 border transition-colors ${
                      active
                        ? 'bg-[#ec9324] text-white border-[#ec9324]'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-[#ec9324] hover:text-[#ec9324]'
                    }`}
                  >
                    <Icon size={12}/>
                    <span className="leading-tight text-center">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bay controls */}
          <div className="mb-3 p-2 bg-gray-50 border border-gray-200 rounded">
            <div className="text-[10px] font-semibold mb-1.5 text-gray-700">BAY {isBayLocked(currentBay) && <Lock sx={{ fontSize: 10 }} className="inline"/>}</div>
            <div className="flex items-center gap-1 mb-1">
              <button onClick={() => { const idx = BAY_LIST.indexOf(currentBay); setCurrentBay(BAY_LIST[Math.max(0, idx - 1)] || BAY_LIST[0]); }} className="p-1 bg-white border border-gray-200 rounded hover:border-[#ec9324]"><ChevronLeft sx={{ fontSize: 12 }}/></button>
              <select value={currentBay} onChange={(e) => setCurrentBay(e.target.value)} className="flex-1 px-1.5 py-1 border border-gray-200 rounded text-xs font-bold bg-white focus:outline-none focus:border-[#ec9324]" data-testid="bay-select">
                {BAY_LIST.map(l => <option key={l} value={l}>Bay {l}</option>)}
              </select>
              <button onClick={() => { const idx = BAY_LIST.indexOf(currentBay); setCurrentBay(BAY_LIST[Math.min(BAY_LIST.length - 1, idx + 1)] || BAY_LIST[BAY_LIST.length - 1]); }} className="p-1 bg-white border border-gray-200 rounded hover:border-[#ec9324]"><ChevronRight sx={{ fontSize: 12 }}/></button>
            </div>
            <div className="flex justify-between items-center text-[10px] text-gray-600">
              <span>{currentBaySeats.length} seat(s)</span>
              <button onClick={() => toggleBayLock(currentBay, !isBayLocked(currentBay))} className="flex items-center gap-0.5 hover:text-[#ec9324]" data-testid="bay-lock-toggle">
                {isBayLocked(currentBay) ? <><Unlock sx={{ fontSize: 10 }}/> unlock bay</> : <><Lock sx={{ fontSize: 10 }}/> lock bay</>}
              </button>
            </div>
          </div>

          {/* Snap to grid */}
          <div className="mb-3 p-2 bg-gray-50 rounded">
            <label className="flex items-center justify-between text-[10px] font-semibold text-gray-700 gap-2">
              <span className="inline-flex items-center"><Grid sx={{ fontSize: 10 }} className="mr-1"/>SNAP TO GRID</span>
              <select
                value={String(snapGrid)}
                onChange={(e) => setSnapGrid(parseInt(e.target.value, 10))}
                data-testid="snap-select"
                className="text-[10px] px-2 py-1 border border-gray-200 rounded bg-white focus:outline-none focus:border-[#ec9324] min-w-[64px]"
              >
                {GRID_SIZES.map(g => (
                  <option key={g} value={g}>{g === 0 ? 'Off' : `${g} px`}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Selected / Bulk Actions */}
          {selectedSeats.length > 0 && (
            <div className="mb-3 border border-[#ec9324]/30 bg-orange-50/50 rounded overflow-hidden" data-testid="bulk-panel">
              <div className="px-2 py-1.5 bg-[#ec9324]/10 flex items-center justify-between border-b border-[#ec9324]/20">
                <span className="text-[11px] font-bold text-[#ec9324]">{selectedSeats.length} selected</span>
                <button
                  onClick={() => setSelectedSeats([])}
                  className="text-[10px] text-gray-500 hover:text-gray-700"
                  data-testid="clear-selection-btn"
                  title="Clear selection"
                >
                  Clear
                </button>
              </div>

              <div className="p-2 space-y-2">
                {/* Size + Rotate sliders */}
                <div className="bg-white rounded border border-gray-100 p-2 space-y-1.5">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-500 w-10">Size</span>
                    <input type="range" min="1" max="50" step="0.5" value={pendingSize} onChange={(e) => setPendingSize(parseFloat(e.target.value))} className="flex-1 accent-[#ec9324]" data-testid="size-slider"/>
                    <span className="text-[10px] font-mono w-7 text-right">{pendingSize}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-500 w-10">Rotate</span>
                    <input type="range" min="0" max="360" step="15" value={pendingRotation} onChange={(e) => setPendingRotation(parseInt(e.target.value))} className="flex-1 accent-[#ec9324]" data-testid="rotation-slider"/>
                    <span className="text-[10px] font-mono w-9 text-right">{pendingRotation}°</span>
                  </div>
                  <div className="flex gap-1 pt-0.5">
                    <button
                      onClick={() => { applyDraftChanges(); setSelectedSeats([]); }}
                      className="flex-1 py-1 bg-[#ec9324] hover:bg-[#d6831f] text-white rounded text-[10px] font-semibold flex items-center justify-center gap-0.5"
                      data-testid="apply-draft-btn"
                    ><Check sx={{ fontSize: 10 }}/> Apply</button>
                    <button
                      onClick={cancelDraftChanges}
                      className="flex-1 py-1 border border-gray-200 hover:bg-gray-50 text-gray-600 rounded text-[10px]"
                      data-testid="cancel-draft-btn"
                    >Cancel</button>
                  </div>
                </div>

                {/* Layout actions */}
                <div className="bg-white rounded border border-gray-100 p-2">
                  <div className="text-[9px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Layout</div>
                  <div className="grid grid-cols-3 gap-1">
                    <BulkBtn label="Smart Align" icon={Wand2} onClick={() => { smartAlign(); setSelectedSeats([]); }} disabled={selectedSeats.length < 2} testId="smart-align-btn"/>
                    <BulkBtn label="Auto-Gen" icon={Wand2} onClick={() => { autoGenerateBay(); setSelectedSeats([]); }} testId="auto-gen-btn"/>
                    <BulkBtn label="Renumber" onClick={() => {
                      const ns = { ...mappedSeats }; let result = ns;
                      const bays = new Set(selectedSeats.map(bayOf));
                      bays.forEach(b => { result = renumberBay(result, b); });
                      commit(result);
                      setSelectedSeats([]);
                    }} disabled={selectedSeats.length === 0} testId="renumber-btn"/>
                  </div>
                </div>

                {/* Lock / Rename / Delete */}
                <div className="bg-white rounded border border-gray-100 p-2">
                  <div className="text-[9px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Manage</div>
                  <div className="grid grid-cols-2 gap-1 mb-1">
                    <BulkBtn label="Lock" icon={Lock} onClick={() => { lockSelected(true); setSelectedSeats([]); }} testId="lock-btn"/>
                    <BulkBtn label="Unlock" icon={Unlock} onClick={() => { lockSelected(false); setSelectedSeats([]); }} testId="unlock-btn"/>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <BulkBtn label="Rename Prefix" onClick={() => { renamePrefix(); /* keep selection so user can verify */ }} testId="rename-prefix-btn"/>
                    <BulkBtn label="Delete" icon={Trash2} onClick={() => { deleteSelected(); /* deleteSelected already clears selection */ }} danger testId="delete-selected-btn"/>
                  </div>
                </div>

                {/* Per-seat rename — only when exactly one seat is selected */}
                {selectedSeats.length === 1 && mappedSeats[selectedSeats[0]] && (
                  <SeatRenameField
                    seatId={selectedSeats[0]}
                    onRename={(newId) => renameSeat(selectedSeats[0], newId)}
                  />
                )}
              </div>
            </div>
          )}
          </>)}

          {/* Meeting Room Calibration tools */}
          {calibMode === 'room' && (
            <RoomToolPanel
              roomTool={roomTool}
              setRoomTool={setRoomTool}
              roomsArray={roomsArray}
              selectedRooms={selectedRooms}
              setSelectedRooms={setSelectedRooms}
              mappedRooms={mappedRooms}
              deleteSelectedRooms={deleteSelectedRooms}
              onRequestRename={(id) => setRenameRoomDialog({ id, name: mappedRooms[id]?.name || '', capacity: mappedRooms[id]?.capacity || 1 })}
            />
          )}

          {/* Undo/Redo */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button onClick={undo} disabled={historyIndex <= 0} className="py-1.5 bg-gray-200 hover:bg-gray-300 rounded text-xs flex items-center justify-center gap-1 disabled:opacity-40" data-testid="undo-btn"><Undo2 sx={{ fontSize: 12 }}/> Undo</button>
            <button onClick={redo} disabled={historyIndex >= history.length - 1} className="py-1.5 bg-gray-200 hover:bg-gray-300 rounded text-xs flex items-center justify-center gap-1 disabled:opacity-40" data-testid="redo-btn"><Redo2 sx={{ fontSize: 12 }}/> Redo</button>
          </div>

          {/* View toggles */}
          <div className="mb-3 space-y-1">
            <label className="flex items-center gap-2 text-[11px] cursor-pointer">
              <input type="checkbox" checked={showCoordinates} onChange={(e) => setShowCoordinates(e.target.checked)} className="accent-[#ec9324]"/>
              Show coordinates
            </label>
            <label className="flex items-center gap-2 text-[11px] cursor-pointer">
              <input type="checkbox" checked={previewMode} onChange={(e) => setPreviewMode(e.target.checked)} className="accent-[#ec9324]"/>
              Preview mode
            </label>
          </div>

          {/* Import/Export */}
          <div className="space-y-1.5">
            <button onClick={exportConfig} disabled={totalMapped === 0} className="w-full py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-xs flex items-center justify-center gap-1 disabled:opacity-40"><Download sx={{ fontSize: 12 }}/> Export JSON</button>
            <label className="w-full py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-xs flex items-center justify-center gap-1 cursor-pointer">
              <Upload sx={{ fontSize: 12 }}/> Import JSON
              <input type="file" accept=".json" onChange={importConfig} className="hidden"/>
            </label>
          </div>
        </div>
      </div>
      )
      )}

      {/* ────────────────────────────── PDF Canvas */}
      <div ref={canvasViewportRef} className="flex-1 overflow-hidden bg-gray-100 relative">
        <TransformWrapper
          initialScale={1}
          minScale={0.25} maxScale={4}
          wheel={{ step: 0.15, smoothStep: 0.01 }} pinch={{ step: 5 }}
          doubleClick={{ disabled: true }}
          panning={{ disabled: toolMode === 'box' || toolMode === 'lasso' || (calibMode === 'room' && roomTool === 'draw'), velocityDisabled: true }}
          centerOnInit={true}
          smooth={true}
          limitToBounds={false}
          onZoom={(ref) => setCurrentZoom(ref.state.scale)}
          onTransformed={(ref) => setCurrentZoom(ref.state.scale)}
          ref={transformRef}
        >
          {({ zoomIn, zoomOut, resetTransform, centerView }) => (
            <>
              <div className="absolute top-3 right-3 z-20 bg-white rounded-lg shadow-lg p-1.5">
                <div className="text-[10px] font-semibold text-center text-gray-700">ZOOM {(currentZoom * 100).toFixed(0)}%</div>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  <button onClick={() => zoomIn()} className="p-1 hover:bg-gray-100 rounded" data-testid="zoom-in-btn"><ZoomIn sx={{ fontSize: 13 }}/></button>
                  <button onClick={() => zoomOut()} className="p-1 hover:bg-gray-100 rounded" data-testid="zoom-out-btn"><ZoomOut sx={{ fontSize: 13 }}/></button>
                  <button onClick={() => { resetTransform(); requestAnimationFrame(() => centerFloorPlan(true)); }} className="p-1 hover:bg-gray-100 rounded" title="Reset zoom" data-testid="zoom-reset-btn"><Maximize2 sx={{ fontSize: 13 }}/></button>
                  <button onClick={() => centerFloorPlan(true)} className="p-1 hover:bg-gray-100 rounded" title="Center floor plan" data-testid="zoom-center-btn"><Maximize sx={{ fontSize: 13 }}/></button>
                </div>
                <select
                  className="text-[10px] p-0.5 border rounded w-full mt-1"
                  value={(() => {
                    // Pick the closest enumerated level so the dropdown reflects the current zoom accurately
                    const nearest = ZOOM_LEVELS.reduce((p, c) => Math.abs(c - currentZoom) < Math.abs(p - currentZoom) ? c : p, ZOOM_LEVELS[0]);
                    return nearest.toFixed(2);
                  })()}
                  onChange={(e) => {
                    const z = parseFloat(e.target.value);
                    const ref = transformRef.current;
                    if (!ref) return;
                    // Zoom around the CURRENT screen center (not the PDF center) so the user's focus point doesn't jump.
                    const vp = canvasViewportRef.current?.getBoundingClientRect();
                    const state = ref.instance?.transformState || ref.state;
                    if (vp && state && ref.setTransform) {
                      const cxScreen = vp.width / 2;
                      const cyScreen = vp.height / 2;
                      // Content point under the current screen center
                      const cxContent = (cxScreen - state.positionX) / state.scale;
                      const cyContent = (cyScreen - state.positionY) / state.scale;
                      // New offsets so the same content point stays under the screen center at the new scale
                      const newX = cxScreen - cxContent * z;
                      const newY = cyScreen - cyContent * z;
                      ref.setTransform(newX, newY, z, 200, "easeOut");
                    } else if (ref.centerView) {
                      ref.centerView(z, 200, "easeOut");
                    }
                  }}
                  data-testid="zoom-select"
                >
                  {ZOOM_LEVELS.map(l => <option key={l} value={l.toFixed(2)}>{(l * 100).toFixed(0)}%</option>)}
                </select>
              </div>

              {showCoordinates && isCalibrating && (
                <div className="absolute top-3 left-3 z-20 bg-white rounded-lg shadow-lg p-2 text-[10px]">
                  <div className="font-semibold">Position</div>
                  <div>X: {mouseCoords.x}%</div>
                  <div>Y: {mouseCoords.y}%</div>
                </div>
              )}

              <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
                <div
                  ref={containerRef}
                  /* View-only mode: short-circuit every editing handler so the
                     PDF can still be panned/zoomed via TransformWrapper, but
                     no seats are placed/moved/deleted on click & drag. */
                  onMouseDown={viewOnly ? undefined : handlePdfMouseDown}
                  onMouseMove={viewOnly ? undefined : handlePdfMouseMove}
                  onMouseUp={viewOnly ? undefined : handlePdfMouseUp}
                  data-testid="pdf-canvas"
                  className={`relative inline-block ${
                    viewOnly ? 'cursor-default' :
                    calibMode === 'room' && roomTool === 'draw' ? 'cursor-crosshair' :
                    calibMode === 'room' && roomTool === 'delete' ? 'cursor-pointer' :
                    calibMode === 'room' ? 'cursor-default' :
                    toolMode === 'place' ? 'cursor-crosshair' :
                    toolMode === 'delete' ? 'cursor-pointer' :
                    toolMode === 'box' || toolMode === 'lasso' ? 'cursor-crosshair' :
                    toolMode === 'select' ? 'cursor-pointer' :
                    'cursor-default'
                  }`}
                >
                  <Document file={resolvePdfUrl(pdfUrl)}>
                    <Page
                      // `key` on the canvas-render DPR forces react-pdf to
                      // re-rasterise the page when the bucket changes — this
                      // is what keeps the floor plan sharp as the user zooms
                      // in. Without the `key`, react-pdf caches the canvas
                      // and the new devicePixelRatio is ignored.
                      key={`pdfpage-dpr-${pdfRenderDpr}`}
                      pageNumber={1}
                      width={pageWidth}
                      devicePixelRatio={pdfRenderDpr}
                      renderMode="canvas"
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      onLoadSuccess={() => {
                        // The PDF canvas now has real dimensions — center the floor plan in the viewport.
                        // Only do this once per mount; subsequent silent reloads (after publish/save) must not reposition.
                        if (viewportInitDoneRef.current) return;
                        viewportInitDoneRef.current = true;
                        requestAnimationFrame(() => centerFloorPlan(false));
                      }}
                    />
                  </Document>

                  {/* Seats */}
                  <div className="absolute inset-0" style={{ pointerEvents: 'none', opacity: calibMode === 'room' ? 0.35 : 1 }}>
                    {seatsArray.map(seat => {
                      const isSelected = selectedSeats.includes(seat.id);
                      const displaySize = isSelected ? pendingSize : (seat.size || 10);
                      const displayRot = isSelected ? pendingRotation : (seat.rotation || 0);
                      const canDrag = calibMode === 'workstation' && !previewMode && !seat.locked && (
                        toolMode === "select" ||
                        ((toolMode === "box" || toolMode === "lasso") && isSelected)
                      );
                      return (
                        <div
                          key={seat.id}
                          className="absolute"
                          style={{
                            left: `${seat.x}%`,
                            top: `${seat.y}%`,
                            transform: 'translate(-50%, -50%)',
                            pointerEvents: calibMode === 'room' ? 'none' : 'auto',
                            cursor: canDrag ? 'move' : (toolMode === 'select' ? 'pointer' : 'inherit'),
                          }}
                          onMouseDown={(e) => !viewOnly && calibMode === 'workstation' && handleSeatMouseDown(seat, e)}
                          data-testid={`seat-${seat.id}`}
                        >
                          <SeatIcon
                            size={displaySize}
                            label={previewMode ? null : seat.label}
                            rotation={displayRot}
                            isSelected={isSelected}
                            isLocked={seat.locked && !previewMode}
                            isOverlap={!previewMode && validation.overlaps.has(seat.id)}
                            isDup={!previewMode && validation.dupes.has(seat.id)}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* Meeting Rooms layer */}
                  <MeetingRoomsLayer
                    rooms={roomsArray}
                    mappedRooms={mappedRooms}
                    setMappedRooms={setMappedRooms}
                    selectedRooms={selectedRooms}
                    setSelectedRooms={setSelectedRooms}
                    calibMode={calibMode}
                    roomTool={roomTool}
                    previewMode={previewMode}
                    dragRoomRef={dragRoomRef}
                    resizeRoomRef={resizeRoomRef}
                    containerRef={containerRef}
                    onRequestRename={(id) => setRenameRoomDialog({ id, name: mappedRooms[id]?.name || '', capacity: mappedRooms[id]?.capacity || 1 })}
                    onDelete={(id) => {
                      const ns = { ...mappedRooms };
                      delete ns[id];
                      commitRooms(ns);
                      setSelectedRooms(prev => prev.filter(x => x !== id));
                    }}
                    setDraftDirty={setDraftDirty}
                  />

                  {/* Drawing room preview */}
                  {drawingRoom && (
                    <div className="absolute pointer-events-none" style={{
                      left: `${Math.min(drawingRoom.x0, drawingRoom.x1)}%`,
                      top: `${Math.min(drawingRoom.y0, drawingRoom.y1)}%`,
                      width: `${Math.abs(drawingRoom.x1 - drawingRoom.x0)}%`,
                      height: `${Math.abs(drawingRoom.y1 - drawingRoom.y0)}%`,
                      border: '1px dashed #ec9324',
                      background: 'rgba(236,147,36,0.10)',
                      zIndex: 30,
                    }}/>
                  )}

                  {/* Box selection rectangle */}
                  {selectionRect && (
                    <div className="absolute pointer-events-none" style={{
                      left: `${Math.min(selectionRect.x1, selectionRect.x2)}%`,
                      top: `${Math.min(selectionRect.y1, selectionRect.y2)}%`,
                      width: `${Math.abs(selectionRect.x2 - selectionRect.x1)}%`,
                      height: `${Math.abs(selectionRect.y2 - selectionRect.y1)}%`,
                      border: '1px dashed #ec9324',
                      background: 'rgba(236,147,36,0.06)',
                    }}/>
                  )}

                  {/* Lasso path */}
                  {lassoPath.length > 1 && (
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 100 100">
                      <polyline
                        points={lassoPath.map(p => `${p.x},${p.y}`).join(' ')}
                        fill="rgba(236,153,36,0.08)"
                        stroke="#ec9324"
                        strokeWidth="0.3"
                        strokeDasharray="0.6 0.4"
                      />
                    </svg>
                  )}

                  {/* Status banner */}
                  {isCalibrating && !previewMode && (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-yellow-500 text-white px-4 py-2 rounded-lg shadow-lg text-xs font-semibold z-50" data-testid="status-banner">
                      {calibMode === 'workstation' && toolMode === null    && 'Pick a tool from the right panel to start calibrating'}
                      {calibMode === 'workstation' && toolMode === 'place'  && (isBayLocked(currentBay)
                        ? `🔒 Bay ${currentBay} locked`
                        : `✓ Place Mode · Bay ${currentBay} · Click to add ${currentBay}${nextSeatNumber}`)}
                      {calibMode === 'workstation' && toolMode === 'select' && '✓ Select Mode · Click seats to edit'}
                      {calibMode === 'workstation' && toolMode === 'box'    && '✓ Multi Select · Drag to select · Hold over selected seat to move'}
                      {calibMode === 'workstation' && toolMode === 'lasso'  && '✓ Lasso Select · Drag freeform shape'}
                      {calibMode === 'workstation' && toolMode === 'delete' && '✓ Delete Mode · Click seats to remove'}
                      {calibMode === 'room' && roomTool === 'draw'   && '✓ Draw Meeting Room · Click and drag to create a room'}
                      {calibMode === 'room' && roomTool === 'select' && '✓ Select Mode · Click a room to edit · Shift+click for multi-select'}
                      {calibMode === 'room' && roomTool === 'delete' && '✓ Delete Mode · Click a room to remove'}
                    </div>
                  )}
                </div>
              </TransformComponent>
            </>
          )}
        </TransformWrapper>
      </div>
    </div>

      {/* Modals & panels */}
      {showPublishDialog && (
        <PublishDialog
          diff={localDiff}
          roomDiff={roomDiff}
          busy={publishing}
          onCancel={() => setShowPublishDialog(false)}
          onConfirm={handlePublish}
        />
      )}
      <VersionHistoryPanel
        planId={planId}
        liveVersionId={plan.live_version_id}
        open={showVersionPanel}
        onClose={() => setShowVersionPanel(false)}
        onRollback={() => { setShowVersionPanel(false); loadPlan(true); }}
      />
      <AuditLogPanel
        planId={planId}
        open={showAuditPanel}
        onClose={() => setShowAuditPanel(false)}
      />

      {/* Meeting Room - Name dialog (after drawing) */}
      {roomNameDialog && (
        <RoomNameModal
          title="Name this meeting room"
          initial={roomNameDialog.suggested}
          initialCapacity={1}
          confirmLabel="Create Room"
          onCancel={() => setRoomNameDialog(null)}
          onConfirm={(name, capacity) => {
            const id = ridGen();
            const { x, y, w, h } = roomNameDialog;
            const room = clampRoom({ id, name, capacity, x, y, w, h });
            commitRooms({ ...mappedRooms, [id]: room });
            setSelectedRooms([id]);
            setRoomNameDialog(null);
            setRoomTool('select');
          }}
        />
      )}

      {/* Meeting Room - Rename dialog */}
      {renameRoomDialog && (
        <RoomNameModal
          title="Edit meeting room"
          initial={renameRoomDialog.name}
          initialCapacity={renameRoomDialog.capacity || 1}
          confirmLabel="Save"
          onCancel={() => setRenameRoomDialog(null)}
          onConfirm={(name, capacity) => {
            const id = renameRoomDialog.id;
            if (mappedRooms[id]) {
              commitRooms({ ...mappedRooms, [id]: { ...mappedRooms[id], name, capacity } });
            }
            setRenameRoomDialog(null);
          }}
        />
      )}

      {/* Unsaved indicator */}
      {draftDirty && (
        <div className="fixed bottom-3 left-3 px-3 py-1.5 bg-blue-600 text-white rounded text-xs shadow-lg flex items-center gap-2 z-30" data-testid="dirty-indicator">
          <AlertCircle sx={{ fontSize: 12 }}/>
          Unsaved draft · auto-saving in 30s
        </div>
      )}
    </Layout>
  );
}

// --------------------------------------------------------------------- Live toggle (On/Off)
function BulkBtn({ label, icon: Icon, onClick, disabled, danger, testId }) {
  const base = "py-1 px-1.5 border rounded text-[10px] flex items-center justify-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const tone = danger
    ? "border-red-200 text-red-600 hover:bg-red-50"
    : "border-gray-200 text-gray-700 hover:border-[#ec9324] hover:text-[#ec9324]";
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={testId} className={`${base} ${tone}`}>
      {Icon ? <Icon size={10}/> : null}
      <span>{label}</span>
    </button>
  );
}

function LiveToggle({ plan, draftDirty, totalMapped, hasDupes, onPublishRequested, onSetStatus, onAutoPublish }) {
  const hasLive = !!plan?.live_version_id;
  const isLive = hasLive && plan?.status !== "inactive";

  const handleToggle = () => {
    if (isLive) {
      onSetStatus("inactive");
      return;
    }
    // Turning ON. If there are ANY pending changes (dirty local edits OR a
    // saved backend draft), we must publish before going live — otherwise
    // the "Live" flag would just flip while the changes stay stuck in draft
    // (which is what caused meeting rooms not to appear on the booking
    // page after users toggled off/on).
    const hasPendingChanges = draftDirty || !!plan?.has_draft || !hasLive;
    if (hasPendingChanges) {
      if (totalMapped === 0) {
        notify.warning('Place at least one seat before going Live.');
        return;
      }
      if (hasDupes) {
        notify.warning('Resolve duplicate seat IDs before publishing.');
        return;
      }
      // If we already have a live version and only need to promote the
      // saved draft (no local dirty edits), publish silently — the user
      // clearly meant "make my changes live". Otherwise open the dialog
      // so unsaved local edits can be reviewed before publish.
      if (hasLive && !draftDirty && plan?.has_draft && typeof onAutoPublish === "function") {
        onAutoPublish();
      } else {
        onPublishRequested();
      }
    } else {
      onSetStatus("live");
    }
  };

  return (
    <div className="flex items-center justify-between bg-white border border-gray-200 rounded px-3 py-1.5">
      <span className="text-[11px] font-semibold text-gray-700">Live</span>
      <button
        type="button"
        onClick={handleToggle}
        data-testid="live-toggle"
        aria-pressed={isLive}
        title={isLive ? "Plan is Live — click to mark Inactive" : "Click to go Live"}
        className="relative inline-flex items-center w-[52px] h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#ec9324]"
        style={{ backgroundColor: isLive ? "#ec9324" : "#b2b2b2" }}
      >
        {/* Label visible in the coloured area */}
        <span
          className="absolute text-[9px] font-bold text-white pointer-events-none select-none"
          style={isLive ? { left: 7 } : { right: 7 }}
        >
          {isLive ? "On" : "Off"}
        </span>
        {/* Sliding knob */}
        <span
          className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200"
          style={{ transform: isLive ? "translateX(28px)" : "translateX(2px)" }}
        />
      </button>
    </div>
  );
}

// --------------------------------------------------------------------- Per-seat rename input
function SeatRenameField({ seatId, onRename }) {
  const [val, setVal] = React.useState(seatId);
  React.useEffect(() => { setVal(seatId); }, [seatId]);
  const submit = () => { if (val.trim() && val.trim().toUpperCase() !== seatId) onRename(val.trim()); };
  return (
    <div className="mt-2 p-1.5 bg-white border rounded">
      <div className="text-[10px] font-semibold text-gray-600 mb-1">RENAME SEAT</div>
      <div className="flex gap-1">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          className="flex-1 px-2 py-1 border rounded text-[11px] font-mono uppercase"
          placeholder="e.g. A12"
          data-testid="seat-rename-input"
          maxLength={8}
        />
        <button
          onClick={submit}
          className="px-2 py-1 bg-indigo-500 text-white rounded text-[10px] font-semibold"
          data-testid="seat-rename-submit"
        >Save</button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- Meeting Room toolbar
function RoomToolPanel({ roomTool, setRoomTool, roomsArray, selectedRooms, setSelectedRooms, mappedRooms, deleteSelectedRooms, onRequestRename }) {
  return (
    <>
      <div className="mb-3 p-2 bg-gray-50 rounded" data-testid="room-tool-panel">
        <div className="text-[10px] font-semibold mb-1.5 text-gray-700">TOOL MODE</div>
        <div className="grid grid-cols-3 gap-1">
          {[
            { mode: 'draw',   Icon: Square,   label: 'Draw Meeting Room' },
            { mode: 'select', Icon: Settings, label: 'Select' },
            { mode: 'delete', Icon: Trash2,   label: 'Delete' },
          ].map(({ mode, Icon, label }) => {
            const active = roomTool === mode;
            return (
              <button
                key={mode}
                onClick={() => setRoomTool(mode)}
                data-testid={`room-tool-${mode}`}
                title={label}
                className={`p-1.5 rounded text-[9px] flex flex-col items-center gap-0.5 border transition-colors ${
                  active
                    ? 'bg-[#ec9324] text-white border-[#ec9324]'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-[#ec9324] hover:text-[#ec9324]'
                }`}
              >
                <Icon size={12}/>
                <span className="leading-tight text-center">{label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 text-[10px] text-gray-500">
          {roomsArray.length} meeting room{roomsArray.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Selection panel */}
      {selectedRooms.length > 0 && (
        <div className="mb-3 border border-[#ec9324]/40 bg-orange-50/60 rounded overflow-hidden" data-testid="room-bulk-panel">
          <div className="px-2 py-1.5 bg-[#ec9324]/10 flex items-center justify-between border-b border-[#ec9324]/20">
            <span className="text-[11px] font-bold text-[#ec9324]">{selectedRooms.length} room{selectedRooms.length === 1 ? '' : 's'} selected</span>
            <button onClick={() => setSelectedRooms([])} className="text-[10px] text-gray-600 hover:text-gray-900" data-testid="room-clear-selection">Clear</button>
          </div>
          <div className="p-2 space-y-1.5">
            {selectedRooms.length === 1 && mappedRooms[selectedRooms[0]] && (
              <div className="bg-white rounded border border-gray-100 p-2 space-y-2">
                <div>
                  <div className="text-[9px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Name</div>
                  <div className="text-[11px] font-semibold text-gray-800 truncate" title={mappedRooms[selectedRooms[0]].name}>
                    {mappedRooms[selectedRooms[0]].name}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Seats</div>
                  <div className="text-[11px] font-semibold text-gray-800" data-testid="room-capacity-display">
                    {mappedRooms[selectedRooms[0]].capacity || 1}
                  </div>
                </div>
                <button
                  onClick={() => onRequestRename(selectedRooms[0])}
                  className="w-full text-[10px] px-2 py-1.5 border border-gray-200 hover:border-[#ec9324] hover:text-[#ec9324] rounded"
                  data-testid="room-rename-btn"
                >Edit Room</button>
              </div>
            )}
            <button
              onClick={deleteSelectedRooms}
              className="w-full py-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded text-[10px] font-semibold flex items-center justify-center gap-1"
              data-testid="room-delete-selected"
            >
              <Trash2 sx={{ fontSize: 11 }}/> Delete {selectedRooms.length > 1 ? 'rooms' : 'room'}
            </button>
            <div className="text-[9px] text-gray-500 leading-relaxed pt-1">
              Move: drag or arrow keys (Shift=5px, Ctrl=10px). Resize: drag handles (single selection).
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// --------------------------------------------------------------------- Meeting Rooms layer (on the PDF canvas)
function MeetingRoomsLayer({
  rooms, mappedRooms, setMappedRooms,
  selectedRooms, setSelectedRooms,
  calibMode, roomTool, previewMode,
  dragRoomRef, resizeRoomRef,
  containerRef, onRequestRename, onDelete,
  setDraftDirty,
}) {
  const interactive = calibMode === 'room' && !previewMode;
  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const cursorFor = (h) => ({ n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }[h] || 'default');

  const onRoomMouseDown = (room, e) => {
    if (!interactive) return;
    if (roomTool === 'delete') {
      e.stopPropagation();
      onDelete(room.id);
      return;
    }
    if (roomTool !== 'select') return;
    e.stopPropagation();
    e.preventDefault();
    // Selection management
    const already = selectedRooms.includes(room.id);
    let nextSel;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      nextSel = already ? selectedRooms.filter(x => x !== room.id) : [...selectedRooms, room.id];
    } else {
      nextSel = already ? selectedRooms : [room.id];
    }
    setSelectedRooms(nextSel);
    // Prepare drag
    const rect = containerRef.current.getBoundingClientRect();
    const startPositions = {};
    nextSel.forEach(id => {
      const r = mappedRooms[id];
      if (r) startPositions[id] = { x: r.x, y: r.y };
    });
    dragRoomRef.current = {
      ids: nextSel,
      startMouseX: e.clientX, startMouseY: e.clientY,
      rectW: rect.width, rectH: rect.height,
      startPositions,
      moved: false,
    };
  };

  const onHandleMouseDown = (room, handle, e) => {
    if (!interactive || roomTool !== 'select') return;
    e.stopPropagation();
    e.preventDefault();
    setSelectedRooms([room.id]);
    const rect = containerRef.current.getBoundingClientRect();
    resizeRoomRef.current = {
      id: room.id,
      handle,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      rectW: rect.width,
      rectH: rect.height,
      startBox: { x: room.x, y: room.y, w: room.w, h: room.h },
    };
  };

  return (
    <div className="absolute inset-0" style={{ pointerEvents: 'none' }} data-testid="rooms-layer">
      {rooms.map(room => {
        const isSelected = selectedRooms.includes(room.id);
        const bg = isSelected ? 'rgba(236,147,36,0.45)' : 'rgba(255,255,255,0.0)';
        const borderColor = isSelected ? '#ec9324' : '#9ca3af';
        return (
          <div
            key={room.id}
            className="absolute meeting-room"
            data-testid={`room-${room.id}`}
            style={{
              left: `${room.x}%`,
              top: `${room.y}%`,
              width: `${room.w}%`,
              height: `${room.h}%`,
              background: bg,
              border: `${isSelected ? '1.5px' : '1px'} solid ${borderColor}`,
              boxSizing: 'border-box',
              pointerEvents: interactive ? 'auto' : 'none',
              cursor: roomTool === 'select' ? (isSelected ? 'move' : 'pointer') : (roomTool === 'delete' ? 'pointer' : 'inherit'),
              zIndex: 20,
              transition: 'background 120ms, border-color 120ms',
              containerType: 'size',
            }}
            onMouseDown={(e) => !window.location.search.includes('view=1') && onRoomMouseDown(room, e)}
            onDoubleClick={(e) => { if (interactive) { e.stopPropagation(); onRequestRename(room.id); } }}
            onContextMenu={(e) => { if (interactive) { e.preventDefault(); onRequestRename(room.id); } }}
            onMouseEnter={(e) => {
              if (!interactive || isSelected) return;
              e.currentTarget.style.background = 'rgba(236,147,36,0.16)';
              e.currentTarget.style.borderColor = '#ec9324';
            }}
            onMouseLeave={(e) => {
              if (!interactive || isSelected) return;
              e.currentTarget.style.background = 'rgba(255,255,255,0.0)';
              e.currentTarget.style.borderColor = '#9ca3af';
            }}
          >
            {/* Room label — centered, two-line stack matching the naming
                convention used elsewhere in the app (Room name + "Seats : N").
                Uses container-query units so it scales with the room box. */}
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 pointer-events-none select-none"
              style={{
                fontSize: 'clamp(6px, 15cqh, 13px)',
                lineHeight: 1.15,
              }}
            >
              <div
                className="font-semibold rounded"
                style={{
                  background: isSelected ? '#ec9324' : 'rgba(255,255,255,0.9)',
                  color: isSelected ? 'white' : '#111827',
                  padding: '1px 5px',
                  maxWidth: '92%',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {room.name}
              </div>
              {room.capacity != null && (
                <div
                  className="font-medium rounded text-white"
                  style={{
                    background: 'rgba(17,24,39,0.75)',
                    padding: '0.5px 5px',
                    fontSize: '0.85em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Seats : {room.capacity}
                </div>
              )}
            </div>

            {/* Resize handles — only on single selection */}
            {interactive && roomTool === 'select' && isSelected && selectedRooms.length === 1 && handles.map(h => {
              const pos = {
                nw: { left: -4, top: -4 }, n: { left: '50%', top: -4, marginLeft: -4 },
                ne: { right: -4, top: -4 }, e: { right: -4, top: '50%', marginTop: -4 },
                se: { right: -4, bottom: -4 }, s: { left: '50%', bottom: -4, marginLeft: -4 },
                sw: { left: -4, bottom: -4 }, w: { left: -4, top: '50%', marginTop: -4 },
              }[h];
              return (
                <div
                  key={h}
                  onMouseDown={(e) => onHandleMouseDown(room, h, e)}
                  data-testid={`room-handle-${h}`}
                  style={{
                    position: 'absolute',
                    width: 8, height: 8,
                    background: '#fff',
                    border: '1.5px solid #ec9324',
                    borderRadius: 2,
                    cursor: cursorFor(h),
                    zIndex: 21,
                    ...pos,
                  }}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// --------------------------------------------------------------------- Room form modal (name + capacity)
function RoomNameModal({ title, initial, initialCapacity, confirmLabel, onCancel, onConfirm }) {
  const [name, setName] = React.useState(initial || '');
  const [capacity, setCapacity] = React.useState(initialCapacity || 1);
  const [touched, setTouched] = React.useState(false);
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    setName(initial || '');
    setCapacity(initialCapacity || 1);
    setTouched(false);
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 30);
  }, [initial, initialCapacity]);

  const nameError = touched && !name.trim() ? 'Meeting Room Name is required' : '';
  const capError = touched && (!capacity || capacity < 1 || capacity > 20) ? 'Number of Seats is required' : '';
  const valid = name.trim() && capacity >= 1 && capacity <= 20;

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    onConfirm(name.trim(), Number(capacity));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="room-name-modal"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-white rounded-lg shadow-xl w-[400px] p-5">
        <div className="text-sm font-bold text-gray-900 mb-3">{title}</div>

        {/* Name */}
        <label className="block text-[11px] font-semibold text-gray-700 mb-1">
          Meeting Room Name <span className="text-red-500">*</span>
        </label>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
          placeholder="e.g. Board Room, Conference Room A"
          className={`w-full px-3 py-2 border rounded text-sm focus:outline-none ${nameError ? 'border-red-400 focus:border-red-500' : 'border-gray-300 focus:border-emerald-500'}`}
          data-testid="room-name-input"
          maxLength={80}
        />
        {nameError && <div className="text-[11px] text-red-600 mt-1" data-testid="room-name-error">{nameError}</div>}

        {/* Capacity */}
        <label className="block text-[11px] font-semibold text-gray-700 mt-3 mb-1">
          Number of Seats <span className="text-red-500">*</span>
        </label>
        <select
          value={capacity}
          onChange={(e) => setCapacity(parseInt(e.target.value, 10))}
          className={`w-full px-3 py-2 border rounded text-sm bg-white focus:outline-none ${capError ? 'border-red-400 focus:border-red-500' : 'border-gray-300 focus:border-emerald-500'}`}
          data-testid="room-capacity-select"
        >
          {Array.from({ length: 20 }, (_, i) => i + 1).map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        {capError && <div className="text-[11px] text-red-600 mt-1" data-testid="room-capacity-error">{capError}</div>}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm border border-gray-200 rounded hover:bg-gray-50" data-testid="room-name-cancel">Cancel</button>
          <button
            onClick={submit}
            disabled={touched && !valid}
            className="px-3 py-1.5 text-sm bg-emerald-500 hover:bg-emerald-600 text-white rounded disabled:opacity-40"
            data-testid="room-name-confirm"
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
