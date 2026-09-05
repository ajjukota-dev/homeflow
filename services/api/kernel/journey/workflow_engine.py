"""Phase 3 workflow engine.

Load-bearing pieces:
  * conditional-rule evaluator (a tiny, whitelisted DSL)
  * journey instantiation from a template
  * task readiness / blocker calculation
  * progression cascade (task → subprocess → stage → journey)
"""
from __future__ import annotations

import ast
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from kernel.mongo import get_db, write_audit

logger = logging.getLogger("workflow")


# ---------------- Constants ----------------

TASK_STATUSES = {
    "Not Started",
    "In Progress",
    "Waiting for Customer",
    "Waiting for Internal Team",
    "Waiting for External Party",
    "Blocked",
    "Awaiting Verification",
    "Awaiting Approval",
    "Completed",
    "Cancelled",
}

WAITING_STATUSES = {
    "Waiting for Customer",
    "Waiting for Internal Team",
    "Waiting for External Party",
}

TERMINAL_STATUSES = {"Completed", "Cancelled"}

JOURNEY_STATUSES = {"Active", "OnHold", "Cancelled", "Closed"}
STAGE_STATUSES = {"Not Started", "In Progress", "Completed", "Skipped"}
SUB_STATUSES = {"Not Started", "In Progress", "Not Applicable", "Completed"}


def _uid() -> str:
    return str(uuid.uuid4())


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------- Conditional-rule evaluator ----------------

_RULE_RE = re.compile(
    r"^\s*(?P<scope>\w+)\.(?P<field>\w+)\s+(?P<op>==|!=|not\s+in|in)\s+(?P<val>.+?)\s*$"
)


def evaluate_conditional_rule(rule: Optional[str], ctx: dict[str, dict]) -> bool:
    """
    Supported DSL:
      customer.nri_status == 'Resident'
      customer.nri_status in ['NRI','OCI']
      unit.status != 'Available'
      project.type != 'Villa'

    If the rule can't be parsed we fall open (return True) — the caller decides
    the semantics of that; here it means "include the conditional task".
    """
    if not rule or not rule.strip():
        return True
    m = _RULE_RE.match(rule)
    if not m:
        logger.warning("Unparseable conditional rule: %r", rule)
        return True
    scope = m.group("scope")
    field = m.group("field")
    op = re.sub(r"\s+", " ", m.group("op")).strip()
    val_str = m.group("val").strip()

    lhs = (ctx.get(scope) or {}).get(field)

    # RHS parsing — string 'foo' / "foo" or a list literal
    if val_str.startswith("[") and val_str.endswith("]"):
        try:
            rhs = ast.literal_eval(val_str)
        except Exception:  # noqa: BLE001
            logger.warning("Bad list literal in rule: %r", val_str)
            return True
        if not isinstance(rhs, (list, tuple, set)):
            return True
    else:
        rhs = val_str.strip("'\"")

    if op == "==":
        return lhs == rhs
    if op == "!=":
        return lhs != rhs
    if op == "in":
        try:
            return lhs in rhs
        except TypeError:
            return False
    if op == "not in":
        try:
            return lhs not in rhs
        except TypeError:
            return True
    return True


# ---------------- Journey instantiation ----------------

async def create_journey_from_template(
    *,
    booking: dict,
    project: dict,
    unit: dict,
    customer: dict,
    template: dict,
    actor_user_id: Optional[str],
) -> dict:
    """
    Idempotent. If an active/on-hold journey already exists for this booking, return it.
    Instantiates ALL stage/subprocess/task instances.
    Returns the journey document (sans _id).
    """
    db = get_db()
    existing = await db.customer_journeys.find_one(
        {"booking_id": booking["id"], "status": {"$in": ["Active", "OnHold"]}},
        {"_id": 0},
    )
    if existing:
        return existing

    ctx = {"customer": customer or {}, "booking": booking, "unit": unit or {}, "project": project or {}}

    journey_id = _uid()
    now = _now_iso()

    journey_doc = {
        "id": journey_id,
        "booking_id": booking["id"],
        "customer_id": booking["customer_id"],
        "project_id": booking["project_id"],
        "unit_id": booking["unit_id"],
        "workflow_template_id": template["id"],
        "workflow_template_version": template.get("version", 1),
        "status": "Active",
        "current_stage_id": None,
        "current_subprocess_id": None,
        "journey_percentage": 0.0,
        "risk_level": "Low",
        "risk_reasons": [],
        "expected_handover_date": None,
        "expected_handover_history": [],
        "sales_owner_id": booking.get("sales_owner_id"),
        "crm_owner_id": booking.get("crm_owner_id"),
        "created_at": now,
    }
    await db.customer_journeys.insert_one(journey_doc)

    # Load template hierarchy
    stages = await db.workflow_stages.find(
        {"workflow_template_id": template["id"], "active": True},
        {"_id": 0},
    ).sort("sequence", 1).to_list(200)

    all_stage_instance_ids: list[str] = []
    all_task_instance_ids: list[str] = []
    task_template_to_instance: dict[str, str] = {}

    for i, stage in enumerate(stages):
        stage_inst_id = _uid()
        stage_inst = {
            "id": stage_inst_id,
            "journey_id": journey_id,
            "stage_id": stage["id"],
            "sequence": stage["sequence"],
            "status": "In Progress" if i == 0 else "Not Started",
            "started_at": now if i == 0 else None,
            "completed_at": None,
            "progress_percentage": 0.0,
        }
        await db.journey_stage_instances.insert_one(stage_inst)
        all_stage_instance_ids.append(stage_inst_id)

        subs = await db.workflow_subprocesses.find(
            {"stage_id": stage["id"], "active": True},
            {"_id": 0},
        ).sort("sequence", 1).to_list(200)

        for j, sub in enumerate(subs):
            sub_inst_id = _uid()
            sub_inst = {
                "id": sub_inst_id,
                "journey_id": journey_id,
                "stage_instance_id": stage_inst_id,
                "subprocess_id": sub["id"],
                "sequence": sub["sequence"],
                "status": "In Progress" if (i == 0 and j == 0) else "Not Started",
                "na_reason": None,
                "started_at": now if (i == 0 and j == 0) else None,
                "completed_at": None,
            }
            await db.journey_subprocess_instances.insert_one(sub_inst)

            # Task templates for this subprocess
            task_tpls = await db.workflow_task_templates.find(
                {"subprocess_id": sub["id"]},
                {"_id": 0},
            ).sort("sequence", 1).to_list(200)

            for tpl in task_tpls:
                # Conditional evaluation — filter out if false
                if tpl.get("task_type") == "Conditional" and not evaluate_conditional_rule(
                    tpl.get("conditional_rule"), ctx
                ):
                    continue

                # Derive owner: if there's exactly one active user in dept + role, auto-assign; else null
                owner_user_id = await _autofill_owner(
                    db,
                    department_id=tpl.get("department_id"),
                    role_code=tpl.get("default_owner_role"),
                    booking=booking,
                )

                due_date = None
                if tpl.get("sla_days"):
                    try:
                        due_date = (
                            datetime.now(timezone.utc) + timedelta(days=int(tpl["sla_days"]))
                        ).isoformat()
                    except Exception:  # noqa: BLE001
                        due_date = None

                # Copy checklist_items → checklist_state
                checklist_state = []
                for item in tpl.get("checklist_items") or []:
                    checklist_state.append({
                        "key": item["key"],
                        "label": item["label"],
                        "required": bool(item.get("required", True)),
                        "done": False,
                        "done_by": None,
                        "done_at": None,
                    })

                task_id = _uid()
                task_doc = {
                    "id": task_id,
                    "journey_id": journey_id,
                    "subprocess_instance_id": sub_inst_id,
                    "stage_instance_id": stage_inst_id,
                    "task_template_id": tpl["id"],
                    "title": tpl["title"],
                    "description": tpl.get("description") or "",
                    "task_type": tpl["task_type"],
                    "execution_type": tpl["execution_type"],
                    "department_id": tpl.get("department_id"),
                    "default_owner_role": tpl.get("default_owner_role"),
                    "owner_user_id": owner_user_id,
                    "priority": tpl.get("priority", "Medium"),
                    "due_date": due_date,
                    "status": "Not Started",
                    "checklist_state": checklist_state,
                    "evidence_attachment_ids": [],
                    "evidence_required": bool(tpl.get("evidence_required")),
                    "required_document_category": tpl.get("required_document_category"),
                    "verification_required": bool(tpl.get("verification_required")),
                    "verifier_role": tpl.get("verifier_role"),
                    "verification_status": "Pending" if tpl.get("verification_required") else "Not Required",
                    "verified_by": None,
                    "verified_at": None,
                    "verification_notes": None,
                    "approval_required": bool(tpl.get("approval_required")),
                    "approver_role": tpl.get("approver_role"),
                    "approval_status": "Pending" if tpl.get("approval_required") else "Not Required",
                    "approved_by": None,
                    "approved_at": None,
                    "approval_notes": None,
                    "external_party": tpl.get("external_party"),
                    "external_reference": None,
                    "customer_visible": bool(tpl.get("customer_visible")),
                    "override_flag": False,
                    "completed_by": None,
                    "completed_at": None,
                    "created_at": now,
                    "updated_at": now,
                }
                await db.tasks.insert_one(task_doc)
                task_template_to_instance[tpl["id"]] = task_id
                all_task_instance_ids.append(task_id)

    # Set journey.current_* to earliest In Progress
    if all_stage_instance_ids:
        first_stage_inst = await db.journey_stage_instances.find_one(
            {"journey_id": journey_id, "status": "In Progress"}, {"_id": 0}
        )
        first_sub_inst = await db.journey_subprocess_instances.find_one(
            {"journey_id": journey_id, "status": "In Progress"}, {"_id": 0}
        )
        await db.customer_journeys.update_one(
            {"id": journey_id},
            {"$set": {
                "current_stage_id": first_stage_inst["id"] if first_stage_inst else None,
                "current_subprocess_id": first_sub_inst["id"] if first_sub_inst else None,
            }},
        )

    await write_audit(
        user_id=actor_user_id,
        entity_type="journey",
        entity_id=journey_id,
        action="create",
        after=journey_doc,
    )

    # Phase 4: seed the document checklist for this booking (Rules 8/9 of §20)
    try:
        from seeds.document_seed import seed_document_checklist  # local import — avoids cycles
        await seed_document_checklist(customer=customer, booking=booking)
    except Exception:  # noqa: BLE001
        # Never block journey creation on doc-checklist seed failure
        pass

    return await db.customer_journeys.find_one({"id": journey_id}, {"_id": 0})


async def _autofill_owner(db, *, department_id, role_code, booking):
    """If a booking-scoped role owner (sales/crm) is available and matches, prefer that.
    Otherwise, auto-assign only if exactly one active user matches dept+role.
    """
    if role_code == "SALES" and booking.get("sales_owner_id"):
        return booking["sales_owner_id"]
    if role_code == "CRM" and booking.get("crm_owner_id"):
        return booking["crm_owner_id"]
    if not department_id or not role_code:
        return None
    role = await db.roles.find_one({"code": role_code}, {"_id": 0, "id": 1})
    if not role:
        return None
    users = await db.users.find(
        {"active": True, "department_id": department_id, "role_id": role["id"]},
        {"_id": 0, "id": 1},
    ).to_list(5)
    if len(users) == 1:
        return users[0]["id"]
    return None


# ---------------- Task readiness ----------------

async def compute_blocker(task: dict) -> Optional[str]:
    """Return a human-readable blocker_reason if prereqs aren't satisfied; else None."""
    db = get_db()
    deps = await db.workflow_task_dependencies.find(
        {"task_template_id": task["task_template_id"]}, {"_id": 0}
    ).to_list(50)
    if not deps:
        return None
    prereq_template_ids = [d["prerequisite_task_template_id"] for d in deps]
    prereqs = await db.tasks.find(
        {"journey_id": task["journey_id"], "task_template_id": {"$in": prereq_template_ids}},
        {"_id": 0, "id": 1, "title": 1, "status": 1, "department_id": 1},
    ).to_list(50)

    unmet: list[dict] = []
    for pre in prereqs:
        if pre["status"] not in TERMINAL_STATUSES:
            unmet.append(pre)
    if not unmet:
        return None

    dept_ids = list({p.get("department_id") for p in unmet if p.get("department_id")})
    dept_by_id: dict[str, str] = {}
    if dept_ids:
        async for d in db.departments.find({"id": {"$in": dept_ids}}, {"_id": 0, "id": 1, "name": 1}):
            dept_by_id[d["id"]] = d["name"]

    parts = []
    for p in unmet:
        dn = dept_by_id.get(p.get("department_id"), "")
        suffix = f" (owner: {dn})" if dn else ""
        parts.append(f"{p['title']}{suffix}")
    return "Blocked by: " + "; ".join(parts)


def overlay_overdue(task: dict) -> dict:
    """Compute the overdue-overlay status on read. Does not mutate stored status."""
    task = dict(task)
    task.pop("_id", None)
    stored_status = task.get("status")
    if stored_status in TERMINAL_STATUSES:
        return task
    due = task.get("due_date")
    if not due:
        return task
    try:
        due_dt = datetime.fromisoformat(due)
        if due_dt.tzinfo is None:
            due_dt = due_dt.replace(tzinfo=timezone.utc)
    except Exception:  # noqa: BLE001
        return task
    if due_dt < datetime.now(timezone.utc):
        task["overdue"] = True
        task["display_status"] = "Overdue"
    else:
        task["overdue"] = False
        task["display_status"] = stored_status
    return task


# ---------------- Progression cascade ----------------

async def cascade_from_task(task_id: str, *, actor_user_id: Optional[str]):
    """Called after any task-status mutation. Recomputes subprocess → stage → journey."""
    db = get_db()
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        return
    await _recompute_subprocess(db, task["subprocess_instance_id"], actor_user_id=actor_user_id)
    await _recompute_stage(db, task["stage_instance_id"], actor_user_id=actor_user_id)
    await _recompute_journey(db, task["journey_id"], actor_user_id=actor_user_id)


async def _transitive_dependents(db, template_id: str, journey_id: str) -> list[dict]:
    """Return all tasks in this journey whose task_template transitively depends on `template_id`.

    Uses the workflow_task_dependencies table (task_template_id → prerequisite_task_template_id).
    """
    # Build reverse map once: prereq → list of dependents
    all_deps = await db.workflow_task_dependencies.find({}, {"_id": 0}).to_list(2000)
    prereq_to_dependents: dict[str, list[str]] = {}
    for d in all_deps:
        prereq_to_dependents.setdefault(d["prerequisite_task_template_id"], []).append(d["task_template_id"])

    visited: set[str] = set()
    stack = [template_id]
    while stack:
        cur = stack.pop()
        for nxt in prereq_to_dependents.get(cur, []):
            if nxt in visited:
                continue
            visited.add(nxt)
            stack.append(nxt)

    if not visited:
        return []
    tasks = await db.tasks.find(
        {"journey_id": journey_id, "task_template_id": {"$in": list(visited)}},
        {"_id": 0},
    ).to_list(500)
    return tasks


async def reverse_cascade_from_task(task_id: str, *, actor_user_id: Optional[str], reason: str = ""):
    """After a task is reopened (Completed → In Progress), reset every transitive dependent
    that has already advanced past Not Started back to Not Started, then re-run the forward
    cascade to recompute subprocess/stage/journey statuses (which may need to revert).
    """
    db = get_db()
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task or not task.get("task_template_id"):
        return
    now = _now_iso()
    dependents = await _transitive_dependents(db, task["task_template_id"], task["journey_id"])
    for dep in dependents:
        if dep["status"] == "Not Started" or dep["status"] == "Cancelled":
            continue
        before = dict(dep)
        # Full reset — anything action-specific is cleared. Owner assignment kept.
        reset = {
            "status": "Not Started",
            "started_at": None,
            "completed_at": None,
            "completed_by": None,
            "completion_notes": None,
            "verification_status": "Not Required" if not dep.get("verification_required") else "Pending",
            "verified_by": None,
            "verified_at": None,
            "verification_notes": None,
            "approval_status": "Not Required" if not dep.get("approval_required") else "Pending",
            "approved_by": None,
            "approved_at": None,
            "approval_notes": None,
            "waiting_reason": None,
            "override_flag": False,
            "updated_at": now,
        }
        await db.tasks.update_one({"id": dep["id"]}, {"$set": reset})
        after = await db.tasks.find_one({"id": dep["id"]}, {"_id": 0})
        await write_audit(
            user_id=actor_user_id,
            entity_type="task",
            entity_id=dep["id"],
            action="update",
            before=before,
            after=after,
            parent_entity_type="journey",
            parent_entity_id=task["journey_id"],
        )

    # Recompute all impacted subprocesses/stages once; the journey recompute walks all stages.
    impacted_subs = {task["subprocess_instance_id"]}
    impacted_stages = {task["stage_instance_id"]}
    for d in dependents:
        impacted_subs.add(d["subprocess_instance_id"])
        impacted_stages.add(d["stage_instance_id"])
    for sid in impacted_subs:
        await _recompute_subprocess(db, sid, actor_user_id=actor_user_id)
    for sid in impacted_stages:
        await _recompute_stage(db, sid, actor_user_id=actor_user_id)
    await _recompute_journey(db, task["journey_id"], actor_user_id=actor_user_id)


async def _recompute_subprocess(db, sub_inst_id: str, *, actor_user_id: Optional[str]):
    sub_inst = await db.journey_subprocess_instances.find_one({"id": sub_inst_id}, {"_id": 0})
    if not sub_inst or sub_inst["status"] == "Not Applicable":
        return
    subprocess_def = await db.workflow_subprocesses.find_one({"id": sub_inst["subprocess_id"]}, {"_id": 0})
    rule = (subprocess_def or {}).get("completion_rule", "all_mandatory_tasks_done")

    tasks = await db.tasks.find({"subprocess_instance_id": sub_inst_id}, {"_id": 0}).to_list(500)
    if not tasks:
        return
    considered = tasks
    if rule == "all_mandatory_tasks_done":
        considered = [t for t in tasks if t["task_type"] in ("Mandatory", "Conditional")]
    complete = all(t["status"] in TERMINAL_STATUSES for t in considered)
    started_any = any(t["status"] not in ("Not Started",) for t in tasks)

    before = dict(sub_inst)
    new_status = sub_inst["status"]
    completed_at = sub_inst.get("completed_at")
    started_at = sub_inst.get("started_at")

    if complete and rule != "manual_close":
        new_status = "Completed"
        completed_at = completed_at or _now_iso()
    elif started_any:
        if sub_inst["status"] == "Not Started":
            new_status = "In Progress"
            started_at = started_at or _now_iso()

    if new_status != sub_inst["status"]:
        await db.journey_subprocess_instances.update_one(
            {"id": sub_inst_id},
            {"$set": {"status": new_status, "started_at": started_at, "completed_at": completed_at}},
        )
        await write_audit(
            user_id=actor_user_id,
            entity_type="journey_subprocess",
            entity_id=sub_inst_id,
            action="update",
            before=before,
            after={**before, "status": new_status, "started_at": started_at, "completed_at": completed_at},
            parent_entity_type="journey",
            parent_entity_id=sub_inst["journey_id"],
        )
        # If this subprocess just completed, kick the next one in the same stage to In Progress
        if new_status == "Completed":
            next_sub = await db.journey_subprocess_instances.find_one(
                {
                    "stage_instance_id": sub_inst["stage_instance_id"],
                    "sequence": {"$gt": sub_inst["sequence"]},
                    "status": "Not Started",
                },
                sort=[("sequence", 1)],
            )
            if next_sub:
                await db.journey_subprocess_instances.update_one(
                    {"id": next_sub["id"]},
                    {"$set": {"status": "In Progress", "started_at": _now_iso()}},
                )


async def _recompute_stage(db, stage_inst_id: str, *, actor_user_id: Optional[str]):
    stage_inst = await db.journey_stage_instances.find_one({"id": stage_inst_id}, {"_id": 0})
    if not stage_inst or stage_inst["status"] == "Skipped":
        return
    subs = await db.journey_subprocess_instances.find(
        {"stage_instance_id": stage_inst_id}, {"_id": 0}
    ).to_list(500)
    if not subs:
        return
    non_na = [s for s in subs if s["status"] != "Not Applicable"]
    complete = all(s["status"] == "Completed" for s in non_na)

    tasks = await db.tasks.find({"stage_instance_id": stage_inst_id}, {"_id": 0}).to_list(500)
    active_tasks = [t for t in tasks if t["status"] != "Cancelled"]
    completed = [t for t in active_tasks if t["status"] == "Completed"]
    progress = 100.0 if not active_tasks else round(len(completed) * 100 / len(active_tasks), 2)

    before = dict(stage_inst)
    new_status = stage_inst["status"]
    completed_at = stage_inst.get("completed_at")
    if complete:
        new_status = "Completed"
        completed_at = completed_at or _now_iso()
    elif any(s["status"] == "In Progress" for s in subs) or any(t["status"] != "Not Started" for t in tasks):
        # In progress if anything has started, or previously completed but something got reopened.
        if stage_inst["status"] in ("Not Started", "Completed"):
            new_status = "In Progress"
            if stage_inst["status"] == "Completed":
                completed_at = None
    else:
        # Nothing started at all — if we were In Progress or Completed, revert
        if stage_inst["status"] in ("In Progress", "Completed"):
            new_status = "Not Started"
            completed_at = None

    if new_status != stage_inst["status"] or abs(progress - (stage_inst.get("progress_percentage") or 0)) > 0.001:
        after = {
            **before,
            "status": new_status,
            "progress_percentage": progress,
            "completed_at": completed_at,
        }
        await db.journey_stage_instances.update_one(
            {"id": stage_inst_id},
            {"$set": {"status": new_status, "progress_percentage": progress, "completed_at": completed_at}},
        )
        if new_status != before["status"]:
            await write_audit(
                user_id=actor_user_id,
                entity_type="journey_stage",
                entity_id=stage_inst_id,
                action="update",
                before=before,
                after=after,
                parent_entity_type="journey",
                parent_entity_id=stage_inst["journey_id"],
            )
        # Advance to next stage if this one just completed
        if new_status == "Completed":
            next_stage = await db.journey_stage_instances.find_one(
                {
                    "journey_id": stage_inst["journey_id"],
                    "sequence": {"$gt": stage_inst["sequence"]},
                    "status": "Not Started",
                },
                sort=[("sequence", 1)],
            )
            if next_stage:
                await db.journey_stage_instances.update_one(
                    {"id": next_stage["id"]},
                    {"$set": {"status": "In Progress", "started_at": _now_iso()}},
                )
                first_sub = await db.journey_subprocess_instances.find_one(
                    {"stage_instance_id": next_stage["id"], "status": "Not Started"},
                    sort=[("sequence", 1)],
                )
                if first_sub:
                    await db.journey_subprocess_instances.update_one(
                        {"id": first_sub["id"]},
                        {"$set": {"status": "In Progress", "started_at": _now_iso()}},
                    )


async def _recompute_journey(db, journey_id: str, *, actor_user_id: Optional[str]):
    journey = await db.customer_journeys.find_one({"id": journey_id}, {"_id": 0})
    if not journey:
        return
    stages = await db.journey_stage_instances.find({"journey_id": journey_id}, {"_id": 0}).to_list(200)
    if not stages:
        return
    # Weight lookup
    stage_defs = await db.workflow_stages.find(
        {"workflow_template_id": journey["workflow_template_id"]}, {"_id": 0}
    ).to_list(200)
    weight_by_stage = {s["id"]: float(s.get("weight", 0)) for s in stage_defs}

    total_pct = 0.0
    for si in stages:
        w = weight_by_stage.get(si["stage_id"], 0.0)
        total_pct += (si.get("progress_percentage") or 0.0) * w
    total_pct = round(total_pct, 2)

    current_stage = await db.journey_stage_instances.find_one(
        {"journey_id": journey_id, "status": "In Progress"}, sort=[("sequence", 1)]
    )
    current_sub = await db.journey_subprocess_instances.find_one(
        {"journey_id": journey_id, "status": "In Progress"}, sort=[("sequence", 1)]
    )
    all_complete = all(s["status"] in ("Completed", "Skipped") for s in stages)

    updates: dict[str, Any] = {
        "journey_percentage": total_pct,
        "current_stage_id": current_stage["id"] if current_stage else None,
        "current_subprocess_id": current_sub["id"] if current_sub else None,
    }
    if all_complete and journey["status"] == "Active":
        updates["status"] = "Closed"

    if any(journey.get(k) != v for k, v in updates.items()):
        before = dict(journey)
        await db.customer_journeys.update_one({"id": journey_id}, {"$set": updates})
        after = {**before, **updates}
        await write_audit(
            user_id=actor_user_id,
            entity_type="journey",
            entity_id=journey_id,
            action="update",
            before=before,
            after=after,
        )


# ---------------- Convenience ----------------

async def get_task_or_404(task_id: str) -> dict:
    from fastapi import HTTPException
    db = get_db()
    doc = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Task not found")
    return doc


async def get_active_journey_for_booking(booking_id: str) -> Optional[dict]:
    db = get_db()
    return await db.customer_journeys.find_one(
        {"booking_id": booking_id, "status": {"$in": ["Active", "OnHold"]}},
        {"_id": 0},
    )
