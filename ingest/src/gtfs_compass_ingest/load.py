"""D1 HTTP client and the guarded sync (upsert + prune) engine.

D1's HTTP API is auto-commit with no transactions, so idempotent convergence
is the safety mechanism: select existing rows, diff in Python, write only
changed rows, then delete only the computed delete-set in chunked `IN` lists.
Chunked `NOT IN` against a keep-set is forbidden — each chunk would delete
every row absent from that chunk.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Iterable, Iterator, Sequence

import requests

log = logging.getLogger(__name__)

MAX_PARAMS_PER_STATEMENT = 100  # documented D1 limit
DEFAULT_PACE_SECONDS = 0.25  # global API limit is 1,200 req / 5 min per token
PRUNE_GUARD_FRACTION = 0.5  # refuse deleting more than this share without force
PRUNE_GUARD_MIN_ROWS = 10  # guards only apply once a table has real data
LOCK_TTL_SECONDS = 1800


class D1Error(RuntimeError):
    """The D1 API rejected a request or reported statement failure."""


class PruneRefused(RuntimeError):
    """Prune guard tripped: empty keep-set or over-threshold delete."""


@dataclass
class SyncStats:
    written: int = 0
    deleted: int = 0
    unchanged: int = 0


class D1Client:
    """Thin client for the Cloudflare D1 /query endpoint.

    One statement per request: whether /query accepts batches of
    parameterized statements is undocumented, so we stay conservative and
    rely on pacing + multi-row statements to keep request counts sane.
    """

    def __init__(
        self,
        account_id: str,
        database_id: str,
        api_token: str,
        session: requests.Session | None = None,
        pace_seconds: float = DEFAULT_PACE_SECONDS,
        max_retries: int = 5,
    ):
        self.url = (
            "https://api.cloudflare.com/client/v4/accounts/"
            f"{account_id}/d1/database/{database_id}/query"
        )
        self._headers = {"Authorization": f"Bearer {api_token}"}
        self._session = session or requests.Session()
        self._pace_seconds = pace_seconds
        self._max_retries = max_retries
        self._last_request_at = 0.0

    @classmethod
    def from_env(cls) -> "D1Client":
        env = {}
        for var in (
            "CLOUDFLARE_ACCOUNT_ID",
            "CLOUDFLARE_D1_DATABASE_ID",
            "CLOUDFLARE_API_TOKEN",
        ):
            value = os.environ.get(var)
            if not value:
                raise SystemExit(f"missing required environment variable {var}")
            env[var] = value
        return cls(
            account_id=env["CLOUDFLARE_ACCOUNT_ID"],
            database_id=env["CLOUDFLARE_D1_DATABASE_ID"],
            api_token=env["CLOUDFLARE_API_TOKEN"],
            pace_seconds=float(os.environ.get("D1_PACE_SECONDS", DEFAULT_PACE_SECONDS)),
        )

    def query(self, sql: str, params: Sequence[Any] = ()) -> dict:
        payload = {"sql": sql, "params": list(params)}
        for attempt in range(self._max_retries + 1):
            self._pace()
            resp = self._session.post(
                self.url, json=payload, headers=self._headers, timeout=60
            )
            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt == self._max_retries:
                    raise D1Error(
                        f"D1 request failed with HTTP {resp.status_code} "
                        f"after {attempt + 1} attempts"
                    )
                delay = float(resp.headers.get("Retry-After", 0) or 0) or 2**attempt
                log.warning(
                    "D1 HTTP %s, retrying in %.1fs (attempt %d)",
                    resp.status_code,
                    delay,
                    attempt + 1,
                )
                time.sleep(delay)
                continue
            if resp.status_code != 200:
                raise D1Error(f"D1 request failed: HTTP {resp.status_code}: {resp.text}")
            body = resp.json()
            if not body.get("success"):
                raise D1Error(f"D1 reported failure: {body.get('errors')}")
            result = body["result"][0]
            if not result.get("success", True):
                raise D1Error(f"D1 statement failed: {result}")
            return result
        raise AssertionError("unreachable")

    def _pace(self) -> None:
        if self._pace_seconds <= 0:
            return
        wait = self._last_request_at + self._pace_seconds - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self._last_request_at = time.monotonic()


def sync(
    client: D1Client,
    table,
    rows: Iterable[dict],
    *,
    scope_where: str = "",
    scope_params: Sequence[Any] = (),
    prune: bool = True,
    force: bool = False,
    timestamp_column: str | None = None,
) -> SyncStats:
    """Converge `table` (a TableSpec) toward `rows` within the scope.

    All writes complete before any delete, so a mid-run failure leaves a
    superset of the desired state, never missing rows. `timestamp_column`
    is excluded from change comparison and only written when a row's other
    values changed — identical re-runs write zero rows.
    """
    columns = list(table.columns)
    pk_columns = list(table.pk_columns)

    desired: dict[tuple, dict] = {}
    for row in rows:
        key = tuple(row[c] for c in pk_columns)
        if key in desired:
            log.warning("%s: duplicate key %r in input, last value wins", table.name, key)
        desired[key] = row

    where = f" WHERE {scope_where}" if scope_where else ""
    existing_result = client.query(
        f"SELECT {', '.join(columns)} FROM {table.name}{where}", scope_params
    )
    existing = {
        tuple(row[c] for c in pk_columns): row for row in existing_result["results"]
    }

    compare_columns = [c for c in columns if c != timestamp_column]
    to_write = [
        row
        for key, row in desired.items()
        if key not in existing
        or any(existing[key][c] != row[c] for c in compare_columns)
    ]
    delete_keys = [key for key in existing if key not in desired]

    if prune and existing:
        if not desired:
            raise PruneRefused(
                f"{table.name}: refusing to prune against an empty keep-set "
                f"({len(existing)} existing rows); this usually means a truncated source"
            )
        if (
            len(existing) >= PRUNE_GUARD_MIN_ROWS
            and len(delete_keys) > PRUNE_GUARD_FRACTION * len(existing)
            and not force
        ):
            raise PruneRefused(
                f"{table.name}: prune would delete {len(delete_keys)} of "
                f"{len(existing)} scoped rows; re-run with --force if intended"
            )

    for chunk in _chunked(to_write, max(1, MAX_PARAMS_PER_STATEMENT // len(columns))):
        client.query(*_upsert_statement(table.name, columns, pk_columns, chunk))

    if prune:
        for chunk in _chunked(
            delete_keys, max(1, MAX_PARAMS_PER_STATEMENT // len(pk_columns))
        ):
            sql, params = _delete_statement(
                table.name, pk_columns, chunk, scope_where, scope_params
            )
            client.query(sql, params)

    stats = SyncStats(
        written=len(to_write),
        deleted=len(delete_keys),
        unchanged=len(desired) - len(to_write),
    )
    log.info(
        "%s: %d written, %d deleted, %d unchanged",
        table.name,
        stats.written,
        stats.deleted,
        stats.unchanged,
    )
    return stats


def _upsert_statement(
    name: str, columns: list[str], pk_columns: list[str], rows: list[dict]
) -> tuple[str, list]:
    row_placeholder = "(" + ", ".join("?" for _ in columns) + ")"
    non_pk = [c for c in columns if c not in pk_columns]
    if non_pk:
        conflict = "DO UPDATE SET " + ", ".join(f"{c} = excluded.{c}" for c in non_pk)
    else:
        conflict = "DO NOTHING"
    sql = (
        f"INSERT INTO {name} ({', '.join(columns)}) VALUES "
        + ", ".join(row_placeholder for _ in rows)
        + f" ON CONFLICT ({', '.join(pk_columns)}) {conflict}"
    )
    params = [row[c] for row in rows for c in columns]
    return sql, params


def _delete_statement(
    name: str,
    pk_columns: list[str],
    keys: list[tuple],
    scope_where: str,
    scope_params: Sequence[Any],
) -> tuple[str, list]:
    scope = f"{scope_where} AND " if scope_where else ""
    if len(pk_columns) == 1:
        clause = f"{pk_columns[0]} IN ({', '.join('?' for _ in keys)})"
        params = [*scope_params, *(key[0] for key in keys)]
    else:
        tuple_placeholder = "(" + ", ".join("?" for _ in pk_columns) + ")"
        clause = (
            f"({', '.join(pk_columns)}) IN (VALUES "
            + ", ".join(tuple_placeholder for _ in keys)
            + ")"
        )
        params = [*scope_params, *(value for key in keys for value in key)]
    return f"DELETE FROM {name} WHERE {scope}{clause}", params


def _chunked(items: list, size: int) -> Iterator[list]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def acquire_lock(client: D1Client, holder: str, ttl_seconds: int = LOCK_TTL_SECONDS) -> bool:
    """Claim the cross-host run lock; returns False if another run holds it."""
    now = int(time.time())
    client.query(
        "UPDATE ingest_lock SET holder = ?, expires_at = ? "
        "WHERE id = 1 AND (holder IS NULL OR expires_at < ?)",
        [holder, now + ttl_seconds, now],
    )
    result = client.query("SELECT holder FROM ingest_lock WHERE id = 1")
    return bool(result["results"]) and result["results"][0]["holder"] == holder


def release_lock(client: D1Client, holder: str) -> None:
    client.query(
        "UPDATE ingest_lock SET holder = NULL, expires_at = 0 WHERE id = 1 AND holder = ?",
        [holder],
    )
