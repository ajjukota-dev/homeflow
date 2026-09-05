"""Legal record + versioned drafts (Phase 6 — lean).

One legal_record per booking. Drafts uploaded as versioned attachments.
Upload draft (first) cascade-completes journey task T5.
Approve cascade-completes T6. Reject reverse-cascades T5 + T6.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import (
    get_project_scope, is_all_projects_user, project_id_of_booking,
    require_project_access_soft, scoped_booking_ids, require_module_by_method
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
    system_complete_task,
    system_reset_task_to_in_progress,
)
from kernel.files.storage import save_upload_stream


router = APIRouter(prefix="", tags=["legal"], dependencies=[Depends(require_module_by_method("legal"))])

STORAGE_ROOT = Path(os.environ.get("ATTACHMENT_STORAGE_ROOT", "/app/backend/storage"))
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)

ALLOWED_STATUS = {
    "Not Started", "Draft Uploaded", "Under Review",
    "Deviations Raised", "Approved", "Rejected",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid() -> str:
    return str(uuid.uuid4())


def _can_manage_legal(user: dict) -> bool:
    """Legal / Super Admin manage; also Management."""
    return is_super_admin(user) or user_role_code(user) in {"LEGAL", "MANAGEMENT"}


class DeviationPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    deviation_notes: str


class ApprovePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    notes: Optional[str] = None


class RejectPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str


async def _get_or_404(db, lid: str) -> dict:
    doc = await db.legal_records.find_one({"id": lid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Legal record not found")
    return doc


async def _find_journey_id_for_booking(db, booking_id: str) -> Optional[str]:
    j = await db.customer_journeys.find_one(
        {"booking_id": booking_id, "status": {"$in": ["Active", "OnHold", "Closed"]}},
        {"_id": 0, "id": 1},
    )
    return (j or {}).get("id")


async def _cascade_task_completed(db, booking_id: str, key: str, actor_id: str, note: str = "") -> None:
    jid = await _find_journey_id_for_booking(db, booking_id)
    if not jid:
        return
    t = await find_journey_task_by_key(jid, key)
    if t:
        await system_complete_task(t["id"], actor_id, note=note or f"Auto-completed by Legal ({key})")


async def _reverse_task(db, booking_id: str, key: str, actor_id: str, reason: str) -> None:
    jid = await _find_journey_id_for_booking(db, booking_id)
    if not jid:
        return
    t = await find_journey_task_by_key(jid, key)
    if t and t["status"] == "Completed":
        await system_reset_task_to_in_progress(t["id"], actor_id, reason=reason)


async def _enrich(db, doc: dict) -> dict:
    doc = dict(doc)
    versions = await db.legal_versions.find(
        {"legal_record_id": doc["id"]}, {"_id": 0}
    ).sort("version", -1).to_list(100)
    if doc.get("latest_draft_attachment_id"):
        att = await db.attachments.find_one({"id": doc["latest_draft_attachment_id"]}, {"_id": 0})
        doc["latest_draft"] = att
    else:
        doc["latest_draft"] = None
    doc["version_count"] = len(versions)
    doc["latest_version"] = versions[0]["version"] if versions else 0
    return doc


async def _upload_attachment(file: UploadFile, entity_id: str, user_id: str) -> dict:
    db = get_db()
    filename = os.path.basename(file.filename or "")
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File extension {ext} not allowed")
    attachment_id = _uid()
    content_type = file.content_type or "application/octet-stream"
    gridfs_id, size = await save_upload_stream(
        file,
        max_bytes=MAX_UPLOAD_BYTES,
        filename=filename,
        content_type=content_type,
        metadata={
            "attachment_id": attachment_id,
            "uploaded_by": user_id,
            "entity_type": "legal_record",
            "entity_id": entity_id,
        },
    )
    doc = {
        "id": attachment_id,
        "entity_type": "legal_record",
        "entity_id": entity_id,
        "comment_id": None,
        "filename": filename,
        "storage_path": None,
        "gridfs_file_id": gridfs_id,
        "storage_backend": "gridfs",
        "file_missing": False,
        "mime_type": content_type,
        "size_bytes": size,
        "category": "Agreement",
        "version": 1,
        "visibility": "Internal",
        "description": None,
        "uploaded_by": user_id,
        "uploaded_at": _now(),
        "verification_status": "Uploaded",
        "verified_by": None,
        "verified_at": None,
        "verification_notes": None,
        "deleted_at": None,
    }
    await db.attachments.insert_one(doc)
    return doc


# ---------------- Endpoints ----------------

@router.get("/legal/booking/{booking_id}")
async def get_legal_for_booking(booking_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking["status"] != "Confirmed":
        raise HTTPException(status_code=404, detail="Legal record only for Confirmed bookings")
    await require_project_access_soft(current_user, booking.get("project_id"))
    doc = await db.legal_records.find_one({"booking_id": booking_id}, {"_id": 0})
    if not doc:
        # Auto-create
        doc = {
            "id": _uid(),
            "booking_id": booking_id,
            "status": "Not Started",
            "latest_draft_attachment_id": None,
            "deviation_notes": None,
            "reviewed_by": None,
            "reviewed_at": None,
            "approved_by": None,
            "approved_at": None,
            "approval_notes": None,
            "rejection_reason": None,
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.legal_records.insert_one(doc)
        doc.pop("_id", None)
        await write_audit(user_id=current_user["id"], entity_type="legal_record", entity_id=doc["id"],
                          action="create", after=doc,
                          parent_entity_type="booking", parent_entity_id=booking_id)
    return await _enrich(db, doc)


@router.post("/legal/{lid}/upload-draft")
async def upload_draft(lid: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    if not _can_manage_legal(current_user):
        raise HTTPException(status_code=403, detail="Only Legal / Super Admin can upload drafts")
    db = get_db()
    doc = await _get_or_404(db, lid)
    if doc["status"] == "Approved":
        raise HTTPException(status_code=400, detail="Legal is Approved — cannot upload new draft. Reject first to reopen.")

    att = await _upload_attachment(file, lid, current_user["id"])
    # Increment version
    latest = await db.legal_versions.find({"legal_record_id": lid}, {"_id": 0, "version": 1}).sort("version", -1).to_list(1)
    new_ver = (latest[0]["version"] if latest else 0) + 1
    ver = {
        "id": _uid(),
        "legal_record_id": lid,
        "version": new_ver,
        "attachment_id": att["id"],
        "uploaded_by": current_user["id"],
        "uploaded_at": _now(),
        "comments": None,
    }
    await db.legal_versions.insert_one(ver)

    is_first = new_ver == 1
    before = dict(doc)
    updates: dict = {"latest_draft_attachment_id": att["id"], "updated_at": _now()}
    if doc["status"] == "Not Started":
        updates["status"] = "Draft Uploaded"
    # After a rejection, subsequent upload moves to Draft Uploaded (fresh draft)
    if doc["status"] == "Rejected":
        updates["status"] = "Draft Uploaded"
        updates["rejection_reason"] = None
    await db.legal_records.update_one({"id": lid}, {"$set": updates})
    after = await db.legal_records.find_one({"id": lid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="legal_record", entity_id=lid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])

    # Cascade T5 on first upload only
    if is_first:
        await _cascade_task_completed(db, doc["booking_id"], "T5",
                                      current_user["id"], note="Draft agreement uploaded")

    return await _enrich(db, after)


@router.post("/legal/{lid}/submit-for-review")
async def submit_for_review(lid: str, current_user: dict = Depends(get_current_user)):
    if not _can_manage_legal(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, lid)
    if doc["status"] not in ("Draft Uploaded", "Deviations Raised"):
        raise HTTPException(status_code=400, detail=f"Cannot submit from status '{doc['status']}'")
    before = dict(doc)
    await db.legal_records.update_one({"id": lid}, {"$set": {"status": "Under Review", "updated_at": _now()}})
    after = await db.legal_records.find_one({"id": lid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="legal_record", entity_id=lid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return await _enrich(db, after)


@router.post("/legal/{lid}/raise-deviation")
async def raise_deviation(lid: str, payload: DeviationPayload, current_user: dict = Depends(get_current_user)):
    if not _can_manage_legal(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    if not payload.deviation_notes.strip():
        raise HTTPException(status_code=400, detail="deviation_notes required")
    db = get_db()
    doc = await _get_or_404(db, lid)
    if doc["status"] not in ("Draft Uploaded", "Under Review"):
        raise HTTPException(status_code=400, detail=f"Cannot raise deviation from '{doc['status']}'")
    before = dict(doc)
    await db.legal_records.update_one({"id": lid}, {"$set": {
        "status": "Deviations Raised",
        "deviation_notes": payload.deviation_notes.strip(),
        "updated_at": _now(),
    }})
    after = await db.legal_records.find_one({"id": lid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="legal_record", entity_id=lid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return await _enrich(db, after)


@router.post("/legal/{lid}/resolve-deviations")
async def resolve_deviations(lid: str, current_user: dict = Depends(get_current_user)):
    if not _can_manage_legal(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, lid)
    if doc["status"] != "Deviations Raised":
        raise HTTPException(status_code=400, detail="No deviations to resolve")
    before = dict(doc)
    await db.legal_records.update_one({"id": lid}, {"$set": {
        "status": "Under Review",
        "deviation_notes": None,
        "updated_at": _now(),
    }})
    after = await db.legal_records.find_one({"id": lid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="legal_record", entity_id=lid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return await _enrich(db, after)


@router.post("/legal/{lid}/approve")
async def approve_legal(lid: str, payload: ApprovePayload, current_user: dict = Depends(get_current_user)):
    if not _can_manage_legal(current_user):
        raise HTTPException(status_code=403, detail="Only Legal / Super Admin can approve")
    db = get_db()
    doc = await _get_or_404(db, lid)
    if doc["status"] not in ("Draft Uploaded", "Under Review", "Deviations Raised"):
        raise HTTPException(status_code=400, detail=f"Cannot approve from status '{doc['status']}'")
    if not doc.get("latest_draft_attachment_id"):
        raise HTTPException(status_code=400, detail="Cannot approve without an uploaded draft")
    before = dict(doc)
    now = _now()
    await db.legal_records.update_one({"id": lid}, {"$set": {
        "status": "Approved",
        "approved_by": current_user["id"],
        "approved_at": now,
        "approval_notes": (payload.notes or "").strip() or None,
        "reviewed_by": current_user["id"],
        "reviewed_at": now,
        "deviation_notes": None,
        "rejection_reason": None,
        "updated_at": now,
    }})
    after = await db.legal_records.find_one({"id": lid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="legal_record", entity_id=lid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    # Cascade T6 (Legal approval) — also completes T5 if it wasn't already, per journey order
    await _cascade_task_completed(db, doc["booking_id"], "T5", current_user["id"], note="Legal approved")
    await _cascade_task_completed(db, doc["booking_id"], "T6", current_user["id"], note="Legal approved")
    return await _enrich(db, after)


@router.post("/legal/{lid}/reject")
async def reject_legal(lid: str, payload: RejectPayload, current_user: dict = Depends(get_current_user)):
    if not _can_manage_legal(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="reason required")
    db = get_db()
    doc = await _get_or_404(db, lid)
    before = dict(doc)
    await db.legal_records.update_one({"id": lid}, {"$set": {
        "status": "Rejected",
        "rejection_reason": payload.reason.strip(),
        "approved_by": None,
        "approved_at": None,
        "updated_at": _now(),
    }})
    after = await db.legal_records.find_one({"id": lid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="legal_record", entity_id=lid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    # Reverse-cascade T5 + T6 if they were completed
    await _reverse_task(db, doc["booking_id"], "T6", current_user["id"], reason=f"Legal rejected: {payload.reason.strip()}")
    await _reverse_task(db, doc["booking_id"], "T5", current_user["id"], reason=f"Legal rejected: {payload.reason.strip()}")
    return await _enrich(db, after)


@router.get("/legal/{lid}/versions")
async def get_legal_versions(lid: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    _ = await _get_or_404(db, lid)
    versions = await db.legal_versions.find({"legal_record_id": lid}, {"_id": 0}).sort("version", -1).to_list(200)
    # Enrich each version with attachment
    for v in versions:
        att = await db.attachments.find_one({"id": v["attachment_id"]}, {"_id": 0}) if v.get("attachment_id") else None
        v["attachment"] = att
    return versions


@router.get("/legal")
async def list_legal(
    status: Optional[str] = None,
    project_id: Optional[str] = None,
    limit: int = Query(500, ge=1, le=2000),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q: dict = {}
    if status:
        q["status"] = status
    # Phase 9 scope
    if not is_all_projects_user(current_user):
        bids = await scoped_booking_ids(current_user)
        if not bids: return []
        q["booking_id"] = {"$in": bids}
    docs = await db.legal_records.find(q, {"_id": 0}).sort("updated_at", -1).to_list(limit)
    booking_ids = list({d["booking_id"] for d in docs})
    bookings = {b["id"]: b async for b in db.bookings.find({"id": {"$in": booking_ids}}, {"_id": 0})}
    if project_id:
        docs = [d for d in docs if bookings.get(d["booking_id"], {}).get("project_id") == project_id]
    cust_ids = list({b["customer_id"] for b in bookings.values() if b.get("customer_id")})
    customers = {c["id"]: c async for c in db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0, "id": 1, "code": 1, "primary_name": 1})}
    proj_ids = list({b["project_id"] for b in bookings.values() if b.get("project_id")})
    projects = {p["id"]: p async for p in db.projects.find({"id": {"$in": proj_ids}}, {"_id": 0, "id": 1, "code": 1, "name": 1})}
    unit_ids = list({b["unit_id"] for b in bookings.values() if b.get("unit_id")})
    units = {u["id"]: u async for u in db.units.find({"id": {"$in": unit_ids}}, {"_id": 0, "id": 1, "code": 1})}
    for d in docs:
        b = bookings.get(d["booking_id"], {})
        d["_booking"] = {"id": b.get("id"), "code": b.get("code")}
        d["_customer"] = customers.get(b.get("customer_id"), {})
        d["_project"] = projects.get(b.get("project_id"), {})
        d["_unit"] = units.get(b.get("unit_id"), {})
        # Lightweight version enrichment for row rendering
        latest = await db.legal_versions.find(
            {"legal_record_id": d["id"]}, {"_id": 0, "version": 1, "uploaded_at": 1}
        ).sort("version", -1).to_list(1)
        d["latest_version"] = latest[0]["version"] if latest else 0
        d["version_count"] = await db.legal_versions.count_documents({"legal_record_id": d["id"]})
        if d.get("latest_draft_attachment_id"):
            att = await db.attachments.find_one(
                {"id": d["latest_draft_attachment_id"]},
                {"_id": 0, "filename": 1, "uploaded_at": 1},
            )
            d["latest_draft"] = att
        else:
            d["latest_draft"] = None
    return docs


@router.get("/legal/counts/pending-approval")
async def count_pending_approval(current_user: dict = Depends(get_current_user)):
    db = get_db()
    n = await db.legal_records.count_documents({"status": {"$in": ["Under Review", "Deviations Raised"]}})
    return {"count": n}
