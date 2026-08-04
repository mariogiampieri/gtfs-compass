import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CSRF_HEADER,
  SESSION_COOKIE,
  authorize,
  hashToken,
  mintSession,
  parseScopes,
} from "../../src/auth";
import { clearFix } from "../../src/relay";
import { routeConfig } from "../../src/routes/config";
import { DEFAULT_DEVICE_SCOPES, normalizeUserCode, routePair } from "../../src/routes/pair";
import { resetSchema } from "./schema";

/**
 * The device list, scope grants, and unpair (U10; R8, R9, R18; AE6, AE6d).
 *
 * Devices are created by driving the real pairing routes end to end rather than
 * by inserting rows: "a freshly claimed device shows `read:fix` off" is a claim
 * about what pairing *does*, and a hand-seeded row would assert it against
 * whatever this file decided to write.
 *
 * The device-side assertions go through `authorize()` — the same chokepoint
 * every device request goes through — because that is where a scope grant or a
 * revocation actually takes effect. No route names a scope yet (U8/U13 are the
 * first that will), so asserting against a route would be asserting against
 * nothing.
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
  cookie?: string;
  bearer?: string;
}

function req(path: string, opts: ReqOpts = {}): Request {
  const headers = new Headers();
  if (opts.origin !== null) headers.set("Origin", opts.origin ?? ORIGIN);
  if (opts.csrf !== null) headers.set(CSRF_HEADER, opts.csrf ?? "1");
  headers.set("CF-Connecting-IP", IP);
  if (opts.cookie) headers.set("Cookie", `${SESSION_COOKIE}=${opts.cookie}`);
  if (opts.bearer) headers.set("Authorization", `Bearer ${opts.bearer}`);
  const init: RequestInit = { method: opts.method ?? "GET", headers };
  if (opts.body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  return new Request(`${ORIGIN}${path}`, init);
}

function call(request: Request, environment: Env = e()): Promise<Response> {
  return routeConfig(request, environment, new URL(request.url));
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

interface DeviceEntry {
  id: string;
  paired_at: number | null;
  last_seen: number | null;
  scopes: string[];
  device: { name: string | null; fw_version: string | null; untrusted: true };
}

async function session(userId: string): Promise<string> {
  const minted = await mintSession(e(), userId);
  return minted.token;
}

/** Pair a board for real: start → claim (confirm) → poll. */
async function pairDevice(
  cookie: string,
  meta: Record<string, unknown> = { device_name: "Kitchen board", fw_version: "1.4.0" },
): Promise<{ deviceId: string; token: string }> {
  const environment = e();
  const startRes = await routePair(
    new Request(`${ORIGIN}/v1/device/pair/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": IP },
      body: JSON.stringify(meta),
    }),
    environment,
    new URL(`${ORIGIN}/v1/device/pair/start`),
  );
  expect(startRes.status).toBe(200);
  const started = (await startRes.json()) as { device_code: string; user_code: string };

  const claimRes = await routePair(
    new Request(`${ORIGIN}/v1/pair/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        [CSRF_HEADER]: "1",
        "CF-Connecting-IP": IP,
        Cookie: `${SESSION_COOKIE}=${cookie}`,
      },
      body: JSON.stringify({ user_code: normalizeUserCode(started.user_code), confirm: true }),
    }),
    environment,
    new URL(`${ORIGIN}/v1/pair/claim`),
  );
  expect(claimRes.status).toBe(200);

  const pollRes = await routePair(
    new Request(`${ORIGIN}/v1/device/pair/poll`, {
      method: "POST",
      headers: { Authorization: `Bearer ${started.device_code}`, "CF-Connecting-IP": IP },
    }),
    environment,
    new URL(`${ORIGIN}/v1/device/pair/poll`),
  );
  expect(pollRes.status).toBe(200);
  const collected = (await pollRes.json()) as { access_token: string; device_id: string };
  return { deviceId: collected.device_id, token: collected.access_token };
}

/** What `authorize()` makes of a device token asking for `scope`, right now. */
async function deviceAuth(token: string, scope?: string): Promise<Response | "allowed"> {
  const result = await authorize(
    new Request(`${ORIGIN}/v1/anything`, { headers: { Authorization: `Bearer ${token}` } }),
    e(),
    scope ? { scope: scope as "read:fix" } : {},
  );
  return result instanceof Response ? result : "allowed";
}

async function listDevices(cookie: string): Promise<DeviceEntry[]> {
  const res = await call(req("/v1/config/devices", { cookie }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { devices: DeviceEntry[] }).devices;
}

async function storedScopes(deviceId: string): Promise<string[]> {
  const row = await env.DB.prepare("SELECT scopes FROM devices WHERE id = ?1")
    .bind(deviceId)
    .first<{ scopes: string | null }>();
  return parseScopes(row?.scopes);
}

/**
 * Seed the relay row a phone would have posted.
 *
 * Direct SQL, and it stays that way now that U7 has landed `putFixForUser`.
 * Half the cases below need a fix on a board that does *not* currently hold
 * `read:fix` — another account's default-scoped device, or the row a
 * half-completed revocation left behind — and the fan-out write refuses
 * exactly those by design (R11's predicate is the grant *and* `revoked_at IS
 * NULL`). Routing this helper through the seam would make those tests seed
 * nothing and pass vacuously against a `fixCount` of 0.
 *
 * This is a *test* reaching past the seam, never product code: the Definition
 * of Done's "no SQL touches `device_fixes` outside the relay seam" is about
 * `src/`. The relay suite (`relay.test.ts`) exercises the seam's own round
 * trip.
 */
async function seedFix(deviceId: string): Promise<void> {
  const now = nowSec();
  await env.DB.prepare(
    `INSERT INTO device_fixes (device_id, lat, lon, accuracy_m, captured_at, received_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
  )
    .bind(deviceId, 40.6923, -73.9873, 8, now)
    .run();
}

async function fixCount(deviceId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM device_fixes WHERE device_id = ?1")
    .bind(deviceId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function grant(
  cookie: string,
  deviceId: string,
  scope: string,
  granted: boolean,
  opts: ReqOpts = {},
  environment: Env = e(),
): Promise<Response> {
  return call(
    req(`/v1/config/devices/${deviceId}`, {
      method: "PATCH",
      cookie,
      body: { scope, granted },
      ...opts,
    }),
    environment,
  );
}

/* -------------------------------------------------------------------------- */
/* Envs that make a partial failure and a lost race deterministic              */
/* -------------------------------------------------------------------------- */

/** Bind a host object's own method to it, so a Proxy can hand it back intact. */
function passThrough(target: object, prop: string | symbol): unknown {
  const value = Reflect.get(target, prop) as unknown;
  return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
}

/**
 * An `Env` whose first `DELETE FROM device_fixes` throws.
 *
 * Unpair is two writes that are deliberately *not* batched (see `relay.ts`),
 * so "the second one failed" is a state the system can genuinely be in — and
 * the only honest way to test what it leaves behind is to put it there.
 */
function failingFixDelete(): Env {
  const db = env.DB;
  let armed = true;
  return e({
    DB: new Proxy(db, {
      get(target, prop) {
        if (prop !== "prepare") return passThrough(target, prop);
        return (sql: string) => {
          if (armed && sql.includes("DELETE FROM device_fixes")) {
            armed = false;
            throw new Error("D1: write failed");
          }
          return target.prepare(sql);
        };
      },
    }),
  });
}

/**
 * An `Env` that runs `competitor` immediately before the first statement whose
 * SQL contains `marker` — i.e. exactly in the window between this request's
 * read and its write.
 *
 * Deterministic on purpose. A `Promise.all` of two requests exercises whatever
 * interleaving the runtime happens to pick, which is worth asserting on but is
 * not evidence that a specific compare-and-set branch ran.
 */
function raceBefore(marker: string, competitor: () => Promise<void>): Env {
  const db = env.DB;
  let armed = true;
  const wrap = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop) {
        if (prop === "bind") {
          return (...args: unknown[]) => wrap(target.bind(...args));
        }
        if (prop === "run") {
          return async () => {
            if (armed) {
              armed = false;
              await competitor();
            }
            return target.run();
          };
        }
        return passThrough(target, prop);
      },
    });
  return e({
    DB: new Proxy(db, {
      get(target, prop) {
        if (prop !== "prepare") return passThrough(target, prop);
        return (sql: string) => {
          const stmt = target.prepare(sql);
          return armed && sql.includes(marker) ? wrap(stmt) : stmt;
        };
      },
    }),
  });
}

/** The scope compare-and-set in `handleScope`, named for `raceBefore`. */
const SCOPE_CAS = "UPDATE devices SET scopes";

beforeEach(async () => {
  await resetSchema();
  for (const id of [OWNER, OTHER]) {
    await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?1, ?2, ?3)")
      .bind(id, `${id}@example.com`, nowSec())
      .run();
  }
});

/* -------------------------------------------------------------------------- */
/* Who may call any of this (R9, AE6)                                          */
/* -------------------------------------------------------------------------- */

describe("the config surface is session-only", () => {
  it("answers 401 with no credential at all", async () => {
    const res = await call(req("/v1/config/devices"));
    expect(res.status).toBe(401);
  });

  it("refuses a device token outright — a board cannot enumerate its account's boards", async () => {
    const cookie = await session(OWNER);
    const { token } = await pairDevice(cookie);
    const res = await call(req("/v1/config/devices", { bearer: token }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "forbidden: device tokens are not accepted on this route",
    });
  });

  it("refuses a board's attempt to unpair or re-scope a device", async () => {
    const cookie = await session(OWNER);
    const { deviceId, token } = await pairDevice(cookie);
    const patched = await call(
      req(`/v1/config/devices/${deviceId}`, {
        method: "PATCH",
        bearer: token,
        body: { scope: "read:fix", granted: true },
      }),
    );
    const deleted = await call(
      req(`/v1/config/devices/${deviceId}`, { method: "DELETE", bearer: token }),
    );
    expect(patched.status).toBe(403);
    expect(deleted.status).toBe(403);
    expect(await storedScopes(deviceId)).toEqual([...DEFAULT_DEVICE_SCOPES]);
  });

  it("applies the CSRF gate to state changes, so a cross-site page cannot unpair a board", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);

    const noHeader = await grant(cookie, deviceId, "read:fix", true, { csrf: null });
    const crossOrigin = await call(
      req(`/v1/config/devices/${deviceId}`, {
        method: "DELETE",
        cookie,
        origin: "https://evil.example",
      }),
    );

    expect(noHeader.status).toBe(403);
    expect(crossOrigin.status).toBe(403);
    expect(await storedScopes(deviceId)).toEqual([...DEFAULT_DEVICE_SCOPES]);
    expect(await listDevices(cookie)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The list itself (R18)                                                       */
/* -------------------------------------------------------------------------- */

describe("the device list (R18)", () => {
  it("shows name, firmware version, pairing time, last-seen and scopes", async () => {
    const cookie = await session(OWNER);
    const { deviceId, token } = await pairDevice(cookie, {
      device_name: "Kitchen board",
      fw_version: "1.4.0",
    });
    // A device request is what stamps last_used_at; before one, last-seen is
    // honestly null rather than a fabricated pairing time.
    expect((await listDevices(cookie))[0].last_seen).toBeNull();

    expect(await deviceAuth(token, "read:config")).toBe("allowed");

    const [device] = await listDevices(cookie);
    expect(device.id).toBe(deviceId);
    expect(device.device).toEqual({
      name: "Kitchen board",
      fw_version: "1.4.0",
      untrusted: true,
    });
    expect(device.paired_at).toBeGreaterThan(0);
    expect(device.last_seen).toBeGreaterThan(0);
  });

  it("shows a freshly claimed device with read:fix OFF (R9)", async () => {
    const cookie = await session(OWNER);
    await pairDevice(cookie);
    const [device] = await listDevices(cookie);
    expect(device.scopes).toEqual([...DEFAULT_DEVICE_SCOPES]);
    expect(device.scopes).not.toContain("read:fix");
  });

  it("is empty for an account with no devices, rather than an error", async () => {
    expect(await listDevices(await session(OWNER))).toEqual([]);
  });

  it("never carries a cache header that would leave an account's list in a proxy", async () => {
    const cookie = await session(OWNER);
    await pairDevice(cookie);
    const res = await call(req("/v1/config/devices", { cookie }));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toBe("application/json");
    // Device-supplied text rides in this body; a sniffing browser is the one
    // way JSON becomes markup.
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("returns device-supplied metadata verbatim and untrusted — escaping is the renderer's job", async () => {
    const cookie = await session(OWNER);
    const hostile = '<img src=x onerror="alert(1)">';
    await pairDevice(cookie, { device_name: hostile, fw_version: "</script><b>1.0" });
    const [device] = await listDevices(cookie);
    // Verbatim: the API must not half-escape, which would leave the UI unable
    // to tell an escaped payload from a device that really is called `&lt;`.
    expect(device.device.name).toBe(hostile);
    expect(device.device.fw_version).toBe("</script><b>1.0");
    // ...and it must say so on the wire, so the renderer cannot mistake it for
    // a fact the server checked.
    expect(device.device.untrusted).toBe(true);
  });

  it("appends the slid session cookie, so reading the list does not shorten the session", async () => {
    const cookie = await session(OWNER);
    // Push the row past its half-life; `validateSession` slides it in D1, and
    // the browser only learns about that from a re-issued cookie.
    await env.DB.prepare("UPDATE sessions SET expires_at = ?1 WHERE token_hash = ?2")
      .bind(nowSec() + 60, await hashToken(cookie))
      .run();
    const res = await call(req("/v1/config/devices", { cookie }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain(`${SESSION_COOKIE}=${cookie}`);
  });
});

/* -------------------------------------------------------------------------- */
/* Tenancy: invisible AND unmodifiable are two properties                      */
/* -------------------------------------------------------------------------- */

describe("another account's devices", () => {
  it("are invisible in the list", async () => {
    const mine = await session(OWNER);
    const theirs = await session(OTHER);
    await pairDevice(theirs, { device_name: "Their board" });
    const { deviceId } = await pairDevice(mine, { device_name: "My board" });

    const listed = await listDevices(mine);
    expect(listed.map((d) => d.id)).toEqual([deviceId]);
    expect(listed.map((d) => d.device.name)).toEqual(["My board"]);
  });

  it("cannot be re-scoped — a 404, and the row is untouched", async () => {
    const theirs = await session(OTHER);
    const { deviceId, token } = await pairDevice(theirs);

    const res = await grant(await session(OWNER), deviceId, "read:fix", true);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no such device" });
    // The write half of the assertion: a 404 that had already changed the row
    // would be the worse bug, and the response alone cannot tell them apart.
    expect(await storedScopes(deviceId)).toEqual([...DEFAULT_DEVICE_SCOPES]);
    expect(await deviceAuth(token, "read:fix")).not.toBe("allowed");
  });

  it("cannot be unpaired — a 404, and the board keeps working", async () => {
    const theirs = await session(OTHER);
    const { deviceId, token } = await pairDevice(theirs);
    await seedFix(deviceId);

    const res = await call(
      req(`/v1/config/devices/${deviceId}`, { method: "DELETE", cookie: await session(OWNER) }),
    );

    expect(res.status).toBe(404);
    expect(await deviceAuth(token, "read:config")).toBe("allowed");
    expect(await listDevices(theirs)).toHaveLength(1);
    // Unpair's other write must not have happened either.
    expect(await fixCount(deviceId)).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Scope grants (R9)                                                           */
/* -------------------------------------------------------------------------- */

describe("granting and revoking a scope", () => {
  it("takes effect on the device's next request, in both directions", async () => {
    const cookie = await session(OWNER);
    const { deviceId, token } = await pairDevice(cookie);

    // Before: the grant does not exist, so the board is refused.
    const before = await deviceAuth(token, "read:fix");
    expect(before).not.toBe("allowed");
    expect((before as Response).status).toBe(403);

    const granted = await grant(cookie, deviceId, "read:fix", true);
    expect(granted.status).toBe(200);
    expect((await granted.json<DeviceEntry>()).scopes).toContain("read:fix");
    expect(await deviceAuth(token, "read:fix")).toBe("allowed");

    const revoked = await grant(cookie, deviceId, "read:fix", false);
    expect(revoked.status).toBe(200);
    expect((await revoked.json<DeviceEntry>()).scopes).not.toContain("read:fix");
    const after = await deviceAuth(token, "read:fix");
    expect(after).not.toBe("allowed");
    expect((after as Response).status).toBe(403);
  });

  it("moves one scope and leaves the others alone", async () => {
    const cookie = await session(OWNER);
    const { deviceId, token } = await pairDevice(cookie);

    await grant(cookie, deviceId, "read:departures", false);

    expect(await storedScopes(deviceId)).toEqual(["read:config"]);
    expect(await deviceAuth(token, "read:config")).toBe("allowed");
    expect(await deviceAuth(token, "read:departures")).not.toBe("allowed");
  });

  it("stores scopes in a canonical order whatever order the toggles arrive in", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    for (const scope of ["read:config", "read:departures", "read:fix"]) {
      await grant(cookie, deviceId, scope, false);
    }
    for (const scope of ["read:fix", "read:config", "read:departures"]) {
      await grant(cookie, deviceId, scope, true);
    }
    const row = await env.DB.prepare("SELECT scopes FROM devices WHERE id = ?1")
      .bind(deviceId)
      .first<{ scopes: string }>();
    expect(row?.scopes).toBe("read:departures,read:config,read:fix");
  });

  it("is idempotent — granting twice is not a conflict", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    const first = await grant(cookie, deviceId, "read:fix", true);
    const second = await grant(cookie, deviceId, "read:fix", true);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await storedScopes(deviceId)).toEqual([
      "read:departures",
      "read:config",
      "read:fix",
    ]);
  });

  it("refuses a scope it does not know rather than silently granting nothing", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    const res = await grant(cookie, deviceId, "write:everything", true);
    expect(res.status).toBe(400);
    expect(await storedScopes(deviceId)).toEqual([...DEFAULT_DEVICE_SCOPES]);
  });

  it("refuses a comma-joined scope rather than acting on the one it recognizes", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    // Each of these names more than one thing, or names one thing twice. The
    // move the server would have made is unambiguous — nothing widens — but
    // the *request* is not, and answering it 200 tells a client its exact
    // wording was understood.
    for (const scope of ["bogus,read:fix", "read:fix,read:fix", "read:fix,read:config", ""]) {
      const res = await grant(cookie, deviceId, scope, true);
      expect(res.status).toBe(400);
    }
    expect(await storedScopes(deviceId)).toEqual([...DEFAULT_DEVICE_SCOPES]);
  });

  it("refuses a request that does not say whether it is granting or revoking", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    const res = await call(
      req(`/v1/config/devices/${deviceId}`, {
        method: "PATCH",
        cookie,
        body: { scope: "read:fix" },
      }),
    );
    expect(res.status).toBe(400);
    expect(await storedScopes(deviceId)).toEqual([...DEFAULT_DEVICE_SCOPES]);
  });

  it("refuses a scope change on a device that has been unpaired", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    await call(req(`/v1/config/devices/${deviceId}`, { method: "DELETE", cookie }));
    const res = await grant(cookie, deviceId, "read:fix", true);
    expect(res.status).toBe(404);
    expect(await storedScopes(deviceId)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Revocation reaches the stored fix (R9, AE6d — stored-state half)            */
/* -------------------------------------------------------------------------- */

describe("revoking read:fix clears the position already delivered", () => {
  it("deletes the stored fix when the grant is turned off", async () => {
    const cookie = await session(OWNER);
    const { deviceId, token } = await pairDevice(cookie);
    await grant(cookie, deviceId, "read:fix", true);
    await seedFix(deviceId);
    expect(await fixCount(deviceId)).toBe(1);

    const res = await grant(cookie, deviceId, "read:fix", false);

    expect(res.status).toBe(200);
    // Both halves of "immediate on both sides" (R9): the grant is gone from the
    // credential the board presents...
    expect(await deviceAuth(token, "read:fix")).not.toBe("allowed");
    // ...and so is the row it would otherwise still be reading.
    expect(await fixCount(deviceId)).toBe(0);
  });

  it("leaves other devices' fixes alone", async () => {
    const cookie = await session(OWNER);
    const kitchen = await pairDevice(cookie, { device_name: "Kitchen" });
    const hallway = await pairDevice(cookie, { device_name: "Hallway" });
    for (const device of [kitchen, hallway]) {
      await grant(cookie, device.deviceId, "read:fix", true);
      await seedFix(device.deviceId);
    }

    await grant(cookie, kitchen.deviceId, "read:fix", false);

    expect(await fixCount(kitchen.deviceId)).toBe(0);
    expect(await fixCount(hallway.deviceId)).toBe(1);
    expect(await deviceAuth(hallway.token, "read:fix")).toBe("allowed");
  });

  it("reaps a fix left behind by an earlier failed revocation", async () => {
    // The grant is already off and a row exists anyway — the state a revocation
    // that half-completed leaves behind. Turning the toggle off again has to
    // finish the job rather than short-circuit on "nothing to change".
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    await seedFix(deviceId);
    const res = await grant(cookie, deviceId, "read:fix", false);
    expect(res.status).toBe(200);
    expect(await fixCount(deviceId)).toBe(0);
  });

  it("does not clear the fix when a different scope is revoked", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    await grant(cookie, deviceId, "read:fix", true);
    await seedFix(deviceId);
    await grant(cookie, deviceId, "read:departures", false);
    expect(await fixCount(deviceId)).toBe(1);
  });

  /**
   * AE6d's read-side half, and it is **not implemented here**: "the device's
   * next /v1/locate and /v1/nearby resolve without the phone provider" needs a
   * phone provider in the chain, which is U8 (`locate.ts` today resolves WiFi →
   * unknown and has no per-credential context at all). Writing a passing test
   * for it now would mean asserting that a provider which does not exist did
   * not run — vacuously green, and green again on the day U8 wires it in
   * wrongly. Tracked in beads as the U8 acceptance for AE6d.
   */
  it.todo("AE6d read side: the locate chain skips the phone provider once the grant is gone (U8)");
});

/* -------------------------------------------------------------------------- */
/* Two tabs at once — the compare-and-set branches                             */
/* -------------------------------------------------------------------------- */

describe("a scope change that loses the compare-and-set", () => {
  it("still clears the fix when the winner asked for the same revocation", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    await grant(cookie, deviceId, "read:fix", true);
    await seedFix(deviceId);

    const environment = raceBefore(SCOPE_CAS, async () => {
      await grant(cookie, deviceId, "read:fix", false);
      // Re-seeded after the winner's own clear, so what this asserts is that
      // *this* request cleared — not that somebody did. Leaning on the
      // winner's second write is precisely the coupling being tested for.
      await seedFix(deviceId);
    });

    const res = await grant(cookie, deviceId, "read:fix", false, {}, environment);

    expect(res.status).toBe(200);
    expect((await res.json<DeviceEntry>()).scopes).not.toContain("read:fix");
    expect(await fixCount(deviceId)).toBe(0);
  });

  it("answers 409 and applies nothing when the concurrent change was a different one", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    await grant(cookie, deviceId, "read:fix", true);
    await seedFix(deviceId);

    const environment = raceBefore(SCOPE_CAS, async () => {
      await grant(cookie, deviceId, "read:departures", false);
    });

    const res = await grant(cookie, deviceId, "read:fix", false, {}, environment);

    expect(res.status).toBe(409);
    // The revocation did not happen, so the fix it would have taken with it is
    // still there — a 409 that had half-applied would be the worse answer.
    expect(await storedScopes(deviceId)).toEqual(["read:config", "read:fix"]);
    expect(await fixCount(deviceId)).toBe(1);
  });

  it("ends in one state when two tabs revoke the same scope at once", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    await grant(cookie, deviceId, "read:fix", true);
    await seedFix(deviceId);

    const [first, second] = await Promise.all([
      grant(cookie, deviceId, "read:fix", false),
      grant(cookie, deviceId, "read:fix", false),
    ]);

    // Both asked for what the row now holds, so neither is a conflict.
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await storedScopes(deviceId)).not.toContain("read:fix");
    expect(await fixCount(deviceId)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Unpair (R18)                                                                */
/* -------------------------------------------------------------------------- */

describe("unpairing a device", () => {
  it("revokes the credential — the board's next call is a 401", async () => {
    const cookie = await session(OWNER);
    const { deviceId, token } = await pairDevice(cookie);
    expect(await deviceAuth(token, "read:config")).toBe("allowed");

    const res = await call(req(`/v1/config/devices/${deviceId}`, { method: "DELETE", cookie }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: deviceId });
    const after = await deviceAuth(token, "read:config");
    expect(after).not.toBe("allowed");
    expect((after as Response).status).toBe(401);
    // The same 401 a token that never existed gets: nothing in the answer says
    // "this one used to be real".
    expect(await (after as Response).json()).toEqual({ error: "unauthorized" });
  });

  it("clears the stored fix, exactly as revoking read:fix does", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    await grant(cookie, deviceId, "read:fix", true);
    await seedFix(deviceId);

    await call(req(`/v1/config/devices/${deviceId}`, { method: "DELETE", cookie }));

    expect(await fixCount(deviceId)).toBe(0);
  });

  it("empties the scope list as well as setting revoked_at", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    await grant(cookie, deviceId, "read:fix", true);

    await call(req(`/v1/config/devices/${deviceId}`, { method: "DELETE", cookie }));

    const row = await env.DB.prepare("SELECT scopes, revoked_at FROM devices WHERE id = ?1")
      .bind(deviceId)
      .first<{ scopes: string; revoked_at: number | null }>();
    expect(row?.revoked_at).toBeGreaterThan(0);
    expect(row?.scopes).toBe("");
  });

  it("takes the device out of the list", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    await call(req(`/v1/config/devices/${deviceId}`, { method: "DELETE", cookie }));
    expect(await listDevices(cookie)).toEqual([]);
  });

  it("reaps a fix stranded by an unpair whose clear failed", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    await grant(cookie, deviceId, "read:fix", true);
    await seedFix(deviceId);

    // The revoke lands and the clear throws — the grant is gone, the position
    // is not, and the user has already been told it was deleted.
    await expect(
      call(
        req(`/v1/config/devices/${deviceId}`, { method: "DELETE", cookie }),
        failingFixDelete(),
      ),
    ).rejects.toThrow();
    expect(await fixCount(deviceId)).toBe(1);

    // Every other path to that row is now closed: it is out of the list, and a
    // scope toggle 404s on `revoked_at IS NULL` before it reaches the clear.
    expect(await listDevices(cookie)).toEqual([]);
    expect((await grant(cookie, deviceId, "read:fix", false)).status).toBe(404);
    expect(await fixCount(deviceId)).toBe(1);

    // So the repeat unpair has to be the reaper — behind the same 404, which
    // says nothing new about a device the caller already owns.
    const repeat = await call(req(`/v1/config/devices/${deviceId}`, { method: "DELETE", cookie }));
    expect(repeat.status).toBe(404);
    expect(await fixCount(deviceId)).toBe(0);
  });

  it("answers the same 404 on a repeat, an unknown id, and a malformed one", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    const first = await call(req(`/v1/config/devices/${deviceId}`, { method: "DELETE", cookie }));
    const repeat = await call(req(`/v1/config/devices/${deviceId}`, { method: "DELETE", cookie }));
    const unknown = await call(req("/v1/config/devices/dev_nope", { method: "DELETE", cookie }));

    expect(first.status).toBe(200);
    expect(repeat.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await repeat.json()).toEqual(await unknown.json());
  });
});

/* -------------------------------------------------------------------------- */
/* The seam itself                                                             */
/* -------------------------------------------------------------------------- */

describe("clearFix (the relay seam's revocation half)", () => {
  it("removes the row and reports that it did", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    await seedFix(deviceId);
    expect(await clearFix(e(), deviceId)).toBe(true);
    expect(await fixCount(deviceId)).toBe(0);
  });

  it("is a no-op on a device with no fix, not an error", async () => {
    const cookie = await session(OWNER);
    const { deviceId } = await pairDevice(cookie);
    expect(await clearFix(e(), deviceId)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                    */
/* -------------------------------------------------------------------------- */

describe("dispatch", () => {
  it("404s an unknown path and an unsupported method, before authenticating", async () => {
    const cookie = await session(OWNER);
    const unknown = await call(req("/v1/config/nothing", { cookie }));
    const wrongMethod = await call(
      req("/v1/config/devices", { method: "DELETE", cookie }),
    );
    expect(unknown.status).toBe(404);
    expect(wrongMethod.status).toBe(404);
  });

  it("404s a device id with malformed percent-encoding", async () => {
    const res = await call(
      req("/v1/config/devices/%E0%A4%A", { method: "DELETE", cookie: await session(OWNER) }),
    );
    expect(res.status).toBe(404);
  });
});
