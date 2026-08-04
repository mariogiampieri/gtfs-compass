-- gtfs-compass retention indexes (Phase 5 code-review follow-up).
-- Source of truth: docs/plans/2026-08-03-004-feat-phase-5-accounts-pairing-relay-plan.md
-- Additive only; 0003 and 0004 are applied and are never edited.
--
-- Backs two purge phases that had no supporting index:
--
--   * sessions past expires_at (F9): the same "nothing else bounds this
--     table" gap magic_tokens and pairing_codes already have an index for.
--     `revokeSession` only fires on explicit sign-out, so a user who closes
--     the browser leaves a row forever without the retention sweep, and the
--     sweep needs this index the same way it needs idx_magic_tokens_expires_at.
--   * the ref_lat-only branch of locate_log tier one (routes/locate.ts's
--     {"known": false} case, paired with a phone reference fix) already
--     self-latches on ref_lat the same way idx_locate_log_precise_ts
--     self-latches on est_lat, but had no partial index of its own and fell
--     back to scanning idx_locate_log_ts. Verified with EXPLAIN QUERY PLAN
--     that SQLite chooses this index over the full ts index for that phase's
--     WHERE clause.
CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);

CREATE INDEX idx_locate_log_ref_only_ts ON locate_log (ts) WHERE est_lat IS NULL AND ref_lat IS NOT NULL;
