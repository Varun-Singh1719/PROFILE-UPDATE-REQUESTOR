import React from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate, useParams, useSearchParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { BusyProvider } from "./context/BusyContext";
import { EffectivePermissionsProvider } from "./context/EffectivePermissionsContext";
import GlobalToaster from "./components/GlobalToaster";
import DialogHost from "./components/DialogHost";
import MutationBlocker from "./components/MutationBlocker";
import LoginPage from "./pages/LoginPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import AuthCallback from "./pages/AuthCallback";
import ImpersonateCallback from "./pages/ImpersonateCallback";
import AdminDashboard from "./pages/AdminDashboard";
import TicketListPage from "./pages/TicketListPage";
import TicketDetailPage from "./pages/TicketDetailPage";
import CreateTicketPage from "./pages/CreateTicketPage";
import ContactListPage from "./pages/ContactListPage";
import TeamsPage from "./pages/TeamsPage";
import PermissionsPage from "./pages/PermissionsPage";
import NotificationsOutboxPage from "./pages/NotificationsOutboxPage";
import EmailTemplatesPage from "./pages/EmailTemplatesPage";
import NotificationTemplatesPage from "./pages/NotificationTemplatesPage";
import DeskBookingPage from "./pages/DeskBookingPage";
import FloorLayoutPage from "./pages/FloorLayoutPage";
import SeatCalibrationPage from "./pages/SeatCalibrationPage";
import FloorPlansListPage from "./pages/FloorPlansListPage";
import MeetingRoomBookingPage from "./pages/MeetingRoomBookingPage";
import WorkstationBookingPage from "./pages/WorkstationBookingPage";
import RequestWorkstationPage from "./pages/RequestWorkstationPage";
import PendingApprovalsPage from "./pages/PendingApprovalsPage";
import BookingsPage from "./pages/BookingsPage";
import SegmentationsPage from "./pages/SegmentationsPage";
import ClientsPage from "./pages/ClientsPage";
import SegmentationLinkMockupsPage from "./pages/SegmentationLinkMockupsPage";
import ClientContactsPage from "./pages/ClientContactsPage";
import ProfilePage from "./pages/ProfilePage";
import WMOverallPreview from "./pages/WMOverallPreview";
import Loader2 from "@mui/icons-material/Autorenew";
import { useEffectivePermissionsState } from "./context/EffectivePermissionsContext";

// v3 role model — every authenticated user (Super Admin or Admin) lands at /admin.
// Routing inside the admin shell is gated by Permission Sets, not by role.
const roleHome = () => "/admin";

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading || user === null)
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-[#ec9324]" sx={{ fontSize: 32 }}/></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={roleHome()} replace />;
  }
  return children;
}

/**
 * V3ProtectedRoute — checks BOTH role (must be Admin or Super Admin) AND
 * v3 page visibility. Super Admin always passes. Admins must have at least
 * ONE of the given (module, page) pairs marked view.enabled+view.visible.
 *
 * Added Aug 2026 to close QA frontend defect FE-D2: users with only a role
 * check could bypass the sidebar (which was v3-aware) via direct URL nav.
 */
function V3ProtectedRoute({ children, pages }) {
  const { user, loading } = useAuth();
  const { ready, isSuperAdmin, isPageViewVisible } = useEffectivePermissionsState();
  if (loading || user === null || !ready)
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-[#ec9324]" sx={{ fontSize: 32 }}/></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!["Super Admin", "Admin"].includes(user.role)) return <Navigate to={roleHome()} replace />;
  if (isSuperAdmin) return children;
  const allowed = (pages || []).some(([m, p]) => isPageViewVisible(m, p));
  if (!allowed) return <Navigate to={roleHome()} replace />;
  return children;
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading || user === null) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-[#ec9324]" sx={{ fontSize: 32 }}/></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={roleHome()} replace />;
}

/** Legacy `/admin/permission-sets/:id` → new tabbed permissions page (view mode). */
function PermissionSetRedirect() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const edit = sp.get("edit") === "1";
  const target = `/admin/permissions?tab=${edit ? "editor" : "view"}${id ? `&set=${encodeURIComponent(id)}` : ""}`;
  return <Navigate to={target} replace />;
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
          <EffectivePermissionsProvider>
          <GlobalToaster>
          <BrowserRouter>
            <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/impersonate/callback" element={<ImpersonateCallback />} />

            {/* Unified admin shell — Super Admin + Admin */}
            <Route path="/admin" element={<ProtectedRoute roles={ADMIN_ROLES}><AdminDashboard /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute roles={ADMIN_ROLES}><ProfilePage /></ProtectedRoute>} />
            <Route path="/admin/open-tickets" element={<V3ProtectedRoute pages={[["profix","all_requests"]]}>
              <TicketListPage scope="all" title="All Requests" basePath="/admin/tickets" />
            </V3ProtectedRoute>} />
            <Route path="/admin/open-requests" element={<V3ProtectedRoute pages={[["profix","open_requests"],["profix","all_requests"]]}>
              <TicketListPage scope="all" title="Open Requests" basePath="/admin/tickets" lockedStatus="Open" />
            </V3ProtectedRoute>} />
            <Route path="/admin/unassigned" element={<V3ProtectedRoute pages={[["profix","unassigned"]]}>
              <TicketListPage scope="unassigned" title="Unassigned Requests" basePath="/admin/tickets" />
            </V3ProtectedRoute>} />
            <Route path="/admin/create" element={<V3ProtectedRoute pages={[["profix","create_request"],["profix","all_requests"]]}><CreateTicketPage /></V3ProtectedRoute>} />
            <Route path="/admin/tickets/:id" element={<V3ProtectedRoute pages={[["profix","ticket_detail"],["profix","all_requests"],["profix","open_requests"],["profix","unassigned"]]}><TicketDetailPage /></V3ProtectedRoute>} />

            {/* Manage screens — v3 gated. Permissions editor stays SA-only. */}
            <Route path="/admin/contacts" element={<V3ProtectedRoute pages={[["manage","employees"]]}><ContactListPage /></V3ProtectedRoute>} />
            <Route path="/admin/teams" element={<V3ProtectedRoute pages={[["manage","teams"]]}><TeamsPage /></V3ProtectedRoute>} />
            <Route path="/admin/permissions" element={<ProtectedRoute roles={SUPER_ADMIN_ONLY}><PermissionsPage /></ProtectedRoute>} />
            {/* Legacy: standalone permission-sets pages folded into Permissions tabs */}
            <Route path="/admin/permission-sets" element={<Navigate to="/admin/permissions" replace />} />
            <Route path="/admin/permission-sets/:id" element={<PermissionSetRedirect />} />
            <Route path="/admin/notifications" element={<V3ProtectedRoute pages={[["manage","notifications"]]}><NotificationsOutboxPage /></V3ProtectedRoute>} />
            <Route path="/admin/email-templates" element={<V3ProtectedRoute pages={[["manage","email_templates"]]}><EmailTemplatesPage /></V3ProtectedRoute>} />
            <Route path="/admin/notification-templates" element={<V3ProtectedRoute pages={[["manage","email_templates"]]}><NotificationTemplatesPage /></V3ProtectedRoute>} />

            {/* Workspace Manager — v3 gated */}
            <Route path="/workspace-manager/floor-layout" element={<V3ProtectedRoute pages={[["desk_booking","floor_layout"]]}><FloorLayoutPage /></V3ProtectedRoute>} />
            <Route path="/workspace-manager/floor-plans" element={<V3ProtectedRoute pages={[["desk_booking","floor_plans"]]}><FloorPlansListPage /></V3ProtectedRoute>} />
            <Route path="/workspace-manager/calibration/:planId" element={<V3ProtectedRoute pages={[["desk_booking","floor_plans"]]}><SeatCalibrationPage /></V3ProtectedRoute>} />
            {/* Legacy /calibration (no planId): redirect to the floor-plans list */}
            <Route path="/workspace-manager/calibration" element={<Navigate to="/workspace-manager/floor-plans" replace />} />
            <Route path="/workspace-manager/meeting-room-booking" element={<V3ProtectedRoute pages={[["desk_booking","meeting_room_bookings"]]}><MeetingRoomBookingPage /></V3ProtectedRoute>} />
            <Route path="/workspace-manager/workstation-booking" element={<V3ProtectedRoute pages={[["desk_booking","workstation_bookings"]]}><WorkstationBookingPage /></V3ProtectedRoute>} />
            <Route path="/workspace-manager/request-workstation" element={<V3ProtectedRoute pages={[["desk_booking","workstation_requests"]]}><RequestWorkstationPage /></V3ProtectedRoute>} />
            <Route path="/workspace-manager/pending-approvals" element={<V3ProtectedRoute pages={[["desk_booking","pending_approvals"]]}><PendingApprovalsPage /></V3ProtectedRoute>} />
            <Route path="/workspace-manager/bookings" element={<V3ProtectedRoute pages={[["desk_booking","bookings_history"]]}><BookingsPage /></V3ProtectedRoute>} />
            
            {/* CRM (label to be finalised later) — currently accessible to any Super Admin / Admin */}
            <Route path="/crm/segmentations" element={<ProtectedRoute roles={ADMIN_ROLES}><SegmentationsPage /></ProtectedRoute>} />
            <Route path="/crm/clients" element={<ProtectedRoute roles={ADMIN_ROLES}><ClientsPage /></ProtectedRoute>} />
            <Route path="/crm/segmentation-link-mockups" element={<ProtectedRoute roles={ADMIN_ROLES}><SegmentationLinkMockupsPage /></ProtectedRoute>} />
            <Route path="/crm/client-contacts" element={<ProtectedRoute roles={ADMIN_ROLES}><ClientContactsPage /></ProtectedRoute>} />
            <Route path="/crm/client-contacts/:id" element={<ProtectedRoute roles={ADMIN_ROLES}><ClientContactsPage /></ProtectedRoute>} />
            
            {/* Legacy redirect */}
            <Route path="/desk-booking" element={<Navigate to="/workspace-manager/floor-layout" replace />} />

            {/* Design preview — WM Overall dashboard */}
            <Route path="/mockup/wm-overall" element={<ProtectedRoute roles={ADMIN_ROLES}><WMOverallPreview /></ProtectedRoute>} />

            {/* Legacy paths from pre-v3 collapse — keep redirecting to unified admin shell */}
            <Route path="/manager/*" element={<Navigate to="/admin" replace />} />
            <Route path="/ra/*" element={<Navigate to="/admin" replace />} />
            <Route path="/dq/*" element={<Navigate to="/admin" replace />} />
            <Route path="/employee/*" element={<Navigate to="/admin" replace />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          {/* BusyOverlay is mounted inside <Layout> so it only covers the
              content area (sidebar + top bar remain interactive) for GET
              requests. Mutations (POST/PATCH/PUT/DELETE) instead trigger
              MutationBlocker below which covers the ENTIRE screen. */}
          <MutationBlocker />
          {/* Global confirm / prompt / alert dialog renderer */}
          <DialogHost />
        </BrowserRouter>
        </GlobalToaster>
        </EffectivePermissionsProvider>
      </AuthProvider>
      </BusyProvider>
    </div>
  );
}

export default App;
