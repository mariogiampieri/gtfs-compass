import { ARRIVALS_PER_ROUTE } from "./feed_do";
import { fetchGroupSnapshots, groupForRoute } from "./nearby";
import { normalizeColor, paletteColor, textColorFor } from "./presentation";
import { type WalkOrigin, computeWalk, walkMaxAccuracyM } from "./walk";

/**
 * /v1/departures composition — the spec's leave-by timer contract. Pre-Phase-5
 * favorites live on the device, so the caller supplies namespaced platform
 * refs directly; walk context (manual seconds and/or an origin fix) rides in
 * with the request and walk.ts resolves the tier. The payload is the spec's
 * compact shape: entries per (stop, route) with server-computed minute
 * arrays; the device does no time math beyond decrementing.
 */

export interface StopRef {
  feedId: string;
  stopId: string;
}

export interface DeparturesParams {
  /** Request-ordered, validated (curated + group-capable adapter) upstream. */
  refs: StopRef[];
  /** Arrivals per (stop, route). */
  n: number;
  /** Manual walk seconds keyed by "feed:stop" ref. */
  walkSeconds: ReadonlyMap<string, number>;
  origin: WalkOrigin | null;
}

export const DEFAULT_ARRIVALS = 3;
// FeedDO's per-route trim depth is the ceiling — deeper asks are unsatisfiable.
export const MAX_ARRIVALS = ARRIVALS_PER_ROUTE;
export const MAX_STOP_REFS = 20; // 6 favorites × 2 directions with headroom, and payload sanity

export interface DepartureEntry {
  /** Namespaced "feed:stop" ref — bare ids can collide across feeds. */
  s: string;
  r: string;
  /** Colors are bare RRGGBB hex per the spec's example (no '#'). */
  c: string;
  t: string;
  m: number[];
  /** Leave-by minutes aligned with m; unclamped — negative = missed it. */
  l?: number[];
}

export interface DeparturesResponse {
  ts: number;
  fetched_at: number | null;
  partial?: true;
  d: DepartureEntry[];
  w?: Record<string, { s: number; src: "manual" | "heuristic" }>;
}

interface StopRow {
  stop_id: string;
  lat: number | null;
  lon: number | null;
}

interface StopRouteRow {
  stop_id: string;
  route_id: string;
  short_name: string | null;
  color: string | null;
  text_color: string | null;
  route_type: number | null;
}

export async function composeDepartures(
  env: Env,
  adapters: ReadonlyMap<string, string>,
  params: DeparturesParams,
): Promise<DeparturesResponse> {
  const nowSec = Math.floor(Date.now() / 1000);
  const maxAccuracyM = walkMaxAccuracyM(env);

  const refsByFeed = new Map<string, string[]>();
  for (const ref of params.refs) {
    const list = refsByFeed.get(ref.feedId) ?? [];
    if (!list.includes(ref.stopId)) list.push(ref.stopId);
    refsByFeed.set(ref.feedId, list);
  }

  // Feeds share no inputs — compose them concurrently (device hot path).
  const perFeed = await Promise.all(
    [...refsByFeed].map(async ([feedId, stopIds]) => {
      const adapter = adapters.get(feedId);
      if (!adapter) {
        // Route-layer validation makes this unreachable; belt-and-suspenders.
        console.warn(`[departures] ${feedId}: no adapter; refs skipped`);
        return { feedId, entries: new Map<string, DepartureEntry[]>(), walk: {}, stamps: [], anyFailed: true };
      }
      return composeFeed(env, feedId, adapter, stopIds, params, nowSec, maxAccuracyM);
    }),
  );

  // Reassemble in request order; walk map keys are caller-controlled → no prototype.
  const d: DepartureEntry[] = [];
  const w: Record<string, { s: number; src: "manual" | "heuristic" }> = Object.create(null);
  let anyWalk = false;
  const stamps: number[] = [];
  let partial = false;
  const byFeed = new Map(perFeed.map((f) => [f.feedId, f]));
  for (const ref of params.refs) {
    const feed = byFeed.get(ref.feedId);
    if (!feed) continue;
    for (const entry of feed.entries.get(ref.stopId) ?? []) d.push(entry);
    const key = `${ref.feedId}:${ref.stopId}`;
    if (Object.hasOwn(feed.walk, key)) {
      w[key] = feed.walk[key];
      anyWalk = true;
    }
  }
  for (const feed of perFeed) {
    stamps.push(...feed.stamps);
    partial ||= feed.anyFailed;
  }

  return {
    ts: nowSec,
    fetched_at: stamps.length ? Math.min(...stamps) : null,
    ...(partial ? { partial: true as const } : {}),
    d,
    ...(anyWalk ? { w } : {}),
  };
}

interface FeedComposition {
  feedId: string;
  entries: Map<string, DepartureEntry[]>;
  walk: Record<string, { s: number; src: "manual" | "heuristic" }>;
  stamps: number[];
  anyFailed: boolean;
}

async function composeFeed(
  env: Env,
  feedId: string,
  adapter: string,
  stopIds: string[],
  params: DeparturesParams,
  nowSec: number,
  maxAccuracyM: number,
): Promise<FeedComposition> {
  const placeholders = stopIds.map(() => "?").join(", ");
  const [stopRows, routeRows] = await Promise.all([
    env.DB.prepare(
      `SELECT stop_id, lat, lon FROM stops WHERE feed_id = ? AND stop_id IN (${placeholders})`,
    )
      .bind(feedId, ...stopIds)
      .all<StopRow>(),
    env.DB.prepare(
      `SELECT sr.stop_id, r.route_id, r.short_name, r.color, r.text_color, r.route_type
       FROM stop_routes sr
       JOIN routes r ON r.feed_id = sr.feed_id AND r.route_id = sr.route_id
       WHERE sr.feed_id = ? AND sr.stop_id IN (${placeholders})`,
    )
      .bind(feedId, ...stopIds)
      .all<StopRouteRow>(),
  ]);

  const knownStops = new Map(stopRows.results.map((row) => [row.stop_id, row]));
  const unknown = stopIds.filter((id) => !knownStops.has(id));
  if (unknown.length) {
    // Favorites can outlive a stop across GTFS updates — data drift, not a
    // caller bug: omit with a counted warning, never a throw.
    console.warn(`[departures] ${feedId}: ${unknown.length} unknown stop id(s) omitted`);
  }

  const routesByStop = new Map<string, StopRouteRow[]>();
  const groupByRoute = new Map<string, string>();
  let unmappedRoutes = 0;
  for (const row of routeRows.results) {
    const list = routesByStop.get(row.stop_id) ?? [];
    list.push(row);
    routesByStop.set(row.stop_id, list);
    if (!groupByRoute.has(row.route_id)) {
      const group = groupForRoute(adapter, row.route_id);
      if (group) groupByRoute.set(row.route_id, group);
      else unmappedRoutes++;
    }
  }
  if (unmappedRoutes) {
    console.warn(`[departures] ${feedId}: ${unmappedRoutes} route(s) with no feed-group mapping`);
  }

  const { results: snapshots, anySourceFailed: anyFailed } = await fetchGroupSnapshots(
    env,
    feedId,
    [...new Set(groupByRoute.values())],
    stopIds,
    "[departures]",
  );

  const entries = new Map<string, DepartureEntry[]>();
  const walk: Record<string, { s: number; src: "manual" | "heuristic" }> = Object.create(null);
  for (const stopId of stopIds) {
    const stopRow = knownStops.get(stopId);
    if (!stopRow) continue;
    const routes = (routesByStop.get(stopId) ?? []).sort((a, b) =>
      a.route_id < b.route_id ? -1 : a.route_id > b.route_id ? 1 : 0,
    );

    const key = `${feedId}:${stopId}`;
    const walkResult = computeWalk(
      {
        stop: stopRow.lat != null && stopRow.lon != null ? { lat: stopRow.lat, lon: stopRow.lon } : null,
        manualSeconds: params.walkSeconds.get(key),
        routeTypes: [...new Set(routes.map((r) => r.route_type).filter((t): t is number => t != null))],
      },
      params.origin,
      maxAccuracyM,
    );
    if (walkResult) walk[key] = { s: walkResult.seconds, src: walkResult.source };

    const stopEntries: DepartureEntry[] = [];
    for (const route of routes) {
      const group = groupByRoute.get(route.route_id);
      const snapshot = group ? snapshots.get(group) : undefined;
      const stored =
        snapshot && Object.hasOwn(snapshot.stops, stopId) ? snapshot.stops[stopId] : [];
      const arrivals = stored.filter((a) => a.routeId === route.route_id).slice(0, params.n);

      const color = normalizeColor(route.color) ?? paletteColor(route.route_id);
      const entry: DepartureEntry = {
        s: key,
        r: route.short_name || route.route_id,
        c: color.slice(1),
        t: textColorFor(color, route.text_color).slice(1),
        m: arrivals.map((a) => Math.max(0, Math.floor((a.time - nowSec) / 60))),
      };
      if (walkResult) {
        entry.l = arrivals.map((a) => Math.floor((a.time - walkResult.seconds - nowSec) / 60));
      }
      stopEntries.push(entry);
    }
    entries.set(stopId, stopEntries);
  }

  const stamps = [...snapshots.values()]
    .map((s) => s.fetchedAt)
    .filter((t): t is number => t !== null);
  return { feedId, entries, walk, stamps, anyFailed };
}
