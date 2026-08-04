import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CSRF_HEADER,
  NONCE_COOKIE,
  SESSION_COOKIE,
  SINGLE_USER_ID,
  authorize,
  clearedNonceCookie,
  clearedSessionCookie,
  hasScope,
  hashToken,
  isSingleUserMode,
  mintSession,
  nonceCookie,
  ownerPredicate,
  parseScopes,
  readNonceCookie,
  resolveCredential,
  revokeSession,
  rotateSession,
  sessionCookie,
  validateSession,
} from "../../src/auth";

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

beforeEach(async () => {
  // Schema per migrations 0000 + 0003 (these suites build their own tables).
  await env.DB.prepare("DROP TABLE IF EXISTS sessions").run();
  await env.DB.prepare("DROP TABLE IF EXISTS devices").run();
  await env.DB.prepare("DROP TABLE IF EXISTS locate_log").run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS users (
       id             TEXT PRIMARY KEY NOT NULL,
       email          TEXT UNIQUE,
       created_at     INTEGER,
       config_version INTEGER NOT NULL DEFAULT 0
     )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE sessions (
       id           TEXT PRIMARY KEY NOT NULL,
       user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
       expires_at   INTEGER,
       created_at   INTEGER,
       token_hash   TEXT,
       last_used_at INTEGER
     )`,
  ).run();
  await env.DB.prepare("CREATE UNIQUE INDEX idx_sessions_token_hash ON sessions (token_hash)").run();
  await env.DB.prepare(
    `CREATE TABLE devices (
       id           TEXT PRIMARY KEY NOT NULL,
       user_id      TEXT REFERENCES users (id) ON DELETE CASCADE,
       token_hash   TEXT,
       name         TEXT,
       paired_at    INTEGER,
       last_seen    INTEGER,
       fw_version   TEXT,
       scopes       TEXT NOT NULL DEFAULT 'read:departures,read:config',
       revoked_at   INTEGER,
       last_used_at INTEGER
     )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE locate_log (
       id           INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id      TEXT REFERENCES users (id) ON DELETE CASCADE,
       device_id    TEXT,
       ts           INTEGER,
       est_lat      REAL,
       est_lon      REAL,
       est_accuracy REAL,
       provider     TEXT,
       bssid_count  INTEGER,
       ref_lat      REAL,
       ref_lon      REAL,
       ref_accuracy REAL,
       delta_m      REAL,
       label        TEXT
     )`,
  ).run();
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
