"""Assert the Python table specs match api/migrations/0000_initial_schema.sql.

The migration is the schema owner; the ingest job is a client. This test
closes the drift seam between the two at commit time.
"""

import re
from pathlib import Path

import pytest

from gtfs_compass_ingest.tables import SYNCED_TABLES

MIGRATION = (
    Path(__file__).parents[2] / "api" / "migrations" / "0000_initial_schema.sql"
)

CONSTRAINT_STARTERS = ("PRIMARY KEY", "CHECK", "UNIQUE", "FOREIGN KEY")


def parse_create_table(sql, name):
    match = re.search(
        rf"CREATE TABLE {name}\s*\((.*?)\);", sql, re.DOTALL | re.IGNORECASE
    )
    assert match, f"table {name} not found in migration"
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
    return columns, pk


@pytest.fixture(scope="module")
def migration_sql():
    return MIGRATION.read_text()


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
