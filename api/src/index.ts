import { adapterGroups } from "./adapters";
import { routeLocate } from "./routes/locate";

export { FeedDO } from "./feed_do";
export { GbfsDO } from "./gbfs_do";

/**
 * Curated feeds reachable through the group-addressed route. The D1 feeds
 * table also holds ~2,800 crowd-sourced catalog rows whose URLs must never
 * be fetched on an anonymous caller's say-so — reachability is by explicit
 * allowlist, not by what exists in the table.
 */
const CURATED_FEEDS: ReadonlySet<string> = new Set(["mta-subway"]);

const RATE_CAPACITY = 20; // burst
const RATE_REFILL_PER_SEC = 5;

// /v1/locate* fronts an external geolocation provider (BeaconDB-proxy abuse
// is in-scope harm), so it gets its own tighter bucket, keyed separately
// from the debug route's.
const LOCATE_RATE_CAPACITY = 10; // burst
const LOCATE_RATE_REFILL_PER_SEC = 1;

type RateBuckets = Map<string, { tokens: number; lastMs: number }>;

// In-isolate caches: best-effort (reset on isolate recycle), which is the
// right cost/benefit for a debug surface ahead of Phase 3/5 auth.
const adapterCache = new Map<string, string | null>();
const rateBuckets: RateBuckets = new Map();
const locateRateBuckets: RateBuckets = new Map();

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      // D1 hiccups and other unexpected failures keep the JSON error contract.
      console.error("route failed:", error);
      return Response.json({ error: "internal error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

    if (url.pathname === "/v1/locate" || url.pathname.startsWith("/v1/locate/")) {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (
        rateLimited(ip, Date.now(), locateRateBuckets, LOCATE_RATE_CAPACITY, LOCATE_RATE_REFILL_PER_SEC)
      ) {
        return Response.json({ error: "rate limited" }, { status: 429 });
      }
      return routeLocate(request, env, url);
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
    if (!CURATED_FEEDS.has(feedId)) {
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
