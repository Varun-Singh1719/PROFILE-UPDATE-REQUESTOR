/**
 * Team color palette — 60 two-stop gradient combinations, mirroring the
 * Employee avatar "Initials Palettes" UX but extended to a much larger set.
 *
 * Each palette has a stable id ("tp1"..."tpN") so we can persist a tiny
 * string on the team document and still render rich gradients in the UI.
 *
 * Backwards-compatible: existing teams may have a legacy hex string
 * (e.g. "#ec9324") in `team.color`. The helpers below transparently fall
 * back to rendering the hex as a near-flat gradient / solid SVG fill.
 */

export const TEAM_PALETTES = [
  // Warm — oranges / reds / pinks
  { id: "tp1",  stops: ["#FB923C", "#F87171"] },
  { id: "tp2",  stops: ["#FBBF24", "#EF4444"] },
  { id: "tp3",  stops: ["#F472B6", "#FB923C"] },
  { id: "tp4",  stops: ["#EF4444", "#F59E0B"] },
  { id: "tp5",  stops: ["#F97316", "#DC2626"] },
  { id: "tp6",  stops: ["#FDBA74", "#F43F5E"] },
  { id: "tp7",  stops: ["#FCA5A5", "#7F1D1D"] },
  { id: "tp8",  stops: ["#FDE68A", "#F97316"] },

  // Pink / magenta / rose
  { id: "tp9",  stops: ["#F472B6", "#A855F7"] },
  { id: "tp10", stops: ["#EC4899", "#8B5CF6"] },
  { id: "tp11", stops: ["#FB7185", "#BE123C"] },
  { id: "tp12", stops: ["#F9A8D4", "#DB2777"] },
  { id: "tp13", stops: ["#FBCFE8", "#9D174D"] },
  { id: "tp14", stops: ["#E879F9", "#7C3AED"] },

  // Purple / violet / indigo
  { id: "tp15", stops: ["#A78BFA", "#EC4899"] },
  { id: "tp16", stops: ["#8B5CF6", "#3B82F6"] },
  { id: "tp17", stops: ["#C4B5FD", "#7C3AED"] },
  { id: "tp18", stops: ["#6366F1", "#06B6D4"] },
  { id: "tp19", stops: ["#A78BFA", "#22D3EE"] },
  { id: "tp20", stops: ["#7C3AED", "#312E81"] },

  // Blue / cyan / sky
  { id: "tp21", stops: ["#60A5FA", "#A78BFA"] },
  { id: "tp22", stops: ["#3B82F6", "#06B6D4"] },
  { id: "tp23", stops: ["#0EA5E9", "#22D3EE"] },
  { id: "tp24", stops: ["#1D4ED8", "#1E3A8A"] },
  { id: "tp25", stops: ["#38BDF8", "#6366F1"] },
  { id: "tp26", stops: ["#0284C7", "#0F766E"] },
  { id: "tp27", stops: ["#67E8F9", "#0E7490"] },

  // Teal / green / emerald
  { id: "tp28", stops: ["#34D399", "#0EA5E9"] },
  { id: "tp29", stops: ["#10B981", "#84CC16"] },
  { id: "tp30", stops: ["#22C55E", "#16A34A"] },
  { id: "tp31", stops: ["#14B8A6", "#0EA5E9"] },
  { id: "tp32", stops: ["#86EFAC", "#047857"] },
  { id: "tp33", stops: ["#A7F3D0", "#0F766E"] },
  { id: "tp34", stops: ["#4ADE80", "#0891B2"] },
  { id: "tp35", stops: ["#059669", "#1E3A8A"] },

  // Lime / yellow / amber
  { id: "tp36", stops: ["#A3E635", "#16A34A"] },
  { id: "tp37", stops: ["#FACC15", "#F97316"] },
  { id: "tp38", stops: ["#FDE047", "#84CC16"] },
  { id: "tp39", stops: ["#EAB308", "#B45309"] },
  { id: "tp40", stops: ["#D9F99D", "#15803D"] },
  { id: "tp41", stops: ["#F59E0B", "#92400E"] },

  // Earthy / brown / neutral
  { id: "tp42", stops: ["#CA8A04", "#7C2D12"] },
  { id: "tp43", stops: ["#A16207", "#365314"] },
  { id: "tp44", stops: ["#D97706", "#9A3412"] },
  { id: "tp45", stops: ["#78350F", "#1F2937"] },

  // Cool / slate / monochrome
  { id: "tp46", stops: ["#64748B", "#0F172A"] },
  { id: "tp47", stops: ["#94A3B8", "#334155"] },
  { id: "tp48", stops: ["#475569", "#0F172A"] },
  { id: "tp49", stops: ["#9CA3AF", "#111827"] },

  // Mixed / vivid contrasts
  { id: "tp50", stops: ["#06B6D4", "#F472B6"] },
  { id: "tp51", stops: ["#22D3EE", "#FB7185"] },
  { id: "tp52", stops: ["#84CC16", "#7C3AED"] },
  { id: "tp53", stops: ["#F59E0B", "#10B981"] },
  { id: "tp54", stops: ["#10B981", "#6366F1"] },
  { id: "tp55", stops: ["#F43F5E", "#22D3EE"] },
  { id: "tp56", stops: ["#EAB308", "#0EA5E9"] },
  { id: "tp57", stops: ["#A855F7", "#22C55E"] },
  { id: "tp58", stops: ["#EC4899", "#0EA5E9"] },
  { id: "tp59", stops: ["#F472B6", "#34D399"] },
  { id: "tp60", stops: ["#FB923C", "#3B82F6"] },
];

const PALETTE_BY_ID = Object.fromEntries(TEAM_PALETTES.map((p) => [p.id, p.stops]));

/** Returns the stops for any color value (palette id, hex, or null). */
export function paletteForTeam(value) {
  if (value && PALETTE_BY_ID[value]) return PALETTE_BY_ID[value];
  // Legacy hex (e.g. "#ec9324") — duplicate the hex for a flat "gradient"
  // so any styling that expects two stops still works.
  if (typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value)) {
    return [value, value];
  }
  // Unknown / null — fall back to the brand orange.
  return ["#ec9324", "#d4811f"];
}

/** CSS `background` value for the team color (rich gradient). */
export function teamBackground(value) {
  const [a, b] = paletteForTeam(value);
  return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
}

/** Single solid color (first stop) for places that only accept one color,
 *  e.g. SVG `fill=` attributes on the workstation floor map. */
export function teamSolid(value) {
  return paletteForTeam(value)[0];
}

/** Suggest the first palette id that isn't already taken by another team. */
export function suggestNextPalette(usedColors) {
  const used = new Set(usedColors || []);
  for (const p of TEAM_PALETTES) {
    if (!used.has(p.id)) return p.id;
  }
  return TEAM_PALETTES[0].id;
}

/** Two-letter team initials, e.g. "ProfiX North" -> "PN". */
export function teamInitials(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Two-letter person initials, e.g. "Aarushi Ajmani" -> "AA". */
export function personInitials(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Simple stable string hash — kept tiny; deterministic across sessions. */
function _strHash(str) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Deterministic avatar gradient for a person, keyed by their id
 * (or falls back to name). Reuses the same 60-stop palette we already ship
 * for teams so the whole UI feels visually cohesive.
 */
export function personAvatarBackground(seed) {
  const palette = TEAM_PALETTES[_strHash(seed) % TEAM_PALETTES.length];
  return `linear-gradient(135deg, ${palette.stops[0]} 0%, ${palette.stops[1]} 100%)`;
}

