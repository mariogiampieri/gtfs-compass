import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { transit_realtime } from "../../src/gen/gtfs-realtime.js";
import { type DeparturesParams, type StopRef, composeDepartures } from "../../src/departures";

const ORIGIN = "https://rt.example";
// Jay St–MetroTech; the walk origin sits ~650 m north along the meridian.
const JAY = { lat: 40.692338, lon: -73.987342 };
const ORIGIN_650M = { lat: JAY.lat + 650 / 111_320, lon: JAY.lon, accuracyM: 30 };

// ---------- fixtures ----------

interface TripFixture {
  routeId: string;
  stops: [string, number][];
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

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ---------- outbound fetch stub (DO refreshes share the isolate's fetch) ----------

type Responder = () => { status: number; body: Uint8Array | string };
const responders = new Map<string, Responder>();
const realFetch = globalThis.fetch;

function respondWith(url: string, responder: Responder) {
  responders.set(url, responder);
}

beforeEach(async () => {
  responders.clear();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    const responder = responders.get(url);
    if (!responder) throw new Error(`unmocked outbound fetch: ${url}`);
    const { status, body } = responder();
    const payload = typeof body === "string" ? body : body.slice().buffer;
    return new Response(payload as BodyInit, { status });
  }) as typeof fetch;

  for (const table of ["feeds", "stops", "routes", "stop_routes"]) {
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
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---------- seeding helpers (unique feed ids: DO instances persist per name) ----------

let feedSerial = 0;

/** NYCT-adapter feed: base URL serves 1234567s; other groups get -suffix URLs. */
async function seedNyctFeed(): Promise<string> {
  const id = `rail-${++feedSerial}-${Date.now() % 100000}`;
  await env.DB.prepare(
    "INSERT INTO feeds (id, rt_trip_url, adapter, units) VALUES (?, ?, 'nyct', 'imperial')",
  )
    .bind(id, `${ORIGIN}/${id}`)
    .run();
  return id;
}

/** Plain GTFS-RT feed: single "all" group at the base URL. */
async function seedGtfsRtFeed(): Promise<string> {
  const id = `bus-${++feedSerial}-${Date.now() % 100000}`;
  await env.DB.prepare(
    "INSERT INTO feeds (id, rt_trip_url, adapter, units) VALUES (?, ?, 'gtfs_rt', 'imperial')",
  )
    .bind(id, `${ORIGIN}/${id}`)
    .run();
  return id;
}

async function seedPlatform(
  feedId: string,
  stopId: string,
  routes: string[],
  coords: { lat: number; lon: number } | null = JAY,
) {
  await env.DB.prepare("INSERT INTO stops (feed_id, stop_id, name, lat, lon) VALUES (?, ?, ?, ?, ?)")
    .bind(feedId, stopId, `Stop ${stopId}`, coords?.lat ?? null, coords?.lon ?? null)
    .run();
  for (const route of routes) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO stop_routes (feed_id, stop_id, route_id) VALUES (?, ?, ?)",
    )
      .bind(feedId, stopId, route)
      .run();
  }
}

async function seedRoute(
  feedId: string,
  routeId: string,
  shortName: string | null,
  color: string | null,
  textColor: string | null = null,
  routeType = 1,
) {
  await env.DB.prepare(
    "INSERT INTO routes (feed_id, route_id, short_name, color, text_color, route_type) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(feedId, routeId, shortName, color, textColor, routeType)
    .run();
}

function refs(feedId: string, ...stopIds: string[]): StopRef[] {
  return stopIds.map((stopId) => ({ feedId, stopId }));
}

function params(overrides: Partial<DeparturesParams> & Pick<DeparturesParams, "refs">): DeparturesParams {
  return { n: 3, walkSeconds: new Map(), origin: null, ...overrides };
}

function adapterMap(...feeds: [string, string][]): Map<string, string> {
  return new Map(feeds);
}

/** First read arms the DO's refresh-behind; the second sees the snapshot. */
async function composeWarm(adapters: Map<string, string>, p: DeparturesParams) {
  await composeDepartures(env, adapters, p);
  await new Promise((r) => setTimeout(r, 150));
  return composeDepartures(env, adapters, p);
}

// ---------- tests ----------

describe("composeDepartures — contract", () => {
  it("builds the golden compact payload: namespaced s, per-route entries, ascending trimmed m", async () => {
    const feed = await seedNyctFeed();
    await seedRoute(feed, "A", "A", "0039A6", "FFFFFF");
    await seedRoute(feed, "C", "C", "0039A6", "FFFFFF");
    await seedPlatform(feed, "A41N", ["A", "C"]);
    await seedPlatform(feed, "A41S", ["A", "C"]);
    const t0 = nowSec();
    respondWith(`${ORIGIN}/${feed}-ace`, () => ({
      status: 200,
      body: encodeTrips(t0, [
        { routeId: "A", stops: [["A41N", t0 + 180], ["A41N", t0 + 660], ["A41N", t0 + 1080], ["A41N", t0 + 1500]] },
        { routeId: "C", stops: [["A41N", t0 + 300]] },
        { routeId: "A", stops: [["A41S", t0 + 360], ["A41S", t0 + 840]] },
      ]),
    }));

    const body = await composeWarm(
      adapterMap([feed, "nyct"]),
      params({ refs: refs(feed, "A41N", "A41S") }),
    );

    expect(body.fetched_at).toBeGreaterThanOrEqual(t0);
    expect(body.partial).toBeUndefined();
    expect(typeof body.ts).toBe("number");
    expect(body.d.map((e) => [e.s, e.r])).toEqual([
      [`${feed}:A41N`, "A"],
      [`${feed}:A41N`, "C"],
      [`${feed}:A41S`, "A"],
      [`${feed}:A41S`, "C"],
    ]);
    const a41nA = body.d[0];
    expect(a41nA.c).toBe("0039A6");
    expect(a41nA.t).toBe("FFFFFF");
    expect(a41nA.m).toEqual([3, 11, 18]); // n=3 trims the 4th arrival
    expect(a41nA.l).toBeUndefined(); // no walk context → no leave-by
    expect(body.d[1].m).toEqual([5]);
    expect(body.d[3].m).toEqual([]); // known platform, no C service → dash, not absent
    expect(body.w).toBeUndefined();
  });

  it("keeps entries with empty m for a known stop with no service and omits unknown stop ids", async () => {
    const feed = await seedNyctFeed();
    await seedRoute(feed, "G", "G", "6CBE45");
    await seedPlatform(feed, "G22N", ["G"]);
    respondWith(`${ORIGIN}/${feed}-g`, () => ({ status: 200, body: encodeTrips(nowSec(), []) }));

    const body = await composeWarm(
      adapterMap([feed, "nyct"]),
      params({ refs: refs(feed, "G22N", "GHOST9") }),
    );

    expect(body.d.map((e) => e.s)).toEqual([`${feed}:G22N`]);
    expect(body.d[0].m).toEqual([]);
  });

  it("clamps m at 0 on boundary etas and keeps l unclamped and aligned (630 s fixture)", async () => {
    const feed = await seedNyctFeed();
    await seedRoute(feed, "A", "A", "0039A6");
    await seedPlatform(feed, "A41N", ["A"]);
    const t0 = nowSec();
    respondWith(`${ORIGIN}/${feed}-ace`, () => ({
      status: 200,
      body: encodeTrips(t0, [
        // now+30 (m 0), now+59 (m 0), now+630 (m 10) — DO filters past arrivals.
        { routeId: "A", stops: [["A41N", t0 + 30], ["A41N", t0 + 59], ["A41N", t0 + 630]] },
      ]),
    }));

    const body = await composeWarm(
      adapterMap([feed, "nyct"]),
      params({ refs: refs(feed, "A41N"), walkSeconds: new Map([[`${feed}:A41N`, 420]]) }),
    );

    const entry = body.d[0];
    // Elapsed test time can shift each eta by at most one floor step; the
    // structural facts hold: m clamped at 0, l negative where walk > arrival.
    expect(entry.m[0]).toBe(0);
    expect(entry.m[1]).toBe(0);
    expect(entry.m[2]).toBeGreaterThanOrEqual(9);
    expect(entry.l).toHaveLength(3);
    // arrival now+30 with walk 510: floor((30-510)/60) = -8 — a real, negative fact.
    expect(entry.l![0]).toBeLessThan(0);
    // arrival now+630 with walk 510: floor((630-510)/60) = 2 — distinguishes the
    // formula from m-minus-walk-minutes (10 − 9 = 1).
    expect(entry.l![2]).toBeGreaterThanOrEqual(1);
    expect(entry.l![2]).toBe(Math.floor((630 - 510 - (body.ts - t0)) / 60));
    expect(body.w).toEqual({ [`${feed}:A41N`]: { s: 510, src: "manual" } });
  });

  it("computes the heuristic walk from an origin and reports src heuristic", async () => {
    const feed = await seedNyctFeed();
    await seedRoute(feed, "A", "A", "0039A6");
    await seedPlatform(feed, "A41N", ["A"]);
    const t0 = nowSec();
    respondWith(`${ORIGIN}/${feed}-ace`, () => ({
      status: 200,
      body: encodeTrips(t0, [{ routeId: "A", stops: [["A41N", t0 + 1200]] }]),
    }));

    const body = await composeWarm(
      adapterMap([feed, "nyct"]),
      params({ refs: refs(feed, "A41N"), origin: ORIGIN_650M }),
    );

    const w = body.w?.[`${feed}:A41N`];
    expect(w?.src).toBe("heuristic");
    // ~650 m ≡ ~650 s + 90 s rail buffer.
    expect(w?.s).toBeGreaterThanOrEqual(735);
    expect(w?.s).toBeLessThanOrEqual(745);
    expect(body.d[0].l).toHaveLength(1);
  });

  it("skips the heuristic for a stop row without coordinates while manual still applies", async () => {
    const feed = await seedNyctFeed();
    await seedRoute(feed, "A", "A", "0039A6");
    await seedPlatform(feed, "A41N", ["A"], null); // null lat/lon
    await seedPlatform(feed, "A41S", ["A"]);
    const t0 = nowSec();
    respondWith(`${ORIGIN}/${feed}-ace`, () => ({
      status: 200,
      body: encodeTrips(t0, [{ routeId: "A", stops: [["A41N", t0 + 600], ["A41S", t0 + 600]] }]),
    }));

    const body = await composeWarm(
      adapterMap([feed, "nyct"]),
      params({
        refs: refs(feed, "A41N", "A41S"),
        origin: ORIGIN_650M,
        walkSeconds: new Map([[`${feed}:A41N`, 300]]),
      }),
    );

    // A41N: no coords, but manual wins anyway. A41S: heuristic from origin.
    expect(body.w?.[`${feed}:A41N`]).toEqual({ s: 390, src: "manual" });
    expect(body.w?.[`${feed}:A41S`]?.src).toBe("heuristic");
  });

  it("stays under 500 bytes for the representative favorites payload", async () => {
    const feed = await seedNyctFeed();
    await seedRoute(feed, "A", "A", "0039A6", "FFFFFF");
    await seedRoute(feed, "C", "C", "0039A6", "FFFFFF");
    await seedPlatform(feed, "A41N", ["A", "C"]);
    await seedPlatform(feed, "A41S", ["A", "C"]);
    const t0 = nowSec();
    respondWith(`${ORIGIN}/${feed}-ace`, () => ({
      status: 200,
      body: encodeTrips(t0, [
        { routeId: "A", stops: [["A41N", t0 + 180], ["A41N", t0 + 660], ["A41N", t0 + 1080]] },
        { routeId: "C", stops: [["A41N", t0 + 300], ["A41N", t0 + 900], ["A41N", t0 + 1400]] },
        { routeId: "A", stops: [["A41S", t0 + 360], ["A41S", t0 + 840], ["A41S", t0 + 1260]] },
        { routeId: "C", stops: [["A41S", t0 + 240], ["A41S", t0 + 700], ["A41S", t0 + 1300]] },
      ]),
    }));

    const body = await composeWarm(
      adapterMap([feed, "nyct"]),
      params({
        refs: refs(feed, "A41N", "A41S"),
        walkSeconds: new Map([
          [`${feed}:A41N`, 420],
          [`${feed}:A41S`, 420],
        ]),
      }),
    );

    const bytes = new TextEncoder().encode(JSON.stringify(body)).length;
    expect(bytes).toBeLessThan(500);
  });

  it("marks partial with the fresh min stamp when one group is cold, null when all are", async () => {
    const feed = await seedNyctFeed();
    await seedRoute(feed, "A", "A", "0039A6");
    await seedRoute(feed, "G", "G", "6CBE45");
    await seedPlatform(feed, "A41N", ["A"]);
    await seedPlatform(feed, "G22N", ["G"]);
    const t0 = nowSec();
    respondWith(`${ORIGIN}/${feed}-ace`, () => ({
      status: 200,
      body: encodeTrips(t0, [{ routeId: "A", stops: [["A41N", t0 + 300]] }]),
    }));
    respondWith(`${ORIGIN}/${feed}-g`, () => ({ status: 500, body: "" }));

    const body = await composeWarm(
      adapterMap([feed, "nyct"]),
      params({ refs: refs(feed, "A41N", "G22N") }),
    );

    expect(body.partial).toBe(true);
    expect(body.fetched_at).toBeGreaterThanOrEqual(t0); // fresh group's stamp survives
    expect(body.d.find((e) => e.s === `${feed}:G22N`)?.m).toEqual([]);

    const allCold = await composeDepartures(
      env,
      adapterMap([feed, "nyct"]),
      params({ refs: refs(feed, "G22N") }),
    );
    expect(allCold.fetched_at === null || allCold.partial === true).toBe(true);
  });

  it("composes two feeds in one request with per-feed group fanout", async () => {
    const rail = await seedNyctFeed();
    const bus = await seedGtfsRtFeed();
    await seedRoute(rail, "A", "A", "0039A6");
    await seedRoute(bus, "B62", "B62", null, null, 3);
    await seedPlatform(rail, "A41N", ["A"]);
    await seedPlatform(bus, "305231", ["B62"]);
    const t0 = nowSec();
    respondWith(`${ORIGIN}/${rail}-ace`, () => ({
      status: 200,
      body: encodeTrips(t0, [{ routeId: "A", stops: [["A41N", t0 + 300]] }]),
    }));
    respondWith(`${ORIGIN}/${bus}`, () => ({
      status: 200,
      body: encodeTrips(t0, [{ routeId: "B62", stops: [["305231", t0 + 480]] }]),
    }));

    const body = await composeWarm(
      adapterMap([rail, "nyct"], [bus, "gtfs_rt"]),
      params({
        refs: [...refs(rail, "A41N"), ...refs(bus, "305231")],
        walkSeconds: new Map([
          [`${rail}:A41N`, 300],
          [`${bus}:305231`, 300],
        ]),
      }),
    );

    expect(body.d.map((e) => e.s)).toEqual([`${rail}:A41N`, `${bus}:305231`]);
    // Every s is namespaced and joins to its w key (golden two-feed assertion).
    for (const entry of body.d) {
      expect(entry.s).toContain(":");
      expect(body.w?.[entry.s]).toBeDefined();
    }
    // Rail gets the 90 s entry buffer; bus does not.
    expect(body.w?.[`${rail}:A41N`]).toEqual({ s: 390, src: "manual" });
    expect(body.w?.[`${bus}:305231`]).toEqual({ s: 300, src: "manual" });
    // Colorless bus route falls back to the palette with a real text color.
    const busEntry = body.d[1];
    expect(busEntry.c).toMatch(/^[0-9A-F]{6}$/);
    expect(["000000", "FFFFFF"]).toContain(busEntry.t);
  });

  it("drops realtime arrivals for routes absent from static data with the request intact", async () => {
    const feed = await seedNyctFeed();
    await seedRoute(feed, "A", "A", "0039A6");
    await seedPlatform(feed, "A41N", ["A"]);
    const t0 = nowSec();
    respondWith(`${ORIGIN}/${feed}-ace`, () => ({
      status: 200,
      body: encodeTrips(t0, [
        { routeId: "A", stops: [["A41N", t0 + 300]] },
        { routeId: "H", stops: [["A41N", t0 + 200]] }, // realtime-only route
      ]),
    }));

    const body = await composeWarm(adapterMap([feed, "nyct"]), params({ refs: refs(feed, "A41N") }));

    expect(body.d).toHaveLength(1);
    expect(body.d[0].r).toBe("A");
    expect(body.d[0].m).toHaveLength(1);
    // t0+300 arrival: 4 or 5 depending on elapsed warm-up time.
    expect(body.d[0].m[0]).toBeGreaterThanOrEqual(4);
    expect(body.d[0].m[0]).toBeLessThanOrEqual(5);
  });
});

// ---------- route surface (through the real worker: allowlist + rate limit) ----------

let ipSerial = 0;

function get(path: string, ip?: string): Promise<Response> {
  return SELF.fetch(`https://worker.example${path}`, {
    headers: { "CF-Connecting-IP": ip ?? `10.9.${++ipSerial}.1` },
  });
}

describe("/v1/departures route", () => {
  beforeEach(async () => {
    // Curated ids come from wrangler vars (mta-subway, citibike); seed their rows.
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
  });

  it("rejects a request without stops", async () => {
    const res = await get("/v1/departures");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("stops");
  });

  it("rejects malformed refs, naming the offender", async () => {
    for (const bad of ["A41N", "mta-subway%3A", "%3AA41N"]) {
      const res = await get(`/v1/departures?stops=${bad}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("malformed stop ref");
    }
  });

  it("rejects non-curated feeds and gbfs feeds (bike favorites are /v1/nearby territory)", async () => {
    const bogus = await get("/v1/departures?stops=bogus:A41N");
    expect(bogus.status).toBe(400);
    expect(((await bogus.json()) as { error: string }).error).toBe("unknown feed: bogus");

    const bike = await get("/v1/departures?stops=citibike:305231");
    expect(bike.status).toBe(400);
    expect(((await bike.json()) as { error: string }).error).toBe("unknown feed: citibike");
  });

  it("bounds n at 1..8 and defaults to 3", async () => {
    for (const bad of ["0", "9", "abc", "2.5"]) {
      const res = await get(`/v1/departures?stops=mta-subway:X1&n=${bad}`);
      expect(res.status).toBe(400);
    }
    // Valid bounds pass validation (unknown stop id → clean 200, no DO consulted).
    for (const ok of ["1", "8", ""]) {
      const res = await get(`/v1/departures?stops=mta-subway:X1&n=${ok}`);
      expect(res.status).toBe(200);
    }
  });

  it("rejects malformed walk triplets and walk refs not present in stops", async () => {
    for (const bad of ["mta-subway:X1:abc", "mta-subway:X1:-1", "mta-subway:X1:7201", "600"]) {
      const res = await get(`/v1/departures?stops=mta-subway:X1&walk=${bad}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("walk");
    }
    const stray = await get("/v1/departures?stops=mta-subway:X1&walk=mta-subway:X2:300");
    expect(stray.status).toBe(400);
    expect(((await stray.json()) as { error: string }).error).toBe(
      "walk ref not in stops: mta-subway:X2",
    );
  });

  it("requires a complete gated origin: lat+lon+acc together, in range", async () => {
    for (const bad of [
      "lat=40.69",
      "lat=40.69&lon=-73.98",
      "lat=91&lon=-73.98&acc=30",
      "lat=40.69&lon=-181&acc=30",
      "lat=40.69&lon=-73.98&acc=0",
      "lat=40.69&lon=-73.98&acc=abc",
      "lon=-73.98&acc=30",
    ]) {
      const res = await get(`/v1/departures?stops=mta-subway:X1&${bad}`);
      expect(res.status).toBe(400);
    }
    const ok = await get("/v1/departures?stops=mta-subway:X1&lat=40.69&lon=-73.98&acc=30");
    expect(ok.status).toBe(200);
  });

  it("caps stop refs at 20", async () => {
    const make = (count: number) =>
      Array.from({ length: count }, (_, i) => `mta-subway:X${i}`).join(",");
    expect((await get(`/v1/departures?stops=${make(21)}`)).status).toBe(400);
    expect((await get(`/v1/departures?stops=${make(20)}`)).status).toBe(200);
  });

  it("serves only GET", async () => {
    const res = await SELF.fetch("https://worker.example/v1/departures?stops=mta-subway:X1", {
      method: "POST",
      headers: { "CF-Connecting-IP": "10.8.0.1" },
    });
    expect(res.status).toBe(404);
  });

  it("shares the standard rate bucket, not the tighter locate bucket", async () => {
    const ip = "10.7.0.1";
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await get("/v1/departures?stops=mta-subway:X1", ip)).status);
    }
    // Locate bucket would 429 from request 11; the standard bucket allows 20.
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("returns the full contract end to end: entries, walk overlay, staleness stamp", async () => {
    await seedRoute("mta-subway", "A", "A", "0039A6", "FFFFFF");
    await seedPlatform("mta-subway", "A41N", ["A"]);
    const t0 = nowSec();
    respondWith(`${ORIGIN}/mta-ace`, () => ({
      status: 200,
      body: encodeTrips(t0, [{ routeId: "A", stops: [["A41N", t0 + 600]] }]),
    }));

    const cold = await get("/v1/departures?stops=mta-subway:A41N&walk=mta-subway:A41N:120");
    expect(cold.status).toBe(200); // never blocks on upstream — cold read arms the poller
    await new Promise((r) => setTimeout(r, 150));

    const warm = await get("/v1/departures?stops=mta-subway:A41N&walk=mta-subway:A41N:120");
    const body = (await warm.json()) as {
      fetched_at: number | null;
      d: { s: string; r: string; m: number[]; l?: number[] }[];
      w?: Record<string, { s: number; src: string }>;
    };
    expect(body.fetched_at).toBeGreaterThanOrEqual(t0);
    expect(body.d[0].s).toBe("mta-subway:A41N");
    expect(body.d[0].m).toHaveLength(1);
    expect(body.d[0].l).toHaveLength(1);
    expect(body.w).toEqual({ "mta-subway:A41N": { s: 210, src: "manual" } });
  });
});
