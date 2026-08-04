"""Table specs for everything the ingest job writes.

These must match the api/migrations/*.sql files exactly (CREATE TABLE plus
any later ALTER TABLE ADD COLUMN, in migration order);
tests/test_schema_sync.py enforces that at commit time.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class TableSpec:
    name: str
    columns: tuple[str, ...]
    pk_columns: tuple[str, ...]
    # Columns the schema owns but the converge loop must neither read nor
    # write. They still appear in `columns` because tests/test_schema_sync.py
    # holds this spec to the migration's exact column list.
    unmanaged_columns: tuple[str, ...] = ()

    @property
    def sync_columns(self) -> tuple[str, ...]:
        return tuple(c for c in self.columns if c not in self.unmanaged_columns)


FEEDS = TableSpec(
    name="feeds",
    columns=(
        "id",
        "name",
        "static_url",
        "rt_trip_url",
        "rt_alert_url",
        "rt_needs_key",
        "adapter",
        "min_lat",
        "max_lat",
        "min_lon",
        "max_lon",
        "license_url",
        "status",
        "updated_at",
        "direction_labels",
        "units",
        "mode",
        "data_version",
    ),
    pk_columns=("id",),
    # data_version is stamped out of band (it bumps when a feed's static data
    # changes, and the device's config ETag reads it). Syncing it would either
    # reset the stamp to whatever the catalog row happened to carry or rewrite
    # every feed row on each run, so the metadata converge loop leaves it alone.
    unmanaged_columns=("data_version",),
)

STOPS = TableSpec(
    name="stops",
    columns=("feed_id", "stop_id", "name", "lat", "lon", "parent_station", "capacity"),
    pk_columns=("feed_id", "stop_id"),
)

ROUTES = TableSpec(
    name="routes",
    columns=(
        "feed_id",
        "route_id",
        "short_name",
        "long_name",
        "color",
        "text_color",
        "route_type",
    ),
    pk_columns=("feed_id", "route_id"),
)

STOP_ROUTES = TableSpec(
    name="stop_routes",
    columns=("feed_id", "stop_id", "route_id"),
    pk_columns=("feed_id", "stop_id", "route_id"),
)

ROUTE_DIRECTIONS = TableSpec(
    name="route_directions",
    columns=("feed_id", "route_id", "direction_id", "headsign"),
    pk_columns=("feed_id", "route_id", "direction_id"),
)

SYNCED_TABLES = (FEEDS, STOPS, ROUTES, STOP_ROUTES, ROUTE_DIRECTIONS)
