"""Workflow templates, journeys, and journey subprocess actions."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict

from kernel.identity.auth_utils import get_current_user, require_super_admin
from kernel.identity.auth_scope import (
    get_project_scope, is_all_projects_user, require_project_access_soft,
)
from kernel.collaboration.collaboration import is_super_admin
from kernel.mongo import get_db, write_audit
from kernel.journey.workflow_engine import _now_iso


router = APIRouter(tags=["workflow"])


# ---------------- Workflow templates (read-only) ----------------

@router.get("/workflow_templates")
async def list_workflow_templates(
    project_type: Optional[str] = None,
    active: Optional[bool] = None,
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q: dict = {}
    if project_type:
        q["project_type"] = project_type
    if active is not None:
        q["active"] = active
    return await db.workflow_templates.find(q, {"_id": 0}).sort("project_type", 1).to_list(50)


@router.get("/workflow_templates/{template_id}")
async def get_workflow_template(template_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    tpl = await db.workflow_templates.find_one({"id": template_id}, {"_id": 0})
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    stages = await db.workflow_stages.find(
        {"workflow_template_id": template_id}, {"_id": 0}
    ).sort("sequence", 1).to_list(200)
    for stage in stages:
        subs = await db.workflow_subprocesses.find({"stage_id": stage["id"]}, {"_id": 0}).sort("sequence", 1).to_list(200)
        for sub in subs:
            tasks = await db.workflow_task_templates.find({"subprocess_id": sub["id"]}, {"_id": 0}).sort("sequence", 1).to_list(200)
            for t in tasks:
                t["prerequisites"] = await db.workflow_task_dependencies.find(
                    {"task_template_id": t["id"]}, {"_id": 0}
                ).to_list(50)
            sub["task_templates"] = tasks
        stage["subprocesses"] = subs
    tpl["stages"] = stages
    return tpl


# ---------------- Journeys ----------------

@router.get("/journeys")
async def list_journeys(
    customer_id: Optional[str] = None,
    project_id: Optional[str] = None,
    status: Optional[str] = None,
    risk: Optional[str] = None,
    stage_status: Optional[str] = Query(None, description="Filter by first-stage-in-progress etc."),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q: dict = {}
    if customer_id:
        q["customer_id"] = customer_id
    if project_id:
        q["project_id"] = project_id
    if status:
        q["status"] = status
    if risk:
        q["risk_level"] = risk
    if not is_all_projects_user(current_user):
        scope = get_project_scope(current_user) or []
        if not scope: return []
        if "project_id" in q:
            if q["project_id"] not in scope: return []
        else:
            q["project_id"] = {"$in": scope}
    docs = await db.customer_journeys.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)

    # Enrich with customer/project/unit/current-stage summaries
    if not docs:
        return []

    cust_ids = list({d["customer_id"] for d in docs})
    proj_ids = list({d["project_id"] for d in docs})
    unit_ids = list({d["unit_id"] for d in docs})
    stage_inst_ids = list({d.get("current_stage_id") for d in docs if d.get("current_stage_id")})
    sub_inst_ids = list({d.get("current_subprocess_id") for d in docs if d.get("current_subprocess_id")})

    customers = {c["id"]: c async for c in db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0})}
    projects = {p["id"]: p async for p in db.projects.find({"id": {"$in": proj_ids}}, {"_id": 0})}
    units = {u["id"]: u async for u in db.units.find({"id": {"$in": unit_ids}}, {"_id": 0})}
    stage_insts = {s["id"]: s async for s in db.journey_stage_instances.find({"id": {"$in": stage_inst_ids}}, {"_id": 0})}
    stage_defs = {}
    if stage_insts:
        sd_ids = [si["stage_id"] for si in stage_insts.values()]
        stage_defs = {s["id"]: s async for s in db.workflow_stages.find({"id": {"$in": sd_ids}}, {"_id": 0})}
    sub_insts = {s["id"]: s async for s in db.journey_subprocess_instances.find({"id": {"$in": sub_inst_ids}}, {"_id": 0})}
    sub_defs = {}
    if sub_insts:
        sub_def_ids = [si["subprocess_id"] for si in sub_insts.values()]
        sub_defs = {s["id"]: s async for s in db.workflow_subprocesses.find({"id": {"$in": sub_def_ids}}, {"_id": 0})}

    out = []
    for d in docs:
        cust = customers.get(d["customer_id"], {})
        proj = projects.get(d["project_id"], {})
        unit = units.get(d["unit_id"], {})
        stage_inst = stage_insts.get(d.get("current_stage_id"))
        stage_def = stage_defs.get(stage_inst["stage_id"]) if stage_inst else None
        sub_inst = sub_insts.get(d.get("current_subprocess_id"))
        sub_def = sub_defs.get(sub_inst["subprocess_id"]) if sub_inst else None

        # Filter "new bookings" if requested: first stage still In Progress
        if stage_status == "new_bookings":
            # A "new booking" journey is one where the *first* stage (sequence=1) is still In Progress
            first_stage = await db.journey_stage_instances.find_one(
                {"journey_id": d["id"], "sequence": 1}, {"_id": 0}
            )
            if not first_stage or first_stage["status"] != "In Progress":
                continue

        out.append({
            **d,
            "customer": {"id": cust.get("id"), "code": cust.get("code"), "primary_name": cust.get("primary_name")},
            "project": {"id": proj.get("id"), "name": proj.get("name"), "type": proj.get("type"), "location": proj.get("location")},
            "unit": {"id": unit.get("id"), "code": unit.get("code"), "unit_type": unit.get("unit_type")},
            "current_stage": {"name": stage_def.get("name") if stage_def else None,
                              "sequence": stage_def.get("sequence") if stage_def else None} if stage_def else None,
            "current_subprocess": {"name": sub_def.get("name") if sub_def else None} if sub_def else None,
        })
    return out


@router.get("/journeys/{journey_id}")
async def get_journey(journey_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    journey = await db.customer_journeys.find_one({"id": journey_id}, {"_id": 0})
    if not journey:
        raise HTTPException(status_code=404, detail="Journey not found")
    await require_project_access_soft(current_user, journey.get("project_id"))

    tpl = await db.workflow_templates.find_one({"id": journey["workflow_template_id"]}, {"_id": 0})
    stage_defs_by_id = {}
    if tpl:
        stage_defs = await db.workflow_stages.find(
            {"workflow_template_id": tpl["id"]}, {"_id": 0}
        ).to_list(200)
        stage_defs_by_id = {s["id"]: s for s in stage_defs}
        sub_defs = await db.workflow_subprocesses.find(
            {"stage_id": {"$in": [s["id"] for s in stage_defs]}}, {"_id": 0}
        ).to_list(500)
        sub_defs_by_id = {s["id"]: s for s in sub_defs}
    else:
        sub_defs_by_id = {}

    stages = await db.journey_stage_instances.find({"journey_id": journey_id}, {"_id": 0}).sort("sequence", 1).to_list(500)
    subs = await db.journey_subprocess_instances.find({"journey_id": journey_id}, {"_id": 0}).sort("sequence", 1).to_list(500)
    tasks = await db.tasks.find({"journey_id": journey_id}, {"_id": 0}).sort("created_at", 1).to_list(2000)

    from kernel.journey.workflow_engine import compute_blocker, overlay_overdue
    tasks_by_sub: dict[str, list[dict]] = {}
    for t in tasks:
        t = overlay_overdue(t)
        t["blocker_reason"] = await compute_blocker(t) if t["status"] not in ("Completed", "Cancelled") else None
        tasks_by_sub.setdefault(t["subprocess_instance_id"], []).append(t)

    subs_by_stage: dict[str, list[dict]] = {}
    for s in subs:
        s["tasks"] = tasks_by_sub.get(s["id"], [])
        d = sub_defs_by_id.get(s["subprocess_id"], {})
        s["name"] = d.get("name")
        s["completion_rule"] = d.get("completion_rule")
        subs_by_stage.setdefault(s["stage_instance_id"], []).append(s)

    for st in stages:
        d = stage_defs_by_id.get(st["stage_id"], {})
        st["name"] = d.get("name")
        st["weight"] = d.get("weight")
        st["mandatory"] = d.get("mandatory", True)
        st["department_id"] = d.get("department_id")
        st["subprocesses"] = subs_by_stage.get(st["id"], [])

    journey["stages"] = stages
    return journey


class HandoverDatePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    new_date: str
    reason: str


@router.post("/journeys/{journey_id}/expected-handover")
async def update_expected_handover(
    journey_id: str,
    payload: HandoverDatePayload,
    current_user: dict = Depends(get_current_user),
):
    if not payload.new_date or not payload.reason.strip():
        raise HTTPException(status_code=400, detail="new_date and reason are required")
    db = get_db()
    journey = await db.customer_journeys.find_one({"id": journey_id}, {"_id": 0})
    if not journey:
        raise HTTPException(status_code=404, detail="Journey not found")

    history = list(journey.get("expected_handover_history") or [])
    history.append({
        "previous_date": journey.get("expected_handover_date"),
        "new_date": payload.new_date,
        "reason": payload.reason.strip(),
        "changed_by": current_user["id"],
        "changed_at": _now_iso(),
    })
    await db.customer_journeys.update_one(
        {"id": journey_id},
        {"$set": {"expected_handover_date": payload.new_date, "expected_handover_history": history}},
    )
    after = await db.customer_journeys.find_one({"id": journey_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="journey",
        entity_id=journey_id,
        action="update",
        before=journey,
        after=after,
    )
    return after


class HoldPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str


@router.post("/journeys/{journey_id}/hold")
async def hold_journey(
    journey_id: str,
    payload: HoldPayload,
    current_user: dict = Depends(get_current_user),
):
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Reason is required")
    db = get_db()
    j = await db.customer_journeys.find_one({"id": journey_id}, {"_id": 0})
    if not j:
        raise HTTPException(status_code=404, detail="Journey not found")
    if j["status"] not in ("Active",):
        raise HTTPException(status_code=400, detail=f"Cannot hold from {j['status']}")
    await db.customer_journeys.update_one(
        {"id": journey_id}, {"$set": {"status": "OnHold", "hold_reason": payload.reason.strip()}}
    )
    after = await db.customer_journeys.find_one({"id": journey_id}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="journey", entity_id=journey_id, action="update", before=j, after=after)
    return after


@router.post("/journeys/{journey_id}/resume")
async def resume_journey(journey_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    j = await db.customer_journeys.find_one({"id": journey_id}, {"_id": 0})
    if not j:
        raise HTTPException(status_code=404, detail="Journey not found")
    if j["status"] != "OnHold":
        raise HTTPException(status_code=400, detail="Journey is not on hold")
    await db.customer_journeys.update_one({"id": journey_id}, {"$set": {"status": "Active"}, "$unset": {"hold_reason": ""}})
    after = await db.customer_journeys.find_one({"id": journey_id}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="journey", entity_id=journey_id, action="update", before=j, after=after)
    return after


@router.post("/journeys/{journey_id}/close")
async def close_journey(
    journey_id: str,
    payload: HoldPayload,
    current_user: dict = Depends(require_super_admin()),
):
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Reason is required")
    db = get_db()
    j = await db.customer_journeys.find_one({"id": journey_id}, {"_id": 0})
    if not j:
        raise HTTPException(status_code=404, detail="Journey not found")
    await db.customer_journeys.update_one(
        {"id": journey_id}, {"$set": {"status": "Closed", "close_reason": payload.reason.strip(), "closed_at": _now_iso()}}
    )
    after = await db.customer_journeys.find_one({"id": journey_id}, {"_id": 0})
    await write_audit(user_id=current_user["id"], entity_type="journey", entity_id=journey_id, action="update", before=j, after=after)
    return after


# ---------------- Subprocess ----------------

class NAPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str


@router.post("/subprocesses/{instance_id}/mark-not-applicable")
async def mark_subprocess_na(
    instance_id: str,
    payload: NAPayload,
    current_user: dict = Depends(get_current_user),
):
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Reason is required")
    db = get_db()
    si = await db.journey_subprocess_instances.find_one({"id": instance_id}, {"_id": 0})
    if not si:
        raise HTTPException(status_code=404, detail="Subprocess instance not found")

    # Authorisation: Super Admin or owner-department lead (in Phase 3 we accept any Super Admin or matching-dept user)
    if not is_super_admin(current_user):
        sub_def = await db.workflow_subprocesses.find_one({"id": si["subprocess_id"]}, {"_id": 0})
        if not sub_def or current_user.get("department_id") != sub_def.get("owner_department_id"):
            raise HTTPException(status_code=403, detail="Only Super Admin or the owning department can mark NA")

    if si["status"] == "Completed":
        raise HTTPException(status_code=400, detail="Cannot NA a completed subprocess")

    now = _now_iso()
    before = dict(si)
    await db.journey_subprocess_instances.update_one(
        {"id": instance_id},
        {"$set": {"status": "Not Applicable", "na_reason": payload.reason.strip(), "completed_at": now}},
    )
    # Cascade tasks to Cancelled
    async for t in db.tasks.find({"subprocess_instance_id": instance_id, "status": {"$nin": ["Completed", "Cancelled"]}}, {"_id": 0}):
        await db.tasks.update_one(
            {"id": t["id"]},
            {"$set": {"status": "Cancelled", "cancel_reason": f"Subprocess NA: {payload.reason.strip()}", "updated_at": now}},
        )
        await write_audit(
            user_id=current_user["id"],
            entity_type="task",
            entity_id=t["id"],
            action="update",
            before=t,
            after={**t, "status": "Cancelled"},
            parent_entity_type="journey",
            parent_entity_id=t["journey_id"],
        )
    after = await db.journey_subprocess_instances.find_one({"id": instance_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="journey_subprocess",
        entity_id=instance_id,
        action="update",
        before=before,
        after=after,
        parent_entity_type="journey",
        parent_entity_id=si["journey_id"],
    )
    # Cascade progression
    from kernel.journey.workflow_engine import cascade_from_task
    any_task = await db.tasks.find_one({"subprocess_instance_id": instance_id}, {"_id": 0})
    if any_task:
        await cascade_from_task(any_task["id"], actor_user_id=current_user["id"])
    return after
