import { DurableObject } from "cloudflare:workers";

import { ParseError } from "./adapters";
import { type StationStatus, parseStationStatus } from "./adapters/gbfs";
import {
  batchIdsParam,
  type DoIdentity,
  FETCH_TIMEOUT_MS,
  IDLE_SUSPEND_MS,
  MissingFeedError,
  doTag,
} from "./do_shared";

export const POLL_INTERVAL_MS = 60_000; // the GBFS feed's ttl; polling faster is wasted
// Persist last_read at FeedDO's 20 s bound rather than the 60 s cadence, so
// the suspend decision's staleness error stays capped at 20 s here too.
export const LAST_READ_PERSIST_MS = 20_000;

interface Snapshot {
  stations: Record<string, StationStatus>;
  fetchedAtMs: number; // wall clock at fetch start
  lastUpdated: number; // GBFS top-level last_updated (epoch seconds)
}

interface GbfsConfig {
  statusUrl: string;
}

/**
 * One DO per GBFS feed ("{feed_id}:all" — station_status is a single
 * document, so there is exactly one group). Sibling of FeedDO with the same
 * lifecycle discipline (docs/solutions/architecture-patterns/
 * durable-object-alarm-loop-discipline.md): reschedule-first alarm that never
 * throws, one refresh in flight, storage-await-only read-path arming,
 * newer-only stores, 10-idle-minute self-suspend. Only the cadence (60 s ttl),
 * snapshot shape (station counts vs arrivals), and parse differ.
 */
export class GbfsDO extends DurableObject<Env> {
  private snapshot: Snapshot | null = null;
  private identity: DoIdentity | null = null;
  private lastReadMs = 0;
  private lastPersistedReadMs = 0;
  private refreshInFlight = false;
  private configPromise: Promise<GbfsConfig> | null = null;
  private configMissing = false;
  private configMissingSinceMs = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Storage-only restore: warm restart serves the last snapshot.
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
    const feedId = url.searchParams.get("feed");
    const group = url.searchParams.get("group");
    const single = url.pathname.match(/^\/station\/([^/]+)$/);
    const batchIds = url.pathname === "/stations" ? batchIdsParam(url) : null;
    if ((!single && batchIds === null) || !feedId || !group) {
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
    const now = Date.now();

    // Input-gated sequence: storage awaits only, no interleaving point.
    this.lastReadMs = now;
    if (!this.identity) {
      this.identity = { feedId, group };
      await this.ctx.storage.put("identity", this.identity);
    }
    if (now - this.lastPersistedReadMs > LAST_READ_PERSIST_MS) {
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
      ? this.stationResponse(decodeURIComponent(single[1]))
      : this.stationsResponse(batchIds ?? []);
    if (arming) {
      this.ctx.waitUntil(this.refresh());
    }
    return response;
  }

  async alarm(): Promise<void> {
    // Total handler: exception-driven retries are intentionally unreachable;
    // the 60 s cadence is the retry policy. Duplicate (at-least-once)
    // invocations are idempotent: setAlarm overrides, refresh single-flights.
    try {
      if (!this.identity) return; // pre-first-read alarm: nothing to poll

      const now = Date.now();
      if (this.lastReadMs > this.lastPersistedReadMs) {
        await this.ctx.storage.put("last_read", this.lastReadMs);
        this.lastPersistedReadMs = this.lastReadMs;
      }
      if (now - this.lastReadMs >= IDLE_SUSPEND_MS) {
        return; // self-suspend: no reschedule
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

      const upstream = await fetch(config.statusUrl, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!upstream.ok) {
        console.warn(`${this.tag()} upstream ${upstream.status}; keeping old snapshot`);
        return;
      }
      const parsed = parseStationStatus(await upstream.text());

      // A far-future last_updated (ms-instead-of-s glitch, clock skew) must
      // never become the persisted high-water mark — it would reject every
      // correct body forever, with no recovery even across restarts.
      if (parsed.lastUpdated > Math.floor(fetchStartMs / 1000) + 300) {
        console.warn(`${this.tag()} implausible last_updated ${parsed.lastUpdated}; ignoring timestamp`);
        parsed.lastUpdated = 0;
      }

      // Frozen upstream: HTTP 200 but the feed hasn't advanced. Treat as a
      // failed fetch so staleness becomes visible (spec constraint #5).
      // A body that omits last_updated (0) skips this gate.
      if (this.snapshot && parsed.lastUpdated > 0 && parsed.lastUpdated <= this.snapshot.lastUpdated) {
        console.warn(`${this.tag()} last_updated not advancing (${parsed.lastUpdated}); keeping old snapshot`);
        return;
      }
      if (this.snapshot && fetchStartMs <= this.snapshot.fetchedAtMs) {
        return; // stale-ordered write from an older interleaved fetch
      }

      const stations: Record<string, StationStatus> = Object.create(null); // no prototype keys
      for (const [id, status] of parsed.stations) {
        stations[id] = status;
      }
      const snapshot: Snapshot = {
        stations,
        fetchedAtMs: fetchStartMs,
        lastUpdated: parsed.lastUpdated,
      };
      // Persist first, then flip memory: a failed put must not leave the live
      // instance serving data that regresses on the next warm restart.
      await this.ctx.storage.put("snapshot", snapshot);
      this.snapshot = snapshot;
    } catch (error) {
      if (error instanceof MissingFeedError) {
        this.configMissing = true;
        this.configMissingSinceMs = Date.now();
      } else if (error instanceof ParseError) {
        console.warn(`${this.tag()} unparseable station_status; keeping old snapshot:`, error.message);
      } else {
        console.warn(`${this.tag()} refresh failed; keeping old snapshot:`, error);
      }
    } finally {
      this.refreshInFlight = false;
    }
  }

  private loadConfig(feedId: string): Promise<GbfsConfig> {
    if (!this.configPromise) {
      this.configPromise = (async () => {
        const row = await this.env.DB.prepare(
          "SELECT rt_trip_url FROM feeds WHERE id = ?",
        )
          .bind(feedId)
          .first<{ rt_trip_url: string | null }>();
        if (!row?.rt_trip_url) {
          throw new MissingFeedError(feedId);
        }
        return { statusUrl: row.rt_trip_url }; // rt_trip_url = station_status URL for GBFS feeds
      })();
      // Clear on rejection so a transient D1 error doesn't pin failure.
      this.configPromise.catch(() => {
        this.configPromise = null;
      });
    }
    return this.configPromise;
  }

  private stationResponse(stationId: string): Response {
    if (!this.snapshot) {
      // First-ever read: "no data yet" — distinct from unknown-station (fetched_at null).
      return Response.json({ fetched_at: null, station: null });
    }
    // hasOwn guard: station ids are caller-controlled and storage round-trips
    // restore Object.prototype, so "constructor" etc. must not hit the chain.
    const station = Object.hasOwn(this.snapshot.stations, stationId)
      ? this.snapshot.stations[stationId]
      : null;
    return Response.json({
      fetched_at: Math.floor(this.snapshot.fetchedAtMs / 1000),
      station,
    });
  }

  private stationsResponse(ids: string[]): Response {
    if (!this.snapshot) {
      return Response.json({ fetched_at: null, stations: {} });
    }
    const stations: Record<string, StationStatus> = Object.create(null); // "__proto__" id must not hit the setter
    for (const id of ids) {
      if (Object.hasOwn(this.snapshot.stations, id)) {
        stations[id] = this.snapshot.stations[id]; // missing ids omitted
      }
    }
    return Response.json({
      fetched_at: Math.floor(this.snapshot.fetchedAtMs / 1000),
      stations,
    });
  }
}
