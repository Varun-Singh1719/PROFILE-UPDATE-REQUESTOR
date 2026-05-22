import React, { useEffect, useState, useCallback } from "react";
import api from "../lib/api";

/**
 * Lightweight permission hook. Returns:
 * - can(module, feature, action): bool — true if user has the action.
 *   * Super Admin → always true.
 *   * Admin       → true iff at least one assigned Permission Set grants the action.
 *                   If the employee has no Permission Sets, defaults to false.
 *                   When the entire `effective` map is empty AND there are zero
 *                   assigned sets AND zero legacy rules, we fall back to default-allow
 *                   so legacy tickets/desk-booking flows keep working pre-onboarding.
 * - effective: raw effective access map
 * - role: user role
 * - sets:   list of assigned Permission Sets (for chips/labels)
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

  const isSuperAdmin = !!data?.sources?.super_admin;

  const can = useCallback(
    (module, feature, action) => {
      if (!data) return true; // default-allow while loading
      if (data?.sources?.super_admin) return true; // Super Admin → full access
      const eff = data.effective || {};
      const fmap = (eff[module] || {})[feature];
      const setsCount = data?.counts?.sets || 0;
      const totalRules = data?.counts?.total_rules || 0;
      if (!fmap) {
        // No effective entry for this feature.
        // Legacy default-allow only when the org has *no* Permission Sets and *no*
        // legacy rules at all (greenfield). Otherwise deny so set-based gating works.
        if (setsCount === 0 && totalRules === 0) return true;
        return false;
      }
      return !!fmap[action];
    },
    [data]
  );

  return {
    can,
    effective: data?.effective,
    role: data?.employee?.role,
    sets: data?.sources?.sets || [],
    isSuperAdmin,
    refresh,
    loaded,
  };
}
