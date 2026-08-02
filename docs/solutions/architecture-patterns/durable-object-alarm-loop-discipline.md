---
title: Durable Object alarm-loop discipline for polling workloads
date: 2026-08-02
category: architecture-patterns
module: api
problem_type: architecture_pattern
component: background_job
severity: high
applies_when:
  - "A Durable Object polls an upstream on a self-rescheduling alarm while consumers read cached state"
  - "The loop must survive upstream outages, duplicate (at-least-once) alarm delivery, and hibernation between events"
  - "Billing depends on the DO staying hibernation-eligible between cycles"
tags: [durable-objects, alarms, hibernation, polling, idempotency, cloudflare-workers, staleness]
---

# Durable Object alarm-loop discipline for polling workloads

## Context

Phase 2 of gtfs-compass polls GTFS-RT feeds from a per-feed-group DO on a
20 s alarm while devices read cached arrivals, self-suspending after 10 idle
minutes. Three platform facts shape everything: an idle DO with a pending
alarm bills **zero duration** (hibernation-eligible); alarms are
**at-least-once** with undocumented retry/getAlarm interactions; and DO
**input gates cover storage awaits only** — any non-storage await is an
interleaving point. Plan deepening and adversarial review each caught a
race the naive design would have shipped.

## Guidance

### 1. Reschedule first; never throw; let cadence be the retry

`alarm()` runs: suspend check → `setAlarm(now + interval)` **before any
upstream I/O** → risky work inside a catch-all that never rethrows. The
next tick is armed before anything can fail, so no exception kills the
loop, and the built-in retry machinery (with its undocumented
`getAlarm()`-during-backoff semantics) is never engaged — a failed cycle
just waits for the next one, absorbed by the consumer-facing staleness
contract. Because delivery is at-least-once anyway, the handler must also
be idempotent under duplicate invocation.

### 2. One refresh in flight, guarded at every entry point

A read arriving while `alarm()` awaits its upstream fetch sees
`getAlarm() === null` (the alarm is executing) and would happily start a
second fetch. Guards, all three: a single in-memory `refreshInFlight` flag
covering **both** the alarm path and the read-triggered path; an
`AbortSignal.timeout` safely under the cadence so a hung upstream can't
outlive its window; and a newer-only store (reject a snapshot whose fetch
began before the stored one's) so a slow old fetch can never overwrite
newer data. In the read path, keep the `getAlarm()`-check → `setAlarm()`
pair free of non-storage awaits — input gates make it atomic — and launch
the `waitUntil` refresh only after.

### 3. Hibernation forgets memory on the timescale of seconds — persist accordingly

Between a sparse read and the next alarm, the DO hibernates (~10 s
idle) and the constructor re-runs on wake: in-memory state loss is the
**common case**, not a rare eviction. Anything a lifecycle decision depends
on (here: `last_read` driving self-suspend) must be persisted often enough
that its staleness bound is acceptable — we persist on read whenever the
stored value is older than one alarm interval, costing ≤1 row-write per
window while capping the error at one interval. Conversely, persist the
snapshot **before** flipping the in-memory copy: memory-first ordering
serves data that silently regresses on the next wake if the put failed.

### 4. Don't trust HTTP 200 from a stuck upstream

A feed generator can freeze while its HTTP layer keeps serving 200s. Stamp
freshness (`fetched_at`) only when the payload's own generation timestamp
advances; otherwise treat the cycle as a failed fetch and keep the old
stamp so staleness becomes visible downstream. Skip the gate when the
upstream omits the timestamp (optional in GTFS-RT), or the first snapshot
freezes forever at `0 <= 0`.

### 5. Serve stale instantly; distinguish "no data yet" from "no service"

Reads never block on upstream: return the snapshot with its honest stamp
and refresh behind. A brand-new DO has nothing to serve — return an
explicit null stamp ("no data yet"), a different fact from empty-results-
with-real-stamp ("no service"). Consumers render the two differently.

## Why This Matters

Each rule closes a failure that unit-tested happy paths never hit: the
mid-flight read race double-fetches exactly during bursts (violating the
one-fetch-per-window invariant that makes N readers cost one upstream
fetch); an unrenewed in-memory `last_read` suspends an actively-read DO
mid-use; a frozen feed silently defeats the staleness contract; a thrown
alarm plus reschedule-first duplicates the loop. Live verification
confirmed the composite behavior: one alarm per window, 6–28 ms CPU per
cycle, zero activity after suspend, instant stale-then-fresh on re-arm.

## When to Apply

- Any DO that polls on a self-rescheduling alarm with cached reads
  (realtime proxies, webhook debouncers, upstream health monitors)
- Whenever billing assumes hibernation between cycles — a `setTimeout`
  chain or a blocking-fetch design silently bills 24/7 wall time
- The persist-before-flip and never-throw rules apply to any DO whose
  constructor restores from storage

## Examples

Reference implementation: `api/src/feed_do.ts` (`alarm()`, `refresh()`,
`fetch()` ordering); race and lifecycle tests in
`api/test/workers/feed_do.test.ts` (mid-flight race, duplicate alarms,
frozen upstream, sparse-reader suspend, first-read contract).

## Related

- `docs/solutions/design-patterns/d1-http-api-idempotent-bulk-sync.md` —
  same no-transactional-safety-net philosophy, different mechanics (SQL
  diff convergence vs snapshot convergence under at-least-once delivery).
- Plan: `docs/plans/2026-08-02-002-feat-feed-durable-object-plan.md`
  (verified platform facts and the deepening/review findings behind rules
  2 and 3).
