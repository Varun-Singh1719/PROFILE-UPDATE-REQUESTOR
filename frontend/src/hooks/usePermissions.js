import React, { useEffect, useState, useCallback } from "react";
import api from "../lib/api";

/**
 * Lightweight permission hook. Returns:
 * - can(module, feature, action): bool — true if user has the action,
 *   or true (default-allow) when no rules exist for the feature at all.
 * - effective: raw effective access map
 * - role: user role
 */
export function usePermissions() {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get("/permissions/me/effective");
      setData(r.data);
    } catch {
      setData(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const can = useCallback(
    (module, feature, action) => {
      if (!data) return true; // default-allow while loading
      const eff = data.effective || {};
      const fmap = (eff[module] || {})[feature];
      if (!fmap) return true; // no rules configured → default allow
      return !!fmap[action];
    },
    [data]
  );

  return { can, effective: data?.effective, role: data?.employee?.role, refresh, loaded };
}
