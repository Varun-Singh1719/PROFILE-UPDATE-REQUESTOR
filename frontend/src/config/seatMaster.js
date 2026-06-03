/**
 * Seat Master Configuration
 * Maps all workstation seats from the floor plan PDF
 * Coordinates extracted from actual PDF positions (percentage-based)
 */

export const FLOOR_PLAN_CONFIG = {
  pdfUrl: "https://customer-assets.emergentagent.com/job_workspace-manager-19/artifacts/8xyci4sh_Final_Layout_Plan_Updated.pdf",
  name: "Office Floor Plan",
  seats: [
    // Section A (A1-A6)
    { id: "A1", label: "A1", x: 20.21, y: 33.47, status: "available" },
    { id: "A2", label: "A2", x: 21.82, y: 33.47, status: "available" },
    { id: "A3", label: "A3", x: 23.43, y: 33.47, status: "available" },
    { id: "A4", label: "A4", x: 25.04, y: 33.47, status: "available" },
    { id: "A5", label: "A5", x: 26.65, y: 33.47, status: "available" },
    { id: "A6", label: "A6", x: 28.26, y: 33.47, status: "available" },

    // Section B (B1-B4)
    { id: "B1", label: "B1", x: 20.21, y: 35.74, status: "available" },
    { id: "B2", label: "B2", x: 21.82, y: 35.74, status: "available" },
    { id: "B3", label: "B3", x: 23.43, y: 35.74, status: "available" },
    { id: "B4", label: "B4", x: 25.04, y: 35.74, status: "available" },

    // Section C (C1-C8)
    { id: "C1", label: "C1", x: 28.98, y: 33.47, status: "available" },
    { id: "C2", label: "C2", x: 30.59, y: 33.47, status: "available" },
    { id: "C3", label: "C3", x: 32.20, y: 33.47, status: "available" },
    { id: "C4", label: "C4", x: 33.81, y: 33.47, status: "available" },
    { id: "C5", label: "C5", x: 35.42, y: 33.47, status: "available" },
    { id: "C6", label: "C6", x: 37.03, y: 33.47, status: "available" },
    { id: "C7", label: "C7", x: 38.64, y: 33.47, status: "available" },
    { id: "C8", label: "C8", x: 40.25, y: 33.47, status: "available" },

    // Section D (D1-D6)
    { id: "D1", label: "D1", x: 28.98, y: 35.74, status: "available" },
    { id: "D2", label: "D2", x: 30.59, y: 35.74, status: "available" },
    { id: "D3", label: "D3", x: 32.20, y: 35.74, status: "available" },
    { id: "D4", label: "D4", x: 33.81, y: 35.74, status: "available" },
    { id: "D5", label: "D5", x: 35.42, y: 35.74, status: "available" },
    { id: "D6", label: "D6", x: 37.03, y: 35.74, status: "available" },

    // Section E (E1-E8)
    { id: "E1", label: "E1", x: 41.66, y: 33.47, status: "available" },
    { id: "E2", label: "E2", x: 43.27, y: 33.47, status: "available" },
    { id: "E3", label: "E3", x: 44.88, y: 33.47, status: "available" },
    { id: "E4", label: "E4", x: 46.49, y: 33.47, status: "available" },
    { id: "E5", label: "E5", x: 48.10, y: 33.47, status: "available" },
    { id: "E6", label: "E6", x: 49.71, y: 33.47, status: "available" },
    { id: "E7", label: "E7", x: 51.32, y: 33.47, status: "available" },
    { id: "E8", label: "E8", x: 52.93, y: 33.47, status: "available" },

    // Section F (F1-F4)
    { id: "F1", label: "F1", x: 41.66, y: 35.74, status: "available" },
    { id: "F2", label: "F2", x: 43.27, y: 35.74, status: "available" },
    { id: "F3", label: "F3", x: 44.88, y: 35.74, status: "available" },
    { id: "F4", label: "F4", x: 46.49, y: 35.74, status: "available" },

    // Section G (G1-G5)
    { id: "G1", label: "G1", x: 54.35, y: 33.47, status: "available" },
    { id: "G2", label: "G2", x: 55.96, y: 33.47, status: "available" },
    { id: "G3", label: "G3", x: 57.57, y: 33.47, status: "available" },
    { id: "G4", label: "G4", x: 59.18, y: 33.47, status: "available" },
    { id: "G5", label: "G5", x: 60.79, y: 33.47, status: "available" },

    // Section H (H1-H10)
    { id: "H1", label: "H1", x: 73.08, y: 28.51, status: "available" },
    { id: "H2", label: "H2", x: 74.35, y: 28.51, status: "available" },
    { id: "H3", label: "H3", x: 75.63, y: 28.51, status: "available" },
    { id: "H4", label: "H4", x: 76.90, y: 28.51, status: "available" },
    { id: "H5", label: "H5", x: 78.18, y: 28.51, status: "available" },
    { id: "H6", label: "H6", x: 79.45, y: 28.51, status: "available" },
    { id: "H7", label: "H7", x: 80.73, y: 28.51, status: "available" },
    { id: "H8", label: "H8", x: 82.01, y: 28.51, status: "available" },
    { id: "H9", label: "H9", x: 83.28, y: 28.51, status: "available" },
    { id: "H10", label: "H10", x: 84.56, y: 28.51, status: "available" },

    // Section I (I1-I10)
    { id: "I1", label: "I1", x: 73.08, y: 30.14, status: "available" },
    { id: "I2", label: "I2", x: 74.35, y: 30.14, status: "available" },
    { id: "I3", label: "I3", x: 75.63, y: 30.14, status: "available" },
    { id: "I4", label: "I4", x: 76.90, y: 30.14, status: "available" },
    { id: "I5", label: "I5", x: 78.18, y: 30.14, status: "available" },
    { id: "I6", label: "I6", x: 79.45, y: 30.14, status: "available" },
    { id: "I7", label: "I7", x: 80.73, y: 30.14, status: "available" },
    { id: "I8", label: "I8", x: 82.01, y: 30.14, status: "available" },
    { id: "I9", label: "I9", x: 83.28, y: 30.14, status: "available" },
    { id: "I10", label: "I10", x: 84.56, y: 30.14, status: "available" },

    // Section J (J1-J5)
    { id: "J1", label: "J1", x: 71.81, y: 33.47, status: "available" },
    { id: "J2", label: "J2", x: 73.08, y: 33.47, status: "available" },
    { id: "J3", label: "J3", x: 74.35, y: 33.47, status: "available" },
    { id: "J4", label: "J4", x: 75.63, y: 33.47, status: "available" },
    { id: "J5", label: "J5", x: 76.90, y: 33.47, status: "available" },

    // Section K (K1-K6)
    { id: "K1", label: "K1", x: 71.81, y: 35.74, status: "available" },
    { id: "K2", label: "K2", x: 73.08, y: 35.74, status: "available" },
    { id: "K3", label: "K3", x: 74.35, y: 35.74, status: "available" },
    { id: "K4", label: "K4", x: 75.63, y: 35.74, status: "available" },
    { id: "K5", label: "K5", x: 76.90, y: 35.74, status: "available" },
    { id: "K6", label: "K6", x: 78.18, y: 35.74, status: "available" },

    // Section L (L1-L5)
    { id: "L1", label: "L1", x: 61.77, y: 33.47, status: "available" },
    { id: "L2", label: "L2", x: 63.38, y: 33.47, status: "available" },
    { id: "L3", label: "L3", x: 65.00, y: 33.47, status: "available" },
    { id: "L4", label: "L4", x: 66.61, y: 33.47, status: "available" },
    { id: "L5", label: "L5", x: 68.22, y: 33.47, status: "available" },

    // Section M (M1-M5)
    { id: "M1", label: "M1", x: 61.77, y: 35.74, status: "available" },
    { id: "M2", label: "M2", x: 63.38, y: 35.74, status: "available" },
    { id: "M3", label: "M3", x: 65.00, y: 35.74, status: "available" },
    { id: "M4", label: "M4", x: 66.61, y: 35.74, status: "available" },
    { id: "M5", label: "M5", x: 68.22, y: 35.74, status: "available" },

    // Section N (N1-N3)
    { id: "N1", label: "N1", x: 81.19, y: 37.57, status: "available" },
    { id: "N2", label: "N2", x: 82.46, y: 37.57, status: "available" },
    { id: "N3", label: "N3", x: 83.74, y: 37.57, status: "available" },

    // Section O (O1-O4)
    { id: "O1", label: "O1", x: 85.64, y: 37.57, status: "available" },
    { id: "O2", label: "O2", x: 86.91, y: 37.57, status: "available" },
    { id: "O3", label: "O3", x: 88.19, y: 37.57, status: "available" },
    { id: "O4", label: "O4", x: 89.46, y: 37.57, status: "available" },

    // Section P (P1-P8)
    { id: "P1", label: "P1", x: 85.20, y: 33.47, status: "available" },
    { id: "P2", label: "P2", x: 86.81, y: 33.47, status: "available" },
    { id: "P3", label: "P3", x: 88.42, y: 33.47, status: "available" },
    { id: "P4", label: "P4", x: 90.03, y: 33.47, status: "available" },
    { id: "P5", label: "P5", x: 91.64, y: 33.47, status: "available" },
    { id: "P6", label: "P6", x: 93.25, y: 33.47, status: "available" },
    { id: "P7", label: "P7", x: 94.86, y: 33.47, status: "available" },
    { id: "P8", label: "P8", x: 96.47, y: 33.47, status: "available" },

    // Section Q (Q1-Q3)
    { id: "Q1", label: "Q1", x: 85.20, y: 35.74, status: "available" },
    { id: "Q2", label: "Q2", x: 86.81, y: 35.74, status: "available" },
    { id: "Q3", label: "Q3", x: 88.42, y: 35.74, status: "available" },

    // Section R (R1-R6)
    { id: "R1", label: "R1", x: 97.74, y: 33.47, status: "available" },
    { id: "R2", label: "R2", x: 99.35, y: 33.47, status: "available" },
    { id: "R3", label: "R3", x: 98.01, y: 35.74, status: "available" },
    { id: "R4", label: "R4", x: 99.62, y: 35.74, status: "available" },

    // Section S (S1-S6)
    { id: "S1", label: "S1", x: 75.63, y: 44.07, status: "available" },
    { id: "S2", label: "S2", x: 76.90, y: 44.07, status: "available" },
    { id: "S3", label: "S3", x: 78.18, y: 44.07, status: "available" },
    { id: "S4", label: "S4", x: 79.45, y: 44.07, status: "available" },
    { id: "S5", label: "S5", x: 80.73, y: 44.07, status: "available" },
    { id: "S6", label: "S6", x: 82.01, y: 44.07, status: "available" },

    // Section T (T1-T8)
    { id: "T1", label: "T1", x: 75.63, y: 46.34, status: "available" },
    { id: "T2", label: "T2", x: 76.90, y: 46.34, status: "available" },
    { id: "T3", label: "T3", x: 78.18, y: 46.34, status: "available" },
    { id: "T4", label: "T4", x: 79.45, y: 46.34, status: "available" },
    { id: "T5", label: "T5", x: 80.73, y: 46.34, status: "available" },
    { id: "T6", label: "T6", x: 82.01, y: 46.34, status: "available" },

    // Section U (U1-U5)
    { id: "U1", label: "U1", x: 83.74, y: 44.07, status: "available" },
    { id: "U2", label: "U2", x: 85.02, y: 44.07, status: "available" },
    { id: "U3", label: "U3", x: 86.30, y: 44.07, status: "available" },
    { id: "U4", label: "U4", x: 87.57, y: 44.07, status: "available" },
    { id: "U5", label: "U5", x: 88.85, y: 44.07, status: "available" },

    // Section V (V1-V10)
    { id: "V1", label: "V1", x: 83.74, y: 46.34, status: "available" },
    { id: "V2", label: "V2", x: 85.02, y: 46.34, status: "available" },
    { id: "V3", label: "V3", x: 86.30, y: 46.34, status: "available" },
    { id: "V4", label: "V4", x: 87.57, y: 46.34, status: "available" },
    { id: "V5", label: "V5", x: 88.85, y: 46.34, status: "available" },

    // Section W (W1-W10)
    { id: "W1", label: "W1", x: 91.25, y: 44.07, status: "available" },
    { id: "W2", label: "W2", x: 92.53, y: 44.07, status: "available" },
    { id: "W3", label: "W3", x: 93.81, y: 44.07, status: "available" },
    { id: "W4", label: "W4", x: 95.08, y: 44.07, status: "available" },
    { id: "W5", label: "W5", x: 96.36, y: 44.07, status: "available" },
    { id: "W6", label: "W6", x: 97.64, y: 44.07, status: "available" },
    { id: "W7", label: "W7", x: 98.91, y: 44.07, status: "available" },
    { id: "W8", label: "W8", x: 99.90, y: 44.07, status: "available" },

    // Section X (X1-X10)
    { id: "X1", label: "X1", x: 91.25, y: 46.34, status: "available" },
    { id: "X2", label: "X2", x: 92.53, y: 46.34, status: "available" },
    { id: "X3", label: "X3", x: 93.81, y: 46.34, status: "available" },
    { id: "X4", label: "X4", x: 95.08, y: 46.34, status: "available" },
    { id: "X5", label: "X5", x: 96.36, y: 46.34, status: "available" },
    { id: "X6", label: "X6", x: 97.64, y: 46.34, status: "available" },
    { id: "X7", label: "X7", x: 98.91, y: 46.34, status: "available" },
    { id: "X8", label: "X8", x: 99.90, y: 46.34, status: "available" },

    // Section Y (Y1-Y8)
    { id: "Y1", label: "Y1", x: 88.85, y: 48.61, status: "available" },
    { id: "Y2", label: "Y2", x: 90.13, y: 48.61, status: "available" },
    { id: "Y3", label: "Y3", x: 91.41, y: 48.61, status: "available" },
    { id: "Y4", label: "Y4", x: 92.68, y: 48.61, status: "available" },
    { id: "Y5", label: "Y5", x: 93.96, y: 48.61, status: "available" },
    { id: "Y6", label: "Y6", x: 95.24, y: 48.61, status: "available" },
    { id: "Y7", label: "Y7", x: 96.52, y: 48.61, status: "available" },
    { id: "Y8", label: "Y8", x: 97.79, y: 48.61, status: "available" },
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
