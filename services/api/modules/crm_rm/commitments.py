"""Customer Commitments API — captures ad-hoc promises Sales/CRM makes to a customer.

Overdue is *computed on read* — never stored.
Rule 8: commitments with delivery_status ∈ {Approved, In Progress, Completed, Customer Confirmed}
cannot be deleted.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import (
    is_all_projects_user, require_customer_access, require_customer_access_soft,
    scoped_customer_ids, require_module_by_method
)
from kernel.collaboration.collaboration import is_super_admin, user_role_code
from kernel.mongo import get_db, next_sequence, write_audit


router = APIRouter(prefix="/commitments", tags=["commitments"], dependencies=[Depends(require_module_by_method("commitments"))])


ALLOWED_CATEGORIES: set[str] = {
    "Modification", "Commercial Promise", "Timeline Promise",
    "Complimentary Item", "Specification Upgrade", "Other",
}

DELIVERY_TERMINAL = {"Completed", "Customer Confirmed", "Rejected", "Cancelled"}
DELIVERY_LOCKED_FROM_DELETE = {"Approved", "In Progress", "Completed", "Customer Confirmed"}
DELIVERY_EDITABLE = {"Draft", "Awaiting Approval", "Approved", "In Progress"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class CommitmentCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    customer_id: str
    booking_id: Optional[str] = None
    unit_id: Optional[str] = None
    category: str
    description: str
    committed_date: Optional[str] = None
    responsible_department_id: Optional[str] = None
    owner_user_id: Optional[str] = None
    target_date: Optional[str] = None
    financial_impact_inr: Optional[float] = None
    approval_required: bool = False
    customer_confirmation_required: bool = False


class CommitmentUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    category: Optional[str] = None
    description: Optional[str] = None
    target_date: Optional[str] = None
    responsible_department_id: Optional[str] = None
    owner_user_id: Optional[str] = None
    financial_impact_inr: Optional[float] = None
    customer_confirmation_required: Optional[bool] = None


class DecisionPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    decision: str
    notes: Optional[str] = None


class ReasonPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str


def _overlay_overdue(doc: dict) -> dict:
    doc = dict(doc)
    doc["overdue"] = False
    td = doc.get("target_date")
    if not td:
        return doc
    if doc["delivery_status"] in DELIVERY_TERMINAL:
        return doc
    try:
        dt = datetime.fromisoformat(td)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    except Exception:
        return doc
    if dt < datetime.now(timezone.utc):
        doc["overdue"] = True
    return doc


async def _get_or_404(db, cid: str) -> dict:
    doc = await db.customer_commitments.find_one({"id": cid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Commitment not found")
    return doc


async def _enrich(db, doc: dict) -> dict:
    doc = _overlay_overdue(doc)
    if doc.get("customer_id"):
        c = await db.customers.find_one({"id": doc["customer_id"]}, {"_id": 0, "id": 1, "code": 1, "primary_name": 1})
        doc["_customer"] = c
    if doc.get("responsible_department_id"):
        d = await db.departments.find_one({"id": doc["responsible_department_id"]}, {"_id": 0, "id": 1, "name": 1, "code": 1})
        doc["_department"] = d
    if doc.get("evidence_attachment_ids"):
        atts = []
        async for a in db.attachments.find(
            {"id": {"$in": doc["evidence_attachment_ids"]}, "deleted_at": None},
            {"_id": 0},
        ):
            atts.append(a)
        doc["evidence_attachments"] = atts
    return doc


# ---------------- Endpoints ----------------

@router.get("")
async def list_commitments(
    customer_id: Optional[str] = None,
    status: Optional[str] = None,
    department_id: Optional[str] = None,
    overdue: Optional[bool] = None,
    limit: int = Query(500, ge=1, le=2000),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q: dict = {}
    if customer_id:
        q["customer_id"] = customer_id
    if department_id:
        q["responsible_department_id"] = department_id
    # Phase 9 scope
    if not is_all_projects_user(current_user):
        cids = await scoped_customer_ids(current_user) or []
        if not cids: return []
        if "customer_id" in q:
            if q["customer_id"] not in cids: return []
        else:
            q["customer_id"] = {"$in": cids}
    docs = await db.customer_commitments.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    out = []
    for d in docs:
        d = await _enrich(db, d)
        if status and d.get("delivery_status") != status and not (status == "Overdue" and d.get("overdue")):
            continue
        if overdue is not None and bool(d.get("overdue")) != bool(overdue):
            continue
        out.append(d)
    return out


@router.get("/counts/overdue")
async def counts_overdue(current_user: dict = Depends(get_current_user)):
    db = get_db()
    now = _now()
    n = await db.customer_commitments.count_documents({
        "target_date": {"$lt": now, "$ne": None},
        "delivery_status": {"$nin": list(DELIVERY_TERMINAL)},
    })
    return {"count": n}


@router.get("/{cid}")
async def get_commitment(cid: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await _get_or_404(db, cid)
    await require_customer_access_soft(current_user, doc.get("customer_id"))
    return await _enrich(db, doc)


@router.post("")
async def create_commitment(payload: CommitmentCreate, current_user: dict = Depends(get_current_user)):
    if payload.category not in ALLOWED_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"category must be one of {sorted(ALLOWED_CATEGORIES)}")
    if not payload.description.strip():
        raise HTTPException(status_code=400, detail="Description required")

    db = get_db()
    customer = await db.customers.find_one({"id": payload.customer_id}, {"_id": 0, "id": 1})
    if not customer:
        raise HTTPException(status_code=400, detail="Unknown customer_id")
    # Phase 9 write guard
    await require_customer_access(current_user, payload.customer_id)

    seq = await next_sequence("commitments")
    now = _now()
    delivery_status = "Awaiting Approval" if payload.approval_required else "Draft"
    doc = {
        "id": str(uuid.uuid4()),
        "code": f"COM-{seq:06d}",
        "customer_id": payload.customer_id,
        "booking_id": payload.booking_id,
        "unit_id": payload.unit_id,
        "category": payload.category,
        "description": payload.description.strip(),
        "committed_by": current_user["id"],
        "committed_date": payload.committed_date or now,
        "responsible_department_id": payload.responsible_department_id,
        "owner_user_id": payload.owner_user_id,
        "target_date": payload.target_date,
        "financial_impact_inr": payload.financial_impact_inr,
        "approval_required": bool(payload.approval_required),
        "approval_status": "Pending" if payload.approval_required else "Not Required",
        "approver_user_id": None,
        "approved_at": None,
        "approval_notes": None,
        "delivery_status": delivery_status,
        "customer_confirmation_required": bool(payload.customer_confirmation_required),
        "customer_confirmed_at": None,
        "evidence_attachment_ids": [],
        "created_at": now,
        "updated_at": now,
    }
    await db.customer_commitments.insert_one(doc)
    await write_audit(
        user_id=current_user["id"],
        entity_type="customer_commitment",
        entity_id=doc["id"],
        action="create",
        after=doc,
        parent_entity_type="customer",
        parent_entity_id=payload.customer_id,
    )
    doc.pop("_id", None)
    return await _enrich(db, doc)


@router.patch("/{cid}")
async def update_commitment(cid: str, payload: CommitmentUpdate, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await _get_or_404(db, cid)
    if doc["delivery_status"] in {"Completed", "Customer Confirmed"}:
        raise HTTPException(status_code=400, detail="Cannot edit a commitment in a terminal delivery state")
    # Super Admin OR dept lead (owner or dept-member with Management role)
    role = user_role_code(current_user)
    allowed = (
        is_super_admin(current_user)
        or role == "MANAGEMENT"
        or (doc.get("owner_user_id") and doc["owner_user_id"] == current_user["id"])
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Only Super Admin / Management / owner can edit")

    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return await _enrich(db, doc)
    if "category" in changes and changes["category"] not in ALLOWED_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"category must be one of {sorted(ALLOWED_CATEGORIES)}")

    changes["updated_at"] = _now()
    before = dict(doc)
    await db.customer_commitments.update_one({"id": cid}, {"$set": changes})
    after = await db.customer_commitments.find_one({"id": cid}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="customer_commitment",
        entity_id=cid,
        action="update",
        before=before,
        after=after,
        parent_entity_type="customer",
        parent_entity_id=doc["customer_id"],
    )
    return await _enrich(db, after)


@router.post("/{cid}/submit-for-approval")
async def submit_for_approval(cid: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await _get_or_404(db, cid)
    if doc["delivery_status"] != "Draft":
        raise HTTPException(status_code=400, detail=f"Cannot submit for approval from {doc['delivery_status']}")
    before = dict(doc)
    await db.customer_commitments.update_one(
        {"id": cid},
        {"$set": {"delivery_status": "Awaiting Approval", "approval_required": True, "approval_status": "Pending", "updated_at": _now()}},
    )
    after = await db.customer_commitments.find_one({"id": cid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="customer_commitment", entity_id=cid, action="update",
                      before=before, after=after, parent_entity_type="customer", parent_entity_id=doc["customer_id"])
    return await _enrich(db, after)


@router.post("/{cid}/approve")
async def approve(cid: str, payload: DecisionPayload, current_user: dict = Depends(get_current_user)):
    if payload.decision not in ("Approved", "Rejected"):
        raise HTTPException(status_code=400, detail="decision must be 'Approved' or 'Rejected'")
    db = get_db()
    doc = await _get_or_404(db, cid)
    if doc["delivery_status"] != "Awaiting Approval":
        raise HTTPException(status_code=400, detail=f"Cannot approve from {doc['delivery_status']}")

    role = user_role_code(current_user)
    # Self-approval guard fires first so Sales users see the precise reason
    if doc.get("committed_by") == current_user["id"] and not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Cannot approve your own commitment")
    if not (is_super_admin(current_user) or role == "MANAGEMENT"):
        raise HTTPException(status_code=403, detail="Only Management / Super Admin can approve commitments")

    now = _now()
    updates = {
        "approval_status": payload.decision,
        "approver_user_id": current_user["id"],
        "approved_at": now,
        "approval_notes": (payload.notes or "").strip() or None,
        "delivery_status": "Approved" if payload.decision == "Approved" else "Rejected",
        "updated_at": now,
    }
    before = dict(doc)
    await db.customer_commitments.update_one({"id": cid}, {"$set": updates})
    after = await db.customer_commitments.find_one({"id": cid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="customer_commitment", entity_id=cid, action="update",
                      before=before, after=after, parent_entity_type="customer", parent_entity_id=doc["customer_id"])
    return await _enrich(db, after)


@router.post("/{cid}/start")
async def start(cid: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await _get_or_404(db, cid)
    # Must be Approved (or Draft if no approval required)
    if doc["delivery_status"] == "Approved":
        pass
    elif doc["delivery_status"] == "Draft" and not doc.get("approval_required"):
        pass
    else:
        raise HTTPException(status_code=400, detail=f"Cannot start from {doc['delivery_status']}")

    if doc.get("owner_user_id") and doc["owner_user_id"] != current_user["id"] and not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only the assigned owner can start this commitment")

    before = dict(doc)
    updates = {"delivery_status": "In Progress", "updated_at": _now()}
    if not doc.get("owner_user_id"):
        updates["owner_user_id"] = current_user["id"]
    await db.customer_commitments.update_one({"id": cid}, {"$set": updates})
    after = await db.customer_commitments.find_one({"id": cid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="customer_commitment", entity_id=cid, action="update",
                      before=before, after=after, parent_entity_type="customer", parent_entity_id=doc["customer_id"])
    return await _enrich(db, after)


@router.post("/{cid}/complete")
async def complete(cid: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await _get_or_404(db, cid)
    if doc["delivery_status"] != "In Progress":
        raise HTTPException(status_code=400, detail=f"Cannot complete from {doc['delivery_status']}")
    role = user_role_code(current_user)
    allowed = (
        is_super_admin(current_user)
        or doc.get("owner_user_id") == current_user["id"]
        or (doc.get("responsible_department_id") == current_user.get("department_id") and role == "MANAGEMENT")
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Only owner or department lead can complete")
    before = dict(doc)
    await db.customer_commitments.update_one({"id": cid}, {"$set": {"delivery_status": "Completed", "updated_at": _now()}})
    after = await db.customer_commitments.find_one({"id": cid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="customer_commitment", entity_id=cid, action="update",
                      before=before, after=after, parent_entity_type="customer", parent_entity_id=doc["customer_id"])
    return await _enrich(db, after)


@router.post("/{cid}/customer-confirm")
async def customer_confirm(cid: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await _get_or_404(db, cid)
    if doc["delivery_status"] != "Completed":
        raise HTTPException(status_code=400, detail=f"Cannot customer-confirm from {doc['delivery_status']}")
    role = user_role_code(current_user)
    if not (is_super_admin(current_user) or role == "CRM"):
        raise HTTPException(status_code=403, detail="Only CRM / Super Admin can record customer confirmation")
    before = dict(doc)
    now = _now()
    await db.customer_commitments.update_one(
        {"id": cid},
        {"$set": {"delivery_status": "Customer Confirmed", "customer_confirmed_at": now, "updated_at": now}},
    )
    after = await db.customer_commitments.find_one({"id": cid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="customer_commitment", entity_id=cid, action="update",
                      before=before, after=after, parent_entity_type="customer", parent_entity_id=doc["customer_id"])
    return await _enrich(db, after)


@router.post("/{cid}/cancel")
async def cancel(cid: str, payload: ReasonPayload, current_user: dict = Depends(get_current_user)):
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Reason required")
    if not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only Super Admin can cancel a commitment")
    db = get_db()
    doc = await _get_or_404(db, cid)
    if doc["delivery_status"] in {"Completed", "Customer Confirmed"}:
        raise HTTPException(status_code=400, detail="Cannot cancel a completed commitment")
    before = dict(doc)
    await db.customer_commitments.update_one(
        {"id": cid},
        {"$set": {"delivery_status": "Cancelled", "approval_notes": (doc.get("approval_notes") or "") + f"\nCancel: {payload.reason.strip()}", "updated_at": _now()}},
    )
    after = await db.customer_commitments.find_one({"id": cid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="customer_commitment", entity_id=cid, action="update",
                      before=before, after=after, parent_entity_type="customer", parent_entity_id=doc["customer_id"])
    return await _enrich(db, after)


@router.delete("/{cid}")
async def delete(cid: str, current_user: dict = Depends(get_current_user)):
    if not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only Super Admin can delete a commitment")
    db = get_db()
    doc = await _get_or_404(db, cid)
    if doc["delivery_status"] in DELIVERY_LOCKED_FROM_DELETE:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete a commitment in state '{doc['delivery_status']}'. Critical customer commitments cannot be deleted.",
        )
    await db.customer_commitments.delete_one({"id": cid})
    await write_audit(user_id=current_user["id"], entity_type="customer_commitment", entity_id=cid, action="delete",
                      before=doc, parent_entity_type="customer", parent_entity_id=doc["customer_id"])
    return {"ok": True}
