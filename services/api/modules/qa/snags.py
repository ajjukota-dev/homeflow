"""Snags (Phase 7 — lean).

State machine: Open → Assigned → In Progress → Ready for Verification → Verified/Closed.
Reopen from Verified/Closed → Reopened.
Cascade T12 when ALL Critical snags for a booking are Closed AND T11 is Completed.
Reverse-cascade T12 when a NEW Critical is created OR an existing one is reopened after T12 was Completed.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import (
    get_project_scope, is_all_projects_user, project_id_of_booking,
    require_project_access_soft, scoped_booking_ids, require_module_by_method
)
from kernel.collaboration.collaboration import ALLOWED_UPLOAD_EXTENSIONS, MAX_UPLOAD_BYTES, is_super_admin, user_role_code
from kernel.mongo import get_db, next_sequence, write_audit
from kernel.action.engine_hooks import find_journey_task_by_key, system_complete_task, system_reset_task_to_in_progress
from kernel.files.storage import save_upload_stream


router = APIRouter(prefix="", tags=["snags"], dependencies=[Depends(require_module_by_method("snagging"))])

STORAGE_ROOT = Path(os.environ.get("ATTACHMENT_STORAGE_ROOT", "/app/backend/storage"))
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)

ROOMS = {"Living", "Kitchen", "Master Bedroom", "Bedroom 2", "Bedroom 3", "Bathroom 1", "Bathroom 2", "Utility", "Balcony", "Common", "Other"}
CATEGORIES = {"Civil", "Electrical", "Plumbing", "Painting", "Flooring", "Fittings", "Cleaning", "Other"}
SEVERITIES = {"Critical", "Major", "Minor"}
STATUSES = {"Open", "Assigned", "In Progress", "Ready for Verification", "Verified", "Closed", "Reopened"}


def _now() -> str: return datetime.now(timezone.utc).isoformat()
def _uid() -> str: return str(uuid.uuid4())


def _can_qa(user: dict) -> bool:
    return is_super_admin(user) or user_role_code(user) in {"QA", "SITE", "MANAGEMENT"}


def _can_verify(user: dict) -> bool:
    return is_super_admin(user) or user_role_code(user) in {"QA", "MANAGEMENT"}


def _can_reopen(user: dict) -> bool:
    return is_super_admin(user) or user_role_code(user) in {"QA", "HANDOVER", "MANAGEMENT"}


async def _find_journey_id(db, booking_id: str) -> Optional[str]:
    j = await db.customer_journeys.find_one(
        {"booking_id": booking_id, "status": {"$in": ["Active", "OnHold", "Closed"]}},
        {"_id": 0, "id": 1},
    )
    return (j or {}).get("id")


async def _sync_t12_for_booking(db, booking_id: str, actor_id: str, trigger: str) -> None:
    """After any snag state change, keep T12 in sync with the "all critical closed" rule.

    - If ALL Critical snags are Closed AND T11 is Completed AND T12 is not Completed → complete T12.
    - If T12 is Completed AND any Critical snag is now NOT Closed → reverse T12.
    """
    jid = await _find_journey_id(db, booking_id)
    if not jid:
        return
    t11 = await find_journey_task_by_key(jid, "T11")
    t12 = await find_journey_task_by_key(jid, "T12")
    if not t12:
        return
    criticals = await db.snags.find(
        {"booking_id": booking_id, "severity": "Critical"}, {"_id": 0, "status": 1},
    ).to_list(500)
    all_closed = all(s["status"] == "Closed" for s in criticals) if criticals else True
    if all_closed and (t11 and t11["status"] == "Completed") and t12["status"] != "Completed":
        await system_complete_task(t12["id"], actor_id, note=f"All critical snags closed ({trigger})")
    elif not all_closed and t12["status"] == "Completed":
        await system_reset_task_to_in_progress(t12["id"], actor_id, reason=f"Critical snag re-emerged ({trigger})")


class SnagCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    booking_id: str
    room: str
    category: str
    description: str
    severity: str
    contractor_name: Optional[str] = None
    due_date: Optional[str] = None


class SnagUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    description: Optional[str] = None
    room: Optional[str] = None
    category: Optional[str] = None
    severity: Optional[str] = None
    contractor_name: Optional[str] = None
    due_date: Optional[str] = None


class AssignPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    owner_user_id: str


class VerifyPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    decision: str  # "Verified" | "Rejected"
    notes: Optional[str] = None


class ReasonPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str


async def _get_or_404(db, sid: str) -> dict:
    doc = await db.snags.find_one({"id": sid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Snag not found")
    return doc


async def _upload_attachment(file: UploadFile, entity_id: str, user_id: str, tag: str) -> dict:
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
            "entity_type": "snag",
            "entity_id": entity_id,
        },
    )
    att = {
        "id": attachment_id, "entity_type": "snag", "entity_id": entity_id, "comment_id": None,
        "filename": filename, "storage_path": None,
        "gridfs_file_id": gridfs_id, "storage_backend": "gridfs", "file_missing": False,
        "mime_type": content_type, "size_bytes": size,
        "category": "Snag", "version": 1, "visibility": "Internal", "description": tag,
        "uploaded_by": user_id, "uploaded_at": _now(),
        "verification_status": "Uploaded", "verified_by": None, "verified_at": None,
        "verification_notes": None, "deleted_at": None,
    }
    await db.attachments.insert_one(att)
    att.pop("_id", None)
    return att


@router.post("/snags")
async def create_snag(
    booking_id: str = Form(...),
    room: str = Form(...),
    category: str = Form(...),
    description: str = Form(...),
    severity: str = Form(...),
    contractor_name: Optional[str] = Form(None),
    due_date: Optional[str] = Form(None),
    before_photo: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user),
):
    if not _can_qa(current_user):
        raise HTTPException(status_code=403, detail="Only QA / Site / Super Admin can create snags")
    if room not in ROOMS: raise HTTPException(status_code=400, detail=f"Invalid room: {room}")
    if category not in CATEGORIES: raise HTTPException(status_code=400, detail=f"Invalid category: {category}")
    if severity not in SEVERITIES: raise HTTPException(status_code=400, detail=f"Invalid severity: {severity}")
    if not description.strip():
        raise HTTPException(status_code=400, detail="description required")
    db = get_db()
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    before_photo_id = None
    sid = _uid()
    if before_photo and before_photo.filename:
        att = await _upload_attachment(before_photo, sid, current_user["id"], "before")
        before_photo_id = att["id"]

    seq = await next_sequence("snag")
    now = _now()
    doc = {
        "id": sid,
        "code": f"SNG-{seq:06d}",
        "booking_id": booking_id,
        "unit_id": booking["unit_id"],
        "room": room, "category": category, "severity": severity,
        "description": description.strip(),
        "before_photo_attachment_id": before_photo_id,
        "after_photo_attachment_id": None,
        "owner_user_id": None,
        "contractor_name": (contractor_name or "").strip() or None,
        "due_date": due_date or None,
        "status": "Open",
        "verified_by": None,
        "closed_date": None,
        "reopen_reason": None,
        "created_by": current_user["id"],
        "created_at": now,
        "updated_at": now,
    }
    await db.snags.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user_id=current_user["id"], entity_type="snag", entity_id=sid,
                      action="create", after=doc,
                      parent_entity_type="booking", parent_entity_id=booking_id)
    # New Critical snag may reverse T12 if already completed
    if severity == "Critical":
        await _sync_t12_for_booking(db, booking_id, current_user["id"], trigger="new critical")
    return doc


@router.get("/snags")
async def list_snags(
    booking_id: Optional[str] = None,
    severity: Optional[str] = None,
    status: Optional[str] = None,
    project_id: Optional[str] = None,
    limit: int = Query(500, ge=1, le=2000),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q: dict = {}
    if booking_id: q["booking_id"] = booking_id
    if severity: q["severity"] = severity
    if status: q["status"] = status
    # Phase 9 scope
    if not is_all_projects_user(current_user):
        bids = await scoped_booking_ids(current_user)
        if not bids: return []
        if "booking_id" in q:
            if q["booking_id"] not in bids: return []
        else:
            q["booking_id"] = {"$in": bids}
    docs = await db.snags.find(q, {"_id": 0}).sort("updated_at", -1).to_list(limit)
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
    owner_ids = list({d["owner_user_id"] for d in docs if d.get("owner_user_id")})
    owners = {u["id"]: u async for u in db.users.find({"id": {"$in": owner_ids}}, {"_id": 0, "id": 1, "name": 1})}
    for d in docs:
        b = bookings.get(d["booking_id"], {})
        d["_booking"] = {"id": b.get("id"), "code": b.get("code")}
        d["_customer"] = customers.get(b.get("customer_id"), {})
        d["_project"] = projects.get(b.get("project_id"), {})
        d["_unit"] = units.get(b.get("unit_id"), {})
        d["_owner"] = owners.get(d.get("owner_user_id"), {}) if d.get("owner_user_id") else None
    return docs


@router.get("/snags/{sid}")
async def get_snag(sid: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await _get_or_404(db, sid)
    pid = await project_id_of_booking(doc["booking_id"])
    await require_project_access_soft(current_user, pid)
    # attach photos
    before = await db.attachments.find_one({"id": doc.get("before_photo_attachment_id")}, {"_id": 0}) if doc.get("before_photo_attachment_id") else None
    after = await db.attachments.find_one({"id": doc.get("after_photo_attachment_id")}, {"_id": 0}) if doc.get("after_photo_attachment_id") else None
    doc["_before_photo"] = before
    doc["_after_photo"] = after
    return doc


@router.patch("/snags/{sid}")
async def update_snag(sid: str, payload: SnagUpdate, current_user: dict = Depends(get_current_user)):
    if not _can_qa(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, sid)
    if doc["status"] in ("Verified", "Closed"):
        raise HTTPException(status_code=400, detail="Cannot edit a Verified/Closed snag. Reopen first.")
    changes = payload.model_dump(exclude_unset=True)
    if "room" in changes and changes["room"] not in ROOMS:
        raise HTTPException(status_code=400, detail=f"Invalid room: {changes['room']}")
    if "category" in changes and changes["category"] not in CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category: {changes['category']}")
    if "severity" in changes and changes["severity"] not in SEVERITIES:
        raise HTTPException(status_code=400, detail=f"Invalid severity: {changes['severity']}")
    if not changes:
        return doc
    changes["updated_at"] = _now()
    before = dict(doc)
    await db.snags.update_one({"id": sid}, {"$set": changes})
    after = await db.snags.find_one({"id": sid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="snag", entity_id=sid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    # Severity may have flipped Critical <-> non-Critical
    if changes.get("severity") and (before["severity"] == "Critical" or changes["severity"] == "Critical"):
        await _sync_t12_for_booking(db, doc["booking_id"], current_user["id"], trigger="severity change")
    return after


@router.post("/snags/{sid}/assign")
async def assign_snag(sid: str, payload: AssignPayload, current_user: dict = Depends(get_current_user)):
    if not _can_qa(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, sid)
    if doc["status"] not in ("Open", "Assigned", "Reopened"):
        raise HTTPException(status_code=400, detail=f"Cannot assign from status {doc['status']}")
    user = await db.users.find_one({"id": payload.owner_user_id, "active": True}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=400, detail="Invalid owner")
    before = dict(doc)
    await db.snags.update_one({"id": sid}, {"$set": {"owner_user_id": payload.owner_user_id, "status": "Assigned", "updated_at": _now()}})
    after = await db.snags.find_one({"id": sid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="snag", entity_id=sid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return after


@router.post("/snags/{sid}/start")
async def start_snag(sid: str, current_user: dict = Depends(get_current_user)):
    if not _can_qa(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, sid)
    if doc["status"] not in ("Assigned", "Reopened"):
        raise HTTPException(status_code=400, detail=f"Cannot start from status {doc['status']}")
    before = dict(doc)
    await db.snags.update_one({"id": sid}, {"$set": {"status": "In Progress", "updated_at": _now()}})
    after = await db.snags.find_one({"id": sid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="snag", entity_id=sid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return after


@router.post("/snags/{sid}/upload-after-photo")
async def upload_after_photo(sid: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    if not _can_qa(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, sid)
    if doc["status"] in ("Verified", "Closed"):
        raise HTTPException(status_code=400, detail="Cannot upload after-photo on Verified/Closed snag")
    att = await _upload_attachment(file, sid, current_user["id"], "after")
    before = dict(doc)
    await db.snags.update_one({"id": sid}, {"$set": {"after_photo_attachment_id": att["id"], "updated_at": _now()}})
    after = await db.snags.find_one({"id": sid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="snag", entity_id=sid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return {"attachment": att, "snag": after}


@router.post("/snags/{sid}/submit-for-verification")
async def submit_for_verification(sid: str, current_user: dict = Depends(get_current_user)):
    if not _can_qa(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, sid)
    if doc["status"] != "In Progress":
        raise HTTPException(status_code=400, detail=f"Cannot submit for verification from status {doc['status']}")
    if not doc.get("after_photo_attachment_id"):
        raise HTTPException(status_code=400, detail="Cannot submit for verification: after-photo required")
    before = dict(doc)
    await db.snags.update_one({"id": sid}, {"$set": {"status": "Ready for Verification", "updated_at": _now()}})
    after = await db.snags.find_one({"id": sid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="snag", entity_id=sid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return after


@router.post("/snags/{sid}/verify")
async def verify_snag(sid: str, payload: VerifyPayload, current_user: dict = Depends(get_current_user)):
    if not _can_verify(current_user):
        raise HTTPException(status_code=403, detail="Only QA / Super Admin can verify snags")
    if payload.decision not in ("Verified", "Rejected"):
        raise HTTPException(status_code=400, detail="decision must be Verified or Rejected")
    db = get_db()
    doc = await _get_or_404(db, sid)
    if doc["status"] != "Ready for Verification":
        raise HTTPException(status_code=400, detail=f"Cannot verify from status {doc['status']}")
    now = _now()
    before = dict(doc)
    if payload.decision == "Verified":
        updates = {"status": "Closed", "verified_by": current_user["id"], "closed_date": now, "updated_at": now}
    else:
        updates = {"status": "In Progress", "updated_at": now}
    await db.snags.update_one({"id": sid}, {"$set": updates})
    after = await db.snags.find_one({"id": sid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="snag", entity_id=sid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    await _sync_t12_for_booking(db, doc["booking_id"], current_user["id"], trigger=f"snag {payload.decision.lower()}")
    return after


@router.post("/snags/{sid}/reopen")
async def reopen_snag(sid: str, payload: ReasonPayload, current_user: dict = Depends(get_current_user)):
    if not _can_reopen(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="reason required")
    db = get_db()
    doc = await _get_or_404(db, sid)
    if doc["status"] not in ("Verified", "Closed"):
        raise HTTPException(status_code=400, detail=f"Cannot reopen from status {doc['status']}")
    before = dict(doc)
    await db.snags.update_one({"id": sid}, {"$set": {
        "status": "Reopened",
        "reopen_reason": payload.reason.strip(),
        "closed_date": None,
        "updated_at": _now(),
    }})
    after = await db.snags.find_one({"id": sid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="snag", entity_id=sid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    await _sync_t12_for_booking(db, doc["booking_id"], current_user["id"], trigger="snag reopened")
    return after


@router.delete("/snags/{sid}")
async def delete_snag(sid: str, current_user: dict = Depends(get_current_user)):
    if not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only Super Admin can delete snags")
    db = get_db()
    doc = await _get_or_404(db, sid)
    if doc["status"] != "Open":
        raise HTTPException(status_code=400, detail="Can only delete Open snags")
    await db.snags.delete_one({"id": sid})
    await write_audit(user_id=current_user["id"], entity_type="snag", entity_id=sid,
                      action="delete", before=doc,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return {"ok": True}


@router.get("/snags/counts/critical-open")
async def count_critical_open(current_user: dict = Depends(get_current_user)):
    db = get_db()
    n = await db.snags.count_documents({"severity": "Critical", "status": {"$nin": ["Closed"]}})
    return {"count": n}


@router.get("/snags/counts/awaiting-verification")
async def count_awaiting_verification(current_user: dict = Depends(get_current_user)):
    db = get_db()
    n = await db.snags.count_documents({"status": "Ready for Verification"})
    return {"count": n}
