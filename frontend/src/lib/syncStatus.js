// Helpers for the CRM MySQL → MongoDB "Sync" buttons.
//
// The list-page Sync runs a full mirror + recompute in the BACKGROUND. The UI
// gets a `run_id` back immediately and polls GET /crm-sync/status?run_id=… until
// the run finishes, then shows a summary (processed / updated / created /
// newly linked / failed).

// Poll a background sync run until it finishes (status "ok"/"failed") or times out.
// Returns the final `last_run` object (or null on timeout).
export async function pollSyncCompletion(
  api,
  runId,
  { intervalMs = 3000, timeoutMs = 8 * 60 * 1000 } = {}
) {
  const deadline = Date.now() + timeoutMs;
  // small initial delay so the background task can create/flip the run doc
  await new Promise((r) => setTimeout(r, 1200));
  while (Date.now() < deadline) {
    try {
      const res = await api.get("/crm-sync/status", {
        params: runId ? { run_id: runId } : {},
        silent: true,
      });
      const run = res.data?.last_run;
      if (run && (run.status === "ok" || run.status === "failed")) return run;
    } catch (_e) {
      // transient — keep polling
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

// Build a human summary line from a finished run for a given scope.
// scope: "clients" | "contacts"
export function formatSyncSummary(scope, run) {
  const r = scope === "clients" ? run?.result?.clients : run?.result?.contacts;
  const noun = scope === "clients" ? "Clients" : "Client Contacts";
  if (!r) return `All ${noun} synchronized successfully.`;
  const parts = [
    `${(r.processed ?? 0).toLocaleString()} processed`,
    `${(r.updated ?? 0).toLocaleString()} updated`,
    `${(r.created ?? 0).toLocaleString()} created`,
    `${(r.newly_linked ?? 0).toLocaleString()} newly linked`,
    `${(r.failed ?? 0).toLocaleString()} failed`,
  ];
  return `${noun}: ${parts.join(" · ")}`;
}

// "07 Sep 2026, 05:30 PM"
export function formatLastSynced(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const s = d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  // Uppercase only the am/pm marker (keep "Sep" as-is).
  return s.replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
}
