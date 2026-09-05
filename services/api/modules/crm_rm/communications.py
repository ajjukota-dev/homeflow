"""Communications router (Phase 8 lean)."""
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
    is_all_projects_user, require_customer_access, require_customer_access_soft,
    scoped_customer_ids, require_module_by_method
)
from kernel.collaboration.collaboration import ALLOWED_UPLOAD_EXTENSIONS, MAX_UPLOAD_BYTES, is_super_admin, user_role_code
from kernel.mongo import get_db, next_sequence, write_audit
from kernel.files.storage import save_upload_stream


router = APIRouter(prefix="", tags=["communications"], dependencies=[Depends(require_module_by_method("communications"))])

STORAGE_ROOT = Path(os.environ.get("ATTACHMENT_STORAGE_ROOT", "/app/backend/storage"))
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)

CHANNELS = {"Phone", "Email", "WhatsApp", "SMS", "Meeting", "In-person", "Portal"}
DIRECTIONS = {"Inbound", "Outbound"}


def _now(): return datetime.now(timezone.utc).isoformat()
def _uid(): return str(uuid.uuid4())


def _can_set_visible(user: dict) -> bool:
    return is_super_admin(user) or user_role_code(user) in {"CRM", "MANAGEMENT"}


class UpdatePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    subject: Optional[str] = None
    summary: Optional[str] = None
    follow_up_required: Optional[bool] = None
    follow_up_date: Optional[str] = None
    follow_up_owner_user_id: Optional[str] = None
    customer_visible: Optional[bool] = None


@router.post("/communications")
async def create_comm(
    customer_id: str = Form(...),
    booking_id: Optional[str] = Form(None),
    channel: str = Form(...),
    direction: str = Form(...),
    subject: str = Form(...),
    summary: str = Form(...),
    communicated_at: Optional[str] = Form(None),
    follow_up_required: bool = Form(False),
    follow_up_date: Optional[str] = Form(None),
    follow_up_owner_user_id: Optional[str] = Form(None),
    customer_visible: bool = Form(False),
    department_id: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user),
):
    if channel not in CHANNELS: raise HTTPException(status_code=400, detail=f"Invalid channel: {channel}")
    if direction not in DIRECTIONS: raise HTTPException(status_code=400, detail=f"Invalid direction: {direction}")
    if not subject.strip() or not summary.strip():
        raise HTTPException(status_code=400, detail="subject and summary required")
    if customer_visible and not _can_set_visible(current_user):
        raise HTTPException(status_code=403, detail="Only CRM / Management / Super Admin can set customer_visible=true")
    db = get_db()
    cust = await db.customers.find_one({"id": customer_id}, {"_id": 0, "id": 1})
    if not cust: raise HTTPException(status_code=400, detail="Invalid customer")
    # Phase 9 write guard
    await require_customer_access(current_user, customer_id)

    cid = _uid()
    attachment_ids: list[str] = []
    if file and file.filename:
        filename = os.path.basename(file.filename)
        ext = os.path.splitext(filename)[1].lower()
        if ext in ALLOWED_UPLOAD_EXTENSIONS:
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
                    "entity_type": "communication",
                    "entity_id": cid,
                },
            )
            att = {
                "id": attachment_id, "entity_type": "communication", "entity_id": cid, "comment_id": None,
                "filename": filename, "storage_path": None,
                "gridfs_file_id": gridfs_id, "storage_backend": "gridfs", "file_missing": False,
                "mime_type": content_type, "size_bytes": size,
                "category": "Communication", "version": 1, "visibility": "Internal", "description": subject.strip(),
                "uploaded_by": current_user["id"], "uploaded_at": _now(),
                "verification_status": "Uploaded", "verified_by": None, "verified_at": None,
                "verification_notes": None, "deleted_at": None,
            }
            await db.attachments.insert_one(att)
            attachment_ids.append(att["id"])

    seq = await next_sequence("communication")
    now = _now()
    doc = {
        "id": cid, "code": f"COM-{seq:06d}",
        "customer_id": customer_id, "booking_id": booking_id,
        "channel": channel, "direction": direction,
        "subject": subject.strip(), "summary": summary.strip(),
        "employee_user_id": current_user["id"],
        "department_id": department_id or current_user.get("department_id"),
        "communicated_at": communicated_at or now,
        "follow_up_required": follow_up_required,
        "follow_up_date": follow_up_date,
        "follow_up_owner_user_id": follow_up_owner_user_id,
        "customer_visible": customer_visible,
        "attachment_ids": attachment_ids,
        "created_at": now, "updated_at": now,
    }
    await db.communications.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user_id=current_user["id"], entity_type="communication", entity_id=cid,
                      action="create", after=doc,
                      parent_entity_type="customer", parent_entity_id=customer_id)
    # Trigger event-based rule check for inbound follow-ups
    if direction == "Inbound" and follow_up_required:
        try:
            from kernel.action.escalation_rules import run_event_rules_for_entity
            await run_event_rules_for_entity("communication")
        except Exception:
            pass
    return doc


@router.get("/communications")
async def list_comms(
    customer_id: Optional[str] = None,
    channel: Optional[str] = None,
    direction: Optional[str] = None,
    customer_visible: Optional[bool] = None,
    follow_up_outstanding: bool = False,
    limit: int = Query(500, ge=1, le=2000),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q: dict = {}
    if customer_id: q["customer_id"] = customer_id
    if channel: q["channel"] = channel
    if direction: q["direction"] = direction
    if customer_visible is not None: q["customer_visible"] = customer_visible
    if follow_up_outstanding: q["follow_up_required"] = True
    # Phase 9 scope
    if not is_all_projects_user(current_user):
        cids = await scoped_customer_ids(current_user) or []
        if not cids: return []
        if "customer_id" in q:
            if q["customer_id"] not in cids: return []
        else:
            q["customer_id"] = {"$in": cids}
    docs = await db.communications.find(q, {"_id": 0}).sort("communicated_at", -1).to_list(limit)
    cust_ids = [d["customer_id"] for d in docs]
    customers = {c["id"]: c async for c in db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0, "id": 1, "code": 1, "primary_name": 1})}
    emp_ids = list({d["employee_user_id"] for d in docs if d.get("employee_user_id")})
    emps = {u["id"]: u async for u in db.users.find({"id": {"$in": emp_ids}}, {"_id": 0, "id": 1, "name": 1})}
    for d in docs:
        d["_customer"] = customers.get(d.get("customer_id"), {})
        d["_employee"] = emps.get(d.get("employee_user_id"), {})
    return docs


@router.get("/communications/counts/followups-overdue")
async def followups_overdue(current_user: dict = Depends(get_current_user)):
    db = get_db()
    n = await db.communications.count_documents({
        "follow_up_required": True,
        "follow_up_date": {"$lt": _now()},
    })
    return {"count": n}


@router.patch("/communications/{cid}")
async def update_comm(cid: str, payload: UpdatePayload, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.communications.find_one({"id": cid}, {"_id": 0})
    if not doc: raise HTTPException(status_code=404, detail="Communication not found")
    if not is_super_admin(current_user) and doc["employee_user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Only the creator or Super Admin can edit")
    created = datetime.fromisoformat(doc["created_at"].replace("Z", "+00:00"))
    if (datetime.now(timezone.utc) - created).total_seconds() > 24 * 3600 and not is_super_admin(current_user):
        raise HTTPException(status_code=400, detail="Cannot edit after 24 hours")
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("customer_visible") and not _can_set_visible(current_user):
        raise HTTPException(status_code=403, detail="Only CRM / Management / Super Admin can set customer_visible=true")
    if not changes:
        return doc
    changes["updated_at"] = _now()
    before = dict(doc)
    await db.communications.update_one({"id": cid}, {"$set": changes})
    after = await db.communications.find_one({"id": cid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="communication", entity_id=cid,
                      action="update", before=before, after=after,
                      parent_entity_type="customer", parent_entity_id=doc["customer_id"])
    return after


@router.post("/communications/{cid}/complete-follow-up")
async def complete_follow_up(cid: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.communications.find_one({"id": cid}, {"_id": 0})
    if not doc: raise HTTPException(status_code=404, detail="Not found")
    if not doc.get("follow_up_required"):
        raise HTTPException(status_code=400, detail="No follow-up outstanding")
    before = dict(doc)
    await db.communications.update_one({"id": cid}, {"$set": {"follow_up_required": False, "updated_at": _now()}})
    after = await db.communications.find_one({"id": cid}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="communication", entity_id=cid,
                      action="update", before=before, after=after,
                      parent_entity_type="customer", parent_entity_id=doc["customer_id"])
    try:
        from kernel.action.escalation_rules import run_event_rules_for_entity
        await run_event_rules_for_entity("communication")
    except Exception:
        pass
    return after
