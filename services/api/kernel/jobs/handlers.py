"""Kernel housekeeping handlers (technical/04 §3-§4).

Everything else lives next to the tables it writes, in the module that owns them.
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import text

from kernel.db import Tx
from kernel.jobs.registry import job

log = logging.getLogger("homeflow.jobs")

#: A task that dies mid-run leaves its row `running`; after this it is queued again.
#: Intervals are `timedelta`: asyncpg binds the parameter before the cast, so a string
#: would arrive as text and Postgres would refuse the subtraction.
STUCK_AFTER = timedelta(minutes=10)
KEEP_DONE = timedelta(days=7)
KEEP_DEAD = timedelta(days=90)
KEEP_OTP = timedelta(days=30)


@job("job.reap")
async def reap(tx: Tx, args: dict[str, Any]) -> None:
    n = await tx.conn.scalar(
        text(
            "WITH reaped AS ("
            "  UPDATE job SET status = 'queued', started_at = NULL"
            "   WHERE status = 'running' AND started_at < now() - cast(:stuck as interval)"
            "   RETURNING 1) SELECT count(*) FROM reaped"
        ),
        {"stuck": STUCK_AFTER},
    )
    if n:
        log.info("job.reap: requeued %d stuck jobs", n)


@job("job.prune")
async def prune(tx: Tx, args: dict[str, Any]) -> None:
    """The only hard delete of kernel data, and none of it is material history: the
    events these jobs produced stay (technical/02 §4.3, 03 §9)."""
    done = await tx.conn.scalar(
        text(
            "WITH gone AS (DELETE FROM job WHERE status = 'done'"
            "   AND finished_at < now() - cast(:keep as interval) RETURNING 1)"
            " SELECT count(*) FROM gone"
        ),
        {"keep": KEEP_DONE},
    )
    dead = await tx.conn.scalar(
        text(
            "WITH gone AS (DELETE FROM job WHERE status = 'dead'"
            "   AND finished_at < now() - cast(:keep as interval) RETURNING 1)"
            " SELECT count(*) FROM gone"
        ),
        {"keep": KEEP_DEAD},
    )
    otp = await tx.conn.scalar(
        text(
            "WITH gone AS (DELETE FROM otp_challenge"
            "   WHERE created_at < now() - cast(:keep as interval) RETURNING 1)"
            " SELECT count(*) FROM gone"
        ),
        {"keep": KEEP_OTP},
    )
    log.info("job.prune: %s done, %s dead, %s otp challenges removed", done, dead, otp)
