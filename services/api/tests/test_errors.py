"""The error envelope is the same shape for every failure (technical/07 §2)."""
from __future__ import annotations

from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from kernel import errors
from kernel.errors import AppError
from kernel.middleware import RequestIdMiddleware


@pytest.fixture()
def client() -> TestClient:
    app = FastAPI()

    @app.get("/things/{thing_id}")
    async def get_thing(thing_id: UUID) -> dict[str, str]:
        return {"id": str(thing_id)}

    @app.get("/boom")
    async def boom() -> None:
        raise AppError("GATE_FAILED", "Two gates are closed.", extra={"blockers": ["G1", "G2"]})

    @app.get("/kaboom")
    async def kaboom() -> None:
        raise RuntimeError("secret path /app/kernel/thing.py")

    app.add_middleware(RequestIdMiddleware)
    errors.install(app)
    return TestClient(app, raise_server_exceptions=False)


def _envelope(body: dict) -> None:
    assert set(body) == {"errors", "meta"}
    assert body["meta"]["request_id"]
    for e in body["errors"]:
        assert e["code"] and e["message"]


def test_bad_uuid_is_400_with_envelope(client: TestClient) -> None:
    r = client.get("/things/not-a-uuid")
    assert r.status_code == 400
    _envelope(r.json())
    assert r.json()["errors"][0]["code"] == "VALIDATION"
    assert r.json()["errors"][0]["field"] == "thing_id"


def test_unknown_route_is_404_json_not_html(client: TestClient) -> None:
    r = client.get("/nope")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")
    _envelope(r.json())
    assert r.json()["errors"][0]["code"] == "NOT_FOUND"


def test_app_error_status_comes_from_the_code(client: TestClient) -> None:
    r = client.get("/boom")
    assert r.status_code == 409
    assert r.json()["errors"][0]["blockers"] == ["G1", "G2"]


def test_500_body_never_leaks_a_path_or_traceback(client: TestClient) -> None:
    r = client.get("/kaboom")
    assert r.status_code == 500
    body = r.text
    _envelope(r.json())
    assert "/app/kernel" not in body and "Traceback" not in body
    assert r.json()["errors"][0]["message"] == "Something went wrong."


def test_request_id_is_echoed(client: TestClient) -> None:
    r = client.get("/nope", headers={"X-Request-Id": "rid-123"})
    assert r.headers["X-Request-Id"] == "rid-123"
    assert r.json()["meta"]["request_id"] == "rid-123"
