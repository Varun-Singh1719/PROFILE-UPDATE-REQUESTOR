import { useEffect } from "react";

/**
 * useWheelScrollIsolation
 * ------------------------------------------------------------------
 * Fixes trackpad / mouse-wheel scrolling for dropdown popups that are
 * rendered in a portal on `document.body` while a Radix Dialog (or any
 * `react-remove-scroll` based modal) is open.
 *
 * `react-remove-scroll` attaches a NON-passive `wheel` / `touchmove`
 * listener on `document` (bubble phase) and calls `preventDefault()` on
 * any scroll that happens OUTSIDE the dialog's own DOM subtree. A dropdown
 * list portalled to `document.body` is outside that subtree, so trackpad
 * scrolling on it gets blocked.
 *
 * By attaching our own NATIVE listener directly on the scroll container
 * (which sits deeper in the DOM than `document`), we run FIRST in the
 * bubble phase and `stopPropagation()` — the event never reaches the
 * document-level scroll-lock, so the browser scrolls the list natively.
 *
 * @param {React.RefObject<HTMLElement>} ref  scroll container element ref
 * @param {boolean} enabled                    attach only while open
 */
export function useWheelScrollIsolation(ref, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const el = ref.current;
    if (!el) return undefined;

    const stop = (e) => {
      // Do NOT preventDefault — we want the element's own native scroll to
      // happen. We only stop the event from bubbling up to the document-
      // level scroll-lock that would otherwise cancel it.
      e.stopPropagation();
    };

    el.addEventListener("wheel", stop, { passive: false });
    el.addEventListener("touchmove", stop, { passive: false });
    return () => {
      el.removeEventListener("wheel", stop, { passive: false });
      el.removeEventListener("touchmove", stop, { passive: false });
    };
  }, [ref, enabled]);
}

export default useWheelScrollIsolation;
