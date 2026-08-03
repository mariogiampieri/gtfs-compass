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
        # Mercury JSON variant (verified live 2026-08-03, no key): the protobuf
        # feed's standard `effect` field is uniformly UNKNOWN_EFFECT, so the
        # alerts adapter reads Mercury's alert_type from the JSON body.
        "rt_alert_url": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json",
        "rt_needs_key": 0,
        "adapter": "nyct",
        "min_lat": 40.50,
        "max_lat": 40.92,
        "min_lon": -74.28,
        "max_lon": -73.68,
        "license_url": "https://www.mta.info/developers",
        "status": "active",
        # NYC subway platforms carry N/S suffixes mapping to direction_id 0/1.
        "direction_labels": '["Uptown","Downtown"]',
        "units": "imperial",
    },
    static_ingest=True,
)

CITIBIKE = CuratedFeed(
    row={
        "id": "citibike",
        "name": "Citi Bike NYC",
        # GBFS 2.3 (3.0 is 403 as of 2026-08-02); station_information stands in
        # as the "static" source — stations become stops rows with capacity.
        "static_url": "https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json",
        "rt_trip_url": "https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json",
        "rt_alert_url": None,
        "rt_needs_key": 0,
        "adapter": "gbfs",
        "min_lat": 40.50,
        "max_lat": 40.92,
        "min_lon": -74.28,
        "max_lon": -73.68,
        "license_url": "https://citibikenyc.com/data-sharing-policy",
        "status": "active",
        "direction_labels": None,  # bikes have no directions
        "units": "imperial",
    },
    static_ingest=True,
)

CURATED_FEEDS = (MTA_SUBWAY, CITIBIKE)

# Mobility Database ids whose systems a curated row already covers.
# mdb-511 = NYC Subway Supplemented (static), mdb-516 = NYC Subway (static);
# the NYC subway gtfs_rt rows all reference mdb-516 and follow it.
SUPPRESSED_CATALOG_IDS = frozenset({"mdb-511", "mdb-516"})

SUPPRESSED_STATUS = "suppressed"


def curated_rows(now: int) -> list[dict]:
    return [{**feed.row, "updated_at": now} for feed in CURATED_FEEDS]


def static_ingest_feed_ids() -> list[str]:
    return [feed.row["id"] for feed in CURATED_FEEDS if feed.static_ingest]


def adapter_for(feed_id: str) -> str | None:
    """Adapter name for a curated feed; None for unknown/catalog feeds.

    The static loop dispatches on this. Resolving from the seeds registry is
    sufficient because only curated feeds are static-ingested.
    """
    for feed in CURATED_FEEDS:
        if feed.row["id"] == feed_id:
            return feed.row["adapter"]
    return None
