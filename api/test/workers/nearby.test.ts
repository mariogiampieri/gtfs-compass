import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { transit_realtime } from "../../src/gen/gtfs-realtime.js";
import { type FeedInfo, composeNearby } from "../../src/nearby";

const ORIGIN = "https://rt.example";
// Jay St–MetroTech
const JAY = { lat: 40.692338, lon: -73.987342 };

// ---------- fixtures ----------

interface TripFixture {
  routeId: string;
  stops: [string, number][]; // ordered; last = terminal
}

function encodeTrips(headerTimestamp: number, trips: TripFixture[]): Uint8Array {
  return transit_realtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: "2.0", timestamp: headerTimestamp },
    entity: trips.map((trip, i) => ({
      id: `t${i}`,
      tripUpdate: {
        trip: { tripId: `trip${i}`, routeId: trip.routeId },
        stopTimeUpdate: trip.stops.map(([stopId, time]) => ({
          stopId,
          departure: { time },
        })),
      },
    })),
  } as transit_realtime.IFeedMessage).finish();
}

function gbfsStatus(
  stations: { id: string; classic: number; electric: number; docks: number; renting?: boolean }[],
): string {
  return JSON.stringify({
    data: {
      stations: stations.map((s) => ({
        station_id: s.id,
        num_bikes_available: s.classic + s.electric,
        num_docks_available: s.docks,
        is_renting: s.renting === false ? 0 : 1,
        is_installed: 1,
        is_returning: 1,
        vehicle_types_available: [
          { vehicle_type_id: "1", count: s.classic },
          { vehicle_type_id: "2", count: s.electric },
        ],
      })),
    },
    last_updated: nowSec(),
    ttl: 60,
    version: "2.3",
  });
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ---------- outbound fetch stub (DO refreshes share the isolate's fetch) ----------

type Responder = () => { status: number; body: Uint8Array | string };
const responders = new Map<string, Responder>();
const realFetch = globalThis.fetch;
const outboundUrls: string[] = [];

function respondWith(url: string, responder: Responder) {
  responders.set(url, responder);
}

beforeEach(async () => {
  responders.clear();
  outboundUrls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    outboundUrls.push(url);
    const responder = responders.get(url);
    if (!responder) throw new Error(`unmocked outbound fetch: ${url}`);
    const { status, body } = responder();
    const payload = typeof body === "string" ? body : body.slice().buffer;
    return new Response(payload as BodyInit, { status });
  }) as typeof fetch;

  for (const table of ["feeds", "stops", "routes", "stop_routes", "route_directions"]) {
    await env.DB.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  }
  await env.DB.prepare(
    `CREATE TABLE feeds (id TEXT PRIMARY KEY NOT NULL, rt_trip_url TEXT, rt_alert_url TEXT,
       adapter TEXT, direction_labels TEXT, units TEXT)`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE stops (feed_id TEXT NOT NULL, stop_id TEXT NOT NULL, name TEXT,
       lat REAL, lon REAL, parent_station TEXT, capacity INTEGER,
       PRIMARY KEY (feed_id, stop_id))`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE routes (feed_id TEXT NOT NULL, route_id TEXT NOT NULL, short_name TEXT,
       long_name TEXT, color TEXT, text_color TEXT, route_type INTEGER,
       PRIMARY KEY (feed_id, route_id))`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE stop_routes (feed_id TEXT NOT NULL, stop_id TEXT NOT NULL, route_id TEXT NOT NULL,
       PRIMARY KEY (feed_id, stop_id, route_id))`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE route_directions (feed_id TEXT NOT NULL, route_id TEXT NOT NULL,
       direction_id INTEGER NOT NULL, headsign TEXT,
       PRIMARY KEY (feed_id, route_id, direction_id))`,
  ).run();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---------- seeding helpers (unique feed ids: DO instances persist per name) ----------

let feedSerial = 0;

async function seedRailFeed(): Promise<FeedInfo> {
  const id = `rail-${++feedSerial}-${Date.now() % 100000}`;
  await env.DB.prepare(
    "INSERT INTO feeds (id, rt_trip_url, rt_alert_url, adapter, units) VALUES (?, ?, ?, 'nyct', 'imperial')",
  )
    .bind(id, `${ORIGIN}/${id}`, `${ORIGIN}/${id}/alerts.json`)
    .run();
  return { id, adapter: "nyct", directionLabels: ["Uptown", "Downtown"], units: "imperial" };
}

const MERCURY = "transit_realtime.mercury_alert";

function alertsBody(
  fixtures: {
    routes?: string[];
    agency?: boolean;
    alertType?: string;
    text?: string;
    stops?: string[];
    updatedAt?: number;
  }[],
): string {
  return JSON.stringify({
    header: { timestamp: nowSec() },
    entity: fixtures.map((f, i) => ({
      id: `lmm:alert:${i}`,
      alert: {
        informed_entity: [
          ...(f.routes ?? []).map((r) => ({ route_id: r })),
          ...(f.stops ?? []).map((s) => ({ route_id: f.routes?.[0], stop_id: s })),
          ...(f.agency ? [{ agency_id: "MTASBWY" }] : []),
        ],
        active_period: [],
        header_text: { translation: [{ language: "en", text: f.text ?? "Trains delayed" }] },
        [MERCURY]: { alert_type: f.alertType ?? "Delays", updated_at: f.updatedAt ?? 1785700000 },
      },
    })),
  });
}

async function seedBikeFeed(): Promise<FeedInfo> {
  const id = `bike-${++feedSerial}-${Date.now() % 100000}`;
  await env.DB.prepare("INSERT INTO feeds (id, rt_trip_url, adapter, units) VALUES (?, ?, 'gbfs', 'imperial')")
    .bind(id, `${ORIGIN}/${id}/status.json`)
    .run();
  return { id, adapter: "gbfs", directionLabels: null, units: "imperial" };
}

async function seedStation(
  feedId: string,
  parentId: string,
  name: string,
  lat: number,
  lon: number,
  routesByPlatform: Record<string, string[]>, // "A41N" -> ["A", "C"]
) {
  await env.DB.prepare(
    "INSERT INTO stops (feed_id, stop_id, name, lat, lon) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(feedId, parentId, name, lat, lon)
    .run();
  for (const [platform, routes] of Object.entries(routesByPlatform)) {
    await env.DB.prepare(
      "INSERT INTO stops (feed_id, stop_id, name, lat, lon, parent_station) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(feedId, platform, name, lat, lon, parentId)
      .run();
    for (const route of routes) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO stop_routes (feed_id, stop_id, route_id) VALUES (?, ?, ?)",
      )
        .bind(feedId, platform, route)
        .run();
    }
  }
}

async function seedRoute(
  feedId: string,
  routeId: string,
  shortName: string | null,
  color: string | null,
  textColor: string | null = null,
) {
  await env.DB.prepare(
    "INSERT INTO routes (feed_id, route_id, short_name, color, text_color) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(feedId, routeId, shortName, color, textColor)
    .run();
}

async function seedBikeStation(feedId: string, id: string, name: string, lat: number, lon: number, capacity: number) {
  await env.DB.prepare(
    "INSERT INTO stops (feed_id, stop_id, name, lat, lon, capacity) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(feedId, id, name, lat, lon, capacity)
    .run();
}

function compose(feeds: FeedInfo[], modes: string[] = ["rail", "bus", "bike"]) {
  return composeNearby(env, feeds, { lat: JAY.lat, lon: JAY.lon, modes });
}

/** First read arms the DO's refresh-behind; the second sees the snapshot. */
async function composeWarm(feeds: FeedInfo[], modes: string[]) {
  await compose(feeds, modes);
  await new Promise((r) => setTimeout(r, 150));
  return compose(feeds, modes);
}

function railSystem(body: any) {
  return body.systems.find((s: any) => s.mode === "rail");
}

// ---------- tests ----------

describe("composeNearby — rail", () => {
  it("builds trunks grouped by feed color with direction-split arrivals and headsigns", async () => {
    const feed = await seedRailFeed();
    const now = nowSec();
    await seedStation(feed.id, "A41", "Jay St-MetroTech", JAY.lat, JAY.lon, {
      A41N: ["A", "C"],
      A41S: ["A", "C"],
    });
    await seedRoute(feed.id, "A", "A", "0039A6", "FFFFFF");
    await seedRoute(feed.id, "C", "C", "0039A6", "FFFFFF");
    // Terminal platform rows so realtime terminals resolve to names.
    await seedStation(feed.id, "A65", "Far Rockaway-Mott Av", JAY.lat + 0.2, JAY.lon, {});
    await env.DB.prepare(
      "INSERT INTO stops (feed_id, stop_id, name, lat, lon, parent_station) VALUES (?, 'A65S', 'Far Rockaway-Mott Av', ?, ?, 'A65')",
    )
      .bind(feed.id, JAY.lat + 0.2, JAY.lon)
      .run();
    await env.DB.prepare(
      "INSERT INTO stops (feed_id, stop_id, name, lat, lon, parent_station) VALUES (?, 'A09N', '168 St', ?, ?, 'A09')",
    )
      .bind(feed.id, JAY.lat + 0.2, JAY.lon)
      .run();

    respondWith(`${ORIGIN}/${feed.id}-ace`, () => ({
      status: 200,
      // Mid-minute offsets (+150/+330): an exact-minute boundary flips the
      // floor()ed eta when composition lands a second later than `now`.
      body: encodeTrips(now, [
        { routeId: "A", stops: [["A41S", now + 150], ["A65S", now + 1800]] },
        { routeId: "C", stops: [["A41N", now + 330], ["A09N", now + 2400]] },
      ]),
    }));

    const body: any = await composeWarm([feed], ["rail"]);
    const system = railSystem(body);
    expect(system.direction_labels).toEqual(["Uptown", "Downtown"]);
    expect(system.stops).toHaveLength(1);

    const stop = system.stops[0];
    expect(stop.id).toBe("A41");
    expect(stop.name).toBe("Jay St-MetroTech");
    expect(stop.distance_label).toMatch(/ft$/);
    expect(stop.trunks).toHaveLength(1); // A + C share the color

    const trunk = stop.trunks[0];
    expect(trunk.key).toBe("0039a6");
    expect(trunk.color).toBe("#0039A6");
    expect(trunk.text_color).toBe("#FFFFFF");
    expect(trunk.alert).toBeNull();
    expect(trunk.note).toBeNull();
    expect(trunk.routes).toEqual([
      { label: "A", shape: "circle" },
      { label: "C", shape: "circle" },
    ]);

    expect(trunk.directions).toHaveLength(2);
    const [dir0, dir1] = trunk.directions;
    expect(dir0.direction_id).toBe(0);
    expect(dir0.arrivals).toEqual([{ route: "C", headsign: "168 St", eta_min: 5 }]);
    expect(dir1.direction_id).toBe(1);
    expect(dir1.arrivals).toEqual([{ route: "A", headsign: "Far Rockaway-Mott Av", eta_min: 2 }]);

    expect(system.fetched_at).toBeGreaterThan(0);
    expect(system.partial).toBeUndefined();
    expect(body.units).toBe("imperial");
    expect(body.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("separates trunks by color and gives colorless routes stable r:-keys and palette colors", async () => {
    const feed = await seedRailFeed();
    await seedStation(feed.id, "R29", "Court St", JAY.lat, JAY.lon, {
      R29N: ["N", "Q", "X1", "X2"],
    });
    await seedRoute(feed.id, "N", "N", "FCCC0A");
    await seedRoute(feed.id, "Q", "Q", "FCCC0A");
    await seedRoute(feed.id, "X1", "X1", null);
    await seedRoute(feed.id, "X2", "X2", null);

    const first: any = await compose([feed], ["rail"]);
    const trunks = railSystem(first).stops[0].trunks;
    expect(trunks).toHaveLength(3); // yellow N/Q + two single-route fallback trunks
    const yellow = trunks.find((t: any) => t.key === "fccc0a");
    expect(yellow.routes.map((r: any) => r.label).sort()).toEqual(["N", "Q"]);
    expect(yellow.text_color).toBe("#000000"); // luminance fallback on the yellow
    const x1 = trunks.find((t: any) => t.key === "r:X1");
    const x2 = trunks.find((t: any) => t.key === "r:X2");
    expect(x1).toBeDefined();
    expect(x2).toBeDefined();

    const second: any = await compose([feed], ["rail"]);
    const again = railSystem(second).stops[0].trunks.find((t: any) => t.key === "r:X1");
    expect(again.color).toBe(x1.color); // stable across calls
  });

  it("keeps both direction entries when only one platform direction exists", async () => {
    const feed = await seedRailFeed();
    await seedStation(feed.id, "X10", "One Way", JAY.lat, JAY.lon, { X10N: ["G"] });
    await seedRoute(feed.id, "G", "G", "6CBE45");
    const body: any = await compose([feed], ["rail"]);
    const trunk = railSystem(body).stops[0].trunks[0];
    expect(trunk.directions.map((d: any) => d.direction_id)).toEqual([0, 1]);
    expect(trunk.directions[1].arrivals).toEqual([]);
  });

  it("clamps past arrivals to eta 0 and floors future ones", async () => {
    const feed = await seedRailFeed();
    const now = nowSec();
    await seedStation(feed.id, "G22", "Court Sq", JAY.lat, JAY.lon, { G22N: ["G"] });
    await seedRoute(feed.id, "G", "G", "6CBE45");
    respondWith(`${ORIGIN}/${feed.id}-g`, () => ({
      status: 200,
      body: encodeTrips(now, [
        { routeId: "G", stops: [["G22N", now + 1]] }, // effectively "now"
        { routeId: "G", stops: [["G22N", now + 95]] },
      ]),
    }));
    const body: any = await composeWarm([feed], ["rail"]);
    const arrivals = railSystem(body).stops[0].trunks[0].directions[0].arrivals;
    expect(arrivals.map((a: any) => a.eta_min)).toEqual([0, 1]);
  });

  it("marks partial and uses the fresh min when one group is cold, null when all are", async () => {
    const feed = await seedRailFeed();
    const now = nowSec();
    // A (ace group) + 1 (1234567s group) at one station; only ace responds.
    await seedStation(feed.id, "MIX", "Mixed", JAY.lat, JAY.lon, {
      MIXN: ["A", "1"],
    });
    await seedRoute(feed.id, "A", "A", "0039A6");
    await seedRoute(feed.id, "1", "1", "EE352E");
    respondWith(`${ORIGIN}/${feed.id}-ace`, () => ({
      status: 200,
      body: encodeTrips(now, [{ routeId: "A", stops: [["MIXN", now + 60]] }]),
    }));
    respondWith(`${ORIGIN}/${feed.id}`, () => ({ status: 500, body: "" }));

    // First compose arms both DOs (cold reads), second sees the ace snapshot.
    await compose([feed], ["rail"]);
    await new Promise((r) => setTimeout(r, 100));
    const body: any = await compose([feed], ["rail"]);
    const system = railSystem(body);
    expect(system.partial).toBe(true); // numbered group still cold
    expect(system.fetched_at).toBeGreaterThan(0); // min over non-null stamps
    const one = system.stops[0].trunks.find((t: any) => t.key === "ee352e");
    expect(one.directions[0].arrivals).toEqual([]); // cold group renders empty

    // All-cold system: brand-new feed, upstreams down.
    const cold = await seedRailFeed();
    await seedStation(cold.id, "C1", "Cold", JAY.lat, JAY.lon, { C1N: ["A"] });
    await seedRoute(cold.id, "A", "A", "0039A6");
    respondWith(`${ORIGIN}/${cold.id}-ace`, () => ({ status: 500, body: "" }));
    const coldBody: any = await compose([cold], ["rail"]);
    const coldSystem = railSystem(coldBody);
    expect(coldSystem.fetched_at).toBeNull();
    expect(coldSystem.partial).toBe(true);
  });

  it("degrades a failed group DO to never-fetched semantics with the request still 200", async () => {
    // No feeds row for this id: the group DO's refresh flags configMissing and
    // subsequent reads 404 — the composer's rejected-group path.
    const ghost: FeedInfo = {
      id: `ghost-${Date.now() % 100000}`,
      adapter: "nyct",
      directionLabels: null,
      units: "imperial",
    };
    await seedStation(ghost.id, "GH1", "Ghost", JAY.lat, JAY.lon, { GH1N: ["A"] });
    await seedRoute(ghost.id, "A", "A", "0039A6");

    await compose([ghost], ["rail"]); // cold read arms refresh, which hits the missing config
    await new Promise((r) => setTimeout(r, 100));
    const body: any = await compose([ghost], ["rail"]); // DO now 404s
    const system = railSystem(body);
    expect(system.fetched_at).toBeNull();
    expect(system.partial).toBe(true);
    expect(system.stops[0].trunks[0].directions[0].arrivals).toEqual([]);
  });

  it("falls back to route_directions headsigns when the terminal is missing or unresolvable", async () => {
    const feed = await seedRailFeed();
    const now = nowSec();
    await seedStation(feed.id, "A41", "Jay St", JAY.lat, JAY.lon, { A41S: ["A", "C"] });
    await seedRoute(feed.id, "A", "A", "0039A6");
    await seedRoute(feed.id, "C", "C", "0039A6");
    await env.DB.prepare(
      "INSERT INTO route_directions (feed_id, route_id, direction_id, headsign) VALUES (?, 'A', 1, 'Far Rockaway')",
    )
      .bind(feed.id)
      .run();
    respondWith(`${ORIGIN}/${feed.id}-ace`, () => ({
      status: 200,
      body: encodeTrips(now, [
        // Terminal id resolves to no stops row → static fallback.
        { routeId: "A", stops: [["A41S", now + 120], ["ZZZ9S", now + 1800]] },
        // No route_directions row for C and unresolvable terminal → null.
        { routeId: "C", stops: [["A41S", now + 240], ["YYY9S", now + 1900]] },
      ]),
    }));
    const body: any = await composeWarm([feed], ["rail"]);
    const arrivals = railSystem(body).stops[0].trunks[0].directions[1].arrivals;
    expect(arrivals.find((a: any) => a.route === "A").headsign).toBe("Far Rockaway");
    expect(arrivals.find((a: any) => a.route === "C").headsign).toBeNull();
  });

  it("resolves shuttles through the enumerated map and tolerates unmapped routes", async () => {
    const feed = await seedRailFeed();
    const now = nowSec();
    await seedStation(feed.id, "S01", "Times Sq", JAY.lat, JAY.lon, {
      S01N: ["GS", "MYSTERY"],
    });
    await seedRoute(feed.id, "GS", "S", "808183");
    await seedRoute(feed.id, "MYSTERY", "M?", null);
    respondWith(`${ORIGIN}/${feed.id}`, () => ({
      status: 200,
      body: encodeTrips(now, [{ routeId: "GS", stops: [["S01N", now + 90]] }]),
    }));
    const body: any = await composeWarm([feed], ["rail"]);
    const trunks = railSystem(body).stops[0].trunks;
    const shuttle = trunks.find((t: any) => t.key === "808183");
    expect(shuttle.directions[0].arrivals).toHaveLength(1); // GS reached via 1234567s group
    const mystery = trunks.find((t: any) => t.key === "r:MYSTERY");
    expect(mystery.directions[0].arrivals).toEqual([]); // unmapped: empty, not a throw
  });

  it("drops arrivals keyed to suffix-less platform ids", async () => {
    const feed = await seedRailFeed();
    const now = nowSec();
    // Standalone stop id with no N/S suffix — direction cannot be derived.
    await env.DB.prepare(
      "INSERT INTO stops (feed_id, stop_id, name, lat, lon) VALUES (?, 'B99', 'Suffixless', ?, ?)",
    )
      .bind(feed.id, JAY.lat, JAY.lon)
      .run();
    await env.DB.prepare(
      "INSERT INTO stop_routes (feed_id, stop_id, route_id) VALUES (?, 'B99', 'A')",
    )
      .bind(feed.id)
      .run();
    await seedRoute(feed.id, "A", "A", "0039A6");
    respondWith(`${ORIGIN}/${feed.id}-ace`, () => ({
      status: 200,
      body: encodeTrips(now, [{ routeId: "A", stops: [["B99", now + 60]] }]),
    }));
    const body: any = await composeWarm([feed], ["rail"]);
    const trunk = railSystem(body).stops[0].trunks[0];
    expect(trunk.directions[0].arrivals).toEqual([]);
    expect(trunk.directions[1].arrivals).toEqual([]);
  });

  it("carries nearest_distance_label when the system has zero in-radius stops", async () => {
    const feed = await seedRailFeed();
    await seedStation(feed.id, "FAR", "Far Station", JAY.lat + 0.035, JAY.lon, {
      FARN: ["A"],
    });
    const body: any = await compose([feed], ["rail"]);
    const system = railSystem(body);
    expect(system.stops).toEqual([]);
    expect(system.fetched_at).toBeNull();
    expect(system.nearest_distance_label).toBe("2.4 mi");
  });
});

describe("composeNearby — bike and modes", () => {
  it("merges GbfsDO counts onto stations by id; absent stations get honest zeros", async () => {
    const feed = await seedBikeFeed();
    await seedBikeStation(feed.id, "st-1", "Adams St & Tillary St", JAY.lat + 0.001, JAY.lon, 31);
    await seedBikeStation(feed.id, "st-2", "Jay St & York St", JAY.lat + 0.002, JAY.lon, 24);
    respondWith(`${ORIGIN}/${feed.id}/status.json`, () => ({
      status: 200,
      body: gbfsStatus([{ id: "st-1", classic: 9, electric: 5, docks: 9 }]),
    }));

    await compose([feed], ["bike"]); // cold read arms the poller
    await new Promise((r) => setTimeout(r, 100));
    const body: any = await compose([feed], ["bike"]);
    const system = body.systems.find((s: any) => s.mode === "bike");
    expect(system.fetched_at).toBeGreaterThan(0);
    expect(system.partial).toBeUndefined();
    expect(system.stations).toEqual([
      {
        id: "st-1",
        name: "Adams St & Tillary St",
        distance_label: expect.stringMatching(/ft$/),
        bikes_classic: 9,
        bikes_electric: 5,
        docks_open: 9,
        capacity: 31,
      },
      {
        id: "st-2",
        name: "Jay St & York St",
        distance_label: expect.stringMatching(/ft$/),
        bikes_classic: 0, // fresh feed, station absent → real zeros
        bikes_electric: 0,
        docks_open: 0,
        capacity: 24,
      },
    ]);
  });

  it("keeps capacity with null counts when the status source has no data", async () => {
    const feed = await seedBikeFeed();
    await seedBikeStation(feed.id, "st-9", "Cold Station", JAY.lat + 0.001, JAY.lon, 19);
    respondWith(`${ORIGIN}/${feed.id}/status.json`, () => ({ status: 500, body: "" }));
    const body: any = await compose([feed], ["bike"]); // first read: fetched_at null
    const system = body.systems.find((s: any) => s.mode === "bike");
    expect(system.fetched_at).toBeNull();
    expect(system.partial).toBe(true);
    expect(system.stations[0]).toMatchObject({
      bikes_classic: null,
      bikes_electric: null,
      docks_open: null,
      capacity: 19,
    });
  });

  it("honors modes= as a filter and emits configured-empty systems", async () => {
    const rail = await seedRailFeed();
    const filtered: any = await compose([rail], ["rail"]);
    expect(filtered.systems.map((s: any) => s.mode)).toEqual(["rail"]);

    const all: any = await compose([rail], ["rail", "bus", "bike"]);
    expect(all.systems.map((s: any) => s.mode)).toEqual(["rail", "bus", "bike"]);
    const bus = all.systems.find((s: any) => s.mode === "bus");
    expect(bus.stops).toEqual([]);
    expect(bus.fetched_at).toBeNull();
    const bike = all.systems.find((s: any) => s.mode === "bike");
    expect(bike.stations).toEqual([]); // no bike feed passed
  });
});

describe("/v1/nearby routes", () => {
  function withIp(init: RequestInit = {}, ip = `10.0.0.${++feedSerial}`): RequestInit {
    return { ...init, headers: { ...(init.headers ?? {}), "CF-Connecting-IP": ip } };
  }

  it("rejects a GET without coordinates", async () => {
    const res = await SELF.fetch("https://api/v1/nearby", withIp());
    expect(res.status).toBe(400);
  });

  it("rejects out-of-range coordinates", async () => {
    const res = await SELF.fetch("https://api/v1/nearby?lat=91&lon=0", withIp());
    expect(res.status).toBe(400);
  });

  it("returns 422 with the distinct shape when location is unknown", async () => {
    respondWith("https://api.beacondb.net/v1/geolocate", () => ({
      status: 404,
      body: JSON.stringify({ error: { errors: [{ reason: "notFound" }], code: 404, message: "Not found" } }),
    }));
    const res = await SELF.fetch(
      "https://api/v1/nearby",
      withIp({
        method: "POST",
        body: JSON.stringify({ wifiAccessPoints: [{ macAddress: "aa:bb:cc:dd:ee:01" }, { macAddress: "aa:bb:cc:dd:ee:02" }] }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "location unknown" });
  });

  it("rejects an oversized wifiAccessPoints array before any provider call", async () => {
    const aps = Array.from({ length: 51 }, (_, i) => ({ macAddress: `aa:bb:cc:dd:${String(i % 100).padStart(2, "0")}:0${i % 10}` }));
    const res = await SELF.fetch(
      "https://api/v1/nearby",
      withIp({ method: "POST", body: JSON.stringify({ wifiAccessPoints: aps }), headers: { "content-type": "application/json" } }),
    );
    expect(res.status).toBe(400);
    expect(outboundUrls.filter((u) => u.includes("beacondb"))).toEqual([]);
  });

  it("resolves BSSIDs and composes in one round trip, reporting the location", async () => {
    // Curated feeds must exist for the router path; mta-subway needs no
    // in-radius stops (fixture is far from real stations anyway).
    await env.DB.prepare(
      "INSERT INTO feeds (id, rt_trip_url, adapter, direction_labels, units) VALUES ('mta-subway', ?, 'nyct', '[\"Uptown\",\"Downtown\"]', 'imperial')",
    )
      .bind(`${ORIGIN}/mta`)
      .run();
    await env.DB.prepare(
      "INSERT INTO feeds (id, rt_trip_url, adapter, units) VALUES ('citibike', ?, 'gbfs', 'imperial')",
    )
      .bind(`${ORIGIN}/citibike/status.json`)
      .run();
    respondWith("https://api.beacondb.net/v1/geolocate", () => ({
      status: 200,
      body: JSON.stringify({ location: { lat: JAY.lat, lng: JAY.lon }, accuracy: 40 }),
    }));

    const res = await SELF.fetch(
      "https://api/v1/nearby?modes=rail",
      withIp({
        method: "POST",
        body: JSON.stringify({
          wifiAccessPoints: [{ macAddress: "aa:bb:cc:dd:ee:11" }, { macAddress: "aa:bb:cc:dd:ee:12" }],
          device_id: "test-device",
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.location).toEqual({ lat: JAY.lat, lon: JAY.lon, accuracy: 40 });
    expect(body.systems.map((s: any) => s.mode)).toEqual(["rail"]);
    expect(body.units).toBe("imperial");
  });

  it("GET with lat/lon never consults the locate providers", async () => {
    await env.DB.prepare(
      "INSERT INTO feeds (id, rt_trip_url, adapter, units) VALUES ('mta-subway', ?, 'nyct', 'imperial')",
    )
      .bind(`${ORIGIN}/mta`)
      .run();
    await env.DB.prepare(
      "INSERT INTO feeds (id, rt_trip_url, adapter, units) VALUES ('citibike', ?, 'gbfs', 'imperial')",
    )
      .bind(`${ORIGIN}/citibike/status.json`)
      .run();
    const res = await SELF.fetch(
      `https://api/v1/nearby?lat=${JAY.lat}&lon=${JAY.lon}&modes=rail`,
      withIp(),
    );
    expect(res.status).toBe(200);
    expect(outboundUrls.filter((u) => u.includes("beacondb"))).toEqual([]);
    const body: any = await res.json();
    expect(body.location).toEqual({ lat: JAY.lat, lon: JAY.lon, accuracy: null });
  });

  it("shares the tighter locate rate bucket", async () => {
    const ip = "10.9.9.9";
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const res = await SELF.fetch("https://api/v1/nearby?lat=91&lon=0", withIp({}, ip));
      if (res.status === 429) limited = true;
    }
    expect(limited).toBe(true);
  });
});

describe("payload budget", () => {
  it("stays within the stated ~25 KB bound at full depth", async () => {
    const feed = await seedRailFeed();
    const now = nowSec();
    // 5 stations × 2 platforms × 2 routes, 8 arrivals per route per direction.
    const trips: TripFixture[] = [];
    for (let s = 1; s <= 5; s++) {
      await seedStation(feed.id, `ST${s}`, `Station Number ${s} With A Long Name`, JAY.lat + 0.001 * s, JAY.lon, {
        [`ST${s}N`]: ["A", "C"],
        [`ST${s}S`]: ["A", "C"],
      });
      for (const route of ["A", "C"]) {
        for (let i = 0; i < 8; i++) {
          trips.push({ routeId: route, stops: [[`ST${s}N`, now + 60 * (i + 1)], ["TERM9N", now + 3600]] });
          trips.push({ routeId: route, stops: [[`ST${s}S`, now + 60 * (i + 1)], ["TERM1S", now + 3600]] });
        }
      }
    }
    await seedRoute(feed.id, "A", "A", "0039A6");
    await seedRoute(feed.id, "C", "C", "0039A6");
    respondWith(`${ORIGIN}/${feed.id}-ace`, () => ({ status: 200, body: encodeTrips(now, trips) }));

    await compose([feed], ["rail"]);
    await new Promise((r) => setTimeout(r, 150));
    const body = await compose([feed], ["rail"]);
    const size = JSON.stringify(body).length;
    const arrivalCount = JSON.stringify(body).match(/eta_min/g)?.length ?? 0;
    expect(arrivalCount).toBeGreaterThanOrEqual(75); // ~80 = 5 stations × 2 directions × depth 8
    expect(size).toBeLessThan(25_000);
  });
});

describe("review-driven regressions", () => {
  it("carries nearest_distance_label on an empty bike system", async () => {
    const feed = await seedBikeFeed();
    // ~3.9 km north — outside the 1200 m radius, inside the widening search.
    await seedBikeStation(feed.id, "far-dock", "Far Dock", JAY.lat + 0.035, JAY.lon, 20);
    const body: any = await compose([feed], ["bike"]);
    const system = body.systems.find((s: any) => s.mode === "bike");
    expect(system.stations).toEqual([]);
    expect(system.fetched_at).toBeNull();
    expect(system.nearest_distance_label).toBe("2.4 mi");
  });

  it("returns null nearest_distance_label when the bike feed has no stations at all", async () => {
    const feed = await seedBikeFeed();
    const body: any = await compose([feed], ["bike"]);
    const system = body.systems.find((s: any) => s.mode === "bike");
    expect(system.nearest_distance_label).toBeNull();
  });

  it("rejects a modes= list with no known mode instead of returning everything", async () => {
    const res = await SELF.fetch(
      `https://api/v1/nearby?lat=${JAY.lat}&lon=${JAY.lon}&modes=scooter`,
      { headers: { "CF-Connecting-IP": "10.44.44.1" } },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown modes" });
  });

  it("defaults to all three systems when modes= is absent", async () => {
    const res = await SELF.fetch(`https://api/v1/nearby?lat=${JAY.lat}&lon=${JAY.lon}`, {
      headers: { "CF-Connecting-IP": "10.44.44.2" },
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.systems.map((s: any) => s.mode)).toEqual(["rail", "bus", "bike"]);
  });

  it("composes a generic single-group (non-NYCT) rail adapter through group 'all'", async () => {
    const id = `generic-${Date.now() % 100000}`;
    await env.DB.prepare(
      "INSERT INTO feeds (id, rt_trip_url, adapter, units) VALUES (?, ?, 'gtfs_rt', 'imperial')",
    )
      .bind(id, `${ORIGIN}/${id}`)
      .run();
    const feed: FeedInfo = { id, adapter: "gtfs_rt", directionLabels: null, units: "imperial" };
    const now = nowSec();
    await seedStation(id, "G1", "Generic Stop", JAY.lat, JAY.lon, { G1N: ["R1"] });
    await seedRoute(id, "R1", "R1", "3E86C0");
    // gtfs_rt is single-group: the base rt_trip_url IS the "all" group URL.
    respondWith(`${ORIGIN}/${id}`, () => ({
      status: 200,
      body: encodeTrips(now, [{ routeId: "R1", stops: [["G1N", now + 120]] }]),
    }));
    const body: any = await composeWarm([feed], ["rail"]);
    const system = railSystem(body);
    expect(system.fetched_at).toBeGreaterThan(0);
    expect(system.stops[0].trunks[0].directions[0].arrivals).toHaveLength(1);
  });
});

describe("trunk alerts", () => {
  it("fills trunk.alert with the design shape for an alerted member route", async () => {
    const feed = await seedRailFeed();
    const now = nowSec();
    await seedStation(feed.id, "A41", "Jay St", JAY.lat, JAY.lon, { A41N: ["A", "C"], A41S: ["A", "C"] });
    await seedStation(feed.id, "G22", "Court Sq", JAY.lat + 0.001, JAY.lon, { G22N: ["G"] });
    await seedRoute(feed.id, "A", "A", "0039A6");
    await seedRoute(feed.id, "C", "C", "0039A6");
    await seedRoute(feed.id, "G", "G", "6CBE45");
    respondWith(`${ORIGIN}/${feed.id}-ace`, () => ({
      status: 200,
      body: encodeTrips(now, [{ routeId: "A", stops: [["A41N", now + 120]] }]),
    }));
    respondWith(`${ORIGIN}/${feed.id}/alerts.json`, () => ({
      status: 200,
      body: alertsBody([{ routes: ["A"], alertType: "Delays", text: "Delays · signal problem" }]),
    }));

    const body: any = await composeWarm([feed], ["rail"]);
    const stops = railSystem(body).stops;
    const jay = stops.find((s: any) => s.id === "A41");
    expect(jay.trunks[0].alert).toEqual({
      severity: "delay",
      text: "Delays · signal problem",
      directions: [0, 1], // no direction selectors → both
    });
    const courtSq = stops.find((s: any) => s.id === "G22");
    expect(courtSq.trunks[0].alert).toBeNull(); // G not alerted
  });

  it("scopes stop-selector alerts to the shown station and derives directions from suffixes", async () => {
    const feed = await seedRailFeed();
    await seedStation(feed.id, "A41", "Jay St", JAY.lat, JAY.lon, { A41S: ["A"] });
    await seedStation(feed.id, "A48", "Other St", JAY.lat + 0.002, JAY.lon, { A48S: ["A"] });
    await seedRoute(feed.id, "A", "A", "0039A6");
    respondWith(`${ORIGIN}/${feed.id}/alerts.json`, () => ({
      status: 200,
      body: alertsBody([{ routes: ["A"], stops: ["A41S"], text: "Downtown A at Jay St only" }]),
    }));

    const body: any = await composeWarm([feed], ["rail"]);
    const stops = railSystem(body).stops;
    const jay = stops.find((s: any) => s.id === "A41");
    expect(jay.trunks[0].alert.text).toBe("Downtown A at Jay St only");
    expect(jay.trunks[0].alert.directions).toEqual([1]); // S suffix
    const other = stops.find((s: any) => s.id === "A48");
    expect(other.trunks[0].alert).toBeNull(); // out of scope
  });

  it("applies agency-wide alerts to every trunk at every station", async () => {
    const feed = await seedRailFeed();
    await seedStation(feed.id, "A41", "Jay St", JAY.lat, JAY.lon, { A41N: ["A"] });
    await seedStation(feed.id, "R29", "Court St", JAY.lat + 0.001, JAY.lon, { R29N: ["R"] });
    await seedRoute(feed.id, "A", "A", "0039A6");
    await seedRoute(feed.id, "R", "R", "FCCC0A");
    respondWith(`${ORIGIN}/${feed.id}/alerts.json`, () => ({
      status: 200,
      body: alertsBody([{ agency: true, alertType: "Delays", text: "Systemwide suspension" }]),
    }));

    const body: any = await composeWarm([feed], ["rail"]);
    for (const stop of railSystem(body).stops) {
      for (const trunk of stop.trunks) {
        expect(trunk.alert?.text).toBe("Systemwide suspension");
      }
    }
  });

  it("picks delay over info, then newer updatedAt, one alert per trunk", async () => {
    const feed = await seedRailFeed();
    await seedStation(feed.id, "A41", "Jay St", JAY.lat, JAY.lon, { A41N: ["A"] });
    await seedRoute(feed.id, "A", "A", "0039A6");
    respondWith(`${ORIGIN}/${feed.id}/alerts.json`, () => ({
      status: 200,
      body: alertsBody([
        { routes: ["A"], alertType: "Boarding Change", text: "older info", updatedAt: 100 },
        { routes: ["A"], alertType: "Delays", text: "the delay", updatedAt: 50 },
        { routes: ["A"], alertType: "Boarding Change", text: "newer info", updatedAt: 200 },
      ]),
    }));
    const body: any = await composeWarm([feed], ["rail"]);
    expect(railSystem(body).stops[0].trunks[0].alert.text).toBe("the delay");
  });

  it("truncates long alert text at a whitespace boundary", async () => {
    const feed = await seedRailFeed();
    await seedStation(feed.id, "A41", "Jay St", JAY.lat, JAY.lon, { A41N: ["A"] });
    await seedRoute(feed.id, "A", "A", "0039A6");
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    respondWith(`${ORIGIN}/${feed.id}/alerts.json`, () => ({
      status: 200,
      body: alertsBody([{ routes: ["A"], text: long }]),
    }));
    const body: any = await composeWarm([feed], ["rail"]);
    const text = railSystem(body).stops[0].trunks[0].alert.text;
    expect(text.length).toBeLessThanOrEqual(201); // 200 + ellipsis
    expect(text.endsWith("…")).toBe(true);
    expect(text.slice(0, -1).endsWith("word")).toBe(false); // cut at whitespace, not mid-word
  });

  it("degrades to null alerts when the AlertDO source fails, without touching partial", async () => {
    const feed = await seedRailFeed();
    const now = nowSec();
    await seedStation(feed.id, "A41", "Jay St", JAY.lat, JAY.lon, { A41N: ["A"] });
    await seedRoute(feed.id, "A", "A", "0039A6");
    respondWith(`${ORIGIN}/${feed.id}-ace`, () => ({
      status: 200,
      body: encodeTrips(now, [{ routeId: "A", stops: [["A41N", now + 60]] }]),
    }));
    respondWith(`${ORIGIN}/${feed.id}/alerts.json`, () => ({ status: 500, body: "" }));

    const body: any = await composeWarm([feed], ["rail"]);
    const system = railSystem(body);
    expect(system.stops[0].trunks[0].alert).toBeNull();
    expect(system.partial).toBeUndefined(); // alerts are an overlay
    expect(system.stops[0].trunks[0].directions[0].arrivals).toHaveLength(1); // arrivals unaffected
  });

  it("attaches the alert to a multi-route trunk when only one member is alerted", async () => {
    const feed = await seedRailFeed();
    await seedStation(feed.id, "A41", "Jay St", JAY.lat, JAY.lon, { A41N: ["A", "C"] });
    await seedRoute(feed.id, "A", "A", "0039A6");
    await seedRoute(feed.id, "C", "C", "0039A6"); // same trunk
    respondWith(`${ORIGIN}/${feed.id}/alerts.json`, () => ({
      status: 200,
      body: alertsBody([{ routes: ["C"], text: "C only" }]),
    }));
    const body: any = await composeWarm([feed], ["rail"]);
    const trunk = railSystem(body).stops[0].trunks[0];
    expect(trunk.routes.map((r: any) => r.label).sort()).toEqual(["A", "C"]);
    expect(trunk.alert.text).toBe("C only");
  });
});

describe("alert text normalization", () => {
  it("collapses embedded newlines to single spaces", async () => {
    const feed = await seedRailFeed();
    await seedStation(feed.id, "A41", "Jay St", JAY.lat, JAY.lon, { A41N: ["A"] });
    await seedRoute(feed.id, "A", "A", "0039A6");
    respondWith(`${ORIGIN}/${feed.id}/alerts.json`, () => ({
      status: 200,
      body: alertsBody([{ routes: ["A"], text: "No [2] between stations\nTrains run every 20 minutes" }]),
    }));
    const body: any = await composeWarm([feed], ["rail"]);
    expect(railSystem(body).stops[0].trunks[0].alert.text).toBe(
      "No [2] between stations Trains run every 20 minutes",
    );
  });
});
