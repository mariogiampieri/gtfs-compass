import json

import pytest
from gtfs_compass_ingest.load import D1Client


class FakeResponse:
    def __init__(self, status_code=200, body=None, headers=None):
        self.status_code = status_code
        self._body = body if body is not None else d1_body([])
        self.headers = headers or {}
        self.text = json.dumps(self._body)

    def json(self):
        return self._body


def d1_body(results, success=True):
    return {
        "success": success,
        "errors": [],
        "result": [{"success": True, "results": results, "meta": {}}],
    }


class FakeSession:
    """Stands in for requests.Session.

    `handler(sql, params)` returns the result-rows list for a statement;
    `queue` (list of FakeResponse) takes precedence when non-empty, so tests
    can inject HTTP-level failures.
    """

    def __init__(self, handler=None):
        self.handler = handler or (lambda sql, params: [])
        self.queue = []
        self.calls = []

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append({"url": url, "payload": json, "headers": headers})
        if self.queue:
            item = self.queue.pop(0)
            if isinstance(item, Exception):
                raise item
            return item
        results = self.handler(json["sql"], json["params"])
        return FakeResponse(body=d1_body(results))


@pytest.fixture
def fake_session():
    return FakeSession()


@pytest.fixture
def client(fake_session):
    return D1Client(
        account_id="acct",
        database_id="db",
        api_token="token",
        session=fake_session,
        pace_seconds=0,
    )
