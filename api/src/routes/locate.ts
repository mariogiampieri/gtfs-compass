/**
 * /v1/locate* route handlers — locate resolution plus the spec's diagnostic
 * capture (device estimate vs phone reference, paired by time window).
 *
 * Privacy/abuse posture (Phase 3 plan KTDs): BSSIDs are forwarded to the
 * provider chain and never stored; diagnostics surfaces are operator-only
 * behind a shared-secret DIAG_TOKEN carried ONLY as an Authorization Bearer
 * header (never a query param); `log:true` inserts carry a per-device daily
 * cap so a rotating device_id cannot grow locate_log unbounded.
 */

import { MAX_BSSIDS, haversineM, resolveLocation } from "../locate";

const DAILY_LOG_CAP = 500;
const REF_PAIR_WINDOW_S = 60;
const LOG_PAGE_LIMIT = 500;

/** Header-only Bearer check. A token anywhere else (query param) never counts. */
function diagAuthorized(request: Request, env: Env): boolean {
  const token = env.DIAG_TOKEN;
  if (!token) return false; // no token configured → diagnostics are closed
  return request.headers.get("Authorization") === `Bearer ${token}`;
}

export async function routeLocate(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/v1/locate" && request.method === "POST") {
    return handleLocate(request, env);
  }
  if (url.pathname === "/v1/locate/ref" && request.method === "POST") {
    return handleLocateRef(request, env);
  }
  if (url.pathname === "/v1/locate/log" && request.method === "GET") {
    return handleLocateLog(request, env, url);
  }
  return Response.json({ error: "not found" }, { status: 404 });
}

/** POST /v1/locate — {wifiAccessPoints, device_id?, log?, label?} */
async function handleLocate(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const wifiAccessPoints = body.wifiAccessPoints;
  if (!Array.isArray(wifiAccessPoints)) {
    return Response.json({ error: "wifiAccessPoints must be an array" }, { status: 400 });
  }
  // Reject oversized sets before any hashing or provider call.
  if (wifiAccessPoints.length > MAX_BSSIDS) {
    return Response.json(
      { error: `wifiAccessPoints capped at ${MAX_BSSIDS} entries` },
      { status: 400 },
    );
  }

  const deviceId = typeof body.device_id === "string" && body.device_id ? body.device_id : null;
  const wantsLog = body.log === true;

  if (wantsLog) {
    // The diagnostic walk is operator-driven (spec) — logging costs nothing to
    // gate and closes the device_id-rotation cap bypass entirely.
    if (!diagAuthorized(request, env)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!deviceId) {
      return Response.json({ error: "device_id required when log is true" }, { status: 400 });
    }
    const dayStartS = Math.floor(Date.now() / 1000 / 86_400) * 86_400;
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM locate_log WHERE device_id = ?1 AND ts >= ?2",
    )
      .bind(deviceId, dayStartS)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= DAILY_LOG_CAP) {
      return Response.json({ error: "daily log cap reached" }, { status: 429 });
    }
  }

  const result = await resolveLocation(wifiAccessPoints, env);

  if (wantsLog && deviceId) {
    const label = typeof body.label === "string" ? body.label : null;
    await env.DB.prepare(
      `INSERT INTO locate_log
         (user_id, device_id, ts, est_lat, est_lon, est_accuracy, provider, bssid_count, label)
       VALUES (NULL, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
      .bind(
        deviceId,
        Math.floor(Date.now() / 1000),
        result.known ? result.lat : null,
        result.known ? result.lon : null,
        result.known ? result.accuracy : null,
        result.known ? result.provider : "none",
        wifiAccessPoints.length,
        label,
      )
      .run();
  }

  return Response.json(result);
}

/**
 * POST /v1/locate/ref — {device_id, lat, lon, accuracy?, label?}. Pairs the
 * phone reference to the newest unpaired estimate for that device within the
 * 60 s window and computes the haversine delta_m.
 */
async function handleLocateRef(request: Request, env: Env): Promise<Response> {
  if (!diagAuthorized(request, env)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const deviceId = typeof body.device_id === "string" && body.device_id ? body.device_id : null;
  const lat = body.lat;
  const lon = body.lon;
  if (!deviceId || typeof lat !== "number" || typeof lon !== "number") {
    return Response.json({ error: "device_id, lat, lon required" }, { status: 400 });
  }
  const accuracy = typeof body.accuracy === "number" ? body.accuracy : null;
  const label = typeof body.label === "string" ? body.label : null;

  const nowS = Math.floor(Date.now() / 1000);
  const est = await env.DB.prepare(
    `SELECT id, est_lat, est_lon FROM locate_log
     WHERE device_id = ?1 AND ref_lat IS NULL AND ts >= ?2
     ORDER BY ts DESC, id DESC LIMIT 1`,
  )
    .bind(deviceId, nowS - REF_PAIR_WINDOW_S)
    .first<{ id: number; est_lat: number | null; est_lon: number | null }>();
  if (!est) {
    return Response.json({ error: "no unpaired estimate within 60s" }, { status: 404 });
  }

  // delta_m only when the estimate actually resolved ({known:false} rows pair
  // with a null delta — the miss itself is the diagnostic datum).
  const deltaM =
    est.est_lat !== null && est.est_lon !== null
      ? haversineM(est.est_lat, est.est_lon, lat, lon)
      : null;

  await env.DB.prepare(
    `UPDATE locate_log
     SET ref_lat = ?1, ref_lon = ?2, ref_accuracy = ?3, delta_m = ?4,
         label = COALESCE(?5, label)
     WHERE id = ?6`,
  )
    .bind(lat, lon, accuracy, deltaM, label, est.id)
    .run();

  return Response.json({ id: est.id, delta_m: deltaM });
}

/** GET /v1/locate/log?device_id=&since= — diagnostic rows, newest first. */
async function handleLocateLog(request: Request, env: Env, url: URL): Promise<Response> {
  if (!diagAuthorized(request, env)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const deviceId = url.searchParams.get("device_id");
  const sinceRaw = url.searchParams.get("since");
  const since = sinceRaw === null ? null : Number(sinceRaw);
  if (since !== null && !Number.isFinite(since)) {
    return Response.json({ error: "since must be an epoch-seconds number" }, { status: 400 });
  }

  const clauses: string[] = [];
  const binds: (string | number)[] = [];
  if (deviceId) {
    clauses.push(`device_id = ?${binds.length + 1}`);
    binds.push(deviceId);
  }
  if (since !== null) {
    clauses.push(`ts >= ?${binds.length + 1}`);
    binds.push(since);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await env.DB.prepare(
    `SELECT * FROM locate_log ${where} ORDER BY ts DESC, id DESC LIMIT ${LOG_PAGE_LIMIT}`,
  )
    .bind(...binds)
    .all();

  return Response.json({ rows: rows.results });
}
