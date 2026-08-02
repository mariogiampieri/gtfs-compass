import type Long from "long";

import { transit_realtime } from "../gen/gtfs-realtime.js";
import { type Arrival, type FeedAdapter, ParseError } from "./types";

function toNumber(value: number | Long | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

/**
 * Base GTFS-RT reduction: trip_updates -> per-stop upcoming arrivals.
 * Departure time preferred, arrival as fallback; entries with time >= now
 * are kept (the same boundary rule the DO applies at read time).
 */
export function parseGtfsRt(buf: Uint8Array, now: number): Map<string, Arrival[]> {
  let feed: transit_realtime.FeedMessage;
  try {
    feed = transit_realtime.FeedMessage.decode(buf);
  } catch (cause) {
    throw new ParseError("failed to decode GTFS-RT feed", cause);
  }

  const byStop = new Map<string, Arrival[]>();
  for (const entity of feed.entity) {
    const tripUpdate = entity.tripUpdate;
    if (!tripUpdate) continue;
    const routeId = tripUpdate.trip?.routeId;
    if (!routeId) continue;
    for (const update of tripUpdate.stopTimeUpdate ?? []) {
      const stopId = update.stopId;
      const time = toNumber(update.departure?.time ?? update.arrival?.time);
      if (!stopId || !time || time < now) continue;
      const list = byStop.get(stopId) ?? [];
      list.push({ routeId, time });
      byStop.set(stopId, list);
    }
  }
  for (const list of byStop.values()) {
    list.sort((a, b) => a.time - b.time);
  }
  return byStop;
}

/** Feed header generation timestamp (epoch seconds); 0 when absent. */
export function feedHeaderTimestamp(buf: Uint8Array): number {
  try {
    return toNumber(transit_realtime.FeedMessage.decode(buf).header.timestamp);
  } catch (cause) {
    throw new ParseError("failed to decode GTFS-RT feed header", cause);
  }
}

export const gtfsRtAdapter: FeedAdapter = { parse: parseGtfsRt };
