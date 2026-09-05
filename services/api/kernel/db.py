"""Async engine + the transaction that carries the RLS context (technical/03 §6).

`tx()` is the only way to get a connection, so the five GUCs are set on *every*
transaction and RLS can never be accidentally skipped.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

from kernel.identity.principal import ANONYMOUS, Principal
from settings import settings

_SET_CONTEXT = text(
    "SELECT set_config('app.realm', :realm, true),"
    "       set_config('app.user_id', :user_id, true),"
    "       set_config('app.customer_id', :customer_id, true),"
    "       set_config('app.project_ids', :project_ids, true),"
    "       set_config('app.all_projects', :all_projects, true)"
)

_engine: AsyncEngine | None = None


def engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True, future=True)
    return _engine


async def dispose_engine() -> None:
    global _engine
    if _engine is not None:
        await _engine.dispose()
        _engine = None


@dataclass(frozen=True)
class Tx:
    """A live transaction, the principal whose GUCs are set on it, and the id that ties
    everything written inside it together (technical/04 §1)."""

    conn: AsyncConnection
    principal: Principal
    correlation_id: UUID | None = None


def _guc_params(p: Principal) -> dict[str, str]:
    return {
        "realm": p.realm,
        "user_id": str(p.user_id) if p.user_id else "",
        "customer_id": str(p.customer_id) if p.customer_id else "",
        "project_ids": ",".join(sorted(str(i) for i in p.project_ids)),
        "all_projects": "true" if p.all_projects else "false",
    }


@asynccontextmanager
async def tx(principal: Principal = ANONYMOUS, correlation_id: UUID | None = None) -> AsyncIterator[Tx]:
    """BEGIN, set the RLS GUCs as SET LOCAL, yield, COMMIT (ROLLBACK on any exception)."""
    async with engine().begin() as conn:
        await conn.execute(_SET_CONTEXT, _guc_params(principal))
        yield Tx(conn=conn, principal=principal, correlation_id=correlation_id)
