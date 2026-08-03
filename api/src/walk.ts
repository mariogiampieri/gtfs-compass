/**
 * walk.ts — the walk-time seam (spec: "walk.ts — walk-time estimation").
 *
 * Tiers in preference order: manual (request-supplied, device-held) >
 * heuristic (haversine × 1.3 detour ÷ 1.3 m/s from an origin position) >
 * none. Every result carries its `source` so estimated values render
 * differently from confirmed ones, and every tier gets the entry buffer
 * added here — GTFS-RT predicts platform arrival, walk estimates end at the
 * street entrance, and omitting the mezzanine/turnstile/stairs seconds is
 * the systematic bias that makes people miss trains.
 *
 * The Mapbox routed tier is deliberately unbuilt (build order: "Mapbox
 * later, if the heuristic annoys you"); when it lands it slots between
 * manual and heuristic, env-gated, mirroring the Unwired Labs slot in
 * locate.ts. Phase 5's server-side walk_times rows likewise become a tier
 * above the request-param manual without changing this interface.
 */

import { DEFAULT_MAX_ACCURACY_M, intVar } from "./locate";
import { haversineM } from "./stops";

export { DEFAULT_MAX_ACCURACY_M } from "./locate";

/** Street-entrance → platform seconds no router models (spec default). */
export const RAIL_ENTRY_BUFFER_S = 90;
/** Sanity cap on request-supplied manual walk seconds (2 h). */
export const MANUAL_WALK_MAX_S = 7200;

const DETOUR_FACTOR = 1.3; // street-grid detour over the crow-flies distance
const WALK_SPEED_MPS = 1.3;

// GTFS route_type: 0 tram, 1 subway/metro, 2 rail — all "heavy rail" for
// entry-buffer purposes; 3 bus (and anything else) gets no buffer.
const RAIL_ROUTE_TYPES = new Set([0, 1, 2]);

export interface WalkOrigin {
  lat: number;
  lon: number;
  /** Reported fix accuracy. Absent = trusted caller (the API route layer
   * requires `acc`, so absence only occurs for internal callers). */
  accuracyM?: number;
}

export interface WalkStopContext {
  /** Platform coordinates; null when the stops row has no coordinates
   * (heuristic tier unavailable, manual unaffected). */
  stop: { lat: number; lon: number } | null;
  manualSeconds?: number;
  routeTypes: number[];
}

export interface WalkResult {
  seconds: number;
  source: "manual" | "heuristic";
}

/** Max entry buffer across the route types serving the stop: any rail → 90 s. */
export function entryBufferS(routeTypes: number[]): number {
  return routeTypes.some((t) => RAIL_ROUTE_TYPES.has(t)) ? RAIL_ENTRY_BUFFER_S : 0;
}

/** The locate chain's accuracy gate value, reused for the walk heuristic. */
export function walkMaxAccuracyM(env: Env): number {
  return intVar(env.LOCATE_MAX_ACCURACY_M, DEFAULT_MAX_ACCURACY_M);
}

/**
 * Resolve walk seconds for one stop: manual > heuristic > null, entry
 * buffer always added. An origin coarser than the gate is ignored, never
 * silently used (spec constraint: coarse location is gated).
 */
export function computeWalk(
  ctx: WalkStopContext,
  origin: WalkOrigin | null,
  maxAccuracyM: number = DEFAULT_MAX_ACCURACY_M,
): WalkResult | null {
  const buffer = entryBufferS(ctx.routeTypes);

  const manual = ctx.manualSeconds;
  if (manual !== undefined && Number.isFinite(manual) && manual >= 0 && manual <= MANUAL_WALK_MAX_S) {
    return { seconds: Math.round(manual) + buffer, source: "manual" };
  }

  if (!origin || !ctx.stop) return null;
  if (origin.accuracyM !== undefined && origin.accuracyM > maxAccuracyM) return null;

  const distanceM = haversineM(origin.lat, origin.lon, ctx.stop.lat, ctx.stop.lon);
  const seconds = Math.round((distanceM * DETOUR_FACTOR) / WALK_SPEED_MPS);
  return { seconds: seconds + buffer, source: "heuristic" };
}
