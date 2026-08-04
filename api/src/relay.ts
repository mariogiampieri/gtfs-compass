/**
 * relay.ts — the one seam that owns `device_fixes` (Phase 5 plan, U7;
 * requirements R11, R13, R14).
 *
 * Four exported functions and no other way in:
 *
 *   `putFixForUser`         the account-scoped fan-out write (R11)
 *   `getFix`                the per-device read the locate chain consumes (R13)
 *   `clearFix`              revocation's other half (R9), shipped early by U10
 *   `purgeFixesOlderThan`   one bounded batch for retention's sweep (R20)
 *
 * The plan's Definition of Done makes it a shipped property that **no SQL
 * touches `device_fixes` outside this file**, which is what keeps the
 * documented D1→Durable-Object upgrade a three-function change with no data
 * migration. `purgeFixesOlderThan` is the fourth name only because retention's
 * sweep is a legitimate second reason to write to this table and it predates
 * this file; expressing it as a bounded batch rather than as an exported SQL
 * string is what keeps it a *seam* call and not SQL wearing a function's name.
 *
 * Shape is RPC, deliberately — `(env, …) => Promise<…>`, never an exported
 * `D1PreparedStatement`. A statement builder would let a caller batch the
 * write into its own transaction, which is tempting (see `routes/config.ts`,
 * where revoke-then-clear is two writes) and is exactly the coupling that would
 * make the storage swap a rewrite of every call site rather than a rewrite of
 * this file.
 *
 * Two properties are structural here rather than remembered per caller:
 *
 *  1. **The write takes a user, never a device.** R11's post names no device;
 *     the session identifies the account and the `read:fix` grant identifies
 *     the recipients. There is no parameter for a caller to point at somebody
 *     else's board, so the plan's primary IDOR surface does not exist to be
 *     tested for — it is absent from the signature.
 *
 *  2. **Freshness is a state, not an arithmetic exercise left to callers**
 *     (R13). `getFix` returns `quality` and `ageS` alongside the position, so
 *     "a fix 4 minutes old" cannot be rendered as a current position by a
 *     caller that forgot to subtract. Absence stays a third thing: `null`.
 *
 * **The accuracy gate is deliberately absent** (R12). Whatever the phone
 * reports is stored, `accuracy_m` and all; the provider chain gates it at read
 * time, in one place, and a gated fix falls through to the next provider.
 * Gating here would make AE7's read-side scenario unreachable and turn U8's
 * phone gate into dead code.
 *
 * **Residual, tracked and deliberately not papered over:** R9's other half —
 * "the locate chain skips the phone provider unless the resolved credential
 * currently carries the scope" — is U8's, and cannot exist yet because the
 * chain has no phone provider to skip (`locate.ts` resolves WiFi → unknown).
 * So this file closes the *stored-state* half of AE6d and nothing more: after a
 * revocation there is no row for a future chain to read, and the fan-out
 * predicate below will not write one back. The read-side gate is a separate
 * control for a separate failure (a fix written between the revocation and the
 * delete, or by a fan-out that raced it), and U8 owns it.
 */

import { parseScopes, type Scope } from "./auth";

/** The grant that is also the relay's fan-out control (R9, R11). */
const FIX_SCOPE: Scope = "read:fix";

/**
 * How old a relayed fix may be and still be a *position* — 120 seconds (plan
 * KTD). Long enough to survive a phone screen-lock, since mobile browsers
 * suspend `watchPosition` and real traffic is bursty rather than a heartbeat;
 * short enough that a walking user's position stays honest.
 *
 * A constant rather than an env var on purpose: it is half of a wire contract
 * (`quality` on the locate response, R13) and a deployment that quietly widened
 * it would be relabelling stale positions as current, which is the one thing
 * the discriminator exists to prevent.
 */
export const FIX_HORIZON_S = 120;

/**
 * How old a relayed fix may be and still be served **at all** — 4 hours. Past
 * it `getFix` reports absence, the chain falls through, and the device shows
 * the `{known: false}` screen it already has a design for.
 *
 * The ceiling exists because the `last_known` label is not a control. It is an
 * optional appended field (AE9), so every consumer is structurally entitled to
 * ignore it — and the shipped firmware does: `firmware/main/model.c` reads
 * `lat`/`lon`/`accuracy` and nothing else. Meanwhile the *server* does the
 * arithmetic the label was supposed to caveat: `/v1/nearby` sorts stops,
 * computes walk times and adds entry buffers from whatever position it is
 * handed, and answers with the phone's original `accuracy` — so a fix from
 * yesterday renders as a confident "leave in 3 min" for a platform the user is
 * nowhere near. Labelling it is constraint #4 failing in the direction it
 * exists to prevent; bounding it is the control.
 *
 * Four hours, not minutes and not days. The relay's job is to place a *board*,
 * which is a fixed installation, from a phone that is usually in the same
 * building, and the config UI posts on interaction rather than as a heartbeat —
 * so a gap of hours across one visit is ordinary and a tight ceiling would make
 * the relay useless for the case it exists to rescue (a BSSID set BeaconDB
 * cannot place). Four hours is longer than a meal, a film or an errand and
 * shorter than a workday, a night's sleep or a long flight — the absences after
 * which "still where the phone last was" stops being the default assumption.
 * It does not eliminate the risk inside the window; it bounds it, where
 * retention's 14-day sweep was the only bound before.
 *
 * A constant, like the horizon, and for the same reason: it decides what the
 * API is willing to vouch for.
 */
export const FIX_LAST_KNOWN_MAX_AGE_S = 4 * 60 * 60;

/** Inside the horizon: a position, usable as *where the user is*. */
export const QUALITY_CURRENT = "current";
/** Past it: last-known, rendered with its age and never silently used as now. */
export const QUALITY_LAST_KNOWN = "last_known";

export type FixQuality = typeof QUALITY_CURRENT | typeof QUALITY_LAST_KNOWN;

/** What a phone posts. Epoch **seconds**, like every other timestamp in D1. */
export interface PostedFix {
  lat: number;
  lon: number;
  /** As reported, ungated (R12). Null when the source could not say. */
  accuracyM?: number | null;
  /** When the phone fixed the position — not when the Worker heard about it. */
  capturedAt: number;
}

/** What `getFix` hands its caller: the row, plus the freshness R13 asks for. */
export interface StoredFix {
  deviceId: string;
  lat: number;
  lon: number;
  accuracyM: number | null;
  capturedAt: number;
  receivedAt: number;
  /** Seconds since capture, floored at 0 — never negative on a skewed clock. */
  ageS: number;
  quality: FixQuality;
}

/** What one fan-out did. `targeted` and `written` differ only by the refinement below. */
export interface FanOutResult {
  /** Devices of this user holding `read:fix` and not revoked (R11's predicate). */
  targeted: number;
  /** Of those, the ones this fix actually replaced the stored position on. */
  written: number;
}

function nowS(): number {
  return Math.floor(Date.now() / 1000);
}

/* -------------------------------------------------------------------------- */
/* The write (R11, R14)                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Fan one posted fix out to every device of `userId` that holds `read:fix` and
 * is not revoked. Latest-wins, never queued (R14): one row per device, replaced
 * in place.
 *
 * **`revoked_at IS NULL` is half the predicate, not a tidiness check.** Unpair
 * revokes the row and empties `scopes`, but those are two columns and only one
 * of them is load-bearing on the read path; a fan-out testing the grant alone
 * would re-create the fix `clearFix` had just removed on the very next post,
 * quietly undoing a revocation the user was told had taken effect. Both halves,
 * always — and `idx_devices_user_revoked` is on exactly those two columns.
 *
 * **The scope test is applied in TypeScript, over a set SQL has already
 * narrowed, and not as a SQL string match.** `devices.scopes` is a comma-joined
 * list, so `scopes LIKE '%read:fix%'` would match a hypothetical `read:fixture`
 * — the classic substring-in-a-list trap. The boundary-safe SQL spelling
 * exists (`',' || scopes || ',' LIKE '%,read:fix,%'`), but writing it here
 * would put a *second* definition of "holds this grant" in the codebase,
 * beside `parseScopes`, which already splits on commas, trims, and drops
 * unknown entries so an unrecognized scope can never widen a grant. Two
 * implementations of one rule is how they drift. The indexable halves —
 * `user_id`, `revoked_at` — stay in SQL, which is what the migration's index
 * comment describes; a user has a handful of devices, so the residual filter is
 * over a handful of rows.
 *
 * **Latest means latest *capture*, not latest write.** An update whose incoming
 * `captured_at` is strictly older than the stored one is refused outright: posts
 * retry and reorder, and without that test an equally accurate replay walked
 * `captured_at` backwards, after which `getFix` relabelled the older position
 * `current` and the board rewound. The accuracy refinement below covers only
 * the accuracy dimension and cannot see this.
 *
 * **The refinement on latest-wins:** a newly-arrived fix does not replace a
 * strictly more accurate one that is still inside the horizon, so a momentary
 * coarse reading (a phone that briefly falls back to cell-tower accuracy) can't
 * erase the good position the device is about to read. An incomparable pair —
 * either side's accuracy unknown — is not "strictly more accurate", so it falls
 * through to plain latest-wins. Once the stored fix ages past the horizon it is
 * no longer a position at all (R13) and anything current outranks it — and
 * "past the horizon" is spelled the same way here as in `getFix`, inclusive at
 * exactly `FIX_HORIZON_S`, because it is one rule and the two sides disagreeing
 * meant the read layer served a position the write layer had already written
 * off.
 *
 * **`captured_at` is clamped to receipt.** The ingress route tolerates 60 s of
 * forward clock skew, and every freshness question in this file is asked of
 * `captured_at`, so an ordinary fast phone clock would stretch a 120 s horizon
 * to 180 real seconds — the discriminator widened by a client, with no
 * deployment change, which is exactly what the constant's comment says must not
 * happen. Clamping at the one moment both numbers are known keeps a single
 * freshness derivation downstream (age, the horizon, capture ordering, the
 * retention cutoff) instead of a `min()` every reader has to remember, and it
 * makes `captured_at <= received_at` an invariant of the table. A fix can only
 * ever be *reported* as older than it was, never newer.
 *
 * The whole fan-out is one `batch()`, so a two-device account cannot end up
 * with one device holding this fix and the other holding the last one.
 *
 * @param nowSec injectable clock; also the row's `received_at`.
 */
export async function putFixForUser(
  env: Env,
  userId: string,
  fix: PostedFix,
  nowSec: number = nowS(),
): Promise<FanOutResult> {
  const { results } = await env.DB.prepare(
    "SELECT id, scopes FROM devices WHERE user_id = ?1 AND revoked_at IS NULL",
  )
    .bind(userId)
    .all<{ id: string; scopes: string | null }>();

  const recipients = results.filter((row) => parseScopes(row.scopes).includes(FIX_SCOPE));
  // No devices is a normal outcome, not an error: a user who has granted the
  // scope nowhere is simply not relaying, and the phone gets the same 200 it
  // would get otherwise — telling it which of the account's boards hold a grant
  // is not the posting client's business.
  if (recipients.length === 0) return { targeted: 0, written: 0 };

  const accuracyM = fix.accuracyM ?? null;
  const capturedAt = Math.min(fix.capturedAt, nowSec);
  const horizonFloor = nowSec - FIX_HORIZON_S;
  const statements = recipients.map((row) =>
    env.DB.prepare(
      `INSERT INTO device_fixes (device_id, lat, lon, accuracy_m, captured_at, received_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (device_id) DO UPDATE SET
         lat         = excluded.lat,
         lon         = excluded.lon,
         accuracy_m  = excluded.accuracy_m,
         captured_at = excluded.captured_at,
         received_at = excluded.received_at
       WHERE excluded.captured_at >= device_fixes.captured_at
         AND NOT (device_fixes.captured_at >= ?7
                  AND device_fixes.accuracy_m IS NOT NULL
                  AND excluded.accuracy_m IS NOT NULL
                  AND device_fixes.accuracy_m < excluded.accuracy_m)`,
    ).bind(row.id, fix.lat, fix.lon, accuracyM, capturedAt, nowSec, horizonFloor),
  );

  const written = (await env.DB.batch(statements)).reduce(
    (sum, result) => sum + (result.meta?.changes ?? 0),
    0,
  );
  return { targeted: recipients.length, written };
}

/* -------------------------------------------------------------------------- */
/* The read (R13)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * This device's stored fix, or `null`.
 *
 * **Three states, not two.** `null` means no phone has ever posted for this
 * board (or its fix was cleared) and the caller must fall through to the rest
 * of the chain; a row with `quality: "current"` is a position; a row with
 * `quality: "last_known"` is a place the user was, carrying its age. R13 is
 * explicit that the last-known state is a *distinct state* rather than a fix
 * with an old timestamp, and deriving it here rather than returning a bare row
 * is what stops each caller re-deriving it — U8 renders it, U16 clears it, and
 * neither should own a copy of the 120-second rule.
 *
 * **A row past `FIX_LAST_KNOWN_MAX_AGE_S` is the first state, not the third.**
 * It is still in the table — retention owns deletion, on its own 14-day
 * schedule, for its own reasons — but this function will not serve it, so the
 * chain falls through as if nothing had ever been posted. Absence is the only
 * signal a caller cannot ignore, and the alternative was `/v1/nearby` composing
 * a departures board out of a position from last week and stamping it with the
 * phone's original 8-metre accuracy.
 *
 * No accuracy gate, no grant check. Both belong to the chain (R12, R9): this
 * function answers "what is stored", and a device that may not read it must be
 * refused before it gets here.
 *
 * `captured_at` is clamped to receipt on write, so age is measured against a
 * number the server observed rather than one a client asserted; the floor at 0
 * stays as a second belt for rows this file did not write.
 */
export async function getFix(
  env: Env,
  deviceId: string,
  nowSec: number = nowS(),
): Promise<StoredFix | null> {
  const row = await env.DB.prepare(
    `SELECT device_id, lat, lon, accuracy_m, captured_at, received_at
       FROM device_fixes WHERE device_id = ?1`,
  )
    .bind(deviceId)
    .first<{
      device_id: string;
      lat: number;
      lon: number;
      accuracy_m: number | null;
      captured_at: number;
      received_at: number;
    }>();
  if (!row) return null;

  const ageS = Math.max(0, nowSec - row.captured_at);
  if (ageS > FIX_LAST_KNOWN_MAX_AGE_S) return null;

  return {
    deviceId: row.device_id,
    lat: row.lat,
    lon: row.lon,
    accuracyM: row.accuracy_m,
    capturedAt: row.captured_at,
    receivedAt: row.received_at,
    ageS,
    quality: ageS <= FIX_HORIZON_S ? QUALITY_CURRENT : QUALITY_LAST_KNOWN,
  };
}

/* -------------------------------------------------------------------------- */
/* Removal — revocation (R9) and retention (R20)                               */
/* -------------------------------------------------------------------------- */

/**
 * Drop this device's stored fix. Idempotent: no row is a normal outcome, not
 * an error — a device that was never granted `read:fix`, or was granted it and
 * never had a phone post one, has nothing to clear.
 *
 * Idempotence is also what makes a *retry* a repair, and callers rely on that.
 * Because the revoke and the clear are two unbatched writes (see above), the
 * second can fail on its own; `routes/config.ts` therefore re-runs this against
 * devices that are already revoked, and against grants that are already off,
 * rather than treating "nothing to change" as "nothing to do".
 *
 * Callers revoke the grant *first* and clear *second*, never the other way
 * round. The order is what closes the window against a concurrent
 * `putFixForUser`, whose fan-out predicate is "this user's devices holding
 * `read:fix` and not revoked" (R11): a fan-out that begins after the revocation
 * selects nothing for this device, so the delete is the last write. Clearing
 * first would leave the grant live for the duration of the delete, and a post
 * landing in that gap would re-create the row that was just removed.
 *
 * @returns whether a row was actually removed — for the caller's logging and
 * for tests that need to tell "cleared" from "there was nothing to clear".
 */
export async function clearFix(env: Env, deviceId: string): Promise<boolean> {
  const result = await env.DB.prepare("DELETE FROM device_fixes WHERE device_id = ?1")
    .bind(deviceId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Delete **one bounded batch** of fixes captured before `cutoffS`, oldest
 * first, and report how many rows went. Retention's sweep (R20) re-runs it
 * until a batch comes back short of `limit` or the invocation's batch budget is
 * spent; the loop, the budget and the bookkeeping stay in `retention.ts`, which
 * is where every other table's phases live.
 *
 * It exists because retention issued its own `DELETE FROM device_fixes` — it
 * was written before this file did — and that one statement was the whole
 * difference between "the storage swap is a rewrite of this file" and "the
 * storage swap is a rewrite of this file plus whatever else grew a query"
 * (bead `gc-x8n.2`). A caller that batches by rows rather than by SQL is a
 * caller a Durable Object implementation can satisfy.
 *
 * The predicate is self-latching, which is what makes a partial run simply a
 * shorter run: a deleted row no longer matches, so the next tick resumes with
 * no cursor to persist. `device_fixes` has no `id` column — `device_id` is the
 * primary key — so the bounded sub-select goes through `rowid`, ordered by
 * `idx_device_fixes_captured_at`.
 *
 * Cutoff is `captured_at`, not `received_at`: the retention window is about how
 * old the *position* is, and a fix relayed late is no less precise for it.
 */
export async function purgeFixesOlderThan(
  env: Env,
  cutoffS: number,
  limit: number,
): Promise<number> {
  const result = await env.DB.prepare(
    `DELETE FROM device_fixes
      WHERE rowid IN (SELECT rowid FROM device_fixes
                       WHERE captured_at < ?1
                       ORDER BY captured_at LIMIT ?2)`,
  )
    .bind(cutoffS, limit)
    .run();
  return result.meta?.changes ?? 0;
}
