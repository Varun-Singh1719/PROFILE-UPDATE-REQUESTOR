import React, { createContext, useContext, useState, useCallback, useRef, useMemo } from "react";

/**
 * BusyContext — global "is the app currently processing an action" state.
 *
 * Each `start(label?)` returns a token. Call `stop(token)` (typically in a
 * `finally`) to release that slot. The overlay shows while any slot is open
 * and displays the most-recently-started label (e.g. "Saving…", "Uploading…").
 *
 * Concurrency: uses a counter, so background save + foreground delete both
 * work without one clearing the other.
 *
 * Outside-React access: the singleton bridge (`__busyBridge`) lets non-React
 * code (e.g. axios interceptors) push/pop with the same semantics. Once the
 * BusyProvider mounts it registers its `start`/`stop` into the bridge.
 */

const noop = () => {};
let _seq = 0;

// Tiny singleton bridge so non-React code can push/pop the global busy state.
export const __busyBridge = {
  start: (label) => _busyFallback("start", label),
  stop: (token) => _busyFallback("stop", token),
  // hasLabel() lets callers (e.g. axios interceptors) skip adding their own
  // generic label when a more-specific one is already showing.
  hasLabel: () => false,
};

// While no provider is mounted, queue ops so they replay on registration.
const _pending = [];
function _busyFallback(kind, arg) {
  _pending.push({ kind, arg, token: ++_seq });
  return _pending[_pending.length - 1].token;
}

const BusyContext = createContext({
  isBusy: false,
  busyCount: 0,
  label: null,
  start: () => 0,
  stop: noop,
});

export function BusyProvider({ children }) {
  // We store { token -> label } so we can show the most recent label and
  // count concurrent operations correctly.
  const slotsRef = useRef(new Map());
  const [snap, setSnap] = useState({ count: 0, label: null });

  const refresh = useCallback(() => {
    const labels = Array.from(slotsRef.current.values()).filter(Boolean);
    setSnap({
      count: slotsRef.current.size,
      label: labels.length ? labels[labels.length - 1] : null,
    });
  }, []);

  const start = useCallback((label) => {
    const token = ++_seq;
    slotsRef.current.set(token, label || null);
    refresh();
    return token;
  }, [refresh]);

  const stop = useCallback((token) => {
    if (slotsRef.current.delete(token)) refresh();
  }, [refresh]);

  // Register the real start/stop into the singleton bridge so non-React
  // callers (axios interceptors) push into THIS provider.
  useMemo(() => {
    __busyBridge.start = start;
    __busyBridge.stop = stop;
    __busyBridge.hasLabel = () =>
      Array.from(slotsRef.current.values()).some(Boolean);
    // Replay anything that was queued before mount.
    while (_pending.length) {
      const op = _pending.shift();
      if (op.kind === "start") start(op.arg);
      // 'stop' ops queued before mount are dropped — they reference fallback tokens.
    }
  }, [start, stop]);

  const value = useMemo(() => ({
    isBusy: snap.count > 0,
    busyCount: snap.count,
    label: snap.label,
    start, stop,
  }), [snap, start, stop]);

  return (
    <BusyContext.Provider value={value}>
      {children}
    </BusyContext.Provider>
  );
}

export const useBusy = () => useContext(BusyContext);
