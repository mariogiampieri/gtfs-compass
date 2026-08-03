/**
 * /v1/nearby — the device contract: locate + composition in one round trip.
 *
 * POST body {wifiAccessPoints, device_id?} runs the locate chain first;
 * GET ?lat=&lon= (config UI, curl) bypasses it. Unknown location → 422 with
 * a distinct error shape the device maps to its empty/error states — a
 * different fact from empty-but-located systems (200 with empty stops).
 */

import { readWifiScanBody, resolveLocation } from "../locate";
import { type FeedInfo, MODES, composeNearby } from "../nearby";

export async function routeNearby(
  request: Request,
  env: Env,
  url: URL,
  curatedFeeds: ReadonlySet<string>,
): Promise<Response> {
  let lat: number;
  let lon: number;
  let accuracy: number | null = null;

  if (request.method === "GET") {
    const latRaw = url.searchParams.get("lat");
    const lonRaw = url.searchParams.get("lon");
    // Number(null) is 0 — absent params must not read as Null Island.
    lat = latRaw === null || latRaw === "" ? NaN : Number(latRaw);
    lon = lonRaw === null || lonRaw === "" ? NaN : Number(lonRaw);
    if (!validCoords(lat, lon)) {
      return Response.json({ error: "lat and lon required" }, { status: 400 });
    }
  } else if (request.method === "POST") {
    const parsed = await readWifiScanBody(request);
    if (parsed instanceof Response) return parsed;
    const located = await resolveLocation(parsed.wifiAccessPoints, env);
    if (!located.known) {
      // The device's designed "can't find you" state — not an empty board.
      return Response.json({ error: "location unknown" }, { status: 422 });
    }
    lat = located.lat;
    lon = located.lon;
    accuracy = located.accuracy;
  } else {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const modes = parseModes(url.searchParams.get("modes"));
  if (modes === null) {
    return Response.json({ error: "unknown modes" }, { status: 400 });
  }
  const feeds = await loadFeedInfo(env, curatedFeeds);
  const body = await composeNearby(env, feeds, { lat, lon, modes });
  return Response.json({ location: { lat, lon, accuracy }, ...body });
}

/** Shared with routes/departures.ts's origin validation. */
export function validCoords(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  );
}

/**
 * modes= is honored as a filter (contract pin); unknown names are ignored.
 * An explicit list with NO known mode is a caller error (null → 400) — a
 * typo must not silently return the full payload.
 */
function parseModes(raw: string | null): string[] | null {
  if (!raw) return [...MODES];
  const requested = raw.split(",").map((m) => m.trim());
  const known = MODES.filter((m) => requested.includes(m));
  return known.length ? known : null;
}

async function loadFeedInfo(env: Env, curatedFeeds: ReadonlySet<string>): Promise<FeedInfo[]> {
  const ids = [...curatedFeeds];
  if (ids.length === 0) return [];
  const rows = await env.DB.prepare(
    `SELECT id, adapter, direction_labels, units, mode FROM feeds
     WHERE id IN (${ids.map(() => "?").join(", ")})`,
  )
    .bind(...ids)
    .all<{
      id: string;
      adapter: string | null;
      direction_labels: string | null;
      units: string | null;
      mode: string | null;
    }>();
  return rows.results
    .filter((r) => r.adapter !== null)
    .map((r) => ({
      id: r.id,
      adapter: r.adapter!,
      mode: r.mode,
      directionLabels: parseLabels(r.direction_labels),
      units: r.units,
    }));
}

function parseLabels(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((l) => typeof l === "string") ? parsed : null;
  } catch {
    return null;
  }
}
