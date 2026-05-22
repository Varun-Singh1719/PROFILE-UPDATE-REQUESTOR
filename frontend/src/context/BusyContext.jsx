import React, { createContext, useContext, useState, useCallback, useRef } from "react";

/**
 * BusyContext — global "is the app currently processing an action" state.
 * Uses a counter so concurrent actions work correctly (e.g. background save + foreground delete).
 */
const BusyContext = createContext({
  isBusy: false,
  busyCount: 0,
  start: () => {},
  stop: () => {},
});

export function BusyProvider({ children }) {
  const counterRef = useRef(0);
  const [busyCount, setBusyCount] = useState(0);

  const start = useCallback(() => {
    counterRef.current += 1;
    setBusyCount(counterRef.current);
  }, []);

  const stop = useCallback(() => {
    counterRef.current = Math.max(0, counterRef.current - 1);
    setBusyCount(counterRef.current);
  }, []);

  return (
    <BusyContext.Provider value={{ isBusy: busyCount > 0, busyCount, start, stop }}>
      {children}
    </BusyContext.Provider>
  );
}

export const useBusy = () => useContext(BusyContext);
