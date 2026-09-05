"""The six guarantees of technical/04 §7, against the compose Postgres."""
from __future__ import annotations

from uuid import UUID, uuid4

import asyncpg
import pytest
from sqlalchemy import text

from kernel.db import tx
from kernel.errors import AppError
from kernel.events.append import append
from kernel.events.consumers import Consumer
from kernel.identity.principal import SYSTEM
from kernel.jobs.enqueue import enqueue
from kernel.jobs.registry import HANDLERS, job
from kernel.jobs.ticker import LOCK_ID, run_one

pytestmark = pytest.mark.integration


@pytest.fixture
def counted_consumer(monkeypatch: pytest.MonkeyPatch) -> str:
    """A consumer whose kind has a handler, wired only for the test (04 §2)."""
    kind = "job.reap"  # already registered; the point here is the fan-out, not the work
    monkeypatch.setitem(
        __import__("kernel.events.consumers", fromlist=["CONSUMERS"]).CONSUMERS,
        "unit.progress.updated",
        (
            Consumer(
                kind=kind,
                args=lambda subject, payload: {"unit_id": str(subject.get("unit_id"))},
                dedupe=lambda subject: f"gate:{subject.get('unit_id')}",
            ),
        ),
    )
    return kind


# --- 1. rollback leaves no event and no job -----------------------------------------


async def test_a_rolled_back_transaction_leaves_no_event_and_no_job(
    world: dict[str, UUID], owner: asyncpg.Connection, counted_consumer: str
) -> None:
    correlation = uuid4()
    with pytest.raises(RuntimeError):
        async with tx(SYSTEM, correlation_id=correlation) as t:
            await append(t, "unit.progress.updated", subject={"unit_id": str(world["unit"])})
            raise RuntimeError("the caller failed after appending")
    assert await owner.fetchval(
        "SELECT count(*) FROM event WHERE correlation_id = $1", correlation
    ) == 0
    assert await owner.fetchval(
        "SELECT count(*) FROM job WHERE correlation_id = $1", correlation
    ) == 0


# --- 2. the consumer job is in the same transaction as the event --------------------


async def test_the_consumer_job_shares_the_events_transaction_and_correlation(
    world: dict[str, UUID], owner: asyncpg.Connection, counted_consumer: str
) -> None:
    correlation = uuid4()
    async with tx(SYSTEM, correlation_id=correlation) as t:
        await append(t, "unit.progress.updated", subject={"unit_id": str(world["unit"])})
    events = await owner.fetch("SELECT * FROM event WHERE correlation_id = $1", correlation)
    jobs = await owner.fetch("SELECT * FROM job WHERE correlation_id = $1", correlation)
    assert len(events) == 1
    assert len(jobs) == 1
    assert jobs[0]["kind"] == counted_consumer
    assert events[0]["project_id"] == world["project"] == jobs[0]["project_id"]
    await owner.execute("DELETE FROM job WHERE correlation_id = $1", correlation)


async def test_project_id_is_derived_from_the_subject_never_supplied(
    world: dict[str, UUID], owner: asyncpg.Connection
) -> None:
    async with tx(SYSTEM) as t:
        by_unit = await append(t, "unit.gate.opened", subject={"unit_id": str(world["unit"])})
        by_booking = await append(
            t, "booking.created", subject={"booking_id": str(world["booking"])}
        )
        portfolio = await append(t, "config.changed", subject={})
    rows = {
        r["id"]: r["project_id"]
        for r in await owner.fetch(
            "SELECT id, project_id FROM event WHERE id = ANY($1::uuid[])",
            [by_unit, by_booking, portfolio],
        )
    }
    assert rows[by_unit] == world["project"]
    assert rows[by_booking] == world["project"]
    assert rows[portfolio] is None


async def test_an_event_that_needs_a_reason_code_refuses_without_one(
    world: dict[str, UUID]
) -> None:
    async with tx(SYSTEM) as t:
        with pytest.raises(AppError) as exc:
            await append(t, "booking.cancelled", subject={"booking_id": str(world["booking"])})
        assert exc.value.code == "REASON_CODE_REQUIRED"
        assert exc.value.status_code == 400
        await append(
            t, "booking.cancelled", subject={"booking_id": str(world["booking"])},
            reason_code="customer_withdrew",
        )


async def test_an_uncatalogued_type_never_reaches_the_database(world: dict[str, UUID]) -> None:
    async with tx(SYSTEM) as t:
        with pytest.raises(KeyError):
            await append(t, "booking.invented_by_a_dev", subject={})


# --- 3. the app role cannot rewrite the audit trail ---------------------------------


async def test_the_app_role_cannot_update_or_delete_an_event(world: dict[str, UUID]) -> None:
    async with tx(SYSTEM) as t:
        await append(t, "unit.gate.opened", subject={"unit_id": str(world["unit"])})
    for statement in ("UPDATE event SET reason_code = 'tampered'", "DELETE FROM event"):
        with pytest.raises(Exception) as exc:  # noqa: B017 — the driver's own error class
            async with tx(SYSTEM) as t:
                await t.conn.execute(text(statement))
        assert "permission denied" in str(exc.value).lower()


# --- 4. two connections cannot both be the ticker -----------------------------------


async def test_only_one_connection_can_hold_the_ticker_lock() -> None:
    """The mechanism, on a private lock id: the compose stack's own ticker is holding
    LOCK_ID right now, which is the guarantee working, not a reason to fail the test."""
    from tests.security.conftest import connect

    assert LOCK_ID == 7001  # technical/04 §3
    test_lock = LOCK_ID + 90_000
    first = await connect("homeflow_app")
    second = await connect("homeflow_app")
    try:
        assert await first.fetchval("SELECT pg_try_advisory_lock($1)", test_lock) is True
        assert await second.fetchval("SELECT pg_try_advisory_lock($1)", test_lock) is False
        await first.execute("SELECT pg_advisory_unlock($1)", test_lock)
        assert await second.fetchval("SELECT pg_try_advisory_lock($1)", test_lock) is True
        await second.execute("SELECT pg_advisory_unlock($1)", test_lock)
    finally:
        await first.close()
        await second.close()


# --- 5. five failures make a job dead, with a job.dead event ------------------------


async def test_a_job_that_keeps_raising_dies_and_says_so(
    world: dict[str, UUID], owner: asyncpg.Connection
) -> None:
    @job("test.always-fails")
    async def _always_fails(t, args) -> None:  # noqa: ANN001
        raise RuntimeError("nope")

    correlation = uuid4()
    async with tx(SYSTEM, correlation_id=correlation) as t:
        job_id = await enqueue(t, "test.always-fails", {"n": 1})
    assert job_id is not None
    for attempt in range(1, 6):
        await run_one(job_id, "test.always-fails", {"n": 1}, attempt, 5, correlation)
    row = await owner.fetchrow("SELECT status, last_error, attempts FROM job WHERE id = $1", job_id)
    assert row["status"] == "dead"
    assert "nope" in row["last_error"]
    dead = await owner.fetch(
        "SELECT payload FROM event WHERE event_type = 'job.dead' AND correlation_id = $1",
        correlation,
    )
    assert len(dead) == 1
    await owner.execute("DELETE FROM job WHERE id = $1", job_id)
    HANDLERS.pop("test.always-fails", None)


async def test_a_failing_job_is_requeued_with_a_growing_backoff(
    world: dict[str, UUID], owner: asyncpg.Connection
) -> None:
    @job("test.fails-once")
    async def _fails(t, args) -> None:  # noqa: ANN001
        raise RuntimeError("transient")

    async with tx(SYSTEM) as t:
        job_id = await enqueue(t, "test.fails-once", {})
    assert job_id is not None
    await run_one(job_id, "test.fails-once", {}, 1, 5, None)
    row = await owner.fetchrow(
        "SELECT status, run_at > now() + interval '30 seconds' AS waits FROM job WHERE id = $1",
        job_id,
    )
    assert row["status"] == "queued"
    assert row["waits"] is True
    await owner.execute("DELETE FROM job WHERE id = $1", job_id)
    HANDLERS.pop("test.fails-once", None)


async def test_a_handler_that_succeeds_marks_the_job_done(
    world: dict[str, UUID], owner: asyncpg.Connection
) -> None:
    seen: list[dict] = []

    @job("test.succeeds")
    async def _ok(t, args) -> None:  # noqa: ANN001
        seen.append(args)

    async with tx(SYSTEM) as t:
        job_id = await enqueue(t, "test.succeeds", {"unit_id": str(world["unit"])})
    assert job_id is not None
    await run_one(job_id, "test.succeeds", {"unit_id": str(world["unit"])}, 1, 5, None)
    assert seen == [{"unit_id": str(world["unit"])}]
    assert await owner.fetchval("SELECT status FROM job WHERE id = $1", job_id) == "done"
    await owner.execute("DELETE FROM job WHERE id = $1", job_id)
    HANDLERS.pop("test.succeeds", None)


# --- 6. dedupe coalesces a burst ----------------------------------------------------


async def test_fifty_progress_updates_on_one_unit_leave_one_queued_job(
    world: dict[str, UUID], owner: asyncpg.Connection, counted_consumer: str
) -> None:
    correlation = uuid4()
    async with tx(SYSTEM, correlation_id=correlation) as t:
        for _ in range(50):
            await append(t, "unit.progress.updated", subject={"unit_id": str(world["unit"])})
    assert await owner.fetchval(
        "SELECT count(*) FROM event WHERE correlation_id = $1", correlation
    ) == 50
    assert await owner.fetchval(
        "SELECT count(*) FROM job WHERE dedupe_key = $1 AND status IN ('queued','running')",
        f"gate:{world['unit']}",
    ) == 1
    await owner.execute("DELETE FROM job WHERE correlation_id = $1", correlation)


# --- reading the log (04 §6) --------------------------------------------------------


async def test_the_events_endpoint_is_filtered_scoped_and_role_gated(
    client, world: dict[str, UUID], owner: asyncpg.Connection
) -> None:
    from kernel.identity import session as session_mod
    from tests.security.conftest import CSRF  # noqa: F401

    correlation = uuid4()
    async with tx(SYSTEM, correlation_id=correlation) as t:
        await append(t, "booking.created", subject={"booking_id": str(world["booking"])})
        await append(t, "unit.gate.opened", subject={"unit_id": str(world["unit"])})

    await owner.execute(
        "INSERT INTO user_role_assignment (user_id, role_id) VALUES ($1, 'super_admin')"
        " ON CONFLICT DO NOTHING",
        world["user"],
    )
    r = await client.get("/auth/dev-login", params={"user": world["email"]})
    cookies = {session_mod.COOKIE_NAME: r.cookies[session_mod.COOKIE_NAME]}

    listed = await client.get(
        "/api/v1/events", params={"subject.booking_id": str(world["booking"])}, cookies=cookies
    )
    assert listed.status_code == 200, listed.text
    types = {e["event_type"] for e in listed.json()["data"]}
    assert types == {"booking.created"}

    traced = await client.get(f"/api/v1/events/{correlation}/trace", cookies=cookies)
    assert traced.status_code == 200
    assert [e["event_type"] for e in traced.json()["data"]] == [
        "booking.created", "unit.gate.opened"
    ]


async def test_a_role_without_the_events_module_is_forbidden(
    client, world: dict[str, UUID], owner: asyncpg.Connection
) -> None:
    """Sales has `customer_audit: none` in v1's matrix, so it inherits no `events`."""
    from kernel.identity import session as session_mod

    await owner.execute("DELETE FROM user_role_assignment WHERE user_id = $1", world["user"])
    await owner.execute(
        "INSERT INTO user_role_assignment (user_id, role_id) VALUES ($1, 'sales')", world["user"]
    )
    r = await client.get("/auth/dev-login", params={"user": world["email"]})
    got = await client.get(
        "/api/v1/events",
        cookies={session_mod.COOKIE_NAME: r.cookies[session_mod.COOKIE_NAME]},
    )
    assert got.status_code == 403
    assert got.json()["errors"][0]["code"] == "FORBIDDEN"
