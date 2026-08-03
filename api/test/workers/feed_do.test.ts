import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { transit_realtime } from "../../src/gen/gtfs-realtime.js";
import { FeedDO, IDLE_SUSPEND_MS, trimPerRoute } from "../../src/feed_do";

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
    "CREATE TABLE IF NOT EXISTS feeds (id TEXT PRIMARY KEY NOT NULL, rt_trip_url TEXT, adapter TEXT)",
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
  it("keeps 4 per route so infrequent routes are not starved (per-route floor)", () => {
    const base = 1000;
    const arrivals = [
      ...Array.from({ length: 8 }, (_, i) => ({ routeId: "A", time: base + i * 10 })),
      { routeId: "F", time: base + 5 },
      { routeId: "F", time: base + 45 },
      { routeId: "F", time: base + 85 },
      { routeId: "F", time: base + 125 },
      { routeId: "F", time: base + 165 },
    ].sort((a, b) => a.time - b.time);

    const trimmed = trimPerRoute(new Map([["S1", arrivals]]));
    const byRoute = (route: string) => trimmed.S1.filter((a) => a.routeId === route);
    expect(byRoute("A")).toHaveLength(4);
    expect(byRoute("F")).toHaveLength(4); // not starved by the frequent A
    for (let i = 1; i < trimmed.S1.length; i++) {
      expect(trimmed.S1[i].time).toBeGreaterThanOrEqual(trimmed.S1[i - 1].time);
    }
  });
});
