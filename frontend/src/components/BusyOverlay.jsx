import React, { useEffect, useState } from "react";
import { useBusy } from "../context/BusyContext";
import { Loader2 } from "lucide-react";

/**
 * BusyOverlay — adaptive global blocker.
 *
 * Behaviour (matches the global Action-Button spec):
 *   • Fires within 200 ms of an action starting (sub-200 ms calls never flash).
 *   • Blocks every pointer/keyboard event on the page underneath, so no
 *     double-clicks can reach any button.
 *   • Renders the currently active label ("Saving…", "Uploading file…", etc.).
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

  if (!isBusy) return null;

  return (
    <div
      data-testid="busy-overlay"
      aria-busy="true"
      aria-live="polite"
      role="status"
      className={`fixed inset-0 z-[200] transition-colors duration-200 ${
        showSpinner ? "bg-white/45 backdrop-blur-[2px]" : "bg-transparent"
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
            className="bg-white rounded-2xl shadow-2xl px-5 py-3.5 flex items-center gap-3 border border-[#ec9324]/20 animate-in fade-in zoom-in-95 duration-200 min-w-[220px]"
          >
            <Loader2 className="animate-spin text-[#ec9324] flex-shrink-0" size={20} />
            <span className="text-sm font-medium text-gray-800" data-testid="busy-overlay-label">
              {label || "Processing…"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
