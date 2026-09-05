"""Bookings CRUD + status transitions."""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from kernel.identity.auth_utils import get_current_user, require_super_admin
from kernel.mongo import get_db, next_sequence, utcnow_iso, write_audit
from kernel.identity.rbac_redact import redact_financial_amounts
from models import BookingCreate, BookingTransition, BookingUpdate


router = APIRouter(prefix="/bookings", tags=["bookings"])


ALLOWED_TRANSITIONS = {
    "Draft": {"Confirmed", "Cancelled"},
    "Confirmed": {"Cancelled"},
    "Cancelled": set(),
}


async def _validate_refs(db, payload_data: dict):
    if "project_id" in payload_data:
        if not await db.projects.find_one({"id": payload_data["project_id"]}):
            raise HTTPException(status_code=400, detail="Invalid project_id")
    if "unit_id" in payload_data:
        if not await db.units.find_one({"id": payload_data["unit_id"]}):
            raise HTTPException(status_code=400, detail="Invalid unit_id")
    if "customer_id" in payload_data:
        if not await db.customers.find_one({"id": payload_data["customer_id"]}):
            raise HTTPException(status_code=400, detail="Invalid customer_id")
    if "sales_owner_id" in payload_data:
        if not await db.users.find_one({"id": payload_data["sales_owner_id"]}):
            raise HTTPException(status_code=400, detail="Invalid sales_owner_id")
    if payload_data.get("crm_owner_id"):
        if not await db.users.find_one({"id": payload_data["crm_owner_id"]}):
            raise HTTPException(status_code=400, detail="Invalid crm_owner_id")


from kernel.identity.auth_scope import (
    get_project_scope, is_all_projects_user, require_booking_access,
    require_project_access, require_project_access_soft, scoped_booking_ids,
)


@router.get("")
async def list_bookings(
    customer_id: Optional[str] = None,
    unit_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q: dict = {}
    if customer_id:
        q["customer_id"] = customer_id
    if unit_id:
        q["unit_id"] = unit_id
    scope = get_project_scope(current_user)
    if scope is not None:
        if not scope: return []
        q["project_id"] = {"$in": scope}
    return redact_financial_amounts(
        await db.bookings.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000),
        current_user,
        module="customer_financials",
    )


@router.get("/{booking_id}")
async def get_booking(booking_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Booking not found")
    await require_project_access_soft(current_user, doc.get("project_id"))
    return redact_financial_amounts(doc, current_user, module="customer_financials")


@router.post("")
async def create_booking(
    payload: BookingCreate,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    data = payload.model_dump()
    await _validate_refs(db, data)

    unit = await db.units.find_one({"id": data["unit_id"]})
    if unit and unit.get("project_id") != data["project_id"]:
        raise HTTPException(status_code=400, detail="Unit does not belong to the selected project")
    if unit and unit.get("status") not in ("Available", "Booked"):
        raise HTTPException(status_code=400, detail=f"Unit is not available (status={unit.get('status')})")

    seq = await next_sequence("booking")
    doc = {
        "id": str(uuid.uuid4()),
        "code": f"BKG-{seq:06d}",
        **data,
        "status": "Draft",
        "cancellation_reason": None,
        "created_at": utcnow_iso(),
    }
    await db.bookings.insert_one(doc)
    await write_audit(
        user_id=current_user["id"],
        entity_type="booking",
        entity_id=doc["id"],
        action="create",
        after=doc,
    )
    doc.pop("_id", None)
    return doc


@router.put("/{booking_id}")
async def update_booking(
    booking_id: str,
    payload: BookingUpdate,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    before = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not before:
        raise HTTPException(status_code=404, detail="Booking not found")
    if before["status"] == "Cancelled":
        raise HTTPException(status_code=400, detail="Cannot edit a cancelled booking")
    changes = payload.model_dump(exclude_unset=True)
    await _validate_refs(db, changes)
    if changes:
        await db.bookings.update_one({"id": booking_id}, {"$set": changes})
    after = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="booking",
        entity_id=booking_id,
        action="update",
        before=before,
        after=after,
    )
    return after


@router.post("/{booking_id}/transition")
async def transition_booking(
    booking_id: str,
    payload: BookingTransition,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    before = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not before:
        raise HTTPException(status_code=404, detail="Booking not found")
    current = before["status"]
    target = payload.to_status
    if target not in ALLOWED_TRANSITIONS.get(current, set()):
        raise HTTPException(
            status_code=400,
            detail=f"Illegal transition {current} -> {target}",
        )
    if target == "Cancelled" and not (payload.reason and payload.reason.strip()):
        raise HTTPException(status_code=400, detail="Cancellation reason is required")

    update: dict = {"status": target}
    if target == "Cancelled":
        update["cancellation_reason"] = payload.reason.strip()

    await db.bookings.update_one({"id": booking_id}, {"$set": update})

    # Reflect on unit
    unit = await db.units.find_one({"id": before["unit_id"]})
    if unit:
        if target == "Confirmed":
            await db.units.update_one({"id": unit["id"]}, {"$set": {"status": "Booked"}})
        elif target == "Cancelled" and unit.get("status") == "Booked":
            await db.units.update_one({"id": unit["id"]}, {"$set": {"status": "Available"}})

    # Journey side effects
    journey_id = None
    if target == "Confirmed":
        from kernel.journey.workflow_engine import create_journey_from_template, get_active_journey_for_booking
        existing = await get_active_journey_for_booking(booking_id)
        if existing:
            journey_id = existing["id"]
        else:
            project = await db.projects.find_one({"id": before["project_id"]}, {"_id": 0})
            unit_doc = await db.units.find_one({"id": before["unit_id"]}, {"_id": 0})
            customer = await db.customers.find_one({"id": before["customer_id"]}, {"_id": 0})
            # Phase 9: Commercial Office units reuse the Apartment workflow template
            unit_type = (unit_doc or {}).get("unit_type")
            template_project_type = "Apartment" if unit_type == "Commercial Office" else (project or {}).get("type")
            template = await db.workflow_templates.find_one(
                {"project_type": template_project_type, "active": True}, {"_id": 0}
            )
            if project and template:
                booking_full = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
                journey = await create_journey_from_template(
                    booking=booking_full,
                    project=project,
                    unit=unit_doc or {},
                    customer=customer or {},
                    template=template,
                    actor_user_id=current_user["id"],
                )
                journey_id = journey["id"] if journey else None
    elif target == "Cancelled":
        # Soft-close any active/on-hold journey attached to this booking
        active_journey = await db.customer_journeys.find_one(
            {"booking_id": booking_id, "status": {"$in": ["Active", "OnHold"]}}, {"_id": 0}
        )
        if active_journey:
            j_before = dict(active_journey)
            await db.customer_journeys.update_one(
                {"id": active_journey["id"]},
                {"$set": {"status": "Cancelled", "close_reason": f"Booking cancelled: {payload.reason.strip()}"}},
            )
            j_after = await db.customer_journeys.find_one({"id": active_journey["id"]}, {"_id": 0})
            await write_audit(
                user_id=current_user["id"],
                entity_type="journey",
                entity_id=active_journey["id"],
                action="update",
                before=j_before,
                after=j_after,
            )
            journey_id = active_journey["id"]

    after = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if journey_id:
        after["journey_id"] = journey_id
    await write_audit(
        user_id=current_user["id"],
        entity_type="booking",
        entity_id=booking_id,
        action="update",
        before=before,
        after=after,
    )
    return after


@router.delete("/{booking_id}")
async def delete_booking(
    booking_id: str,
    current_user: dict = Depends(require_super_admin()),
):
    db = get_db()
    before = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not before:
        raise HTTPException(status_code=404, detail="Booking not found")
    if before["status"] != "Draft":
        raise HTTPException(status_code=400, detail="Only Draft bookings can be deleted; cancel instead.")
    await db.bookings.delete_one({"id": booking_id})
    await write_audit(
        user_id=current_user["id"],
        entity_type="booking",
        entity_id=booking_id,
        action="delete",
        before=before,
    )
    return {"ok": True}
