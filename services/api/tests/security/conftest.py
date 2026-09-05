"""Integration fixtures: a real app over the compose Postgres, with a seeded world."""
from __future__ import annotations

from collections.abc import AsyncIterator
from uuid import UUID

import asyncpg
import pytest
from httpx import ASGITransport, AsyncClient

from tests.conftest import DB, HOST, PORT
from tests.rls.factory import purge, seed_project

CSRF = {"X-Requested-With": "HomeFlow"}


async def connect(user: str) -> asyncpg.Connection:
    return await asyncpg.connect(host=HOST, port=int(PORT), user=user, password=user, database=DB)


@pytest.fixture
async def owner() -> AsyncIterator[asyncpg.Connection]:
    conn = await connect("homeflow_owner")
    # FORCE ROW LEVEL SECURITY applies to the owner too, so give it an all-projects context.
    await conn.execute(
        "SELECT set_config('app.realm','staff',false), set_config('app.all_projects','true',false),"
        "       set_config('app.user_id','',false), set_config('app.customer_id','',false),"
        "       set_config('app.project_ids','',false)"
    )
    try:
        yield conn
    finally:
        await conn.close()


@pytest.fixture
async def world(owner: asyncpg.Connection) -> AsyncIterator[dict[str, UUID]]:
    """One project with a unit, customer, booking and applicant, plus a staff user
    assigned to it — the smallest world in which sessions mean anything."""
    await _purge(owner)
    ids = await seed_project(owner, "SEC1")
    await owner.execute(
        "INSERT INTO user_role_assignment (user_id, role_id) VALUES ($1, 'crm')"
        " ON CONFLICT DO NOTHING",
        ids["user"],
    )
    await owner.execute(
        "UPDATE project_team_assignment SET primary_owner_id = $1 WHERE project_id = $2",
        ids["user"], ids["project"],
    )
    await owner.execute("UPDATE booking SET status = 'active' WHERE id = $1", ids["booking"])
    ids["email"] = await owner.fetchval('SELECT email FROM "user" WHERE id = $1', ids["user"])
    ids["phone"] = await owner.fetchval("SELECT primary_phone FROM customer WHERE id = $1", ids["customer"])
    yield ids
    await _purge(owner)


async def _purge(conn: asyncpg.Connection) -> None:
    await conn.execute("DELETE FROM session WHERE true")
    await conn.execute("DELETE FROM otp_challenge WHERE true")
    await purge(conn, "SEC")


@pytest.fixture(autouse=True)
async def rbac_matrix() -> None:
    """`reload()` normally runs in the app lifespan, which ASGITransport does not run."""
    from kernel.identity.rbac import reload

    await reload()


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    from app import app

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver", follow_redirects=False
    ) as c:
        yield c
