"""Static GTFS ingest: stops, routes, and stop-route edges for one feed.

Streams straight out of the zip with stdlib csv. Load order is fixed so no
reader ever sees an edge pointing at a missing stop: upsert stops and routes
before stop_routes; prune stop_routes before stops and routes.

A feed may be built from several source zips (mta-bus: five boroughs plus
the MTA Bus Company set under one feed_id). Sources parse sequentially —
one zip's stop_times in memory at a time — and merge into accumulated row
dicts; Sync runs once with the merged sets so the prune keep-set spans every
source. Any failed, oversized, hollow, or conflicting source keeps the
healthy upserts but refuses the feed's prune (superset over deletion).
"""

from __future__ import annotations

import csv
import io
import logging
import re
import zipfile
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field

import requests

from . import seeds
from .load import D1Client, PruneRefused, parse_optional_float, prune_only, sync
from .tables import ROUTE_DIRECTIONS, ROUTES, STOP_ROUTES, STOPS

log = logging.getLogger(__name__)

# NYCT convention (verified against trips.txt on every run): platform suffix
# N <-> direction_id 0, S <-> direction_id 1. The composer's direction split
# depends on this holding.
EXPECTED_NS_MAPPING = {0: "N", 1: "S"}

# NYCT trip_ids encode the platform direction of the path: "..N03R" / "..S03R".
NYCT_TRIP_DIRECTION = re.compile(r"\.\.([NS])")

# location_type: '' / 0 = platform or simple stop, 1 = station. Entrances (2),
# generic nodes (3), and boarding areas (4) are navigation aids, not places a
# vehicle stops — loading them would surface entrance ids in proximity results.
LOADED_LOCATION_TYPES = ("", "0", "1")

# Streamed per-source download cap: ~10x the largest observed borough zip
# (~8 MB). A breach mid-stream is treated exactly like a failed download.
MAX_SOURCE_BYTES = 80 * 1024 * 1024

# Absolute per-source health floors for multi-source feeds (R3): D1 keeps no
# per-source provenance under the single feed_id, so last-run comparisons are
# unavailable, and one hollow borough (~15-20% of the merged feed) slips under
# the 50% deletion guard. Staten Island, the smallest real source, carries
# roughly 600 stops and ~30 routes. Single-source feeds keep the existing
# sync-level guards (empty keep-set / 50% threshold).
# Calibrated against the live per-source counts (2026-08-03): the smallest
# zips carried ~1,400 stops (Queens) and 92 routes (busco), so 500/40
# catches a truncated-but-parseable zip at ~1/3 of the smallest healthy
# source while leaving real publication variance ample headroom.
MIN_SOURCE_STOPS = 500
MIN_SOURCE_ROUTES = 40


class SourceTooLarge(RuntimeError):
    """A static source exceeded MAX_SOURCE_BYTES mid-download."""


# A source counts as failed on network errors, a corrupt zip, a zip missing a
# required member (KeyError from ZipFile.open), or blowing the download cap.
# Fetch+parse never touches D1, so a failure here can only cost this source's
# rows — never already-landed upserts.
SOURCE_FAILURES = (requests.RequestException, zipfile.BadZipFile, KeyError, SourceTooLarge)


@dataclass
class StaticStats:
    stops_written: int = 0
    routes_written: int = 0
    edges_written: int = 0
    directions_written: int = 0
    pruned: int = 0
    skipped_locations: int = 0
    skipped_directionless: int = 0
    sources_failed: int = 0
    duplicates_deduped: int = 0  # normalized-identical rows across sources
    duplicate_conflicts: int = 0  # same id, different payload across sources


@dataclass
class _MergedFeed:
    """Rows accumulated across a feed's sources, keyed by table PK."""

    stops: dict[str, dict] = field(default_factory=dict)
    routes: dict[str, dict] = field(default_factory=dict)
    edges: dict[tuple[str, str], dict] = field(default_factory=dict)
    direction_votes: dict[tuple[str, int], Counter] = field(default_factory=dict)


def run_static(
    client: D1Client | None,
    feed_id: str,
    *,
    dry_run: bool = False,
    force: bool = False,
    http_session: requests.Session | None = None,
    renew_lock: Callable[[], bool] | None = None,
) -> StaticStats:
    sources = seeds.static_sources_for(feed_id)
    if sources is None:  # catalog-only feed: single URL from D1
        sources = [resolve_static_url(client, feed_id)]
    multi_source = len(sources) > 1

    stats = StaticStats()
    merged = _MergedFeed()
    refusals: list[str] = []  # availability/health: --force may override
    conflict_refusals: list[str] = []  # data disagreement: never overridable

    for index, url in enumerate(sources):
        if index and renew_lock is not None and not renew_lock():
            # Writing on past a lost claim risks two hosts converging D1 at
            # once; this is fatal for the whole run, not just this feed.
            raise RuntimeError(f"{feed_id}: lost the D1 ingest lock between static sources")
        try:
            data = _fetch_zip(url, http_session)
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                stop_rows, skipped = _parse_stops(zf, feed_id)
                route_rows = _parse_routes(zf, feed_id)
                edge_rows = _derive_edges(zf, feed_id, stop_rows, route_rows)
                votes, skipped_directionless = _collect_direction_votes(zf, feed_id)
        except SOURCE_FAILURES as exc:
            stats.sources_failed += 1
            reason = f"source {url} failed: {exc.__class__.__name__}: {exc}"
            log.error("%s: %s — feed prune disabled, healthy upserts still land", feed_id, reason)
            refusals.append(reason)
            continue

        log.info(
            "%s: %s parsed %d stops (%d non-stop locations skipped), %d routes, "
            "%d edges, %d directed routes",
            feed_id, url, len(stop_rows), skipped, len(route_rows), len(edge_rows), len(votes),
        )
        stats.skipped_locations += skipped
        stats.skipped_directionless += skipped_directionless

        if multi_source and (
            len(stop_rows) < MIN_SOURCE_STOPS or len(route_rows) < MIN_SOURCE_ROUTES
        ):
            reason = (
                f"source {url} is hollow: {len(stop_rows)} stops / "
                f"{len(route_rows)} routes (floors {MIN_SOURCE_STOPS}/{MIN_SOURCE_ROUTES})"
            )
            log.error("%s: %s — feed prune disabled", feed_id, reason)
            refusals.append(reason)

        # Merge into the accumulated feed. Rows land regardless of health —
        # upserts are convergent and the prune is already refused above —
        # but a genuine payload conflict also refuses the prune, loudly.
        for accum, rows, key_column, table_name in (
            (merged.stops, stop_rows, "stop_id", STOPS.name),
            (merged.routes, route_rows, "route_id", ROUTES.name),
        ):
            deduped, conflicts = _merge_source_rows(
                accum, rows, key_column, table_name, feed_id, url
            )
            stats.duplicates_deduped += deduped
            stats.duplicate_conflicts += conflicts
            if conflicts:
                conflict_refusals.append(
                    f"{conflicts} conflicting {table_name} rows from {url}"
                )
        # Edge rows are pure PK tuples: cross-source repeats are always
        # identical, so union silently.
        merged.edges.update(((row["stop_id"], row["route_id"]), row) for row in edge_rows)
        # route_directions merge at the vote level; dominants are picked once
        # after every source has voted, never row-level last-wins.
        for key, counter in votes.items():
            merged.direction_votes.setdefault(key, Counter()).update(counter)

    stop_rows = list(merged.stops.values())
    route_rows = list(merged.routes.values())
    edge_rows = [merged.edges[key] for key in sorted(merged.edges)]
    direction_rows = _directions_from_votes(feed_id, merged.direction_votes)

    if multi_source:
        log.info(
            "%s: merged %d stops, %d routes, %d edges, %d route directions "
            "from %d sources (%d failed)",
            feed_id, len(stop_rows), len(route_rows), len(edge_rows),
            len(direction_rows), len(sources), stats.sources_failed,
        )
    all_refusals = refusals + conflict_refusals
    if force and refusals and not conflict_refusals:
        # Operator override for a permanently-dead or hollow source (the
        # long-term fix is a seeds.py edit): prune converges on the
        # surviving sources. Conflicts are data disagreements and stay
        # force-proof.
        log.warning(
            "%s: --force overriding %d source refusal(s); pruning on the "
            "surviving sources", feed_id, len(refusals),
        )
        all_refusals = []
    if dry_run:
        if all_refusals:
            raise PruneRefused(f"{feed_id}: {'; '.join(all_refusals)}")
        return stats

    prune = not all_refusals
    scope = {"scope_where": "feed_id = ?", "scope_params": [feed_id]}

    stats.stops_written = sync(client, STOPS, stop_rows, prune=False, **scope).written
    stats.routes_written = sync(client, ROUTES, route_rows, prune=False, **scope).written
    edge_stats = sync(client, STOP_ROUTES, edge_rows, prune=prune, force=force, **scope)
    stats.edges_written = edge_stats.written
    stats.pruned = edge_stats.deleted
    direction_stats = sync(
        client, ROUTE_DIRECTIONS, direction_rows, prune=prune, force=force, **scope
    )
    stats.directions_written = direction_stats.written
    stats.pruned += direction_stats.deleted

    if not prune:
        # Upserts above all landed; leaving stale rows behind (superset) is
        # the safe failure. Raising here rides the existing PruneRefused
        # path so the run exits non-zero.
        raise PruneRefused(
            f"{feed_id}: prune skipped after upserts — {'; '.join(all_refusals)}"
        )

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


def _normalized_payload(row: dict) -> tuple:
    """Comparison view of a row: trimmed/case-folded text and 5-decimal
    coordinates, so cross-source duplicates differing only in cosmetic noise
    compare equal (the six bus zips are generated independently)."""
    normalized = []
    for column in sorted(row):
        value = row[column]
        if isinstance(value, str):
            value = value.strip().casefold()
        elif isinstance(value, float):
            value = round(value, 5)
        normalized.append((column, value))
    return tuple(normalized)


# Same-id stops closer than this are the same physical stop published with
# survey drift, not a conflict. Measured against the live zips (2026-08-03):
# borough vs busco rows for shared stop boxes differ by ~15-30 m and by name
# abbreviation ("EAST" vs "E"), across 781 ids — exact-payload identity would
# refuse the nightly prune forever. A reused id for a *different* place is
# what the conflict path exists to catch, and distance is its real signal.
STOP_DRIFT_TOLERANCE_DEG = 0.001  # ~111 m latitude; generous for GPS drift
# Name-identical same-id stops get a looser allowance: the live zips carry a
# handful ~90-150 m apart (wide parkway intersections, disagreeing pole
# placements) with byte-equal names — same stop, not a reused id.
STOP_DRIFT_SAME_NAME_DEG = 0.0025


def _same_stop_within_drift(seen: dict, row: dict) -> bool:
    try:
        same_name = (seen.get("name") or "").strip().casefold() == (
            row.get("name") or ""
        ).strip().casefold()
        tolerance = STOP_DRIFT_SAME_NAME_DEG if same_name else STOP_DRIFT_TOLERANCE_DEG
        return (
            abs(float(seen["lat"]) - float(row["lat"])) <= tolerance
            and abs(float(seen["lon"]) - float(row["lon"])) <= tolerance
            and (seen.get("parent_station") or None) == (row.get("parent_station") or None)
        )
    except (KeyError, TypeError, ValueError):
        return False


def _merge_source_rows(
    accum: dict[str, dict],
    rows: list[dict],
    key_column: str,
    table_name: str,
    feed_id: str,
    source: str,
) -> tuple[int, int]:
    """Merge one source's rows into the accumulated dict; returns
    (deduped, conflicts). Normalized-equal duplicates dedupe silently;
    conflicting payloads keep the first-seen row (the caller refuses the
    feed's prune so the disagreement degrades to a loud nightly warning,
    never a deletion or a run-killing error)."""
    deduped = conflicts = 0
    examples: list[str] = []
    for row in rows:
        key = row[key_column]
        seen = accum.get(key)
        if seen is None:
            accum[key] = row
        elif _normalized_payload(seen) == _normalized_payload(row):
            deduped += 1
        elif table_name == "stops" and _same_stop_within_drift(seen, row):
            # Coordinate-proximate same-id stops: survey drift between
            # generators, first-seen text wins, not a conflict.
            deduped += 1
        else:
            conflicts += 1
            if len(examples) < 5:
                examples.append(key)
    if deduped:
        log.info(
            "%s: %d normalized-identical duplicate %s rows from %s deduped",
            feed_id, deduped, table_name, source,
        )
    if conflicts:
        log.error(
            "%s: %d CONFLICTING duplicate %s rows from %s (e.g. %s) — keeping "
            "first-seen values and refusing this feed's prune",
            feed_id, conflicts, table_name, source, examples,
        )
    return deduped, conflicts


def resolve_static_url(client: D1Client | None, feed_id: str) -> str:
    """Static source URL for a feed: D1 when connected, seeds in dry-run.

    Shared with the GBFS ingest, whose "static" source is station_information.
    """
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
    """Streamed download with a hard byte cap.

    The cap is counted over received bytes, not Content-Length, so a lying
    or absent header can't sneak an unbounded body into memory.
    """
    resp = (session or requests).get(url, timeout=300, stream=True)
    resp.raise_for_status()
    chunks, total = [], 0
    for chunk in resp.iter_content(chunk_size=1 << 20):
        total += len(chunk)
        if total > MAX_SOURCE_BYTES:
            raise SourceTooLarge(f"{url} exceeded {MAX_SOURCE_BYTES} bytes mid-download")
        chunks.append(chunk)
    return b"".join(chunks)


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
                "lat": parse_optional_float(row.get("stop_lat")),
                "lon": parse_optional_float(row.get("stop_lon")),
                "parent_station": (row.get("parent_station") or "").strip() or None,
                "capacity": None,  # GBFS-only column; rail stops have none
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


def _collect_direction_votes(
    zf: zipfile.ZipFile, feed_id: str
) -> tuple[dict[tuple[str, int], Counter], int]:
    """Headsign vote counters per (route_id, direction_id) from trips.txt.

    Votes stay counters here so a multi-source feed can union them across
    sources before dominants are picked (_directions_from_votes); picking
    per source would silently make the last source's dominant win.
    """
    votes: dict[tuple[str, int], Counter] = {}
    ns_votes: Counter = Counter()  # (direction_id, 'N'|'S') observed pairs
    skipped_directionless = 0

    for row in _open_member(zf, "trips.txt"):
        route_id = (row.get("route_id") or "").strip()
        if not route_id:
            continue
        direction = (row.get("direction_id") or "").strip()
        if direction not in ("0", "1"):
            skipped_directionless += 1
            continue
        direction_id = int(direction)
        counter = votes.setdefault((route_id, direction_id), Counter())
        headsign = (row.get("trip_headsign") or "").strip()
        if headsign:
            counter[headsign] += 1
        match = NYCT_TRIP_DIRECTION.search((row.get("trip_id") or "").strip())
        if match:
            ns_votes[(direction_id, match.group(1))] += 1

    if skipped_directionless:
        log.warning(
            "%s: %d trips without a usable direction_id skipped in the "
            "route_directions pass",
            feed_id,
            skipped_directionless,
        )
    _verify_ns_convention(feed_id, ns_votes)
    return votes, skipped_directionless


def _directions_from_votes(
    feed_id: str, votes: dict[tuple[str, int], Counter]
) -> list[dict]:
    """Dominant trip_headsign per (route_id, direction_id) from merged votes.

    Counted vote with a deterministic tie-break (highest count, then
    lexicographically smallest headsign). The result is the composition-time
    fallback when a realtime trip's terminal is missing or unresolvable.
    """
    return [
        {
            "feed_id": feed_id,
            "route_id": route_id,
            "direction_id": direction_id,
            "headsign": _dominant(counter),
        }
        for (route_id, direction_id), counter in sorted(votes.items())
    ]


def _dominant(counter: Counter) -> str | None:
    if not counter:
        return None
    return min(counter.items(), key=lambda item: (-item[1], item[0]))[0]


def _verify_ns_convention(feed_id: str, ns_votes: Counter) -> None:
    """Empirically confirm platform-suffix N/S <-> direction_id 0/1.

    NYCT trip_ids carry the path direction ("..N03R"); feeds without that
    encoding contribute no votes and skip the check. A disagreement is loud —
    a swapped mapping would flip every on-device direction label — but stays
    a warning: the check is advisory and must not abort the feed load.
    """
    if not ns_votes:
        return
    observed = {}
    for direction_id in (0, 1):
        counts = {c: ns_votes.get((direction_id, c), 0) for c in ("N", "S")}
        if any(counts.values()):
            observed[direction_id] = max(counts, key=counts.get)
    log.info(
        "%s: observed direction_id -> platform-suffix mapping %s from trips.txt",
        feed_id,
        observed,
    )
    for direction_id, suffix in observed.items():
        if EXPECTED_NS_MAPPING.get(direction_id) != suffix:
            log.warning(
                "%s: direction convention MISMATCH — trips.txt says "
                "direction_id %d <-> %r, expected %r; the composer's N/S "
                "direction split relies on the expected mapping",
                feed_id,
                direction_id,
                suffix,
                EXPECTED_NS_MAPPING.get(direction_id),
            )
