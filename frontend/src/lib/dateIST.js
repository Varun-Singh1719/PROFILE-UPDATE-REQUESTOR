/**
 * IST (Asia/Kolkata) date/time formatting helpers.
 *
 * Jul 2025 — the entire app is standardised on IST. All persisted timestamps
 * are IST-tagged (+05:30). To make the UI show IST regardless of the browser
 * locale, ALWAYS format ISO strings through these helpers instead of raw
 * `toLocaleString(undefined, ...)`.
 *
 * Any function accepts either an ISO string OR a Date. Falsy inputs return "".
 */

const IST_TZ = "Asia/Kolkata";
const IST_LOCALE = "en-IN";

const _toDate = (v) => {
  if (!v && v !== 0) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  try {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
};

const _with = (opts) => ({ timeZone: IST_TZ, ...opts });

/** "12 Jul 2025, 04:32 PM" */
export const formatISTDateTime = (v, opts = {}) => {
  const d = _toDate(v);
  if (!d) return "";
  return d.toLocaleString(
    IST_LOCALE,
    _with({
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      ...opts,
    })
  );
};

/** "12 Jul 2025" */
export const formatISTDate = (v, opts = {}) => {
  const d = _toDate(v);
  if (!d) return "";
  return d.toLocaleDateString(
    IST_LOCALE,
    _with({ day: "2-digit", month: "short", year: "numeric", ...opts })
  );
};

/** "04:32 PM" */
export const formatISTTime = (v, opts = {}) => {
  const d = _toDate(v);
  if (!d) return "";
  return d.toLocaleTimeString(
    IST_LOCALE,
    _with({ hour: "2-digit", minute: "2-digit", hour12: true, ...opts })
  );
};

/** "Sat, 12 Jul" — used in day-strip headings */
export const formatISTShort = (v) => {
  const d = _toDate(v);
  if (!d) return "";
  return d.toLocaleDateString(
    IST_LOCALE,
    _with({ weekday: "short", day: "2-digit", month: "short" })
  );
};

/** "YYYY-MM-DD" in IST — for storing / comparing dates with backend `date` fields. */
export const istDateISO = (v) => {
  const d = _toDate(v) || new Date();
  // Use en-CA locale to get "YYYY-MM-DD" naturally.
  return d.toLocaleDateString("en-CA", { timeZone: IST_TZ });
};

/** Today (YYYY-MM-DD) in IST. */
export const istTodayISO = () => istDateISO(new Date());

/** "12 Jul 2025 · 04:32 PM" — used in list rows. */
export const formatISTDateTimeDot = (v) => {
  const d = _toDate(v);
  if (!d) return "";
  return `${formatISTDate(d)} · ${formatISTTime(d)}`;
};

/** "3 minutes ago" style relative — always vs current IST time. */
export const timeAgoIST = (v) => {
  const d = _toDate(v);
  if (!d) return "";
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
};

/** Return the IST timezone label (e.g. "IST") for tagging displays. */
export const IST_LABEL = "IST";
