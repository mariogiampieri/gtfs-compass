"""Curated feed rows and catalog-suppression list.

Curated rows keep stable, human-readable feed ids (favorites will reference
them) and always win over catalog rows. The suppression list names Mobility
Database ids covering the same systems; those catalog rows are loaded with a
non-active status so downstream "which agencies serve here" queries never
return the same system twice.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class CuratedFeed:
    row: dict  # feeds-table row, minus updated_at (stamped at load time)
    static_ingest: bool  # include in the default `static`/`all` feed set


MTA_SUBWAY = CuratedFeed(
    row={
        "id": "mta-subway",
        "name": "MTA New York City Subway",
        "static_url": "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip",
        # Base (1234567S) feed; the eight NYCT group endpoints are an
        # adapter concern settled in Phase 2.
        "rt_trip_url": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
        "rt_alert_url": None,
        "rt_needs_key": 0,
        "adapter": "nyct",
        "min_lat": 40.50,
        "max_lat": 40.92,
        "min_lon": -74.28,
        "max_lon": -73.68,
        "license_url": "https://www.mta.info/developers",
        "status": "active",
    },
    static_ingest=True,
)

CURATED_FEEDS = (MTA_SUBWAY,)

# Mobility Database ids whose systems a curated row already covers.
# mdb-511 = NYC Subway Supplemented (static), mdb-516 = NYC Subway (static);
# the NYC subway gtfs_rt rows all reference mdb-516 and follow it.
SUPPRESSED_CATALOG_IDS = frozenset({"mdb-511", "mdb-516"})

SUPPRESSED_STATUS = "suppressed"


def curated_rows(now: int) -> list[dict]:
    return [{**feed.row, "updated_at": now} for feed in CURATED_FEEDS]


def static_ingest_feed_ids() -> list[str]:
    return [feed.row["id"] for feed in CURATED_FEEDS if feed.static_ingest]
