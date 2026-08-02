"""Table specs for everything the ingest job writes.

These must match api/migrations/0000_initial_schema.sql exactly;
tests/test_schema_sync.py enforces that at commit time.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class TableSpec:
    name: str
    columns: tuple[str, ...]
    pk_columns: tuple[str, ...]


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
    ),
    pk_columns=("id",),
)

STOPS = TableSpec(
    name="stops",
    columns=("feed_id", "stop_id", "name", "lat", "lon", "parent_station"),
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

SYNCED_TABLES = (FEEDS, STOPS, ROUTES, STOP_ROUTES)
