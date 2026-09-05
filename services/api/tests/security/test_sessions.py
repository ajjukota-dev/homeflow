"""Sessions, CSRF and realm isolation against the compose stack (technical/03 §10)."""
from __future__ import annotations

import hashlib
import logging
from uuid import UUID

import asyncpg
import pytest
from httpx import AsyncClient
from sqlalchemy import text

from kernel.db import tx
from kernel.identity import session as session_mod
from kernel.identity.principal import ANONYMOUS, SYSTEM
from tests.security.conftest import CSRF

pytestmark = pytest.mark.integration


async def _sign_in(client: AsyncClient, email: str) -> str:
    r = await client.get("/auth/dev-login", params={"user": email})
    assert r.status_code == 302, r.text
    return r.cookies[session_mod.COOKIE_NAME]


async def test_dev_login_gives_a_session_whose_roles_and_projects_are_loaded(
    client: AsyncClient, world: dict[str, UUID]
) -> None:
    token = await _sign_in(client, world["email"])
    r = await client.get("/me/session", cookies={session_mod.COOKIE_NAME: token})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["realm"] == "staff"
    assert data["role_ids"] == ["crm"]
    assert data["project_ids"] == [str(world["project"])]
    assert data["all_projects"] is False


async def test_a_protected_route_401s_without_a_cookie(client: AsyncClient) -> None:
    r = await client.get("/me/session")
    assert r.status_code == 401
    assert r.json()["errors"][0]["code"] == "UNAUTHENTICATED"


async def test_every_non_get_needs_the_csrf_header(
    client: AsyncClient, world: dict[str, UUID]
) -> None:
    token = await _sign_in(client, world["email"])
    bare = await client.post("/auth/logout", cookies={session_mod.COOKIE_NAME: token})
    assert bare.status_code == 403
    assert bare.json()["errors"][0]["code"] == "CSRF_HEADER_MISSING"
    with_header = await client.post(
        "/auth/logout", headers=CSRF, cookies={session_mod.COOKIE_NAME: token}
    )
    assert with_header.status_code == 204


async def test_otp_request_is_not_exempt_from_csrf(client: AsyncClient) -> None:
    r = await client.post("/auth/otp/request", json={"phone": "+919876543210"})
    assert r.status_code == 403
    assert r.json()["errors"][0]["code"] == "CSRF_HEADER_MISSING"


async def test_logout_revokes_the_session_row(
    client: AsyncClient, world: dict[str, UUID], owner: asyncpg.Connection
) -> None:
    token = await _sign_in(client, world["email"])
    await client.post("/auth/logout", headers=CSRF, cookies={session_mod.COOKIE_NAME: token})
    revoked = await owner.fetchval(
        "SELECT revoked_at IS NOT NULL FROM session WHERE token_hash = $1",
        hashlib.sha256(token.encode()).digest(),
    )
    assert revoked is True
    after = await client.get("/me/session", cookies={session_mod.COOKIE_NAME: token})
    assert after.status_code == 401


async def test_deactivation_revokes_every_session_in_the_same_transaction(
    client: AsyncClient, world: dict[str, UUID], owner: asyncpg.Connection
) -> None:
    token = await _sign_in(client, world["email"])
    async with tx(SYSTEM) as t:
        await t.conn.execute(
            text('UPDATE "user" SET is_active = false WHERE id = :id'), {"id": world["user"]}
        )
        await session_mod.revoke_all_for_user(t, world["user"])
    live = await owner.fetchval(
        "SELECT count(*) FROM session WHERE user_id = $1 AND revoked_at IS NULL", world["user"]
    )
    assert live == 0
    assert (await client.get("/me/session", cookies={session_mod.COOKIE_NAME: token})).status_code == 401
    await owner.execute('UPDATE "user" SET is_active = true WHERE id = $1', world["user"])


async def test_a_deactivated_user_cannot_sign_in_again(
    client: AsyncClient, world: dict[str, UUID], owner: asyncpg.Connection
) -> None:
    await owner.execute('UPDATE "user" SET is_active = false WHERE id = $1', world["user"])
    r = await client.get("/auth/dev-login", params={"user": world["email"]})
    assert r.status_code == 403
    assert r.json()["errors"][0]["code"] == "NOT_PROVISIONED"
    await owner.execute('UPDATE "user" SET is_active = true WHERE id = $1', world["user"])


async def test_a_forged_cookie_is_simply_anonymous(client: AsyncClient) -> None:
    r = await client.get("/me/session", cookies={session_mod.COOKIE_NAME: "not-a-real-token"})
    assert r.status_code == 401


async def test_the_session_token_is_never_logged_or_stored(
    client: AsyncClient, world: dict[str, UUID], owner: asyncpg.Connection, caplog
) -> None:
    with caplog.at_level(logging.DEBUG):
        token = await _sign_in(client, world["email"])
        await client.get("/me/session", cookies={session_mod.COOKIE_NAME: token})
    assert token not in caplog.text
    stored = await owner.fetch("SELECT token_hash FROM session")
    assert stored and all(row["token_hash"] != token.encode() for row in stored)
    assert await owner.fetchval(
        "SELECT count(*) FROM session WHERE token_hash = $1",
        hashlib.sha256(token.encode()).digest(),
    ) == 1


async def test_an_anonymous_request_reaches_sql_with_realm_none_and_reads_nothing(
    world: dict[str, UUID]
) -> None:
    async with tx(ANONYMOUS) as t:
        realm = await t.conn.exec_driver_sql("SELECT current_setting('app.realm', true)")
        assert realm.scalar() == "none"
        for table in ("project", "unit", "booking", "booking_applicant", "unit_progress_state"):
            rows = await t.conn.exec_driver_sql(f"SELECT count(*) FROM {table}")
            assert rows.scalar() == 0, table
