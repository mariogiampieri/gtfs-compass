"""CLI entry point. Orchestration lands with U5; the parser is stable now."""

from __future__ import annotations

import argparse
import sys


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


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    print(f"command '{args.command}' is not implemented yet", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
