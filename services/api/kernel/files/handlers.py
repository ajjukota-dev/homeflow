"""File jobs: the out-of-band checksum and the orphan prune (technical/08 §1)."""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any
from uuid import UUID

from botocore.exceptions import ClientError
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from kernel.db import Tx
from kernel.files.port import s3
from kernel.files.service import _sha256
from kernel.jobs.registry import job
from settings import settings

log = logging.getLogger("homeflow.files")

#: technical/08 §1 — a `pending` row means the browser never finished its PUT.
PENDING_TTL = timedelta(hours=24)


@job("file.checksum")
async def checksum(tx: Tx, args: dict[str, Any]) -> None:
    """Files over 5 MB get their sha256 here rather than inline on confirm."""
    file_id = UUID(str(args["file_id"]))
    key = await tx.conn.scalar(
        text("SELECT s3_key FROM file_object WHERE id = :id AND sha256 IS NULL"), {"id": file_id}
    )
    if key is None:
        return  # already checksummed, or gone — idempotent by construction
    await tx.conn.execute(
        text("UPDATE file_object SET sha256 = :sha WHERE id = :id"),
        {"id": file_id, "sha": await _sha256(key)},
    )


@job("file.prune")
async def prune(tx: Tx, args: dict[str, Any]) -> None:
    """Drop `pending` rows older than a day, and the orphan object with them."""
    rows = (
        await tx.conn.execute(
            text(
                "SELECT id, s3_key FROM file_object"
                " WHERE status = 'pending' AND created_at < now() - cast(:ttl as interval)"
            ),
            {"ttl": PENDING_TTL},
        )
    ).mappings().all()
    for row in rows:
        try:
            await run_in_threadpool(
                s3().delete_object, Bucket=settings.S3_BUCKET, Key=row["s3_key"]
            )
        except ClientError:
            log.warning("file.prune: could not delete %s; removing the row anyway", row["s3_key"])
        await tx.conn.execute(text("DELETE FROM file_object WHERE id = :id"), {"id": row["id"]})
    if rows:
        log.info("file.prune: removed %d abandoned uploads", len(rows))
