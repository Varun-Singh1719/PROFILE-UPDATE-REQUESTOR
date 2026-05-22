import React, { useEffect, useState } from "react";
import { useBusy } from "../context/BusyContext";
import { Loader2 } from "lucide-react";

/**
 * BusyOverlay — adaptive global blocker.
 *
 * Adaptive behavior:
 *   - Immediately after `isBusy` becomes true, render a near-invisible click-blocker
 *     so users can't double-click or interact while we wait.
 *   - If the busy state persists for more than `SPINNER_DELAY_MS`, fade in a centered
 *     "Processing…" pill so the user has an obvious cue.
 *
 * Pointer events are captured to prevent any clicks bubbling to the underlying UI.
 */
const SPINNER_DELAY_MS = 400;

export default function BusyOverlay() {
  const { isBusy } = useBusy();
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    if (!isBusy) {
      setShowSpinner(false);
      return;
    }
    const t = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    return () => clearTimeout(t);
  }, [isBusy]);

  if (!isBusy) return null;

  return (
    <div
      data-testid="busy-overlay"
      aria-busy="true"
      aria-live="polite"
      className={`fixed inset-0 z-[200] transition-colors duration-200 ${
        showSpinner ? "bg-white/40" : "bg-transparent"
      }`}
      style={{ cursor: "wait" }}
      onClickCapture={(e) => { e.stopPropagation(); e.preventDefault(); }}
      onMouseDownCapture={(e) => { e.stopPropagation(); e.preventDefault(); }}
      onKeyDownCapture={(e) => {
        // Allow Tab navigation for accessibility, block everything else
        if (e.key !== "Tab") { e.stopPropagation(); e.preventDefault(); }
      }}
    >
      {showSpinner && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            data-testid="busy-overlay-spinner"
            className="bg-white rounded-2xl shadow-2xl px-5 py-3.5 flex items-center gap-3 border border-[#ec9324]/20 animate-in fade-in zoom-in-95 duration-200"
          >
            <Loader2 className="animate-spin text-[#ec9324]" size={20} />
            <span className="text-sm font-medium text-gray-800">Processing…</span>
          </div>
        </div>
      )}
    </div>
  );
}
