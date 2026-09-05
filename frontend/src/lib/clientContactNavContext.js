/**
 * clientContactNavContext
 * ------------------------------------------------------------------
 * Remembers the exact order of the Client Contact LIST (after search,
 * client filter, sort and pagination) so the Detail view can navigate
 * prev/next with a trackpad swipe in the same order the user saw.
 *
 * Stored in sessionStorage (per browser tab) — it survives a page refresh
 * of the detail view but never leaks between tabs.
 *
 * Shape:
 * {
 *   ids:       string[]   ordered contact ids currently loaded (may span
 *                         several list pages once the detail view extends it)
 *   pageStart: number     first list page whose ids are loaded (1-based)
 *   pageEnd:   number     last list page whose ids are loaded
 *   pageSize:  number
 *   total:     number     total rows matching the filters (from the API)
 *   params:    { search, clientFilter, sortKey }
 *   ts:        number
 * }
 */

const KEY = "cc_list_nav_ctx_v1";

export function saveClientContactNavContext(ctx) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...ctx, ts: Date.now() }));
  } catch {
    /* storage unavailable — swipe navigation simply stays disabled */
  }
}

export function loadClientContactNavContext() {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const ctx = JSON.parse(raw);
    if (!ctx || !Array.isArray(ctx.ids) || ctx.ids.length === 0) return null;
    return ctx;
  } catch {
    return null;
  }
}

export function clearClientContactNavContext() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
