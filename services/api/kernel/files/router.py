"""`/api/v1/files/*` (technical/08 §1)."""
from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from starlette.responses import RedirectResponse

from kernel.db import tx
from kernel.errors import AppError, ok
from kernel.files import service
from kernel.files.ownership import owner_of
from kernel.files.port import FileMeta, Visibility
from kernel.identity.principal import Principal
from kernel.identity.rbac import allows, principal_of, require

router = APIRouter(prefix="/api/v1/files", tags=["files"])

MODULE = "files"
Writer = Annotated[Principal, Depends(require(MODULE, "write"))]


class PresignRequest(BaseModel):
    entity_type: str = Field(min_length=1, max_length=64)
    entity_id: UUID
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=127)
    size_bytes: int
    visibility: Visibility = "internal"


@router.post("/presign")
async def presign(request: Request, body: PresignRequest, principal: Writer) -> dict[str, Any]:
    """The caller must be able to write the *parent* entity, not just `files`."""
    owner = owner_of(body.entity_type)
    if not allows(principal, owner.module, "write"):
        raise AppError(
            "FORBIDDEN", f"Not permitted to attach files to {body.entity_type}.",
            extra={"module": owner.module},
        )
    async with tx(principal) as t:
        upload = await service.presign_upload(
            t,
            principal,
            FileMeta(
                entity_type=body.entity_type,
                entity_id=body.entity_id,
                filename=body.filename,
                content_type=body.content_type,
                size_bytes=body.size_bytes,
                visibility=body.visibility,
            ),
        )
    return ok(
        {
            "file_id": str(upload.file_id),
            "upload": {"url": upload.url, "method": upload.method, "headers": upload.headers},
        },
        request,
    )


@router.post("/{file_id}/confirm")
async def confirm(request: Request, file_id: UUID, principal: Writer) -> dict[str, Any]:
    async with tx(principal) as t:
        row = await service.confirm(t, principal, file_id)
    return ok(
        {
            "file_id": str(row["id"]),
            "status": row["status"],
            "size_bytes": row["size_bytes"],
            "sha256": row["sha256"].hex() if row["sha256"] else None,
        },
        request,
    )


@router.get("/{file_id}")
async def download(request: Request, file_id: UUID) -> RedirectResponse:
    """302 to a presigned GET. Customers reach their own files without the staff matrix,
    so this route gates on the realm and `visibility`, not on `require()`."""
    principal = principal_of(request)
    if principal.realm == "staff" and not allows(principal, MODULE, "read"):
        raise AppError("FORBIDDEN", "Not permitted on files.", extra={"module": MODULE})
    async with tx(principal) as t:
        url = await service.download_url(t, principal, file_id)
    return RedirectResponse(url, status_code=302)
