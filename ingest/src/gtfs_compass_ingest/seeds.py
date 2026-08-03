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
    # Authoritative static download list for multi-source feeds. None (the
    # default) means the single row["static_url"]. For multi-source feeds the
    # D1 static_url column is display-only; this list wins on every run.
    static_sources: list[str] | None = None


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
        "mode": "rail",
    },
    static_ingest=True,
)

# One feed, six static sources: MTA publishes bus GTFS per borough plus the
# MTA Bus Company set (all verified live 2026-08-03 on the same S3 bucket as
# the subway zip). They ingest as a single mta-bus feed_id; the first URL
# doubles as the display static_url.
MTA_BUS_STATIC_SOURCES = [
    "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_b.zip",  # Brooklyn
    "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_bx.zip",  # Bronx
    "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_m.zip",  # Manhattan
    "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_q.zip",  # Queens
    "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_si.zip",  # Staten Island
    "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_busco.zip",  # MTA Bus Company
]

MTA_BUS = CuratedFeed(
    row={
        "id": "mta-bus",
        "name": "MTA New York City Bus",
        "static_url": MTA_BUS_STATIC_SOURCES[0],  # display only; sources win
        # Citywide Bus Time trip updates: a plain single-group GTFS-RT feed,
        # so the generic gtfs_rt adapter needs no new code. The key is
        # documented-required but unenforced (verified live 2026-08-03);
        # rt_needs_key drives the Worker's optional key injection.
        "rt_trip_url": "https://gtfsrt.prod.obanyc.com/tripUpdates",
        "rt_alert_url": None,  # bus alerts deferred (AlertDO can take it later)
        "rt_needs_key": 1,
        "adapter": "gtfs_rt",
        "min_lat": 40.50,
        "max_lat": 40.92,
        "min_lon": -74.28,
        "max_lon": -73.68,
        "license_url": "https://www.mta.info/developers",
        "status": "active",
        # No platform suffixes on curb stops; the device renders compass tags.
        "direction_labels": None,
        "units": "imperial",
        "mode": "bus",
    },
    static_ingest=True,
    static_sources=MTA_BUS_STATIC_SOURCES,
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
        "mode": "bike",
    },
    static_ingest=True,
)

CURATED_FEEDS = (MTA_SUBWAY, MTA_BUS, CITIBIKE)

# Mobility Database ids whose systems a curated row already covers.
# mdb-511 = NYC Subway Supplemented (static), mdb-516 = NYC Subway (static);
# the NYC subway gtfs_rt rows all reference mdb-516 and follow it.
# TODO(beads follow-up): add the MTA-bus catalog ids once confirmed against
# the live Mobility Database — they could not be derived offline.
SUPPRESSED_CATALOG_IDS = frozenset({"mdb-511", "mdb-516"})

SUPPRESSED_STATUS = "suppressed"


def curated_rows(now: int) -> list[dict]:
    return [{**feed.row, "updated_at": now} for feed in CURATED_FEEDS]


def static_ingest_feed_ids() -> list[str]:
    return [feed.row["id"] for feed in CURATED_FEEDS if feed.static_ingest]


def static_sources_for(feed_id: str) -> list[str] | None:
    """Authoritative static source URLs for a curated feed; None for
    unknown/catalog feeds (those resolve their single URL from D1).

    Single-source curated feeds fall back to [static_url]; multi-source
    feeds declare static_sources explicitly.
    """
    for feed in CURATED_FEEDS:
        if feed.row["id"] == feed_id:
            if feed.static_sources is not None:
                return list(feed.static_sources)
            return [feed.row["static_url"]]
    return None


def adapter_for(feed_id: str) -> str | None:
    """Adapter name for a curated feed; None for unknown/catalog feeds.

    The static loop dispatches on this. Resolving from the seeds registry is
    sufficient because only curated feeds are static-ingested.
    """
    for feed in CURATED_FEEDS:
        if feed.row["id"] == feed_id:
            return feed.row["adapter"]
    return None
