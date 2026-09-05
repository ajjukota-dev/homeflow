"""Customer CRUD with nested applicants."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException

from kernel.identity.auth_utils import get_current_user, require_super_admin
from kernel.identity.auth_scope import (
    get_project_scope, is_all_projects_user, require_customer_access,
    require_customer_access_soft, require_module_by_method, scoped_customer_ids, user_can_access_customer,
)
from kernel.mongo import get_db, next_sequence, utcnow_iso, write_audit
from models import CustomerCreate, CustomerUpdate
from kernel.identity.rbac_redact import redact_customer_pii


router = APIRouter(prefix="/customers", tags=["customers"], dependencies=[Depends(require_module_by_method("customer_overview"))])

MAX_APPLICANTS = 4  # primary + 3 co-applicants


def _pack_applicants(applicants) -> list[dict]:
    if applicants is None:
        return []
    if len(applicants) > MAX_APPLICANTS:
        raise HTTPException(status_code=400, detail=f"At most {MAX_APPLICANTS} applicants allowed")
    out = []
    for a in applicants:
        row = a.model_dump() if hasattr(a, "model_dump") else dict(a)
        row.setdefault("id", str(uuid.uuid4()))
        row.setdefault("kyc_status", "Pending")
        out.append(row)
    return out


@router.get("")
async def list_customers(current_user: dict = Depends(get_current_user)):
    db = get_db()
    q: dict = {}
    if not is_all_projects_user(current_user):
        cids = await scoped_customer_ids(current_user)
        if cids is None:
            pass
        elif not cids:
            return []
        else:
            q["id"] = {"$in": cids}
    docs = await db.customers.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return redact_customer_pii(docs, current_user, module="customer_overview")


@router.get("/{customer_id}")
async def get_customer(customer_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Customer not found")
    if not is_all_projects_user(current_user):
        if not await user_can_access_customer(current_user, customer_id):
            raise HTTPException(status_code=404, detail="Customer not found")
    return redact_customer_pii(doc, current_user, module="customer_overview")


@router.post("")
async def create_customer(
    payload: CustomerCreate,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    seq = await next_sequence("customer")
    doc = {
        "id": str(uuid.uuid4()),
        "code": f"CUS-{seq:06d}",
        "primary_name": payload.primary_name,
        "email": payload.email,
        "phone": payload.phone,
        "nri_status": payload.nri_status,
        "communication_pref": payload.communication_pref,
        "address_line": payload.address_line,
        "city": payload.city,
        "state": payload.state,
        "pincode": payload.pincode,
        "applicants": _pack_applicants(payload.applicants),
        "created_at": utcnow_iso(),
    }
    await db.customers.insert_one(doc)
    await write_audit(
        user_id=current_user["id"],
        entity_type="customer",
        entity_id=doc["id"],
        action="create",
        after=doc,
    )
    doc.pop("_id", None)
    return doc


@router.put("/{customer_id}")
async def update_customer(
    customer_id: str,
    payload: CustomerUpdate,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    before = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    if not before:
        raise HTTPException(status_code=404, detail="Customer not found")
    changes = payload.model_dump(exclude_unset=True)
    if "applicants" in changes:
        changes["applicants"] = _pack_applicants(payload.applicants)
    if changes:
        await db.customers.update_one({"id": customer_id}, {"$set": changes})
    after = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="customer",
        entity_id=customer_id,
        action="update",
        before=before,
        after=after,
    )
    return after


@router.delete("/{customer_id}")
async def delete_customer(
    customer_id: str,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    before = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    if not before:
        raise HTTPException(status_code=404, detail="Customer not found")
    if await db.bookings.count_documents({"customer_id": customer_id, "status": {"$ne": "Cancelled"}}) > 0:
        raise HTTPException(status_code=400, detail="Cannot delete a customer with an active booking")
    await db.customers.delete_one({"id": customer_id})
    await write_audit(
        user_id=current_user["id"],
        entity_type="customer",
        entity_id=customer_id,
        action="delete",
        before=before,
    )
    return {"ok": True}
