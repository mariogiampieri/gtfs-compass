/**
 * Server-side presentation rules from the design handoff (README "Server-side
 * responsibilities"): the device renders exactly what it's told — bullet
 * shape, colors, and contrast are decided here.
 */

export type BulletShape = "circle" | "pill" | "disc";

/** Rail short-names ≤2 chars get the classic bullet; longer get a pill; none, a disc. */
export function bulletShape(shortName: string | null | undefined): BulletShape {
  if (!shortName) return "disc";
  return shortName.length <= 2 ? "circle" : "pill";
}

/** The design's fixed fallback palette for colorless routes, in order. */
export const FALLBACK_PALETTE = [
  "#C9564C",
  "#B07A30",
  "#7C8F3A",
  "#3F9A62",
  "#2F9C93",
  "#3E86C0",
  "#7A74CE",
  "#B75F9E",
] as const;

/** Deterministic palette pick: same route_id → same color across calls and deploys. */
export function paletteColor(routeId: string): string {
  // FNV-1a: stable, cheap, well-distributed on short ids.
  let hash = 0x811c9dc5;
  for (let i = 0; i < routeId.length; i++) {
    hash ^= routeId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return FALLBACK_PALETTE[(hash >>> 0) % FALLBACK_PALETTE.length];
}

/** Normalize a GTFS color field ("EE352E", "#ee352e") to "#RRGGBB", or null. */
export function normalizeColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const hex = raw.replace(/^#/, "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return `#${hex.toUpperCase()}`;
}

/**
 * Text color on a bullet: honor the feed's text_color when present, else
 * black/white by background luminance (WCAG relative-luminance approximation).
 */
export function textColorFor(
  background: string,
  feedTextColor: string | null | undefined,
): string {
  const declared = normalizeColor(feedTextColor);
  if (declared) return declared;
  const hex = background.replace(/^#/, "");
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.4 ? "#000000" : "#FFFFFF";
}
