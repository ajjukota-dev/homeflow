"""Financial Clearance API — Accounts approves the booking's financial readiness.

The approved record becomes the Registration gate consumed in Phase 6.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import (
    get_project_scope, is_all_projects_user, project_id_of_booking,
    require_project_access_soft, require_module_by_method
)
from kernel.collaboration.collaboration import is_super_admin, user_role_code
from kernel.mongo import get_db, write_audit


router = APIRouter(prefix="/financial-clearances", tags=["financial-clearances"], dependencies=[Depends(require_module_by_method("collections"))])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_checklist() -> dict:
    return {
        "ledger_reconciled": False,
        "due_amounts_paid": False,
        "tds_verified": False,
        "bank_disbursement_received": False,
        "bank_disbursement_applicable": False,
        "other_charges_cleared": False,
        "exceptions_approved": True,
    }


def _can_manage(user: dict) -> bool:
    return is_super_admin(user) or user_role_code(user) in {"ACCOUNTS", "MANAGEMENT"}


class ChecklistPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    ledger_reconciled: Optional[bool] = None
    due_amounts_paid: Optional[bool] = None
    tds_verified: Optional[bool] = None
    bank_disbursement_received: Optional[bool] = None
    bank_disbursement_applicable: Optional[bool] = None
    other_charges_cleared: Optional[bool] = None
    exceptions_approved: Optional[bool] = None
    notes: Optional[str] = None


class ReasonPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str


async def _autocreate(db, booking: dict, actor_id: str) -> dict:
    doc = {
        "id": str(uuid.uuid4()),
        "booking_id": booking["id"],
        "checklist": _default_checklist(),
        "status": "Pending",
        "approved_by": None,
        "approved_at": None,
        "rejection_reason": None,
        "notes": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.financial_clearances.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user_id=actor_id, entity_type="financial_clearance", entity_id=doc["id"],
                      action="create", after=doc, parent_entity_type="booking", parent_entity_id=booking["id"])
    return doc


@router.get("/booking/{booking_id}")
async def get_by_booking(booking_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b["status"] != "Confirmed":
        raise HTTPException(status_code=404, detail="Financial clearance only for Confirmed bookings")
    await require_project_access_soft(current_user, b.get("project_id"))
    doc = await db.financial_clearances.find_one({"booking_id": booking_id}, {"_id": 0})
    if not doc:
        doc = await _autocreate(db, b, current_user["id"])
    return doc


@router.patch("/{fid}/checklist")
async def patch_checklist(fid: str, payload: ChecklistPatch, current_user: dict = Depends(get_current_user)):
    if not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="Only Accounts / Super Admin can edit FC checklist")
    db = get_db()
    doc = await db.financial_clearances.find_one({"id": fid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Financial clearance not found")
    if doc["status"] == "Approved":
        raise HTTPException(status_code=400, detail="Cannot edit an Approved financial clearance")
    changes = payload.model_dump(exclude_unset=True)
    notes = changes.pop("notes", None)
    checklist = dict(doc.get("checklist") or _default_checklist())

    # Invariant: tds_verified can only be set true when TDS is Verified OR Not Applicable
    if changes.get("tds_verified") is True:
        tds = await db.tds_records.find_one({"booking_id": doc["booking_id"]}, {"_id": 0})
        tds_ok = tds and (tds.get("verification_status") == "Verified" or tds.get("applicability") == "Not Applicable")
        if not tds_ok:
            raise HTTPException(
                status_code=400,
                detail="Cannot mark tds_verified=true — the booking's TDS record is neither Verified nor Not Applicable",
            )

    checklist.update(changes)
    before = dict(doc)
    await db.financial_clearances.update_one({"id": fid}, {"$set": {
        "checklist": checklist,
        "notes": notes if notes is not None else doc.get("notes"),
        "updated_at": _now(),
    }})
    after = await db.financial_clearances.find_one({"id": fid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="financial_clearance", entity_id=fid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return after


@router.post("/{fid}/approve")
async def approve(fid: str, current_user: dict = Depends(get_current_user)):
    if not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="Only Accounts / Super Admin can approve FC")
    db = get_db()
    doc = await db.financial_clearances.find_one({"id": fid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Financial clearance not found")
    if doc["status"] == "Approved":
        return doc

    checklist = dict(doc.get("checklist") or {})
    # Bank disbursement checks skipped if not applicable
    bank_applicable = bool(checklist.get("bank_disbursement_applicable"))
    required_true_keys = ["ledger_reconciled", "due_amounts_paid", "tds_verified", "other_charges_cleared", "exceptions_approved"]
    if bank_applicable:
        required_true_keys.append("bank_disbursement_received")

    unmet: list[str] = [k for k in required_true_keys if not checklist.get(k)]
    if unmet:
        raise HTTPException(status_code=400, detail={"message": "Checklist incomplete", "unmet": unmet})

    now = _now()
    before = dict(doc)
    await db.financial_clearances.update_one({"id": fid}, {"$set": {
        "status": "Approved",
        "approved_by": current_user["id"],
        "approved_at": now,
        "rejection_reason": None,
        "updated_at": now,
    }})
    after = await db.financial_clearances.find_one({"id": fid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="financial_clearance", entity_id=fid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return after


@router.post("/{fid}/reject")
async def reject(fid: str, payload: ReasonPayload, current_user: dict = Depends(get_current_user)):
    if not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="Only Accounts / Super Admin can reject FC")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Reason required")
    db = get_db()
    doc = await db.financial_clearances.find_one({"id": fid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Financial clearance not found")
    now = _now()
    before = dict(doc)
    await db.financial_clearances.update_one({"id": fid}, {"$set": {
        "status": "Rejected",
        "rejection_reason": payload.reason.strip(),
        "updated_at": now,
    }})
    after = await db.financial_clearances.find_one({"id": fid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="financial_clearance", entity_id=fid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return after


@router.get("/counts/pending")
async def counts_pending(current_user: dict = Depends(get_current_user)):
    db = get_db()
    n = await db.financial_clearances.count_documents({"status": "Pending"})
    return {"count": n}
