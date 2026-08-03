# Handoff: GTFS-Compass — Transit Watch App
Target device: **Waveshare ESP32-S3-Touch-AMOLED-2.06** (410×502 AMOLED, FT3168 capacitive touch, QMI8658 6-axis IMU, PWR button, AXP2101 battery management)

## Overview
A glanceable, gesture-driven transit display for a watch-form-factor ESP32 device. It shows nearby train, bus, and bikeshare stops/stations from a companion API (GTFS/GBFS-backed, city-agnostic). The user swipes horizontally between systems (rail / bus / bike), vertically between stops (pre-sorted by distance by the API), taps a route row for arrival detail, taps a direction pill to flip direction, and shakes the device to force a refresh.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, NOT production code to copy. The task is to **recreate these designs on the device** in the target environment — most likely **ESP-IDF + LVGL** (LVGL 9 with the vendor's double-buffered/anti-tearing config is recommended; the Arduino GFX path has weaker DMA performance per Waveshare's wiki). All px values below are literal device pixels at 410×502 — no scaling math needed.

- `Transit Watch Prototype.dc.html` — the interactive prototype. **This is the behavioral source of truth**: run it in a browser, drag/tap/press keys to feel every transition.
- `Transit Watch Explorations.dc.html` — the exploration document. Option ids referenced below (2b, 4c, 5b…) are visible badges in this file. Turn 5 shows the design under DC/London/SF/small-city feeds.
- `support.js` — runtime for the HTML files; irrelevant to implementation.

## Fidelity
**High-fidelity.** Colors, type sizes, spacing, and motion values are final and specified exactly below. Recreate pixel-perfectly within LVGL's capabilities. The one intentional substitution: the mock uses Helvetica Neue; on device use any neutral grotesque with **tabular (fixed-width) numerals** — LVGL's built-in Montserrat at matched sizes is acceptable; a converted Helvetica-like (e.g. IBM Plex Sans / Public Sans) is better. Bold weights matter more than the exact face.

## Global chrome (every screen)
- Background: pure `#000000` (AMOLED battery/contrast).
- Screen corner radius ≈ 82px — keep content inside side insets of 34px (rows may bleed to edges; text never closer than 32px to a side).
- **Status chip row**, centered at y=18, 16px text, gap 16px between the two items:
  - Freshness: 8px dot + seconds since last fetch (`12s`). Dot/text `#30D158` when live; the whole chip turns `#FF453A` with text `offline · 2m` when disconnected; flashes green `now` (dot glow) for 1.4s after a refresh completes.
  - Battery: 22×11px outline battery glyph (1.5px `#7D7D84` border, r3) + `82%`, all `#7D7D84`. Read from AXP2101.
- **Mode dots** (system position): 3 × 6px dots, gap 9px, centered at bottom=16. Active `#FFFFFF`, inactive `#333333`.
- **Stop dots** (vertical position within system): 6px dots, gap 7px, right=12, vertically centered. Same colors. Hidden in detail views.

## Screens / Views

### 1. Board — rail & bus (exploration 2b, 4b; prototype default view)
Purpose: answer "what's leaving soon near me" in one glance.
- Header at top=50, inset 34: station name, bold, **length-adaptive size**: ≤12 chars → 30px; ≤18 → 27px; longer → 24px, max 2 lines, ellipsize.
- Under the name (7px gap), a row with: **direction pill** — 15px/600 text + `⇅` glyph in `#8E8E93`, padding 5px 13px, radius 16, bg `#1C1C1F`, 1px border `#2E2E33`; then distance (`0.2 mi`) 15px `#8E8E93`, 10px gap.
- Rows fill from top≈148 (158 if 2-line name) to bottom=44, equal heights, each with 1px top hairline `#1C1C1F`, horizontal padding 32, internal gap 14. Fit all trunks without scrolling up to 4 rows (Fulton St case); ≥5 rows use the 2a compressed pattern (exploration 2a) — 4 rows + dimmed overflow bullet tray.
- Row anatomy, left→right:
  - **Bullet cluster**: one bullet per route in the trunk. Rail: 46px circle, 25px/700 label, `route_color` fill, `route_text_color` text; overlapped -12px with a 3px black ring separating (`box-shadow` equivalent: 3px `#000` outline). Bus: pill min-width 60×40, radius 9, 20px/700 (16px when label >4 chars, e.g. `M15-SBS`), padding 0 10, siblings gap 6 (no overlap).
  - **Headsign** of the soonest arrival: 18px/500 `#E8E8EC`, 1 line, ellipsize. Optional sub-line 14px, 2px below: alert text in `#F5A623` or informational note in `#8E8E93`.
  - **Countdown**: number 36px/700, letter-spacing -1, `#FFFFFF` (amber `#F5A623` when that trunk has an alert); unit `min` 14px `#8E8E93`, baseline-aligned, 4px gap.
- **Alert badge** (exploration 4c): 22px amber `#F5A623` circle, black `!` 15px/800, 3px black ring, at top-right of the bullet cluster (offset -6,-6).

### 2. Trunk / route detail (explorations 3a, 1g; prototype: tap row)
Purpose: all upcoming arrivals for one trunk (interleaved across its lines, sorted by ETA) in one direction.
- Header at top=44, inset 34, bottom-padded 14 with 1px hairline: bullet cluster at 52px (overlap -13), then station name 14px caps `#8E8E93` letter-spacing 1, direction label 20px/600 `#E8E8EC` with `⇅` `#68686E` (tappable → flip). Right-aligned `‹ back` 13px `#5A5A60`.
- Arrivals list from top=144 to bottom=64, scrollable, **scrollbar hidden**: rows 86px tall, 1px bottom hairline; 44px bullet (24px label; bus: 56×36 pill), headsign 17px `#9A9AA0`, countdown 40px/700 `#E8E8EC` + `min` 14px.
- Footer hint centered at bottom=36: 14px `#5A5A60` — `scroll for later · tap ⇅ to flip · shake refreshes`.
- Tap header (or PWR) → back to board.

### 3. Bike station (explorations 1e; prototype: 3rd system)
- Header same as board, minus direction pill (distance only).
- Two hero numbers at top=158: available bikes (classic+electric) 84px/800 letter-spacing -3 in `#3FC9C0`, label `BIKES` 15px/600 letter-spacing 1.8 `#8E8E93`; right-aligned open docks in `#E8E8EC`, label `DOCKS`.
- Segmented capacity bar at top=312: height 14, radius 7, 2px gaps; classic `#3FC9C0`, electric `#F0C419`, empty `#2A2A2E`, widths proportional to station capacity.
- Legend below (14px gap): `9 classic · 5 electric · 9 open` — 9px swatch dots, 17px `#9A9AA0` text, counts in `#E8E8EC`.
- Hint at bottom=52: `tap for nearby stations` 14px `#5A5A60`. Tap anywhere → Nearby.

### 4. Bike nearby compare (exploration 3e; prototype: tap bike screen)
- Header top=48: `NEARBY STATIONS` 16px/600 caps letter-spacing 1.5 `#8E8E93`; `‹ back` right.
- One row per station (3 visible), equal heights, 1px hairlines, inset 34: name 19px/600 `#E8E8EC` + distance 15px `#8E8E93` right-aligned; below (9px gap) a 10px-tall radius-5 capacity bar, same color language. Sorted by distance. Tap a row → that station becomes current, back to bike board.

### 5. Loading (exploration 4e)
Skeleton preserving board bones: real station name if known; shimmer blocks elsewhere (46px circles, 16px bars, 60×34 blocks) — base `#1A1A1C`, highlight `#26262A`, 1.4s linear sweep. No spinner. Chip shows `…`.

### 6. Offline / stale (exploration 4d)
Chip red `offline · 2m`; countdowns prefixed `~`, content at 60% opacity; red banner centered at bottom=40: `last updated 8:42 — shake to retry` 15px `#FF453A`. Never show stale data as live.

### 7. Empty mode (exploration 4f)
56px dashed circle (2px `#3A3A3E`), title 24px/700 `#C9C9CF` (`No bikeshare nearby`), body 17px `#8E8E93` two lines (`Closest station is 2.4 mi away.` / `Swipe ← for bus or train.`). Mode dots remain.

## Interactions & Behavior
Gesture thresholds (from prototype): **swipe** = pointer travel >50px with a dominant axis; **tap** = travel <15px. A drag >15px suppresses the tap that would otherwise fire.

- Swipe ← / → : previous/next system (rail ↔ bus ↔ bike), clamped, no wraparound. In a detail view, a horizontal swipe first pops back to the board.
- Swipe ↑ / ↓ : next/previous stop by distance (board only; in detail, vertical drag scrolls arrivals).
- Tap row → trunk/route detail. Tap bike screen → nearby list.
- Tap direction pill / ⇅ → flip direction (rail & bus, board & detail). **This is the only way to flip** — deliberately not shake (an accidental flip silently shows wrong-way trains; an accidental refresh is harmless).
- **Shake → refresh** (QMI8658: suggest accel-magnitude threshold ~1.8g with ≥2 zero-crossings within 500ms; tune on hardware). Feedback: 700ms device-wobble is a browser affordance — on device, flash the chip green `now` for 1.4s after the fetch lands.
- **PWR button click → home**: board view, nearest stop of the current system, from anywhere.
- Auto-poll every 30s (configurable); freshness counter ticks locally every 1s.

### Motion (all 260ms, cubic-bezier(.3,.7,.3,1))
- System change: incoming content slides from ±70px X + fade from 15%.
- Stop change: same on Y.
- Detail push/pop: scale from 0.93 + fade from 20%.
- Direction flip: scaleY from 0.92 + fade from 10%.
On LVGL: `lv_anim` translate+opacity on the content container; drop the fades if compositing is expensive — the slides carry the meaning.

## State Management
```
state = {
  sys: 0|1|2,               // rail, bus, bike
  stopIdx: [int,int,int],   // remembered per system
  view: board|detail|nearby,
  trunkIdx: int,            // which trunk is open in detail
  dir: 0|1,                 // global direction, shared across systems
  secsSinceFetch: int, refreshing: bool, offline: bool
}
```
Data refetch triggers: poll timer, shake, stop/system change (serve cache immediately, revalidate in background).

## API Contract (companion API — co-developed)
The device is a dumb renderer; **the API does all the thinking**. One endpoint:

`GET /v1/nearby?lat=&lon=&modes=rail,bus,bike`
```json
{
  "generated_at": "2026-08-02T18:44:00Z",
  "units": "imperial",
  "systems": [
    {
      "mode": "rail",
      "direction_labels": ["Uptown", "Downtown"],
      "stops": [
        {
          "id": "fulton", "name": "Fulton St", "distance_label": "0.2 mi",
          "trunks": [
            {
              "key": "ee352e",
              "color": "#EE352E", "text_color": "#FFFFFF",
              "routes": [{"label": "2", "shape": "circle"}, {"label": "3", "shape": "circle"}],
              "alert": {"severity": "delay", "text": "Delays · signal problem", "directions": [0]},
              "note": null,
              "directions": [
                {"direction_id": 0, "label": null,
                 "arrivals": [{"route": "2", "headsign": "Wakefield–241 St", "eta_min": 2}]},
                {"direction_id": 1, "label": null, "arrivals": []}
              ]
            }
          ]
        }
      ]
    },
    {
      "mode": "bike",
      "stations": [
        {"id": "w-chambers", "name": "West St & Chambers St", "distance_label": "460 ft",
         "bikes_classic": 9, "bikes_electric": 5, "docks_open": 9, "capacity": 23}
      ]
    }
  ]
}
```
Server-side responsibilities (keeps the firmware trivial and city-agnostic):
- **Distance sorting + labels** (`460 ft`, `0.2 mi`, or metric per feed config).
- **Trunk grouping**: group routes at a stop by `route_color`. Single-route groups are the normal case outside NYC (see exploration 5a — DC degrades to plain rows).
- **Bullet shape**: `circle` for rail `route_type`s when `route_short_name` ≤2 chars; `pill` for buses and any label >2 chars. No short name at all (London, 5b) → `shape: "disc"`: client renders a 26px color disc and promotes the line name to the row's primary text, headsign to the sub-line with a compass tag.
- **Direction labels**: feed-level names when defined (NYC Uptown/Downtown, SF Inbound/Outbound). Mixed-orientation stations (London, 5b) → `direction_labels: null`: client shows a bare `⇅ flip direction` pill and per-arrival compass tags (12px letter in a 1px `#2E2E33` r4 box).
- **Missing route_color** (5d): deterministic hash of `route_id` into a fixed 8-color palette so colors are stable across refreshes: `#C9564C #B07A30 #7C8F3A #3F9A62 #2F9C93 #3E86C0 #7A74CE #B75F9E` (≈ oklch 0.62/0.14, 8 hues).
- **Contrast**: honor `route_text_color`; else black/white by luminance (DC's orange/silver bullets use black text, 5a).
- Alerts: `severity: "delay"` (amber badge + amber countdown + amber sub-line) vs `"info"` (gray sub-line only, no badge).

## Design Tokens
Colors — bg `#000000`; hairline `#1C1C1F`; pill bg `#1C1C1F` / border `#2E2E33`; text `#FFFFFF` `#E8E8EC` `#9A9AA0` `#8E8E93` `#5A5A60`; live `#30D158`; alert `#F5A623`; offline `#FF453A`; bike `#3FC9C0`; e-bike `#F0C419`; empty dock `#2A2A2E` (+`#3A3A3E` border); bezel-only grays are out of scope on device.
Type ramp (px/weight) — hero countdown 120/800 (unused in final board, kept for a possible 1b mode); bike heroes 84/800; detail countdown 40/700; board countdown 36/700; station name 24–30/700; detail direction 20/600; headsign 18/500 (detail 17); pill & legend 15–17/600; sub/hint/unit 14; caps labels 14–16/600, letter-spacing 1–1.8; chip 16.
Spacing — side inset 34 (rows pad 32); hairlines 1px; row gap 14 (detail 13); dot sizes 6/8/9; radii: pill 16–17, bus bullet 9, bars 5–7.

## Assets
None — no images or icon fonts. Every glyph is text (`⇅`, `‹`, `!`, `⟳`) or a drawn primitive (dots, bars, battery outline, dashed circle). Route colors come from feed data. Nothing NYC-branded is baked in; NYC strings/colors in the mocks are sample API payloads.

## Files
- `Transit Watch Prototype.dc.html` — interactive prototype (behavioral truth; open in a browser; Tweaks panel simulates offline, hints, poll rate)
- `Transit Watch Explorations.dc.html` — exploration doc; option ids (1a…5d) referenced throughout this README
- `support.js` — HTML runtime, ignore
