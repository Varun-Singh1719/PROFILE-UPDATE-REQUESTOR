// Resolve a stored pdfUrl into a fetchable URL.
// - Absolute http/https URLs are returned as-is.
// - Relative paths starting with "/api/files/" are converted to full URLs and
//   the current JWT is appended as the `auth` query param (the files router
//   accepts `?auth=<jwt>` for cookie-less embeds like <iframe>/<canvas>).
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

export function resolvePdfUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/api/")) {
    const token = (typeof window !== "undefined") ? window.localStorage.getItem("access_token") : null;
    const sep = url.includes("?") ? "&" : "?";
    return `${BACKEND_URL}${url}${token ? `${sep}auth=${encodeURIComponent(token)}` : ""}`;
  }
  return url;
}
