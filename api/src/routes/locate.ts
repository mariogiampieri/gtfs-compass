/**
 * /v1/locate* route handlers — locate resolution, the relay's **write** half
 * (Phase 5 plan, U14; requirements R11, R21), and the spec's diagnostic
 * capture (device estimate vs phone reference, paired by time window).
 *
 * Privacy/abuse posture (Phase 3 plan KTDs): BSSIDs are forwarded to the
 * provider chain and never stored; diagnostics surfaces are operator-only
 * behind a shared-secret DIAG_TOKEN carried ONLY as an Authorization Bearer
 * header (never a query param); `log:true` inserts carry a daily cap so a
 * rotating identifier cannot grow locate_log unbounded.
 *
 * Three credentials reach this file and they are deliberately **not**
 * interchangeable (U14's KTD):
 *
 *  * **A session** is an account. It is the only thing that may relay a fix,
 *    because `putFixForUser` takes a *user* — R11's post names no device, so
 *    there is no ownership parameter to validate and nothing to spoof.
 *  * **A device token** is a board. It may attribute its own diagnostic rows
 *    (`user_id` + `device_row_id`), which is what gives R21's history deletion
 *    something to delete; it may not relay, and `authorize()` refuses it on
 *    every route here that names no scope.
 *  * **DIAG_TOKEN** is a static operator secret naming *no user at all*. It
 *    keeps the diagnostic path it has always had and is refused on the relay:
 *    an operator relay post would have to supply a `user_id` parameter,
 *    reinstating exactly the caller-supplied ownership argument R11 exists to
 *    delete, now behind a shared secret.
 *
 * **Two identity spaces for `locate_log`, never merged** (migration 0003's
 * ruling, and U14's second KTD). `device_id` is client-chosen free-form text;
 * `devices.id`/`users.id` are server-minted. The daily insert cap is counted in
 * whichever space the row is being written into, so an anonymous caller who
 * learns a paired board's id cannot burn that board's cap — nor inject rows
 * into an identified user's history, since the anonymous branch cannot write
 * `user_id` or `device_row_id` at all.
 *
 * **Every read and update of `locate_log` carries a tenancy predicate.** Once
 * rows can name a user, an unscoped `SELECT *` hands every caller everyone
 * else's location history, and an unscoped pairing UPDATE lets one caller write
 * their phone's position into somebody else's row. `historyPredicate()` below
 * is composed unconditionally into both statements, and the per-user half of it
 * comes from `auth.ts`'s `ownerPredicate` rather than a hand-written
 * `user_id = ?` — the scoping is the credential resolver's, not the route's.
 *
 * **A phone-sourced resolution is never written to `locate_log`.** The corpus
 * exists to compare a device's WiFi *estimate* against a phone *reference*, and
 * `device_fixes` — one row, latest-wins, deleted the instant `read:fix` is
 * revoked — is the only place the relayed position is allowed to live. See
 * `handleLocate`.
 *
 * **Client-supplied text is length-capped at ingress.** `device_id` and `label`
 * are attacker-chosen strings on a surface any session or board may write to,
 * and `DAILY_LOG_CAP` bounds the row *count*, not the row *size*.
 */

import {
  authorize,
  checkAmbientCsrf,
  hashToken,
  ownerPredicate,
  refreshCookie,
  resolveCredential,
  type Authorized,
  type Credential,
  type OwnerPredicate,
} from "../auth";
import { budgetVar, incrementBudget, readBudget } from "../email";
import { haversineM, readWifiScanBody, resolveLocation } from "../locate";
import { putFixForUser } from "../relay";
import { networkKey } from "./pair";

const DAILY_LOG_CAP = 500;
const REF_PAIR_WINDOW_S = 60;
const LOG_PAGE_LIMIT = 500;

/**
 * Caps on the two client-chosen strings these routes store. Neither is bounded
 * anywhere else: `readWifiScanBody` bounds the access-point array,
 * `normalizeBssids` bounds each `macAddress`, and `DAILY_LOG_CAP` bounds how
 * many rows a caller may insert per day — none of them bounds how big a row is.
 * Against D1's row ceiling an uncapped `label` turns a 500-row daily allowance
 * into a gigabyte of attacker-chosen text in the same database that serves
 * feeds, stops and auth.
 *
 * Over-length is a 400, never a truncation: `device_id` is the key the daily cap
 * and the reference pairing are addressed by, and silently shortening it would
 * file the row under — and let it pair against — a different caller's id.
 */
const MAX_DEVICE_ID_LENGTH = 64;
const MAX_LABEL_LENGTH = 128;

/* `auth_budgets.scope` values this module owns (R11). ----------------------- */

/**
 * Relay posts per **user** per UTC day — the counter that does the enforcing.
 *
 * Keyed on the account and not on the session, which is the whole point: a
 * session is not scarce (30-day TTL, a fresh row per magic-link redeem, five
 * sends per address per day), so a per-session allowance is a per-account
 * allowance multiplied by however many sessions the holder cares to mint. A
 * user costs an email that R4's send slices already ration.
 */
export const RELAY_USER_SCOPE = "relay:user";
/**
 * The same posts counted per client network (/24 or /64, never per address),
 * **split into two slices** exactly as `pair.ts` splits its deployment-wide
 * caps. The network key is shared — a carrier CGNAT /24 holds hundreds of
 * subscribers, on a feature whose premise is a phone on mobile data — so a
 * single counter over it is a denial lever one account can pull. The slice a
 * charge draws on is chosen by the *user's* own count for the day, so an
 * account posting all day spends `repeat` and cannot exhaust the `fresh` pool a
 * co-located user's ordinary sends land in.
 */
export const RELAY_IP_FRESH_SCOPE = "relay:ip:fresh";
export const RELAY_IP_REPEAT_SCOPE = "relay:ip:repeat";
/**
 * Posts a spent network slice turned away, keyed by slice. Fixed cardinality
 * (two keys, `BUDGET_SHARDS` rows apiece), so it is safe to write on the
 * refusal path — see `pair.ts`'s `noteGlobalRefusal`, whose reasoning this
 * shares: a shared key refusing an honest caller is invisible in the response.
 */
export const RELAY_REFUSED_SCOPE = "relay:refused";

/**
 * A full day at the documented client cadence (about once a minute) plus
 * headroom. The client batches; this is the backstop for a client that does
 * not — the relay is the phase's highest-frequency write and fans out to N
 * rows per call, so it is the one path that must not be uncapped.
 */
const DEFAULT_RELAY_USER_BUDGET = 1500;
/**
 * The network's day, four fifths of it reserved for the traffic an abuser
 * cannot manufacture cheaply. Same split and the same arithmetic as
 * `PAIR_START_BUDGET_FRESH`/`_REPEAT` and `AUTH_SEND_BUDGET_KNOWN`/`UNKNOWN`;
 * the two still total the 6000/day the single counter was.
 */
const DEFAULT_RELAY_IP_FRESH_BUDGET = 4800;
const DEFAULT_RELAY_IP_REPEAT_BUDGET = 1200;

/**
 * How many of one user's posts in a UTC day draw on the network's `fresh`
 * slice.
 *
 * The honest shape is a gesture: the config UI sends on a button press and
 * throttles itself to about one a minute, so a person actively relaying spends
 * a handful to a few dozen in a day. Sixty covers that generously, and
 * everything past it — hundreds of posts from one account — is the shape only a
 * runaway client or an abuser has. Sized in posts rather than in
 * `pair.ts`'s handful because the honest cadence here is a stream, not a
 * once-in-a-device's-life request.
 */
const FRESH_SLICE_POSTS = 60;

/** Which network slice a charge draws on. Operator-facing only — never a response. */
type NetworkSlice = "fresh" | "repeat";

/** How far ahead of the Worker a phone's clock may be and still be believed. */
const MAX_FIX_SKEW_S = 60;
/** How stale a posted capture time may be. A day-old fix is a bug, not a flush. */
const MAX_FIX_AGE_S = 86_400;

function nowS(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Every response these routes return.
 *
 * `no-store` because two of them now carry a metre-accurate personal position
 * (the relayed phone fix) and one carries an account's diagnostic history — the
 * same reason `routes/config.ts`, `routes/auth.ts` and `routes/pair.ts` all set
 * it. A POST body is not cached by a conforming shared cache, so this is
 * hardening against the GET form, proxy or service worker somebody adds later.
 * `nosniff` because `/v1/locate/log` echoes client-chosen `device_id`/`label`
 * text and the one way a JSON body becomes executable markup is a browser that
 * sniffs it as HTML.
 *
 * The body is `JSON.stringify` of the value handed in, byte for byte what
 * `Response.json` produced — AE9's byte-identical locate contract is a property
 * of the object's key order, not of the helper.
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
 * A client-supplied string, bounded. Returns `null` for "absent or empty" — the
 * one representation of "the caller said nothing" — and a ready 400 for a value
 * past `cap`.
 */
function boundedText(raw: unknown, field: string, cap: number): string | null | Response {
  if (typeof raw !== "string" || raw === "") return null;
  if (raw.length > cap) {
    return noStoreJson({ error: `${field} must be at most ${cap} characters` }, 400);
  }
  return raw;
}

/** Header-only Bearer check. A token anywhere else (query param) never counts. */
function diagAuthorized(request: Request, env: Env): boolean {
  const token = env.DIAG_TOKEN;
  if (!token) return false; // no token configured → diagnostics are closed
  return request.headers.get("Authorization") === `Bearer ${token}`;
}

/**
 * The caller's address, which `networkKey` truncates into the budget key.
 * `CF-Connecting-IP` is set by the edge and cannot be spoofed by the client;
 * behind anything else every caller shares the `unknown` bucket, which fails
 * safe (one shared, tighter budget) rather than open.
 */
function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

/**
 * Append the slid session cookie to any answer that leaves the session in
 * place. `validateSession` renews the window in D1; the browser cannot see
 * that, so a response that drops the cookie silently shortens the session to
 * whatever `Max-Age` it was minted with.
 */
function withCookie(res: Response, cookie: string | null): Response {
  if (!cookie) return res;
  const headers = new Headers(res.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(res.body, { status: res.status, headers });
}

/** The `authorize()`-shaped half of `withCookie`, for the routes that use it. */
function withSession(auth: Authorized | null, res: Response): Response {
  return withCookie(res, auth?.refresh ?? null);
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
  return noStoreJson({ error: "not found" }, 404);
}

/* -------------------------------------------------------------------------- */
/* Attribution and the daily cap (R21)                                         */
/* -------------------------------------------------------------------------- */

/**
 * Who a `locate_log` row belongs to, and **which identity space its daily cap
 * is counted in**. The column name is a literal union rather than a string so
 * that the one place it reaches SQL cannot be handed anything else.
 */
interface Attribution {
  userId: string | null;
  deviceRowId: string | null;
  capColumn: "device_id" | "device_row_id" | "user_id";
  /** Null only on the anonymous branch with no `device_id` — a 400, not a row. */
  capKey: string | null;
}

/**
 * The attribution a row gets, from the credential that is writing it.
 *
 * A device credential keys its cap on `devices.id` and a session on `users.id`
 * — both server-minted, neither reachable by an anonymous caller, whose rows
 * keep counting against the free-form `device_id` they chose. That separation
 * is the KTD: merging the spaces would let an anonymous caller who learns a
 * paired board's id burn its cap, and (worse) would blur "this row belongs to
 * an account" with "this row named a string".
 *
 * A session with no device is not a gap: the cap still lands in a server-minted
 * space, and the account is the resource being bounded.
 */
function attribution(credential: Credential | null, deviceId: string | null): Attribution {
  if (!credential) {
    return { userId: null, deviceRowId: null, capColumn: "device_id", capKey: deviceId };
  }
  if (credential.kind === "device") {
    return {
      userId: credential.userId,
      deviceRowId: credential.deviceId,
      capColumn: "device_row_id",
      capKey: credential.deviceId,
    };
  }
  return {
    userId: credential.userId,
    deviceRowId: null,
    capColumn: "user_id",
    capKey: credential.userId,
  };
}

/** Today's inserts in this identity space, against `DAILY_LOG_CAP`. */
async function dailyCapReached(env: Env, attributed: Attribution): Promise<boolean> {
  const dayStartS = Math.floor(Date.now() / 1000 / 86_400) * 86_400;
  // `ts >= ?2` is what keeps this cheap in the two spaces with no composite
  // index: idx_locate_log_ts narrows to one day before the column is compared.
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM locate_log WHERE ${attributed.capColumn} = ?1 AND ts >= ?2`,
  )
    .bind(attributed.capKey, dayStartS)
    .first<{ n: number }>();
  return (count?.n ?? 0) >= DAILY_LOG_CAP;
}

/**
 * The tenancy predicate for a `locate_log` read or update, unconditionally
 * composed into both statements that touch existing rows.
 *
 * A session sees its own rows, and the fragment comes from `ownerPredicate` so
 * there is exactly one definition of "this user's rows" in the codebase.
 * DIAG_TOKEN resolves to **no** `Credential` — it names no user — so the only
 * rows it can be entitled to are the ones that belong to no user: the anonymous
 * diagnostic corpus its own inserts create. That is a narrowing, not an
 * oversight; see `handleLocateLog`.
 */
function historyPredicate(auth: Authorized | null, placeholderIndex: number): OwnerPredicate {
  if (!auth) return { sql: "user_id IS NULL", binds: [] };
  return ownerPredicate(auth.credential, "user_id", placeholderIndex);
}

/* -------------------------------------------------------------------------- */
/* The relay budget (R11) — U1's sharded counters, from email.ts               */
/* -------------------------------------------------------------------------- */

/**
 * Which network slice a user's next post draws on, given what that user has
 * already spent today. The whole point of the split: the posts a single account
 * can produce in volume are the ones past `FRESH_SLICE_POSTS`, so they get
 * their own pool and cannot exhaust the one everybody else's ordinary sends
 * land in.
 */
function sliceFor(userUsed: number): NetworkSlice {
  return userUsed < FRESH_SLICE_POSTS ? "fresh" : "repeat";
}

/**
 * Record — durably, not only in a log tail nobody is reading — that a network
 * slice turned away a post that had done nothing wrong.
 *
 * The network key is shared, so a refusal here can be somebody else's fault
 * entirely, and it is invisible in the response: the honest phone sees the same
 * 429 an abuser does. A counter failure must not turn a 429 into a 500, so it
 * is swallowed after being logged — it exists to report, never to gate.
 */
async function noteNetworkRefusal(env: Env, slice: NetworkSlice): Promise<void> {
  console.error(
    `[relay] refused: the ${slice} network slice is spent for today — honest callers behind ` +
      `this /24 or /64 are being turned away (auth_budgets scope=${RELAY_REFUSED_SCOPE})`,
  );
  try {
    await incrementBudget(env, RELAY_REFUSED_SCOPE, slice);
  } catch (err) {
    console.error(`[relay] refusal counter write failed: ${String(err)}`);
  }
}

/**
 * Bound one relay post before it writes anything.
 *
 * **Every counter is read before any is written** — the ordering
 * `chargeSendBudget` and `chargeStartBudget` established, and it is load bearing
 * for the same reason: the network key is caller-chosen, so charging it before
 * the bounds above it are checked would persist one `auth_budgets` row per
 * network for as long as anyone cares to POST.
 *
 * **The enforcing bound is per user, and the shared bound is sliced** — the
 * shape `chargeStartBudget` arrived at, for the same failure. A counter keyed
 * on `sessions.id` bounds nothing an account has to respect: sessions live 30
 * days, every magic-link redeem mints another, and five sends per address per
 * day means one mailbox accumulates five live sessions a day, each with its own
 * full allowance. So the account is the key, and the network — which is shared
 * with strangers and cannot be made unshared — carries a split cap instead of a
 * single one an attacker could spend to deny every other subscriber behind the
 * same CGNAT /24. The residue is the one `email.ts` accepts on its `known`
 * slice: an attacker who brings genuinely fresh *accounts* can still reach the
 * fresh pool, at the cost of one registration — itself rationed by R4's
 * unknown-address send slice — per `FRESH_SLICE_POSTS` posts.
 *
 * When `CF-Connecting-IP` is absent every caller collapses into one network key
 * (see `clientIp`). That is still one shared, tighter budget rather than an open
 * one, and the slice is what keeps the collapse survivable: a user's first
 * `FRESH_SLICE_POSTS` of the day draw on a pool nobody's runaway client can
 * spend.
 *
 * Not serializable, deliberately: two concurrent charges at the boundary can
 * both pass, so a limit of N admits N+1 in the worst case. That is the right
 * trade for a rate limit — the alternative is a transaction on the hot row that
 * sharding exists to avoid.
 */
async function chargeRelayBudget(
  env: Env,
  credential: Credential,
  ip: string,
): Promise<boolean> {
  // The account, never the session. `AUTH_MODE=single` has no session row at
  // all and binds every request to the same synthetic user, which this keys on
  // exactly like any other.
  const userKey = await hashToken(credential.userId);
  const ipKey = await hashToken(networkKey(ip));
  // The user's count is read first because it selects the slice, which is a
  // read too — no row exists until the last two statements.
  const userUsed = await readBudget(env, RELAY_USER_SCOPE, userKey);
  const slice = sliceFor(userUsed);
  const ipScope = slice === "fresh" ? RELAY_IP_FRESH_SCOPE : RELAY_IP_REPEAT_SCOPE;
  const ipLimit =
    slice === "fresh"
      ? budgetVar(env.RELAY_BUDGET_IP_FRESH, DEFAULT_RELAY_IP_FRESH_BUDGET)
      : budgetVar(env.RELAY_BUDGET_IP_REPEAT, DEFAULT_RELAY_IP_REPEAT_BUDGET);
  const ipUsed = await readBudget(env, ipScope, ipKey);
  if (userUsed >= budgetVar(env.RELAY_BUDGET_USER, DEFAULT_RELAY_USER_BUDGET)) {
    return false;
  }
  if (ipUsed >= ipLimit) {
    await noteNetworkRefusal(env, slice);
    return false;
  }
  await incrementBudget(env, RELAY_USER_SCOPE, userKey);
  await incrementBudget(env, ipScope, ipKey);
  return true;
}

/* -------------------------------------------------------------------------- */
/* POST /v1/locate                                                             */
/* -------------------------------------------------------------------------- */

/** POST /v1/locate — {wifiAccessPoints, device_id?, log?, label?} */
async function handleLocate(request: Request, env: Env): Promise<Response> {
  const parsed = await readWifiScanBody(request);
  if (parsed instanceof Response) return parsed;
  const { body, wifiAccessPoints } = parsed;

  const deviceId = boundedText(body.device_id, "device_id", MAX_DEVICE_ID_LENGTH);
  if (deviceId instanceof Response) return deviceId;
  const label = boundedText(body.label, "label", MAX_LABEL_LENGTH);
  if (label instanceof Response) return label;
  const wantsLog = body.log === true;

  // `resolveCredential` rather than `authorize`: this route is anonymous-capable
  // (R10) and must stay byte-identical for a board that presents nothing, and a
  // device that has *not* been granted `read:fix` must still get a WiFi answer
  // rather than a 403 — the grant enables a provider, it does not gate the
  // route. An anonymous multi-user request resolves to null without a query.
  const credential = await resolveCredential(request, env);
  // Resolving a session slides its window in D1, which the browser cannot see;
  // this route does not go through `authorize()`, so the cookie is re-issued
  // here or the slid window never reaches the client.
  const refresh = refreshCookie(request, credential);

  // DIAG_TOKEN wins over any credential the same request happens to carry: it
  // *is* the operator diagnostic path, and its rows belong to the walk rather
  // than to whoever was signed in on that laptop. That also keeps
  // `AUTH_MODE=single` — where every request resolves to the synthetic user —
  // from quietly attributing the operator's diagnostic corpus and hiding it
  // from `/v1/locate/log`.
  const diag = diagAuthorized(request, env);
  const attributed = diag ? attribution(null, deviceId) : attribution(credential, deviceId);

  if (wantsLog) {
    const denial = await checkLogInsert(request, env, credential, diag, attributed);
    if (denial) return withCookie(denial, refresh);
  }

  const result = await resolveLocation({ bssids: wifiAccessPoints, env, credential });

  // A phone-sourced resolution is never persisted as a diagnostic estimate.
  //
  // `quality` is on the wire for a relayed fix and for nothing else (see
  // `locate.ts`'s `toResolved`), which makes it the discriminator rather than a
  // provider-name string copied across module boundaries. Two things compose
  // into a leak without it: `log:true` now takes any session or device token,
  // and the chain answers from the relay first — so a board holding `read:fix`
  // could copy its owner's metre-accurate GPS position into `locate_log`, where
  // revoking the grant does not delete it and the 14-day sweep is the only
  // reaper. `device_fixes` is the one place that position lives, precisely
  // because `clearFix` empties it the instant the grant goes.
  //
  // Suppressing the row loses nothing the corpus wants: it exists to compare a
  // WiFi *estimate* against a phone *reference*, and when the phone answered
  // there is no estimate — the chain returned before WiFi was consulted.
  const phoneSourced = result.known && result.quality !== undefined;

  if (wantsLog && !phoneSourced) {
    await env.DB.prepare(
      `INSERT INTO locate_log
         (user_id, device_id, device_row_id, ts, est_lat, est_lon, est_accuracy,
          provider, bssid_count, label)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
      .bind(
        attributed.userId,
        deviceId,
        attributed.deviceRowId,
        nowS(),
        result.known ? result.lat : null,
        result.known ? result.lon : null,
        result.known ? result.accuracy : null,
        result.known ? result.provider : "none",
        wifiAccessPoints.length,
        label,
      )
      .run();
  }

  return withCookie(noStoreJson(result), refresh);
}

/**
 * May this request insert a diagnostic row, and is it inside its daily cap?
 *
 * The insert is authorized by *any* of the three credentials — that is what
 * R21's attribution needs, since `/v1/locate/ref` only UPDATEs and this is the
 * only statement in the codebase that creates a `locate_log` row. What differs
 * per credential is whose row it becomes, which `attribution` has already
 * decided by the time this runs.
 *
 * A device token is accepted here without naming a scope, which is the one
 * deliberate departure from `authorize()`'s fail-closed rule and is safe for a
 * specific reason: the board is writing *its own* diagnostic row and reads
 * nothing back. There is no authority to delegate, so there is no scope to
 * check — and the route already accepts device tokens for the locate chain
 * itself (U8).
 */
async function checkLogInsert(
  request: Request,
  env: Env,
  credential: Credential | null,
  diag: boolean,
  attributed: Attribution,
): Promise<Response | null> {
  if (!diag && !credential) {
    return noStoreJson({ error: "unauthorized" }, 401);
  }
  // Ambient credentials only (R3): the session cookie is the one thing a
  // browser attaches on its own, and this branch writes a row. Bearer
  // credentials — a device token, DIAG_TOKEN — are not ambient and are exempt,
  // the same asymmetry `authorize()` encodes.
  if (!diag && credential?.kind === "session") {
    const denial = checkAmbientCsrf(request);
    if (denial) return denial;
  }
  if (!attributed.capKey) {
    // Only reachable on the anonymous branch: an authenticated insert is keyed
    // by the credential, so it needs no client-supplied identifier at all.
    return noStoreJson({ error: "device_id required when log is true" }, 400);
  }
  if (await dailyCapReached(env, attributed)) {
    return noStoreJson({ error: "daily log cap reached" }, 429);
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* POST /v1/locate/ref — the single phone-fix ingress (R11)                    */
/* -------------------------------------------------------------------------- */

/**
 * POST /v1/locate/ref — `{lat, lon, accuracy?, captured_at?, relay?, log?,
 * device_id?, label?}`. One ingress, two independent jobs:
 *
 *  * **`relay: true`** (session only) writes the fix to every device of that
 *    user holding `read:fix`, and **short-circuits the pairing lookup** — a
 *    phone posting its position has no device WiFi scan in the last 60 seconds
 *    in the normal case, and 404ing that would make the relay unusable.
 *  * **`log: true`** (session or DIAG_TOKEN) keeps today's behavior exactly:
 *    pair the newest *unpaired* estimate for that device inside the 60 s
 *    window, compute `delta_m`, and 404 when there is none.
 *
 * `log` defaults to today's behavior — the pairing — so an existing diagnostic
 * caller that sends neither flag is unchanged; a relay-only post defaults it
 * off, since a phone fix has no estimate to pair with.
 *
 * The request **names no device for the relay** (R11): the session identifies
 * the user and the grant list identifies the recipients. `device_id` addresses
 * the diagnostic row only, and `putFixForUser` takes a user, so there is no
 * ownership parameter here to validate.
 */
async function handleLocateRef(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return noStoreJson({ error: "invalid JSON body" }, 400);
  }

  const wantsRelay = body.relay === true;
  const wantsLog = typeof body.log === "boolean" ? body.log : !wantsRelay;
  if (!wantsRelay && !wantsLog) {
    return noStoreJson({ error: "relay or log must be true" }, 400);
  }

  const diag = diagAuthorized(request, env);
  // A relay post always goes through the chokepoint, whatever else it carries:
  // `putFixForUser` takes a user, and DIAG_TOKEN names none. `authorize()`
  // refuses device credentials on a route that declares no scope, so a
  // successful return here is a session by construction — there is no
  // `kind === "session"` check below because there is no other possibility.
  let auth: Authorized | null = null;
  if (wantsRelay || !diag) {
    const result = await authorize(request, env, { stateChanging: true });
    if (result instanceof Response) return result;
    auth = result;
  }

  // Everything is validated before anything is written, so a malformed
  // diagnostic field cannot 400 a request whose fix has already been relayed.
  const lat = body.lat;
  const lon = body.lon;
  if (!isLatitude(lat) || !isLongitude(lon)) {
    return withSession(auth, noStoreJson({ error: "lat and lon required, in range" }, 400));
  }
  const accuracy = typeof body.accuracy === "number" && Number.isFinite(body.accuracy)
    ? body.accuracy
    : null;
  const label = boundedText(body.label, "label", MAX_LABEL_LENGTH);
  if (label instanceof Response) return withSession(auth, label);
  const deviceId = boundedText(body.device_id, "device_id", MAX_DEVICE_ID_LENGTH);
  if (deviceId instanceof Response) return withSession(auth, deviceId);
  if (wantsLog && !deviceId) {
    return withSession(auth, noStoreJson({ error: "device_id required when log is true" }, 400));
  }
  const capturedAt = readCapturedAt(body.captured_at);
  if (capturedAt instanceof Response) return withSession(auth, capturedAt);

  const payload: Record<string, unknown> = {};

  if (wantsRelay) {
    // Unreachable: `wantsRelay` took the `authorize()` branch above, which
    // either returned a denial or produced a session. Spelled as a refusal
    // rather than an assertion so a future edit to that branch cannot turn a
    // missing credential into a silent 200.
    if (!auth) return noStoreJson({ error: "unauthorized" }, 401);
    if (!(await chargeRelayBudget(env, auth.credential, clientIp(request)))) {
      return withSession(auth, noStoreJson({ error: "relay budget spent" }, 429));
    }
    // Ungated on purpose (R12): whatever the phone reports is stored,
    // `accuracy_m` and all, and the provider chain gates it at read time so a
    // coarse fix falls through to the next provider instead of being lost.
    const { targeted, written } = await putFixForUser(env, auth.credential.userId, {
      lat,
      lon,
      accuracyM: accuracy,
      capturedAt,
    });
    // Counts of the caller's *own* boards, which the caller can already read
    // from `/v1/config/devices`; `devices` is what lets the UI say "no device is
    // set to receive this" instead of implying the fix went somewhere.
    //
    // `stored` is reported separately because the two differ, and the case they
    // differ in is the one the fan-out's accuracy refinement exists for: a
    // board holding a strictly more accurate fix from inside the horizon keeps
    // it. Reporting `targeted` alone would let the UI say "each keeps this
    // position until a newer one arrives" about a board that is still showing
    // the position from three streets back.
    payload.relayed = { devices: targeted, stored: written };
  }

  if (wantsLog && deviceId) {
    const paired = await pairReference(env, auth, {
      deviceId,
      lat,
      lon,
      accuracy,
      label,
    });
    if (!paired) {
      // The 404 belongs to the *pairing*, so it survives only when the pairing
      // was the whole request. A relay post that also asked to pair has already
      // done the thing it was for.
      if (!wantsRelay) {
        return withSession(auth, noStoreJson({ error: "no unpaired estimate within 60s" }, 404));
      }
    } else {
      payload.id = paired.id;
      payload.delta_m = paired.deltaM;
    }
  }

  return withSession(auth, noStoreJson(payload));
}

function isLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 90;
}

function isLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 180;
}

/**
 * When the phone fixed the position, in epoch **seconds** — defaulting to now.
 *
 * Validating it is this route's job rather than the store's (see `getFix`): a
 * client that sends milliseconds is off by a factor of a thousand, and clamping
 * that silently would file a fix from the year 58000 as "captured just now".
 * A skewed-but-plausible clock is allowed through and floors to age 0
 * downstream; anything past `MAX_FIX_SKEW_S` or older than `MAX_FIX_AGE_S` is
 * told so.
 */
function readCapturedAt(raw: unknown): number | Response {
  if (raw === undefined || raw === null) return nowS();
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return noStoreJson({ error: "captured_at must be epoch seconds" }, 400);
  }
  const captured = Math.floor(raw);
  const now = nowS();
  if (captured > now + MAX_FIX_SKEW_S || captured < now - MAX_FIX_AGE_S) {
    return noStoreJson({ error: "captured_at is not a plausible epoch-seconds time" }, 400);
  }
  return captured;
}

/**
 * Pair the phone reference to the newest unpaired estimate for this device
 * inside the 60 s window, and compute the haversine `delta_m`. Returns null
 * when there is nothing to pair with.
 *
 * **The lookup carries the tenancy predicate**, which is what stops a caller
 * writing their phone's position into a row belonging to somebody else: rows
 * are addressed by a client-chosen `device_id`, so without it an operator — or
 * any account — could pair against an identified user's estimate the moment
 * those estimates started carrying a `user_id`.
 */
async function pairReference(
  env: Env,
  auth: Authorized | null,
  ref: {
    deviceId: string;
    lat: number;
    lon: number;
    accuracy: number | null;
    label: string | null;
  },
): Promise<{ id: number; deltaM: number | null } | null> {
  const binds: (string | number)[] = [ref.deviceId, nowS() - REF_PAIR_WINDOW_S];
  const scope = historyPredicate(auth, binds.length + 1);
  binds.push(...scope.binds);
  const est = await env.DB.prepare(
    `SELECT id, est_lat, est_lon FROM locate_log
     WHERE device_id = ?1 AND ref_lat IS NULL AND ts >= ?2 AND ${scope.sql}
     ORDER BY ts DESC, id DESC LIMIT 1`,
  )
    .bind(...binds)
    .first<{ id: number; est_lat: number | null; est_lon: number | null }>();
  if (!est) return null;

  // delta_m only when the estimate actually resolved ({known:false} rows pair
  // with a null delta — the miss itself is the diagnostic datum).
  const deltaM =
    est.est_lat !== null && est.est_lon !== null
      ? haversineM(est.est_lat, est.est_lon, ref.lat, ref.lon)
      : null;

  await env.DB.prepare(
    `UPDATE locate_log
     SET ref_lat = ?1, ref_lon = ?2, ref_accuracy = ?3, delta_m = ?4,
         label = COALESCE(?5, label)
     WHERE id = ?6`,
  )
    .bind(ref.lat, ref.lon, ref.accuracy, deltaM, ref.label, est.id)
    .run();

  return { id: est.id, deltaM };
}

/* -------------------------------------------------------------------------- */
/* GET /v1/locate/log                                                          */
/* -------------------------------------------------------------------------- */

/**
 * GET /v1/locate/log?device_id=&since= — diagnostic rows, newest first.
 *
 * **Operator-only, and scoped to the rows no user owns.** DIAG_TOKEN names no
 * user, so "every row in the table" was never the right answer for it — it was
 * only a harmless one while every row was anonymous. Now that a session or a
 * board attributes its inserts, the operator secret's entitlement is exactly
 * the anonymous diagnostic corpus its own walk creates, and `user_id IS NULL`
 * says so in SQL rather than in a comment.
 *
 * No session branch is added here on purpose: U14 owes R21 an *attribution*,
 * not a history-reading surface, and the account-facing reads land with the
 * rest of `/v1/config` (U15) and the deletion (U16). What this shape
 * guarantees for them is that the predicate is composed unconditionally — there
 * is no code path through this handler that omits it — so the per-user read is
 * a change of credential, never a change of whether tenancy is checked.
 */
async function handleLocateLog(request: Request, env: Env, url: URL): Promise<Response> {
  if (!diagAuthorized(request, env)) {
    return noStoreJson({ error: "unauthorized" }, 401);
  }

  const deviceId = url.searchParams.get("device_id");
  const sinceRaw = url.searchParams.get("since");
  const since = sinceRaw === null ? null : Number(sinceRaw);
  if (since !== null && !Number.isFinite(since)) {
    return noStoreJson({ error: "since must be an epoch-seconds number" }, 400);
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
  const scope = historyPredicate(null, binds.length + 1);
  clauses.push(scope.sql);
  binds.push(...scope.binds);

  const rows = await env.DB.prepare(
    `SELECT * FROM locate_log WHERE ${clauses.join(" AND ")} ORDER BY ts DESC, id DESC LIMIT ${LOG_PAGE_LIMIT}`,
  )
    .bind(...binds)
    .all();

  return noStoreJson({ rows: rows.results });
}
