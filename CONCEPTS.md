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

### Locate Chain
The ordered sequence of position providers behind one interface (`api/src/locate.ts`): the relayed phone fix first, then WiFi trilateration, then `{"known": false}`. Every provider's answer is checked against the one accuracy gate as it arrives, and a rejected answer falls through to the next provider rather than ending resolution — a fix too coarse to trust costs a WiFi lookup, not a failure. The WiFi sub-chain owns the BSSID-hash cache; nothing derived from a credential may be cached above it, because that cache is device-agnostic by construction.

### Fix Quality
Whether a relayed phone position is still *where the user is* (`current`) or only *where they were* (`last_known`), split at a 120-second horizon. Modelled on Garmin's `Position.Quality`: a last-known fix is a distinct state rather than a position with an old timestamp, so the chain prefers anything a live provider resolves and surfaces it only as a labelled fallback carrying its capture time. The device renders the age; it never shows a stale number as current.

## Accounts and auth

### Session
The account-holding credential: an opaque token carried in the `__Host-` cookie, stored hashed, matched to one `sessions` row. Two expirations bound it independently — a 30-day sliding window, renewed only once a request lands past its half-life so a live session does not write to D1 on every read, and a 180-day absolute ceiling anchored to `created_at` that renewal can never push past. Rotated (new row minted, old row destroyed, in one batch) on every authentication, so a Bearer device credential can never be laundered into one and a stolen token has a shrinking window to be replayed.

### Magic Link / Magic Token
The passwordless sign-in credential: a single-use, 10-minute link mailed to the address a rider typed, backed by one `magic_tokens` row keyed on a hashed high-entropy token. Redemption is a conditional `UPDATE ... WHERE used_at IS NULL AND expires_at > now`, not a read-then-write, so a concurrent double-click or a raced retry can win at most once.

### Redeem Nonce
The second, ambient cookie set alongside a Magic Token at request time and matched — not required — at redemption. A match auto-confirms a same-browser redemption with no extra click; a mismatch or an absent cookie (the common case for a link opened from a phone's mail app, a different browser than the one that requested it) falls back to an explicit confirm button instead. Distinct from the magic token itself: holding the nonce alone redeems nothing.

### Owner Predicate
The bindable `WHERE user_id = ?` fragment `authorize()` hands back to every route, scoping a query to the requesting credential's account. Routes never write their own tenancy clause — the predicate is the one place that check lives, so a new endpoint cannot forget it the way an unscoped query once did.

### Single-User Mode
`AUTH_MODE=single`: an auth bypass that binds every request to one fixed synthetic user (`usr_single`, seeded by migration and shared as a contract with `auth.ts`) instead of resolving a session. Meant for a private deployment sitting behind a network-level control, not the open internet — the CSRF and Origin checks still run, but with no credential in play, any client that reaches the Worker hostname is that one user.

### Device Scope
A separately grantable, separately revocable permission on a paired device's Bearer token (`read:departures`, `read:config`, `read:fix`). `read:fix` is never implied by pairing alone — a freshly paired board holds no location grant until a user extends one, so a stolen or second-hand board is not a tracking device by default.

### Unpair
Revoking a paired board from the device list: `devices.revoked_at` is stamped, its scope list is emptied, and its stored fix is cleared. The row itself survives, so the board's token keeps resolving to the same `401` a token that never existed gets, and the account's diagnostic attribution is not orphaned. Turning the `read:fix` scope off on its own performs the second and third of those steps — revocation is a property of the grant, not of the unpair button.

### Relay Seam
The three functions that are allowed to touch `device_fixes` (`api/src/relay.ts`): `putFixForUser` writes the account's latest phone position to every device holding `read:fix`, `getFix` reads one device's row for the locate chain, and `clearFix` deletes it. No SQL against that table exists anywhere else — that is what keeps moving the relay off D1 a three-function change rather than a data migration. A fourth name, `purgeFixesOlderThan`, exists only so the Retention Purge sweeps the table in bounded batches through the seam rather than with SQL of its own.

### Relay Post
The account-scoped write that puts a phone's position into the Relay Seam: `POST /v1/locate/ref` with `relay: true`, session-authenticated, **naming no device**. The session says whose position it is and the `read:fix` grant list says which boards receive it, so the request has no ownership parameter to validate and the config UI needs no device picker. It short-circuits the diagnostic pairing lookup — a phone posting its position has no device WiFi scan from the last 60 seconds in the normal case — and is budgeted per session and per client network, being the highest-frequency write in the system.

### Locate Log Attribution
Recording *who* an inserted `locate_log` row belongs to (`user_id`, plus `device_row_id` when a paired board wrote it), populated from the resolved credential and left NULL on the anonymous path. It exists so "delete all my location history" has rows to delete, and it splits the daily insert cap into two identity spaces that never merge: a client-chosen `device_id` for anonymous rows, a server-minted id for attributed ones. Merging them would let an anonymous caller who learns a board's id burn its cap and write into an identified user's history.

### Send Budget
The sharded daily counter set (`auth_budgets`) gating magic-link delivery: a per-address cap charged first, then a global cap split into a `known` slice (addresses with an existing account) and a smaller `unknown` slice. The split exists so spraying unknown addresses cannot exhaust the shared daily cap and lock out real users — it costs only the attacker's own slice. A separate `send:failure` scope counts delivery failures rather than requests and is retained past the daily sweep that clears the others, because it is the only durable signal that a mail-provider outage happened.

### Config ETag Pair
The two version counters a device's config fetch is conditioned on together: `users.config_version`, bumped by every favorites/origins/walk_times write, and `feeds.data_version`, stamped by ingest when a feed's static data changes. Both halves are required — the first alone would let a recolored route serve stale to the device forever.
