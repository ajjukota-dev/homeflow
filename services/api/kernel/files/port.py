"""The `Files` port and its S3/MinIO implementation (technical/01 §4, 08 §1).

The API never proxies bytes: the browser PUTs and GETs S3 directly through presigned
URLs, and this module only ever mints them.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol
from uuid import UUID

import boto3
from botocore.config import Config

from settings import settings

#: technical/08 §1 — the allowed list, not a wildcard.
ALLOWED_CONTENT_TYPES: dict[str, str] = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/heic": ".heic",
    "image/vnd.dwg": ".dwg",
    "application/acad": ".dwg",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/csv": ".csv",
}
MAX_BYTES = 50 * 1024 * 1024
UPLOAD_TTL = 600
DOWNLOAD_TTL = 300
#: Above this, the checksum is a job rather than an inline read.
INLINE_SHA256_LIMIT = 5 * 1024 * 1024

Visibility = Literal["internal", "customer_facing"]


@dataclass(frozen=True)
class FileMeta:
    entity_type: str
    entity_id: UUID
    filename: str
    content_type: str
    size_bytes: int
    visibility: Visibility = "internal"


@dataclass(frozen=True)
class PresignedUpload:
    file_id: UUID
    url: str
    method: str
    headers: dict[str, str]


class Files(Protocol):
    async def presign_upload(self, tx: Any, p: Any, meta: FileMeta) -> PresignedUpload: ...
    async def confirm(self, tx: Any, file_id: UUID) -> dict[str, Any]: ...
    def presign_download(self, key: str, ttl: int = DOWNLOAD_TTL) -> str: ...


def _client(endpoint: str | None) -> Any:
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4", connect_timeout=3, read_timeout=10),
    )


def s3() -> Any:
    """Server-side calls (head, get, delete): the endpoint this process can reach."""
    return _client(settings.S3_ENDPOINT_URL)


def signer() -> Any:
    """URL minting: the endpoint the *browser* can reach.

    SigV4 signs the Host header, so a presigned URL cannot have its host rewritten after
    the fact — it has to be signed against the public endpoint from the start. Locally
    that is `localhost:9000` while the API itself still talks to `minio:9000`; in AWS
    S3_PUBLIC_ENDPOINT_URL is unset and both are real S3 (technical/08 §1).
    """
    return _client(settings.S3_PUBLIC_ENDPOINT_URL or settings.S3_ENDPOINT_URL)


def s3_key(project_id: UUID | None, entity_type: str, entity_id: UUID, file_id: UUID) -> str:
    """`{project_id}/{entity_type}/{entity_id}/{id}` (technical/02 §4.4)."""
    return f"{project_id or 'portfolio'}/{entity_type}/{entity_id}/{file_id}"
