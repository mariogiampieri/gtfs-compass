import { DurableObject } from "cloudflare:workers";

import { ParseError } from "./adapters";
import {
  AGENCY_WIDE_KEY,
  type AlertItem,
  isActiveNow,
  parseMtaAlerts,
} from "./adapters/mta_alerts";
import {
  batchIdsParam,
  type DoIdentity,
  FETCH_TIMEOUT_MS,
  IDLE_SUSPEND_MS,
  MissingFeedError,
  doTag,
} from "./do_shared";

export const POLL_INTERVAL_MS = 60_000; // alerts move slowly; faster is wasted
// Persist last_read at FeedDO's 20 s bound rather than the 60 s cadence, so
// the suspend decision's staleness error stays capped at 20 s here too.
export const LAST_READ_PERSIST_MS = 20_000;

interface Snapshot {
  byRoute: Record<string, AlertItem[]>;
  fetchedAtMs: number; // wall clock at fetch start
  headerTimestamp: number; // feed generation time (epoch seconds)
}

interface AlertsConfig {
  alertUrl: string;
}

/**
 * One DO per alerts feed ("{feed_id}:alerts" — the feed is a single document).
 * Third sibling of FeedDO/GbfsDO with the same lifecycle discipline
 * (docs/solutions/architecture-patterns/durable-object-alarm-loop-discipline.md):
 * reschedule-first alarm that never throws, one refresh in flight,
 * storage-await-only read-path arming, newer-only stores, far-future clamp,
 * 10-idle-minute self-suspend. Only the cadence, snapshot shape (route →
 * alerts), and parse differ. Active-now filtering is THIS read path's job —
 * active_period windows open and close between polls, so composition consumes
 * an already-active-only snapshot (alert-layer plan, canonical locus).
 */
export class AlertDO extends DurableObject<Env> {
  private snapshot: Snapshot | null = null;
  private identity: DoIdentity | null = null;
  private lastReadMs = 0;
  private lastPersistedReadMs = 0;
  private refreshInFlight = false;
  private configPromise: Promise<AlertsConfig> | null = null;
  private configMissing = false;

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
    const batchIds = url.pathname === "/routes" ? batchIdsParam(url) : null;
    if (batchIds === null || !feedId || !group) {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    if (this.configMissing) {
      return Response.json({ error: `unknown feed: ${feedId}` }, { status: 404 });
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

    const response = this.routesResponse(batchIds, now);
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

      const upstream = await fetch(config.alertUrl, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!upstream.ok) {
        console.warn(`${this.tag()} upstream ${upstream.status}; keeping old snapshot`);
        return;
      }
      const parsed = parseMtaAlerts(await upstream.text());

      // Severity-signal loss must be distinguishable from calm: if Mercury
      // vanishes from a non-trivial feed, every alert silently greys to info.
      if (parsed.entitiesParsed >= 10 && parsed.entitiesWithMercury === 0) {
        console.warn(
          `${this.tag()} mercury extension missing from all ${parsed.entitiesParsed} entities — severity signal lost`,
        );
      }

      // A far-future header timestamp must never become the persisted
      // high-water mark — it would reject every correct body forever.
      if (parsed.timestamp > Math.floor(fetchStartMs / 1000) + 300) {
        console.warn(`${this.tag()} implausible header timestamp ${parsed.timestamp}; ignoring`);
        parsed.timestamp = 0;
      }
      // Frozen upstream: HTTP 200 but the feed hasn't advanced. Treat as a
      // failed fetch so staleness becomes visible (spec constraint #5).
      // A body that omits the timestamp (0) skips this gate.
      if (this.snapshot && parsed.timestamp > 0 && parsed.timestamp <= this.snapshot.headerTimestamp) {
        console.warn(`${this.tag()} header not advancing (${parsed.timestamp}); keeping old snapshot`);
        return;
      }
      if (this.snapshot && fetchStartMs <= this.snapshot.fetchedAtMs) {
        return; // stale-ordered write from an older interleaved fetch
      }

      const byRoute: Record<string, AlertItem[]> = Object.create(null); // no prototype keys
      for (const [routeId, items] of parsed.byRoute) {
        byRoute[routeId] = items;
      }
      const snapshot: Snapshot = {
        byRoute,
        fetchedAtMs: fetchStartMs,
        headerTimestamp: parsed.timestamp,
      };
      // Persist first, then flip memory: a failed put must not leave the live
      // instance serving data that regresses on the next warm restart.
      await this.ctx.storage.put("snapshot", snapshot);
      this.snapshot = snapshot;
    } catch (error) {
      if (error instanceof MissingFeedError) {
        this.configMissing = true;
      } else if (error instanceof ParseError) {
        console.warn(`${this.tag()} unparseable alerts body; keeping old snapshot:`, error.message);
      } else {
        console.warn(`${this.tag()} refresh failed; keeping old snapshot:`, error);
      }
    } finally {
      this.refreshInFlight = false;
    }
  }

  private loadConfig(feedId: string): Promise<AlertsConfig> {
    if (!this.configPromise) {
      this.configPromise = (async () => {
        const row = await this.env.DB.prepare("SELECT rt_alert_url FROM feeds WHERE id = ?")
          .bind(feedId)
          .first<{ rt_alert_url: string | null }>();
        if (!row?.rt_alert_url) {
          throw new MissingFeedError(feedId);
        }
        return { alertUrl: row.rt_alert_url };
      })();
      // Clear on rejection so a transient D1 error doesn't pin failure.
      this.configPromise.catch(() => {
        this.configPromise = null;
      });
    }
    return this.configPromise;
  }

  /**
   * Batch read: every requested id present (FeedDO convention — alerts are
   * route-keyed like arrivals, not presence-keyed like stations), plus the
   * agency-wide sentinel when it carries anything. Active-now filtered here,
   * with this DO's clock — the canonical locus.
   */
  private routesResponse(routeIds: string[], nowMs: number): Response {
    if (!this.snapshot) {
      const empty: Record<string, AlertItem[]> = Object.create(null);
      for (const id of routeIds) empty[id] = [];
      return Response.json({ fetched_at: null, routes: empty });
    }
    const nowSec = Math.floor(nowMs / 1000);
    const routes: Record<string, AlertItem[]> = Object.create(null);
    for (const id of new Set([...routeIds, AGENCY_WIDE_KEY])) {
      const stored = Object.hasOwn(this.snapshot.byRoute, id) ? this.snapshot.byRoute[id] : [];
      const active = stored.filter((item) => isActiveNow(item, nowSec));
      if (id === AGENCY_WIDE_KEY && active.length === 0) continue; // sentinel only when meaningful
      routes[id] = active;
    }
    return Response.json({
      fetched_at: Math.floor(this.snapshot.fetchedAtMs / 1000),
      routes,
    });
  }
}
