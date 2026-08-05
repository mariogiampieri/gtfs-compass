import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CSRF_HEADER,
  DEVICE_TOKEN_PREFIX,
  SESSION_COOKIE,
  hashToken,
  mintSession,
  parseScopes,
  type Credential,
} from "../../src/auth";
import { budgetDay } from "../../src/email";
import { haversineM, resolveFromWifi, resolveLocation } from "../../src/locate";
import { getFix } from "../../src/relay";
import {
  RELAY_IP_FRESH_SCOPE,
  RELAY_IP_REPEAT_SCOPE,
  RELAY_REFUSED_SCOPE,
  RELAY_USER_SCOPE,
} from "../../src/routes/locate";
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

  it("a negative accuracy fails the gate rather than reading as metre-perfect", async () => {
    // `accuracy` is client-supplied on the relay path, and the gate is a single
    // upper bound: `-1 <= 500` passed, so an impossible reading outranked every
    // honest one.
    const { deviceId, token } = await seedDevice();
    await seedFix(deviceId, { ageS: 10, accuracyM: -1 });
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

    // Bytes, like the /v1/locate cases above, and for the same reason: a
    // parsed-object comparison cannot see key order, and key order is the wire
    // contract for a board that is already flashed. `location` is asserted as a
    // literal substring rather than the whole body because the rest of the
    // payload is feed data that legitimately varies.
    expect(await res.text()).toContain('"location":{"lat":40.6931,"lon":-73.9871,"accuracy":42}');
  });

  it("/v1/nearby is byte-identical for a granted board with no fix posted", async () => {
    const { token } = await seedDevice(); // holds read:fix; no phone has posted
    beaconOk(40.6931, -73.9871, 42);

    const res = await post("/v1/nearby", { wifiAccessPoints: uniqueAps() }, { token });

    expect(res.status).toBe(200);
    // The nearby mirror of the /v1/locate granted-but-no-fix case: consulting
    // the relay and finding nothing must leave the wire exactly as it was.
    expect(await res.text()).toContain('"location":{"lat":40.6931,"lon":-73.9871,"accuracy":42}');
  });
});

/* -------------------------------------------------------------------------- */
/* The relay write path and locate_log attribution (U14; R11, R17, R21)        */
/* -------------------------------------------------------------------------- */

const ORIGIN = "https://api.example";

interface AuthOpts {
  /** Session token for the `__Host-` cookie. */
  cookie?: string;
  /** `null` omits the CSRF header — the 403 case. */
  csrf?: string | null;
  /** `null` omits `Origin`, which `checkAmbientCsrf` also refuses. */
  origin?: string | null;
  token?: string;
  ip?: string;
}

function authHeaders(opts: AuthOpts): Record<string, string> {
  const headers: Record<string, string> = {
    "CF-Connecting-IP": opts.ip ?? freshIp(),
    "Content-Type": "application/json",
  };
  if (opts.cookie) headers.Cookie = `${SESSION_COOKIE}=${opts.cookie}`;
  if (opts.csrf !== null) headers[CSRF_HEADER] = opts.csrf ?? "1";
  if (opts.origin !== null) headers.Origin = opts.origin ?? ORIGIN;
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  return headers;
}

function postRef(body: unknown, opts: AuthOpts = {}) {
  return SELF.fetch(`${ORIGIN}/v1/locate/ref`, {
    method: "POST",
    headers: authHeaders(opts),
    body: JSON.stringify(body),
  });
}

function postLocate(body: unknown, opts: AuthOpts = {}) {
  return SELF.fetch(`${ORIGIN}/v1/locate`, {
    method: "POST",
    headers: authHeaders(opts),
    body: JSON.stringify(body),
  });
}

function postNearby(body: unknown, opts: AuthOpts = {}) {
  return SELF.fetch(`${ORIGIN}/v1/nearby`, {
    method: "POST",
    headers: authHeaders(opts),
    body: JSON.stringify(body),
  });
}

/** Push a session past its half-life, so the next read slides it in D1. */
async function ageSession(cookie: string): Promise<void> {
  await env.DB.prepare("UPDATE sessions SET expires_at = ?1 WHERE token_hash = ?2")
    .bind(nowSec() + 60, await hashToken(cookie))
    .run();
}

async function signIn(userId: string): Promise<{ token: string; sessionId: string }> {
  await seedUser(userId);
  const minted = await mintSession(env as unknown as Env, userId);
  return { token: minted.token, sessionId: minted.sessionId };
}

/**
 * Spend a sharded daily counter outright: the counter is a SUM across shards,
 * so one row carrying the whole cap exhausts it. `ON CONFLICT` rather than a
 * bare insert because a real charge may already have landed on this shard —
 * `incrementBudget` picks one at random, and a 1-in-8 primary-key collision is
 * a flaky test rather than an interesting one.
 */
async function spendBudget(scope: string, key: string, count: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO auth_budgets (scope, key, day, shard, count) VALUES (?1, ?2, ?3, 0, ?4)
     ON CONFLICT (scope, key, day, shard) DO UPDATE SET count = count + excluded.count`,
  )
    .bind(scope, await hashToken(key), budgetDay(), count)
    .run();
}

/** The estimate a diagnostic walk leaves behind, ready for a reference to pair. */
async function seedEstimate(
  deviceId: string,
  extra: { userId?: string | null; deviceRowId?: string | null } = {},
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO locate_log (user_id, device_id, device_row_id, ts, est_lat, est_lon, provider)
     VALUES (?1, ?2, ?3, ?4, 40.0, -73.95, 'beacondb')`,
  )
    .bind(extra.userId ?? null, deviceId, extra.deviceRowId ?? null, nowSec())
    .run();
}

describe("POST /v1/locate/ref — relay: true (R11)", () => {
  it("fans the fix out to the granting devices and 200s with no estimate to pair", async () => {
    const { token: cookie } = await signIn("usr_relay");
    const granted = await seedDevice({ userId: "usr_relay" });
    const ungranted = await seedDevice({
      userId: "usr_relay",
      scopes: "read:departures,read:config",
    });
    const capturedAt = nowSec() - 5;

    const res = await postRef(
      { relay: true, lat: 40.7052, lon: -74.0136, accuracy: 11, captured_at: capturedAt },
      { cookie },
    );

    // No unpaired estimate exists anywhere — the pairing lookup is short
    // circuited, so this is a 200 rather than the diagnostic path's 404.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ relayed: { devices: 1, stored: 1 } });

    const mine = await getFix(env as unknown as Env, granted.deviceId);
    expect(mine).toMatchObject({
      lat: 40.7052,
      lon: -74.0136,
      accuracyM: 11,
      capturedAt,
      quality: "current",
    });
    // The grant is the fan-out control (R9/R11): a board of the same account
    // without it is not a recipient.
    expect(await getFix(env as unknown as Env, ungranted.deviceId)).toBeNull();
  });

  it("writes nothing for another user's devices", async () => {
    const { token: cookie } = await signIn("usr_poster");
    const mine = await seedDevice({ userId: "usr_poster" });
    const theirs = await seedDevice({ userId: "usr_stranger" });

    // The request names no device (R11) — there is no parameter to point at
    // somebody else's board, so the only thing to assert is that the seam's
    // user argument is the one the credential produced.
    const res = await postRef(
      { relay: true, lat: 40.7052, lon: -74.0136, accuracy: 9, device_id: theirs.deviceId },
      { cookie },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ relayed: { devices: 1, stored: 1 } });
    expect(await getFix(env as unknown as Env, mine.deviceId)).not.toBeNull();
    expect(await getFix(env as unknown as Env, theirs.deviceId)).toBeNull();
  });

  it("without the CSRF header → 403 and nothing written", async () => {
    const { token: cookie } = await signIn("usr_csrf");
    const board = await seedDevice({ userId: "usr_csrf" });

    const missingHeader = await postRef(
      { relay: true, lat: 40.7, lon: -74.0 },
      { cookie, csrf: null },
    );
    expect(missingHeader.status).toBe(403);

    const missingOrigin = await postRef(
      { relay: true, lat: 40.7, lon: -74.0 },
      { cookie, origin: null },
    );
    expect(missingOrigin.status).toBe(403);

    const crossOrigin = await postRef(
      { relay: true, lat: 40.7, lon: -74.0 },
      { cookie, origin: "https://evil.example" },
    );
    expect(crossOrigin.status).toBe(403);

    expect(await getFix(env as unknown as Env, board.deviceId)).toBeNull();
  });

  it("DIAG_TOKEN and no session → 401 (the operator secret names no user)", async () => {
    await seedUser("usr_diag");
    const board = await seedDevice({ userId: "usr_diag" });

    const res = await postRef({ relay: true, lat: 40.7, lon: -74.0 }, { token: TOKEN });

    expect(res.status).toBe(401);
    expect(await getFix(env as unknown as Env, board.deviceId)).toBeNull();
  });

  it("a device token → 403: a board is not an account", async () => {
    const board = await seedDevice({ userId: "usr_board" });

    // `authorize()` refuses device credentials on any route naming no scope,
    // so this is the chokepoint's denial, not a guard written here.
    const res = await postRef({ relay: true, lat: 40.7, lon: -74.0 }, { token: board.token });

    expect(res.status).toBe(403);
    expect(await getFix(env as unknown as Env, board.deviceId)).toBeNull();
  });

  it("anonymous → 401", async () => {
    const res = await postRef({ relay: true, lat: 40.7, lon: -74.0 });
    expect(res.status).toBe(401);
  });

  it("the enforcing bound is the account: a second session does not buy a second allowance", async () => {
    const first = await signIn("usr_budget");
    const board = await seedDevice({ userId: "usr_budget" });
    await spendBudget(RELAY_USER_SCOPE, "usr_budget", 1500);

    const refused = await postRef({ relay: true, lat: 40.7, lon: -74.0 }, { cookie: first.token });
    expect(refused.status).toBe(429);

    // Every magic-link redeem mints a fresh `sessions` row, and an address may
    // ask for five links a day: keyed on the session, one mailbox held five
    // full allowances by tomorrow and the account's cadence was unenforced past
    // day one.
    const second = await signIn("usr_budget");
    const stillRefused = await postRef(
      { relay: true, lat: 40.7, lon: -74.0 },
      { cookie: second.token },
    );
    expect(stillRefused.status).toBe(429);
    expect(await getFix(env as unknown as Env, board.deviceId)).toBeNull();
  });

  it("one account cannot spend the shared network budget out from under its neighbours", async () => {
    const heavy = await signIn("usr_heavy");
    const neighbour = await signIn("usr_neighbour");
    await seedDevice({ userId: "usr_heavy" });
    const theirBoard = await seedDevice({ userId: "usr_neighbour" });

    // Past its own fresh allowance for the day, so this account's posts draw on
    // the repeat slice — and that slice is spent.
    await spendBudget(RELAY_USER_SCOPE, "usr_heavy", 60);
    await spendBudget(RELAY_IP_REPEAT_SCOPE, "198.19.9.0/24", 1200);

    const refused = await postRef(
      { relay: true, lat: 40.7, lon: -74.0 },
      { cookie: heavy.token, ip: "198.19.9.42" },
    );
    expect(refused.status).toBe(429);

    // The neighbour behind the same /24 — a carrier CGNAT block holds hundreds
    // of subscribers — is untouched: their first posts of the day land in a
    // slice nothing the heavy account does can reach.
    const allowed = await postRef(
      { relay: true, lat: 40.71, lon: -74.01 },
      { cookie: neighbour.token, ip: "198.19.9.99" },
    );
    expect(allowed.status).toBe(200);
    expect(await getFix(env as unknown as Env, theirBoard.deviceId)).not.toBeNull();
  });

  it("records a durable refusal when a spent network slice turns a post away", async () => {
    const { token: cookie } = await signIn("usr_slice");
    await seedDevice({ userId: "usr_slice" });
    await spendBudget(RELAY_IP_FRESH_SCOPE, "198.19.11.0/24", 4800);

    const res = await postRef(
      { relay: true, lat: 40.7, lon: -74.0 },
      { cookie, ip: "198.19.11.5" },
    );

    expect(res.status).toBe(429);
    // The shared key means this refusal can be somebody else's fault entirely,
    // and it is invisible in the response — so it lands on a counter.
    const row = await env.DB.prepare(
      "SELECT COALESCE(SUM(count), 0) AS n FROM auth_budgets WHERE scope = ?1 AND key = ?2",
    )
      .bind(RELAY_REFUSED_SCOPE, "fresh")
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("a spent account budget writes no per-network counter row", async () => {
    // The ordering `chargeSendBudget` established: every read before any write,
    // and the caller-chosen key is never charged ahead of the bound above it.
    const { token: cookie } = await signIn("usr_order");
    await spendBudget(RELAY_USER_SCOPE, "usr_order", 1500);

    const res = await postRef({ relay: true, lat: 40.7, lon: -74.0 }, { cookie, ip: "198.20.4.4" });

    expect(res.status).toBe(429);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM auth_budgets WHERE scope IN (?1, ?2) AND key = ?3",
    )
      .bind(RELAY_IP_FRESH_SCOPE, RELAY_IP_REPEAT_SCOPE, await hashToken("198.20.4.0/24"))
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("reports how many boards stored the fix, not only how many were targeted", async () => {
    const { token: cookie } = await signIn("usr_refine");
    const board = await seedDevice({ userId: "usr_refine" });
    // The board already holds a metre-accurate fix from inside the horizon.
    const held = await seedFix(board.deviceId, { ageS: 20, accuracyM: 8 });

    const res = await postRef(
      { relay: true, lat: 40.9, lon: -74.9, accuracy: 60 },
      { cookie },
    );

    // Targeted, and deliberately not written: the refinement keeps the better
    // position. Reporting only `devices` let the UI say "each keeps this
    // position until a newer one arrives" about a board showing the older one.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ relayed: { devices: 1, stored: 0 } });
    expect(await getFix(env as unknown as Env, board.deviceId)).toMatchObject({
      lat: held.lat,
      accuracyM: 8,
    });
  });

  it("relay and log are independent", async () => {
    const { token: cookie } = await signIn("usr_both");
    const board = await seedDevice({ userId: "usr_both" });
    await seedEstimate("walk-1", { userId: "usr_both" });

    const both = await postRef(
      { relay: true, log: true, device_id: "walk-1", lat: 40.001, lon: -73.95, accuracy: 5 },
      { cookie },
    );

    expect(both.status).toBe(200);
    const body = await both.json<{ id: number; delta_m: number; relayed: { devices: number } }>();
    expect(body.relayed).toEqual({ devices: 1, stored: 1 });
    expect(body.delta_m).toBeGreaterThan(110);
    expect(await getFix(env as unknown as Env, board.deviceId)).toMatchObject({ lat: 40.001 });

    // log alone: the pairing happens and nothing is relayed.
    await seedEstimate("walk-2", { userId: "usr_both" });
    await env.DB.prepare("DELETE FROM device_fixes").run();
    const logOnly = await postRef(
      { log: true, device_id: "walk-2", lat: 40.001, lon: -73.95 },
      { cookie },
    );
    expect(logOnly.status).toBe(200);
    expect(await logOnly.json<Record<string, unknown>>()).not.toHaveProperty("relayed");
    expect(await getFix(env as unknown as Env, board.deviceId)).toBeNull();

    // relay alone with a pairable estimate sitting right there: still no pairing.
    await seedEstimate("walk-3", { userId: "usr_both" });
    const relayOnly = await postRef({ relay: true, lat: 40.5, lon: -73.5 }, { cookie });
    expect(relayOnly.status).toBe(200);
    expect(await relayOnly.json()).toEqual({ relayed: { devices: 1, stored: 1 } });
    const untouched = await env.DB.prepare(
      "SELECT ref_lat FROM locate_log WHERE device_id = 'walk-3'",
    ).first<{ ref_lat: number | null }>();
    expect(untouched?.ref_lat).toBeNull();
  });

  it("a relay post that also asked to pair does not 404 when there is nothing to pair", async () => {
    const { token: cookie } = await signIn("usr_nopair");
    const board = await seedDevice({ userId: "usr_nopair" });

    const res = await postRef(
      { relay: true, log: true, device_id: "never-scanned", lat: 40.7, lon: -74.0 },
      { cookie },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ relayed: { devices: 1, stored: 1 } });
    expect(await getFix(env as unknown as Env, board.deviceId)).not.toBeNull();
  });

  it("a coarse fix is stored ungated (R12) and still pairs as a reference", async () => {
    const { token: cookie } = await signIn("usr_coarse");
    const board = await seedDevice({ userId: "usr_coarse" });
    await seedEstimate("coarse-walk", { userId: "usr_coarse" });

    const res = await postRef(
      { relay: true, log: true, device_id: "coarse-walk", lat: 40.001, lon: -73.95, accuracy: 900 },
      { cookie },
    );

    expect(res.status).toBe(200);
    // 900 m is far past LOCATE_MAX_ACCURACY_M; the store keeps it and the
    // provider chain is what refuses it (AE7 above).
    expect(await getFix(env as unknown as Env, board.deviceId)).toMatchObject({ accuracyM: 900 });
    const row = await env.DB.prepare(
      "SELECT ref_accuracy, delta_m FROM locate_log WHERE device_id = 'coarse-walk'",
    ).first<{ ref_accuracy: number; delta_m: number }>();
    expect(row?.ref_accuracy).toBe(900);
    expect(row?.delta_m).toBeGreaterThan(110);
  });

  it("refuses an out-of-range or millisecond captured_at rather than storing it", async () => {
    const { token: cookie } = await signIn("usr_clock");
    const board = await seedDevice({ userId: "usr_clock" });

    const ms = await postRef(
      { relay: true, lat: 40.7, lon: -74.0, captured_at: Date.now() },
      { cookie },
    );
    expect(ms.status).toBe(400);

    const nonsense = await postRef({ relay: true, lat: 91, lon: -74.0 }, { cookie });
    expect(nonsense.status).toBe(400);

    const noPosition = await postRef({ relay: true, lon: -74.0 }, { cookie });
    expect(noPosition.status).toBe(400);

    expect(await getFix(env as unknown as Env, board.deviceId)).toBeNull();
  });

  it("neither flag → 400, and the budget is untouched", async () => {
    const { token: cookie } = await signIn("usr_noop");
    const res = await postRef({ relay: false, log: false, lat: 40.7, lon: -74.0 }, { cookie });
    expect(res.status).toBe(400);
    const spent = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM auth_budgets WHERE scope = ?1 AND key = ?2",
    )
      .bind(RELAY_USER_SCOPE, await hashToken("usr_noop"))
      .first<{ n: number }>();
    expect(spent?.n).toBe(0);
  });
});

describe("a phone-sourced answer is never a diagnostic estimate", () => {
  /**
   * The composition that made this a leak: `log:true` takes any session or
   * board token now, and the chain answers from the relay before WiFi. Without
   * the suppression a board holding `read:fix` copied its owner's
   * metre-accurate GPS position into `locate_log`, where revoking the grant
   * does not delete it, unpairing does not delete it, and the 14-day precise
   * sweep is the only reaper — a durable movement trail behind the one row the
   * config UI promises is deleted when the permission goes off.
   */
  it("a board with read:fix cannot copy its owner's position into locate_log", async () => {
    const { deviceId, token } = await seedDevice();
    const posted = await seedFix(deviceId, { ageS: 10, accuracyM: 8 });

    const res = await postLocate(
      { wifiAccessPoints: [], device_id: "board-trail", log: true },
      { token },
    );

    // The board still gets its answer — this is not a refusal, it is a refusal
    // to *persist*.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      known: true,
      provider: "phone",
      lat: posted.lat,
      lon: posted.lon,
    });
    expect(await logRows("board-trail")).toHaveLength(0);
    const anywhere = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM locate_log WHERE provider = 'phone' OR est_lat = ?1",
    )
      .bind(posted.lat)
      .first<{ n: number }>();
    expect(anywhere?.n).toBe(0);
  });

  it("the same board still logs a WiFi estimate, which is what the corpus is for", async () => {
    const { deviceId, token } = await seedDevice();
    await seedFix(deviceId, { ageS: 10, accuracyM: 8 });
    // Grant gone: the chain falls through to WiFi, and that answer *is* an
    // estimate a phone reference can later be paired against.
    await env.DB.prepare("UPDATE devices SET scopes = 'read:departures' WHERE id = ?1")
      .bind(deviceId)
      .run();
    beaconOk(40.6931, -73.9871, 42);

    const res = await postLocate(
      { wifiAccessPoints: uniqueAps(), device_id: "board-estimate", log: true },
      { token },
    );

    expect(res.status).toBe(200);
    expect((await logRows("board-estimate"))[0]).toMatchObject({
      provider: "beacondb",
      est_lat: 40.6931,
    });
  });
});

describe("client-supplied text is bounded at ingress", () => {
  it("refuses an oversized device_id or label rather than storing it", async () => {
    beaconOk(40.6931, -73.9871, 42);
    const longId = "d".repeat(65);
    const tooLongId = await postLocate(
      { wifiAccessPoints: uniqueAps(), device_id: longId, log: true },
      { token: TOKEN },
    );
    expect(tooLongId.status).toBe(400);
    expect((await tooLongId.json<{ error: string }>()).error).toMatch(/device_id/);
    expect(await logRows(longId)).toHaveLength(0);

    // `DAILY_LOG_CAP` bounds how many rows a caller writes, never how big one
    // is: 500 rows of megabyte labels is the same database that serves feeds,
    // stops and auth.
    const tooLongLabel = await postLocate(
      { wifiAccessPoints: uniqueAps(), device_id: "dev-label", log: true, label: "x".repeat(129) },
      { token: TOKEN },
    );
    expect(tooLongLabel.status).toBe(400);
    expect((await tooLongLabel.json<{ error: string }>()).error).toMatch(/label/);
    expect(await logRows("dev-label")).toHaveLength(0);
  });

  it("accepts the boundary values, so the cap is a cap and not a paper cut", async () => {
    beaconOk(40.6931, -73.9871, 42);
    const id = "d".repeat(64);
    const res = await postLocate(
      { wifiAccessPoints: uniqueAps(), device_id: id, log: true, label: "y".repeat(128) },
      { token: TOKEN },
    );
    expect(res.status).toBe(200);
    expect(await logRows(id)).toHaveLength(1);
  });

  it("bounds the same two fields on the reference ingress, before anything is relayed", async () => {
    const { token: cookie } = await signIn("usr_bounds");
    const board = await seedDevice({ userId: "usr_bounds" });

    const res = await postRef(
      { relay: true, lat: 40.7, lon: -74.0, label: "z".repeat(129) },
      { cookie },
    );

    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toMatch(/label/);
    expect(await getFix(env as unknown as Env, board.deviceId)).toBeNull();

    const longId = await postRef(
      { relay: true, log: true, lat: 40.7, lon: -74.0, device_id: "d".repeat(65) },
      { cookie },
    );
    expect(longId.status).toBe(400);
    expect(await getFix(env as unknown as Env, board.deviceId)).toBeNull();
  });
});

describe("the two responses that now carry a live position", () => {
  it("are marked no-store, like every other credentialed route", async () => {
    beaconOk(40.6931, -73.9871, 42);
    const located = await postLocate({ wifiAccessPoints: uniqueAps() });
    expect(located.headers.get("Cache-Control")).toBe("no-store");
    expect(located.headers.get("Content-Type")).toBe("application/json");
    expect(located.headers.get("X-Content-Type-Options")).toBe("nosniff");

    beaconOk(40.6931, -73.9871, 42);
    const nearby = await postNearby({ wifiAccessPoints: uniqueAps() });
    expect(nearby.status).toBe(200);
    expect(nearby.headers.get("Cache-Control")).toBe("no-store");
  });

  it("re-issue the slid session cookie rather than moving D1 alone", async () => {
    const { token: cookie } = await signIn("usr_slide");
    await ageSession(cookie);
    beaconOk(40.6931, -73.9871, 42);

    // Neither route goes through `authorize()` — they are anonymous-capable —
    // so without re-issuing the cookie here the window slides in D1 while the
    // browser keeps the `Max-Age` it was minted with.
    const located = await postLocate({ wifiAccessPoints: uniqueAps() }, { cookie });
    expect(located.status).toBe(200);
    expect(located.headers.get("Set-Cookie")).toContain(`${SESSION_COOKIE}=${cookie}`);

    const second = await signIn("usr_slide2");
    await ageSession(second.token);
    beaconOk(40.6931, -73.9871, 42);
    const nearby = await postNearby({ wifiAccessPoints: uniqueAps() }, { cookie: second.token });
    expect(nearby.status).toBe(200);
    expect(nearby.headers.get("Set-Cookie")).toContain(`${SESSION_COOKIE}=${second.token}`);
  });
});

describe("locate_log attribution (R21) and its two identity spaces", () => {
  it("a device-token insert carries user_id and device_row_id; an anonymous one keeps both NULL", async () => {
    const board = await seedDevice({ userId: "usr_attr" });
    beaconOk(40.6931, -73.9871, 42);

    const attributed = await postLocate(
      { wifiAccessPoints: uniqueAps(), device_id: "board-walk", log: true },
      { token: board.token },
    );
    expect(attributed.status).toBe(200);

    beaconOk(40.6931, -73.9871, 42);
    const anonymous = await postLocate(
      { wifiAccessPoints: uniqueAps(), device_id: "anon-walk", log: true },
      { token: TOKEN },
    );
    expect(anonymous.status).toBe(200);

    expect((await logRows("board-walk"))[0]).toMatchObject({
      user_id: "usr_attr",
      device_row_id: board.deviceId,
    });
    expect((await logRows("anon-walk"))[0]).toMatchObject({
      user_id: null,
      device_row_id: null,
    });
  });

  it("a session insert is attributed, needs no device_id, and is CSRF-gated", async () => {
    const { token: cookie } = await signIn("usr_session_log");
    beaconOk(40.6931, -73.9871, 42);

    const forged = await postLocate(
      { wifiAccessPoints: uniqueAps(), log: true },
      { cookie, csrf: null },
    );
    expect(forged.status).toBe(403);

    beaconOk(40.6931, -73.9871, 42);
    const res = await postLocate({ wifiAccessPoints: uniqueAps(), log: true }, { cookie });
    expect(res.status).toBe(200);

    const rows = await env.DB.prepare("SELECT * FROM locate_log WHERE user_id = ?1")
      .bind("usr_session_log")
      .all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({ device_id: null, device_row_id: null });
  });

  it("the operator path stays anonymous even for a caller who is also signed in", async () => {
    const { token: cookie } = await signIn("usr_operator");
    beaconOk(40.6931, -73.9871, 42);

    // DIAG_TOKEN wins: the walk's rows belong to the walk, and stay readable
    // through /v1/locate/log rather than disappearing into an account.
    const res = await postLocate(
      { wifiAccessPoints: uniqueAps(), device_id: "op-walk", log: true },
      { cookie, token: TOKEN },
    );

    expect(res.status).toBe(200);
    expect((await logRows("op-walk"))[0]).toMatchObject({ user_id: null, device_row_id: null });
  });

  it("the two caps are separate spaces: an anonymous id cannot burn a board's", async () => {
    const board = await seedDevice({ userId: "usr_caps" });
    // 500 anonymous rows naming the board's server-minted id as free-form text.
    await env.DB.prepare(
      `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 500)
       INSERT INTO locate_log (device_id, ts) SELECT ?1, ?2 FROM c`,
    )
      .bind(board.deviceId, nowSec())
      .run();

    // The anonymous space is full for that string...
    const anonymous = await postLocate(
      { wifiAccessPoints: uniqueAps(), device_id: board.deviceId, log: true },
      { token: TOKEN },
    );
    expect(anonymous.status).toBe(429);

    // ...and the board's own cap, counted on devices.id, is untouched.
    beaconOk(40.6931, -73.9871, 42);
    const authenticated = await postLocate(
      { wifiAccessPoints: uniqueAps(), device_id: board.deviceId, log: true },
      { token: board.token },
    );
    expect(authenticated.status).toBe(200);
    const attributedRows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM locate_log WHERE device_row_id = ?1",
    )
      .bind(board.deviceId)
      .first<{ n: number }>();
    expect(attributedRows?.n).toBe(1);
  });

  it("a board's own cap refuses its 501st row of the day", async () => {
    const board = await seedDevice({ userId: "usr_devcap" });
    await env.DB.prepare(
      `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 500)
       INSERT INTO locate_log (device_row_id, user_id, ts) SELECT ?1, ?2, ?3 FROM c`,
    )
      .bind(board.deviceId, "usr_devcap", nowSec())
      .run();

    const res = await postLocate(
      { wifiAccessPoints: uniqueAps(), log: true },
      { token: board.token },
    );

    expect(res.status).toBe(429);
    expect(beaconCalls).toBe(0); // refused before the provider was consulted
  });
});

describe("locate_log tenancy (the predicate the SELECT * used to lack)", () => {
  it("a session cannot pair a reference onto another account's estimate", async () => {
    const { token: cookie } = await signIn("usr_a");
    await seedUser("usr_b");
    await seedEstimate("shared-label", { userId: "usr_b" });

    const res = await postRef(
      { log: true, device_id: "shared-label", lat: 40.001, lon: -73.95 },
      { cookie },
    );

    // Same 404 an estimate that does not exist gets — the account boundary is
    // not something a device_id guesser gets to probe.
    expect(res.status).toBe(404);
    const row = await env.DB.prepare(
      "SELECT ref_lat FROM locate_log WHERE device_id = 'shared-label'",
    ).first<{ ref_lat: number | null }>();
    expect(row?.ref_lat).toBeNull();
  });

  it("the operator secret cannot pair a reference onto an attributed estimate", async () => {
    await seedUser("usr_c");
    await seedEstimate("op-target", { userId: "usr_c" });

    const res = await postRef(
      { log: true, device_id: "op-target", lat: 40.001, lon: -73.95 },
      { token: TOKEN },
    );

    expect(res.status).toBe(404);
    const row = await env.DB.prepare(
      "SELECT ref_lat FROM locate_log WHERE device_id = 'op-target'",
    ).first<{ ref_lat: number | null }>();
    expect(row?.ref_lat).toBeNull();
  });

  it("a session pairs its own estimate, including one its board wrote", async () => {
    const { token: cookie } = await signIn("usr_own");
    const board = await seedDevice({ userId: "usr_own" });
    await seedEstimate("own-walk", { userId: "usr_own", deviceRowId: board.deviceId });

    const res = await postRef(
      { log: true, device_id: "own-walk", lat: 40.001, lon: -73.95 },
      { cookie },
    );

    expect(res.status).toBe(200);
    expect((await res.json<{ delta_m: number }>()).delta_m).toBeGreaterThan(110);
  });

  it("GET /v1/locate/log returns only the rows that belong to no user", async () => {
    await seedUser("usr_hidden");
    await seedEstimate("mixed", { userId: "usr_hidden" });
    await seedEstimate("mixed");

    const res = await get("/v1/locate/log?device_id=mixed", { token: TOKEN });

    expect(res.status).toBe(200);
    const rows = (await res.json<{ rows: { user_id: string | null }[] }>()).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* R6 (firmware pairing plan): a presented-but-invalid device token is 401     */
/* -------------------------------------------------------------------------- */

describe("nearby answers 401 for a presented-but-invalid device token (R6)", () => {
  it("revoked and never-minted tokens get the same 401, byte for byte", async () => {
    const { deviceId, token } = await seedDevice();
    await env.DB.prepare("UPDATE devices SET revoked_at = ?1 WHERE id = ?2")
      .bind(nowSec(), deviceId)
      .run();

    const revoked = await postNearby({ wifiAccessPoints: uniqueAps() }, { token });
    const never = await postNearby(
      { wifiAccessPoints: uniqueAps() },
      { token: `${DEVICE_TOKEN_PREFIX}neverminted` },
    );

    expect(revoked.status).toBe(401);
    expect(never.status).toBe(401);
    const body = await revoked.text();
    // Revoked must not be distinguishable from never-real (Unpair concept).
    expect(body).toBe(await never.text());
    expect(body).toBe('{"error":"invalid device token"}');
    // Refused before the locate chain runs — no provider spend for a dead token.
    expect(beaconCalls).toBe(0);
  });

  it("a malformed Authorization header is refused, not silently anonymous", async () => {
    for (const header of ["Basic Zm9vOmJhcg==", "Bearer ", "Bearer not-a-device-token"]) {
      const res = await SELF.fetch(`${ORIGIN}/v1/nearby`, {
        method: "POST",
        headers: {
          "CF-Connecting-IP": freshIp(),
          "Content-Type": "application/json",
          Authorization: header,
        },
        body: JSON.stringify({ wifiAccessPoints: uniqueAps() }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("a valid default-scopes token is accepted and resolves via WiFi", async () => {
    const { token } = await seedDevice({ scopes: "read:departures,read:config" });
    beaconOk(40.6931, -73.9871, 42);

    const res = await postNearby({ wifiAccessPoints: uniqueAps() }, { token });

    expect(res.status).toBe(200);
    // No read:fix, no relay consult — the anonymous wire shape, byte for byte.
    expect(await res.text()).toContain(
      '"location":{"lat":40.6931,"lon":-73.9871,"accuracy":42}',
    );
  });

  it("a session cookie with a stray non-device Authorization header is 401", async () => {
    // Pins the deliberate breadth of the gate: ANY presented Authorization
    // header that does not resolve to a device credential is refused, even
    // when a valid session rides alongside. Flagged for Mario as an open
    // question (doc-review A6) — flip this pin if the gate is narrowed to
    // gtfsc_dev_-prefixed bearers only.
    const { token: cookie } = await signIn("usr_stray");
    const res = await postNearby(
      { wifiAccessPoints: uniqueAps() },
      { cookie, token: "stray-header-value" },
    );
    expect(res.status).toBe(401);
  });

  it("/v1/locate is unchanged: an invalid device token still resolves anonymously", async () => {
    beaconOk(40.6931, -73.9871, 42);
    const aps = uniqueAps();

    const anon = await postLocate({ wifiAccessPoints: aps }, {});
    const withBadToken = await postLocate(
      { wifiAccessPoints: aps },
      { token: `${DEVICE_TOKEN_PREFIX}neverminted` },
    );

    expect(anon.status).toBe(200);
    expect(withBadToken.status).toBe(200);
    // The shared resolveCredential seam did not change shape: locate's
    // anonymous answer for a bad token is byte-identical to no token at all.
    expect(await withBadToken.text()).toBe(await anon.text());
  });
});
