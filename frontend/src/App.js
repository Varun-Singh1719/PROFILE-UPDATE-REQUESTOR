import React from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { BusyProvider } from "./context/BusyContext";
import BusyOverlay from "./components/BusyOverlay";
import GlobalToaster from "./components/GlobalToaster";
import LoginPage from "./pages/LoginPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import AuthCallback from "./pages/AuthCallback";
import AdminDashboard from "./pages/AdminDashboard";
import TicketListPage from "./pages/TicketListPage";
import TicketDetailPage from "./pages/TicketDetailPage";
import CreateTicketPage from "./pages/CreateTicketPage";
import ContactListPage from "./pages/ContactListPage";
import TeamsPage from "./pages/TeamsPage";
import PermissionsPage from "./pages/PermissionsPage";
import PermissionSetsListPage from "./pages/PermissionSetsListPage";
import PermissionSetDetailPage from "./pages/PermissionSetDetailPage";
import NotificationsOutboxPage from "./pages/NotificationsOutboxPage";
import EmailTemplatesPage from "./pages/EmailTemplatesPage";
import DeskBookingPage from "./pages/DeskBookingPage";
import FloorLayoutPage from "./pages/FloorLayoutPage";
import SeatCalibrationPage from "./pages/SeatCalibrationPage";
import { Loader2 } from "lucide-react";

// v3 role model — every authenticated user (Super Admin or Admin) lands at /admin.
// Routing inside the admin shell is gated by Permission Sets, not by role.
const roleHome = () => "/admin";

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading || user === null)
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-[#ec9324]" size={32}/></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={roleHome()} replace />;
  }
  return children;
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading || user === null) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-[#ec9324]" size={32}/></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={roleHome()} replace />;
}

// Both canonical roles are allowed on the admin shell.
const ADMIN_ROLES = ["Super Admin", "Admin"];
// Super-Admin-only screens (employee mgmt, teams, permission sets editing, etc.)
const SUPER_ADMIN_ONLY = ["Super Admin"];

function App() {
  return (
    <div className="App">
      <BusyProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* Unified admin shell — Super Admin + Admin */}
            <Route path="/admin" element={<ProtectedRoute roles={ADMIN_ROLES}><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/open-tickets" element={<ProtectedRoute roles={ADMIN_ROLES}>
              <TicketListPage scope="all" title="All Requests" basePath="/admin/tickets" />
            </ProtectedRoute>} />
            <Route path="/admin/unassigned" element={<ProtectedRoute roles={ADMIN_ROLES}>
              <TicketListPage scope="unassigned" title="Unassigned Requests" basePath="/admin/tickets" />
            </ProtectedRoute>} />
            <Route path="/admin/create" element={<ProtectedRoute roles={ADMIN_ROLES}><CreateTicketPage /></ProtectedRoute>} />
            <Route path="/admin/tickets/:id" element={<ProtectedRoute roles={ADMIN_ROLES}><TicketDetailPage /></ProtectedRoute>} />

            {/* Super-Admin-only management screens */}
            <Route path="/admin/contacts" element={<ProtectedRoute roles={SUPER_ADMIN_ONLY}><ContactListPage /></ProtectedRoute>} />
            <Route path="/admin/teams" element={<ProtectedRoute roles={SUPER_ADMIN_ONLY}><TeamsPage /></ProtectedRoute>} />
            <Route path="/admin/permissions" element={<ProtectedRoute roles={SUPER_ADMIN_ONLY}><PermissionsPage /></ProtectedRoute>} />
            <Route path="/admin/permission-sets" element={<ProtectedRoute roles={SUPER_ADMIN_ONLY}><PermissionSetsListPage /></ProtectedRoute>} />
            <Route path="/admin/permission-sets/:id" element={<ProtectedRoute roles={SUPER_ADMIN_ONLY}><PermissionSetDetailPage /></ProtectedRoute>} />
            <Route path="/admin/notifications" element={<ProtectedRoute roles={SUPER_ADMIN_ONLY}><NotificationsOutboxPage /></ProtectedRoute>} />
            <Route path="/admin/email-templates" element={<ProtectedRoute roles={SUPER_ADMIN_ONLY}><EmailTemplatesPage /></ProtectedRoute>} />

            {/* Workspace Manager */}
            <Route path="/workspace-manager/floor-layout" element={<ProtectedRoute roles={ADMIN_ROLES}><FloorLayoutPage /></ProtectedRoute>} />
            <Route path="/workspace-manager/calibration" element={<ProtectedRoute roles={ADMIN_ROLES}><SeatCalibrationPage /></ProtectedRoute>} />
            
            {/* Legacy redirect */}
            <Route path="/desk-booking" element={<Navigate to="/workspace-manager/floor-layout" replace />} />

            {/* Legacy paths from pre-v3 collapse — keep redirecting to unified admin shell */}
            <Route path="/manager/*" element={<Navigate to="/admin" replace />} />
            <Route path="/ra/*" element={<Navigate to="/admin" replace />} />
            <Route path="/dq/*" element={<Navigate to="/admin" replace />} />
            <Route path="/employee/*" element={<Navigate to="/admin" replace />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          {/* Global, app-wide busy overlay — sits above all routes incl. login */}
          <BusyOverlay />
          {/* Single global Toaster — bottom-left, orange-on-white theme */}
          <GlobalToaster />
        </BrowserRouter>
      </AuthProvider>
      </BusyProvider>
    </div>
  );
}

export default App;
