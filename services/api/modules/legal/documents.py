"""Documents API — customer-scoped document checklist with versioning + verification.

Reuses `attachments` for the physical file storage/streaming; each upload
against a document produces one attachment (entity_type=document, entity_id=<doc.id>)
and one document_versions row.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import (
    is_all_projects_user, require_customer_access, require_customer_access_soft,
    scoped_customer_ids, require_module_by_method
)
from kernel.collaboration.collaboration import (
    ALLOWED_UPLOAD_EXTENSIONS,
    MAX_UPLOAD_BYTES,
    is_super_admin,
    user_role_code,
)
from kernel.mongo import get_db, write_audit
from kernel.files.storage import save_upload_stream


router = APIRouter(prefix="/documents", tags=["documents"], dependencies=[Depends(require_module_by_method("documents"))])


STORAGE_ROOT = Path(os.environ.get("ATTACHMENT_STORAGE_ROOT", "/app/backend/storage"))
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)


ALLOWED_CATEGORIES: set[str] = {
    "PAN", "Identity Proof", "Address Proof", "Passport", "OCI",
    "Booking Form", "Cost Sheet", "Agreement", "TDS", "Loan Documents",
    "Registration Documents", "POA", "Handover Documents", "Other",
}

# Per-category verifier role mapping (spec §115 handled at attachment-level too).
CATEGORY_TO_VERIFIER_ROLE: dict[str, str] = {
    "PAN": "CRM",
    "Identity Proof": "CRM",
    "Address Proof": "CRM",
    "Passport": "CRM",
    "OCI": "CRM",
    "Booking Form": "CRM",
    "Cost Sheet": "CRM",
    "Agreement": "LEGAL",
    "POA": "LEGAL",
    "TDS": "ACCOUNTS",
    "Loan Documents": "ACCOUNTS",
    "Registration Documents": "REGISTRATION",
    "Handover Documents": "HANDOVER",
    "Other": "CRM",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class DocumentCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    customer_id: str
    booking_id: Optional[str] = None
    category: str
    title: str
    required: bool = True
    notes: Optional[str] = None


class DocumentUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: Optional[str] = None
    required: Optional[bool] = None
    notes: Optional[str] = None


class MarkNAPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str


class VerifyPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    decision: str  # Verified | Rejected
    notes: Optional[str] = None


def _can_manage(user: dict) -> bool:
    return is_super_admin(user) or user_role_code(user) == "CRM"


def _can_verify_category(user: dict, category: str) -> bool:
    if is_super_admin(user):
        return True
    role = user_role_code(user)
    if role == "MANAGEMENT":
        return True
    return CATEGORY_TO_VERIFIER_ROLE.get(category) == role


async def _get_doc_or_404(db, doc_id: str) -> dict:
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


def _clean_filename(name: str) -> str:
    name = os.path.basename(name or "")
    if not name:
        raise HTTPException(status_code=400, detail="File name is required")
    return name


# ---------------- Endpoints ----------------

@router.get("")
async def list_documents(
    customer_id: Optional[str] = None,
    booking_id: Optional[str] = None,
    status: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = Query(500, ge=1, le=2000),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q: dict = {}
    if customer_id:
        q["customer_id"] = customer_id
    if booking_id:
        q["booking_id"] = booking_id
    if category:
        q["category"] = category
    # Phase 9 scope
    if not is_all_projects_user(current_user):
        cids = await scoped_customer_ids(current_user) or []
        if not cids: return []
        if "customer_id" in q:
            if q["customer_id"] not in cids: return []
        else:
            q["customer_id"] = {"$in": cids}
    docs = await db.documents.find(q, {"_id": 0}).sort([("category", 1), ("created_at", 1)]).to_list(limit)
    if status:
        docs = [d for d in docs if d.get("status") == status]

    # Enrich with latest attachment metadata + customer info (list needs it)
    att_ids = [d["latest_attachment_id"] for d in docs if d.get("latest_attachment_id")]
    atts = {}
    if att_ids:
        async for a in db.attachments.find({"id": {"$in": att_ids}}, {"_id": 0}):
            atts[a["id"]] = a
    cust_ids = list({d["customer_id"] for d in docs if d.get("customer_id")})
    customers = {c["id"]: c async for c in db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0})}
    for d in docs:
        d["latest_attachment"] = atts.get(d.get("latest_attachment_id")) if d.get("latest_attachment_id") else None
        c = customers.get(d["customer_id"], {})
        d["_customer"] = {"id": c.get("id"), "code": c.get("code"), "primary_name": c.get("primary_name")}
    return docs


@router.get("/{doc_id}")
async def get_document(doc_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await _get_doc_or_404(db, doc_id)
    await require_customer_access_soft(current_user, doc.get("customer_id"))
    latest_att = None
    if doc.get("latest_attachment_id"):
        latest_att = await db.attachments.find_one({"id": doc["latest_attachment_id"]}, {"_id": 0})
    doc["latest_attachment"] = latest_att
    return doc


@router.post("")
async def create_document(payload: DocumentCreate, current_user: dict = Depends(get_current_user)):
    if not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="Only CRM / Super Admin can add documents")
    if payload.category not in ALLOWED_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"category must be one of {sorted(ALLOWED_CATEGORIES)}")
    db = get_db()
    customer = await db.customers.find_one({"id": payload.customer_id}, {"_id": 0, "id": 1})
    if not customer:
        raise HTTPException(status_code=400, detail="Unknown customer_id")
    # Phase 9 write guard
    await require_customer_access(current_user, payload.customer_id)
    if payload.booking_id:
        booking = await db.bookings.find_one({"id": payload.booking_id}, {"_id": 0, "id": 1})
        if not booking:
            raise HTTPException(status_code=400, detail="Unknown booking_id")

    now = _now()
    doc = {
        "id": str(uuid.uuid4()),
        "customer_id": payload.customer_id,
        "booking_id": payload.booking_id,
        "category": payload.category,
        "title": payload.title.strip(),
        "required": bool(payload.required),
        "applicable": True,
        "na_reason": None,
        "status": "Required",
        "latest_version": 0,
        "latest_attachment_id": None,
        "notes": (payload.notes or "").strip() or None,
        "created_at": now,
        "updated_at": now,
    }
    await db.documents.insert_one(doc)
    await write_audit(
        user_id=current_user["id"],
        entity_type="document",
        entity_id=doc["id"],
        action="create",
        after=doc,
        parent_entity_type="customer",
        parent_entity_id=payload.customer_id,
    )
    doc.pop("_id", None)
    return doc


@router.patch("/{doc_id}")
async def update_document(doc_id: str, payload: DocumentUpdate, current_user: dict = Depends(get_current_user)):
    if not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="Only CRM / Super Admin can edit documents")
    db = get_db()
    doc = await _get_doc_or_404(db, doc_id)
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return doc
    changes["updated_at"] = _now()
    before = dict(doc)
    await db.documents.update_one({"id": doc_id}, {"$set": changes})
    after = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="document",
        entity_id=doc_id,
        action="update",
        before=before,
        after=after,
        parent_entity_type="customer",
        parent_entity_id=doc["customer_id"],
    )
    return after


@router.post("/{doc_id}/mark-na")
async def mark_na(doc_id: str, payload: MarkNAPayload, current_user: dict = Depends(get_current_user)):
    if not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="Only CRM / Super Admin can mark N/A")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Reason required")
    db = get_db()
    doc = await _get_doc_or_404(db, doc_id)
    before = dict(doc)
    await db.documents.update_one(
        {"id": doc_id},
        {"$set": {"applicable": False, "na_reason": payload.reason.strip(),
                  "status": "Not Applicable", "updated_at": _now()}},
    )
    after = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="document", entity_id=doc_id, action="update",
                      before=before, after=after, parent_entity_type="customer", parent_entity_id=doc["customer_id"])
    return after


@router.post("/{doc_id}/mark-required")
async def mark_required(doc_id: str, current_user: dict = Depends(get_current_user)):
    if not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="Only CRM / Super Admin can un-mark N/A")
    db = get_db()
    doc = await _get_doc_or_404(db, doc_id)
    before = dict(doc)
    # Return to Required unless we already have a verified attachment
    new_status = "Required"
    if doc.get("latest_attachment_id"):
        latest = await db.attachments.find_one({"id": doc["latest_attachment_id"]}, {"_id": 0})
        if latest and latest.get("verification_status") == "Verified":
            new_status = "Verified"
        elif latest:
            new_status = "Received"
    await db.documents.update_one(
        {"id": doc_id},
        {"$set": {"applicable": True, "na_reason": None, "required": True,
                  "status": new_status, "updated_at": _now()}},
    )
    after = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="document", entity_id=doc_id, action="update",
                      before=before, after=after, parent_entity_type="customer", parent_entity_id=doc["customer_id"])
    return after


@router.post("/{doc_id}/mark-expired")
async def mark_expired(doc_id: str, current_user: dict = Depends(get_current_user)):
    if not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="Only CRM / Super Admin can mark expired")
    db = get_db()
    doc = await _get_doc_or_404(db, doc_id)
    before = dict(doc)
    await db.documents.update_one({"id": doc_id}, {"$set": {"status": "Expired", "updated_at": _now()}})
    after = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="document", entity_id=doc_id, action="update",
                      before=before, after=after, parent_entity_type="customer", parent_entity_id=doc["customer_id"])
    return after


@router.post("/{doc_id}/upload")
async def upload_version(
    doc_id: str,
    file: UploadFile = File(...),
    comments: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    doc = await _get_doc_or_404(db, doc_id)
    if not doc.get("applicable", True):
        raise HTTPException(status_code=400, detail="Document is marked Not Applicable — un-mark first")

    filename = _clean_filename(file.filename)
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File extension {ext or '(none)'} is not allowed. Allowed: {sorted(ALLOWED_UPLOAD_EXTENSIONS)}")

    entity_type = "document"
    attachment_id = str(uuid.uuid4())
    content_type = file.content_type or "application/octet-stream"
    gridfs_id, size = await save_upload_stream(
        file,
        max_bytes=MAX_UPLOAD_BYTES,
        filename=filename,
        content_type=content_type,
        metadata={
            "attachment_id": attachment_id,
            "uploaded_by": current_user["id"],
            "entity_type": entity_type,
            "entity_id": doc_id,
        },
    )

    version = int(doc.get("latest_version") or 0) + 1
    now = _now()
    attachment = {
        "id": attachment_id,
        "entity_type": entity_type,
        "entity_id": doc_id,
        "comment_id": None,
        "filename": filename,
        "storage_path": None,
        "gridfs_file_id": gridfs_id,
        "storage_backend": "gridfs",
        "file_missing": False,
        "mime_type": content_type,
        "size_bytes": size,
        "category": doc["category"],
        "version": version,
        "visibility": "Internal",
        "description": None,
        "uploaded_by": current_user["id"],
        "uploaded_at": now,
        "verification_status": "Uploaded",
        "verified_by": None,
        "verified_at": None,
        "verification_notes": None,
        "deleted_at": None,
    }
    await db.attachments.insert_one(attachment)

    version_row = {
        "id": str(uuid.uuid4()),
        "document_id": doc_id,
        "version": version,
        "attachment_id": attachment["id"],
        "uploaded_by": current_user["id"],
        "uploaded_at": now,
        "verification_status": "Uploaded",
        "verified_by": None,
        "verified_at": None,
        "comments": (comments or "").strip() or None,
    }
    await db.document_versions.insert_one(version_row)

    role = user_role_code(current_user)
    new_status = "Under Review" if role == "SALES" else "Received"

    before = dict(doc)
    await db.documents.update_one(
        {"id": doc_id},
        {"$set": {
            "status": new_status,
            "latest_version": version,
            "latest_attachment_id": attachment["id"],
            "updated_at": now,
        }},
    )
    after = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="document",
        entity_id=doc_id,
        action="update",
        before=before,
        after=after,
        parent_entity_type="customer",
        parent_entity_id=doc["customer_id"],
    )

    after.pop("_id", None)
    attachment.pop("_id", None)
    version_row.pop("_id", None)
    return {"document": after, "attachment": attachment, "version": version_row}


@router.post("/{doc_id}/verify")
async def verify_document(doc_id: str, payload: VerifyPayload, current_user: dict = Depends(get_current_user)):
    if payload.decision not in ("Verified", "Rejected"):
        raise HTTPException(status_code=400, detail="decision must be 'Verified' or 'Rejected'")
    db = get_db()
    doc = await _get_doc_or_404(db, doc_id)
    if not _can_verify_category(current_user, doc["category"]):
        raise HTTPException(status_code=403, detail=f"{doc['category']} documents can only be verified by {CATEGORY_TO_VERIFIER_ROLE.get(doc['category'], 'a verifier')} or Super Admin")
    if not doc.get("latest_attachment_id"):
        raise HTTPException(status_code=400, detail="No attachment to verify")

    now = _now()
    # Update the underlying attachment
    await db.attachments.update_one(
        {"id": doc["latest_attachment_id"]},
        {"$set": {
            "verification_status": payload.decision,
            "verification_notes": (payload.notes or "").strip() or None,
            "verified_by": current_user["id"],
            "verified_at": now,
        }},
    )
    # Update the corresponding document_versions row
    await db.document_versions.update_one(
        {"attachment_id": doc["latest_attachment_id"]},
        {"$set": {
            "verification_status": payload.decision,
            "verified_by": current_user["id"],
            "verified_at": now,
            "comments": (payload.notes or "").strip() or None,
        }},
    )

    before = dict(doc)
    await db.documents.update_one(
        {"id": doc_id},
        {"$set": {"status": payload.decision, "updated_at": now}},
    )
    after = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="document",
        entity_id=doc_id,
        action="update",
        before=before,
        after=after,
        parent_entity_type="customer",
        parent_entity_id=doc["customer_id"],
    )
    return after


@router.get("/{doc_id}/versions")
async def list_versions(doc_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await _get_doc_or_404(db, doc_id)
    rows = await db.document_versions.find({"document_id": doc_id}, {"_id": 0}).sort("version", -1).to_list(200)
    # Enrich with uploader names
    uploader_ids = list({r["uploaded_by"] for r in rows if r.get("uploaded_by")}) + \
                   list({r["verified_by"] for r in rows if r.get("verified_by")})
    users_map = {u["id"]: u["name"] async for u in db.users.find({"id": {"$in": uploader_ids}}, {"_id": 0})}
    # Pull the underlying attachments so the UI can render Missing chip / filename.
    att_ids = [r.get("attachment_id") for r in rows if r.get("attachment_id")]
    atts = {}
    if att_ids:
        async for a in db.attachments.find({"id": {"$in": att_ids}}, {"_id": 0, "id": 1, "filename": 1, "file_missing": 1}):
            atts[a["id"]] = a
    for r in rows:
        r["_uploaded_by_name"] = users_map.get(r.get("uploaded_by"))
        r["_verified_by_name"] = users_map.get(r.get("verified_by"))
        a = atts.get(r.get("attachment_id")) if r.get("attachment_id") else None
        r["_attachment_filename"] = (a or {}).get("filename")
        r["_file_missing"] = bool((a or {}).get("file_missing"))
    return rows


@router.get("/counts/pending-verification")
async def pending_verification_count(current_user: dict = Depends(get_current_user)):
    """For the Phase 4 dashboard card."""
    db = get_db()
    n = await db.documents.count_documents({
        "status": {"$in": ["Received", "Under Review"]},
        "applicable": True,
    })
    return {"count": n}
