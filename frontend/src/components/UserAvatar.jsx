/**
 * UserAvatar — reusable avatar component.
 *
 * Renders one of three sources, in priority:
 *   1. Uploaded image (base64 data URL) — when avatar_kind === "upload"
 *   2. Predefined cartoon preset (DiceBear "fun-emoji" SVG) — when avatar_kind === "preset"
 *   3. Initials from the user's name (first + last word, uppercase) — fallback
 *
 * Props:
 *   user           — { name, avatar_kind?, avatar_preset?, avatar_image? }
 *   size           — number (px). default 40.
 *   online         — bool. show green/grey dot in lower-right.
 *   showStatusDot  — bool. default true.
 *   ringColor      — optional ring class
 */
import React from "react";

export const AVATAR_PRESETS = [
  "memoji-1", "memoji-2", "memoji-3", "memoji-4",
  "memoji-5", "memoji-6", "memoji-7", "memoji-8",
  "memoji-9", "memoji-10", "memoji-11", "memoji-12",
];

// Public DiceBear URL — cartoon-emoji style. No API key required.
export function presetUrl(slug) {
  return `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(slug)}&radius=50&backgroundType=gradientLinear&backgroundColor=ffd5dc,c0aede,fec5bb,b2f7ef,d4e5ff`;
}

export function initialsFor(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function UserAvatar({
  user,
  size = 40,
  online = false,
  showStatusDot = true,
  className = "",
}) {
  const kind = user?.avatar_kind || "initials";
  const initials = initialsFor(user?.name);

  // Stable, name-derived hue for the initials fallback
  const hue = React.useMemo(() => {
    const s = String(user?.name || user?.email || "x");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 360;
  }, [user?.name, user?.email]);

  const px = `${size}px`;
  const fontPx = `${Math.max(11, Math.round(size * 0.4))}px`;

  let inner;
  if (kind === "upload" && user?.avatar_image) {
    inner = (
      <img
        src={user.avatar_image}
        alt={user?.name || "Avatar"}
        className="w-full h-full object-cover"
        draggable={false}
      />
    );
  } else if (kind === "preset" && user?.avatar_preset) {
    inner = (
      <img
        src={presetUrl(user.avatar_preset)}
        alt={user?.name || "Avatar"}
        className="w-full h-full object-cover"
        draggable={false}
      />
    );
  } else {
    inner = (
      <span
        className="w-full h-full flex items-center justify-center font-bold tracking-wide"
        style={{
          backgroundColor: `hsl(${hue}, 70%, 92%)`,
          color: `hsl(${hue}, 60%, 32%)`,
          fontSize: fontPx,
        }}
      >
        {initials}
      </span>
    );
  }

  const dotSize = Math.max(8, Math.round(size * 0.28));

  return (
    <div
      className={`relative inline-block rounded-full overflow-hidden ${className}`}
      style={{ width: px, height: px }}
      data-testid="user-avatar"
    >
      <div className="w-full h-full rounded-full overflow-hidden bg-white">
        {inner}
      </div>
      {showStatusDot && (
        <span
          aria-label={online ? "Online" : "Offline"}
          data-testid="avatar-status-dot"
          className={`absolute bottom-0 right-0 rounded-full ring-2 ring-white ${
            online ? "bg-emerald-500" : "bg-gray-300"
          }`}
          style={{ width: `${dotSize}px`, height: `${dotSize}px` }}
        />
      )}
    </div>
  );
}
