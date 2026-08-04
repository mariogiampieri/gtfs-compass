import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Credential, DEVICE_TOKEN_PREFIX, hashToken, parseScopes } from "../../src/auth";
import { haversineM, resolveFromWifi, resolveLocation } from "../../src/locate";
import { resetSchema } from "./schema";

const BEACON_URL = "https://api.beacondb.net/v1/geolocate";
const TOKEN = "test-diag-token"; // bound in vitest.config.ts miniflare bindings

// Tests and the worker under SELF share one workerd isolate, so a global-fetch
// stub is the outbound seam (same convention as feed_do/router tests). Any
// unexpected outbound fetch throws.
type BeaconHandler = (init: RequestInit) => Response | Promise<Response>;
const realFetch = globalThis.fetch;
let beaconHandler: BeaconHandler | null = null;
let beaconCalls = 0;
let lastBeaconInit: RequestInit | null = null;

function beaconOk(lat: number, lon: number, accuracy: number) {
  beaconHandler = () => Response.json({ location: { lat, lng: lon }, accuracy });
}

function beaconNotFound() {
  beaconHandler = () =>
    Response.json({ error: { errors: [{ reason: "notFound" }], code: 404 } }, { status: 404 });
}

// The locate cache is keyed by the BSSID set and lives for the whole isolate,
// so every test uses a fresh MAC set unless it is deliberately testing a hit.
let macSeq = 0;
function uniqueAps(n = 2): { macAddress: string; signalStrength: number }[] {
  macSeq++;
  const tag = macSeq.toString(16).padStart(2, "0");
  return Array.from({ length: n }, (_, i) => ({
    macAddress: `aa:bb:${tag}:00:00:0${i}`,
    signalStrength: -50 - i,
  }));
}

// The /v1/locate* bucket allows a burst of 10 per IP; hand each request its
// own IP so tests never trip the limiter unless they mean to.
let ipSeq = 0;
function freshIp(): string {
  ipSeq++;
  return `198.18.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
}

function post(
  path: string,
  body: unknown,
  opts: { ip?: string; token?: string | null; query?: string } = {},
) {
  return SELF.fetch(`https://api.example${path}${opts.query ?? ""}`, {
    method: "POST",
    headers: {
      "CF-Connecting-IP": opts.ip ?? freshIp(),
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function get(path: string, opts: { ip?: string; token?: string | null } = {}) {
  return SELF.fetch(`https://api.example${path}`, {
    headers: {
      "CF-Connecting-IP": opts.ip ?? freshIp(),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
  });
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

async function logRows(deviceId: string) {
  const res = await env.DB.prepare("SELECT * FROM locate_log WHERE device_id = ?1 ORDER BY id")
    .bind(deviceId)
    .all<Record<string, unknown>>();
  return res.results;
}

beforeEach(async () => {
  beaconHandler = null;
  beaconCalls = 0;
  lastBeaconInit = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== BEACON_URL) throw new Error(`unmocked outbound fetch: ${url}`);
    beaconCalls++;
    lastBeaconInit = init ?? {};
    if (!beaconHandler) throw new Error("no beacondb mock configured");
    return beaconHandler(init ?? {});
  }) as typeof fetch;

  await resetSchema();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("provider chain", () => {
  it("BeaconDB 200 within the gate passes through with the provider name", async () => {
    beaconOk(40.6931, -73.9871, 42);
    const result = await resolveLocation({ bssids: uniqueAps(), env });
    expect(result).toEqual({
      known: true,
      lat: 40.6931,
      lon: -73.9871,
      accuracy: 42,
      provider: "beacondb",
    });
  });

  it("sends the mandatory headers and the ipf-suppressing body", async () => {
    beaconOk(40, -73, 30);
    await resolveFromWifi(
      [
        { macAddress: "AA:BB:CC:DD:EE:F0", signalStrength: -40 },
        { macAddress: "aa:bb:cc:dd:ee:f1", signalStrength: -60 },
      ],
      env,
    );
    expect(beaconCalls).toBe(1);
    const headers = new Headers(lastBeaconInit!.headers);
    expect(headers.get("user-agent")).toBe(
      "gtfs-compass/0.1 (+https://github.com/mariogiampieri/gtfs-compass)",
    );
    expect(headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(String(lastBeaconInit!.body));
    expect(body.considerIp).toBe(false);
    expect(body.fallbacks).toEqual({ ipf: false });
    expect(body.wifiAccessPoints).toEqual([
      { macAddress: "aa:bb:cc:dd:ee:f0", signalStrength: -40 },
      { macAddress: "aa:bb:cc:dd:ee:f1", signalStrength: -60 },
    ]);
  });

  it("accuracy beyond the default 500 m gate is never passed through", async () => {
    beaconOk(40, -73, 25_000); // cell/IP-grade fix
    expect(await resolveLocation({ bssids: uniqueAps(), env })).toEqual({ known: false });
  });

  it("respects a LOCATE_MAX_ACCURACY_M env override", async () => {
    beaconOk(40, -73, 300);
    const tight = await resolveLocation({
      bssids: uniqueAps(),
      env: { ...env, LOCATE_MAX_ACCURACY_M: "100" } as Env,
    });
    expect(tight).toEqual({ known: false });

    beaconOk(40, -73, 300);
    const loose = await resolveLocation({ bssids: uniqueAps(), env }); // default 500
    expect(loose).toMatchObject({ known: true, accuracy: 300 });
  });

  it("404 notFound → {known:false}", async () => {
    beaconNotFound();
    expect(await resolveLocation({ bssids: uniqueAps(), env })).toEqual({ known: false });
  });

  it("non-200 → {known:false}", async () => {
    beaconHandler = () => new Response("upstream sad", { status: 500 });
    expect(await resolveLocation({ bssids: uniqueAps(), env })).toEqual({ known: false });
  });

  it("a fallback-marked body is treated as unknown, never a position", async () => {
    beaconHandler = () =>
      Response.json({ location: { lat: 40, lng: -73 }, accuracy: 50, fallback: "ipf" });
    expect(await resolveLocation({ bssids: uniqueAps(), env })).toEqual({ known: false });
  });

  it("network error → {known:false}, never a throw to the caller", async () => {
    beaconHandler = () => {
      throw new TypeError("connection refused");
    };
    await expect(resolveLocation({ bssids: uniqueAps(), env })).resolves.toEqual({ known: false });
  });

  it("a hung provider is aborted at LOCATE_TIMEOUT_MS and the caller unblocked", async () => {
    beaconHandler = (init) =>
      new Promise<Response>((_, reject) => {
        // Resolve only via the abort signal — the provider never answers.
        init.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason ?? new Error("aborted")),
        );
      });
    const t0 = Date.now();
    const result = await resolveLocation({
      bssids: uniqueAps(),
      env: { ...env, LOCATE_TIMEOUT_MS: "50" } as Env,
    });
    expect(result).toEqual({ known: false });
    expect(Date.now() - t0).toBeLessThan(1500); // unblocked well inside the device budget
  });

  it("empty/malformed BSSID list resolves {known:false} without a provider call", async () => {
    expect(await resolveLocation({ bssids: [], env })).toEqual({ known: false });
    expect(await resolveLocation({ bssids: [{ notAMac: true }], env })).toEqual({ known: false });
    expect(beaconCalls).toBe(0);
    // The short circuit lives in the WiFi sub-chain, not in the chain: a board
    // that skipped its radio scan still has a phone provider above this.
    expect(await resolveFromWifi([], env)).toBeNull();
    expect(beaconCalls).toBe(0);
  });
});

describe("locate cache", () => {
  it("identical set reordered and re-cased hits; a different set misses", async () => {
    const spy = vi.spyOn(console, "log");
    const aps = uniqueAps(3);
    beaconOk(40.1, -73.1, 60);

    const first = await resolveFromWifi(aps, env);
    expect(first).toMatchObject({ lat: 40.1, accuracy: 60, provider: "beacondb" });
    expect(beaconCalls).toBe(1);
    expect(spy.mock.calls.flat()).toContain("[locate-cache] miss");

    const reordered = [...aps]
      .reverse()
      .map((ap) => ({ ...ap, macAddress: ap.macAddress.toUpperCase() }));
    const second = await resolveFromWifi(reordered, env);
    expect(second).toEqual(first);
    expect(beaconCalls).toBe(1); // served from cache, no second provider call
    expect(spy.mock.calls.flat()).toContain("[locate-cache] hit");

    beaconOk(41.2, -72.2, 70);
    const other = await resolveFromWifi(uniqueAps(3), env);
    expect(other).toMatchObject({ lat: 41.2 });
    expect(beaconCalls).toBe(2); // different set → miss → fresh lookup
    expect(spy.mock.calls.flat().filter((m) => m === "[locate-cache] miss")).toHaveLength(2);
  });
});

describe("POST /v1/locate", () => {
  it("resolves and returns the known:true shape end-to-end", async () => {
    beaconOk(40.6931, -73.9871, 42);
    const res = await post("/v1/locate", { wifiAccessPoints: uniqueAps() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      known: true,
      lat: 40.6931,
      lon: -73.9871,
      accuracy: 42,
      provider: "beacondb",
    });
  });

  it("missing or non-array wifiAccessPoints → 400", async () => {
    const missing = await post("/v1/locate", { device_id: "d1" });
    expect(missing.status).toBe(400);
    const nonArray = await post("/v1/locate", { wifiAccessPoints: "aa:bb" });
    expect(nonArray.status).toBe(400);
    expect(beaconCalls).toBe(0);
  });

  it("more than 50 entries → 400 before any provider call", async () => {
    const aps = Array.from({ length: 51 }, (_, i) => ({
      macAddress: `0e:00:00:00:${Math.floor(i / 10)}${i % 10}:00`,
    }));
    const res = await post("/v1/locate", { wifiAccessPoints: aps });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toMatch(/capped at 50/);
    expect(beaconCalls).toBe(0);
  });

  it("log:true without the Bearer token → 401 and no row", async () => {
    beaconOk(40, -73, 30);
    const res = await post("/v1/locate", {
      wifiAccessPoints: uniqueAps(),
      device_id: "dev-noauth",
      log: true,
    });
    expect(res.status).toBe(401);
    expect(await logRows("dev-noauth")).toHaveLength(0);
    expect(beaconCalls).toBe(0); // rejected before touching the provider
  });

  it("token in a query param is rejected — header only", async () => {
    const res = await post(
      "/v1/locate",
      { wifiAccessPoints: uniqueAps(), device_id: "dev-qp", log: true },
      { query: `?token=${TOKEN}&diag_token=${TOKEN}` },
    );
    expect(res.status).toBe(401);
    expect(await logRows("dev-qp")).toHaveLength(0);
  });

  it("log:true with the token but no device_id → 400", async () => {
    const res = await post(
      "/v1/locate",
      { wifiAccessPoints: uniqueAps(), log: true },
      { token: TOKEN },
    );
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toMatch(/device_id/);
  });

  it("log:true writes a row with est fields, provider, bssid_count, label", async () => {
    beaconOk(40.6931, -73.9871, 42);
    const res = await post(
      "/v1/locate",
      { wifiAccessPoints: uniqueAps(3), device_id: "dev-log", log: true, label: "home" },
      { token: TOKEN },
    );
    expect(res.status).toBe(200);
    const rows = await logRows("dev-log");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: null,
      device_id: "dev-log",
      est_lat: 40.6931,
      est_lon: -73.9871,
      est_accuracy: 42,
      provider: "beacondb",
      bssid_count: 3,
      ref_lat: null,
      delta_m: null,
      label: "home",
    });
    expect(rows[0].ts).toBeGreaterThan(nowSec() - 5);
  });

  it("log:true on an unresolved locate stores nulls and provider 'none'", async () => {
    beaconNotFound();
    const res = await post(
      "/v1/locate",
      { wifiAccessPoints: uniqueAps(), device_id: "dev-none", log: true },
      { token: TOKEN },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ known: false });
    const rows = await logRows("dev-none");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      est_lat: null,
      est_lon: null,
      est_accuracy: null,
      provider: "none",
      bssid_count: 2,
    });
  });

  it("per-device daily cap → 429 once exceeded", async () => {
    await env.DB.prepare(
      `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 500)
       INSERT INTO locate_log (device_id, ts) SELECT ?1, ?2 FROM c`,
    )
      .bind("dev-cap", nowSec())
      .run();
    const res = await post(
      "/v1/locate",
      { wifiAccessPoints: uniqueAps(), device_id: "dev-cap", log: true },
      { token: TOKEN },
    );
    expect(res.status).toBe(429);
    expect((await res.json<{ error: string }>()).error).toMatch(/daily log cap/);
    expect(await logRows("dev-cap")).toHaveLength(500); // no 501st row
  });

  it("unknown /v1/locate subpaths and wrong methods 404", async () => {
    expect((await get("/v1/locate")).status).toBe(404); // GET on the POST surface
    expect((await post("/v1/locate/nope", {})).status).toBe(404);
  });
});

describe("POST /v1/locate/ref", () => {
  it("pairs the newest unpaired estimate and computes delta_m", async () => {
    // Estimate at (40.0000, -73.9500); reference 0.001° north on the same
    // meridian — a known ~111.2 m separation.
    beaconOk(40.0, -73.95, 30);
    await post(
      "/v1/locate",
      { wifiAccessPoints: uniqueAps(), device_id: "dev-ref", log: true },
      { token: TOKEN },
    );

    const res = await post(
      "/v1/locate/ref",
      { device_id: "dev-ref", lat: 40.001, lon: -73.95, accuracy: 5, label: "platform" },
      { token: TOKEN },
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ id: number; delta_m: number }>();
    expect(body.delta_m).toBeGreaterThan(110);
    expect(body.delta_m).toBeLessThan(113);

    const rows = await logRows("dev-ref");
    expect(rows[0]).toMatchObject({
      ref_lat: 40.001,
      ref_lon: -73.95,
      ref_accuracy: 5,
      label: "platform",
    });
    expect(rows[0].delta_m).toBeCloseTo(body.delta_m, 6);
  });

  it("requires the Bearer token", async () => {
    const res = await post("/v1/locate/ref", { device_id: "d", lat: 40, lon: -73 });
    expect(res.status).toBe(401);
  });

  it("no unpaired estimate → 404", async () => {
    const res = await post(
      "/v1/locate/ref",
      { device_id: "dev-none-yet", lat: 40, lon: -73 },
      { token: TOKEN },
    );
    expect(res.status).toBe(404);
  });

  it("an estimate older than 60 s cannot be paired", async () => {
    await env.DB.prepare(
      "INSERT INTO locate_log (device_id, ts, est_lat, est_lon, provider) VALUES (?1, ?2, 40, -73, 'beacondb')",
    )
      .bind("dev-stale", nowSec() - 120)
      .run();
    const res = await post(
      "/v1/locate/ref",
      { device_id: "dev-stale", lat: 40, lon: -73 },
      { token: TOKEN },
    );
    expect(res.status).toBe(404);
  });

  it("a second ref cannot double-pair the same estimate", async () => {
    beaconOk(40.0, -73.95, 30);
    await post(
      "/v1/locate",
      { wifiAccessPoints: uniqueAps(), device_id: "dev-double", log: true },
      { token: TOKEN },
    );
    const first = await post(
      "/v1/locate/ref",
      { device_id: "dev-double", lat: 40.001, lon: -73.95 },
      { token: TOKEN },
    );
    expect(first.status).toBe(200);
    const second = await post(
      "/v1/locate/ref",
      { device_id: "dev-double", lat: 40.002, lon: -73.95 },
      { token: TOKEN },
    );
    expect(second.status).toBe(404); // ref_lat is set → no longer unpaired
    const rows = await logRows("dev-double");
    expect(rows[0].ref_lat).toBe(40.001); // first pairing untouched
  });
});

describe("GET /v1/locate/log", () => {
  it("requires the Bearer token", async () => {
    expect((await get("/v1/locate/log?device_id=d")).status).toBe(401);
  });

  it("returns rows filtered by device_id and since, newest first", async () => {
    const now = nowSec();
    const seed = env.DB.prepare(
      "INSERT INTO locate_log (device_id, ts, provider, bssid_count) VALUES (?1, ?2, 'beacondb', 4)",
    );
    await seed.bind("dev-a", now - 300).run();
    await seed.bind("dev-a", now - 10).run();
    await seed.bind("dev-b", now - 10).run();

    const all = await get("/v1/locate/log?device_id=dev-a", { token: TOKEN });
    expect(all.status).toBe(200);
    const allRows = (await all.json<{ rows: { ts: number; device_id: string }[] }>()).rows;
    expect(allRows).toHaveLength(2);
    expect(allRows.every((r) => r.device_id === "dev-a")).toBe(true);
    expect(allRows[0].ts).toBeGreaterThanOrEqual(allRows[1].ts);

    const since = await get(`/v1/locate/log?device_id=dev-a&since=${now - 60}`, { token: TOKEN });
    expect((await since.json<{ rows: unknown[] }>()).rows).toHaveLength(1);
  });
});

describe("locate rate bucket", () => {
  it("burst 10 per IP then 429, without touching the debug route's limiter", async () => {
    const ip = "198.51.100.77";
    const statuses: number[] = [];
    for (let i = 0; i < 15; i++) {
      statuses.push((await post("/v1/locate", {}, { ip })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true); // burst allowed (empty body)
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);

    // Same IP, debug route: separate bucket map → not rate limited.
    const debug = await SELF.fetch("https://api.example/internal/nope/ace/stop/X", {
      headers: { "CF-Connecting-IP": ip },
    });
    expect(debug.status).toBe(404); // unknown feed, not 429
  });
});

describe("haversineM", () => {
  it("0.001° of latitude on a meridian is ~111.2 m", () => {
    expect(haversineM(40, -73.95, 40.001, -73.95)).toBeCloseTo(111.2, 0);
  });
});

describe("negative caching (transient vs definitive)", () => {
  it("does not cache a transient provider failure as {known:false}", async () => {
    const aps = uniqueAps();
    beaconHandler = () => new Response("", { status: 500 });
    expect(await resolveFromWifi(aps, env)).toBeNull();

    // Provider recovers: the SAME set must re-consult the chain immediately.
    const callsBefore = beaconCalls;
    beaconOk(40.6923, -73.9873, 40);
    const second = await resolveFromWifi(aps, env);
    expect(beaconCalls).toBe(callsBefore + 1);
    expect(second).toMatchObject({ lat: 40.6923 });
  });

  it("caches the authoritative notFound negative for the TTL", async () => {
    const aps = uniqueAps();
    beaconNotFound();
    expect(await resolveFromWifi(aps, env)).toBeNull();

    const callsBefore = beaconCalls;
    expect(await resolveFromWifi(aps, env)).toBeNull();
    expect(beaconCalls).toBe(callsBefore); // served from cache, no provider call
  });

  it("drops oversized macAddress strings during normalization", async () => {
    const aps = [{ macAddress: "aa".repeat(100) }, ...uniqueAps()];
    beaconOk(40.6923, -73.9873, 40);
    const result = await resolveFromWifi(aps, env);
    expect(result).toMatchObject({ lat: 40.6923 });
    const sent = JSON.parse(String(lastBeaconInit?.body)) as {
      wifiAccessPoints: unknown[];
    };
    expect(sent.wifiAccessPoints).toHaveLength(2); // junk entry never forwarded
  });
});

/* -------------------------------------------------------------------------- */
/* The phone provider (U8; R9, R12, R13, R15; AE6d, AE7, AE8, AE9)             */
/* -------------------------------------------------------------------------- */

/**
 * Devices are seeded with SQL here rather than driven through the pairing
 * routes. What is under test is the *chain's* behavior given a credential, and
 * half these cases need a shape pairing will not produce on demand — a board
 * whose grant was never given, a fix belonging to a second account, a stored
 * position with no accuracy at all. `config.test.ts` owns the end-to-end
 * pairing-and-revocation path and drives the real routes for it (AE6d).
 */
let deviceSeq = 0;

async function seedUser(userId: string): Promise<void> {
  await env.DB.prepare("INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?1, ?2, ?3)")
    .bind(userId, `${userId}@example.test`, nowSec())
    .run();
}

async function seedDevice(
  opts: { userId?: string; scopes?: string } = {},
): Promise<{ deviceId: string; token: string; credential: Credential }> {
  deviceSeq++;
  const userId = opts.userId ?? "usr_owner";
  await seedUser(userId);
  const deviceId = `dev_${deviceSeq}`;
  const token = `${DEVICE_TOKEN_PREFIX}test${deviceSeq}`;
  const scopes = opts.scopes ?? "read:departures,read:config,read:fix";
  await env.DB.prepare(
    `INSERT INTO devices (id, user_id, token_hash, name, paired_at, scopes)
     VALUES (?1, ?2, ?3, 'Board', ?4, ?5)`,
  )
    .bind(deviceId, userId, await hashToken(token), nowSec(), scopes)
    .run();
  return {
    deviceId,
    token,
    credential: { kind: "device", deviceId, userId, scopes: parseScopes(scopes) },
  };
}

/** `POST /v1/locate` as this board (or as nobody), parsed. */
async function locateJson(aps: unknown[], token?: string): Promise<Record<string, unknown>> {
  const res = await post("/v1/locate", { wifiAccessPoints: aps }, token ? { token } : {});
  expect(res.status).toBe(200);
  return res.json<Record<string, unknown>>();
}

/** The row a phone's fan-out would have written for this board. */
async function seedFix(
  deviceId: string,
  fix: { lat?: number; lon?: number; accuracyM?: number | null; ageS?: number } = {},
): Promise<{ lat: number; lon: number; capturedAt: number }> {
  const lat = fix.lat ?? 40.7052;
  const lon = fix.lon ?? -74.0136;
  const capturedAt = nowSec() - (fix.ageS ?? 20);
  await env.DB.prepare(
    `INSERT INTO device_fixes (device_id, lat, lon, accuracy_m, captured_at, received_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
  )
    .bind(deviceId, lat, lon, fix.accuracyM === undefined ? 12 : fix.accuracyM, capturedAt)
    .run();
  return { lat, lon, capturedAt };
}

describe("the phone provider", () => {
  it("a fresh accurate fix wins, carrying its provider, capture time and quality", async () => {
    const { deviceId, token } = await seedDevice();
    const posted = await seedFix(deviceId, { ageS: 20, accuracyM: 12 });

    const res = await post("/v1/locate", { wifiAccessPoints: uniqueAps() }, { token });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      known: true,
      lat: posted.lat,
      lon: posted.lon,
      accuracy: 12,
      provider: "phone",
      captured_at: posted.capturedAt,
      quality: "current",
    });
    // The chain stopped at the first accepted candidate — no upstream call.
    expect(beaconCalls).toBe(0);
  });

  it("AE7: a 900 m fix is skipped AND BeaconDB is consulted", async () => {
    const { deviceId, token } = await seedDevice();
    await seedFix(deviceId, { ageS: 10, accuracyM: 900 });
    beaconOk(40.6931, -73.9871, 42);

    const res = await post("/v1/locate", { wifiAccessPoints: uniqueAps() }, { token });

    // Not `{known:false}`: the gated fix falls *through*, it does not end the
    // chain. This is the assertion the pre-split control flow would fail.
    expect(await res.json()).toEqual({
      known: true,
      lat: 40.6931,
      lon: -73.9871,
      accuracy: 42,
      provider: "beacondb",
    });
    expect(beaconCalls).toBe(1);
  });

  it("a stored fix with no accuracy at all fails closed and falls through", async () => {
    const { deviceId, token } = await seedDevice();
    await seedFix(deviceId, { ageS: 10, accuracyM: null });
    beaconOk(40.6931, -73.9871, 42);

    const res = await post("/v1/locate", { wifiAccessPoints: uniqueAps() }, { token });

    expect(await res.json()).toMatchObject({ known: true, provider: "beacondb" });
  });

  it("the gate value comes from the same env var as every other provider", async () => {
    const { deviceId, credential } = await seedDevice();
    await seedFix(deviceId, { ageS: 10, accuracyM: 900 });

    // Default gate (500 m): rejected, and with no BSSIDs there is nothing below.
    expect(await resolveLocation({ bssids: [], env, credential })).toEqual({ known: false });

    // The one knob, widened: the same fix is now inside the gate.
    const loose = await resolveLocation({
      bssids: [],
      env: { ...env, LOCATE_MAX_ACCURACY_M: "1000" } as Env,
      credential,
    });
    expect(loose).toMatchObject({ known: true, accuracy: 900, provider: "phone" });
    expect(beaconCalls).toBe(0);
  });

  it("a zero-BSSID request still reaches the phone provider", async () => {
    // The board skipped its radio scan. The old short circuit answered
    // {known:false} here before any provider ran.
    const { deviceId, token } = await seedDevice();
    await seedFix(deviceId);

    const res = await post("/v1/locate", { wifiAccessPoints: [] }, { token });

    expect(await res.json()).toMatchObject({ known: true, provider: "phone" });
    expect(beaconCalls).toBe(0);
  });

  it("R13: a fix past the 120 s horizon yields to a live provider", async () => {
    const { deviceId, token } = await seedDevice();
    await seedFix(deviceId, { ageS: 400, accuracyM: 12 });
    beaconOk(40.6931, -73.9871, 42);

    const res = await post("/v1/locate", { wifiAccessPoints: uniqueAps() }, { token });

    expect(await res.json()).toEqual({
      known: true,
      lat: 40.6931,
      lon: -73.9871,
      accuracy: 42,
      provider: "beacondb",
    });
  });

  it("R13: ...and is last_known with its capture time when nothing fresher is", async () => {
    const { deviceId, token } = await seedDevice();
    const posted = await seedFix(deviceId, { ageS: 400, accuracyM: 12 });
    beaconNotFound();

    const res = await post("/v1/locate", { wifiAccessPoints: uniqueAps() }, { token });

    expect(await res.json()).toEqual({
      known: true,
      lat: posted.lat,
      lon: posted.lon,
      accuracy: 12,
      provider: "phone",
      captured_at: posted.capturedAt,
      quality: "last_known",
    });
    expect(beaconCalls).toBe(1); // the chain was run out before falling back
  });

  it("a device that was never granted read:fix never consults the relay", async () => {
    const { deviceId, token } = await seedDevice({ scopes: "read:departures,read:config" });
    await seedFix(deviceId, { ageS: 5, accuracyM: 5 });
    beaconOk(40.6931, -73.9871, 42);

    const res = await post("/v1/locate", { wifiAccessPoints: uniqueAps() }, { token });

    // A better fix sits in the table and is not read: the grant governs the
    // read, not just the fan-out (R9).
    expect(await res.json()).toMatchObject({ known: true, provider: "beacondb" });
  });

  it("a body-supplied device_id never selects a fix", async () => {
    const { deviceId } = await seedDevice();
    await seedFix(deviceId);
    beaconOk(40.6931, -73.9871, 42);

    // No credential; `device_id` is a diagnostic label anyone may send.
    const res = await post("/v1/locate", { wifiAccessPoints: uniqueAps(), device_id: deviceId });

    expect(await res.json()).toMatchObject({ known: true, provider: "beacondb" });
  });

  it("AE8: two boards seeing identical access points never share a phone position", async () => {
    const mine = await seedDevice({ userId: "usr_owner" });
    const neighbor = await seedDevice({ userId: "usr_neighbor" });
    const posted = await seedFix(mine.deviceId, { ageS: 10, accuracyM: 9 });
    const shared = uniqueAps(3); // one household, one set of access points
    beaconOk(40.6931, -73.9871, 42);

    const ours = await locateJson(shared, mine.token);
    const theirs = await locateJson(shared, neighbor.token);
    const anyone = await locateJson(shared);

    expect(ours).toMatchObject({ lat: posted.lat, provider: "phone" });
    // The neighbor's board and an anonymous caller get the WiFi answer for
    // those access points — never the position that belongs to one device.
    expect(theirs).toEqual({
      known: true,
      lat: 40.6931,
      lon: -73.9871,
      accuracy: 42,
      provider: "beacondb",
    });
    expect(anyone).toEqual(theirs);
    // And the shared BSSID-hash cache was never taught the phone's position:
    // one upstream call served all three (R15).
    expect(beaconCalls).toBe(1);
  });

  it("AE9: with no fix ever posted, the response is byte-identical to the contract", async () => {
    const { token } = await seedDevice(); // granted read:fix, and no phone has posted
    beaconOk(40.6931, -73.9871, 42);
    const SHIPPED = '{"known":true,"lat":40.6931,"lon":-73.9871,"accuracy":42,"provider":"beacondb"}';

    const granted = await post("/v1/locate", { wifiAccessPoints: uniqueAps() }, { token });
    const anonymous = await post("/v1/locate", { wifiAccessPoints: uniqueAps() });

    // Bytes, not shape: shipped firmware parses this and a new key is a wire
    // change. `captured_at`/`quality` appear only for a relayed fix.
    expect(await granted.text()).toBe(SHIPPED);
    expect(await anonymous.text()).toBe(SHIPPED);
  });

  it("AE9: an unresolvable chain is still exactly {\"known\":false}", async () => {
    const { token } = await seedDevice();
    beaconNotFound();
    const res = await post("/v1/locate", { wifiAccessPoints: uniqueAps() }, { token });
    expect(await res.text()).toBe('{"known":false}');
  });

  it("a cached coarse WiFi fix is still rejected on a cache hit", async () => {
    // The gate moved *above* the cache, so what the cache holds for ten minutes
    // is the position, not the first caller's verdict on it. Both directions
    // matter: a rejected fix must not be cached as a negative, and a cached
    // coarse fix must be rejected again on every hit.
    const aps = uniqueAps(3);
    beaconOk(40.5, -73.5, 900);

    const first = await resolveLocation({ bssids: aps, env }); // default 500 m
    expect(first).toEqual({ known: false });
    expect(beaconCalls).toBe(1);

    // Same cache entry, wider gate: the position survived the rejection.
    const loose = await resolveLocation({
      bssids: aps,
      env: { ...env, LOCATE_MAX_ACCURACY_M: "1000" } as Env,
    });
    expect(loose).toMatchObject({ known: true, accuracy: 900 });

    // ...and it is still rejected on the next hit under the real gate.
    expect(await resolveLocation({ bssids: aps, env })).toEqual({ known: false });
    expect(beaconCalls).toBe(1); // one upstream call served all three
  });

  it("/v1/nearby resolves the same device the same way /v1/locate does", async () => {
    const { deviceId, token } = await seedDevice();
    const posted = await seedFix(deviceId, { ageS: 30, accuracyM: 11 });

    const located = await locateJson([], token);
    const nearby = await post("/v1/nearby", { wifiAccessPoints: [] }, { token });

    expect(nearby.status).toBe(200);
    const body = await nearby.json<{ location: Record<string, unknown> }>();
    expect(body.location).toEqual({
      lat: posted.lat,
      lon: posted.lon,
      accuracy: 11,
      provider: "phone",
      captured_at: posted.capturedAt,
      quality: "current",
    });
    expect(body.location.lat).toBe(located.lat);
    expect(beaconCalls).toBe(0);
  });

  it("/v1/nearby stays byte-identical for an anonymous WiFi resolution", async () => {
    beaconOk(40.6931, -73.9871, 42);
    const res = await post("/v1/nearby", { wifiAccessPoints: uniqueAps() });
    expect(res.status).toBe(200);
    const body = await res.json<{ location: unknown }>();
    expect(body.location).toEqual({ lat: 40.6931, lon: -73.9871, accuracy: 42 });
  });
});
