import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { distanceLabel, haversineM, nearbyStops, nearestBeyond } from "../../src/stops";

// Jay St–MetroTech
const JAY = { lat: 40.692338, lon: -73.987342 };

async function seedStop(
  feedId: string,
  stopId: string,
  name: string,
  lat: number,
  lon: number,
  parent: string | null = null,
  capacity: number | null = null,
) {
  await env.DB.prepare(
    "INSERT INTO stops (feed_id, stop_id, name, lat, lon, parent_station, capacity) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(feedId, stopId, name, lat, lon, parent, capacity)
    .run();
}

async function seedRoute(feedId: string, stopId: string, routeId: string) {
  await env.DB.prepare("INSERT INTO stop_routes (feed_id, stop_id, route_id) VALUES (?, ?, ?)")
    .bind(feedId, stopId, routeId)
    .run();
}

beforeEach(async () => {
  await env.DB.prepare("DROP TABLE IF EXISTS stops").run();
  await env.DB.prepare("DROP TABLE IF EXISTS stop_routes").run();
  await env.DB.prepare(
    `CREATE TABLE stops (
       feed_id TEXT NOT NULL, stop_id TEXT NOT NULL, name TEXT,
       lat REAL, lon REAL, parent_station TEXT, capacity INTEGER,
       PRIMARY KEY (feed_id, stop_id))`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE stop_routes (
       feed_id TEXT NOT NULL, stop_id TEXT NOT NULL, route_id TEXT NOT NULL,
       PRIMARY KEY (feed_id, stop_id, route_id))`,
  ).run();
});

describe("haversineM", () => {
  it("measures ~111 km per degree of latitude", () => {
    const d = haversineM(40, -74, 41, -74);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it("is zero for identical points", () => {
    expect(haversineM(JAY.lat, JAY.lon, JAY.lat, JAY.lon)).toBe(0);
  });
});

describe("distanceLabel", () => {
  it("renders feet under 1000 ft, else miles at one decimal", () => {
    expect(distanceLabel(140, null)).toBe("459 ft");
    expect(distanceLabel(140, "imperial")).toBe("459 ft");
    expect(distanceLabel(322, null)).toBe("0.2 mi");
    expect(distanceLabel(3900, null)).toBe("2.4 mi");
  });

  it("renders m/km for metric feeds", () => {
    expect(distanceLabel(460, "metric")).toBe("460 m");
    expect(distanceLabel(2400, "metric")).toBe("2.4 km");
  });
});

describe("nearbyStops", () => {
  it("groups N/S platforms under their parent station with routes from all platforms", async () => {
    await seedStop("mta-subway", "A41", "Jay St-MetroTech", JAY.lat, JAY.lon);
    await seedStop("mta-subway", "A41N", "Jay St-MetroTech", JAY.lat, JAY.lon, "A41");
    await seedStop("mta-subway", "A41S", "Jay St-MetroTech", JAY.lat, JAY.lon, "A41");
    await seedRoute("mta-subway", "A41N", "A");
    await seedRoute("mta-subway", "A41N", "C");
    await seedRoute("mta-subway", "A41S", "A");
    await seedRoute("mta-subway", "A41S", "F");

    const groups = await nearbyStops(env.DB, {
      lat: JAY.lat,
      lon: JAY.lon,
      radiusM: 500,
      feedIds: ["mta-subway"],
      limit: 5,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("A41");
    expect(groups[0].name).toBe("Jay St-MetroTech");
    expect(groups[0].stopIds.sort()).toEqual(["A41N", "A41S"]);
    expect(groups[0].routeIds).toEqual(["A", "C", "F"]);
  });

  it("groups platforms even when the parent-station row is missing", async () => {
    await seedStop("mta-subway", "A41N", "Jay St-MetroTech", JAY.lat, JAY.lon, "A41");
    await seedStop("mta-subway", "A41S", "Jay St-MetroTech", JAY.lat, JAY.lon, "A41");

    const groups = await nearbyStops(env.DB, {
      lat: JAY.lat,
      lon: JAY.lon,
      radiusM: 500,
      feedIds: ["mta-subway"],
      limit: 5,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("A41");
    expect(groups[0].stopIds.sort()).toEqual(["A41N", "A41S"]);
  });

  it("excludes stops outside the radius and sorts by distance", async () => {
    // ~0.0045 deg lat ~= 500 m
    await seedStop("mta-subway", "NEAR", "Near", JAY.lat + 0.001, JAY.lon);
    await seedStop("mta-subway", "NEARER", "Nearer", JAY.lat + 0.0005, JAY.lon);
    await seedStop("mta-subway", "FAR", "Far", JAY.lat + 0.02, JAY.lon);

    const groups = await nearbyStops(env.DB, {
      lat: JAY.lat,
      lon: JAY.lon,
      radiusM: 500,
      feedIds: ["mta-subway"],
      limit: 5,
    });
    expect(groups.map((g) => g.id)).toEqual(["NEARER", "NEAR"]);
    expect(groups[0].distanceM).toBeLessThan(groups[1].distanceM);
  });

  it("excludes a stop just beyond the radius and keeps one just inside", async () => {
    await seedStop("mta-subway", "IN", "Inside", JAY.lat + 0.004, JAY.lon); // ~445 m
    await seedStop("mta-subway", "OUT", "Outside", JAY.lat + 0.005, JAY.lon); // ~556 m

    const groups = await nearbyStops(env.DB, {
      lat: JAY.lat,
      lon: JAY.lon,
      radiusM: 500,
      feedIds: ["mta-subway"],
      limit: 5,
    });
    expect(groups.map((g) => g.id)).toEqual(["IN"]);
  });

  it("interleaves bike stations with rail stations by distance, carrying capacity", async () => {
    await seedStop("mta-subway", "A41", "Jay St-MetroTech", JAY.lat + 0.002, JAY.lon);
    await seedStop("citibike", "66db", "Adams St & Tillary St", JAY.lat + 0.001, JAY.lon, null, 31);

    const groups = await nearbyStops(env.DB, {
      lat: JAY.lat,
      lon: JAY.lon,
      radiusM: 800,
      feedIds: ["mta-subway", "citibike"],
      limit: 5,
    });
    expect(groups.map((g) => g.id)).toEqual(["66db", "A41"]);
    expect(groups[0].feedId).toBe("citibike");
    expect(groups[0].capacity).toBe(31);
    expect(groups[0].stopIds).toEqual(["66db"]);
    expect(groups[1].capacity).toBeNull();
  });

  it("formats distance labels per feed units", async () => {
    await seedStop("mta-subway", "A41", "Jay St", JAY.lat + 0.001, JAY.lon);
    const [imperial] = await nearbyStops(
      env.DB,
      { lat: JAY.lat, lon: JAY.lon, radiusM: 500, feedIds: ["mta-subway"], limit: 5 },
      { "mta-subway": "imperial" },
    );
    expect(imperial.distanceLabel).toMatch(/ft$/);
    const [metric] = await nearbyStops(
      env.DB,
      { lat: JAY.lat, lon: JAY.lon, radiusM: 500, feedIds: ["mta-subway"], limit: 5 },
      { "mta-subway": "metric" },
    );
    expect(metric.distanceLabel).toMatch(/m$/);
  });

  it("returns an empty array for zero results and for no feeds", async () => {
    expect(
      await nearbyStops(env.DB, {
        lat: JAY.lat,
        lon: JAY.lon,
        radiusM: 500,
        feedIds: ["mta-subway"],
        limit: 5,
      }),
    ).toEqual([]);
    expect(
      await nearbyStops(env.DB, {
        lat: JAY.lat,
        lon: JAY.lon,
        radiusM: 500,
        feedIds: [],
        limit: 5,
      }),
    ).toEqual([]);
  });

  it("honors the limit after sorting", async () => {
    for (let i = 1; i <= 8; i++) {
      await seedStop("mta-subway", `S${i}`, `Stop ${i}`, JAY.lat + 0.0003 * i, JAY.lon);
    }
    const groups = await nearbyStops(env.DB, {
      lat: JAY.lat,
      lon: JAY.lon,
      radiusM: 2000,
      feedIds: ["mta-subway"],
      limit: 5,
    });
    expect(groups).toHaveLength(5);
    expect(groups.map((g) => g.id)).toEqual(["S1", "S2", "S3", "S4", "S5"]);
  });

  it("skips rows with null coordinates", async () => {
    await seedStop("mta-subway", "NULLED", "No coords", null as unknown as number, null as unknown as number);
    await seedStop("mta-subway", "OK", "Has coords", JAY.lat, JAY.lon);
    const groups = await nearbyStops(env.DB, {
      lat: JAY.lat,
      lon: JAY.lon,
      radiusM: 500,
      feedIds: ["mta-subway"],
      limit: 5,
    });
    expect(groups.map((g) => g.id)).toEqual(["OK"]);
  });
});

describe("nearestBeyond", () => {
  it("finds the closest stop outside any nearby radius and labels it", async () => {
    // ~3.9 km north of Jay St
    await seedStop("mta-subway", "FAR", "Far Station", JAY.lat + 0.035, JAY.lon);
    const label = await nearestBeyond(env.DB, JAY.lat, JAY.lon, ["mta-subway"], "imperial");
    expect(label).toBe("2.4 mi");
  });

  it("returns null when the feed has no stops at all", async () => {
    expect(await nearestBeyond(env.DB, JAY.lat, JAY.lon, ["mta-subway"], null)).toBeNull();
  });
});
