/**
 * Proximity queries behind one seam (spec: if multi-agency scale later
 * demands PostGIS, that should be one file's worth of change).
 *
 * Bounding-box prefilter on the indexed lat/lon columns, haversine sort in
 * JS, parent-station grouping for rail. At current scale (~4k rows across
 * feeds) this is instant and stays fine into the tens of thousands.
 */

export interface StopGroup {
  /** Parent station id for rail groups; the stop's own id otherwise. */
  id: string;
  feedId: string;
  name: string;
  lat: number;
  lon: number;
  distanceM: number;
  distanceLabel: string;
  /** Constituent platform ids (rail: both directions; others: [id]). */
  stopIds: string[];
  /** Route ids serving any constituent stop (rail; empty for bike). */
  routeIds: string[];
  capacity: number | null;
}

export interface NearbyQuery {
  lat: number;
  lon: number;
  radiusM: number;
  feedIds: string[];
  limit: number;
}

const EARTH_RADIUS_M = 6_371_000;

export function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Format a distance per feed units config ('metric' | anything else = imperial). */
export function distanceLabel(meters: number, units: string | null): string {
  if (units === "metric") {
    return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
  }
  const feet = meters * 3.28084;
  return feet < 1000 ? `${Math.round(feet)} ft` : `${(feet / 5280).toFixed(1)} mi`;
}

interface StopRow {
  feed_id: string;
  stop_id: string;
  name: string | null;
  lat: number | null;
  lon: number | null;
  parent_station: string | null;
  capacity: number | null;
}

/**
 * Nearest stop groups within radius, distance-sorted. Rail platforms group
 * under their parent station; standalone stops (bike stations, parentless
 * stops) pass through as single-member groups.
 */
export async function nearbyStops(
  db: D1Database,
  query: NearbyQuery,
  unitsByFeed: Record<string, string | null> = {},
): Promise<StopGroup[]> {
  if (query.feedIds.length === 0) return [];

  const latDelta = (query.radiusM / 111_320) * 1.2; // slack so the bbox never clips the circle
  const lonDelta =
    (query.radiusM / (111_320 * Math.max(0.2, Math.cos((query.lat * Math.PI) / 180)))) * 1.2;

  const placeholders = query.feedIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT feed_id, stop_id, name, lat, lon, parent_station, capacity
       FROM stops
       WHERE feed_id IN (${placeholders})
         AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`,
    )
    .bind(
      ...query.feedIds,
      query.lat - latDelta,
      query.lat + latDelta,
      query.lon - lonDelta,
      query.lon + lonDelta,
    )
    .all<StopRow>();

  // Group: parented platforms under (feed, parent); everything else standalone.
  const groups = new Map<string, StopGroup>();
  const parentRows = new Map<string, StopRow>(); // (feed:id) -> station row, for name/coords
  for (const row of rows.results) {
    if (row.lat == null || row.lon == null) continue;
    if (!row.parent_station) {
      parentRows.set(`${row.feed_id}:${row.stop_id}`, row);
    }
  }
  for (const row of rows.results) {
    if (row.lat == null || row.lon == null) continue;
    const groupId = row.parent_station ?? row.stop_id;
    const key = `${row.feed_id}:${groupId}`;
    const anchor = parentRows.get(key) ?? row;
    let group = groups.get(key);
    if (!group) {
      group = {
        id: groupId,
        feedId: row.feed_id,
        name: anchor.name ?? row.name ?? groupId,
        lat: anchor.lat ?? row.lat,
        lon: anchor.lon ?? row.lon,
        distanceM: 0,
        distanceLabel: "",
        stopIds: [],
        routeIds: [],
        capacity: anchor.capacity ?? null,
      };
      groups.set(key, group);
    }
    if (!group.stopIds.includes(row.stop_id)) group.stopIds.push(row.stop_id);
  }
  // A parent-station row rides along in its own group; once platforms exist,
  // the parent id is not a constituent stop.
  for (const group of groups.values()) {
    if (group.stopIds.length > 1) {
      group.stopIds = group.stopIds.filter((id) => id !== group.id);
    }
  }

  const within: StopGroup[] = [];
  for (const group of groups.values()) {
    group.distanceM = haversineM(query.lat, query.lon, group.lat, group.lon);
    if (group.distanceM <= query.radiusM) {
      group.distanceLabel = distanceLabel(group.distanceM, unitsByFeed[group.feedId] ?? null);
      within.push(group);
    }
  }
  within.sort((a, b) => a.distanceM - b.distanceM);
  const limited = within.slice(0, query.limit);

  await attachRoutes(db, limited);
  return limited;
}

/** Route ids serving each group's constituent stops (one query for all groups). */
async function attachRoutes(db: D1Database, groups: StopGroup[]): Promise<void> {
  const pairs = groups.flatMap((g) =>
    (g.stopIds.length ? g.stopIds : [g.id]).map((stopId) => ({ group: g, stopId })),
  );
  if (pairs.length === 0) return;
  const placeholders = pairs.map(() => "(?, ?)").join(", ");
  const rows = await db
    .prepare(
      `SELECT feed_id, stop_id, route_id FROM stop_routes
       WHERE (feed_id, stop_id) IN (VALUES ${placeholders})`,
    )
    .bind(...pairs.flatMap((p) => [p.group.feedId, p.stopId]))
    .all<{ feed_id: string; stop_id: string; route_id: string }>();

  const byStop = new Map<string, string[]>();
  for (const row of rows.results) {
    const key = `${row.feed_id}:${row.stop_id}`;
    (byStop.get(key) ?? byStop.set(key, []).get(key)!).push(row.route_id);
  }
  for (const { group, stopId } of pairs) {
    for (const routeId of byStop.get(`${group.feedId}:${stopId}`) ?? []) {
      if (!group.routeIds.includes(routeId)) group.routeIds.push(routeId);
    }
  }
  for (const group of groups) group.routeIds.sort();
}

/**
 * Distance to the closest stop of a feed — feeds the empty-mode screen's
 * "Closest station is 2.4 mi away." Two-stage widening bbox search, capped
 * at 100 km: beyond that "nearest station" is meaningless to a pedestrian
 * and the bbox would scan most of the table on every far-away request.
 */
export async function nearestBeyond(
  db: D1Database,
  lat: number,
  lon: number,
  feedIds: string[],
  units: string | null,
): Promise<string | null> {
  for (const radiusM of [10_000, 100_000]) {
    const found = await nearbyStops(
      db,
      { lat, lon, radiusM, feedIds, limit: 1 },
      Object.fromEntries(feedIds.map((f) => [f, units])),
    );
    if (found.length) return found[0].distanceLabel;
  }
  return null;
}
