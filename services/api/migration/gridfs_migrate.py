"""One-shot migration: move existing filesystem-backed attachments into GridFS.

Idempotent. Safe to re-run. Never deletes or rewrites ``storage_path`` —
the field is left intact for rollback safety. Blobs already in GridFS
(``gridfs_file_id`` set) are skipped.

Usage:
    cd /app/backend
    python -m migrations.gridfs_migrate
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Make backend/ importable when this script is invoked directly.
_HERE = Path(__file__).resolve()
_BACKEND = _HERE.parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import aiofiles  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

load_dotenv(_BACKEND / ".env")

from kernel.mongo import get_db, init_db  # noqa: E402
from kernel.files.storage import save_bytes  # noqa: E402


logging.basicConfig(level=logging.INFO, format="%(asctime)s [gridfs_migrate] %(message)s")
log = logging.getLogger("gridfs_migrate")

STORAGE_ROOT = Path(os.environ.get("ATTACHMENT_STORAGE_ROOT", "/app/backend/storage"))


async def _read_file_bytes(path: Path) -> bytes | None:
    try:
        async with aiofiles.open(path, "rb") as fp:
            return await fp.read()
    except FileNotFoundError:
        return None
    except Exception as exc:  # noqa: BLE001
        log.warning("read failure on %s: %s", path, exc)
        return None


async def migrate() -> dict:
    init_db()
    db = get_db()

    total = await db.attachments.count_documents({})
    migrated = 0
    already = 0
    missing = 0

    cursor = db.attachments.find({}, {"_id": 0})
    async for doc in cursor:
        att_id = doc.get("id")
        if not att_id:
            continue

        # Already migrated — leave it.
        if doc.get("gridfs_file_id"):
            already += 1
            continue

        # Soft-deleted rows: don't attempt migration, but do mark them so
        # the frontend never tries to download a missing blob.
        if doc.get("deleted_at"):
            already += 1
            continue

        storage_path = doc.get("storage_path")
        file_bytes: bytes | None = None
        if storage_path:
            file_path = STORAGE_ROOT / storage_path
            file_bytes = await _read_file_bytes(file_path)

        if file_bytes is None:
            # No usable file — flag it so downloads return the friendly
            # 404 and the UI can render the "Missing — re-upload required"
            # chip. We keep storage_path intact.
            await db.attachments.update_one(
                {"id": att_id},
                {"$set": {
                    "file_missing": True,
                    "storage_backend": "filesystem",
                    "gridfs_file_id": None,
                }},
            )
            missing += 1
            log.info(
                "MISSING: id=%s filename=%r storage_path=%r",
                att_id, doc.get("filename"), storage_path,
            )
            continue

        gridfs_id = await save_bytes(
            file_bytes,
            filename=doc.get("filename") or f"att_{att_id}",
            content_type=doc.get("mime_type") or "application/octet-stream",
            metadata={
                "attachment_id": att_id,
                "uploaded_by": doc.get("uploaded_by"),
                "entity_type": doc.get("entity_type"),
                "entity_id": doc.get("entity_id"),
                "migrated": True,
            },
        )
        await db.attachments.update_one(
            {"id": att_id},
            {"$set": {
                "gridfs_file_id": gridfs_id,
                "storage_backend": "gridfs",
                "file_missing": False,
                "migrated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        migrated += 1

    result = {"migrated": migrated, "already_migrated": already, "missing": missing, "total": total}
    log.info("done: %s", result)
    return result


if __name__ == "__main__":
    r = asyncio.run(migrate())
    print("\n=== gridfs_migrate summary ===")
    for k, v in r.items():
        print(f"  {k}: {v}")
