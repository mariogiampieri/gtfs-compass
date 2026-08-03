# gtfs-compass

A pocket transit timer. A small battery-powered device (Waveshare ESP32-S3
AMOLED) shows "minutes until you should leave" for your favorite stops. A
Cloudflare Worker + Durable Object layer does all the heavy lifting —
normalizing GTFS-Realtime and GBFS feeds into tiny JSON the device can render
in under a second.

**Project status: early.** Phase 1 (data model + ingest), Phase 2 (realtime
Durable Objects), and Phase 3 (the `/v1/nearby` read API, the `/v1/departures`
leave-by timer endpoint with server-side walk times, WiFi geolocation,
and Citi Bike GBFS) are built. Firmware and the config UI are specified in
[`docs/plans/01-guiding-spec.md`](docs/plans/01-guiding-spec.md) and land in
later phases.

## Architecture at a glance

```
Mobility Database CSV ─┐
                       ├─> ingest/ (Python, cron) ─> Cloudflare D1
MTA static GTFS zip  ──┘                                 │
                                                         v
                              api/ (Cloudflare Worker + Durable Objects,
                               Phase 2+: GTFS-RT parsing, /v1 endpoints)
                                                         │
                                                         v
                                        firmware/ (ESP32, Phase 4)
```

- **`ingest/`** — Python package, run on a cron box. Seeds a catalog of
  ~2,800 active transit feeds (with bounding boxes and license URLs) from the
  [Mobility Database](https://mobilitydatabase.org/), parses static GTFS for
  configured feeds (v1: NYC subway, plus Citi Bike station information via
  GBFS), derives per-direction headsigns from `trips.txt`, and loads stops,
  routes, and stop-to-route edges into D1 over the HTTP API. Idempotent:
  re-running with unchanged sources writes zero rows.
- **`api/`** — owns the D1 database schema via wrangler migrations, and (as
  of Phase 2) the realtime layer: a Worker plus one Durable Object per feed
  group that polls GTFS-RT on a 20-second alarm loop while devices are
  reading, self-suspends after 10 idle minutes, and serves per-stop arrival
  lists with an honest `fetched_at`. Reads never block on the upstream —
  the first poll returns last-known data instantly and refreshes behind.
- Nothing assumes a single agency: every table keys on `feed_id`, route
  colors come from feed data, and adding a second agency is configuration,
  not code.

## Getting started

Prerequisites: a Cloudflare account (free tier is fine), Node.js 18+, and
[uv](https://docs.astral.sh/uv/) (or any Python 3.11+ with pip).

### 1. Create the database and apply the schema

```bash
cd api
npm install
npx wrangler login                 # one-time browser auth
npx wrangler d1 create gtfs-compass
```

Copy the printed `database_id` into `api/wrangler.jsonc`, then:

```bash
npm run migrate:remote             # applies migrations to your real D1
npm run migrate:local              # optional: local copy for development
```

### 2. Configure the ingest job

```bash
cp .env.example .env               # then fill in the three required values
```

You need your account id, the database id from step 1, and an API token
scoped to **Account -> D1 -> Edit** only (see `.env.example` for exact
steps). The `.env` file is gitignored — never commit real credentials.

### 3. Run the ingest

```bash
cd ingest
uv sync
set -a; source ../.env; set +a
uv run gtfs-compass-ingest --dry-run all   # parse everything, write nothing
uv run gtfs-compass-ingest all             # catalog + subway static + Citi Bike stations
```

A full run seeds the feeds catalog, then loads ~1,500 subway stops,
29 routes, ~2,000 stop-route edges, per-direction headsigns, and ~2,000+
Citi Bike stations with dock capacity. Verify with:

```bash
cd ../api
npx wrangler d1 execute gtfs-compass --remote \
  --command "SELECT s.name, group_concat(sr.route_id) FROM stops s
             JOIN stop_routes sr ON sr.feed_id = s.feed_id AND sr.stop_id = s.stop_id
             WHERE s.name LIKE 'Jay St%' GROUP BY s.stop_id"
```

### 4. Schedule it (optional)

Static GTFS and the feed catalog change rarely; daily is plenty. On the box
that runs the job:

```cron
15 4 * * * cd /path/to/gtfs-compass/ingest && set -a && . ../.env && set +a && uv run gtfs-compass-ingest all >> ~/gtfs-compass-ingest.log 2>&1
```

Overlapping runs are safe: a local lock and a D1-side lock row make the
second run exit immediately. A failed run leaves convergent state that the
next successful run repairs — and guard rails refuse large prunes (e.g. a
truncated download) unless you pass `--force`.

## Realtime layer (Phase 2)

The Worker needs the **Workers Paid plan** (~$5/mo — chosen for the 30 s CPU
budget and no hard daily caps; actual metered usage is pennies). Deploy:

```bash
cd api
npm install --legacy-peer-deps
npm run generate:proto   # only when proto/ changes; output is committed
npm test                 # unit + workerd-pool suites
npm run deploy
```

Then poke it (this is an operator debug surface; the public `/v1` API is
documented below):

```bash
curl "https://gtfs-compass-api.<your-subdomain>.workers.dev/internal/mta-subway/ace/stop/A32N"
curl "https://gtfs-compass-api.<your-subdomain>.workers.dev/internal/citibike/all/station/<station-id>"
curl "https://gtfs-compass-api.<your-subdomain>.workers.dev/internal/mta-subway/alerts/route/A"
```

`npm run deploy` applies any pending D1 migrations first — new Worker code
never runs against an unmigrated database.

The first call returns `{"fetched_at":null,...}` (no data yet) and wakes the
poll loop; within ~20 seconds the same call returns live arrivals as epoch
seconds. `fetched_at` is the fetch time of the snapshot — devices treat data
older than 90 s as stale. A feed whose upstream freezes (HTTP 200 but a
non-advancing header timestamp) goes visibly stale rather than being
re-stamped fresh.

**No authentication yet.** The `/internal/*` and `/v1/*` routes are public
until the device-token model lands (Phase 5); they are limited to the
curated feed allowlist (`vars.CURATED_FEEDS` in `api/wrangler.jsonc`) and
per-IP rate limiting, and expose only already-public transit data. The
locate diagnostics surfaces are additionally gated by a `DIAG_TOKEN` Worker
secret (see `.env.example`).

## The read API (Phase 3)

One endpoint does the thinking; the device is a dumb renderer.

**`GET /v1/nearby?lat=&lon=&modes=rail,bus,bike`** — nearby stations with
realtime arrivals, grouped into color trunks with per-train headsigns,
direction labels, pre-formatted distance labels, and bike station counts:

```bash
curl "https://gtfs-compass-api.<your-subdomain>.workers.dev/v1/nearby?lat=40.6923&lon=-73.9873&modes=rail,bike"
```

**`POST /v1/nearby`** — the device path: one round trip from WiFi scan to
board. The body carries the scan; the Worker resolves a position and
composes the same response (plus the resolved `location`):

```bash
curl -X POST "https://gtfs-compass-api.<your-subdomain>.workers.dev/v1/nearby" \
  -H 'content-type: application/json' \
  -d '{"wifiAccessPoints": [{"macAddress": "aa:bb:cc:dd:ee:ff", "signalStrength": -60}, ...]}'
```

An unresolvable location returns `422 {"error": "location unknown"}` —
distinct from a located-but-empty board. Each system carries `fetched_at`
(the oldest upstream snapshot consulted, `null` when never fetched) and
`partial: true` while any feed group is still cold, so the device never
shows stale data as live. When the bike status source is unavailable,
`bikes_classic`/`bikes_electric`/`docks_open` are `null` (capacity stays
real) — `null` means "no data", `0` means "actually empty".

Rail trunks carry live **service alerts** from the
[MTA's Mercury alerts feed](https://api.mta.info/):
`alert: {"severity": "delay"|"info", "text": "...", "directions": [0,1]}`.
`"delay"` marks active disruptions (delays, suspensions, skipped stops,
reduced service); planned work and notices render as `"info"`. Only alerts
whose active period covers *now* are shown, scoped to the station when the
alert names specific stops. `alert: null` means no active alert **or** the
alerts source is down/stale (older than 30 minutes) — the device renders
those identically by design. `note` remains a null stub.

**`POST /v1/locate`** — the bare geolocation step, for diagnostics and the
config UI:

```bash
curl -X POST "https://<worker-host>/v1/locate" -H 'content-type: application/json' \
  -d '{"wifiAccessPoints": [{"macAddress": "aa:bb:cc:dd:ee:ff", "signalStrength": -60}, ...]}'
```

`POST /v1/locate/ref` and `GET /v1/locate/log` support the accuracy walk
described in the spec. They — and `log: true` on `/v1/locate` — require the
`DIAG_TOKEN` secret as a Bearer header (query-param tokens are rejected):

```bash
# 1. log an estimate for a device (within 60 s of step 2)
curl -X POST "https://<worker-host>/v1/locate" \
  -H "Authorization: Bearer $DIAG_TOKEN" -H 'content-type: application/json' \
  -d '{"wifiAccessPoints": [...], "log": true, "device_id": "<opaque-id>", "label": "platform"}'
# 2. pair the phone's reference position; the API computes delta_m
curl -X POST "https://<worker-host>/v1/locate/ref" \
  -H "Authorization: Bearer $DIAG_TOKEN" -H 'content-type: application/json' \
  -d '{"device_id": "<opaque-id>", "lat": 40.6923, "lon": -73.9873, "accuracy": 5}'
# 3. read the paired rows
curl "https://<worker-host>/v1/locate/log?device_id=<opaque-id>" \
  -H "Authorization: Bearer $DIAG_TOKEN"
```

### Location privacy

Submitted BSSIDs (WiFi MAC addresses) are **forwarded to
[BeaconDB](https://beacondb.net)**, a third-party community geolocation
service, to resolve a position — that is their only use. This project never
stores BSSIDs: only a one-way hash of the scanned set lives in a 10-minute
in-memory cache, and only a *count* of access points appears in diagnostic
rows. Operator-initiated diagnostic logging (`log: true`, `DIAG_TOKEN`
required) stores the resolved position estimate; those rows currently
persist until the Phase 5 retention purge ships. BeaconDB is explicitly
experimental (no SLA) — an unavailable provider degrades to
`{"known": false}` and the device falls back to its favorite-stop behavior.

> Note: the guiding spec's 500-byte payload budget applies to the
> favorites-departures endpoint below; `/v1/nearby` is a richer
> explore-first payload (~15–25 KB) fetched over WiFi.

## The leave-by timer endpoint

**`GET /v1/departures`** — the favorites poll: server-computed arrival and
leave-by minutes for device-held stops, in the spec's compact shape. Until
Phase 5 lands accounts, favorites live on the device and the request carries
everything the server needs:

```bash
# Arrivals only
curl "https://<worker-host>/v1/departures?stops=mta-subway:A41N,mta-subway:A41S&n=3"
# With hand-tuned walk seconds per stop (the manual tier — always wins)
curl "https://<worker-host>/v1/departures?stops=mta-subway:A41N,mta-subway:A41S&walk=mta-subway:A41N:420,mta-subway:A41S:420"
# With an origin fix for the heuristic tier (all three params required together)
curl "https://<worker-host>/v1/departures?stops=mta-subway:A41N&lat=40.6923&lon=-73.9873&acc=30"
```

Parameters: `stops=` is a comma list of **namespaced refs** `<feed_id>:<stop_id>`
(max 20 — this diverges deliberately from the spec's bare-id sketch so
mixed-agency favorites work in one call); `n=` is arrivals per stop+route
(1–8, default 3); `walk=` carries `<feed>:<stop>:<seconds>` triplets
(0–7200, each ref must appear in `stops=`); `lat`/`lon`/`acc` supply an
origin for the walk heuristic — `acc` (accuracy, meters) is required, and an
origin coarser than `LOCATE_MAX_ACCURACY_M` (default 500) is ignored, never
trusted silently. Validation is fail-loud: any malformed ref, unknown or
non-rail feed, or out-of-range value rejects the whole request with 400 and
a specific error. Bike favorites are `/v1/nearby` territory.

```json
{"ts":1754236082,"fetched_at":1754236075,
 "d":[{"s":"mta-subway:A41N","r":"A","c":"0039A6","t":"FFFFFF","m":[3,11,18],"l":[1,9,16]},
      {"s":"mta-subway:A41S","r":"A","c":"0039A6","t":"FFFFFF","m":[6,14],"l":[4,12]}],
 "w":{"mta-subway:A41N":{"s":510,"src":"manual"},
      "mta-subway:A41S":{"s":510,"src":"manual"}}}
```

Response semantics the device renders directly (no time math beyond
decrementing between polls):

- `d` has one entry per (stop, static route); `s` is the namespaced ref,
  `r` the route label, `c`/`t` bare `RRGGBB` colors from the feed (palette
  fallback when the feed omits them).
- `m` is arrival minutes, clamped at 0, ascending. **Empty `m` means no
  upcoming service** (render a dash) — a different fact from a 0-minute
  arrival.
- `l` (present only when walk context exists) is leave-by minutes aligned
  index-for-index with `m`, computed as `floor((arrival − walk_s − now)/60)`
  and **unclamped — negative means you've missed that train**, which renders
  differently from both 0 ("leave now") and no data.
- `w` reports the walk seconds actually applied per stop and their `src`
  (`"manual"` or `"heuristic"`). Every walk value already includes the entry
  buffer (90 s for rail, 0 for bus/bikeshare) — the street-entrance-to-
  platform seconds no router models.
- `fetched_at` is the oldest realtime snapshot consulted (`null` when never
  fetched); `partial: true` appears while any needed feed group is cold or
  failing. The staleness contract is unchanged: data older than 90 s renders
  as stale.

Payload size: the representative favorites poll (two platforms, two routes
each, `n=3`, walk overlay) is pinned under **500 bytes** by a test. That is
a target for the typical case, not a maximum — at the caps (20 refs, busy
multi-route platforms, `n=8`) the worst case is on the order of **15 KB**,
so firmware should size receive buffers to the worst case and treat 500 B
as the norm.

Origin coordinates and walk parameters are request-scoped only: never
persisted, never logged (the same posture as BSSIDs on `/v1/locate`).

## Feed data licensing

This project redistributes transit data published by agencies under their
own terms. The catalog stores each feed's license URL (`feeds.license_url`)
precisely because terms vary — surface it wherever feed data is shown.
NYC subway data comes from the
[MTA's developer feeds](https://www.mta.info/developers). Citi Bike station
data is used under the
[Citi Bike data sharing policy](https://citibikenyc.com/data-sharing-policy).

## License

MIT — see [LICENSE](LICENSE). (The code is MIT; transit data remains under
each agency's terms.)
