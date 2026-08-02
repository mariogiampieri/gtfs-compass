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
