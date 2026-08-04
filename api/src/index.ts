import { adapterGroups } from "./adapters";
import { routeAuth } from "./routes/auth";
import { routeDepartures } from "./routes/departures";
import { routeLocate } from "./routes/locate";
import { routeNearby } from "./routes/nearby";

export { FeedDO } from "./feed_do";
export { GbfsDO } from "./gbfs_do";
export { AlertDO } from "./alerts_do";

/**
 * Curated feeds reachable through the public routes come from wrangler
 * `vars.CURATED_FEEDS` (JSON array) — the D1 feeds table also holds ~2,800
 * crowd-sourced catalog rows whose URLs must never be fetched on an
 * anonymous caller's say-so, so reachability is by explicit config, not by
 * what exists in the table. Memoized per isolate; vars are deploy-time.
 */
let curatedFeedsMemo: ReadonlySet<string> | null = null;
export function curatedFeeds(env: Env): ReadonlySet<string> {
  if (!curatedFeedsMemo) {
    curatedFeedsMemo = new Set(Array.isArray(env.CURATED_FEEDS) ? env.CURATED_FEEDS : []);
  }
  return curatedFeedsMemo;
}

const RATE_CAPACITY = 20; // burst
const RATE_REFILL_PER_SEC = 5;

// /v1/locate* fronts an external geolocation provider (BeaconDB-proxy abuse
// is in-scope harm), so it gets its own tighter bucket, keyed separately
// from the debug route's.
const LOCATE_RATE_CAPACITY = 10; // burst
const LOCATE_RATE_REFILL_PER_SEC = 1;

// /v1/auth* gets its own bucket rather than borrowing the general one because
// it is the only credential-issuing surface here: a burst that is unremarkable
// for a departures read is, on this path, either a mail-bomb aimed at one
// address or a run of guesses at a live sign-in token. The per-address and
// global send budgets (R4) bound the mail; this bounds everything else —
// including redemption attempts, which the budgets do not see at all.
// 12/minute sustained, 10 burst: a human signing in spends 3 (mode, request,
// redeem) and a page reload spends 1.
const AUTH_RATE_CAPACITY = 10; // burst
const AUTH_RATE_REFILL_PER_SEC = 0.2;

type RateBuckets = Map<string, { tokens: number; lastMs: number }>;

// In-isolate caches: best-effort (reset on isolate recycle), which is the
// right cost/benefit for a debug surface ahead of Phase 3/5 auth.
const adapterCache = new Map<string, string | null>();
const rateBuckets: RateBuckets = new Map();
const locateRateBuckets: RateBuckets = new Map();
const authRateBuckets: RateBuckets = new Map();

export function rateLimited(
  ip: string,
  now: number,
  buckets: RateBuckets = rateBuckets,
  capacity: number = RATE_CAPACITY,
  refillPerSec: number = RATE_REFILL_PER_SEC,
): boolean {
  if (buckets.size > 10_000) {
    buckets.clear(); // crude bound: scanners rotating IPs can't grow memory forever
  }
  const bucket = buckets.get(ip) ?? { tokens: capacity, lastMs: now };
  bucket.tokens = Math.min(
    capacity,
    bucket.tokens + ((now - bucket.lastMs) / 1000) * refillPerSec,
  );
  bucket.lastMs = now;
  if (bucket.tokens < 1) {
    buckets.set(ip, bucket);
    return true;
  }
  bucket.tokens -= 1;
  buckets.set(ip, bucket);
  return false;
}

async function feedAdapter(env: Env, feedId: string): Promise<string | null> {
  if (adapterCache.has(feedId)) return adapterCache.get(feedId)!;
  const row = await env.DB.prepare("SELECT adapter FROM feeds WHERE id = ?")
    .bind(feedId)
    .first<{ adapter: string | null }>();
  const adapter = row?.adapter ?? null;
  if (adapter !== null) {
    // Never cache negative lookups: a not-yet-seeded row would otherwise
    // 404 until isolate recycle (mirrors the DO's memo-clear-on-failure).
    adapterCache.set(feedId, adapter);
  }
  return adapter;
}

const ROUTE = /^\/internal\/([^/]+)\/([^/]+)\/stop\/([^/]+)$/;
// GBFS feeds are single-group ("all") and keyed by station, not stop — the
// operator debug surface mirrors FeedDO's so a stuck bike poll is inspectable
// without composing a full /v1/nearby response.
const STATION_ROUTE = /^\/internal\/([^/]+)\/all\/station\/([^/]+)$/;
// Same parity for the alerts poller: route-keyed, "alerts" pseudo-group.
const ALERTS_ROUTE = /^\/internal\/([^/]+)\/alerts\/route\/([^/]+)$/;

export default {
  // `ctx` is threaded through because /v1/auth/request sends its mail in
  // `waitUntil` (R2: the send happens after the response, so response timing
  // cannot say whether mail went out).
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      // D1 hiccups and other unexpected failures keep the JSON error contract.
      console.error("route failed:", error);
      return Response.json({ error: "internal error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

    if (url.pathname.startsWith("/v1/auth/")) {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (
        rateLimited(ip, Date.now(), authRateBuckets, AUTH_RATE_CAPACITY, AUTH_RATE_REFILL_PER_SEC)
      ) {
        return Response.json({ error: "rate limited" }, { status: 429 });
      }
      return routeAuth(request, env, url, ctx);
    }

    if (
      url.pathname === "/v1/nearby" ||
      url.pathname === "/v1/locate" ||
      url.pathname.startsWith("/v1/locate/")
    ) {
      // /v1/nearby shares the locate chain's fan-out cost, so it shares the
      // tighter bucket too (plan KTD: BeaconDB-proxy abuse is in-scope harm).
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (
        rateLimited(ip, Date.now(), locateRateBuckets, LOCATE_RATE_CAPACITY, LOCATE_RATE_REFILL_PER_SEC)
      ) {
        return Response.json({ error: "rate limited" }, { status: 429 });
      }
      if (url.pathname === "/v1/nearby") {
        return routeNearby(request, env, url, curatedFeeds(env));
      }
      return routeLocate(request, env, url);
    }

    if (url.pathname === "/v1/departures") {
      // Standard bucket, not the locate bucket: this path fans out to cached
      // DO snapshots only, no external geolocation provider.
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (rateLimited(ip, Date.now())) {
        return Response.json({ error: "rate limited" }, { status: 429 });
      }
      return routeDepartures(request, env, url, curatedFeeds(env));
    }

    const alertsMatch = url.pathname.match(ALERTS_ROUTE);
    if (alertsMatch && request.method === "GET") {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (rateLimited(ip, Date.now())) {
        return Response.json({ error: "rate limited" }, { status: 429 });
      }
      let feedId: string;
      let routeId: string;
      try {
        [, feedId, routeId] = alertsMatch.map(decodeURIComponent) as [string, string, string];
      } catch {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      if (!curatedFeeds(env).has(feedId)) {
        return Response.json({ error: `unknown feed: ${feedId}` }, { status: 404 });
      }
      const stub = env.ALERT_DO.get(env.ALERT_DO.idFromName(`${feedId}:alerts`));
      return stub.fetch(
        `https://do/routes?ids=${encodeURIComponent(routeId)}&feed=${encodeURIComponent(feedId)}&group=alerts`,
      );
    }

    const stationMatch = url.pathname.match(STATION_ROUTE);
    if (stationMatch && request.method === "GET") {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (rateLimited(ip, Date.now())) {
        return Response.json({ error: "rate limited" }, { status: 429 });
      }
      let feedId: string;
      let stationId: string;
      try {
        [, feedId, stationId] = stationMatch.map(decodeURIComponent) as [string, string, string];
      } catch {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      if (!curatedFeeds(env).has(feedId) || (await feedAdapter(env, feedId)) !== "gbfs") {
        return Response.json({ error: `unknown feed: ${feedId}` }, { status: 404 });
      }
      const stub = env.GBFS_DO.get(env.GBFS_DO.idFromName(`${feedId}:all`));
      return stub.fetch(
        `https://do/station/${encodeURIComponent(stationId)}?feed=${encodeURIComponent(feedId)}&group=all`,
      );
    }

    const match = url.pathname.match(ROUTE);
    if (!match || request.method !== "GET") {
      return Response.json({ error: "not found" }, { status: 404 });
    }

    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (rateLimited(ip, Date.now())) {
      return Response.json({ error: "rate limited" }, { status: 429 });
    }

    let decoded: string[];
    try {
      decoded = match.map(decodeURIComponent);
    } catch {
      // Malformed percent-encoding passes the regex verbatim but throws here.
      return Response.json({ error: "not found" }, { status: 404 });
    }
    const [, feedId, group, stopId] = decoded;

    // Allowlist before any lookup: non-curated feeds are unreachable by design.
    if (!curatedFeeds(env).has(feedId)) {
      return Response.json({ error: `unknown feed: ${feedId}` }, { status: 404 });
    }
    const adapter = await feedAdapter(env, feedId);
    const groups = adapter ? adapterGroups[adapter] : undefined;
    if (!groups) {
      return Response.json({ error: `unknown feed: ${feedId}` }, { status: 404 });
    }
    if (!groups.includes(group)) {
      return Response.json({ error: `unknown group: ${group}` }, { status: 404 });
    }

  const stub = env.FEED_DO.get(env.FEED_DO.idFromName(`${feedId}:${group}`));
  return stub.fetch(
    `https://do/stop/${encodeURIComponent(stopId)}?feed=${encodeURIComponent(feedId)}&group=${encodeURIComponent(group)}`,
  );
}
