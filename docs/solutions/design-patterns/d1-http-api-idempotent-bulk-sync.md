---
title: Idempotent bulk sync to Cloudflare D1 over the HTTP API
date: 2026-08-02
category: design-patterns
module: ingest
problem_type: design_pattern
component: database
severity: high
applies_when:
  - "An external process (cron job, script) writes to D1 through the HTTP /query endpoint rather than a Workers binding"
  - "The same dataset is re-loaded periodically and re-runs must converge without duplicates or lost rows"
  - "More than one host might run the job against the same database"
tags: [cloudflare-d1, idempotency, bulk-load, prune, parameter-limit, distributed-lock]
---

# Idempotent bulk sync to Cloudflare D1 over the HTTP API

## Context

Phase 1 of gtfs-compass needed a Python cron job to keep D1 reference tables
(feeds catalog, GTFS stops/routes/edges) converged with external sources. The
D1 HTTP API is auto-commit with **no transactions** (batch atomicity is
undocumented — assume none), enforces **100 bound parameters and 100 KB per
statement**, and the 1,200 req/5 min rate limit is **token-wide**. Safety
therefore cannot come from rollback; it must come from convergent, guarded
design. Three patterns emerged, one of which was reached only after code
review caught a P1 in the "obvious" implementation.

## Guidance

### 1. The 100-binding budget is per statement, and *everything* counts against it

Chunk sizing must budget every placeholder in the statement — scope/WHERE
params share the limit with row keys. The trap: `100 // len(pk_columns)`
looks correct, passes small-fixture tests, and overflows in production.

```python
# WRONG: 50 keys x 2 pk cols = 100 params + 1 scope param = 101 -> rejected
chunk_size = MAX_PARAMS // len(pk_columns)

# RIGHT: scope params share the statement budget
key_budget = MAX_PARAMS - len(scope_params)
chunk_size = max(1, key_budget // len(pk_columns))
```

Write the regression test against the boundary (a scoped 2-column-PK delete
with >= 50 keys) and assert `<= 100` — a `<= 101` tolerance in a test
*encodes* the bug rather than catching it, which is exactly what happened
here until review caught it.

### 2. Prune by select-diff-delete; chunked `NOT IN` is a mass delete

To remove rows absent from the source, never chunk a `NOT IN (keep-set)` —
each chunk deletes every row absent from *that chunk*, so the first statement
wipes most of the table. Instead:

1. `SELECT` the existing keys for the scope
2. Diff against the keep-set in application code
3. `DELETE ... IN (delete-set)` in chunks — each chunk independently safe

Order writes so failure leaves a *superset*, never missing rows: all upserts
complete before any delete; parents (stops, routes) upsert before children
(edges); children prune before parents. Guard the prune: refuse an empty
keep-set outright, and refuse deleting more than ~50% of scoped rows without
an explicit `--force` — a truncated download becomes a loud no-op instead of
a wipe. For zero-write re-runs, compare rows in application code before
upserting (SQLite's `ON CONFLICT DO UPDATE` rewrites identical rows) and
exclude timestamp columns from the comparison.

### 3. Two-layer run lock: local flock + a D1 lock row with TTL renewal

A local `fcntl` lock stops same-host overlap but not a second machine using
the same token. Add a one-row lock table claimed by conditional UPDATE
(atomic in SQLite), verified by a follow-up SELECT, with an expiry timestamp
so a crashed holder self-heals:

```sql
UPDATE ingest_lock SET holder = ?, expires_at = ?
WHERE id = 1 AND (holder IS NULL OR expires_at < ?)
```

**Renew the TTL between work phases** (`UPDATE ... WHERE holder = ?`, abort
if ownership was lost) and cap retry backoff — an unrenewed fixed TTL is a
time bomb: accumulated backoff pushes the run past expiry, a second host
claims the "expired" lock, and interleaved prunes break the superset
invariant. Three independent reviewers converged on this in review.

## Why This Matters

Every failure mode here is silent until it destroys data or availability:
the 101-param DELETE aborts a nightly run; chunked `NOT IN` deletes ~98% of
kept rows on the first chunk; a stale-TTL lock lets two hosts interleave
deletes computed from different snapshots. None are caught by happy-path
tests, all are cheap to prevent by construction, and the idempotent-converge
shape means any partial failure is repaired by the next successful run —
which is the only safety available without transactions.

## When to Apply

- Any external writer to D1's HTTP API (the Workers-binding `batch()` API is
  transactional and relaxes pattern 2's ordering, but limits still apply)
- Periodic full-dataset re-ingest where the source is authoritative
- Multi-host access to one database with shared credentials
- More broadly: any SQL target with per-statement parameter caps and no
  transaction support (the patterns are D1-flavored, not D1-specific)

## Examples

The reference implementation is `ingest/src/gtfs_compass_ingest/load.py`
(`sync`, `prune_only`, `_delete_in_chunks`, `acquire_lock`/`renew_lock`) with
boundary tests in `ingest/tests/test_load.py`
(`test_scoped_two_column_pk_prune_stays_within_param_budget`,
`test_prune_multichunk_deletes_only_the_diff`).

## Related

- Plan: `docs/plans/2026-08-02-001-feat-data-model-and-ingest-plan.md` (KTDs pin these patterns)
- Review run artifact: `/tmp/compound-engineering/ce-code-review/20260802-151215-5edac331/` (P1 finding #1 and lock-TTL finding #2)
