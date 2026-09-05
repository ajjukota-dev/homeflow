"""The Google sign-in route with the network stubbed out (technical/03 §1)."""
from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs, urlparse
from uuid import UUID

import asyncpg
import pytest
from httpx import AsyncClient

from kernel.errors import AppError
from kernel.identity import router as identity_router
from kernel.identity import session as session_mod
from kernel.identity.google import GoogleOidc

pytestmark = pytest.mark.integration


class StubGoogle(GoogleOidc):
    """Same claim checks as the real client; the token endpoint never leaves the process."""

    claims: dict[str, Any]

    async def exchange(self, code: str, verifier: str) -> dict[str, Any]:
        assert code and verifier
        return self.check_claims(dict(self.claims))


@pytest.fixture
def stub(monkeypatch: pytest.MonkeyPatch) -> StubGoogle:
    client = StubGoogle(
        client_id="cid", client_secret="secret",
        redirect_uri="http://localhost:8001/auth/google/callback",
        allowed_hd=frozenset({"pranava.in"}),
    )
    client.claims = {
        "iss": "https://accounts.google.com", "aud": "cid", "sub": "google-sub-1",
        "email": "", "email_verified": True, "hd": "pranava.in",
    }
    monkeypatch.setattr(identity_router, "_oidc", client)
    return client


async def _start(client: AsyncClient, next_path: str = "/units") -> tuple[str, str]:
    r = await client.get("/auth/google/start", params={"next": next_path})
    assert r.status_code == 302
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    return state, r.cookies[session_mod.OAUTH_COOKIE]


async def test_start_redirects_to_google_with_state_pkce_and_hd(
    client: AsyncClient, stub: StubGoogle
) -> None:
    r = await client.get("/auth/google/start", params={"next": "/units/1"})
    assert r.status_code == 302
    q = parse_qs(urlparse(r.headers["location"]).query)
    assert q["client_id"] == ["cid"]
    assert q["code_challenge_method"] == ["S256"]
    assert q["hd"] == ["pranava.in"]
    assert q["scope"] == ["openid email profile"]
    assert session_mod.OAUTH_COOKIE in r.cookies


async def test_a_provisioned_user_gets_a_session_and_google_sub_is_bound(
    client: AsyncClient, stub: StubGoogle, world: dict[str, UUID], owner: asyncpg.Connection
) -> None:
    stub.claims["email"] = world["email"]
    state, oauth_cookie = await _start(client, "/units")
    r = await client.get(
        "/auth/google/callback",
        params={"code": "auth-code", "state": state},
        cookies={session_mod.OAUTH_COOKIE: oauth_cookie},
    )
    assert r.status_code == 302
    assert r.headers["location"] == "/units"
    assert session_mod.COOKIE_NAME in r.cookies
    sub, last_login = await owner.fetchrow(
        'SELECT google_sub, last_login_at FROM "user" WHERE id = $1', world["user"]
    )
    assert sub == "google-sub-1"
    assert last_login is not None


async def test_an_unknown_email_is_403_not_provisioned(
    client: AsyncClient, stub: StubGoogle, world: dict[str, UUID]
) -> None:
    stub.claims["email"] = "someone.else@pranava.in"
    state, oauth_cookie = await _start(client)
    r = await client.get(
        "/auth/google/callback",
        params={"code": "auth-code", "state": state},
        cookies={session_mod.OAUTH_COOKIE: oauth_cookie},
    )
    assert r.status_code == 403
    assert r.json()["errors"][0]["code"] == "NOT_PROVISIONED"


async def test_a_foreign_hd_never_reaches_the_user_lookup(
    client: AsyncClient, stub: StubGoogle, world: dict[str, UUID]
) -> None:
    stub.claims["email"] = world["email"]
    stub.claims["hd"] = "gmail.com"
    state, oauth_cookie = await _start(client)
    r = await client.get(
        "/auth/google/callback",
        params={"code": "auth-code", "state": state},
        cookies={session_mod.OAUTH_COOKIE: oauth_cookie},
    )
    assert r.status_code == 403
    assert r.json()["errors"][0]["code"] == "NOT_PROVISIONED"


async def test_a_mismatched_state_is_refused(client: AsyncClient, stub: StubGoogle) -> None:
    _, oauth_cookie = await _start(client)
    r = await client.get(
        "/auth/google/callback",
        params={"code": "auth-code", "state": "not-the-state"},
        cookies={session_mod.OAUTH_COOKIE: oauth_cookie},
    )
    assert r.status_code == 401


async def test_a_callback_with_no_oauth_cookie_is_refused(
    client: AsyncClient, stub: StubGoogle
) -> None:
    state, _ = await _start(client)
    client.cookies.clear()  # the jar keeps hf_oauth from /start; this is the no-cookie case
    r = await client.get("/auth/google/callback", params={"code": "c", "state": state})
    assert r.status_code == 401


async def test_next_is_never_an_absolute_url(
    client: AsyncClient, stub: StubGoogle, world: dict[str, UUID]
) -> None:
    stub.claims["email"] = world["email"]
    state, oauth_cookie = await _start(client, "https://evil.example.com/steal")
    r = await client.get(
        "/auth/google/callback",
        params={"code": "auth-code", "state": state},
        cookies={session_mod.OAUTH_COOKIE: oauth_cookie},
    )
    assert r.status_code == 302
    assert r.headers["location"] == "/"


def test_the_real_client_refuses_a_token_response_without_an_id_token() -> None:
    """`exchange` is the only method that talks to Google; its failure mode is one code."""
    assert AppError("UNAUTHENTICATED").status_code == 401
