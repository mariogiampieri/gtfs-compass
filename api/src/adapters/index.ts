import type { FeedAdapter } from "./types";
import { gtfsRtAdapter } from "./gtfs_rt";
import { NYCT_GROUPS, groupUrls, nyctAdapter } from "./nyct";

const adapters: Record<string, FeedAdapter> = {
  gtfs_rt: gtfsRtAdapter,
  nyct: nyctAdapter,
};

/**
 * Adapters that fan a feed out into named groups. Only feeds whose adapter
 * appears here are reachable through the group-addressed route (U4's
 * allowlist leans on this: no groups, no route).
 */
export const adapterGroups: Record<string, readonly string[]> = {
  nyct: NYCT_GROUPS,
};

export function getAdapter(name: string): FeedAdapter {
  const adapter = adapters[name];
  if (!adapter) {
    throw new Error(`unknown feed adapter: ${name}`);
  }
  return adapter;
}

const groupUrlBuilders: Record<string, (baseUrl: string) => Record<string, string>> = {
  nyct: (base) => ({ ...groupUrls(base) }),
};

/** Group-fanout URL map for an adapter, or null for non-group adapters. */
export function groupUrlsFor(adapter: string, baseUrl: string): Record<string, string> | null {
  const builder = groupUrlBuilders[adapter];
  return builder ? builder(baseUrl) : null;
}

export { type Arrival, type FeedAdapter, ParseError } from "./types";
export { feedHeaderTimestamp } from "./gtfs_rt";
export { groupUrls } from "./nyct";
