import { enqueueSnackbar, closeSnackbar } from "notistack";

/**
 * Centralised notification helpers built on notistack's `enqueueSnackbar`.
 *
 * Variants and their notistack-default backgrounds (text is white on all):
 *   success → #43a047 (green)
 *   error   → #d32f2f (red)
 *   warning → #ff9800 (orange)
 *   info    → #2196f3 (blue)
 *
 * Usage:
 *   notify.success("Saved")
 *   notify.error(err, { what: "Save Permission Set" })
 *   notify.warning("Heads up")
 *   notify.info("FYI")
 *
 * The optional `description` is appended to the title on a second line.
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

/**
 * Combine title + description into a single string that notistack will render.
 * notistack v3 supports a `message` that can be a string or a ReactNode; we
 * keep it as a string with a newline so the snackbar wraps naturally.
 */
function composeMessage(title, description) {
  if (!description) return String(title ?? "");
  return `${title}\n${description}`;
}

const baseOptions = {
  // Allow the snackbar to wrap multi-line text from `composeMessage`.
  style: { whiteSpace: "pre-line" },
  preventDuplicate: true,
};

export const notify = {
  success(message, opts = {}) {
    return enqueueSnackbar(composeMessage(message, opts.description), {
      ...baseOptions,
      variant: "success",
      autoHideDuration: opts.duration ?? 3500,
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
    // Log to console for developers.
    try {
      // eslint-disable-next-line no-console
      console.warn(`[notify.error] (${status ?? "n/a"}) ${title}: ${description}`, err);
    } catch (_) { /* ignore */ }
    return enqueueSnackbar(composeMessage(title, description), {
      ...baseOptions,
      variant: "error",
      autoHideDuration: opts.duration ?? 6000,
    });
  },

  warning(message, opts = {}) {
    return enqueueSnackbar(composeMessage(message, opts.description), {
      ...baseOptions,
      variant: "warning",
      autoHideDuration: opts.duration ?? 4500,
    });
  },

  info(message, opts = {}) {
    return enqueueSnackbar(composeMessage(message, opts.description), {
      ...baseOptions,
      variant: "info",
      autoHideDuration: opts.duration ?? 3500,
    });
  },

  dismiss(id) {
    closeSnackbar(id);
  },
};

/**
 * Sonner-compatible `toast` shim — lets pages that previously did
 * `import { toast } from "sonner"` simply switch the import path to
 * `from "../lib/notify"` and keep working. All variants route through
 * notistack's `enqueueSnackbar` so they pick up the configured variants
 * (success / error / warning / info) with the correct colour + white text.
 *
 * Note: sonner's `toast.error("message")` shows the message as-is; we
 * therefore route it directly to enqueueSnackbar instead of through
 * `notify.error` (which wraps Axios errors with a "Couldn't ..." title).
 */
function toastFn(message, opts = {}) {
  return enqueueSnackbar(composeMessage(message, opts?.description), {
    ...baseOptions,
    variant: "default",
    autoHideDuration: opts?.duration ?? 3500,
  });
}
toastFn.success = (message, opts = {}) =>
  enqueueSnackbar(composeMessage(message, opts?.description), {
    ...baseOptions,
    variant: "success",
    autoHideDuration: opts?.duration ?? 3500,
  });
toastFn.error = (message, opts = {}) =>
  enqueueSnackbar(composeMessage(message, opts?.description), {
    ...baseOptions,
    variant: "error",
    autoHideDuration: opts?.duration ?? 6000,
  });
toastFn.warning = (message, opts = {}) =>
  enqueueSnackbar(composeMessage(message, opts?.description), {
    ...baseOptions,
    variant: "warning",
    autoHideDuration: opts?.duration ?? 4500,
  });
toastFn.info = (message, opts = {}) =>
  enqueueSnackbar(composeMessage(message, opts?.description), {
    ...baseOptions,
    variant: "info",
    autoHideDuration: opts?.duration ?? 3500,
  });
toastFn.dismiss = (id) => closeSnackbar(id);

export const toast = toastFn;

export default notify;
