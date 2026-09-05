"""uuid_generate_v7() must sort by time (technical/02 §2)."""
from __future__ import annotations

import os

import asyncpg
import pytest

pytestmark = pytest.mark.integration

HOST = os.environ.get("PGHOST", "localhost")
PORT = int(os.environ.get("POSTGRES_HOST_PORT", "5434"))
DB = os.environ.get("PGDATABASE", "homeflow")


async def test_uuid7_ids_sort_by_generation_order() -> None:
    conn = await asyncpg.connect(host=HOST, port=PORT, user="homeflow_owner",
                                 password="homeflow_owner", database=DB)
    try:
        rows = await conn.fetch(
            "SELECT n, uuid_generate_v7() AS id FROM generate_series(1, 1000) AS n ORDER BY n"
        )
        ids = [r["id"] for r in rows]
        assert len(set(ids)) == 1000, "uuid_generate_v7() produced a collision"
        assert ids == sorted(ids), "uuid_generate_v7() output does not sort by time"
        # version 7, RFC 4122 variant
        assert all(i.hex[12] == "7" for i in ids)
        assert all(i.hex[16] in "89ab" for i in ids)
    finally:
        await conn.close()
