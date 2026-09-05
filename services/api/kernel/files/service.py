"""presign -> PUT -> confirm -> presigned GET (technical/08 §1). No bytes pass through us."""
from __future__ import annotations

import hashlib
import json
from typing import Any, cast
from uuid import UUID

from botocore.exceptions import ClientError
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from kernel.db import Tx
from kernel.errors import AppError
from kernel.events.append import append
from kernel.files.ownership import owner_of
from kernel.files.port import (
    ALLOWED_CONTENT_TYPES,
    DOWNLOAD_TTL,
    INLINE_SHA256_LIMIT,
    MAX_BYTES,
    UPLOAD_TTL,
    FileMeta,
    PresignedUpload,
    s3,
    s3_key,
    signer,
)
from kernel.identity.principal import Principal
from kernel.jobs.enqueue import enqueue
from settings import settings


def validate(meta: FileMeta) -> None:
    if meta.content_type not in ALLOWED_CONTENT_TYPES:
        raise AppError(
            "VALIDATION", f"{meta.content_type} is not an accepted file type.", field="content_type"
        )
    if meta.size_bytes <= 0 or meta.size_bytes > MAX_BYTES:
        raise AppError(
            "VALIDATION", f"Files must be between 1 byte and {MAX_BYTES // 1024 // 1024} MB.",
            field="size_bytes",
        )


async def _parent_project_id(tx: Tx, entity_type: str, entity_id: UUID) -> UUID | None:
    """RLS read of the parent row: invisible parent means 404, never 403 (technical/07 §2)."""
    owner = owner_of(entity_type)
    if owner.table is None:
        return None
    column = "id" if owner.table == "project" else "project_id"
    row = (
        await tx.conn.execute(
            text(f"SELECT {column} AS project_id FROM {owner.table} WHERE id = :id"),
            {"id": entity_id},
        )
    ).mappings().first()
    if row is None:
        raise AppError("NOT_FOUND", "No such record.")
    return cast(UUID, row["project_id"])


async def presign_upload(tx: Tx, principal: Principal, meta: FileMeta) -> PresignedUpload:
    validate(meta)
    owner = owner_of(meta.entity_type)
    if meta.visibility == "customer_facing" and not owner.customer_facing_allowed:
        raise AppError(
            "VALIDATION", f"{meta.entity_type} files are internal only.", field="visibility"
        )
    project_id = await _parent_project_id(tx, meta.entity_type, meta.entity_id)
    file_id: UUID = (
        await tx.conn.execute(text("SELECT uuid_generate_v7()"))
    ).scalar_one()
    key = s3_key(project_id, meta.entity_type, meta.entity_id, file_id)
    await tx.conn.execute(
        text(
            "INSERT INTO file_object (id, project_id, entity_type, entity_id, s3_key, filename,"
            "                         content_type, size_bytes, visibility, uploaded_by)"
            " VALUES (:id, :project_id, :entity_type, :entity_id, :key, :filename, :content_type,"
            "         :size_bytes, :visibility, cast(:uploaded_by as jsonb))"
        ),
        {
            "id": file_id, "project_id": project_id, "entity_type": meta.entity_type,
            "entity_id": meta.entity_id, "key": key, "filename": meta.filename,
            "content_type": meta.content_type, "size_bytes": meta.size_bytes,
            "visibility": meta.visibility, "uploaded_by": json.dumps(principal.as_actor()),
        },
    )
    url = await run_in_threadpool(
        signer().generate_presigned_url,
        "put_object",
        Params={
            "Bucket": settings.S3_BUCKET,
            "Key": key,
            "ContentType": meta.content_type,
            "ContentLength": meta.size_bytes,
        },
        ExpiresIn=UPLOAD_TTL,
    )
    return PresignedUpload(
        file_id=file_id,
        url=url,
        method="PUT",
        headers={"Content-Type": meta.content_type, "Content-Length": str(meta.size_bytes)},
    )


async def _row(tx: Tx, file_id: UUID) -> dict[str, Any]:
    row = (
        await tx.conn.execute(
            text(
                "SELECT id, project_id, entity_type, entity_id, s3_key, filename, content_type,"
                "       size_bytes, sha256, visibility, status FROM file_object WHERE id = :id"
            ),
            {"id": file_id},
        )
    ).mappings().first()
    if row is None:
        raise AppError("NOT_FOUND", "No such file.")
    return dict(row)


async def confirm(tx: Tx, principal: Principal, file_id: UUID) -> dict[str, Any]:
    """The object is in the bucket; record what actually landed and mark it ready."""
    row = await _row(tx, file_id)
    try:
        head = await run_in_threadpool(
            s3().head_object, Bucket=settings.S3_BUCKET, Key=row["s3_key"]
        )
    except ClientError as exc:
        raise AppError("NOT_FOUND", "The upload has not arrived yet.") from exc
    size = int(head["ContentLength"])
    if size > MAX_BYTES:
        raise AppError("VALIDATION", "That file is too large.", field="size_bytes")
    sha256 = await _sha256(row["s3_key"]) if size <= INLINE_SHA256_LIMIT else None
    await tx.conn.execute(
        text(
            "UPDATE file_object SET status = 'ready', size_bytes = :size, sha256 = :sha"
            " WHERE id = :id"
        ),
        {"id": file_id, "size": size, "sha": sha256},
    )
    if sha256 is None:
        await enqueue(tx, "file.checksum", {"file_id": str(file_id)},
                      dedupe_key=f"file.checksum:{file_id}", project_id=row["project_id"])
    await append(
        tx, "file.attached",
        subject={
            "file_id": str(file_id), "entity_type": row["entity_type"],
            "entity_id": str(row["entity_id"]),
            **({"project_id": str(row["project_id"])} if row["project_id"] else {}),
        },
        payload={"filename": row["filename"], "content_type": row["content_type"], "size": size},
    )
    return {**row, "status": "ready", "size_bytes": size, "sha256": sha256}


async def _sha256(key: str) -> bytes:
    body = await run_in_threadpool(s3().get_object, Bucket=settings.S3_BUCKET, Key=key)
    digest = hashlib.sha256()
    for chunk in body["Body"].iter_chunks(1024 * 256):
        digest.update(chunk)
    return digest.digest()


async def download_url(tx: Tx, principal: Principal, file_id: UUID) -> str:
    """RLS has already scoped the row by project; visibility is the second check."""
    row = await _row(tx, file_id)
    if principal.realm == "customer" and row["visibility"] != "customer_facing":
        raise AppError("NOT_FOUND", "No such file.")  # no existence leak (technical/07 §2)
    if row["status"] != "ready":
        raise AppError("NOT_FOUND", "That file is not ready yet.")
    url = await run_in_threadpool(
        signer().generate_presigned_url,
        "get_object",
        Params={
            "Bucket": settings.S3_BUCKET,
            "Key": row["s3_key"],
            "ResponseContentDisposition": f'attachment; filename="{row["filename"]}"',
        },
        ExpiresIn=DOWNLOAD_TTL,
    )
    return cast(str, url)
