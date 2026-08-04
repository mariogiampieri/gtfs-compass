import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CSRF_HEADER,
  NONCE_COOKIE,
  SESSION_COOKIE,
  hashToken,
  mintSession,
  nonceCookie,
} from "../../src/auth";
import { SEND_ADDRESS_SCOPE, budgetDay, readBudget } from "../../src/email";
import {
  CALLBACK_PATH,
  MAGIC_TOKEN_TTL_S,
  MAX_LIVE_TOKENS_PER_ADDRESS,
  routeAuth,
} from "../../src/routes/auth";
import { resetSchema } from "./schema";

/**
 * /v1/auth/* — the sign-in surface (U4; R1, R2, R4, R4b, R19; AE1, AE2, AE3).
 *
 * These call `routeAuth` directly rather than through `SELF.fetch` for one
 * reason: the send happens in `waitUntil`, and a test that cannot await that
 * promise cannot assert what was mailed. The fake `ExecutionContext` here
 * collects the promises so each test can settle them deliberately — which also
 * proves the send is genuinely deferred, since nothing is delivered until
 * `settle()` runs.
 */

const ORIGIN = "https://api.example";
const KNOWN = "mario@example.com";
const UNKNOWN = "newcomer@example.com";
const OUTSIDER = "stranger@example.net"; // never on the allowlist
const ALLOWLIST = `${KNOWN}, ${UNKNOWN}`;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function e(overrides: Record<string, unknown> = {}): Env {
  return {
    ...env,
    AUTH_EMAIL_PROVIDER: "console",
    AUTH_ALLOWED_EMAILS: ALLOWLIST,
    ...overrides,
  } as unknown as Env;
}

/** Collects `waitUntil` promises so a test can await the deferred send. */
function fakeCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
  return { ctx, pendingCount: () => pending.length, settle: () => Promise.all(pending) };
}

/** Captures everything the console provider prints, in place of the real log. */
function sink() {
  const lines: string[] = [];
  return {
    lines,
    deps: { log: (l: string) => lines.push(l), warn: (l: string) => lines.push(l) },
    joined: () => lines.join("\n"),
  };
}

interface ReqOpts {
  method?: string;
  body?: unknown;
  origin?: string | null;
  csrf?: string | null;
  cookies?: Record<string, string>;
}

function req(path: string, opts: ReqOpts = {}): Request {
  const headers = new Headers();
  if (opts.origin !== null) headers.set("Origin", opts.origin ?? ORIGIN);
  if (opts.csrf !== null) headers.set(CSRF_HEADER, opts.csrf ?? "1");
  const cookies = Object.entries(opts.cookies ?? {}).map(([k, v]) => `${k}=${v}`);
  if (cookies.length) headers.set("Cookie", cookies.join("; "));
  const init: RequestInit = { method: opts.method ?? "GET", headers };
  if (opts.body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  return new Request(`${ORIGIN}${path}`, init);
}

/** Drive one route call with a fresh context and log sink. */
async function call(
  request: Request,
  environment: Env = e(),
  ctx = fakeCtx(),
  logs = sink(),
): Promise<{ res: Response; ctx: typeof ctx; logs: typeof logs }> {
  const res = await routeAuth(request, environment, new URL(request.url), ctx.ctx, logs.deps);
  return { res, ctx, logs };
}

/** Ask for a link and return the token the console provider printed. */
async function requestLink(
  email: string,
  environment: Env = e(),
): Promise<{ res: Response; token: string | null; nonce: string; logs: string }> {
  const ctx = fakeCtx();
  const logs = sink();
  const res = await routeAuth(
    req("/v1/auth/request", { method: "POST", body: { email } }),
    environment,
    new URL(`${ORIGIN}/v1/auth/request`),
    ctx.ctx,
    logs.deps,
  );
  await ctx.settle();
  const joined = logs.joined();
  const match = joined.match(/callback#([A-Za-z0-9_-]+)/);
  const setCookie = res.headers.get("Set-Cookie") ?? "";
  const nonce = setCookie.split(";")[0].split("=")[1] ?? "";
  return { res, token: match?.[1] ?? null, nonce, logs: joined };
}

async function tokenRows(): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare("SELECT * FROM magic_tokens").all();
  return results as Record<string, unknown>[];
}

async function userRow(email: string) {
  return env.DB.prepare("SELECT id, email FROM users WHERE email = ?1")
    .bind(email)
    .first<{ id: string; email: string }>();
}

/**
 * A `DB` that records the SQL it is asked to prepare. The R2 assertion that
 * matters most is not "the bodies match" (easy to satisfy by accident) but
 * "the inline path issued the same statements in the same order" — an
 * account-existence branch shows up here long before it shows up in a body.
 */
function recordingDb(log: string[]): D1Database {
  return new Proxy(env.DB, {
    get(target, prop, receiver) {
      if (prop === "prepare") {
        return (sql: string) => {
          log.push(sql.replace(/\s+/g, " ").trim());
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as D1Database;
}

beforeEach(async () => {
  await resetSchema();
  // KNOWN has an account; UNKNOWN and OUTSIDER do not.
  await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?1, ?2, ?3)")
    .bind("usr_known", KNOWN, nowSec())
    .run();
});

/* -------------------------------------------------------------------------- */
/* GET /v1/auth/mode (R5)                                                      */
/* -------------------------------------------------------------------------- */

describe("GET /v1/auth/mode", () => {
  it("reports single-user mode when AUTH_MODE is exactly 'single'", async () => {
    const { res } = await call(req("/v1/auth/mode"), e({ AUTH_MODE: "single" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ auth_mode: "single" });
  });

  it("fails closed to multi for unset, mis-cased, and unrecognized values", async () => {
    for (const value of [undefined, "Single", " single ", "yes", ""]) {
      const { res } = await call(req("/v1/auth/mode"), e({ AUTH_MODE: value }));
      expect(await res.json()).toEqual({ auth_mode: "multi" });
    }
  });

  it("is never cached — the banner must not survive a config change", async () => {
    const { res } = await call(req("/v1/auth/mode"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

/* -------------------------------------------------------------------------- */
/* POST /v1/auth/request — R2/R4b identity (AE1)                               */
/* -------------------------------------------------------------------------- */

describe("POST /v1/auth/request is one answer for every address (R2, R4b, AE1)", () => {
  it("is byte-identical for a known, an unknown, and a non-allowlisted address", async () => {
    const results = [];
    for (const email of [KNOWN, UNKNOWN, OUTSIDER]) {
      const { res } = await requestLink(email);
      results.push({
        status: res.status,
        body: await res.text(),
        // Header *names* and every value except the deliberately random nonce.
        headers: [...res.headers.keys()].sort(),
        cookieShape: (res.headers.get("Set-Cookie") ?? "").replace(
          /^__Host-gc_nonce=[^;]+/,
          "__Host-gc_nonce=<random>",
        ),
        cacheControl: res.headers.get("Cache-Control"),
      });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(results[0].status).toBe(200);
    expect(results[0].body).toBe('{"ok":true}');
  });

  it("issues the same SQL, in the same order, for a known and an unknown address", async () => {
    const knownSql: string[] = [];
    const unknownSql: string[] = [];
    await requestLink(KNOWN, e({ DB: recordingDb(knownSql) }));
    await requestLink(UNKNOWN, e({ DB: recordingDb(unknownSql) }));
    // Not just "the same set": the same sequence. A `known` branch that
    // charged a different counter first, or skipped a read, shows up here.
    expect(unknownSql).toEqual(knownSql);
    expect(knownSql.length).toBeGreaterThan(3);
  });

  it("creates no account for an address that has never signed in (AE1)", async () => {
    await requestLink(UNKNOWN);
    expect(await userRow(UNKNOWN)).toBeNull();
  });

  it("creates no magic_tokens row and sends nothing for a non-allowlisted address (R4b)", async () => {
    const { logs } = await requestLink(OUTSIDER);
    expect(await tokenRows()).toHaveLength(0);
    expect(logs).toBe("");
  });

  it("still mails an allowlisted address with no account — that is registration", async () => {
    const { token, logs } = await requestLink(UNKNOWN);
    expect(token).toBeTruthy();
    expect(logs).toContain(UNKNOWN);
    expect(await tokenRows()).toHaveLength(1);
  });

  it("normalizes case and whitespace before deciding anything", async () => {
    const { token } = await requestLink("  MaRio@Example.COM  ");
    expect(token).toBeTruthy();
    const rows = await tokenRows();
    expect(rows[0].email).toBe(KNOWN);
  });

  it("rejects a body that is not an addressable string, without an account lookup", async () => {
    for (const email of ["", "nope", "two @spaces.com", undefined, 42, `${"a".repeat(250)}@b.co`]) {
      const { res } = await call(req("/v1/auth/request", { method: "POST", body: { email } }));
      expect(res.status).toBe(400);
    }
    expect(await tokenRows()).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* POST /v1/auth/request — CSRF, budgets, provider config                      */
/* -------------------------------------------------------------------------- */

describe("POST /v1/auth/request guards", () => {
  it("403s without the custom header, cross-origin, and with no Origin at all", async () => {
    const cases: ReqOpts[] = [
      { csrf: null },
      { origin: "https://evil.example" },
      { origin: null },
    ];
    for (const extra of cases) {
      const { res } = await call(
        req("/v1/auth/request", { method: "POST", body: { email: KNOWN }, ...extra }),
      );
      expect(res.status).toBe(403);
    }
    expect(await tokenRows()).toHaveLength(0);
  });

  it("answers identically with the budget exhausted, and sends nothing", async () => {
    const open = await requestLink(UNKNOWN); // an ordinary 200 to compare against
    const openBody = await open.res.text();

    // Spend the address's whole daily slice (default 5) on a real counter row
    // rather than reconfiguring the limit — this is the path production hits.
    await env.DB.prepare(
      "INSERT INTO auth_budgets (scope, key, day, shard, count) VALUES (?1, ?2, ?3, 0, ?4)",
    )
      .bind(SEND_ADDRESS_SCOPE, await hashToken(KNOWN), budgetDay(), 5)
      .run();

    const spent = await requestLink(KNOWN);
    expect(spent.res.status).toBe(open.res.status);
    expect(await spent.res.text()).toBe(openBody);
    expect(spent.logs).toBe("");
    expect(spent.token).toBeNull();
  });

  it("charges the address budget once per mailed link", async () => {
    const key = await hashToken(KNOWN);
    await requestLink(KNOWN);
    expect(await readBudget(env, SEND_ADDRESS_SCOPE, key, budgetDay())).toBe(1);
    await requestLink(KNOWN);
    // Each repeat inside the cap mails a real link, so it is not free: the
    // address cap is what bounds a resend loop.
    expect(await readBudget(env, SEND_ADDRESS_SCOPE, key, budgetDay())).toBe(2);
  });

  it("addresses the allowlist refuses do not spend the global registration slice", async () => {
    // Twenty throwaway addresses is the default unknown slice. If a refusal
    // charges it, the next real sign-up — including the operator's own first
    // one on a fresh deployment — is blocked until 00:00 UTC.
    for (let i = 0; i < 20; i++) await requestLink(`throwaway${i}@example.net`);
    const { token } = await requestLink(UNKNOWN);
    expect(token).toBeTruthy();
  });

  it("mints nothing when the provider is misconfigured (U3's ordering KTD)", async () => {
    const { res } = await call(
      req("/v1/auth/request", { method: "POST", body: { email: KNOWN } }),
      e({ AUTH_EMAIL_PROVIDER: "resend", RESEND_API_KEY: undefined }),
    );
    expect(res.status).toBe(503);
    expect(await tokenRows()).toHaveLength(0);
  });

  it("never waits for the send: a hung provider still answers (R2)", async () => {
    const ctx = fakeCtx();
    const hung = new Promise<Response>(() => {}); // never settles
    const res = await routeAuth(
      req("/v1/auth/request", { method: "POST", body: { email: KNOWN } }),
      e({
        AUTH_EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "re_test_key",
        AUTH_EMAIL_FROM: "signin@example.com",
      }),
      new URL(`${ORIGIN}/v1/auth/request`),
      ctx.ctx,
      { fetch: (() => hung) as unknown as typeof fetch },
    );
    // The response is out while the send is still in flight inside waitUntil —
    // which is also why response timing cannot say whether mail was sent.
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true}');
    expect(ctx.pendingCount()).toBe(1);
    // The row exists, so the deferral is genuinely the send and not a skip.
    expect(await tokenRows()).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The token row itself (R1, R4)                                               */
/* -------------------------------------------------------------------------- */

describe("the magic token (R1, R4)", () => {
  it("stores only a hash, expires in ten minutes, and carries >=128 bits", async () => {
    const before = nowSec();
    const { token } = await requestLink(KNOWN);
    const rows = await tokenRows();
    expect(rows).toHaveLength(1);
    expect(Object.values(rows[0])).not.toContain(token);
    expect(rows[0].token_hash).toBe(await hashToken(token!));
    expect(token).toMatch(/^[A-Za-z0-9_-]{22,}$/); // 16 bytes, base64url, unpadded
    expect(rows[0].expires_at).toBe((rows[0].created_at as number) + MAGIC_TOKEN_TTL_S);
    expect(rows[0].created_at as number).toBeGreaterThanOrEqual(before);
    expect(rows[0].used_at).toBeNull();
  });

  it("mails the token in the fragment, never in the path or query", async () => {
    const { logs } = await requestLink(KNOWN);
    const url = logs.match(/https:\/\/\S+/)?.[0] ?? "";
    const parsed = new URL(url);
    expect(parsed.pathname).toBe(CALLBACK_PATH);
    expect(parsed.search).toBe("");
    expect(parsed.hash.slice(1)).toMatch(/^[A-Za-z0-9_-]{22,}$/);
  });

  it("points the link at AUTH_PUBLIC_ORIGIN when one is configured", async () => {
    const { logs } = await requestLink(KNOWN, e({ AUTH_PUBLIC_ORIGIN: "https://compass.example/x" }));
    expect(logs).toContain(`https://compass.example${CALLBACK_PATH}#`);
  });

  it("a repeat does not invalidate the link already sitting in the inbox", async () => {
    const first = await requestLink(KNOWN);
    const second = await requestLink(KNOWN);
    expect(second.token).not.toBe(first.token);
    // Two rows, each with its own unslid expiry: an unauthenticated POST must
    // not be able to destroy a link somebody else is holding.
    const rows = await tokenRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.expires_at)).toEqual(rows.map((r) => (r.created_at as number) + MAGIC_TOKEN_TTL_S));

    const { res } = await call(redeem(first.token, { cookies: { [NONCE_COOKIE]: first.nonce } }));
    expect(res.status).toBe(200);
  });

  it("caps concurrently-live links per address, and a capped repeat spends no budget", async () => {
    const key = await hashToken(KNOWN);
    const cap = MAX_LIVE_TOKENS_PER_ADDRESS;
    for (let i = 0; i < cap; i++) expect((await requestLink(KNOWN)).token).toBeTruthy();
    expect(await tokenRows()).toHaveLength(cap);
    expect(await readBudget(env, SEND_ADDRESS_SCOPE, key, budgetDay())).toBe(cap);

    const capped = await requestLink(KNOWN);
    expect(capped.res.status).toBe(200); // R2: still the one answer
    expect(capped.token).toBeNull();
    expect(await tokenRows()).toHaveLength(cap);
    // The whole point: a third party cannot burn a named user's daily
    // allowance by hammering the route.
    expect(await readBudget(env, SEND_ADDRESS_SCOPE, key, budgetDay())).toBe(cap);
  });

  it("keeps separate rows for separate addresses", async () => {
    await requestLink(KNOWN);
    await requestLink(UNKNOWN);
    expect(await tokenRows()).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* GET /v1/auth/callback — the interstitial (R19, AE2)                         */
/* -------------------------------------------------------------------------- */

describe("GET /v1/auth/callback", () => {
  it("serves HTML under a nonce-based CSP with no inline escape hatch (R19)", async () => {
    const { res } = await call(req(CALLBACK_PATH));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    const nonce = csp.match(/script-src 'nonce-([A-Za-z0-9_-]+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const html = await res.text();
    // Every inline block carries the nonce; nothing runs without it.
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).toContain(`<style nonce="${nonce}">`);
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).not.toMatch(/<script(?![^>]*nonce=)/);
    // No inline event handlers either: they would need `unsafe-inline`, which
    // this policy does not grant, so one would be a silently dead control.
    expect(html).not.toMatch(/\son[a-z]+\s*=/);
  });

  it("mints a fresh nonce per request — a reused one is a reusable injection", async () => {
    const a = (await call(req(CALLBACK_PATH))).res.headers.get("Content-Security-Policy");
    const b = (await call(req(CALLBACK_PATH))).res.headers.get("Content-Security-Policy");
    expect(a).not.toBe(b);
  });

  it("reads the token from the fragment and posts it — never a GET redemption", async () => {
    const html = await (await call(req(CALLBACK_PATH))).res.text();
    expect(html).toContain("location.hash");
    expect(html).toContain('"/v1/auth/redeem"');
    expect(html).toContain('method: "POST"');
    expect(html).toContain('"X-GC-CSRF"');
    expect(html).toContain("history.replaceState"); // token leaves the address bar
  });

  it("a scanner's GET does not consume the token; the later POST still signs in (AE2)", async () => {
    const { token, nonce } = await requestLink(KNOWN);
    // The gateway prefetch: a GET with no JavaScript, no cookies, no Origin.
    const scan = await call(req(CALLBACK_PATH, { csrf: null, origin: null }));
    expect(scan.res.status).toBe(200);
    expect((await tokenRows())[0].used_at).toBeNull();

    const { res } = await call(
      req("/v1/auth/redeem", {
        method: "POST",
        body: { token },
        cookies: { [NONCE_COOKIE]: nonce },
      }),
    );
    expect(res.status).toBe(200);
    expect((await tokenRows())[0].used_at).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* POST /v1/auth/redeem (R1, R3; AE3)                                          */
/* -------------------------------------------------------------------------- */

/** Redeem helper: valid nonce cookie unless the test says otherwise. */
function redeem(token: string | null, opts: ReqOpts & { confirm?: boolean } = {}): Request {
  const { confirm, ...rest } = opts;
  return req("/v1/auth/redeem", {
    method: "POST",
    body: confirm ? { token, confirm: true } : { token },
    ...rest,
  });
}

describe("POST /v1/auth/redeem", () => {
  it("signs in, rotates a session cookie in, and clears the nonce", async () => {
    const { token, nonce } = await requestLink(KNOWN);
    const { res } = await call(redeem(token, { cookies: { [NONCE_COOKIE]: nonce } }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? "";
    expect(session).toMatch(/Secure/);
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/SameSite=Lax/);
    expect(session).not.toMatch(/Domain=/);
    expect(cookies.some((c) => c.startsWith(`${NONCE_COOKIE}=`) && c.includes("Max-Age=0"))).toBe(
      true,
    );

    const sessionToken = session.split(";")[0].split("=")[1];
    const row = await env.DB.prepare("SELECT user_id FROM sessions WHERE token_hash = ?1")
      .bind(await hashToken(sessionToken))
      .first<{ user_id: string }>();
    expect(row?.user_id).toBe("usr_known");
  });

  it("creates the account on an allowlisted first sign-in", async () => {
    const { token, nonce } = await requestLink(UNKNOWN);
    const { res } = await call(redeem(token, { cookies: { [NONCE_COOKIE]: nonce } }));
    expect(res.status).toBe(200);
    const user = await userRow(UNKNOWN);
    expect(user).toBeTruthy();
    expect(user!.id).toMatch(/^usr_/);
  });

  it("refuses to register an address dropped from the allowlist after the send", async () => {
    const { token, nonce } = await requestLink(UNKNOWN);
    const { res } = await call(
      redeem(token, { cookies: { [NONCE_COOKIE]: nonce } }),
      e({ AUTH_ALLOWED_EMAILS: KNOWN }),
    );
    expect(res.status).toBe(400);
    expect(await userRow(UNKNOWN)).toBeNull();
  });

  it("destroys the session already in the browser (R3: rotate on authentication)", async () => {
    const old = await mintSession(e(), "usr_known");
    const { token, nonce } = await requestLink(KNOWN);
    const { res } = await call(
      redeem(token, { cookies: { [NONCE_COOKIE]: nonce, [SESSION_COOKIE]: old.token } }),
    );
    expect(res.status).toBe(200);
    const survivor = await env.DB.prepare("SELECT id FROM sessions WHERE token_hash = ?1")
      .bind(await hashToken(old.token))
      .first();
    expect(survivor).toBeNull();
  });

  it("rotates the same account's session, carrying the 180-day anchor forward", async () => {
    const old = await mintSession(e(), "usr_known");
    const anchor = nowSec() - 100 * 86_400;
    await env.DB.prepare("UPDATE sessions SET created_at = ?1 WHERE id = ?2")
      .bind(anchor, old.sessionId)
      .run();

    const { token, nonce } = await requestLink(KNOWN);
    const { res } = await call(
      redeem(token, { cookies: { [NONCE_COOKIE]: nonce, [SESSION_COOKIE]: old.token } }),
    );
    expect(res.status).toBe(200);

    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>();
    expect(rows!.n).toBe(1); // one batch, one survivor
    const session = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
    const fresh = session.split(";")[0].split("=")[1];
    const row = await env.DB.prepare("SELECT created_at FROM sessions WHERE token_hash = ?1")
      .bind(await hashToken(fresh))
      .first<{ created_at: number }>();
    // Re-authenticating must not reset the absolute cap of a session that is
    // continuing in the same browser.
    expect(row!.created_at).toBe(anchor);
  });

  it("a session belonging to a different account is destroyed, not rotated", async () => {
    await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?1, ?2, ?3)")
      .bind("usr_other", "other@example.com", nowSec())
      .run();
    const other = await mintSession(e(), "usr_other");
    const anchor = nowSec() - 100 * 86_400;
    await env.DB.prepare("UPDATE sessions SET created_at = ?1 WHERE id = ?2")
      .bind(anchor, other.sessionId)
      .run();

    const { token, nonce } = await requestLink(KNOWN);
    const { res } = await call(
      redeem(token, { cookies: { [NONCE_COOKIE]: nonce, [SESSION_COOKIE]: other.token } }),
    );
    expect(res.status).toBe(200);
    expect(
      await env.DB.prepare("SELECT id FROM sessions WHERE token_hash = ?1")
        .bind(await hashToken(other.token))
        .first(),
    ).toBeNull();
    const session = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
    const row = await env.DB.prepare(
      "SELECT user_id, created_at FROM sessions WHERE token_hash = ?1",
    )
      .bind(await hashToken(session.split(";")[0].split("=")[1]))
      .first<{ user_id: string; created_at: number }>();
    expect(row!.user_id).toBe("usr_known");
    expect(row!.created_at).toBeGreaterThan(anchor); // a new account, a new anchor
  });

  it("warns on account creation when the allowlist is empty (open sign-up)", async () => {
    const { token, nonce } = await requestLink(UNKNOWN);
    const warnings: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    });
    try {
      const { res } = await call(
        redeem(token, { cookies: { [NONCE_COOKIE]: nonce } }),
        e({ AUTH_ALLOWED_EMAILS: "" }),
      );
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
    // Open registration is the specified behavior, not a bug — but it must not
    // be silent, because it is also what an accidentally-cleared var looks like.
    expect(warnings.join("\n")).toContain("AUTH_ALLOWED_EMAILS");
  });

  it("rejects a cross-site POST of an attacker's token on the missing header (AE3)", async () => {
    const { token, nonce } = await requestLink(KNOWN);
    // The attacker's hosted page: no custom header (it cannot set one without a
    // preflight this Worker never grants), and the victim's cookies ride along.
    const { res } = await call(
      redeem(token, { csrf: null, cookies: { [NONCE_COOKIE]: nonce } }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("X-GC-CSRF") });
    // The victim was not signed in and the token is untouched.
    expect((await tokenRows())[0].used_at).toBeNull();
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("rejects a cross-origin POST that does carry the header, and one with no Origin", async () => {
    const { token, nonce } = await requestLink(KNOWN);
    for (const extra of [{ origin: "https://evil.example" }, { origin: null }] as ReqOpts[]) {
      const { res } = await call(redeem(token, { cookies: { [NONCE_COOKIE]: nonce }, ...extra }));
      expect(res.status).toBe(403);
    }
    expect((await tokenRows())[0].used_at).toBeNull();
  });

  it("replays are refused with the one indistinguishable error", async () => {
    const { token, nonce } = await requestLink(KNOWN);
    const first = await call(redeem(token, { cookies: { [NONCE_COOKIE]: nonce } }));
    expect(first.res.status).toBe(200);

    const second = await call(redeem(token, { cookies: { [NONCE_COOKIE]: nonce } }));
    expect(second.res.status).toBe(400);
    const unknown = await call(redeem("not-a-real-token", { cookies: { [NONCE_COOKIE]: nonce } }));
    expect(unknown.res.status).toBe(400);
    // Byte-identical: a replayed token must not be distinguishable from one
    // that never existed.
    expect(await second.res.text()).toBe(await unknown.res.text());
  });

  it("an expired token is refused even with a matching nonce", async () => {
    const { token, nonce } = await requestLink(KNOWN);
    await env.DB.prepare("UPDATE magic_tokens SET expires_at = ?1").bind(nowSec() - 1).run();
    const { res } = await call(redeem(token, { cookies: { [NONCE_COOKIE]: nonce } }));
    expect(res.status).toBe(400);
    expect((await tokenRows())[0].used_at).toBeNull();
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("two concurrent redemptions: exactly one wins (the rows-affected check)", async () => {
    const { token, nonce } = await requestLink(KNOWN);
    const cookies = { [NONCE_COOKIE]: nonce };
    const [a, b] = await Promise.all([
      call(redeem(token, { cookies })),
      call(redeem(token, { cookies })),
    ]);
    const statuses = [a.res.status, b.res.status].sort();
    expect(statuses).toEqual([200, 400]);
    // One session, not two: the loser minted nothing.
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The nonce mismatch path — normal, not an attack                             */
/* -------------------------------------------------------------------------- */

describe("nonce mismatch routes to the naming interstitial", () => {
  it("names the address, consumes nothing, and stays redeemable", async () => {
    const { token } = await requestLink(KNOWN);
    // A different browser, or a mail app's webview: SameSite=Lax means the
    // __Host- cookie simply is not there.
    const { res } = await call(redeem(token));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ status: "confirm", email: KNOWN });
    expect((await tokenRows())[0].used_at).toBeNull();
    expect(res.headers.getSetCookie()).toHaveLength(0);

    const confirmed = await call(redeem(token, { confirm: true }));
    expect(confirmed.res.status).toBe(200);
    expect((await tokenRows())[0].used_at).not.toBeNull();
  });

  it("treats a wrong nonce the same as a missing one", async () => {
    const { token } = await requestLink(KNOWN);
    const { res } = await call(redeem(token, { cookies: { [NONCE_COOKIE]: "someone-elses" } }));
    expect(res.status).toBe(409);
    expect((await tokenRows())[0].used_at).toBeNull();
  });

  it("a stale nonce from an earlier request does not silently match", async () => {
    const first = await requestLink(KNOWN);
    const second = await requestLink(KNOWN); // rewrites nonce_hash on the row
    const stale = await call(redeem(second.token, { cookies: { [NONCE_COOKIE]: first.nonce } }));
    expect(stale.res.status).toBe(409);
    const fresh = await call(redeem(second.token, { cookies: { [NONCE_COOKIE]: second.nonce } }));
    expect(fresh.res.status).toBe(200);
  });

  it("the nonce cookie the request set is __Host-, Lax, and short-lived", async () => {
    const { res } = await requestLink(KNOWN);
    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(NONCE_COOKIE.startsWith("__Host-")).toBe(true);
    expect(cookie).toContain(`${NONCE_COOKIE}=`);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/Domain=/);
    expect(cookie).toBe(nonceCookie(cookie.split(";")[0].split("=")[1]));
  });
});

/* -------------------------------------------------------------------------- */
/* POST /v1/auth/signout                                                       */
/* -------------------------------------------------------------------------- */

describe("POST /v1/auth/signout", () => {
  it("revokes the session server-side and clears the cookie", async () => {
    const minted = await mintSession(e(), "usr_known");
    const { res } = await call(
      req("/v1/auth/signout", { method: "POST", cookies: { [SESSION_COOKIE]: minted.token } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
    const row = await env.DB.prepare("SELECT id FROM sessions WHERE token_hash = ?1")
      .bind(await hashToken(minted.token))
      .first();
    expect(row).toBeNull();
  });

  it("401s without a session and 403s without the CSRF header", async () => {
    const anonymous = await call(req("/v1/auth/signout", { method: "POST" }));
    expect(anonymous.res.status).toBe(401);

    const minted = await mintSession(e(), "usr_known");
    const noHeader = await call(
      req("/v1/auth/signout", {
        method: "POST",
        csrf: null,
        cookies: { [SESSION_COOKIE]: minted.token },
      }),
    );
    expect(noHeader.res.status).toBe(403);
    // Still live: a failed CSRF check must not have logged anyone out.
    expect(
      await env.DB.prepare("SELECT id FROM sessions WHERE token_hash = ?1")
        .bind(await hashToken(minted.token))
        .first(),
    ).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Method and path discipline                                                  */
/* -------------------------------------------------------------------------- */

describe("dispatch", () => {
  it("404s the wrong method on every surface — a GET can never redeem", async () => {
    const cases: [string, string][] = [
      ["/v1/auth/mode", "POST"],
      ["/v1/auth/request", "GET"],
      [CALLBACK_PATH, "POST"],
      ["/v1/auth/redeem", "GET"],
      ["/v1/auth/signout", "GET"],
      ["/v1/auth/nope", "GET"],
    ];
    for (const [path, method] of cases) {
      const { res } = await call(req(path, { method }));
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });
});
