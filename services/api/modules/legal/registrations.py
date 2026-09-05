"""Registration record (Phase 6 — lean).

One registration per booking. Auto-created on first GET for a Confirmed booking.
Confirm-availability requires T6 (Legal approval) complete → cascade T9.
Book-slot requires T6 + T8 + FC Approved + registration status=Availability Confirmed → cascade T10.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone, timedelta
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
from kernel.collaboration.collaboration import (
    ALLOWED_UPLOAD_EXTENSIONS,
    MAX_UPLOAD_BYTES,
    is_super_admin,
    user_role_code,
)
from kernel.mongo import get_db, write_audit
from kernel.action.engine_hooks import find_journey_task_by_key, system_complete_task
from kernel.files.storage import save_upload_stream


router = APIRouter(prefix="", tags=["registrations"], dependencies=[Depends(require_module_by_method("registrations"))])

STORAGE_ROOT = Path(os.environ.get("ATTACHMENT_STORAGE_ROOT", "/app/backend/storage"))
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid() -> str:
    return str(uuid.uuid4())


def _can_confirm(user: dict) -> bool:
    return is_super_admin(user) or user_role_code(user) in {"CRM", "REGISTRATION", "MANAGEMENT"}


def _can_book_slot(user: dict) -> bool:
    return is_super_admin(user) or user_role_code(user) in {"REGISTRATION", "MANAGEMENT"}


class RegUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    sro_office: Optional[str] = None
    preferred_dates: Optional[list[str]] = None
    outcome_notes: Optional[str] = None


class ConfirmAvailabilityPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    confirmed_date: str


class BookSlotPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    slot_date: str
    slot_time: str
    sro_office: str
    slot_reference_no: str
    attachment_id: Optional[str] = None


class MarkExecutedPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    executed_date: str
    registration_document_number: str
    company_representative: str
    customer_attendees: Optional[list[str]] = None
    outcome_notes: Optional[str] = None


async def _get_or_404(db, rid: str) -> dict:
    doc = await db.registrations.find_one({"id": rid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Registration not found")
    return doc


async def _find_journey_id_for_booking(db, booking_id: str) -> Optional[str]:
    j = await db.customer_journeys.find_one(
        {"booking_id": booking_id, "status": {"$in": ["Active", "OnHold", "Closed"]}},
        {"_id": 0, "id": 1},
    )
    return (j or {}).get("id")


async def _task_by_key(db, booking_id: str, key: str) -> Optional[dict]:
    jid = await _find_journey_id_for_booking(db, booking_id)
    if not jid:
        return None
    return await find_journey_task_by_key(jid, key)


async def _cascade_complete(db, booking_id: str, key: str, actor_id: str, note: str) -> None:
    t = await _task_by_key(db, booking_id, key)
    if t:
        await system_complete_task(t["id"], actor_id, note=note)


async def _readiness(db, booking_id: str) -> dict:
    """Compute the 4 readiness gates for slot booking."""
    t6 = await _task_by_key(db, booking_id, "T6")
    t8 = await _task_by_key(db, booking_id, "T8")
    fc = await db.financial_clearances.find_one({"booking_id": booking_id}, {"_id": 0})
    tds = await db.tds_records.find_one({"booking_id": booking_id}, {"_id": 0})

    legal_ready = bool(t6) and t6["status"] == "Completed"
    # TDS ready when applicability=Not Applicable OR T8 completed OR verification=Verified
    tds_ready = False
    if tds:
        if tds.get("applicability") == "Not Applicable":
            tds_ready = True
        elif tds.get("verification_status") == "Verified":
            tds_ready = True
    if not tds_ready and t8 and t8["status"] == "Completed":
        tds_ready = True
    fc_ready = bool(fc) and fc.get("status") == "Approved"

    return {
        "legal_ready": legal_ready,
        "tds_ready": tds_ready,
        "fc_ready": fc_ready,
        "legal_status": t6["status"] if t6 else "Missing",
        "tds_status": (tds or {}).get("applicability", "Not Determined"),
        "tds_verification": (tds or {}).get("verification_status", "Pending"),
        "fc_status": (fc or {}).get("status", "Missing"),
    }


async def _enrich(db, doc: dict) -> dict:
    doc = dict(doc)
    doc["readiness"] = await _readiness(db, doc["booking_id"])
    return doc


# ---------------- Endpoints ----------------

@router.get("/registrations/booking/{booking_id}")
async def get_reg_for_booking(booking_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking["status"] != "Confirmed":
        raise HTTPException(status_code=404, detail="Registration only for Confirmed bookings")
    await require_project_access_soft(current_user, booking.get("project_id"))
    doc = await db.registrations.find_one({"booking_id": booking_id}, {"_id": 0})
    if not doc:
        doc = {
            "id": _uid(),
            "booking_id": booking_id,
            "sro_office": None,
            "preferred_dates": [],
            "confirmed_date": None,
            "slot_date": None,
            "slot_time": None,
            "slot_reference_no": None,
            "slot_confirmation_attachment_id": None,
            "status": "Not Started",
            "executed_date": None,
            "registration_document_number": None,
            "registered_sale_deed_attachment_id": None,
            "company_representative": None,
            "customer_attendees": [],
            "outcome_notes": None,
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.registrations.insert_one(doc)
        doc.pop("_id", None)
        await write_audit(user_id=current_user["id"], entity_type="registration", entity_id=doc["id"],
                          action="create", after=doc,
                          parent_entity_type="booking", parent_entity_id=booking_id)
    return await _enrich(db, doc)


@router.patch("/registrations/{rid}")
async def update_reg(rid: str, payload: RegUpdate, current_user: dict = Depends(get_current_user)):
    if not _can_confirm(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, rid)
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return await _enrich(db, doc)
    changes["updated_at"] = _now()
    before = dict(doc)
    await db.registrations.update_one({"id": rid}, {"$set": changes})
    after = await db.registrations.find_one({"id": rid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="registration", entity_id=rid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return await _enrich(db, after)


@router.post("/registrations/{rid}/confirm-availability")
async def confirm_availability(rid: str, payload: ConfirmAvailabilityPayload, current_user: dict = Depends(get_current_user)):
    if not _can_confirm(current_user):
        raise HTTPException(status_code=403, detail="Only CRM / Registration / Super Admin can confirm availability")
    db = get_db()
    doc = await _get_or_404(db, rid)
    if doc["status"] not in ("Not Started", "Availability Confirmed"):
        raise HTTPException(status_code=400, detail=f"Cannot confirm from status '{doc['status']}'")
    t6 = await _task_by_key(db, doc["booking_id"], "T6")
    if not t6 or t6["status"] != "Completed":
        raise HTTPException(status_code=400, detail="Legal approval required before confirming registration availability")
    before = dict(doc)
    await db.registrations.update_one({"id": rid}, {"$set": {
        "status": "Availability Confirmed",
        "confirmed_date": payload.confirmed_date,
        "updated_at": _now(),
    }})
    after = await db.registrations.find_one({"id": rid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="registration", entity_id=rid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    await _cascade_complete(db, doc["booking_id"], "T9", current_user["id"], note="Customer availability confirmed")
    return await _enrich(db, after)


@router.post("/registrations/{rid}/book-slot")
async def book_slot(rid: str, payload: BookSlotPayload, current_user: dict = Depends(get_current_user)):
    if not _can_book_slot(current_user):
        raise HTTPException(status_code=403, detail="Only Registration / Super Admin can book slots")
    db = get_db()
    doc = await _get_or_404(db, rid)
    if doc["status"] not in ("Availability Confirmed", "Slot Booked"):
        raise HTTPException(status_code=400, detail=f"Cannot book slot from status '{doc['status']}'")

    # Preconditions
    missing: list[str] = []
    t6 = await _task_by_key(db, doc["booking_id"], "T6")
    if not t6 or t6["status"] != "Completed":
        missing.append("Legal approval (T6) not complete")
    t8 = await _task_by_key(db, doc["booking_id"], "T8")
    tds = await db.tds_records.find_one({"booking_id": doc["booking_id"]}, {"_id": 0})
    tds_ok = False
    if tds and tds.get("applicability") == "Not Applicable":
        tds_ok = True
    elif tds and tds.get("verification_status") == "Verified":
        tds_ok = True
    elif t8 and t8["status"] == "Completed":
        tds_ok = True
    if not tds_ok:
        missing.append("TDS not verified (or not marked Not Applicable)")
    if doc["status"] != "Availability Confirmed":
        # Only true if slot already booked (allowed above), otherwise missing
        if doc["status"] != "Slot Booked":
            missing.append("Customer availability not confirmed")
    fc = await db.financial_clearances.find_one({"booking_id": doc["booking_id"]}, {"_id": 0})
    if not fc or fc.get("status") != "Approved":
        missing.append("Financial clearance not approved")

    if missing:
        raise HTTPException(status_code=400, detail=f"Cannot book slot: {'; '.join(missing)}")

    before = dict(doc)
    await db.registrations.update_one({"id": rid}, {"$set": {
        "status": "Slot Booked",
        "slot_date": payload.slot_date,
        "slot_time": payload.slot_time,
        "sro_office": payload.sro_office,
        "slot_reference_no": payload.slot_reference_no,
        "slot_confirmation_attachment_id": payload.attachment_id,
        "updated_at": _now(),
    }})
    after = await db.registrations.find_one({"id": rid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="registration", entity_id=rid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    await _cascade_complete(db, doc["booking_id"], "T10", current_user["id"], note="SRO slot booked")
    return await _enrich(db, after)


@router.post("/registrations/{rid}/mark-executed")
async def mark_executed(rid: str, payload: MarkExecutedPayload, current_user: dict = Depends(get_current_user)):
    if not _can_book_slot(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, rid)
    if doc["status"] != "Slot Booked":
        raise HTTPException(status_code=400, detail=f"Cannot mark executed from status '{doc['status']}'")
    before = dict(doc)
    await db.registrations.update_one({"id": rid}, {"$set": {
        "status": "Executed",
        "executed_date": payload.executed_date,
        "registration_document_number": payload.registration_document_number,
        "company_representative": payload.company_representative,
        "customer_attendees": payload.customer_attendees or [],
        "outcome_notes": (payload.outcome_notes or "").strip() or None,
        "updated_at": _now(),
    }})
    after = await db.registrations.find_one({"id": rid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="registration", entity_id=rid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return await _enrich(db, after)


@router.post("/registrations/{rid}/upload-registered-deed")
async def upload_registered_deed(rid: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    if not _can_book_slot(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, rid)
    if doc["status"] != "Executed":
        raise HTTPException(status_code=400, detail=f"Registration must be Executed to upload deed (currently {doc['status']})")

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
            "uploaded_by": current_user["id"],
            "entity_type": "registration",
            "entity_id": rid,
        },
    )
    att = {
        "id": attachment_id,
        "entity_type": "registration",
        "entity_id": rid,
        "comment_id": None,
        "filename": filename,
        "storage_path": None,
        "gridfs_file_id": gridfs_id,
        "storage_backend": "gridfs",
        "file_missing": False,
        "mime_type": content_type,
        "size_bytes": size,
        "category": "Registration",
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
    await db.attachments.insert_one(att)

    before = dict(doc)
    await db.registrations.update_one({"id": rid}, {"$set": {
        "status": "Closed",
        "registered_sale_deed_attachment_id": att["id"],
        "updated_at": _now(),
    }})
    after = await db.registrations.find_one({"id": rid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="registration", entity_id=rid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return await _enrich(db, after)


@router.get("/registrations")
async def list_registrations(
    status: Optional[str] = None,
    project_id: Optional[str] = None,
    this_month: bool = False,
    blocked: bool = False,
    limit: int = Query(500, ge=1, le=2000),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q: dict = {}
    if status:
        q["status"] = status
    if this_month:
        now = datetime.now(timezone.utc)
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
        # First day next month
        if now.month == 12:
            nm = now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        else:
            nm = now.replace(month=now.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
        end = nm.isoformat()
        q["slot_date"] = {"$gte": start, "$lt": end}

    docs = await db.registrations.find(q, {"_id": 0}).sort("updated_at", -1).to_list(limit)
    # Phase 9 scope
    if not is_all_projects_user(current_user):
        bids = await scoped_booking_ids(current_user)
        if not bids: return []
        docs = [d for d in docs if d.get("booking_id") in set(bids)]
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

    out: list[dict] = []
    for d in docs:
        b = bookings.get(d["booking_id"], {})
        d["_booking"] = {"id": b.get("id"), "code": b.get("code")}
        d["_customer"] = customers.get(b.get("customer_id"), {})
        d["_project"] = projects.get(b.get("project_id"), {})
        d["_unit"] = units.get(b.get("unit_id"), {})
        r = await _readiness(db, d["booking_id"])
        d["readiness"] = r
        is_blocked = d["status"] == "Not Started" and (not r["legal_ready"] or not r["tds_ready"] or not r["fc_ready"])
        d["is_blocked"] = is_blocked
        if blocked and not is_blocked:
            continue
        out.append(d)
    return out


@router.get("/registrations/counts/this-month")
async def count_this_month(current_user: dict = Depends(get_current_user)):
    db = get_db()
    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    if now.month == 12:
        nm = now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        nm = now.replace(month=now.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
    end = nm.isoformat()
    n = await db.registrations.count_documents({"slot_date": {"$gte": start, "$lt": end}})
    return {"count": n}


@router.get("/registrations/counts/blocked")
async def count_blocked(current_user: dict = Depends(get_current_user)):
    db = get_db()
    docs = await db.registrations.find({"status": "Not Started"}, {"_id": 0, "booking_id": 1}).to_list(2000)
    n = 0
    for d in docs:
        r = await _readiness(db, d["booking_id"])
        if not r["legal_ready"] or not r["tds_ready"] or not r["fc_ready"]:
            n += 1
    return {"count": n}
