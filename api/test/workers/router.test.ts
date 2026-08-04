import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { transit_realtime } from "../../src/gen/gtfs-realtime.js";

const ORIGIN = "https://rt.example";
const realFetch = globalThis.fetch;
let upstreamCalls = 0;

function feedBody(): Uint8Array {
  const now = Math.floor(Date.now() / 1000);
  return transit_realtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: "2.0", timestamp: now },
    entity: [
      {
        id: "t0",
        tripUpdate: {
          trip: { tripId: "trip0", routeId: "A" },
          stopTimeUpdate: [{ stopId: "A32N", departure: { time: now + 300 } }],
        },
      },
    ],
  } as transit_realtime.IFeedMessage).finish();
}

beforeEach(async () => {
  upstreamCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(ORIGIN)) throw new Error(`unmocked outbound fetch: ${url}`);
    upstreamCalls++;
    return new Response(feedBody().slice().buffer as BodyInit, { status: 200 });
  }) as typeof fetch;

  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS feeds (id TEXT PRIMARY KEY NOT NULL, rt_trip_url TEXT, adapter TEXT, rt_needs_key INTEGER)",
  ).run();
  await env.DB.prepare(
    "INSERT OR REPLACE INTO feeds (id, rt_trip_url, adapter) VALUES ('mta-subway', ?, 'nyct')",
  )
    .bind(`${ORIGIN}/gtfs`)
    .run();
  // A real-looking crowd-sourced catalog row that must stay unreachable.
  await env.DB.prepare(
    "INSERT OR REPLACE INTO feeds (id, rt_trip_url, adapter) VALUES ('mdb-999', 'https://evil.example/feed', 'nyct')",
  ).run();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function get(path: string, ip = "203.0.113.1") {
  return SELF.fetch(`https://api.example${path}`, {
    headers: { "CF-Connecting-IP": ip },
  });
}

describe("router", () => {
  it("valid route reaches the DO and returns its response shape", async () => {
    const res = await get("/internal/mta-subway/ace/stop/A32N");
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body).toHaveProperty("fetched_at");
    expect(body.group).toBe("ace");
    expect(Array.isArray(body.arrivals)).toBe(true);
    // Let the armed waitUntil refresh consume its fetch inside THIS test,
    // so its upstream call can't bleed into the next test's counter.
    await new Promise((r) => setTimeout(r, 100));
  });

  it("unknown feed and unknown group 404 without touching a DO or upstream", async () => {
    const feed = await get("/internal/nope/ace/stop/A32N");
    expect(feed.status).toBe(404);
    const group = await get("/internal/mta-subway/zzz/stop/A32N");
    expect(group.status).toBe(404);
    expect(upstreamCalls).toBe(0);
  });

  it("a catalog (non-curated) feed_id is rejected even though its row exists", async () => {
    const res = await get("/internal/mdb-999/ace/stop/A32N");
    expect(res.status).toBe(404);
    expect((await res.json<any>()).error).toMatch(/unknown feed/);
    expect(upstreamCalls).toBe(0); // the evil URL is never fetched
  });

  it("requests over the per-IP limit get 429; other IPs unaffected", async () => {
    const ip = "198.51.100.7";
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) {
      statuses.push((await get("/internal/mta-subway/zzz/stop/X", ip)).status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(0, 20).every((s) => s === 404)).toBe(true); // burst allowed
    const other = await get("/internal/mta-subway/zzz/stop/X", "198.51.100.8");
    expect(other.status).toBe(404); // not 429
  });

  it("same feed+group on two requests resolves to the same DO instance", async () => {
    const first = await get("/internal/mta-subway/l/stop/L01N");
    expect((await first.json<any>()).fetched_at).toBeNull(); // first-ever read
    // Give the waitUntil refresh a moment to complete inside the same isolate.
    await new Promise((r) => setTimeout(r, 100));
    const second = await get("/internal/mta-subway/l/stop/L01N");
    const body = await second.json<any>();
    expect(body.fetched_at).toBeGreaterThan(0); // shared state -> same DO
    expect(upstreamCalls).toBe(1); // and only one upstream fetch (R1 via routing)
  });

  it("non-matching paths 404", async () => {
    // `GET /` deliberately dropped from this test (U9). In production the
    // config-UI PWA now ships from this Worker's `assets` directory, so `/`
    // is the SPA shell, not a 404 — asserting 404 here would encode a
    // contract that is false at the edge. It cannot simply be flipped to 200
    // either: `SELF.fetch()` in the workerd pool bypasses the static-asset
    // router entirely and always lands on the user Worker, so every asset
    // path 404s in here regardless of config. The real assertions run against
    // `wrangler dev` in test/unit/asset-routing.test.ts.
    expect((await get("/internal/mta-subway/ace")).status).toBe(404);
  });

  it("malformed percent-encoding returns JSON 404, not a 500", async () => {
    const res = await get("/internal/mta-subway/ace/stop/%zz");
    expect(res.status).toBe(404);
    expect((await res.json<any>()).error).toBe("not found");
    expect(upstreamCalls).toBe(0);
  });
});

describe("the /v1/auth/* bucket", () => {
  // Deliberately identity-and-isolation assertions, not refill timing: this
  // repo has been broken twice by tests racing a token-bucket refill window.
  // At 0.2 tokens/sec a whole suite could run inside one refill tick, so
  // nothing here depends on how long the loop below takes.
  const authGet = (ip: string) =>
    SELF.fetch("https://api.example/v1/auth/mode", { headers: { "CF-Connecting-IP": ip } });

  it("routes /v1/auth/* through the Worker at all", async () => {
    const res = await authGet("198.51.100.201");
    expect(res.status).toBe(200);
    expect(await res.json<any>()).toHaveProperty("auth_mode");
  });

  it("429s past the burst, on its own bucket, per IP", async () => {
    const ip = "198.51.100.202";
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) statuses.push((await authGet(ip)).status);
    // Capacity is 10; refill can only ever *add* tokens, so "the first ten are
    // served" and "something in twenty is refused" both hold however slow the
    // machine is.
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);

    // Same IP, different prefix: separate bucket map, so the auth burst has
    // not spent the general limiter (and vice versa).
    expect((await get("/internal/mta-subway/zzz/stop/X", ip)).status).toBe(404);
    // A different IP is untouched — the bucket is keyed, not global.
    expect((await authGet("198.51.100.203")).status).toBe(200);
  });
});

describe("the pairing bucket (U5)", () => {
  // A poll with no bearer credential is refused before any storage is touched,
  // which makes it the cheapest possible probe for "did this path reach the
  // pairing route at all" — a 404 here would mean the prefix fell through to
  // the internal-route matcher.
  const poll = (ip: string) =>
    SELF.fetch("https://api.example/v1/device/pair/poll", {
      method: "POST",
      headers: { "CF-Connecting-IP": ip },
    });

  it("routes both pairing prefixes through the Worker", async () => {
    const res = await poll("198.51.100.211");
    expect(res.status).toBe(400);
    expect((await res.json<any>()).error).toBe("invalid_request");

    // The browser half is a different prefix and must land on the same route.
    const claim = await SELF.fetch("https://api.example/v1/pair/claim", {
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.211" },
    });
    expect(claim.status).toBe(401); // reached the route, refused for want of a session
  });

  it("has its own bucket, sized for a 5-second poll loop", async () => {
    const ip = "198.51.100.212";
    const statuses: number[] = [];
    for (let i = 0; i < 15; i++) statuses.push((await poll(ip)).status);
    // Capacity is 15 — the whole point of not sharing the auth bucket, whose
    // 10-token burst at 0.2/sec would strangle a device polling as instructed.
    expect(statuses.every((s) => s === 400)).toBe(true);

    // Spent here, untouched elsewhere: the auth bucket is a separate map.
    expect(
      (await SELF.fetch("https://api.example/v1/auth/mode", { headers: { "CF-Connecting-IP": ip } }))
        .status,
    ).toBe(200);
  });
});

describe("the config surface (U10)", () => {
  // A list read with no cookie is refused before any storage is touched, which
  // makes it the cheapest probe for "did this path reach routeConfig at all".
  // A 404 with `{"error":"not found"}` here would mean the prefix fell through
  // to the internal-route matcher; an HTML 200 would mean the asset router
  // answered it with the SPA shell.
  const devices = (ip: string) =>
    SELF.fetch("https://api.example/v1/config/devices", { headers: { "CF-Connecting-IP": ip } });

  it("routes /v1/config/* through the Worker", async () => {
    const res = await devices("198.51.100.221");
    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json<any>()).toEqual({ error: "unauthorized" });
  });

  it("answers an unknown config path with the route's JSON 404", async () => {
    const res = await SELF.fetch("https://api.example/v1/config", {
      headers: { "CF-Connecting-IP": "198.51.100.222" },
    });
    expect(res.status).toBe(404);
    expect(await res.json<any>()).toEqual({ error: "not found" });
  });

  it("shares the standard bucket rather than the auth one", async () => {
    const ip = "198.51.100.223";
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) statuses.push((await devices(ip)).status);
    // Capacity is 20: a session-only, low-frequency surface has no reason to
    // sit in the sign-in bucket, where a burst of 10 is the whole allowance.
    expect(statuses.every((s) => s === 401)).toBe(true);
    expect((await devices(ip)).status).toBe(429);
  });
});

describe("rateLimited refill math", () => {
  it("refills tokens over time at the configured rate", async () => {
    const { rateLimited } = await import("../../src/index");
    const ip = "192.0.2.99";
    const t0 = 1_000_000;
    for (let i = 0; i < 20; i++) {
      expect(rateLimited(ip, t0)).toBe(false); // burst capacity
    }
    expect(rateLimited(ip, t0)).toBe(true); // depleted
    expect(rateLimited(ip, t0 + 1000)).toBe(false); // 1s -> 5 tokens back
    expect(rateLimited(ip, t0 + 1000)).toBe(false);
    expect(rateLimited(ip, t0 + 1000)).toBe(false);
    expect(rateLimited(ip, t0 + 1000)).toBe(false);
    expect(rateLimited(ip, t0 + 1000)).toBe(false);
    expect(rateLimited(ip, t0 + 1000)).toBe(true); // sixth within the second fails
  });
});

describe("curated allowlist from wrangler vars", () => {
  it("reads CURATED_FEEDS vars, not a code constant", async () => {
    const { curatedFeeds } = await import("../../src/index");
    const set = curatedFeeds(env);
    expect(set.has("mta-subway")).toBe(true);
    expect(set.has("citibike")).toBe(true); // present in vars only — never in the old constant
    expect(set.has("not-curated")).toBe(false);
  });
});
