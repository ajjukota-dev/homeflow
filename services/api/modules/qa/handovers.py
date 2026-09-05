"""Handovers (Phase 7 — lean).

One record per booking. Auto-created on first GET for a Confirmed booking.
Readiness score computed from 6 contributors. gate_status Green/Amber/Red.
record-acknowledgement cascades T13 + sets unit.status=Handed Over.
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
from kernel.mongo import get_db, write_audit
from kernel.action.engine_hooks import find_journey_task_by_key, system_complete_task
from kernel.files.storage import save_upload_stream


router = APIRouter(prefix="", tags=["handovers"], dependencies=[Depends(require_module_by_method("handovers"))])

STORAGE_ROOT = Path(os.environ.get("ATTACHMENT_STORAGE_ROOT", "/app/backend/storage"))
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)

WEIGHTS = {
    "finance": 0.20, "registration": 0.20, "readiness": 0.25,
    "snagging": 0.15, "documents": 0.10, "commitments": 0.10,
}


def _now() -> str: return datetime.now(timezone.utc).isoformat()
def _uid() -> str: return str(uuid.uuid4())


def _can_handover(user: dict) -> bool:
    return is_super_admin(user) or user_role_code(user) in {"HANDOVER", "MANAGEMENT"}


def _can_override(user: dict) -> bool:
    return is_super_admin(user) or user_role_code(user) == "MANAGEMENT"


async def _readiness_score(db, booking_id: str) -> dict:
    """Return {readiness_score, gate_status, gate_blockers, contributors}."""
    fc = await db.financial_clearances.find_one({"booking_id": booking_id}, {"_id": 0})
    reg = await db.registrations.find_one({"booking_id": booking_id}, {"_id": 0})
    ur = await db.unit_readiness.find_one({"booking_id": booking_id}, {"_id": 0})
    snags = await db.snags.find({"booking_id": booking_id, "severity": "Critical"}, {"_id": 0, "status": 1}).to_list(500)
    documents = await db.documents.find({"booking_id": booking_id}, {"_id": 0, "applicability": 1, "required": 1, "status": 1}).to_list(500)
    commitments = await db.customer_commitments.find({"booking_id": booking_id}, {"_id": 0, "delivery_status": 1}).to_list(500)

    # Finance
    fc_ready = (fc or {}).get("status") == "Approved"
    finance_score = 100 if fc_ready else 0

    # Registration
    reg_status = (reg or {}).get("status", "Not Started")
    reg_ready = reg_status in {"Slot Booked", "Executed", "Closed"}
    reg_score = 100 if reg_ready else 0

    # Unit Readiness
    ur_score = 0.0
    ur_pct = 0.0
    if ur:
        ur_pct = round(sum((c.get("percent") or 0) * (c.get("weight") or 0) for c in ur.get("components", [])), 2)
        ur_score = ur_pct
    ur_ready = ur_pct >= 85

    # Snagging
    critical_open = sum(1 for s in snags if s.get("status") != "Closed")
    snag_score = 100 if critical_open == 0 else 0
    snag_ready = critical_open == 0

    # Documents — required + applicable and Verified
    mandatory = [d for d in documents if d.get("required") and (d.get("applicability") or "Applicable") == "Applicable"]
    if mandatory:
        verified = sum(1 for d in mandatory if d.get("status") == "Verified")
        doc_score = round(100 * verified / max(1, len(mandatory)), 1)
        doc_ready = verified == len(mandatory)
    else:
        doc_score, doc_ready = 100.0, True

    # Commitments
    open_count = sum(1 for c in commitments if c.get("delivery_status") in {"Awaiting Approval", "In Progress"})
    if open_count == 0:
        commit_score = 100.0
    else:
        commit_score = max(0.0, 100 - min(open_count * 20, 100))
    commit_ready = open_count == 0

    readiness_score = round(
        finance_score * WEIGHTS["finance"]
        + reg_score * WEIGHTS["registration"]
        + ur_score * WEIGHTS["readiness"]
        + snag_score * WEIGHTS["snagging"]
        + doc_score * WEIGHTS["documents"]
        + commit_score * WEIGHTS["commitments"],
        1,
    )

    blockers: list[str] = []
    if not fc_ready: blockers.append("Financial clearance not Approved")
    if not reg_ready: blockers.append(f"Registration status is {reg_status} (need Slot Booked / Executed / Closed)")
    if not ur_ready: blockers.append(f"Unit readiness at {ur_pct:.0f}% (need ≥ 85%)")
    if critical_open: blockers.append(f"{critical_open} critical snag(s) still open")
    if not doc_ready: blockers.append("Mandatory documents not all Verified")
    if not commit_ready: blockers.append(f"{open_count} commitment(s) still open")

    critical_blockers = [b for b in blockers if b.startswith(("Financial", "Registration", "Unit readiness")) or "critical snag" in b]

    return {
        "readiness_score": readiness_score,
        "gate_blockers": blockers,
        "gate_ready": all([fc_ready, reg_ready, ur_ready, snag_ready, doc_ready, commit_ready]),
        "critical_blocker": bool(critical_blockers),
        "contributors": {
            "finance": {"score": finance_score, "ready": fc_ready},
            "registration": {"score": reg_score, "ready": reg_ready, "status": reg_status},
            "readiness": {"score": ur_score, "ready": ur_ready},
            "snagging": {"score": snag_score, "ready": snag_ready, "critical_open": critical_open},
            "documents": {"score": doc_score, "ready": doc_ready},
            "commitments": {"score": commit_score, "ready": commit_ready, "open_count": open_count},
        },
    }


def _apply_override(computed: dict, override: Optional[dict]) -> dict:
    bypassed = set((override or {}).get("mandatory_gates_bypassed") or [])
    blockers = [b for b in computed["gate_blockers"] if not any(g.lower() in b.lower() for g in bypassed)]
    critical_blocker = computed["critical_blocker"] and not any(g.lower() in "financial registration unit critical" for g in bypassed)
    score = computed["readiness_score"]
    if score >= 90 and not blockers:
        gate = "Green"
    elif score < 70 or critical_blocker:
        gate = "Red"
    else:
        gate = "Amber"
    if override and gate == "Red":
        # Override forces at minimum to Amber (never Green unless truly ready)
        gate = "Amber"
    return {"gate_status": gate, "gate_blockers": blockers, "critical_blocker_effective": critical_blocker}


async def _enrich(db, doc: dict) -> dict:
    doc = dict(doc)
    r = await _readiness_score(db, doc["booking_id"])
    doc["readiness_score"] = r["readiness_score"]
    ov = _apply_override(r, doc.get("override"))
    doc["gate_status"] = ov["gate_status"]
    doc["gate_blockers"] = ov["gate_blockers"]
    doc["contributors"] = r["contributors"]
    # Derived status label
    if doc.get("status") not in {"Executed", "Closed"}:
        if doc.get("scheduled", {}).get("final_date"):
            doc["status"] = "Ready" if ov["gate_status"] == "Green" else "Scheduling"
        elif doc.get("scheduled", {}).get("proposed_date"):
            doc["status"] = "Scheduling"
        else:
            doc["status"] = "Not Started"
    return doc


class SchedulePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    proposed_date: str
    customer_preferred_date: Optional[str] = None
    location: Optional[str] = None
    internal_rep_user_id: Optional[str] = None


class SetFinalDatePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    final_date: str
    final_time: str
    reason: str


class OverridePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str
    mandatory_gates_bypassed: list[str]


class ChecklistPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    property: Optional[dict] = None
    keys: Optional[dict] = None
    access: Optional[dict] = None
    utilities: Optional[dict] = None
    documents: Optional[dict] = None


class PostHandoverPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    facility_intro_done: Optional[bool] = None
    maintenance_setup_done: Optional[bool] = None
    owner_record_transferred: Optional[bool] = None
    warranties_shared: Optional[bool] = None
    pending_snag_monitoring: Optional[bool] = None


async def _get_or_404(db, hid: str) -> dict:
    doc = await db.handovers.find_one({"id": hid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Handover not found")
    return doc


def _empty_handover(booking_id: str) -> dict:
    return {
        "id": _uid(), "booking_id": booking_id,
        "override": None,
        "scheduled": {"proposed_date": None, "customer_preferred_date": None, "final_date": None, "final_time": None,
                      "location": None, "customer_confirmation": False, "internal_rep_user_id": None},
        "date_revision_history": [],
        "checklist": {
            "property": {"cleaning": False, "electrical": False, "plumbing": False, "fixtures": False, "doors_windows": False, "snag_clearance": False},
            "keys": {"main_door_count": 0, "secondary_count": 0, "utility_count": 0, "other_count": 0, "all_handed_over": False},
            "access": {"access_cards_count": 0, "parking_slot_ids": [], "clubhouse_confirmed": False, "security_briefed": False},
            "utilities": {"electricity_meter_no": None, "electricity_reading": None, "water_meter_no": None, "water_reading": None, "other_notes": None},
            "documents": {"possession_letter": False, "warranties": False, "manuals": False, "registration_copy": False, "maintenance_docs": False, "contact_directory": False},
        },
        "acknowledgement": None,
        "post_handover": {"facility_intro_done": False, "maintenance_setup_done": False, "owner_record_transferred": False,
                          "warranties_shared": False, "pending_snag_monitoring": False, "closure_confirmed_at": None},
        "status": "Not Started",
        "created_at": _now(), "updated_at": _now(),
    }


@router.get("/handovers/booking/{booking_id}")
async def get_handover(booking_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking["status"] != "Confirmed":
        raise HTTPException(status_code=404, detail="Handover only for Confirmed bookings")
    await require_project_access_soft(current_user, booking.get("project_id"))
    doc = await db.handovers.find_one({"booking_id": booking_id}, {"_id": 0})
    if not doc:
        doc = _empty_handover(booking_id)
        await db.handovers.insert_one(doc)
        doc.pop("_id", None)
        await write_audit(user_id=current_user["id"], entity_type="handover", entity_id=doc["id"],
                          action="create", after=doc,
                          parent_entity_type="booking", parent_entity_id=booking_id)
    return await _enrich(db, doc)


@router.post("/handovers/{hid}/schedule")
async def schedule_handover(hid: str, payload: SchedulePayload, current_user: dict = Depends(get_current_user)):
    if not _can_handover(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, hid)
    before = dict(doc)
    sc = dict(doc.get("scheduled", {}))
    sc.update({
        "proposed_date": payload.proposed_date,
        "customer_preferred_date": payload.customer_preferred_date,
        "location": payload.location,
        "internal_rep_user_id": payload.internal_rep_user_id,
    })
    await db.handovers.update_one({"id": hid}, {"$set": {"scheduled": sc, "updated_at": _now()}})
    after = await db.handovers.find_one({"id": hid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="handover", entity_id=hid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return await _enrich(db, after)


@router.post("/handovers/{hid}/set-final-date")
async def set_final_date(hid: str, payload: SetFinalDatePayload, current_user: dict = Depends(get_current_user)):
    if not _can_handover(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="reason required")
    db = get_db()
    doc = await _get_or_404(db, hid)
    before = dict(doc)
    prev_date = doc.get("scheduled", {}).get("final_date")
    hist = list(doc.get("date_revision_history", []))
    if prev_date and prev_date != payload.final_date:
        hist.append({
            "field_name": "final_date",
            "previous_value": prev_date,
            "new_value": payload.final_date,
            "reason": payload.reason.strip(),
            "changed_by": current_user["id"],
            "changed_at": _now(),
        })
    elif not prev_date:
        hist.append({
            "field_name": "final_date",
            "previous_value": None,
            "new_value": payload.final_date,
            "reason": payload.reason.strip(),
            "changed_by": current_user["id"],
            "changed_at": _now(),
        })
    sc = dict(doc.get("scheduled", {}))
    sc.update({"final_date": payload.final_date, "final_time": payload.final_time})
    await db.handovers.update_one({"id": hid}, {"$set": {"scheduled": sc, "date_revision_history": hist, "updated_at": _now()}})
    after = await db.handovers.find_one({"id": hid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="handover", entity_id=hid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return await _enrich(db, after)


@router.post("/handovers/{hid}/customer-confirm-date")
async def customer_confirm_date(hid: str, current_user: dict = Depends(get_current_user)):
    if not (is_super_admin(current_user) or user_role_code(current_user) in {"CRM", "HANDOVER", "MANAGEMENT"}):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, hid)
    sc = dict(doc.get("scheduled", {}))
    sc["customer_confirmation"] = True
    before = dict(doc)
    await db.handovers.update_one({"id": hid}, {"$set": {"scheduled": sc, "updated_at": _now()}})
    after = await db.handovers.find_one({"id": hid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="handover", entity_id=hid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return await _enrich(db, after)


@router.patch("/handovers/{hid}/checklist")
async def patch_checklist(hid: str, payload: ChecklistPatch, current_user: dict = Depends(get_current_user)):
    if not _can_handover(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, hid)
    cl = dict(doc.get("checklist", {}))
    changes = payload.model_dump(exclude_unset=True)
    for section, updates in changes.items():
        if not updates: continue
        merged = dict(cl.get(section, {}))
        merged.update(updates)
        cl[section] = merged
    before = dict(doc)
    await db.handovers.update_one({"id": hid}, {"$set": {"checklist": cl, "updated_at": _now()}})
    after = await db.handovers.find_one({"id": hid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="handover", entity_id=hid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return await _enrich(db, after)


@router.post("/handovers/{hid}/record-acknowledgement")
async def record_acknowledgement(
    hid: str,
    customer_confirmed_by_name: str = Form(...),
    agreed_open_items: Optional[str] = Form(None),
    comments: Optional[str] = Form(None),
    signature_file: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user),
):
    if not _can_handover(current_user):
        raise HTTPException(status_code=403, detail="Only Handover / Super Admin can record acknowledgement")
    if not customer_confirmed_by_name.strip():
        raise HTTPException(status_code=400, detail="customer_confirmed_by_name required")
    db = get_db()
    doc = await _get_or_404(db, hid)
    if doc.get("status") in {"Executed", "Closed"}:
        raise HTTPException(status_code=400, detail=f"Handover already {doc['status']}")
    enr = await _enrich(db, doc)
    if enr["gate_status"] != "Green" and not doc.get("override"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot record acknowledgement: gate is {enr['gate_status']}. Blockers: {'; '.join(enr['gate_blockers'])}",
        )

    sig_id = None
    if signature_file and signature_file.filename:
        filename = os.path.basename(signature_file.filename)
        ext = os.path.splitext(filename)[1].lower()
        if ext in ALLOWED_UPLOAD_EXTENSIONS:
            attachment_id = _uid()
            content_type = signature_file.content_type or "application/octet-stream"
            gridfs_id, size = await save_upload_stream(
                signature_file,
                max_bytes=MAX_UPLOAD_BYTES,
                filename=filename,
                content_type=content_type,
                metadata={
                    "attachment_id": attachment_id,
                    "uploaded_by": current_user["id"],
                    "entity_type": "handover",
                    "entity_id": hid,
                },
            )
            att = {
                "id": attachment_id, "entity_type": "handover", "entity_id": hid, "comment_id": None,
                "filename": filename, "storage_path": None,
                "gridfs_file_id": gridfs_id, "storage_backend": "gridfs", "file_missing": False,
                "mime_type": content_type, "size_bytes": size,
                "category": "Handover", "version": 1, "visibility": "Internal", "description": "customer signature",
                "uploaded_by": current_user["id"], "uploaded_at": _now(),
                "verification_status": "Uploaded", "verified_by": None, "verified_at": None,
                "verification_notes": None, "deleted_at": None,
            }
            await db.attachments.insert_one(att)
            att.pop("_id", None)
            sig_id = att["id"]

    now = _now()
    before = dict(doc)
    ack = {
        "customer_confirmed_by_name": customer_confirmed_by_name.strip(),
        "customer_confirmed_by_signature_attachment_id": sig_id,
        "customer_confirmed_at": now,
        "agreed_open_items": (agreed_open_items or "").strip() or None,
        "comments": (comments or "").strip() or None,
    }
    await db.handovers.update_one({"id": hid}, {"$set": {
        "acknowledgement": ack,
        "status": "Executed",
        "updated_at": now,
    }})
    after = await db.handovers.find_one({"id": hid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="handover", entity_id=hid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    # Cascade T13
    j = await db.customer_journeys.find_one({"booking_id": doc["booking_id"]}, {"_id": 0, "id": 1})
    if j:
        t13 = await find_journey_task_by_key(j["id"], "T13")
        if t13:
            await system_complete_task(t13["id"], current_user["id"], note="Customer acknowledgement recorded")
    # Flip unit status
    booking = await db.bookings.find_one({"id": doc["booking_id"]}, {"_id": 0})
    if booking:
        await db.units.update_one({"id": booking["unit_id"]}, {"$set": {"status": "Handed Over"}})
    return await _enrich(db, after)


@router.post("/handovers/{hid}/override")
async def override_handover(hid: str, payload: OverridePayload, current_user: dict = Depends(get_current_user)):
    if not _can_override(current_user):
        raise HTTPException(status_code=403, detail="Only Super Admin / Management can override")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="reason required")
    db = get_db()
    doc = await _get_or_404(db, hid)
    ov = {
        "by_user_id": current_user["id"],
        "reason": payload.reason.strip(),
        "override_at": _now(),
        "mandatory_gates_bypassed": payload.mandatory_gates_bypassed,
    }
    before = dict(doc)
    await db.handovers.update_one({"id": hid}, {"$set": {"override": ov, "updated_at": _now()}})
    after = await db.handovers.find_one({"id": hid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="handover", entity_id=hid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return await _enrich(db, after)


@router.post("/handovers/{hid}/clear-override")
async def clear_override(hid: str, current_user: dict = Depends(get_current_user)):
    if not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only Super Admin")
    db = get_db()
    doc = await _get_or_404(db, hid)
    before = dict(doc)
    await db.handovers.update_one({"id": hid}, {"$set": {"override": None, "updated_at": _now()}})
    after = await db.handovers.find_one({"id": hid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="handover", entity_id=hid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return await _enrich(db, after)


@router.patch("/handovers/{hid}/post-handover")
async def patch_post_handover(hid: str, payload: PostHandoverPatch, current_user: dict = Depends(get_current_user)):
    if not (is_super_admin(current_user) or user_role_code(current_user) in {"HANDOVER", "FACILITY", "MANAGEMENT"}):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, hid)
    ph = dict(doc.get("post_handover", {}))
    changes = payload.model_dump(exclude_unset=True)
    ph.update({k: v for k, v in changes.items() if v is not None})
    before = dict(doc)
    await db.handovers.update_one({"id": hid}, {"$set": {"post_handover": ph, "updated_at": _now()}})
    after = await db.handovers.find_one({"id": hid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="handover", entity_id=hid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return await _enrich(db, after)


@router.post("/handovers/{hid}/close")
async def close_handover(hid: str, current_user: dict = Depends(get_current_user)):
    if not _can_handover(current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    doc = await _get_or_404(db, hid)
    if doc.get("status") != "Executed":
        raise HTTPException(status_code=400, detail=f"Cannot close from status {doc.get('status')}")
    ph = doc.get("post_handover", {})
    mandatory = ["facility_intro_done", "maintenance_setup_done", "owner_record_transferred", "warranties_shared", "pending_snag_monitoring"]
    missing = [k for k in mandatory if not ph.get(k)]
    if missing:
        raise HTTPException(status_code=400, detail=f"Cannot close: post-handover incomplete — {', '.join(missing)}")
    now = _now()
    ph["closure_confirmed_at"] = now
    before = dict(doc)
    await db.handovers.update_one({"id": hid}, {"$set": {"post_handover": ph, "status": "Closed", "updated_at": now}})
    after = await db.handovers.find_one({"id": hid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="handover", entity_id=hid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return await _enrich(db, after)


@router.get("/handovers")
async def list_handovers(
    gate_status: Optional[str] = None,
    status: Optional[str] = None,
    project_id: Optional[str] = None,
    at_risk: bool = False,
    ready: bool = False,
    executed: bool = False,
    limit: int = Query(500, ge=1, le=2000),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q: dict = {}
    if status:
        q["status"] = status
    if executed:
        q["status"] = {"$in": ["Executed", "Closed"]}
    # Phase 9 scope
    if not is_all_projects_user(current_user):
        bids = await scoped_booking_ids(current_user)
        if not bids: return []
        q["booking_id"] = {"$in": bids}
    docs = await db.handovers.find(q, {"_id": 0}).sort("updated_at", -1).to_list(limit)
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
    out = []
    for d in docs:
        b = bookings.get(d["booking_id"], {})
        d = await _enrich(db, d)
        d["_booking"] = {"id": b.get("id"), "code": b.get("code")}
        d["_customer"] = customers.get(b.get("customer_id"), {})
        d["_project"] = projects.get(b.get("project_id"), {})
        d["_unit"] = units.get(b.get("unit_id"), {})
        if gate_status and d["gate_status"] != gate_status:
            continue
        if ready and not (d["gate_status"] == "Green" and d.get("status") in {"Not Started", "Scheduling", "Ready"}):
            continue
        if at_risk and d["gate_status"] not in {"Amber", "Red"}:
            continue
        out.append(d)
    return out


@router.get("/handovers/counts/ready-this-month")
async def count_ready_this_month(current_user: dict = Depends(get_current_user)):
    db = get_db()
    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    if now.month == 12:
        nm = now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        nm = now.replace(month=now.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
    end = nm.isoformat()
    docs = await db.handovers.find({"scheduled.final_date": {"$gte": start, "$lt": end}}, {"_id": 0}).to_list(500)
    n = 0
    for d in docs:
        r = await _enrich(db, d)
        if r["gate_status"] == "Green":
            n += 1
    return {"count": n}


@router.get("/handovers/counts/at-risk")
async def count_at_risk(current_user: dict = Depends(get_current_user)):
    db = get_db()
    now = datetime.now(timezone.utc)
    horizon = (now.replace(hour=0, minute=0, second=0, microsecond=0)).isoformat()
    end = (now.replace(hour=0, minute=0, second=0, microsecond=0) + __import__("datetime").timedelta(days=30)).isoformat()
    docs = await db.handovers.find({"scheduled.final_date": {"$gte": horizon, "$lt": end}}, {"_id": 0}).to_list(500)
    n = 0
    for d in docs:
        r = await _enrich(db, d)
        if r["gate_status"] in {"Amber", "Red"}:
            n += 1
    return {"count": n}
