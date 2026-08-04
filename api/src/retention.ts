/**
 * Retention purge (R20, AE11) — the job behind the Cron Trigger in
 * `index.ts`'s `scheduled` export.
 *
 * Two tiers on `locate_log`, because the diagnostic question and the movement
 * history have different half-lives: past `LOCATE_LOG_PRECISE_DAYS` the raw
 * coordinates are nulled while `delta_m`, the accuracies, `bssid_count`,
 * `provider` and `ts` survive — that is what "was BeaconDB good enough at this
 * platform entrance" needs, and it needs no position. Past
 * `LOCATE_LOG_RETENTION_DAYS` the row goes. The same run sweeps the tables
 * nothing else bounds: expired `magic_tokens` and `pairing_codes` (`pair/start`
 * is unauthenticated, so an attacker chooses that table's growth rate),
 * expired `sessions` (closing a browser tab is not a sign-out; nothing but
 * this sweep bounds a table every sign-in mints a row into), yesterday's
 * `auth_budgets` shards — except `scope = 'send:failure'`, retained past its
 * day because it is the only durable signal that a Resend outage happened —
 * and `device_fixes` older than the precise window — a metre-accurate GPS fix
 * is the most precise location this system stores and must not be the one
 * location table with no expiry at all.
 *
 * A Cron Trigger rather than a DO alarm: there is no polling loop and no
 * per-object state here, and the alarm-loop discipline in `do_shared.ts` exists
 * for a different shape.
 */

import { SEND_FAILURE_SCOPE, budgetDay } from "./email";
import { intVar } from "./locate";

/** The single `maintenance_runs.job` key this module owns. */
export const RETENTION_JOB = "retention-purge";

export const DEFAULT_PRECISE_DAYS = 14;
export const DEFAULT_RETENTION_DAYS = 90;
/** Rows per statement. */
export const DEFAULT_BATCH_LIMIT = 500;
/** Statements per phase per invocation. */
export const DEFAULT_MAX_BATCHES = 20;

const DAY_S = 86_400;

export interface PurgeCounts {
  /** locate_log rows that lost their raw coordinates (tier one). */
  locate_coords_nulled: number;
  /** locate_log rows deleted (tier two). */
  locate_deleted: number;
  device_fixes_deleted: number;
  magic_tokens_deleted: number;
  pairing_codes_deleted: number;
  sessions_deleted: number;
  auth_budgets_deleted: number;
}

export interface PurgeResult {
  /** Completion time, epoch seconds — the value "has not run in N days" reads. */
  ran_at: number;
  duration_ms: number;
  /** Summed across every phase; 0 is a legitimate, recorded outcome. */
  rows_affected: number;
  /** A phase hit its batch bound: work remains for the next tick. */
  pending: boolean;
  counts: PurgeCounts;
}

export interface RetentionRun {
  job: string;
  last_run_at: number;
  duration_ms: number;
  rows_affected: number;
  pending: boolean;
  counts: Partial<PurgeCounts>;
}

function preciseDays(env: Env): number {
  return intVar(env.LOCATE_LOG_PRECISE_DAYS, DEFAULT_PRECISE_DAYS);
}

function retentionDays(env: Env): number {
  return intVar(env.LOCATE_LOG_RETENTION_DAYS, DEFAULT_RETENTION_DAYS);
}

/**
 * One phase: the same statement re-run until it comes back short (nothing left
 * to do) or the invocation's batch budget is spent.
 *
 * The bound exists because `locate_log` grows unbounded and D1 has statement
 * and wall-clock limits — a first run against a year of backlog must not be one
 * enormous DELETE. Every statement is written so a partial run is simply a
 * shorter run: the predicates are self-latching (a nulled row no longer matches
 * tier one, a deleted row no longer matches anything), so the next tick resumes
 * from wherever this one stopped with no cursor to persist.
 */
async function purgeInBatches(
  env: Env,
  sql: string,
  binds: unknown[],
  limit: number,
  maxBatches: number,
): Promise<{ rows: number; pending: boolean }> {
  let rows = 0;
  for (let i = 0; i < maxBatches; i++) {
    const result = await env.DB.prepare(sql)
      .bind(...binds, limit)
      .run();
    const changed = result.meta?.changes ?? 0;
    rows += changed;
    if (changed < limit) return { rows, pending: false };
  }
  // A final batch that happened to drain the table exactly reports pending
  // anyway; the cost of that false positive is one no-op run.
  return { rows, pending: true };
}

/**
 * Runs the purge and records it. Throws on a D1 failure *without* recording,
 * deliberately: a run that half-happened must not refresh `last_run_at`, or
 * the alert R20 asks for ("has not run in N days") would report health for a
 * job that is silently failing — which is the exact failure this bookkeeping
 * exists to catch.
 */
export async function runRetentionPurge(env: Env, nowMs: number = Date.now()): Promise<PurgeResult> {
  const startedMs = Date.now();
  const nowS = Math.floor(nowMs / 1000);
  const preciseCutoff = nowS - preciseDays(env) * DAY_S;
  const retentionCutoff = nowS - retentionDays(env) * DAY_S;
  const limit = intVar(env.RETENTION_BATCH_LIMIT, DEFAULT_BATCH_LIMIT);
  const maxBatches = intVar(env.RETENTION_MAX_BATCHES, DEFAULT_MAX_BATCHES);

  let pending = false;
  const phase = async (sql: string, binds: unknown[]): Promise<number> => {
    const result = await purgeInBatches(env, sql, binds, limit, maxBatches);
    pending = pending || result.pending;
    return result.rows;
  };

  // Tier two runs first, deliberately: a row past the retention window is also
  // past the precise window, so nulling before deleting would rewrite rows on
  // their way out and count them twice. Oldest first on idx_locate_log_ts.
  //
  // `ts IS NULL` is in this and the tier-one predicates because the column is
  // nullable: a row that cannot be shown to be inside the window is treated as
  // outside it, and NULLs sort first in the index so the seek stays cheap.
  // Without it, an untimestamped row would be the one row retention can never
  // reach.
  const locateDeleted = await phase(
    `DELETE FROM locate_log
      WHERE id IN (SELECT id FROM locate_log
                    WHERE ts IS NULL OR ts < ?1
                    ORDER BY ts LIMIT ?2)`,
    [retentionCutoff],
  );

  // Tier one, the common case: an unresolved coordinate set drops out of
  // idx_locate_log_precise_ts (partial ON ts WHERE est_lat IS NOT NULL) the
  // moment it is nulled, so a repeat run is an empty index scan rather than a
  // rescan of the whole aged range.
  const nulledEstimates = await phase(
    `UPDATE locate_log
        SET est_lat = NULL, est_lon = NULL, ref_lat = NULL, ref_lon = NULL
      WHERE id IN (SELECT id FROM locate_log
                    WHERE est_lat IS NOT NULL AND (ts IS NULL OR ts < ?1)
                    ORDER BY ts LIMIT ?2)`,
    [preciseCutoff],
  );

  // Tier one, the {"known": false} case. `est_lat` is the latch, but a locate
  // miss stores no estimate at all and can still be paired with a phone
  // reference fix (routes/locate.ts writes ref_lat on a row whose est_lat is
  // NULL) — those are real coordinates, and the partial index cannot see them.
  // Self-latching on ref_lat for the same reason tier one latches on est_lat.
  const nulledRefs = await phase(
    `UPDATE locate_log
        SET ref_lat = NULL, ref_lon = NULL
      WHERE id IN (SELECT id FROM locate_log
                    WHERE est_lat IS NULL AND ref_lat IS NOT NULL AND (ts IS NULL OR ts < ?1)
                    ORDER BY ts LIMIT ?2)`,
    [preciseCutoff],
  );

  // device_fixes carries no id column (device_id is the PK), so the bounded
  // sub-select goes through rowid; idx_device_fixes_captured_at orders it.
  const fixesDeleted = await phase(
    `DELETE FROM device_fixes
      WHERE rowid IN (SELECT rowid FROM device_fixes
                       WHERE captured_at < ?1
                       ORDER BY captured_at LIMIT ?2)`,
    [preciseCutoff],
  );

  // Expired credentials. An expired magic token is already unredeemable and an
  // expired pairing code already unclaimable — this is storage hygiene, not an
  // access control, which is why it can lag a tick without consequence.
  const magicDeleted = await phase(
    `DELETE FROM magic_tokens
      WHERE id IN (SELECT id FROM magic_tokens
                    WHERE expires_at < ?1
                    ORDER BY expires_at LIMIT ?2)`,
    [nowS],
  );
  const pairingDeleted = await phase(
    `DELETE FROM pairing_codes
      WHERE id IN (SELECT id FROM pairing_codes
                    WHERE expires_at < ?1
                    ORDER BY expires_at LIMIT ?2)`,
    [nowS],
  );

  // Sessions: `revokeSession` fires only on explicit sign-out, so a user who
  // just closes the browser leaves a row forever without this phase. `NULL`
  // reads as expired for the same reason the locate_log predicates treat an
  // untimestamped row as out-of-window — it is also where NULLs already sort
  // in idx_sessions_expires_at, so the seek stays cheap.
  const sessionsDeleted = await phase(
    `DELETE FROM sessions
      WHERE id IN (SELECT id FROM sessions
                    WHERE expires_at IS NULL OR expires_at < ?1
                    ORDER BY expires_at LIMIT ?2)`,
    [nowS],
  );

  // Budget shards are keyed by UTC day; anything before today is dead weight.
  // Strictly `<` today, computed exactly as email.ts computes the day it
  // writes, so a purge running at 00:00 UTC cannot delete a live counter.
  // `send:failure` is excluded: it is the only durable record that a Resend
  // outage happened, and this same purge deleting it at 03:47 UTC the morning
  // after would erase the signal before an operator ever saw it.
  const budgetsDeleted = await phase(
    `DELETE FROM auth_budgets
      WHERE rowid IN (SELECT rowid FROM auth_budgets
                       WHERE day < ?1 AND scope != ?2
                       ORDER BY day LIMIT ?3)`,
    [budgetDay(nowMs), SEND_FAILURE_SCOPE],
  );

  const counts: PurgeCounts = {
    locate_coords_nulled: nulledEstimates + nulledRefs,
    locate_deleted: locateDeleted,
    device_fixes_deleted: fixesDeleted,
    magic_tokens_deleted: magicDeleted,
    pairing_codes_deleted: pairingDeleted,
    sessions_deleted: sessionsDeleted,
    auth_budgets_deleted: budgetsDeleted,
  };
  const result: PurgeResult = {
    ran_at: Math.floor(Date.now() / 1000),
    duration_ms: Date.now() - startedMs,
    rows_affected: Object.values(counts).reduce((a, b) => a + b, 0),
    pending,
    counts,
  };

  // Recorded even when nothing was purged — that is the whole point. Without a
  // no-op run leaving a trace, "no rows deleted lately" is ambiguous between
  // "nothing to delete" and "the cron is dead".
  await env.DB.prepare(
    `INSERT INTO maintenance_runs (job, last_run_at, duration_ms, rows_affected, pending, detail)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (job) DO UPDATE SET
       last_run_at   = excluded.last_run_at,
       duration_ms   = excluded.duration_ms,
       rows_affected = excluded.rows_affected,
       pending       = excluded.pending,
       detail        = excluded.detail`,
  )
    .bind(
      RETENTION_JOB,
      result.ran_at,
      result.duration_ms,
      result.rows_affected,
      result.pending ? 1 : 0,
      JSON.stringify(counts),
    )
    .run();

  return result;
}

/**
 * The operator read: what the last run did and when. `null` means the job has
 * never completed on this database — indistinguishable from a very long
 * outage, and both answers are "go look at the cron".
 */
export async function lastRetentionRun(
  env: Env,
  job: string = RETENTION_JOB,
): Promise<RetentionRun | null> {
  const row = await env.DB.prepare("SELECT * FROM maintenance_runs WHERE job = ?1")
    .bind(job)
    .first<{
      job: string;
      last_run_at: number;
      duration_ms: number;
      rows_affected: number;
      pending: number;
      detail: string | null;
    }>();
  if (!row) return null;
  let counts: Partial<PurgeCounts> = {};
  try {
    counts = row.detail ? (JSON.parse(row.detail) as Partial<PurgeCounts>) : {};
  } catch {
    // A detail blob we cannot parse must not hide the timestamp, which is the
    // half of this row an alert actually reads.
    counts = {};
  }
  return {
    job: row.job,
    last_run_at: row.last_run_at,
    duration_ms: row.duration_ms,
    rows_affected: row.rows_affected,
    pending: row.pending === 1,
    counts,
  };
}
