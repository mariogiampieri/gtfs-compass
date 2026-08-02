# gtfs-compass — implementation spec

A pocket transit timer. A Waveshare ESP32-S3-Touch-AMOLED-2.06 renders "minutes until you should leave" for a small set of favorite stops, and an estimate of minutes to X stop for non-favorite stops. A Cloudflare Worker + Durable Object layer normalizes GTFS-RT and GBFS into tiny JSON.

**Audience:** Claude Code. Build phases in order; each is independently testable.

**v1 scope:** NYC subway, one user, favorites + total NYC subway/bus/citibike systems. Battery-powered, wake-on-motion.
**Structured for:** any GTFS/GBFS feed, many users, later.

---

## Design constraints (do not violate)

1. **No protobuf on the device.** Ever. The device consumes ~200 bytes of JSON. All GTFS-RT
   parsing happens server-side.
2. **One parse per feed, not per device.** A Durable Object per feed polls and parses on an
   alarm; devices read cached state. This is the difference between a pet project and something that survives ten users.
3. **`feed_id` is a column from day one.** v1 ships MTA subway + MTA Bus + citibike-only, but nothing is allowed to assume a single agency. No hardcoded route colors, no hardcoded stop ID formats.
4. **The product is "leave now" or "next train."** The countdown is the mechanism in "leave by" mode; the departure alert is the point. In "explore mode" the next train/bus is the point. In looking for citibikes, the product is always "number of bikes" or "number of parking spots"
5. **Stale data is labeled, never silently shown.** Same discipline as boxwatch: a transit
   display that lies confidently is worse than one that admits ignorance.
6. **Wake on motion, never on touch.** The device lives in a pocket. Touch is read only once
   already awake. A capacitive panel as a wake source means phantom presses, battery drain, and unrequested state changes.
7. **Coarse location is gated, never trusted silently.** Any position with accuracy worse than
   the configured threshold is treated as *unknown*, not as a location. Silent degradation to an
   IP-derived fix is the failure mode that shows someone stops in the wrong borough.

---

## Repo layout

```
gtfs-compass/
├── README.md  LICENSE  (MIT)
├── ingest/                      # Python, runs on cron — NOT in the Worker
│   ├── pyproject.toml
│   └── src/gtfs_compass_ingest/
│       ├── catalog.py           # Mobility Database → feeds table
│       ├── static_gtfs.py       # stops, routes, stop↔route edges
│       └── load.py              # → D1
├── api/                         # Cloudflare Worker + DOs
│   ├── wrangler.toml
│   └── src/
│       ├── index.ts             # routes
│       ├── feed_do.ts           # one DO per RT feed
│       ├── adapters/            # gtfs_rt.ts, nyct.ts, gbfs.ts
│       ├── stops.ts             # proximity + search queries
│       ├── locate.ts            # provider chain + accuracy gate
│       └── walk.ts              # walk-time estimation
├── config-ui/                   # PWA served by the Worker
└── firmware/                    # Arduino IDE / ESP-IDF, Waveshare 2.06 AMOLED
    ├── platformio.ini
    └── src/{core,hal}/
```

---

## Phase 1 — Data model and ingest

**Why ingest is a separate Python job, not a Worker:** deriving "which routes serve this stop"
requires joining `trips.txt` against `stop_times.txt`, and `stop_times.txt` for a large agency
runs to millions of rows. That is not a Worker workload. Run it on cron (the dev box is fine- the box is labeled "opti" and is a dell optiplex 3060. setting up the cron will be it's own step),
write results to D1.

### Tables (D1 / SQLite)

```sql
feeds(id TEXT PK, name, static_url, rt_trip_url, rt_alert_url,
      rt_needs_key INT, adapter TEXT,          -- 'gtfs_rt' | 'nyct' | 'siri'
      min_lat REAL, max_lat REAL, min_lon REAL, max_lon REAL,
      license_url TEXT, status TEXT, updated_at INT)

stops(feed_id TEXT, stop_id TEXT, name TEXT, lat REAL, lon REAL,
      parent_station TEXT, PRIMARY KEY(feed_id, stop_id))

routes(feed_id TEXT, route_id TEXT, short_name TEXT, long_name TEXT,
       color TEXT, text_color TEXT, route_type INT,
       PRIMARY KEY(feed_id, route_id))

stop_routes(feed_id TEXT, stop_id TEXT, route_id TEXT,
            PRIMARY KEY(feed_id, stop_id, route_id))

CREATE INDEX idx_stops_bbox ON stops(lat, lon);

-- Accounts. Favorites belong to the user, not the device: two devices show one config.
users(id TEXT PK, email TEXT UNIQUE, created_at INT)
sessions(id TEXT PK, user_id TEXT, expires_at INT, created_at INT)
devices(id TEXT PK, user_id TEXT, token_hash TEXT, name TEXT,
        paired_at INT, last_seen INT, fw_version TEXT)

favorites(id TEXT PK, user_id TEXT, feed_id TEXT, stop_ids TEXT,  -- JSON array, both directions
          label TEXT, mode TEXT, sort_order INT)
origins(id TEXT PK, user_id TEXT, label TEXT, lat REAL, lon REAL)

-- Diagnostic: paired device-estimate vs phone-reference captures
locate_log(id INTEGER PK AUTOINCREMENT, user_id TEXT, device_id TEXT, ts INT,
           est_lat REAL, est_lon REAL, est_accuracy REAL,
           provider TEXT,              -- 'beacondb' | 'unwiredlabs' | 'none'
           bssid_count INT,
           ref_lat REAL, ref_lon REAL, ref_accuracy REAL,   -- from phone, nullable
           delta_m REAL,                                     -- computed on pairing
           label TEXT)                                       -- 'home' | 'platform' | free text

-- Walk times are per (favorite, origin), not per favorite
walk_times(user_id TEXT, favorite_id TEXT, origin_id TEXT,
           seconds INT, source TEXT,   -- 'manual' | 'heuristic' | 'mapbox'
           PRIMARY KEY(user_id, favorite_id, origin_id))
```

**Use `routes.route_color` and `route_text_color` from the feed.** GTFS carries them; MTA
populates them. Never hardcode a palette — that's the single change that makes this work for an agency. Fall back to a generated color hashed from `route_id` only when the feed omits them.

### Catalog

Seed `feeds` from the Mobility Database — an open catalog of over 6000 GTFS, GTFS-Realtime and GBFS feeds across more than 99 countries, which replaced TransitFeeds in February 2024 and checks producer URLs for updates daily at midnight UTC. It carries per-feed bounding boxes (`minimum_latitude` / `maximum_latitude` / `minimum_longitude` / `maximum_longitude`), a status field of `active` / `deprecated` / `inactive` / `development`, `direct_download_url`, and a license URL.

The bounding boxes are how "which agencies serve this location" gets answered later — store them even though v1 has one feed.

> **Verify, don't assume:** the catalog is downloadable as CSV, but the API requires an account
> and token. Prefer the CSV for bulk seeding so the ingest job has no auth dependency. Confirm
> the current CSV URL and schema before writing the parser rather than guessing field names.
> Filter to `status = 'active'`.

### v1 feed rows

- **MTA subway** — no API key required as of 2024. Eight feed groups (`1234567S`, `ACE`, `BDFM`,
  `G`, `JZ`, `L`, `NQRW`, `SIR`); each is a *full dataset* for its group. Adapter: `nyct`  (needs the NYCT protobuf extensions for track/direction detail).
- **MTA bus** — `gtfsrt.prod.obanyc.com/tripUpdates?key=<KEY>`, key required. Adapter: `gtfs_rt`.  Defer to Phase 6.

---

## Phase 2 — Feed Durable Object

One DO instance per `feed_id` (or per NYCT feed group). Responsibilities:

**For the sake of billing, have a discussion with the user on optimizing this service using hibernate. Have a discussion with the user on latency, polling fresh on request vs alarm-triggered runs that may not serve a purpose 22 hours a day.** Some considerations to guide the discussion:
- `alarm()` every 20 s: fetch the RT feed, parse via the configured adapter, reduce to
  `Map<stop_id, arrival_epoch[]>`, store in memory + `state.storage` for warm restart.
- `GET /stop/:stop_id` → next N arrivals with route ids.
- **Self-suspend:** track last-read time. If no read in 10 minutes, cancel the alarm and stop
  polling. Re-arm on next read. This is what keeps upstream load proportional to actual usage
  rather than to feed count.
- Record `fetched_at` and expose it. Downstream staleness depends on it.

Parse with `gtfs-realtime-bindings`. The NYCT adapter extends the base message with
`nyct-subway.proto`.

> **Verify, don't assume:** check Worker CPU-time limits against actual parse cost for a full
> NYCT feed group before committing. If parsing exceeds budget, move parsing to the ingest box> and have the DO fetch pre-reduced JSON. Measure; don't guess.

Adapter interface — keep it this narrow:

```ts
interface FeedAdapter {
  parse(buf: ArrayBuffer, now: number): Map<string, Arrival[]>;
}
interface Arrival { routeId: string; time: number; }
```

---

## Phase 3 — Read API

All responses JSON, all cached at the edge where safe.

```
GET  /v1/stops/near?lat=&lon=&radius_m=800&limit=20   (config UI)
GET  /v1/stops/search?q=&feed=                        (config UI)
GET  /v1/departures?stops=A32N,A32S&n=3
POST /v1/locate                                       (device → coarse position)
GET  /v1/config/:device_id           (ETag)
POST /v1/config/:device_id           (from config UI)
POST /v1/register                    (device → returns pairing code)
```

### `POST /v1/locate` — provider chain

The device sends observed access points; the Worker resolves them. **The device never calls a
geolocation provider directly** — that keeps providers swappable without reflashing, puts the
accuracy gate in one place, and preserves constraint #1.

Request (Ichnaea format, which BeaconDB accepts unchanged):

```json
{"wifiAccessPoints":[{"macAddress":"aa:bb:cc:dd:ee:ff","signalStrength":-52}, ...],
 "log": true, "label": "home"}
```

`locate.ts` is an **ordered chain**, each step configured by env var, each returning
`{lat, lon, accuracy, provider}` or null:

1. **BeaconDB** — `https://api.beacondb.net/v1/geolocate`. Free, no key, no account.
2. **Unwired Labs LocationAPI** — paid fallback, invoked *only* when step 1 returns
   `accuracy > LOCATE_MAX_ACCURACY_M`. Locates from cell towers, WiFi and IP, indoors and out,
   without GPS. Has a free tier worth checking before paying.
3. **Fail** → `{"known": false}`.

> **Not Mapbox.** Mapbox has no BSSID-positioning product — its catalog is Maps, Navigation,
> Search/Geocoding, and Data. Mapbox enters this project in `walk.ts`, not here. Google's
> Geolocation API does do this and is the obvious alternative to Unwired Labs, but requires a
> Google Cloud billing account, which is friction for self-hosters.

**Gate the result.** Never pass through a position with `accuracy > LOCATE_MAX_ACCURACY_M`
(default 500). BeaconDB falls back to cell-tower and then IP estimates when WiFi coverage is
thin, and an IP fix on a phone hotspot resolves to the carrier's exit node. Cache per-device for
10 minutes.

Self-hosters with no Unwired Labs key get step 1 and step 3 only. That must work fine.

### Diagnostic: device estimate vs. phone reference

```
POST /v1/locate         {..., log:true, label:"platform"}   → writes locate_log row
POST /v1/locate/ref     {lat, lon, accuracy, label}         → phone reference, pairs by ts
GET  /v1/locate/log?device_id=&since=                       → pairs + delta_m
```

Pair a reference to the most recent unpaired estimate for that device within 60 s, then compute
the haversine `delta_m`.

**Your phone is not ground truth indoors.** iOS and Android fall back to their own WiFi-location
databases when GNSS is unavailable, so an indoor comparison is estimate-vs-estimate. Always store the browser's reported `accuracy` and filter to sub-20 m references when computing error
statistics — those are the GNSS-derived ones.

Store `bssid_count` on every row. The hypothesis worth testing is that AP count predicts accuracy; if it holds, the device can gate locally on count before spending a round-trip.

Keep providers behind the `locate.ts` interface. Adding, reordering, or removing one should not
touch anything else.

### `walk.ts` — walk-time estimation

Three tiers, in preference order. Every result is stored in `walk_times` with its `source` so the
UI can show provenance and the user can override.

1. **Manual** — typed in the config UI. Always wins. For your daily stations you are a better
   estimator than any router: you know the elevator, the turnstile, and which stair you take.
2. **Heuristic** — `haversine × 1.3 ÷ 1.3 m/s`. The detour factor is remarkably stable on a grid.
   Free, instant, no key. This is the default for a newly discovered stop.
3. **Mapbox Directions** (`walking` profile) — optional, env-var key. Better on irregular street
   networks, water crossings, and anywhere the 1.3 factor lies. Self-hosted Valhalla is the
   no-key alternative and slots into the same interface, to be considered at a later time.

**Always add `entry_buffer_s`.** GTFS-RT predicts arrival *at the platform*; every walk estimate
ends at the *street entrance*. The mezzanine, turnstile, and stairs are unmodeled by every router.
Default 90 s for heavy rail, 0 for bus and bikeshare, configurable per feed. This is the
systematic bias that makes people miss trains.

```
walk_seconds = max(manual, heuristic|mapbox) + entry_buffer_s(feed)
```

**Don't route from a coarse fix.** If `/v1/locate` returned accuracy worse than ~150 m, use the
heuristic and skip Mapbox — a routed number computed from a 500 m position is precise-looking nonsense. Return the `source` so the UI can render estimated values differently from confirmed ones.

### Proximity query

Bounding-box prefilter on the indexed columns, then haversine sort in JS, then limit. At v1 scale
(~500 stops) this is instant; it stays fine into the tens of thousands.

Group results by `parent_station` where present, so "Jay St–MetroTech" returns once with its
routes rather than six times with platform IDs. Return each group's constituent `stop_id`s so the
device can request both directions.

> Keep this query behind a single `stops.ts` interface. If multi-agency scale later demands
> PostGIS on Neon, that should be one file's worth of change.

**Departures response** — keep it under 500 bytes:

```json
{"ts":1753632000,"fetched_at":1753631988,
 "d":[{"s":"A32N","r":"A","c":"0039A6","t":"FFFFFF","m":[3,11,18]},
      {"s":"A32S","r":"A","c":"0039A6","t":"FFFFFF","m":[6,14]}]}
```

`m` is integer minutes, already computed server-side. The device does no time math beyond
decrementing between polls — which matters because the device's RTC and the server's clock drift.

**Staleness contract:** always return `fetched_at`. The device shows data as stale when
`now - fetched_at > 90s`, and as disconnected when its own last successful poll is older than
that. Two different failures, two different displays.

---

## Phase 4 — Firmware (Waveshare ESP32-S3-Touch-AMOLED-2.06)

**Toolchain:** Waveshare supports **Arduino IDE and ESP-IDF only** — there is no PlatformIO board
definition. Either hand-roll a `platformio.ini` from the Arduino settings, or use Arduino IDE.
Arduino ESP32 board package **≥3.2.0** is required.

**Hardware.** ESP32-S3R8, 8MB PSRAM, **32MB flash**. 2.06″ AMOLED **410×502** over QSPI
(**CO5300** driver, **FT3168** touch). AXP2101 PMU, QMI8658 6-axis IMU, PCF85063 RTC powered
through the AXP2101, **ES8311 audio codec with onboard speaker** plus ES7210 echo cancellation and
SMD microphone, TF slot, PWR + BOOT side buttons, USB-C. Ships cased with straps and an MX1.25
battery included.

**No V1/V2 split** — unlike the 1.8 and 1.75, the 2.06 wiki documents a single hardware
configuration. That verification step is gone.

> **The docs contain copy-paste errors from sibling boards.** The library table calls
> `Arduino_DriveBus` a "CST816 touch driver" (this board is **FT3168**) and demo 02's prose refers
> to "the SH8601 display" (this board is **CO5300**). Waveshare reuses templates across the AMOLED
> family, and the six sizes are near-identical but their configs are **not** interchangeable.
> **Trust the Features / Hardware Description section and the `Mylibrary` pin-macro header — never
> the demo prose.**

> **Also verify:** PSRAM enabled in the build config. 410×502 RGB565 is ~410KB; it fits in 8MB
> PSRAM but fails confusingly if PSRAM is off.

### Pinned library versions

| Library | Version | Install |
|---|---|---|
| esp32 by Espressif Systems | ≥3.2.0 | online or offline |
| `GFX_Library_for_Arduino` | v1.6.0 | either |
| `lvgl` | v9.3.0 | offline recommended |
| `SensorLib` (PCF85063, QMI8658) | v0.3.1 | either |
| `XPowersLib` (AXP2101) | v0.2.6 | either |
| `Arduino_DriveBus`, `Mylibrary`, `lv_conf.h` | — | **offline only**, from the demo bundle |

### Start from the vendor demos — one per HAL function

Waveshare ships working reference code for every subsystem this project needs. Port from these
rather than writing drivers:

| HAL function | Demo |
|---|---|
| Battery %, charge state, Vbus | `05_LVGL_AXP2101_ADC_Data` (Arduino) / `01_AXP2101` (IDF) |
| Audio alert | `08_ES8311` |
| IMU / wake-on-motion | `04_LVGL_QMI8658_ui` |
| RTC | `03_GFX_PCF85063_simpleTime` |
| Display bring-up | `01_HelloWorld` |
| Backlight / PWR button | `05_LVGL_AXP2101_ADC_Data` (includes `toggleBacklight()`) |

Demos: `github.com/waveshareteam/ESP32-S3-Touch-AMOLED-2.06`. Schematic and dimensional drawings
are linked from the wiki.

### Structure: split `core/` from `hal/`

```
firmware/src/
├── core/     poll, parse, state machine, favorites, alert logic  — board-agnostic
└── hal/      display, input, power, IMU, PMU                     — board-specific
```

The API contract is identical across boards. A second device should be a new HAL, not a fork.
Nothing in `core/` may reference a driver chip or a pin.

### Power model: `on_demand`

This is a pocket device. It is dark by default.

1. **Deep sleep** until an IMU motion interrupt fires (QMI8658 wake-on-motion).
2. Wake → render last-known values from RTC-backed memory **immediately**, before networking.
3. Connect WiFi → `GET /v1/departures` → update.
4. Display for ~15 s of no interaction → sleep.

Step 2 is the one that decides whether the object survives contact with real life. If picking it
up doesn't show a number within about a second, the user reaches for their phone instead and the
device is dead. Render stale-but-instant, then correct.

Expose battery percentage and charging state by reading the AXP2101 over I2C. This is the main
thing the board buys you over cheaper alternatives — use it.

### Screen design — dark, and richer than a single number

**Invert the usual instinct.** On AMOLED, black pixels are genuinely off. A full-bleed color fill
is the worst case for battery; a dark field with large colored numerals costs a fraction of it.

410×502 is enough for a real departure card, not just a countdown. Vertical layout:

```
┌──────────────────────────┐
│ ● A   Jay St–MetroTech   │  route bullet in route_color + stop name
│       Manhattan-bound    │  direction / headsign, grey
│                          │
│         3                │  LEAVE IN — very large, route_color
│      leave now           │  label, small
│                          │
│  train in 9 · then 17    │  arrivals, secondary
│                          │
│  Jay St & Willoughby     │  cross streets, grey, small
│  ──────────────────────  │
│  ▓▓▓░░  84%    ⌂ home    │  battery, resolved origin
└──────────────────────────┘
```

- **Leave-time is the headline** (`arrival − walk_seconds`). Train-time is secondary — you want it
  when deciding whether to run.
- **Cross streets** come from `stops.name` plus, where available, a `cross_street` field you can
  populate during ingest from the static GTFS `stop_desc`. Optional; degrade gracefully.
- **States override:** `LEAVE_NOW` pulses the numerals; `STALE` renders grey with an age readout;
  `NOWIFI` shows an icon; `NO_SERVICE` (empty `m`) shows a dash.
- Zero and negative minutes must render distinctly from "no data." They are different facts.

**Burn-in mitigation is a requirement, not a nicety.** A departure card is the textbook risk case:
identical layout, same position, every day. On each wake, **offset the entire layout by a random
±4 px in x and y**, and never leave a static frame up for more than the display timeout. The
`on_demand` power model does most of the work; the jitter covers the rest.

### Interaction

Touch is enabled **only while awake** (constraint #6).

- **Swipe horizontally:** cycle favorites. Wrap.
- **Swipe vertically:** switch mode — train / bus / bike. These are peer views, not a hierarchy,
  so swipe is the correct gesture rather than a menu.
- **Tap:** toggle direction (the paired `stop_id`).
- **Long press on screen:** dismiss the current alert.
- **PWR button:** force refresh / power off, per the PMU's own semantics.

### Alerting

Walk time comes from `walk.ts` per (favorite, origin) and already includes `entry_buffer_s`. Alert
once at `arrival − walk_seconds` and again at `−60 s`, suppressed
during configured quiet hours. **The alert is audio through the onboard ES8311 codec and speaker**
— port `08_ES8311`, which drives it over I2S. Use a short distinctive rising tone, not a beep;
you'll learn to recognize it without looking. Pair it with a screen pulse for when it's silenced.

There is no vibration motor on this board, so audio plus visual is the whole alert path. Respect
quiet hours strictly — an unmutable chime in a meeting is how a device gets left in a drawer.

This is the feature that justifies the object. Build it in Phase 4, not "later."

### Config and pairing

First boot: WiFiManager captive portal → WiFi → `POST /v1/register` → display a six-character
pairing code. User enters it in the config UI. Device polls `/v1/config/:id` on wake with an
ETag; favorites, walk times, and last-known departures cached in NVS so it survives reboot
offline.

### Location: pick the favorite, don't power a search

Browsing a twenty-item stop list on this screen is not the interaction. Station selection happens
in the phone config UI. The device's use of location is narrower and much easier:
**decide which of the user's favorites to surface first.**

On wake, scan WiFi, `POST /v1/locate`, and if the response is `known` pick the nearest favorite.
If `known` is false, fall back to favorite 0 and show no location indicator. That needs ~500 m
accuracy, no list UI, and no GNSS hardware.

---

## Phase 5 — Accounts + Config UI (PWA)

### Auth: user identity in the browser, device identity on the wire

**The device never holds user credentials.** This is the load-bearing rule. Rotating a secret on
an ESP32 means reflashing or a provisioning dance; rotating a browser session means clearing a
cookie. Keep them separate:

- **User** authenticates in the PWA → session cookie. Never touches the device.
- **Device** holds a long-lived opaque token issued at pairing. Stored hashed in `devices`.
  Sent as a bearer header on `/v1/departures`, `/v1/locate`, `/v1/config/:id`.
- **Pairing** binds the two: device displays a six-character code → logged-in user enters it in
  the PWA → `devices.user_id` set, token issued. Codes expire in 10 minutes, single use.

Consequences worth designing for: favorites and origins belong to the `user`, so a second device
inherits the same config with no re-entry. Unpairing revokes the device token without touching the
user account. A lost device is a row update, not a password reset.

> **Port from mapparty rather than reinventing** — session handling, cookie flags, CSRF posture,
> and the D1/Worker session table are all the same problem. Keep whatever it uses behind an
> `auth.ts` interface so a self-hoster can swap the provider.

**Open question for Mario:** what does mapparty use — GitHub OAuth, email magic link, passkeys,
or password + Argon2? Each drags a different dependency into a project that currently has none.
For an OSS, developer-facing tool, OAuth or passkeys avoid standing up email infrastructure
entirely, which is the main cost of the password and magic-link routes. Tell CC which, and it
should follow that pattern rather than choosing independently.

**Single-user escape hatch:** self-hosters running one device shouldn't be forced through account
creation. If `AUTH_MODE=single`, skip login and treat all data as belonging to a synthetic user.
Roughly ten lines, and it keeps the "clone it and run it" story true.

### Privacy note — say this out loud in the README

Adding accounts changes what `locate_log` is. Without accounts it's device diagnostics; with
accounts it's **an identified person's location history**, retained on a server. That's a real
escalation, and given the design discipline everywhere else in this project it deserves matching
treatment:

- Default retention of 90 days, configurable, with a scheduled purge.
- One-click "delete all my location history" in the UI, and account deletion that actually
  cascades.
- Store only what the diagnostic needs; nothing about *which stops* were viewed goes into
  `locate_log`.

Also state plainly that **the device scans nearby WiFi BSSIDs and transmits them to the server for
coarse positioning** — what is collected, that it's used only for a position lookup, that it isn't
retained beyond the 10-minute cache, and which provider resolves it. An open-source project that
is explicit about this ages better than one that isn't.

### PWA, not a native app

Everything it needs — geolocation, a map, forms — is web. A native iOS app would cost an App Store
review cycle, a $99/yr developer account, and a TestFlight barrier for every OSS contributor, in
exchange for nothing. Serve it from the Worker; self-hosters get it automatically.

Keep the PWA layer thin: a manifest and a minimal service worker for the app shell. Installability
matters mainly for the diagnostic flow, which you'll open repeatedly while walking around.

### Geolocation gotchas — read before writing the capture button

**1. Secure context is required, and a LAN IP is not one.** `localhost` counts and the deployed
Worker counts, but `wrangler dev` on `192.168.1.x:8787` opened from your phone will silently fail
no matter what flags you pass. Use `cloudflared tunnel` or test against the deployed Worker. This
one costs an afternoon if you meet it cold.

**2. Must be triggered by a user gesture.** Calling `getCurrentPosition` on page load gets ignored
or blocked. Hang it off a tap.

**3. `maximumAge: 0` is non-negotiable for the diagnostic.** The default permits a cached fix from
minutes ago, possibly from somewhere else entirely — which would pair a stale reference against a
fresh estimate and quietly corrupt the residual data.

```js
navigator.geolocation.getCurrentPosition(
  pos => post('/v1/locate/ref', {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    label
  }),
  err => showError(err.code),
  { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
);
```

**4. iOS "Precise Location" can be off without the user realizing.** Approximate mode returns
kilometer-scale accuracy regardless of `enableHighAccuracy`. The sub-20 m reference filter catches
it, but surface the raw `accuracy` in the UI so a rejected capture explains itself.

**5. Installed PWA holds permission separately from Safari.** Expect to grant twice.

**6. Safari Websites → Never yields `PERMISSION_DENIED` with no prompt.** Handle `err.code === 1`
with specific copy pointing at Settings, not a generic failure message.

**Build the capture button first** — before the map, before favorites. Twenty lines, and it
de-risks the entire diagnostic plan on day one rather than after everything is built around it.

### The rest of the config UI

**This is where station selection lives.** The browser's Geolocation API is precise and free, the
screen is large, and scrolling a list is natural. Everything the device can't do well, do here.

- Map (MapLibre) centered on browser geolocation, stops within a draggable radius.
- Click to add a favorite; drag to reorder.
- Walk time per (favorite, origin) pair, showing `source` — manual, heuristic, or routed — so an
  estimated value is visibly different from one you confirmed.
- Named origins (home, office, …) so the device can pick the right constant from coarse location.
- Mode assignment per favorite: train / bus / bike.
- Device list: name, last seen, firmware version, unpair.
- Show the feed's `license_url` and attribution for each agency in use. Not optional — the
  catalog carries per-feed license URLs precisely because terms vary, and a product that
  redistributes feed data needs to surface them.

> **iOS note.** **Web Bluetooth is not supported on iOS**, which is why pairing goes through the
> server rather than direct BLE provisioning. That's a platform constraint, not a design choice.

### Diagnostic view

- **Capture reference** button → `getCurrentPosition({enableHighAccuracy:true})` →
  `POST /v1/locate/ref` with a label.
- Map of paired captures with error vectors drawn from device-estimate to phone-reference. This
  is a residual map; read it the way you'd read any calibration residual.
- Scatter of `bssid_count` vs `delta_m`, filtered to sub-20 m references.
- Summary by label: median and p90 error at home, office, platform, street.

After a few weeks this answers empirically whether BeaconDB is sufficient in the places you
actually go — which is the question the whole location design is currently guessing at.

---

## Acceptance criteria

- [ ] `/v1/departures?stops=A32N&n=3` returns in <300 ms warm, with `fetched_at` within 30 s.
- [ ] Two devices polling the same feed cause exactly one upstream MTA fetch per 20 s window.
- [ ] A feed DO with no reads for 10 minutes stops polling; the next read re-arms it and returns
      fresh data within one interval.
- [ ] `/v1/stops/near?lat=40.692&lon=-73.987&radius_m=800` returns parent-station-grouped results
      sorted by distance, each with route colors from the feed.
- [ ] Killing WiFi shows `NOWIFI` within 30 s; restoring it recovers without reboot.
- [ ] Stopping the Worker leaves the last values on screen, greyed, with a visible age.
- [ ] A stop with no upcoming service renders a dash, distinguishable from a 0-minute arrival.
- [ ] Alert fires once at `arrival − walk_time`, once at `−60 s`, and not during quiet hours.
- [ ] Ingest run on a second agency's feed produces working proximity + departures with **no code
      changes** — config only. *This is the test that proves the seam is real.*
- [ ] Device reboots offline and still shows favorites from NVS with a stale indicator.
- [ ] **Picking up the device renders a number in under 1 second**, before the network round-trip
      completes. Non-negotiable.
- [ ] Device in a pocket for an hour registers zero touch-initiated state changes.
- [ ] `/v1/locate` with a BSSID set that BeaconDB can't resolve returns `{"known":false}` — the
      device shows favorite 0 and no location indicator, never a wrong position.
- [ ] Battery percentage and charging state read correctly from the AXP2101 across a full
      charge/discharge cycle.
- [ ] A GBFS favorite renders bikes/docks; a GTFS favorite renders minutes; swiping between them
      requires no reconnection.
- [ ] With no Unwired Labs key configured, `/v1/locate` still works on BeaconDB alone and returns
      `{"known":false}` rather than erroring when coverage is thin.
- [ ] A paired capture (device estimate + phone reference within 60 s) produces a `locate_log` row
      with a computed `delta_m`.
- [ ] Walk time for a newly added stop returns immediately from the heuristic with
      `source:"heuristic"`, without requiring a Mapbox key.
- [ ] `entry_buffer_s` is applied to subway favorites and not to bus or bikeshare.
- [ ] A `/v1/locate` result with accuracy > 150 m causes `walk.ts` to skip Mapbox and use the
      heuristic.
- [ ] Two origins (home, office) for the same favorite return different walk times, selected by
      coarse location.
- [ ] The alert plays audibly through the onboard speaker at `arrival − walk_seconds`, and is
      silent during quiet hours.
- [ ] Layout position shifts by a random ±4 px on each wake (burn-in mitigation), verified by
      photographing two consecutive wakes.
- [ ] The departure card renders route bullet, stop name, direction, leave-time, next two
      arrivals, cross streets, battery, and resolved origin without truncation at 410×502.
- [ ] A stop with no `cross_street` data renders the card correctly with that line omitted.
- [ ] A second device paired to the same account inherits all favorites with no re-entry.
- [ ] Unpairing a device revokes its token — subsequent `/v1/departures` calls with it return 401
      — without affecting the user account or other devices.
- [ ] An expired or already-used pairing code is rejected.
- [ ] `AUTH_MODE=single` skips login entirely and the whole app works with no account.
- [ ] Account deletion cascades to devices, favorites, origins, walk_times, and locate_log.
- [ ] The retention purge removes `locate_log` rows older than the configured window.
- [ ] Opening the config UI over a LAN IP shows a clear "needs HTTPS" message rather than a
      silent geolocation failure.

---

## Build order

1. Ingest → D1 with MTA subway only; verify `stops` and `stop_routes` by eye
2. Feed DO + `nyct` adapter; test with `curl`
3. `/v1/departures`; test with `curl`
4. Firmware: display bring-up, WiFi, poll, single hardcoded favorite, always-on
5. Favorites, swipe navigation, direction toggle
6. Sleep/wake: IMU motion wake, render-before-network, NVS cache, AXP2101 battery
7. `walk.ts` — manual + heuristic + entry buffer. Mapbox later, if the heuristic annoys you.
8. Walk-time alerting
9. **Auth + PWA shell + capture button.** Port the session pattern from mapparty. Build the
   geolocation capture button before the map or the favorites list.
10. Device pairing + `/v1/config`
11. Favorites, origins, walk-time editing in the UI
12. `/v1/locate` with BeaconDB only + favorite auto-selection
13. Diagnostic residual view. **Run this for a few weeks before deciding on step 14.**
14. Unwired Labs fallback — only if the diagnostic says BeaconDB isn't enough
15. Citi Bike GBFS adapter as the second `feed_kind`
16. Second GTFS agency as a regression test on the seam

Step 4 uses always-on power so you're not debugging sleep and display simultaneously. Sleep lands
in step 6, once there's something worth waking to. The capture button lands in step 9, before the
UI it belongs to, because it's the cheapest way to find out whether the location plan holds. Step
13 before step 14 is the point: don't buy a positioning provider until you've measured a need.

---

## Settled

- **Self-hostable, not hosted.** Device config carries a server URL field. Accounts exist, but
  `AUTH_MODE=single` skips them entirely for one-device self-hosters.
- **User auth lives in the browser; the device holds only a pairing-issued token.**
- **The proxy is mandatory.** No "point it at any GTFS-RT URL" mode — incompatible with
  constraint #1.
- **Battery-powered, `on_demand`.** Not always-plugged.
- **No GNSS.** WiFi geolocation, gated on accuracy. BeaconDB first, Unwired Labs as an optional
  paid fallback, never Google.
- **Walk times are manual or heuristic by default.** Mapbox Directions is optional and only
  invoked when the position is good enough to justify it.
- **Config UI is a PWA**, not a native app.
- **Hardware:** Waveshare ESP32-S3-Touch-AMOLED-2.06, cased, battery included, single hardware
  revision. Arduino IDE or ESP-IDF (no PlatformIO board definition).

## Open questions

1. **Walk times: hand-entered or routed?** Hand-entered in v1. Computing them with Valhalla from
   the configured home location would be a good later addition, particularly for favorites added
   without hand-tuning.
2. **Bus in v1?** It forces MTA Bus Time API-key custody earlier, which is the main thing standing
   between "personal project" and "hosted product." Cleaner to defer — but only you know whether
   the bus is the one you actually need in the morning.
3. **What happens at zero favorites?** First-run before pairing needs a defined screen. Probably
   the pairing code and nothing else.
4. **Sleep timeout and motion sensitivity are guesses.** 15 s and "any motion" are starting
   values. Both want tuning against a week of actual pocket carry, and the IMU threshold is the
   difference between a device that wakes when you pick it up and one that wakes when you walk.
