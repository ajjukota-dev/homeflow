"""`enqueue()` — a job row in the caller's transaction (technical/04 §3)."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import text

from kernel.db import Tx

_INSERT = text(
    "INSERT INTO job (kind, args, run_at, dedupe_key, correlation_id, project_id)"
    " VALUES (:kind, cast(:args as jsonb), coalesce(:run_at, now()), :dedupe_key,"
    "         :correlation_id, :project_id)"
    " ON CONFLICT (dedupe_key) WHERE status IN ('queued','running') DO NOTHING"
    " RETURNING id"
)


async def enqueue(
    tx: Tx,
    kind: str,
    args: dict[str, Any] | None = None,
    *,
    run_at: datetime | None = None,
    dedupe_key: str | None = None,
    correlation_id: UUID | None = None,
    project_id: UUID | None = None,
) -> UUID | None:
    """Returns the new job id, or `None` when `dedupe_key` coalesced it into a live job."""
    row = await tx.conn.execute(
        _INSERT,
        {
            "kind": kind,
            "args": json.dumps(args or {}, default=str),
            "run_at": run_at,
            "dedupe_key": dedupe_key,
            "correlation_id": correlation_id or tx.correlation_id,
            "project_id": project_id,
        },
    )
    return row.scalar_one_or_none()
