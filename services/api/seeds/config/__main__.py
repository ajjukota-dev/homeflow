"""`python -m seeds.config` — roles, permissions, schedules, and (HOMEFLOW_DEMO=1) users.

Idempotent by natural key: every statement is an upsert on the primary key, so the
entrypoint can run it on every container start.
"""
from __future__ import annotations

import asyncio
import json
import logging

from sqlalchemy import text

from kernel.db import dispose_engine, tx
from kernel.identity.principal import SYSTEM
from seeds.config.demo_users import DEMO_USERS
from seeds.config.roles import permissions, roles
from seeds.config.schedules import SCHEDULES
from settings import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
log = logging.getLogger("seeds.config")


async def seed_roles() -> int:
    async with tx(SYSTEM) as t:
        for role_id, name, all_projects in roles():
            await t.conn.execute(
                text(
                    "INSERT INTO role (id, name, all_projects) VALUES (:id, :name, :ap)"
                    " ON CONFLICT (id) DO UPDATE SET name = excluded.name,"
                    "   all_projects = excluded.all_projects"
                ),
                {"id": role_id, "name": name, "ap": all_projects},
            )
        rows = permissions()
        for role_id, module, level, modifiers in rows:
            await t.conn.execute(
                text(
                    "INSERT INTO permission (role_id, module, level, modifiers)"
                    " VALUES (:r, :m, :l, cast(:mods as jsonb))"
                    " ON CONFLICT (role_id, module) DO UPDATE SET level = excluded.level,"
                    "   modifiers = excluded.modifiers"
                ),
                {"r": role_id, "m": module, "l": level, "mods": json.dumps(modifiers)},
            )
    return len(rows)


async def seed_schedules() -> int:
    async with tx(SYSTEM) as t:
        for row in SCHEDULES:
            await t.conn.execute(
                text(
                    "INSERT INTO schedule (kind, args, every_seconds, daily_at, next_run_at)"
                    " VALUES (:kind, '{}', :every, :daily, now())"
                    " ON CONFLICT (kind) DO UPDATE SET every_seconds = excluded.every_seconds,"
                    "   daily_at = excluded.daily_at"
                ),
                row,
            )
    return len(SCHEDULES)


async def seed_demo_users() -> int:
    """One staff user per role, so `HOMEFLOW_DEV_LOGIN=1` has somebody to sign in as."""
    async with tx(SYSTEM) as t:
        for email, full_name, role_id in DEMO_USERS:
            user_id = await t.conn.scalar(
                text(
                    'INSERT INTO "user" (email, full_name) VALUES (:e, :n)'
                    " ON CONFLICT (email) DO UPDATE SET full_name = excluded.full_name"
                    " RETURNING id"
                ),
                {"e": email, "n": full_name},
            )
            await t.conn.execute(
                text(
                    "INSERT INTO user_role_assignment (user_id, role_id) VALUES (:u, :r)"
                    " ON CONFLICT DO NOTHING"
                ),
                {"u": user_id, "r": role_id},
            )
    return len(DEMO_USERS)


async def main() -> None:
    log.info("config seed: %d permission rows", await seed_roles())
    log.info("config seed: %d schedule rows", await seed_schedules())
    if settings.HOMEFLOW_DEMO:
        log.info("config seed: %d demo users", await seed_demo_users())
    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
