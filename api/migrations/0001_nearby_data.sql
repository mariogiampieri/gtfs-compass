-- gtfs-compass nearby-data additions (Phase 3, U1).
-- Source of truth: docs/plans/2026-08-02-003-feat-nearby-read-api-plan.md
-- Additive only: applies cleanly over a database that already has Phase 1 data.
--   * route_directions: dominant static trip_headsign per (route, direction) —
--     the fallback when a realtime trip's terminal is missing or unresolvable
--   * stops.capacity: GBFS dock capacity; NULL for rail stops
--   * feeds.direction_labels: JSON array (e.g. '["Uptown","Downtown"]');
--     NULL means mixed orientation — the device shows compass tags
--   * feeds.units: 'imperial' | 'metric' — distance-label formatting per feed

CREATE TABLE route_directions (
  feed_id      TEXT NOT NULL,
  route_id     TEXT NOT NULL,
  direction_id INTEGER NOT NULL,
  headsign     TEXT,
  PRIMARY KEY (feed_id, route_id, direction_id)
);

ALTER TABLE stops ADD COLUMN capacity INTEGER;

ALTER TABLE feeds ADD COLUMN direction_labels TEXT;

ALTER TABLE feeds ADD COLUMN units TEXT;
