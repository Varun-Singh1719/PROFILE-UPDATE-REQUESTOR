/**
 * UserAvatar — reusable avatar component.
 *
 * Three modes (priority order):
 *   1. Uploaded image (base64 data URL)            — avatar_kind === "upload"
 *   2. Predefined Fluent 3D emoji preset            — avatar_kind === "preset"
 *   3. Notion/Linear-style gradient + initials      — fallback (default)
 *
 * Props:
 *   user           — { name, email, avatar_kind?, avatar_preset?, avatar_image? }
 *   size           — number (px). default 40.
 *   online         — bool. show green/grey dot in lower-right.
 *   showStatusDot  — bool. default true.
 */
import React from "react";

// ---------- Predefined cartoon avatar presets (Microsoft Fluent 3D Emoji) ----------
// Each entry: { slug, path } where `path` is relative to the Fluent 3D CDN root.
export const AVATAR_PRESET_DEFS = [
  { slug: "smile",       path: "Smiling face/3D/smiling_face_3d.png" },
  { slug: "beam",        path: "Beaming face with smiling eyes/3D/beaming_face_with_smiling_eyes_3d.png" },
  { slug: "grin",        path: "Grinning face with big eyes/3D/grinning_face_with_big_eyes_3d.png" },
  { slug: "heart-eyes",  path: "Smiling face with heart-eyes/3D/smiling_face_with_heart-eyes_3d.png" },
  { slug: "halo",        path: "Smiling face with halo/3D/smiling_face_with_halo_3d.png" },
  { slug: "sunglasses",  path: "Smiling face with sunglasses/3D/smiling_face_with_sunglasses_3d.png" },
  { slug: "star-struck", path: "Star-struck/3D/star-struck_3d.png" },
  { slug: "savoring",    path: "Face savoring food/3D/face_savoring_food_3d.png" },
  { slug: "monocle",     path: "Face with monocle/3D/face_with_monocle_3d.png" },
  { slug: "nerd",        path: "Nerd face/3D/nerd_face_3d.png" },
  { slug: "party",       path: "Partying face/3D/partying_face_3d.png" },
  { slug: "hearts",      path: "Smiling face with hearts/3D/smiling_face_with_hearts_3d.png" },
];

export const AVATAR_PRESETS = AVATAR_PRESET_DEFS.map((p) => p.slug);

const FLUENT_BASE = "https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/";

export function presetUrl(slug) {
  const entry = AVATAR_PRESET_DEFS.find((p) => p.slug === slug);
  if (!entry) return "";
  return FLUENT_BASE + entry.path.split("/").map(encodeURIComponent).join("/");
}

// ---------- Gradient + initials fallback ----------
// 12 vivid 2-stop gradient palettes; chosen deterministically from the user's name.
const PALETTES = [
  ["#FB923C", "#F87171"],
  ["#34D399", "#0EA5E9"],
  ["#A78BFA", "#EC4899"],
  ["#FBBF24", "#EF4444"],
  ["#60A5FA", "#A78BFA"],
  ["#F472B6", "#FB923C"],
  ["#10B981", "#84CC16"],
  ["#06B6D4", "#3B82F6"],
  ["#F59E0B", "#10B981"],
  ["#EC4899", "#8B5CF6"],
  ["#EF4444", "#F59E0B"],
  ["#3B82F6", "#06B6D4"],
];

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
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

  const px = `${size}px`;
  const fontPx = `${Math.max(11, Math.round(size * 0.4))}px`;

  // Deterministic gradient from the user's name/email
  const palette = React.useMemo(() => {
    const key = String(user?.name || user?.email || "x");
    return PALETTES[hashString(key) % PALETTES.length];
  }, [user?.name, user?.email]);

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
    // 3D Fluent emoji preset — render with a soft pastel backdrop so they
    // pop against any background.
    const url = presetUrl(user.avatar_preset);
    inner = (
      <div
        className="w-full h-full flex items-center justify-center"
        style={{
          background: "radial-gradient(circle at 30% 30%, #ffe0c2, #f8d7da 60%, #e0c3fc 100%)",
        }}
      >
        <img
          src={url}
          alt={user?.name || "Avatar"}
          className="block"
          style={{ width: "82%", height: "82%", objectFit: "contain" }}
          draggable={false}
        />
      </div>
    );
  } else {
    // Gradient + initials fallback
    inner = (
      <div
        className="w-full h-full flex items-center justify-center font-extrabold text-white"
        style={{
          background: `linear-gradient(135deg, ${palette[0]} 0%, ${palette[1]} 100%)`,
          fontSize: fontPx,
          letterSpacing: "0.02em",
        }}
      >
        {initials}
      </div>
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
