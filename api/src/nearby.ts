import { NYCT_ROUTE_GROUP, nyctDirectionId } from "./adapters/nyct";
import type { StationStatus } from "./adapters/gbfs";
import { bulletShape, normalizeColor, paletteColor, textColorFor } from "./presentation";
import { type StopGroup, nearbyStops, nearestBeyond } from "./stops";

/**
 * /v1/nearby composition — the design contract's "the API does all the
 * thinking" layer. Pure assembly over the seams: stops.ts proximity, FeedDO
 * group snapshots, GbfsDO station counts, D1 reference data.
 */

export interface FeedInfo {
  id: string;
  adapter: string; // 'nyct' | 'gtfs_rt' | 'gbfs' | ...
  directionLabels: string[] | null;
  units: string | null;
}

export interface NearbyParams {
  lat: number;
  lon: number;
  modes: string[]; // subset of MODES, in request order
  radiusM?: number;
  stopsPerSystem?: number;
}

export const MODES = ["rail", "bus", "bike"] as const;
export const DEFAULT_RADIUS_M = 1200;
export const STOPS_PER_SYSTEM = 5; // payload cap — a designer call, flagged in the plan
const ARRIVALS_PER_DIRECTION = 8; // matches FeedDO's per-route trim depth

interface RouteEntry {
  label: string;
  shape: ReturnType<typeof bulletShape>;
}

interface DirectionEntry {
  direction_id: 0 | 1;
  label: null;
  arrivals: { route: string; headsign: string | null; eta_min: number }[];
}

interface Trunk {
  key: string;
  color: string;
  text_color: string;
  routes: RouteEntry[];
  alert: null;
  note: null;
  directions: [DirectionEntry, DirectionEntry];
}

export function modeForFeed(feed: FeedInfo): (typeof MODES)[number] {
  return feed.adapter === "gbfs" ? "bike" : "rail";
}

/** route_id → feed group, per-adapter strategy (plan KTD). Null = unmapped. */
function groupForRoute(adapter: string, routeId: string): string | null {
  if (adapter === "nyct") return NYCT_ROUTE_GROUP[routeId] ?? null;
  return "all"; // single-group adapters: one full-dataset feed
}

export async function composeNearby(
  env: Env,
  feeds: FeedInfo[],
  params: NearbyParams,
): Promise<Record<string, unknown>> {
  const radiusM = params.radiusM ?? DEFAULT_RADIUS_M;
  const limit = params.stopsPerSystem ?? STOPS_PER_SYSTEM;
  const nowSec = Math.floor(Date.now() / 1000);

  const systems: Record<string, unknown>[] = [];
  for (const mode of params.modes) {
    const modeFeeds = feeds.filter((f) => modeForFeed(f) === mode);
    if (modeFeeds.length === 0) {
      // Configured-empty mode (bus in v1): the device renders its empty state.
      systems.push(
        mode === "bike"
          ? { mode, fetched_at: null, stations: [] }
          : { mode, direction_labels: null, fetched_at: null, stops: [] },
      );
      continue;
    }
    for (const feed of modeFeeds) {
      systems.push(
        mode === "bike"
          ? await composeBikeSystem(env, feed, params.lat, params.lon, radiusM, limit)
          : await composeRailSystem(env, feed, params.lat, params.lon, radiusM, limit, nowSec),
      );
    }
  }

  const railFeed = feeds.find((f) => modeForFeed(f) === "rail");
  return {
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    units: railFeed?.units ?? feeds[0]?.units ?? "imperial",
    systems,
  };
}

async function composeRailSystem(
  env: Env,
  feed: FeedInfo,
  lat: number,
  lon: number,
  radiusM: number,
  limit: number,
  nowSec: number,
): Promise<Record<string, unknown>> {
  const units = { [feed.id]: feed.units };
  const stations = await nearbyStops(env.DB, { lat, lon, radiusM, feedIds: [feed.id], limit }, units);
  if (stations.length === 0) {
    return {
      mode: "rail",
      direction_labels: feed.directionLabels,
      fetched_at: null,
      stops: [],
      nearest_distance_label: await nearestBeyond(env.DB, lat, lon, [feed.id], feed.units),
    };
  }

  // Reference data for every route seen at the in-radius stations, one query each.
  const routeIds = [...new Set(stations.flatMap((s) => s.routeIds))];
  const routeRows = routeIds.length
    ? (
        await env.DB.prepare(
          `SELECT route_id, short_name, color, text_color FROM routes
           WHERE feed_id = ? AND route_id IN (${routeIds.map(() => "?").join(", ")})`,
        )
          .bind(feed.id, ...routeIds)
          .all<{ route_id: string; short_name: string | null; color: string | null; text_color: string | null }>()
      ).results
    : [];
  const routesById = new Map(routeRows.map((r) => [r.route_id, r]));
  const fallbackHeadsigns = await loadFallbackHeadsigns(env, feed.id, routeIds);

  // Feed groups needed by these routes; unmapped routes render as
  // empty-arrivals trunks with a counted warning, never a throw.
  const groupByRoute = new Map<string, string>();
  let unmappedRoutes = 0;
  for (const routeId of routeIds) {
    const group = groupForRoute(feed.adapter, routeId);
    if (group) groupByRoute.set(routeId, group);
    else unmappedRoutes++;
  }
  if (unmappedRoutes) {
    console.warn(`[nearby] ${feed.id}: ${unmappedRoutes} route(s) with no feed-group mapping`);
  }

  // One batch snapshot read per needed group, concurrent, failure-isolated.
  const allPlatformIds = stations.flatMap((s) => s.stopIds);
  const neededGroups = [...new Set(groupByRoute.values())];
  const groupResults = new Map<string, { fetchedAt: number | null; stops: Record<string, SnapshotArrival[]> }>();
  let anySourceFailed = false;
  const settled = await Promise.allSettled(
    neededGroups.map(async (group) => {
      const stub = env.FEED_DO.get(env.FEED_DO.idFromName(`${feed.id}:${group}`));
      const res = await stub.fetch(
        `https://do/stops?ids=${allPlatformIds.map(encodeURIComponent).join(",")}&feed=${feed.id}&group=${group}`,
      );
      if (!res.ok) throw new Error(`group ${group}: ${res.status}`);
      const body = await res.json<{ fetched_at: number | null; stops: Record<string, SnapshotArrival[]> }>();
      return { group, body };
    }),
  );
  for (const [i, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      const { fetched_at, stops } = result.value.body;
      groupResults.set(result.value.group, { fetchedAt: fetched_at, stops });
      if (fetched_at === null) anySourceFailed = true; // cold group: no data yet
    } else {
      // Failed group degrades to never-fetched semantics (plan KTD).
      console.warn(`[nearby] ${feed.id}:${neededGroups[i]} snapshot fetch failed:`, result.reason);
      anySourceFailed = true;
    }
  }

  // Collect every arrival's terminal id, then resolve names in one query.
  const terminalIds = new Set<string>();
  for (const { stops } of groupResults.values()) {
    for (const arrivals of Object.values(stops)) {
      for (const a of arrivals) if (a.terminalStopId) terminalIds.add(a.terminalStopId);
    }
  }
  const terminalNames = await loadStopNames(env, feed.id, [...terminalIds]);

  let suffixlessPlatforms = 0;
  const stops = stations.map((station) => {
    const { trunks, trunkByRoute } = buildTrunks(station, routesById);
    for (const platformId of station.stopIds) {
      const directionId = nyctDirectionId(platformId);
      if (directionId === null) {
        suffixlessPlatforms++;
        continue;
      }
      for (const { stops: groupStops } of groupResults.values()) {
        for (const arrival of groupStops[platformId] ?? []) {
          const trunk = trunkByRoute.get(arrival.routeId);
          if (!trunk) continue; // realtime-only route unknown to static data
          const label = routesById.get(arrival.routeId)?.short_name || arrival.routeId;
          const terminalName = arrival.terminalStopId
            ? (terminalNames.get(arrival.terminalStopId) ?? null)
            : null;
          const headsign =
            terminalName ?? fallbackHeadsigns.get(`${arrival.routeId}:${directionId}`) ?? null;
          trunk.directions[directionId].arrivals.push({
            route: label,
            headsign,
            eta_min: Math.max(0, Math.floor((arrival.time - nowSec) / 60)),
          });
        }
      }
    }
    for (const trunk of trunks) {
      for (const direction of trunk.directions) {
        direction.arrivals.sort((a, b) => a.eta_min - b.eta_min);
        direction.arrivals.length = Math.min(direction.arrivals.length, ARRIVALS_PER_DIRECTION);
      }
    }
    return {
      id: station.id,
      name: station.name,
      distance_label: station.distanceLabel,
      trunks,
    };
  });
  if (suffixlessPlatforms) {
    console.warn(`[nearby] ${feed.id}: ${suffixlessPlatforms} platform id(s) without a direction suffix dropped`);
  }

  const stamps = [...groupResults.values()].map((g) => g.fetchedAt).filter((t): t is number => t !== null);
  return {
    mode: "rail",
    direction_labels: feed.directionLabels,
    fetched_at: stamps.length ? Math.min(...stamps) : null,
    ...(anySourceFailed ? { partial: true } : {}),
    stops,
  };
}

interface SnapshotArrival {
  routeId: string;
  time: number;
  terminalStopId?: string;
}

function buildTrunks(
  station: StopGroup,
  routesById: Map<string, { route_id: string; short_name: string | null; color: string | null; text_color: string | null }>,
): { trunks: Trunk[]; trunkByRoute: Map<string, Trunk> } {
  const trunks = new Map<string, Trunk>();
  const trunkByRoute = new Map<string, Trunk>();
  for (const routeId of station.routeIds) {
    const row = routesById.get(routeId);
    const feedColor = normalizeColor(row?.color);
    // Feed-supplied color groups; hash-fallback routes stay single-route
    // trunks (grouping by post-fallback color would merge unrelated routes).
    const key = feedColor ? feedColor.slice(1).toLowerCase() : `r:${routeId}`;
    const color = feedColor ?? paletteColor(routeId);
    let trunk = trunks.get(key);
    if (!trunk) {
      trunk = {
        key,
        color,
        text_color: textColorFor(color, row?.text_color),
        routes: [],
        alert: null,
        note: null,
        directions: [
          { direction_id: 0, label: null, arrivals: [] },
          { direction_id: 1, label: null, arrivals: [] },
        ],
      };
      trunks.set(key, trunk);
    }
    trunk.routes.push({ label: row?.short_name || routeId, shape: bulletShape(row?.short_name || routeId) });
    trunkByRoute.set(routeId, trunk);
  }
  return { trunks: [...trunks.values()], trunkByRoute };
}

async function composeBikeSystem(
  env: Env,
  feed: FeedInfo,
  lat: number,
  lon: number,
  radiusM: number,
  limit: number,
): Promise<Record<string, unknown>> {
  const units = { [feed.id]: feed.units };
  const nearby = await nearbyStops(env.DB, { lat, lon, radiusM, feedIds: [feed.id], limit }, units);
  if (nearby.length === 0) {
    return {
      mode: "bike",
      fetched_at: null,
      stations: [],
      nearest_distance_label: await nearestBeyond(env.DB, lat, lon, [feed.id], feed.units),
    };
  }

  let fetchedAt: number | null = null;
  let statuses: Record<string, StationStatus> | null = null;
  try {
    const stub = env.GBFS_DO.get(env.GBFS_DO.idFromName(`${feed.id}:all`));
    const res = await stub.fetch(
      `https://do/stations?ids=${nearby.map((s) => encodeURIComponent(s.id)).join(",")}&feed=${feed.id}&group=all`,
    );
    if (!res.ok) throw new Error(`gbfs status ${res.status}`);
    const body = await res.json<{ fetched_at: number | null; stations: Record<string, StationStatus> }>();
    fetchedAt = body.fetched_at;
    statuses = body.fetched_at === null ? null : body.stations;
  } catch (error) {
    // Degrade: stations keep capacity, counts go null (plan KTD).
    console.warn(`[nearby] ${feed.id} station status fetch failed:`, error);
  }

  const stations = nearby.map((s) => {
    const status = statuses ? (Object.hasOwn(statuses, s.id) ? statuses[s.id] : null) : undefined;
    return {
      id: s.id,
      name: s.name,
      distance_label: s.distanceLabel,
      // status===undefined: source failed (null counts); status===null: source
      // fresh but station absent from the feed (honest zeros).
      bikes_classic: status === undefined ? null : (status?.classic ?? 0),
      bikes_electric: status === undefined ? null : (status?.electric ?? 0),
      docks_open: status === undefined ? null : (status?.docks ?? 0),
      capacity: s.capacity,
    };
  });

  return {
    mode: "bike",
    fetched_at: fetchedAt,
    ...(statuses === null || fetchedAt === null ? { partial: true } : {}),
    stations,
  };
}

async function loadFallbackHeadsigns(
  env: Env,
  feedId: string,
  routeIds: string[],
): Promise<Map<string, string>> {
  if (routeIds.length === 0) return new Map();
  try {
    const rows = await env.DB.prepare(
      `SELECT route_id, direction_id, headsign FROM route_directions
       WHERE feed_id = ? AND route_id IN (${routeIds.map(() => "?").join(", ")})`,
    )
      .bind(feedId, ...routeIds)
      .all<{ route_id: string; direction_id: number; headsign: string | null }>();
    const map = new Map<string, string>();
    for (const row of rows.results) {
      if (row.headsign) map.set(`${row.route_id}:${row.direction_id}`, row.headsign);
    }
    return map;
  } catch (error) {
    // Pre-migration-0001 database: headsign fallback degrades to null.
    console.warn(`[nearby] route_directions unavailable:`, error);
    return new Map();
  }
}

async function loadStopNames(env: Env, feedId: string, stopIds: string[]): Promise<Map<string, string>> {
  if (stopIds.length === 0) return new Map();
  const rows = await env.DB.prepare(
    `SELECT stop_id, name FROM stops WHERE feed_id = ? AND stop_id IN (${stopIds.map(() => "?").join(", ")})`,
  )
    .bind(feedId, ...stopIds)
    .all<{ stop_id: string; name: string | null }>();
  const map = new Map<string, string>();
  for (const row of rows.results) {
    if (row.name) map.set(row.stop_id, row.name);
  }
  return map;
}
