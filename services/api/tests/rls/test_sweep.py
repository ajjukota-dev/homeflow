"""The RLS sweep (technical/02 §3, TASKS Vivek 4).

Connects as `homeflow_app` — the role the API uses, with `NOBYPASSRLS` — sets the five GUCs
for a staff user on project A, and proves that every RLS-enabled table returns A's rows and
none of B's. With `app.realm = 'none'` every table must return nothing at all.

Run against the compose stack: `uv run pytest -m integration`.
"""
from __future__ import annotations

import os
from collections.abc import AsyncIterator
from uuid import UUID

import asyncpg
import pytest

from tests.rls.factory import seed_project

pytestmark = pytest.mark.integration

HOST = os.environ.get("PGHOST", "localhost")
PORT = int(os.environ.get("POSTGRES_HOST_PORT", "5434"))
DB = os.environ.get("PGDATABASE", "homeflow")

# Tables whose partition column is `id`, not `project_id`.
_PROJECT_COLUMN = {"project": "id"}
# Not project-partitioned at all: config and master rows every staff user may read.
_UNPARTITIONED = {"customer", "team", "component_definition", "change_category", "change_gate_rule"}

_SET_GUCS = (
    "SELECT set_config('app.realm', $1, false),"
    "       set_config('app.user_id', $2, false),"
    "       set_config('app.customer_id', $3, false),"
    "       set_config('app.project_ids', $4, false),"
    "       set_config('app.all_projects', $5, false)"
)


async def _connect(user: str) -> asyncpg.Connection:
    return await asyncpg.connect(host=HOST, port=PORT, user=user, password=user, database=DB)


async def _set_context(
    conn: asyncpg.Connection,
    *,
    realm: str,
    user_id: str = "",
    customer_id: str = "",
    project_ids: str = "",
    all_projects: str = "false",
) -> None:
    await conn.execute(_SET_GUCS, realm, user_id, customer_id, project_ids, all_projects)


async def _rls_tables(conn: asyncpg.Connection) -> list[str]:
    rows = await conn.fetch(
        "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
        " WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity"
        " ORDER BY relname"
    )
    return [r["relname"] for r in rows]


@pytest.fixture
async def seeded() -> AsyncIterator[dict[str, dict[str, UUID]]]:
    """Two complete projects, inserted as the owner, removed again at the end."""
    owner = await _connect("homeflow_owner")
    try:
        # FORCE ROW LEVEL SECURITY applies to the owner too, so give it a context that sees all.
        await _set_context(owner, realm="staff", all_projects="true")
        await _purge(owner)
        a = await seed_project(owner, "RLSA")
        b = await seed_project(owner, "RLSB")
        yield {"a": a, "b": b}
        await _purge(owner)
    finally:
        await owner.close()


# Everything the sweep creates is prefixed RLS, so a re-run after a crashed one is clean
# and nothing else in the database is touched.
_CHILD_TABLES = (
    "event",
    "handover_record",
    "home_passport_item",
    "as_built_revision",
    "snag",
    "qa_evidence",
    "unit_change_gate",
    "unit_progress_state",
    "unit_spec_item",
    "file_object",
    "booking_applicant",
    "booking",
    "project_team_assignment",
    "unit",
    "project_hierarchy_node",
)


async def _purge(owner: asyncpg.Connection) -> None:
    """Delete the sweep's own rows in FK order. Only the sweep does this; the app has no grant."""
    scope = "SELECT id FROM project WHERE code LIKE 'RLS%'"
    for table in _CHILD_TABLES:
        await owner.execute(f"DELETE FROM {table} WHERE project_id IN ({scope})")
    await owner.execute("DELETE FROM change_gate_rule WHERE category_id IN"
                        " (SELECT id FROM change_category WHERE code LIKE 'RLS%')")
    await owner.execute("DELETE FROM change_category WHERE code LIKE 'RLS%'")
    await owner.execute("DELETE FROM component_definition WHERE code LIKE 'RLS%'")
    await owner.execute("DELETE FROM team WHERE code LIKE 'RLS%'")
    await owner.execute("DELETE FROM customer WHERE primary_email LIKE 'rls%'")
    await owner.execute("DELETE FROM project WHERE code LIKE 'RLS%'")
    await owner.execute('DELETE FROM "user" WHERE email LIKE \'rls%\'')


async def test_every_partitioned_table_is_scoped_to_the_staff_projects(
    seeded: dict[str, dict[str, UUID]],
) -> None:
    a, b = seeded["a"], seeded["b"]
    app = await _connect("homeflow_app")
    try:
        await _set_context(
            app, realm="staff", user_id=str(a["user"]), project_ids=str(a["project"])
        )
        tables = await _rls_tables(app)
        assert len(tables) >= 18, tables

        leaked: list[str] = []
        empty: list[str] = []
        for table in tables:
            if table in _UNPARTITIONED:
                continue
            column = _PROJECT_COLUMN.get(table, "project_id")
            mine = await app.fetchval(
                f"SELECT count(*) FROM {table} WHERE {column} = $1", a["project"]
            )
            theirs = await app.fetchval(
                f"SELECT count(*) FROM {table} WHERE {column} = $1", b["project"]
            )
            if theirs:
                leaked.append(table)
            if not mine:
                empty.append(table)
        assert leaked == [], f"cross-project rows visible on: {leaked}"
        assert empty == [], f"own-project rows invisible on: {empty}"
    finally:
        await app.close()


async def test_realm_none_sees_nothing_anywhere(seeded: dict[str, dict[str, UUID]]) -> None:
    app = await _connect("homeflow_app")
    try:
        await _set_context(app, realm="none")
        nonempty = []
        for table in await _rls_tables(app):
            if await app.fetchval(f"SELECT count(*) FROM {table}"):
                nonempty.append(table)
        assert nonempty == [], f"anonymous context saw rows on: {nonempty}"
    finally:
        await app.close()


async def test_customer_realm_sees_only_their_own_booking(
    seeded: dict[str, dict[str, UUID]],
) -> None:
    a, b = seeded["a"], seeded["b"]
    app = await _connect("homeflow_app")
    try:
        await _set_context(app, realm="customer", customer_id=str(a["customer"]))
        visible = await app.fetch("SELECT id FROM booking")
        assert [r["id"] for r in visible] == [a["booking"]]
        assert await app.fetchval("SELECT count(*) FROM unit WHERE id = $1", b["unit"]) == 0
        # No customer policy on progress state, so the construction detail is invisible.
        assert await app.fetchval("SELECT count(*) FROM unit_progress_state") == 0
    finally:
        await app.close()


@pytest.mark.parametrize("statement", ["UPDATE event SET reason_code = 'x'", "DELETE FROM event"])
async def test_event_is_append_only_for_the_app_role(statement: str) -> None:
    app = await _connect("homeflow_app")
    try:
        await _set_context(app, realm="staff", all_projects="true")
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await app.execute(statement)
    finally:
        await app.close()
