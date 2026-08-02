/**
 * U1 spike: measure NYCT protobuf decode cost and reduced-snapshot size
 * against the plan's budgets (30 s paid-plan CPU; 2 MB SQLite storage value).
 *
 * Fixtures captured 2026-08-02 ~16:35 ET (Saturday afternoon — below weekday
 * AM-rush entity counts; re-capture during rush before treating these as
 * ceilings). Measured values are logged and asserted only against generous
 * sanity bounds so clock noise can't flake CI.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { transit_realtime } from "../../src/gen/gtfs-realtime.js";

const FIXTURES = ["nyct-1234567s.pb", "nyct-ace.pb", "nyct-si.pb"] as const;

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(__dirname, "../fixtures", name)));
}

function toNumber(value: number | Long | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

/** Minimal reduce mirroring what the adapter (U2) does: stop -> arrival epochs. */
function reduce(feed: transit_realtime.FeedMessage): Map<string, { routeId: string; time: number }[]> {
  const byStop = new Map<string, { routeId: string; time: number }[]>();
  for (const entity of feed.entity) {
    const tripUpdate = entity.tripUpdate;
    if (!tripUpdate) continue;
    const routeId = tripUpdate.trip?.routeId ?? "";
    for (const stu of tripUpdate.stopTimeUpdate ?? []) {
      const time = toNumber(stu.departure?.time ?? stu.arrival?.time);
      if (!stu.stopId || !time) continue;
      const list = byStop.get(stu.stopId) ?? [];
      list.push({ routeId, time });
      byStop.set(stu.stopId, list);
    }
  }
  return byStop;
}

describe("parse-cost spike (R7)", () => {
  it("decodes real fixtures with reachable NYCT extension fields", () => {
    for (const name of FIXTURES) {
      const feed = transit_realtime.FeedMessage.decode(fixture(name));
      expect(feed.entity.length).toBeGreaterThan(0);

      const headerTs = toNumber(feed.header.timestamp);
      expect(headerTs).toBeGreaterThan(1_700_000_000); // plausible epoch seconds

      const withTrip = feed.entity.find((e) => e.tripUpdate?.trip);
      expect(withTrip).toBeDefined();
      const trip = withTrip!.tripUpdate!.trip! as transit_realtime.ITripDescriptor &
        Record<string, unknown>;
      // Extension property name recorded per the plan's open question:
      expect(trip[".transit_realtime.nyctTripDescriptor"]).toBeDefined();
    }
  });

  it("decode + reduce cost and snapshot size stay far inside budget", () => {
    const results: string[] = [];
    for (const name of FIXTURES) {
      const buf = fixture(name);
      const iterations = 20;
      const start = performance.now();
      let feed!: transit_realtime.FeedMessage;
      for (let i = 0; i < iterations; i++) {
        feed = transit_realtime.FeedMessage.decode(buf);
      }
      const decodeMs = (performance.now() - start) / iterations;

      const reduceStart = performance.now();
      const snapshot = reduce(feed);
      const reduceMs = performance.now() - reduceStart;

      const serialized = JSON.stringify(Object.fromEntries(snapshot));
      results.push(
        `${name}: ${buf.length} bytes pb, decode ${decodeMs.toFixed(1)}ms, ` +
          `reduce ${reduceMs.toFixed(1)}ms, ${snapshot.size} stops, ` +
          `snapshot ${(serialized.length / 1024).toFixed(0)}KB JSON`,
      );

      // Sanity bounds, not the real budgets (30s CPU / 2MB value):
      expect(decodeMs).toBeLessThan(1000);
      expect(serialized.length).toBeLessThan(2 * 1024 * 1024);
    }
    // Visible in vitest output for the R7 record.
    console.log("\n[parse-cost spike]\n" + results.join("\n"));
  });
});
