"""Unit Readiness (Phase 7 — lean).

One record per booking. 14 components with weights summing to 1.0.
`declare-ready-for-qa` cascades T11 when score ≥ 85 AND ≥ 2 photos.
`reset-ready` reverses T11 (and downstream T12/T13) via reverse cascade.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import (
    get_project_scope, is_all_projects_user, project_id_of_booking,
    require_project_access_soft, scoped_booking_ids, require_module_by_method
)
from kernel.collaboration.collaboration import ALLOWED_UPLOAD_EXTENSIONS, MAX_UPLOAD_BYTES, is_super_admin, user_role_code
from kernel.mongo import get_db, write_audit
from kernel.action.engine_hooks import find_journey_task_by_key, system_complete_task, system_reset_task_to_in_progress
from kernel.files.storage import save_upload_stream


router = APIRouter(prefix="", tags=["unit_readiness"], dependencies=[Depends(require_module_by_method("unit_readiness"))])

STORAGE_ROOT = Path(os.environ.get("ATTACHMENT_STORAGE_ROOT", "/app/backend/storage"))
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)

# 14 components per spec §54. Weights sum to 1.00.
COMPONENTS_SEED: list[dict] = [
    {"name": "Civil", "weight": 0.15},
    {"name": "Flooring", "weight": 0.10},
    {"name": "Doors", "weight": 0.05},
    {"name": "Windows", "weight": 0.05},
    {"name": "Painting", "weight": 0.10},
    {"name": "Electrical", "weight": 0.10},
    {"name": "Plumbing", "weight": 0.10},
    {"name": "Sanitary", "weight": 0.05},
    {"name": "Kitchen", "weight": 0.10},
    {"name": "HVAC", "weight": 0.05},
    {"name": "Utilities", "weight": 0.05},
    {"name": "External Works", "weight": 0.05},
    {"name": "Cleaning", "weight": 0.03},
    {"name": "Common Area Dependencies", "weight": 0.02},
]
COMPONENT_NAMES = {c["name"] for c in COMPONENTS_SEED}


def _now() -> str: return datetime.now(timezone.utc).isoformat()
def _uid() -> str: return str(uuid.uuid4())


def _can_manage(user: dict) -> bool:
    return is_super_admin(user) or user_role_code(user) in {"SITE", "MANAGEMENT"}


def _compute_score(components: list[dict]) -> float:
    return round(sum((c.get("percent") or 0) * (c.get("weight") or 0) for c in components), 2)


async def _enrich(doc: dict) -> dict:
    doc = dict(doc)
    doc["overall_score"] = _compute_score(doc.get("components", []))
    return doc


class ComponentUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    component_name: str
    percent: int
    notes: Optional[str] = None


class DeclareReadyPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    site_engineer_name: str
    ready_notes: Optional[str] = None


async def _find_journey_id(db, booking_id: str) -> Optional[str]:
    j = await db.customer_journeys.find_one(
        {"booking_id": booking_id, "status": {"$in": ["Active", "OnHold", "Closed"]}},
        {"_id": 0, "id": 1},
    )
    return (j or {}).get("id")


@router.get("/unit-readiness/booking/{booking_id}")
async def get_ur_for_booking(booking_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking["status"] != "Confirmed":
        raise HTTPException(status_code=404, detail="Unit Readiness only for Confirmed bookings")
    await require_project_access_soft(current_user, booking.get("project_id"))
    doc = await db.unit_readiness.find_one({"booking_id": booking_id}, {"_id": 0})
    if not doc:
        doc = {
            "id": _uid(),
            "booking_id": booking_id,
            "components": [{"name": c["name"], "weight": c["weight"], "percent": 0, "notes": None} for c in COMPONENTS_SEED],
            "site_engineer_user_id": None,
            "site_engineer_name": None,
            "ready_declared_at": None,
            "ready_notes": None,
            "ready_for_qa": False,
            "photo_attachment_ids": [],
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.unit_readiness.insert_one(doc)
        doc.pop("_id", None)
        await write_audit(user_id=current_user["id"], entity_type="unit_readiness", entity_id=doc["id"],
                          action="create", after=doc,
                          parent_entity_type="booking", parent_entity_id=booking_id)
    return await _enrich(doc)


@router.patch("/unit-readiness/{urid}/component")
async def patch_component(urid: str, payload: ComponentUpdate, current_user: dict = Depends(get_current_user)):
    if not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="Only Site / Management / Super Admin can update readiness components")
    if payload.component_name not in COMPONENT_NAMES:
        raise HTTPException(status_code=400, detail=f"Unknown component: {payload.component_name}")
    if not (0 <= payload.percent <= 100):
        raise HTTPException(status_code=400, detail="percent must be between 0 and 100")
    db = get_db()
    doc = await db.unit_readiness.find_one({"id": urid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Unit Readiness record not found")
    before = dict(doc)
    comps = list(doc.get("components", []))
    for c in comps:
        if c["name"] == payload.component_name:
            c["percent"] = payload.percent
            if payload.notes is not None:
                c["notes"] = payload.notes.strip() or None
            break
    await db.unit_readiness.update_one({"id": urid}, {"$set": {"components": comps, "updated_at": _now()}})
    after = await db.unit_readiness.find_one({"id": urid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="unit_readiness", entity_id=urid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return await _enrich(after)


@router.post("/unit-readiness/{urid}/upload-photo")
async def upload_photo(urid: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    if not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="Only Site / Management / Super Admin can upload readiness photos")
    db = get_db()
    doc = await db.unit_readiness.find_one({"id": urid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Unit Readiness record not found")
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
            "entity_type": "unit_readiness",
            "entity_id": urid,
        },
    )
    att = {
        "id": attachment_id, "entity_type": "unit_readiness", "entity_id": urid, "comment_id": None,
        "filename": filename, "storage_path": None,
        "gridfs_file_id": gridfs_id, "storage_backend": "gridfs", "file_missing": False,
        "mime_type": content_type, "size_bytes": size,
        "category": "Snag", "version": 1, "visibility": "Internal", "description": None,
        "uploaded_by": current_user["id"], "uploaded_at": _now(),
        "verification_status": "Uploaded", "verified_by": None, "verified_at": None,
        "verification_notes": None, "deleted_at": None,
    }
    await db.attachments.insert_one(att)
    att.pop("_id", None)
    before = dict(doc)
    ids = list(doc.get("photo_attachment_ids", [])) + [att["id"]]
    await db.unit_readiness.update_one({"id": urid}, {"$set": {"photo_attachment_ids": ids, "updated_at": _now()}})
    after = await db.unit_readiness.find_one({"id": urid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="unit_readiness", entity_id=urid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    return {"attachment": att, "record": await _enrich(after)}


@router.post("/unit-readiness/{urid}/declare-ready-for-qa")
async def declare_ready(urid: str, payload: DeclareReadyPayload, current_user: dict = Depends(get_current_user)):
    if not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="Only Site / Management / Super Admin can declare Ready-for-QA")
    if not payload.site_engineer_name.strip():
        raise HTTPException(status_code=400, detail="site_engineer_name required")
    db = get_db()
    doc = await db.unit_readiness.find_one({"id": urid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    if doc.get("ready_for_qa"):
        raise HTTPException(status_code=400, detail="Already declared Ready-for-QA. Use reset-ready to reverse.")
    score = _compute_score(doc.get("components", []))
    if score < 85:
        raise HTTPException(status_code=400, detail=f"Cannot declare ready: overall score {score:.1f} < 85")
    if len(doc.get("photo_attachment_ids", [])) < 2:
        raise HTTPException(status_code=400, detail="Cannot declare ready: at least 2 readiness photos required")
    before = dict(doc)
    now = _now()
    await db.unit_readiness.update_one({"id": urid}, {"$set": {
        "ready_for_qa": True,
        "site_engineer_user_id": current_user["id"],
        "site_engineer_name": payload.site_engineer_name.strip(),
        "ready_notes": (payload.ready_notes or "").strip() or None,
        "ready_declared_at": now,
        "updated_at": now,
    }})
    after = await db.unit_readiness.find_one({"id": urid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="unit_readiness", entity_id=urid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    # Cascade T11
    jid = await _find_journey_id(db, doc["booking_id"])
    if jid:
        t11 = await find_journey_task_by_key(jid, "T11")
        if t11:
            await system_complete_task(t11["id"], current_user["id"], note="Site declared Ready-for-QA")
    return await _enrich(after)


@router.post("/unit-readiness/{urid}/reset-ready")
async def reset_ready(urid: str, current_user: dict = Depends(get_current_user)):
    if not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only Super Admin can reset Ready-for-QA")
    db = get_db()
    doc = await db.unit_readiness.find_one({"id": urid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    if not doc.get("ready_for_qa"):
        raise HTTPException(status_code=400, detail="Not currently declared Ready-for-QA")
    before = dict(doc)
    await db.unit_readiness.update_one({"id": urid}, {"$set": {
        "ready_for_qa": False,
        "ready_declared_at": None,
        "ready_notes": None,
        "updated_at": _now(),
    }})
    after = await db.unit_readiness.find_one({"id": urid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="unit_readiness", entity_id=urid,
                      action="update", before=before, after=after,
                      parent_entity_type="booking", parent_entity_id=doc["booking_id"])
    # Reverse cascade T11 (which reverse-cascades T12/T13 automatically via workflow_engine)
    jid = await _find_journey_id(db, doc["booking_id"])
    if jid:
        t11 = await find_journey_task_by_key(jid, "T11")
        if t11 and t11["status"] == "Completed":
            await system_reset_task_to_in_progress(t11["id"], current_user["id"], reason="Site reset Ready-for-QA")
    return await _enrich(after)


@router.get("/unit-readiness")
async def list_ur(
    project_id: Optional[str] = None,
    ready_for_qa: Optional[bool] = None,
    limit: int = Query(500, ge=1, le=2000),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q: dict = {}
    if ready_for_qa is not None:
        q["ready_for_qa"] = ready_for_qa
    # Phase 9 scope
    if not is_all_projects_user(current_user):
        bids = await scoped_booking_ids(current_user)
        if not bids: return []
        q["booking_id"] = {"$in": bids}
    docs = await db.unit_readiness.find(q, {"_id": 0}).sort("updated_at", -1).to_list(limit)
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
        d = await _enrich(d)
        d["_booking"] = {"id": b.get("id"), "code": b.get("code")}
        d["_customer"] = customers.get(b.get("customer_id"), {})
        d["_project"] = projects.get(b.get("project_id"), {})
        d["_unit"] = units.get(b.get("unit_id"), {})
        out.append(d)
    return out


@router.get("/unit-readiness/counts/near-ready")
async def count_near_ready(current_user: dict = Depends(get_current_user)):
    """Overall score ≥ 85 AND ready_for_qa = false."""
    db = get_db()
    docs = await db.unit_readiness.find({"ready_for_qa": False}, {"_id": 0}).to_list(2000)
    n = sum(1 for d in docs if _compute_score(d.get("components", [])) >= 85)
    return {"count": n}
