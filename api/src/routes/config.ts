/**
 * /v1/config/* — the account's own configuration surface (Phase 5 plan, U10;
 * requirements R8, R9, R18; acceptance AE6, AE6d).
 *
 * This unit ships the device half only:
 *
 *   GET    /v1/config/devices             list this account's paired boards
 *   PATCH  /v1/config/devices/:device_id  grant or revoke one scope
 *   DELETE /v1/config/devices/:device_id  unpair (revoke)
 *
 * Favorites, origins and walk-times (U15) land in this same file later, as does
 * `GET /v1/config/:device_id` — the one device-facing read here, which is why
 * the device routes are namespaced under `/devices/` rather than hanging off
 * `/v1/config/<id>`: a board's own config read and the owner's device list must
 * not be one path that means two things depending on who asked.
 *
 * Properties this module guarantees structurally rather than per handler:
 *
 *  1. **No board can call any of it.** None of these routes names a `scope`,
 *     and U6 made that the fail-closed rule in `authorize()`: a device
 *     credential is refused before a handler runs. There is deliberately no
 *     second guard here — a local check would imply the global rule needs
 *     help, and the next route added to this file would be written without it.
 *
 *  2. **Every statement carries the ownership predicate `authorize()` returns**,
 *     never a hand-written `user_id = ?`. Both halves of "another user's
 *     devices are invisible *and* unmodifiable" come from the same fragment:
 *     the SELECT filters and the UPDATE's WHERE means a write against someone
 *     else's row changes zero rows, which is reported as the same 404 a
 *     nonexistent id gets. A write that quietly succeeds against a row it may
 *     not see is a different bug from a read that hides it, and is the one that
 *     would not show up in a list.
 *
 *  3. **Moving `read:fix` in either direction clears the fix already
 *     delivered** (R9). Unpair and an explicit toggle-off do exactly the same
 *     two writes in the same order — revoke the grant, then `clearFix()` —
 *     because "revocation is immediate on both sides, not merely prospective"
 *     is a property of the *grant*, not of the unpair button. A grant clears
 *     too, before its write, so that turning the permission back on can never
 *     hand a board a position captured while it was off. Ordering and the seam
 *     are argued in `../relay` and on `handleScope`.
 *
 * Device-supplied text (`name`, `fw_version`) is returned as stored: sanitized
 * of control characters and length-capped at rest by `pair.ts`, tagged
 * `untrusted: true` on the wire, and **escaped by the renderer** — the same
 * contract the claim preview carries, so the config UI has one component for
 * both. This module emits no HTML for it to escape into.
 */

import {
  KNOWN_SCOPES,
  authorize,
  formatScopes,
  parseScopes,
  type Authorized,
  type Scope,
} from "../auth";
import { clearFix } from "../relay";

/** The scope whose grant is also the relay's fan-out control (R9, R11). */
const FIX_SCOPE: Scope = "read:fix";

function nowS(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Account data, so `no-store`; `nosniff` because the body carries
 * device-supplied text and the one way JSON becomes executable markup is a
 * browser that sniffs it as HTML (same reasoning as `pair.ts`'s `json`).
 */
function noStoreJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * One answer for "no such device", "not yours", and "already unpaired". The
 * account boundary is not something an id-guesser gets to probe: a 403 on
 * someone else's device id would confirm that the id exists.
 */
function noSuchDevice(): Response {
  return noStoreJson({ error: "no such device" }, 404);
}

/**
 * Append the slid session cookie to any answer that leaves the session in
 * place. `authorize()` renews the window in D1; the browser cannot see that,
 * so a response that drops `refresh` silently shortens the session to whatever
 * `Max-Age` it was minted with.
 */
function withSession(auth: Authorized, res: Response): Response {
  if (!auth.refresh) return res;
  const headers = new Headers(res.headers);
  headers.append("Set-Cookie", auth.refresh);
  return new Response(res.body, { status: res.status, headers });
}

/** Read a JSON object body. `null` means malformed. */
async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const raw = (await request.text()).trim();
  if (raw === "") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null) return {};
    return typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* The device view (R18)                                                       */
/* -------------------------------------------------------------------------- */

interface DeviceRow {
  id: string;
  name: string | null;
  fw_version: string | null;
  paired_at: number | null;
  last_used_at: number | null;
  scopes: string | null;
}

const DEVICE_COLUMNS = "id, name, fw_version, paired_at, last_used_at, scopes";

/**
 * What the device list renders (R18): name, last-seen, firmware version and
 * scopes.
 *
 * `last_seen` on the wire is the `last_used_at` column, not the `last_seen`
 * column of the same name — that one is Phase 1 vintage and nothing has ever
 * written it. `last_used_at` is what U6's resolver stamps (at most every five
 * minutes), so it is the value that answers the question the field exists for:
 * a board you are holding that is still calling home is a board whose token
 * somebody else has.
 *
 * The metadata is nested under `device` and tagged `untrusted` to match the
 * claim preview's shape byte for byte, so the UI renders both through one
 * escaping component rather than two.
 */
function deviceView(row: DeviceRow): unknown {
  return {
    id: row.id,
    paired_at: row.paired_at,
    last_seen: row.last_used_at,
    scopes: parseScopes(row.scopes),
    device: { name: row.name, fw_version: row.fw_version, untrusted: true },
  };
}

/**
 * One live device of this account, or null. "Live" excludes revoked rows: an
 * unpaired board is gone from every surface here, and the row survives only so
 * that its token keeps resolving to the same 401 a token that never existed
 * gets.
 */
async function readDevice(
  env: Env,
  auth: Authorized,
  deviceId: string,
): Promise<DeviceRow | null> {
  const { owner } = auth;
  const idIndex = owner.binds.length + 1;
  return env.DB.prepare(
    `SELECT ${DEVICE_COLUMNS} FROM devices
      WHERE ${owner.sql} AND id = ?${idIndex} AND revoked_at IS NULL`,
  )
    .bind(...owner.binds, deviceId)
    .first<DeviceRow>();
}

/**
 * Whether this device id is this account's **at all**, revoked or not.
 *
 * Deliberately blind to `revoked_at`, which is the whole difference from
 * `readDevice`: once a row is revoked it is invisible to the list, to the scope
 * toggle, and to `ON DELETE CASCADE`, so anything left hanging off it has no
 * reaper but retention's sweep. `handleUnpair` is the one place that needs to
 * see through the revocation, and it still answers 404 either way.
 */
async function ownsDevice(env: Env, auth: Authorized, deviceId: string): Promise<boolean> {
  const { owner } = auth;
  const idIndex = owner.binds.length + 1;
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM devices WHERE ${owner.sql} AND id = ?${idIndex}`,
  )
    .bind(...owner.binds, deviceId)
    .first<{ ok: number }>();
  return row !== null;
}

/* -------------------------------------------------------------------------- */
/* GET /v1/config/devices (R18)                                                */
/* -------------------------------------------------------------------------- */

async function handleList(request: Request, env: Env): Promise<Response> {
  const auth = await authorize(request, env);
  if (auth instanceof Response) return auth;
  const { owner } = auth;

  const { results } = await env.DB.prepare(
    `SELECT ${DEVICE_COLUMNS} FROM devices
      WHERE ${owner.sql} AND revoked_at IS NULL
      ORDER BY paired_at DESC, id`,
  )
    .bind(...owner.binds)
    .all<DeviceRow>();

  return withSession(auth, noStoreJson({ devices: results.map(deviceView) }));
}

/* -------------------------------------------------------------------------- */
/* PATCH /v1/config/devices/:device_id — one scope at a time (R9)              */
/* -------------------------------------------------------------------------- */

/**
 * Grant or revoke exactly one scope.
 *
 * **One scope per request, not a replacement list.** R9's words are
 * "separately grantable and separately revocable", and the shape follows: a
 * `{"scopes": [...]}` PUT would make every toggle a whole-set write, so a
 * second tab holding a stale list would silently take back a grant — or worse,
 * silently restore `read:fix` after the user had turned it off. Here the
 * request states the intent it actually has, and nothing else moves.
 *
 * The write is a compare-and-set on the scope string rather than a
 * read-then-write, so two toggles racing cannot lose one of the two intents to
 * a last-writer-wins overwrite. A CAS that fails is re-read: if the row already
 * holds the requested state somebody else did the same thing and this is a
 * success, and only a genuinely conflicting concurrent change is a 409.
 */
async function handleScope(request: Request, env: Env, deviceId: string): Promise<Response> {
  const auth = await authorize(request, env);
  if (auth instanceof Response) return auth;

  const body = await readJsonBody(request);
  if (!body) return withSession(auth, noStoreJson({ error: "invalid JSON body" }, 400));

  // Matched against the scope set directly, never through `parseScopes` —
  // that one is a *column* parser, and a column is a list: it splits on commas
  // and drops what it does not recognize, so `"bogus,read:fix"` would reach
  // this handler as a well-formed single-scope request. An unknown or
  // ambiguous scope is a 400, never a silent no-op that answers 200 and leaves
  // the UI believing the grant it worded was the grant that happened.
  const requested = typeof body.scope === "string" ? body.scope.trim() : "";
  const scope = KNOWN_SCOPES.find((known) => known === requested);
  if (!scope) {
    return withSession(
      auth,
      noStoreJson({ error: `scope must be one of ${KNOWN_SCOPES.join(", ")}` }, 400),
    );
  }
  if (typeof body.granted !== "boolean") {
    return withSession(auth, noStoreJson({ error: "granted must be true or false" }, 400));
  }
  const granted = body.granted;

  const row = await readDevice(env, auth, deviceId);
  if (!row) return withSession(auth, noSuchDevice());

  // **Both edges of the `read:fix` toggle clear the stored position, and the
  // clear always runs on the side of the write where the grant is off** —
  // before a grant, after a revoke — so no fan-out can land in the window and
  // leave a row behind.
  //
  // Granting clears because the fan-out's recipient SELECT and its batched
  // upsert are separate round trips (see `../relay`): a post that read this
  // board as a recipient, then lost the race to a revocation, re-creates the
  // row after `clearFix` deleted it. The read gate stops that row being served
  // while the grant is off — and would hand it straight to the board the moment
  // the owner turned the permission back on. A position captured while the user
  // believed the relay was off is never served, so re-enabling starts empty and
  // waits for the next post.
  if (granted && scope === FIX_SCOPE) {
    await clearFix(env, deviceId);
  }

  const current = new Set(parseScopes(row.scopes));
  if (granted) current.add(scope);
  else current.delete(scope);
  // Canonical order, so the stored string is a function of the set and not of
  // the order the toggles happened to be flipped in — the CAS below compares
  // strings.
  const next = formatScopes(KNOWN_SCOPES.filter((s) => current.has(s)));

  // What the response reports. Reassigned only by the lost-CAS path, which
  // answers from the row it re-read rather than from the row it started with.
  let effective: DeviceRow = { ...row, scopes: next };

  if (next !== (row.scopes ?? "")) {
    const { owner } = auth;
    const idIndex = owner.binds.length + 1;
    const updated = await env.DB.prepare(
      `UPDATE devices SET scopes = ?${idIndex + 1}
        WHERE ${owner.sql} AND id = ?${idIndex} AND revoked_at IS NULL AND scopes = ?${idIndex + 2}`,
    )
      .bind(...owner.binds, deviceId, next, row.scopes)
      .run();

    if ((updated.meta?.changes ?? 0) !== 1) {
      // Lost the CAS. Re-read rather than guess: the concurrent writer may have
      // asked for exactly what this request asked for.
      const fresh = await readDevice(env, auth, deviceId);
      if (!fresh) return withSession(auth, noSuchDevice());
      if (formatScopes(parseScopes(fresh.scopes)) !== next) {
        return withSession(
          auth,
          noStoreJson({ error: "device scopes changed concurrently; reload and retry" }, 409),
        );
      }
      // Same state, another writer: this request succeeded, so it falls
      // through to the clear below rather than returning here. Returning would
      // make "revoking read:fix deletes the fix" a property of whichever
      // request won the race instead of a property of this handler.
      effective = fresh;
    }
  }

  // Revocation is immediate on both sides (R9): the position already delivered
  // goes with the grant. After the write, never before — see `clearFix`.
  // Unconditional on "not granted" rather than on "the set changed", so a
  // toggle-off that was already off still reaps a fix left behind by a failed
  // earlier attempt.
  if (!granted && scope === FIX_SCOPE) {
    await clearFix(env, deviceId);
  }

  return withSession(auth, noStoreJson(deviceView(effective)));
}

/* -------------------------------------------------------------------------- */
/* DELETE /v1/config/devices/:device_id — unpair (R9, R18)                     */
/* -------------------------------------------------------------------------- */

/**
 * Unpair: revoke the credential and drop the stored fix.
 *
 * The row is revoked, not deleted. A deleted row would make the board's token
 * resolve as "never existed", which is the same 401 — but it would also drop
 * `locate_log.device_row_id`'s referent (`ON DELETE SET NULL`) and take the
 * account's own diagnostic attribution with it. `scopes` is emptied alongside
 * `revoked_at` as defense in depth: the relay's fan-out predicate tests both,
 * and a revoked board that still *reads* as holding `read:fix` is one forgotten
 * `revoked_at IS NULL` away from being handed a position again.
 */
async function handleUnpair(request: Request, env: Env, deviceId: string): Promise<Response> {
  const auth = await authorize(request, env);
  if (auth instanceof Response) return auth;

  const { owner } = auth;
  const idIndex = owner.binds.length + 1;
  const revoked = await env.DB.prepare(
    `UPDATE devices SET revoked_at = ?${idIndex + 1}, scopes = ''
      WHERE ${owner.sql} AND id = ?${idIndex} AND revoked_at IS NULL`,
  )
    .bind(...owner.binds, deviceId, nowS())
    .run();
  // Zero rows is "not yours, not there, or already unpaired" — one answer, and
  // the tenancy half of it is the predicate above, not a check anyone had to
  // remember to write.
  if ((revoked.meta?.changes ?? 0) !== 1) {
    // ...but an already-unpaired device of this account still gets the clear.
    // The two writes here are deliberately unbatched (see `../relay`), so
    // "revoked, not cleared" is a reachable state, and it is a terminal one:
    // the row is out of `readDevice`, out of the list, and out of the
    // cascade's reach, which leaves retention's 14-day sweep as the only other
    // reaper of a position the user was already told had been deleted. A
    // repeat unpair is the reachable path, and it answers the same 404 —
    // nothing here distinguishes a device this account owns from one it does
    // not, only what gets cleaned up behind that answer.
    if (await ownsDevice(env, auth, deviceId)) await clearFix(env, deviceId);
    return withSession(auth, noSuchDevice());
  }

  await clearFix(env, deviceId);

  return withSession(auth, noStoreJson({ ok: true, id: deviceId }));
}

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                    */
/* -------------------------------------------------------------------------- */

const DEVICE_ROUTE = /^\/v1\/config\/devices\/([^/]+)$/;

export async function routeConfig(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/v1/config/devices" && request.method === "GET") {
    return handleList(request, env);
  }

  const match = DEVICE_ROUTE.exec(url.pathname);
  if (match) {
    let deviceId: string;
    try {
      deviceId = decodeURIComponent(match[1]);
    } catch {
      // Malformed percent-encoding passes the regex and throws here.
      return noStoreJson({ error: "not found" }, 404);
    }
    if (request.method === "PATCH") return handleScope(request, env, deviceId);
    if (request.method === "DELETE") return handleUnpair(request, env, deviceId);
  }

  return noStoreJson({ error: "not found" }, 404);
}
