import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import {
  Download, Upload, X, ZoomIn, ZoomOut, Maximize2, ChevronLeft, ChevronRight,
  Minus, MoreVertical, Wand2, MapPin, Trash2, Square, Lasso,
  Undo2, Redo2, Maximize, Settings, Check, Cloud, Lock, Unlock,
  History, Activity, ArrowLeft, Save, Send, AlertCircle, Grid
} from 'lucide-react';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import api from '../lib/api';
import PublishDialog from '../components/calibration/PublishDialog';
import VersionHistoryPanel from '../components/calibration/VersionHistoryPanel';
import AuditLogPanel from '../components/calibration/AuditLogPanel';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

// ---------------------------------------------------------------- Seat icon
const SeatIcon = ({ size = 10, label, rotation = 0, isSelected = false, isLocked = false, isOverlap = false, isDup = false }) => (
  <div style={{ width: size, height: size, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `rotate(${rotation}deg)` }}>
    <img
      src="https://customer-assets.emergentagent.com/job_workspace-manager-19/artifacts/96yixbn4_pngegg.png"
      alt="seat"
      style={{
        width: '100%', height: '100%', objectFit: 'contain',
        filter: isSelected ? 'drop-shadow(0 0 4px #00FF00)' :
                isDup ? 'drop-shadow(0 0 4px #ef4444)' :
                isOverlap ? 'drop-shadow(0 0 4px #f59e0b)' : 'none',
      }}
    />
    {label && (
      <div style={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        fontSize: Math.max(3, size * 0.25) + 'px', fontWeight: 'bold', color: '#000',
        pointerEvents: 'none', whiteSpace: 'nowrap',
        textShadow: '0 0 3px white, 0 0 3px white, 0 0 3px white', zIndex: 10
      }}>{label}</div>
    )}
    {isLocked && (
      <Lock size={Math.max(6, size * 0.4)} style={{ position: 'absolute', top: -size * 0.15, right: -size * 0.15, color: '#475569', background: 'white', borderRadius: '50%', padding: 1 }} />
    )}
    {isSelected && <div style={{ position: 'absolute', inset: -2, border: '2px solid #00FF00', borderRadius: '4px', pointerEvents: 'none' }} />}
    {isDup && <div style={{ position: 'absolute', inset: -2, border: '2px dashed #ef4444', borderRadius: '4px', pointerEvents: 'none' }} />}
    {isOverlap && !isDup && <div style={{ position: 'absolute', inset: -2, border: '2px dashed #f59e0b', borderRadius: '4px', pointerEvents: 'none' }} />}
  </div>
);

const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5];
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

  // ---- plan + persistence state
  const [plan, setPlan] = useState(null);            // backend doc
  const [liveSeats, setLiveSeats] = useState([]);    // baseline for diff
  const [pdfUrl, setPdfUrl] = useState('');
  const [pageWidth] = useState(1200);
  const [loadingPlan, setLoadingPlan] = useState(true);

  // ---- editing state
  const [mappedSeats, setMappedSeats] = useState({});
  const [currentBay, setCurrentBay] = useState('A');
  const [toolMode, setToolMode] = useState('place'); // place|select|delete|box|lasso
  const [isCalibrating, setIsCalibrating] = useState(true);
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [previewMode, setPreviewMode] = useState(false);
  const [mouseCoords, setMouseCoords] = useState({ x: 0, y: 0 });
  const [currentZoom, setCurrentZoom] = useState(1);
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

  // ---------------------------- Load plan
  const loadPlan = useCallback(async () => {
    setLoadingPlan(true);
    try {
      const res = await api.get(`/floor-plans/${planId}`);
      setPlan(res.data);
      setPdfUrl(res.data.pdfUrl);
      const seatsSrc = res.data.draft?.seats || res.data.live_seats || [];
      const seatsObj = Object.fromEntries(seatsSrc.map(s => [s.id, s]));
      setMappedSeats(seatsObj);
      setLiveSeats(res.data.live_seats || []);
      setHistory([seatsObj]);
      setHistoryIndex(0);
      setDraftDirty(false);
      setLastSaved(res.data.draft_updated_at || null);
    } catch (e) {
      alert(`Failed to load plan: ${e?.response?.data?.detail || e.message}`);
    } finally { setLoadingPlan(false); }
  }, [planId]);
  useEffect(() => { loadPlan(); }, [loadPlan]);

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

  // ---------------------------- Drag-vs-click PDF interaction
  const handlePdfMouseDown = (e) => {
    if (!isCalibrating) return;
    const rect = e.currentTarget.getBoundingClientRect();
    mouseDownPosRef.current = {
      sx: e.clientX, sy: e.clientY,
      px: ((e.clientX - rect.left) / rect.width) * 100,
      py: ((e.clientY - rect.top) / rect.height) * 100,
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
        commit(ns);
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
    selectedSeats.forEach(id => {
      if (ns[id]?.locked) { blocked++; return; }
      delete ns[id];
    });
    if (blocked > 0) setValidationError(`${blocked} locked seat(s) skipped.`);
    commit(ns);
    setSelectedSeats([]);
  };

  const lockSelected = (lock) => applyToSelected(() => ({ locked: lock }), false);
  const renamePrefix = () => {
    if (selectedSeats.length === 0) return;
    const newPrefix = window.prompt('New bay prefix (e.g. "Z"):', '');
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

  const alignSelected = (type) => {
    if (selectedSeats.length < 2) return;
    const ns = { ...mappedSeats };
    const arr = selectedSeats.map(id => ns[id]).filter(Boolean);
    if (type === 'horizontal') {
      const sorted = [...arr].sort((a, b) => a.x - b.x);
      const avgY = sorted.reduce((s, x) => s + x.y, 0) / sorted.length;
      const minX = sorted[0].x, maxX = sorted[sorted.length - 1].x;
      const spacing = (maxX - minX) / (sorted.length - 1);
      sorted.forEach((s, i) => {
        if (s.locked) return;
        ns[s.id] = { ...s, y: r2(avgY), x: i === 0 || i === sorted.length - 1 ? s.x : r2(minX + spacing * i) };
      });
    } else {
      const sorted = [...arr].sort((a, b) => a.y - b.y);
      const avgX = sorted.reduce((s, x) => s + x.x, 0) / sorted.length;
      const minY = sorted[0].y, maxY = sorted[sorted.length - 1].y;
      const spacing = (maxY - minY) / (sorted.length - 1);
      sorted.forEach((s, i) => {
        if (s.locked) return;
        ns[s.id] = { ...s, x: r2(avgX), y: i === 0 || i === sorted.length - 1 ? s.y : r2(minY + spacing * i) };
      });
    }
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
        name: plan.name, pdfUrl, seats: Object.values(mappedSeats),
      });
      setLastSaved(new Date().toISOString());
      setDraftDirty(false);
      if (!silent) setValidationError('');
    } catch (e) {
      if (!silent) alert(`Save failed: ${e?.response?.data?.detail || e.message}`);
    } finally { setSaving(false); }
  }, [plan, planId, pdfUrl, mappedSeats]);

  const handlePublish = async (comments) => {
    setPublishing(true);
    try {
      // Persist current state as draft first
      await api.put(`/floor-plans/${planId}/draft`, { name: plan.name, pdfUrl, seats: Object.values(mappedSeats) });
      await api.post(`/floor-plans/${planId}/publish`, { comments });
      setShowPublishDialog(false);
      await loadPlan();
    } catch (e) {
      alert(`Publish failed: ${e?.response?.data?.detail || e.message}`);
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
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (e.key === 'Delete' && selectedSeats.length > 0) { e.preventDefault(); deleteSelected(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.shiftKey) { e.preventDefault(); saveDraft(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, selectedSeats, mappedSeats, saveDraft]);

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
    <div className="flex h-screen bg-gray-50">
      {/* ────────────────────────────── Left toolbar */}
      <div className="w-80 bg-white border-r overflow-y-auto" data-testid="calibration-toolbar">
        <div className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => {
              if (draftDirty && !window.confirm('Unsaved draft changes will be kept on the server. Leave anyway?')) return;
              navigate('/workspace-manager/floor-plans');
            }} className="p-1 hover:bg-gray-100 rounded" data-testid="back-to-plans-btn">
              <ArrowLeft size={16} />
            </button>
            <h1 className="text-lg font-bold truncate">{plan.name}</h1>
          </div>
          <div className="text-xs text-gray-500 mb-3">
            v{plan?.live_version_id ? '(live exists)' : 'unpublished'} · {totalMapped} seats
            {draftDirty && <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-semibold">Draft</span>}
          </div>

          {/* Save / Publish */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button onClick={() => saveDraft()} disabled={saving || !draftDirty} data-testid="save-draft-btn"
              className="py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
              <Save size={13}/>{saving ? 'Saving…' : 'Save Draft'}
            </button>
            <button onClick={() => setShowPublishDialog(true)} disabled={totalMapped === 0 || validation.dupes.size > 0}
              data-testid="publish-btn"
              title={validation.dupes.size > 0 ? 'Resolve duplicate IDs first' : 'Publish current state to Live'}
              className="py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
              <Send size={13}/>Publish Live
            </button>
          </div>
          <div className="text-[10px] text-gray-500 mb-3">
            {lastSaved ? `Saved ${new Date(lastSaved).toLocaleTimeString()}` : 'Not saved yet'} · auto-save every 30s
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
                  <button onClick={() => setValidationError('')} className="text-red-700"><X size={12}/></button>
                </div>
              )}
            </div>
          )}

          {/* History / Audit toggles */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button onClick={() => { setShowAuditPanel(false); setShowVersionPanel(true); }} className="py-1.5 text-xs border border-gray-200 hover:bg-gray-50 rounded flex items-center justify-center gap-1" data-testid="open-versions-btn">
              <History size={12}/> Versions
            </button>
            <button onClick={() => { setShowVersionPanel(false); setShowAuditPanel(true); }} className="py-1.5 text-xs border border-gray-200 hover:bg-gray-50 rounded flex items-center justify-center gap-1" data-testid="open-audit-btn">
              <Activity size={12}/> Audit
            </button>
          </div>

          {/* Tool mode */}
          <div className="mb-3 p-2 bg-gray-50 rounded">
            <div className="text-[10px] font-semibold mb-1.5 text-gray-700">TOOL MODE</div>
            <div className="grid grid-cols-5 gap-1">
              {[
                { mode: 'place',  Icon: MapPin, color: 'bg-blue-500' },
                { mode: 'select', Icon: Settings, color: 'bg-green-500' },
                { mode: 'box',    Icon: Square, color: 'bg-purple-500' },
                { mode: 'lasso',  Icon: Lasso, color: 'bg-pink-500' },
                { mode: 'delete', Icon: Trash2, color: 'bg-red-500' },
              ].map(({ mode, Icon, color }) => (
                <button key={mode} onClick={() => { setToolMode(mode); setIsCalibrating(true); }}
                  data-testid={`tool-${mode}`}
                  className={`p-1.5 rounded text-[10px] flex flex-col items-center gap-0.5 capitalize ${toolMode === mode ? `${color} text-white` : 'bg-white border'}`}>
                  <Icon size={12}/>{mode}
                </button>
              ))}
            </div>
          </div>

          {/* Bay controls */}
          <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded">
            <div className="text-[10px] font-semibold mb-1.5 text-blue-900">BAY · {isBayLocked(currentBay) && <Lock size={10} className="inline"/>}</div>
            <div className="flex items-center gap-1 mb-1">
              <button onClick={() => setCurrentBay(String.fromCharCode(Math.max(65, currentBay.charCodeAt(0) - 1)))} className="p-1 bg-white border rounded"><ChevronLeft size={12}/></button>
              <select value={currentBay} onChange={(e) => setCurrentBay(e.target.value)} className="flex-1 px-1.5 py-1 border rounded text-xs font-bold" data-testid="bay-select">
                {Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)).map(l => <option key={l} value={l}>Bay {l}</option>)}
              </select>
              <button onClick={() => setCurrentBay(String.fromCharCode(Math.min(90, currentBay.charCodeAt(0) + 1)))} className="p-1 bg-white border rounded"><ChevronRight size={12}/></button>
            </div>
            <div className="flex justify-between items-center text-[10px] text-blue-700">
              <span>{currentBaySeats.length} seat(s)</span>
              <button onClick={() => toggleBayLock(currentBay, !isBayLocked(currentBay))} className="flex items-center gap-0.5 hover:underline" data-testid="bay-lock-toggle">
                {isBayLocked(currentBay) ? <><Unlock size={10}/> unlock bay</> : <><Lock size={10}/> lock bay</>}
              </button>
            </div>
          </div>

          {/* Snap to grid */}
          <div className="mb-3 p-2 bg-gray-50 rounded">
            <div className="flex items-center justify-between text-[10px] font-semibold text-gray-700 mb-1.5">
              <span><Grid size={10} className="inline mr-1"/>SNAP TO GRID</span>
              <span>{snapGrid ? `${snapGrid}px` : 'Off'}</span>
            </div>
            <div className="flex gap-1">
              {GRID_SIZES.map(g => (
                <button key={g} onClick={() => setSnapGrid(g)} data-testid={`snap-${g}`}
                  className={`flex-1 py-1 text-[10px] rounded ${snapGrid === g ? 'bg-[#ec9324] text-white' : 'bg-white border'}`}>
                  {g === 0 ? 'Off' : g}
                </button>
              ))}
            </div>
          </div>

          {/* Selected / Bulk Actions */}
          {selectedSeats.length > 0 && (
            <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded" data-testid="bulk-panel">
              <div className="text-[10px] font-semibold mb-1.5 text-amber-900">
                {selectedSeats.length} selected{lockedCount > 0 ? ` · ${lockedCount} locked total` : ''}
              </div>

              <div className="mb-2 p-1.5 bg-white rounded border space-y-1.5">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] w-12">Size</span>
                  <input type="range" min="1" max="50" step="0.5" value={pendingSize} onChange={(e) => setPendingSize(parseFloat(e.target.value))} className="flex-1" data-testid="size-slider"/>
                  <span className="text-[10px] w-6">{pendingSize}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] w-12">Rotate</span>
                  <input type="range" min="0" max="360" step="15" value={pendingRotation} onChange={(e) => setPendingRotation(parseInt(e.target.value))} className="flex-1" data-testid="rotation-slider"/>
                  <span className="text-[10px] w-6">{pendingRotation}°</span>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <button onClick={applyDraftChanges} className="py-1 bg-green-500 text-white rounded text-[10px] flex items-center justify-center gap-0.5" data-testid="apply-draft-btn"><Check size={10}/>Apply</button>
                  <button onClick={cancelDraftChanges} className="py-1 bg-gray-400 text-white rounded text-[10px]" data-testid="cancel-draft-btn">Cancel</button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1 mb-1">
                <button onClick={() => alignSelected('horizontal')} disabled={selectedSeats.length < 2} className="py-1 bg-blue-500 text-white rounded text-[10px] disabled:opacity-50" data-testid="align-h-btn"><Minus size={10} className="inline"/>H</button>
                <button onClick={() => alignSelected('vertical')} disabled={selectedSeats.length < 2} className="py-1 bg-blue-500 text-white rounded text-[10px] disabled:opacity-50" data-testid="align-v-btn"><MoreVertical size={10} className="inline"/>V</button>
                <button onClick={autoGenerateBay} className="py-1 bg-purple-500 text-white rounded text-[10px]" data-testid="auto-gen-btn"><Wand2 size={10} className="inline"/>Auto</button>
              </div>
              <div className="grid grid-cols-2 gap-1 mb-1">
                <button onClick={() => lockSelected(true)} className="py-1 bg-slate-600 text-white rounded text-[10px]" data-testid="lock-btn"><Lock size={10} className="inline"/> Lock</button>
                <button onClick={() => lockSelected(false)} className="py-1 bg-slate-400 text-white rounded text-[10px]" data-testid="unlock-btn"><Unlock size={10} className="inline"/> Unlock</button>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <button onClick={renamePrefix} className="py-1 bg-indigo-500 text-white rounded text-[10px]" data-testid="rename-prefix-btn">Rename Prefix</button>
                <button onClick={deleteSelected} className="py-1 bg-red-500 text-white rounded text-[10px]" data-testid="delete-selected-btn"><Trash2 size={10} className="inline"/> Delete</button>
              </div>
            </div>
          )}

          {/* Undo/Redo */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button onClick={undo} disabled={historyIndex <= 0} className="py-1.5 bg-gray-200 hover:bg-gray-300 rounded text-xs flex items-center justify-center gap-1 disabled:opacity-40" data-testid="undo-btn"><Undo2 size={12}/> Undo</button>
            <button onClick={redo} disabled={historyIndex >= history.length - 1} className="py-1.5 bg-gray-200 hover:bg-gray-300 rounded text-xs flex items-center justify-center gap-1 disabled:opacity-40" data-testid="redo-btn"><Redo2 size={12}/> Redo</button>
          </div>

          {/* View toggles */}
          <div className="mb-3 space-y-1">
            <label className="flex items-center gap-2 text-[11px]">
              <input type="checkbox" checked={showCoordinates} onChange={(e) => setShowCoordinates(e.target.checked)}/>
              Show coordinates
            </label>
            <label className="flex items-center gap-2 text-[11px]">
              <input type="checkbox" checked={previewMode} onChange={(e) => setPreviewMode(e.target.checked)}/>
              Preview mode
            </label>
          </div>

          {/* Import/Export */}
          <div className="space-y-1.5">
            <button onClick={exportConfig} disabled={totalMapped === 0} className="w-full py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-xs flex items-center justify-center gap-1 disabled:opacity-40"><Download size={12}/> Export JSON</button>
            <label className="w-full py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-xs flex items-center justify-center gap-1 cursor-pointer">
              <Upload size={12}/> Import JSON
              <input type="file" accept=".json" onChange={importConfig} className="hidden"/>
            </label>
          </div>
        </div>
      </div>

      {/* ────────────────────────────── PDF Canvas */}
      <div className="flex-1 overflow-hidden bg-gray-100 relative">
        <TransformWrapper
          initialScale={1} minScale={0.25} maxScale={5}
          wheel={{ step: 0.1 }} pinch={{ step: 5 }}
          doubleClick={{ disabled: true }}
          panning={{ disabled: toolMode === 'box' || toolMode === 'lasso', velocityDisabled: true }}
          centerOnInit={true}
          onZoom={(ref) => setCurrentZoom(ref.state.scale)}
          ref={transformRef}
        >
          {({ zoomIn, zoomOut, resetTransform, centerView }) => (
            <>
              <div className="absolute top-3 right-3 z-20 bg-white rounded-lg shadow-lg p-1.5">
                <div className="text-[10px] font-semibold text-center text-gray-700">ZOOM {(currentZoom * 100).toFixed(0)}%</div>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  <button onClick={() => zoomIn()} className="p-1 hover:bg-gray-100 rounded"><ZoomIn size={13}/></button>
                  <button onClick={() => zoomOut()} className="p-1 hover:bg-gray-100 rounded"><ZoomOut size={13}/></button>
                  <button onClick={() => resetTransform()} className="p-1 hover:bg-gray-100 rounded"><Maximize2 size={13}/></button>
                  <button onClick={() => centerView()} className="p-1 hover:bg-gray-100 rounded"><Maximize size={13}/></button>
                </div>
                <select className="text-[10px] p-0.5 border rounded w-full mt-1" value={currentZoom.toFixed(2)} onChange={(e) => { const z = parseFloat(e.target.value); resetTransform(); setTimeout(() => zoomIn(z - 1), 50); }}>
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
                  onMouseDown={handlePdfMouseDown}
                  onMouseMove={handlePdfMouseMove}
                  onMouseUp={handlePdfMouseUp}
                  data-testid="pdf-canvas"
                  className={`relative inline-block ${
                    toolMode === 'place' ? 'cursor-crosshair' :
                    toolMode === 'delete' ? 'cursor-pointer' :
                    toolMode === 'box' || toolMode === 'lasso' ? 'cursor-crosshair' :
                    'cursor-pointer'
                  }`}
                >
                  <Document file={pdfUrl}>
                    <Page pageNumber={1} width={pageWidth} renderTextLayer={false} renderAnnotationLayer={false}/>
                  </Document>

                  {/* Seats */}
                  <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
                    {seatsArray.map(seat => {
                      const isSelected = selectedSeats.includes(seat.id);
                      const displaySize = isSelected ? pendingSize : (seat.size || 10);
                      const displayRot = isSelected ? pendingRotation : (seat.rotation || 0);
                      return (
                        <div key={seat.id} className="absolute" style={{ left: `${seat.x}%`, top: `${seat.y}%`, transform: 'translate(-50%, -50%)', pointerEvents: 'auto' }}>
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

                  {/* Box selection rectangle */}
                  {selectionRect && (
                    <div className="absolute pointer-events-none" style={{
                      left: `${Math.min(selectionRect.x1, selectionRect.x2)}%`,
                      top: `${Math.min(selectionRect.y1, selectionRect.y2)}%`,
                      width: `${Math.abs(selectionRect.x2 - selectionRect.x1)}%`,
                      height: `${Math.abs(selectionRect.y2 - selectionRect.y1)}%`,
                      border: '2px dashed #3b82f6',
                      background: 'rgba(59,130,246,0.08)',
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
                      {toolMode === 'place'  && (isBayLocked(currentBay)
                        ? `🔒 Bay ${currentBay} locked`
                        : `✓ Place Mode · Bay ${currentBay} · Click to add ${currentBay}${nextSeatNumber}`)}
                      {toolMode === 'select' && '✓ Select Mode · Click seats to edit'}
                      {toolMode === 'box'    && '✓ Box Select · Drag to select (Shift add, Ctrl remove)'}
                      {toolMode === 'lasso'  && '✓ Lasso Select · Drag freeform shape'}
                      {toolMode === 'delete' && '✓ Delete Mode · Click seats to remove'}
                    </div>
                  )}
                </div>
              </TransformComponent>
            </>
          )}
        </TransformWrapper>
      </div>

      {/* Modals & panels */}
      {showPublishDialog && (
        <PublishDialog
          diff={localDiff}
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
        onRollback={() => { setShowVersionPanel(false); loadPlan(); }}
      />
      <AuditLogPanel
        planId={planId}
        open={showAuditPanel}
        onClose={() => setShowAuditPanel(false)}
      />

      {/* Unsaved indicator */}
      {draftDirty && (
        <div className="fixed bottom-3 left-3 px-3 py-1.5 bg-blue-600 text-white rounded text-xs shadow-lg flex items-center gap-2 z-30" data-testid="dirty-indicator">
          <AlertCircle size={12}/>
          Unsaved draft · auto-saving in 30s
        </div>
      )}
    </div>
  );
}
