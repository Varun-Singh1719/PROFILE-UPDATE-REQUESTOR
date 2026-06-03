import React, { useState, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Download, Upload, Save, X, Check, RotateCcw, MapPin } from 'lucide-react';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

// All seat IDs in order
const ALL_SEAT_IDS = [
  // Section A
  "A1", "A2", "A3", "A4", "A5", "A6",
  // Section B
  "B1", "B2", "B3", "B4",
  // Section C
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8",
  // Section D
  "D1", "D2", "D3", "D4", "D5", "D6",
  // Section E
  "E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8",
  // Section F
  "F1", "F2", "F3", "F4",
  // Section G
  "G1", "G2", "G3", "G4", "G5",
  // Section H
  "H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10",
  // Section I
  "I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8", "I9", "I10",
  // Section J
  "J1", "J2", "J3", "J4", "J5",
  // Section K
  "K1", "K2", "K3", "K4", "K5", "K6",
  // Section L
  "L1", "L2", "L3", "L4", "L5",
  // Section M
  "M1", "M2", "M3", "M4", "M5",
  // Section N
  "N1", "N2", "N3",
  // Section O
  "O1", "O2", "O3", "O4",
  // Section P
  "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8",
  // Section Q
  "Q1", "Q2", "Q3",
  // Section R
  "R1", "R2", "R3", "R4",
  // Section S
  "S1", "S2", "S3", "S4", "S5", "S6",
  // Section T
  "T1", "T2", "T3", "T4", "T5", "T6",
  // Section U
  "U1", "U2", "U3", "U4", "U5",
  // Section V
  "V1", "V2", "V3", "V4", "V5",
  // Section W
  "W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8",
  // Section X
  "X1", "X2", "X3", "X4", "X5", "X6", "X7", "X8",
  // Section Y
  "Y1", "Y2", "Y3", "Y4", "Y5", "Y6", "Y7", "Y8",
];

export default function SeatCalibrationPage() {
  const [pdfUrl] = useState("https://customer-assets.emergentagent.com/job_workspace-manager-19/artifacts/8xyci4sh_Final_Layout_Plan_Updated.pdf");
  const [pageWidth, setPageWidth] = useState(1200);
  const [mappedSeats, setMappedSeats] = useState({});
  const [currentSeatIndex, setCurrentSeatIndex] = useState(0);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [pdfDimensions, setPdfDimensions] = useState({ width: 0, height: 0 });
  const containerRef = useRef(null);

  const currentSeatId = ALL_SEAT_IDS[currentSeatIndex];
  const progress = Object.keys(mappedSeats).length;
  const total = ALL_SEAT_IDS.length;

  const onDocumentLoadSuccess = ({ numPages }) => {
    console.log('PDF loaded with', numPages, 'pages');
  };

  const onPageLoadSuccess = (page) => {
    const { width, height } = page;
    setPdfDimensions({ width, height });
    console.log('Page dimensions:', width, height);
  };

  const handlePdfClick = (e) => {
    if (!isCalibrating || currentSeatIndex >= ALL_SEAT_IDS.length) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Convert to percentage
    const xPercent = (x / rect.width) * 100;
    const yPercent = (y / rect.height) * 100;

    const seatId = ALL_SEAT_IDS[currentSeatIndex];
    
    setMappedSeats(prev => ({
      ...prev,
      [seatId]: {
        id: seatId,
        label: seatId,
        x: parseFloat(xPercent.toFixed(2)),
        y: parseFloat(yPercent.toFixed(2)),
        status: "available"
      }
    }));

    // Move to next seat
    if (currentSeatIndex < ALL_SEAT_IDS.length - 1) {
      setCurrentSeatIndex(prev => prev + 1);
    } else {
      setIsCalibrating(false);
      alert('All seats mapped! Click "Export Configuration" to save.');
    }
  };

  const startCalibration = () => {
    setIsCalibrating(true);
    setCurrentSeatIndex(0);
  };

  const skipCurrentSeat = () => {
    if (currentSeatIndex < ALL_SEAT_IDS.length - 1) {
      setCurrentSeatIndex(prev => prev + 1);
    }
  };

  const goBackOneSeat = () => {
    if (currentSeatIndex > 0) {
      setCurrentSeatIndex(prev => prev - 1);
    }
  };

  const resetCalibration = () => {
    if (window.confirm('Are you sure you want to reset all mapped seats?')) {
      setMappedSeats({});
      setCurrentSeatIndex(0);
      setIsCalibrating(false);
    }
  };

  const exportConfiguration = () => {
    const seatsArray = Object.values(mappedSeats);
    const config = {
      pdfUrl: pdfUrl,
      name: "Office Floor Plan",
      seats: seatsArray
    };

    const dataStr = JSON.stringify(config, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'seat-configuration.json';
    link.click();
    URL.revokeObjectURL(url);
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
        alert('Configuration imported successfully!');
      } catch (error) {
        alert('Failed to import configuration: ' + error.message);
      }
    };
    reader.readAsText(file);
  };

  const copyToClipboard = () => {
    const seatsArray = Object.values(mappedSeats);
    const config = {
      pdfUrl: pdfUrl,
      name: "Office Floor Plan",
      seats: seatsArray
    };
    const dataStr = JSON.stringify(config, null, 2);
    navigator.clipboard.writeText(dataStr);
    alert('Configuration copied to clipboard!');
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Left Panel - Controls */}
      <div className="w-80 bg-white border-r border-gray-200 overflow-y-auto">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Seat Calibration Tool
          </h1>
          <p className="text-sm text-gray-600 mb-6">
            Click on the floor plan to map each seat location
          </p>

          {/* Progress */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Progress</span>
              <span className="text-sm text-gray-600">{progress} / {total}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-[#ec9324] h-2 rounded-full transition-all"
                style={{ width: `${(progress / total) * 100}%` }}
              />
            </div>
          </div>

          {/* Current Seat */}
          {isCalibrating && currentSeatIndex < ALL_SEAT_IDS.length && (
            <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="text-yellow-600" size={20} />
                <span className="font-semibold text-yellow-900">Click to place:</span>
              </div>
              <div className="text-3xl font-bold text-yellow-900">
                {currentSeatId}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={skipCurrentSeat}
                  className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded text-sm hover:bg-gray-50"
                >
                  Skip
                </button>
                <button
                  onClick={goBackOneSeat}
                  className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded text-sm hover:bg-gray-50"
                  disabled={currentSeatIndex === 0}
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="space-y-3">
            {!isCalibrating ? (
              <button
                onClick={startCalibration}
                className="w-full px-4 py-3 bg-[#ec9324] text-white rounded-lg hover:bg-[#d88420] flex items-center justify-center gap-2 font-medium"
              >
                <MapPin size={20} />
                Start Calibration
              </button>
            ) : (
              <button
                onClick={() => setIsCalibrating(false)}
                className="w-full px-4 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 flex items-center justify-center gap-2 font-medium"
              >
                <X size={20} />
                Stop Calibration
              </button>
            )}

            <button
              onClick={resetCalibration}
              className="w-full px-4 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 flex items-center justify-center gap-2"
              disabled={progress === 0}
            >
              <RotateCcw size={20} />
              Reset All
            </button>

            <button
              onClick={exportConfiguration}
              className="w-full px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center justify-center gap-2"
              disabled={progress === 0}
            >
              <Download size={20} />
              Export Configuration
            </button>

            <button
              onClick={copyToClipboard}
              className="w-full px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center justify-center gap-2"
              disabled={progress === 0}
            >
              <Save size={20} />
              Copy to Clipboard
            </button>

            <label className="w-full px-4 py-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600 flex items-center justify-center gap-2 cursor-pointer">
              <Upload size={20} />
              Import Configuration
              <input
                type="file"
                accept=".json"
                onChange={importConfiguration}
                className="hidden"
              />
            </label>
          </div>

          {/* Mapped Seats List */}
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              Mapped Seats ({progress})
            </h3>
            <div className="max-h-96 overflow-y-auto space-y-1">
              {Object.values(mappedSeats).map(seat => (
                <div
                  key={seat.id}
                  className="flex items-center justify-between p-2 bg-green-50 border border-green-200 rounded text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Check className="text-green-600" size={16} />
                    <span className="font-medium text-green-900">{seat.id}</span>
                  </div>
                  <span className="text-xs text-green-600">
                    {seat.x.toFixed(1)}%, {seat.y.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - PDF Viewer */}
      <div className="flex-1 overflow-auto bg-gray-100 p-8">
        <div className="max-w-full mx-auto">
          <div
            ref={containerRef}
            onClick={handlePdfClick}
            className={`relative inline-block ${
              isCalibrating ? 'cursor-crosshair' : 'cursor-default'
            }`}
          >
            <Document
              file={pdfUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={
                <div className="flex items-center justify-center h-screen">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#ec9324]" />
                </div>
              }
            >
              <Page
                pageNumber={1}
                width={pageWidth}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                onLoadSuccess={onPageLoadSuccess}
              />
            </Document>

            {/* Overlay mapped seats */}
            <div className="absolute inset-0 pointer-events-none">
              {Object.values(mappedSeats).map(seat => (
                <div
                  key={seat.id}
                  className="absolute"
                  style={{
                    left: `${seat.x}%`,
                    top: `${seat.y}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  {/* Seat marker */}
                  <div className="w-7 h-7 rounded-full bg-green-500 border-2 border-white shadow-lg" />
                  {/* Label */}
                  <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 bg-green-600 text-white text-xs px-2 py-0.5 rounded whitespace-nowrap font-bold">
                    {seat.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Calibration hint */}
            {isCalibrating && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-yellow-500 text-white px-6 py-3 rounded-lg shadow-lg font-semibold text-lg">
                Click to place: {currentSeatId}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
