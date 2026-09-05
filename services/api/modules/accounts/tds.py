"""TDS record API — one per booking. Drives journey task T8."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import (
    get_project_scope, is_all_projects_user, project_id_of_booking,
    require_project_access, require_project_access_soft, scoped_booking_ids, require_module_by_method
)
from kernel.collaboration.collaboration import (
    ALLOWED_UPLOAD_EXTENSIONS,
    MAX_UPLOAD_BYTES,
    is_super_admin,
    user_role_code,
)
from kernel.mongo import get_db, write_audit
from kernel.action.engine_hooks import (
    find_journey_task_by_key,
    post_task_comment,
    system_cancel_task,
    system_reset_task_from_cancelled,
    system_verify_task,
)
from kernel.files.storage import save_upload_stream


router = APIRouter(prefix="/tds", tags=["tds"], dependencies=[Depends(require_module_by_method("collections"))])


STORAGE_ROOT = Path(os.environ.get("ATTACHMENT_STORAGE_ROOT", "/app/backend/storage"))
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _can_manage_tds(user: dict) -> bool:
    return is_super_admin(user) or user_role_code(user) in {"ACCOUNTS", "CRM", "MANAGEMENT"}


def _can_verify_tds(user: dict) -> bool:
    return is_super_admin(user) or user_role_code(user) in {"ACCOUNTS", "MANAGEMENT"}


class ApplicabilityPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    applicability: str
    na_reason: Optional[str] = None


class TDSPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    tds_amount_inr: Optional[float] = None
    challan_number: Optional[str] = None
    challan_date: Optional[str] = None
    pan_number: Optional[str] = None
    customer_confirmed: Optional[bool] = None
    notes: Optional[str] = None


class VerifyPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    decision: str
    notes: Optional[str] = None


async def _get_or_404(db, tid: str) -> dict:
    doc = await db.tds_records.find_one({"id": tid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="TDS record not found")
    return doc


async def _autocreate(db, booking: dict, actor_id: str) -> dict:
    doc = {
        "id": str(uuid.uuid4()),
        "booking_id": booking["id"],
        "applicability": "Not Determined",
        "na_reason": None,
        "tds_amount_inr": None,
        "deducted_from_payment_id": None,
        "challan_number": None,
        "challan_date": None,
        "pan_number": None,
        "customer_confirmed": False,
        "uploaded_attachment_id": None,
        "verification_status": "Pending",
        "verified_by": None,
        "verified_at": None,
        "verification_notes": None,
        "notes": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.tds_records.insert_one(doc)
    await write_audit(user_id=actor_id, entity_type="tds_record", entity_id=doc["id"],
                      action="create", after=doc, parent_entity_type="booking", parent_entity_id=booking["id"])
    doc.pop("_id", None)
    return doc


@router.get("/booking/{booking_id}")
async def get_by_booking(booking_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b["status"] != "Confirmed":
        raise HTTPException(status_code=404, detail="TDS is only available for Confirmed bookings")
    await require_project_access_soft(current_user, b.get("project_id"))
    doc = await db.tds_records.find_one({"booking_id": booking_id}, {"_id": 0})
    if not doc:
        doc = await _autocreate(db, b, current_user["id"])
    return doc


@router.post("/{tid}/set-applicability")
async def set_applicability(tid: str, payload: ApplicabilityPayload, current_user: dict = Depends(get_current_user)):
    if payload.applicability not in ("Applicable", "Not Applicable"):
        raise HTTPException(status_code=400, detail="applicability must be 'Applicable' or 'Not Applicable'")
    if payload.applicability == "Not Applicable" and not (payload.na_reason or "").strip():
        raise HTTPException(status_code=400, detail="na_reason required when Not Applicable")
    if not _can_manage_tds(current_user):
        raise HTTPException(status_code=403, detail="Only CRM / Accounts / Super Admin can set TDS applicability")
    db = get_db()
    doc = await _get_or_404(db, tid)
    before = dict(doc)
    now = _now()
    updates = {
        "applicability": payload.applicability,
        "na_reason": (payload.na_reason or "").strip() or None if payload.applicability == "Not Applicable" else None,
        "updated_at": now,
    }
    # If flipping to Not Applicable, verification effectively skipped
    if payload.applicability == "Not Applicable":
        updates["verification_status"] = "Not Required"
        updates["verified_by"] = None
        updates["verified_at"] = None
    else:
        # Flipping back to Applicable — clear NA state, verification back to Pending
        updates["verification_status"] = "Pending"
        updates["verified_by"] = None
        updates["verified_at"] = None
    await db.tds_records.update_one({"id": tid}, {"$set": updates})
    after = await db.tds_records.find_one({"id": tid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="tds_record", entity_id=tid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])

    # Engine cascade on T8
    journey = await db.customer_journeys.find_one(
        {"booking_id": doc["booking_id"], "status": {"$in": ["Active", "OnHold", "Closed"]}},
        {"_id": 0},
    )
    if journey:
        t8 = await find_journey_task_by_key(journey["id"], "T8")
        if t8:
            if payload.applicability == "Not Applicable":
                await system_cancel_task(t8["id"], current_user["id"], reason=(payload.na_reason or "").strip() or "Not Applicable")
            elif before.get("applicability") == "Not Applicable" and payload.applicability == "Applicable":
                # Restore T8 from Cancelled → Not Started + reverse cascade
                await system_reset_task_from_cancelled(t8["id"], current_user["id"], reason="TDS applicability restored")
    return after


@router.patch("/{tid}")
async def update_tds(tid: str, payload: TDSPatch, current_user: dict = Depends(get_current_user)):
    if not _can_manage_tds(current_user):
        raise HTTPException(status_code=403, detail="Only CRM / Accounts / Super Admin can edit TDS")
    db = get_db()
    doc = await _get_or_404(db, tid)
    if doc["applicability"] == "Not Applicable":
        raise HTTPException(status_code=400, detail="Cannot edit fields on a Not Applicable TDS record")
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return doc
    changes["updated_at"] = _now()
    before = dict(doc)
    await db.tds_records.update_one({"id": tid}, {"$set": changes})
    after = await db.tds_records.find_one({"id": tid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="tds_record", entity_id=tid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return after


@router.post("/{tid}/upload-challan")
async def upload_challan(tid: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    if not _can_manage_tds(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, tid)
    filename = os.path.basename(file.filename or "")
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File extension {ext} not allowed")
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
            "entity_type": "tds_record",
            "entity_id": tid,
        },
    )
    attachment = {
        "id": attachment_id,
        "entity_type": "tds_record",
        "entity_id": tid,
        "comment_id": None,
        "filename": filename,
        "storage_path": None,
        "gridfs_file_id": gridfs_id,
        "storage_backend": "gridfs",
        "file_missing": False,
        "mime_type": content_type,
        "size_bytes": size,
        "category": "TDS",
        "version": 1,
        "visibility": "Internal",
        "description": None,
        "uploaded_by": current_user["id"],
        "uploaded_at": _now(),
        "verification_status": "Uploaded",
        "verified_by": None,
        "verified_at": None,
        "verification_notes": None,
        "deleted_at": None,
    }
    await db.attachments.insert_one(attachment)
    attachment.pop("_id", None)
    before = dict(doc)
    await db.tds_records.update_one({"id": tid}, {"$set": {"uploaded_attachment_id": attachment["id"], "updated_at": _now()}})
    after = await db.tds_records.find_one({"id": tid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="tds_record", entity_id=tid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return {"tds": after, "attachment": attachment}


@router.post("/{tid}/verify")
async def verify_tds(tid: str, payload: VerifyPayload, current_user: dict = Depends(get_current_user)):
    if payload.decision not in ("Verified", "Rejected"):
        raise HTTPException(status_code=400, detail="decision must be 'Verified' or 'Rejected'")
    if not _can_verify_tds(current_user):
        raise HTTPException(status_code=403, detail="Only Accounts / Super Admin can verify TDS")
    db = get_db()
    doc = await _get_or_404(db, tid)
    if doc.get("applicability") != "Applicable":
        raise HTTPException(status_code=400, detail="TDS must be Applicable to verify")

    if payload.decision == "Verified":
        errors: dict[str, str] = {}
        for k in ("tds_amount_inr", "challan_number", "challan_date", "pan_number", "uploaded_attachment_id"):
            if not doc.get(k):
                errors[k] = "required"
        if errors:
            raise HTTPException(status_code=400, detail={"message": "TDS fields incomplete", "errors": errors})

    now = _now()
    before = dict(doc)
    await db.tds_records.update_one({"id": tid}, {"$set": {
        "verification_status": payload.decision,
        "verified_by": current_user["id"],
        "verified_at": now,
        "verification_notes": (payload.notes or "").strip() or None,
        "updated_at": now,
    }})
    if doc.get("uploaded_attachment_id"):
        await db.attachments.update_one({"id": doc["uploaded_attachment_id"]}, {"$set": {
            "verification_status": payload.decision, "verified_by": current_user["id"], "verified_at": now,
        }})
    after = await db.tds_records.find_one({"id": tid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="tds_record", entity_id=tid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])

    # Cascade
    journey = await db.customer_journeys.find_one(
        {"booking_id": doc["booking_id"], "status": {"$in": ["Active", "OnHold", "Closed"]}},
        {"_id": 0},
    )
    if journey:
        t8 = await find_journey_task_by_key(journey["id"], "T8")
        if t8:
            if payload.decision == "Verified":
                await system_verify_task(t8["id"], current_user["id"])
            else:
                # Rejected — post comment on T8, keep as-is
                await post_task_comment(
                    task_id=t8["id"],
                    actor=current_user,
                    body=f"TDS verification rejected: {(payload.notes or '').strip() or 'no reason provided'}",
                )
    return after
