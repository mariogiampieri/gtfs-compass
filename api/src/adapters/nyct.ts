import type { FeedAdapter } from "./types";
import { parseGtfsRt } from "./gtfs_rt";

/**
 * NYCT subway: eight feed groups, each a full dataset for its routes.
 * URLs derive from the feed's base rt_trip_url by suffix — verified live
 * 2026-08-02 against api-endpoint.mta.info. The base URL (no suffix) is
 * the 1234567S group.
 */
export const NYCT_GROUPS = [
  "1234567s",
  "ace",
  "bdfm",
  "g",
  "jz",
  "l",
  "nqrw",
  "si",
] as const;

export type NyctGroup = (typeof NYCT_GROUPS)[number];

export function groupUrls(baseUrl: string): Record<NyctGroup, string> {
  const urls = {} as Record<NyctGroup, string>;
  for (const group of NYCT_GROUPS) {
    urls[group] = group === "1234567s" ? baseUrl : `${baseUrl}-${group}`;
  }
  return urls;
}

/**
 * The NYCT extension (.transit_realtime.nyctTripDescriptor) adds direction
 * and track detail the arrival reduction doesn't need yet; parsing is the
 * base GTFS-RT walk. The adapter exists so feeds.adapter = 'nyct' selects
 * group-fanout behavior without any code change elsewhere (constraint #3).
 */
export const nyctAdapter: FeedAdapter = { parse: parseGtfsRt };

/**
 * route_id → feed group. Letter-family intuition fails exactly on the
 * shuttles (GS rides the numbered feed, FS the BDFM feed, H the ACE feed),
 * so the map is enumerated, express variants included. An unmapped route is
 * the caller's counted-warning case, never a throw.
 */
export const NYCT_ROUTE_GROUP: Readonly<Record<string, NyctGroup>> = {
  "1": "1234567s",
  "2": "1234567s",
  "3": "1234567s",
  "4": "1234567s",
  "5": "1234567s",
  "5X": "1234567s",
  "6": "1234567s",
  "6X": "1234567s",
  "7": "1234567s",
  "7X": "1234567s",
  GS: "1234567s", // 42 St Shuttle
  A: "ace",
  C: "ace",
  E: "ace",
  H: "ace", // Rockaway Park Shuttle
  B: "bdfm",
  D: "bdfm",
  F: "bdfm",
  FX: "bdfm",
  M: "bdfm",
  FS: "bdfm", // Franklin Av Shuttle
  G: "g",
  J: "jz",
  Z: "jz",
  L: "l",
  N: "nqrw",
  Q: "nqrw",
  R: "nqrw",
  W: "nqrw",
  SI: "si",
  SIR: "si",
};

/**
 * NYCT platform ids encode direction as an N/S suffix (A41N / A41S);
 * GTFS static trips.txt confirms N ↔ direction_id 0, S ↔ 1.
 * Returns null for a suffix-less id — the caller drops it with a counted
 * warning rather than guessing.
 */
export function nyctDirectionId(stopId: string): 0 | 1 | null {
  const last = stopId[stopId.length - 1];
  if (last === "N") return 0;
  if (last === "S") return 1;
  return null;
}
