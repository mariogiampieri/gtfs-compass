import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { transit_realtime } from "../../src/gen/gtfs-realtime.js";
import {
  FeedDO,
  IDLE_SUSPEND_MS,
  MAX_CHUNKS,
  feedKeys,
  resetFeedKeysForTests,
  trimPerRoute,
} from "../../src/feed_do";

const ORIGIN = "https://rt.example";
const BASE_URL = `${ORIGIN}/gtfs`;

function encodeFeed(headerTimestamp: number, entries: [string, string, number][]): Uint8Array {
  return transit_realtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: "2.0", timestamp: headerTimestamp },
    entity: entries.map(([routeId, stopId, time], i) => ({
      id: `t${i}`,
      tripUpdate: {
        trip: { tripId: `trip${i}`, routeId },
        stopTimeUpdate: [{ stopId, departure: { time } }],
      },
    })),
  } as transit_realtime.IFeedMessage).finish();
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function stubFor(name: string) {
  return env.FEED_DO.get(env.FEED_DO.idFromName(name));
}

function read(stub: DurableObjectStub<FeedDO>, stopId: string, feed = "mta-subway", group = "ace") {
  return stub.fetch(`https://do/stop/${stopId}?feed=${feed}&group=${group}`);
}

/** Wait until the DO's background refresh settles. */
async function settleRefresh(stub: DurableObjectStub<FeedDO>) {
  await runInDurableObject(stub, async (instance: FeedDO) => {
    for (let i = 0; i < 200 && (instance as any).refreshInFlight; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });
}

// Tests and DOs share one workerd isolate under vitest-pool-workers, so a
// global-fetch stub is the outbound seam (this pool version has no fetchMock).
// One-shot handlers; any unexpected outbound fetch throws (net "blocked").
type MockReply = { status: number; body: Uint8Array | string; delayMs: number };
const pendingMocks = new Map<string, MockReply[]>();
const realFetch = globalThis.fetch;
let upstreamAttempts = 0; // counts every outbound try, even unmocked ones

function mockFeedOnce(path: string, body: Uint8Array | string, delayMs = 0, status = 200) {
  const url = `${ORIGIN}${path}`;
  const queue = pendingMocks.get(url) ?? [];
  queue.push({ status, body, delayMs });
  pendingMocks.set(url, queue);
}

function assertNoPendingMocks() {
  const leftover = [...pendingMocks.entries()].filter(([, q]) => q.length > 0);
  expect(leftover, "expected every mocked upstream fetch to be consumed").toEqual([]);
}

beforeEach(async () => {
  pendingMocks.clear();
  upstreamAttempts = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    upstreamAttempts++;
    const url = input instanceof Request ? input.url : String(input);
    const queue = pendingMocks.get(url);
    const reply = queue?.shift();
    if (!reply) throw new Error(`unmocked outbound fetch: ${url}`);
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    const body = typeof reply.body === "string" ? reply.body : reply.body.slice().buffer;
    return new Response(body as BodyInit, { status: reply.status });
  }) as typeof fetch;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS feeds (id TEXT PRIMARY KEY NOT NULL, rt_trip_url TEXT, adapter TEXT, rt_needs_key INTEGER)",
  ).run();
  await env.DB.prepare(
    "INSERT OR REPLACE INTO feeds (id, rt_trip_url, adapter) VALUES ('mta-subway', ?, 'nyct')",
  )
    .bind(BASE_URL)
    .run();
});

afterEach(() => {
  try {
    assertNoPendingMocks();
  } finally {
    globalThis.fetch = realFetch;
  }
});

describe("FeedDO", () => {
  it("first-ever read: fetched_at null, empty arrivals, refresh triggered", async () => {
    const stub = stubFor("mta-subway:ace#first");
    mockFeedOnce("/gtfs-ace", encodeFeed(nowSec(), [["A", "S1", nowSec() + 300]]));

    const res = await read(stub, "S1");
    const body = await res.json<any>();
    expect(body).toEqual({ fetched_at: null, group: "ace", arrivals: [] });

    await settleRefresh(stub);
    const second = await read(stub, "S1");
    const secondBody = await second.json<any>();
    expect(secondBody.fetched_at).toBeGreaterThan(0);
    expect(secondBody.arrivals).toHaveLength(1);
    expect(secondBody.arrivals[0].routeId).toBe("A");
  });

  it("one upstream fetch per window: two quick reads trigger exactly one fetch (R1)", async () => {
    const stub = stubFor("mta-subway:ace#window");
    mockFeedOnce("/gtfs-ace", encodeFeed(nowSec(), [["A", "S1", nowSec() + 300]]));

    await read(stub, "S1");
    await read(stub, "S1"); // second read sees pending alarm, must not refetch
    await settleRefresh(stub);
    // Attempt count (not just queue drain): a swallowed unmocked-fetch throw
    // inside refresh() must not be able to hide a duplicate fetch.
    expect(upstreamAttempts).toBe(1);
  });

  it("read during a slow in-flight refresh does not double-fetch or regress (race)", async () => {
    const stub = stubFor("mta-subway:ace#race");
    mockFeedOnce("/gtfs-ace", encodeFeed(nowSec(), [["A", "S1", nowSec() + 300]]), 150);

    const first = read(stub, "S1"); // arms + starts slow refresh
    await first;
    const during = await read(stub, "S1"); // lands mid-fetch
    expect((await during.json<any>()).fetched_at).toBeNull(); // still no data, no crash

    await settleRefresh(stub);
    const after = await read(stub, "S1");
    expect((await after.json<any>()).arrivals).toHaveLength(1);
    const pending = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(pending).not.toBeNull(); // exactly one pending alarm
  });

  it("self-suspends after 10 idle minutes and re-arms on the next read (R2)", async () => {
    const stub = stubFor("mta-subway:ace#suspend");
    mockFeedOnce("/gtfs-ace", encodeFeed(nowSec(), [["A", "S1", nowSec() + 300]]));
    await read(stub, "S1");
    await settleRefresh(stub);

    // Simulate 11 minutes of idleness (memory + storage, surviving hibernation).
    await runInDurableObject(stub, async (instance: FeedDO, state) => {
      const stale = Date.now() - IDLE_SUSPEND_MS - 60_000;
      (instance as any).lastReadMs = stale;
      (instance as any).lastPersistedReadMs = stale;
      await state.storage.put("last_read", stale);
    });

    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    const pendingAfter = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(pendingAfter).toBeNull(); // suspended: no reschedule, no fetch

    // Next read re-arms and refreshes.
    mockFeedOnce("/gtfs-ace", encodeFeed(nowSec() + 60, [["A", "S1", nowSec() + 600]]));
    await read(stub, "S1");
    await settleRefresh(stub);
    const rearmed = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(rearmed).not.toBeNull();
  });

  it("serves a stored snapshot without any upstream call (R3/R4)", async () => {
    const stub = stubFor("mta-subway:ace#warm");
    const staleFetchedAt = Date.now() - 5 * 60_000;
    await runInDurableObject(stub, async (instance: FeedDO, state) => {
      const snapshot = {
        arrivals: { S1: [{ routeId: "A", time: nowSec() + 120 }] },
        fetchedAtMs: staleFetchedAt,
        headerTimestamp: nowSec() - 300,
      };
      (instance as any).snapshot = snapshot;
      await state.storage.put("snapshot", snapshot);
      await state.storage.setAlarm(Date.now() + 20_000); // pending alarm: read must not re-arm/refresh
    });

    const res = await read(stub, "S1");
    const body = await res.json<any>();
    expect(body.fetched_at).toBe(Math.floor(staleFetchedAt / 1000)); // honest stale stamp
    expect(body.arrivals).toHaveLength(1); // served with net connect disabled
  });

  it("upstream 500 during alarm keeps old snapshot, reschedules (never-throws)", async () => {
    const stub = stubFor("mta-subway:ace#err");
    mockFeedOnce("/gtfs-ace", encodeFeed(nowSec(), [["A", "S1", nowSec() + 300]]));
    await read(stub, "S1");
    await settleRefresh(stub);
    const before = await (await read(stub, "S1")).json<any>();

    mockFeedOnce("/gtfs-ace", "boom", 0, 500);
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await settleRefresh(stub);

    const after = await (await read(stub, "S1")).json<any>();
    expect(after.fetched_at).toBe(before.fetched_at); // unchanged
    const pending = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(pending).not.toBeNull(); // loop still armed
  });

  it("frozen upstream (header not advancing) is treated as a failed fetch", async () => {
    const stub = stubFor("mta-subway:ace#frozen");
    const headerTs = nowSec();
    mockFeedOnce("/gtfs-ace", encodeFeed(headerTs, [["A", "S1", nowSec() + 300]]));
    await read(stub, "S1");
    await settleRefresh(stub);
    const before = await (await read(stub, "S1")).json<any>();

    // Same header timestamp: content pretends to be new, generator is stuck.
    mockFeedOnce("/gtfs-ace", encodeFeed(headerTs, [["A", "S1", nowSec() + 900]]));
    await runDurableObjectAlarm(stub);
    await settleRefresh(stub);

    const after = await (await read(stub, "S1")).json<any>();
    expect(after.fetched_at).toBe(before.fetched_at); // visibly stale, not re-stamped
    expect(after.arrivals[0].time).toBe(before.arrivals[0].time);
  });

  it("duplicate alarm invocations single-flight the refresh", async () => {
    const stub = stubFor("mta-subway:ace#dup");
    mockFeedOnce("/gtfs-ace", encodeFeed(nowSec(), [["A", "S1", nowSec() + 300]]));
    await read(stub, "S1");
    await settleRefresh(stub);

    mockFeedOnce("/gtfs-ace", encodeFeed(nowSec() + 60, [["A", "S1", nowSec() + 600]]));
    const before = upstreamAttempts;
    await runInDurableObject(stub, async (instance: FeedDO) => {
      await Promise.all([instance.alarm(), instance.alarm()]); // at-least-once duplicate
    });
    expect(upstreamAttempts - before).toBe(1); // single-flight: exactly one attempt
    const pending = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(pending).not.toBeNull();
  });

  it("stop ids colliding with Object.prototype keys are safe", async () => {
    const stub = stubFor("mta-subway:ace#proto");
    await runInDurableObject(stub, async (instance: FeedDO, state) => {
      const snapshot = {
        arrivals: { S1: [{ routeId: "A", time: nowSec() + 120 }] },
        fetchedAtMs: Date.now(),
        headerTimestamp: nowSec(),
      };
      (instance as any).snapshot = snapshot;
      await state.storage.put("snapshot", snapshot);
      await state.storage.setAlarm(Date.now() + 20_000);
    });
    for (const evil of ["constructor", "__proto__", "toString"]) {
      const res = await read(stub, evil);
      expect(res.status).toBe(200);
      expect((await res.json<any>()).arrivals).toEqual([]);
    }
  });

  it("configMissing recovers once the feeds row appears", async () => {
    const stub = stubFor("late-feed:ace");
    await read(stub, "S1", "late-feed"); // arms; refresh hits MissingFeedError
    await settleRefresh(stub);
    expect((await read(stub, "S1", "late-feed")).status).toBe(404); // pinned missing

    await env.DB.prepare(
      "INSERT OR REPLACE INTO feeds (id, rt_trip_url, adapter) VALUES ('late-feed', ?, 'nyct')",
    )
      .bind(BASE_URL)
      .run();
    mockFeedOnce("/gtfs-ace", encodeFeed(nowSec(), [["A", "S1", nowSec() + 300]]));
    const ran = await runDurableObjectAlarm(stub); // alarm still armed; retries config
    expect(ran).toBe(true);
    await settleRefresh(stub);

    const recovered = await read(stub, "S1", "late-feed");
    expect(recovered.status).toBe(200); // sticky-404 bug would fail here
    expect((await recovered.json<any>()).arrivals).toHaveLength(1);
  });

  it("unknown stop returns empty arrivals with real fetched_at (no-service fact)", async () => {
    const stub = stubFor("mta-subway:ace#unknown");
    mockFeedOnce("/gtfs-ace", encodeFeed(nowSec(), [["A", "S1", nowSec() + 300]]));
    await read(stub, "S1");
    await settleRefresh(stub);

    const res = await read(stub, "NOPE");
    const body = await res.json<any>();
    expect(res.status).toBe(200);
    expect(body.arrivals).toEqual([]);
    expect(body.fetched_at).toBeGreaterThan(0);
  });

  it("missing feeds row: refresh marks config missing, reads 404, memo cleared", async () => {
    const stub = stubFor("ghost-feed:ace");
    const res = await read(stub, "S1", "ghost-feed");
    expect(res.status).toBe(200); // first read is still the no-data contract
    await settleRefresh(stub);

    await runInDurableObject(stub, (instance: FeedDO) => {
      expect((instance as any).configMissing).toBe(true);
      expect((instance as any).configPromise).toBeNull(); // rejection cleared the memo
    });
    const after = await read(stub, "S1", "ghost-feed");
    expect(after.status).toBe(404);
    expect((await after.json<any>()).error).toMatch(/unknown feed/);
  });

  it("read-time filter drops past arrivals with the same >= now boundary", async () => {
    const stub = stubFor("mta-subway:ace#past");
    await runInDurableObject(stub, async (instance: FeedDO, state) => {
      const snapshot = {
        arrivals: { S1: [{ routeId: "A", time: nowSec() - 10 }, { routeId: "A", time: nowSec() + 120 }] },
        fetchedAtMs: Date.now(),
        headerTimestamp: nowSec(),
      };
      (instance as any).snapshot = snapshot;
      await state.storage.put("snapshot", snapshot);
      await state.storage.setAlarm(Date.now() + 20_000);
    });
    const body = await (await read(stub, "S1")).json<any>();
    expect(body.arrivals).toHaveLength(1);
    expect(body.arrivals[0].time).toBeGreaterThanOrEqual(nowSec());
  });
});

describe("trimPerRoute", () => {
  it("keeps 8 per route so infrequent routes are not starved (per-route floor)", () => {
    const base = 1000;
    const arrivals = [
      ...Array.from({ length: 12 }, (_, i) => ({ routeId: "A", time: base + i * 10 })),
      ...Array.from({ length: 10 }, (_, i) => ({ routeId: "F", time: base + 5 + i * 40 })),
    ].sort((a, b) => a.time - b.time);

    const trimmed = trimPerRoute(new Map([["S1", arrivals]]));
    const byRoute = (route: string) => trimmed.S1.filter((a) => a.routeId === route);
    expect(byRoute("A")).toHaveLength(8);
    expect(byRoute("F")).toHaveLength(8); // not starved by the frequent A
    for (let i = 1; i < trimmed.S1.length; i++) {
      expect(trimmed.S1[i].time).toBeGreaterThanOrEqual(trimmed.S1[i - 1].time);
    }
  });
});

describe("batch stop reads", () => {
  it("returns every requested id with filtered arrivals and one shared fetched_at", async () => {
    const now = nowSec();
    mockFeedOnce(
      "/gtfs-ace",
      encodeFeed(now, [
        ["A", "A41N", now + 120],
        ["A", "A41S", now + 300],
      ]),
    );
    const stub = stubFor("mta-subway:ace-batch");
    await read(stub, "A41N"); // arm + refresh
    await settleRefresh(stub);

    const res = await stub.fetch("https://do/stops?ids=A41N,A41S,MISSING&feed=mta-subway&group=ace");
    const body = await res.json<any>();
    expect(body.fetched_at).toBeGreaterThan(0);
    expect(body.stops.A41N).toHaveLength(1);
    expect(body.stops.A41S).toHaveLength(1);
    expect(body.stops.MISSING).toEqual([]);
    assertNoPendingMocks();
  });

  it("honors the first-read contract: fetched_at null with empty lists", async () => {
    mockFeedOnce("/gtfs-ace", encodeFeed(nowSec(), []));
    const stub = stubFor("mta-subway:ace-batch-first");
    const res = await stub.fetch("https://do/stops?ids=A41N,A41S&feed=mta-subway&group=ace");
    const body = await res.json<any>();
    expect(body.fetched_at).toBeNull();
    expect(body.stops).toEqual({ A41N: [], A41S: [] });
    await settleRefresh(stub); // consume the armed refresh's mock
    assertNoPendingMocks();
  });

  it("rejects a batch read missing feed/group params", async () => {
    const stub = stubFor("mta-subway:ace-batch-bad");
    const res = await stub.fetch("https://do/stops?ids=A41N");
    expect(res.status).toBe(400);
  });
});

describe("batch read hardening", () => {
  it("keeps prototype-named stop ids as own keys", async () => {
    const now = nowSec();
    mockFeedOnce("/gtfs-ace", encodeFeed(now, [["A", "__proto__", now + 120]]));
    const stub = stubFor("mta-subway:ace-proto");
    await read(stub, "__proto__");
    await settleRefresh(stub);

    const res = await stub.fetch(
      "https://do/stops?ids=__proto__,constructor&feed=mta-subway&group=ace",
    );
    const body = await res.json<any>();
    expect(Array.isArray(body.stops.__proto__)).toBe(true);
    expect(body.stops.__proto__).toHaveLength(1);
    expect(body.stops.constructor).toEqual([]); // own key, not Object's
    assertNoPendingMocks();
  });

  it("round-trips a stop id containing the ',' separator", async () => {
    const now = nowSec();
    mockFeedOnce("/gtfs-ace", encodeFeed(now, [["A", "odd,idN", now + 90]]));
    const stub = stubFor("mta-subway:ace-comma");
    await read(stub, "x");
    await settleRefresh(stub);

    const res = await stub.fetch(
      `https://do/stops?ids=${encodeURIComponent("odd,idN")}&feed=mta-subway&group=ace`,
    );
    const body = await res.json<any>();
    expect(body.stops["odd,idN"]).toHaveLength(1);
    assertNoPendingMocks();
  });
});

// ---------- chunked snapshot persistence (bus scale) ----------

const META_KEY = "snapshot_meta";
const CHUNK_PREFIX = "snapshot_chunk:";
const KV_VALUE_LIMIT = 128 * 1024;

/** Compressible snapshot around a target JSON size (repetitive arrivals). */
function makeSnapshot(targetBytes: number, salt = "x"): any {
  const arrivals: Record<string, any[]> = {};
  let size = 0;
  let i = 0;
  while (size < targetBytes) {
    const stopId = `S${salt}${i++}`;
    arrivals[stopId] = [
      { routeId: "B62", time: 1_785_000_000 + i, directionId: i % 2 },
      { routeId: "Q54", time: 1_785_000_100 + i, directionId: (i + 1) % 2 },
    ];
    size += 90; // rough per-stop JSON cost; exactness doesn't matter
  }
  return { arrivals, fetchedAtMs: 1_785_000_000_000, headerTimestamp: 1_785_000_000 };
}

/** Incompressible snapshot (random hex defeats gzip) for ceiling tests. */
function makeIncompressibleSnapshot(targetBytes: number): any {
  const arrivals: Record<string, any[]> = {};
  const words = new Uint32Array(1024);
  let size = 0;
  let i = 0;
  while (size < targetBytes) {
    crypto.getRandomValues(words);
    const blob = [...words].map((w) => w.toString(36)).join("");
    arrivals[`R${i++}${blob.slice(0, 8)}`] = [{ routeId: blob.slice(0, 6000), time: 1 }];
    size += 6100;
  }
  return { arrivals, fetchedAtMs: 1, headerTimestamp: 1 };
}

async function persistIn(stub: DurableObjectStub<FeedDO>, snapshot: any): Promise<void> {
  await runInDurableObject(stub, async (instance: FeedDO) => {
    (instance as any).identity = { feedId: "mta-bus", group: "all" };
    await (instance as any).persistSnapshot(snapshot);
  });
}

async function storageState(stub: DurableObjectStub<FeedDO>) {
  return runInDurableObject(stub, async (_i, state) => {
    const legacy = await state.storage.get("snapshot");
    const meta = (await state.storage.get(META_KEY)) as any;
    const chunkKeys = [...(await state.storage.list({ prefix: CHUNK_PREFIX })).keys()];
    return { legacy, meta, chunkKeys };
  });
}

async function restoreIn(stub: DurableObjectStub<FeedDO>): Promise<any> {
  return runInDurableObject(stub, async (instance: FeedDO, state) => {
    const meta = await state.storage.get(META_KEY);
    if (!meta) return (await state.storage.get("snapshot")) ?? null;
    return (instance as any).restoreChunked(meta);
  });
}

describe("FeedDO — chunked snapshot persistence", () => {
  it("oversized snapshot gzips, chunks, restores equal, and leaves no legacy key (AE3)", async () => {
    const stub = stubFor("mta-bus:all#chunk-roundtrip");
    const snapshot = makeSnapshot(2_600_000);
    await persistIn(stub, snapshot);

    const { legacy, meta, chunkKeys } = await storageState(stub);
    expect(legacy).toBeUndefined();
    expect(meta.encoding).toBe("gzip");
    expect(meta.chunks).toBeGreaterThan(0);
    expect(chunkKeys).toHaveLength(meta.chunks);
    const restored = await restoreIn(stub);
    expect(restored).toEqual(snapshot);
  });

  it("small snapshot keeps the legacy single-key format (subway regression)", async () => {
    const stub = stubFor("mta-bus:all#legacy");
    const snapshot = makeSnapshot(10_000);
    await persistIn(stub, snapshot);

    const { legacy, meta, chunkKeys } = await storageState(stub);
    expect(legacy).toEqual(snapshot);
    expect(meta).toBeUndefined();
    expect(chunkKeys).toEqual([]);
    expect(await restoreIn(stub)).toEqual(snapshot);
  });

  it("shrinking within chunked format leaves no surplus chunk keys", async () => {
    const stub = stubFor("mta-bus:all#shrink");
    await persistIn(stub, makeIncompressibleSnapshot(1_200_000));
    const big = await storageState(stub);
    const smaller = makeIncompressibleSnapshot(400_000);
    await persistIn(stub, smaller);

    const state = await storageState(stub);
    expect(state.meta.chunks).toBeLessThan(big.meta.chunks);
    expect(state.chunkKeys).toHaveLength(state.meta.chunks);
    expect(await restoreIn(stub)).toEqual(smaller);
  });

  it("chunked-to-legacy crossing deletes meta and all chunk keys", async () => {
    const stub = stubFor("mta-bus:all#crossing");
    await persistIn(stub, makeSnapshot(2_600_000));
    const small = makeSnapshot(8_000, "y");
    await persistIn(stub, small);

    const { legacy, meta, chunkKeys } = await storageState(stub);
    expect(legacy).toEqual(small);
    expect(meta).toBeUndefined();
    expect(chunkKeys).toEqual([]);
    expect(await restoreIn(stub)).toEqual(small);
  });

  it("torn chunked state restores as no-snapshot and deletes the bad keys", async () => {
    const stub = stubFor("mta-bus:all#torn");
    await persistIn(stub, makeSnapshot(2_600_000));
    await runInDurableObject(stub, (_i, state) => state.storage.delete(`${CHUNK_PREFIX}1`));

    expect(await restoreIn(stub)).toBeNull();
    const { meta, chunkKeys } = await storageState(stub);
    expect(meta).toBeUndefined();
    expect(chunkKeys).toEqual([]);
  });

  it("torn restore: a truncated chunk (bytes short of meta) clears and recovers", async () => {
    const stub = stubFor("mta-bus:all#torn-short");
    await persistIn(stub, makeSnapshot(2_600_000));
    await runInDurableObject(stub, (_i, state) =>
      state.storage.put(`${CHUNK_PREFIX}1`, new ArrayBuffer(16)),
    );

    expect(await restoreIn(stub)).toBeNull();
    const { meta, chunkKeys } = await storageState(stub);
    expect(meta).toBeUndefined();
    expect(chunkKeys).toEqual([]);
  });

  it("torn restore: corrupt gzip bytes with correct lengths clears and recovers", async () => {
    const stub = stubFor("mta-bus:all#torn-corrupt");
    await persistIn(stub, makeSnapshot(2_600_000));
    await runInDurableObject(stub, async (_i, state) => {
      const original = (await state.storage.get(`${CHUNK_PREFIX}0`)) as ArrayBuffer;
      const garbage = new Uint8Array(original.byteLength);
      crypto.getRandomValues(garbage.subarray(0, Math.min(garbage.length, 65536)));
      await state.storage.put(`${CHUNK_PREFIX}0`, garbage.buffer);
    });

    expect(await restoreIn(stub)).toBeNull(); // length checks pass; gunzip fails
    const { meta, chunkKeys } = await storageState(stub);
    expect(meta).toBeUndefined();
    expect(chunkKeys).toEqual([]);
  });

  it("splits by serialized bytes, never characters: every chunk fits the KV limit", async () => {
    const stub = stubFor("mta-bus:all#multibyte");
    // Non-ASCII-heavy payload: UTF-8 bytes ≈ 3× UTF-16 length — a char-based
    // split would produce over-limit values here.
    const arrivals: Record<string, any[]> = {};
    for (let i = 0; i < 4000; i++) {
      arrivals[`停留所${i}`] = [{ routeId: `路線${"号".repeat(120)}${i}`, time: 1_785_000_000 + i }];
    }
    const snapshot = { arrivals, fetchedAtMs: 1, headerTimestamp: 1 };
    await persistIn(stub, snapshot);

    await runInDurableObject(stub, async (_i, state) => {
      const chunks = await state.storage.list({ prefix: CHUNK_PREFIX });
      for (const value of chunks.values()) {
        expect((value as ArrayBuffer).byteLength).toBeLessThanOrEqual(KV_VALUE_LIMIT);
      }
    });
    expect(await restoreIn(stub)).toEqual(snapshot);
  });

  it("refuses a snapshot beyond the chunk ceiling, keeping the previous persisted state", async () => {
    const stub = stubFor("mta-bus:all#ceiling");
    const previous = makeSnapshot(20_000, "prev");
    await persistIn(stub, previous);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // ~20 MB semi-compressible → compressed stays > MAX_CHUNKS × 90 KiB.
      await persistIn(stub, makeIncompressibleSnapshot(20_000_000));
      expect(errors).toHaveBeenCalledOnce();
      expect(String(errors.mock.calls[0][0])).toContain(`max ${MAX_CHUNKS}`);
    } finally {
      errors.mockRestore();
    }
    expect(await restoreIn(stub)).toEqual(previous);
  });
});

// ---------- rt_needs_key fetch injection ----------

describe("FeedDO — keyed fetch", () => {
  const KEY = "sekret-abc123";

  beforeEach(async () => {
    resetFeedKeysForTests();
    await env.DB.prepare(
      "INSERT OR REPLACE INTO feeds (id, rt_trip_url, adapter, rt_needs_key) VALUES ('kf-feed', ?, 'gtfs_rt', 1)",
    )
      .bind(`${ORIGIN}/bus`)
      .run();
  });

  afterEach(() => {
    (env as any).RT_FEED_KEYS = undefined;
    resetFeedKeysForTests();
  });

  function readBus(stub: DurableObjectStub<FeedDO>) {
    return stub.fetch("https://do/stop/S1?feed=kf-feed&group=all");
  }

  it("appends the key from RT_FEED_KEYS to the upstream URL", async () => {
    (env as any).RT_FEED_KEYS = JSON.stringify({ "kf-feed": KEY });
    const stub = stubFor("kf-feed:all#keyed");
    // The mock is keyed by exact URL — consuming it proves the key rode along.
    mockFeedOnce(`/bus?key=${KEY}`, encodeFeed(nowSec(), [["B62", "S1", nowSec() + 300]]));

    await readBus(stub);
    await settleRefresh(stub);
    const body = await (await readBus(stub)).json<any>();
    expect(body.arrivals).toHaveLength(1);
  });

  it("polls keyless with a warning when no key entry exists (AE4)", async () => {
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const stub = stubFor("kf-feed:all#keyless");
      mockFeedOnce("/bus", encodeFeed(nowSec(), [["B62", "S1", nowSec() + 300]]));

      await readBus(stub);
      await settleRefresh(stub);
      const body = await (await readBus(stub)).json<any>();
      expect(body.arrivals).toHaveLength(1);
      const keylessWarns = warns.mock.calls.filter((c) => String(c[0]).includes("polling keyless"));
      expect(keylessWarns).toHaveLength(1);
    } finally {
      warns.mockRestore();
    }
  });

  it("treats a malformed RT_FEED_KEYS exactly like a missing one, leaking nothing", async () => {
    (env as any).RT_FEED_KEYS = '{"kf-feed": "oops-trailing",}';
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(feedKeys(env)).toEqual({});
      const stub = stubFor("kf-feed:all#badsecret");
      mockFeedOnce("/bus", encodeFeed(nowSec(), [["B62", "S1", nowSec() + 300]]));
      await readBus(stub);
      await settleRefresh(stub);
      const body = await (await readBus(stub)).json<any>();
      expect(body.arrivals).toHaveLength(1);
      for (const call of warns.mock.calls) {
        expect(call.map(String).join(" ")).not.toContain("oops-trailing");
      }
    } finally {
      warns.mockRestore();
    }
  });

  it("flags a keyless 401 as probable enforcement onset", async () => {
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const stub = stubFor("kf-feed:all#enforced");
      mockFeedOnce("/bus", "denied", 0, 401);
      await readBus(stub);
      await settleRefresh(stub);
      const flagged = warns.mock.calls.filter((c) => String(c[0]).includes("enforcement"));
      expect(flagged).toHaveLength(1);
    } finally {
      warns.mockRestore();
    }
  });

  it("scrubs error-path logs for keyed fetches (the URL embeds the key)", async () => {
    (env as any).RT_FEED_KEYS = JSON.stringify({ "kf-feed": KEY });
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const stub = stubFor("kf-feed:all#scrub");
      // No mock for the keyed URL: the stub fetch throws an error whose
      // message CONTAINS the full URL (and therefore the key).
      await readBus(stub);
      await settleRefresh(stub);
      for (const call of warns.mock.calls) {
        expect(call.map(String).join(" ")).not.toContain(KEY);
      }
      const scrubbed = warns.mock.calls.filter((c) => String(c[0]).includes("error scrubbed"));
      expect(scrubbed).toHaveLength(1);
    } finally {
      warns.mockRestore();
    }
  });
});
