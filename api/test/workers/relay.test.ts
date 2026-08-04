import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { formatScopes, type Scope } from "../../src/auth";
import {
  FIX_HORIZON_S,
  FIX_LAST_KNOWN_MAX_AGE_S,
  QUALITY_CURRENT,
  QUALITY_LAST_KNOWN,
  clearFix,
  getFix,
  purgeFixesOlderThan,
  putFixForUser,
} from "../../src/relay";
import { resetSchema } from "./schema";

/**
 * The relay store (U7; R11, R12, R13, R14; AE6b, AE6d, AE7 storage half, AE10
 * clear half).
 *
 * Everything here goes through the seam's own functions — no test reads or
 * writes `device_fixes` with SQL, which is the same discipline the Definition
 * of Done imposes on `src/`. The two exceptions are deliberate and are the only
 * ways to reach states the seam cannot produce: seeding `devices` (pairing is
 * U9's, and driving it here would test pairing) and `DELETE FROM devices` (the
 * cascade test, whose entire subject is what the FK does to a table this file
 * never names).
 *
 * Scope grants are written as the column stores them — comma-joined, through
 * `formatScopes` — rather than hand-spelled, so a test cannot assert against a
 * separator the production parser does not accept.
 */

const OWNER = "usr_owner";
const OTHER = "usr_other";

function e(): Env {
  return env as unknown as Env;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** A paired board. Scopes default to the pairing default: `read:fix` **off**. */
async function seedDevice(
  id: string,
  opts: {
    userId?: string;
    scopes?: Scope[];
    revoked?: boolean;
  } = {},
): Promise<string> {
  const userId = opts.userId ?? OWNER;
  await env.DB.prepare("INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?1, ?2, ?3)")
    .bind(userId, `${userId}@example.test`, nowSec())
    .run();
  await env.DB.prepare(
    `INSERT INTO devices (id, user_id, paired_at, scopes, revoked_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(
      id,
      userId,
      nowSec(),
      formatScopes(opts.scopes ?? ["read:departures", "read:config"]),
      opts.revoked ? nowSec() : null,
    )
    .run();
  return id;
}

/** A board that holds the grant — the ordinary recipient of a fan-out. */
function seedGranted(id: string, userId = OWNER): Promise<string> {
  return seedDevice(id, { userId, scopes: ["read:departures", "read:config", "read:fix"] });
}

/** Platform entrance at Grand Army Plaza, to a metre or so. */
const PRECISE = { lat: 40.6752, lon: -73.971, accuracyM: 8 };
/** The same phone a moment later, fallen back to cell towers. */
const COARSE = { lat: 40.68, lon: -73.98, accuracyM: 900 };

beforeEach(async () => {
  await resetSchema();
});

/* -------------------------------------------------------------------------- */
/* Round trip                                                                  */
/* -------------------------------------------------------------------------- */

describe("put → get", () => {
  it("stores what the phone reported and reads it back as a current position", async () => {
    await seedGranted("dev_kitchen");
    const now = nowSec();

    const result = await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now - 20 }, now);

    expect(result).toEqual({ targeted: 1, written: 1 });
    expect(await getFix(e(), "dev_kitchen", now)).toEqual({
      deviceId: "dev_kitchen",
      lat: PRECISE.lat,
      lon: PRECISE.lon,
      accuracyM: 8,
      capturedAt: now - 20,
      receivedAt: now,
      ageS: 20,
      quality: QUALITY_CURRENT,
    });
  });

  it("stores a 900 m fix ungated — the accuracy gate is read-side only (R12)", async () => {
    // AE7's storage half. Gating here would make the chain's phone gate dead
    // code and the "skipped, and BeaconDB consulted" scenario unreachable.
    await seedGranted("dev_kitchen");
    const now = nowSec();

    await putFixForUser(e(), OWNER, { ...COARSE, capturedAt: now }, now);

    expect(await getFix(e(), "dev_kitchen", now)).toMatchObject({
      accuracyM: 900,
      quality: QUALITY_CURRENT,
    });
  });

  it("records an unreported accuracy as null rather than inventing one", async () => {
    await seedGranted("dev_kitchen");
    const now = nowSec();

    await putFixForUser(e(), OWNER, { lat: 40.7, lon: -74, capturedAt: now }, now);

    expect(await getFix(e(), "dev_kitchen", now)).toMatchObject({ accuracyM: null });
  });
});

/* -------------------------------------------------------------------------- */
/* The fan-out predicate (R11): grant AND not revoked                          */
/* -------------------------------------------------------------------------- */

describe("the fan-out predicate", () => {
  it("writes only to the device holding read:fix (AE6b)", async () => {
    await seedGranted("dev_granted");
    await seedDevice("dev_plain");
    const now = nowSec();

    const result = await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now }, now);

    expect(result).toEqual({ targeted: 1, written: 1 });
    expect(await getFix(e(), "dev_granted", now)).not.toBeNull();
    expect(await getFix(e(), "dev_plain", now)).toBeNull();
  });

  it("writes to every granting device of the account, in one fan-out", async () => {
    await seedGranted("dev_kitchen");
    await seedGranted("dev_hallway");
    const now = nowSec();

    const result = await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now }, now);

    expect(result).toEqual({ targeted: 2, written: 2 });
    expect(await getFix(e(), "dev_kitchen", now)).not.toBeNull();
    expect(await getFix(e(), "dev_hallway", now)).not.toBeNull();
  });

  it("writes nothing, and does not throw, when no device holds the grant", async () => {
    await seedDevice("dev_plain");

    const result = await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: nowSec() });

    expect(result).toEqual({ targeted: 0, written: 0 });
    expect(await getFix(e(), "dev_plain")).toBeNull();
  });

  it("writes nothing for an account with no devices at all", async () => {
    await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?1, ?2, ?3)")
      .bind(OWNER, "owner@example.test", nowSec())
      .run();

    expect(await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: nowSec() })).toEqual({
      targeted: 0,
      written: 0,
    });
  });

  it("skips a revoked device even though its scope list still lists read:fix (AE6d)", async () => {
    // Unpair empties `scopes` *and* sets `revoked_at`; a fan-out testing only
    // the grant would re-create the row `clearFix` just removed the moment the
    // scope write is the half that failed.
    await seedDevice("dev_unpaired", {
      scopes: ["read:departures", "read:config", "read:fix"],
      revoked: true,
    });
    const now = nowSec();

    const result = await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now }, now);

    expect(result).toEqual({ targeted: 0, written: 0 });
    expect(await getFix(e(), "dev_unpaired", now)).toBeNull();
  });

  it("does not re-create a fix that revocation cleared", async () => {
    await seedGranted("dev_kitchen");
    const now = nowSec();
    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now }, now);

    // Revoke as unpair does, then clear — the order `routes/config.ts` uses.
    await env.DB.prepare("UPDATE devices SET revoked_at = ?1, scopes = '' WHERE id = ?2")
      .bind(now, "dev_kitchen")
      .run();
    expect(await clearFix(e(), "dev_kitchen")).toBe(true);

    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now + 1 }, now + 1);

    expect(await getFix(e(), "dev_kitchen", now + 1)).toBeNull();
  });

  it("matches the grant on a whole entry, never on a substring", async () => {
    // `scopes LIKE '%read:fix%'` would match this row. The column is a
    // comma-joined list and `parseScopes` drops what it does not recognize, so
    // an unknown scope can never widen a grant.
    await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?1, ?2, ?3)")
      .bind(OWNER, "owner@example.test", nowSec())
      .run();
    await env.DB.prepare(
      "INSERT INTO devices (id, user_id, paired_at, scopes) VALUES (?1, ?2, ?3, ?4)",
    )
      .bind("dev_lookalike", OWNER, nowSec(), "read:departures,read:fixture")
      .run();

    const result = await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: nowSec() });

    expect(result).toEqual({ targeted: 0, written: 0 });
    expect(await getFix(e(), "dev_lookalike")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Latest-wins, and the one refinement (R14)                                   */
/* -------------------------------------------------------------------------- */

describe("latest-wins", () => {
  it("keeps the newest of a rapid burst, never a queue", async () => {
    await seedGranted("dev_kitchen");
    const now = nowSec();

    for (let i = 0; i < 5; i++) {
      await putFixForUser(
        e(),
        OWNER,
        { lat: 40.6 + i / 1000, lon: -73.9, accuracyM: 10, capturedAt: now - 4 + i },
        now,
      );
    }

    expect(await getFix(e(), "dev_kitchen", now)).toMatchObject({
      lat: 40.604,
      capturedAt: now,
    });
  });

  it("does not let a coarse reading displace a fresher, more accurate one", async () => {
    await seedGranted("dev_kitchen");
    const now = nowSec();
    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now }, now);

    const result = await putFixForUser(e(), OWNER, { ...COARSE, capturedAt: now + 5 }, now + 5);

    // Targeted, and deliberately not written: the device was about to read a
    // good position and a momentary cell-tower fallback must not erase it.
    expect(result).toEqual({ targeted: 1, written: 0 });
    expect(await getFix(e(), "dev_kitchen", now + 5)).toMatchObject({
      lat: PRECISE.lat,
      accuracyM: 8,
    });
  });

  it("lets the coarse reading through once the accurate one is past the horizon", async () => {
    await seedGranted("dev_kitchen");
    const now = nowSec();
    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now }, now);
    const later = now + FIX_HORIZON_S + 1;

    const result = await putFixForUser(e(), OWNER, { ...COARSE, capturedAt: later }, later);

    // Past the horizon the stored row is not a position at all (R13), so
    // anything current outranks it however coarse.
    expect(result).toEqual({ targeted: 1, written: 1 });
    expect(await getFix(e(), "dev_kitchen", later)).toMatchObject({
      lat: COARSE.lat,
      accuracyM: 900,
      quality: QUALITY_CURRENT,
    });
  });

  it("still protects the accurate fix at exactly the horizon", async () => {
    // The write side's "is the stored fix still a position" test and the read
    // side's `current` label are one rule with two spellings; at exactly 120 s
    // the read layer served this row as a usable position while the write layer
    // treated it as expendable.
    await seedGranted("dev_kitchen");
    const now = nowSec();
    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now }, now);
    const atHorizon = now + FIX_HORIZON_S;

    const result = await putFixForUser(e(), OWNER, { ...COARSE, capturedAt: atHorizon }, atHorizon);

    expect(result).toEqual({ targeted: 1, written: 0 });
    expect(await getFix(e(), "dev_kitchen", atHorizon)).toMatchObject({
      accuracyM: 8,
      quality: QUALITY_CURRENT,
    });
  });

  it("refuses a fix captured before the stored one — latest capture, not latest write", async () => {
    // A retried or reordered post. The accuracy refinement covers only the
    // accuracy dimension, so an equally accurate but *older* capture used to
    // overwrite unconditionally and walk `captured_at` backwards, after which
    // `getFix` relabelled the older position `current`.
    await seedGranted("dev_kitchen");
    const now = nowSec();
    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now }, now);

    const result = await putFixForUser(
      e(),
      OWNER,
      { lat: 40.6, lon: -73.9, accuracyM: PRECISE.accuracyM, capturedAt: now - 90 },
      now + 1,
    );

    expect(result).toEqual({ targeted: 1, written: 0 });
    expect(await getFix(e(), "dev_kitchen", now + 1)).toMatchObject({
      lat: PRECISE.lat,
      capturedAt: now,
    });
  });

  it("lets an equally accurate reading through — the guard is strict", async () => {
    await seedGranted("dev_kitchen");
    const now = nowSec();
    await putFixForUser(e(), OWNER, { lat: 40.6, lon: -73.9, accuracyM: 8, capturedAt: now }, now);

    await putFixForUser(
      e(),
      OWNER,
      { lat: 40.7, lon: -73.8, accuracyM: 8, capturedAt: now + 1 },
      now + 1,
    );

    expect(await getFix(e(), "dev_kitchen", now + 1)).toMatchObject({ lat: 40.7 });
  });

  it("lets a more accurate reading through immediately", async () => {
    await seedGranted("dev_kitchen");
    const now = nowSec();
    await putFixForUser(e(), OWNER, { ...COARSE, capturedAt: now }, now);

    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now + 1 }, now + 1);

    expect(await getFix(e(), "dev_kitchen", now + 1)).toMatchObject({ accuracyM: 8 });
  });

  it("falls back to plain latest-wins when the accuracies are not comparable", async () => {
    // An unknown accuracy is not "strictly more accurate" in either direction,
    // so the refinement does not apply and the newer fix simply wins.
    await seedGranted("dev_kitchen");
    const now = nowSec();
    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now }, now);

    await putFixForUser(e(), OWNER, { lat: 41, lon: -73, capturedAt: now + 1 }, now + 1);

    expect(await getFix(e(), "dev_kitchen", now + 1)).toMatchObject({ lat: 41, accuracyM: null });
  });
});

/* -------------------------------------------------------------------------- */
/* Freshness is a state, not a timestamp (R13)                                 */
/* -------------------------------------------------------------------------- */

describe("freshness", () => {
  it("distinguishes absence from staleness", async () => {
    await seedGranted("dev_never");
    await seedGranted("dev_stale");
    const now = nowSec();
    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now - 3600 }, now - 3600);

    // Nothing ever posted for this board: the chain must fall through, which is
    // a different instruction from "render this position with its age".
    await clearFix(e(), "dev_never");

    expect(await getFix(e(), "dev_never", now)).toBeNull();
    expect(await getFix(e(), "dev_stale", now)).toMatchObject({
      quality: QUALITY_LAST_KNOWN,
      ageS: 3600,
    });
  });

  it("reads a fix past the horizon as last-known with its age, not as a position", async () => {
    await seedGranted("dev_kitchen");
    const now = nowSec();
    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now }, now);

    const later = now + FIX_HORIZON_S + 60;
    const fix = await getFix(e(), "dev_kitchen", later);

    expect(fix).toMatchObject({
      quality: QUALITY_LAST_KNOWN,
      ageS: FIX_HORIZON_S + 60,
      lat: PRECISE.lat,
    });
  });

  it("holds the horizon at exactly 120 s — inclusive, then over", async () => {
    await seedGranted("dev_kitchen");
    const now = nowSec();
    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now }, now);

    expect(await getFix(e(), "dev_kitchen", now + FIX_HORIZON_S)).toMatchObject({
      quality: QUALITY_CURRENT,
    });
    expect(await getFix(e(), "dev_kitchen", now + FIX_HORIZON_S + 1)).toMatchObject({
      quality: QUALITY_LAST_KNOWN,
    });
  });

  it("stops serving a last-known fix past the age ceiling", async () => {
    // Nothing consumes `quality` — it is an optional appended field (AE9) and
    // the firmware reads lat/lon/accuracy only — so past the ceiling absence is
    // the only honest answer the chain can act on.
    await seedGranted("dev_kitchen");
    const now = nowSec();
    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now }, now);

    expect(await getFix(e(), "dev_kitchen", now + FIX_LAST_KNOWN_MAX_AGE_S)).toMatchObject({
      quality: QUALITY_LAST_KNOWN,
    });
    expect(await getFix(e(), "dev_kitchen", now + FIX_LAST_KNOWN_MAX_AGE_S + 1)).toBeNull();
  });

  it("measures the horizon from receipt, so a fast phone clock cannot widen it", async () => {
    // Ingress tolerates 60 s of forward skew (`MAX_FIX_SKEW_S`); inheriting it
    // here would make `current` mean 180 real seconds — ~150 m at walking pace,
    // the difference between two subway entrances.
    await seedGranted("dev_kitchen");
    const now = nowSec();

    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now + 60 }, now);

    expect(await getFix(e(), "dev_kitchen", now + FIX_HORIZON_S + 1)).toMatchObject({
      capturedAt: now,
      ageS: FIX_HORIZON_S + 1,
      quality: QUALITY_LAST_KNOWN,
    });
  });

  it("floors the age of a fix from a phone whose clock runs ahead", async () => {
    await seedGranted("dev_kitchen");
    const now = nowSec();

    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now + 300 }, now);

    // A negative age would render as "in 5 minutes"; validating the posted
    // timestamp is the ingress route's job (U14), not the store's.
    expect(await getFix(e(), "dev_kitchen", now)).toMatchObject({
      ageS: 0,
      quality: QUALITY_CURRENT,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Isolation                                                                   */
/* -------------------------------------------------------------------------- */

describe("isolation", () => {
  it("never lets two device ids share state", async () => {
    await seedGranted("dev_kitchen");
    await seedGranted("dev_hallway");
    const now = nowSec();
    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now }, now);

    await clearFix(e(), "dev_kitchen");

    expect(await getFix(e(), "dev_kitchen", now)).toBeNull();
    expect(await getFix(e(), "dev_hallway", now)).toMatchObject({ lat: PRECISE.lat });
  });

  it("cannot reach another account's device — the write names a user, not a device", async () => {
    await seedGranted("dev_mine", OWNER);
    await seedGranted("dev_theirs", OTHER);
    const now = nowSec();

    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now }, now);

    expect(await getFix(e(), "dev_mine", now)).not.toBeNull();
    expect(await getFix(e(), "dev_theirs", now)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Removal — revocation (R9), cascade (AE10), retention (R20)                  */
/* -------------------------------------------------------------------------- */

describe("clearFix", () => {
  it("removes the row and reports that it did", async () => {
    await seedGranted("dev_kitchen");
    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: nowSec() });

    expect(await clearFix(e(), "dev_kitchen")).toBe(true);
    expect(await getFix(e(), "dev_kitchen")).toBeNull();
  });

  it("is a no-op on a device with no fix, not an error", async () => {
    await seedGranted("dev_kitchen");
    expect(await clearFix(e(), "dev_kitchen")).toBe(false);
  });
});

describe("the FK cascade", () => {
  it("takes the fix with the device row (AE10)", async () => {
    await seedGranted("dev_kitchen");
    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: nowSec() });

    // The one place this file writes SQL against another table on purpose: the
    // subject of the test is what `ON DELETE CASCADE` does, which is how
    // account deletion (U16) reaches the relay row for free.
    await env.DB.prepare("DELETE FROM devices WHERE id = ?1").bind("dev_kitchen").run();

    expect(await getFix(e(), "dev_kitchen")).toBeNull();
  });

  it("takes it with the user row too", async () => {
    await seedGranted("dev_kitchen");
    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: nowSec() });

    await env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(OWNER).run();

    expect(await getFix(e(), "dev_kitchen")).toBeNull();
  });
});

describe("purgeFixesOlderThan", () => {
  it("deletes fixes captured before the cutoff and keeps the rest", async () => {
    // Two accounts, so each board can be given its own capture time: one
    // fan-out reaches every granting device of the user it names.
    await seedGranted("dev_old", OWNER);
    await seedGranted("dev_new", OTHER);
    const now = nowSec();
    const cutoff = now - 1000;
    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: cutoff - 1 }, now);
    await putFixForUser(e(), OTHER, { ...PRECISE, capturedAt: now }, now);

    const deleted = await purgeFixesOlderThan(e(), cutoff, 500);

    expect(deleted).toBe(1);
    expect(await getFix(e(), "dev_old", now)).toBeNull();
    expect(await getFix(e(), "dev_new", now)).not.toBeNull();
  });

  it("honors its limit, so retention's batching stays bounded", async () => {
    const now = nowSec();
    for (const id of ["dev_a", "dev_b", "dev_c"]) await seedGranted(id);
    await putFixForUser(e(), OWNER, { ...PRECISE, capturedAt: now - 5000 }, now);

    expect(await purgeFixesOlderThan(e(), now, 2)).toBe(2);
    expect(await purgeFixesOlderThan(e(), now, 2)).toBe(1);
    expect(await purgeFixesOlderThan(e(), now, 2)).toBe(0);
  });
});
