"""Test wiring: point the app at the compose Postgres on the host, not at `postgres:5432`.

Runs before any test module imports `settings`, which reads env once.
"""
from __future__ import annotations

import os

HOST = os.environ.get("PGHOST", "localhost")
PORT = os.environ.get("POSTGRES_HOST_PORT", "5434")
DB = os.environ.get("PGDATABASE", "homeflow")

os.environ.setdefault("ENV", "local")
os.environ.setdefault("HOMEFLOW_DEV_LOGIN", "1")
os.environ["DATABASE_URL"] = f"postgresql+asyncpg://homeflow_app:homeflow_app@{HOST}:{PORT}/{DB}"
os.environ["OWNER_DATABASE_URL"] = f"postgresql+asyncpg://homeflow_owner:homeflow_owner@{HOST}:{PORT}/{DB}"

# MinIO is `minio:9000` inside compose and `localhost:9000` from the test process.
os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost:9000")
os.environ.setdefault("S3_PUBLIC_ENDPOINT_URL", "http://localhost:9000")
os.environ.setdefault("S3_BUCKET", "homeflow-files")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "homeflow")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "homeflow123")


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
async def _engine_per_test():
    """pytest-asyncio gives each test its own event loop; the module-level async engine
    would otherwise hand the next test a connection bound to a closed loop."""
    yield
    from kernel.db import dispose_engine

    await dispose_engine()
