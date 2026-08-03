import fcntl

import gtfs_compass_ingest.__main__ as cli
import pytest


class Recorder:
    def __init__(self):
        self.calls = []

    def run_catalog(self, client, **kwargs):
        self.calls.append(("catalog", kwargs))

    def run_static(self, client, feed_id, **kwargs):
        self.calls.append(("static", feed_id, kwargs))

    def run_gbfs_static(self, client, feed_id, **kwargs):
        self.calls.append(("gbfs", feed_id, kwargs))


@pytest.fixture
def recorder(monkeypatch, tmp_path):
    rec = Recorder()
    monkeypatch.setattr(cli, "run_catalog", rec.run_catalog)
    monkeypatch.setattr(cli, "run_static", rec.run_static)
    monkeypatch.setattr(cli, "run_gbfs_static", rec.run_gbfs_static)
    monkeypatch.setattr(cli.D1Client, "from_env", classmethod(lambda cls: object()))
    monkeypatch.setattr(cli, "acquire_lock", lambda client, holder: True)
    monkeypatch.setattr(cli, "renew_lock", lambda client, holder: True)
    released = []
    monkeypatch.setattr(cli, "release_lock", lambda client, holder: released.append(holder))
    monkeypatch.setenv("INGEST_LOCK_FILE", str(tmp_path / "lock"))
    monkeypatch.delenv("INGEST_STATIC_FEEDS", raising=False)
    rec.released = released
    return rec


def test_all_runs_catalog_then_static_in_order(recorder):
    assert cli.main(["all"]) == 0
    # Default set from seed flags; citibike dispatches to the GBFS path.
    assert recorder.calls[0][0] == "catalog"
    assert [c[:2] for c in recorder.calls[1:]] == [
        ("static", "mta-subway"),
        ("gbfs", "citibike"),
    ]
    assert recorder.released  # D1 lock released on success


def test_failing_step_skips_rest_and_exits_nonzero(recorder, monkeypatch):
    def boom(client, **kwargs):
        raise RuntimeError("catalog broke")

    monkeypatch.setattr(cli, "run_catalog", boom)
    assert cli.main(["all"]) == 1
    assert not [c for c in recorder.calls if c[0] == "static"]
    assert recorder.released  # lock still released after failure


def test_dry_run_makes_no_d1_client(recorder, monkeypatch):
    monkeypatch.setattr(
        cli.D1Client,
        "from_env",
        classmethod(lambda cls: pytest.fail("from_env called in dry-run")),
    )
    assert cli.main(["--dry-run", "all"]) == 0
    assert recorder.calls[0][1]["dry_run"] is True
    assert not recorder.released  # no lock taken, none released


def test_local_lock_held_exits_2_before_d1_lock(recorder, monkeypatch):
    acquire_calls = []
    monkeypatch.setattr(
        cli, "acquire_lock", lambda client, holder: acquire_calls.append(1) or True
    )

    def raise_blocked(fh, flags):
        raise BlockingIOError

    monkeypatch.setattr(fcntl, "flock", raise_blocked)
    assert cli.main(["catalog"]) == 2
    assert not acquire_calls and not recorder.calls


def test_d1_lock_held_exits_2_without_running(recorder, monkeypatch):
    monkeypatch.setattr(cli, "acquire_lock", lambda client, holder: False)
    assert cli.main(["catalog"]) == 2
    assert not recorder.calls
    assert not recorder.released  # never acquired, never released


def test_static_dispatches_by_adapter(recorder):
    assert cli.main(["static", "citibike", "mta-subway"]) == 0
    assert [c[:2] for c in recorder.calls] == [
        ("gbfs", "citibike"),  # adapter 'gbfs' from the seeds registry
        ("static", "mta-subway"),
    ]


def test_unknown_adapter_falls_back_to_run_static(recorder):
    # Catalog-only ids resolve no adapter -> zip pipeline (existing behavior).
    assert cli.main(["static", "mdb-999"]) == 0
    assert [c[:2] for c in recorder.calls] == [("static", "mdb-999")]


def test_ingest_static_feeds_env_overrides_selector(recorder, monkeypatch):
    monkeypatch.setenv("INGEST_STATIC_FEEDS", "feed-a, feed-b")
    assert cli.main(["static"]) == 0
    assert [c[1] for c in recorder.calls] == ["feed-a", "feed-b"]


def test_cli_feed_ids_override_env(recorder, monkeypatch):
    monkeypatch.setenv("INGEST_STATIC_FEEDS", "feed-a")
    assert cli.main(["static", "feed-x"]) == 0
    assert [c[1] for c in recorder.calls] == ["feed-x"]


def test_force_flag_propagates(recorder):
    assert cli.main(["--force", "catalog"]) == 0
    assert recorder.calls[0][1]["force"] is True


def test_release_lock_failure_does_not_mask_exit_code(recorder, monkeypatch):
    def boom_release(client, holder):
        raise RuntimeError("network blip during release")

    monkeypatch.setattr(cli, "release_lock", boom_release)
    assert cli.main(["all"]) == 0  # containment in finally keeps the real code


def test_lost_d1_lock_mid_run_aborts_before_static(recorder, monkeypatch):
    monkeypatch.setattr(cli, "renew_lock", lambda client, holder: False)
    assert cli.main(["all"]) == 1
    assert not [c for c in recorder.calls if c[0] == "static"]
