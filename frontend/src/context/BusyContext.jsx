import React, { createContext, useContext, useState, useCallback, useRef, useMemo, useEffect } from "react";

/**
 * BusyContext — global "is the app currently processing an action" state.
 *
 * Each `start(label?, options?)` returns a token. Call `stop(token)` (typically
 * in a `finally`) to release that slot. The overlay shows while any slot is
 * open and displays the most-recently-started label (e.g. "Saving…").
 *
 * options:
 *   - kind:     "read" | "mutation" (default "read")  — drives overlay scope
 *   - controller: AbortController (optional)          — enables abort-on-action
 *
 * Concurrency: uses a counter, so background save + foreground delete both
 * work without one clearing the other.
 *
 * Outside-React access: the singleton bridge (`__busyBridge`) lets non-React
 * code (e.g. axios interceptors) push/pop with the same semantics. Once the
 * BusyProvider mounts it registers its `start`/`stop` into the bridge.
 *
 * Abort semantics (Jul 2026):
 *   - Every GET request registers its AbortController with kind="read".
 *   - Every mutating request registers with kind="mutation" (never aborted).
 *   - A global mousedown-capture listener detects clicks on action elements
 *     (button / a[href] / [role=button]) and calls `abortAllReads()`, so slow
 *     background list-fetches don't linger after the user navigates.
 *   - Mutations always run to completion (data integrity — backend cannot be
 *     stopped mid-write). During mutations, a full-page blocker overlay is
 *     rendered so the user can't fire another action.
 */

const noop = () => {};
let _seq = 0;

// Tiny singleton bridge so non-React code can push/pop the global busy state.
export const __busyBridge = {
  start: (label, opts) => _busyFallback("start", { label, opts }),
  stop: (token) => _busyFallback("stop", token),
  hasLabel: () => false,
  abortAllReads: () => {},
};

// While no provider is mounted, queue ops so they replay on registration.
const _pending = [];
function _busyFallback(kind, arg) {
  _pending.push({ kind, arg, token: ++_seq });
  return _pending[_pending.length - 1].token;
}

const BusyContext = createContext({
  isBusy: false,
  isMutating: false,
  busyCount: 0,
  label: null,
  start: () => 0,
  stop: noop,
  abortAllReads: noop,
});

export function BusyProvider({ children }) {
  // We store token -> { label, kind, controller } so we can:
  //   - show the most-recent label
  //   - detect whether any active slot is a mutation (drives full-page block)
  //   - abort in-flight reads on demand
  const slotsRef = useRef(new Map());
  const [snap, setSnap] = useState({ count: 0, label: null, isMutating: false });

  const refresh = useCallback(() => {
    const slots = Array.from(slotsRef.current.values());
    const labels = slots.map((s) => s.label).filter(Boolean);
    const isMutating = slots.some((s) => s.kind === "mutation");
    setSnap({
      count: slotsRef.current.size,
      label: labels.length ? labels[labels.length - 1] : null,
      isMutating,
    });
  }, []);

  const start = useCallback((label, opts) => {
    const token = ++_seq;
    slotsRef.current.set(token, {
      label: label || null,
      kind: opts?.kind || "read",
      controller: opts?.controller || null,
    });
    refresh();
    return token;
  }, [refresh]);

  const stop = useCallback((token) => {
    if (slotsRef.current.delete(token)) refresh();
  }, [refresh]);

  const abortAllReads = useCallback(() => {
    const toDelete = [];
    for (const [tok, slot] of slotsRef.current.entries()) {
      if (slot.kind === "read" && slot.controller) {
        try { slot.controller.abort(); } catch { /* noop */ }
        toDelete.push(tok);
      }
    }
    if (toDelete.length) {
      for (const t of toDelete) slotsRef.current.delete(t);
      refresh();
    }
  }, [refresh]);

  // Register the real start/stop into the singleton bridge so non-React
  // callers (axios interceptors) push into THIS provider.
  useMemo(() => {
    __busyBridge.start = start;
    __busyBridge.stop = stop;
    __busyBridge.abortAllReads = abortAllReads;
    __busyBridge.hasLabel = () =>
      Array.from(slotsRef.current.values()).some((s) => !!s.label);
    // Replay anything that was queued before mount.
    while (_pending.length) {
      const op = _pending.shift();
      if (op.kind === "start") start(op.arg?.label, op.arg?.opts);
      // 'stop' ops queued before mount are dropped — they reference fallback tokens.
    }
  }, [start, stop, abortAllReads]);

  // Global click-abort listener — cancels all in-flight READ requests the
  // moment the user clicks an action element. Runs on mousedown-capture so it
  // fires BEFORE the click reaches React handlers (and BEFORE any new API
  // call is dispatched by the handler).
  useEffect(() => {
    const handler = (ev) => {
      // Only consider primary button (left click) to avoid aborting on scroll
      // or right-click menus.
      if (ev.button !== 0) return;
      const target = ev.target;
      if (!target || !target.closest) return;
      // Anything that looks like an "action" — button, link, or role=button.
      const el = target.closest(
        'button, a[href], [role="button"], [role="link"], [role="menuitem"], [role="tab"], input[type="submit"], input[type="button"]'
      );
      if (!el) return;
      // Skip disabled elements (they won't fire an action anyway).
      if (el.disabled || el.getAttribute("aria-disabled") === "true") return;
      // Skip elements explicitly opted out (e.g. modal internals that don't
      // trigger navigation / new API calls).
      if (el.closest('[data-no-abort="true"]')) return;
      abortAllReads();
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [abortAllReads]);

  const value = useMemo(() => ({
    isBusy: snap.count > 0,
    isMutating: snap.isMutating,
    busyCount: snap.count,
    label: snap.label,
    start, stop, abortAllReads,
  }), [snap, start, stop, abortAllReads]);

  return (
    <BusyContext.Provider value={value}>
      {children}
    </BusyContext.Provider>
  );
}

export const useBusy = () => useContext(BusyContext);
