"""Static GTFS ingest: stops, routes, and stop-route edges for one feed.

Streams straight out of the zip with stdlib csv. Load order is fixed so no
reader ever sees an edge pointing at a missing stop: upsert stops and routes
before stop_routes; prune stop_routes before stops and routes.
"""

from __future__ import annotations

import csv
import io
import logging
import zipfile
from dataclasses import dataclass

import requests

from . import seeds
from .load import D1Client, prune_only, sync
from .tables import ROUTES, STOP_ROUTES, STOPS

log = logging.getLogger(__name__)

# location_type: '' / 0 = platform or simple stop, 1 = station. Entrances (2),
# generic nodes (3), and boarding areas (4) are navigation aids, not places a
# vehicle stops — loading them would surface entrance ids in proximity results.
LOADED_LOCATION_TYPES = ("", "0", "1")


@dataclass
class StaticStats:
    stops_written: int = 0
    routes_written: int = 0
    edges_written: int = 0
    pruned: int = 0
    skipped_locations: int = 0


def run_static(
    client: D1Client | None,
    feed_id: str,
    *,
    dry_run: bool = False,
    force: bool = False,
    http_session: requests.Session | None = None,
) -> StaticStats:
    url = _resolve_static_url(client, feed_id)
    data = _fetch_zip(url, http_session)

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        stop_rows, skipped = _parse_stops(zf, feed_id)
        route_rows = _parse_routes(zf, feed_id)
        edge_rows = _derive_edges(zf, feed_id, stop_rows, route_rows)

    log.info(
        "%s: parsed %d stops (%d non-stop locations skipped), %d routes, %d edges",
        feed_id,
        len(stop_rows),
        skipped,
        len(route_rows),
        len(edge_rows),
    )
    stats = StaticStats(skipped_locations=skipped)
    if dry_run:
        return stats

    scope = {"scope_where": "feed_id = ?", "scope_params": [feed_id]}

    stats.stops_written = sync(client, STOPS, stop_rows, prune=False, **scope).written
    stats.routes_written = sync(client, ROUTES, route_rows, prune=False, **scope).written
    edge_stats = sync(client, STOP_ROUTES, edge_rows, force=force, **scope)
    stats.edges_written = edge_stats.written
    stats.pruned = edge_stats.deleted

    stats.pruned += prune_only(
        client,
        STOPS,
        {(feed_id, row["stop_id"]) for row in stop_rows},
        force=force,
        **scope,
    )
    stats.pruned += prune_only(
        client,
        ROUTES,
        {(feed_id, row["route_id"]) for row in route_rows},
        force=force,
        **scope,
    )
    return stats


def _resolve_static_url(client: D1Client | None, feed_id: str) -> str:
    if client is not None:
        result = client.query("SELECT static_url FROM feeds WHERE id = ?", [feed_id])
        rows = result["results"]
        if not rows or not rows[0]["static_url"]:
            raise ValueError(
                f"feed {feed_id!r} has no static_url in D1 — run catalog ingest first"
            )
        return rows[0]["static_url"]
    for feed in seeds.CURATED_FEEDS:  # dry-run without credentials
        if feed.row["id"] == feed_id and feed.row["static_url"]:
            return feed.row["static_url"]
    raise ValueError(f"feed {feed_id!r} unknown without a D1 connection")


def _fetch_zip(url: str, session: requests.Session | None) -> bytes:
    resp = (session or requests).get(url, timeout=300)
    resp.raise_for_status()
    return resp.content


def _open_member(zf: zipfile.ZipFile, name: str):
    return csv.DictReader(
        io.TextIOWrapper(zf.open(name), encoding="utf-8-sig", newline="")
    )


def _parse_stops(zf: zipfile.ZipFile, feed_id: str) -> tuple[list[dict], int]:
    rows, skipped = [], 0
    for row in _open_member(zf, "stops.txt"):
        if (row.get("location_type") or "").strip() not in LOADED_LOCATION_TYPES:
            skipped += 1
            continue
        stop_id = (row.get("stop_id") or "").strip()
        if not stop_id:
            skipped += 1
            continue
        rows.append(
            {
                "feed_id": feed_id,
                "stop_id": stop_id,
                "name": (row.get("stop_name") or "").strip() or None,
                "lat": _number(row.get("stop_lat")),
                "lon": _number(row.get("stop_lon")),
                "parent_station": (row.get("parent_station") or "").strip() or None,
            }
        )
    return rows, skipped


def _parse_routes(zf: zipfile.ZipFile, feed_id: str) -> list[dict]:
    rows = []
    for row in _open_member(zf, "routes.txt"):
        route_id = (row.get("route_id") or "").strip()
        if not route_id:
            continue
        route_type = (row.get("route_type") or "").strip()
        rows.append(
            {
                "feed_id": feed_id,
                "route_id": route_id,
                "short_name": (row.get("route_short_name") or "").strip() or None,
                "long_name": (row.get("route_long_name") or "").strip() or None,
                "color": (row.get("route_color") or "").strip() or None,
                "text_color": (row.get("route_text_color") or "").strip() or None,
                "route_type": int(route_type) if route_type.isdigit() else None,
            }
        )
    return rows


def _derive_edges(
    zf: zipfile.ZipFile, feed_id: str, stop_rows: list[dict], route_rows: list[dict]
) -> list[dict]:
    known_routes = {row["route_id"] for row in route_rows}
    known_stops = {row["stop_id"] for row in stop_rows}

    trip_to_route: dict[str, str] = {}
    unknown_routes = 0
    for row in _open_member(zf, "trips.txt"):
        route_id, trip_id = (row.get("route_id") or "").strip(), (row.get("trip_id") or "").strip()
        if not trip_id:
            continue
        if route_id not in known_routes:
            unknown_routes += 1
            continue
        trip_to_route[trip_id] = route_id

    edges: set[tuple[str, str]] = set()
    unknown_trips = unknown_stops = 0
    for row in _open_member(zf, "stop_times.txt"):
        trip_id = (row.get("trip_id") or "").strip()
        stop_id = (row.get("stop_id") or "").strip()
        route_id = trip_to_route.get(trip_id)
        if route_id is None:
            unknown_trips += 1
            continue
        if stop_id not in known_stops:
            unknown_stops += 1
            continue
        edges.add((stop_id, route_id))

    for label, count in (
        ("trips with unknown route_id", unknown_routes),
        ("stop_times with unknown trip_id", unknown_trips),
        ("stop_times with unknown stop_id", unknown_stops),
    ):
        if count:
            log.warning("%s: %d %s skipped", feed_id, count, label)

    return [
        {"feed_id": feed_id, "stop_id": stop_id, "route_id": route_id}
        for stop_id, route_id in sorted(edges)
    ]


def _number(value: str | None) -> float | None:
    value = (value or "").strip()
    try:
        return float(value) if value else None
    except ValueError:
        return None
