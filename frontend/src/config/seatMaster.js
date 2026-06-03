/**
 * Seat Master Configuration
 * Maps all workstation seats from the floor plan PDF
 * Coordinates are in percentage relative to PDF dimensions for responsiveness
 */

export const FLOOR_PLAN_CONFIG = {
  pdfUrl: "https://customer-assets.emergentagent.com/job_workspace-manager-19/artifacts/8xyci4sh_Final_Layout_Plan_Updated.pdf",
  name: "Office Floor Plan",
  seats: [
    // Zone 1: Upper Left - J Series (J1-J10)
    { id: "J1", label: "J1", x: 15, y: 18, status: "available" },
    { id: "J2", label: "J2", x: 19, y: 18, status: "available" },
    { id: "J3", label: "J3", x: 23, y: 18, status: "available" },
    { id: "J4", label: "J4", x: 27, y: 18, status: "available" },
    { id: "J5", label: "J5", x: 15, y: 22, status: "available" },
    { id: "J6", label: "J6", x: 19, y: 22, status: "available" },
    { id: "J7", label: "J7", x: 23, y: 22, status: "available" },
    { id: "J8", label: "J8", x: 27, y: 22, status: "available" },
    { id: "J9", label: "J9", x: 19, y: 26, status: "available" },
    { id: "J10", label: "J10", x: 23, y: 26, status: "available" },

    // Zone 1: K Series (K1-K6)
    { id: "K1", label: "K1", x: 32, y: 18, status: "available" },
    { id: "K2", label: "K2", x: 36, y: 18, status: "available" },
    { id: "K3", label: "K3", x: 40, y: 18, status: "available" },
    { id: "K4", label: "K4", x: 32, y: 22, status: "available" },
    { id: "K5", label: "K5", x: 36, y: 22, status: "available" },
    { id: "K6", label: "K6", x: 40, y: 22, status: "available" },

    // Zone 2: Numbered Seats (1-20) - 2x2 clusters
    { id: "1", label: "1", x: 8, y: 40, status: "available" },
    { id: "2", label: "2", x: 12, y: 40, status: "available" },
    { id: "3", label: "3", x: 8, y: 44, status: "available" },
    { id: "4", label: "4", x: 12, y: 44, status: "available" },
    
    { id: "5", label: "5", x: 18, y: 40, status: "available" },
    { id: "6", label: "6", x: 22, y: 40, status: "available" },
    { id: "7", label: "7", x: 18, y: 44, status: "available" },
    { id: "8", label: "8", x: 22, y: 44, status: "available" },
    
    { id: "9", label: "9", x: 8, y: 52, status: "available" },
    { id: "10", label: "10", x: 12, y: 52, status: "available" },
    { id: "11", label: "11", x: 8, y: 56, status: "available" },
    { id: "12", label: "12", x: 12, y: 56, status: "available" },
    
    { id: "13", label: "13", x: 18, y: 52, status: "available" },
    { id: "14", label: "14", x: 22, y: 52, status: "available" },
    { id: "15", label: "15", x: 18, y: 56, status: "available" },
    { id: "16", label: "16", x: 22, y: 56, status: "available" },
    
    { id: "17", label: "17", x: 8, y: 64, status: "available" },
    { id: "18", label: "18", x: 12, y: 64, status: "available" },
    { id: "19", label: "19", x: 8, y: 68, status: "available" },
    { id: "20", label: "20", x: 12, y: 68, status: "available" },

    // Zone 3: Right Side - L Series (L1-L5)
    { id: "L1", label: "L1", x: 85, y: 15, status: "available" },
    { id: "L2", label: "L2", x: 89, y: 15, status: "available" },
    { id: "L3", label: "L3", x: 93, y: 15, status: "available" },
    { id: "L4", label: "L4", x: 89, y: 19, status: "available" },
    { id: "L5", label: "L5", x: 93, y: 19, status: "available" },

    // Zone 3: F Series (F1-F4)
    { id: "F1", label: "F1", x: 70, y: 35, status: "available" },
    { id: "F2", label: "F2", x: 74, y: 35, status: "available" },
    { id: "F3", label: "F3", x: 70, y: 39, status: "available" },
    { id: "F4", label: "F4", x: 74, y: 39, status: "available" },

    // Zone 3: G Series (G1-G5)
    { id: "G1", label: "G1", x: 70, y: 48, status: "available" },
    { id: "G2", label: "G2", x: 74, y: 48, status: "available" },
    { id: "G3", label: "G3", x: 78, y: 48, status: "available" },
    { id: "G4", label: "G4", x: 74, y: 52, status: "available" },
    { id: "G5", label: "G5", x: 78, y: 52, status: "available" },

    // Zone 3: H Series (H1-H10)
    { id: "H1", label: "H1", x: 70, y: 62, status: "available" },
    { id: "H2", label: "H2", x: 74, y: 62, status: "available" },
    { id: "H3", label: "H3", x: 78, y: 62, status: "available" },
    { id: "H4", label: "H4", x: 82, y: 62, status: "available" },
    { id: "H5", label: "H5", x: 86, y: 62, status: "available" },
    { id: "H6", label: "H6", x: 70, y: 66, status: "available" },
    { id: "H7", label: "H7", x: 74, y: 66, status: "available" },
    { id: "H8", label: "H8", x: 78, y: 66, status: "available" },
    { id: "H9", label: "H9", x: 82, y: 66, status: "available" },
    { id: "H10", label: "H10", x: 86, y: 66, status: "available" },

    // Zone 3: M Series (M1-M5)
    { id: "M1", label: "M1", x: 85, y: 78, status: "available" },
    { id: "M2", label: "M2", x: 89, y: 78, status: "available" },
    { id: "M3", label: "M3", x: 93, y: 78, status: "available" },
    { id: "M4", label: "M4", x: 89, y: 82, status: "available" },
    { id: "M5", label: "M5", x: 93, y: 82, status: "available" },
  ]
};

export const SEAT_STATUS = {
  AVAILABLE: 'available',
  SELECTED: 'selected',
  OCCUPIED: 'occupied'
};

export const SEAT_COLORS = {
  available: {
    fill: '#FFFFFF',
    border: '#FF1493',
    borderWidth: 2
  },
  selected: {
    fill: '#00FF00',
    border: '#FF1493',
    borderWidth: 2
  },
  occupied: {
    fill: '#808080',
    border: '#FF1493',
    borderWidth: 2
  }
};
