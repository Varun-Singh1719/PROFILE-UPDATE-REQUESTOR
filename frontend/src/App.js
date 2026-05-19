import React from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import AuthCallback from "./pages/AuthCallback";
import AdminDashboard from "./pages/AdminDashboard";
import RADashboard from "./pages/RADashboard";
import DQDashboard from "./pages/DQDashboard";
import ManagerDashboard from "./pages/ManagerDashboard";
import TicketListPage from "./pages/TicketListPage";
import TicketDetailPage from "./pages/TicketDetailPage";
import CreateTicketPage from "./pages/CreateTicketPage";
import ContactListPage from "./pages/ContactListPage";
import TeamsPage from "./pages/TeamsPage";
import PermissionsPage from "./pages/PermissionsPage";
import NotificationsOutboxPage from "./pages/NotificationsOutboxPage";
import EmailTemplatesPage from "./pages/EmailTemplatesPage";
import EmployeeDashboard from "./pages/EmployeeDashboard";
import DeskBookingPage from "./pages/DeskBookingPage";
import { Loader2 } from "lucide-react";

const roleHome = (role) => {
  if (role === "Admin") return "/admin";
  if (role === "Manager") return "/manager";
  if (role === "Research") return "/ra";
  if (role === "DQ Team") return "/dq";
  return "/employee";
};

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading || user === null)
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-[#ec9324]" size={32}/></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={roleHome(user.role)} replace />;
  }
  return children;
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading || user === null) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-[#ec9324]" size={32}/></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={roleHome(user.role)} replace />;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* Admin */}
            <Route path="/admin" element={<ProtectedRoute roles={["Admin"]}><AdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/open-tickets" element={<ProtectedRoute roles={["Admin"]}>
              <TicketListPage scope="all" title="All Requests" basePath="/admin/tickets" />
            </ProtectedRoute>} />
            <Route path="/admin/unassigned" element={<ProtectedRoute roles={["Admin"]}>
              <TicketListPage scope="unassigned" title="Unassigned Requests" basePath="/admin/tickets" />
            </ProtectedRoute>} />
            <Route path="/admin/contacts" element={<ProtectedRoute roles={["Admin"]}><ContactListPage /></ProtectedRoute>} />
            <Route path="/admin/teams" element={<ProtectedRoute roles={["Admin"]}><TeamsPage /></ProtectedRoute>} />
            <Route path="/admin/permissions" element={<ProtectedRoute roles={["Admin"]}><PermissionsPage /></ProtectedRoute>} />
            <Route path="/admin/notifications" element={<ProtectedRoute roles={["Admin"]}><NotificationsOutboxPage /></ProtectedRoute>} />
            <Route path="/admin/email-templates" element={<ProtectedRoute roles={["Admin"]}><EmailTemplatesPage /></ProtectedRoute>} />
            <Route path="/admin/create" element={<ProtectedRoute roles={["Admin"]}><CreateTicketPage /></ProtectedRoute>} />
            <Route path="/admin/tickets/:id" element={<ProtectedRoute roles={["Admin"]}><TicketDetailPage /></ProtectedRoute>} />

            {/* Manager */}
            <Route path="/manager" element={<ProtectedRoute roles={["Manager"]}><ManagerDashboard /></ProtectedRoute>} />
            <Route path="/manager/open-tickets" element={<ProtectedRoute roles={["Manager"]}>
              <TicketListPage scope="all" title="All Requests" basePath="/manager/tickets" />
            </ProtectedRoute>} />
            <Route path="/manager/unassigned" element={<ProtectedRoute roles={["Manager"]}>
              <TicketListPage scope="unassigned" title="Unassigned Requests" basePath="/manager/tickets" />
            </ProtectedRoute>} />
            <Route path="/manager/create" element={<ProtectedRoute roles={["Manager"]}><CreateTicketPage /></ProtectedRoute>} />
            <Route path="/manager/email-templates" element={<ProtectedRoute roles={["Manager"]}><EmailTemplatesPage /></ProtectedRoute>} />
            <Route path="/manager/tickets/:id" element={<ProtectedRoute roles={["Manager"]}><TicketDetailPage /></ProtectedRoute>} />
            {/* Research Associate */}
            <Route path="/ra" element={<ProtectedRoute roles={["Research"]}><RADashboard /></ProtectedRoute>} />
            <Route path="/ra/tickets" element={<ProtectedRoute roles={["Research"]}>
              <TicketListPage scope="mine" title="My Requests" basePath="/ra/tickets" allowCreate />
            </ProtectedRoute>} />
            <Route path="/ra/create" element={<ProtectedRoute roles={["Research"]}><CreateTicketPage /></ProtectedRoute>} />
            <Route path="/ra/tickets/:id" element={<ProtectedRoute roles={["Research"]}><TicketDetailPage /></ProtectedRoute>} />

            {/* DQ Team */}
            <Route path="/dq" element={<ProtectedRoute roles={["DQ Team"]}><DQDashboard /></ProtectedRoute>} />
            <Route path="/dq/tickets" element={<ProtectedRoute roles={["DQ Team"]}>
              <TicketListPage scope="assigned" title="My Requests" basePath="/dq/tickets" />
            </ProtectedRoute>} />
            <Route path="/dq/unassigned" element={<ProtectedRoute roles={["DQ Team"]}>
              <TicketListPage scope="unassigned" title="Unassigned Tickets" basePath="/dq/tickets" />
            </ProtectedRoute>} />
            <Route path="/dq/tickets/:id" element={<ProtectedRoute roles={["DQ Team"]}><TicketDetailPage /></ProtectedRoute>} />

            {/* Desk Booking (all roles) */}
            <Route path="/desk-booking" element={<ProtectedRoute roles={["Admin", "Manager", "Research", "DQ Team", "Delivery", "Member"]}><DeskBookingPage /></ProtectedRoute>} />
            {/* Default employee dashboard for new roles */}
            <Route path="/employee" element={<ProtectedRoute roles={["Delivery", "Member"]}><EmployeeDashboard /></ProtectedRoute>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
