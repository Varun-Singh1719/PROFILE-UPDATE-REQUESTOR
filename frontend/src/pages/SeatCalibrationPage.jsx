import React, { useState, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { 
  Download, Upload, Save, X, ZoomIn, ZoomOut, Maximize2, ChevronLeft, ChevronRight,
  Minus, MoreVertical, Wand2, Eye, Grid, MapPin, Trash2, RotateCw,
  Undo2, Redo2, Maximize, Plus, Settings, Check
} from 'lucide-react';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

// Seat Icon using uploaded image
const DirectionalSeatIcon = ({ size = 10, color = "#FFFFFF", borderColor = "#FF1493", label, rotation = 0, isSelected = false }) => {
  return (
    <div 
      style={{ 
        width: size,
        height: size,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `rotate(${rotation}deg)`,
      }}
    >
      {/* Seat Image */}
      <img 
        src="https://customer-assets.emergentagent.com/job_workspace-manager-19/artifacts/96yixbn4_pngegg.png"
        alt="seat"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          filter: isSelected ? 'drop-shadow(0 0 4px #00FF00)' : 'none',
          opacity: color === '#FFFFFF' ? 1 : 0.7
        }}
      />
      
      {/* Label rotates with seat */}
      {label && (
        <div 
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: Math.max(3, size * 0.25) + 'px',
            fontWeight: 'bold',
            color: '#000',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            textShadow: '0 0 3px white, 0 0 3px white, 0 0 3px white',
            zIndex: 10
          }}
        >
          {label}
        </div>
      )}
      
      {/* Selection indicator */}
      {isSelected && (
        <div 
          style={{
            position: 'absolute',
            inset: -2,
            border: '2px solid #00FF00',
            borderRadius: '4px',
            pointerEvents: 'none'
          }}
        />
      )}
    </div>
  );
};

const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5];

export default function SeatCalibrationPage() {
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
  
  // Draft state for pending changes
  const [pendingSeatSize, setPendingSeatSize] = useState(10);
  const [pendingSeatRotation, setPendingSeatRotation] = useState(0);
  const [selectedSeats, setSelectedSeats] = useState([]);
  
  // History for undo/redo
  const [history, setHistory] = useState([{}]);
  const [historyIndex, setHistoryIndex] = useState(0);
  
  const [toolMode, setToolMode] = useState('place');
  const [nextSeatNumber, setNextSeatNumber] = useState(1);
  
  const containerRef = useRef(null);
  const transformRef = useRef(null);

  // Dynamic bay detection
  const getSeatsInBay = (bay) => {
    return Object.keys(mappedSeats).filter(id => id.startsWith(bay)).sort();
  };

  const currentBaySeats = getSeatsInBay(currentBay);
  const availableBays = [...new Set(Object.keys(mappedSeats).map(id => id.charAt(0)))].sort();
  const totalMapped = Object.keys(mappedSeats).length;

  // Add to history
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
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
      if (e.key === 'Delete' && selectedSeats.length > 0) {
        e.preventDefault();
        deleteSelectedSeats();
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
      const seatId = `${currentBay}${nextSeatNumber}`;
      
      const newSeats = {
        ...mappedSeats,
        [seatId]: {
          id: seatId,
          label: seatId,
          x: parseFloat(xPercent.toFixed(2)),
          y: parseFloat(yPercent.toFixed(2)),
          size: 10, // Default size
          rotation: 0, // Default rotation
          status: "available"
        }
      };
      setMappedSeats(newSeats);
      addToHistory(newSeats);
      setNextSeatNumber(nextSeatNumber + 1);
    } else if (toolMode === 'delete') {
      // Find and delete clicked seat
      const clickedSeat = Object.values(mappedSeats).find(seat => {
        const dx = Math.abs(seat.x - xPercent);
        const dy = Math.abs(seat.y - yPercent);
        return dx < 1 && dy < 1;
      });
      if (clickedSeat) {
        const newSeats = { ...mappedSeats };
        delete newSeats[clickedSeat.id];
        setMappedSeats(newSeats);
        addToHistory(newSeats);
      }
    } else if (toolMode === 'select') {
      // Select seat for editing
      const clickedSeat = Object.values(mappedSeats).find(seat => {
        const dx = Math.abs(seat.x - xPercent);
        const dy = Math.abs(seat.y - yPercent);
        return dx < 1 && dy < 1;
      });
      if (clickedSeat) {
        if (e.ctrlKey || e.metaKey) {
          // Multi-select
          setSelectedSeats(prev => 
            prev.includes(clickedSeat.id) 
              ? prev.filter(id => id !== clickedSeat.id)
              : [...prev, clickedSeat.id]
          );
        } else {
          setSelectedSeats([clickedSeat.id]);
          setPendingSeatSize(clickedSeat.size || 10);
          setPendingSeatRotation(clickedSeat.rotation || 0);
        }
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

  // Apply pending changes
  const applyChanges = () => {
    if (selectedSeats.length === 0) return;
    
    const newSeats = { ...mappedSeats };
    selectedSeats.forEach(id => {
      if (newSeats[id]) {
        newSeats[id] = {
          ...newSeats[id],
          size: pendingSeatSize,
          rotation: pendingSeatRotation
        };
      }
    });
    
    setMappedSeats(newSeats);
    addToHistory(newSeats);
    alert('Changes applied to selected seats');
  };

  // Cancel pending changes
  const cancelChanges = () => {
    if (selectedSeats.length > 0 && mappedSeats[selectedSeats[0]]) {
      setPendingSeatSize(mappedSeats[selectedSeats[0]].size || 10);
      setPendingSeatRotation(mappedSeats[selectedSeats[0]].rotation || 0);
    }
  };

  const autoGenerateBay = () => {
    const baySeats = currentBaySeats;
    
    if (baySeats.length < 2) {
      alert('Please place at least 2 seats in the bay first');
      return;
    }

    const firstSeat = mappedSeats[baySeats[0]];
    const lastSeat = mappedSeats[baySeats[baySeats.length - 1]];
    
    if (!firstSeat || !lastSeat) {
      alert('Cannot find first and last seat');
      return;
    }

    const count = baySeats.length;
    const newSeats = { ...mappedSeats };

    for (let i = 1; i < count - 1; i++) {
      const ratio = i / (count - 1);
      const x = firstSeat.x + (lastSeat.x - firstSeat.x) * ratio;
      const y = firstSeat.y + (lastSeat.y - firstSeat.y) * ratio;
      
      newSeats[baySeats[i]] = {
        ...newSeats[baySeats[i]],
        x: parseFloat(x.toFixed(2)),
        y: parseFloat(y.toFixed(2)),
      };
    }

    setMappedSeats(newSeats);
    addToHistory(newSeats);
  };

  const alignSelectedSeats = (type) => {
    if (selectedSeats.length < 2) {
      alert('Please select at least 2 seats');
      return;
    }

    const newSeats = { ...mappedSeats };
    
    if (type === 'horizontal') {
      // Align on average Y, distribute evenly on X
      const seats = selectedSeats.map(id => newSeats[id]).sort((a, b) => a.x - b.x);
      const avgY = seats.reduce((sum, seat) => sum + seat.y, 0) / seats.length;
      const minX = seats[0].x;
      const maxX = seats[seats.length - 1].x;
      const spacing = (maxX - minX) / (seats.length - 1);
      
      seats.forEach((seat, i) => {
        newSeats[seat.id].y = parseFloat(avgY.toFixed(2));
        if (i > 0 && i < seats.length - 1) {
          newSeats[seat.id].x = parseFloat((minX + spacing * i).toFixed(2));
        }
      });
    } else if (type === 'vertical') {
      // Align on average X, distribute evenly on Y
      const seats = selectedSeats.map(id => newSeats[id]).sort((a, b) => a.y - b.y);
      const avgX = seats.reduce((sum, seat) => sum + seat.x, 0) / seats.length;
      const minY = seats[0].y;
      const maxY = seats[seats.length - 1].y;
      const spacing = (maxY - minY) / (seats.length - 1);
      
      seats.forEach((seat, i) => {
        newSeats[seat.id].x = parseFloat(avgX.toFixed(2));
        if (i > 0 && i < seats.length - 1) {
          newSeats[seat.id].y = parseFloat((minY + spacing * i).toFixed(2));
        }
      });
    }

    setMappedSeats(newSeats);
    addToHistory(newSeats);
  };

  const deleteSelectedSeats = () => {
    const newSeats = { ...mappedSeats };
    selectedSeats.forEach(id => delete newSeats[id]);
    setMappedSeats(newSeats);
    addToHistory(newSeats);
    setSelectedSeats([]);
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
    alert('Configuration copied!');
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
      {/* Left Panel - Organized Sections */}
      <div className="w-80 bg-white border-r overflow-y-auto">
        <div className="p-4">
          <h1 className="text-xl font-bold mb-1">Seat Calibration</h1>
          <p className="text-xs text-gray-600 mb-4">Professional floor mapping tool</p>

          {/* Tool Mode Section */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="text-xs font-semibold mb-2 text-gray-700">TOOL MODE</div>
            <div className="grid grid-cols-3 gap-1">
              <button
                onClick={() => {
                  setToolMode('place');
                  if (!isCalibrating) {
                    setIsCalibrating(true);
                  }
                }}
                className={`p-2 rounded text-xs flex flex-col items-center gap-1 ${
                  toolMode === 'place' ? 'bg-blue-500 text-white' : 'bg-white border'
                }`}
              >
                <MapPin size={14} />
                Place
              </button>
              <button
                onClick={() => {
                  setToolMode('select');
                  if (!isCalibrating) {
                    setIsCalibrating(true);
                  }
                }}
                className={`p-2 rounded text-xs flex flex-col items-center gap-1 ${
                  toolMode === 'select' ? 'bg-green-500 text-white' : 'bg-white border'
                }`}
              >
                <Settings size={14} />
                Select
              </button>
              <button
                onClick={() => {
                  setToolMode('delete');
                  if (!isCalibrating) {
                    setIsCalibrating(true);
                  }
                }}
                className={`p-2 rounded text-xs flex flex-col items-center gap-1 ${
                  toolMode === 'delete' ? 'bg-red-500 text-white' : 'bg-white border'
                }`}
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
            {isCalibrating && (
              <div className="mt-2 text-xs text-green-600 bg-green-50 p-2 rounded">
                ✓ Calibration Active
              </div>
            )}
          </div>

          {/* Bay Controls Section */}
          <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div className="text-xs font-semibold mb-2 text-blue-900">BAY CONTROLS</div>
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => setCurrentBay(String.fromCharCode(Math.max(65, currentBay.charCodeAt(0) - 1)))} className="p-1.5 bg-white border rounded hover:bg-gray-50">
                <ChevronLeft size={16} />
              </button>
              <select value={currentBay} onChange={(e) => setCurrentBay(e.target.value)} className="flex-1 px-2 py-1.5 border rounded text-sm font-bold">
                {Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i)).map(letter => (
                  <option key={letter} value={letter}>Bay {letter}</option>
                ))}
              </select>
              <button onClick={() => setCurrentBay(String.fromCharCode(Math.min(90, currentBay.charCodeAt(0) + 1)))} className="p-1.5 bg-white border rounded hover:bg-gray-50">
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="text-xs text-blue-700">
              Seats in bay: {currentBaySeats.length}
            </div>
          </div>

          {/* Seat Controls Section */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="text-xs font-semibold mb-2 text-gray-700">SEAT CONTROLS</div>
            
            {/* Size Control with Draft State */}
            <div className="mb-3 p-2 bg-white rounded border">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">Size (px)</span>
                <input
                  type="number"
                  min="1"
                  max="50"
                  step="0.5"
                  value={pendingSeatSize}
                  onChange={(e) => setPendingSeatSize(parseFloat(e.target.value))}
                  className="w-16 px-1 py-0.5 border rounded text-xs text-right"
                />
              </div>
              <input
                type="range"
                min="1"
                max="50"
                step="0.5"
                value={pendingSeatSize}
                onChange={(e) => setPendingSeatSize(parseFloat(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-gray-500 mt-1">
                {selectedSeats.length > 0 && mappedSeats[selectedSeats[0]] && (
                  <span>Current: {mappedSeats[selectedSeats[0]].size || 10}px</span>
                )}
              </div>
            </div>

            {/* Rotation Control with Draft State */}
            <div className="mb-3 p-2 bg-white rounded border">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">Rotation (°)</span>
                <input
                  type="number"
                  min="0"
                  max="360"
                  step="45"
                  value={pendingSeatRotation}
                  onChange={(e) => setPendingSeatRotation(parseInt(e.target.value))}
                  className="w-16 px-1 py-0.5 border rounded text-xs text-right"
                />
              </div>
              <input
                type="range"
                min="0"
                max="360"
                step="45"
                value={pendingSeatRotation}
                onChange={(e) => setPendingSeatRotation(parseInt(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-gray-500 mt-1">
                {selectedSeats.length > 0 && mappedSeats[selectedSeats[0]] && (
                  <span>Current: {mappedSeats[selectedSeats[0]].rotation || 0}°</span>
                )}
              </div>
            </div>

            {/* Apply/Cancel Buttons */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button
                onClick={applyChanges}
                disabled={selectedSeats.length === 0}
                className="py-1.5 bg-green-500 text-white rounded hover:bg-green-600 flex items-center justify-center gap-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check size={14} />
                Apply
              </button>
              <button
                onClick={cancelChanges}
                disabled={selectedSeats.length === 0}
                className="py-1.5 bg-gray-500 text-white rounded hover:bg-gray-600 flex items-center justify-center gap-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X size={14} />
                Cancel
              </button>
            </div>

            <div className="text-xs text-gray-600 bg-yellow-50 p-2 rounded border border-yellow-200">
              Selected: {selectedSeats.length} seat(s)
            </div>
          </div>

          {/* Alignment Controls Section */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="text-xs font-semibold mb-2 text-gray-700">ALIGNMENT CONTROLS</div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button
                onClick={() => alignSelectedSeats('horizontal')}
                disabled={selectedSeats.length < 2}
                className="py-2 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center justify-center gap-1 text-xs disabled:opacity-50"
              >
                <Minus size={14} />
                Align H
              </button>
              <button
                onClick={() => alignSelectedSeats('vertical')}
                disabled={selectedSeats.length < 2}
                className="py-2 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center justify-center gap-1 text-xs disabled:opacity-50"
              >
                <MoreVertical size={14} />
                Align V
              </button>
            </div>
            <button
              onClick={autoGenerateBay}
              className="w-full py-2 bg-purple-500 text-white rounded hover:bg-purple-600 flex items-center justify-center gap-1 text-xs"
            >
              <Wand2 size={14} />
              Auto Generate
            </button>
          </div>

          {/* Actions Section */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="text-xs font-semibold mb-2 text-gray-700">ACTIONS</div>
            <div className="grid grid-cols-4 gap-2 mb-2">
              <button
                onClick={undo}
                disabled={historyIndex <= 0}
                className="py-2 bg-gray-500 text-white rounded hover:bg-gray-600 flex items-center justify-center disabled:opacity-50"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 size={14} />
              </button>
              <button
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
                className="py-2 bg-gray-500 text-white rounded hover:bg-gray-600 flex items-center justify-center disabled:opacity-50"
                title="Redo (Ctrl+Y)"
              >
                <Redo2 size={14} />
              </button>
              <button
                onClick={deleteSelectedSeats}
                disabled={selectedSeats.length === 0}
                className="py-2 bg-red-500 text-white rounded hover:bg-red-600 flex items-center justify-center disabled:opacity-50"
                title="Delete (Del)"
              >
                <Trash2 size={14} />
              </button>
              <button
                onClick={() => setIsCalibrating(!isCalibrating)}
                className={`py-2 rounded flex items-center justify-center ${
                  isCalibrating ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-green-500 text-white hover:bg-green-600'
                }`}
              >
                {isCalibrating ? <X size={14} /> : <MapPin size={14} />}
              </button>
            </div>
          </div>

          {/* View Options */}
          <div className="mb-4 space-y-2">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={showAccuracyMode} onChange={(e) => setShowAccuracyMode(e.target.checked)} className="rounded" />
              Show Coordinates
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={previewMode} onChange={(e) => setPreviewMode(e.target.checked)} className="rounded" />
              Preview Mode
            </label>
          </div>

          {/* Progress */}
          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1">
              <span className="font-medium">Total Seats</span>
              <span>{totalMapped}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1.5">
              <div className="bg-[#ec9324] h-1.5 rounded-full transition-all" style={{ width: `${Math.min(100, totalMapped)}%` }} />
            </div>
          </div>

          {/* Export Controls */}
          <div className="space-y-2">
            <button onClick={exportConfiguration} className="w-full py-2 bg-green-500 text-white rounded hover:bg-green-600 flex items-center justify-center gap-2 text-sm" disabled={totalMapped === 0}>
              <Download size={16} />
              Export
            </button>
            <button onClick={copyToClipboard} className="w-full py-2 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center justify-center gap-2 text-sm" disabled={totalMapped === 0}>
              <Save size={16} />
              Copy
            </button>
            <label className="w-full py-2 bg-purple-500 text-white rounded hover:bg-purple-600 flex items-center justify-center gap-2 cursor-pointer text-sm">
              <Upload size={16} />
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
          centerOnInit={true}
          onZoom={(ref) => setCurrentZoom(ref.state.scale)}
          ref={transformRef}
        >
          {({ zoomIn, zoomOut, resetTransform, centerView }) => (
            <>
              {/* Zoom Controls Section */}
              <div className="absolute top-4 right-4 z-20 bg-white rounded-lg shadow-lg p-2">
                <div className="text-xs font-semibold mb-2 text-center text-gray-700">ZOOM</div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => zoomIn()} className="p-2 hover:bg-gray-100 rounded" title="Zoom In">
                    <ZoomIn size={16} />
                  </button>
                  <button onClick={() => zoomOut()} className="p-2 hover:bg-gray-100 rounded" title="Zoom Out">
                    <ZoomOut size={16} />
                  </button>
                  <div className="border-t border-gray-200 my-1" />
                  <button onClick={() => resetTransform()} className="p-2 hover:bg-gray-100 rounded" title="Fit Screen">
                    <Maximize2 size={16} />
                  </button>
                  <button onClick={() => centerView()} className="p-2 hover:bg-gray-100 rounded" title="Center">
                    <Maximize size={16} />
                  </button>
                </div>
                <select 
                  className="text-xs p-1 border rounded w-full mt-2" 
                  value={currentZoom.toFixed(2)}
                  onChange={(e) => {
                    const zoom = parseFloat(e.target.value);
                    resetTransform();
                    setTimeout(() => {
                      zoomIn(zoom - 1);
                    }, 50);
                  }}
                >
                  {ZOOM_LEVELS.map(level => (
                    <option key={level} value={level.toFixed(2)}>{(level * 100).toFixed(0)}%</option>
                  ))}
                </select>
                <div className="text-xs text-center mt-1 text-gray-600">
                  {(currentZoom * 100).toFixed(0)}%
                </div>
              </div>

              {/* Accuracy Mode Info */}
              {showAccuracyMode && isCalibrating && (
                <div className="absolute top-4 left-4 z-20 bg-white rounded-lg shadow-lg p-2 text-xs">
                  <div className="font-semibold">Position</div>
                  <div>X: {mouseCoords.x}%</div>
                  <div>Y: {mouseCoords.y}%</div>
                </div>
              )}

              <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
                <div
                  ref={containerRef}
                  onClick={handlePdfClick}
                  onMouseMove={handleMouseMove}
                  className={`relative inline-block ${
                    toolMode === 'place' ? 'cursor-crosshair' : 
                    toolMode === 'delete' ? 'cursor-pointer' : 
                    toolMode === 'select' ? 'cursor-pointer' : 'cursor-move'
                  }`}
                >
                  <Document file={pdfUrl} onLoadSuccess={onDocumentLoadSuccess}>
                    <Page 
                      pageNumber={1} 
                      width={pageWidth} 
                      renderTextLayer={false} 
                      renderAnnotationLayer={false} 
                      onLoadSuccess={onPageLoadSuccess} 
                    />
                  </Document>

                  {/* Seat Overlays - Optimized rendering */}
                  <div className="absolute inset-0" style={{ willChange: 'transform', pointerEvents: 'none' }}>
                    {Object.values(mappedSeats).map(seat => {
                      const isSelected = selectedSeats.includes(seat.id);
                      const seatColor = previewMode ? '#FFFFFF' : (isSelected ? '#00FF00' : '#FFFFFF');
                      
                      // Use pending values for selected seats in preview
                      const displaySize = (isSelected ? pendingSeatSize : (seat.size || 10));
                      const displayRotation = (isSelected ? pendingSeatRotation : (seat.rotation || 0));
                      
                      return (
                        <div
                          key={seat.id}
                          className="absolute"
                          style={{
                            left: `${seat.x}%`,
                            top: `${seat.y}%`,
                            transform: 'translate(-50%, -50%)',
                            pointerEvents: 'auto'
                          }}
                        >
                          <DirectionalSeatIcon 
                            size={displaySize} 
                            color={seatColor} 
                            label={previewMode ? null : seat.label}
                            rotation={displayRotation}
                            isSelected={isSelected} 
                          />
                        </div>
                      );
                    })}
                  </div>

                  {isCalibrating && !previewMode && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-yellow-500 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-semibold z-50">
                      {toolMode === 'place' ? `✓ Place Mode Active - Bay ${currentBay} - Click to add ${currentBay}${nextSeatNumber}` : 
                       toolMode === 'delete' ? '✓ Delete Mode Active - Click seats to remove' : 
                       '✓ Select Mode Active - Click seats to edit'}
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
