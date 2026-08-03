import io
import logging
import zipfile

import pytest
from conftest import FakeSession
from gtfs_compass_ingest.load import D1Client
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
    def __init__(self, content):
        self.content = content

    def get(self, url, timeout=None):
        resp = self
        resp.status_code = 200
        return resp

    def raise_for_status(self):
        pass


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
