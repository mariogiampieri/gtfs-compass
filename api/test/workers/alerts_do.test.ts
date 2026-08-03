import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AlertDO } from "../../src/alerts_do";

const ALERTS_URL = "https://alerts.example/subway-alerts.json";
const MERCURY = "transit_realtime.mercury_alert";

// ---------- fixtures ----------

interface AlertFixture {
  routes?: string[];
  agency?: boolean;
  alertType?: string;
  text?: string;
  periods?: { start?: number; end?: number }[];
  stops?: string[];
  updatedAt?: number;
}

function alertEntity(f: AlertFixture, i = 0): Record<string, unknown> {
  const informed: Record<string, unknown>[] = [];
  for (const r of f.routes ?? []) informed.push({ route_id: r });
  for (const s of f.stops ?? []) informed.push({ route_id: f.routes?.[0], stop_id: s });
  if (f.agency) informed.push({ agency_id: "MTASBWY" });
  return {
    id: `lmm:alert:${i}`,
    alert: {
      informed_entity: informed,
      active_period: f.periods ?? [],
      header_text: { translation: [{ language: "en", text: f.text ?? "Trains delayed" }] },
      [MERCURY]: { alert_type: f.alertType ?? "Delays", updated_at: f.updatedAt ?? 1785700000 },
    },
  };
}

function encodeAlerts(headerTimestamp: number, fixtures: AlertFixture[]): string {
  return JSON.stringify({
    header: { timestamp: headerTimestamp },
    entity: fixtures.map((f, i) => alertEntity(f, i)),
  });
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function stubFor(name: string) {
  return env.ALERT_DO.get(env.ALERT_DO.idFromName(name));
}

function readRoutes(stub: DurableObjectStub<AlertDO>, ids: string[], feed = "mta-subway") {
  return stub.fetch(`https://do/routes?ids=${ids.join(",")}&feed=${feed}&group=alerts`);
}

/** Wait until the DO's background refresh settles. */
async function settleRefresh(stub: DurableObjectStub<AlertDO>) {
  await runInDurableObject(stub, async (instance: AlertDO) => {
    for (let i = 0; i < 200 && (instance as any).refreshInFlight; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });
}

// ---------- outbound fetch stub (same seam as the sibling DO suites) ----------

type MockReply = { status: number; body: string; delayMs: number };
const pendingMocks: MockReply[] = [];
const realFetch = globalThis.fetch;
let upstreamAttempts = 0;

function mockAlertsOnce(body: string, delayMs = 0, status = 200) {
  pendingMocks.push({ status, body, delayMs });
}

function assertNoPendingMocks() {
  expect(pendingMocks, "expected every mocked upstream fetch to be consumed").toEqual([]);
}

beforeEach(async () => {
  pendingMocks.length = 0;
  upstreamAttempts = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    upstreamAttempts++;
    const url = input instanceof Request ? input.url : String(input);
    if (url !== ALERTS_URL) throw new Error(`unmocked outbound fetch: ${url}`);
    const reply = pendingMocks.shift();
    if (!reply) throw new Error(`unmocked alerts fetch (queue empty)`);
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    return new Response(reply.body, { status: reply.status });
  }) as typeof fetch;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS feeds (id TEXT PRIMARY KEY NOT NULL, rt_trip_url TEXT, rt_alert_url TEXT, adapter TEXT)",
  ).run();
  await env.DB.prepare(
    "INSERT OR REPLACE INTO feeds (id, rt_alert_url, adapter) VALUES ('mta-subway', ?, 'nyct')",
  )
    .bind(ALERTS_URL)
    .run();
});

afterEach(() => {
  try {
    assertNoPendingMocks();
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------- tests ----------

describe("AlertDO", () => {
  it("first-ever read: fetched_at null, every requested id present, refresh triggered", async () => {
    const stub = stubFor("mta-subway:alerts#first");
    mockAlertsOnce(encodeAlerts(nowSec(), [{ routes: ["A"] }]));

    const res = await readRoutes(stub, ["A", "C"]);
    const body = await res.json<any>();
    expect(body.fetched_at).toBeNull();
    expect(body.routes).toEqual({ A: [], C: [] });

    await settleRefresh(stub);
    const warm = await (await readRoutes(stub, ["A", "C"])).json<any>();
    expect(warm.fetched_at).toBeGreaterThan(0);
    expect(warm.routes.A).toHaveLength(1);
    expect(warm.routes.A[0].severity).toBe("delay");
    expect(warm.routes.C).toEqual([]); // requested id always present
  });

  it("one upstream fetch per window: two quick reads trigger exactly one fetch", async () => {
    const stub = stubFor("mta-subway:alerts#window");
    mockAlertsOnce(encodeAlerts(nowSec(), [{ routes: ["A"] }]));
    await readRoutes(stub, ["A"]);
    await readRoutes(stub, ["A"]);
    await settleRefresh(stub);
    expect(upstreamAttempts).toBe(1);
  });

  it("filters to active-now at read time with the DO's clock", async () => {
    const stub = stubFor("mta-subway:alerts#active");
    const now = nowSec();
    mockAlertsOnce(
      encodeAlerts(now, [
        { routes: ["A"], text: "current", periods: [{ start: now - 100, end: now + 100 }] },
        { routes: ["A"], text: "future", periods: [{ start: now + 3600 }] },
        { routes: ["A"], text: "expired", periods: [{ start: now - 200, end: now - 100 }] },
        { routes: ["A"], text: "always" }, // no periods
      ]),
    );
    await readRoutes(stub, ["A"]);
    await settleRefresh(stub);
    const body = await (await readRoutes(stub, ["A"])).json<any>();
    expect(body.routes.A.map((a: any) => a.text).sort()).toEqual(["always", "current"]);
  });

  it("window opening between polls appears on read without a new fetch", async () => {
    const stub = stubFor("mta-subway:alerts#boundary");
    const now = nowSec();
    // Window opens 1 second from now; snapshot is fetched once, before it opens.
    mockAlertsOnce(encodeAlerts(now, [{ routes: ["A"], text: "imminent", periods: [{ start: now + 1 }] }]));
    await readRoutes(stub, ["A"]);
    await settleRefresh(stub);
    const before = await (await readRoutes(stub, ["A"])).json<any>();
    expect(before.routes.A).toEqual([]); // not yet active
    await new Promise((r) => setTimeout(r, 1100));
    const after = await (await readRoutes(stub, ["A"])).json<any>();
    expect(after.routes.A.map((a: any) => a.text)).toEqual(["imminent"]); // same snapshot, no refetch
    expect(upstreamAttempts).toBe(1);
  });

  it("includes the agency-wide sentinel only when it carries active alerts", async () => {
    const stub = stubFor("mta-subway:alerts#agency");
    mockAlertsOnce(encodeAlerts(nowSec(), [{ agency: true, text: "System suspended" }, { routes: ["A"] }]));
    await readRoutes(stub, ["A"]);
    await settleRefresh(stub);
    const body = await (await readRoutes(stub, ["A"])).json<any>();
    expect(body.routes["*"].map((a: any) => a.text)).toEqual(["System suspended"]);

    const quiet = stubFor("mta-subway:alerts#agency-quiet");
    mockAlertsOnce(encodeAlerts(nowSec(), [{ routes: ["A"] }]));
    await readRoutes(quiet, ["A"]);
    await settleRefresh(quiet);
    const quietBody = await (await readRoutes(quiet, ["A"])).json<any>();
    expect("*" in quietBody.routes).toBe(false);
  });

  it("unchanged header keeps the content but refreshes the staleness stamp", async () => {
    // Deliberate divergence from the sibling gate: the Mercury timestamp only
    // advances on content change, so an unchanged 200 is healthy steady
    // state — the stamp must advance or the 30-min horizon nulls quiet nights.
    const stub = stubFor("mta-subway:alerts#frozen");
    const t = nowSec();
    mockAlertsOnce(encodeAlerts(t, [{ routes: ["A"], text: "one" }]));
    await readRoutes(stub, ["A"]);
    await settleRefresh(stub);
    const firstMs = await runInDurableObject(stub, (i: AlertDO) => (i as any).snapshot.fetchedAtMs);

    mockAlertsOnce(encodeAlerts(t, [{ routes: ["A"], text: "two" }])); // same timestamp
    await runDurableObjectAlarm(stub);
    await settleRefresh(stub);
    const second = await (await readRoutes(stub, ["A"])).json<any>();
    const secondMs = await runInDurableObject(stub, (i: AlertDO) => (i as any).snapshot.fetchedAtMs);
    expect(secondMs).toBeGreaterThan(firstMs); // stamp refreshed (ms precision)
    expect(second.routes.A.map((a: any) => a.text)).toEqual(["one"]); // content kept
  });

  it("single-flights a read landing during a slow in-flight refresh", async () => {
    const stub = stubFor("mta-subway:alerts#race");
    mockAlertsOnce(encodeAlerts(nowSec(), [{ routes: ["A"] }]), 150);
    await readRoutes(stub, ["A"]); // arms + starts slow refresh
    const during = await (await readRoutes(stub, ["A"])).json<any>(); // lands mid-fetch
    expect(during.fetched_at).toBeNull(); // still no data, no crash
    await settleRefresh(stub);
    expect(upstreamAttempts).toBe(1); // no double fetch
    const after = await (await readRoutes(stub, ["A"])).json<any>();
    expect(after.routes.A).toHaveLength(1);
  });

  it("keeps the old snapshot on a non-2xx upstream", async () => {
    const stub = stubFor("mta-subway:alerts#500");
    mockAlertsOnce(encodeAlerts(nowSec(), [{ routes: ["A"], text: "good" }]));
    await readRoutes(stub, ["A"]);
    await settleRefresh(stub);
    mockAlertsOnce("", 0, 503);
    await runDurableObjectAlarm(stub);
    await settleRefresh(stub);
    const body = await (await readRoutes(stub, ["A"])).json<any>();
    expect(body.routes.A.map((a: any) => a.text)).toEqual(["good"]);
  });

  it("always includes an explicitly requested '*' id, even when empty", async () => {
    const stub = stubFor("mta-subway:alerts#star");
    mockAlertsOnce(encodeAlerts(nowSec(), [{ routes: ["A"] }])); // no agency alerts
    await readRoutes(stub, ["A"]);
    await settleRefresh(stub);
    const body = await (
      await stub.fetch(`https://do/routes?ids=${encodeURIComponent("*")},A&feed=mta-subway&group=alerts`)
    ).json<any>();
    expect(body.routes["*"]).toEqual([]); // requested → present, empty
  });

  it("drops fully-expired planned work at store time", async () => {
    const stub = stubFor("mta-subway:alerts#expired");
    const now = nowSec();
    mockAlertsOnce(
      encodeAlerts(now, [
        { routes: ["A"], text: "over", periods: [{ start: now - 500, end: now - 100 }] },
        { routes: ["A"], text: "ongoing", periods: [{ start: now - 500, end: now + 500 }] },
      ]),
    );
    await readRoutes(stub, ["A"]);
    await settleRefresh(stub);
    const stored = await runInDurableObject(stub, (i: AlertDO) => (i as any).snapshot.byRoute.A);
    expect(stored.map((a: any) => a.text)).toEqual(["ongoing"]); // expired never persisted
  });

  it("naturally retries a missing config after a poll interval, without manual resets", async () => {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO feeds (id, rt_alert_url, adapter) VALUES ('late-feed', NULL, 'nyct')",
    ).run();
    const stub = stubFor("late-feed:alerts");
    await readRoutes(stub, ["A"], "late-feed"); // arms; refresh flags configMissing
    await settleRefresh(stub);
    expect((await readRoutes(stub, ["A"], "late-feed")).status).toBe(404);

    // Operator fixes the row; simulate the poll interval elapsing.
    await env.DB.prepare("UPDATE feeds SET rt_alert_url = ? WHERE id = 'late-feed'")
      .bind(ALERTS_URL)
      .run();
    await runInDurableObject(stub, (i: AlertDO) => {
      (i as any).configMissingSinceMs = Date.now() - 61_000; // > POLL_INTERVAL_MS ago
      (i as any).configPromise = null; // memo would have been cleared by its rejection
    });
    mockAlertsOnce(encodeAlerts(nowSec(), [{ routes: ["A"] }]));
    const retried = await readRoutes(stub, ["A"], "late-feed");
    expect(retried.status).toBe(200); // the read fell through the cleared flag
    // The alarm from the first read is still pending, so the retried read
    // didn't arm a refresh — the next alarm drives loadConfig against the
    // fixed row (the production recovery path).
    await runDurableObjectAlarm(stub);
    await settleRefresh(stub);
    const warm = await (await readRoutes(stub, ["A"], "late-feed")).json<any>();
    expect(warm.fetched_at).toBeGreaterThan(0);
  });

  it("clamps an implausible far-future header timestamp instead of poisoning the watermark", async () => {
    const stub = stubFor("mta-subway:alerts#clamp");
    const t = nowSec();
    mockAlertsOnce(encodeAlerts(t * 1000, [{ routes: ["A"], text: "glitch" }])); // ms-valued
    await readRoutes(stub, ["A"]);
    await settleRefresh(stub);

    mockAlertsOnce(encodeAlerts(t + 60, [{ routes: ["A"], text: "recovered" }]));
    await runDurableObjectAlarm(stub);
    await settleRefresh(stub);
    const body = await (await readRoutes(stub, ["A"])).json<any>();
    expect(body.routes.A.map((a: any) => a.text)).toEqual(["recovered"]);
  });

  it("self-suspends after 10 idle minutes and re-arms on the next read", async () => {
    const stub = stubFor("mta-subway:alerts#suspend");
    mockAlertsOnce(encodeAlerts(nowSec(), [{ routes: ["A"] }]));
    await readRoutes(stub, ["A"]);
    await settleRefresh(stub);

    await runInDurableObject(stub, async (instance: AlertDO, state) => {
      const stale = Date.now() - 11 * 60_000;
      (instance as any).lastReadMs = stale;
      (instance as any).lastPersistedReadMs = stale;
      await state.storage.put("last_read", stale);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const pending = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(pending).toBeNull(); // suspended

    mockAlertsOnce(encodeAlerts(nowSec() + 60, [{ routes: ["A"] }]));
    await readRoutes(stub, ["A"]);
    await settleRefresh(stub);
    const rearmed = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(rearmed).not.toBeNull();
  });

  it("404s when the feed row has no rt_alert_url and recovers when fixed", async () => {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO feeds (id, rt_alert_url, adapter) VALUES ('bare-feed', NULL, 'nyct')",
    ).run();
    const stub = stubFor("bare-feed:alerts");
    await readRoutes(stub, ["A"], "bare-feed"); // arms; refresh hits missing config
    await settleRefresh(stub);
    const blocked = await readRoutes(stub, ["A"], "bare-feed");
    expect(blocked.status).toBe(404);

    await env.DB.prepare("UPDATE feeds SET rt_alert_url = ? WHERE id = 'bare-feed'")
      .bind(ALERTS_URL)
      .run();
    await runInDurableObject(stub, (instance: AlertDO) => {
      (instance as any).configMissing = false; // next read path re-attempts
      (instance as any).configPromise = null;
    });
    mockAlertsOnce(encodeAlerts(nowSec(), [{ routes: ["A"] }]));
    const recovered = await readRoutes(stub, ["A"], "bare-feed");
    expect(recovered.status).toBe(200);
    // The alarm from the first read is still pending, so the recovered read
    // didn't re-arm a refresh — fire the alarm to exercise the fixed config.
    await runDurableObjectAlarm(stub);
    await settleRefresh(stub);
    const warm = await (await readRoutes(stub, ["A"], "bare-feed")).json<any>();
    expect(warm.fetched_at).toBeGreaterThan(0);
  });

  it("keeps prototype-named route ids as own keys and round-trips comma ids", async () => {
    const stub = stubFor("mta-subway:alerts#proto");
    mockAlertsOnce(encodeAlerts(nowSec(), [{ routes: ["__proto__", "odd,id"] }]));
    await readRoutes(stub, ["A"]);
    await settleRefresh(stub);
    const res = await stub.fetch(
      `https://do/routes?ids=__proto__,${encodeURIComponent("odd,id")}&feed=mta-subway&group=alerts`,
    );
    const body = await res.json<any>();
    expect(Array.isArray(body.routes.__proto__)).toBe(true);
    expect(body.routes.__proto__).toHaveLength(1);
    expect(body.routes["odd,id"]).toHaveLength(1);
  });

  it("malformed body keeps the old snapshot (ParseError path)", async () => {
    const stub = stubFor("mta-subway:alerts#garbage");
    mockAlertsOnce(encodeAlerts(nowSec(), [{ routes: ["A"], text: "good" }]));
    await readRoutes(stub, ["A"]);
    await settleRefresh(stub);

    mockAlertsOnce("not json at all");
    await runDurableObjectAlarm(stub);
    await settleRefresh(stub);
    const body = await (await readRoutes(stub, ["A"])).json<any>();
    expect(body.routes.A.map((a: any) => a.text)).toEqual(["good"]); // kept
  });

  it("rejects reads missing feed/group params", async () => {
    const stub = stubFor("mta-subway:alerts#bad");
    const res = await stub.fetch("https://do/routes?ids=A");
    expect(res.status).toBe(400);
  });
});
