/**
 * overviewMeta — shared loader for the CRM → Overview tab's DYNAMIC display
 * metadata (tab name / description). The label is NOT hardcoded anywhere; it
 * is served by GET /api/crm/overview/meta and cached module-wide so the
 * Sidebar, Page Header, Breadcrumbs and Navigation all render the same
 * configuration-driven name. Renaming the tab is a backend/DB-only change.
 */
import { useEffect, useState } from "react";
import api from "./api";

export const DEFAULT_OVERVIEW_META = {
  tab_name: "Overview",
  route_id: "crm_overview",
  description: "Cross-segmentation mapping between Infollion Research and a selected client.",
};

let _cache = null;
let _inflight = null;
const _subs = new Set();

export async function fetchOverviewMeta(force = false) {
  if (_cache && !force) return _cache;
  if (_inflight) return _inflight;
  _inflight = api
    .get("/crm/overview/meta")
    .then(({ data }) => {
      _cache = { ...DEFAULT_OVERVIEW_META, ...(data || {}) };
      _inflight = null;
      _subs.forEach((fn) => fn(_cache));
      return _cache;
    })
    .catch(() => {
      _inflight = null;
      return _cache || DEFAULT_OVERVIEW_META;
    });
  return _inflight;
}

/** React hook — returns the (possibly default) meta and refreshes when loaded. */
export function useOverviewMeta() {
  const [meta, setMeta] = useState(_cache || DEFAULT_OVERVIEW_META);
  useEffect(() => {
    let mounted = true;
    const sub = (m) => { if (mounted) setMeta(m); };
    _subs.add(sub);
    fetchOverviewMeta().then((m) => { if (mounted) setMeta(m); });
    return () => { mounted = false; _subs.delete(sub); };
  }, []);
  return meta;
}
