/**
 * auth.ts — the one chokepoint that mints, validates, rotates, revokes, and
 * scopes every credential (Phase 5 plan, U2; requirements R3, R5, R9).
 *
 * Seam shape mirrors `locate.ts`: exported types, pure functions, `env` passed
 * in rather than captured, no classes, and the policy in exactly one place.
 *
 * Two properties this module exists to guarantee, both structural rather than
 * remembered by each route:
 *
 *  1. **A Bearer credential can never come back as `kind:"session"`.** Sessions
 *     are read exclusively from the `__Host-` cookie; the `Authorization`
 *     header is consulted only on the device branch, which can only ever
 *     produce `kind:"device"` or `null`. A device token is therefore not
 *     exchangeable for a session (R9) by construction, not by convention.
 *
 *  2. **Every user-owned read and write carries the ownership predicate this
 *     module returns.** `authorize()` hands back `owner` — a bindable SQL
 *     fragment scoping rows to the credential's user — so a route cannot
 *     "forget" the tenancy check the way today's unscoped `SELECT * FROM
 *     locate_log` did. Routes never invent their own `user_id = ?` clause.
 *
 *  3. **A route that does not name a scope does not accept device tokens at
 *     all** (U6, R9). Scope is enforced *here*, never by route convention: a
 *     device credential reaches a handler only when that handler declared
 *     `scope`, so every account surface added later — the email, the device
 *     list, config writes, the pair claim — is device-proof the moment it is
 *     written, without anyone remembering to add a guard. The framing that
 *     matters is not "a device token cannot hurt the account": once the relay
 *     lands this token reads its owner's live position, so `read:fix` is
 *     separately grantable, separately revocable, and never implied.
 *
 * CSRF (R3) is deliberately scoped to **ambient** credentials — the session
 * cookie and the pre-session redeem nonce cookie — because ambient credentials
 * are the entirety of CSRF's threat model. `POST /v1/device/pair/start`,
 * `POST /v1/device/pair/poll` and the `DIAG_TOKEN` branch of `/v1/locate/ref`
 * authenticate with a Bearer credential a browser never attaches on its own,
 * and are called by firmware and harnesses that send no `Origin` at all; a
 * blanket rule would 403 the whole pairing flow while protecting nothing.
 */

import { intVar } from "./vars";

/**
 * The fixed synthetic user `AUTH_MODE=single` binds to. Seeded by migration
 * 0003 — the string is a contract with that file; change it in both or not at
 * all.
 */
export const SINGLE_USER_ID = "usr_single";

/** Session cookie. `__Host-` forbids `Domain` and requires `Secure` + `Path=/`. */
export const SESSION_COOKIE = "__Host-gc_session";
/** Pre-session nonce cookie set by `/v1/auth/request`, matched by `/v1/auth/redeem`. */
export const NONCE_COOKIE = "__Host-gc_nonce";

/**
 * The custom request header every ambient-credential state change must carry.
 * Its defense is presence, not value: a cross-origin form post cannot set an
 * arbitrary header without a CORS preflight the Worker never grants.
 */
export const CSRF_HEADER = "X-GC-CSRF";

/** Device tokens are prefixed so they are recognizable in logs and in code (R9). */
export const DEVICE_TOKEN_PREFIX = "gtfsc_dev_";

/**
 * **Specified and deliberately unimplemented** (R9). No route emits this header
 * today; the constant exists so that the name is fixed and testable before
 * anything depends on it.
 *
 * The contract firmware may implement now, so that turning rotation on later is
 * not a breaking change: any response to a device-token request *may* carry
 * `X-GC-Device-Token: <new token>`. A device that sees it must persist the new
 * value and use it for every subsequent request; the token it presented stays
 * valid only until the rotation is observed. A device that ignores the header
 * keeps working exactly as it does today — which is what makes shipping the
 * header later safe, and what makes writing it into the firmware now free.
 *
 * It is a *response* header and never a request header: nothing a client sends
 * under this name is read, so a client cannot ask for a rotation.
 */
export const DEVICE_TOKEN_ROTATION_HEADER = "X-GC-Device-Token";

/**
 * How stale `devices.last_used_at` may get before a device request refreshes
 * it — five minutes.
 *
 * The column exists so the device list (U10) can show a stolen board still
 * calling home, which needs minutes of resolution, not seconds. Stamping it on
 * every request would put a D1 write on the hot path of a board that polls
 * every 20 s (180 writes/hour/device against the same single-primary database
 * that serves session validation); a five-minute floor caps that at 12, and the
 * displayed value is never more than five minutes behind the truth. Same shape
 * as `validateSession`'s half-life renewal, and for the same reason: a read
 * stays a read.
 */
export const DEVICE_LAST_USED_SLIDE_S = 300;

const DAY_S = 86_400;
/** Sliding session window (R3: 30 days), renewed at its half-life. */
const DEFAULT_SESSION_TTL_DAYS = 30;
/** Absolute ceiling (R3: 180 days) anchored on `sessions.created_at`. */
const DEFAULT_SESSION_ABSOLUTE_TTL_DAYS = 180;
/** Nonce cookie lifetime — matches the 10-minute magic-token expiry (R1). */
export const NONCE_TTL_S = 600;

/** Device scopes (R9). Separately grantable and revocable; `read:fix` is never implied. */
export type Scope = "read:departures" | "read:config" | "read:fix";

/**
 * Every scope that exists, in the order they are stored and displayed. Exported
 * because the grant surface (U10's `routes/config.ts`) has to answer "is this a
 * scope at all" and has to write the column back in a canonical order — a
 * toggle that reordered `devices.scopes` would make the compare-and-set it
 * depends on fail against a semantically identical value.
 */
export const KNOWN_SCOPES: readonly Scope[] = ["read:departures", "read:config", "read:fix"];

/**
 * A resolved credential. `session` is the account itself (ambient, cookie-borne);
 * `device` is a scoped Bearer credential that can never reach account surfaces.
 */
export type Credential =
  | {
      kind: "session";
      userId: string;
      sessionId: string | null;
      single?: true;
      /**
       * Set only when this request slid the window. `expires_at` moving in D1
       * is invisible to the browser — its `Max-Age` was fixed at mint — so the
       * response has to re-issue the cookie or the sliding window has no
       * user-visible effect at all. See `Authorized.refresh`.
       */
      renewedExpiresAtS?: number;
    }
  | { kind: "device"; deviceId: string; userId: string; scopes: readonly Scope[] };

/** A bindable `WHERE` fragment scoping rows to the credential's owner. */
export interface OwnerPredicate {
  /** e.g. `user_id = ?1` — AND this into the query's WHERE clause. */
  sql: string;
  /** Values for the fragment's placeholders, in order. */
  binds: string[];
}

/** What a route gets once the chokepoint has said yes. */
export interface Authorized {
  credential: Credential;
  /** Default `user_id = ?1`; call `ownerPredicate` directly for other shapes. */
  owner: OwnerPredicate;
  /**
   * A ready `Set-Cookie` when this request renewed the session, else null.
   * **Any route that answers 2xx and leaves the session in place must append
   * it**, or the window slides in D1 only and the browser still hard-expires
   * the cookie at the original `Max-Age`. Sign-out is the deliberate exception:
   * it clears the cookie instead.
   */
  refresh: string | null;
}

export interface MintedSession {
  token: string;
  sessionId: string;
  /** Epoch seconds; `created_at` is the anchor for the 180-day absolute cap. */
  createdAtS: number;
  expiresAtS: number;
  /** Ready `Set-Cookie` value. */
  cookie: string;
}

function sessionTtlS(env: Env): number {
  return intVar(env.SESSION_TTL_DAYS, DEFAULT_SESSION_TTL_DAYS) * DAY_S;
}

function sessionAbsoluteTtlS(env: Env): number {
  return intVar(env.SESSION_ABSOLUTE_TTL_DAYS, DEFAULT_SESSION_ABSOLUTE_TTL_DAYS) * DAY_S;
}

function nowS(): number {
  return Math.floor(Date.now() / 1000);
}

/* -------------------------------------------------------------------------- */
/* Tokens and hashing                                                          */
/* -------------------------------------------------------------------------- */

/** SHA-256 hex. Every secret in this phase is stored hashed, never in the clear. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** CSPRNG token, base64url, no padding. 16 bytes = the 128 bits R3 requires. */
export function randomToken(byteLength = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* -------------------------------------------------------------------------- */
/* Cookies                                                                     */
/* -------------------------------------------------------------------------- */

function cookieHeader(name: string, value: string, maxAgeS: number): string {
  // No Domain attribute: `__Host-` forbids it, and that is the point — the
  // cookie is pinned to this exact host and cannot be set by a sibling.
  return `${name}=${value}; Max-Age=${maxAgeS}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

/** `Set-Cookie` for a freshly minted session. */
export function sessionCookie(token: string, maxAgeS: number): string {
  return cookieHeader(SESSION_COOKIE, token, maxAgeS);
}

/** `Set-Cookie` that deletes the session cookie (sign-out, rotation failure). */
export function clearedSessionCookie(): string {
  return cookieHeader(SESSION_COOKIE, "", 0);
}

/** `Set-Cookie` for the pre-session redeem nonce (U4 sets it at request time). */
export function nonceCookie(nonce: string, maxAgeS: number = NONCE_TTL_S): string {
  return cookieHeader(NONCE_COOKIE, nonce, maxAgeS);
}

/** `Set-Cookie` that deletes the nonce cookie once redemption has consumed it. */
export function clearedNonceCookie(): string {
  return cookieHeader(NONCE_COOKIE, "", 0);
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    // Keep scanning past an empty one rather than returning on the first name
    // match: a cleared cookie from a wider path can sit in the same header
    // ahead of the live one, and stopping there logs the user out.
    if (value !== "") return value;
  }
  return null;
}

/** The ambient session token, cookie-only — never a header, never a query param. */
export function readSessionCookie(request: Request): string | null {
  return readCookie(request, SESSION_COOKIE);
}

/** The pre-session redeem nonce, for U4's `/v1/auth/redeem` match. */
export function readNonceCookie(request: Request): string | null {
  return readCookie(request, NONCE_COOKIE);
}

/* -------------------------------------------------------------------------- */
/* Sessions (R3)                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Mint a session row and its cookie. `createdAtS` lets rotation carry the
 * absolute-cap anchor forward instead of resetting it; callers minting a fresh
 * sign-in omit it.
 */
export async function mintSession(
  env: Env,
  userId: string,
  opts: { createdAtS?: number } = {},
): Promise<MintedSession> {
  const { statement, minted } = await prepareSession(env, userId, opts.createdAtS);
  await statement.run();
  return minted;
}

/**
 * The INSERT plus the values describing it, so `rotateSession` can put the
 * insert and the old row's delete in one `batch()` rather than two writes that
 * can half-succeed.
 */
async function prepareSession(
  env: Env,
  userId: string,
  createdAtOverrideS?: number,
): Promise<{ statement: D1PreparedStatement; minted: MintedSession }> {
  const issuedAtS = nowS();
  const createdAtS = createdAtOverrideS ?? issuedAtS;
  const expiresAtS = Math.min(issuedAtS + sessionTtlS(env), createdAtS + sessionAbsoluteTtlS(env));
  const token = randomToken();
  const sessionId = `ses_${randomToken(12)}`;
  const statement = env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_used_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(sessionId, userId, await hashToken(token), createdAtS, expiresAtS, issuedAtS);
  return {
    statement,
    minted: {
      token,
      sessionId,
      createdAtS,
      expiresAtS,
      cookie: sessionCookie(token, expiresAtS - issuedAtS),
    },
  };
}

/**
 * Validate a session token, sliding its window when — and only when — it is
 * past the half-life **and the renewed value actually moves**. The half-life
 * condition is what keeps a read a read (R3): an unconditional `last_used_at`
 * stamp would put a D1 write on every page load. The second condition covers
 * the far end of the same problem: once `expires_at` is pinned to the absolute
 * cap, `Math.min` stops moving it while the half-life test stays permanently
 * true, so an unguarded UPDATE rewrites an identical row on every request.
 *
 * A renewal is reported back on the credential (`renewedExpiresAtS`) because
 * the browser cannot see a D1 column — `authorize()` turns it into the
 * `Set-Cookie` the response must carry.
 */
export async function validateSession(env: Env, token: string): Promise<Credential | null> {
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT id, user_id, created_at, expires_at FROM sessions WHERE token_hash = ?1",
  )
    .bind(await hashToken(token))
    .first<{ id: string; user_id: string; created_at: number; expires_at: number }>();
  if (!row) return null;

  const now = nowS();
  const absoluteEndS = row.created_at + sessionAbsoluteTtlS(env);
  // Both ends checked independently: a row whose expires_at was somehow
  // extended past the absolute cap is still dead at 180 days.
  if (row.expires_at <= now || absoluteEndS <= now) return null;

  const credential: Credential = { kind: "session", userId: row.user_id, sessionId: row.id };
  const ttlS = sessionTtlS(env);
  if (now >= row.expires_at - Math.floor(ttlS / 2)) {
    const renewedS = Math.min(now + ttlS, absoluteEndS);
    if (renewedS > row.expires_at) {
      await env.DB.prepare(
        "UPDATE sessions SET expires_at = ?1, last_used_at = ?2 WHERE id = ?3",
      )
        .bind(renewedS, now, row.id)
        .run();
      credential.renewedExpiresAtS = renewedS;
    }
  }
  return credential;
}

/**
 * Rotate on authentication (R3): issue a new token and destroy the old row in
 * one batch. `created_at` is carried forward, so rotation cannot be used to
 * walk a session past its 180-day absolute cap.
 *
 * `opts.userId` is what makes this safe on the redeem path, where the cookie
 * already in the browser may belong to somebody else entirely: a rotation is
 * only a rotation when the continuing session is the *same account's*. A
 * mismatch returns null and the caller revokes and mints instead, so a
 * stranger's absolute-cap anchor can never be inherited by a new sign-in.
 */
export async function rotateSession(
  env: Env,
  oldToken: string,
  opts: { userId?: string } = {},
): Promise<MintedSession | null> {
  if (!oldToken) return null;
  const oldHash = await hashToken(oldToken);
  const row = await env.DB.prepare(
    "SELECT id, user_id, created_at, expires_at FROM sessions WHERE token_hash = ?1",
  )
    .bind(oldHash)
    .first<{ id: string; user_id: string; created_at: number; expires_at: number }>();
  if (!row) return null;
  if (opts.userId !== undefined && row.user_id !== opts.userId) return null;
  const now = nowS();
  if (row.expires_at <= now || row.created_at + sessionAbsoluteTtlS(env) <= now) return null;

  const { statement, minted } = await prepareSession(env, row.user_id, row.created_at);
  // One batch, so the old token cannot survive a half-failed rotation: D1 runs
  // a batch as a single transaction, and the point of rotating is that exactly
  // one token is live afterwards.
  await env.DB.batch([statement, env.DB.prepare("DELETE FROM sessions WHERE id = ?1").bind(row.id)]);
  return minted;
}

/** Revoke one session by its token. Returns false when nothing was revoked. */
export async function revokeSession(env: Env, token: string): Promise<boolean> {
  if (!token) return false;
  const result = await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1")
    .bind(await hashToken(token))
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/* -------------------------------------------------------------------------- */
/* Scopes (R9 — the type and parsing land here so U6 slots in)                 */
/* -------------------------------------------------------------------------- */

/**
 * Parse `devices.scopes` (a comma-joined list). Unknown entries are dropped
 * rather than carried: an unrecognized scope must never widen a grant, and
 * `read:fix` is only ever present when it was explicitly stored.
 */
export function parseScopes(raw: string | null | undefined): Scope[] {
  if (!raw) return [];
  const out: Scope[] = [];
  for (const part of raw.split(",")) {
    const scope = part.trim();
    if (!KNOWN_SCOPES.includes(scope as Scope)) continue;
    if (out.includes(scope as Scope)) continue;
    out.push(scope as Scope);
  }
  return out;
}

/** Serialize scopes for the `devices.scopes` column. */
export function formatScopes(scopes: readonly Scope[]): string {
  return scopes.join(",");
}

/**
 * Scope test. A session is the account itself and is not scope-limited; only
 * device credentials carry scopes, which is exactly R9's asymmetry.
 *
 * That asymmetry survives U6 deliberately. Scopes are a *delegation* boundary —
 * what the owner has lent to a board sitting on a shelf — not an authorization
 * matrix over the account. The user reading their own position in the config UI
 * is not exercising a grant, so `hasScope(session, "read:fix")` is true; the
 * board only gets it when the owner says so. Route-level access is therefore
 * expressed as "which credential kinds may call this", which is what
 * `authorize()`'s fail-closed device rule below encodes.
 */
export function hasScope(credential: Credential, scope: Scope): boolean {
  return credential.kind === "session" || credential.scopes.includes(scope);
}

/**
 * The other half of a device credential's authority: **which device it may
 * speak about.** Scopes say what kind of thing a token may read; this says that
 * a token may only ever read *its own* row.
 *
 * It exists because `GET /v1/config/:device_id` (U15) is the one surface where
 * a client-supplied device id survived the relay redesign, and the ownership
 * predicate alone does not cover it: two boards paired to the same account pass
 * `user_id = ?` identically, so without this a token pulled from one board
 * addresses the other. A session is the account and may name any of its own
 * devices — the tenancy check for that case is `owner`, applied in SQL.
 *
 * Returns a ready 403 on denial and `null` on pass, like `checkAmbientCsrf`.
 * `authorize({ deviceId })` is the way routes should reach it.
 */
export function checkDeviceTarget(credential: Credential, deviceId: string): Response | null {
  if (credential.kind !== "device") return null;
  if (credential.deviceId !== deviceId) return forbidden("device id is not this device's");
  return null;
}

/* -------------------------------------------------------------------------- */
/* The ownership predicate                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The tenancy check every user-owned query must carry. A device credential is
 * scoped to its **owning user**, not to its device id: a device reads its
 * owner's rows, never another account's.
 */
export function ownerPredicate(
  credential: Credential,
  column = "user_id",
  placeholderIndex = 1,
): OwnerPredicate {
  return { sql: `${column} = ?${placeholderIndex}`, binds: [credential.userId] };
}

/* -------------------------------------------------------------------------- */
/* AUTH_MODE (R5)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * `AUTH_MODE=single` is an auth bypass, so parsing fails closed: an **exact**
 * string match and nothing else. Unset, mis-cased, whitespace-padded or
 * unrecognized all mean multi-user.
 *
 * The CSRF and `Origin` checks still apply in this mode, but they constrain
 * browsers only: with no credential in play, any non-browser client that
 * reaches the Worker hostname is the synthetic user. Single-user mode is only
 * safe behind a network-level control (Cloudflare Access, a private hostname).
 */
export function isSingleUserMode(env: Env): boolean {
  return env.AUTH_MODE === "single";
}

/* -------------------------------------------------------------------------- */
/* CSRF / Origin (R3), ambient credentials only                                */
/* -------------------------------------------------------------------------- */

function forbidden(reason: string): Response {
  // The body names the failed control for the operator; it leaks nothing about
  // whether a credential existed.
  return Response.json({ error: `forbidden: ${reason}` }, { status: 403 });
}

/**
 * The ambient-credential CSRF gate: a custom header **and** an `Origin` that
 * matches this Worker's own origin (the PWA is same-origin by R16). An absent
 * `Origin` is a 403 — a request that declines to say where it came from is not
 * given the benefit of the doubt.
 *
 * Returns a ready `Response` on denial, `null` on pass. Call it directly for
 * pre-session ambient credentials such as U4's redeem nonce cookie, where
 * there is no `Credential` to authorize yet.
 */
export function checkAmbientCsrf(request: Request): Response | null {
  const header = request.headers.get(CSRF_HEADER);
  if (!header) return forbidden(`missing ${CSRF_HEADER}`);
  const origin = request.headers.get("Origin");
  if (!origin) return forbidden("missing Origin");
  if (origin !== new URL(request.url).origin) return forbidden("cross-origin request");
  return null;
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

/** Bearer credential from the header only — a token in a query param never counts. */
function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token === "" ? null : token;
}

/**
 * Resolve a device token (U6, R9): one indexed lookup on
 * `idx_devices_token_hash`, `revoked_at` honored, scopes parsed from the
 * column, `last_used_at` slid rather than stamped.
 *
 * It resolves on *this* branch only, so it can only ever produce
 * `kind:"device"` or `null`, never a session.
 *
 * **Revoked and never-existed are the same answer.** Both return null and the
 * caller turns both into the same 401 with the same body; the two paths run the
 * same single indexed SELECT and neither writes, so nothing distinguishes them
 * by content or by shape. Telling a token holder "this one used to be real"
 * would confirm a board's token to whoever pulled a candidate out of flash.
 *
 * A row with a NULL `user_id` is treated as no credential at all: `user_id` is
 * what `ownerPredicate` binds, and a credential that cannot name an owner must
 * not be handed to a route that is about to scope a query by it. Pairing never
 * writes such a row (the insert selects a non-NULL `claimed_by`); this is the
 * structural guarantee that it could not be used if one appeared.
 */
async function resolveDeviceToken(token: string, env: Env): Promise<Credential | null> {
  const row = await env.DB.prepare(
    "SELECT id, user_id, scopes, revoked_at, last_used_at FROM devices WHERE token_hash = ?1",
  )
    .bind(await hashToken(token))
    .first<{
      id: string;
      user_id: string | null;
      scopes: string | null;
      revoked_at: number | null;
      last_used_at: number | null;
    }>();
  if (!row) return null;
  if (row.revoked_at !== null) return null;
  if (!row.user_id) return null;

  const now = nowS();
  // Past the floor, or never used at all. A `last_used_at` somehow ahead of now
  // (clock skew) fails this test and writes nothing, which is the safe way
  // round: the worst case is a stale display, not a write per request.
  if (row.last_used_at === null || row.last_used_at <= now - DEVICE_LAST_USED_SLIDE_S) {
    // Unconditional on the row rather than a compare-and-set: two concurrent
    // requests past the floor write the same second to the same column, which
    // is idempotent, and a CAS here would buy nothing but a longer statement.
    await env.DB.prepare("UPDATE devices SET last_used_at = ?1 WHERE id = ?2")
      .bind(now, row.id)
      .run();
  }

  return {
    kind: "device",
    deviceId: row.id,
    userId: row.user_id,
    scopes: parseScopes(row.scopes),
  };
}

/**
 * Resolve a request to a credential, or `null`.
 *
 * Branch order is deliberate. The device branch is first and terminal: a
 * request presenting a device token is a device request even if it also
 * carries a cookie, so a stolen board's token can never be laundered into the
 * ambient session sitting in the same browser. Single-user mode short-circuits
 * only the *session* branch (R5), never the device branch.
 */
export async function resolveCredential(request: Request, env: Env): Promise<Credential | null> {
  const bearer = bearerToken(request);
  if (bearer?.startsWith(DEVICE_TOKEN_PREFIX)) {
    return resolveDeviceToken(bearer, env);
  }
  if (isSingleUserMode(env)) {
    return { kind: "session", userId: SINGLE_USER_ID, sessionId: null, single: true };
  }
  const token = readSessionCookie(request);
  if (!token) return null;
  return validateSession(env, token);
}

/**
 * The chokepoint routes call. Resolves the credential, applies the ambient
 * CSRF gate to state-changing requests, enforces device scope and device
 * targeting, and hands back the ownership predicate the route must apply to
 * its SQL.
 *
 * Two defaults, both failing safe so a route added later is protected by
 * omission rather than by memory:
 *
 *  * `stateChanging` defaults to "anything that is not a GET or HEAD", so a new
 *    write route is CSRF-gated without anyone saying so.
 *  * **`scope` absent means device tokens are refused outright** (R9). Naming a
 *    scope is how a route opts into being callable by a board; the account
 *    surfaces — the email, the device list, config writes, `/v1/pair/claim` —
 *    name none and are therefore session-only by construction. This is the
 *    denial AE6 asks for, and it is one rule rather than one guard per route.
 *
 * `deviceId` is for routes that take a device id in the path: it holds a device
 * credential to its own row (see `checkDeviceTarget`).
 */
export async function authorize(
  request: Request,
  env: Env,
  opts: { stateChanging?: boolean; scope?: Scope; deviceId?: string } = {},
): Promise<Authorized | Response> {
  const credential = await resolveCredential(request, env);
  if (!credential) return Response.json({ error: "unauthorized" }, { status: 401 });

  const stateChanging =
    opts.stateChanging ?? !(request.method === "GET" || request.method === "HEAD");
  // Ambient == the browser attaches it on its own. Bearer credentials are not
  // ambient and are deliberately exempt (R3): firmware and harnesses send no
  // Origin, and gating them would break pairing while protecting nothing.
  if (stateChanging && credential.kind === "session") {
    const denial = checkAmbientCsrf(request);
    if (denial) return denial;
  }

  if (credential.kind === "device" && !opts.scope) {
    // The fail-closed rule. A route that named no scope is an account surface,
    // and an account surface is not something a board may call.
    return forbidden("device tokens are not accepted on this route");
  }
  if (opts.scope && !hasScope(credential, opts.scope)) {
    return forbidden(`missing scope ${opts.scope}`);
  }
  if (opts.deviceId !== undefined) {
    const denial = checkDeviceTarget(credential, opts.deviceId);
    if (denial) return denial;
  }

  return {
    credential,
    owner: ownerPredicate(credential),
    refresh: refreshCookie(request, credential),
  };
}

/**
 * The `Set-Cookie` a renewed session needs, or null. Rebuilt from the token the
 * request presented — the plaintext exists only in that header, never in D1 —
 * so this is the only point at which a slid window can reach the browser.
 */
function refreshCookie(request: Request, credential: Credential): string | null {
  if (credential.kind !== "session" || credential.renewedExpiresAtS === undefined) return null;
  const token = readSessionCookie(request);
  if (!token) return null;
  return sessionCookie(token, Math.max(0, credential.renewedExpiresAtS - nowS()));
}
