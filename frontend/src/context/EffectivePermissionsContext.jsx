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
 *   - No assigned sets   → PERMISSIVE fallback: everything visible + usable.
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
  const isPermissive = ctx.is_super_admin || !ctx.has_any_set;
  /** Returns true when the given (module, page) page-level view is visible for
   * the current user. Permissive (Super Admin or no assigned sets) = always true.
   * Non-permissive with no entry for this page → hidden. */
  const isPageViewVisible = (moduleKey, pageKey) => {
    if (isPermissive) return true;
    const p = ((ctx.modules || {})[moduleKey] || {}).pages?.[pageKey];
    if (!p) return false;
    return !!p.view?.visible;
  };
  return { ready, isPermissive, isSuperAdmin: !!ctx.is_super_admin, isPageViewVisible, state: ctx };
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

  const isPermissive = state.is_super_admin || !state.has_any_set;

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
  const isPermissive = state.is_super_admin || !state.has_any_set;

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
