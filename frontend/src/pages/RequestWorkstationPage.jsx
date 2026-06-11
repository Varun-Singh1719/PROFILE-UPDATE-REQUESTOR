import React from "react";
import WorkstationBookingPage from "./WorkstationBookingPage";

/**
 * Request Workstation page — same UI/UX as Workstation Booking but instead of
 * creating a booking, it submits a request that goes into "Pending Approval".
 *
 * Implementation is a thin wrapper: WorkstationBookingPage accepts a `mode`
 * prop that switches between the booking and request flows (API endpoints,
 * button label, page title, no recurring section).
 */
export default function RequestWorkstationPage() {
  return <WorkstationBookingPage mode="request" />;
}
