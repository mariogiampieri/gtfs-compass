# gtfs-compass

A pocket transit timer. A small battery-powered device (Waveshare ESP32-S3
AMOLED) shows "minutes until you should leave" for your favorite stops. A
Cloudflare Worker + Durable Object layer does all the heavy lifting —
normalizing GTFS-Realtime and GBFS feeds into tiny JSON the device can render
in under a second.

**Project status: early.** Phase 1 (data model + ingest) is built. The
realtime layer (Durable Objects), read API, firmware, and config UI are
specified in [`docs/plans/01-guiding-spec.md`](docs/plans/01-guiding-spec.md)
and land in later phases.

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
  configured feeds (v1: NYC subway), and loads stops, routes, and
  stop-to-route edges into D1 over the HTTP API. Idempotent: re-running with
  unchanged sources writes zero rows.
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
uv run gtfs-compass-ingest all             # catalog + NYC subway static data
```

A full run seeds the feeds catalog, then loads ~1,500 subway stops,
29 routes, and ~2,000 stop-route edges. Verify with:

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

Then poke it (this is a debug surface — the public `/v1` API is Phase 3):

```bash
curl "https://gtfs-compass-api.<your-subdomain>.workers.dev/internal/mta-subway/ace/stop/A32N"
```

The first call returns `{"fetched_at":null,...}` (no data yet) and wakes the
poll loop; within ~20 seconds the same call returns live arrivals as epoch
seconds. `fetched_at` is the fetch time of the snapshot — devices treat data
older than 90 s as stale. A feed whose upstream freezes (HTTP 200 but a
non-advancing header timestamp) goes visibly stale rather than being
re-stamped fresh.

**No authentication yet.** The `/internal/*` route is public until the
device-token model lands (Phase 3/5); it is limited to the curated feed
allowlist and per-IP rate limiting, and exposes only already-public transit
arrival times. Self-hosters uncomfortable with that can simply not deploy
until Phase 3.

## Feed data licensing

This project redistributes transit data published by agencies under their
own terms. The catalog stores each feed's license URL (`feeds.license_url`)
precisely because terms vary — surface it wherever feed data is shown.
NYC subway data comes from the
[MTA's developer feeds](https://www.mta.info/developers).

## License

MIT — see [LICENSE](LICENSE). (The code is MIT; transit data remains under
each agency's terms.)
