import json

import pytest
from conftest import FakeSession
from gtfs_compass_ingest.gbfs import run_gbfs_static
from gtfs_compass_ingest.load import D1Client

STATIONS = [
    {"station_id": "66db6387", "name": "Jay St & Tech Pl", "lat": 40.6946, "lon": -73.9871, "capacity": 43},
    {"station_id": "66db65b0", "name": "Sands St & Navy St", "lat": 40.6997, "lon": -73.9797, "capacity": 27},
]


def make_payload(stations=STATIONS):
    return {"last_updated": 1754000000, "ttl": 60, "data": {"stations": stations}}


class FakeHTTP:
    def __init__(self, payload):
        self.payload = payload
        self.status_code = 200

    def get(self, url, timeout=None):
        return self

    def raise_for_status(self):
        pass

    def json(self):
        return json.loads(json.dumps(self.payload))


def run(payload, existing_rows=None):
    def handler(sql, params):
        if sql.startswith("SELECT static_url"):
            return [{"static_url": "https://example.com/station_information.json"}]
        if sql.lstrip().upper().startswith("SELECT"):
            return existing_rows or []
        return []

    session = FakeSession(handler)
    client = D1Client("a", "d", "t", session=session, pace_seconds=0)
    stats = run_gbfs_static(client, "citibike", http_session=FakeHTTP(payload))
    return stats, session


def inserted_stops(session):
    rows = []
    for call in session.calls:
        sql = call["payload"]["sql"]
        if sql.startswith("INSERT INTO stops "):
            columns = sql.split("(")[1].split(")")[0].split(", ")
            params = call["payload"]["params"]
            for start in range(0, len(params), len(columns)):
                rows.append(dict(zip(columns, params[start : start + len(columns)])))
    return rows


def existing_row(station):
    return {
        "feed_id": "citibike",
        "stop_id": station["station_id"],
        "name": station["name"],
        "lat": station["lat"],
        "lon": station["lon"],
        "parent_station": None,
        "capacity": station["capacity"],
    }


def test_stations_become_stops_rows_with_capacity():
    stats, session = run(make_payload())
    rows = {r["stop_id"]: r for r in inserted_stops(session)}
    assert set(rows) == {"66db6387", "66db65b0"}
    jay = rows["66db6387"]
    assert jay["feed_id"] == "citibike"
    assert jay["name"] == "Jay St & Tech Pl"
    assert jay["lat"] == 40.6946 and jay["lon"] == -73.9871
    assert jay["capacity"] == 43
    assert jay["parent_station"] is None
    assert stats.stations_written == 2


def test_rerun_with_identical_data_writes_zero_rows():
    existing = [existing_row(s) for s in STATIONS]
    stats, session = run(make_payload(), existing_rows=existing)
    assert stats.stations_written == 0
    assert not inserted_stops(session)


def test_removed_station_pruned_feed_scoped():
    removed = {"station_id": "gone1", "name": "Old Dock", "lat": 40.7, "lon": -73.9, "capacity": 10}
    existing = [existing_row(s) for s in [*STATIONS, removed]]
    stats, session = run(make_payload(), existing_rows=existing)
    deletes = [
        c["payload"]
        for c in session.calls
        if c["payload"]["sql"].startswith("DELETE FROM stops")
    ]
    assert deletes and "gone1" in deletes[0]["params"]
    assert "citibike" in deletes[0]["params"]  # feed-scoped delete
    assert stats.pruned == 1


def test_station_without_id_skipped_and_counted():
    payload = make_payload([*STATIONS, {"name": "No Id", "lat": 40.7, "lon": -73.9}])
    stats, session = run(payload)
    assert stats.skipped == 1
    assert len(inserted_stops(session)) == 2


def test_missing_capacity_and_coords_null_not_crash():
    payload = make_payload([{"station_id": "s1", "name": "Bare"}])
    _, session = run(payload)
    (row,) = inserted_stops(session)
    assert row["capacity"] is None and row["lat"] is None and row["lon"] is None


def test_malformed_payload_raises():
    with pytest.raises(ValueError, match="data.stations"):
        run({"data": {}})


def test_dry_run_resolves_url_from_seeds_and_makes_no_d1_calls():
    stats = run_gbfs_static(
        None, "citibike", dry_run=True, http_session=FakeHTTP(make_payload())
    )
    assert stats.stations_written == 0 and stats.pruned == 0


def test_unknown_feed_without_client_raises():
    with pytest.raises(ValueError, match="unknown"):
        run_gbfs_static(
            None, "not-a-feed", dry_run=True, http_session=FakeHTTP(make_payload())
        )


def test_non_dict_station_entry_is_skipped_not_fatal():
    """A malformed (non-dict) entry in data.stations is counted and skipped."""
    from gtfs_compass_ingest.gbfs import _parse_stations

    payload = {
        "data": {
            "stations": [
                "garbage-string",
                {"station_id": "ok-1", "name": "Real", "lat": 40.0, "lon": -73.9, "capacity": 10},
            ]
        },
        "last_updated": 1700000000,
        "ttl": 60,
        "version": "2.3",
    }
    rows, skipped = _parse_stations(payload, "citibike")
    assert skipped == 1
    assert [r["stop_id"] for r in rows] == ["ok-1"]
