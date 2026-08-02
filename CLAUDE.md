# gtfs-compass

A pocket transit timer. A Waveshare ESP32-S3 AMOLED device shows "minutes until you should
leave" for favorite stops; a Cloudflare Worker + Durable Object layer normalizes GTFS-RT and
GBFS into tiny JSON. Guiding spec: `docs/plans/01-guiding-spec.md` — read it before planning
any task. It is the source of truth; this file is the operating manual.

## Current scope

**Implement Phases 1–3 only** (ingest + data model, feed Durable Object, read API).

- **Phase 4 (firmware) is out of scope for now** — Mario is still designing the device
  interface. Do not scaffold firmware code, HAL stubs, or display work unless explicitly asked.
- Phases 5+ (accounts, config UI) come later. Don't build ahead, but don't paint them out
  either: the schema already includes users/devices/favorites — keep those tables and the API
  shapes compatible with the spec so later phases slot in.

## Workflow — non-negotiable

Every request goes through the compound-engineering pipeline, in order:

1. **`ce-plan`** — plan the work before touching code. Surface open questions from the spec
   that the task hits (see "Decisions that require Mario" below) during planning, not mid-build.
2. **`ce-work`** — execute the plan.
3. **`ce-code-review`** — review the result.
4. **All P1 and P2 findings must be fixed before the task is considered complete.** No
   deferring them to follow-ups. P3s may be logged and deferred with a note.

Do not skip stages because a task looks small. If a request is truly trivial (typo, doc tweak),
say so and confirm before bypassing the pipeline.

## Design constraints (from the spec — do not violate)

1. **No protobuf on the device.** All GTFS-RT parsing is server-side; the device consumes
   ~200 bytes of JSON.
2. **One parse per feed, not per device.** A Durable Object per feed polls and parses;
   devices read cached state.
3. **`feed_id` is a column from day one.** Nothing may assume a single agency — no hardcoded
   route colors (use `routes.color`/`text_color` from the feed, hash-fallback only), no
   hardcoded stop ID formats.
4. **Stale data is labeled, never silently shown.** Always return `fetched_at`; the staleness
   contract (90 s) lives in the API response, not in device guesswork.
5. **Coarse location is gated, never trusted silently.** Accuracy worse than
   `LOCATE_MAX_ACCURACY_M` (default 500) → `{"known": false}`, never a wrong position.
6. **Keep the seams real.** Providers behind `locate.ts`, proximity behind `stops.ts`,
   adapters behind the narrow `FeedAdapter` interface. The acceptance test is a second agency
   working with config changes only.

## Verify, don't assume (spec calls these out explicitly)

- **Mobility Database catalog:** confirm the current CSV URL and schema before writing the
  parser; prefer CSV over the token-gated API; filter `status = 'active'`.
- **Worker CPU limits:** measure the actual parse cost of a full NYCT feed group before
  committing to in-DO parsing. If it blows the budget, move parsing to the ingest box and have
  the DO fetch pre-reduced JSON.
- **MTA subway feeds** need no API key (as of 2024); MTA Bus needs one and is deferred to
  Phase 6 territory — don't build key custody now.

## Decisions that require Mario

- **Phase 2 DO polling model:** the spec mandates a discussion (not a unilateral choice) on
  hibernation/billing — alarm-driven 20 s polling with 10-minute self-suspend vs.
  fetch-on-request, and what latency is acceptable. Have this conversation during `ce-plan`
  for Phase 2, before implementing.
- Anything touching the Phase 4+ device interface or auth provider choice — park it and ask.

## Open-source hygiene — standing directives

This is an open-source project (MIT). On every task:

- **`.env.example` stays current.** Any new env var (Worker vars, ingest config, API keys)
  gets added to `.env.example` (and `wrangler.toml` vars where applicable) with a comment
  explaining what it does and whether it's optional. **Prompt Mario for real values** when a
  new secret/config is needed — never invent or commit real values.
- **README stays current.** `README.md` is written for an outside user: what the project is,
  architecture at a glance, prerequisites, and how to get each existing component running.
  Update it in the same task that changes setup steps, endpoints, or requirements — not as a
  follow-up.
- Surface feed `license_url`/attribution wherever feed data is redistributed.

## Architecture notes

- **Ingest is Python on cron (the "opti" box), not a Worker** — the trips×stop_times join is
  millions of rows. Output goes to D1. Cron setup is its own step.
- **Stack:** Python (`ingest/`), TypeScript Cloudflare Worker + DOs + D1 (`api/`). Repo layout
  is specified in the spec — follow it.
- **Departures response stays under 500 bytes**, minutes computed server-side (`m` arrays);
  the device does no time math beyond decrementing.
- **Proximity:** bbox prefilter on indexed lat/lon, haversine sort in JS, group by
  `parent_station`, return constituent stop_ids.
- **Walk times:** manual > heuristic (`haversine × 1.3 ÷ 1.3 m/s`) > Mapbox (optional,
  env-gated). Always add `entry_buffer_s` (90 s heavy rail, 0 bus/bike). Never route from a
  fix coarser than ~150 m. Store `source` with every value.
- **Locate chain:** BeaconDB (free, no key) → Unwired Labs (optional, env-gated) → 
  `{"known": false}`. Must work with BeaconDB alone. Never Mapbox (no BSSID product), never
  Google.

## Project knowledge

- `docs/solutions/` — documented solutions and patterns from past work, organized by
  category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when
  implementing or debugging in documented areas.
- `CONCEPTS.md` — shared domain vocabulary (entities, named processes, status
  concepts). Relevant when orienting to the codebase or naming domain things.

## Definition of done for a phase

Check the acceptance criteria list in the spec — each phase's tasks map to specific
checkboxes there (e.g. Phase 2: one upstream fetch per 20 s window regardless of device
count; self-suspend after 10 idle minutes; Phase 3: `/v1/departures` <300 ms warm,
parent-station grouping, feed-sourced colors). Cite which criteria a completed task
satisfies in the review.
