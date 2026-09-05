"""Reading the event log (technical/04 §6) — the audit tab on every 360 screen.

Staff only, RLS-scoped (the policy on `event` does the project filter), redacted through
`permission.modifiers` for the `events` module.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import text

from kernel.db import tx
from kernel.errors import ok
from kernel.identity.principal import Principal
from kernel.identity.rbac import require
from kernel.identity.redact import redact
from kernel.pagination import clamp_limit, decode_cursor, encode_cursor

router = APIRouter(prefix="/api/v1/events", tags=["events"])

MODULE = "events"
#: Module-level so the dependency is built once — and so `Depends(...)` never sits in a
#: function default (ruff B008); this is the shape every 2.0 router uses.
Reader = Annotated[Principal, Depends(require(MODULE, "read"))]
_COLUMNS = (
    "id, event_type, occurred_at, recorded_at, project_id, actor, subject, payload,"
    " previous_state, new_state, reason_code, correlation_id, source"
)


def _row(row: Any) -> dict[str, Any]:
    out = dict(row)
    for key in ("id", "project_id", "correlation_id"):
        if out.get(key) is not None:
            out[key] = str(out[key])
    for key in ("occurred_at", "recorded_at"):
        if isinstance(out.get(key), datetime):
            out[key] = out[key].isoformat()
    return out


@router.get("")
async def list_events(
    request: Request,
    principal: Reader,
    booking_id: Annotated[UUID | None, Query(alias="subject.booking_id")] = None,
    unit_id: Annotated[UUID | None, Query(alias="subject.unit_id")] = None,
    type: Annotated[str | None, Query()] = None,
    from_: Annotated[datetime | None, Query(alias="from")] = None,
    to: Annotated[datetime | None, Query()] = None,
    cursor: Annotated[str | None, Query()] = None,
    limit: Annotated[int | None, Query()] = None,
) -> dict[str, Any]:
    size = clamp_limit(limit)
    where = ["true"]
    params: dict[str, Any] = {"limit": size + 1}
    if booking_id:
        where.append("subject @> cast(:booking as jsonb)")
        params["booking"] = f'{{"booking_id": "{booking_id}"}}'
    if unit_id:
        where.append("subject @> cast(:unit as jsonb)")
        params["unit"] = f'{{"unit_id": "{unit_id}"}}'
    if type:
        where.append("event_type = :type")
        params["type"] = type
    if from_:
        where.append("recorded_at >= :from_ts")
        params["from_ts"] = from_
    if to:
        where.append("recorded_at <= :to_ts")
        params["to_ts"] = to
    if cursor:
        sort_key, row_id = decode_cursor(cursor)
        where.append("(recorded_at, id) < (cast(:c_ts as timestamptz), cast(:c_id as uuid))")
        params["c_ts"], params["c_id"] = sort_key, row_id
    async with tx(principal) as t:
        rows = (
            await t.conn.execute(
                text(
                    f"SELECT {_COLUMNS} FROM event WHERE {' AND '.join(where)}"
                    " ORDER BY recorded_at DESC, id DESC LIMIT :limit"
                ),
                params,
            )
        ).mappings().all()
    items = [_row(r) for r in rows[:size]]
    next_cursor = (
        encode_cursor(items[-1]["recorded_at"], items[-1]["id"]) if len(rows) > size else None
    )
    data = redact(items, principal, MODULE)
    return ok(data, request, **({"next_cursor": next_cursor} if next_cursor else {}))


@router.get("/{correlation_id}/trace")
async def trace(
    request: Request,
    correlation_id: UUID,
    principal: Reader,
) -> dict[str, Any]:
    """Every event one handshake produced, oldest first — the workflow, reconstructed."""
    async with tx(principal) as t:
        rows = (
            await t.conn.execute(
                text(
                    f"SELECT {_COLUMNS} FROM event WHERE correlation_id = :cid"
                    " ORDER BY recorded_at, id"
                ),
                {"cid": correlation_id},
            )
        ).mappings().all()
    return ok(redact([_row(r) for r in rows], principal, MODULE), request)
