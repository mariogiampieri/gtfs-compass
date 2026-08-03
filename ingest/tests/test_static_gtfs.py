import io
import logging
import zipfile

import pytest
import requests
from conftest import FakeSession
from gtfs_compass_ingest import seeds, static_gtfs
from gtfs_compass_ingest.load import D1Client, PruneRefused
from gtfs_compass_ingest.static_gtfs import run_static

STOPS = """stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station
101,Jay St,40.69,-73.98,1,
101N,Jay St,40.69,-73.98,,101
101S,Jay St,40.69,-73.98,0,101
E01,Jay St Entrance,40.69,-73.98,2,101
"""

ROUTES = """route_id,route_short_name,route_long_name,route_color,route_text_color,route_type
A,A,8 Avenue Express,0062CF,FFFFFF,1
F,F,Queens Blvd Local,FF6319,FFFFFF,1
"""

# Column order differs from stops.txt on purpose (DictReader independence).
TRIPS = """service_id,trip_id,route_id
wk,t1,A
wk,t2,F
wk,t3,GHOST
"""

STOP_TIMES = """trip_id,stop_id,arrival_time,departure_time,stop_sequence
t1,101N,08:00:00,08:00:00,1
t1,101S,08:05:00,08:05:00,2
t2,101N,08:10:00,08:10:00,1
t9,101N,09:00:00,09:00:00,1
"""


def make_zip(stops=STOPS, routes=ROUTES, trips=TRIPS, stop_times=STOP_TIMES):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("stops.txt", stops)
        zf.writestr("routes.txt", routes)
        zf.writestr("trips.txt", trips)
        zf.writestr("stop_times.txt", stop_times)
    return buf.getvalue()


class FakeHTTP:
    """Single-URL session: every get streams back the same zip bytes."""

    def __init__(self, content):
        self.content = content

    def get(self, url, timeout=None, stream=False):
        resp = self
        resp.status_code = 200
        return resp

    def raise_for_status(self):
        pass

    def iter_content(self, chunk_size):
        for start in range(0, len(self.content), chunk_size):
            yield self.content[start : start + chunk_size]


class FakeMultiHTTP:
    """Maps url -> zip bytes, or an Exception instance to raise from get."""

    def __init__(self, by_url):
        self.by_url = dict(by_url)
        self.requested = []

    def get(self, url, timeout=None, stream=False):
        self.requested.append(url)
        item = self.by_url[url]
        if isinstance(item, Exception):
            raise item
        return FakeHTTP(item)


def run(zip_bytes, existing_by_table=None):
    existing_by_table = existing_by_table or {}

    def handler(sql, params):
        if sql.startswith("SELECT static_url"):
            return [{"static_url": "https://example.com/gtfs.zip"}]
        if sql.lstrip().upper().startswith("SELECT"):
            for table, rows in existing_by_table.items():
                if f"FROM {table}" in sql:
                    return rows
            return []
        return []

    session = FakeSession(handler)
    client = D1Client("a", "d", "t", session=session, pace_seconds=0)
    stats = run_static(client, "mta-subway", http_session=FakeHTTP(zip_bytes))
    return stats, session


def inserted_rows(session, table):
    rows = []
    for call in session.calls:
        sql = call["payload"]["sql"]
        if sql.startswith(f"INSERT INTO {table} "):
            columns = sql.split("(")[1].split(")")[0].split(", ")
            params = call["payload"]["params"]
            for start in range(0, len(params), len(columns)):
                rows.append(dict(zip(columns, params[start : start + len(columns)])))
    return rows


def test_station_platform_parsing_and_entrance_exclusion():
    stats, session = run(make_zip())
    stops = {r["stop_id"]: r for r in inserted_rows(session, "stops")}
    assert set(stops) == {"101", "101N", "101S"}  # entrance E01 excluded
    assert stops["101"]["parent_station"] is None
    assert stops["101N"]["parent_station"] == "101"
    assert stats.skipped_locations == 1


def test_edges_platform_level_only():
    _, session = run(make_zip())
    edges = {(r["stop_id"], r["route_id"]) for r in inserted_rows(session, "stop_routes")}
    assert edges == {("101N", "A"), ("101S", "A"), ("101N", "F")}
    assert not any(stop == "101" for stop, _ in edges)  # station id gets no edges


def test_unknown_route_and_trip_skipped_without_crash():
    stats, session = run(make_zip())  # t3 -> GHOST route, t9 unknown trip
    edges = inserted_rows(session, "stop_routes")
    assert all(r["route_id"] in ("A", "F") for r in edges)
    assert stats.edges_written == 3


def test_colors_verbatim_and_missing_column_null():
    routes_no_color = "route_id,route_short_name,route_type\nA,A,1\n"
    _, session = run(make_zip(routes=routes_no_color, trips="service_id,trip_id,route_id\nwk,t1,A\n"))
    (route,) = inserted_rows(session, "routes")
    assert route["color"] is None and route["text_color"] is None

    _, session = run(make_zip())
    colors = {r["route_id"]: r["color"] for r in inserted_rows(session, "routes")}
    assert colors == {"A": "0062CF", "F": "FF6319"}


def test_header_order_independence():
    reordered = "parent_station,location_type,stop_lon,stop_lat,stop_name,stop_id\n,1,-73.98,40.69,Jay St,101\n101,,-73.98,40.69,Jay St,101N\n"
    stop_times = "trip_id,stop_id,arrival_time,departure_time,stop_sequence\nt1,101N,08:00:00,08:00:00,1\n"
    _, session = run(make_zip(stops=reordered, stop_times=stop_times))
    stops = {r["stop_id"] for r in inserted_rows(session, "stops")}
    assert stops == {"101", "101N"}


def test_removed_stop_pruned_children_before_parents():
    blank = {"name": None, "lat": None, "lon": None, "parent_station": None, "capacity": None}
    existing = {
        "stops": [
            {"feed_id": "mta-subway", "stop_id": s, **blank}
            for s in ("101", "101N", "101S", "OLD1")
        ],
        "stop_routes": [
            {"feed_id": "mta-subway", "stop_id": "OLD1", "route_id": "A"},
        ],
    }
    stats, session = run(make_zip(), existing_by_table=existing)
    deletes = [
        c["payload"] for c in session.calls if c["payload"]["sql"].startswith("DELETE")
    ]
    delete_order = [d["sql"].split()[2] for d in deletes]
    assert "stop_routes" in delete_order and "stops" in delete_order
    assert delete_order.index("stop_routes") < delete_order.index("stops")
    stops_delete = next(d for d in deletes if d["sql"].startswith("DELETE FROM stops"))
    assert "OLD1" in stops_delete["params"]
    assert stats.pruned >= 2  # OLD1 stop + its stale edge


def test_dry_run_makes_no_d1_calls():
    session = FakeSession()
    stats = run_static(None, "mta-subway", dry_run=True, http_session=FakeHTTP(make_zip()))
    assert session.calls == []
    assert stats.stops_written == 0


def test_unknown_stop_id_in_stop_times_produces_no_edge():
    stop_times = STOP_TIMES + "t1,GHOST,09:30:00,09:30:00,3\nt1,E01,09:31:00,09:31:00,4\n"
    stats, session = run(make_zip(stop_times=stop_times))
    edges = {(r["stop_id"], r["route_id"]) for r in inserted_rows(session, "stop_routes")}
    assert not any(stop in ("GHOST", "E01") for stop, _ in edges)
    assert stats.edges_written == 3  # unchanged from the clean fixture


def test_missing_static_url_in_d1_raises():
    session = FakeSession(lambda sql, params: [])  # no feeds row exists
    client = D1Client("a", "d", "t", session=session, pace_seconds=0)
    with pytest.raises(ValueError, match="catalog"):
        run_static(client, "mystery-feed", http_session=FakeHTTP(make_zip()))


def test_unknown_feed_without_client_raises():
    with pytest.raises(ValueError, match="unknown"):
        run_static(None, "not-a-feed", dry_run=True, http_session=FakeHTTP(make_zip()))


# --- route_directions derivation (Phase 3 / U1) ---

TRIPS_WITH_DIRECTIONS = """route_id,service_id,trip_id,direction_id,trip_headsign
A,wk,t1,0,Far Rockaway
A,wk,t2,0,Far Rockaway
A,wk,t3,0,Lefferts Blvd
A,wk,t4,1,Inwood-207 St
F,wk,t5,,Jamaica
"""


def direction_rows(session):
    return {
        (r["route_id"], r["direction_id"]): r["headsign"]
        for r in inserted_rows(session, "route_directions")
    }


def test_dominant_headsign_wins_and_directionless_counted():
    stats, session = run(make_zip(trips=TRIPS_WITH_DIRECTIONS))
    assert direction_rows(session) == {
        ("A", 0): "Far Rockaway",  # 2 votes beat 1
        ("A", 1): "Inwood-207 St",
    }
    assert stats.skipped_directionless == 1  # the F trip without direction_id
    assert stats.directions_written == 2


def test_headsign_tie_breaks_lexicographic_and_deterministic():
    trips = (
        "route_id,service_id,trip_id,direction_id,trip_headsign\n"
        "A,wk,t1,0,Rockaway Park\n"
        "A,wk,t2,0,Far Rockaway\n"
    )
    results = []
    for _ in range(2):
        _, session = run(make_zip(trips=trips))
        results.append(direction_rows(session))
    assert results[0] == results[1] == {("A", 0): "Far Rockaway"}


def test_missing_direction_id_warns_and_does_not_crash(caplog):
    with caplog.at_level(logging.WARNING):
        stats, _ = run(make_zip())  # base TRIPS has no direction_id column
    assert stats.skipped_directionless == 3
    assert any(
        "3 trips without a usable direction_id" in r.message for r in caplog.records
    )


def test_headsignless_direction_yields_null_headsign():
    trips = "route_id,service_id,trip_id,direction_id\nA,wk,t1,0\n"
    _, session = run(make_zip(trips=trips))
    assert direction_rows(session) == {("A", 0): None}


def test_ns_convention_confirmed_logs_mapping_without_warning(caplog):
    trips = (
        "route_id,service_id,trip_id,direction_id,trip_headsign\n"
        "A,wk,X_000600_A..N03R,0,Uptown Terminal\n"
        "A,wk,X_000700_A..S03R,1,Downtown Terminal\n"
    )
    with caplog.at_level(logging.INFO):
        run(make_zip(trips=trips))
    assert any(
        "observed direction_id -> platform-suffix mapping" in r.message
        for r in caplog.records
    )
    assert not any("MISMATCH" in r.message for r in caplog.records)


def test_ns_convention_swapped_warns_loudly(caplog):
    trips = (
        "route_id,service_id,trip_id,direction_id,trip_headsign\n"
        "A,wk,X_000600_A..S03R,0,Wrong Way\n"
        "A,wk,X_000700_A..N03R,1,Wrong Way\n"
    )
    with caplog.at_level(logging.WARNING):
        run(make_zip(trips=trips))
    mismatches = [r for r in caplog.records if "MISMATCH" in r.message]
    assert len(mismatches) == 2  # both directions disagree
    assert all(r.levelno == logging.WARNING for r in mismatches)


def test_removed_route_direction_pruned_feed_scoped():
    existing = {
        "route_directions": [
            {"feed_id": "mta-subway", "route_id": "OLD", "direction_id": 0, "headsign": "Gone"},
        ],
    }
    _, session = run(make_zip(trips=TRIPS_WITH_DIRECTIONS), existing_by_table=existing)
    deletes = [
        c["payload"]
        for c in session.calls
        if c["payload"]["sql"].startswith("DELETE FROM route_directions")
    ]
    assert deletes and "OLD" in deletes[0]["params"]
    assert "mta-subway" in deletes[0]["params"]  # feed-scoped delete


# --- multi-source feeds (mta-bus / U2) ---

SRC_A = "https://example.com/a.zip"
SRC_B = "https://example.com/b.zip"

A_STOPS = """stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station
B1,Court St,40.69,-73.99,,
B2,Joralemon St,40.6910,-73.9910,,
"""
A_ROUTES = """route_id,route_short_name,route_long_name,route_color,route_text_color,route_type
B63,B63,Atlantic Av,0039A6,FFFFFF,3
"""
A_TRIPS = """route_id,service_id,trip_id,direction_id,trip_headsign
B63,wk,a1,0,Pier 6
B63,wk,a2,0,Pier 6
"""
A_STOP_TIMES = """trip_id,stop_id,arrival_time,departure_time,stop_sequence
a1,B1,08:00:00,08:00:00,1
a1,B2,08:05:00,08:05:00,2
"""

B_STOPS = """stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station
Q1,Main St,40.70,-73.80,,
Q2,Kissena Blvd,40.7010,-73.8010,,
"""
B_ROUTES = """route_id,route_short_name,route_long_name,route_color,route_text_color,route_type
Q44,Q44,Flushing,006983,FFFFFF,3
"""
B_TRIPS = """route_id,service_id,trip_id,direction_id,trip_headsign
Q44,wk,b1,1,Jamaica
"""
B_STOP_TIMES = """trip_id,stop_id,arrival_time,departure_time,stop_sequence
b1,Q1,08:00:00,08:00:00,1
b1,Q2,08:05:00,08:05:00,2
"""


def zip_a():
    return make_zip(stops=A_STOPS, routes=A_ROUTES, trips=A_TRIPS, stop_times=A_STOP_TIMES)


def zip_b(stops=B_STOPS, routes=B_ROUTES, trips=B_TRIPS, stop_times=B_STOP_TIMES):
    return make_zip(stops=stops, routes=routes, trips=trips, stop_times=stop_times)


@pytest.fixture
def two_source_feed(monkeypatch):
    """A curated two-source feed, with floors scaled to the tiny fixtures.

    The real 200/10 floors assume borough-scale zips; the floor *logic* is
    exercised against these small values.
    """
    feed = seeds.CuratedFeed(
        row={**seeds.MTA_BUS.row, "id": "multi-bus", "static_url": SRC_A},
        static_ingest=True,
        static_sources=[SRC_A, SRC_B],
    )
    monkeypatch.setattr(seeds, "CURATED_FEEDS", (*seeds.CURATED_FEEDS, feed))
    monkeypatch.setattr(static_gtfs, "MIN_SOURCE_STOPS", 2)
    monkeypatch.setattr(static_gtfs, "MIN_SOURCE_ROUTES", 1)
    return feed


def multi_client(existing_by_table=None):
    existing_by_table = existing_by_table or {}

    def handler(sql, params):
        if sql.lstrip().upper().startswith("SELECT"):
            for table, rows in existing_by_table.items():
                if f"FROM {table}" in sql:
                    return rows
            return []
        return []

    session = FakeSession(handler)
    return D1Client("a", "d", "t", session=session, pace_seconds=0), session


def delete_calls(session, table=None):
    prefix = f"DELETE FROM {table}" if table else "DELETE"
    return [c["payload"] for c in session.calls if c["payload"]["sql"].startswith(prefix)]


def test_two_source_merge_lands_in_one_feed(two_source_feed):
    client, session = multi_client()
    http = FakeMultiHTTP({SRC_A: zip_a(), SRC_B: zip_b()})
    stats = run_static(client, "multi-bus", http_session=http)

    stops = {r["stop_id"]: r for r in inserted_rows(session, "stops")}
    assert set(stops) == {"B1", "B2", "Q1", "Q2"}
    assert {r["feed_id"] for r in stops.values()} == {"multi-bus"}
    routes = {r["route_id"] for r in inserted_rows(session, "routes")}
    assert routes == {"B63", "Q44"}
    edges = {(r["stop_id"], r["route_id"]) for r in inserted_rows(session, "stop_routes")}
    assert edges == {("B1", "B63"), ("B2", "B63"), ("Q1", "Q44"), ("Q2", "Q44")}
    assert direction_rows(session) == {("B63", 0): "Pier 6", ("Q44", 1): "Jamaica"}
    assert stats.sources_failed == 0 and stats.duplicate_conflicts == 0


def test_prune_keep_set_spans_both_sources(two_source_feed):
    blank = {"name": None, "lat": None, "lon": None, "parent_station": None, "capacity": None}
    existing = {
        "stops": [
            {"feed_id": "multi-bus", "stop_id": s, **blank} for s in ("B1", "Q1", "OLD")
        ],
    }
    client, session = multi_client(existing)
    http = FakeMultiHTTP({SRC_A: zip_a(), SRC_B: zip_b()})
    run_static(client, "multi-bus", http_session=http)

    (stops_delete,) = delete_calls(session, "stops")
    assert "OLD" in stops_delete["params"]
    # Stops from both sources are in the keep-set — neither gets deleted.
    assert "B1" not in stops_delete["params"] and "Q1" not in stops_delete["params"]


def test_failed_download_upserts_land_and_prune_skipped(two_source_feed, caplog):
    client, session = multi_client(
        {"stops": [{"feed_id": "multi-bus", "stop_id": "OLD", "name": None, "lat": None,
                    "lon": None, "parent_station": None, "capacity": None}]}
    )
    http = FakeMultiHTTP({SRC_A: zip_a(), SRC_B: requests.ConnectionError("boom")})
    with caplog.at_level(logging.ERROR):
        with pytest.raises(PruneRefused, match="failed"):
            run_static(client, "multi-bus", http_session=http)

    stops = {r["stop_id"] for r in inserted_rows(session, "stops")}
    assert stops == {"B1", "B2"}  # the healthy source landed
    assert delete_calls(session) == []  # OLD survives: no prune anywhere
    assert any("prune disabled" in r.message for r in caplog.records)


@pytest.mark.parametrize(
    "b_stops",
    [
        "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n",  # zero stops
        # one stop: parses, but below the (test-scaled) per-source floor
        "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\nQ1,Main St,40.70,-73.80,,\n",
    ],
    ids=["zero-stops", "below-floor"],
)
def test_hollow_source_refuses_prune_but_upserts_land(two_source_feed, caplog, b_stops):
    client, session = multi_client()
    http = FakeMultiHTTP({SRC_A: zip_a(), SRC_B: zip_b(stops=b_stops, stop_times="trip_id,stop_id\n")})
    with caplog.at_level(logging.ERROR):
        with pytest.raises(PruneRefused, match="hollow"):
            run_static(client, "multi-bus", http_session=http)

    stops = {r["stop_id"] for r in inserted_rows(session, "stops")}
    assert {"B1", "B2"} <= stops  # healthy source landed regardless
    assert delete_calls(session) == []
    assert any("hollow" in r.message for r in caplog.records)


def test_normalized_identical_duplicate_deduped_and_counted(two_source_feed, caplog):
    # B republishes stop B1 with cosmetic noise only: spacing, case, and a
    # coordinate that rounds equal at 5 decimals.
    b_stops = (
        "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n"
        "B1, COURT ST ,40.690000004,-73.99,,\n"
        "Q1,Main St,40.70,-73.80,,\n"
        "Q2,Kissena Blvd,40.7010,-73.8010,,\n"
    )
    client, session = multi_client()
    http = FakeMultiHTTP({SRC_A: zip_a(), SRC_B: zip_b(stops=b_stops)})
    with caplog.at_level(logging.INFO):
        stats = run_static(client, "multi-bus", http_session=http)

    stops = [r for r in inserted_rows(session, "stops") if r["stop_id"] == "B1"]
    assert len(stops) == 1
    assert stops[0]["name"] == "Court St"  # first-seen payload kept verbatim
    assert stats.duplicates_deduped == 1
    assert stats.duplicate_conflicts == 0
    assert any("normalized-identical" in r.message for r in caplog.records)


def test_survey_drift_duplicate_dedupes_without_refusal(two_source_feed):
    # Same stop id ~20 m away with an abbreviated name: the live borough vs
    # busco zips publish exactly this shape (781 ids on 2026-08-03) — it is
    # survey drift, not a conflict, and must never wedge the nightly prune.
    b_stops = (
        "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n"
        "B1,COURT ST (E),40.69018,-73.98988,,\n"  # ~20 m from zip_a's B1
        "Q1,Main St,40.70,-73.80,,\n"
        "Q2,Kissena Blvd,40.7010,-73.8010,,\n"
    )
    client, session = multi_client()
    http = FakeMultiHTTP({SRC_A: zip_a(), SRC_B: zip_b(stops=b_stops)})
    run_static(client, "multi-bus", http_session=http)  # no PruneRefused

    stops = {r["stop_id"]: r for r in inserted_rows(session, "stops")}
    assert stops["B1"]["name"] == "Court St"  # first-seen text wins


def test_conflicting_duplicate_keeps_first_seen_and_refuses_prune(two_source_feed, caplog):
    b_stops = (
        "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n"
        "B1,Somewhere Else,40.75,-73.95,,\n"  # same id, genuinely different
        "Q1,Main St,40.70,-73.80,,\n"
        "Q2,Kissena Blvd,40.7010,-73.8010,,\n"
    )
    client, session = multi_client()
    http = FakeMultiHTTP({SRC_A: zip_a(), SRC_B: zip_b(stops=b_stops)})
    with caplog.at_level(logging.ERROR):
        with pytest.raises(PruneRefused, match="conflicting"):
            run_static(client, "multi-bus", http_session=http)

    stops = {r["stop_id"]: r for r in inserted_rows(session, "stops")}
    assert stops["B1"]["name"] == "Court St"  # first-seen wins
    assert "Q1" in stops  # the run continued past the conflict
    assert delete_calls(session) == []
    assert any("CONFLICTING" in r.message for r in caplog.records)


def test_oversized_download_treated_as_failed_source(two_source_feed, monkeypatch, caplog):
    a = zip_a()
    padded = io.BytesIO()
    with zipfile.ZipFile(padded, "w") as zf:
        with zipfile.ZipFile(io.BytesIO(zip_b())) as src:
            for name in src.namelist():
                zf.writestr(name, src.read(name))
        zf.writestr("pad.txt", "x" * 100_000)
    monkeypatch.setattr(static_gtfs, "MAX_SOURCE_BYTES", len(a))

    client, session = multi_client()
    http = FakeMultiHTTP({SRC_A: a, SRC_B: padded.getvalue()})
    with caplog.at_level(logging.ERROR):
        with pytest.raises(PruneRefused, match="SourceTooLarge"):
            run_static(client, "multi-bus", http_session=http)

    assert {r["stop_id"] for r in inserted_rows(session, "stops")} == {"B1", "B2"}
    assert delete_calls(session) == []


def test_route_directions_merge_at_vote_level(two_source_feed):
    # Both sources vote on B63 direction 0. Row-level merging (first- or
    # last-wins) would pick one source's dominant; vote-level merging lets
    # B's 3 votes beat A's 2 across the union.
    b_routes = A_ROUTES  # identical payload -> dedupes, no conflict
    b_trips = (
        "route_id,service_id,trip_id,direction_id,trip_headsign\n"
        "B63,wk,b1,0,Bay Ridge\n"
        "B63,wk,b2,0,Bay Ridge\n"
        "B63,wk,b3,0,Bay Ridge\n"
    )
    b_stops = (
        "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n"
        "Q1,Main St,40.70,-73.80,,\n"
        "Q2,Kissena Blvd,40.7010,-73.8010,,\n"
    )
    client, session = multi_client()
    http = FakeMultiHTTP(
        {SRC_A: zip_a(),
         SRC_B: zip_b(stops=b_stops, routes=b_routes, trips=b_trips,
                      stop_times="trip_id,stop_id,arrival_time,departure_time,stop_sequence\n")}
    )
    run_static(client, "multi-bus", http_session=http)
    assert direction_rows(session)[("B63", 0)] == "Bay Ridge"  # 3 votes beat 2


def test_lock_renewed_between_sources(two_source_feed):
    renewals = []
    client, _ = multi_client()
    http = FakeMultiHTTP({SRC_A: zip_a(), SRC_B: zip_b()})
    run_static(client, "multi-bus", http_session=http, renew_lock=lambda: renewals.append(1) or True)
    assert len(renewals) == 1  # once between the two sources


def test_lost_lock_between_sources_aborts_run(two_source_feed):
    client, session = multi_client()
    http = FakeMultiHTTP({SRC_A: zip_a(), SRC_B: zip_b()})
    with pytest.raises(RuntimeError, match="lost the D1 ingest lock"):
        run_static(client, "multi-bus", http_session=http, renew_lock=lambda: False)
    assert http.requested == [SRC_A]  # aborted before fetching source B
    assert inserted_rows(session, "stops") == []  # and before any write


def test_dry_run_multi_source_needs_no_client(two_source_feed):
    http = FakeMultiHTTP({SRC_A: zip_a(), SRC_B: zip_b()})
    stats = run_static(None, "multi-bus", dry_run=True, http_session=http)
    assert http.requested == [SRC_A, SRC_B]  # source list came from the seeds
    assert stats.sources_failed == 0


def test_dry_run_failed_source_still_exits_nonzero(two_source_feed):
    http = FakeMultiHTTP({SRC_A: zip_a(), SRC_B: requests.ConnectionError("boom")})
    with pytest.raises(PruneRefused, match="failed"):
        run_static(None, "multi-bus", dry_run=True, http_session=http)
