"""Alembic environment (technical/02 §7).

Migrations connect as `homeflow_owner` (it owns every object), never as the app role.
The whole upgrade runs while holding `pg_advisory_lock(42)` on the same connection, so
two API tasks starting together queue instead of racing.
"""
from __future__ import annotations

import asyncio
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from settings import settings  # noqa: E402

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", settings.OWNER_DATABASE_URL)

# DDL is hand-written SQL via op.execute, so there is no metadata to autogenerate from.
target_metadata = None

ADVISORY_LOCK_ID = 42


def run_migrations_offline() -> None:
    context.configure(
        url=settings.OWNER_DATABASE_URL,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def _run(connection: Connection) -> None:
    connection.execute(text("SELECT pg_advisory_lock(:id)"), {"id": ADVISORY_LOCK_ID})
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()
    connection.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": ADVISORY_LOCK_ID})


async def run_migrations_online() -> None:
    engine = async_engine_from_config(
        config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool
    )
    async with engine.connect() as connection:
        await connection.run_sync(_run)
        await connection.commit()
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
