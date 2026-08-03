import { NYCT_ROUTE_GROUP, nyctDirectionId } from "./adapters/nyct";
import type { StationStatus } from "./adapters/gbfs";
import { FETCH_TIMEOUT_MS } from "./do_shared";
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
const TERMINAL_LOOKUP_CAP = 80; // headroom under D1's 100-binding statement limit

// The device contract (design handoff README "API Contract") — typed so the
// compiler guards the shape Phase 4 firmware builds against.

export interface RouteEntry {
  label: string;
  shape: ReturnType<typeof bulletShape>;
}

export interface ArrivalEntry {
  route: string;
  headsign: string | null;
  eta_min: number;
}

export interface DirectionEntry {
  direction_id: 0 | 1;
  label: null;
  arrivals: ArrivalEntry[];
}

export interface Trunk {
  key: string;
  color: string;
  text_color: string;
  routes: RouteEntry[];
  alert: null;
  note: null;
  directions: [DirectionEntry, DirectionEntry];
}

export interface RailStop {
  id: string;
  name: string;
  distance_label: string;
  trunks: Trunk[];
}

export interface RailSystem {
  mode: "rail" | "bus";
  direction_labels: string[] | null;
  fetched_at: number | null;
  partial?: true;
  stops: RailStop[];
  nearest_distance_label?: string | null;
}

export interface BikeStation {
  id: string;
  name: string;
  distance_label: string;
  /** null when the status source failed; 0 when fresh but station absent. */
  bikes_classic: number | null;
  bikes_electric: number | null;
  docks_open: number | null;
  capacity: number | null;
}

export interface BikeSystem {
  mode: "bike";
  fetched_at: number | null;
  partial?: true;
  stations: BikeStation[];
  nearest_distance_label?: string | null;
}

export type NearbySystem = RailSystem | BikeSystem;

export interface NearbyResponse {
  generated_at: string;
  units: string;
  systems: NearbySystem[];
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
): Promise<NearbyResponse> {
  const radiusM = params.radiusM ?? DEFAULT_RADIUS_M;
  const limit = params.stopsPerSystem ?? STOPS_PER_SYSTEM;
  const nowSec = Math.floor(Date.now() / 1000);

  // Requested modes compose concurrently — this is the device's 1–2 s hot
  // path, and the systems share no inputs.
  const systems = (
    await Promise.all(
      params.modes.map(async (mode): Promise<NearbySystem[]> => {
        const modeFeeds = feeds.filter((f) => modeForFeed(f) === mode);
        if (modeFeeds.length === 0) {
          // Configured-empty mode (bus in v1): the device renders its empty state.
          return [
            mode === "bike"
              ? { mode: "bike", fetched_at: null, stations: [] }
              : { mode: mode as "rail" | "bus", direction_labels: null, fetched_at: null, stops: [] },
          ];
        }
        return Promise.all(
          modeFeeds.map((feed) =>
            mode === "bike"
              ? composeBikeSystem(env, feed, params.lat, params.lon, radiusM, limit)
              : composeRailSystem(env, feed, params.lat, params.lon, radiusM, limit, nowSec),
          ),
        );
      }),
    )
  ).flat();

  const railFeed = feeds.find((f) => modeForFeed(f) === "rail");
  return {
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    units: railFeed?.units ?? feeds[0]?.units ?? "imperial",
    systems,
  };
}

interface SnapshotArrival {
  routeId: string;
  time: number;
  terminalStopId?: string;
}

interface GroupSnapshots {
  results: Map<string, { fetchedAt: number | null; stops: Record<string, SnapshotArrival[]> }>;
  anySourceFailed: boolean;
}

async function composeRailSystem(
  env: Env,
  feed: FeedInfo,
  lat: number,
  lon: number,
  radiusM: number,
  limit: number,
  nowSec: number,
): Promise<RailSystem> {
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

  const routeIds = [...new Set(stations.flatMap((s) => s.routeIds))];

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
  const neededGroups = [...new Set(groupByRoute.values())];
  const allPlatformIds = stations.flatMap((s) => s.stopIds);

  // The three lookups depend only on routeIds/stations — run them together.
  const [routeRows, fallbackHeadsigns, snapshots] = await Promise.all([
    loadRouteRows(env, feed.id, routeIds),
    loadFallbackHeadsigns(env, feed.id, routeIds),
    fetchGroupSnapshots(env, feed.id, neededGroups, allPlatformIds),
  ]);
  const routesById = new Map(routeRows.map((r) => [r.route_id, r]));

  // Collect every arrival's terminal id, then resolve names in one query.
  const terminalIds = new Set<string>();
  for (const { stops } of snapshots.results.values()) {
    for (const arrivals of Object.values(stops)) {
      for (const a of arrivals) if (a.terminalStopId) terminalIds.add(a.terminalStopId);
    }
  }
  const terminalNames = await loadStopNames(env, feed.id, [...terminalIds]);

  let suffixlessPlatforms = 0;
  const stops = stations.map((station): RailStop => {
    const { trunks, trunkByRoute } = buildTrunks(station, routesById);
    for (const platformId of station.stopIds) {
      const directionId = nyctDirectionId(platformId);
      if (directionId === null) {
        suffixlessPlatforms++;
        continue;
      }
      for (const { stops: groupStops } of snapshots.results.values()) {
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

  const stamps = [...snapshots.results.values()]
    .map((g) => g.fetchedAt)
    .filter((t): t is number => t !== null);
  return {
    mode: "rail",
    direction_labels: feed.directionLabels,
    fetched_at: stamps.length ? Math.min(...stamps) : null,
    ...(snapshots.anySourceFailed ? { partial: true as const } : {}),
    stops,
  };
}

/** One batch snapshot read per needed group, concurrent, failure-isolated. */
async function fetchGroupSnapshots(
  env: Env,
  feedId: string,
  neededGroups: string[],
  platformIds: string[],
): Promise<GroupSnapshots> {
  const results: GroupSnapshots["results"] = new Map();
  let anySourceFailed = false;
  const settled = await Promise.allSettled(
    neededGroups.map(async (group) => {
      const stub = env.FEED_DO.get(env.FEED_DO.idFromName(`${feedId}:${group}`));
      const res = await stub.fetch(
        `https://do/stops?ids=${platformIds.map(encodeURIComponent).join(",")}&feed=${feedId}&group=${group}`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      if (!res.ok) throw new Error(`group ${group}: ${res.status}`);
      const body = await res.json<{
        fetched_at: number | null;
        stops: Record<string, SnapshotArrival[]>;
      }>();
      return { group, body };
    }),
  );
  for (const [i, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      const { fetched_at, stops } = result.value.body;
      results.set(result.value.group, { fetchedAt: fetched_at, stops });
      if (fetched_at === null) anySourceFailed = true; // cold group: no data yet
    } else {
      // Failed group degrades to never-fetched semantics (plan KTD).
      console.warn(`[nearby] ${feedId}:${neededGroups[i]} snapshot fetch failed:`, result.reason);
      anySourceFailed = true;
    }
  }
  return { results, anySourceFailed };
}

function buildTrunks(
  station: StopGroup,
  routesById: Map<string, RouteRow>,
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
): Promise<BikeSystem> {
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
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) throw new Error(`gbfs status ${res.status}`);
    const body = await res.json<{
      fetched_at: number | null;
      stations: Record<string, StationStatus>;
    }>();
    fetchedAt = body.fetched_at;
    statuses = body.fetched_at === null ? null : body.stations;
  } catch (error) {
    // Degrade: stations keep capacity, counts go null (plan KTD).
    console.warn(`[nearby] ${feed.id} station status fetch failed:`, error);
  }

  const stations = nearby.map((s): BikeStation => {
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
    ...(statuses === null || fetchedAt === null ? { partial: true as const } : {}),
    stations,
  };
}

interface RouteRow {
  route_id: string;
  short_name: string | null;
  color: string | null;
  text_color: string | null;
}

async function loadRouteRows(env: Env, feedId: string, routeIds: string[]): Promise<RouteRow[]> {
  if (routeIds.length === 0) return [];
  const rows = await env.DB.prepare(
    `SELECT route_id, short_name, color, text_color FROM routes
     WHERE feed_id = ? AND route_id IN (${routeIds.map(() => "?").join(", ")})`,
  )
    .bind(feedId, ...routeIds)
    .all<RouteRow>();
  return rows.results;
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

/**
 * Terminal-name lookup: capped (untrusted realtime data must not grow the
 * IN-list past D1's binding budget) and failure-isolated (headsigns degrade
 * to the route_directions fallback, never a 500).
 */
async function loadStopNames(env: Env, feedId: string, stopIds: string[]): Promise<Map<string, string>> {
  if (stopIds.length === 0) return new Map();
  if (stopIds.length > TERMINAL_LOOKUP_CAP) {
    console.warn(`[nearby] ${feedId}: ${stopIds.length} terminal ids capped at ${TERMINAL_LOOKUP_CAP}`);
    stopIds = stopIds.slice(0, TERMINAL_LOOKUP_CAP);
  }
  const map = new Map<string, string>();
  try {
    const rows = await env.DB.prepare(
      `SELECT stop_id, name FROM stops WHERE feed_id = ? AND stop_id IN (${stopIds.map(() => "?").join(", ")})`,
    )
      .bind(feedId, ...stopIds)
      .all<{ stop_id: string; name: string | null }>();
    for (const row of rows.results) {
      if (row.name) map.set(row.stop_id, row.name);
    }
  } catch (error) {
    console.warn(`[nearby] ${feedId}: terminal name lookup failed:`, error);
  }
  return map;
}
