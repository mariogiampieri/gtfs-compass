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


def test_migrations_apply_in_order_over_phase1_data():
    """0001 is additive: it must apply cleanly on a database already
    carrying Phase 1 rows, and the parsed specs must match SQLite's view."""
    db = sqlite3.connect(":memory:")
    files = migration_files()
    db.executescript(files[0].read_text())
    db.execute("INSERT INTO feeds (id, name) VALUES ('mta-subway', 'MTA')")
    db.execute(
        "INSERT INTO stops (feed_id, stop_id, name) VALUES ('mta-subway', '101', 'Jay St')"
    )
    for path in files[1:]:
        db.executescript(path.read_text())

    for spec in SYNCED_TABLES:
        actual = [row[1] for row in db.execute(f"PRAGMA table_info({spec.name})")]
        assert actual == list(spec.columns), (
            f"{spec.name}: SQLite columns {actual} != spec {list(spec.columns)}"
        )
    # Phase 1 rows survived, new columns read back as NULL
    row = db.execute("SELECT capacity FROM stops WHERE stop_id = '101'").fetchone()
    assert row == (None,)
