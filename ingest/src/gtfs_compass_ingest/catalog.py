"""Seed the feeds table from the Mobility Database catalog CSV.

Only `data_type=gtfs` rows become feeds rows; `gtfs_rt` rows attach their
URLs to the static feed they reference. Curated seed rows are merged last
and always win — there is no catalog-without-seeds operation.
"""

from __future__ import annotations

import csv
import io
import logging
import os

import requests

from . import seeds
from .load import D1Client, SyncStats, sync
from .tables import FEEDS

log = logging.getLogger(__name__)

DEFAULT_CSV_URL = "https://files.mobilitydatabase.org/feeds_v2.csv"


def csv_url() -> str:
    return os.environ.get("MOBILITY_DB_CSV_URL", DEFAULT_CSV_URL)


def fetch_catalog(url: str, session: requests.Session | None = None) -> str:
    resp = (session or requests).get(url, timeout=120)
    resp.raise_for_status()
    return resp.text


def build_feed_rows(catalog_text: str, now: int) -> list[dict]:
    rows = list(csv.DictReader(io.StringIO(catalog_text)))

    rt_by_static: dict[str, list[dict]] = {}
    for row in rows:
        if row.get("data_type") != "gtfs_rt" or row.get("status") != "active":
            continue
        static_id = (row.get("static_reference") or "").strip()
        if static_id:
            rt_by_static.setdefault(static_id, []).append(row)

    feed_rows = []
    for row in rows:
        if row.get("data_type") != "gtfs" or row.get("status") != "active":
            continue
        feed_id = (row.get("id") or "").strip()
        if not feed_id:
            log.warning("catalog row without id skipped: %.80s", row)
            continue

        rt_trip_url = rt_alert_url = None
        rt_needs_key = 0
        for rt in rt_by_static.get(feed_id, ()):
            url = rt.get("urls.direct_download") or rt.get("urls.latest") or None
            if not url:
                continue
            entities = (rt.get("entity_type") or "").split("|")
            if "tu" in entities and rt_trip_url is None:
                rt_trip_url = url
                if (rt.get("urls.authentication_type") or "0") not in ("", "0"):
                    rt_needs_key = 1
            if "sa" in entities and rt_alert_url is None:
                rt_alert_url = url

        suppressed = feed_id in seeds.SUPPRESSED_CATALOG_IDS
        feed_rows.append(
            {
                "id": feed_id,
                "name": row.get("provider") or row.get("name") or None,
                "static_url": row.get("urls.direct_download")
                or row.get("urls.latest")
                or None,
                "rt_trip_url": rt_trip_url,
                "rt_alert_url": rt_alert_url,
                "rt_needs_key": rt_needs_key,
                "adapter": "gtfs_rt",
                "min_lat": _coord(row, "location.bounding_box.minimum_latitude"),
                "max_lat": _coord(row, "location.bounding_box.maximum_latitude"),
                "min_lon": _coord(row, "location.bounding_box.minimum_longitude"),
                "max_lon": _coord(row, "location.bounding_box.maximum_longitude"),
                "license_url": row.get("urls.license") or None,
                "status": seeds.SUPPRESSED_STATUS if suppressed else "active",
                "updated_at": now,
            }
        )
    return feed_rows


def _coord(row: dict, column: str) -> float | None:
    value = (row.get(column) or "").strip()
    try:
        return float(value) if value else None
    except ValueError:
        return None


def run_catalog(
    client: D1Client | None,
    *,
    now: int,
    dry_run: bool = False,
    force: bool = False,
    session: requests.Session | None = None,
) -> SyncStats:
    catalog_text = fetch_catalog(csv_url(), session=session)
    feed_rows = build_feed_rows(catalog_text, now)

    # Curated seeds are an inseparable final step: merged last, they win.
    combined = {row["id"]: row for row in feed_rows}
    for row in seeds.curated_rows(now):
        combined[row["id"]] = row

    log.info(
        "catalog: %d active rows from Mobility Database, %d curated",
        len(feed_rows),
        len(seeds.CURATED_FEEDS),
    )
    if dry_run:
        return SyncStats(unchanged=len(combined))
    return sync(
        client,
        FEEDS,
        list(combined.values()),
        timestamp_column="updated_at",
        force=force,
    )
