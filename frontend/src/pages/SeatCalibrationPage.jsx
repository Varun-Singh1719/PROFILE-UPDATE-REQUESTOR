import React, { useState, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { 
  Download, Upload, Save, X, ZoomIn, ZoomOut, Maximize2, ChevronLeft, ChevronRight,
  Minus, MoreVertical, Wand2, Eye, Grid, MapPin, Trash2, RotateCw, RefreshCw,
  Move, Undo2, Redo2, Maximize, MonitorPlay, Plus, Settings
} from 'lucide-react';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

// Enhanced Seat Icon with label inside and rotation support
const SeatIcon = ({ size = 24, color = "#FFFFFF", borderColor = "#FF1493", label, rotation = 0, isSelected = false }) => (
  <div 
    style={{ 
      transform: `rotate(${rotation}deg)`,
      width: size,
      height: size,
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}
  >
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="16" height="8" rx="2" fill={color} stroke={borderColor} strokeWidth="1.5" />
      <rect x="5" y="12" width="14" height="6" rx="1.5" fill={color} stroke={borderColor} strokeWidth="1.5" />
      <rect x="3" y="8" width="2" height="8" rx="1" fill={color} stroke={borderColor} strokeWidth="1" />
      <rect x="19" y="8" width="2" height="8" rx="1" fill={color} stroke={borderColor} strokeWidth="1" />
      {isSelected && <circle cx="12" cy="12" r="3" fill="#00FF00" opacity="0.5" />}
    </svg>
    {label && (
      <div 
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%) rotate(-${rotation}deg)`,
          fontSize: Math.max(8, size * 0.35) + 'px',
          fontWeight: 'bold',
          color: '#333',
          pointerEvents: 'none',
          whiteSpace: 'nowrap'
        }}
      >
        {label}
      </div>
    )}
  </div>
);

const BAYS = {
  A: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'],
  B: ['B1', 'B2', 'B3', 'B4'],
  C: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'],
  D: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'],
  E: ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8'],
  F: ['F1', 'F2', 'F3', 'F4'],
  G: ['G1', 'G2', 'G3', 'G4', 'G5'],
  H: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10'],
  I: ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'I10'],
  J: ['J1', 'J2', 'J3', 'J4', 'J5'],
  K: ['K1', 'K2', 'K3', 'K4', 'K5', 'K6'],
  L: ['L1', 'L2', 'L3', 'L4', 'L5'],
  M: ['M1', 'M2', 'M3', 'M4', 'M5'],
  N: ['N1', 'N2', 'N3'],
  O: ['O1', 'O2', 'O3', 'O4'],
  P: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'],
  Q: ['Q1', 'Q2', 'Q3'],
  R: ['R1', 'R2', 'R3', 'R4'],
  S: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
  T: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'],
  U: ['U1', 'U2', 'U3', 'U4', 'U5'],
  V: ['V1', 'V2', 'V3', 'V4', 'V5'],
  W: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'],
  X: ['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8'],
  Y: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7', 'Y8'],
};

const BAY_KEYS = Object.keys(BAYS);
const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5];

export default function SeatCalibrationPage() {
  // NEW PDF URL
  const [pdfUrl] = useState("https://customer-assets.emergentagent.com/job_workspace-manager-19/artifacts/m9mpuhb8_Without%20seat%20floor%20map.pdf");
  const [pageWidth, setPageWidth] = useState(1200);
  const [mappedSeats, setMappedSeats] = useState({});
  const [currentBay, setCurrentBay] = useState('A');
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [pdfDimensions, setPdfDimensions] = useState({ width: 0, height: 0 });
  const [showAccuracyMode, setShowAccuracyMode] = useState(true);
  const [previewMode, setPreviewMode] = useState(false);
  const [mouseCoords, setMouseCoords] = useState({ x: 0, y: 0 });
  const [currentZoom, setCurrentZoom] = useState(1);
  
  // New state for enhancements
  const [seatSize, setSeatSize] = useState(28);
  const [seatRotation, setSeatRotation] = useState(0);
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [toolMode, setToolMode] = useState('place'); // place, delete, move, rotate
  const [lastSeatTemplate, setLastSeatTemplate] = useState({ size: 28, rotation: 0 });
  
  const containerRef = useRef(null);

  const currentBaySeats = BAYS[currentBay] || [];
  const currentBayIndex = BAY_KEYS.indexOf(currentBay);
  const totalBays = BAY_KEYS.length;
  const mappedInBay = currentBaySeats.filter(id => mappedSeats[id]).length;
  const totalMapped = Object.keys(mappedSeats).length;
  const totalSeats = BAY_KEYS.reduce((sum, key) => sum + BAYS[key].length, 0);

  // Add to history for undo/redo
  const addToHistory = (newState) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(newState)));
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const undo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setMappedSeats(history[historyIndex - 1]);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setMappedSeats(history[historyIndex + 1]);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
      if (e.key === 'Delete' && selectedSeats.length > 0) {
        e.preventDefault();
        deleteSeat(selectedSeats);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history, selectedSeats]);

  const onDocumentLoadSuccess = ({ numPages }) => {
    console.log('PDF loaded');
  };

  const onPageLoadSuccess = (page) => {
    setPdfDimensions({ width: page.width, height: page.height });
  };

  const handlePdfClick = (e) => {
    if (!isCalibrating) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const xPercent = (x / rect.width) * 100;
    const yPercent = (y / rect.height) * 100;

    if (toolMode === 'place') {
      const nextSeat = currentBaySeats.find(id => !mappedSeats[id]);
      if (!nextSeat) return;

      const newSeats = {
        ...mappedSeats,
        [nextSeat]: {
          id: nextSeat,
          label: nextSeat,
          x: parseFloat(xPercent.toFixed(2)),
          y: parseFloat(yPercent.toFixed(2)),
          size: lastSeatTemplate.size,
          rotation: lastSeatTemplate.rotation,
          status: "available"
        }
      };
      setMappedSeats(newSeats);
      addToHistory(newSeats);
    } else if (toolMode === 'delete') {
      // Find clicked seat and delete it
      const clickedSeat = Object.values(mappedSeats).find(seat => {
        const dx = Math.abs(seat.x - xPercent);
        const dy = Math.abs(seat.y - yPercent);
        return dx < 2 && dy < 2;
      });
      if (clickedSeat) {
        deleteSeat([clickedSeat.id]);
      }
    }
  };

  const handleMouseMove = (e) => {
    if (!containerRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const xPercent = (x / rect.width) * 100;
    const yPercent = (y / rect.height) * 100;
    setMouseCoords({ x: xPercent.toFixed(2), y: yPercent.toFixed(2) });
  };

  const autoGenerateBay = () => {
    const baySeats = currentBaySeats;
    const mappedInCurrentBay = baySeats.filter(id => mappedSeats[id]);
    
    if (mappedInCurrentBay.length < 2) {
      alert('Please place at least the first and last seat in the bay');
      return;
    }

    const firstSeat = mappedSeats[baySeats[0]];
    const lastSeat = mappedSeats[baySeats[baySeats.length - 1]];
    
    if (!firstSeat || !lastSeat) {
      alert('Please place the first and last seat of the bay');
      return;
    }

    const newSeats = { ...mappedSeats };
    const count = baySeats.length;

    for (let i = 1; i < count - 1; i++) {
      const ratio = i / (count - 1);
      const x = firstSeat.x + (lastSeat.x - firstSeat.x) * ratio;
      const y = firstSeat.y + (lastSeat.y - firstSeat.y) * ratio;
      
      newSeats[baySeats[i]] = {
        id: baySeats[i],
        label: baySeats[i],
        x: parseFloat(x.toFixed(2)),
        y: parseFloat(y.toFixed(2)),
        size: firstSeat.size || lastSeatTemplate.size,
        rotation: firstSeat.rotation || lastSeatTemplate.rotation,
        status: "available"
      };
    }

    setMappedSeats(newSeats);
    addToHistory(newSeats);
  };

  const autoAlignHorizontal = () => {
    const baySeats = currentBaySeats.filter(id => mappedSeats[id]);
    if (baySeats.length < 2) return;

    const avgY = baySeats.reduce((sum, id) => sum + mappedSeats[id].y, 0) / baySeats.length;
    const newSeats = { ...mappedSeats };
    
    baySeats.forEach(id => {
      newSeats[id] = { ...newSeats[id], y: parseFloat(avgY.toFixed(2)) };
    });
    
    setMappedSeats(newSeats);
    addToHistory(newSeats);
  };

  const autoAlignVertical = () => {
    const baySeats = currentBaySeats.filter(id => mappedSeats[id]);
    if (baySeats.length < 2) return;

    const avgX = baySeats.reduce((sum, id) => sum + mappedSeats[id].x, 0) / baySeats.length;
    const newSeats = { ...mappedSeats };
    
    baySeats.forEach(id => {
      newSeats[id] = { ...newSeats[id], x: parseFloat(avgX.toFixed(2)) };
    });
    
    setMappedSeats(newSeats);
    addToHistory(newSeats);
  };

  const deleteSeat = (seatIds) => {
    const newSeats = { ...mappedSeats };
    seatIds.forEach(id => delete newSeats[id]);
    setMappedSeats(newSeats);
    addToHistory(newSeats);
    setSelectedSeats([]);
  };

  const applySizeToBay = () => {
    const newSeats = { ...mappedSeats };
    currentBaySeats.forEach(id => {
      if (newSeats[id]) {
        newSeats[id].size = seatSize;
      }
    });
    setMappedSeats(newSeats);
    addToHistory(newSeats);
    setLastSeatTemplate({ ...lastSeatTemplate, size: seatSize });
  };

  const applySizeToAll = () => {
    const newSeats = { ...mappedSeats };
    Object.keys(newSeats).forEach(id => {
      newSeats[id].size = seatSize;
    });
    setMappedSeats(newSeats);
    addToHistory(newSeats);
    setLastSeatTemplate({ ...lastSeatTemplate, size: seatSize });
  };

  const applyRotationToBay = () => {
    const newSeats = { ...mappedSeats };
    currentBaySeats.forEach(id => {
      if (newSeats[id]) {
        newSeats[id].rotation = seatRotation;
      }
    });
    setMappedSeats(newSeats);
    addToHistory(newSeats);
    setLastSeatTemplate({ ...lastSeatTemplate, rotation: seatRotation });
  };

  const nextBay = () => {
    if (currentBayIndex < totalBays - 1) {
      setCurrentBay(BAY_KEYS[currentBayIndex + 1]);
    }
  };

  const prevBay = () => {
    if (currentBayIndex > 0) {
      setCurrentBay(BAY_KEYS[currentBayIndex - 1]);
    }
  };

  const exportConfiguration = () => {
    const seatsArray = Object.values(mappedSeats);
    const config = { pdfUrl, name: "Office Floor Plan", seats: seatsArray };
    const dataStr = JSON.stringify(config, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'seat-configuration.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = () => {
    const seatsArray = Object.values(mappedSeats);
    const config = { pdfUrl, name: "Office Floor Plan", seats: seatsArray };
    navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    alert('Configuration copied to clipboard!');
  };

  const importConfiguration = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const config = JSON.parse(event.target.result);
        const seatsObj = {};
        config.seats.forEach(seat => {
          seatsObj[seat.id] = seat;
        });
        setMappedSeats(seatsObj);
        addToHistory(seatsObj);
        alert('Configuration imported!');
      } catch (error) {
        alert('Import failed: ' + error.message);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Left Panel */}
      <div className="w-80 bg-white border-r overflow-y-auto">
        <div className="p-6">
          <h1 className="text-2xl font-bold mb-2">Professional Calibration</h1>
          <p className="text-sm text-gray-600 mb-6">Enhanced workflow with new floor plan</p>

          {/* Tool Mode */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="text-sm font-semibold mb-2">Tool Mode</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setToolMode('place')}
                className={`p-2 rounded text-sm flex items-center justify-center gap-1 ${
                  toolMode === 'place' ? 'bg-blue-500 text-white' : 'bg-white border'
                }`}
              >
                <MapPin size={16} />
                Place
              </button>
              <button
                onClick={() => setToolMode('delete')}
                className={`p-2 rounded text-sm flex items-center justify-center gap-1 ${
                  toolMode === 'delete' ? 'bg-red-500 text-white' : 'bg-white border'
                }`}
              >
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          </div>

          {/* Bay Navigation */}
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-blue-900">Current Bay</span>
              <span className="text-xs text-blue-600">{currentBayIndex + 1} / {totalBays}</span>
            </div>
            
            <div className="flex items-center gap-2 mb-3">
              <button onClick={prevBay} disabled={currentBayIndex === 0} className="p-2 bg-white border rounded hover:bg-gray-50 disabled:opacity-50">
                <ChevronLeft size={20} />
              </button>
              
              <select value={currentBay} onChange={(e) => setCurrentBay(e.target.value)} className="flex-1 px-3 py-2 border rounded font-bold text-lg text-center">
                {BAY_KEYS.map(key => (
                  <option key={key} value={key}>Bay {key}</option>
                ))}
              </select>
              
              <button onClick={nextBay} disabled={currentBayIndex === totalBays - 1} className="p-2 bg-white border rounded hover:bg-gray-50 disabled:opacity-50">
                <ChevronRight size={20} />
              </button>
            </div>

            <div className="text-sm text-blue-800">
              <div className="flex flex-wrap gap-1">
                {currentBaySeats.map(id => (
                  <span key={id} className={`px-2 py-1 rounded text-xs ${mappedSeats[id] ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-600'}`}>
                    {id}
                  </span>
                ))}
              </div>
              <div className="mt-2 text-xs">Mapped: {mappedInBay} / {currentBaySeats.length}</div>
            </div>
          </div>

          {/* Seat Size Control */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Settings size={16} />
              Seat Size: {seatSize}px
            </div>
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => setSeatSize(Math.max(16, seatSize - 4))} className="p-1 bg-white border rounded hover:bg-gray-100">
                <Minus size={16} />
              </button>
              <input
                type="range"
                min="16"
                max="64"
                value={seatSize}
                onChange={(e) => setSeatSize(parseInt(e.target.value))}
                className="flex-1"
              />
              <button onClick={() => setSeatSize(Math.min(64, seatSize + 4))} className="p-1 bg-white border rounded hover:bg-gray-100">
                <Plus size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button onClick={applySizeToBay} className="p-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                Apply to Bay
              </button>
              <button onClick={applySizeToAll} className="p-2 bg-purple-500 text-white rounded hover:bg-purple-600">
                Apply to All
              </button>
            </div>
          </div>

          {/* Seat Rotation Control */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="text-sm font-semibold mb-2 flex items-center gap-2">
              <RotateCw size={16} />
              Rotation: {seatRotation}°
            </div>
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => setSeatRotation((seatRotation - 45 + 360) % 360)} className="p-1 bg-white border rounded hover:bg-gray-100">
                -45°
              </button>
              <input
                type="range"
                min="0"
                max="360"
                step="45"
                value={seatRotation}
                onChange={(e) => setSeatRotation(parseInt(e.target.value))}
                className="flex-1"
              />
              <button onClick={() => setSeatRotation((seatRotation + 45) % 360)} className="p-1 bg-white border rounded hover:bg-gray-100">
                +45°
              </button>
            </div>
            <button onClick={applyRotationToBay} className="w-full p-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-xs">
              Apply Rotation to Bay
            </button>
          </div>

          {/* Calibration Controls */}
          <div className="space-y-2 mb-6">
            <button
              onClick={() => setIsCalibrating(!isCalibrating)}
              className={`w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                isCalibrating ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-[#ec9324] text-white hover:bg-[#d88420]'
              }`}
            >
              {isCalibrating ? <X size={20} /> : <MapPin size={20} />}
              {isCalibrating ? 'Stop Calibration' : 'Start Calibration'}
            </button>

            <button onClick={autoGenerateBay} className="w-full py-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600 flex items-center justify-center gap-2" disabled={!isCalibrating}>
              <Wand2 size={20} />
              Auto Generate Bay
            </button>

            <div className="grid grid-cols-3 gap-2">
              <button onClick={undo} disabled={historyIndex <= 0} className="py-2 bg-gray-500 text-white rounded hover:bg-gray-600 flex items-center justify-center disabled:opacity-50">
                <Undo2 size={16} />
              </button>
              <button onClick={redo} disabled={historyIndex >= history.length - 1} className="py-2 bg-gray-500 text-white rounded hover:bg-gray-600 flex items-center justify-center disabled:opacity-50">
                <Redo2 size={16} />
              </button>
              <button onClick={() => selectedSeats.length > 0 && deleteSeat(selectedSeats)} disabled={selectedSeats.length === 0} className="py-2 bg-red-500 text-white rounded hover:bg-red-600 flex items-center justify-center disabled:opacity-50">
                <Trash2 size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={autoAlignHorizontal} className="py-2 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center justify-center gap-1 text-sm">
                <Minus size={16} className="rotate-0" />
                Align H
              </button>
              <button onClick={autoAlignVertical} className="py-2 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center justify-center gap-1 text-sm">
                <MoreVertical size={16} />
                Align V
              </button>
            </div>
          </div>

          {/* Modes */}
          <div className="space-y-2 mb-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showAccuracyMode} onChange={(e) => setShowAccuracyMode(e.target.checked)} className="rounded" />
              <Grid size={16} />
              Accuracy Mode
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={previewMode} onChange={(e) => setPreviewMode(e.target.checked)} className="rounded" />
              <Eye size={16} />
              Preview Mode (End User View)
            </label>
          </div>

          {/* Progress */}
          <div className="mb-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium">Total Progress</span>
              <span>{totalMapped} / {totalSeats}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-[#ec9324] h-2 rounded-full transition-all" style={{ width: `${(totalMapped / totalSeats) * 100}%` }} />
            </div>
          </div>

          {/* Export Controls */}
          <div className="space-y-2">
            <button onClick={exportConfiguration} className="w-full py-2 bg-green-500 text-white rounded hover:bg-green-600 flex items-center justify-center gap-2" disabled={totalMapped === 0}>
              <Download size={18} />
              Export
            </button>
            <button onClick={copyToClipboard} className="w-full py-2 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center justify-center gap-2" disabled={totalMapped === 0}>
              <Save size={18} />
              Copy
            </button>
            <label className="w-full py-2 bg-purple-500 text-white rounded hover:bg-purple-600 flex items-center justify-center gap-2 cursor-pointer">
              <Upload size={18} />
              Import
              <input type="file" accept=".json" onChange={importConfiguration} className="hidden" />
            </label>
          </div>
        </div>
      </div>

      {/* Right Panel - PDF Viewer */}
      <div className="flex-1 overflow-hidden bg-gray-100 relative">
        <TransformWrapper
          initialScale={1}
          minScale={0.25}
          maxScale={5}
          wheel={{ step: 0.1 }}
          pinch={{ step: 5 }}
          onZoom={(ref) => setCurrentZoom(ref.state.scale)}
        >
          {({ zoomIn, zoomOut, resetTransform, setTransform }) => (
            <>
              {/* Zoom Controls */}
              <div className="absolute top-4 right-4 z-20 bg-white rounded-lg shadow-lg p-2 flex flex-col gap-1">
                <button onClick={() => zoomIn()} className="p-2 hover:bg-gray-100 rounded">
                  <ZoomIn size={18} />
                </button>
                <button onClick={() => zoomOut()} className="p-2 hover:bg-gray-100 rounded">
                  <ZoomOut size={18} />
                </button>
                <div className="border-t border-gray-200 my-1" />
                <button onClick={() => resetTransform()} className="p-2 hover:bg-gray-100 rounded">
                  <Maximize2 size={18} />
                </button>
                <select className="text-xs p-1 border rounded" value={currentZoom} onChange={(e) => setTransform(0, 0, parseFloat(e.target.value))}>
                  {ZOOM_LEVELS.map(level => (
                    <option key={level} value={level}>{(level * 100).toFixed(0)}%</option>
                  ))}
                </select>
              </div>

              {/* Accuracy Mode Overlay */}
              {showAccuracyMode && isCalibrating && (
                <div className="absolute top-4 left-4 z-20 bg-white rounded-lg shadow-lg p-3 text-sm">
                  <div className="font-semibold mb-1">Mouse Position</div>
                  <div className="text-xs">X: {mouseCoords.x}%</div>
                  <div className="text-xs">Y: {mouseCoords.y}%</div>
                  <div className="text-xs mt-2">Zoom: {(currentZoom * 100).toFixed(0)}%</div>
                </div>
              )}

              <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
                <div
                  ref={containerRef}
                  onClick={handlePdfClick}
                  onMouseMove={handleMouseMove}
                  className={`relative inline-block ${
                    toolMode === 'place' ? 'cursor-crosshair' : toolMode === 'delete' ? 'cursor-pointer' : 'cursor-move'
                  }`}
                >
                  <Document file={pdfUrl} onLoadSuccess={onDocumentLoadSuccess}>
                    <Page pageNumber={1} width={pageWidth} renderTextLayer={false} renderAnnotationLayer={false} onLoadSuccess={onPageLoadSuccess} />
                  </Document>

                  {/* Seat Overlays */}
                  <div className="absolute inset-0 pointer-events-none">
                    {Object.values(mappedSeats).map(seat => {
                      const isInCurrentBay = currentBaySeats.includes(seat.id);
                      const seatColor = previewMode ? '#FFFFFF' : (isInCurrentBay ? '#00FF00' : '#CCCCCC');
                      const dynamicSize = (seat.size || 28) * currentZoom;
                      
                      return (
                        <div
                          key={seat.id}
                          className="absolute"
                          style={{
                            left: `${seat.x}%`,
                            top: `${seat.y}%`,
                            transform: 'translate(-50%, -50%)',
                          }}
                        >
                          <SeatIcon 
                            size={dynamicSize} 
                            color={seatColor} 
                            label={previewMode ? null : seat.label}
                            rotation={seat.rotation || 0}
                            isSelected={selectedSeats.includes(seat.id)} 
                          />
                        </div>
                      );
                    })}
                  </div>

                  {isCalibrating && !previewMode && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-yellow-500 text-white px-6 py-3 rounded-lg shadow-lg font-semibold">
                      {toolMode === 'place' ? `Calibrating Bay ${currentBay} - Click to place seats` : 
                       toolMode === 'delete' ? 'Delete Mode - Click seats to remove' : 'Move Mode'}
                    </div>
                  )}
                </div>
              </TransformComponent>
            </>
          )}
        </TransformWrapper>
      </div>
    </div>
  );
}
