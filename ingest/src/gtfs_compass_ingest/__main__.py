"""CLI orchestration: catalog (with seeds), static ingest, or both.

Designed for unattended cron use: timestamped stderr logging, non-zero exit
on any failure, and a two-layer run lock — a local fcntl lock against
same-host overlap plus the D1 ingest_lock row against cross-host overlap
(a dev-laptop run and the cron box share one remote database).
"""

from __future__ import annotations

import argparse
import fcntl
import logging
import os
import socket
import sys
import time

from . import seeds
from .catalog import run_catalog
from .gbfs import run_gbfs_static
from .load import D1Client, PruneRefused, acquire_lock, release_lock, renew_lock
from .static_gtfs import run_static

log = logging.getLogger("gtfs_compass_ingest")

EXIT_OK = 0
EXIT_FAILURE = 1
EXIT_LOCKED = 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="gtfs-compass-ingest",
        description="Seed the feeds catalog and static GTFS data into D1.",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="parse sources without writing to D1"
    )
    parser.add_argument(
        "--force", action="store_true", help="bypass the prune deletion-threshold guard"
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("catalog", help="seed feeds from the Mobility Database (with curated seeds)")
    static = sub.add_parser("static", help="ingest static GTFS for one or more feeds")
    static.add_argument("feed_ids", nargs="*", help="feed ids (default: configured set)")
    sub.add_parser("all", help="catalog, then static ingest for the configured feeds")
    return parser


def static_feed_ids(cli_ids: list[str] | None) -> list[str]:
    """Selector is data, not code: CLI args > INGEST_STATIC_FEEDS > seed flags."""
    if cli_ids:
        return cli_ids
    env = os.environ.get("INGEST_STATIC_FEEDS", "").strip()
    if env:
        return [feed_id.strip() for feed_id in env.split(",") if feed_id.strip()]
    return seeds.static_ingest_feed_ids()


def lock_file_path() -> str:
    return os.environ.get("INGEST_LOCK_FILE", "/tmp/gtfs-compass-ingest.lock")


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.INFO,
        stream=sys.stderr,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    start = time.monotonic()
    exit_code = _run(args)
    log.info("run finished with exit code %d in %.1fs", exit_code, time.monotonic() - start)
    return exit_code


def _run(args: argparse.Namespace) -> int:
    dry_run = args.dry_run
    client = None if dry_run else D1Client.from_env()
    holder = f"{socket.gethostname()}-{os.getpid()}"
    local_lock = None
    d1_locked = False

    try:
        if not dry_run:
            # The flock lives as long as the fd, which is closed in `finally`.
            local_lock = open(lock_file_path(), "w")  # noqa: SIM115
            try:
                fcntl.flock(local_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                log.error("another ingest run holds the local lock; exiting")
                return EXIT_LOCKED
            if not acquire_lock(client, holder):
                log.error("another host holds the D1 ingest lock; exiting")
                return EXIT_LOCKED
            d1_locked = True

        now = int(time.time())
        if args.command in ("catalog", "all"):
            run_catalog(client, now=now, dry_run=dry_run, force=args.force)
        failed_feeds = []
        if args.command in ("static", "all"):
            cli_ids = getattr(args, "feed_ids", None)
            renew = None if dry_run else (lambda: renew_lock(client, holder))
            for feed_id in static_feed_ids(cli_ids):
                # Re-extend the D1 lock before each phase so a long run
                # (backoff, slow network) can never outlive its claim.
                if not dry_run and not renew_lock(client, holder):
                    log.error("lost the D1 ingest lock mid-run; aborting")
                    return EXIT_FAILURE
                # A refused prune is contained to its feed: the upserts
                # already landed (superset state) and the other feeds still
                # deserve their nightly run. The exit code stays non-zero.
                try:
                    # Dispatch on the feed's adapter (from the seeds registry —
                    # only curated feeds are static-ingested): a GBFS JSON pushed
                    # through the zip pipeline would be a BadZipFile crash.
                    if seeds.adapter_for(feed_id) == "gbfs":
                        run_gbfs_static(client, feed_id, dry_run=dry_run, force=args.force)
                    else:
                        run_static(
                            client,
                            feed_id,
                            dry_run=dry_run,
                            force=args.force,
                            renew_lock=renew,
                        )
                except PruneRefused as exc:
                    log.error("%s", exc)
                    failed_feeds.append(feed_id)
        if failed_feeds:
            log.error("static ingest finished with failed feeds: %s", ", ".join(failed_feeds))
            return EXIT_FAILURE
        return EXIT_OK
    except PruneRefused as exc:
        log.error("%s", exc)
        return EXIT_FAILURE
    except Exception:
        log.exception("ingest run failed")
        return EXIT_FAILURE
    finally:
        if d1_locked:
            try:
                release_lock(client, holder)
            except Exception:
                log.exception("failed to release D1 ingest lock (expires on its own)")
        if local_lock is not None:
            local_lock.close()


if __name__ == "__main__":
    sys.exit(main())
