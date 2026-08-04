# gtfs-compass

A pocket transit timer. A small battery-powered device (Waveshare ESP32-S3
AMOLED) shows "minutes until you should leave" for your favorite stops. A
Cloudflare Worker + Durable Object layer does all the heavy lifting —
normalizing GTFS-Realtime and GBFS feeds into tiny JSON the device can render
in under a second.

**Project status: early.** Phase 1 (data model + ingest), Phase 2 (realtime
Durable Objects), and Phase 3 (the `/v1/nearby` read API, the `/v1/departures`
leave-by timer endpoint with server-side walk times, WiFi geolocation,
and Citi Bike GBFS) are built, with all three NYC systems live — subway,
**MTA Bus** (six static GTFS sources + the citywide Bus Time realtime feed),
and Citi Bike. Phase 4 (firmware) and Phase 5 (accounts, pairing, and the
config UI) are in progress — the config UI currently ships its shell, its
sign-in form, device pairing, the device list, a local location check, and the
button that relays this phone's position to the boards you granted it to.
Everything is specified in
[`docs/plans/01-guiding-spec.md`](docs/plans/01-guiding-spec.md).

## Architecture at a glance

```
Mobility Database CSV ─┐
                       ├─> ingest/ (Python, cron) ─> Cloudflare D1
MTA static GTFS zip  ──┘                                 │
                                                         v
                              api/ (Cloudflare Worker + Durable Objects,
                               Phase 2+: GTFS-RT parsing, /v1 endpoints;
                               also serves config-ui/ as static assets)
                                                         │
                                    ┌────────────────────┴────────────┐
                                    v                                 v
                        firmware/ (ESP32, Phase 4)      config-ui/ (PWA, Phase 5)
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
- **`config-ui/`** — the configuration PWA, plain HTML/CSS/ES modules with no
  framework and no bundler. Built to `config-ui/dist/`, which the Worker
  serves as static assets on the same origin as `/v1/*`.
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
29 routes, ~2,000 stop-route edges, per-direction headsigns, the MTA bus
network (~12–16k stops and several hundred routes merged from six borough
zips into the single `mta-bus` feed), and ~2,000+ Citi Bike stations with
dock capacity. Verify with:

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

**The transit routes are unauthenticated, and stay that way.** `/internal/*`
and the transit `/v1/*` routes serve already-public transit data and answer
identically whether or not a credential is presented — a paired device changes
nothing about them. They are limited to the curated feed allowlist
(`vars.CURATED_FEEDS` in `api/wrangler.jsonc`) and per-IP rate
limiting. The locate diagnostics surfaces are gated by a
`DIAG_TOKEN` Worker secret (see `.env.example`). Accounts exist on
`/v1/auth/*` — see [Signing in](#signing-in) — devices get their own scoped
credentials through [pairing](#pairing-a-device), and everything user-owned
that arrives in later milestones goes behind them.

## The read API (Phase 3)

One endpoint does the thinking; the device is a dumb renderer.

**`GET /v1/nearby?lat=&lon=&modes=rail,bus,bike`** — nearby stations with
realtime arrivals, grouped into color trunks with per-train headsigns,
direction labels, pre-formatted distance labels, and bike station counts.
All three modes are live: bus stops split arrivals by the trip's
`direction_id` (curb stops have no platform suffixes) with headsigns from
the static schedule's dominant per-direction labels, and render with
`direction_labels: null` — the device shows compass tags:

```bash
curl "https://gtfs-compass-api.<your-subdomain>.workers.dev/v1/nearby?lat=40.6923&lon=-73.9873&modes=rail,bus,bike"
```

**MTA Bus Time key:** MTA
[documents](https://bustime.mta.info/wiki/Developers/GTFSRt) an API key as
required for the bus realtime feed but does not currently enforce it
(verified live 2026-08-03). The Worker polls keyless until a key is
installed as the `RT_FEED_KEYS` secret (see `.env.example`); a keyless
401/403 logs a distinct warning so enforcement onset is visible, and the
feed then degrades to labeled staleness — never wrong data.

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

It answers `{"known": true, "lat": …, "lon": …, "accuracy": …, "provider": …}`
or `{"known": false}` — never a position the API cannot vouch for. Providers
are tried in order and each answer is checked against `LOCATE_MAX_ACCURACY_M`
on its own: a fix too coarse to trust is *skipped* and the next provider is
consulted, not turned into a failure.

A board that sends its device token and holds the `read:fix` grant is resolved
from the phone position its owner last relayed **before** WiFi is consulted,
and that answer carries two extra fields:

```json
{"known": true, "lat": 40.6923, "lon": -73.9873, "accuracy": 12,
 "provider": "phone", "captured_at": 1785000000, "quality": "current"}
```

`captured_at` is when the *phone* fixed the position (epoch seconds, not when
the Worker heard about it) and `quality` is `"current"` inside a 120-second
horizon, `"last_known"` past it. A last-known fix is a distinct state, not a
position with an old timestamp: the chain prefers anything a live provider can
resolve and returns it only when nothing else does, labelled so the device
renders "via phone, 3 min ago" instead of a silently stale number. The horizon
is measured from when the Worker received the fix, so a phone whose clock runs
fast cannot stretch it, and a last-known fix has a hard ceiling of **4 hours**:
past that it is treated as absent, the chain falls through to WiFi and then to
`{"known": false}`, and no board is ever given a departure time computed from a
position the user left this morning. Anonymous
requests, boards that were never granted `read:fix`, and boards whose grant was
revoked get exactly the WiFi response above — the grant governs the read as
well as the relay, so a revocation takes effect on the board's very next call.
`/v1/nearby` resolves through the same chain and echoes the same fields in its
`location` object; both fields are absent whenever the position did not come
from a phone.

**`POST /v1/locate/ref` with `relay: true`** — the write half of the relay, and
the only client that can produce a fix is a phone. It is **session-only**: the
request names no device, the signed-in session says whose position it is, and
the server writes it to every board on that account holding `read:fix`. There
is no device parameter to get wrong and no device picker in the UI.

```bash
curl -X POST "https://<worker-host>/v1/locate/ref" \
  -H 'content-type: application/json' -H 'X-GC-CSRF: 1' \
  -H "Origin: https://<worker-host>" -b "__Host-gc_session=<token>" \
  -d '{"relay": true, "lat": 40.6923, "lon": -73.9873, "accuracy": 12,
       "captured_at": 1785000000}'
# → {"relayed": {"devices": 2, "stored": 2}}
```

`devices` is how many boards were targeted and `stored` how many actually took
this position. They differ in one case, and it is the case the store exists to
handle: a board already holding a *strictly more accurate* fix from inside the
120-second horizon keeps it, so a phone that briefly falls back to cell-tower
accuracy cannot erase the good position the board is about to read. The config
UI says so rather than reporting a delivery that did not replace anything.

`accuracy` is stored exactly as the phone reported it — the accuracy gate lives
at read time so a coarse fix falls through to the next provider instead of
being lost — and `captured_at` (epoch **seconds**, optional, defaults to
receipt) is what `quality` is measured from. Posts are budgeted per **account**
and per client network per day (`RELAY_BUDGET_USER`, and
`RELAY_BUDGET_IP_FRESH` / `_REPEAT`); the client sends at most about once a
minute, and the budget is the backstop rather than the mechanism. The account is
the enforcing key because a session is not scarce — one mailbox can redeem
several sign-in links a day — and the network cap is *split* for the same reason
the pairing caps are: that key is shared with every other subscriber behind the
same CGNAT /24, so one account must not be able to spend it and 429 the rest.
`DIAG_TOKEN` cannot relay: it names no user, and an operator post would need a
caller-supplied `user_id` — exactly the ownership parameter the account-scoped
design removes.

**A phone-sourced answer is never written to the diagnostic log.** `log: true`
on `/v1/locate` records the *WiFi estimate* a walk produces, so that
`/v1/locate/ref` can pair a phone reference against it and compute `delta_m`;
when the relay answered, there is no estimate — the chain returned before WiFi
was consulted — and a row whose estimate *is* the phone reference would be a
durable copy of the most precise position in the system, in a table that
revoking `read:fix` does not clear. The relayed position lives in exactly one
place, and turning the permission off deletes it.

`POST /v1/locate/ref` with `log: true` and `GET /v1/locate/log` support the
accuracy walk described in the spec. They — and `log: true` on `/v1/locate` —
accept the `DIAG_TOKEN` secret as a Bearer header (query-param tokens are
rejected):

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

A signed-in browser or a paired board may also log an estimate, in which case
the row records **who** it belongs to (`user_id`, and `device_row_id` for a
board) so that "delete all my location history" has something to delete. Those
attributed rows live in a different identity space from the anonymous ones:
the daily insert cap counts each space separately, so an anonymous caller who
learns a board's id cannot burn that board's cap or write into its owner's
history. `GET /v1/locate/log` is the operator surface and returns **only the
unattributed rows** — `DIAG_TOKEN` names no user, so the rows that belong to
one are not its to read.

### Location privacy

Submitted BSSIDs (WiFi MAC addresses) are **forwarded to
[BeaconDB](https://beacondb.net)**, a third-party community geolocation
service, to resolve a position — that is their only use. This project never
stores BSSIDs: only a one-way hash of the scanned set lives in a 10-minute
in-memory cache, and only a *count* of access points appears in diagnostic
rows. That cache is keyed on the access points alone, so two boards in one
household share its entries — which is why nothing derived from a credential
is ever stored in it, and why a relayed phone position (looked up per device)
sits above it rather than inside it. Diagnostic logging (`log: true`, which
takes `DIAG_TOKEN`, a session, or a paired board's token — never nothing at
all) stores the resolved position estimate, attributed to the account when the
caller had one — but **never a phone-relayed position**, which lives only in the
row the `read:fix` toggle deletes. Those diagnostic rows are aged out on a
schedule — see
[Data retention](#data-retention). A relayed phone position is stored as one
row per receiving board, replaced in place rather than accumulated, and aged
out on the same schedule. BeaconDB is explicitly
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
 "d":[{"s":"mta-subway:A41N","r":"A","c":"0039A6","t":"FFFFFF","m":[3,11,18],"l":[-5,3,10]},
      {"s":"mta-subway:A41S","r":"A","c":"0039A6","t":"FFFFFF","m":[6,14],"l":[-3,5]}],
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

One request may consult every feed group its stops span (up to all eight
NYCT groups); each read arms that group's 20-second poll loop, which
self-suspends after 10 idle minutes. That wake amplification is the
accepted pre-auth cost posture — bounded by the per-IP rate limit and the
curated-feed allowlist, and closed properly by Phase 5 device tokens.

## Firmware (Phase 4)

The device is a Waveshare ESP32-S3-Touch-AMOLED-2.06 running the explore
board as a dumb renderer: WiFi scan → one `POST /v1/nearby` → LVGL. Code
lives in `firmware/` — `components/model` and `components/ui` are
platform-free (shared with the desktop simulator), `main/` is the device
glue on the vendor BSP.

### Prerequisites (macOS)

```bash
brew install cmake ninja dfu-util sdl2
git clone -b v5.5.5 --recursive https://github.com/espressif/esp-idf.git ~/esp/esp-idf
~/esp/esp-idf/install.sh esp32s3
```

### Simulator (no hardware needed)

```bash
git submodule update --init          # LVGL 9.5, pinned
cd firmware/sim && cmake -B build -G Ninja . && cmake --build build
./build/sim                          # renders fixtures/live-jay-st.json
```

Keys (routed through the same navigation code the device gestures use):

| Key       | Action                                              |
| --------- | --------------------------------------------------- |
| `h` / `l` | previous / next system (rail ↔ bus ↔ bike, clamped) |
| `j` / `k` | next / previous stop (rail board)                   |
| `Enter`   | open the trunk detail for the first trunk           |
| `Esc`/`b` | back to the board                                   |
| `d`       | flip direction (global)                             |
| `1`–`5`   | loading / live / stale / offline / no-location      |
| `f`       | toggle the refresh flash · `q` quit                 |

The mouse drives the same gesture tracker and tap/swipe routing as the
device touch panel: swipe left/right for systems, up/down for stops, tap a
trunk row for detail, tap the `⇅` pill to flip, tap the bike screen for the
nearby list, tap a nearby row to make that station current (`‹ back` or a
horizontal swipe exits without changing it). Capture a fresh live fixture with
`curl <worker>/v1/nearby?lat=..&lon=.. > firmware/fixtures/name.json`.

Headless capture: `GC_DUMP=/tmp/f.ppm ./build/sim` renders one frame and
exits; `GC_VIEW=detail[:N] | bike | bus | nearby` sets the view first and
`GC_DIR=1` flips the rendered direction, so
every screen is reachable without a window.

The sim build also produces `./build/test_input`, a headless scripted-pointer
suite for the gesture tracker (run in CI).

### Device build, flash, provision

```bash
cd firmware
. ~/esp/esp-idf/export.sh
idf.py build
idf.py -p /dev/cu.usbmodem* flash monitor
```

WiFi credentials are stored in the device's NVS, never in the repo. Two
ways to provision:

- **Serial console** (works any time): in the monitor, type
  `wifi_set <ssid> <password>` — the device stores the credentials and
  restarts its network path. `wifi_clear` erases; `gc_status` shows state.
- **Dev seed**: create a gitignored `firmware/sdkconfig.local` with
  `CONFIG_GC_WIFI_SSID`/`CONFIG_GC_WIFI_PASSWORD` and build with
  `SDKCONFIG_DEFAULTS="sdkconfig.defaults;sdkconfig.local"` — seeded into
  NVS on first boot only.

To pin the board to a fixed location (e.g. test a station you're not at,
or work around thin BeaconDB coverage in your area), type
`loc_set <lat> <lon>` in the console — the device then uses the GET path
and skips WiFi scanning; `loc_clear` returns to scan-based location.
A build-time seed via `CONFIG_GC_DEV_FIXED_LAT`/`_LON` (same
`sdkconfig.local` mechanism) behaves identically; the console value wins
when both exist.

### Host tests

```bash
cd firmware/test/host && cmake -B build -G Ninja . && cmake --build build
./build/test_model                   # model parser suite (ASAN)
./build/test_nav                     # navigation/reconciler transitions
./build/test_bike_layout             # bike hero/capacity-bar math
```

(The sim build also produces `firmware/sim/build/test_input`, the headless
gesture-tracker suite.)

### Fonts

The UI renders IBM Plex Sans (OFL 1.1) converted to LVGL bitmap faces at
the design ramp with tabular numerals. The generated `.c` files live in
`firmware/components/ui/fonts/` and are committed, so ordinary builds need
nothing extra. To change sizes, weights, or glyph ranges, edit and re-run
`firmware/tools/genfonts.sh` (needs node + curl + unzip; it downloads the pinned
TTF releases into a gitignored cache). Attribution and license text:
`firmware/components/ui/fonts/README.md` and `OFL.txt`.

## Config UI (Phase 5)

`config-ui/` is the configuration PWA. It is served as **static assets by the
same Worker** that serves `/v1/*`, so it is same-origin with the API: no CORS
to configure, and the session cookie is first-party.

Today it holds the shell, the sign-in form (which posts an address to
`POST /v1/auth/request` and never says whether that address has an account —
the emailed link is redeemed by a separate Worker-served page), the **pairing
screens** and the **device list** described below, and the location check.
Favorites and walk-time editing land in a later milestone.

**Pairing a board from the browser.** The device shows an eight-letter code and
sends you to `/pair`, which is this same shell with the cursor in the code box.
Typing a code shows a **confirm screen** first: it names the board — as text
the device reported and nothing has verified — and says plainly that a code
must come off a screen you are holding, because the attack this step exists to
stop (RFC 8628 §5.4) is a code read to you over the phone. Nothing is bound
until you confirm.

**The device list** shows every board on the account with its name, firmware
version, when it was paired, when it last called home, a checkbox per
permission, and an unpair button. The `read:fix` checkbox is the one that
matters and it says so: turning it on means *this device will receive your
phone's live position* until you turn it off, and turning it off both stops
that and deletes the position already sent to that board.

**The location card has two buttons, and they do different things.** *Check my
location* reads this phone's position and shows the raw accuracy — nothing
leaves the phone. *Send my position to my devices* posts that same reading to
every board holding the `read:fix` grant, and says how many received it,
including "no device is set to receive it" when the answer is none — and how
many actually took it, because a board holding a more accurate position from the
last couple of minutes keeps that one, and "each keeps this position" would be
the wrong sentence for a board still showing an earlier reading. It is
gesture-triggered, throttled to about one send a minute, and never runs on its
own; a board with the grant switched off is not a recipient, and switching it
off deletes the position that board already had.

The other two checkboxes are labelled **recorded, but not enforced yet**, and
the label is deliberate. `/v1/departures` and `/v1/nearby` are anonymous by
design and name no scope, and a board's own config read does not exist yet, so
unchecking "Arrival times" today stores your choice without stopping the board
from displaying arrivals. Same rule the API applies to stale data: say so
rather than show a control that quietly does nothing. The label goes when
those routes start checking the grant.

Prerequisites: Node.js 18+ — nothing else. There is no framework and no
bundler; the UI is hand-written HTML, CSS, and native ES modules, and the
"build" copies `config-ui/src/` to `config-ui/dist/` and fails if any emitted
HTML contains an inline `<script>`, an inline `<style>`, an `on*` handler, or
an inline `style` attribute. That last part is the point: the assets are
served without passing through the Worker, so they can never carry a
per-request CSP nonce, and the policy they ship under is `script-src 'self'`
/ `style-src 'self'` with no `unsafe-inline` escape hatch.

```bash
cd config-ui
npm install
npm run check        # build + tests (this is the CI gate)
npm run build        # dist/ only
```

You rarely need to run the build by hand: `api`'s `test`, `dev`, and `deploy`
scripts all build the UI first, because `dist/` is generated and not
committed.

```bash
cd api && npm run dev     # builds config-ui, then serves UI + API together
```

Routing, configured in `api/wrangler.jsonc`:

| Path | Served by |
|---|---|
| `/v1/*`, `/internal/*` | the Worker, always (`assets.run_worker_first`) — including when a file of the same name exists in `dist/` |
| an unknown `/v1/*` path | the Worker's JSON `404`, **never** the SPA shell |
| `/`, `/app.js`, any other path | static assets, with unknown paths falling back to the shell (`not_found_handling: "single-page-application"`) |

That ordering is not cosmetic: without the first row, a file that happened to
be named `v1/nearby` would shadow the API and hand a device HTML where it
expects JSON — the worst possible way for a device parser to fail.
`api/test/unit/asset-routing.test.ts`
runs a real `wrangler dev` and asserts each row — the workerd test pool
bypasses the asset router entirely, so those assertions cannot live with the
rest of the Worker tests.

Security headers for the static side come from `config-ui/src/_headers`
(CSP, `nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`).
The Worker-served sign-in callback is a separate route with its own
nonce-based CSP.

### Signing in

There are no passwords. You type an address, the Worker mails a single-use
link, and opening it signs the browser in.

| Route | What it does |
| --- | --- |
| `POST /v1/auth/request` | Ask for a link. **Always** answers `200 {"ok":true}` |
| `GET /v1/auth/callback` | The Worker-served interstitial the emailed link opens |
| `POST /v1/auth/redeem` | The only thing that consumes a token |
| `POST /v1/auth/signout` | Revokes the session server-side and clears the cookie |
| `GET /v1/auth/mode` | `{"auth_mode":"single"\|"multi"}` — drives the single-user banner |

Requesting a link requires a configured mail provider — set
`AUTH_EMAIL_PROVIDER` (and its provider's variables) as described in
`.env.example`. With none set, sign-in is disabled outright and
`/v1/auth/request` answers `503`; there is deliberately no fallback that
prints tokens. For local work, `AUTH_EMAIL_PROVIDER=console` prints the link
to the Worker log and refuses to start without an `AUTH_ALLOWED_EMAILS` list.

**Out of the box, sign-up is open to the internet.** `AUTH_ALLOWED_EMAILS`
ships unset, and an empty allowlist means anyone who can reach the Worker can
register — a deliberate opt-in, and almost certainly not what you want on a
personal deployment. Set it to your own address before you deploy. Every
account created under an empty allowlist logs a warning, so `wrangler tail`
will tell you if you got there by accident. Once it is set, only listed
addresses can receive a link; an address that is not on the list gets the
same `200 {"ok":true}` as one that is — the response never reveals whether an
address has an account, is on the allowlist, or has exhausted its daily send
budget.

Four details are load-bearing and easy to undo by accident:

- **Asking again never kills the link you already have.** An address may hold
  up to three un-redeemed links at once, each with its own untouched
  ten-minute expiry; past that a repeat mails nothing and costs nothing.
  Re-issuing the secret on the live row instead would let any anonymous `POST`
  invalidate the link sitting in somebody else's inbox.
- **The token rides in the URL fragment**, so it is never in a request line,
  a query string, a `Referer`, or a server log. The interstitial reads
  `location.hash`, strips it from the address bar, and `POST`s it.
- **Only a POST consumes a token.** Mail gateways prefetch links with GETs;
  a scanner's GET must not burn a sign-in link before its owner clicks it.
- **A `__Host-` nonce cookie set at request time is matched at redemption.**
  `SameSite=Lax` means it is simply absent when the link is opened on another
  device or inside a mail app's webview, so a mismatch is not an error: the
  interstitial names the address being signed in and asks for a confirmation,
  and the token stays valid until you give it.

Emailed links point at the origin of the request that asked for one. On a
deployment answering to more than one hostname, set `AUTH_PUBLIC_ORIGIN` to
pin them to the real front door.

#### `AUTH_MODE=single` is an auth bypass, and it now writes as well as reads

Setting the Worker var to the exact string `single` skips sign-in entirely and
binds **every** request to one synthetic user. The CSRF and `Origin` checks stay
on, but those constrain browsers: with no credential in play, any non-browser
client that reaches the hostname *is* the account. Workers deploy to a public
hostname by default, so the mode is only safe behind a network-level control
(Cloudflare Access, a private hostname, or equivalent).

What has changed with the relay is the blast radius. It is no longer only reads
and configuration: `POST /v1/locate/ref` with `relay: true` is session-only, and
in this mode every request is the session, so a single `curl` carrying an
`Origin` header and `X-GC-CSRF` plants an arbitrary position on every board
holding `read:fix` — and the board *navigates* by it, sorting stops, computing
walk times, and telling its owner to leave for a platform they are nowhere near.

There is deliberately no per-route carve-out refusing `relay: true` in this
mode. The mode's meaning is "every request is the user", one rule that a reader
can hold in their head; a list of routes that quietly opted out would be
folklore, and it would break the relay in the one deployment shape where the
phone has no other way to authenticate. Turn the mode off, or put the network
control in front of it.

### Pairing a device

The board has no keyboard and must never hold your password, so pairing
follows **RFC 8628** (the OAuth device authorization grant): the device asks
for a pairing request, shows you an eight-character code, and polls until you
have claimed that code in a browser you are already signed in to.

| Route | Caller | What it does |
| --- | --- | --- |
| `POST /v1/device/pair/start` | the device, unauthenticated | Mints a 256-bit `device_code` (stored hashed) and an 8-character `user_code`; answers `device_code`, `user_code`, `verification_uri`, `expires_in`, `interval` |
| `POST /v1/device/pair/poll` | the device, `Authorization: Bearer <device_code>` | `authorization_pending` until claimed, then the device token **exactly once** |
| `POST /v1/pair/claim` | the browser, session cookie + `X-GC-CSRF` | Names the pending request by its `user_code`; the first call previews the device, a second call with `"confirm": true` binds it |

```bash
# what the firmware does, by hand
curl -X POST "https://<worker-host>/v1/device/pair/start" \
  -H 'content-type: application/json' \
  -d '{"device_name":"Kitchen board","fw_version":"1.4.0"}'
# -> {"device_code":"…","user_code":"BCDF-GHJK","verification_uri":"https://…/pair", …}

curl -X POST "https://<worker-host>/v1/device/pair/poll" \
  -H "Authorization: Bearer <device_code>"
# -> 400 {"error":"authorization_pending"} until you claim it, then the token
```

Five properties are load-bearing:

- **The short code authenticates nothing.** It is ~34.5 bits and gets read off
  a screen; all it does is *name* a pending request. The credential is the
  256-bit `device_code`, which never leaves the device, is stored hashed, and
  is sent as a `Bearer` header — a copy in the query string is refused
  outright rather than accepted, because a query string reaches every access
  log along the way.
- **The claiming browser never sees the device token.** Claiming writes
  ownership and nothing else; the token is minted on the device's next poll
  and returned only to whoever holds the device code. It is issued exactly
  once — a replay gets `expired_token`.
- **Claiming takes a confirm step.** That screen is a security control, not a
  nicety: RFC 8628 §5.4's attack is talking someone into typing a code from a
  device they are not holding. The preview names the device — as **untrusted,
  escaped, length-capped** text, because the name is whatever the device said
  it was — before anything is bound.
- **Guessing is budgeted in D1, not in memory.** Attempts are counted per
  signed-in claimer *and* per client network, **including attempts against
  codes that do not exist**, since a per-code counter is no defense against
  spraying the live-code space. A specific code is separately destroyed after
  five attempts against it, and a pairing request expires in five minutes. Tune
  the caps with the `PAIR_*_BUDGET_*` variables in `.env.example`; each takes
  `0` as a kill switch.
- **No cap here is an off switch a stranger can flip.** The per-caller budgets
  are keyed to the /24 or /64, not to the address — a per-address cap is not a
  cap when the smallest IPv6 allocation holds 2^64 of them — and the
  deployment-wide caps are *split*, exactly like the send budgets: a network's
  (or an account's) first few requests of the day draw on a `FRESH` slice that
  repeat traffic cannot touch. Without that, ~25 addresses could spend one
  shared counter in minutes and every honest board would get `429` until
  midnight UTC. If a slice does run out, the refusal is recorded rather than
  merely logged — that is a real outage of a feature nobody would otherwise see:

  ```bash
  cd api
  npx wrangler d1 execute gtfs-compass --remote \
    --command "SELECT scope, key, SUM(count) FROM auth_budgets
                WHERE scope LIKE 'pair:%:refused' GROUP BY scope, key"
  ```

  Any row here means honest callers in that class were turned away today; the
  fix is to raise the matching `PAIR_*_BUDGET_FRESH`/`_REPEAT` var. (The daily
  retention sweep clears yesterday's counters, so read it the same day.)
- **A freshly paired device cannot see your location.** Pairing grants
  `read:departures` and `read:config` only. `read:fix` — the scope that lets a
  board receive your phone's live position — is never implied by pairing and
  is granted separately, per device.

#### What the device token can do

The board sends its token as `Authorization: Bearer gtfsc_dev_…` — never a
query parameter, which the API refuses. The token is stored as a SHA-256 hash
under a unique index and resolves in one indexed lookup.

- **It is not a login.** A device token can never come back as a session: the
  Bearer branch and the cookie branch are separate by construction, so a token
  extracted from a board cannot be exchanged for account access even in a
  browser that is already signed in.
- **It reaches only what its scopes name.** A route that does not declare a
  scope refuses device tokens outright, so the account email, the device list,
  configuration writes and `POST /v1/pair/claim` answer `403` to a board — one
  rule in the resolver rather than a guard each route has to remember. A
  request for a scope the device was not granted is also a `403`; a device
  token holding `read:config` may read *its own* device's configuration and no
  other board's, including boards on the same account. **No route names
  `read:departures` or `read:config` yet**, so those two grants are stored,
  listed, and not currently checked against anything — which the device list
  says on the toggle rather than leaving an unchecked box to imply a board was
  cut off.
- **Revocation is immediate, on both sides.** Unpairing sets `revoked_at` and
  the very next request is a `401` — the same `401`, byte for byte, that a
  token which never existed gets, so a token found in flash tells its holder
  nothing. It also **deletes the phone position already delivered to that
  board**, and so does turning the `read:fix` permission off on its own:
  revocation that only stopped the *next* fix would leave the last one
  readable indefinitely.
- **Theft is visible.** Every device request refreshes `last_used_at` (at most
  once every five minutes, so a board polling every 20 s does not put a
  database write on each poll). The device list shows it: a board you are
  holding that is still calling home is a board whose token somebody else has.

**Token rotation is specified and not implemented.** Any response to a
device-token request *may* one day carry `X-GC-Device-Token: <new token>`,
meaning "persist this and use it from now on". Nothing emits it today, and a
device that ignores it keeps working — firmware that handles it now is what
makes switching rotation on later a non-breaking change instead of a
fleet-wide reflash.

#### Managing paired devices

Three routes behind the device list, all of them **session-only** — a board's
own token is refused outright, so a stolen credential cannot enumerate the
account's other boards, widen its own permissions, or unpair anything.

| Route | What it does |
| --- | --- |
| `GET /v1/config/devices` | This account's boards: `id`, `paired_at`, `last_seen`, `scopes`, and the device's own `name`/`fw_version` tagged `untrusted` |
| `PATCH /v1/config/devices/<device_id>` | `{"scope": "read:fix", "granted": true}` — one permission per request, so a stale browser tab cannot restore a grant you just revoked |
| `DELETE /v1/config/devices/<device_id>` | Unpair: revoke the credential and delete the stored position |

```bash
curl "https://<worker-host>/v1/config/devices" -b cookies.txt

curl -X PATCH "https://<worker-host>/v1/config/devices/dev_abc123" \
  -b cookies.txt -H 'content-type: application/json' -H 'X-GC-CSRF: 1' \
  -H "Origin: https://<worker-host>" \
  -d '{"scope":"read:fix","granted":true}'
```

A device id that belongs to somebody else answers `404`, the same as one that
does not exist, and the write it named does not happen — the ownership
predicate is in the `WHERE` clause of every statement, not in a check a route
had to remember.

### The location check

The **Check my location** button reads this phone's position once and shows
the **raw** accuracy in metres, graded against the two thresholds that
matter: 150 m (past which walk times are not routed) and 500 m (past which
the API reports an unknown position rather than a wrong one). In this
milestone it is local-only — nothing is sent anywhere.

Geolocation is **secure-context-only**. Over `http://` on a LAN address —
which is what `wrangler dev` gives you — browsers deny it with no prompt and
no console error. The button detects that case and says so instead of
failing silently, but the fix is the same either way: open the deployed
`https://` address on the phone. Verifying this feature means using a real
phone over HTTPS; a desktop browser on localhost proves nothing about the
permission prompt.

## Data retention

Location data ages out on its own. A Cron Trigger (`triggers.crons` in
`api/wrangler.jsonc`, 03:47 UTC daily) runs a two-tier purge:

| After | What happens |
|---|---|
| `LOCATE_LOG_PRECISE_DAYS` (14) | `locate_log` loses its raw coordinates (`est_lat`/`est_lon`/`ref_lat`/`ref_lon`); the accuracies, `delta_m`, `provider`, `bssid_count` and timestamp stay. Any stored phone fix (`device_fixes`) is deleted. |
| `LOCATE_LOG_RETENTION_DAYS` (90) | The `locate_log` row is deleted. |

The split is deliberate: the question these diagnostic rows exist to answer —
*was the estimate accurate enough at this platform entrance* — is answered by
the metrics, not by the position, so the movement history ages out roughly six
times faster than the residual measurements. The same run sweeps expired
sign-in tokens, expired pairing codes, and yesterday's rate-limit counters.

The sweep also covers expired `sessions` — closing a browser tab is not a
sign-out, so nothing else bounds that table — and it deliberately **excludes**
`auth_budgets` rows scoped `send:failure` from the daily counter cleanup: that
scope is the only durable record that a mail-provider outage happened, and
letting the next purge tick erase it would destroy the signal before an
operator ever saw it.

Every run is recorded, including one that finds nothing to do — otherwise
"no rows deleted lately" is indistinguishable from a dead cron:

```bash
cd api
npx wrangler d1 execute gtfs-compass --remote \
  --command "SELECT * FROM maintenance_runs"
# job              last_run_at  duration_ms  rows_affected  pending  detail
# retention-purge  1785810156   84           37             0        {"locate_coords_nulled":12,...}
```

**A stale `last_run_at` is the alert condition**: if it is more than a day or
two behind, the purge is not running and retention is not happening. `pending
= 1` means one invocation's batch budget was not enough to drain the backlog
and the next tick will continue — expected on a first run against an old
database, a problem if it never clears. A run in progress is visible live with
`npx wrangler tail --format pretty` (it prints one `retention purge: {...}`
line per invocation); `npx wrangler dev --test-scheduled` plus
`curl 'http://localhost:8787/__scheduled?cron=47+3+*+*+*'` triggers one
locally.

Windows and batch sizes are configurable — see `LOCATE_LOG_PRECISE_DAYS`,
`LOCATE_LOG_RETENTION_DAYS`, `RETENTION_BATCH_LIMIT` and
`RETENTION_MAX_BATCHES` in `.env.example`.

## Feed data licensing

This project redistributes transit data published by agencies under their
own terms. The catalog stores each feed's license URL (`feeds.license_url`)
precisely because terms vary — surface it wherever feed data is shown.
NYC subway and bus data come from the
[MTA's developer feeds](https://www.mta.info/developers). Citi Bike station
data is used under the
[Citi Bike data sharing policy](https://citibikenyc.com/data-sharing-policy).

## License

MIT — see [LICENSE](LICENSE). (The code is MIT; transit data remains under
each agency's terms.)
