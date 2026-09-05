"""Payment schedule + milestones + payments API (Phase 5).

Milestone.status and alert_flag are computed on read (spec §47/§48). Verified booking-amount
payments cascade-complete journey task T7 via engine_hooks.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional

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
from kernel.identity.rbac_redact import redact_financial_amounts
from kernel.action.engine_hooks import find_journey_task_by_key, system_complete_task
from kernel.files.storage import save_upload_stream


router = APIRouter(prefix="", tags=["payments"], dependencies=[Depends(require_module_by_method("collections"))])

STORAGE_ROOT = Path(os.environ.get("ATTACHMENT_STORAGE_ROOT", "/app/backend/storage"))
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)

ALLOWED_MODES = {"Bank Transfer", "Cheque", "DD", "RTGS", "NEFT", "UPI", "Other"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(s: str | None) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _can_manage_finance(user: dict) -> bool:
    return is_super_admin(user) or user_role_code(user) in {"ACCOUNTS", "MANAGEMENT"}


def _can_record_payment(user: dict) -> bool:
    return _can_manage_finance(user) or user_role_code(user) == "SALES"


# ---------------- Pydantic ----------------

class MilestoneIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    sequence: int
    milestone_name: str
    due_date: Optional[str] = None
    demand_amount_inr: float
    tax_inr: float = 0
    notes: Optional[str] = None
    is_booking_amount: bool = False


class ScheduleCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    booking_id: str
    template_used: Optional[str] = None
    total_agreement_value_inr: float
    total_tax_inr: float = 0
    milestones: list[MilestoneIn]


class ScheduleUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    template_used: Optional[str] = None
    total_agreement_value_inr: Optional[float] = None
    total_tax_inr: Optional[float] = None


class MilestoneUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    sequence: Optional[int] = None
    milestone_name: Optional[str] = None
    due_date: Optional[str] = None
    demand_amount_inr: Optional[float] = None
    tax_inr: Optional[float] = None
    notes: Optional[str] = None
    is_booking_amount: Optional[bool] = None


class GenerateTemplateBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    booking_id: str
    template_name: str


class ReasonPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str


# ---------------- helpers ----------------

def _milestone_totals(m: dict) -> dict:
    demand = float(m.get("demand_amount_inr") or 0)
    tax = float(m.get("tax_inr") or 0)
    return {"total_due_inr": round(demand + tax, 2)}


def _compute_alert_flag(days_delta: int, is_paid: bool) -> Optional[str]:
    if is_paid:
        return None
    if days_delta >= 30:
        return "overdue_30"
    if days_delta >= 15:
        return "overdue_15"
    if days_delta >= 7:
        return "overdue_7"
    if days_delta == 0:
        return "due_today"
    if -7 <= days_delta < 0:
        return "due_7_days"
    return None


async def _milestone_with_computed(db, m: dict) -> dict:
    """Return milestone dict with computed status, ageing, and receipt summary."""
    m = dict(m)
    payments = await db.payments.find({"milestone_id": m["id"]}, {"_id": 0}).to_list(200)
    verified = round(sum(p["amount_inr"] + (p.get("tax_inr") or 0) for p in payments if p.get("verification_status") == "Verified"), 2)
    pending = round(sum(p["amount_inr"] + (p.get("tax_inr") or 0) for p in payments if p.get("verification_status") == "Pending"), 2)
    total_due = float(m.get("total_due_inr") or (m.get("demand_amount_inr", 0) + m.get("tax_inr", 0)))
    balance = round(total_due - verified, 2)

    due_dt = _parse_iso(m.get("due_date"))
    days_delta = 0
    if due_dt:
        days_delta = (_today().date() - due_dt.date()).days

    has_disputed = any(p.get("verification_status") == "Disputed" for p in payments)
    all_waived = payments and all(p.get("verification_status") == "Waived" for p in payments)

    if has_disputed:
        status = "Disputed"
    elif all_waived:
        status = "Waived"
    elif verified >= total_due and total_due > 0:
        status = "Paid"
    elif verified > 0:
        status = "Partially Paid"
    elif days_delta > 0:
        status = "Overdue"
    elif days_delta == 0:
        status = "Due"
    elif -7 <= days_delta < 0:
        status = "Due Soon"
    else:
        status = "Not Due"

    m["received_verified_inr"] = verified
    m["received_pending_inr"] = pending
    m["balance_inr"] = balance
    m["days_delta"] = days_delta
    m["status"] = status
    m["alert_flag"] = _compute_alert_flag(days_delta, status == "Paid" or status == "Waived")
    return m


async def _enrich_schedule(db, schedule: dict) -> dict:
    schedule = dict(schedule)
    milestones = await db.payment_milestones.find({"payment_schedule_id": schedule["id"]}, {"_id": 0}).sort("sequence", 1).to_list(200)
    schedule["milestones"] = [await _milestone_with_computed(db, m) for m in milestones]
    return schedule


async def _get_booking_or_404(db, booking_id: str) -> dict:
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    return b


# ---------------- Schedule endpoints ----------------

@router.get("/payment-schedules/booking/{booking_id}")
async def get_schedule_for_booking(booking_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    booking = await _get_booking_or_404(db, booking_id)
    if booking["status"] != "Confirmed":
        raise HTTPException(status_code=404, detail="Payment schedule only for Confirmed bookings")
    await require_project_access_soft(current_user, booking.get("project_id"))
    schedule = await db.payment_schedules.find_one({"booking_id": booking_id}, {"_id": 0})
    if not schedule:
        # Auto-create empty shell
        schedule = {
            "id": str(uuid.uuid4()),
            "booking_id": booking_id,
            "template_used": None,
            "total_agreement_value_inr": float(booking.get("agreement_value_inr") or 0),
            "total_tax_inr": 0,
            "currency": "INR",
            "created_by": current_user["id"],
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.payment_schedules.insert_one(schedule)
        await write_audit(user_id=current_user["id"], entity_type="payment_schedule", entity_id=schedule["id"],
                          action="create", after=schedule, parent_entity_type="booking", parent_entity_id=booking_id)
        schedule.pop("_id", None)
    return redact_financial_amounts(await _enrich_schedule(db, schedule), current_user, module="customer_financials")


@router.post("/payment-schedules/generate-template")
async def generate_template(payload: GenerateTemplateBody, current_user: dict = Depends(get_current_user)):
    """Return a suggested milestone list — does NOT persist."""
    db = get_db()
    booking = await _get_booking_or_404(db, payload.booking_id)
    total = float(booking.get("agreement_value_inr") or 0)
    booking_dt = _parse_iso(booking.get("booking_date")) or _today()
    tpl = payload.template_name
    handover = _parse_iso(booking.get("expected_handover_date")) or (booking_dt + timedelta(days=365))
    span = max(30, int((handover - booking_dt).days))
    if tpl == "30-40-30":
        splits = [(0.30, 0), (0.40, span // 2), (0.30, span)]
        names = ["Booking Amount", "On Foundation", "On Possession"]
    elif tpl == "Construction Linked (10-40-40-10)":
        splits = [(0.10, 0), (0.40, span // 3), (0.40, 2 * span // 3), (0.10, span)]
        names = ["Booking Amount", "On Slab 1", "On Slab 3", "On Handover"]
    elif tpl == "Handover Bias (20-60-20)":
        splits = [(0.20, 0), (0.60, span // 2), (0.20, span)]
        names = ["Booking Amount", "During Construction", "On Handover"]
    else:
        raise HTTPException(status_code=400, detail=f"Unknown template '{tpl}'")

    milestones = []
    for i, (pct, offset) in enumerate(splits):
        demand = round(total * pct, 2)
        milestones.append({
            "sequence": i + 1,
            "milestone_name": names[i],
            "due_date": (booking_dt + timedelta(days=offset)).isoformat(),
            "demand_amount_inr": demand,
            "tax_inr": 0,
            "notes": None,
            "is_booking_amount": i == 0,
        })
    return {"template_used": tpl, "total_agreement_value_inr": total, "milestones": milestones}


@router.post("/payment-schedules")
async def create_schedule(payload: ScheduleCreate, current_user: dict = Depends(get_current_user)):
    if not _can_manage_finance(current_user):
        raise HTTPException(status_code=403, detail="Only Accounts / Super Admin can create schedules")
    db = get_db()
    booking = await _get_booking_or_404(db, payload.booking_id)
    if booking["status"] != "Confirmed":
        raise HTTPException(status_code=400, detail="Booking must be Confirmed to have a payment schedule")

    n_ba = sum(1 for m in payload.milestones if m.is_booking_amount)
    if n_ba != 1:
        raise HTTPException(status_code=400, detail=f"Exactly one milestone must have is_booking_amount=true (got {n_ba})")

    if not payload.milestones:
        raise HTTPException(status_code=400, detail="At least one milestone required")

    milestones_sum = round(sum(m.demand_amount_inr + (m.tax_inr or 0) for m in payload.milestones), 2)
    total = round(payload.total_agreement_value_inr + (payload.total_tax_inr or 0), 2)
    tolerance = max(1.0, total * 0.01)
    if abs(milestones_sum - total) > tolerance:
        raise HTTPException(status_code=400, detail=f"Milestone sum {milestones_sum} differs from total {total} by more than 1% ({tolerance:.2f} tolerance)")

    # Reject if a schedule already exists for this booking
    existing = await db.payment_schedules.find_one({"booking_id": payload.booking_id}, {"_id": 0, "id": 1})
    if existing:
        # If empty (no milestones yet), replace; else error
        n_existing = await db.payment_milestones.count_documents({"payment_schedule_id": existing["id"]})
        if n_existing > 0:
            raise HTTPException(status_code=400, detail="Schedule already exists for this booking (has milestones). PATCH or add milestones individually.")
        sid = existing["id"]
        await db.payment_schedules.update_one({"id": sid}, {"$set": {
            "template_used": payload.template_used,
            "total_agreement_value_inr": payload.total_agreement_value_inr,
            "total_tax_inr": payload.total_tax_inr or 0,
            "updated_at": _now(),
        }})
    else:
        sid = str(uuid.uuid4())
        await db.payment_schedules.insert_one({
            "id": sid,
            "booking_id": payload.booking_id,
            "template_used": payload.template_used,
            "total_agreement_value_inr": payload.total_agreement_value_inr,
            "total_tax_inr": payload.total_tax_inr or 0,
            "currency": "INR",
            "created_by": current_user["id"],
            "created_at": _now(),
            "updated_at": _now(),
        })

    for m in payload.milestones:
        mdoc = {
            "id": str(uuid.uuid4()),
            "payment_schedule_id": sid,
            "sequence": m.sequence,
            "milestone_name": m.milestone_name.strip(),
            "due_date": m.due_date,
            "demand_amount_inr": m.demand_amount_inr,
            "tax_inr": m.tax_inr or 0,
            "total_due_inr": round(m.demand_amount_inr + (m.tax_inr or 0), 2),
            "notes": m.notes,
            "is_booking_amount": bool(m.is_booking_amount),
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.payment_milestones.insert_one(mdoc)

    schedule = await db.payment_schedules.find_one({"id": sid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="payment_schedule", entity_id=sid,
                      action="create", after=schedule, parent_entity_type="booking", parent_entity_id=payload.booking_id)
    return await _enrich_schedule(db, schedule)


@router.patch("/payment-schedules/{sid}")
async def update_schedule(sid: str, payload: ScheduleUpdate, current_user: dict = Depends(get_current_user)):
    if not _can_manage_finance(current_user):
        raise HTTPException(status_code=403, detail="Only Accounts / Super Admin can edit schedules")
    db = get_db()
    sched = await db.payment_schedules.find_one({"id": sid}, {"_id": 0})
    if not sched:
        raise HTTPException(status_code=404, detail="Schedule not found")
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return await _enrich_schedule(db, sched)
    changes["updated_at"] = _now()
    before = dict(sched)
    await db.payment_schedules.update_one({"id": sid}, {"$set": changes})
    after = await db.payment_schedules.find_one({"id": sid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="payment_schedule", entity_id=sid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=sched["booking_id"])
    return await _enrich_schedule(db, after)


# ---------------- Milestone endpoints ----------------

@router.post("/payment-schedules/{sid}/milestones")
async def add_milestone(sid: str, payload: MilestoneIn, current_user: dict = Depends(get_current_user)):
    if not _can_manage_finance(current_user):
        raise HTTPException(status_code=403, detail="Only Accounts / Super Admin can add milestones")
    db = get_db()
    sched = await db.payment_schedules.find_one({"id": sid}, {"_id": 0})
    if not sched:
        raise HTTPException(status_code=404, detail="Schedule not found")
    if payload.is_booking_amount:
        n_ba = await db.payment_milestones.count_documents({"payment_schedule_id": sid, "is_booking_amount": True})
        if n_ba > 0:
            raise HTTPException(status_code=400, detail="A booking-amount milestone already exists")
    mid = str(uuid.uuid4())
    mdoc = {
        "id": mid,
        "payment_schedule_id": sid,
        "sequence": payload.sequence,
        "milestone_name": payload.milestone_name.strip(),
        "due_date": payload.due_date,
        "demand_amount_inr": payload.demand_amount_inr,
        "tax_inr": payload.tax_inr or 0,
        "total_due_inr": round(payload.demand_amount_inr + (payload.tax_inr or 0), 2),
        "notes": payload.notes,
        "is_booking_amount": bool(payload.is_booking_amount),
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.payment_milestones.insert_one(mdoc)
    await write_audit(user_id=current_user["id"], entity_type="payment_milestone", entity_id=mid,
                      action="create", after=mdoc, parent_entity_type="booking", parent_entity_id=sched["booking_id"])
    return await _milestone_with_computed(db, mdoc)


@router.patch("/milestones/{mid}")
async def update_milestone(mid: str, payload: MilestoneUpdate, current_user: dict = Depends(get_current_user)):
    if not _can_manage_finance(current_user):
        raise HTTPException(status_code=403, detail="Only Accounts / Super Admin can edit milestones")
    db = get_db()
    m = await db.payment_milestones.find_one({"id": mid}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Milestone not found")
    n_pay = await db.payments.count_documents({"milestone_id": mid})
    if n_pay > 0:
        raise HTTPException(status_code=400, detail="Cannot edit milestone with linked payments")
    changes = payload.model_dump(exclude_unset=True)
    if "demand_amount_inr" in changes or "tax_inr" in changes:
        new_demand = changes.get("demand_amount_inr", m["demand_amount_inr"])
        new_tax = changes.get("tax_inr", m.get("tax_inr", 0))
        changes["total_due_inr"] = round(new_demand + new_tax, 2)
    changes["updated_at"] = _now()
    before = dict(m)
    await db.payment_milestones.update_one({"id": mid}, {"$set": changes})
    after = await db.payment_milestones.find_one({"id": mid}, {"_id": 0})
    sched = await db.payment_schedules.find_one({"id": m["payment_schedule_id"]}, {"_id": 0, "booking_id": 1})
    await write_audit(user_id=current_user["id"], entity_type="payment_milestone", entity_id=mid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=(sched or {}).get("booking_id"))
    return await _milestone_with_computed(db, after)


@router.delete("/milestones/{mid}")
async def delete_milestone(mid: str, current_user: dict = Depends(get_current_user)):
    if not _can_manage_finance(current_user):
        raise HTTPException(status_code=403, detail="Only Accounts / Super Admin can delete milestones")
    db = get_db()
    m = await db.payment_milestones.find_one({"id": mid}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Milestone not found")
    n_pay = await db.payments.count_documents({"milestone_id": mid})
    if n_pay > 0:
        raise HTTPException(status_code=400, detail="Cannot delete milestone with linked payments")
    sched = await db.payment_schedules.find_one({"id": m["payment_schedule_id"]}, {"_id": 0, "booking_id": 1})
    await db.payment_milestones.delete_one({"id": mid})
    await write_audit(user_id=current_user["id"], entity_type="payment_milestone", entity_id=mid,
                      action="delete", before=m,
                      parent_entity_type="booking", parent_entity_id=(sched or {}).get("booking_id"))
    return {"ok": True}


# ---------------- Payments ----------------

async def _upload_receipt(file: UploadFile, entity_id: str, user_id: str, category: str = "Payment Receipt") -> dict:
    """Reuses attachments storage layer directly (payment attachment)."""
    if not file:
        return None
    db = get_db()
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
            "uploaded_by": user_id,
            "entity_type": "payment",
            "entity_id": entity_id,
        },
    )
    doc = {
        "id": attachment_id,
        "entity_type": "payment",
        "entity_id": entity_id,
        "comment_id": None,
        "filename": filename,
        "storage_path": None,
        "gridfs_file_id": gridfs_id,
        "storage_backend": "gridfs",
        "file_missing": False,
        "mime_type": content_type,
        "size_bytes": size,
        "category": category,
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


@router.post("/payments")
async def record_payment(
    booking_id: str = Form(...),
    amount_inr: float = Form(...),
    tax_inr: float = Form(0),
    payment_mode: str = Form(...),
    reference_no: str = Form(""),
    payment_date: str = Form(...),
    milestone_id: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user),
):
    if not _can_record_payment(current_user):
        raise HTTPException(status_code=403, detail="Not authorised to record payments")
    if payment_mode not in ALLOWED_MODES:
        raise HTTPException(status_code=400, detail=f"payment_mode must be one of {sorted(ALLOWED_MODES)}")
    if amount_inr <= 0:
        raise HTTPException(status_code=400, detail="amount_inr must be positive")

    db = get_db()
    booking = await _get_booking_or_404(db, booking_id)
    if milestone_id:
        m = await db.payment_milestones.find_one({"id": milestone_id}, {"_id": 0})
        if not m:
            raise HTTPException(status_code=400, detail="Unknown milestone_id")
        sched = await db.payment_schedules.find_one({"id": m["payment_schedule_id"]}, {"_id": 0, "booking_id": 1})
        if not sched or sched["booking_id"] != booking_id:
            raise HTTPException(status_code=400, detail="milestone does not belong to this booking")

    pid = str(uuid.uuid4())
    now = _now()
    attachment_ids: list[str] = []
    if file and file.filename:
        att = await _upload_receipt(file, pid, current_user["id"])
        if att:
            attachment_ids.append(att["id"])

    doc = {
        "id": pid,
        "booking_id": booking_id,
        "milestone_id": milestone_id,
        "amount_inr": amount_inr,
        "tax_inr": tax_inr or 0,
        "payment_mode": payment_mode,
        "reference_no": reference_no or "",
        "payment_date": payment_date,
        "received_by_user_id": current_user["id"],
        "verification_status": "Pending",
        "verified_by": None,
        "verified_at": None,
        "verification_notes": None,
        "notes": notes,
        "attachment_ids": attachment_ids,
        "created_at": now,
        "updated_at": now,
    }
    await db.payments.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user_id=current_user["id"], entity_type="payment", entity_id=pid,
                      action="create", after=doc, parent_entity_type="booking", parent_entity_id=booking_id)
    return doc


@router.get("/payments")
async def list_payments(
    booking_id: Optional[str] = None,
    milestone_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(500, ge=1, le=2000),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q: dict = {}
    if booking_id:
        q["booking_id"] = booking_id
    if milestone_id:
        q["milestone_id"] = milestone_id
    if status:
        q["verification_status"] = status
    # Phase 9 scope
    if not is_all_projects_user(current_user):
        bids = await scoped_booking_ids(current_user)
        if not bids: return []
        if "booking_id" in q:
            if q["booking_id"] not in bids: return []
        else:
            q["booking_id"] = {"$in": bids}
    docs = await db.payments.find(q, {"_id": 0}).sort("payment_date", -1).to_list(limit)
    # Enrich
    booking_ids = list({d["booking_id"] for d in docs})
    bookings = {b["id"]: b async for b in db.bookings.find({"id": {"$in": booking_ids}}, {"_id": 0})}
    cust_ids = list({b["customer_id"] for b in bookings.values() if b.get("customer_id")})
    customers = {c["id"]: c async for c in db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0, "id": 1, "code": 1, "primary_name": 1})}
    for d in docs:
        b = bookings.get(d["booking_id"], {})
        d["_booking"] = {"id": b.get("id"), "code": b.get("code")}
        d["_customer"] = customers.get(b.get("customer_id"), {})
    return redact_financial_amounts(docs, current_user, module="collections")


@router.post("/payments/{pid}/verify")
async def verify_payment(pid: str, current_user: dict = Depends(get_current_user)):
    if not _can_manage_finance(current_user):
        raise HTTPException(status_code=403, detail="Only Accounts / Super Admin can verify payments")
    db = get_db()
    p = await db.payments.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    if p["verification_status"] == "Verified":
        return p
    if p["verification_status"] == "Waived":
        raise HTTPException(status_code=400, detail="Cannot verify a waived payment")
    now = _now()
    before = dict(p)
    await db.payments.update_one({"id": pid}, {"$set": {
        "verification_status": "Verified", "verified_by": current_user["id"],
        "verified_at": now, "updated_at": now,
    }})
    after = await db.payments.find_one({"id": pid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="payment", entity_id=pid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=p["booking_id"])

    # Cascade: if booking-amount milestone and verified sum ≥ total_due, complete T7
    if p.get("milestone_id"):
        m = await db.payment_milestones.find_one({"id": p["milestone_id"]}, {"_id": 0})
        if m and m.get("is_booking_amount"):
            payments = await db.payments.find({"milestone_id": m["id"]}, {"_id": 0}).to_list(200)
            verified = sum(pp["amount_inr"] + (pp.get("tax_inr") or 0) for pp in payments if pp.get("verification_status") == "Verified")
            if verified >= float(m.get("total_due_inr") or 0):
                journey = await db.customer_journeys.find_one(
                    {"booking_id": p["booking_id"], "status": {"$in": ["Active", "OnHold", "Closed"]}},
                    {"_id": 0},
                )
                if journey:
                    t7 = await find_journey_task_by_key(journey["id"], "T7")
                    if t7:
                        await system_complete_task(t7["id"], current_user["id"], note="Booking amount milestone paid + verified")
    return after


@router.post("/payments/{pid}/dispute")
async def dispute_payment(pid: str, payload: ReasonPayload, current_user: dict = Depends(get_current_user)):
    if not _can_manage_finance(current_user):
        raise HTTPException(status_code=403, detail="Only Accounts / Super Admin can dispute payments")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Reason required")
    db = get_db()
    p = await db.payments.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    if p["verification_status"] == "Waived":
        raise HTTPException(status_code=400, detail="Cannot dispute a waived payment")
    before = dict(p)
    await db.payments.update_one({"id": pid}, {"$set": {
        "verification_status": "Disputed",
        "verification_notes": payload.reason.strip(),
        "updated_at": _now(),
    }})
    after = await db.payments.find_one({"id": pid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="payment", entity_id=pid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=p["booking_id"])
    return after


@router.post("/payments/{pid}/waive")
async def waive_payment(pid: str, payload: ReasonPayload, current_user: dict = Depends(get_current_user)):
    if not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only Super Admin can waive payments")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Reason required")
    db = get_db()
    p = await db.payments.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    before = dict(p)
    await db.payments.update_one({"id": pid}, {"$set": {
        "verification_status": "Waived",
        "verification_notes": payload.reason.strip(),
        "verified_by": current_user["id"],
        "verified_at": _now(),
        "updated_at": _now(),
    }})
    after = await db.payments.find_one({"id": pid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="payment", entity_id=pid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=p["booking_id"])
    return after


@router.delete("/payments/{pid}")
async def delete_payment(pid: str, current_user: dict = Depends(get_current_user)):
    if not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only Super Admin can delete payments")
    db = get_db()
    p = await db.payments.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    if p["verification_status"] != "Pending":
        raise HTTPException(status_code=400, detail="Only Pending payments can be deleted")
    await db.payments.delete_one({"id": pid})
    await write_audit(user_id=current_user["id"], entity_type="payment", entity_id=pid,
                      action="delete", before=p, parent_entity_type="booking", parent_entity_id=p["booking_id"])
    return {"ok": True}
