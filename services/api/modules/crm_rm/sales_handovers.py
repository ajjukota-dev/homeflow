"""Sales-to-CRM Handover form.

- Auto-creates a Draft handover on first read for any Confirmed booking.
- Only the booking's Sales owner may PATCH sections while status ∈ {Draft, Returned}.
- Submit drives task T1 (Simple, Sales) to Completed, and promotes commitment rows.
- CRM Accept drives task T2 (Verification, CRM) through submit-for-verification + verify.
- CRM Return moves T2 back to In Progress and auto-posts a comment on T2.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import (
    get_project_scope, is_all_projects_user, project_id_of_booking,
    require_project_access, require_project_access_soft, require_module_by_method, scoped_booking_ids,
)
from kernel.collaboration.collaboration import is_super_admin, user_role_code
from kernel.mongo import get_db, write_audit
from kernel.action.engine_hooks import (
    find_journey_task_by_key as _find_task_by_key_shared,
    post_task_comment as _post_task_comment_shared,
    system_complete_task as _system_complete_task_shared,
    system_reset_task_to_in_progress as _system_reset_task_to_in_progress_shared,
    system_verify_task as _system_verify_task_shared,
)
from kernel.journey.workflow_engine import cascade_from_task, compute_blocker, TERMINAL_STATUSES


router = APIRouter(prefix="/sales-handovers", tags=["sales-handovers"], dependencies=[Depends(require_module_by_method("sales_handover"))])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty_customer_section() -> dict:
    return {
        "applicant_details_confirmed": False,
        "contact_verified": False,
        "nri_status_confirmed": False,
        "communication_pref_confirmed": False,
        "notes": "",
    }


def _empty_commercial_section() -> dict:
    return {
        "final_price_inr": None,
        "discount_inr": None,
        "payment_plan_ref": "",
        "booking_amount_inr": None,
        "approved_deviations": [],
        "brokerage_percent": None,
        "brokerage_inr": None,
        "taxes_summary": "",
        "notes": "",
    }


def _empty_unit_section() -> dict:
    return {
        "unit_confirmed": False,
        "parking_count": 0,
        "facing_confirmed": False,
        "specifications_notes": "",
    }


def _empty_documents_section() -> dict:
    return {
        "booking_form_uploaded": False,
        "cost_sheet_uploaded": False,
        "kyc_complete": False,
        "approval_notes_uploaded": False,
        "linked_document_ids": [],
    }


def _empty_commitments_section() -> dict:
    return {"items": []}


class SectionPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    customer_section: Optional[dict] = None
    commercial_section: Optional[dict] = None
    unit_section: Optional[dict] = None
    documents_section: Optional[dict] = None
    commitments_section: Optional[dict] = None


class ReturnPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str


async def _find_by_booking(db, booking_id: str) -> Optional[dict]:
    return await db.sales_handovers.find_one({"booking_id": booking_id}, {"_id": 0})


async def _make_draft(db, booking: dict, actor_id: Optional[str]) -> dict:
    unit = await db.units.find_one({"id": booking["unit_id"]}, {"_id": 0}) or {}
    doc = {
        "id": str(uuid.uuid4()),
        "booking_id": booking["id"],
        "customer_id": booking["customer_id"],
        "submitted_by": None,
        "submitted_at": None,
        "accepted_by": None,
        "accepted_at": None,
        "status": "Draft",
        "return_reason": None,
        "customer_section": _empty_customer_section(),
        "commercial_section": {**_empty_commercial_section(),
                               "final_price_inr": booking.get("agreement_value_inr"),
                               "booking_amount_inr": booking.get("booking_amount_inr"),
                               "payment_plan_ref": booking.get("payment_plan") or ""},
        "unit_section": {**_empty_unit_section(), "parking_count": unit.get("parking_count", 0)},
        "documents_section": _empty_documents_section(),
        "commitments_section": _empty_commitments_section(),
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.sales_handovers.insert_one(doc)
    await write_audit(
        user_id=actor_id,
        entity_type="sales_handover",
        entity_id=doc["id"],
        action="create",
        after=doc,
        parent_entity_type="booking",
        parent_entity_id=booking["id"],
    )
    doc.pop("_id", None)
    return doc


async def _enrich(db, doc: dict) -> dict:
    booking = await db.bookings.find_one({"id": doc["booking_id"]}, {"_id": 0}) or {}
    customer = await db.customers.find_one({"id": doc["customer_id"]}, {"_id": 0}) or {}
    unit = await db.units.find_one({"id": booking.get("unit_id")}, {"_id": 0}) if booking.get("unit_id") else {}
    project = await db.projects.find_one({"id": booking.get("project_id")}, {"_id": 0}) if booking.get("project_id") else {}
    doc["_booking"] = booking
    doc["_customer"] = customer
    doc["_unit"] = unit or {}
    doc["_project"] = project or {}
    # Enrich linked documents in documents_section
    linked_ids = (doc.get("documents_section") or {}).get("linked_document_ids") or []
    linked_docs = []
    if linked_ids:
        async for d in db.documents.find({"id": {"$in": linked_ids}}, {"_id": 0}):
            linked_docs.append(d)
    doc["_linked_documents"] = linked_docs
    return doc


def _is_sales_owner(booking: dict, user: dict) -> bool:
    return booking.get("sales_owner_id") == user["id"]


def _is_crm(user: dict) -> bool:
    return user_role_code(user) == "CRM"


async def _find_task_by_key(db, journey_id: str, key: str) -> Optional[dict]:
    """Locate a task instance in a journey by its template `_key` field.

    There is one row per workflow_template (Villa + Apartment each have T1..T14),
    so we look up ALL templates with the given key and match against the journey's
    task_template_id.
    """
    templates = await db.workflow_task_templates.find({"_key": key}, {"_id": 0, "id": 1}).to_list(50)
    if not templates:
        return None
    ids = [t["id"] for t in templates]
    return await db.tasks.find_one(
        {"journey_id": journey_id, "task_template_id": {"$in": ids}},
        {"_id": 0},
    )


async def _validate_handover(db, doc: dict) -> dict[str, str]:
    """Return field→message dict; empty means valid."""
    errors: dict[str, str] = {}
    cs = doc.get("customer_section") or {}
    for k in ("applicant_details_confirmed", "contact_verified", "nri_status_confirmed", "communication_pref_confirmed"):
        if not cs.get(k):
            errors[f"customer_section.{k}"] = "must be confirmed"

    com = doc.get("commercial_section") or {}
    for k in ("final_price_inr", "booking_amount_inr"):
        if com.get(k) in (None, ""):
            errors[f"commercial_section.{k}"] = "required"
    if not (com.get("payment_plan_ref") or "").strip():
        errors["commercial_section.payment_plan_ref"] = "required"

    us = doc.get("unit_section") or {}
    if not us.get("unit_confirmed"):
        errors["unit_section.unit_confirmed"] = "must be confirmed"

    # At least Booking Form + Cost Sheet documents must be Received/Verified
    linked_ids = (doc.get("documents_section") or {}).get("linked_document_ids") or []
    if linked_ids:
        docs = await db.documents.find({"id": {"$in": linked_ids}}, {"_id": 0}).to_list(200)
        cats = {d["category"]: d for d in docs}
    else:
        cats = {}

    # Fallback: look at ALL customer+booking docs for the mandatory two categories
    async for d in db.documents.find(
        {"customer_id": doc["customer_id"], "booking_id": doc["booking_id"],
         "category": {"$in": ["Booking Form", "Cost Sheet"]}},
        {"_id": 0},
    ):
        cats.setdefault(d["category"], d)

    for cat in ("Booking Form", "Cost Sheet"):
        d = cats.get(cat)
        if not d or d.get("status") in (None, "Required", "Rejected"):
            errors[f"documents_section.{cat.lower().replace(' ', '_')}_uploaded"] = f"{cat} must be uploaded"

    return errors


# ---------------- Engine hooks — thin wrappers over engine_hooks module ----------------

async def _system_complete_task(db, task_id: str, actor_id: str, note: str = ""):
    await _system_complete_task_shared(task_id, actor_id, note=note)


async def _system_verify_task(db, task_id: str, actor_id: str):
    await _system_verify_task_shared(task_id, actor_id)


async def _system_reset_task_to_in_progress(db, task_id: str, actor_id: str, reason: str):
    await _system_reset_task_to_in_progress_shared(task_id, actor_id, reason=f"Handover returned: {reason}")


async def _post_task_comment(db, *, task_id: str, actor: dict, body: str, mention_user_ids: list[str] | None = None):
    return await _post_task_comment_shared(task_id=task_id, actor=actor, body=body, mention_user_ids=mention_user_ids)


async def _find_task_by_key(db, journey_id: str, key: str):
    return await _find_task_by_key_shared(journey_id, key)


async def _promote_commitments(db, handover: dict, actor: dict) -> list[dict]:
    """Turn each row in commitments_section.items into a real customer_commitments record."""
    from kernel.mongo import next_sequence
    out = []
    items = (handover.get("commitments_section") or {}).get("items") or []
    for it in items:
        if not (it.get("description") or "").strip():
            continue
        seq = await next_sequence("commitments")
        now = _now()
        delivery_status = "Awaiting Approval" if it.get("needs_approval") else "Draft"
        doc = {
            "id": str(uuid.uuid4()),
            "code": f"COM-{seq:06d}",
            "customer_id": handover["customer_id"],
            "booking_id": handover["booking_id"],
            "unit_id": None,
            "category": it.get("category") or "Other",
            "description": it["description"].strip(),
            "committed_by": actor["id"],
            "committed_date": now,
            "responsible_department_id": None,
            "owner_user_id": None,
            "target_date": it.get("target_date"),
            "financial_impact_inr": it.get("financial_impact_inr"),
            "approval_required": bool(it.get("needs_approval")),
            "approval_status": "Pending" if it.get("needs_approval") else "Not Required",
            "approver_user_id": None,
            "approved_at": None,
            "approval_notes": None,
            "delivery_status": delivery_status,
            "customer_confirmation_required": True,
            "customer_confirmed_at": None,
            "evidence_attachment_ids": [],
            "created_at": now,
            "updated_at": now,
        }
        await db.customer_commitments.insert_one(doc)
        await write_audit(
            user_id=actor["id"],
            entity_type="customer_commitment",
            entity_id=doc["id"],
            action="create",
            after=doc,
            parent_entity_type="customer",
            parent_entity_id=handover["customer_id"],
        )
        out.append(doc)
    return out


# ---------------- Endpoints ----------------

@router.get("")
async def list_handovers(
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
    docs = await db.sales_handovers.find(q, {"_id": 0}).sort("updated_at", -1).to_list(limit)
    if project_id:
        # filter after enrich (need booking.project_id)
        docs = [d for d in docs if (await db.bookings.find_one({"id": d["booking_id"]}, {"_id": 0, "project_id": 1}) or {}).get("project_id") == project_id]
    out = []
    for d in docs:
        out.append(await _enrich(db, d))
    return out


@router.get("/booking/{booking_id}")
async def get_or_create_by_booking(booking_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking["status"] != "Confirmed":
        raise HTTPException(status_code=404, detail="Sales handover only available for Confirmed bookings")
    await require_project_access_soft(current_user, booking.get("project_id"))

    existing = await _find_by_booking(db, booking_id)
    if not existing:
        existing = await _make_draft(db, booking, current_user["id"])
    return await _enrich(db, existing)


@router.get("/{handover_id}")
async def get_handover(handover_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.sales_handovers.find_one({"id": handover_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Handover not found")
    pid = await project_id_of_booking(doc["booking_id"])
    await require_project_access_soft(current_user, pid)
    return await _enrich(db, doc)


@router.patch("/{handover_id}")
async def patch_sections(handover_id: str, payload: SectionPayload, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.sales_handovers.find_one({"id": handover_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Handover not found")
    booking = await db.bookings.find_one({"id": doc["booking_id"]}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if doc["status"] not in ("Draft", "Returned"):
        raise HTTPException(status_code=400, detail=f"Cannot edit a handover in {doc['status']}")
    if not (is_super_admin(current_user) or _is_sales_owner(booking, current_user)):
        raise HTTPException(status_code=403, detail="Only the Sales owner or Super Admin can edit sections")

    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return await _enrich(db, doc)
    changes["updated_at"] = _now()
    before = dict(doc)
    await db.sales_handovers.update_one({"id": handover_id}, {"$set": changes})
    after = await db.sales_handovers.find_one({"id": handover_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="sales_handover",
        entity_id=handover_id,
        action="update",
        before=before,
        after=after,
        parent_entity_type="booking",
        parent_entity_id=doc["booking_id"],
    )
    return await _enrich(db, after)


@router.post("/{handover_id}/submit")
async def submit(handover_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.sales_handovers.find_one({"id": handover_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Handover not found")
    if doc["status"] not in ("Draft", "Returned"):
        raise HTTPException(status_code=400, detail=f"Cannot submit from {doc['status']}")
    booking = await db.bookings.find_one({"id": doc["booking_id"]}, {"_id": 0})
    if not (is_super_admin(current_user) or _is_sales_owner(booking, current_user)):
        raise HTTPException(status_code=403, detail="Only the Sales owner can submit")

    errors = await _validate_handover(db, doc)
    if errors:
        raise HTTPException(status_code=400, detail={"message": "Validation failed", "errors": errors})

    now = _now()
    before = dict(doc)
    await db.sales_handovers.update_one(
        {"id": handover_id},
        {"$set": {"status": "Submitted", "submitted_by": current_user["id"], "submitted_at": now,
                  "return_reason": None, "updated_at": now}},
    )
    after = await db.sales_handovers.find_one({"id": handover_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="sales_handover",
        entity_id=handover_id,
        action="update",
        before=before,
        after=after,
        parent_entity_type="booking",
        parent_entity_id=doc["booking_id"],
    )

    # Promote commitments
    promoted = await _promote_commitments(db, after, current_user)

    # Complete T1 in the journey
    journey = await db.customer_journeys.find_one({"booking_id": doc["booking_id"], "status": {"$in": ["Active", "OnHold"]}}, {"_id": 0})
    if journey:
        t1 = await _find_task_by_key(db, journey["id"], "T1")
        if t1:
            await _system_complete_task(db, t1["id"], current_user["id"], note="Handover submitted to CRM")

    result = await _enrich(db, after)
    result["_promoted_commitment_ids"] = [c["id"] for c in promoted]
    return result


@router.post("/{handover_id}/accept")
async def accept(handover_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.sales_handovers.find_one({"id": handover_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Handover not found")
    if doc["status"] != "Submitted":
        raise HTTPException(status_code=400, detail=f"Cannot accept from {doc['status']}")
    if not (is_super_admin(current_user) or _is_crm(current_user)):
        raise HTTPException(status_code=403, detail="Only CRM / Super Admin can accept")
    # Also block Sales owner even if they're CRM (defensive): submitter cannot accept
    if doc.get("submitted_by") == current_user["id"] and not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Submitter cannot accept their own handover")

    now = _now()
    before = dict(doc)
    await db.sales_handovers.update_one(
        {"id": handover_id},
        {"$set": {"status": "Accepted", "accepted_by": current_user["id"], "accepted_at": now, "updated_at": now}},
    )
    after = await db.sales_handovers.find_one({"id": handover_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="sales_handover",
        entity_id=handover_id,
        action="update",
        before=before,
        after=after,
        parent_entity_type="booking",
        parent_entity_id=doc["booking_id"],
    )

    # Drive T2 through submit + verify → Completed
    journey = await db.customer_journeys.find_one({"booking_id": doc["booking_id"], "status": {"$in": ["Active", "OnHold"]}}, {"_id": 0})
    if journey:
        t2 = await _find_task_by_key(db, journey["id"], "T2")
        if t2:
            await _system_verify_task(db, t2["id"], current_user["id"])
    return await _enrich(db, after)


@router.post("/{handover_id}/return")
async def return_for_clarification(handover_id: str, payload: ReturnPayload, current_user: dict = Depends(get_current_user)):
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Reason required")
    db = get_db()
    doc = await db.sales_handovers.find_one({"id": handover_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Handover not found")
    # Idempotency (spec): calling /return again on an already-Returned handover → 409
    if doc["status"] == "Returned":
        raise HTTPException(status_code=409, detail="Handover is already Returned")
    # Draft/Cancelled/Any other → 400. Accepted is now a valid source state
    # so CRM can send a handover back for clarification even after accepting.
    if doc["status"] not in ("Submitted", "Accepted"):
        raise HTTPException(status_code=400, detail=f"Cannot return from {doc['status']}")
    if not (is_super_admin(current_user) or _is_crm(current_user)):
        raise HTTPException(status_code=403, detail="Only CRM / Super Admin can return")
    if doc.get("submitted_by") == current_user["id"] and not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Submitter cannot return their own handover")

    reason = payload.reason.strip()
    now = _now()
    before = dict(doc)
    await db.sales_handovers.update_one(
        {"id": handover_id},
        {"$set": {"status": "Returned", "return_reason": reason,
                  "accepted_by": None, "accepted_at": None,
                  "updated_at": now}},
    )
    after = await db.sales_handovers.find_one({"id": handover_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="sales_handover",
        entity_id=handover_id,
        action="update",
        before=before,
        after=after,
        parent_entity_type="booking",
        parent_entity_id=doc["booking_id"],
    )

    # Move T2 back to In Progress + post a comment on its thread with the reason.
    journey = await db.customer_journeys.find_one(
        {"booking_id": doc["booking_id"], "status": {"$in": ["Active", "OnHold", "Closed"]}},
        {"_id": 0},
    )
    if journey:
        t2 = await _find_task_by_key(db, journey["id"], "T2")
        if t2:
            await _system_reset_task_to_in_progress(db, t2["id"], current_user["id"], reason)
            booking = await db.bookings.find_one({"id": doc["booking_id"]}, {"_id": 0}) or {}
            mentions = [booking["sales_owner_id"]] if booking.get("sales_owner_id") else []
            await _post_task_comment(
                db,
                task_id=t2["id"],
                actor=current_user,
                body=f"Handover returned for clarification: {reason}",
                mention_user_ids=mentions,
            )

    return await _enrich(db, after)


@router.get("/counts/awaiting-acceptance")
async def counts_awaiting(current_user: dict = Depends(get_current_user)):
    db = get_db()
    n = await db.sales_handovers.count_documents({"status": "Submitted"})
    return {"count": n}
