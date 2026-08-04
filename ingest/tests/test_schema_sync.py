"""Assert the Python table specs match the api/migrations/*.sql files.

The migrations are the schema owner; the ingest job is a client. This test
closes the drift seam between the two at commit time. Columns are the
CREATE TABLE list plus any later ALTER TABLE ADD COLUMN, in migration order
(matching SQLite's actual column order).
"""

import re
import sqlite3
from pathlib import Path

import pytest
from gtfs_compass_ingest.tables import SYNCED_TABLES

MIGRATIONS_DIR = Path(__file__).parents[2] / "api" / "migrations"

CONSTRAINT_STARTERS = ("PRIMARY KEY", "CHECK", "UNIQUE", "FOREIGN KEY")


def migration_files():
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    assert files, f"no migrations found in {MIGRATIONS_DIR}"
    return files


def parse_create_table(sql, name):
    match = re.search(
        rf"CREATE TABLE {name}\s*\((.*?)\);", sql, re.DOTALL | re.IGNORECASE
    )
    assert match, f"table {name} not found in migrations"
    columns, pk = [], []
    for raw_line in match.group(1).splitlines():
        line = raw_line.split("--")[0].strip().rstrip(",")
        if not line:
            continue
        upper = line.upper()
        if upper.startswith("PRIMARY KEY"):
            pk = [c.strip() for c in re.search(r"\((.*?)\)", line).group(1).split(",")]
            continue
        if upper.startswith(CONSTRAINT_STARTERS):
            continue
        column = line.split()[0]
        columns.append(column)
        if "PRIMARY KEY" in upper:
            pk = [column]
    for added in re.finditer(
        rf"ALTER TABLE {name}\s+ADD COLUMN\s+(\w+)", sql, re.IGNORECASE
    ):
        columns.append(added.group(1))
    return columns, pk


@pytest.fixture(scope="module")
def migration_sql():
    # Concatenated in filename order so ALTER TABLE columns append in the
    # order SQLite would apply them.
    return "\n".join(path.read_text() for path in migration_files())


@pytest.mark.parametrize("spec", SYNCED_TABLES, ids=lambda spec: spec.name)
def test_spec_matches_migration(migration_sql, spec):
    columns, pk = parse_create_table(migration_sql, spec.name)
    assert list(spec.columns) == columns, (
        f"{spec.name}: Python spec columns {list(spec.columns)} != migration {columns}"
    )
    assert list(spec.pk_columns) == pk, (
        f"{spec.name}: Python spec pk {list(spec.pk_columns)} != migration {pk}"
    )


def test_ingest_lock_table_exists(migration_sql):
    columns, _ = parse_create_table(migration_sql, "ingest_lock")
    assert columns == ["id", "holder", "expires_at"]


def apply_migrations_over_existing_data():
    """Apply 0000, seed rows every later migration has to survive, then apply
    the rest. Returns the connection with foreign keys enforced (SQLite
    defaults them off, and D1 enforces them)."""
    db = sqlite3.connect(":memory:")
    files = migration_files()
    db.executescript(files[0].read_text())
    # Phase 1-4 rows: transit reference data plus the account and diagnostic
    # rows the Phase 5 ALTERs and indexes have to be added around.
    db.execute("INSERT INTO feeds (id, name) VALUES ('mta-subway', 'MTA')")
    db.execute(
        "INSERT INTO stops (feed_id, stop_id, name) VALUES ('mta-subway', '101', 'Jay St')"
    )
    db.execute("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@b.test', 1)")
    db.execute("INSERT INTO sessions (id, user_id, expires_at) VALUES ('s1', 'u1', 2)")
    # Two pre-Phase-5 devices with no token: the unique token_hash index in 0003
    # must tolerate repeated NULLs or it cannot be created over real data.
    db.execute("INSERT INTO devices (id, user_id) VALUES ('d1', 'u1')")
    db.execute("INSERT INTO devices (id, user_id) VALUES ('d2', 'u1')")
    db.execute("INSERT INTO favorites (id, user_id, label) VALUES ('f1', 'u1', 'Home')")
    db.execute("INSERT INTO origins (id, user_id, label) VALUES ('o1', 'u1', 'Home')")
    db.execute(
        "INSERT INTO locate_log (device_id, ts, est_lat, est_lon) VALUES ('anon', 1, 40.7, -73.9)"
    )
    for path in files[1:]:
        db.executescript(path.read_text())
    db.execute("PRAGMA foreign_keys = ON")
    return db


def index_list(db, table):
    """{index name: (unique, partial)} for one table."""
    return {
        row[1]: (bool(row[2]), bool(row[4]))
        for row in db.execute(f"PRAGMA index_list({table})")
    }


def test_migrations_apply_in_order_over_phase1_data():
    """The later migrations are additive: they must apply cleanly on a
    database already carrying Phase 1 rows, and the parsed specs must match
    SQLite's view."""
    db = apply_migrations_over_existing_data()

    for spec in SYNCED_TABLES:
        actual = [row[1] for row in db.execute(f"PRAGMA table_info({spec.name})")]
        assert actual == list(spec.columns), (
            f"{spec.name}: SQLite columns {actual} != spec {list(spec.columns)}"
        )
    # Phase 1 rows survived, new columns read back as NULL
    row = db.execute("SELECT capacity FROM stops WHERE stop_id = '101'").fetchone()
    assert row == (None,)
    # ...and the account rows the Phase 5 ALTERs ran over are still there.
    assert db.execute("SELECT COUNT(*) FROM devices").fetchone() == (2,)


# (table, index, unique, partial) — every index migration 0003 adds. The plan's
# read paths depend on these existing, and an index is silently absent when a
# CREATE INDEX is dropped in a merge, so they are asserted by name.
AUTH_INDEXES = [
    ("magic_tokens", "idx_magic_tokens_token_hash", True, False),
    ("magic_tokens", "idx_magic_tokens_email", False, False),
    ("magic_tokens", "idx_magic_tokens_expires_at", False, False),
    ("pairing_codes", "idx_pairing_codes_device_code_hash", True, False),
    ("pairing_codes", "idx_pairing_codes_user_code", False, False),
    ("pairing_codes", "idx_pairing_codes_expires_at", False, False),
    ("auth_budgets", "idx_auth_budgets_day", False, False),
    ("device_fixes", "idx_device_fixes_captured_at", False, False),
    ("devices", "idx_devices_token_hash", True, False),
    ("devices", "idx_devices_user_revoked", False, False),
    ("sessions", "idx_sessions_token_hash", True, False),
    ("sessions", "idx_sessions_user_id", False, False),
    ("favorites", "idx_favorites_user_id", False, False),
    ("origins", "idx_origins_user_id", False, False),
    ("locate_log", "idx_locate_log_device_ts", False, False),
    ("locate_log", "idx_locate_log_ts", False, False),
    # Partial on est_lat: an already-nulled row leaves the index, so the
    # first purge tier never re-processes it (R20).
    ("locate_log", "idx_locate_log_precise_ts", False, True),
    ("locate_log", "idx_locate_log_user_id", False, False),
]


@pytest.mark.parametrize(
    "table,index,unique,partial", AUTH_INDEXES, ids=lambda v: str(v)
)
def test_auth_index_exists(table, index, unique, partial):
    db = apply_migrations_over_existing_data()
    indexes = index_list(db, table)
    assert index in indexes, f"{index} missing from {table}: {sorted(indexes)}"
    assert indexes[index] == (unique, partial), (
        f"{index}: (unique, partial) is {indexes[index]}, expected {(unique, partial)}"
    )


def test_device_token_hash_is_unique_but_tolerates_nulls():
    """A token resolves to at most one device (R9) — while unpaired devices,
    which have no token at all, stay insertable."""
    db = apply_migrations_over_existing_data()
    db.execute("INSERT INTO devices (id, token_hash) VALUES ('d3', 'hash-a')")
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("INSERT INTO devices (id, token_hash) VALUES ('d4', 'hash-a')")
    db.execute("INSERT INTO devices (id, token_hash) VALUES ('d5', NULL)")
    db.execute("INSERT INTO devices (id, token_hash) VALUES ('d6', NULL)")


def test_device_scopes_default_excludes_read_fix():
    """R9: a freshly paired device never receives a position until the user
    grants read:fix, and the default is an explicit list, never NULL."""
    db = apply_migrations_over_existing_data()
    db.execute("INSERT INTO devices (id, user_id) VALUES ('d7', 'u1')")
    (scopes,) = db.execute("SELECT scopes FROM devices WHERE id = 'd7'").fetchone()
    assert scopes is not None
    granted = scopes.split(",")
    assert "read:fix" not in granted
    assert "read:departures" in granted
    # The devices that predate the migration get the same safe default.
    rows = db.execute("SELECT scopes FROM devices WHERE id IN ('d1', 'd2')").fetchall()
    assert all("read:fix" not in row[0] for row in rows)


def test_synthetic_single_mode_user_satisfies_the_sessions_fk():
    """R5: AUTH_MODE=single binds to a fixed user row, and sessions.user_id
    has an FK to users — so the row has to exist before the first sign-in."""
    db = apply_migrations_over_existing_data()
    assert db.execute("SELECT COUNT(*) FROM users WHERE id = 'usr_single'").fetchone() == (1,)
    db.execute(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES ('s-single', 'usr_single', 9)"
    )
    with pytest.raises(sqlite3.IntegrityError):
        db.execute(
            "INSERT INTO sessions (id, user_id, expires_at) VALUES ('s-x', 'nobody', 9)"
        )


def test_version_counters_default_to_zero_and_bump():
    """Both halves of U15's config ETag: users.config_version on any config
    write, feeds.data_version stamped by ingest."""
    db = apply_migrations_over_existing_data()
    assert db.execute("SELECT config_version FROM users WHERE id = 'u1'").fetchone() == (0,)
    assert db.execute("SELECT data_version FROM feeds WHERE id = 'mta-subway'").fetchone() == (0,)
    db.execute("UPDATE users SET config_version = config_version + 1 WHERE id = 'u1'")
    db.execute("UPDATE feeds SET data_version = data_version + 1 WHERE id = 'mta-subway'")
    assert db.execute("SELECT config_version FROM users WHERE id = 'u1'").fetchone() == (1,)
    assert db.execute("SELECT data_version FROM feeds WHERE id = 'mta-subway'").fetchone() == (1,)


def test_device_fix_cascades_with_its_device():
    """AE10: the relay row is reached by account deletion for free, through
    the devices FK — nothing has to remember to clear it."""
    db = apply_migrations_over_existing_data()
    db.execute(
        "INSERT INTO device_fixes (device_id, lat, lon, accuracy_m, captured_at, received_at)"
        " VALUES ('d1', 40.7, -73.9, 12.0, 100, 101)"
    )
    db.execute("DELETE FROM users WHERE id = 'u1'")
    assert db.execute("SELECT COUNT(*) FROM device_fixes").fetchone() == (0,)


def test_feeds_data_version_is_unmanaged_by_the_converge_loop():
    """The stamp is not part of the metadata diff: syncing it would reset it
    to whatever the catalog row carried, or rewrite every feed row each run."""
    from gtfs_compass_ingest.tables import FEEDS

    assert "data_version" in FEEDS.columns
    assert "data_version" not in FEEDS.sync_columns
