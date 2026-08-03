"""GBFS static ingest: station_information becomes stops rows for one feed.

Bike stations live in the stops table (feed-scoped, with capacity) so the
same bbox+haversine proximity seam serves all modes. The feed's static_url
points at station_information.json (curated seed); realtime counts come from
station_status via the Worker's GbfsDO, keyed by stop_id = station_id.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import requests

from .load import D1Client, sync
from .static_gtfs import resolve_static_url
from .tables import STOPS

log = logging.getLogger(__name__)


@dataclass
class GbfsStats:
    stations_written: int = 0
    pruned: int = 0
    skipped: int = 0


def run_gbfs_static(
    client: D1Client | None,
    feed_id: str,
    *,
    dry_run: bool = False,
    force: bool = False,
    http_session: requests.Session | None = None,
) -> GbfsStats:
    url = resolve_static_url(client, feed_id)
    payload = _fetch_json(url, http_session)
    rows, skipped = _parse_stations(payload, feed_id)

    log.info("%s: parsed %d stations (%d skipped)", feed_id, len(rows), skipped)
    stats = GbfsStats(skipped=skipped)
    if dry_run:
        return stats

    sync_stats = sync(
        client,
        STOPS,
        rows,
        scope_where="feed_id = ?",
        scope_params=[feed_id],
        force=force,
    )
    stats.stations_written = sync_stats.written
    stats.pruned = sync_stats.deleted
    return stats


def _fetch_json(url: str, session: requests.Session | None) -> dict:
    resp = (session or requests).get(url, timeout=120)
    resp.raise_for_status()
    return resp.json()


def _parse_stations(payload: dict, feed_id: str) -> tuple[list[dict], int]:
    stations = (payload.get("data") or {}).get("stations")
    if stations is None:
        raise ValueError(f"{feed_id}: GBFS payload has no data.stations")

    rows, skipped = [], 0
    for station in stations:
        if not isinstance(station, dict):
            skipped += 1  # non-dict entry: skip-and-count, never crash the run
            continue
        station_id = str(station.get("station_id") or "").strip()
        if not station_id:
            skipped += 1
            continue
        rows.append(
            {
                "feed_id": feed_id,
                "stop_id": station_id,
                "name": (station.get("name") or "").strip() or None,
                "lat": _optional_number(station.get("lat")),
                "lon": _optional_number(station.get("lon")),
                "parent_station": None,  # GBFS stations have no hierarchy
                "capacity": _optional_int(station.get("capacity")),
            }
        )
    if skipped:
        log.warning("%s: %d stations without station_id skipped", feed_id, skipped)
    return rows, skipped


def _optional_number(value) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _optional_int(value) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None
