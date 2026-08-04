-- gtfs-compass maintenance bookkeeping (Phase 5, U11).
-- Source of truth: docs/plans/2026-08-03-004-feat-phase-5-accounts-pairing-relay-plan.md
-- Additive only; 0003 is applied and is never edited.
--
-- R20 makes "has not run in N days" an alert condition, which requires the
-- Worker to leave a durable trace of every completed purge. Nothing in this
-- codebase stored operational state before now: DO storage is per-feed and
-- per-object (the retention job belongs to no feed), and a log line is not
-- queryable after the tail window closes. So: one small D1 row, readable by an
-- operator with
--   npx wrangler d1 execute gtfs-compass --remote \
--     --command "SELECT * FROM maintenance_runs"
--
-- Latest-run-wins, one row per job, never an append-only history — a table
-- that grew per run would itself need the retention this job exists to
-- provide. `last_run_at` answers the alert condition; the counts answer
-- "and did it actually do anything".
--
-- Deliberately NOT an ingest-owned table (ingest/src/gtfs_compass_ingest/
-- tables.py): the Worker writes it, the ingest converge loop must never see it.
CREATE TABLE maintenance_runs (
  job           TEXT PRIMARY KEY NOT NULL,  -- 'retention-purge'
  last_run_at   INTEGER NOT NULL,           -- completion time, epoch seconds
  duration_ms   INTEGER NOT NULL,
  rows_affected INTEGER NOT NULL,           -- this run, summed across phases
  -- 1 when a phase hit its per-invocation batch bound: the backlog is not
  -- drained and the next tick resumes it. An operator watching this stay 1 for
  -- days is watching the purge lose ground to the insert rate.
  pending       INTEGER NOT NULL DEFAULT 0,
  detail        TEXT                        -- JSON, per-phase row counts
);
