import pytest

import gtfs_compass_ingest.load as load
from gtfs_compass_ingest.load import (
    D1Client,
    D1Error,
    PruneRefused,
    acquire_lock,
    release_lock,
    sync,
)
from gtfs_compass_ingest.tables import STOP_ROUTES, TableSpec

from conftest import FakeResponse, FakeSession, d1_body

WIDE = TableSpec(
    name="wide",
    columns=("id", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"),
    pk_columns=("id",),
)
KV = TableSpec(name="kv", columns=("id", "val"), pk_columns=("id",))


def make_client(handler):
    session = FakeSession(handler)
    return D1Client("acct", "db", "token", session=session, pace_seconds=0), session


def statements(session, verb):
    return [c["payload"] for c in session.calls if c["payload"]["sql"].lstrip().upper().startswith(verb)]


def test_upsert_chunking_respects_param_limit():
    client, session = make_client(lambda sql, params: [])
    rows = [{c: f"{c}-{i}" for c in WIDE.columns} for i in range(25)]
    stats = sync(client, WIDE, rows)
    inserts = statements(session, "INSERT")
    assert len(inserts) == 3  # 10 + 10 + 5 rows at 10 columns each
    assert all(len(s["params"]) <= 100 for s in inserts)
    assert stats.written == 25 and stats.deleted == 0


def test_upsert_sql_names_pk_conflict_target_and_updates_non_pk():
    client, session = make_client(lambda sql, params: [])
    sync(client, KV, [{"id": "a", "val": 1}])
    sql = statements(session, "INSERT")[0]["sql"]
    assert "ON CONFLICT (id) DO UPDATE SET val = excluded.val" in sql
    assert "id = excluded.id" not in sql


def test_retry_on_429_then_success(monkeypatch):
    monkeypatch.setattr(load.time, "sleep", lambda s: None)
    client, session = make_client(lambda sql, params: [])
    session.queue = [FakeResponse(status_code=429), FakeResponse(body=d1_body([]))]
    result = client.query("SELECT 1")
    assert result["results"] == []
    assert len(session.calls) == 2


def test_success_false_raises():
    client, session = make_client(lambda sql, params: [])
    session.queue = [FakeResponse(body={"success": False, "errors": [{"message": "no"}]})]
    with pytest.raises(D1Error):
        client.query("SELECT 1")


def test_requests_carry_bearer_header():
    client, session = make_client(lambda sql, params: [])
    client.query("SELECT 1")
    assert session.calls[0]["headers"]["Authorization"] == "Bearer token"


def existing_kv(n):
    return [{"id": f"k{i}", "val": i} for i in range(n)]


def test_prune_multichunk_deletes_only_the_diff():
    # The chunked-NOT-IN regression test: rows matching later chunks survive.
    existing = existing_kv(500)

    def handler(sql, params):
        return existing if sql.startswith("SELECT") else []

    client, session = make_client(handler)
    keep = [{"id": f"k{i}", "val": i} for i in range(250)]
    stats = sync(client, KV, keep)
    deletes = statements(session, "DELETE")
    assert len(deletes) == 3  # 250 single-col keys at 100 params/statement
    deleted_ids = [p for s in deletes for p in s["params"]]
    assert sorted(deleted_ids) == sorted(f"k{i}" for i in range(250, 500))
    assert not statements(session, "INSERT")  # kept rows unchanged: zero writes
    assert stats.deleted == 250 and stats.unchanged == 250


def test_prune_empty_keepset_refused():
    client, session = make_client(
        lambda sql, params: existing_kv(5) if sql.startswith("SELECT") else []
    )
    with pytest.raises(PruneRefused):
        sync(client, KV, [])
    assert not statements(session, "DELETE")


def test_prune_threshold_guard_and_force():
    handler = lambda sql, params: existing_kv(100) if sql.startswith("SELECT") else []
    client, _ = make_client(handler)
    keep = [{"id": f"k{i}", "val": i} for i in range(10)]
    with pytest.raises(PruneRefused):
        sync(client, KV, keep)
    client, session = make_client(handler)
    stats = sync(client, KV, keep, force=True)
    assert stats.deleted == 90
    assert statements(session, "DELETE")


def test_composite_key_prune_uses_row_values_within_param_limit():
    existing = [
        {"feed_id": "f", "stop_id": f"s{i}", "route_id": f"r{i}"} for i in range(40)
    ]
    client, session = make_client(
        lambda sql, params: existing if sql.startswith("SELECT") else []
    )
    keep = existing[:5]
    sync(client, STOP_ROUTES, keep, scope_where="feed_id = ?", scope_params=["f"], force=True)
    deletes = statements(session, "DELETE")
    assert len(deletes) == 2  # 35 keys at 33 keys/statement (3 params each + scope)
    assert "(feed_id, stop_id, route_id) IN (VALUES" in deletes[0]["sql"]
    assert all(len(s["params"]) <= 101 for s in deletes)  # 100 key params + 1 scope param


def test_unchanged_rows_write_nothing_even_with_new_timestamp():
    tbl = TableSpec(name="t", columns=("id", "val", "updated_at"), pk_columns=("id",))
    existing = [{"id": "a", "val": 1, "updated_at": 111}]
    client, session = make_client(
        lambda sql, params: existing if sql.startswith("SELECT") else []
    )
    stats = sync(
        client,
        tbl,
        [{"id": "a", "val": 1, "updated_at": 999}],
        timestamp_column="updated_at",
    )
    assert not statements(session, "INSERT")
    assert stats.written == 0 and stats.unchanged == 1


def test_changed_row_writes_new_timestamp():
    tbl = TableSpec(name="t", columns=("id", "val", "updated_at"), pk_columns=("id",))
    existing = [{"id": "a", "val": 1, "updated_at": 111}]
    client, session = make_client(
        lambda sql, params: existing if sql.startswith("SELECT") else []
    )
    stats = sync(
        client,
        tbl,
        [{"id": "a", "val": 2, "updated_at": 999}],
        timestamp_column="updated_at",
    )
    inserts = statements(session, "INSERT")
    assert len(inserts) == 1 and 999 in inserts[0]["params"]
    assert stats.written == 1


def test_lock_acquire_and_release():
    state = {"holder": None, "expires_at": 0}

    def handler(sql, params):
        if sql.startswith("UPDATE ingest_lock SET holder = ?"):
            holder, expires_at, now = params
            if state["holder"] is None or state["expires_at"] < now:
                state.update(holder=holder, expires_at=expires_at)
            return []
        if sql.startswith("SELECT holder"):
            return [{"holder": state["holder"]}]
        if sql.startswith("UPDATE ingest_lock SET holder = NULL"):
            if state["holder"] == params[0]:
                state.update(holder=None, expires_at=0)
            return []
        raise AssertionError(f"unexpected sql: {sql}")

    client, _ = make_client(handler)
    assert acquire_lock(client, "host-a") is True
    assert acquire_lock(client, "host-b") is False  # held and unexpired
    release_lock(client, "host-a")
    assert acquire_lock(client, "host-b") is True

    # expired lock is claimable
    state.update(holder="host-b", expires_at=1)
    assert acquire_lock(client, "host-a") is True
