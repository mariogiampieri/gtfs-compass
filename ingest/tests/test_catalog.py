import csv
import io

from conftest import FakeSession

from gtfs_compass_ingest import seeds
from gtfs_compass_ingest.catalog import build_feed_rows, run_catalog
from gtfs_compass_ingest.load import D1Client

FIELDS = [
    "id",
    "data_type",
    "entity_type",
    "provider",
    "name",
    "static_reference",
    "urls.direct_download",
    "urls.latest",
    "urls.authentication_type",
    "urls.license",
    "location.bounding_box.minimum_latitude",
    "location.bounding_box.maximum_latitude",
    "location.bounding_box.minimum_longitude",
    "location.bounding_box.maximum_longitude",
    "status",
]


def make_csv(rows):
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=FIELDS, restval="")
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()


def gtfs_row(feed_id, status="active", **overrides):
    row = {
        "id": feed_id,
        "data_type": "gtfs",
        "provider": f"Agency {feed_id}",
        "urls.direct_download": f"https://example.com/{feed_id}.zip",
        "urls.license": f"https://example.com/{feed_id}/license",
        "status": status,
    }
    row.update(overrides)
    return row


def test_only_active_rows_emitted():
    text = make_csv(
        [
            gtfs_row("mdb-1"),
            gtfs_row("mdb-2", status="deprecated"),
            gtfs_row("mdb-3", status="future"),
        ]
    )
    rows = build_feed_rows(text, now=1000)
    assert [r["id"] for r in rows] == ["mdb-1"]


def test_rt_urls_attach_via_static_reference():
    text = make_csv(
        [
            gtfs_row("mdb-1"),
            {
                "id": "mdb-9",
                "data_type": "gtfs_rt",
                "entity_type": "tu|sa",
                "static_reference": "mdb-1",
                "urls.direct_download": "https://example.com/rt",
                "status": "active",
            },
            {
                "id": "mdb-10",
                "data_type": "gtfs_rt",
                "entity_type": "vp",
                "static_reference": "mdb-nonexistent",
                "urls.direct_download": "https://example.com/orphan",
                "status": "active",
            },
        ]
    )
    rows = build_feed_rows(text, now=1000)
    (feed,) = rows
    assert feed["rt_trip_url"] == "https://example.com/rt"
    assert feed["rt_alert_url"] == "https://example.com/rt"
    assert feed["rt_needs_key"] == 0


def test_rt_auth_type_sets_needs_key():
    def with_auth(auth):
        return make_csv(
            [
                gtfs_row("mdb-1"),
                {
                    "id": "mdb-9",
                    "data_type": "gtfs_rt",
                    "entity_type": "tu",
                    "static_reference": "mdb-1",
                    "urls.direct_download": "https://example.com/rt",
                    "urls.authentication_type": auth,
                    "status": "active",
                },
            ]
        )

    assert build_feed_rows(with_auth("2"), now=0)[0]["rt_needs_key"] == 1
    assert build_feed_rows(with_auth("0"), now=0)[0]["rt_needs_key"] == 0
    assert build_feed_rows(with_auth(""), now=0)[0]["rt_needs_key"] == 0


def test_bbox_mapping_and_empty_bbox():
    text = make_csv(
        [
            gtfs_row(
                "mdb-1",
                **{
                    "location.bounding_box.minimum_latitude": "40.5",
                    "location.bounding_box.maximum_latitude": "40.9",
                    "location.bounding_box.minimum_longitude": "-74.2",
                    "location.bounding_box.maximum_longitude": "-73.7",
                },
            ),
            gtfs_row("mdb-2"),
        ]
    )
    rows = {r["id"]: r for r in build_feed_rows(text, now=0)}
    assert rows["mdb-1"]["min_lat"] == 40.5
    assert rows["mdb-1"]["max_lon"] == -73.7
    assert rows["mdb-2"]["min_lat"] is None


def test_suppressed_catalog_row_loaded_non_active():
    suppressed_id = next(iter(seeds.SUPPRESSED_CATALOG_IDS))
    text = make_csv([gtfs_row(suppressed_id), gtfs_row("mdb-1")])
    rows = {r["id"]: r for r in build_feed_rows(text, now=0)}
    assert rows[suppressed_id]["status"] == seeds.SUPPRESSED_STATUS
    assert rows["mdb-1"]["status"] == "active"


def test_malformed_row_skipped_run_continues():
    text = make_csv([gtfs_row(""), gtfs_row("mdb-1")])
    rows = build_feed_rows(text, now=0)
    assert [r["id"] for r in rows] == ["mdb-1"]


def run_with_fixture(csv_text, existing_rows):
    def handler(sql, params):
        if sql.lstrip().upper().startswith("SELECT"):
            return existing_rows
        return []

    session = FakeSession(handler)
    session.fetch_text = csv_text

    class FakeHTTP:
        def get(self, url, timeout=None):
            class R:
                content = csv_text.encode("utf-8")

                def raise_for_status(self):
                    pass

            return R()

    client = D1Client("a", "d", "t", session=session, pace_seconds=0)
    stats = run_catalog(client, now=1000, session=FakeHTTP())
    return stats, session


def test_full_run_includes_curated_row_and_never_prunes_it():
    stale = {c: None for c in
             ("name", "static_url", "rt_trip_url", "rt_alert_url", "rt_needs_key",
              "adapter", "min_lat", "max_lat", "min_lon", "max_lon",
              "license_url", "status", "updated_at")}
    existing = [
        {"id": "mta-subway", **stale},
        {"id": "mdb-stale", **stale},
    ]
    stats, session = run_with_fixture(make_csv([gtfs_row("mdb-1")]), existing)

    inserts = [c["payload"] for c in session.calls if c["payload"]["sql"].startswith("INSERT")]
    deletes = [c["payload"] for c in session.calls if c["payload"]["sql"].startswith("DELETE")]
    inserted_ids = [p for s in inserts for p in s["params"]]
    deleted_ids = [p for s in deletes for p in s["params"]]
    assert "mta-subway" in inserted_ids  # curated row upserted (values differ)
    assert "mta-subway" not in deleted_ids  # keep-set includes curated ids
    assert deleted_ids == ["mdb-stale"]
    assert stats.deleted == 1


def test_dry_run_makes_no_d1_calls():
    class FakeHTTP:
        def get(self, url, timeout=None):
            class R:
                content = make_csv([gtfs_row("mdb-1")]).encode()

                def raise_for_status(self):
                    pass

            return R()

    stats = run_catalog(None, now=1000, dry_run=True, session=FakeHTTP())
    assert stats.unchanged == 2  # mdb-1 + curated mta-subway, nothing written
