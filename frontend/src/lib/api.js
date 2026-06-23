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
  return "Processing…";
}

// Methods that auto-trigger the global overlay (mutating verbs only — GETs
// are usually background fetches / page loads / polling and shouldn't flash).
const MUTATING = new Set(["post", "put", "patch", "delete"]);

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // Overlay opt-in/out:
  //   • `silent: true`             — never show overlay (use for polling)
  //   • `loadingLabel: "…"`         — always show overlay with that label
  //   • mutating verb (default)    — show overlay with auto label ("Saving…", etc.)
  const method = (config.method || "get").toLowerCase();
  const isMutating = MUTATING.has(method);
  const wantsOverlay = !config.silent && (config.loadingLabel || isMutating);
  if (wantsOverlay) {
    // If a more-specific label is already showing (e.g. set by useAction wrapping
    // this call), don't clobber it with our generic "Saving…" — push a null
    // label so we still bump the counter but the existing label keeps showing.
    const explicit = config.loadingLabel;
    const label = explicit || (__busyBridge.hasLabel() ? null : defaultLabel(method));
    config.__busyToken = __busyBridge.start(label);
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
  (error)    => { popIfNeeded(error?.config);    return Promise.reject(error); },
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
