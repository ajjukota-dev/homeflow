"""`append()` — the one way an event reaches the log (technical/04 §1).

The event row and every job its consumers enqueue share one transaction, so nothing is
emitted without being recorded and nothing recorded is lost.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, cast
from uuid import UUID, uuid4

from sqlalchemy import text

from kernel.db import Tx
from kernel.errors import AppError
from kernel.events.catalogue import spec
from kernel.events.consumers import CONSUMERS
from kernel.jobs.enqueue import enqueue

_INSERT = text(
    "INSERT INTO event (event_type, occurred_at, project_id, actor, subject, payload,"
    "                   previous_state, new_state, reason_code, correlation_id, source)"
    " VALUES (:event_type, coalesce(:occurred_at, now()), :project_id,"
    "         cast(:actor as jsonb), cast(:subject as jsonb), cast(:payload as jsonb),"
    "         cast(:previous_state as jsonb), cast(:new_state as jsonb), :reason_code,"
    "         :correlation_id, cast(:source as jsonb))"
    " RETURNING id"
)

#: subject key -> the table and column that carry `project_id` for it.
_DERIVE = {"unit_id": "unit", "booking_id": "booking"}


async def derive_project_id(tx: Tx, subject: dict[str, Any]) -> UUID | None:
    """Never asked for, always derived (CLAUDE.md). `None` = a portfolio/config event."""
    if subject.get("project_id"):
        return UUID(str(subject["project_id"]))
    for key, table in _DERIVE.items():
        if subject.get(key):
            found = await tx.conn.scalar(
                text(f"SELECT project_id FROM {table} WHERE id = :id"),
                {"id": UUID(str(subject[key]))},
            )
            if found is not None:
                return cast(UUID, found)
    return None


def _json(value: Any) -> str | None:
    return None if value is None else json.dumps(value, default=str)


async def append(
    tx: Tx,
    type: str,
    *,
    subject: dict[str, Any] | None = None,
    payload: dict[str, Any] | None = None,
    actor: dict[str, Any] | None = None,
    previous_state: dict[str, Any] | None = None,
    new_state: dict[str, Any] | None = None,
    reason_code: str | None = None,
    correlation_id: UUID | None = None,
    occurred_at: datetime | None = None,
    source: dict[str, Any] | None = None,
) -> UUID:
    entry = spec(type)  # KeyError -> programming error; unknown types never reach the DB
    if entry.reason_required and not reason_code:
        raise AppError(
            "REASON_CODE_REQUIRED", f"{type} needs a reason code.", extra={"event_type": type}
        )
    subject = subject or {}
    correlation = correlation_id or tx.correlation_id or uuid4()
    project_id = await derive_project_id(tx, subject)
    event_id: UUID = (
        await tx.conn.execute(
            _INSERT,
            {
                "event_type": type,
                "occurred_at": occurred_at,
                "project_id": project_id,
                "actor": _json(actor or tx.principal.as_actor()),
                "subject": _json(subject),
                "payload": _json(payload or {}),
                "previous_state": _json(previous_state),
                "new_state": _json(new_state),
                "reason_code": reason_code,
                "correlation_id": correlation,
                "source": _json(source),
            },
        )
    ).scalar_one()
    for consumer in CONSUMERS.get(type, ()):
        await enqueue(
            tx,
            consumer.kind,
            consumer.args(subject, payload or {}),
            dedupe_key=consumer.dedupe(subject),
            correlation_id=correlation,
            project_id=project_id,
        )
    return event_id
