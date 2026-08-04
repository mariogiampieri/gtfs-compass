import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { expectedSchema, resetSchema, schemaDrift } from "./schema";

/**
 * The guard on test-schema drift.
 *
 * Every workers suite used to hand-write its own CREATE TABLE statements, and
 * those copies had already fallen behind `api/migrations` — most visibly
 * `locate_log.device_row_id`, added by 0003 and absent from every hand-rolled
 * copy, so a write to it would have passed CI and 500'd in production. The
 * suites now build from the migration files (test/workers/schema.ts); this file
 * is what fails if anyone reintroduces a private copy of the schema.
 */

beforeEach(async () => {
  await resetSchema();
});

describe("test schema vs. migrations", () => {
  it("has every column and index the migrations define", async () => {
    expect(await schemaDrift()).toEqual([]);
  });

  it("reads the columns 0003 adds on top of 0000, not just the 0000 list", () => {
    const { columns, indexes } = expectedSchema();
    // Spot-checks of the three drifts the hand-rolled copies actually had.
    expect(columns.get("locate_log")).toContain("device_row_id");
    expect(columns.get("devices")).toEqual(expect.arrayContaining(["scopes", "revoked_at"]));
    expect(indexes.get("idx_magic_tokens_token_hash")).toBe("magic_tokens");
  });

  it("catches the drift that was live: locate_log without device_row_id", async () => {
    // The exact hand-rolled table locate.test.ts carried — migration 0000's
    // column list, missing what 0003 adds. Reproduced here so the guard is
    // pinned to a case known to have shipped, not to a hypothetical one.
    await env.DB.prepare("DROP TABLE locate_log").run();
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

    const drift = await schemaDrift();
    expect(drift).toContain("locate_log.device_row_id");
    expect(drift).toContain("locate_log.device_row_id->devices");
    // Dropping the table takes its indexes with it, so the guard reports the
    // lost purge indexes too — the retention suite's partial indexes are as
    // load-bearing as the column.
    expect(drift).toContain("idx_locate_log_precise_ts");
    expect(drift).toContain("idx_locate_log_ref_only_ts");
  });

  it("catches a dropped UNIQUE index and a dropped foreign key", async () => {
    // The other two shapes the hand-rolled copies had: magic_tokens without the
    // UNIQUE token_hash index (two links could hash alike), and pairing_codes
    // with claimed_by declared as plain TEXT, so account deletion never
    // cascaded to a claimed code.
    await env.DB.prepare("DROP INDEX idx_magic_tokens_token_hash").run();
    await env.DB.prepare("DROP TABLE pairing_codes").run();
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

    const drift = await schemaDrift();
    expect(drift).toContain("idx_magic_tokens_token_hash");
    expect(drift).toContain("pairing_codes.claimed_by->users");
  });

  it("catches a table a suite forgot to create at all", async () => {
    await env.DB.prepare("DROP TABLE device_fixes").run();
    expect(await schemaDrift()).toContain("device_fixes");
  });
});
