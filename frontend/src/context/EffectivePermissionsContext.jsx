/**
 * EffectivePermissionsContext — Round 3 of the Permissions V3 redesign.
 *
 * Loads the effective (merged) v3 permission matrix for the CURRENT user once
 * from `/api/me/permissions` and exposes it via a lightweight context so any
 * component can gate UI elements without making its own request.
 *
 * Public API:
 *   const { canView, canEdit, canUse, isVisible, ready } =
 *       useEffectivePermission(module, page, functionKey);
 *
 * Rules (client-side hide only, per user instruction):
 *   - Super Admin        → everything visible + usable.
 *   - No assigned sets   → STRICT: nothing visible, nothing usable (Sidebar
 *                          shows "No Module Assigned. Contact Superadmin.")
 *                          All Admin/User access must be granted via assigned
 *                          Permission Sets — no defaults.
 *   - Assigned sets      → merged {enabled, visible, scope} triple.
 *
 *   • `isVisible`  → false hides the UI element (button not rendered).
 *   • `canUse`     → false disables the UI element (still rendered).
 *   • `canView`    → page-level view scope truthy.
 *   • `canEdit`    → page-level edit scope truthy.
 *
 * NOTE: The backend still allows the underlying API call. This hook only
 * controls *client-side* visibility/enable state.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import api from "../lib/api";
import { useAuth } from "./AuthContext";

const EffectivePermissionsContext = createContext(null);

const EMPTY = {
  is_super_admin: false,
  has_any_set: false,
  set_ids: [],
  modules: {},
};

export function EffectivePermissionsProvider({ children }) {
  const { user } = useAuth() || {};
  const [state, setState] = useState(EMPTY);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setState(EMPTY);
      setReady(false);
      return;
    }
    try {
      const r = await api.get("/me/permissions");
      setState(r.data || EMPTY);
    } catch (err) {
      // On failure, fall back to permissive (don't lock users out on flaky net).
      setState(EMPTY);
    } finally {
      setReady(true);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(() => ({ ...state, ready, refresh }), [state, ready, refresh]);

  return (
    <EffectivePermissionsContext.Provider value={value}>
      {children}
    </EffectivePermissionsContext.Provider>
  );
}

function _lookup(state, moduleKey, pageKey, functionKey) {
  const page =
    ((state?.modules || {})[moduleKey] || {}).pages?.[pageKey] || null;
  if (!page) return null;
  if (functionKey === "view") return page.view || null;
  if (functionKey === "edit") return page.edit || null;
  return (page.functions || {})[functionKey] || null;
}

export function useEffectivePermissionsState() {
  const ctx = useContext(EffectivePermissionsContext) || EMPTY;
  const ready = !!ctx?.ready;
  // STRICT gating: only Super Admin is permissive. Admins/Users without
  // any assigned Permission Sets get an empty view (Sidebar surfaces the
  // "No Module Assigned. Contact Superadmin." message).
  const isPermissive = !!ctx.is_super_admin;
  const hasAnySet = !!ctx.has_any_set;
  /** Returns true when the given (module, page) page is BOTH visible AND
   * enabled for the current user — i.e. the user should see it in the
   * sidebar / navigation. Pages that are marked visible but with
   * `view.enabled = false` are still "in the catalog" for the user but
   * they can't actually navigate to / use them, so we exclude them from
   * navigation surfaces (a disabled page in the sidebar is a dead link).
   * Permissive (Super Admin) = always true.
   * Non-permissive with no entry for this page → hidden.
   */
  const isPageViewVisible = (moduleKey, pageKey) => {
    if (isPermissive) return true;
    const p = ((ctx.modules || {})[moduleKey] || {}).pages?.[pageKey];
    if (!p) return false;
    return !!p.view?.visible && !!p.view?.enabled;
  };
  /** Returns the dashboard access level for a given product
   * ("workspace_manager" | "profix") based on the assigned Permission Sets.
   *
   * Returns:
   *   "overall"     — user gets the organisation-wide dashboard
   *   "manager"     — user gets the Team Manager dashboard
   *   "individual"  — user gets the Individual dashboard
   *   null          — user has NO dashboard access for this product
   *                   → frontend should render "No Dashboard Shared".
   *
   * Super Admin ALWAYS gets "overall" (bypasses the permission).
   */
  const getDashboardAccess = (product) => {
    if (ctx.is_super_admin) return "overall";
    const dash = (ctx.modules || {}).dashboard?.pages?.[product];
    return dash?.access_level || null;
  };
  /** Returns the ProfiX dashboard "metrics_based_on" configuration.
   *
   * Values: "created_by" (default) | "assigned_to"
   *
   * Super Admin also honors any per-Permission-Set override (falls back to
   * "created_by" when nothing configured). This drives the ticket-owner field
   * used to compute ProfiX Dashboard cards + Team stats.
   */
  const getDashboardMetricsBasedOn = (product) => {
    if (product !== "profix") return null;
    const dash = (ctx.modules || {}).dashboard?.pages?.profix;
    const v = dash?.metrics_based_on;
    if (v === "created_by" || v === "assigned_to") return v;
    return "created_by";
  };
  // True when the caller has AT LEAST ONE effective (module, page) with
  // view.enabled+visible OR any dashboard access — used by Sidebar to
  // decide between rendering the "No Module Assigned" banner vs. an
  // empty nav pane. Fixes the case where a user is assigned a set whose
  // `modules` map is entirely empty (or all-disabled).
  const hasAnyEffectivePermission = (() => {
    if (isPermissive) return true;
    const mods = ctx.modules || {};
    for (const mk of Object.keys(mods)) {
      const pages = (mods[mk] || {}).pages || {};
      for (const pk of Object.keys(pages)) {
        const entry = pages[pk] || {};
        if (entry?.view?.enabled && entry?.view?.visible) return true;
        if (typeof entry?.access_level === "string" && entry.access_level) return true;
      }
    }
    return false;
  })();
  return { ready, isPermissive, hasAnySet, hasAnyEffectivePermission, isSuperAdmin: !!ctx.is_super_admin, isPageViewVisible, getDashboardAccess, getDashboardMetricsBasedOn, state: ctx };
}

/**
 * Look up permission for (module, page, function).
 *
 * Fallback matrix (must stay in sync with server-side `/api/me/permissions`):
 *   - Super Admin OR no assigned sets → permissive (visible + enabled).
 *   - Assigned sets but this specific function has no entry → hidden + disabled.
 */
export function useEffectivePermission(moduleKey, pageKey, functionKey) {
  const ctx = useContext(EffectivePermissionsContext);
  const state = ctx || EMPTY;
  const ready = !!ctx?.ready;

  const isPermissive = !!state.is_super_admin;

  const entry = _lookup(state, moduleKey, pageKey, functionKey);
  const pageBlock = ((state.modules || {})[moduleKey] || {}).pages?.[pageKey] || null;

  const isVisible = isPermissive
    ? true
    : entry
      ? !!entry.visible
      : false;

  const canUse = isPermissive
    ? true
    : entry
      ? !!entry.enabled && !!entry.visible
      : false;

  const canView = isPermissive
    ? true
    : !!pageBlock?.view?.enabled && !!pageBlock?.view?.visible;

  const canEdit = isPermissive
    ? true
    : !!pageBlock?.edit?.enabled && !!pageBlock?.edit?.visible;

  const scope = isPermissive ? "overall" : entry?.scope || null;

  return { ready, isVisible, canUse, canView, canEdit, scope, isSuperAdmin: state.is_super_admin };
}

/**
 * Convenience hook for a whole page — returns page-level view/edit state and
 * an `fn(functionKey)` helper for per-function lookups on that page.
 */
export function useEffectivePage(moduleKey, pageKey) {
  const ctx = useContext(EffectivePermissionsContext) || EMPTY;
  const state = ctx;
  const ready = !!ctx?.ready;
  const isPermissive = !!state.is_super_admin;

  const pageBlock = ((state.modules || {})[moduleKey] || {}).pages?.[pageKey] || null;

  const fn = useCallback(
    (functionKey) => {
      const entry = _lookup(state, moduleKey, pageKey, functionKey);
      if (isPermissive) {
        return { isVisible: true, canUse: true, scope: "overall" };
      }
      if (!entry) {
        return { isVisible: false, canUse: false, scope: null };
      }
      return {
        isVisible: !!entry.visible,
        canUse: !!entry.enabled && !!entry.visible,
        scope: entry.scope || null,
      };
    },
    [state, moduleKey, pageKey, isPermissive]
  );

  return {
    ready,
    canView: isPermissive ? true : !!pageBlock?.view?.enabled && !!pageBlock?.view?.visible,
    canEdit: isPermissive ? true : !!pageBlock?.edit?.enabled && !!pageBlock?.edit?.visible,
    viewScope: isPermissive ? "overall" : pageBlock?.view?.scope || null,
    editScope: isPermissive ? "overall" : pageBlock?.edit?.scope || null,
    isSuperAdmin: state.is_super_admin,
    fn,
  };
}

/**
 * Small wrapper: renders `children` only when the function is visible.
 *
 *   <IfVisible module="profix" page="all_requests" fn="create_ticket">
 *     <Button>New Ticket</Button>
 *   </IfVisible>
 */
export function IfVisible({ module: mKey, page: pKey, fn: fKey, fallback = null, children }) {
  const { isVisible } = useEffectivePermission(mKey, pKey, fKey);
  return isVisible ? children : fallback;
}
