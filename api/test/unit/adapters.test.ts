import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { transit_realtime } from "../../src/gen/gtfs-realtime.js";
import {
  ParseError,
  feedHeaderTimestamp,
  getAdapter,
  groupUrls,
} from "../../src/adapters";
import { NYCT_GROUPS } from "../../src/adapters/nyct";

const aceFixture = new Uint8Array(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/nyct-ace.pb")),
);

/** Build a minimal encoded feed for boundary tests. */
function encodeFeed(
  trips: { routeId: string; stops: { stopId?: string; arrival?: number; departure?: number }[] }[],
): Uint8Array {
  // Generated with --no-create: encode() accepts plain objects directly.
  return transit_realtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: "2.0", timestamp: 1_754_000_000 },
    entity: trips.map((trip, i) => ({
      id: `t${i}`,
      tripUpdate: {
        trip: { tripId: `trip${i}`, routeId: trip.routeId },
        stopTimeUpdate: trip.stops.map((s) => ({
          stopId: s.stopId,
          arrival: s.arrival ? { time: s.arrival } : undefined,
          departure: s.departure ? { time: s.departure } : undefined,
        })),
      },
    })),
  } as transit_realtime.IFeedMessage).finish();
}

const nyct = getAdapter("nyct");

describe("gtfs_rt / nyct parse", () => {
  it("reduces the real ACE fixture with known stops and ascending times", () => {
    const headerTs = feedHeaderTimestamp(aceFixture);
    const map = nyct.parse(aceFixture, headerTs);
    const a32n = map.get("A32N");
    expect(a32n).toBeDefined();
    expect(a32n!.some((a) => a.routeId === "A")).toBe(true);
    for (const arrivals of map.values()) {
      for (let i = 1; i < arrivals.length; i++) {
        expect(arrivals[i].time).toBeGreaterThanOrEqual(arrivals[i - 1].time);
      }
    }
  });

  it("prefers departure, falls back to arrival, skips neither-present", () => {
    const buf = encodeFeed([
      {
        routeId: "A",
        stops: [
          { stopId: "S1", departure: 2000 },
          { stopId: "S2", arrival: 3000 },
          { stopId: "S3" }, // no time -> skipped
        ],
      },
    ]);
    const map = nyct.parse(buf, 1000);
    expect(map.get("S1")![0].time).toBe(2000);
    expect(map.get("S2")![0].time).toBe(3000);
    expect(map.has("S3")).toBe(false);
  });

  it("applies the time >= now boundary inclusively", () => {
    const buf = encodeFeed([
      { routeId: "A", stops: [{ stopId: "S1", departure: 999 }, { stopId: "S2", departure: 1000 }] },
    ]);
    const map = nyct.parse(buf, 1000);
    expect(map.has("S1")).toBe(false); // past
    expect(map.get("S2")![0].time).toBe(1000); // boundary included
  });

  it("skips entries with missing stop_id or route_id", () => {
    const buf = encodeFeed([
      { routeId: "", stops: [{ stopId: "S1", departure: 2000 }] },
      { routeId: "A", stops: [{ departure: 2000 }] },
    ]);
    expect(nyct.parse(buf, 1000).size).toBe(0);
  });

  it("returns an empty map for an entity-less feed; ParseError on garbage/empty", () => {
    expect(nyct.parse(encodeFeed([]), 0).size).toBe(0);
    // proto2 requires the header, so a zero-byte buffer is invalid too
    expect(() => nyct.parse(new Uint8Array(0), 0)).toThrow(ParseError);
    const garbage = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x01, 0x02]);
    expect(() => nyct.parse(garbage, 0)).toThrow(ParseError);
  });
});

describe("nyct group map", () => {
  it("produces the eight verified URLs from the base", () => {
    const base = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs";
    const urls = groupUrls(base);
    expect(Object.keys(urls)).toHaveLength(8);
    expect(urls["1234567s"]).toBe(base);
    expect(urls.ace).toBe(`${base}-ace`);
    expect(urls.si).toBe(`${base}-si`);
    expect(NYCT_GROUPS).toContain("bdfm");
  });

  it("unknown adapter name is an explicit registry error", () => {
    expect(() => getAdapter("siri")).toThrow(/unknown feed adapter/);
  });
});
