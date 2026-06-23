# Global Action-Button Pattern

All buttons that trigger a backend process (Create / Save / Update / Delete / Upload /
Import / Export / Confirm / Approve / Assign / Book / Reschedule / Cancel / Generate /
anything that hits the server) must follow this pattern. The infrastructure is in
place — most cases need **no code changes** because the global axios interceptor
handles them automatically.

---

## How it works (the system, in one screen)

1. **`BusyContext`** (`src/context/BusyContext.jsx`) — singleton React context that
   tracks a stack of in-flight operations and exposes the most recent label.
   It also publishes a `__busyBridge` so non-React code (axios interceptors)
   can push/pop the same state.

2. **`BusyOverlay`** (`src/components/BusyOverlay.jsx`) — mounted once in
   `App.js`. Renders a full-screen blocker after a **200 ms grace period**.
   Captures every pointer + keyboard event → no double-clicks reach the UI.
   Shows the active label ("Saving…", "Uploading employees…", …).

3. **Axios interceptors** (`src/lib/api.js`) — every mutating call
   (`POST`/`PUT`/`PATCH`/`DELETE`) auto-pushes a label into the BusyContext
   on request and pops it on response or error. Result: **every existing
   button is already covered**.

4. **`useAction(fn, opts)`** + **`ActionButton`** — for per-button "Saving…"
   feedback (instant disable + inline spinner + success/error toast).

---

## Choose the right tool

### Default: nothing.
If your code already does `await api.post(...)`, you're already covered by
the global overlay. The button can have its own local `submitting` state if
you want a per-button spinner too — that's recommended for primary actions.

### Per-button feedback: use `ActionButton` (`src/components/ActionButton.jsx`).
```jsx
<ActionButton
  onClick={async () => api.post("/contacts", payload)}
  variant="primary"
  what="Create Employee"           // overlay reads "Create Employee…"
  successMessage="Employee created"
  icon={UserPlus}
>
  Create Employee
</ActionButton>
```
`ActionButton` automatically:
* disables instantly on click + sets `aria-busy`,
* renders an inline spinner with "Processing…" (or `loadingText`),
* re-enables on success **or** error (form data is preserved by caller),
* surfaces a success toast (if `successMessage`) and a structured error toast,
* swallows duplicate clicks while the promise is in flight.

### Custom shape: use the `useAction` hook directly.
```jsx
const { run: save, loading } = useAction(
  async () => api.post(...),
  { what: "Save Permission Set", successMessage: "Saved" }
);
<button disabled={loading} onClick={save}>Save</button>
```

### Raw fetch / XHR (file downloads, uploads with progress): push manually.
```js
import { __busyBridge } from "../context/BusyContext";
const t = __busyBridge.start("Exporting CSV…");
try { /* … */ } finally { __busyBridge.stop(t); }
```

---

## Custom labels for the overlay

For an `api.*` call, pass `loadingLabel` in the axios config:

```js
await api.post("/auth/change-password", body, { loadingLabel: "Updating password…" });
```

Without an explicit label, mutating verbs use these defaults:
| Method   | Default label |
|----------|---------------|
| `POST`   | Saving…       |
| `PATCH`  | Updating…     |
| `PUT`    | Updating…     |
| `DELETE` | Deleting…     |

If a more-specific label is already showing (because `useAction` pushed
`"Create Employee…"`), the axios interceptor pushes a *null* label so the
specific label keeps showing.

---

## Opt-out

Some flows shouldn't trigger the overlay:

```js
// Background polling, autosave, presence pings, etc.
await api.get("/notifications/unread", { silent: true });
await api.post("/heartbeat", null,      { silent: true });
```

GETs are silent by default. Only opt in for explicit user actions like
file exports.

---

## Form data preservation on error

ActionButton / useAction never reset your form state — the calling component
owns the form and is responsible for preserving it on error. Existing modals
(ChangePasswordModal, BulkUploadModal, etc.) follow this convention:
errors set an `err` string, fields remain populated, the user can correct
and retry.

---

## Performance budget

* Overlay appears within **200 ms** of the busy state starting (per spec).
* The "spinner pill" uses `animate-in fade-in zoom-in-95 duration-200` so it
  fades in rather than popping.
* Sub-200 ms requests never flash the overlay at all — important for the
  90% of API calls that complete instantly.

---

## Checklist before merging any new action

- [ ] Calls go through `api.*` (so the interceptor sees them), **or**
      `__busyBridge.start/stop` is wired manually.
- [ ] If the operation has a meaningful name, use `useAction` or
      `ActionButton` with `what:` / `loadingLabel:` set.
- [ ] On error, the form retains the user's input.
- [ ] No `notify.error(...)` *inside* the catch when `useAction`/`ActionButton`
      already handles it (double-toast).
- [ ] Optimistic UI updates (if any) revert on error.
