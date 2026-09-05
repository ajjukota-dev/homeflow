"""Task API: CRUD + all lifecycle actions."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import (
    get_project_scope, is_all_projects_user, project_id_of_task,
)
from kernel.collaboration.collaboration import is_super_admin, user_role_code
from kernel.mongo import get_db, write_audit
from kernel.journey.workflow_engine import (
    TERMINAL_STATUSES,
    WAITING_STATUSES,
    cascade_from_task,
    compute_blocker,
    get_task_or_404,
    overlay_overdue,
)

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _dept_id_for_role(db, code: str) -> Optional[str]:
    role = await db.roles.find_one({"code": code}, {"_id": 0, "id": 1})
    return role["id"] if role else None


async def _enrich_task_for_read(t: dict) -> dict:
    t = overlay_overdue(t)
    t["blocker_reason"] = None if t["status"] in TERMINAL_STATUSES else await compute_blocker(t)
    return t


# Phase 5 + 6: T5 (Draft agreement), T6 (Legal approval), T7 (Booking amount receipt),
# T8 (TDS challan verify), T9 (Confirm customer availability), T10 (Book SRO slot) are
# managed entirely through domain screens (Legal / Payments / TDS / Registration).
# No manual /tasks mutations allowed.
DOMAIN_GATED_KEYS = {
    "T5": ("Legal", "Legal", "Upload the agreement draft there."),
    "T6": ("Legal", "Legal", "Approve the agreement there."),
    "T7": ("Payments", "Financials", "Verify the payment for the booking amount there."),
    "T8": ("TDS", "Financials", "Verify the TDS challan there (or mark it Not Applicable)."),
    "T9": ("Registration", "Registration", "Confirm customer availability there."),
    "T10": ("Registration", "Registration", "Book the SRO slot there."),
    "T11": ("Unit Readiness", "Unit Readiness", "Update component progress and declare Ready-for-QA there."),
    "T12": ("Snagging", "Snagging", "Close all critical snags to complete inspection sign-off."),
    "T13": ("Handover", "Handover", "Record customer acknowledgement there."),
}

async def _domain_gate(task: dict) -> None:
    db = get_db()
    tpl = await db.workflow_task_templates.find_one({"id": task.get("task_template_id")}, {"_id": 0, "_key": 1})
    if tpl and tpl.get("_key") in DOMAIN_GATED_KEYS:
        key = tpl["_key"]
        _target, screen, action_hint = DOMAIN_GATED_KEYS[key]
        raise HTTPException(
            status_code=400,
            detail=f"Task {key} is managed automatically via the {screen} screen. {action_hint}",
        )


# Back-compat alias — old code paths call `_finance_gate` for T7/T8; keep the name working
_finance_gate = _domain_gate


async def _lock_check_task(task_id: str, current_user: dict = Depends(get_current_user)) -> dict:
    """FastAPI Depends that fetches the task and short-circuits with 400 for T5-T10.

    Because Depends runs before body parsing, this fixes the 422-before-lock bug on
    endpoints with typed bodies (attach-evidence, verify, complete, approve, etc.).
    """
    task = await get_task_or_404(task_id)
    await _domain_gate(task)
    return task


# ---------------- Listing & retrieval ----------------

@router.get("")
async def list_tasks(
    mine: bool = False,
    department_id: Optional[str] = None,
    status: Optional[str] = None,
    overdue: bool = False,
    priority: Optional[str] = None,
    journey_id: Optional[str] = None,
    awaiting_approval_for_me: bool = False,
    limit: int = Query(200, ge=1, le=1000),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q: dict = {}
    if journey_id:
        q["journey_id"] = journey_id
    if department_id:
        q["department_id"] = department_id
    if priority:
        q["priority"] = priority

    # Phase 9: project scope — restrict to journeys whose project is in user's scope
    if not is_all_projects_user(current_user):
        scope = get_project_scope(current_user) or []
        if not scope:
            return []
        scoped_journey_ids = [
            j["id"] async for j in db.customer_journeys.find(
                {"project_id": {"$in": scope}}, {"_id": 0, "id": 1}
            )
        ]
        if not scoped_journey_ids:
            return []
        if journey_id:
            if journey_id not in scoped_journey_ids:
                return []
        else:
            q["journey_id"] = {"$in": scoped_journey_ids}

    if mine:
        # tasks I own OR unassigned tasks in my dept where my role matches default_owner_role
        role_code = user_role_code(current_user)
        q_or = [{"owner_user_id": current_user["id"]}]
        if role_code and current_user.get("department_id"):
            q_or.append({
                "owner_user_id": None,
                "department_id": current_user["department_id"],
                "default_owner_role": role_code,
            })
        q["$or"] = q_or

    if awaiting_approval_for_me:
        # Approval-type tasks awaiting approval where my role matches approver_role
        role_code = user_role_code(current_user)
        q["approval_required"] = True
        q["approval_status"] = "Pending"
        q["status"] = "Awaiting Approval"
        if role_code and not is_super_admin(current_user):
            q["approver_role"] = role_code

    docs = await db.tasks.find(q, {"_id": 0}).sort("created_at", 1).to_list(limit)
    # Enrich with journey / customer / project / unit summary + blocker + overdue overlay
    journey_ids = list({d["journey_id"] for d in docs if d.get("journey_id")})
    journeys = {}
    async for j in db.customer_journeys.find({"id": {"$in": journey_ids}}, {"_id": 0}):
        journeys[j["id"]] = j
    cust_ids = list({j["customer_id"] for j in journeys.values() if j.get("customer_id")})
    proj_ids = list({j["project_id"] for j in journeys.values() if j.get("project_id")})
    unit_ids = list({j["unit_id"] for j in journeys.values() if j.get("unit_id")})
    customers = {c["id"]: c async for c in db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0})}
    projects = {p["id"]: p async for p in db.projects.find({"id": {"$in": proj_ids}}, {"_id": 0})}
    units = {u["id"]: u async for u in db.units.find({"id": {"$in": unit_ids}}, {"_id": 0})}

    out = []
    for d in docs:
        d = await _enrich_task_for_read(d)
        if overdue and not d.get("overdue"):
            continue
        # For non-overdue status filter (checked after overlay so 'Overdue' works)
        if status and d.get("display_status") != status:
            continue
        j = journeys.get(d.get("journey_id"), {})
        c = customers.get(j.get("customer_id"), {}) if j else {}
        p = projects.get(j.get("project_id"), {}) if j else {}
        u = units.get(j.get("unit_id"), {}) if j else {}
        d["_journey"] = {"id": j.get("id"), "status": j.get("status")}
        d["_customer"] = {"id": c.get("id"), "code": c.get("code"), "primary_name": c.get("primary_name")}
        d["_project"] = {"id": p.get("id"), "name": p.get("name"), "type": p.get("type")}
        d["_unit"] = {"id": u.get("id"), "code": u.get("code")}
        out.append(d)
    return out


@router.get("/counts")
async def task_counts(current_user: dict = Depends(get_current_user)):
    """Small aggregation for the dashboard cards."""
    db = get_db()

    # Phase 9: project scope — narrow to journeys in scope
    scope_filter: dict = {}
    if not is_all_projects_user(current_user):
        scope = get_project_scope(current_user) or []
        if not scope:
            return {"overdue": 0, "awaiting_verification": 0, "awaiting_approval": 0}
        scoped_journey_ids = [
            j["id"] async for j in db.customer_journeys.find(
                {"project_id": {"$in": scope}}, {"_id": 0, "id": 1}
            )
        ]
        if not scoped_journey_ids:
            return {"overdue": 0, "awaiting_verification": 0, "awaiting_approval": 0}
        scope_filter = {"journey_id": {"$in": scoped_journey_ids}}

    # Overdue count (in-progress ish, due_date < now)
    now_iso = _now_iso()
    overdue_c = await db.tasks.count_documents({
        **scope_filter,
        "status": {"$nin": ["Completed", "Cancelled"]},
        "due_date": {"$lt": now_iso, "$ne": None},
    })
    verify_c = await db.tasks.count_documents({**scope_filter, "status": "Awaiting Verification"})
    approve_c = await db.tasks.count_documents({**scope_filter, "status": "Awaiting Approval"})
    return {
        "overdue": overdue_c,
        "awaiting_verification": verify_c,
        "awaiting_approval": approve_c,
    }


@router.get("/{task_id}")
async def get_task(task_id: str, current_user: dict = Depends(get_current_user)):
    doc = await get_task_or_404(task_id)
    # Phase 9: 404 if out of scope
    if not is_all_projects_user(current_user):
        pid = await project_id_of_task(task_id)
        scope = get_project_scope(current_user) or []
        if pid not in scope:
            raise HTTPException(status_code=404, detail="Task not found")
    doc = await _enrich_task_for_read(doc)
    # Enrich with attachments
    db = get_db()
    evidence = []
    if doc.get("evidence_attachment_ids"):
        async for a in db.attachments.find({"id": {"$in": doc["evidence_attachment_ids"]}, "deleted_at": None}, {"_id": 0}):
            evidence.append(a)
    doc["evidence_attachments"] = evidence
    # Template key (Phase 5 uses this to detect T7/T8 for the finance lock)
    tpl = await db.workflow_task_templates.find_one({"id": doc.get("task_template_id")}, {"_id": 0, "_key": 1})
    doc["_template_key"] = (tpl or {}).get("_key")
    # Journey summary
    journey = await db.customer_journeys.find_one({"id": doc["journey_id"]}, {"_id": 0})
    if journey:
        customer = await db.customers.find_one({"id": journey["customer_id"]}, {"_id": 0})
        stage_inst = await db.journey_stage_instances.find_one({"id": doc["stage_instance_id"]}, {"_id": 0})
        stage_def = await db.workflow_stages.find_one({"id": stage_inst["stage_id"]}, {"_id": 0}) if stage_inst else None
        sub_inst = await db.journey_subprocess_instances.find_one({"id": doc["subprocess_instance_id"]}, {"_id": 0})
        sub_def = await db.workflow_subprocesses.find_one({"id": sub_inst["subprocess_id"]}, {"_id": 0}) if sub_inst else None
        doc["_journey_summary"] = {
            "journey_id": journey["id"],
            "customer_id": customer["id"] if customer else None,
            "customer_code": customer["code"] if customer else None,
            "customer_name": customer["primary_name"] if customer else None,
            "stage_name": stage_def["name"] if stage_def else None,
            "subprocess_name": sub_def["name"] if sub_def else None,
        }
        doc["_booking_id"] = journey.get("booking_id")
    return doc


# ---------------- Mutations ----------------

class AssignPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: Optional[str] = None


class ChecklistPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    key: str
    done: bool


class AttachEvidencePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    attachment_id: str


class DecisionPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    decision: str
    notes: Optional[str] = None


class ReasonPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str


class SetStatusPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    status: str
    reason: Optional[str] = None


class CompletePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    external_reference: Optional[str] = None
    notes: Optional[str] = None


class UpdateTaskPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    due_date: Optional[str] = None
    priority: Optional[str] = None


def _authorised_to_act(task: dict, user: dict) -> bool:
    """Owner or Super Admin can act."""
    if is_super_admin(user):
        return True
    if task.get("owner_user_id") == user["id"]:
        return True
    # Unassigned tasks — allow anyone in same dept + matching role
    if task.get("owner_user_id") is None:
        return (
            task.get("department_id") == user.get("department_id")
            and task.get("default_owner_role") == user_role_code(user)
        )
    return False


async def _write_task_audit(user_id, before, after):
    await write_audit(
        user_id=user_id,
        entity_type="task",
        entity_id=after["id"],
        action="update",
        before=before,
        after=after,
        parent_entity_type="journey",
        parent_entity_id=after["journey_id"],
    )


@router.patch("/{task_id}")
async def update_task(
    task_id: str,
    payload: UpdateTaskPayload,
    current_user: dict = Depends(get_current_user),
):
    task = await get_task_or_404(task_id)
    if not _authorised_to_act(task, current_user):
        raise HTTPException(status_code=403, detail="Not authorised to edit this task")
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return await _enrich_task_for_read(task)
    changes["updated_at"] = _now_iso()
    db = get_db()
    await db.tasks.update_one({"id": task_id}, {"$set": changes})
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await _write_task_audit(current_user["id"], task, after)
    return await _enrich_task_for_read(after)


@router.post("/{task_id}/start")
async def start_task(task_id: str, current_user: dict = Depends(get_current_user)):
    task = await get_task_or_404(task_id)
    if not _authorised_to_act(task, current_user):
        raise HTTPException(status_code=403, detail="Not authorised to start this task")
    if task["status"] != "Not Started":
        raise HTTPException(status_code=400, detail=f"Cannot start from {task['status']}")
    blocker = await compute_blocker(task)
    if blocker:
        raise HTTPException(status_code=400, detail=blocker)
    db = get_db()
    updates = {"status": "In Progress", "updated_at": _now_iso()}
    if not task.get("owner_user_id"):
        updates["owner_user_id"] = current_user["id"]
    await db.tasks.update_one({"id": task_id}, {"$set": updates})
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await _write_task_audit(current_user["id"], task, after)
    await cascade_from_task(task_id, actor_user_id=current_user["id"])
    return await _enrich_task_for_read(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@router.post("/{task_id}/assign")
async def assign_task(
    task_id: str,
    payload: AssignPayload,
    current_user: dict = Depends(get_current_user),
):
    task = await get_task_or_404(task_id)
    if not (is_super_admin(current_user) or _authorised_to_act(task, current_user)):
        raise HTTPException(status_code=403, detail="Not authorised to reassign this task")
    db = get_db()
    new_owner = payload.user_id
    if new_owner:
        u = await db.users.find_one({"id": new_owner, "active": True}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(status_code=400, detail="Invalid or inactive user_id")
    before = dict(task)
    await db.tasks.update_one(
        {"id": task_id}, {"$set": {"owner_user_id": new_owner, "updated_at": _now_iso()}}
    )
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await _write_task_audit(current_user["id"], before, after)
    return await _enrich_task_for_read(after)


@router.patch("/{task_id}/checklist")
async def update_checklist(
    task_id: str,
    payload: ChecklistPayload,
    current_user: dict = Depends(get_current_user),
):
    task = await get_task_or_404(task_id)
    if task["execution_type"] != "Checklist":
        raise HTTPException(status_code=400, detail="Not a Checklist task")
    if not _authorised_to_act(task, current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    checklist = list(task.get("checklist_state") or [])
    found = False
    for item in checklist:
        if item["key"] == payload.key:
            item["done"] = bool(payload.done)
            item["done_by"] = current_user["id"] if payload.done else None
            item["done_at"] = _now_iso() if payload.done else None
            found = True
            break
    if not found:
        raise HTTPException(status_code=400, detail="Checklist key not found")
    db = get_db()
    before = dict(task)
    new_status = task["status"]
    if new_status == "Not Started":
        new_status = "In Progress"
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {"checklist_state": checklist, "status": new_status, "updated_at": _now_iso()}},
    )
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await _write_task_audit(current_user["id"], before, after)
    return await _enrich_task_for_read(after)


@router.post("/{task_id}/attach-evidence")
async def attach_evidence(
    payload: AttachEvidencePayload,
    task: dict = Depends(_lock_check_task),
    current_user: dict = Depends(get_current_user),
):
    if task["execution_type"] not in ("Evidence", "Verification", "Approval"):
        raise HTTPException(status_code=400, detail="This task does not accept evidence")
    if not _authorised_to_act(task, current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    db = get_db()
    task_id = task["id"]
    att = await db.attachments.find_one({"id": payload.attachment_id, "deleted_at": None}, {"_id": 0})
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if att["entity_type"] != "task" or att["entity_id"] != task_id:
        raise HTTPException(status_code=400, detail="Attachment must belong to this task")
    ids = list(dict.fromkeys([*task.get("evidence_attachment_ids", []), payload.attachment_id]))
    before = dict(task)
    new_status = task["status"]
    if new_status == "Not Started":
        new_status = "In Progress"
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {"evidence_attachment_ids": ids, "status": new_status, "updated_at": _now_iso()}},
    )
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await _write_task_audit(current_user["id"], before, after)
    return await _enrich_task_for_read(after)


@router.post("/{task_id}/submit-for-verification")
async def submit_for_verification(task: dict = Depends(_lock_check_task), current_user: dict = Depends(get_current_user)):
    if not _authorised_to_act(task, current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    if task["execution_type"] not in ("Evidence", "Verification"):
        raise HTTPException(status_code=400, detail="Not a verifiable task type")
    db = get_db()
    task_id = task["id"]
    before = dict(task)
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {"status": "Awaiting Verification", "verification_status": "Pending", "updated_at": _now_iso()}},
    )
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await _write_task_audit(current_user["id"], before, after)
    return await _enrich_task_for_read(after)


@router.post("/{task_id}/verify")
async def verify_task(
    payload: DecisionPayload,
    task: dict = Depends(_lock_check_task),
    current_user: dict = Depends(get_current_user),
):
    if payload.decision not in ("Verified", "Rejected"):
        raise HTTPException(status_code=400, detail="decision must be 'Verified' or 'Rejected'")
    if task["execution_type"] not in ("Evidence", "Verification"):
        raise HTTPException(status_code=400, detail="Not a verifiable task")
    if task.get("verifier_role") and not is_super_admin(current_user):
        if user_role_code(current_user) != task["verifier_role"]:
            raise HTTPException(status_code=403, detail=f"Only {task['verifier_role']} or Super Admin can verify")
    # Self-verification guard
    if task.get("owner_user_id") == current_user["id"] and not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Cannot verify a task you own")

    db = get_db()
    task_id = task["id"]
    before = dict(task)
    now = _now_iso()
    updates: dict = {
        "verification_status": payload.decision,
        "verification_notes": (payload.notes or "").strip() or None,
        "verified_by": current_user["id"],
        "verified_at": now,
        "updated_at": now,
    }
    if payload.decision == "Verified":
        # If this task has no separate approval step, complete it now
        if task["execution_type"] == "Verification" and not task.get("approval_required"):
            updates["status"] = "Completed"
            updates["completed_by"] = current_user["id"]
            updates["completed_at"] = now
        elif task["execution_type"] == "Evidence":
            # For Evidence tasks the evidence itself is now Verified; leave task at "In Progress"
            # so the owner can hit /complete.
            updates["status"] = "In Progress"
    else:
        # Rejected
        updates["status"] = "In Progress"

    await db.tasks.update_one({"id": task_id}, {"$set": updates})
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await _write_task_audit(current_user["id"], before, after)

    # Cascade verification decision to the task's evidence attachments so the
    # Complete gate (which reads attachment-level verification_status) can pass.
    # Evidence branch only — Verification tasks do not carry evidence_attachment_ids.
    if task["execution_type"] == "Evidence":
        att_ids = task.get("evidence_attachment_ids") or []
        if att_ids:
            att_before = await db.attachments.find(
                {"id": {"$in": att_ids}, "deleted_at": None},
                {"_id": 0},
            ).to_list(1000)
            att_updates = {
                "verification_status": payload.decision,
                "verified_by": current_user["id"],
                "verified_at": now,
            }
            await db.attachments.update_many(
                {"id": {"$in": att_ids}, "deleted_at": None},
                {"$set": att_updates},
            )
            for a_before in att_before:
                a_after = {**a_before, **att_updates}
                await write_audit(
                    user_id=current_user["id"],
                    entity_type="attachment",
                    entity_id=a_before["id"],
                    action="update",
                    before=a_before,
                    after=a_after,
                    parent_entity_type="task",
                    parent_entity_id=task_id,
                )

    await cascade_from_task(task_id, actor_user_id=current_user["id"])
    return await _enrich_task_for_read(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@router.post("/{task_id}/submit-for-approval")
async def submit_for_approval(task: dict = Depends(_lock_check_task), current_user: dict = Depends(get_current_user)):
    if not _authorised_to_act(task, current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    if task["execution_type"] != "Approval":
        raise HTTPException(status_code=400, detail="Not an Approval task")
    db = get_db()
    task_id = task["id"]
    before = dict(task)
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {"status": "Awaiting Approval", "approval_status": "Pending", "updated_at": _now_iso()}},
    )
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await _write_task_audit(current_user["id"], before, after)
    return await _enrich_task_for_read(after)


@router.post("/{task_id}/approve")
async def approve_task(
    payload: DecisionPayload,
    task: dict = Depends(_lock_check_task),
    current_user: dict = Depends(get_current_user),
):
    if payload.decision not in ("Approved", "Rejected"):
        raise HTTPException(status_code=400, detail="decision must be 'Approved' or 'Rejected'")
    if task["execution_type"] != "Approval":
        raise HTTPException(status_code=400, detail="Not an Approval task")
    task_id = task["id"]

    allowed = (
        is_super_admin(current_user)
        or user_role_code(current_user) == "MANAGEMENT"
        or (task.get("approver_role") and user_role_code(current_user) == task["approver_role"])
    )
    if not allowed:
        raise HTTPException(status_code=403, detail=f"Only {task.get('approver_role')}/Management/Super Admin can approve")

    if task.get("owner_user_id") == current_user["id"] and not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Cannot approve your own task")

    db = get_db()
    before = dict(task)
    now = _now_iso()
    updates: dict = {
        "approval_status": payload.decision,
        "approval_notes": (payload.notes or "").strip() or None,
        "approved_by": current_user["id"],
        "approved_at": now,
        "updated_at": now,
    }
    if payload.decision == "Approved":
        updates["status"] = "Completed"
        updates["completed_by"] = current_user["id"]
        updates["completed_at"] = now
    else:
        updates["status"] = "In Progress"

    await db.tasks.update_one({"id": task_id}, {"$set": updates})
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await _write_task_audit(current_user["id"], before, after)
    await cascade_from_task(task_id, actor_user_id=current_user["id"])
    return await _enrich_task_for_read(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@router.post("/{task_id}/complete")
async def complete_task(
    payload: CompletePayload = Body(default_factory=CompletePayload),
    task: dict = Depends(_lock_check_task),
    current_user: dict = Depends(get_current_user),
):
    if not _authorised_to_act(task, current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    if task["status"] == "Completed":
        return await _enrich_task_for_read(task)
    if task["status"] == "Cancelled":
        raise HTTPException(status_code=400, detail="Task is cancelled")
    task_id = task["id"]

    # Prereq gating
    blocker = await compute_blocker(task)
    if blocker:
        raise HTTPException(status_code=400, detail=f"Cannot complete: {blocker}")

    exec_type = task["execution_type"]
    db = get_db()

    if exec_type == "Checklist":
        missing = [i["label"] for i in (task.get("checklist_state") or []) if i.get("required") and not i.get("done")]
        if missing:
            raise HTTPException(status_code=400, detail=f"Cannot complete: required checklist items pending — {', '.join(missing)}")

    if exec_type == "Evidence":
        att_ids = task.get("evidence_attachment_ids") or []
        if not att_ids:
            raise HTTPException(status_code=400, detail="Cannot complete: no evidence attached")
        att_docs = await db.attachments.find({"id": {"$in": att_ids}, "deleted_at": None}, {"_id": 0}).to_list(50)
        if not any(a["verification_status"] == "Verified" for a in att_docs):
            raise HTTPException(status_code=400, detail="Cannot complete: evidence not verified")

    if exec_type == "Verification":
        if task["verification_status"] != "Verified":
            raise HTTPException(status_code=400, detail="Cannot complete: task not verified yet")

    if exec_type == "Approval":
        if task["approval_status"] != "Approved":
            raise HTTPException(status_code=400, detail="Cannot complete: task not approved yet")

    if exec_type == "External":
        if not (payload.external_reference and payload.external_reference.strip()):
            raise HTTPException(status_code=400, detail="external_reference is required for External tasks")

    before = dict(task)
    now = _now_iso()
    updates: dict = {
        "status": "Completed",
        "completed_by": current_user["id"],
        "completed_at": now,
        "updated_at": now,
    }
    if payload.external_reference:
        updates["external_reference"] = payload.external_reference.strip()
    if payload.notes:
        updates["completion_notes"] = payload.notes.strip()
    await db.tasks.update_one({"id": task_id}, {"$set": updates})
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await _write_task_audit(current_user["id"], before, after)
    await cascade_from_task(task_id, actor_user_id=current_user["id"])
    return await _enrich_task_for_read(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@router.post("/{task_id}/set-status")
async def set_task_status(
    task_id: str,
    payload: SetStatusPayload,
    current_user: dict = Depends(get_current_user),
):
    if payload.status not in WAITING_STATUSES and payload.status != "In Progress":
        raise HTTPException(status_code=400, detail=f"status must be one of {sorted(WAITING_STATUSES | {'In Progress'})}")
    task = await get_task_or_404(task_id)
    if not _authorised_to_act(task, current_user):
        raise HTTPException(status_code=403, detail="Not authorised")
    if task["status"] in TERMINAL_STATUSES:
        raise HTTPException(status_code=400, detail=f"Task is already {task['status']}")
    if payload.status in WAITING_STATUSES and not (payload.reason and payload.reason.strip()):
        raise HTTPException(status_code=400, detail="Reason required for a waiting status")

    db = get_db()
    before = dict(task)
    updates = {"status": payload.status, "updated_at": _now_iso()}
    if payload.reason:
        updates["waiting_reason"] = payload.reason.strip()
    await db.tasks.update_one({"id": task_id}, {"$set": updates})
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await _write_task_audit(current_user["id"], before, after)
    return await _enrich_task_for_read(after)


@router.post("/{task_id}/cancel")
async def cancel_task(
    task_id: str,
    payload: ReasonPayload,
    current_user: dict = Depends(get_current_user),
):
    if not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only Super Admin can cancel a task")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Reason required")
    task = await get_task_or_404(task_id)
    if task["status"] == "Completed":
        raise HTTPException(status_code=400, detail="Cannot cancel a completed task")
    db = get_db()
    before = dict(task)
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {"status": "Cancelled", "cancel_reason": payload.reason.strip(), "updated_at": _now_iso()}},
    )
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await _write_task_audit(current_user["id"], before, after)
    await cascade_from_task(task_id, actor_user_id=current_user["id"])
    return await _enrich_task_for_read(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@router.post("/{task_id}/skip-mandatory")
async def skip_mandatory(
    task_id: str,
    payload: ReasonPayload,
    current_user: dict = Depends(get_current_user),
):
    if not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only Super Admin can skip a mandatory task")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Reason required")
    task = await get_task_or_404(task_id)
    db = get_db()
    before = dict(task)
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {
            "status": "Cancelled",
            "override_flag": True,
            "cancel_reason": f"MANDATORY OVERRIDE: {payload.reason.strip()}",
            "updated_at": _now_iso(),
        }},
    )
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await _write_task_audit(current_user["id"], before, after)
    await cascade_from_task(task_id, actor_user_id=current_user["id"])
    return await _enrich_task_for_read(await db.tasks.find_one({"id": task_id}, {"_id": 0}))
