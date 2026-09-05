import { useEffect, useRef } from "react";

/**
 * useTrackpadSwipeNav
 * ------------------------------------------------------------------
 * Turns a HORIZONTAL trackpad swipe (two-finger horizontal scroll) into a
 * single, debounced navigation callback while leaving normal vertical page
 * scrolling completely untouched.
 *
 * A trackpad emits dozens of `wheel` events for one physical swipe (plus a
 * long tail of inertial events). This hook:
 *   - only reacts to events that are CLEARLY horizontal
 *     (|deltaX| > |deltaY| * HORIZ_DOMINANCE)
 *   - accumulates deltaX across the gesture and fires ONCE when the
 *     accumulated distance crosses `threshold` (px)
 *   - locks itself after firing and ignores every further event of the same
 *     gesture (including inertia) until the gesture has been idle for
 *     `idleMs`
 *   - treats a gesture as "vertical" once it has moved > VERT_CANCEL px
 *     vertically, so a diagonal scroll never flips the record
 *   - calls `preventDefault()` on horizontal-dominant events so the browser
 *     does not hijack the swipe for history back/forward navigation
 *
 *   deltaX > 0  → fingers moved LEFT  (content scrolls right) → "next"
 *   deltaX < 0  → fingers moved RIGHT (content scrolls left)  → "prev"
 *
 * @param {object}   opts
 * @param {boolean}  opts.enabled     attach the listener only while true
 * @param {(dir: 'next'|'prev') => void} opts.onSwipe  navigation callback
 * @param {() => boolean} [opts.isBusy]  return true while a transition is
 *                                        running — gesture is ignored
 * @param {number}   [opts.threshold=70] accumulated px needed to trigger
 * @param {number}   [opts.idleMs=350]   idle gap that ends a gesture
 * @param {HTMLElement|Document|null} [opts.target=document]
 */
export function useTrackpadSwipeNav({
  enabled = true,
  onSwipe,
  isBusy,
  threshold = 70,
  idleMs = 350,
  target = null,
} = {}) {
  const onSwipeRef = useRef(onSwipe);
  const isBusyRef = useRef(isBusy);
  onSwipeRef.current = onSwipe;
  isBusyRef.current = isBusy;

  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof document === "undefined") return undefined;
    const el = target || document;

    const HORIZ_DOMINANCE = 1.5; // |dx| must beat |dy| by this factor
    const VERT_CANCEL = 30;      // px of vertical travel that marks a gesture vertical
    const MIN_DX = 2;            // ignore sub-pixel jitter

    // Per-gesture state
    let accX = 0;
    let accY = 0;
    let vertical = false;   // gesture decided to be a vertical scroll
    let locked = false;     // already fired for this gesture
    let lastAbsDx = 0;      // for "fresh swipe during inertia" detection
    let idleTimer = null;

    const resetGesture = () => {
      accX = 0;
      accY = 0;
      vertical = false;
      locked = false;
      lastAbsDx = 0;
      idleTimer = null;
    };

    const bumpIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(resetGesture, idleMs);
    };

    const normalize = (e) => {
      // deltaMode: 0 = pixels, 1 = lines, 2 = pages
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerWidth : 1;
      return { dx: e.deltaX * k, dy: e.deltaY * k };
    };

    const onWheel = (e) => {
      // Never interfere with wheel events inside dialogs / popups / inputs
      // that are rendered on top of the page (e.g. the Edit Contact form).
      if (e.target && typeof e.target.closest === "function") {
        if (e.target.closest("[role='dialog'], [data-radix-popper-content-wrapper], [data-swipe-ignore]")) {
          return;
        }
      }

      const { dx, dy } = normalize(e);
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      const horizontal = adx >= MIN_DX && adx > ady * HORIZ_DOMINANCE;

      bumpIdle();

      if (!horizontal) {
        // Vertical (or ambiguous diagonal) movement: let the page scroll.
        accY += ady;
        if (accY > VERT_CANCEL) {
          vertical = true;
          accX = 0;
        }
        return;
      }

      // Clearly horizontal → we own this event (stops browser back/forward swipe).
      if (e.cancelable) e.preventDefault();

      if (vertical) return; // gesture already classified as vertical scroll

      if (locked) {
        // A fresh, deliberate swipe started while the previous one's inertia
        // is still trickling in: inertia decays monotonically, so a sudden
        // spike in |dx| means new intent. Unlock and start accumulating.
        const fresh = adx >= 25 && adx > lastAbsDx * 2.5;
        lastAbsDx = adx;
        if (!fresh) return;
        locked = false;
        accX = 0;
      } else {
        lastAbsDx = adx;
      }

      accX += dx;
      if (Math.abs(accX) < threshold) return;

      // Threshold crossed → fire exactly once for this gesture.
      locked = true;
      const dir = accX > 0 ? "next" : "prev";
      accX = 0;

      if (typeof isBusyRef.current === "function" && isBusyRef.current()) return;
      if (typeof onSwipeRef.current === "function") onSwipeRef.current(dir);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel, { passive: false });
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, [enabled, threshold, idleMs, target]);
}

export default useTrackpadSwipeNav;
