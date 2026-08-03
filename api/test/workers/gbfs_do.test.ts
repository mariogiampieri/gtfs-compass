import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GbfsDO } from "../../src/gbfs_do";
import { IDLE_SUSPEND_MS } from "../../src/do_shared";

const ORIGIN = "https://gbfs.example";
const STATUS_PATH = "/station_status.json";
const STATUS_URL = `${ORIGIN}${STATUS_PATH}`;

/** Raw station_status entry, GBFS 2.3 shape (Citi Bike). */
interface StationFixture {
  station_id: string;
  classic?: number;
  electric?: number;
  docks?: number;
  is_renting?: number;
  /** The legacy field — intentionally settable to disagree with the split. */
  num_ebikes_available?: number;
}

function station(fixture: StationFixture): Record<string, unknown> {
  const { station_id, classic = 0, electric = 0, docks = 0, is_renting = 1 } = fixture;
  return {
    station_id,
    num_bikes_available: classic + electric,
    num_ebikes_available: fixture.num_ebikes_available ?? electric,
    num_docks_available: docks,
    is_renting,
    is_installed: 1,
    is_returning: 1,
    vehicle_types_available: [
      { vehicle_type_id: "1", count: classic },
      { vehicle_type_id: "2", count: electric },
    ],
  };
}

function encodeStatus(lastUpdated: number, stations: Record<string, unknown>[]): string {
  return JSON.stringify({
    data: { stations },
    last_updated: lastUpdated,
    ttl: 60,
    version: "2.3",
  });
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function stubFor(name: string) {
  return env.GBFS_DO.get(env.GBFS_DO.idFromName(name));
}

function readStation(stub: DurableObjectStub<GbfsDO>, stationId: string, feed = "citibike", group = "all") {
  return stub.fetch(`https://do/station/${stationId}?feed=${feed}&group=${group}`);
}

function readStations(stub: DurableObjectStub<GbfsDO>, ids: string[], feed = "citibike", group = "all") {
  return stub.fetch(`https://do/stations?ids=${ids.join(",")}&feed=${feed}&group=${group}`);
}

/** Wait until the DO's background refresh settles. */
async function settleRefresh(stub: DurableObjectStub<GbfsDO>) {
  await runInDurableObject(stub, async (instance: GbfsDO) => {
    for (let i = 0; i < 200 && (instance as any).refreshInFlight; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });
}

// Tests and DOs share one workerd isolate under vitest-pool-workers, so a
// global-fetch stub is the outbound seam (this pool version has no fetchMock).
// One-shot handlers; any unexpected outbound fetch throws (net "blocked").
type MockReply = { status: number; body: string; delayMs: number };
const pendingMocks = new Map<string, MockReply[]>();
const realFetch = globalThis.fetch;
let upstreamAttempts = 0; // counts every outbound try, even unmocked ones

function mockStatusOnce(body: string, delayMs = 0, status = 200) {
  const queue = pendingMocks.get(STATUS_URL) ?? [];
  queue.push({ status, body, delayMs });
  pendingMocks.set(STATUS_URL, queue);
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
    return new Response(reply.body, { status: reply.status });
  }) as typeof fetch;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS feeds (id TEXT PRIMARY KEY NOT NULL, rt_trip_url TEXT, adapter TEXT)",
  ).run();
  await env.DB.prepare(
    "INSERT OR REPLACE INTO feeds (id, rt_trip_url, adapter) VALUES ('citibike', ?, 'gbfs')",
  )
    .bind(STATUS_URL)
    .run();
});

afterEach(() => {
  try {
    assertNoPendingMocks();
  } finally {
    globalThis.fetch = realFetch;
  }
});

describe("GbfsDO", () => {
  it("first-ever read: fetched_at null, station null, refresh triggered", async () => {
    const stub = stubFor("citibike:all#first");
    mockStatusOnce(encodeStatus(nowSec(), [station({ station_id: "66db", classic: 3, electric: 2, docks: 10 })]));

    const res = await readStation(stub, "66db");
    const body = await res.json<any>();
    expect(body).toEqual({ fetched_at: null, station: null });

    await settleRefresh(stub);
    const second = await readStation(stub, "66db");
    const secondBody = await second.json<any>();
    expect(secondBody.fetched_at).toBeGreaterThan(0);
    expect(secondBody.station).toEqual({ classic: 3, electric: 2, docks: 10 });
  });

  it("first-ever batch read: fetched_at null, empty stations map", async () => {
    const stub = stubFor("citibike:all#first-batch");
    mockStatusOnce(encodeStatus(nowSec(), [station({ station_id: "a", classic: 1, docks: 5 })]));

    const res = await readStations(stub, ["a", "b"]);
    expect(await res.json<any>()).toEqual({ fetched_at: null, stations: {} });
    await settleRefresh(stub);
  });

  it("vehicle_types_available is the source of truth even when num_ebikes_available disagrees", async () => {
    const stub = stubFor("citibike:all#split");
    // Legacy field claims 5 e-bikes; the typed split says 2. The split wins.
    mockStatusOnce(
      encodeStatus(nowSec(), [
        station({ station_id: "s1", classic: 3, electric: 2, docks: 7, num_ebikes_available: 5 }),
        station({ station_id: "s2", classic: 0, electric: 4, docks: 0 }),
      ]),
    );
    await readStation(stub, "s1");
    await settleRefresh(stub);

    const s1 = (await (await readStation(stub, "s1")).json<any>()).station;
    expect(s1).toEqual({ classic: 3, electric: 2, docks: 7 });
    const s2 = (await (await readStation(stub, "s2")).json<any>()).station;
    expect(s2).toEqual({ classic: 0, electric: 4, docks: 0 });
  });

  it("is_renting 0 surfaces zero bikes while docks stay real", async () => {
    const stub = stubFor("citibike:all#renting");
    mockStatusOnce(
      encodeStatus(nowSec(), [station({ station_id: "off", classic: 6, electric: 3, docks: 11, is_renting: 0 })]),
    );
    await readStation(stub, "off");
    await settleRefresh(stub);

    const body = await (await readStation(stub, "off")).json<any>();
    expect(body.station).toEqual({ classic: 0, electric: 0, docks: 11 });
  });

  it("batch read returns requested stations and omits missing ids", async () => {
    const stub = stubFor("citibike:all#batch");
    mockStatusOnce(
      encodeStatus(nowSec(), [
        station({ station_id: "a", classic: 1, electric: 0, docks: 4 }),
        station({ station_id: "b", classic: 0, electric: 2, docks: 9 }),
        station({ station_id: "c", classic: 5, electric: 5, docks: 0 }),
      ]),
    );
    await readStation(stub, "a");
    await settleRefresh(stub);

    const body = await (await readStations(stub, ["a", "b", "nope"])).json<any>();
    expect(body.fetched_at).toBeGreaterThan(0);
    expect(body.stations).toEqual({
      a: { classic: 1, electric: 0, docks: 4 },
      b: { classic: 0, electric: 2, docks: 9 },
    });
    expect(Object.hasOwn(body.stations, "nope")).toBe(false);
  });

  it("one upstream fetch per window: two quick reads trigger exactly one fetch", async () => {
    const stub = stubFor("citibike:all#window");
    mockStatusOnce(encodeStatus(nowSec(), [station({ station_id: "s", classic: 1, docks: 2 })]));

    await readStation(stub, "s");
    await readStation(stub, "s"); // second read sees pending alarm, must not refetch
    await settleRefresh(stub);
    // Attempt count (not just queue drain): a swallowed unmocked-fetch throw
    // inside refresh() must not be able to hide a duplicate fetch.
    expect(upstreamAttempts).toBe(1);
  });

  it("read during a slow in-flight refresh does not double-fetch or regress (race)", async () => {
    const stub = stubFor("citibike:all#race");
    mockStatusOnce(encodeStatus(nowSec(), [station({ station_id: "s", classic: 1, docks: 2 })]), 150);

    const first = readStation(stub, "s"); // arms + starts slow refresh
    await first;
    const during = await readStation(stub, "s"); // lands mid-fetch
    expect((await during.json<any>()).fetched_at).toBeNull(); // still no data, no crash

    await settleRefresh(stub);
    const after = await readStation(stub, "s");
    expect((await after.json<any>()).station).toEqual({ classic: 1, electric: 0, docks: 2 });
    const pending = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(pending).not.toBeNull(); // exactly one pending alarm
  });

  it("self-suspends after 10 idle minutes and re-arms on the next read", async () => {
    const stub = stubFor("citibike:all#suspend");
    mockStatusOnce(encodeStatus(nowSec(), [station({ station_id: "s", classic: 1, docks: 2 })]));
    await readStation(stub, "s");
    await settleRefresh(stub);

    // Simulate 11 minutes of idleness (memory + storage, surviving hibernation).
    await runInDurableObject(stub, async (instance: GbfsDO, state) => {
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
    mockStatusOnce(encodeStatus(nowSec() + 60, [station({ station_id: "s", classic: 2, docks: 1 })]));
    await readStation(stub, "s");
    await settleRefresh(stub);
    const rearmed = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(rearmed).not.toBeNull();
  });

  it("serves a stored snapshot without any upstream call", async () => {
    const stub = stubFor("citibike:all#warm");
    const staleFetchedAt = Date.now() - 5 * 60_000;
    await runInDurableObject(stub, async (instance: GbfsDO, state) => {
      const snapshot = {
        stations: { s: { classic: 4, electric: 1, docks: 3 } },
        fetchedAtMs: staleFetchedAt,
        lastUpdated: nowSec() - 300,
      };
      (instance as any).snapshot = snapshot;
      await state.storage.put("snapshot", snapshot);
      await state.storage.setAlarm(Date.now() + 60_000); // pending alarm: read must not re-arm/refresh
    });

    const res = await readStation(stub, "s");
    const body = await res.json<any>();
    expect(body.fetched_at).toBe(Math.floor(staleFetchedAt / 1000)); // honest stale stamp
    expect(body.station).toEqual({ classic: 4, electric: 1, docks: 3 }); // served with net connect disabled
  });

  it("upstream 500 during alarm keeps old snapshot, reschedules (never-throws)", async () => {
    const stub = stubFor("citibike:all#err");
    mockStatusOnce(encodeStatus(nowSec(), [station({ station_id: "s", classic: 1, docks: 2 })]));
    await readStation(stub, "s");
    await settleRefresh(stub);
    const before = await (await readStation(stub, "s")).json<any>();

    mockStatusOnce("boom", 0, 500);
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await settleRefresh(stub);

    const after = await (await readStation(stub, "s")).json<any>();
    expect(after.fetched_at).toBe(before.fetched_at); // unchanged
    const pending = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(pending).not.toBeNull(); // loop still armed
  });

  it("frozen last_updated across two cycles is treated as a failed fetch", async () => {
    const stub = stubFor("citibike:all#frozen");
    const lastUpdated = nowSec();
    mockStatusOnce(encodeStatus(lastUpdated, [station({ station_id: "s", classic: 1, docks: 9 })]));
    await readStation(stub, "s");
    await settleRefresh(stub);
    const before = await (await readStation(stub, "s")).json<any>();

    // Same last_updated: content pretends to be new, generator is stuck.
    mockStatusOnce(encodeStatus(lastUpdated, [station({ station_id: "s", classic: 8, docks: 2 })]));
    await runDurableObjectAlarm(stub);
    await settleRefresh(stub);

    const after = await (await readStation(stub, "s")).json<any>();
    expect(after.fetched_at).toBe(before.fetched_at); // visibly stale, not re-stamped
    expect(after.station).toEqual(before.station); // old counts kept
  });

  it("malformed JSON upstream keeps old snapshot, loop stays armed", async () => {
    const stub = stubFor("citibike:all#garbage");
    mockStatusOnce(encodeStatus(nowSec(), [station({ station_id: "s", classic: 1, docks: 2 })]));
    await readStation(stub, "s");
    await settleRefresh(stub);
    const before = await (await readStation(stub, "s")).json<any>();

    mockStatusOnce("{not json"); // ParseError path
    await runDurableObjectAlarm(stub);
    await settleRefresh(stub);
    mockStatusOnce(JSON.stringify({ last_updated: nowSec() + 120, ttl: 60 })); // missing data key
    await runDurableObjectAlarm(stub);
    await settleRefresh(stub);

    const after = await (await readStation(stub, "s")).json<any>();
    expect(after.fetched_at).toBe(before.fetched_at);
    expect(after.station).toEqual(before.station);
    const pending = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(pending).not.toBeNull();
  });

  it("duplicate alarm invocations single-flight the refresh", async () => {
    const stub = stubFor("citibike:all#dup");
    mockStatusOnce(encodeStatus(nowSec(), [station({ station_id: "s", classic: 1, docks: 2 })]));
    await readStation(stub, "s");
    await settleRefresh(stub);

    mockStatusOnce(encodeStatus(nowSec() + 60, [station({ station_id: "s", classic: 2, docks: 1 })]));
    const before = upstreamAttempts;
    await runInDurableObject(stub, async (instance: GbfsDO) => {
      await Promise.all([instance.alarm(), instance.alarm()]); // at-least-once duplicate
    });
    expect(upstreamAttempts - before).toBe(1); // single-flight: exactly one attempt
    const pending = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(pending).not.toBeNull();
  });

  it("station ids colliding with Object.prototype keys are safe", async () => {
    const stub = stubFor("citibike:all#proto");
    await runInDurableObject(stub, async (instance: GbfsDO, state) => {
      const snapshot = {
        stations: { s: { classic: 1, electric: 0, docks: 2 } },
        fetchedAtMs: Date.now(),
        lastUpdated: nowSec(),
      };
      (instance as any).snapshot = snapshot;
      await state.storage.put("snapshot", snapshot);
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    for (const evil of ["constructor", "__proto__", "toString"]) {
      const res = await readStation(stub, evil);
      expect(res.status).toBe(200);
      expect((await res.json<any>()).station).toBeNull();
      const batch = await readStations(stub, [evil, "s"]);
      expect((await batch.json<any>()).stations).toEqual({ s: { classic: 1, electric: 0, docks: 2 } });
    }
  });

  it("unknown station returns null station with real fetched_at (no-station fact)", async () => {
    const stub = stubFor("citibike:all#unknown");
    mockStatusOnce(encodeStatus(nowSec(), [station({ station_id: "s", classic: 1, docks: 2 })]));
    await readStation(stub, "s");
    await settleRefresh(stub);

    const res = await readStation(stub, "NOPE");
    const body = await res.json<any>();
    expect(res.status).toBe(200);
    expect(body.station).toBeNull();
    expect(body.fetched_at).toBeGreaterThan(0);
  });

  it("missing feeds row: refresh marks config missing, reads 404, memo cleared", async () => {
    const stub = stubFor("ghost-gbfs:all");
    const res = await readStation(stub, "s", "ghost-gbfs");
    expect(res.status).toBe(200); // first read is still the no-data contract
    await settleRefresh(stub);

    await runInDurableObject(stub, (instance: GbfsDO) => {
      expect((instance as any).configMissing).toBe(true);
      expect((instance as any).configPromise).toBeNull(); // rejection cleared the memo
    });
    const after = await readStation(stub, "s", "ghost-gbfs");
    expect(after.status).toBe(404);
    expect((await after.json<any>()).error).toMatch(/unknown feed/);
  });

  it("configMissing recovers once the feeds row appears", async () => {
    const stub = stubFor("late-gbfs:all");
    await readStation(stub, "s", "late-gbfs"); // arms; refresh hits MissingFeedError
    await settleRefresh(stub);
    expect((await readStation(stub, "s", "late-gbfs")).status).toBe(404); // pinned missing

    await env.DB.prepare(
      "INSERT OR REPLACE INTO feeds (id, rt_trip_url, adapter) VALUES ('late-gbfs', ?, 'gbfs')",
    )
      .bind(STATUS_URL)
      .run();
    mockStatusOnce(encodeStatus(nowSec(), [station({ station_id: "s", classic: 1, docks: 2 })]));
    const ran = await runDurableObjectAlarm(stub); // alarm still armed; retries config
    expect(ran).toBe(true);
    await settleRefresh(stub);

    const recovered = await readStation(stub, "s", "late-gbfs");
    expect(recovered.status).toBe(200); // sticky-404 bug would fail here
    expect((await recovered.json<any>()).station).toEqual({ classic: 1, electric: 0, docks: 2 });
  });

  it("rejects requests missing route or identity params", async () => {
    const stub = stubFor("citibike:all#bad");
    expect((await stub.fetch("https://do/station/s")).status).toBe(400); // no feed/group
    expect((await stub.fetch("https://do/stations?feed=citibike&group=all")).status).toBe(400); // no ids
    expect((await stub.fetch("https://do/nope?feed=citibike&group=all")).status).toBe(400); // unknown path
  });
});
