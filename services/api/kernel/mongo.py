"""MongoDB connection + shared helpers (v1; goes with the cutover, TASKS Vivek 16).

`write_audit` now lives in `kernel/events/legacy.py` and writes to the Postgres event
log; it is re-exported here so the v1 routers' imports keep working unchanged.
"""
from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket

from kernel.events.legacy import write_audit

__all__ = ["write_audit"]


_client: AsyncIOMotorClient | None = None
_db = None
_gridfs_bucket: AsyncIOMotorGridFSBucket | None = None


def init_db():
    global _client, _db, _gridfs_bucket
    if _client is None:
        _client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        _db = _client[os.environ["DB_NAME"]]
        _gridfs_bucket = AsyncIOMotorGridFSBucket(_db, bucket_name="attachments")
    return _db


def get_db():
    if _db is None:
        return init_db()
    return _db


def get_gridfs_bucket() -> AsyncIOMotorGridFSBucket:
    """Return the shared GridFS bucket for attachment blobs.

    The bucket is named ``attachments`` so its underlying collections
    are ``attachments.files`` and ``attachments.chunks``.
    """
    global _gridfs_bucket
    if _gridfs_bucket is None:
        init_db()
    return _gridfs_bucket  # type: ignore[return-value]


def close_db():
    global _client, _db, _gridfs_bucket
    if _client is not None:
        _client.close()
        _client = None
        _db = None
        _gridfs_bucket = None


def utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


def sanitize(doc: dict[str, Any]) -> dict[str, Any]:
    """Strip Mongo _id from a document."""
    if doc is None:
        return doc
    doc = dict(doc)
    doc.pop("_id", None)
    return doc


async def next_sequence(name: str) -> int:
    """Atomic auto-increment counter used for CUS-000001, BKG-000001 style codes."""
    db = get_db()
    doc = await db.counters.find_one_and_update(
        {"_id": name},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return int(doc["seq"])


def _new_uuid() -> str:
    import uuid
    return str(uuid.uuid4())
