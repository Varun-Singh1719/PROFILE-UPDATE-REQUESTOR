import React, { useEffect, useState } from "react";
import { useBusy } from "../context/BusyContext";
import { Loader2 } from "lucide-react";

/**
 * BusyOverlay — content-area page loader.
 *
 * Renders inside the main content area (positioned `absolute inset-0`), so
 * the sidebar and top bar remain unaffected and interactive during API waits.
 *
 * Behaviour:
 *   • Fires within 200 ms of a request starting (sub-200 ms calls never flash).
 *   • Blocks pointer/keyboard events inside the content area so double-submits
 *     against the currently-loading page are prevented.
 *   • Shows the currently active label ("Loading…", "Saving…", "Uploading…", …).
 *   • Sidebar + top bar are NOT covered — the user can still navigate.
 */
const SPINNER_DELAY_MS = 200;

export default function BusyOverlay() {
  const { isBusy, label } = useBusy();
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    if (!isBusy) { setShowSpinner(false); return; }
    const t = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    return () => clearTimeout(t);
  }, [isBusy]);

  if (!isBusy || !showSpinner) return null;

  return (
    <div
      data-testid="busy-overlay"
      aria-busy="true"
      aria-live="polite"
      role="status"
      className="absolute inset-0 z-40 transition-colors duration-200 bg-white/60 backdrop-blur-[2px]"
      style={{ cursor: "wait" }}
      onClickCapture={(e) => { e.stopPropagation(); e.preventDefault(); }}
      onMouseDownCapture={(e) => { e.stopPropagation(); e.preventDefault(); }}
      onKeyDownCapture={(e) => {
        // Allow Tab navigation for accessibility, block everything else
        if (e.key !== "Tab") { e.stopPropagation(); e.preventDefault(); }
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          data-testid="busy-overlay-spinner"
          className="bg-white rounded-2xl shadow-2xl px-5 py-3.5 flex items-center gap-3 border border-[#ec9324]/20 animate-in fade-in zoom-in-95 duration-200 min-w-[220px]"
        >
          <Loader2 className="animate-spin text-[#ec9324] flex-shrink-0" size={20} />
          <span className="text-sm font-medium text-gray-800" data-testid="busy-overlay-label">
            {label || "Loading…"}
          </span>
        </div>
      </div>
    </div>
  );
}
