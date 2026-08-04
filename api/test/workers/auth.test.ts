import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CSRF_HEADER,
  DEVICE_LAST_USED_SLIDE_S,
  DEVICE_TOKEN_PREFIX,
  DEVICE_TOKEN_ROTATION_HEADER,
  NONCE_COOKIE,
  SESSION_COOKIE,
  SINGLE_USER_ID,
  authorize,
  checkDeviceTarget,
  clearedNonceCookie,
  clearedSessionCookie,
  hasScope,
  hashToken,
  isSingleUserMode,
  mintSession,
  nonceCookie,
  ownerPredicate,
  parseScopes,
  randomToken,
  readNonceCookie,
  resolveCredential,
  revokeSession,
  rotateSession,
  sessionCookie,
  validateSession,
} from "../../src/auth";
import { resetSchema } from "./schema";

const DIAG_TOKEN = "test-diag-token"; // bound in vitest.config.ts miniflare bindings
const ORIGIN = "https://api.example";
const USER = "usr_test";
const DAY_S = 86_400;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Request builder: every ambient-credential knob is explicit and omittable. */
function req(
  path: string,
  opts: {
    method?: string;
    cookies?: Record<string, string>;
    origin?: string | null;
    csrf?: string | null;
    bearer?: string;
  } = {},
): Request {
  const headers = new Headers();
  const cookies = opts.cookies ?? {};
  const cookiePairs = Object.entries(cookies).map(([k, v]) => `${k}=${v}`);
  if (cookiePairs.length) headers.set("Cookie", cookiePairs.join("; "));
  // `origin: null` means "send no Origin header at all" — the case R3 rejects
  // for ambient credentials and must NOT reject for Bearer ones.
  if (opts.origin !== null) headers.set("Origin", opts.origin ?? ORIGIN);
  if (opts.csrf !== null) headers.set(CSRF_HEADER, opts.csrf ?? "1");
  if (opts.bearer) headers.set("Authorization", `Bearer ${opts.bearer}`);
  return new Request(`${ORIGIN}${path}`, { method: opts.method ?? "GET", headers });
}

/** A session cookie jar for `req`. */
function jar(token: string): Record<string, string> {
  return { [SESSION_COOKIE]: token };
}

async function sessionRow(token: string) {
  return env.DB.prepare(
    "SELECT id, user_id, created_at, expires_at, last_used_at FROM sessions WHERE token_hash = ?1",
  )
    .bind(await hashToken(token))
    .first<{
      id: string;
      user_id: string;
      created_at: number;
      expires_at: number;
      last_used_at: number | null;
    }>();
}

/** Backdate a live session so renewal/expiry paths are reachable in a test. */
async function backdate(
  token: string,
  fields: { createdAt?: number; expiresAt?: number; lastUsedAt?: number },
) {
  const hash = await hashToken(token);
  const row = (await sessionRow(token))!;
  await env.DB.prepare(
    "UPDATE sessions SET created_at = ?1, expires_at = ?2, last_used_at = ?3 WHERE token_hash = ?4",
  )
    .bind(
      fields.createdAt ?? row.created_at,
      fields.expiresAt ?? row.expires_at,
      fields.lastUsedAt ?? row.last_used_at,
      hash,
    )
    .run();
}

/* -------------------------------------------------------------------------- */
/* U6 helpers: a device row exactly as pairing writes one                      */
/* -------------------------------------------------------------------------- */

interface PairedDevice {
  id: string;
  token: string;
}

/**
 * A `devices` row shaped exactly like the one `/v1/device/pair/poll` inserts —
 * same `gtfsc_dev_` prefix, same `hashToken`, same default scopes — with the
 * columns U6 has to answer for (`scopes`, `revoked_at`, `last_used_at`,
 * `user_id`) made settable. Written through the migrated schema, never
 * hand-rolled DDL.
 */
async function pairDevice(
  opts: {
    id?: string;
    user?: string | null;
    scopes?: string;
    revokedAt?: number | null;
    lastUsedAt?: number | null;
  } = {},
): Promise<PairedDevice> {
  const token = `${DEVICE_TOKEN_PREFIX}${randomToken(32)}`;
  const id = opts.id ?? `dev_${randomToken(9)}`;
  await env.DB.prepare(
    `INSERT INTO devices
       (id, user_id, token_hash, name, paired_at, fw_version, scopes, revoked_at, last_used_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      id,
      opts.user === undefined ? USER : opts.user,
      await hashToken(token),
      "Kitchen board",
      nowSec(),
      "1.4.0",
      opts.scopes ?? "read:departures,read:config",
      opts.revokedAt ?? null,
      opts.lastUsedAt ?? null,
    )
    .run();
  return { id, token };
}

async function deviceRow(id: string) {
  return env.DB.prepare("SELECT last_used_at, revoked_at FROM devices WHERE id = ?1")
    .bind(id)
    .first<{ last_used_at: number | null; revoked_at: number | null }>();
}

/**
 * An `Env` whose D1 binding records every statement it prepares. "Slides
 * `last_used_at` without writing per request" is a claim about *writes*, and a
 * test that only re-reads the column cannot tell a skipped UPDATE from an
 * UPDATE that rewrote the same second.
 */
function recordingEnv(statements: string[]): Env {
  const db = {
    prepare: (sql: string) => {
      statements.push(sql);
      return env.DB.prepare(sql);
    },
  };
  return { ...env, DB: db } as unknown as Env;
}

const isUpdate = (sql: string) => /^\s*UPDATE/i.test(sql);

beforeEach(async () => {
  await resetSchema();
  const seed = env.DB.prepare("INSERT OR IGNORE INTO users (id, created_at) VALUES (?1, ?2)");
  await seed.bind(USER, nowSec()).run();
  await seed.bind(SINGLE_USER_ID, nowSec()).run();
  await seed.bind("usr_other", nowSec()).run();
});

describe("session mint and validate", () => {
  it("round-trips: a minted token resolves to its user through the cookie", async () => {
    const minted = await mintSession(env, USER);
    const cred = await resolveCredential(req("/v1/config", { cookies: jar(minted.token) }), env);
    expect(cred).toMatchObject({ kind: "session", userId: USER, sessionId: minted.sessionId });
  });

  it("stores only the hash — the plaintext token never lands in D1", async () => {
    const minted = await mintSession(env, USER);
    const row = await env.DB.prepare("SELECT * FROM sessions WHERE id = ?1")
      .bind(minted.sessionId)
      .first<Record<string, unknown>>();
    expect(row).toBeTruthy();
    expect(Object.values(row!)).not.toContain(minted.token);
    expect(row!.token_hash).toBe(await hashToken(minted.token));
    // Opaque and >= 128 bits of entropy, base64url-encoded.
    expect(minted.token).toMatch(/^[A-Za-z0-9_-]{22,}$/);
  });

  it("mints distinct tokens", async () => {
    const a = await mintSession(env, USER);
    const b = await mintSession(env, USER);
    expect(a.token).not.toBe(b.token);
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it("delivers a __Host- Secure HttpOnly SameSite=Lax Path=/ cookie", async () => {
    const minted = await mintSession(env, USER);
    expect(SESSION_COOKIE.startsWith("__Host-")).toBe(true);
    expect(minted.cookie).toContain(`${SESSION_COOKIE}=${minted.token}`);
    expect(minted.cookie).toMatch(/;\s*Secure/);
    expect(minted.cookie).toMatch(/;\s*HttpOnly/);
    expect(minted.cookie).toMatch(/;\s*SameSite=Lax/);
    expect(minted.cookie).toMatch(/;\s*Path=\//);
    expect(minted.cookie).not.toMatch(/Domain=/); // __Host- forbids Domain
    expect(clearedSessionCookie()).toMatch(/Max-Age=0/);
  });

  it("an expired session resolves to null", async () => {
    const minted = await mintSession(env, USER);
    await backdate(minted.token, { expiresAt: nowSec() - 1 });
    expect(await validateSession(env, minted.token)).toBeNull();
    expect(await resolveCredential(req("/", { cookies: jar(minted.token) }), env)).toBeNull();
  });

  it("an unknown or empty token resolves to null", async () => {
    expect(await validateSession(env, "not-a-real-token")).toBeNull();
    expect(await validateSession(env, "")).toBeNull();
    expect(await resolveCredential(req("/"), env)).toBeNull();
  });

  it("refuses a session past the 180-day absolute cap even with a live expires_at", async () => {
    const minted = await mintSession(env, USER);
    await backdate(minted.token, {
      createdAt: nowSec() - 181 * DAY_S,
      expiresAt: nowSec() + 10 * DAY_S,
    });
    expect(await validateSession(env, minted.token)).toBeNull();
  });
});

describe("sliding renewal", () => {
  it("does not write before the half-life — a read stays a read", async () => {
    const minted = await mintSession(env, USER);
    const before = (await sessionRow(minted.token))!;
    // One day in: 29 days left on a 30-day window, well short of the half-life.
    await backdate(minted.token, {
      createdAt: before.created_at - DAY_S,
      expiresAt: before.expires_at - DAY_S,
      lastUsedAt: before.last_used_at! - DAY_S,
    });
    const seeded = (await sessionRow(minted.token))!;
    expect(await validateSession(env, minted.token)).toMatchObject({ userId: USER });
    const after = (await sessionRow(minted.token))!;
    expect(after.expires_at).toBe(seeded.expires_at);
    expect(after.last_used_at).toBe(seeded.last_used_at);
  });

  it("renews past the half-life, extending expires_at and stamping last_used_at", async () => {
    const minted = await mintSession(env, USER);
    const before = (await sessionRow(minted.token))!;
    // 16 days in: 14 days left on a 30-day window, past the 15-day half-life.
    await backdate(minted.token, {
      createdAt: before.created_at - 16 * DAY_S,
      expiresAt: before.expires_at - 16 * DAY_S,
      lastUsedAt: before.last_used_at! - 16 * DAY_S,
    });
    const seeded = (await sessionRow(minted.token))!;
    expect(await validateSession(env, minted.token)).toMatchObject({ userId: USER });
    const after = (await sessionRow(minted.token))!;
    expect(after.expires_at).toBeGreaterThan(seeded.expires_at);
    expect(after.expires_at).toBeCloseTo(nowSec() + 30 * DAY_S, -2);
    expect(after.last_used_at).toBeGreaterThan(seeded.last_used_at!);
    expect(after.created_at).toBe(seeded.created_at); // absolute anchor untouched
  });

  it("hands the response path a refreshed cookie, so the window slides for the browser too", async () => {
    const minted = await mintSession(env, USER);
    const before = (await sessionRow(minted.token))!;
    await backdate(minted.token, {
      createdAt: before.created_at - 16 * DAY_S,
      expiresAt: before.expires_at - 16 * DAY_S,
      lastUsedAt: before.last_used_at! - 16 * DAY_S,
    });
    // The D1 row sliding is invisible to the browser: its Max-Age was fixed at
    // mint, so without a re-issued cookie a user active every day is still
    // hard-logged-out on day 30 and the 180-day cap is unreachable.
    const result = (await authorize(req("/v1/config", { cookies: jar(minted.token) }), env)) as {
      refresh: string | null;
    };
    expect(result.refresh).toBeTruthy();
    expect(result.refresh).toContain(`${SESSION_COOKIE}=${minted.token}`);
    const maxAge = Number(result.refresh!.match(/Max-Age=(\d+)/)![1]);
    expect(maxAge).toBeGreaterThan(29 * DAY_S);
    expect(maxAge).toBeLessThanOrEqual(30 * DAY_S);
  });

  it("offers no refresh before the half-life — nothing was renewed", async () => {
    const minted = await mintSession(env, USER);
    const result = (await authorize(req("/v1/config", { cookies: jar(minted.token) }), env)) as {
      refresh: string | null;
    };
    expect(result.refresh).toBeNull();
  });

  it("writes nothing when the renewed expiry equals the stored one (at the cap)", async () => {
    const minted = await mintSession(env, USER);
    // Pinned to the absolute cap: `Math.min` cannot move expires_at any more,
    // but the half-life condition stays permanently true, so an unconditional
    // UPDATE rewrites an identical row on every single request.
    const createdAt = nowSec() - 179 * DAY_S;
    await backdate(minted.token, { createdAt, expiresAt: createdAt + 180 * DAY_S, lastUsedAt: 1 });
    const seeded = (await sessionRow(minted.token))!;
    const cred = await validateSession(env, minted.token);
    expect(cred).toMatchObject({ userId: USER });
    const after = (await sessionRow(minted.token))!;
    expect(after.expires_at).toBe(seeded.expires_at);
    expect(after.last_used_at).toBe(seeded.last_used_at); // the row was not touched
  });

  it("renewal never pushes expires_at past the absolute cap", async () => {
    const minted = await mintSession(env, USER);
    const createdAt = nowSec() - 175 * DAY_S;
    await backdate(minted.token, { createdAt, expiresAt: nowSec() + DAY_S });
    expect(await validateSession(env, minted.token)).toMatchObject({ userId: USER });
    const after = (await sessionRow(minted.token))!;
    expect(after.expires_at).toBeLessThanOrEqual(createdAt + 180 * DAY_S);
  });
});

describe("rotation and revocation", () => {
  it("rotation invalidates the prior token and issues a working one", async () => {
    const first = await mintSession(env, USER);
    const rotated = await rotateSession(env, first.token);
    expect(rotated).not.toBeNull();
    expect(rotated!.token).not.toBe(first.token);
    expect(await validateSession(env, first.token)).toBeNull();
    expect(await validateSession(env, rotated!.token)).toMatchObject({
      kind: "session",
      userId: USER,
    });
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>();
    expect(rows!.n).toBe(1); // the old row is gone, not merely unusable
  });

  it("rotation carries the absolute anchor forward rather than resetting it", async () => {
    const first = await mintSession(env, USER);
    const createdAt = nowSec() - 179 * DAY_S;
    await backdate(first.token, { createdAt });
    const rotated = await rotateSession(env, first.token);
    const row = (await sessionRow(rotated!.token))!;
    expect(row.created_at).toBe(createdAt);
    expect(row.expires_at).toBeLessThanOrEqual(createdAt + 180 * DAY_S);
  });

  it("refuses to rotate a session belonging to a different user", async () => {
    // Redemption is the caller: the cookie already in the browser may belong to
    // somebody else entirely, and carrying *their* created_at anchor onto the
    // new account's session would be a rotation of the wrong thing.
    const other = await mintSession(env, "usr_other");
    expect(await rotateSession(env, other.token, { userId: USER })).toBeNull();
    expect(await validateSession(env, other.token)).toMatchObject({ userId: "usr_other" });
    expect(await rotateSession(env, other.token, { userId: "usr_other" })).not.toBeNull();
  });

  it("rotating an unknown or expired token returns null and mints nothing", async () => {
    expect(await rotateSession(env, "nope")).toBeNull();
    const minted = await mintSession(env, USER);
    await backdate(minted.token, { expiresAt: nowSec() - 1 });
    expect(await rotateSession(env, minted.token)).toBeNull();
  });

  it("revocation makes the token stop resolving immediately", async () => {
    const minted = await mintSession(env, USER);
    expect(await revokeSession(env, minted.token)).toBe(true);
    expect(await validateSession(env, minted.token)).toBeNull();
    expect(await revokeSession(env, minted.token)).toBe(false); // idempotent
  });
});

describe("CSRF and Origin on ambient credentials", () => {
  it("a state-changing request with cookie, header and same Origin is authorized", async () => {
    const minted = await mintSession(env, USER);
    const result = await authorize(
      req("/v1/config", { method: "POST", cookies: jar(minted.token) }),
      env,
    );
    expect(result).not.toBeInstanceOf(Response);
    expect((result as { credential: { userId: string } }).credential.userId).toBe(USER);
  });

  it("missing the custom header → 403", async () => {
    const minted = await mintSession(env, USER);
    const result = await authorize(
      req("/v1/config", { method: "POST", cookies: jar(minted.token), csrf: null }),
      env,
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it("a cross-origin Origin → 403", async () => {
    const minted = await mintSession(env, USER);
    const result = await authorize(
      req("/v1/config", {
        method: "POST",
        cookies: jar(minted.token),
        origin: "https://evil.example",
      }),
      env,
    );
    expect((result as Response).status).toBe(403);
  });

  it("an ABSENT Origin → 403 on a cookie-authenticated state change", async () => {
    const minted = await mintSession(env, USER);
    const result = await authorize(
      req("/v1/config", { method: "POST", cookies: jar(minted.token), origin: null }),
      env,
    );
    expect((result as Response).status).toBe(403);
  });

  it("reads are not gated by the CSRF header", async () => {
    const minted = await mintSession(env, USER);
    const result = await authorize(
      req("/v1/config", { cookies: jar(minted.token), csrf: null, origin: null }),
      env,
    );
    expect(result).not.toBeInstanceOf(Response);
  });

  it("a GET may opt into the ambient check explicitly", async () => {
    const minted = await mintSession(env, USER);
    const result = await authorize(
      req("/v1/config", { cookies: jar(minted.token), csrf: null }),
      env,
      { stateChanging: true },
    );
    expect((result as Response).status).toBe(403);
  });

  it("no credential at all → 401, not 403", async () => {
    const result = await authorize(req("/v1/config", { method: "POST" }), env);
    expect((result as Response).status).toBe(401);
  });

  it("a Bearer-authenticated route with NO Origin still succeeds (pairing regression)", async () => {
    // The blanket rule R3 rejects would 403 this. /v1/locate/ref is the Bearer
    // surface that exists today and stands in for pair/start and pair/poll.
    await env.DB.prepare(
      "INSERT INTO locate_log (device_id, ts, est_lat, est_lon, provider) VALUES ('dev-bearer', ?1, 40, -73.95, 'beacondb')",
    )
      .bind(nowSec())
      .run();
    const res = await SELF.fetch(`${ORIGIN}/v1/locate/ref`, {
      method: "POST",
      headers: {
        "CF-Connecting-IP": "198.18.9.9",
        "Content-Type": "application/json",
        Authorization: `Bearer ${DIAG_TOKEN}`,
        // deliberately no Origin and no CSRF header
      },
      body: JSON.stringify({ device_id: "dev-bearer", lat: 40.001, lon: -73.95 }),
    });
    expect(res.status).toBe(200);
  });
});

describe("the redeem nonce cookie", () => {
  it("is a __Host- cookie that round-trips through the request", () => {
    const header = nonceCookie("abc123");
    expect(NONCE_COOKIE.startsWith("__Host-")).toBe(true);
    expect(header).toContain(`${NONCE_COOKIE}=abc123`);
    expect(header).toMatch(/;\s*Secure/);
    expect(header).toMatch(/;\s*HttpOnly/);
    expect(header).toMatch(/;\s*SameSite=Lax/);
    expect(header).toMatch(/;\s*Path=\//);
    expect(clearedNonceCookie()).toMatch(/Max-Age=0/);
    expect(readNonceCookie(req("/", { cookies: { [NONCE_COOKIE]: "abc123" } }))).toBe("abc123");
    expect(readNonceCookie(req("/"))).toBeNull();
  });

  it("keeps scanning past an empty duplicate of the same cookie name", async () => {
    // A cleared cookie from a wider path and a live one can both be in the
    // header; abandoning the scan on the first empty value throws the live one
    // away and logs the user out.
    const minted = await mintSession(env, USER);
    const request = new Request(`${ORIGIN}/v1/config`, {
      headers: { Cookie: `${SESSION_COOKIE}=; ${SESSION_COOKIE}=${minted.token}` },
    });
    expect(await resolveCredential(request, env)).toMatchObject({ userId: USER });
  });
});

describe("AUTH_MODE=single", () => {
  const single = { ...env, AUTH_MODE: "single" } as Env;

  it("yields the synthetic user with no cookie at all", async () => {
    const cred = await resolveCredential(req("/v1/config"), single);
    expect(cred).toEqual({
      kind: "session",
      userId: SINGLE_USER_ID,
      sessionId: null,
      single: true,
    });
    expect(SINGLE_USER_ID).toBe("usr_single"); // contract with migration 0003
  });

  it("still enforces CSRF and Origin on state changes", async () => {
    expect(
      ((await authorize(req("/v1/config", { method: "POST", csrf: null }), single)) as Response)
        .status,
    ).toBe(403);
    expect(
      ((await authorize(req("/v1/config", { method: "POST", origin: null }), single)) as Response)
        .status,
    ).toBe(403);
    expect(await authorize(req("/v1/config", { method: "POST" }), single)).not.toBeInstanceOf(
      Response,
    );
  });

  it("fails closed: anything but the exact string is multi-user", async () => {
    for (const raw of [undefined, "", "Single", " single", "single ", "SINGLE", "true", "1", "multi"]) {
      const e = { ...env, ...(raw === undefined ? {} : { AUTH_MODE: raw }) } as Env;
      expect(isSingleUserMode(e)).toBe(false);
      expect(await resolveCredential(req("/v1/config"), e)).toBeNull();
    }
    expect(isSingleUserMode(single)).toBe(true);
  });
});

describe("device credentials", () => {
  it("a Bearer device token never comes back as kind:\"session\"", async () => {
    const cred = await resolveCredential(req("/v1/config", { bearer: "gtfsc_dev_abc123" }), env);
    expect(cred?.kind).not.toBe("session");
  });

  it("a device token in single-user mode is still not upgraded to a session", async () => {
    const cred = await resolveCredential(req("/v1/config", { bearer: "gtfsc_dev_abc123" }), {
      ...env,
      AUTH_MODE: "single",
    } as Env);
    expect(cred?.kind).not.toBe("session");
  });

  it("a device token presented alongside a session cookie does not borrow the session", async () => {
    const minted = await mintSession(env, USER);
    const cred = await resolveCredential(
      req("/v1/config", { cookies: jar(minted.token), bearer: "gtfsc_dev_abc123" }),
      env,
    );
    expect(cred?.kind).not.toBe("session");
  });

  it("parses the comma-joined scopes column, dropping unknowns, never implying read:fix", () => {
    expect(parseScopes("read:departures,read:config")).toEqual(["read:departures", "read:config"]);
    expect(parseScopes(" read:fix , read:departures ")).toEqual(["read:fix", "read:departures"]);
    expect(parseScopes("read:departures,admin,read:departures")).toEqual(["read:departures"]);
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes("")).toEqual([]);
    expect(parseScopes("read:departures,read:config")).not.toContain("read:fix");
  });

  it("resolves a paired token to its device, its owner, and its granted scopes", async () => {
    const device = await pairDevice({ scopes: "read:departures,read:config" });
    const cred = await resolveCredential(req("/v1/departures", { bearer: device.token }), env);
    expect(cred).toEqual({
      kind: "device",
      deviceId: device.id,
      userId: USER,
      scopes: ["read:departures", "read:config"],
    });
  });

  it("carries read:fix only when the column does — it is never implied", async () => {
    const plain = await pairDevice();
    const granted = await pairDevice({ scopes: "read:departures,read:config,read:fix" });
    const of = async (d: PairedDevice) =>
      (await resolveCredential(req("/v1/locate", { bearer: d.token }), env)) as {
        scopes: readonly string[];
      };
    expect((await of(plain)).scopes).not.toContain("read:fix");
    expect((await of(granted)).scopes).toContain("read:fix");
  });

  it("a revoked token and a token that never existed are one answer, byte for byte", async () => {
    const revoked = await pairDevice({ revokedAt: nowSec() - 60 });
    const unknown = `${DEVICE_TOKEN_PREFIX}${randomToken(32)}`;

    expect(await resolveCredential(req("/v1/departures", { bearer: revoked.token }), env)).toBeNull();
    expect(await resolveCredential(req("/v1/departures", { bearer: unknown }), env)).toBeNull();

    const answers = await Promise.all(
      [revoked.token, unknown].map(async (bearer) => {
        const res = (await authorize(req("/v1/departures", { bearer }), env, {
          scope: "read:departures",
        })) as Response;
        return { status: res.status, body: await res.text() };
      }),
    );
    // 401 for both — "revoked" must not be distinguishable from "never real",
    // or a token pulled out of flash tells its holder the board was once paired.
    expect(answers[0]).toEqual({ status: 401, body: '{"error":"unauthorized"}' });
    expect(answers[1]).toEqual(answers[0]);
  });

  it("does not slide last_used_at for a revoked token", async () => {
    const revoked = await pairDevice({ revokedAt: nowSec() - 60, lastUsedAt: null });
    const statements: string[] = [];
    await resolveCredential(
      req("/v1/departures", { bearer: revoked.token }),
      recordingEnv(statements),
    );
    expect(statements.filter(isUpdate)).toEqual([]);
    expect((await deviceRow(revoked.id))!.last_used_at).toBeNull();
  });

  it("refuses a row with no owner — a credential that cannot name a user is no credential", async () => {
    // devices.user_id is nullable (a Phase 1 row can exist before pairing) and
    // ownerPredicate binds it; resolving one would scope a query by NULL.
    const orphan = await pairDevice({ user: null });
    expect(await resolveCredential(req("/v1/departures", { bearer: orphan.token }), env)).toBeNull();
  });

  it("reads the token from the Authorization header only — never a query param", async () => {
    const device = await pairDevice();
    for (const query of [`?token=${device.token}`, `?access_token=${device.token}`]) {
      expect(await resolveCredential(req(`/v1/departures${query}`), env)).toBeNull();
    }
    // And the same token in the header does resolve, so the assertion above is
    // about where the token was, not about the token.
    expect(
      (await resolveCredential(req("/v1/departures", { bearer: device.token }), env))?.kind,
    ).toBe("device");
  });

  it("only the prefixed form reaches the device branch", async () => {
    const device = await pairDevice();
    const unprefixed = device.token.slice(DEVICE_TOKEN_PREFIX.length);
    expect(await resolveCredential(req("/v1/departures", { bearer: unprefixed }), env)).toBeNull();
  });

  it("hasScope is false for every scope on a session credential's device scopes", () => {
    const device = {
      kind: "device" as const,
      deviceId: "dev1",
      userId: USER,
      scopes: ["read:departures"] as const,
    };
    expect(hasScope(device, "read:departures")).toBe(true);
    expect(hasScope(device, "read:fix")).toBe(false);
    // A session is the account itself: it is not scope-limited.
    expect(hasScope({ kind: "session", userId: USER, sessionId: null }, "read:fix")).toBe(true);
  });
});

describe("last_used_at slides, it is not stamped", () => {
  it("stamps a device that has never been seen", async () => {
    const device = await pairDevice({ lastUsedAt: null });
    const before = nowSec();
    await resolveCredential(req("/v1/departures", { bearer: device.token }), env);
    const row = await deviceRow(device.id);
    expect(row!.last_used_at).toBeGreaterThanOrEqual(before);
  });

  it("a burst of requests inside the window prepares no UPDATE at all", async () => {
    const device = await pairDevice({ lastUsedAt: nowSec() });
    const statements: string[] = [];
    const spied = recordingEnv(statements);
    for (let i = 0; i < 10; i++) {
      const cred = await resolveCredential(req("/v1/departures", { bearer: device.token }), spied);
      expect(cred?.kind).toBe("device"); // still authenticating, just not writing
    }
    // The M1 review's P2 shape — a renewal that writes on every request once it
    // is near the boundary — would show up right here.
    expect(statements.filter(isUpdate)).toEqual([]);
    expect(statements).toHaveLength(10); // exactly one SELECT per request
  });

  it("writes once past the floor, then goes quiet again", async () => {
    const stale = nowSec() - DEVICE_LAST_USED_SLIDE_S - 1;
    const device = await pairDevice({ lastUsedAt: stale });
    const statements: string[] = [];
    const spied = recordingEnv(statements);

    await resolveCredential(req("/v1/departures", { bearer: device.token }), spied);
    expect(statements.filter(isUpdate)).toHaveLength(1);
    const slid = (await deviceRow(device.id))!.last_used_at!;
    expect(slid).toBeGreaterThan(stale);

    statements.length = 0;
    for (let i = 0; i < 5; i++) {
      await resolveCredential(req("/v1/departures", { bearer: device.token }), spied);
    }
    expect(statements.filter(isUpdate)).toEqual([]);
    expect((await deviceRow(device.id))!.last_used_at).toBe(slid);
  });

  it("does not write when last_used_at sits inside the floor", async () => {
    const fresh = nowSec() - DEVICE_LAST_USED_SLIDE_S + 5;
    const device = await pairDevice({ lastUsedAt: fresh });
    const statements: string[] = [];
    await resolveCredential(req("/v1/departures", { bearer: device.token }), recordingEnv(statements));
    expect(statements.filter(isUpdate)).toEqual([]);
    expect((await deviceRow(device.id))!.last_used_at).toBe(fresh);
  });
});

describe("a device token on an account surface → 403 (AE6)", () => {
  /**
   * The rule, not a guard per route: `authorize()` with no `scope` refuses a
   * device credential outright, so every account surface is device-proof the
   * moment it is written. The routes AE6 names split three ways here.
   *
   *  * **Live routes** get a real request: `/v1/pair/claim` and
   *    `/v1/auth/signout` are the two account surfaces that exist today.
   *  * **The rule itself** is exercised directly with a real paired token
   *    against `authorize()`'s default options — which is precisely the call
   *    the account email (U11), the device list (U10) and config writes (U15)
   *    will make. Writing `expect(404)` against a route that does not exist
   *    would assert nothing.
   *  * **`/v1/config/:device_id`** (U15) is the one route that takes a
   *    client-supplied device id, so its check lives in `checkDeviceTarget` and
   *    is tested below against real sibling devices rather than against a
   *    missing route.
   */
  it("the rule: a route that names no scope refuses a device token, and 403 not 401", async () => {
    const device = await pairDevice();
    const denial = (await authorize(req("/v1/devices", { bearer: device.token }), env)) as Response;
    expect(denial.status).toBe(403);
    expect(await denial.json()).toEqual({
      error: "forbidden: device tokens are not accepted on this route",
    });

    // Same request, same options, a session cookie instead: allowed. The 403
    // is about the credential kind, not about the route being closed.
    const minted = await mintSession(env, USER);
    expect(await authorize(req("/v1/devices", { cookies: jar(minted.token) }), env)).not.toBeInstanceOf(
      Response,
    );
  });

  it("a POST is refused the same way — the denial is not a CSRF accident", async () => {
    const device = await pairDevice();
    const denial = (await authorize(
      req("/v1/config", { method: "POST", bearer: device.token }),
      env,
    )) as Response;
    expect(denial.status).toBe(403);
    expect(await denial.json()).toEqual({
      error: "forbidden: device tokens are not accepted on this route",
    });
  });

  it("POST /v1/pair/claim: a board cannot pair another board onto its owner", async () => {
    const device = await pairDevice();
    const res = await SELF.fetch(`${ORIGIN}/v1/pair/claim`, {
      method: "POST",
      headers: {
        "CF-Connecting-IP": "198.18.9.11",
        "Content-Type": "application/json",
        Origin: ORIGIN,
        [CSRF_HEADER]: "1",
        Authorization: `Bearer ${device.token}`,
      },
      body: JSON.stringify({ user_code: "BCDF-GHJK", confirm: true }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /v1/auth/signout: a board cannot end its owner's session", async () => {
    const device = await pairDevice();
    const minted = await mintSession(env, USER);
    const res = await SELF.fetch(`${ORIGIN}/v1/auth/signout`, {
      method: "POST",
      headers: {
        "CF-Connecting-IP": "198.18.9.12",
        Origin: ORIGIN,
        [CSRF_HEADER]: "1",
        // The cookie is present *and* the device token wins the branch — this
        // is the laundering attempt the branch order exists to stop.
        Cookie: `${SESSION_COOKIE}=${minted.token}`,
        Authorization: `Bearer ${device.token}`,
      },
    });
    expect(res.status).toBe(403);
    // The property, not just the status code: the session is still alive.
    expect(await validateSession(env, minted.token)).toMatchObject({ userId: USER });
  });

  it("a revoked token is 401 on those routes, not 403 — revocation comes first", async () => {
    const revoked = await pairDevice({ revokedAt: nowSec() - 1 });
    const res = await SELF.fetch(`${ORIGIN}/v1/pair/claim`, {
      method: "POST",
      headers: {
        "CF-Connecting-IP": "198.18.9.13",
        "Content-Type": "application/json",
        Origin: ORIGIN,
        [CSRF_HEADER]: "1",
        Authorization: `Bearer ${revoked.token}`,
      },
      body: JSON.stringify({ user_code: "BCDF-GHJK" }),
    });
    expect(res.status).toBe(401);
  });

  it("the diagnostics surfaces are not a device's to read", async () => {
    const device = await pairDevice();
    const res = await SELF.fetch(`${ORIGIN}/v1/locate/log`, {
      headers: { "CF-Connecting-IP": "198.18.9.14", Authorization: `Bearer ${device.token}` },
    });
    expect(res.status).toBe(401); // DIAG_TOKEN is a different credential entirely
  });

  it("the anonymous transit reads are byte-identical with and without a token (R10)", async () => {
    const device = await pairDevice();
    const read = (bearer?: string) =>
      SELF.fetch(`${ORIGIN}/v1/nearby?lat=40.6923&lon=-73.9873`, {
        headers: {
          "CF-Connecting-IP": "198.18.9.15",
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
      });
    const anonymous = await read();
    const withToken = await read(device.token);
    expect(anonymous.status).toBe(200); // a real read, not two matching errors
    expect(withToken.status).toBe(anonymous.status);
    expect(await withToken.text()).toBe(await anonymous.text());
  });
});

describe("scope enforcement lives in the resolver (R9, AE6)", () => {
  it("a freshly paired device reading a fix → 403", async () => {
    const device = await pairDevice(); // pairing's defaults: no read:fix
    const denial = (await authorize(req("/v1/locate", { bearer: device.token }), env, {
      scope: "read:fix",
    })) as Response;
    expect(denial.status).toBe(403);
    expect(await denial.json()).toEqual({ error: "forbidden: missing scope read:fix" });

    // And a token narrowed to departures alone is refused the same way.
    const narrow = await pairDevice({ scopes: "read:departures" });
    expect(
      ((await authorize(req("/v1/locate", { bearer: narrow.token }), env, {
        scope: "read:fix",
      })) as Response).status,
    ).toBe(403);
  });

  it("the same token passes the scope it does hold, and carries its device id through", async () => {
    const device = await pairDevice();
    const ok = (await authorize(req("/v1/departures", { bearer: device.token }), env, {
      scope: "read:departures",
    })) as { credential: { deviceId: string }; owner: { sql: string; binds: string[] }; refresh: null };
    expect(ok.credential).toMatchObject({ kind: "device", deviceId: device.id, userId: USER });
    expect(ok.owner).toEqual({ sql: "user_id = ?1", binds: [USER] });
    expect(ok.refresh).toBeNull(); // a device has no cookie to slide
  });

  it("granting read:fix on the row is what opens the fix read", async () => {
    const granted = await pairDevice({ scopes: "read:departures,read:config,read:fix" });
    expect(
      await authorize(req("/v1/locate", { bearer: granted.token }), env, { scope: "read:fix" }),
    ).not.toBeInstanceOf(Response);
  });

  it("a device with an empty scopes column can read nothing", async () => {
    const device = await pairDevice({ scopes: "" });
    for (const scope of ["read:departures", "read:config", "read:fix"] as const) {
      const denial = (await authorize(req("/v1/departures", { bearer: device.token }), env, {
        scope,
      })) as Response;
      expect(denial.status).toBe(403);
    }
  });

  it("a Bearer credential is still exempt from the ambient CSRF gate", async () => {
    const device = await pairDevice({ scopes: "read:departures,read:config,read:fix" });
    // No Origin, no CSRF header — firmware sends neither, and R3's gate is for
    // ambient credentials only.
    const result = await authorize(
      req("/v1/locate", { method: "POST", bearer: device.token, origin: null, csrf: null }),
      env,
      { scope: "read:fix" },
    );
    expect(result).not.toBeInstanceOf(Response);
  });
});

describe("device targeting — the /v1/config/:device_id check (U15)", () => {
  it("a device token may not name a sibling board on the same account", async () => {
    const mine = await pairDevice();
    const sibling = await pairDevice(); // same owner: the owner predicate cannot tell them apart
    const denial = (await authorize(req("/v1/config", { bearer: mine.token }), env, {
      scope: "read:config",
      deviceId: sibling.id,
    })) as Response;
    expect(denial.status).toBe(403);
    expect(await denial.json()).toEqual({ error: "forbidden: device id is not this device's" });
  });

  it("and passes for its own id", async () => {
    const mine = await pairDevice();
    expect(
      await authorize(req("/v1/config", { bearer: mine.token }), env, {
        scope: "read:config",
        deviceId: mine.id,
      }),
    ).not.toBeInstanceOf(Response);
  });

  it("checkDeviceTarget: a session may name any id (its tenancy is the SQL predicate)", () => {
    const session = { kind: "session" as const, userId: USER, sessionId: null };
    expect(checkDeviceTarget(session, "dev_anything")).toBeNull();
    const device = {
      kind: "device" as const,
      deviceId: "dev_mine",
      userId: USER,
      scopes: ["read:config"] as const,
    };
    expect(checkDeviceTarget(device, "dev_mine")).toBeNull();
    expect(checkDeviceTarget(device, "dev_theirs")?.status).toBe(403);
  });
});

describe("the token rotation header (R9: specified, unimplemented)", () => {
  it("names the header firmware should code against", () => {
    // Pinned: firmware adopting it now is what makes turning rotation on later
    // a non-breaking change, and a rename after that ships is the breakage.
    expect(DEVICE_TOKEN_ROTATION_HEADER).toBe("X-GC-Device-Token");
  });

  it("is emitted by nothing today", async () => {
    const device = await pairDevice();
    const responses = [
      await SELF.fetch(`${ORIGIN}/v1/nearby?lat=40.69&lon=-73.98`, {
        headers: {
          "CF-Connecting-IP": "198.18.9.16",
          Authorization: `Bearer ${device.token}`,
        },
      }),
      await SELF.fetch(`${ORIGIN}/v1/device/pair/start`, {
        method: "POST",
        headers: { "CF-Connecting-IP": "198.18.9.16", Origin: ORIGIN },
      }),
    ];
    for (const res of responses) {
      expect(res.headers.get(DEVICE_TOKEN_ROTATION_HEADER)).toBeNull();
    }
  });
});

describe("the ownership predicate", () => {
  it("scopes rows to the credential's user with a bindable fragment", async () => {
    const minted = await mintSession(env, USER);
    const result = (await authorize(req("/v1/config", { cookies: jar(minted.token) }), env)) as {
      owner: { sql: string; binds: string[] };
    };
    expect(result.owner).toEqual({ sql: "user_id = ?1", binds: [USER] });

    // And it actually scopes a query — the locate_log SELECT * this exists for.
    await env.DB.prepare(
      "INSERT INTO locate_log (user_id, device_id, ts) VALUES (?1, 'a', 1), ('usr_other', 'b', 2)",
    )
      .bind(USER)
      .run();
    const rows = await env.DB.prepare(
      `SELECT device_id FROM locate_log WHERE ${result.owner.sql}`,
    )
      .bind(...result.owner.binds)
      .all<{ device_id: string }>();
    expect(rows.results.map((r) => r.device_id)).toEqual(["a"]);
  });

  it("accepts a column and a placeholder offset for composed queries", () => {
    const cred = { kind: "session" as const, userId: USER, sessionId: null };
    expect(ownerPredicate(cred, "l.user_id", 3)).toEqual({ sql: "l.user_id = ?3", binds: [USER] });
  });

  it("a device credential is scoped to its owning user, not its device id", () => {
    const cred = {
      kind: "device" as const,
      deviceId: "dev1",
      userId: USER,
      scopes: ["read:departures"] as const,
    };
    expect(ownerPredicate(cred)).toEqual({ sql: "user_id = ?1", binds: [USER] });
  });
});

describe("scope enforcement at the chokepoint", () => {
  it("a session satisfies any required scope", async () => {
    const minted = await mintSession(env, USER);
    const result = await authorize(req("/v1/config", { cookies: jar(minted.token) }), env, {
      scope: "read:fix",
    });
    expect(result).not.toBeInstanceOf(Response);
  });

  it("sessionCookie honors an explicit max age", () => {
    expect(sessionCookie("tok", 60)).toContain("Max-Age=60");
  });
});
