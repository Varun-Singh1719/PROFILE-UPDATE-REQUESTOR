import React, { useEffect, useState } from "react";
import { useBusy } from "../context/BusyContext";
import Loader2 from "@mui/icons-material/Autorenew";

/**
 * MutationBlocker — full-screen blocker rendered ONLY while a mutating
 * (POST/PATCH/PUT/DELETE) request is in flight.
 *
 * Rationale: mutations change server-side state, so the user must NOT be able
 * to trigger another action until the current write completes (mid-write
 * concurrency = data-integrity risk). Unlike `BusyOverlay` (which covers only
 * the content area for GET requests), this component covers the ENTIRE screen
 * including sidebar + top bar and swallows every pointer / keyboard event.
 *
 * Behaviour:
 *   • Fires within 200 ms of the mutating request starting (sub-200ms writes
 *     never flash).
 *   • Renders the current label ("Saving…", "Updating…", "Deleting…", …).
 */
const SPINNER_DELAY_MS = 200;

export default function MutationBlocker() {
  const { isMutating, label } = useBusy();
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    if (!isMutating) { setShowSpinner(false); return; }
    const t = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    return () => clearTimeout(t);
  }, [isMutating]);

  if (!isMutating || !showSpinner) return null;

  return (
    <div
      data-testid="mutation-blocker"
      aria-busy="true"
      aria-live="polite"
      role="status"
      className="fixed inset-0 z-[300] bg-white/55 backdrop-blur-[2px] transition-colors duration-200"
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
          data-testid="mutation-blocker-spinner"
          className="bg-white rounded-2xl shadow-2xl px-5 py-3.5 flex items-center gap-3 border border-[#ec9324]/20 animate-in fade-in zoom-in-95 duration-200 min-w-[240px]"
        >
          <Loader2 className="animate-spin text-[#ec9324] flex-shrink-0" sx={{ fontSize: 22 }}/>
          <span className="text-sm font-semibold text-gray-800" data-testid="mutation-blocker-label">
            {label || "Saving…"}
          </span>
        </div>
      </div>
    </div>
  );
}
