import { createExecutionContext, createScheduledController, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { budgetDay } from "../../src/email";
import worker from "../../src/index";
import {
  DEFAULT_PRECISE_DAYS,
  DEFAULT_RETENTION_DAYS,
  RETENTION_JOB,
  lastRetentionRun,
  runRetentionPurge,
} from "../../src/retention";

/**
 * Retention purge (U11; R20, AE11).
 *
 * The scheduled export is exercised once, end to end, through
 * `createScheduledController` — the wiring between the Cron Trigger and the
 * job is exactly the thing a test calling `runRetentionPurge` directly would
 * not prove. Everything else calls the job, where the assertions can be about
 * rows rather than about a `void` return.
 */

const DAY_S = 86_400;
const USER = "usr_test";
const DEVICE = "dev_test";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** `ts` for a row aged `days` days. */
function daysAgo(days: number): number {
  return nowSec() - days * DAY_S;
}

function e(overrides: Record<string, unknown> = {}): Env {
  return { ...env, ...overrides } as unknown as Env;
}

interface LocateRow {
  ts: number;
  est_lat?: number | null;
  est_lon?: number | null;
  est_accuracy?: number | null;
  provider?: string;
  bssid_count?: number;
  ref_lat?: number | null;
  ref_lon?: number | null;
  ref_accuracy?: number | null;
  delta_m?: number | null;
  label?: string | null;
}

async function insertLocate(row: LocateRow): Promise<number> {
  const result = await env.DB.prepare(
    `INSERT INTO locate_log
       (user_id, device_id, ts, est_lat, est_lon, est_accuracy, provider, bssid_count,
        ref_lat, ref_lon, ref_accuracy, delta_m, label)
     VALUES (NULL, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
     RETURNING id`,
  )
    .bind(
      DEVICE,
      row.ts,
      row.est_lat === undefined ? 40.7128 : row.est_lat,
      row.est_lon === undefined ? -74.006 : row.est_lon,
      row.est_accuracy ?? 42,
      row.provider ?? "beacondb",
      row.bssid_count ?? 7,
      row.ref_lat ?? null,
      row.ref_lon ?? null,
      row.ref_accuracy ?? null,
      row.delta_m ?? null,
      row.label ?? "platform",
    )
    .first<{ id: number }>();
  return result!.id;
}

async function locateRow(id: number) {
  return env.DB.prepare("SELECT * FROM locate_log WHERE id = ?1")
    .bind(id)
    .first<Record<string, unknown>>();
}

async function countOf(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row!.n;
}

beforeEach(async () => {
  // Schema per migrations 0000 + 0003 + 0004 (these suites build their own
  // tables). The two purge indexes are created here as well: the partial one
  // is load-bearing for tier one's self-latching, so the tests run against the
  // shape production has.
  for (const table of [
    "maintenance_runs",
    "auth_budgets",
    "pairing_codes",
    "magic_tokens",
    "device_fixes",
    "locate_log",
    "devices",
  ]) {
    await env.DB.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  }
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS users (
       id         TEXT PRIMARY KEY NOT NULL,
       email      TEXT UNIQUE,
       created_at INTEGER
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
  await env.DB.prepare("CREATE INDEX idx_locate_log_ts ON locate_log (ts)").run();
  await env.DB.prepare(
    "CREATE INDEX idx_locate_log_precise_ts ON locate_log (ts) WHERE est_lat IS NOT NULL",
  ).run();
  await env.DB.prepare(
    `CREATE TABLE devices (
       id         TEXT PRIMARY KEY NOT NULL,
       user_id    TEXT REFERENCES users (id) ON DELETE CASCADE,
       token_hash TEXT,
       name       TEXT,
       paired_at  INTEGER
     )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE device_fixes (
       device_id   TEXT PRIMARY KEY NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
       lat         REAL NOT NULL,
       lon         REAL NOT NULL,
       accuracy_m  REAL,
       captured_at INTEGER NOT NULL,
       received_at INTEGER NOT NULL
     )`,
  ).run();
  await env.DB.prepare(
    "CREATE INDEX idx_device_fixes_captured_at ON device_fixes (captured_at)",
  ).run();
  await env.DB.prepare(
    `CREATE TABLE magic_tokens (
       id         TEXT PRIMARY KEY NOT NULL,
       token_hash TEXT NOT NULL,
       email      TEXT NOT NULL,
       nonce_hash TEXT,
       created_at INTEGER NOT NULL,
       expires_at INTEGER NOT NULL,
       used_at    INTEGER
     )`,
  ).run();
  await env.DB.prepare("CREATE INDEX idx_magic_tokens_expires_at ON magic_tokens (expires_at)").run();
  await env.DB.prepare(
    `CREATE TABLE pairing_codes (
       id               TEXT PRIMARY KEY NOT NULL,
       device_code_hash TEXT NOT NULL,
       user_code        TEXT NOT NULL,
       device_name      TEXT,
       fw_version       TEXT,
       attempts         INTEGER NOT NULL DEFAULT 0,
       created_at       INTEGER NOT NULL,
       expires_at       INTEGER NOT NULL,
       claimed_by       TEXT,
       claimed_at       INTEGER
     )`,
  ).run();
  await env.DB.prepare(
    "CREATE INDEX idx_pairing_codes_expires_at ON pairing_codes (expires_at)",
  ).run();
  await env.DB.prepare(
    `CREATE TABLE auth_budgets (
       scope TEXT NOT NULL,
       key   TEXT NOT NULL,
       day   INTEGER NOT NULL,
       shard INTEGER NOT NULL,
       count INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (scope, key, day, shard)
     )`,
  ).run();
  await env.DB.prepare("CREATE INDEX idx_auth_budgets_day ON auth_budgets (day)").run();
  await env.DB.prepare(
    `CREATE TABLE maintenance_runs (
       job           TEXT PRIMARY KEY NOT NULL,
       last_run_at   INTEGER NOT NULL,
       duration_ms   INTEGER NOT NULL,
       rows_affected INTEGER NOT NULL,
       pending       INTEGER NOT NULL DEFAULT 0,
       detail        TEXT
     )`,
  ).run();
  await env.DB.prepare("INSERT OR IGNORE INTO users (id, created_at) VALUES (?1, ?2)")
    .bind(USER, nowSec())
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO devices (id, user_id, paired_at) VALUES (?1, ?2, ?3)",
  )
    .bind(DEVICE, USER, nowSec())
    .run();
});

describe("locate_log tier one — the coordinates age out, the diagnostic does not", () => {
  it("nulls raw coordinates past the precise window while every metric survives", async () => {
    const id = await insertLocate({
      ts: daysAgo(DEFAULT_PRECISE_DAYS + 1),
      est_accuracy: 310,
      bssid_count: 9,
      ref_lat: 40.7,
      ref_lon: -74.0,
      ref_accuracy: 8,
      delta_m: 123.5,
    });

    const result = await runRetentionPurge(e());

    expect(result.counts.locate_coords_nulled).toBe(1);
    const row = await locateRow(id);
    expect(row).toMatchObject({
      est_lat: null,
      est_lon: null,
      ref_lat: null,
      ref_lon: null,
      // The residual map's actual question, still answerable:
      est_accuracy: 310,
      ref_accuracy: 8,
      delta_m: 123.5,
      bssid_count: 9,
      provider: "beacondb",
      label: "platform",
    });
    expect(row!.ts).toBe(daysAgo(DEFAULT_PRECISE_DAYS + 1));
  });

  it("nulls the reference fix on a {known:false} row, which carries no est_lat to latch on", async () => {
    // routes/locate.ts writes est_lat NULL when the provider resolved nothing,
    // and /v1/locate/ref can still pair a real phone position onto that row.
    // The partial index cannot see those coordinates; they are still
    // coordinates.
    const id = await insertLocate({
      ts: daysAgo(DEFAULT_PRECISE_DAYS + 1),
      est_lat: null,
      est_lon: null,
      est_accuracy: null,
      provider: "none",
      ref_lat: 40.75,
      ref_lon: -73.99,
      ref_accuracy: 12,
    });

    const result = await runRetentionPurge(e());

    expect(result.counts.locate_coords_nulled).toBe(1);
    expect(await locateRow(id)).toMatchObject({
      ref_lat: null,
      ref_lon: null,
      ref_accuracy: 12,
      provider: "none",
    });
  });

  it("leaves in-window rows completely untouched (AE11)", async () => {
    const id = await insertLocate({ ts: daysAgo(DEFAULT_PRECISE_DAYS - 1), ref_lat: 40.7, ref_lon: -74.0 });

    const result = await runRetentionPurge(e());

    expect(result.counts.locate_coords_nulled).toBe(0);
    expect(result.counts.locate_deleted).toBe(0);
    expect(await locateRow(id)).toMatchObject({
      est_lat: 40.7128,
      est_lon: -74.006,
      ref_lat: 40.7,
      ref_lon: -74.0,
    });
  });

  it("does not re-process a row whose coordinates are already null", async () => {
    await insertLocate({ ts: daysAgo(DEFAULT_PRECISE_DAYS + 1) });

    const first = await runRetentionPurge(e());
    const second = await runRetentionPurge(e());

    expect(first.counts.locate_coords_nulled).toBe(1);
    expect(second.counts.locate_coords_nulled).toBe(0);
    expect(second.rows_affected).toBe(0);
  });

  it("reaches a row with no timestamp at all, which no window can vouch for", async () => {
    const id = await insertLocate({ ts: null as unknown as number, ref_lat: 40.7, ref_lon: -74.0 });

    await runRetentionPurge(e());

    // Tier one nulls it and tier two deletes it in the same run: an
    // untimestamped row is outside every window by construction.
    expect(await locateRow(id)).toBeNull();
  });
});

describe("locate_log tier two — the row goes", () => {
  it("deletes rows past the retention window and keeps rows inside it (AE11)", async () => {
    const old = await insertLocate({ ts: daysAgo(DEFAULT_RETENTION_DAYS + 1) });
    const aging = await insertLocate({ ts: daysAgo(DEFAULT_RETENTION_DAYS - 1) });
    const fresh = await insertLocate({ ts: daysAgo(1) });

    const result = await runRetentionPurge(e());

    expect(result.counts.locate_deleted).toBe(1);
    expect(await locateRow(old)).toBeNull();
    expect(await locateRow(aging)).not.toBeNull();
    // Past 14 days, so tier one has taken its coordinates; the row survives.
    expect(await locateRow(aging)).toMatchObject({ est_lat: null, est_accuracy: 42 });
    expect(await locateRow(fresh)).toMatchObject({ est_lat: 40.7128 });
  });

  it("honors overridden windows rather than the defaults", async () => {
    const id = await insertLocate({ ts: daysAgo(3) });

    await runRetentionPurge(e({ LOCATE_LOG_PRECISE_DAYS: "1", LOCATE_LOG_RETENTION_DAYS: "2" }));

    expect(await locateRow(id)).toBeNull();
  });
});

describe("device_fixes — the most precise location in the system expires too", () => {
  async function insertFix(deviceId: string, capturedAt: number) {
    await env.DB.prepare("INSERT OR IGNORE INTO devices (id, user_id, paired_at) VALUES (?1, ?2, ?3)")
      .bind(deviceId, USER, nowSec())
      .run();
    await env.DB.prepare(
      `INSERT INTO device_fixes (device_id, lat, lon, accuracy_m, captured_at, received_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
      .bind(deviceId, 40.7, -74.0, 5, capturedAt, capturedAt)
      .run();
  }

  it("deletes a fix past the precise window and keeps a recent one", async () => {
    await insertFix("dev_stale", daysAgo(DEFAULT_PRECISE_DAYS + 1));
    await insertFix("dev_live", daysAgo(1));

    const result = await runRetentionPurge(e());

    expect(result.counts.device_fixes_deleted).toBe(1);
    const rows = await env.DB.prepare("SELECT device_id FROM device_fixes").all<{
      device_id: string;
    }>();
    expect(rows.results.map((r) => r.device_id)).toEqual(["dev_live"]);
  });
});

describe("credential and counter sweeps — the tables nothing else bounds", () => {
  it("deletes expired magic tokens and pairing codes, keeping live ones", async () => {
    const now = nowSec();
    await env.DB.prepare(
      `INSERT INTO magic_tokens (id, token_hash, email, created_at, expires_at)
       VALUES ('mt_dead', 'h1', 'a@example.com', ?1, ?2),
              ('mt_live', 'h2', 'b@example.com', ?1, ?3)`,
    )
      .bind(now - 3600, now - 60, now + 600)
      .run();
    await env.DB.prepare(
      `INSERT INTO pairing_codes (id, device_code_hash, user_code, created_at, expires_at)
       VALUES ('pc_dead', 'h3', 'AAAABBBB', ?1, ?2),
              ('pc_live', 'h4', 'CCCCDDDD', ?1, ?3)`,
    )
      .bind(now - 3600, now - 60, now + 300)
      .run();

    const result = await runRetentionPurge(e());

    expect(result.counts.magic_tokens_deleted).toBe(1);
    expect(result.counts.pairing_codes_deleted).toBe(1);
    expect(await countOf("magic_tokens")).toBe(1);
    expect(await countOf("pairing_codes")).toBe(1);
    expect(
      await env.DB.prepare("SELECT id FROM magic_tokens").first<{ id: string }>(),
    ).toMatchObject({ id: "mt_live" });
  });

  it("drops yesterday's budget shards and never today's live counters", async () => {
    const today = budgetDay();
    await env.DB.prepare(
      `INSERT INTO auth_budgets (scope, key, day, shard, count)
       VALUES ('send:address', 'k', ?1, 0, 3),
              ('send:address', 'k', ?2, 0, 1)`,
    )
      .bind(today - 1, today)
      .run();

    const result = await runRetentionPurge(e());

    expect(result.counts.auth_budgets_deleted).toBe(1);
    const rows = await env.DB.prepare("SELECT day FROM auth_budgets").all<{ day: number }>();
    expect(rows.results.map((r) => r.day)).toEqual([today]);
  });
});

describe("bounded batches", () => {
  it("bounds one invocation, reports the backlog, and resumes on the next tick", async () => {
    for (let i = 0; i < 5; i++) {
      await insertLocate({ ts: daysAgo(DEFAULT_RETENTION_DAYS + 1 + i) });
    }
    // Two rows per statement, one statement per phase: four of the five rows
    // must survive the first invocation.
    const bounded = e({ RETENTION_BATCH_LIMIT: "2", RETENTION_MAX_BATCHES: "1" });

    const first = await runRetentionPurge(bounded);
    expect(first.counts.locate_deleted).toBe(2);
    expect(first.pending).toBe(true);
    expect(await countOf("locate_log")).toBe(3);

    const second = await runRetentionPurge(bounded);
    expect(second.counts.locate_deleted).toBe(2);
    expect(await countOf("locate_log")).toBe(1);

    const third = await runRetentionPurge(bounded);
    expect(third.counts.locate_deleted).toBe(1);
    expect(third.pending).toBe(false);
    expect(await countOf("locate_log")).toBe(0);
  });

  it("deletes oldest first, so a bounded run drains the backlog in age order", async () => {
    const oldest = await insertLocate({ ts: daysAgo(DEFAULT_RETENTION_DAYS + 10) });
    const newer = await insertLocate({ ts: daysAgo(DEFAULT_RETENTION_DAYS + 1) });

    await runRetentionPurge(e({ RETENTION_BATCH_LIMIT: "1", RETENTION_MAX_BATCHES: "1" }));

    expect(await locateRow(oldest)).toBeNull();
    expect(await locateRow(newer)).not.toBeNull();
  });

  it("keeps working across several statements when the batch budget allows", async () => {
    for (let i = 0; i < 5; i++) {
      await insertLocate({ ts: daysAgo(DEFAULT_RETENTION_DAYS + 1 + i) });
    }

    const result = await runRetentionPurge(
      e({ RETENTION_BATCH_LIMIT: "2", RETENTION_MAX_BATCHES: "20" }),
    );

    expect(result.counts.locate_deleted).toBe(5);
    expect(result.pending).toBe(false);
    expect(await countOf("locate_log")).toBe(0);
  });
});

describe("the run record — what makes 'has not run in N days' answerable", () => {
  it("records a no-op run with zeroed counters and a completion time", async () => {
    const before = nowSec();

    const result = await runRetentionPurge(e());

    expect(result.rows_affected).toBe(0);
    const run = await lastRetentionRun(env as unknown as Env);
    expect(run).not.toBeNull();
    expect(run!.job).toBe(RETENTION_JOB);
    expect(run!.rows_affected).toBe(0);
    expect(run!.pending).toBe(false);
    expect(run!.last_run_at).toBeGreaterThanOrEqual(before);
    expect(run!.counts).toMatchObject({ locate_deleted: 0, magic_tokens_deleted: 0 });
  });

  it("exposes per-phase counts an operator can read back out of D1", async () => {
    await insertLocate({ ts: daysAgo(DEFAULT_PRECISE_DAYS + 1) });
    await insertLocate({ ts: daysAgo(DEFAULT_RETENTION_DAYS + 1) });

    await runRetentionPurge(e());

    const run = await lastRetentionRun(env as unknown as Env);
    expect(run!.rows_affected).toBe(2);
    expect(run!.counts).toMatchObject({ locate_coords_nulled: 1, locate_deleted: 1 });
    // Readable without this helper too — an operator has `wrangler d1 execute`.
    const raw = await env.DB.prepare("SELECT * FROM maintenance_runs").first<{
      job: string;
      rows_affected: number;
    }>();
    expect(raw).toMatchObject({ job: RETENTION_JOB, rows_affected: 2 });
  });

  it("keeps exactly one row per job, so the bookkeeping needs no retention of its own", async () => {
    await runRetentionPurge(e());
    await runRetentionPurge(e());
    await runRetentionPurge(e());

    expect(await countOf("maintenance_runs")).toBe(1);
  });

  it("does not refresh the timestamp when the purge fails — the alert must still fire", async () => {
    await runRetentionPurge(e());
    const healthy = await lastRetentionRun(env as unknown as Env);
    // A missing table is the shape of every D1 failure that matters here: the
    // job throws part-way, and the run must not be recorded as a success.
    await env.DB.prepare("DROP TABLE device_fixes").run();

    await expect(runRetentionPurge(e())).rejects.toThrow();

    const after = await lastRetentionRun(env as unknown as Env);
    expect(after!.last_run_at).toBe(healthy!.last_run_at);
  });
});

describe("the scheduled export", () => {
  it("runs the purge on a cron tick and logs one structured line", async () => {
    const id = await insertLocate({ ts: daysAgo(DEFAULT_RETENTION_DAYS + 1) });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const controller = createScheduledController({ cron: "47 3 * * *" });
      const ctx = createExecutionContext();

      await worker.scheduled!(controller, env as unknown as Env, ctx);

      expect(await locateRow(id)).toBeNull();
      const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("retention purge:"));
      expect(line).toBeDefined();
      expect(JSON.parse(line!.slice("retention purge: ".length))).toMatchObject({
        rows_affected: 1,
        counts: { locate_deleted: 1 },
      });
    } finally {
      log.mockRestore();
    }
    expect((await lastRetentionRun(env as unknown as Env))!.rows_affected).toBe(1);
  });

  it("propagates a failure so the cron invocation is not reported as healthy", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await env.DB.prepare("DROP TABLE magic_tokens").run();
      const controller = createScheduledController({ cron: "47 3 * * *" });

      await expect(
        worker.scheduled!(controller, env as unknown as Env, createExecutionContext()),
      ).rejects.toThrow();
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
