"""Document Generation — template-driven PDF renderer for Sale Deed, Agreement of Sale
and Handover Document. WeasyPrint renders A4 PDF with a diagonal DRAFT watermark;
watermark suppressed only when the linked booking's legal_record.status == "Approved".

All generated PDFs are auto-saved as attachments on the customer's Documents module,
reusing the attachment collection + audit_logs conventions."""
from __future__ import annotations

import io
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse
from jinja2 import ChoiceLoader, Environment, FileSystemLoader, select_autoescape
from pydantic import BaseModel, ConfigDict, Field

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import require_customer_access
from kernel.collaboration.collaboration import is_super_admin, user_role_code
from kernel.mongo import get_db, write_audit
from kernel.files.storage import save_bytes


router = APIRouter(prefix="/documents/generate", tags=["document_generation"])

TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "kernel" / "documents" / "templates"
STORAGE_ROOT = Path(os.environ.get("ATTACHMENT_STORAGE_ROOT", "/app/backend/storage"))
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)

_ALLOWED_ROLE_CODES = {"MANAGEMENT", "CRM", "LEGAL"}

# Template metadata
TEMPLATES: dict[str, dict] = {
    "sale_deed": {
        "id": "sale_deed",
        "name": "Sale Deed",
        "description": "Registered conveyance from Developer to Purchaser. Executed at the SRO after the Agreement of Sale.",
        "template_file": "sale_deed.html",
        "category": "Sale Deed",
        "required_fields": ["customer_id", "booking_id", "signatory_name", "signatory_designation", "witnesses"],
        "optional_fields": [],
    },
    "agreement_of_sale": {
        "id": "agreement_of_sale",
        "name": "Agreement of Sale",
        "description": "Binding agreement setting out the sale terms between Purchaser and Developer, signed after booking confirmation.",
        "template_file": "agreement_of_sale.html",
        "category": "Agreement",
        "required_fields": ["customer_id", "booking_id", "signatory_name", "signatory_designation", "witnesses"],
        "optional_fields": [],
    },
    "handover_document": {
        "id": "handover_document",
        "name": "Handover Document",
        "description": "Handover confirmation with kit contents acknowledged by both parties on the day of possession.",
        "template_file": "handover_document.html",
        "category": "Handover",
        "required_fields": ["customer_id", "booking_id", "signatory_name", "signatory_designation", "witnesses"],
        "optional_fields": [],
    },
}


class WitnessIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    address: Optional[str] = None


class GeneratePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    customer_id: str
    booking_id: str
    template_id: str
    signatory_name: str
    signatory_designation: str
    witnesses: list[WitnessIn] = Field(default_factory=list)


def _is_authorised(user: dict) -> bool:
    if is_super_admin(user):
        return True
    code = user_role_code(user) or ""
    return code.upper() in _ALLOWED_ROLE_CODES


def _require_role(user: dict):
    if not _is_authorised(user):
        raise HTTPException(status_code=403, detail="Only Legal, CRM, Management or Super Admin can generate documents")


_env = Environment(
    loader=FileSystemLoader(str(TEMPLATES_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
    trim_blocks=True,
    lstrip_blocks=True,
)


def _shared_css() -> str:
    return (TEMPLATES_DIR / "_shared.css").read_text(encoding="utf-8")


def _fmt_inr(value) -> str:
    """Indian numbering: X,XX,XXX with Cr / L abbreviations for readability."""
    try:
        n = float(value or 0)
    except (TypeError, ValueError):
        return "—"
    if n <= 0:
        return "—"
    if n >= 10_000_000:  # 1 Cr
        return f"₹{n / 10_000_000:.2f} Cr"
    if n >= 100_000:  # 1 L
        return f"₹{n / 100_000:.2f} L"
    # Indian grouping fallback
    s = f"{int(round(n))}"
    if len(s) <= 3:
        return f"₹{s}"
    last3, rest = s[-3:], s[:-3]
    rest = ",".join([rest[max(i - 2, 0):i] for i in range(len(rest), 0, -2)][::-1])
    return f"₹{rest},{last3}"


def _fmt_date(iso: Optional[str]) -> str:
    if not iso:
        return "—"
    try:
        # accept both YYYY-MM-DD and full ISO
        s = iso[:10]
        dt = datetime.strptime(s, "%Y-%m-%d")
        return dt.strftime("%d %b %Y")
    except Exception:
        return iso[:10] if iso else "—"


async def _assemble_context(
    db,
    payload: GeneratePayload,
    template: dict,
    user: dict,
) -> tuple[dict, bool]:
    """Fetch and shape the render context. Returns (context, is_approved)."""

    customer = await db.customers.find_one({"id": payload.customer_id}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=400, detail={"customer_id": "Customer not found"})

    booking = await db.bookings.find_one({"id": payload.booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=400, detail={"booking_id": "Booking not found"})
    if booking["customer_id"] != payload.customer_id:
        raise HTTPException(status_code=400, detail={"booking_id": "Booking does not belong to the selected customer"})

    unit = await db.units.find_one({"id": booking["unit_id"]}, {"_id": 0}) or {}
    project = await db.projects.find_one({"id": booking["project_id"]}, {"_id": 0}) or {}

    # Legal approval → drop watermark
    legal = await db.legal_records.find_one({"booking_id": booking["id"]}, {"_id": 0})
    is_approved = bool(legal and legal.get("status") == "Approved")

    # Primary applicant (if any)
    applicant = await db.customer_applicants.find_one(
        {"customer_id": payload.customer_id},
        {"_id": 0},
        sort=[("created_at", 1)],
    )

    now = datetime.now(timezone.utc)
    context = {
        "template_name": template["name"],
        "template_id": template["id"],
        "shared_css": _shared_css(),
        "is_approved": is_approved,
        "customer": customer,
        "applicant": applicant,
        "unit": unit,
        "project": project,
        "booking": booking,
        "signatory": {
            "name": payload.signatory_name.strip(),
            "designation": payload.signatory_designation.strip(),
        },
        "witnesses": [{"name": w.name.strip(), "address": (w.address or "").strip() or None} for w in payload.witnesses],
        "money": {
            "agreement_value": _fmt_inr(booking.get("agreement_value_inr")),
            "booking_amount": _fmt_inr(booking.get("booking_amount_inr")),
            "base_price": _fmt_inr(unit.get("base_price_inr")),
        },
        "dates": {
            "booking_date": _fmt_date(booking.get("booking_date")),
            "agreement_date": _fmt_date(
                (legal or {}).get("approved_at") or booking.get("booking_date")
            ),
            "possession_date": _fmt_date(
                (booking.get("expected_handover_date") or booking.get("possession_date")) or None
            ),
        },
        "generated_by": {"name": user.get("name") or "System"},
        "generated_at_display": now.strftime("%d %b %Y %H:%M"),
        "generated_at_iso": now.isoformat(),
    }
    return context, is_approved


def _validate_payload(payload: GeneratePayload):
    errors: dict[str, str] = {}
    if payload.template_id not in TEMPLATES:
        errors["template_id"] = f"Unknown template. Allowed: {list(TEMPLATES.keys())}"
    if not payload.customer_id:
        errors["customer_id"] = "Required"
    if not payload.booking_id:
        errors["booking_id"] = "Required"
    if not payload.signatory_name or not payload.signatory_name.strip():
        errors["signatory_name"] = "Required"
    if not payload.signatory_designation or not payload.signatory_designation.strip():
        errors["signatory_designation"] = "Required"
    cleaned = [w for w in payload.witnesses if w.name and w.name.strip()]
    if len(cleaned) < 2:
        errors["witnesses"] = "At least 2 witnesses required"
    if errors:
        raise HTTPException(status_code=400, detail=errors)


# ---------------- Endpoints ----------------

@router.get("/templates")
async def list_templates(current_user: dict = Depends(get_current_user)):
    _require_role(current_user)
    return [
        {
            "id": t["id"],
            "name": t["name"],
            "description": t["description"],
            "category": t["category"],
            "required_fields": t["required_fields"],
            "optional_fields": t["optional_fields"],
        }
        for t in TEMPLATES.values()
    ]


@router.post("/preview", response_class=HTMLResponse)
async def preview(payload: GeneratePayload, current_user: dict = Depends(get_current_user)):
    _require_role(current_user)
    _validate_payload(payload)
    template = TEMPLATES[payload.template_id]

    await require_customer_access(current_user, payload.customer_id)
    context, _ = await _assemble_context(get_db(), payload, template, current_user)
    html = _env.get_template(template["template_file"]).render(**context)
    return HTMLResponse(content=html)


@router.post("/pdf")
async def generate_pdf(payload: GeneratePayload, current_user: dict = Depends(get_current_user)):
    _require_role(current_user)
    _validate_payload(payload)
    template = TEMPLATES[payload.template_id]

    await require_customer_access(current_user, payload.customer_id)

    db = get_db()
    context, is_approved = await _assemble_context(db, payload, template, current_user)

    # Import here so a missing WeasyPrint doesn't break module load
    from weasyprint import HTML  # noqa: WPS433

    html = _env.get_template(template["template_file"]).render(**context)
    pdf_bytes = HTML(string=html, base_url=str(TEMPLATES_DIR)).write_pdf()

    # ---- Auto-save as an attachment on the customer's Documents module ----
    slug = template["id"]
    # version = next per (customer, filename)
    versioned_name_root = f"{slug}_{payload.booking_id[:8]}"
    filename = f"{versioned_name_root}.pdf"
    last = await db.attachments.find_one(
        {"entity_type": "customer", "entity_id": payload.customer_id, "filename": filename},
        sort=[("version", -1)],
    )
    version = int(last["version"]) + 1 if last else 1

    now_iso = datetime.now(timezone.utc).isoformat()
    attachment_id = str(uuid.uuid4())
    gridfs_id = await save_bytes(
        pdf_bytes,
        filename=filename,
        content_type="application/pdf",
        metadata={
            "attachment_id": attachment_id,
            "uploaded_by": current_user["id"],
            "entity_type": "customer",
            "entity_id": payload.customer_id,
        },
    )
    display = context["generated_at_display"]
    attach = {
        "id": attachment_id,
        "entity_type": "customer",
        "entity_id": payload.customer_id,
        "comment_id": None,
        "filename": filename,
        "storage_path": None,
        "gridfs_file_id": gridfs_id,
        "storage_backend": "gridfs",
        "file_missing": False,
        "mime_type": "application/pdf",
        "size_bytes": len(pdf_bytes),
        "category": template["category"],
        "version": version,
        "visibility": "Internal",
        "description": f"Auto-generated {template['name']} draft on {display} by {current_user.get('name', 'System')}",
        "uploaded_by": current_user["id"],
        "uploaded_at": now_iso,
        "verification_status": "Uploaded",
        "verified_by": None,
        "verified_at": None,
        "verification_notes": None,
        "deleted_at": None,
        # Provenance
        "generated_from_template": {
            "template_id": template["id"],
            "template_name": template["name"],
            "booking_id": payload.booking_id,
            "generated_at": now_iso,
            "generated_by": current_user["id"],
            "is_approved": is_approved,
        },
    }
    await db.attachments.insert_one(attach)
    await write_audit(
        user_id=current_user["id"],
        entity_type="attachment",
        entity_id=attach["id"],
        action="create",
        after=attach,
        parent_entity_type="customer",
        parent_entity_id=payload.customer_id,
    )

    download_name = f"{template['name'].replace(' ', '_')}_{payload.booking_id[:8]}_v{version}.pdf"
    headers = {
        "Content-Disposition": f'attachment; filename="{download_name}"',
        "X-Attachment-Id": attach["id"],
        "X-Attachment-Category": template["category"],
        "X-Draft-Watermark": "false" if is_approved else "true",
    }
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers=headers,
    )
