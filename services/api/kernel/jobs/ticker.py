"""The in-process job ticker (technical/04 §3).

One task runs it, chosen by a session-level `pg_try_advisory_lock(7001)` held on a
dedicated connection for the ticker's lifetime. When that task dies the lock releases
and another API task takes over within five seconds. No SQS, no worker service.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from kernel.db import engine, tx
from kernel.identity.principal import SYSTEM
from kernel.jobs.registry import HANDLERS, backoff, next_run

log = logging.getLogger("homeflow.jobs")

LOCK_ID = 7001
BATCH = 10
IDLE_SLEEP = 10.0
BUSY_SLEEP = 2.0
NO_LOCK_SLEEP = 5.0

_CLAIM = text(
    "UPDATE job SET status = 'running', started_at = now(), attempts = attempts + 1"
    " WHERE id IN (SELECT id FROM job WHERE status = 'queued' AND run_at <= now()"
    "              ORDER BY run_at LIMIT :batch FOR UPDATE SKIP LOCKED)"
    " RETURNING id, kind, args, attempts, max_attempts, correlation_id"
)


@dataclass
class TickerState:
    """What `/health` reports (technical/04 §3)."""

    holder: bool = False
    last_tick_at: datetime | None = None
    running: bool = False
    _lock_conn: AsyncConnection | None = field(default=None, repr=False)

    def as_dict(self) -> dict[str, Any]:
        return {
            "holder": self.holder,
            "last_tick_at": self.last_tick_at.isoformat() if self.last_tick_at else None,
        }


STATE = TickerState()
_task: asyncio.Task[None] | None = None


async def expand_schedules(conn: AsyncConnection) -> int:
    """Due `schedule` rows become `job` rows, deduped on the kind so a slow handler
    cannot pile up behind itself."""
    rows = (
        await conn.execute(
            text(
                "SELECT kind, args, every_seconds, daily_at FROM schedule"
                " WHERE enabled AND next_run_at <= now() FOR UPDATE SKIP LOCKED"
            )
        )
    ).mappings().all()
    now = datetime.now(UTC)
    for row in rows:
        await conn.execute(
            text(
                "INSERT INTO job (kind, args, dedupe_key)"
                " VALUES (:kind, cast(:args as jsonb), :dedupe)"
                " ON CONFLICT (dedupe_key) WHERE status IN ('queued','running') DO NOTHING"
            ),
            {
                "kind": row["kind"],
                "args": json.dumps(row["args"] or {}),
                "dedupe": f"schedule:{row['kind']}",
            },
        )
        await conn.execute(
            text("UPDATE schedule SET last_run_at = now(), next_run_at = :next WHERE kind = :kind"),
            {
                "kind": row["kind"],
                "next": next_run(now, every_seconds=row["every_seconds"], daily_at=row["daily_at"]),
            },
        )
    return len(rows)


async def run_one(job_id: UUID, kind: str, args: dict[str, Any], attempts: int,
                  max_attempts: int, correlation_id: UUID | None) -> None:
    """Each job in its own transaction as the system principal (technical/03 §6)."""
    handler = HANDLERS.get(kind)
    if handler is None:
        await _fail(job_id, attempts, max_attempts, kind, correlation_id,
                    f"no handler registered for {kind}")
        return
    try:
        async with tx(SYSTEM, correlation_id=correlation_id) as t:
            await handler(t, args)
    except Exception as exc:  # noqa: BLE001 — the runner is the retry policy
        log.warning("job %s (%s) failed on attempt %d: %s", job_id, kind, attempts, exc)
        await _fail(job_id, attempts, max_attempts, kind, correlation_id, str(exc))
        return
    async with tx(SYSTEM) as t:
        await t.conn.execute(
            text("UPDATE job SET status = 'done', finished_at = now() WHERE id = :id"),
            {"id": job_id},
        )


async def _fail(job_id: UUID, attempts: int, max_attempts: int, kind: str,
                correlation_id: UUID | None, error: str) -> None:
    from kernel.events.append import append

    dead = attempts >= max_attempts
    async with tx(SYSTEM, correlation_id=correlation_id) as t:
        await t.conn.execute(
            text(
                "UPDATE job SET status = :status, last_error = :error,"
                "   finished_at = CASE WHEN :dead THEN now() ELSE NULL END,"
                "   run_at = CASE WHEN :dead THEN run_at ELSE now() + cast(:wait as interval) END"
                " WHERE id = :id"
            ),
            {
                "id": job_id, "status": "dead" if dead else "queued", "error": error[:2000],
                "dead": dead, "wait": backoff(attempts),
            },
        )
        if dead:
            await append(
                t, "job.dead",
                subject={"job_id": str(job_id)},
                payload={"kind": kind, "attempts": attempts, "last_error": error[:2000]},
                correlation_id=correlation_id,
            )


async def tick() -> int:
    """One pass. Returns how many jobs were claimed; the tests call this directly."""
    conn = STATE._lock_conn
    assert conn is not None, "tick() runs only while the ticker holds the advisory lock"
    # The lock connection autobegins on first use, so commit explicitly rather than
    # nesting a `conn.begin()` inside the transaction SQLAlchemy already opened.
    try:
        await expand_schedules(conn)
        claimed = (await conn.execute(_CLAIM, {"batch": BATCH})).mappings().all()
        await conn.commit()
    except Exception:
        await conn.rollback()
        raise
    STATE.last_tick_at = datetime.now(UTC)
    for row in claimed:
        asyncio.create_task(
            run_one(row["id"], row["kind"], row["args"], row["attempts"],
                    row["max_attempts"], row["correlation_id"])
        )
    return len(claimed)


async def run() -> None:
    """The loop. Started and stopped by the app lifespan when TICKER_ENABLED."""
    STATE.running = True
    conn = await engine().connect()
    STATE._lock_conn = conn
    try:
        while STATE.running:
            if not STATE.holder:
                STATE.holder = bool(await conn.scalar(text("SELECT pg_try_advisory_lock(:id)"),
                                                      {"id": LOCK_ID}))
                await conn.commit()  # a session-level lock outlives the transaction
                if not STATE.holder:
                    await asyncio.sleep(NO_LOCK_SLEEP)
                    continue
                log.info("ticker: holding advisory lock %d", LOCK_ID)
            try:
                claimed = await tick()
            except Exception:  # noqa: BLE001 — one bad pass must not stop the ticker
                log.exception("ticker: tick failed")
                claimed = 0
            await asyncio.sleep(BUSY_SLEEP if claimed else IDLE_SLEEP)
    except asyncio.CancelledError:
        raise
    finally:
        STATE.running = False
        if STATE.holder:
            with contextlib.suppress(Exception):
                await conn.rollback()
                await conn.scalar(text("SELECT pg_advisory_unlock(:id)"), {"id": LOCK_ID})
                await conn.commit()
            STATE.holder = False
        STATE._lock_conn = None
        await conn.close()


async def start() -> None:
    global _task
    if _task is None:
        _task = asyncio.create_task(run())


async def stop() -> None:
    global _task
    STATE.running = False
    if _task is not None:
        _task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _task
        _task = None
