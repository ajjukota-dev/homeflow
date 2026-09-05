"""Loan case + loan events API (Phase 6 — lean).

One loan_case per booking (opt-in). loan_events is an append-only ledger of
lifecycle transitions (application submitted, sanction, disbursements, blockers).

Creating a loan_case sets financial_clearance.bank_disbursement_applicable=true
on the linked booking's FC record so the Approvals checklist correctly demands
disbursement before releasing the Registration gate.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import (
    get_project_scope, is_all_projects_user, project_id_of_booking,
    require_project_access_soft, scoped_booking_ids, require_module_by_method
)
from kernel.collaboration.collaboration import is_super_admin, user_role_code
from kernel.mongo import get_db, write_audit
from kernel.identity.rbac_redact import redact_financial_amounts


router = APIRouter(prefix="", tags=["loans"], dependencies=[Depends(require_module_by_method("loans"))])

ALLOWED_STAGES = {
    "Application", "Sanction Pending", "Sanctioned",
    "Disbursement Pending", "Partially Disbursed", "Fully Disbursed",
    "Closed", "Rejected",
}
ALLOWED_EVENT_TYPES = {
    "Application Submitted", "Sanctioned", "Disbursement Requested",
    "Disbursed", "Rejected", "Cancelled", "Blocker Recorded", "Blocker Resolved",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid() -> str:
    return str(uuid.uuid4())


def _can_manage_loan(user: dict) -> bool:
    """Banking / Accounts / Management / Super Admin can manage loans."""
    return is_super_admin(user) or user_role_code(user) in {"BANKING", "ACCOUNTS", "MANAGEMENT"}


class LoanCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    booking_id: str
    bank_name: str
    bank_branch: Optional[str] = None
    bank_rm_name: Optional[str] = None
    bank_rm_contact: Optional[str] = None
    requested_amount_inr: float
    notes: Optional[str] = None


class LoanUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    bank_name: Optional[str] = None
    bank_branch: Optional[str] = None
    bank_rm_name: Optional[str] = None
    bank_rm_contact: Optional[str] = None
    requested_amount_inr: Optional[float] = None
    blocker: Optional[str] = None
    notes: Optional[str] = None


class SanctionPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    sanctioned_amount_inr: float
    sanction_date: str
    sanction_validity_date: Optional[str] = None
    attachment_id: Optional[str] = None
    notes: Optional[str] = None


class DisbursementPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    amount_inr: float
    event_date: str
    reference_no: Optional[str] = None
    attachment_id: Optional[str] = None
    notes: Optional[str] = None


class BlockerPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    blocker_text: str


class ReasonPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str


async def _get_or_404(db, lid: str) -> dict:
    doc = await db.loan_cases.find_one({"id": lid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Loan case not found")
    return doc


async def _append_event(db, loan_case_id: str, actor_id: str, event_type: str,
                        event_date: Optional[str] = None, amount_inr: Optional[float] = None,
                        reference_no: Optional[str] = None, attachment_id: Optional[str] = None,
                        notes: Optional[str] = None, parent_booking_id: Optional[str] = None) -> dict:
    if event_type not in ALLOWED_EVENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid event_type '{event_type}'")
    eid = _uid()
    now = _now()
    doc = {
        "id": eid,
        "loan_case_id": loan_case_id,
        "event_type": event_type,
        "event_date": event_date or now,
        "amount_inr": amount_inr,
        "reference_no": reference_no,
        "attachment_id": attachment_id,
        "notes": notes,
        "recorded_by": actor_id,
        "recorded_at": now,
    }
    await db.loan_events.insert_one(doc)
    await write_audit(user_id=actor_id, entity_type="loan_event", entity_id=eid,
                      action="create", after=doc,
                      parent_entity_type="loan_case", parent_entity_id=loan_case_id)
    doc.pop("_id", None)
    return doc


async def _enrich(db, doc: dict) -> dict:
    doc = dict(doc)
    events = await db.loan_events.find({"loan_case_id": doc["id"]}, {"_id": 0}).sort("recorded_at", 1).to_list(500)
    doc["events"] = events
    # Cumulative disbursed
    disbursed = sum(e.get("amount_inr") or 0 for e in events if e["event_type"] == "Disbursed")
    doc["disbursed_amount_inr"] = round(disbursed, 2)
    return doc


async def _flip_fc_bank_applicable(db, booking_id: str, applicable: bool, actor_id: str) -> None:
    fc = await db.financial_clearances.find_one({"booking_id": booking_id}, {"_id": 0})
    if not fc:
        return
    checklist = dict(fc.get("checklist") or {})
    if bool(checklist.get("bank_disbursement_applicable")) == applicable:
        return
    checklist["bank_disbursement_applicable"] = applicable
    if not applicable:
        # Reset the received flag if no longer applicable
        checklist["bank_disbursement_received"] = False
    before = dict(fc)
    await db.financial_clearances.update_one({"id": fc["id"]}, {"$set": {"checklist": checklist, "updated_at": _now()}})
    after = await db.financial_clearances.find_one({"id": fc["id"]}, {"_id": 0})
    await write_audit(user_id=actor_id, entity_type="financial_clearance", entity_id=fc["id"],
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=booking_id)


# ---------------- Endpoints ----------------

@router.get("/loans/booking/{booking_id}")
async def get_loan_for_booking(booking_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.loan_cases.find_one({"booking_id": booking_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="No loan case for this booking")
    pid = await project_id_of_booking(booking_id)
    await require_project_access_soft(current_user, pid)
    return redact_financial_amounts(await _enrich(db, doc), current_user, module="customer_loan")


@router.post("/loans")
async def create_loan(payload: LoanCreate, current_user: dict = Depends(get_current_user)):
    if not _can_manage_loan(current_user):
        raise HTTPException(status_code=403, detail="Only Banking / Accounts / Super Admin can create loan cases")
    db = get_db()
    booking = await db.bookings.find_one({"id": payload.booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking["status"] != "Confirmed":
        raise HTTPException(status_code=400, detail="Booking must be Confirmed to open a loan case")
    if await db.loan_cases.count_documents({"booking_id": payload.booking_id}) > 0:
        raise HTTPException(status_code=400, detail="Loan case already exists for this booking")
    if payload.requested_amount_inr <= 0:
        raise HTTPException(status_code=400, detail="requested_amount_inr must be positive")

    lid = _uid()
    now = _now()
    doc = {
        "id": lid,
        "booking_id": payload.booking_id,
        "bank_name": payload.bank_name.strip(),
        "bank_branch": (payload.bank_branch or "").strip() or None,
        "bank_rm_name": (payload.bank_rm_name or "").strip() or None,
        "bank_rm_contact": (payload.bank_rm_contact or "").strip() or None,
        "requested_amount_inr": payload.requested_amount_inr,
        "sanctioned_amount_inr": None,
        "sanction_date": None,
        "sanction_validity_date": None,
        "current_stage": "Application",
        "sanction_letter_attachment_id": None,
        "blocker": None,
        "notes": (payload.notes or "").strip() or None,
        "created_by": current_user["id"],
        "created_at": now,
        "updated_at": now,
    }
    await db.loan_cases.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user_id=current_user["id"], entity_type="loan_case", entity_id=lid,
                      action="create", after=doc,
                      parent_entity_type="booking", parent_entity_id=payload.booking_id)

    await _append_event(db, lid, current_user["id"], "Application Submitted",
                        amount_inr=payload.requested_amount_inr,
                        notes=payload.notes,
                        parent_booking_id=payload.booking_id)

    await _flip_fc_bank_applicable(db, payload.booking_id, True, current_user["id"])

    return await _enrich(db, doc)


@router.patch("/loans/{lid}")
async def update_loan(lid: str, payload: LoanUpdate, current_user: dict = Depends(get_current_user)):
    if not _can_manage_loan(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, lid)
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return await _enrich(db, doc)
    changes["updated_at"] = _now()
    before = dict(doc)
    await db.loan_cases.update_one({"id": lid}, {"$set": changes})
    after = await db.loan_cases.find_one({"id": lid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="loan_case", entity_id=lid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return await _enrich(db, after)


@router.post("/loans/{lid}/record-sanction")
async def record_sanction(lid: str, payload: SanctionPayload, current_user: dict = Depends(get_current_user)):
    if not _can_manage_loan(current_user):
        raise HTTPException(status_code=403, detail="Only Banking / Accounts / Super Admin can record sanction")
    if payload.sanctioned_amount_inr <= 0:
        raise HTTPException(status_code=400, detail="sanctioned_amount_inr must be positive")
    db = get_db()
    doc = await _get_or_404(db, lid)
    if doc["current_stage"] in ("Fully Disbursed", "Closed", "Rejected"):
        raise HTTPException(status_code=400, detail=f"Cannot record sanction — loan is {doc['current_stage']}")
    before = dict(doc)
    await db.loan_cases.update_one({"id": lid}, {"$set": {
        "current_stage": "Sanctioned",
        "sanctioned_amount_inr": payload.sanctioned_amount_inr,
        "sanction_date": payload.sanction_date,
        "sanction_validity_date": payload.sanction_validity_date,
        "sanction_letter_attachment_id": payload.attachment_id,
        "updated_at": _now(),
    }})
    after = await db.loan_cases.find_one({"id": lid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="loan_case", entity_id=lid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    await _append_event(db, lid, current_user["id"], "Sanctioned",
                        event_date=payload.sanction_date,
                        amount_inr=payload.sanctioned_amount_inr,
                        attachment_id=payload.attachment_id,
                        notes=payload.notes,
                        parent_booking_id=doc["booking_id"])
    return await _enrich(db, after)


@router.post("/loans/{lid}/record-disbursement")
async def record_disbursement(lid: str, payload: DisbursementPayload, current_user: dict = Depends(get_current_user)):
    if not _can_manage_loan(current_user):
        raise HTTPException(status_code=403, detail="Only Banking / Accounts / Super Admin can record disbursement")
    if payload.amount_inr <= 0:
        raise HTTPException(status_code=400, detail="amount_inr must be positive")
    db = get_db()
    doc = await _get_or_404(db, lid)
    if doc["current_stage"] in ("Application", "Sanction Pending", "Closed", "Rejected"):
        raise HTTPException(status_code=400, detail=f"Cannot record disbursement — loan is {doc['current_stage']}")
    sanctioned = float(doc.get("sanctioned_amount_inr") or 0)
    if sanctioned <= 0:
        raise HTTPException(status_code=400, detail="Cannot disburse before sanction is recorded")

    # Compute cumulative disbursed AFTER this event
    events = await db.loan_events.find({"loan_case_id": lid, "event_type": "Disbursed"}, {"_id": 0}).to_list(500)
    prior = sum(float(e.get("amount_inr") or 0) for e in events)
    new_total = round(prior + payload.amount_inr, 2)
    tolerance = max(1.0, sanctioned * 0.01)
    if new_total > sanctioned + tolerance:
        raise HTTPException(status_code=400, detail=f"Cumulative disbursement {new_total} exceeds sanctioned {sanctioned}")

    if abs(new_total - sanctioned) <= tolerance:
        new_stage = "Fully Disbursed"
    else:
        new_stage = "Partially Disbursed"

    before = dict(doc)
    await db.loan_cases.update_one({"id": lid}, {"$set": {"current_stage": new_stage, "updated_at": _now()}})
    after = await db.loan_cases.find_one({"id": lid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="loan_case", entity_id=lid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    await _append_event(db, lid, current_user["id"], "Disbursed",
                        event_date=payload.event_date, amount_inr=payload.amount_inr,
                        reference_no=payload.reference_no, attachment_id=payload.attachment_id,
                        notes=payload.notes, parent_booking_id=doc["booking_id"])
    return await _enrich(db, after)


@router.post("/loans/{lid}/record-blocker")
async def record_blocker(lid: str, payload: BlockerPayload, current_user: dict = Depends(get_current_user)):
    if not _can_manage_loan(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    if not payload.blocker_text.strip():
        raise HTTPException(status_code=400, detail="blocker_text required")
    db = get_db()
    doc = await _get_or_404(db, lid)
    before = dict(doc)
    await db.loan_cases.update_one({"id": lid}, {"$set": {"blocker": payload.blocker_text.strip(), "updated_at": _now()}})
    after = await db.loan_cases.find_one({"id": lid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="loan_case", entity_id=lid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    await _append_event(db, lid, current_user["id"], "Blocker Recorded",
                        notes=payload.blocker_text.strip(), parent_booking_id=doc["booking_id"])
    return await _enrich(db, after)


@router.post("/loans/{lid}/clear-blocker")
async def clear_blocker(lid: str, current_user: dict = Depends(get_current_user)):
    if not _can_manage_loan(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, lid)
    if not doc.get("blocker"):
        return await _enrich(db, doc)
    before = dict(doc)
    prev_blocker = doc.get("blocker")
    await db.loan_cases.update_one({"id": lid}, {"$set": {"blocker": None, "updated_at": _now()}})
    after = await db.loan_cases.find_one({"id": lid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="loan_case", entity_id=lid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    await _append_event(db, lid, current_user["id"], "Blocker Resolved",
                        notes=f"Resolved: {prev_blocker}", parent_booking_id=doc["booking_id"])
    return await _enrich(db, after)


@router.post("/loans/{lid}/reject")
async def reject_loan(lid: str, payload: ReasonPayload, current_user: dict = Depends(get_current_user)):
    if not _can_manage_loan(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="reason required")
    db = get_db()
    doc = await _get_or_404(db, lid)
    if doc["current_stage"] == "Fully Disbursed":
        raise HTTPException(status_code=400, detail="Cannot reject a Fully Disbursed loan")
    before = dict(doc)
    await db.loan_cases.update_one({"id": lid}, {"$set": {"current_stage": "Rejected", "updated_at": _now()}})
    after = await db.loan_cases.find_one({"id": lid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="loan_case", entity_id=lid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    await _append_event(db, lid, current_user["id"], "Rejected",
                        notes=payload.reason.strip(), parent_booking_id=doc["booking_id"])
    await _flip_fc_bank_applicable(db, doc["booking_id"], False, current_user["id"])
    return await _enrich(db, after)


@router.get("/loans")
async def list_loans(
    stage: Optional[str] = None,
    project_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    limit: int = Query(500, ge=1, le=2000),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q: dict = {}
    if stage:
        q["current_stage"] = stage
    # Phase 9 scope
    if not is_all_projects_user(current_user):
        bids = await scoped_booking_ids(current_user)
        if not bids: return []
        q["booking_id"] = {"$in": bids}
    docs = await db.loan_cases.find(q, {"_id": 0}).sort("updated_at", -1).to_list(limit)
    # Enrich each
    booking_ids = list({d["booking_id"] for d in docs})
    bookings = {b["id"]: b async for b in db.bookings.find({"id": {"$in": booking_ids}}, {"_id": 0})}
    if project_id:
        docs = [d for d in docs if bookings.get(d["booking_id"], {}).get("project_id") == project_id]
    if customer_id:
        docs = [d for d in docs if bookings.get(d["booking_id"], {}).get("customer_id") == customer_id]
    cust_ids = list({b["customer_id"] for b in bookings.values() if b.get("customer_id")})
    customers = {c["id"]: c async for c in db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0, "id": 1, "code": 1, "primary_name": 1})}
    proj_ids = list({b["project_id"] for b in bookings.values() if b.get("project_id")})
    projects = {p["id"]: p async for p in db.projects.find({"id": {"$in": proj_ids}}, {"_id": 0, "id": 1, "code": 1, "name": 1})}
    unit_ids = list({b["unit_id"] for b in bookings.values() if b.get("unit_id")})
    units = {u["id"]: u async for u in db.units.find({"id": {"$in": unit_ids}}, {"_id": 0, "id": 1, "code": 1})}

    out = []
    for d in docs:
        b = bookings.get(d["booking_id"], {})
        events = await db.loan_events.find({"loan_case_id": d["id"], "event_type": "Disbursed"}, {"_id": 0}).to_list(500)
        d["disbursed_amount_inr"] = round(sum(e.get("amount_inr") or 0 for e in events), 2)
        d["_booking"] = {"id": b.get("id"), "code": b.get("code")}
        d["_customer"] = customers.get(b.get("customer_id"), {})
        d["_project"] = projects.get(b.get("project_id"), {})
        d["_unit"] = units.get(b.get("unit_id"), {})
        out.append(d)
    return out


@router.get("/loans/counts/awaiting-sanction")
async def count_awaiting_sanction(current_user: dict = Depends(get_current_user)):
    db = get_db()
    n = await db.loan_cases.count_documents({"current_stage": {"$in": ["Application", "Sanction Pending"]}})
    return {"count": n}


@router.get("/loans/counts/pending-disbursement")
async def count_pending_disbursement(current_user: dict = Depends(get_current_user)):
    db = get_db()
    n = await db.loan_cases.count_documents({"current_stage": {"$in": ["Sanctioned", "Disbursement Pending", "Partially Disbursed"]}})
    return {"count": n}
