// Resolve a stored pdfUrl into a fetchable URL that the browser can load
// inside <Document file={...}> without CORS issues.
//
// - Absolute http(s) URLs are routed through the backend proxy
//   (/api/floor-plans/proxy-pdf?url=...) so browser-side CORS is bypassed.
// - Relative paths starting with "/api/" are converted to full URLs.
// - The current JWT (from localStorage) is appended as `?auth=<jwt>` because
//   react-pdf's underlying fetch cannot attach an Authorization header.
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

function withAuth(absoluteUrl) {
  const token = (typeof window !== "undefined") ? window.localStorage.getItem("access_token") : null;
  if (!token) return absoluteUrl;
  const sep = absoluteUrl.includes("?") ? "&" : "?";
  return `${absoluteUrl}${sep}auth=${encodeURIComponent(token)}`;
}

export function resolvePdfUrl(url) {
  if (!url) return url;
  // Already a backend path (uploaded file or proxy) → just add auth
  if (url.startsWith("/api/")) return withAuth(`${BACKEND_URL}${url}`);
  // External absolute URL → route through proxy
  if (/^https?:\/\//i.test(url)) {
    return withAuth(`${BACKEND_URL}/api/floor-plans/proxy-pdf?url=${encodeURIComponent(url)}`);
  }
  return url;
}
