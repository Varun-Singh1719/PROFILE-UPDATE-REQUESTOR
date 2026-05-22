import { toast } from "sonner";

/**
 * Centralised toast helpers with structured error formatting and a consistent
 * orange-on-white theme (applied via the global Toaster's toastOptions).
 *
 * Usage:
 *   notify.success("Saved", { description: "Settings applied." })
 *   notify.error(err, { what: "Save Permission Set" })
 *   notify.warning("Heads up", { description: "..." })
 *   notify.info("FYI")
 *   notify.confirm({ title, description, confirmLabel, onConfirm })
 */

// HTTP status → suggested corrective action.
const HTTP_HINTS = {
  400: "Please review the form and try again.",
  401: "Your session has expired — please sign in again.",
  403: "You don't have permission. Ask a Super Admin.",
  404: "It may have been removed — please refresh the page.",
  409: "The data changed since you opened this page — refresh and retry.",
  413: "The upload is too large.",
  422: "Some fields are invalid — please review the form.",
  429: "Too many requests — wait a moment and try again.",
  500: "The server hit an error. Please retry; contact support if it persists.",
  502: "Couldn't reach the server. Please retry.",
  503: "The service is temporarily unavailable. Please retry.",
};

function extractError(err) {
  if (!err) return { message: "Unknown error", hint: null, status: null };
  if (typeof err === "string") return { message: err, hint: null, status: null };

  const status = err?.response?.status ?? null;
  const data = err?.response?.data;
  const detail = data?.detail;
  let detailText = null;

  if (typeof detail === "string") {
    detailText = detail;
  } else if (Array.isArray(detail) && detail.length) {
    // Pydantic v2 validation errors: array of {loc, msg, type, ...}
    detailText = detail
      .map((d) => {
        const field = (d.loc || []).slice(-1)[0] || "field";
        return `${field}: ${d.msg}`;
      })
      .join("; ");
  } else if (detail?.msg) {
    detailText = detail.msg;
  } else if (typeof data === "string") {
    detailText = data;
  } else if (err?.message && !/^AxiosError/i.test(err.message)) {
    detailText = err.message;
  }
  if (!detailText && err?.code === "ERR_NETWORK") detailText = "Network unreachable.";
  if (!detailText) detailText = "Something went wrong.";

  let hint = (status && HTTP_HINTS[status]) || null;
  if (!hint && err?.code === "ERR_NETWORK") hint = "Check your internet connection and retry.";

  return { message: detailText, hint, status };
}

export const notify = {
  success(message, opts = {}) {
    return toast.success(message, {
      description: opts.description,
      duration: opts.duration ?? 3500,
      closeButton: opts.closeButton ?? true,
    });
  },
  error(err, opts = {}) {
    const { message, hint, status } = extractError(err);
    const title = opts.title
      ? opts.title
      : opts.what
        ? `Couldn't ${opts.what.replace(/^\w/, (c) => c.toLowerCase())}`
        : "Action failed";
    const description = [message, hint].filter(Boolean).join("\n");
    // Log to console for developers
    try {
      // eslint-disable-next-line no-console
      console.warn(`[notify.error] (${status ?? "n/a"}) ${title}: ${description}`, err);
    } catch (_) { /* ignore */ }
    return toast.error(title, {
      description,
      duration: opts.duration ?? 6000,
      closeButton: opts.closeButton ?? true,
    });
  },
  warning(message, opts = {}) {
    return toast.warning(message, {
      description: opts.description,
      duration: opts.duration ?? 4500,
      closeButton: opts.closeButton ?? true,
    });
  },
  info(message, opts = {}) {
    return toast(message, {
      description: opts.description,
      duration: opts.duration ?? 3500,
      closeButton: opts.closeButton ?? true,
    });
  },
  dismiss(id) { toast.dismiss(id); },
};

export default notify;
