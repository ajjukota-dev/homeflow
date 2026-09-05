"""DEPRECATED (TASKS Vivek 7). v1's attachment path: multipart upload into GridFS or the
local filesystem, and downloads streamed through the API.

Replaced by `kernel/files/` — `POST /api/v1/files/presign` -> browser PUT -> confirm ->
302 to a presigned GET, with `file_object` rows in Postgres (technical/08 §1). These
routes are kept only so the v1 Mongo routers keep working under `HOMEFLOW_V1_MONGO=1`,
and they still read and write Mongo, not S3: v1 attachment ids, the `attachments`
collection and its verification workflow have no counterpart in `file_object` yet, so
re-pointing them at S3 is the Mongo->Postgres cutover (TASKS Vivek 16), not a small
change. Delete this file with the last v1 router that references an attachment.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import (
    is_all_projects_user, require_entity_access, require_entity_access_soft,
)
from kernel.collaboration.collaboration import (
    ALLOWED_UPLOAD_EXTENSIONS,
    CATEGORY_CHOICES,
    CATEGORY_TO_VERIFIER_DEPT_CODE,
    MAX_UPLOAD_BYTES,
    VERIFICATION_STATUS_CHOICES,
    VISIBILITY_CHOICES,
    can_post_customer_visible,
    can_verify,
    entity_title,
    is_super_admin,
    notify_department_by_code,
    notify_users,
    resolve_entity,
)
from kernel.mongo import get_db, write_audit
from kernel.files.storage import open_download_stream, save_upload_stream


router = APIRouter(prefix="/attachments", tags=["attachments"])


# Legacy filesystem root — only consulted for pre-migration rows with
# storage_backend="filesystem". New writes never touch disk.
STORAGE_ROOT = Path(os.environ.get("ATTACHMENT_STORAGE_ROOT", "/app/backend/storage"))
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)


class VerifyPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    verification_status: str
    verification_notes: Optional[str] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_filename(name: str) -> str:
    """Strip path separators and pick the tail; keep everything else — real UI handles the display."""
    name = os.path.basename(name or "")
    if not name:
        raise HTTPException(status_code=400, detail="File name is required")
    return name


async def _next_version(db, *, entity_type: str, entity_id: str, filename: str) -> int:
    last = await db.attachments.find_one(
        {"entity_type": entity_type, "entity_id": entity_id, "filename": filename},
        sort=[("version", -1)],
    )
    return int(last["version"]) + 1 if last else 1


@router.post("")
async def upload_attachment(
    file: UploadFile = File(...),
    entity_type: str = Form(...),
    entity_id: str = Form(...),
    category: str = Form("Other"),
    visibility: str = Form("Internal"),
    description: Optional[str] = Form(None),
    comment_id: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()

    entity_doc = await resolve_entity(entity_type, entity_id)
    if not entity_doc:
        raise HTTPException(status_code=400, detail="Unsupported or unknown entity_type/entity_id")

    # Phase 9 write guard
    await require_entity_access(current_user, entity_type, entity_id)

    if category not in CATEGORY_CHOICES:
        raise HTTPException(status_code=400, detail=f"category must be one of {CATEGORY_CHOICES}")
    if visibility not in VISIBILITY_CHOICES:
        raise HTTPException(status_code=400, detail=f"visibility must be one of {VISIBILITY_CHOICES}")
    if visibility == "Customer Visible" and not can_post_customer_visible(current_user):
        raise HTTPException(status_code=403, detail="Only CRM/Legal/Management/Super Admin can post Customer Visible files")

    filename = _clean_filename(file.filename)
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File extension {ext or '(none)'} is not allowed. Allowed: {sorted(ALLOWED_UPLOAD_EXTENSIONS)}",
        )

    attachment_id = str(uuid.uuid4())
    content_type = file.content_type or "application/octet-stream"

    gridfs_id, size = await save_upload_stream(
        file,
        max_bytes=MAX_UPLOAD_BYTES,
        filename=filename,
        content_type=content_type,
        metadata={
            "attachment_id": attachment_id,
            "uploaded_by": current_user["id"],
            "entity_type": entity_type,
            "entity_id": entity_id,
        },
    )

    version = await _next_version(db, entity_type=entity_type, entity_id=entity_id, filename=filename)

    doc = {
        "id": attachment_id,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "comment_id": comment_id,
        "filename": filename,
        "storage_path": None,
        "gridfs_file_id": gridfs_id,
        "storage_backend": "gridfs",
        "file_missing": False,
        "mime_type": content_type,
        "size_bytes": size,
        "category": category,
        "version": version,
        "visibility": visibility,
        "description": description or None,
        "uploaded_by": current_user["id"],
        "uploaded_at": _now_iso(),
        "verification_status": "Uploaded",
        "verified_by": None,
        "verified_at": None,
        "verification_notes": None,
        "deleted_at": None,
    }
    await db.attachments.insert_one(doc)

    await write_audit(
        user_id=current_user["id"],
        entity_type="attachment",
        entity_id=doc["id"],
        action="create",
        after=doc,
        parent_entity_type=entity_type,
        parent_entity_id=entity_id,
    )

    label = entity_title(entity_type, entity_doc)
    actor_name = current_user.get("name", "Someone")

    # Notify mentioned users on the parent comment (Rule 5)
    if comment_id:
        parent = await db.comments.find_one({"id": comment_id}, {"_id": 0})
        if parent:
            recipients = list(set(parent.get("mention_user_ids") or []))
            if recipients:
                await notify_users(
                    user_ids=recipients,
                    actor_user_id=current_user["id"],
                    type_="file_uploaded",
                    entity_type=entity_type,
                    entity_id=entity_id,
                    comment_id=comment_id,
                    attachment_id=doc["id"],
                    title=f"{actor_name} uploaded {filename} on {label}",
                    body=f"Category: {category} · v{version}",
                )

    # Rule 6: auto-notify the responsible department for verification-required categories
    dept_code = CATEGORY_TO_VERIFIER_DEPT_CODE.get(category)
    if dept_code:
        await notify_department_by_code(
            department_code=dept_code,
            actor_user_id=current_user["id"],
            type_="verification_requested",
            entity_type=entity_type,
            entity_id=entity_id,
            attachment_id=doc["id"],
            title=f"Verification requested — {filename}",
            body=f"{actor_name} uploaded a {category} document on {label}",
        )

    doc.pop("_id", None)
    return doc


@router.get("")
async def list_attachments(
    entity_type: str = Query(...),
    entity_id: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    # Phase 9 read guard
    await require_entity_access_soft(current_user, entity_type, entity_id)
    docs = await db.attachments.find(
        {"entity_type": entity_type, "entity_id": entity_id, "deleted_at": None},
        {"_id": 0},
    ).sort("uploaded_at", -1).to_list(2000)
    # Default missing fields for legacy rows so the frontend always sees a shape.
    for d in docs:
        d.setdefault("file_missing", False)
        d.setdefault("storage_backend", "filesystem" if d.get("storage_path") else "gridfs")
        d.setdefault("gridfs_file_id", None)
    return docs


async def _mark_file_missing(db, attachment_id: str) -> None:
    await db.attachments.update_one(
        {"id": attachment_id},
        {"$set": {"file_missing": True}},
    )


@router.get("/{attachment_id}/download")
async def download_attachment(
    attachment_id: str,
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    doc = await db.attachments.find_one({"id": attachment_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if doc.get("deleted_at") is not None:
        raise HTTPException(
            status_code=404,
            detail={"detail": "attachment_deleted", "filename": doc.get("filename")},
        )
    # Phase 9 read guard — 404 if entity out of scope
    await require_entity_access_soft(current_user, doc["entity_type"], doc["entity_id"])

    filename = doc.get("filename") or "download"
    mime = doc.get("mime_type") or "application/octet-stream"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}

    if doc.get("file_missing"):
        raise HTTPException(
            status_code=404,
            detail={"detail": "file_missing", "filename": filename},
        )

    backend = doc.get("storage_backend") or ("filesystem" if doc.get("storage_path") else "gridfs")

    if backend == "gridfs":
        gridfs_id = doc.get("gridfs_file_id")
        stream = await open_download_stream(gridfs_id) if gridfs_id else None
        if stream is None:
            await _mark_file_missing(db, attachment_id)
            raise HTTPException(
                status_code=404,
                detail={"detail": "file_missing", "filename": filename},
            )

        async def _gridfs_iter():
            try:
                while True:
                    chunk = await stream.readchunk()
                    if not chunk:
                        break
                    yield chunk
            finally:
                try:
                    stream.close()
                except Exception:
                    pass

        return StreamingResponse(_gridfs_iter(), media_type=mime, headers=headers)

    # Legacy filesystem path — pre-migration rows.
    storage_path = doc.get("storage_path")
    if not storage_path:
        await _mark_file_missing(db, attachment_id)
        raise HTTPException(
            status_code=404,
            detail={"detail": "file_missing", "filename": filename},
        )
    file_path = STORAGE_ROOT / storage_path
    if not file_path.is_file():
        await _mark_file_missing(db, attachment_id)
        raise HTTPException(
            status_code=404,
            detail={"detail": "file_missing", "filename": filename},
        )

    async def _fs_iter():
        async with aiofiles.open(file_path, "rb") as fp:
            while True:
                chunk = await fp.read(1024 * 128)
                if not chunk:
                    break
                yield chunk

    return StreamingResponse(_fs_iter(), media_type=mime, headers=headers)


@router.patch("/{attachment_id}/verify")
async def verify_attachment(
    attachment_id: str,
    payload: VerifyPayload,
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    doc = await db.attachments.find_one({"id": attachment_id, "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if not can_verify(current_user):
        raise HTTPException(status_code=403, detail="Only Management/Accounts/Legal/Registration/QA/CRM/Super Admin can verify")
    if payload.verification_status not in VERIFICATION_STATUS_CHOICES:
        raise HTTPException(status_code=400, detail=f"Status must be one of {VERIFICATION_STATUS_CHOICES}")

    now = _now_iso()
    update: dict = {
        "verification_status": payload.verification_status,
        "verification_notes": (payload.verification_notes or "").strip() or None,
    }
    if payload.verification_status in ("Verified", "Rejected"):
        update["verified_by"] = current_user["id"]
        update["verified_at"] = now
    else:
        # Under Review keeps history; Uploaded resets
        if payload.verification_status == "Uploaded":
            update["verified_by"] = None
            update["verified_at"] = None

    before = dict(doc)
    await db.attachments.update_one({"id": attachment_id}, {"$set": update})
    after = await db.attachments.find_one({"id": attachment_id}, {"_id": 0})

    await write_audit(
        user_id=current_user["id"],
        entity_type="attachment",
        entity_id=attachment_id,
        action="update",
        before=before,
        after=after,
        parent_entity_type=doc["entity_type"],
        parent_entity_id=doc["entity_id"],
    )

    # Rule 8: notify the uploader when Verified/Rejected/Under Review by someone else
    if doc.get("uploaded_by") and doc["uploaded_by"] != current_user["id"]:
        entity_doc = await resolve_entity(doc["entity_type"], doc["entity_id"]) or {}
        label = entity_title(doc["entity_type"], entity_doc)
        actor_name = current_user.get("name", "Someone")
        await notify_users(
            user_ids=[doc["uploaded_by"]],
            actor_user_id=current_user["id"],
            type_="verification_completed",
            entity_type=doc["entity_type"],
            entity_id=doc["entity_id"],
            attachment_id=attachment_id,
            title=f"{doc['filename']} was marked {payload.verification_status}",
            body=f"{actor_name} on {label}",
        )

    return after


@router.delete("/{attachment_id}")
async def delete_attachment(
    attachment_id: str,
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    doc = await db.attachments.find_one({"id": attachment_id, "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if doc["uploaded_by"] != current_user["id"] and not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only the uploader or a Super Admin can delete this file")
    await db.attachments.update_one({"id": attachment_id}, {"$set": {"deleted_at": _now_iso()}})
    await write_audit(
        user_id=current_user["id"],
        entity_type="attachment",
        entity_id=attachment_id,
        action="delete",
        before=doc,
        parent_entity_type=doc["entity_type"],
        parent_entity_id=doc["entity_id"],
    )
    return {"ok": True}
