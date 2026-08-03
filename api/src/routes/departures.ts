/**
 * GET /v1/departures — the device's leave-by timer read path. Pre-Phase-5
 * favorites live on the device, so the request carries namespaced platform
 * refs plus optional walk context; the response is the spec's compact
 * payload. Validation is fail-loud (the device is the only caller): any
 * malformed ref, unknown feed, or out-of-cap input rejects the whole
 * request with a specific error, never partial-silent.
 *
 * Origin (`lat`/`lon`/`acc`) and `walk` parameters are request-scoped only:
 * never persisted, never logged — the same posture as BSSIDs in the locate
 * route. Error text names refs (device config), never coordinates.
 */

import { adapterGroups } from "../adapters";
import {
  DEFAULT_ARRIVALS,
  MAX_ARRIVALS,
  MAX_STOP_REFS,
  type StopRef,
  composeDepartures,
} from "../departures";
import { batchIdsParam } from "../do_shared";
import { MANUAL_WALK_MAX_S, type WalkOrigin } from "../walk";

export async function routeDepartures(
  request: Request,
  env: Env,
  url: URL,
  curatedFeeds: ReadonlySet<string>,
): Promise<Response> {
  if (request.method !== "GET") {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const rawRefs = batchIdsParam(url, "stops");
  if (!rawRefs || rawRefs.length === 0) {
    return Response.json({ error: "stops required" }, { status: 400 });
  }
  if (rawRefs.length > MAX_STOP_REFS) {
    return Response.json(
      { error: `too many stops (max ${MAX_STOP_REFS})` },
      { status: 400 },
    );
  }

  const refs: StopRef[] = [];
  const refKeys = new Set<string>();
  for (const raw of rawRefs) {
    const ref = parseRef(raw);
    if (!ref) {
      return Response.json(
        { error: `malformed stop ref: ${raw} (expected feed:stop)` },
        { status: 400 },
      );
    }
    if (!curatedFeeds.has(ref.feedId)) {
      return Response.json({ error: `unknown feed: ${ref.feedId}` }, { status: 400 });
    }
    const key = `${ref.feedId}:${ref.stopId}`;
    if (!refKeys.has(key)) {
      refKeys.add(key);
      refs.push(ref);
    }
  }

  const n = intParam(url, "n", DEFAULT_ARRIVALS);
  if (n === null || n < 1 || n > MAX_ARRIVALS) {
    return Response.json({ error: `n must be 1..${MAX_ARRIVALS}` }, { status: 400 });
  }

  const walkSeconds = new Map<string, number>();
  for (const raw of batchIdsParam(url, "walk") ?? []) {
    const lastColon = raw.lastIndexOf(":");
    const key = lastColon > 0 ? raw.slice(0, lastColon) : "";
    const seconds = lastColon > 0 ? Number(raw.slice(lastColon + 1)) : Number.NaN;
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > MANUAL_WALK_MAX_S) {
      return Response.json(
        { error: `malformed walk entry: ${raw} (expected feed:stop:seconds, 0..${MANUAL_WALK_MAX_S})` },
        { status: 400 },
      );
    }
    if (!refKeys.has(key)) {
      // Fail-loud: walk context for a stop the request didn't ask about is a
      // device config bug, not something to silently ignore.
      return Response.json({ error: `walk ref not in stops: ${key}` }, { status: 400 });
    }
    walkSeconds.set(key, seconds);
  }

  const origin = parseOrigin(url);
  if (origin instanceof Response) return origin;

  // Adapter lookup doubles as reachability validation: an unseeded feed or a
  // non-group adapter (gbfs — bike favorites are /v1/nearby territory) is
  // unreachable through this endpoint by design.
  const feedIds = [...new Set(refs.map((r) => r.feedId))];
  const rows = await env.DB.prepare(
    `SELECT id, adapter FROM feeds WHERE id IN (${feedIds.map(() => "?").join(", ")})`,
  )
    .bind(...feedIds)
    .all<{ id: string; adapter: string | null }>();
  const adapters = new Map<string, string>();
  for (const row of rows.results) {
    if (row.adapter && adapterGroups[row.adapter]) adapters.set(row.id, row.adapter);
  }
  for (const feedId of feedIds) {
    if (!adapters.has(feedId)) {
      return Response.json({ error: `unknown feed: ${feedId}` }, { status: 400 });
    }
  }

  return Response.json(await composeDepartures(env, adapters, { refs, n, walkSeconds, origin }));
}

function parseRef(raw: string): StopRef | null {
  const colon = raw.indexOf(":");
  if (colon <= 0 || colon === raw.length - 1) return null;
  return { feedId: raw.slice(0, colon), stopId: raw.slice(colon + 1) };
}

/** Integer query param: fallback when absent, null when present-but-invalid. */
function intParam(url: URL, name: string, fallback: number): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

function parseOrigin(url: URL): WalkOrigin | null | Response {
  const latRaw = url.searchParams.get("lat");
  const lonRaw = url.searchParams.get("lon");
  const accRaw = url.searchParams.get("acc");
  if (latRaw === null && lonRaw === null && accRaw === null) return null;
  // Number(null) is 0 — absent params must not read as Null Island.
  const lat = latRaw === null || latRaw === "" ? Number.NaN : Number(latRaw);
  const lon = lonRaw === null || lonRaw === "" ? Number.NaN : Number(lonRaw);
  const acc = accRaw === null || accRaw === "" ? Number.NaN : Number(accRaw);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return Response.json({ error: "origin requires valid lat and lon" }, { status: 400 });
  }
  if (!Number.isFinite(acc) || acc <= 0) {
    // Constraint #5: an origin with unreported accuracy is untrusted — the
    // device's locate response always carries accuracy, so require it.
    return Response.json({ error: "origin requires acc (accuracy meters)" }, { status: 400 });
  }
  return { lat, lon, accuracyM: acc };
}
