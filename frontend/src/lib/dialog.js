/**
 * Programmatic dialog helpers — fully in-app replacement for the browser's
 * native `window.alert()` / `window.confirm()` / `window.prompt()` modals.
 *
 *   await confirm({ title, message, confirmLabel, confirmVariant })  → Promise<boolean>
 *   await prompt({ title, message, defaultValue, placeholder })      → Promise<string|null>
 *   alert({ title, message })                                        → Promise<void>
 *
 * The actual UI is rendered by <DialogHost /> (see ../components/DialogHost.jsx),
 * which subscribes to events from this tiny pub/sub bus. The helpers return a
 * Promise that resolves when the user closes the dialog.
 *
 * NOTE: `alert(...)` here is the *async* in-app replacement; we never call
 * window.alert anywhere in the app.
 */

const listeners = new Set();

export function _subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(payload) {
  // Snapshot so a listener removing itself mid-iteration is safe.
  Array.from(listeners).forEach((fn) => fn(payload));
}

let _seq = 0;
const _resolvers = new Map(); // id -> (value) => void

export function _resolve(id, value) {
  const r = _resolvers.get(id);
  if (!r) return;
  _resolvers.delete(id);
  r(value);
}

function show(kind, opts = {}) {
  const id = ++_seq;
  return new Promise((resolve) => {
    _resolvers.set(id, resolve);
    emit({ id, kind, opts });
  });
}

/**
 * Show a Yes/No confirmation dialog. Resolves to true if confirmed, false otherwise.
 *
 *   const ok = await confirm({ title: "Delete?", message: "This is permanent." });
 *   if (!ok) return;
 */
export function confirm(opts = {}) {
  return show("confirm", {
    title: opts.title || "Are you sure?",
    message: opts.message || "",
    confirmLabel: opts.confirmLabel || "Confirm",
    cancelLabel: opts.cancelLabel || "Cancel",
    confirmVariant: opts.confirmVariant || "primary", // 'primary' | 'destructive'
  });
}

/**
 * Show a text-input dialog. Resolves to the entered string, or null on cancel.
 *
 *   const url = await prompt({ title: "Link URL", defaultValue: "https://" });
 *   if (!url) return;
 */
export function prompt(opts = {}) {
  return show("prompt", {
    title: opts.title || "Input required",
    message: opts.message || "",
    defaultValue: opts.defaultValue ?? "",
    placeholder: opts.placeholder || "",
    confirmLabel: opts.confirmLabel || "OK",
    cancelLabel: opts.cancelLabel || "Cancel",
    inputType: opts.inputType || "text",
  });
}

/**
 * Show a single-button informational dialog (rarely needed — prefer
 * `notify.error()` / `notify.info()` snackbars for transient messages).
 */
export function alert(opts = {}) {
  return show("alert", {
    title: opts.title || "Notice",
    message: opts.message || "",
    confirmLabel: opts.confirmLabel || "OK",
  });
}

const dialog = { confirm, prompt, alert };
export default dialog;
