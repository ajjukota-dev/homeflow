"""Customer OTP end to end, plus realm isolation (technical/03 §2, §10)."""
from __future__ import annotations

from uuid import UUID

import asyncpg
import pytest
from httpx import AsyncClient
from sqlalchemy import text

from kernel.db import tx
from kernel.identity import otp
from kernel.identity import session as session_mod
from kernel.identity.principal import Principal
from tests.security.conftest import CSRF

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _clear_ip_limiter() -> None:
    otp._ip_hits.clear()


async def _request(client: AsyncClient, phone: str) -> dict:
    r = await client.post("/auth/otp/request", headers=CSRF, json={"phone": phone})
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def _live_code(client: AsyncClient, phone: str) -> str:
    r = await client.get("/auth/dev-otp", params={"phone": phone})
    assert r.status_code == 200, r.text
    return r.json()["data"]["code"]


async def test_a_booked_customer_can_request_and_verify_a_code(
    client: AsyncClient, world: dict[str, UUID]
) -> None:
    phone = world["phone"]
    assert (await _request(client, phone))["sent"] is True
    code = await _live_code(client, phone)
    r = await client.post("/auth/otp/verify", headers=CSRF, json={"phone": phone, "code": code})
    assert r.status_code == 200, r.text
    token = r.cookies[session_mod.COOKIE_NAME]
    me = await client.get("/me/session", cookies={session_mod.COOKIE_NAME: token})
    assert me.status_code == 200
    data = me.json()["data"]
    assert data["realm"] == "customer"
    assert data["project_ids"] == [str(world["project"])]
    assert data["role_ids"] == []


async def test_an_unknown_phone_gets_the_same_answer_and_no_challenge(
    client: AsyncClient, world: dict[str, UUID], owner: asyncpg.Connection
) -> None:
    stranger = "+919000000001"
    assert (await _request(client, stranger))["sent"] is True
    assert await owner.fetchval(
        "SELECT count(*) FROM otp_challenge WHERE phone = $1", stranger
    ) == 0


async def test_a_wrong_code_counts_an_attempt_and_five_locks(
    client: AsyncClient, world: dict[str, UUID], owner: asyncpg.Connection
) -> None:
    phone = world["phone"]
    await _request(client, phone)
    real = await _live_code(client, phone)
    wrong = "000000" if real != "000000" else "111111"
    for _ in range(5):
        r = await client.post("/auth/otp/verify", headers=CSRF, json={"phone": phone, "code": wrong})
        assert r.status_code == 401
    assert await owner.fetchval("SELECT max(attempts) FROM otp_challenge WHERE phone = $1", phone) == 5
    locked = await client.post("/auth/otp/verify", headers=CSRF, json={"phone": phone, "code": real})
    assert locked.status_code == 423
    assert locked.json()["errors"][0]["code"] == "LOCKED"


async def test_an_expired_code_is_refused(
    client: AsyncClient, world: dict[str, UUID], owner: asyncpg.Connection
) -> None:
    phone = world["phone"]
    await _request(client, phone)
    code = await _live_code(client, phone)
    await owner.execute(
        "UPDATE otp_challenge SET expires_at = now() - interval '1 second' WHERE phone = $1", phone
    )
    r = await client.post("/auth/otp/verify", headers=CSRF, json={"phone": phone, "code": code})
    assert r.status_code == 401


async def test_a_consumed_code_cannot_be_replayed(
    client: AsyncClient, world: dict[str, UUID]
) -> None:
    phone = world["phone"]
    await _request(client, phone)
    code = await _live_code(client, phone)
    first = await client.post("/auth/otp/verify", headers=CSRF, json={"phone": phone, "code": code})
    assert first.status_code == 200
    replay = await client.post("/auth/otp/verify", headers=CSRF, json={"phone": phone, "code": code})
    assert replay.status_code == 401


async def test_four_requests_for_one_phone_in_ten_minutes_is_rate_limited(
    client: AsyncClient, world: dict[str, UUID]
) -> None:
    phone = world["phone"]
    for _ in range(3):
        await _request(client, phone)
    r = await client.post("/auth/otp/request", headers=CSRF, json={"phone": phone})
    assert r.status_code == 429
    assert r.json()["errors"][0]["code"] == "RATE_LIMITED"


async def test_twenty_one_requests_from_one_ip_in_an_hour_is_rate_limited(
    client: AsyncClient, world: dict[str, UUID]
) -> None:
    # Distinct unknown numbers, so the per-phone limit never fires first.
    for n in range(20):
        r = await client.post(
            "/auth/otp/request", headers=CSRF, json={"phone": f"+9190000{n:05d}"}
        )
        assert r.status_code == 200, (n, r.text)
    r = await client.post("/auth/otp/request", headers=CSRF, json={"phone": "+919099999999"})
    assert r.status_code == 429


async def test_the_code_is_stored_only_as_a_salted_hash(
    client: AsyncClient, world: dict[str, UUID], owner: asyncpg.Connection
) -> None:
    phone = world["phone"]
    await _request(client, phone)
    code = await _live_code(client, phone)
    stored = await owner.fetchval("SELECT code_hash FROM otp_challenge WHERE phone = $1", phone)
    assert stored == otp.code_hash(code)
    assert code.encode() not in stored


async def test_a_customer_session_reads_only_its_own_rows(
    client: AsyncClient, world: dict[str, UUID], owner: asyncpg.Connection
) -> None:
    """RLS half of 03 §10: the customer realm cannot see another project's rows."""
    other = await owner.fetchval(
        "INSERT INTO project (code, name, product_type, legal_entity, jurisdiction)"
        " VALUES ('SEC2', 'Second Estate', 'villa', 'Pranava Estates Pvt Ltd', 'Telangana')"
        " RETURNING id"
    )
    customer = Principal(realm="customer", customer_id=world["customer"], display_name="Kavya")
    async with tx(customer) as t:
        visible = (await t.conn.execute(text("SELECT id FROM project"))).scalars().all()
    assert visible == [world["project"]]
    assert other not in visible
    await owner.execute("DELETE FROM project WHERE id = $1", other)


async def test_a_customer_session_cannot_reach_a_staff_module(
    client: AsyncClient, world: dict[str, UUID]
) -> None:
    """Matrix half of 03 §10."""
    from kernel.identity.rbac import allows

    customer = Principal(realm="customer", customer_id=world["customer"], display_name="Kavya")
    assert allows(customer, "customer_portal", "read")
    for module in ("crm_rm", "accounts", "project_site", "management", "admin", "files"):
        assert not allows(customer, module, "read"), module


async def test_dev_routes_refuse_when_dev_login_is_off(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from settings import settings

    monkeypatch.setattr(settings, "HOMEFLOW_DEV_LOGIN", False)
    assert (await client.get("/auth/dev-login", params={"user": "x@y.z"})).status_code == 404
    assert (await client.get("/auth/dev-otp", params={"phone": "+919876543210"})).status_code == 404
