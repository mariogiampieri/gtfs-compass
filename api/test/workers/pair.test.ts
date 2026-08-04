import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CSRF_HEADER, DEVICE_TOKEN_PREFIX, SESSION_COOKIE, hashToken, mintSession } from "../../src/auth";
import { budgetDay, readBudget } from "../../src/email";
import {
  DEFAULT_DEVICE_SCOPES,
  MAX_CODE_ATTEMPTS,
  MAX_DEVICE_NAME_LENGTH,
  PAIRING_CODE_TTL_S,
  PAIR_CLAIMER_SCOPE,
  PAIR_CLAIM_FRESH_SCOPE,
  PAIR_CLAIM_IP_SCOPE,
  PAIR_CLAIM_REFUSED_SCOPE,
  PAIR_CLAIM_REPEAT_SCOPE,
  PAIR_START_FRESH_SCOPE,
  PAIR_START_IP_SCOPE,
  PAIR_START_REFUSED_SCOPE,
  PAIR_START_REPEAT_SCOPE,
  USER_CODE_ALPHABET,
  USER_CODE_LENGTH,
  mintUserCode,
  networkKey,
  normalizeUserCode,
  routePair,
} from "../../src/routes/pair";
import { resetSchema } from "./schema";

/**
 * RFC 8628 device pairing (U5; R6, R7, R8; AE4, AE5).
 *
 * These call `routePair` directly rather than through `SELF.fetch` so a test
 * can drive two callers concurrently and inspect D1 in between — the two
 * properties that matter most here (the token is issued exactly once, and the
 * budgets are D1-backed rather than in-isolate) are both invisible to a test
 * that can only look at one response at a time.
 */

const ORIGIN = "https://api.example";
const OWNER = "usr_owner";
const OTHER = "usr_other";
const IP = "203.0.113.7";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function e(overrides: Record<string, unknown> = {}): Env {
  return { ...env, ...overrides } as unknown as Env;
}

interface ReqOpts {
  method?: string;
  body?: unknown;
  origin?: string | null;
  csrf?: string | null;
  cookies?: Record<string, string>;
  bearer?: string;
  ip?: string | null;
}

function req(path: string, opts: ReqOpts = {}): Request {
  const headers = new Headers();
  if (opts.origin !== null) headers.set("Origin", opts.origin ?? ORIGIN);
  if (opts.csrf !== null) headers.set(CSRF_HEADER, opts.csrf ?? "1");
  if (opts.ip !== null) headers.set("CF-Connecting-IP", opts.ip ?? IP);
  if (opts.bearer) headers.set("Authorization", `Bearer ${opts.bearer}`);
  const cookies = Object.entries(opts.cookies ?? {}).map(([k, v]) => `${k}=${v}`);
  if (cookies.length) headers.set("Cookie", cookies.join("; "));
  const init: RequestInit = { method: opts.method ?? "POST", headers };
  if (opts.body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  return new Request(`${ORIGIN}${path}`, init);
}

function call(request: Request, environment: Env = e()): Promise<Response> {
  return routePair(request, environment, new URL(request.url));
}

/* -------------------------------------------------------------------------- */
/* Flow helpers                                                                */
/* -------------------------------------------------------------------------- */

interface Started {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

async function start(
  body: Record<string, unknown> = {},
  environment: Env = e(),
  opts: ReqOpts = {},
): Promise<Started> {
  const res = await call(req("/v1/device/pair/start", { body, ...opts }), environment);
  expect(res.status).toBe(200);
  return (await res.json()) as Started;
}

/** A live session cookie for `userId`. */
async function session(userId: string): Promise<string> {
  const minted = await mintSession(e(), userId);
  return minted.token;
}

function claimReq(
  userCode: string,
  cookie: string,
  extra: ReqOpts & { confirm?: boolean } = {},
): Request {
  const { confirm, ...rest } = extra;
  return req("/v1/pair/claim", {
    body: confirm ? { user_code: userCode, confirm: true } : { user_code: userCode },
    cookies: { [SESSION_COOKIE]: cookie },
    ...rest,
  });
}

function pollReq(deviceCode: string): Request {
  return req("/v1/device/pair/poll", { bearer: deviceCode });
}

/**
 * Feed scripted bytes to the *user-code* draws only, in order, falling back to
 * the real CSPRNG once the queue is empty. `mintUserCode` is the only caller
 * that asks for exactly `USER_CODE_LENGTH` bytes, which is what makes this
 * targetable without stubbing token generation as well.
 */
function stubUserCodeBytes(queue: number[][]): () => void {
  const real = crypto.getRandomValues.bind(crypto);
  const spy = vi
    .spyOn(crypto, "getRandomValues")
    .mockImplementation(((array: ArrayBufferView) => {
      if (array instanceof Uint8Array && array.length === USER_CODE_LENGTH && queue.length > 0) {
        array.set(queue.shift()!);
        return array;
      }
      return real(array as Uint8Array);
    }) as typeof crypto.getRandomValues);
  return () => spy.mockRestore();
}

/** Eight copies of one byte — one scripted `mintUserCode` draw. */
function bytes(value: number): number[] {
  return new Array<number>(USER_CODE_LENGTH).fill(value);
}

/**
 * An `Env` whose D1 binding records every statement the route prepares, with
 * the values it bound. Lets a test re-run the route's *own* SQL through
 * `.all()`, which reports `meta.rows_read` — `.first()`, which the routes use,
 * does not.
 */
function recordingEnv(sink: { sql: string; args: unknown[] }[]): Env {
  const db = {
    prepare(sql: string) {
      const entry = { sql, args: [] as unknown[] };
      sink.push(entry);
      const real = env.DB.prepare(sql);
      return {
        bind: (...args: unknown[]) => {
          entry.args = args;
          return real.bind(...args);
        },
        first: real.first.bind(real),
        all: real.all.bind(real),
        run: real.run.bind(real),
      };
    },
    batch: env.DB.batch.bind(env.DB),
  };
  return e({ DB: db });
}

async function codeRows(): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare("SELECT * FROM pairing_codes").all();
  return results as Record<string, unknown>[];
}

async function deviceRows(): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare("SELECT * FROM devices").all();
  return results as Record<string, unknown>[];
}

/** Start, claim (preview + confirm), and hand back both halves. */
async function pairedCode(
  cookie: string,
  body: Record<string, unknown> = {},
): Promise<{ started: Started; compact: string }> {
  const started = await start(body);
  const compact = normalizeUserCode(started.user_code)!;
  const confirmed = await call(claimReq(started.user_code, cookie, { confirm: true }));
  expect(confirmed.status).toBe(200);
  return { started, compact };
}

beforeEach(async () => {
  await resetSchema();
  for (const id of [OWNER, OTHER]) {
    await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?1, ?2, ?3)")
      .bind(id, `${id}@example.com`, nowSec())
      .run();
  }
});

/* -------------------------------------------------------------------------- */
/* The user code itself (R7)                                                   */
/* -------------------------------------------------------------------------- */

describe("the user code (R7)", () => {
  it("is eight characters from the confusion-free consonant alphabet", () => {
    expect(USER_CODE_ALPHABET).toBe("BCDFGHJKLMNPQRSTVWXZ");
    for (let i = 0; i < 200; i++) {
      const code = mintUserCode();
      expect(code).toHaveLength(USER_CODE_LENGTH);
      for (const ch of code) expect(USER_CODE_ALPHABET).toContain(ch);
    }
  });

  it("reaches every letter of the alphabet", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) for (const ch of mintUserCode()) seen.add(ch);
    expect(seen.size).toBe(USER_CODE_ALPHABET.length);
  });

  it("discards out-of-range bytes instead of folding them (no modulo bias)", () => {
    // 256 is not a multiple of 20, so bytes 240-255 have no unbiased mapping.
    // A `byte % 20` implementation would turn this draw into "BBBBBBBB"; a
    // rejecting one throws it away and uses the next draw, which is all 1s.
    const restore = stubUserCodeBytes([bytes(240), bytes(1)]);
    try {
      expect(mintUserCode()).toBe("C".repeat(USER_CODE_LENGTH));
    } finally {
      restore();
    }
  });

  it("normalizes case and separators, and refuses anything else", () => {
    expect(normalizeUserCode("BCDFGHJK")).toBe("BCDFGHJK");
    expect(normalizeUserCode("bcdf-ghjk")).toBe("BCDFGHJK");
    expect(normalizeUserCode("  bcdf ghjk  ")).toBe("BCDFGHJK");
    expect(normalizeUserCode("BCDF—GHJK")).toBe("BCDFGHJK"); // em dash
    // Not "strip anything unrecognized": dropping the A would re-align this
    // into a different, valid, *someone else's* code.
    expect(normalizeUserCode("BCDFAGHJK")).toBeNull();
    expect(normalizeUserCode("BCDFGHJ")).toBeNull();
    expect(normalizeUserCode("BCDFGHJK9")).toBeNull();
    expect(normalizeUserCode("")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* POST /v1/device/pair/start (R6, R7)                                         */
/* -------------------------------------------------------------------------- */

describe("POST /v1/device/pair/start", () => {
  it("mints a 256-bit device code and an 8-character user code (R6, R7)", async () => {
    const before = nowSec();
    const started = await start({ device_name: "Desk board", fw_version: "1.2.3" });

    expect(started.device_code).toMatch(/^[A-Za-z0-9_-]{43,}$/); // 32 bytes, base64url
    expect(started.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(started.expires_in).toBe(PAIRING_CODE_TTL_S);
    expect(started.interval).toBeGreaterThan(0);
    expect(new URL(started.verification_uri).origin).toBe(ORIGIN);

    const rows = await codeRows();
    expect(rows).toHaveLength(1);
    // Only the hash is at rest, and the stored code is the compact form.
    expect(Object.values(rows[0])).not.toContain(started.device_code);
    expect(rows[0].device_code_hash).toBe(await hashToken(started.device_code));
    expect(rows[0].user_code).toBe(started.user_code.replace("-", ""));
    expect(rows[0].expires_at).toBe((rows[0].created_at as number) + PAIRING_CODE_TTL_S);
    expect(rows[0].created_at as number).toBeGreaterThanOrEqual(before);
    expect(rows[0].attempts).toBe(0);
    expect(rows[0].claimed_by).toBeNull();
    expect(rows[0].device_name).toBe("Desk board");
    expect(rows[0].fw_version).toBe("1.2.3");
  });

  it("points verification_uri at AUTH_PUBLIC_ORIGIN when one is configured", async () => {
    const started = await start({}, e({ AUTH_PUBLIC_ORIGIN: "https://compass.example/x" }));
    expect(started.verification_uri.startsWith("https://compass.example/")).toBe(true);
  });

  it("accepts a device that sends no body at all", async () => {
    const res = await call(req("/v1/device/pair/start"));
    expect(res.status).toBe(200);
    expect((await codeRows())[0].device_name).toBeNull();
  });

  it("400s a malformed body without writing a row", async () => {
    const res = await call(req("/v1/device/pair/start", { body: "{not json" }));
    expect(res.status).toBe(400);
    expect(await codeRows()).toHaveLength(0);
  });

  it("caps and strips device-supplied metadata at rest (R8)", async () => {
    await start({
      device_name: `${"n".repeat(200)}`,
      // Escapes, never raw bytes: one literal NUL in this file makes `file`
      // report the whole thing as `data`, which takes it out of every repo-wide
      // grep and log scraper that skips binaries. U+0000 is the C0 control,
      // U+202E is RIGHT-TO-LEFT OVERRIDE.
      fw_version: "1.0\u0000\u202E0.1",
    });
    const row = (await codeRows())[0];
    expect((row.device_name as string).length).toBe(MAX_DEVICE_NAME_LENGTH);
    // Control and format characters — including the bidi override that makes a
    // name read as something else on screen — never reach storage.
    expect(row.fw_version).toBe("1.00.1");
  });

  it("stores non-string metadata as NULL rather than coercing it", async () => {
    await start({ device_name: { toString: "nope" }, fw_version: 42 });
    const row = (await codeRows())[0];
    expect(row.device_name).toBeNull();
    expect(row.fw_version).toBeNull();
  });

  it("re-rolls a user_code that a live row already holds", async () => {
    // Two scripted draws of the same code: the first start takes it, and the
    // second start's opening draw collides with the row the first one wrote.
    const restore = stubUserCodeBytes([bytes(0), bytes(0)]);
    try {
      expect((await start()).user_code).toBe("BBBB-BBBB");
      // The re-roll falls through to the real CSPRNG, so the collision the
      // claim path would otherwise have to refuse never reaches the table.
      const second = await start();
      expect(second.user_code).not.toBe("BBBB-BBBB");
    } finally {
      restore();
    }
    const codes = (await codeRows()).map((r) => r.user_code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("never fails an honest start, even when every re-roll collides", async () => {
    // The reason `idx_pairing_codes_user_code` is not UNIQUE: a collision must
    // not turn into a failed start request. Every draw here is the same code,
    // so the re-roll cannot help and the row is written anyway — loudly. The
    // safety net is the claim path, which refuses the ambiguity (below).
    const restore = stubUserCodeBytes(Array.from({ length: 12 }, () => bytes(0)));
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    try {
      expect((await start()).user_code).toBe("BBBB-BBBB");
      expect((await start()).user_code).toBe("BBBB-BBBB");
    } finally {
      spy.mockRestore();
      restore();
    }
    expect(await codeRows()).toHaveLength(2);
    expect(errors.join("\n")).toContain("collision");
  });
});

/* -------------------------------------------------------------------------- */
/* pair/start budgets (R7) — the bound applies before the write                 */
/* -------------------------------------------------------------------------- */

describe("pair/start is bounded before it writes (R7)", () => {
  it("refuses past the per-IP daily budget, and the counter is in D1", async () => {
    const env3 = e({ PAIR_START_BUDGET_IP: "3" });
    for (let i = 0; i < 3; i++) expect((await call(req("/v1/device/pair/start"), env3)).status).toBe(200);

    const refused = await call(req("/v1/device/pair/start"), env3);
    expect(refused.status).toBe(429);
    expect(await codeRows()).toHaveLength(3); // the refusal wrote no row

    // D1-backed, not in-isolate: the count is readable straight out of the
    // sharded counter table, and a brand-new Env object sees the same refusal.
    expect(await readBudget(env, PAIR_START_IP_SCOPE, await hashToken(networkKey(IP)))).toBe(3);
    expect((await call(req("/v1/device/pair/start"), e({ PAIR_START_BUDGET_IP: "3" }))).status).toBe(
      429,
    );
  });

  it("keys the budget to the network, not the address, and stores neither in the clear", async () => {
    const env1 = e({ PAIR_START_BUDGET_IP: "1" });
    expect((await call(req("/v1/device/pair/start", { ip: "198.51.100.1" }), env1)).status).toBe(200);
    // A per-address key is not a bound: changing the last octet — or, in IPv6,
    // any of the 2^64 host bits a subscriber is handed — would otherwise buy a
    // whole fresh budget for free.
    expect((await call(req("/v1/device/pair/start", { ip: "198.51.100.2" }), env1)).status).toBe(429);
    expect((await call(req("/v1/device/pair/start", { ip: "2001:db8::1" }), env1)).status).toBe(200);
    expect((await call(req("/v1/device/pair/start", { ip: "2001:db8::dead:beef" }), env1)).status).toBe(
      429,
    );
    // A different network is a different budget.
    expect((await call(req("/v1/device/pair/start", { ip: "198.51.101.1" }), env1)).status).toBe(200);
    expect((await call(req("/v1/device/pair/start", { ip: "2001:db8:0:1::1" }), env1)).status).toBe(200);

    const { results } = await env.DB.prepare("SELECT key FROM auth_budgets WHERE scope = ?1")
      .bind(PAIR_START_IP_SCOPE)
      .all<{ key: string }>();
    expect(results.length).toBeGreaterThan(0);
    for (const row of results) {
      expect(row.key).not.toContain("198.51.100");
      expect(row.key).not.toContain("2001");
    }
  });

  it("an exhausted global slice writes NO per-network counter row (the ordering that matters)", async () => {
    // The P1 shape from M1's review: the per-network key is attacker-chosen, so
    // if it were charged before the global bound were checked, a caller
    // rotating networks would grow `auth_budgets` for as long as they cared to
    // POST.
    await env.DB.prepare(
      "INSERT INTO auth_budgets (scope, key, day, shard, count) VALUES (?1, '', ?2, 0, 99)",
    )
      .bind(PAIR_START_FRESH_SCOPE, budgetDay())
      .run();

    const environment = e({ PAIR_START_BUDGET_FRESH: "99" });
    for (const ip of ["192.0.2.1", "198.51.100.1", "203.0.113.9"]) {
      expect((await call(req("/v1/device/pair/start", { ip }), environment)).status).toBe(429);
      expect(await readBudget(env, PAIR_START_IP_SCOPE, await hashToken(networkKey(ip)))).toBe(0);
    }
    expect(await codeRows()).toHaveLength(0);
    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM auth_budgets WHERE scope = ?1",
    )
      .bind(PAIR_START_IP_SCOPE)
      .all<{ n: number }>();
    expect(results[0].n).toBe(0);
  });

  it("treats 0 as a kill switch, not as an unset value", async () => {
    for (const kill of [
      { PAIR_START_BUDGET_IP: "0" },
      { PAIR_START_BUDGET_FRESH: "0" },
    ]) {
      expect((await call(req("/v1/device/pair/start"), e(kill))).status).toBe(429);
    }
    expect(await codeRows()).toHaveLength(0);
  });

  it("spends the repeat slice on a network that keeps starting, never the fresh one", async () => {
    // The split, in one caller: the first few starts from a network draw on
    // `fresh`, and everything past them on `repeat`. Sized so the repeat slice
    // runs out while the fresh one is barely touched.
    const environment = e({ PAIR_START_BUDGET_FRESH: "50", PAIR_START_BUDGET_REPEAT: "3" });
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push((await call(req("/v1/device/pair/start", { ip: "192.0.2.5" }), environment)).status);
    }
    // Four fresh charges, three repeat charges, then this network is done for
    // the day even though 46 of the 50 fresh starts are still unspent.
    expect(statuses.filter((s) => s === 200)).toHaveLength(7);
    expect(statuses.slice(7)).toEqual([429, 429, 429]);
    expect(await readBudget(env, PAIR_START_FRESH_SCOPE, "")).toBe(4);
    expect(await readBudget(env, PAIR_START_REPEAT_SCOPE, "")).toBe(3);
  });

  it("a flood that spends the global budget does NOT lock out an honest board (F1)", async () => {
    // The attack the reviewers named, at the SHIPPED defaults — no env
    // overrides, because the point is what a stock deployment does. Under a
    // single 500/day global counter, 25 addresses at the per-caller cap of 20
    // spend the entire deployment's day and every honest device 429s until
    // 00:00 UTC. Twenty-five addresses is one afternoon of a proxy pool, or
    // twenty-five of the 2^64 addresses in one IPv6 /64.
    let accepted = 0;
    for (let net = 0; net < 25; net++) {
      for (let i = 0; i < 20; i++) {
        const ip = `2001:db8:${net.toString(16)}::${i.toString(16)}`;
        if ((await call(req("/v1/device/pair/start", { ip }))).status === 200) accepted++;
      }
    }
    // The flood got somewhere — this is a real spend, not a no-op setup — and
    // was cut off well short of the 500 a shared counter would have handed it.
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(500);
    expect(await readBudget(env, PAIR_START_REPEAT_SCOPE, "")).toBe(100);

    // The property that matters, and the one the old tests never asked: a third
    // party who has done nothing wrong can still pair a board.
    const honest = await call(req("/v1/device/pair/start", { ip: "192.0.2.200" }));
    expect(honest.status).toBe(200);
  }, 30_000);

  it("records a globally-refused start where an operator can see it, not just in the log", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    try {
      const environment = e({ PAIR_START_BUDGET_FRESH: "0" });
      expect((await call(req("/v1/device/pair/start"), environment)).status).toBe(429);
      expect((await call(req("/v1/device/pair/start"), environment)).status).toBe(429);
    } finally {
      spy.mockRestore();
    }
    // A durable counter, keyed by slice: "pairing has been off for eleven
    // hours" must not be indistinguishable from "nobody paired a board today".
    expect(await readBudget(env, PAIR_START_REFUSED_SCOPE, "fresh")).toBe(2);
    expect(errors.join("\n")).toContain("fresh");
    // A refusal still writes nothing keyed to the caller.
    expect(await readBudget(env, PAIR_START_IP_SCOPE, await hashToken(networkKey(IP)))).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* The budget key (F1) — a network, never an address                           */
/* -------------------------------------------------------------------------- */

describe("networkKey", () => {
  it("truncates IPv4 to the /24 and IPv6 to the /64", () => {
    expect(networkKey("203.0.113.7")).toBe("203.0.113.0/24");
    expect(networkKey("203.0.113.250")).toBe(networkKey("203.0.113.7"));
    expect(networkKey("203.0.114.7")).not.toBe(networkKey("203.0.113.7"));

    // Every host bit inside one /64 is one key, however the address is written:
    // compressed, expanded, upper case, leading zeros, or with a zone index.
    const prefix = networkKey("2001:db8:1:2::1");
    for (const form of [
      "2001:db8:1:2:0:0:0:9999",
      "2001:0db8:0001:0002::abcd",
      "2001:DB8:1:2::1",
      "2001:db8:1:2::1%eth0",
    ]) {
      expect(networkKey(form), form).toBe(prefix);
    }
    expect(networkKey("2001:db8:1:3::1")).not.toBe(prefix);
  });

  it("gives anything unparseable one shared key rather than one key each", () => {
    // Fails safe: `unknown` (no CF-Connecting-IP) and any form the edge does
    // not emit share a single tight budget instead of minting budgets.
    expect(networkKey("unknown")).toBe("unknown");
    expect(networkKey("999.1.2.3")).toBe("999.1.2.3");
    expect(networkKey("1:2:3")).toBe("1:2:3");
  });
});

/* -------------------------------------------------------------------------- */
/* POST /v1/pair/claim — the gates (R8)                                        */
/* -------------------------------------------------------------------------- */

describe("POST /v1/pair/claim gates", () => {
  it("401s without a session and 403s without the CSRF header", async () => {
    const started = await start();
    const cookie = await session(OWNER);

    const anonymous = await call(req("/v1/pair/claim", { body: { user_code: started.user_code } }));
    expect(anonymous.status).toBe(401);

    const noHeader = await call(claimReq(started.user_code, cookie, { csrf: null }));
    expect(noHeader.status).toBe(403);

    for (const extra of [{ origin: "https://evil.example" }, { origin: null }] as ReqOpts[]) {
      expect((await call(claimReq(started.user_code, cookie, extra))).status).toBe(403);
    }

    // Nothing was claimed and no attempt was charged against the code.
    const row = (await codeRows())[0];
    expect(row.claimed_by).toBeNull();
    expect(row.attempts).toBe(0);
  });

  it("400s a code that is not code-shaped, without charging the claimer", async () => {
    const cookie = await session(OWNER);
    for (const code of ["", "NOPE", "BCDFGHJ", "BCDFAGHJ", 42, undefined]) {
      const res = await call(
        req("/v1/pair/claim", {
          body: { user_code: code },
          cookies: { [SESSION_COOKIE]: cookie },
        }),
      );
      expect(res.status).toBe(400);
    }
    // A UI bug must not be able to spend the user's own daily attempts.
    expect(await readBudget(env, PAIR_CLAIMER_SCOPE, await hashToken(OWNER))).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* POST /v1/pair/claim — the confirm step and the claim (R8; AE4)              */
/* -------------------------------------------------------------------------- */

describe("POST /v1/pair/claim", () => {
  it("previews the device before binding anything (R8's confirm screen)", async () => {
    const started = await start({ device_name: "Kitchen board", fw_version: "0.9.1" });
    const cookie = await session(OWNER);

    const preview = await call(claimReq(started.user_code, cookie));
    expect(preview.status).toBe(409);
    expect(await preview.json()).toEqual({
      status: "confirm",
      user_code: started.user_code,
      // Explicitly labelled: the device chose these strings and nothing has
      // verified them.
      device: { name: "Kitchen board", fw_version: "0.9.1", untrusted: true },
    });
    // A preview binds nothing.
    expect((await codeRows())[0].claimed_by).toBeNull();

    const confirmed = await call(claimReq(started.user_code, cookie, { confirm: true }));
    expect(confirmed.status).toBe(200);
    const row = (await codeRows())[0];
    expect(row.claimed_by).toBe(OWNER);
    expect(row.claimed_at).not.toBeNull();
  });

  it("accepts the code lowercase and with the separator (R7 normalization)", async () => {
    const started = await start();
    const cookie = await session(OWNER);
    const typed = started.user_code.toLowerCase(); // "bcdf-ghjk"
    const res = await call(claimReq(typed, cookie, { confirm: true }));
    expect(res.status).toBe(200);
    expect((await codeRows())[0].claimed_by).toBe(OWNER);
  });

  it("never returns the device token to the claiming browser", async () => {
    const started = await start({ device_name: "Board" });
    const cookie = await session(OWNER);
    for (const res of [
      await call(claimReq(started.user_code, cookie)),
      await call(claimReq(started.user_code, cookie, { confirm: true })),
    ]) {
      const text = await res.text();
      expect(text).not.toContain(DEVICE_TOKEN_PREFIX);
      expect(text).not.toContain("access_token");
      expect(text).not.toContain(started.device_code);
    }
    // And nothing was minted yet — the device has not polled.
    expect(await deviceRows()).toHaveLength(0);
  });

  it("hands device metadata back as JSON data a renderer cannot execute (R8)", async () => {
    const hostile = '<script>alert("x")</script>';
    const started = await start({ device_name: hostile });
    const cookie = await session(OWNER);
    const res = await call(claimReq(started.user_code, cookie));

    expect(res.headers.get("Content-Type")).toBe("application/json");
    // The one way a JSON body becomes markup is a browser sniffing it as HTML.
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { device: { name: string; untrusted: boolean } };
    // Round-trips as text, unescaped and unmangled: escaping belongs to the
    // renderer (textContent), and double-escaping here would show the user
    // `&lt;script&gt;` instead of what the device actually calls itself.
    expect(body.device.name).toBe(hostile);
    expect(body.device.untrusted).toBe(true);
  });

  it("refuses an expired code with the same answer as one that never existed", async () => {
    const started = await start();
    const cookie = await session(OWNER);
    await env.DB.prepare("UPDATE pairing_codes SET expires_at = ?1").bind(nowSec() - 1).run();

    const expired = await call(claimReq(started.user_code, cookie, { confirm: true }));
    const unknown = await call(claimReq("BCDFGHJK", cookie, { confirm: true }));
    expect(expired.status).toBe(404);
    expect(unknown.status).toBe(404);
    // Byte-identical: "expired" would confirm the code had once been real.
    expect(await expired.text()).toBe(await unknown.text());
    expect((await codeRows())[0].claimed_by).toBeNull();
  });

  it("two accounts cannot claim one code — the second gets not-found", async () => {
    const started = await start();
    const first = await call(claimReq(started.user_code, await session(OWNER), { confirm: true }));
    expect(first.status).toBe(200);

    const second = await call(claimReq(started.user_code, await session(OTHER), { confirm: true }));
    expect(second.status).toBe(404);
    expect((await codeRows())[0].claimed_by).toBe(OWNER);
  });

  it("two concurrent claims: exactly one wins the conditional UPDATE", async () => {
    const started = await start();
    const [a, b] = await Promise.all([
      call(claimReq(started.user_code, await session(OWNER), { confirm: true })),
      call(claimReq(started.user_code, await session(OTHER), { confirm: true })),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    expect([OWNER, OTHER]).toContain((await codeRows())[0].claimed_by);
  });

  it("refuses an ambiguous user_code rather than guessing which device is meant", async () => {
    const started = await start({ device_name: "Mine" });
    const compact = started.user_code.replace("-", "");
    const now = nowSec();
    // The collision the non-UNIQUE index deliberately permits: a second live
    // row carrying the same short code.
    await env.DB.prepare(
      `INSERT INTO pairing_codes (id, device_code_hash, user_code, device_name, created_at, expires_at)
       VALUES ('pcd_collision', 'hash_collision', ?1, 'Not mine', ?2, ?3)`,
    )
      .bind(compact, now, now + PAIRING_CODE_TTL_S)
      .run();

    const res = await call(claimReq(started.user_code, await session(OWNER), { confirm: true }));
    expect(res.status).toBe(404);
    // Neither row is claimed and neither is charged an attempt: a collision
    // nobody can aim must not become a way to burn someone's counter.
    for (const row of await codeRows()) {
      expect(row.claimed_by).toBeNull();
      expect(row.attempts).toBe(0);
    }
  });

  it("an ambiguity does not block the other request once one code is gone", async () => {
    const started = await start();
    const compact = started.user_code.replace("-", "");
    const now = nowSec();
    await env.DB.prepare(
      `INSERT INTO pairing_codes (id, device_code_hash, user_code, created_at, expires_at)
       VALUES ('pcd_collision', 'hash_collision', ?1, ?2, ?3)`,
    )
      .bind(compact, now, now + PAIRING_CODE_TTL_S)
      .run();
    await env.DB.prepare("DELETE FROM pairing_codes WHERE id = 'pcd_collision'").run();

    const res = await call(claimReq(started.user_code, await session(OWNER), { confirm: true }));
    expect(res.status).toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/* Attempt counters (R7; AE5)                                                  */
/* -------------------------------------------------------------------------- */

describe("attempt budgets (R7; AE5)", () => {
  it("destroys a code after five failed attempts against it", async () => {
    const started = await start();
    const cookie = await session(OWNER);
    const environment = e({ PAIR_CLAIM_BUDGET_CLAIMER: "50", PAIR_CLAIM_BUDGET_IP: "50" });

    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) {
      const res = await call(claimReq(started.user_code, cookie), environment);
      expect(res.status, `attempt ${i}`).toBe(409);
      expect((await codeRows())[0].attempts).toBe(i);
    }

    // The fifth attempt destroys the row, and says only what a code that never
    // existed says.
    const fifth = await call(claimReq(started.user_code, cookie), environment);
    expect(fifth.status).toBe(404);
    expect(await codeRows()).toHaveLength(0);

    // And the code is genuinely unusable afterwards, not merely counted.
    const after = await call(claimReq(started.user_code, cookie, { confirm: true }), environment);
    expect(after.status).toBe(404);
  });

  it("charges the claimer for codes that do not exist, then refuses (AE5)", async () => {
    const cookie = await session(OWNER);
    const environment = e({ PAIR_CLAIM_BUDGET_CLAIMER: "5", PAIR_CLAIM_BUDGET_IP: "50" });
    const key = await hashToken(OWNER);

    // Spraying the live-code space: every guess misses, so there is no row to
    // charge — which is exactly why the counter is keyed to the claimer.
    for (let i = 0; i < 5; i++) {
      const res = await call(claimReq(mintUserCode(), cookie, { confirm: true }), environment);
      expect(res.status).toBe(404);
    }
    expect(await readBudget(env, PAIR_CLAIMER_SCOPE, key)).toBe(5);

    const refused = await call(claimReq(mintUserCode(), cookie, { confirm: true }), environment);
    expect(refused.status).toBe(429);

    // The refusal bites a real code too: the sprayer does not get to keep
    // guessing just because the next guess happens to be right.
    const started = await start();
    const real = await call(claimReq(started.user_code, cookie, { confirm: true }), environment);
    expect(real.status).toBe(429);
    expect((await codeRows())[0].claimed_by).toBeNull();
  });

  it("counts per IP as well, so a second account does not reset the budget", async () => {
    const environment = e({ PAIR_CLAIM_BUDGET_CLAIMER: "2", PAIR_CLAIM_BUDGET_IP: "3" });
    const ownerCookie = await session(OWNER);
    const otherCookie = await session(OTHER);

    for (let i = 0; i < 2; i++) {
      expect(
        (await call(claimReq(mintUserCode(), ownerCookie, { confirm: true }), environment)).status,
      ).toBe(404);
    }
    expect(
      (await call(claimReq(mintUserCode(), ownerCookie, { confirm: true }), environment)).status,
    ).toBe(429);

    // A fresh account from the same address inherits what the IP has left.
    expect(
      (await call(claimReq(mintUserCode(), otherCookie, { confirm: true }), environment)).status,
    ).toBe(404);
    expect(
      (await call(claimReq(mintUserCode(), otherCookie, { confirm: true }), environment)).status,
    ).toBe(429);
    expect(await readBudget(env, PAIR_CLAIM_IP_SCOPE, await hashToken(networkKey(IP)))).toBe(3);
  });

  it("an exhausted global slice writes no per-claimer or per-network counter row", async () => {
    await env.DB.prepare(
      "INSERT INTO auth_budgets (scope, key, day, shard, count) VALUES (?1, '', ?2, 0, 7)",
    )
      .bind(PAIR_CLAIM_FRESH_SCOPE, budgetDay())
      .run();
    const cookie = await session(OWNER);
    const res = await call(
      claimReq(mintUserCode(), cookie, { confirm: true }),
      e({ PAIR_CLAIM_BUDGET_FRESH: "7" }),
    );
    expect(res.status).toBe(429);
    expect(await readBudget(env, PAIR_CLAIMER_SCOPE, await hashToken(OWNER))).toBe(0);
    expect(await readBudget(env, PAIR_CLAIM_IP_SCOPE, await hashToken(networkKey(IP)))).toBe(0);
    // And the refusal is on the operator's counter, not only in the log tail.
    expect(await readBudget(env, PAIR_CLAIM_REFUSED_SCOPE, "fresh")).toBe(1);
  });

  it("an account spending its whole claim budget does NOT lock out another account (F2)", async () => {
    // A claim costs a session, which raises the price of this attack without
    // removing it: registration is open whenever AUTH_ALLOWED_EMAILS is empty,
    // and accounts accumulate across days while the counter resets daily. The
    // per-claimer cap of 10/day already bounds this account; what the global
    // counter must not do is let that spend reach anybody else.
    const attacker = await session(OTHER);
    const environment = e({
      PAIR_CLAIM_BUDGET_CLAIMER: "10",
      PAIR_CLAIM_BUDGET_IP: "50",
      // The whole repeat slice is what one account past its first few attempts
      // can reach; the loop below spends it exactly. The fresh slice is only
      // large enough that a single shared counter of the same total (8 + 6)
      // would have run out inside the loop — which is the point.
      PAIR_CLAIM_BUDGET_FRESH: "8",
      PAIR_CLAIM_BUDGET_REPEAT: "6",
    });
    for (let i = 0; i < 10; i++) {
      const res = await call(claimReq(mintUserCode(), attacker, { confirm: true }), environment);
      expect(res.status, `spray ${i}`).toBe(404); // charged, and every guess misses
    }
    expect(await readBudget(env, PAIR_CLAIM_REPEAT_SCOPE, "")).toBe(6);

    // The property the old tests never asked: an unrelated account can still
    // pair a board. Its first attempts of the day land in the fresh slice,
    // which the sprayer above could not touch.
    const started = await start();
    const owner = await session(OWNER);
    const preview = await call(claimReq(started.user_code, owner), environment);
    expect(preview.status).toBe(409);
    const confirmed = await call(claimReq(started.user_code, owner, { confirm: true }), environment);
    expect(confirmed.status).toBe(200);
    expect((await codeRows())[0].claimed_by).toBe(OWNER);
  });

  it("treats 0 on either claim slice as a kill switch", async () => {
    const cookie = await session(OWNER);
    const res = await call(
      claimReq(mintUserCode(), cookie, { confirm: true }),
      e({ PAIR_CLAIM_BUDGET_FRESH: "0" }),
    );
    expect(res.status).toBe(429);
    expect(await readBudget(env, PAIR_CLAIMER_SCOPE, await hashToken(OWNER))).toBe(0);
  });

  it("charges a successful claim too — a hit is still an attempt", async () => {
    const started = await start();
    const cookie = await session(OWNER);
    await call(claimReq(started.user_code, cookie, { confirm: true }));
    expect(await readBudget(env, PAIR_CLAIMER_SCOPE, await hashToken(OWNER))).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* POST /v1/device/pair/poll (R6, R9; AE4)                                     */
/* -------------------------------------------------------------------------- */

describe("POST /v1/device/pair/poll", () => {
  it("answers authorization_pending until the code is claimed", async () => {
    const started = await start();
    const pending = await call(pollReq(started.device_code));
    expect(pending.status).toBe(400);
    expect(await pending.json()).toEqual({ error: "authorization_pending" });
    expect(await deviceRows()).toHaveLength(0);
  });

  it("returns the token exactly once, and a replay is not-found (AE4)", async () => {
    const cookie = await session(OWNER);
    const { started } = await pairedCode(cookie, { device_name: "Desk", fw_version: "1.4.0" });

    const first = await call(pollReq(started.device_code));
    expect(first.status).toBe(200);
    const body = (await first.json()) as {
      access_token: string;
      token_type: string;
      device_id: string;
      scopes: string[];
    };
    expect(body.access_token.startsWith(DEVICE_TOKEN_PREFIX)).toBe(true);
    expect(body.token_type).toBe("Bearer");
    expect(body.device_id).toMatch(/^dev_/);
    // R9: a freshly paired device never receives a position.
    expect(body.scopes).toEqual([...DEFAULT_DEVICE_SCOPES]);
    expect(body.scopes).not.toContain("read:fix");

    const devices = await deviceRows();
    expect(devices).toHaveLength(1);
    expect(devices[0].id).toBe(body.device_id);
    expect(devices[0].user_id).toBe(OWNER);
    expect(devices[0].token_hash).toBe(await hashToken(body.access_token));
    expect(Object.values(devices[0])).not.toContain(body.access_token);
    expect(devices[0].scopes).toBe("read:departures,read:config");
    expect(devices[0].name).toBe("Desk");
    expect(devices[0].fw_version).toBe("1.4.0");
    expect(devices[0].paired_at).not.toBeNull();
    expect(devices[0].revoked_at).toBeNull();

    // Both codes are destroyed by the collection.
    expect(await codeRows()).toHaveLength(0);

    const replay = await call(pollReq(started.device_code));
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: "expired_token" });
    expect(await deviceRows()).toHaveLength(1); // no second credential
  });

  it("two concurrent polls mint one token, not two", async () => {
    const cookie = await session(OWNER);
    const { started } = await pairedCode(cookie);
    const [a, b] = await Promise.all([
      call(pollReq(started.device_code)),
      call(pollReq(started.device_code)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect(await deviceRows()).toHaveLength(1);
  });

  it("is indistinguishable for an unknown, an expired, and a collected code", async () => {
    const unknown = await call(pollReq("not-a-real-device-code"));
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "expired_token" });

    const started = await start();
    await env.DB.prepare("UPDATE pairing_codes SET expires_at = ?1").bind(nowSec() - 1).run();
    const expired = await call(pollReq(started.device_code));
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({ error: "expired_token" });
  });

  it("refuses a claimed code whose delivery window has lapsed, minting nothing", async () => {
    const cookie = await session(OWNER);
    const { started } = await pairedCode(cookie);
    await env.DB.prepare("UPDATE pairing_codes SET expires_at = ?1").bind(nowSec() - 1).run();
    const res = await call(pollReq(started.device_code));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "expired_token" });
    expect(await deviceRows()).toHaveLength(0);
  });

  it("shortens the window on claim so an uncollected grant lapses (delivery TTL)", async () => {
    const cookie = await session(OWNER);
    const started = await start();
    const before = (await codeRows())[0].expires_at as number;
    await call(claimReq(started.user_code, cookie, { confirm: true }));
    const after = (await codeRows())[0].expires_at as number;
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(nowSec()); // still collectable right now
  });

  it("reads the device code from the header only — never a query parameter", async () => {
    const cookie = await session(OWNER);
    const { started } = await pairedCode(cookie);

    // The exact credential, in the exact place it must never be accepted: a
    // query string is written to every access log and survives in a Referer.
    const inQuery = await routePair(
      new Request(
        `${ORIGIN}/v1/device/pair/poll?device_code=${encodeURIComponent(started.device_code)}`,
        { method: "POST" },
      ),
      e(),
      new URL(`${ORIGIN}/v1/device/pair/poll?device_code=x`),
    );
    expect(inQuery.status).toBe(400);
    expect(await inQuery.json()).toEqual({ error: "invalid_request" });
    expect(await deviceRows()).toHaveLength(0);

    // Even alongside a valid header, the query parameter is refused rather
    // than ignored: a firmware bug must not quietly downgrade the credential.
    const both = await routePair(
      req("/v1/device/pair/poll?device_code=leak", { bearer: started.device_code }),
      e(),
      new URL(`${ORIGIN}/v1/device/pair/poll?device_code=leak`),
    );
    expect(both.status).toBe(400);
    expect(await deviceRows()).toHaveLength(0);

    // The header alone still works, so the refusal above is the query string.
    const header = await call(pollReq(started.device_code));
    expect(header.status).toBe(200);
  });

  it("400s a poll with no bearer credential at all", async () => {
    const res = await call(req("/v1/device/pair/poll"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("costs O(1) rows read whatever the table holds — the reason it needs no budget (F3)", async () => {
    // This route is unbudgeted and it is the highest-rate one here (RFC 8628
    // advertises a 5-second interval), so what stands in for a D1 budget is
    // the unique index on `device_code_hash`: a caller who does not hold a
    // device code reads *zero* rows, and one who does reads one. Charging a
    // counter instead would swap that for two SELECTs and an UPSERT — a write,
    // on an unauthenticated path. The moment the lookup stops being
    // index-covered that trade is wrong, which is what this pins.
    const now = nowSec();
    for (let i = 0; i < 300; i++) {
      await env.DB.prepare(
        `INSERT INTO pairing_codes (id, device_code_hash, user_code, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
        .bind(`pcd_bulk_${i}`, `hash_bulk_${i}`, mintUserCode(), now, now + PAIRING_CODE_TTL_S)
        .run();
    }

    // Replay the statement the route itself ran, so this cannot drift away
    // from the real predicate: `.first()` hides `meta`, `.all()` reports it.
    const started = await start();
    const seen: { sql: string; args: unknown[] }[] = [];
    const polled = await call(pollReq(started.device_code), recordingEnv(seen));
    expect(polled.status).toBe(400); // authorization_pending: unclaimed

    // Whatever the predicate becomes, it is this route's only read of the
    // table — so a change that stops being index-covered lands here.
    const lookup = seen.filter((s) => /^\s*SELECT[\s\S]*FROM pairing_codes/.test(s.sql));
    expect(lookup).toHaveLength(1);
    const hit = await env.DB.prepare(lookup[0].sql)
      .bind(...lookup[0].args)
      .all();
    expect(hit.results).toHaveLength(1);
    expect(hit.meta.rows_read).toBeLessThanOrEqual(1);

    // And the case an abuser actually generates: a code nobody holds.
    const miss = await env.DB.prepare(lookup[0].sql).bind(await hashToken("no-such-code")).all();
    expect(miss.results).toHaveLength(0);
    expect(miss.meta.rows_read).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                    */
/* -------------------------------------------------------------------------- */

describe("dispatch", () => {
  it("404s the wrong method and unknown pairing paths", async () => {
    const cases: [string, string][] = [
      ["/v1/device/pair/start", "GET"],
      ["/v1/device/pair/poll", "GET"],
      ["/v1/pair/claim", "GET"],
      ["/v1/device/pair/nope", "POST"],
      ["/v1/pair/nope", "POST"],
    ];
    for (const [path, method] of cases) {
      const res = await call(req(path, { method }));
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });
});
