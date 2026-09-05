"""Shared engine hooks that drive workflow tasks from outside the /tasks router.

Used by Phase 4 (sales_handovers) and Phase 5 (payments / tds). Bypasses the /tasks
route's role guards because the caller has already been authorised at the wrapping
endpoint (e.g. CRM /accept, Accounts /verify).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from kernel.mongo import get_db, write_audit
from kernel.journey.workflow_engine import cascade_from_task, reverse_cascade_from_task, TERMINAL_STATUSES


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def find_journey_task_by_key(journey_id: str, key: str) -> Optional[dict]:
    """Locate a task instance in a journey by its template `_key`.

    Villa + Apartment templates each have a T1..T14 with the same `_key`, so we
    look up all templates and match by (journey_id, task_template_id) to pick the
    row for this specific journey.
    """
    db = get_db()
    templates = await db.workflow_task_templates.find({"_key": key}, {"_id": 0, "id": 1}).to_list(50)
    if not templates:
        return None
    ids = [t["id"] for t in templates]
    return await db.tasks.find_one(
        {"journey_id": journey_id, "task_template_id": {"$in": ids}},
        {"_id": 0},
    )


async def system_complete_task(task_id: str, actor_id: str, note: str = ""):
    db = get_db()
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task or task["status"] == "Completed":
        return
    now = _now()
    before = dict(task)
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {
            "status": "Completed",
            "completed_by": actor_id,
            "completed_at": now,
            "completion_notes": note or None,
            "override_flag": True,
            "updated_at": now,
        }},
    )
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await write_audit(
        user_id=actor_id,
        entity_type="task",
        entity_id=task_id,
        action="update",
        before=before,
        after=after,
        parent_entity_type="journey",
        parent_entity_id=task["journey_id"],
    )
    await cascade_from_task(task_id, actor_user_id=actor_id)


async def system_verify_task(task_id: str, actor_id: str):
    """Drive a Verification/Evidence-type task through submit + verify(Verified)."""
    db = get_db()
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task or task["status"] == "Completed":
        return
    now = _now()
    before = dict(task)
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {
            "status": "Completed",
            "verification_status": "Verified",
            "verified_by": actor_id,
            "verified_at": now,
            "completed_by": actor_id,
            "completed_at": now,
            "override_flag": True,
            "updated_at": now,
        }},
    )
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await write_audit(
        user_id=actor_id,
        entity_type="task",
        entity_id=task_id,
        action="update",
        before=before,
        after=after,
        parent_entity_type="journey",
        parent_entity_id=task["journey_id"],
    )
    await cascade_from_task(task_id, actor_user_id=actor_id)


async def system_cancel_task(task_id: str, actor_id: str, reason: str):
    """Mark a task Cancelled (Not Applicable) with an audit reason. Cascades.

    Cancelled counts as terminal, so downstream tasks that depended on this one
    become unblocked (same effect as Completed for prereq gating).
    """
    db = get_db()
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task or task["status"] == "Cancelled":
        return
    now = _now()
    before = dict(task)
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {
            "status": "Cancelled",
            "completion_notes": f"Not Applicable: {reason}",
            "override_flag": True,
            "updated_at": now,
        }},
    )
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await write_audit(
        user_id=actor_id,
        entity_type="task",
        entity_id=task_id,
        action="update",
        before=before,
        after=after,
        parent_entity_type="journey",
        parent_entity_id=task["journey_id"],
    )
    await cascade_from_task(task_id, actor_user_id=actor_id)


async def system_reset_task_to_in_progress(task_id: str, actor_id: str, reason: str):
    """Reopen a task from any non-Cancelled state back to In Progress + reverse-cascade."""
    db = get_db()
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task or task["status"] == "Cancelled":
        return
    before = dict(task)
    updates = {
        "status": "In Progress",
        "verification_status": "Pending" if task.get("verification_required") else "Not Required",
        "verified_by": None,
        "verified_at": None,
        "verification_notes": None,
        "completed_at": None,
        "completed_by": None,
        "completion_notes": None,
        "override_flag": False,
        "waiting_reason": reason or None,
        "updated_at": _now(),
    }
    await db.tasks.update_one({"id": task_id}, {"$set": updates})
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await write_audit(
        user_id=actor_id,
        entity_type="task",
        entity_id=task_id,
        action="update",
        before=before,
        after=after,
        parent_entity_type="journey",
        parent_entity_id=task["journey_id"],
    )
    if before["status"] == "Completed":
        await reverse_cascade_from_task(task_id, actor_user_id=actor_id, reason=reason)
    else:
        await cascade_from_task(task_id, actor_user_id=actor_id)


async def system_reset_task_from_cancelled(task_id: str, actor_id: str, reason: str = ""):
    """Move a Cancelled task back to Not Started (Not Applicable → Applicable reversal)."""
    db = get_db()
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task or task["status"] != "Cancelled":
        return
    before = dict(task)
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {
            "status": "Not Started",
            "completion_notes": None,
            "override_flag": False,
            "updated_at": _now(),
        }},
    )
    after = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    await write_audit(
        user_id=actor_id,
        entity_type="task",
        entity_id=task_id,
        action="update",
        before=before,
        after=after,
        parent_entity_type="journey",
        parent_entity_id=task["journey_id"],
    )
    # Downstream tasks that had advanced because this was Cancelled must also revert
    await reverse_cascade_from_task(task_id, actor_user_id=actor_id, reason=reason)


async def post_task_comment(*, task_id: str, actor: dict, body: str, mention_user_ids: Optional[list[str]] = None) -> dict:
    """Insert a system-authored task comment matching the routers/comments.py schema
    and fire the Phase 2 mention fan-out.
    """
    from kernel.collaboration.collaboration import entity_title, notify_users, persist_mentions, resolve_entity  # local import — avoids cycles

    db = get_db()
    comment_id = str(uuid.uuid4())
    now = _now()
    mentions = list(mention_user_ids or [])
    doc = {
        "id": comment_id,
        "entity_type": "task",
        "entity_id": task_id,
        "parent_comment_id": None,
        "thread_root_id": comment_id,
        "user_id": actor["id"],
        "body": body,
        "visibility": "Internal",
        "status": "Active",
        "resolved_by": None,
        "resolved_at": None,
        "created_at": now,
        "edited_at": None,
        "mention_user_ids": mentions,
        "mention_department_ids": [],
        "attachment_ids": [],
    }
    await db.comments.insert_one(doc)
    await persist_mentions(comment_id=comment_id, user_ids=mentions, department_ids=[])
    await write_audit(
        user_id=actor["id"],
        entity_type="comment",
        entity_id=comment_id,
        action="create",
        after=doc,
        parent_entity_type="task",
        parent_entity_id=task_id,
    )
    if mentions:
        entity_doc = await resolve_entity("task", task_id) or {}
        label = entity_title("task", entity_doc)
        actor_name = actor.get("name") or actor.get("email") or "Someone"
        await notify_users(
            user_ids=mentions,
            actor_user_id=actor["id"],
            type_="mention",
            entity_type="task",
            entity_id=task_id,
            comment_id=comment_id,
            title=f"{actor_name} mentioned you on {label}",
            body=body[:180],
        )
    return doc
