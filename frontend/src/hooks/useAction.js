import { useState, useCallback, useRef, useEffect } from "react";
import { useBusy } from "../context/BusyContext";
import { notify } from "../lib/notify";

/**
 * useAction — wraps an async callback with:
 *   • double-click / re-entry protection
 *   • per-action `loading` state (for inline spinners on buttons)
 *   • global BusyContext start/stop (which drives the adaptive overlay)
 *   • automatic structured error toast via notify.error
 *   • optional success toast
 *   • cleanup on unmount (won't setState after unmount)
 *
 * Usage:
 *   const { run: save, loading } = useAction(
 *     async () => api.post(...),
 *     { what: "Save Permission Set", successMessage: "Saved" }
 *   );
 *   <button disabled={loading} onClick={save}>Save</button>
 *
 * Options:
 *   what:            string used in error title ("Couldn't <what>")
 *   successMessage:  string|((result)=>string) — toast on success (omit to skip)
 *   successDescription: string
 *   onError:         (err) => void — override default error toast
 *   onSuccess:       (result) => void
 *   silent:          true → skip error toast (caller handles)
 *   skipBusy:        true → don't toggle global overlay (still toggles `loading`)
 */
export function useAction(fn, opts = {}) {
  const [loading, setLoading] = useState(false);
  const { start, stop } = useBusy();
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const run = useCallback(async (...args) => {
    if (inFlightRef.current) return undefined;
    inFlightRef.current = true;
    setLoading(true);
    const o = optsRef.current || {};
    if (!o.skipBusy) start();
    try {
      const result = await fnRef.current(...args);
      if (o.successMessage) {
        const msg = typeof o.successMessage === "function" ? o.successMessage(result) : o.successMessage;
        notify.success(msg, { description: o.successDescription });
      }
      if (o.onSuccess) o.onSuccess(result);
      return result;
    } catch (err) {
      if (o.onError) o.onError(err);
      else if (!o.silent) notify.error(err, { what: o.what });
      throw err;
    } finally {
      if (mountedRef.current) setLoading(false);
      if (!o.skipBusy) stop();
      inFlightRef.current = false;
    }
  }, [start, stop]);

  return { run, loading };
}

export default useAction;
