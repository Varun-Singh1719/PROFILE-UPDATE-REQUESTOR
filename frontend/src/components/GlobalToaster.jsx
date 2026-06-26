import React from "react";
import { SnackbarProvider } from "notistack";

/**
 * GlobalToaster — single mount point for all app notifications.
 *
 *   • Built on `notistack` (SnackbarProvider).
 *   • Uses notistack's built-in variants — success / error / warning / info —
 *     which render with notistack's default coloured backgrounds and white text:
 *       success → #43a047 (green)
 *       error   → #d32f2f (red)
 *       warning → #ff9800 (orange)
 *       info    → #2196f3 (blue)
 *   • Positioned bottom-left across the app to match the previous toast layout.
 *
 * Use the `notify` helper from `lib/notify.js` for all app notifications
 * (it calls `enqueueSnackbar` under the hood).
 */
export default function GlobalToaster({ children }) {
  return (
    <SnackbarProvider
      maxSnack={5}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      autoHideDuration={4000}
      preventDuplicate
      dense={false}
    >
      {children}
    </SnackbarProvider>
  );
}
