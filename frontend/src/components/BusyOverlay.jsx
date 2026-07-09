import React, { useEffect, useState } from "react";
import { useBusy } from "../context/BusyContext";
import { Loader2 } from "lucide-react";

/**
 * BusyOverlay — content-area page loader (READ requests only).
 *
 * Renders inside the main content area (positioned `absolute inset-0`), so
 * the sidebar and top bar remain unaffected and interactive during GET waits.
 *
 * For mutating requests (POST/PATCH/PUT/DELETE) this overlay does NOT render —
 * see `MutationBlocker` instead, which covers the ENTIRE screen so the user
 * can't fire another action mid-write.
 *
 * Behaviour:
 *   • Fires within 200 ms of a request starting (sub-200 ms calls never flash).
 *   • Sidebar + top bar are NOT covered — the user can still navigate. Any
 *     new navigation click aborts in-flight reads (see BusyContext).
 */
const SPINNER_DELAY_MS = 200;

export default function BusyOverlay() {
  const { isBusy, isMutating, label } = useBusy();
  const [showSpinner, setShowSpinner] = useState(false);

  // Only show this scoped overlay when there is a read in flight (and no
  // mutation — mutations get the full-page MutationBlocker instead).
  const active = isBusy && !isMutating;

  useEffect(() => {
    if (!active) { setShowSpinner(false); return; }
    const t = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    return () => clearTimeout(t);
  }, [active]);

  if (!active || !showSpinner) return null;

  return (
    <div
      data-testid="busy-overlay"
      aria-busy="true"
      aria-live="polite"
      role="status"
      className="absolute inset-0 z-40 transition-colors duration-200 bg-white/60 backdrop-blur-[2px] pointer-events-auto"
      style={{ cursor: "wait" }}
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
