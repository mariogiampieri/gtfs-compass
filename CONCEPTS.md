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
The named strategy for parsing a Feed's realtime data (e.g., plain GTFS-RT vs. the NYCT-extended variant). Stored per Feed so adding an agency is configuration, not code.

### Station and Platform
A Station is the parent place riders name ("Jay St–MetroTech"); Platforms are its directional children where vehicles actually stop. Realtime and schedule data reference Platforms; user-facing grouping happens by rolling Platforms up to their parent Station at query time.

### Stop-Route Edge
The derived fact that a route serves a stop, computed by joining trips against stop times during ingest. Edges are kept at Platform level; Station-level views aggregate them through the parent relationship.

## Ingest operations

### Sync
The convergence operation that makes a database table match a freshly parsed source: read existing rows, diff in application code, write only changed rows, then Prune. A re-run with unchanged input writes zero rows; a partial failure always leaves a superset of the desired state, repaired by the next successful run.

### Prune
The deletion half of Sync: removing rows no longer present in the source, computed as an explicit delete-set (never a chunked NOT-IN). Guarded — an empty keep-set or a deletion above a sanity threshold refuses to run without an explicit force flag, so a truncated source download cannot wipe a table.
