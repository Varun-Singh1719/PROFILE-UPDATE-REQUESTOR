/**
 * Shared helpers around the ticket-ID display convention.
 *
 * The backend stores ticket IDs with a prefix (e.g. "TCK-00512" or
 * "TKT-1102"), but the product surface should always display the numeric
 * portion only ("00512", "1102"). This mirrors the "All Requests" table.
 */

/**
 * Extract the numeric portion of a ticket ID.
 *   "TCK-00512" → "00512"
 *   "TKT-1102"  → "1102"
 *   "1102"      → "1102"
 *   null/""     → ""
 */
export function numericId(ticketId) {
  if (!ticketId) return "";
  const m = String(ticketId).match(/\d+/);
  return m ? m[0] : String(ticketId);
}

/**
 * Convenience: format as "Request 00512" for the copy paths that mention
 * a ticket by number (toasts, notification titles, page headers).
 */
export function formatRequestLabel(ticketId) {
  const n = numericId(ticketId);
  return n ? `Request ${n}` : "Request";
}
