import { DurableObject } from "cloudflare:workers";

import { type Arrival, ParseError, feedHeaderTimestamp, getAdapter, groupUrlsFor } from "./adapters";
import {
  batchIdsParam,
  type DoIdentity,
  FETCH_TIMEOUT_MS,
  IDLE_SUSPEND_MS,
  MissingFeedError,
  doTag,
} from "./do_shared";

export { FETCH_TIMEOUT_MS, IDLE_SUSPEND_MS } from "./do_shared";

export const POLL_INTERVAL_MS = 20_000;
export const ARRIVALS_PER_ROUTE = 8; // per (stop, route): the trunk-detail screen scrolls all upcoming

interface Snapshot {
  arrivals: Record<string, Arrival[]>;
  fetchedAtMs: number; // wall clock at fetch start
  headerTimestamp: number; // feed generation time (epoch seconds)
}

interface FeedConfig {
  rtTripUrl: string;
  adapter: string;
}

/**
 * One DO per feed group ("{feed_id}:{group}"). Polls upstream on a 20 s alarm
 * while devices are reading; self-suspends after 10 idle minutes; serves the
 * last snapshot instantly and refreshes behind. Concurrency discipline per
 * docs/plans/2026-08-02-002: reschedule-first alarm that never throws, one
 * refresh in flight, storage-await-only read-path arming, newer-only stores.
 */
export class FeedDO extends DurableObject<Env> {
  private snapshot: Snapshot | null = null;
  private identity: DoIdentity | null = null;
  private lastReadMs = 0;
  private lastPersistedReadMs = 0;
  private refreshInFlight = false;
  private configPromise: Promise<FeedConfig> | null = null;
  private configMissing = false;
  private configMissingSinceMs = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Storage-only restore: warm restart serves the last snapshot (R4).
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<unknown>(["snapshot", "identity", "last_read"]);
      const map = stored as Map<string, unknown>;
      this.snapshot = (map.get("snapshot") as Snapshot | undefined) ?? null;
      this.identity = (map.get("identity") as DoIdentity | undefined) ?? null;
      this.lastReadMs = (map.get("last_read") as number | undefined) ?? 0;
      this.lastPersistedReadMs = this.lastReadMs;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const single = url.pathname.match(/^\/stop\/([^/]+)$/);
    const batch = url.pathname === "/stops";
    const feedId = url.searchParams.get("feed");
    const group = url.searchParams.get("group");
    if ((!single && !batch) || !feedId || !group) {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    if (this.configMissing) {
      // Natural recovery: under continuous polling the DO stays resident, so
      // a memory-only flag would pin 404 forever after the feeds row is
      // fixed. One retry per poll interval falls through to arm-and-refresh,
      // which re-runs loadConfig against D1.
      if (Date.now() - this.configMissingSinceMs <= POLL_INTERVAL_MS) {
        return Response.json({ error: `unknown feed: ${feedId}` }, { status: 404 });
      }
      this.configMissing = false;
    }
    const stopIds = single ? [decodeURIComponent(single[1])] : (batchIdsParam(url) ?? []);
    const now = Date.now();

    // Input-gated sequence: storage awaits only, no interleaving point.
    this.lastReadMs = now;
    if (!this.identity) {
      this.identity = { feedId, group };
      await this.ctx.storage.put("identity", this.identity);
    }
    if (now - this.lastPersistedReadMs > POLL_INTERVAL_MS) {
      // Hibernation between sparse reads is the common case; a memory-only
      // stamp would be forgotten and the DO could suspend mid-usage.
      await this.ctx.storage.put("last_read", now);
      this.lastPersistedReadMs = now;
    }
    const pending = await this.ctx.storage.getAlarm();
    const arming = pending === null;
    if (arming) {
      await this.ctx.storage.setAlarm(now + POLL_INTERVAL_MS);
    }

    const response = single
      ? this.stopResponse(stopIds[0], group, now)
      : this.stopsResponse(stopIds, group, now);
    if (arming) {
      this.ctx.waitUntil(this.refresh());
    }
    return response;
  }

  async alarm(): Promise<void> {
    // Total handler: exception-driven retries are intentionally unreachable;
    // the 20 s cadence is the retry policy. Duplicate (at-least-once)
    // invocations are idempotent: setAlarm overrides, refresh single-flights.
    try {
      if (!this.identity) return; // pre-first-read alarm: nothing to poll

      const now = Date.now();
      if (this.lastReadMs > this.lastPersistedReadMs) {
        await this.ctx.storage.put("last_read", this.lastReadMs);
        this.lastPersistedReadMs = this.lastReadMs;
      }
      if (now - this.lastReadMs >= IDLE_SUSPEND_MS) {
        return; // self-suspend: no reschedule (R2)
      }
      await this.ctx.storage.setAlarm(now + POLL_INTERVAL_MS); // reschedule-first
      await this.refresh();
    } catch (error) {
      console.error(`${this.tag()} alarm cycle failed (loop already re-armed):`, error);
    }
  }

  private tag(): string {
    return doTag(this.identity);
  }

  /** Fetch + parse + store, single-flight, newer-only. Never throws. */
  private async refresh(): Promise<void> {
    if (this.refreshInFlight || !this.identity) return;
    this.refreshInFlight = true;
    const fetchStartMs = Date.now();
    try {
      const config = await this.loadConfig(this.identity.feedId);
      this.configMissing = false; // a later-fixed feeds row must recover reads
      const url = groupUrlsFor(config.adapter, config.rtTripUrl)?.[this.identity.group];
      if (!url) {
        console.warn(`${this.tag()} adapter ${config.adapter} has no group ${this.identity.group}`);
        return;
      }

      const upstream = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!upstream.ok) {
        console.warn(`${this.tag()} upstream ${upstream.status}; keeping old snapshot`);
        return;
      }
      const buf = new Uint8Array(await upstream.arrayBuffer());

      let headerTimestamp = feedHeaderTimestamp(buf);
      // A far-future header timestamp must never become the persisted
      // high-water mark — it would reject every correct feed forever.
      if (headerTimestamp > Math.floor(fetchStartMs / 1000) + 300) {
        console.warn(`${this.tag()} implausible header timestamp ${headerTimestamp}; ignoring`);
        headerTimestamp = 0;
      }
      // Frozen upstream: HTTP 200 but the feed hasn't advanced. Treat as a
      // failed fetch so staleness becomes visible (spec constraint #5).
      // Feeds that omit the optional header timestamp (0) skip this gate.
      if (this.snapshot && headerTimestamp > 0 && headerTimestamp <= this.snapshot.headerTimestamp) {
        console.warn(`${this.tag()} feed header not advancing (${headerTimestamp}); keeping old snapshot`);
        return;
      }
      if (this.snapshot && fetchStartMs <= this.snapshot.fetchedAtMs) {
        return; // stale-ordered write from an older interleaved fetch
      }

      const nowSec = Math.floor(fetchStartMs / 1000);
      const parsed = getAdapter(config.adapter).parse(buf, nowSec);
      const snapshot: Snapshot = {
        arrivals: trimPerRoute(parsed),
        fetchedAtMs: fetchStartMs,
        headerTimestamp,
      };
      // Persist first, then flip memory: a failed put must not leave the live
      // instance serving data that regresses on the next warm restart (R4).
      await this.ctx.storage.put("snapshot", snapshot);
      this.snapshot = snapshot;
    } catch (error) {
      if (error instanceof MissingFeedError) {
        this.configMissing = true;
        this.configMissingSinceMs = Date.now();
      } else if (error instanceof ParseError) {
        console.warn(`${this.tag()} unparseable upstream feed; keeping old snapshot:`, error.message);
      } else {
        console.warn(`${this.tag()} refresh failed; keeping old snapshot:`, error);
      }
    } finally {
      this.refreshInFlight = false;
    }
  }

  private loadConfig(feedId: string): Promise<FeedConfig> {
    if (!this.configPromise) {
      this.configPromise = (async () => {
        const row = await this.env.DB.prepare(
          "SELECT rt_trip_url, adapter FROM feeds WHERE id = ?",
        )
          .bind(feedId)
          .first<{ rt_trip_url: string | null; adapter: string | null }>();
        if (!row?.rt_trip_url || !row.adapter) {
          throw new MissingFeedError(feedId);
        }
        return { rtTripUrl: row.rt_trip_url, adapter: row.adapter };
      })();
      // Clear on rejection so a transient D1 error doesn't pin failure.
      this.configPromise.catch(() => {
        this.configPromise = null;
      });
    }
    return this.configPromise;
  }

  private stopResponse(stopId: string, group: string, nowMs: number): Response {
    if (!this.snapshot) {
      // First-ever read: "no data yet" — distinct from no-service (fetched_at null).
      return Response.json({ fetched_at: null, group, arrivals: [] });
    }
    const nowSec = Math.floor(nowMs / 1000);
    // hasOwn guard: stop ids are caller-controlled and storage round-trips
    // restore Object.prototype, so "constructor" etc. must not hit the chain.
    const stored = Object.hasOwn(this.snapshot.arrivals, stopId)
      ? this.snapshot.arrivals[stopId]
      : [];
    const arrivals = stored.filter(
      (a) => a.time >= nowSec, // same boundary rule as the adapter's write-trim
    );
    return Response.json({
      fetched_at: Math.floor(this.snapshot.fetchedAtMs / 1000),
      group,
      arrivals,
    });
  }

  /**
   * Batch read for composition: one snapshot lookup per group per request
   * instead of one per platform. Same first-read/staleness contract as the
   * single-stop route; every requested id is present (empty when unknown).
   */
  private stopsResponse(stopIds: string[], group: string, nowMs: number): Response {
    // Object.create(null): stop ids are caller-controlled; "__proto__" etc.
    // must land as own keys, mirroring trimPerRoute and GbfsDO.
    if (!this.snapshot) {
      const empty: Record<string, Arrival[]> = Object.create(null);
      for (const id of stopIds) empty[id] = [];
      return Response.json({ fetched_at: null, group, stops: empty });
    }
    const nowSec = Math.floor(nowMs / 1000);
    const stops: Record<string, Arrival[]> = Object.create(null);
    for (const id of stopIds) {
      const stored = Object.hasOwn(this.snapshot.arrivals, id) ? this.snapshot.arrivals[id] : [];
      stops[id] = stored.filter((a) => a.time >= nowSec);
    }
    return Response.json({
      fetched_at: Math.floor(this.snapshot.fetchedAtMs / 1000),
      group,
      stops,
    });
  }
}

/** Keep the next ARRIVALS_PER_ROUTE arrivals per (stop, route), merged sorted. */
export function trimPerRoute(byStop: Map<string, Arrival[]>): Record<string, Arrival[]> {
  const out: Record<string, Arrival[]> = Object.create(null); // no prototype keys
  for (const [stopId, arrivals] of byStop) {
    const perRoute = new Map<string, number>();
    const kept: Arrival[] = [];
    for (const arrival of arrivals) {
      // arrivals are sorted ascending by the adapter
      const count = perRoute.get(arrival.routeId) ?? 0;
      if (count < ARRIVALS_PER_ROUTE) {
        kept.push(arrival);
        perRoute.set(arrival.routeId, count + 1);
      }
    }
    out[stopId] = kept;
  }
  return out;
}
