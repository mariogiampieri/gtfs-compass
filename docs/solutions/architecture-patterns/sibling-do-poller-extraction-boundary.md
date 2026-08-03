---
title: Share only the genuinely-identical parts of a sibling alarm-loop DO
date: 2026-08-03
category: architecture-patterns
module: api
problem_type: architecture_pattern
component: background_job
severity: medium
applies_when:
  - "Adding another Durable Object poller alongside existing ones that follow the alarm-loop discipline"
  - "Deciding what belongs in a shared module versus per-DO code"
tags: [durable-objects, code-sharing, abstraction, polling, cloudflare-workers]
---

# Share only the genuinely-identical parts of a sibling alarm-loop DO

## Context

gtfs-compass now runs three alarm-loop DO pollers — FeedDO (GTFS-RT protobuf,
20 s), GbfsDO (bike-share JSON, 60 s), AlertDO (service-alerts JSON, 60 s) —
all following `durable-object-alarm-loop-discipline.md`. Each new sibling
raised the same question: how much of the ~200-line lifecycle should be
extracted into a shared base?

## Guidance

Extract into the shared module (`api/src/do_shared.ts`) **only code that is
byte-identical across siblings and carries no per-DO judgment**:

- Constants whose value is genuinely shared (`IDLE_SUSPEND_MS`,
  `FETCH_TIMEOUT_MS`) — NOT cadence (`POLL_INTERVAL_MS` differs per feed ttl).
- Plain data types and pure helpers (`DoIdentity`, `doTag`, `MissingFeedError`,
  `batchIdsParam`).

Keep per-DO, even though it looks repetitive:

- The `fetch()` read path (routes and response shapes differ: stops vs
  stations vs routes; every-id-present vs omit-unknown vs sentinel-key are
  *deliberate* per-domain contracts).
- The `refresh()` body (parse format, freshness-gate source, snapshot shape).
- The constructor restore and `alarm()` (structurally parallel but tied to
  each DO's fields; a shared base class would force the snapshot shape into
  generics and turn every discipline change into a base-class migration).

The three implementations stay deliberately parallel in *structure and
naming* so a reader can diff them; divergence is visible, not hidden behind
an abstraction that must grow flags.

## Why This Matters

The tempting abstraction — `abstract class PollingDO<Snapshot>` — couples the
siblings exactly where they legitimately differ (parse, freshness source,
read contract) and saves only lines that never change independently. When the
alert layer added active-now read-time filtering and a sentinel key, it
touched only AlertDO; a shared base would have needed a hook. Meanwhile the
shared helpers caught real bugs once written once: `batchIdsParam`'s
raw-split-then-decode fixed comma-id corruption in ALL DOs in one place.

## When to Apply

- Every future poller (elevator/accessibility feed, second-agency alerts):
  copy the newest sibling, keep the structure parallel, extract into
  do_shared only what lands byte-identical after the copy settles.
- Revisit only if a *discipline* rule (not a data shape) needs to change in
  three places at once — that is the signal the discipline itself belongs in
  shared code.

## Examples

`api/src/feed_do.ts`, `api/src/gbfs_do.ts`, `api/src/alerts_do.ts` (the three
siblings); `api/src/do_shared.ts` (the boundary, with its header comment
naming the rule).

## Related

- `docs/solutions/architecture-patterns/durable-object-alarm-loop-discipline.md`
  — the lifecycle rules all siblings implement.
