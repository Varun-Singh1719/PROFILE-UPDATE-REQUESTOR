import axios from "axios";
import { __busyBridge } from "../context/BusyContext";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const api = axios.create({
  baseURL: API,
});

/**
 * Auto-derive a friendly loading label from the HTTP method when none was
 * explicitly provided via `config.loadingLabel`.
 */
function defaultLabel(method) {
  const m = (method || "get").toLowerCase();
  if (m === "post")   return "Saving…";
  if (m === "patch")  return "Updating…";
  if (m === "put")    return "Updating…";
  if (m === "delete") return "Deleting…";
  return "Loading…";
}

// Methods that auto-trigger the global overlay. GETs now also trigger a
// content-area loader so pages show visual feedback while data is pending.
// Callers can opt out of the overlay via `silent: true` (used by background
// polling and hot-path calls that shouldn't flash the loader).
const TRIGGERS_OVERLAY = new Set(["get", "post", "put", "patch", "delete"]);

// Mutating verbs — used to tag the busy slot as "mutation" so the overlay
// escalates to a full-page block (user cannot fire another action mid-write).
const MUTATING = new Set(["post", "put", "patch", "delete"]);

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // Overlay opt-in/out:
  //   • `silent: true`             — never show overlay (use for polling)
  //   • `loadingLabel: "…"`         — always show overlay with that label
  //   • any tracked verb (default) — show overlay with auto label
  //     ("Loading…" for GET, "Saving…" for POST, etc.)
  //
  // Abort semantics:
  //   • Every GET request gets an AbortController registered as kind="read".
  //     If the user clicks another action element, __busyBridge.abortAllReads()
  //     will cancel the pending request and drop the response.
  //   • Mutations (POST/PATCH/PUT/DELETE) get kind="mutation" — the overlay
  //     goes full-page (see BusyOverlay + MutationBlocker) so the user can't
  //     fire another action mid-write. Backend can't be reliably aborted, so
  //     we let it run to completion for data integrity.
  //   • Callers can pass their own `config.signal` to opt out of auto-attach.
  const method = (config.method || "get").toLowerCase();
  const isTracked = TRIGGERS_OVERLAY.has(method);
  const isMutating = MUTATING.has(method);
  const wantsOverlay = !config.silent && (config.loadingLabel || isTracked);

  // Attach an AbortController so read requests can be aborted on user action.
  // Skip if the caller already supplied a signal (assume they manage it).
  let controller = null;
  if (!config.signal) {
    controller = new AbortController();
    config.signal = controller.signal;
  }

  if (wantsOverlay) {
    const explicit = config.loadingLabel;
    const label = explicit || (__busyBridge.hasLabel() ? null : defaultLabel(method));
    config.__busyToken = __busyBridge.start(label, {
      kind: isMutating ? "mutation" : "read",
      controller,
    });
  }
  return config;
});

function popIfNeeded(config) {
  if (config && config.__busyToken != null) {
    __busyBridge.stop(config.__busyToken);
    config.__busyToken = null;
  }
}

api.interceptors.response.use(
  (response) => { popIfNeeded(response.config); return response; },
  (error)    => {
    popIfNeeded(error?.config);
    // Aborted GET requests (via AbortController) — silently swallow. These
    // aren't real failures; the user simply moved on before the response.
    // axios v1 surfaces cancellations as ERR_CANCELED / axios.isCancel(error).
    if (axios.isCancel && axios.isCancel(error)) {
      // eslint-disable-next-line no-console
      // console.debug("[api] request aborted:", error?.config?.url);
      return new Promise(() => {}); // never resolve/reject — dead call
    }
    return Promise.reject(error);
  },
);

export function formatApiError(detail) {
  if (detail == null) return "Something went wrong.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(", ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export default api;
