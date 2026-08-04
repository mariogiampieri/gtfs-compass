# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Transit data model

### Feed
A transit data source (one agency's schedule and/or realtime data) and the unit everything else keys on. Feeds come from two places: the Mobility Database catalog (thousands, identified by `mdb-*` slugs) and Curated Seeds (a handful, with stable human-readable ids). Nothing in the system may assume a single feed or agency.

### Curated Seed
A hand-maintained Feed definition that always wins over catalog data and keeps a stable, human-readable id so user favorites can reference it durably. Curated Seeds are applied as an inseparable final step of catalog ingest and are never pruned as absent-from-source.

### Suppression
Marking a catalog Feed non-active because a Curated Seed already covers the same transit system, so location queries never return the same system twice. Suppressed rows stay in the database as a record of the decision; the suppression list is maintained alongside the Curated Seeds.

### Adapter
The named strategy for parsing a Feed's realtime data (e.g., plain GTFS-RT vs. the NYCT-extended variant). Stored per Feed so adding an agency is configuration, not code. Group-capable Adapters additionally know how to fan a Feed out into its Feed Groups.

### Feed Group
An independently fetched slice of a Feed's realtime data (NYC subway publishes eight, split by route family). Each Feed Group is polled and cached in isolation, so one broken group cannot stale the others; a Feed with no such split is a single group.

### Snapshot
The cached, reduced realtime state for one Feed Group: upcoming arrivals per Platform plus the freshness stamp consumers judge staleness by. Snapshots are replaced whole, only ever by strictly newer data, and survive the poller's sleep so a waking reader is served instantly — a Snapshot that has never existed is a distinct fact ("no data yet") from an empty one ("no service").

### Trunk Alert
The single service advisory a trunk carries in the nearby response: severity ("delay" = your ride is disrupted now — delays, suspensions, skipped stops, reduced service; "info" = everything else), rider-facing text, and the directions it applies to. Only alerts whose active period covers the present moment qualify; when several compete for one trunk, higher severity then newer update wins. A null alert deliberately conflates "no alert", "alerts source down", and "alerts data stale".

### Agency-Wide Alert
An alert whose selectors name only the agency, not routes — the systemwide-disruption case. It travels under a sentinel key and attaches to every trunk, because the highest-impact alerts are exactly the ones published without route enumeration.

### Station and Platform
A Station is the parent place riders name ("Jay St–MetroTech"); Platforms are its directional children where vehicles actually stop. Realtime and schedule data reference Platforms; user-facing grouping happens by rolling Platforms up to their parent Station at query time.

### Stop-Route Edge
The derived fact that a route serves a stop, computed by joining trips against stop times during ingest. Edges are kept at Platform level; Station-level views aggregate them through the parent relationship.

### Mode
The device's three peer surfaces — rail, bus, bike — navigated by horizontal swipe. Mode is a property of a Feed (explicit data, not inferred from its Adapter): it decides which system a feed's stops appear under in the nearby response. (The Entry Buffer is decided separately, per route_type, not per mode.) A mode with no configured feeds still renders, as the device's empty state.

### Leave-By
The product's headline number: minutes until the rider should start walking, computed server-side as arrival minus Walk Time. Negative leave-by is a real, renderable fact ("too late for this train") — distinct from zero ("leave now") and from no-data. Pre-Phase-5 the walk inputs arrive with the request; the server never guesses them.

### Walk Time
Seconds from a rider's origin to a stop's street entrance, resolved through ordered tiers — manual (rider-supplied, always wins) > heuristic (haversine × 1.3 detour factor at 1.3 m/s) > routed (deferred) — always carrying its `source` so estimated values render differently from confirmed ones, and always incremented by the Entry Buffer.

### Entry Buffer
The systematic seconds between a stop's street entrance and its platform (mezzanine, turnstile, stairs) that no router models: 90 s for rail, 0 for bus and bikeshare. Added to every Walk Time regardless of tier — omitting it is the bias that makes people miss trains.

## Ingest operations

### Sync
The convergence operation that makes a database table match a freshly parsed source: read existing rows, diff in application code, write only changed rows, then Prune. A re-run with unchanged input writes zero rows; a partial failure always leaves a superset of the desired state, repaired by the next successful run.

### Prune
The deletion half of Sync: removing rows no longer present in the source, computed as an explicit delete-set (never a chunked NOT-IN). Guarded — an empty keep-set or a deletion above a sanity threshold refuses to run without an explicit force flag, so a truncated source download cannot wipe a table.

## Worker operations

### Retention Purge
The daily Cron-triggered job that ages out stored location data in two tiers: past the Precise Window it strips raw coordinates from diagnostic rows and deletes stored phone fixes; past the Retention Window it deletes the diagnostic row entirely. The same run sweeps expired sign-in tokens, pairing codes, and stale rate-limit counters. Bounded per invocation and self-latching, so a partial run simply resumes on the next tick.

### Precise Window / Retention Window
The two ages the Retention Purge acts on (14 and 90 days by default). Inside the Precise Window a location row keeps full fidelity; between the two it keeps only the derived metrics that answer *how accurate was the estimate here* — accuracies, delta, provider, timestamp — with no position; past the Retention Window it does not exist.

### Purge Run Record
The single `maintenance_runs` row the Retention Purge upserts on every completed run, including a run that found nothing to do. A stale `last_run_at` is the alert condition — a silently failing cron is indistinguishable from a quiet one without it — and a failed run deliberately leaves the timestamp untouched.
