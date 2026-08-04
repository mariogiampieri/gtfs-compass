-- gtfs-compass auth, pairing, and relay schema (Phase 5, U1).
-- Source of truth: docs/plans/2026-08-03-004-feat-phase-5-accounts-pairing-relay-plan.md
-- Additive only: applies cleanly over a database already carrying Phase 1-4 rows.
--
-- Identity rulings encoded here (KTDs):
--   * email is normalized (lowercase + trim) in application code, never by
--     COLLATE NOCASE — that needs SQLite's 12-step table rebuild on a table
--     every account table cascades to, and it is ASCII-only besides
--   * devices.id is server-minted and never client-supplied
--   * locate_log.device_id (anonymous, client-chosen text) and
--     locate_log.device_row_id (a paired devices.id) are two separate identity
--     spaces; merging them would let an anonymous caller who learns a paired
--     device's id burn its cap and inject rows into an identified user's history
--   * every secret is stored as a SHA-256 hash, never in the clear

-- Magic-link sign-in tokens (R1). One row per issued link. Single-use is
-- enforced by a conditional UPDATE on used_at with a rows-affected check, not
-- by a read-then-write.
CREATE TABLE magic_tokens (
  id         TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,     -- SHA-256 of the >=128-bit CSPRNG link token
  email      TEXT NOT NULL,     -- normalized in application code before insert
  nonce_hash TEXT,              -- SHA-256 of the __Host- nonce cookie set at request time
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,  -- created_at + 10 minutes (ASVS 6.5.5)
  used_at    INTEGER            -- non-NULL means burned; the single-use latch
);

CREATE UNIQUE INDEX idx_magic_tokens_token_hash ON magic_tokens (token_hash);

-- "A repeat request inside the window resends the same unexpired token" (R4)
-- reads by address over live rows.
CREATE INDEX idx_magic_tokens_email ON magic_tokens (email, expires_at);

-- The retention sweep (R20) deletes expired rows; nothing else does.
CREATE INDEX idx_magic_tokens_expires_at ON magic_tokens (expires_at);

-- RFC 8628 device pairing (R6, R7). The device holds the high-entropy
-- device_code (hashed here); the human reads only the short user_code, which
-- names a pending request and authenticates nothing by itself.
CREATE TABLE pairing_codes (
  id               TEXT PRIMARY KEY NOT NULL,
  device_code_hash TEXT NOT NULL,          -- SHA-256 of the 256-bit device_code
  user_code        TEXT NOT NULL,          -- normalized (upper, dashes stripped)
  device_name      TEXT,                   -- device-supplied, untrusted: escape and length-cap on display (R8)
  fw_version       TEXT,                   -- device-supplied, untrusted
  attempts         INTEGER NOT NULL DEFAULT 0,  -- failed claims against this code; 5 destroys it
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,       -- created_at + 5 minutes
  claimed_by       TEXT REFERENCES users (id) ON DELETE CASCADE,
  claimed_at       INTEGER
);

CREATE UNIQUE INDEX idx_pairing_codes_device_code_hash ON pairing_codes (device_code_hash);

-- Claiming looks a code up by what the human typed. Not UNIQUE: user_code is
-- ~34.5 bits, so a collision between two live codes is possible and must not
-- fail an honest device's start request. The claim path resolves the ambiguity.
CREATE INDEX idx_pairing_codes_user_code ON pairing_codes (user_code, expires_at);

-- The retention sweep (R20) deletes expired rows; pair/start is unauthenticated,
-- so nothing else bounds this table.
CREATE INDEX idx_pairing_codes_expires_at ON pairing_codes (expires_at);

-- Abuse budgets (R4, R7, R11). Sharded on purpose: a single global counter row
-- is one hot row under D1's single-primary write path, so each logical counter
-- is spread over N shards and read as a SUM. `scope` names the budget
-- ('send:address', 'send:global:known', 'pair:claimer', 'relay:session', ...),
-- `key` is the hashed subject ('' for a global counter), `day` is days since
-- the epoch in UTC.
CREATE TABLE auth_budgets (
  scope   TEXT NOT NULL,
  key     TEXT NOT NULL,
  day     INTEGER NOT NULL,
  shard   INTEGER NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, key, day, shard)
);

-- Yesterday's counters are dead weight; the retention sweep drops them by day.
CREATE INDEX idx_auth_budgets_day ON auth_budgets (day);

-- Phone location relay (R11, R14). One row per device, latest-wins, never
-- queued. Deliberately NOT columns on `devices`: that row is on the auth hot
-- path (every device request resolves its token against it) and rewriting it
-- every few seconds would put relay traffic in contention with authentication.
-- The FK cascade is what makes account deletion (AE10) and unpair reach the
-- relay row for free.
CREATE TABLE device_fixes (
  device_id   TEXT PRIMARY KEY NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  accuracy_m  REAL,              -- stored as reported; the gate is read-side only (R12)
  captured_at INTEGER NOT NULL,  -- when the phone fixed the position
  received_at INTEGER NOT NULL   -- when the Worker wrote the row
);

-- The retention sweep deletes fixes older than LOCATE_LOG_PRECISE_DAYS (R20):
-- a metre-accurate GPS fix is the most precise location this system stores and
-- must not be the only one that never expires.
CREATE INDEX idx_device_fixes_captured_at ON device_fixes (captured_at);

-- Hardening of the Phase 1 account tables.

-- Device tokens (R9). Hashed under a unique index so a token resolves in one
-- indexed lookup and two devices can never share one. token_hash stays
-- nullable (SQLite unique indexes permit multiple NULLs) because a device row
-- may exist before its token is minted.
CREATE UNIQUE INDEX idx_devices_token_hash ON devices (token_hash);

-- Scopes are separately grantable and revocable. The default deliberately
-- EXCLUDES read:fix (R9, Mario 2026-08-04): a freshly paired device never
-- receives a position until the user grants it, so a stolen or second-hand
-- board is not a tracking device. NOT NULL with an explicit default, never
-- NULL — a NULL scope list is an ambiguity the resolver would have to guess at.
ALTER TABLE devices ADD COLUMN scopes TEXT NOT NULL DEFAULT 'read:departures,read:config';

ALTER TABLE devices ADD COLUMN revoked_at INTEGER;

ALTER TABLE devices ADD COLUMN last_used_at INTEGER;

-- The relay fan-out predicate is "this user's devices, holding read:fix, not
-- revoked" (R11). user_id and revoked_at are the indexable halves; the scope
-- test is a string match applied to the narrowed set.
CREATE INDEX idx_devices_user_revoked ON devices (user_id, revoked_at);

-- Sessions (R3): opaque 128-bit tokens stored hashed, rotated on
-- authentication, 30-day sliding renewal at half-life, 180-day absolute
-- (created_at + 180 days). last_used_at drives the renewal decision so reads
-- only write past the half-life.
ALTER TABLE sessions ADD COLUMN token_hash TEXT;

ALTER TABLE sessions ADD COLUMN last_used_at INTEGER;

CREATE UNIQUE INDEX idx_sessions_token_hash ON sessions (token_hash);

CREATE INDEX idx_sessions_user_id ON sessions (user_id);

CREATE INDEX idx_favorites_user_id ON favorites (user_id);

CREATE INDEX idx_origins_user_id ON origins (user_id);

-- Attribution for authenticated locate writes (R21). Distinct from the legacy
-- anonymous device_id above by design (see the identity ruling in the header).
-- ON DELETE SET NULL, not CASCADE: unpairing a board drops the attribution but
-- keeps the residual metrics the diagnostic exists for; account deletion still
-- removes the row through the existing user_id cascade.
ALTER TABLE locate_log ADD COLUMN device_row_id TEXT REFERENCES devices (id) ON DELETE SET NULL;

-- Today's daily insert cap counts rows per anonymous device within a window.
CREATE INDEX idx_locate_log_device_ts ON locate_log (device_id, ts);

-- Tier two of the retention purge (R20): delete rows past
-- LOCATE_LOG_RETENTION_DAYS, oldest first, in bounded batches.
CREATE INDEX idx_locate_log_ts ON locate_log (ts);

-- Tier one of the retention purge (R20): null the raw coordinate columns past
-- LOCATE_LOG_PRECISE_DAYS while the derived metrics survive. Partial on
-- est_lat so an already-nulled row leaves the index and is never re-processed,
-- which keeps a repeat run a cheap no-op instead of a full rescan.
CREATE INDEX idx_locate_log_precise_ts ON locate_log (ts) WHERE est_lat IS NOT NULL;

-- "Delete all my location history" (R21) deletes this user's rows.
CREATE INDEX idx_locate_log_user_id ON locate_log (user_id);

-- Two version counters, both halves of the config ETag. users.config_version is
-- bumped by every favorites/origins/walk_times write; feeds.data_version is
-- stamped by ingest when a feed's static data changes — without the second, a
-- recolored route would serve stale to the device forever.
ALTER TABLE users ADD COLUMN config_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE feeds ADD COLUMN data_version INTEGER NOT NULL DEFAULT 0;

-- AUTH_MODE=single binds to this fixed synthetic user (R5). It is seeded here
-- because sessions.user_id, favorites.user_id, and origins.user_id all carry an
-- FK to users: without the row, single-user mode cannot write a session. The id
-- is a contract with api/src/auth.ts — change it in both places or not at all.
-- INSERT OR IGNORE keeps re-application harmless.
INSERT OR IGNORE INTO users (id, email, created_at)
VALUES ('usr_single', NULL, CAST(strftime('%s', 'now') AS INTEGER));
