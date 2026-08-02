-- gtfs-compass initial schema.
-- Source of truth: docs/plans/01-guiding-spec.md (Phase 1 tables), hardened per
-- docs/plans/2026-08-02-001-feat-data-model-and-ingest-plan.md:
--   * NOT NULL on every primary-key column (SQLite composite/TEXT PKs accept NULLs otherwise)
--   * account tables carry FKs to users with ON DELETE CASCADE
--   * transit tables (stops, routes, stop_routes) deliberately carry no FKs
--   * routes.color / routes.text_color are the authoritative color column names

-- Transit reference data (ingest-managed, no FKs by design)

CREATE TABLE feeds (
  id           TEXT PRIMARY KEY NOT NULL,
  name         TEXT,
  static_url   TEXT,
  rt_trip_url  TEXT,
  rt_alert_url TEXT,
  rt_needs_key INTEGER,
  adapter      TEXT,            -- 'gtfs_rt' | 'nyct' | 'siri' | 'gbfs'
  min_lat      REAL,
  max_lat      REAL,
  min_lon      REAL,
  max_lon      REAL,
  license_url  TEXT,
  status       TEXT,
  updated_at   INTEGER
);

CREATE TABLE stops (
  feed_id        TEXT NOT NULL,
  stop_id        TEXT NOT NULL,
  name           TEXT,
  lat            REAL,
  lon            REAL,
  parent_station TEXT,
  PRIMARY KEY (feed_id, stop_id)
);

CREATE INDEX idx_stops_bbox ON stops (lat, lon);

CREATE TABLE routes (
  feed_id    TEXT NOT NULL,
  route_id   TEXT NOT NULL,
  short_name TEXT,
  long_name  TEXT,
  color      TEXT,
  text_color TEXT,
  route_type INTEGER,
  PRIMARY KEY (feed_id, route_id)
);

CREATE TABLE stop_routes (
  feed_id  TEXT NOT NULL,
  stop_id  TEXT NOT NULL,
  route_id TEXT NOT NULL,
  PRIMARY KEY (feed_id, stop_id, route_id)
);

-- Accounts. Favorites belong to the user, not the device.

CREATE TABLE users (
  id         TEXT PRIMARY KEY NOT NULL,
  email      TEXT UNIQUE,
  created_at INTEGER
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER,
  created_at INTEGER
);

CREATE TABLE devices (
  id         TEXT PRIMARY KEY NOT NULL,
  user_id    TEXT REFERENCES users (id) ON DELETE CASCADE,  -- NULL until paired
  token_hash TEXT,
  name       TEXT,
  paired_at  INTEGER,
  last_seen  INTEGER,
  fw_version TEXT
);

CREATE TABLE favorites (
  id         TEXT PRIMARY KEY NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  feed_id    TEXT,
  stop_ids   TEXT,               -- JSON array, both directions
  label      TEXT,
  mode       TEXT,
  sort_order INTEGER
);

CREATE TABLE origins (
  id      TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label   TEXT,
  lat     REAL,
  lon     REAL
);

-- Diagnostic: paired device-estimate vs phone-reference captures
CREATE TABLE locate_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT REFERENCES users (id) ON DELETE CASCADE,
  device_id    TEXT,
  ts           INTEGER,
  est_lat      REAL,
  est_lon      REAL,
  est_accuracy REAL,
  provider     TEXT,             -- 'beacondb' | 'unwiredlabs' | 'none'
  bssid_count  INTEGER,
  ref_lat      REAL,
  ref_lon      REAL,
  ref_accuracy REAL,             -- from phone, nullable
  delta_m      REAL,             -- computed on pairing
  label        TEXT              -- 'home' | 'platform' | free text
);

-- Walk times are per (favorite, origin), not per favorite
CREATE TABLE walk_times (
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  favorite_id TEXT NOT NULL REFERENCES favorites (id) ON DELETE CASCADE,
  origin_id   TEXT NOT NULL REFERENCES origins (id) ON DELETE CASCADE,
  seconds     INTEGER,
  source      TEXT,              -- 'manual' | 'heuristic' | 'mapbox'
  PRIMARY KEY (user_id, favorite_id, origin_id)
);

-- Cross-host ingest coordination: a single row claimed via conditional UPDATE
CREATE TABLE ingest_lock (
  id         INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  holder     TEXT,
  expires_at INTEGER NOT NULL DEFAULT 0
);

INSERT INTO ingest_lock (id, holder, expires_at) VALUES (1, NULL, 0);
