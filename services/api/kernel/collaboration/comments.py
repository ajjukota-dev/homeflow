"""Comments API.

Polymorphic on entity_type + entity_id. Enforces:
- visibility policy (Customer Visible restricted to CRM/Legal/Management/Super Admin)
- entity_type must be resolvable (Phase 2: customer / unit / booking)
- creator+30-min edit window
- soft delete (creator or Super Admin)
- notifications: mentions (user + department), reply-parent, and file uploads
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import (
    is_all_projects_user, require_entity_access, require_entity_access_soft,
)
from kernel.collaboration.collaboration import (
    can_post_customer_visible,
    entity_title,
    is_super_admin,
    notify_departments,
    notify_users,
    persist_mentions,
    resolve_entity,
    VISIBILITY_CHOICES,
    COMMENT_STATUS_CHOICES,
)
from kernel.mongo import get_db, write_audit


router = APIRouter(prefix="/comments", tags=["comments"])

EDIT_WINDOW_MINUTES = 30


# ---------------- DTOs ----------------

class CommentCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    entity_type: str
    entity_id: str
    body: str
    visibility: str = "Internal"
    parent_comment_id: Optional[str] = None
    mention_user_ids: list[str] = Field(default_factory=list)
    mention_department_ids: list[str] = Field(default_factory=list)
    attachment_ids: list[str] = Field(default_factory=list)


class CommentUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    body: str


# ---------------- Endpoints ----------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _serialize(doc: dict) -> dict:
    doc = dict(doc)
    doc.pop("_id", None)
    return doc


async def _fanout_new_comment(*, comment: dict, actor: dict, parent: Optional[dict]):
    """Notification fan-out per spec rules 2-5."""
    entity_doc = await resolve_entity(comment["entity_type"], comment["entity_id"]) or {}
    label = entity_title(comment["entity_type"], entity_doc)
    actor_name = actor.get("name") or actor.get("email") or "Someone"

    # Rule 3: @user mentions
    if comment.get("mention_user_ids"):
        await notify_users(
            user_ids=comment["mention_user_ids"],
            actor_user_id=actor["id"],
            type_="mention",
            entity_type=comment["entity_type"],
            entity_id=comment["entity_id"],
            comment_id=comment["id"],
            title=f"{actor_name} mentioned you on {label}",
            body=comment["body"][:180],
        )

    # Rule 2: @department fan-out
    if comment.get("mention_department_ids"):
        await notify_departments(
            department_ids=comment["mention_department_ids"],
            actor_user_id=actor["id"],
            type_="mention",
            entity_type=comment["entity_type"],
            entity_id=comment["entity_id"],
            comment_id=comment["id"],
            title=f"{actor_name} mentioned your department on {label}",
            body=comment["body"][:180],
        )

    # Rule 4: reply → notify parent author
    if parent and parent.get("user_id"):
        await notify_users(
            user_ids=[parent["user_id"]],
            actor_user_id=actor["id"],
            type_="reply",
            entity_type=comment["entity_type"],
            entity_id=comment["entity_id"],
            comment_id=comment["id"],
            title=f"{actor_name} replied to your comment on {label}",
            body=comment["body"][:180],
        )


@router.post("")
async def create_comment(
    payload: CommentCreate,
    current_user: dict = Depends(get_current_user),
):
    db = get_db()

    # Rule 9: entity_type must resolve; entity must exist
    entity_doc = await resolve_entity(payload.entity_type, payload.entity_id)
    if not entity_doc:
        raise HTTPException(status_code=400, detail="Unsupported or unknown entity_type/entity_id")

    # Phase 9 write guard — user must have project access on the entity
    await require_entity_access(current_user, payload.entity_type, payload.entity_id)

    # Body non-empty
    if not payload.body or not payload.body.strip():
        raise HTTPException(status_code=400, detail="Comment body cannot be empty")

    # Visibility validation
    if payload.visibility not in VISIBILITY_CHOICES:
        raise HTTPException(status_code=400, detail=f"visibility must be one of {VISIBILITY_CHOICES}")
    if payload.visibility == "Customer Visible" and not can_post_customer_visible(current_user):
        raise HTTPException(
            status_code=403,
            detail="Only CRM, Legal, Management or Super Admin can post Customer Visible comments.",
        )

    # Parent + thread root resolution
    parent = None
    thread_root_id = None
    if payload.parent_comment_id:
        parent = await db.comments.find_one({"id": payload.parent_comment_id}, {"_id": 0})
        if not parent:
            raise HTTPException(status_code=400, detail="Parent comment not found")
        if parent["entity_type"] != payload.entity_type or parent["entity_id"] != payload.entity_id:
            raise HTTPException(status_code=400, detail="Parent belongs to a different entity")
        if parent.get("parent_comment_id"):
            raise HTTPException(status_code=400, detail="Only one level of threading supported")
        thread_root_id = parent["id"]
    else:
        thread_root_id = None  # top-level (self-root)

    # Validate mention user_ids exist and active
    if payload.mention_user_ids:
        found = await db.users.count_documents({"id": {"$in": payload.mention_user_ids}, "active": True})
        if found != len(set(payload.mention_user_ids)):
            raise HTTPException(status_code=400, detail="One or more mentioned users are invalid or inactive")
    if payload.mention_department_ids:
        found = await db.departments.count_documents(
            {"id": {"$in": payload.mention_department_ids}, "active": True}
        )
        if found != len(set(payload.mention_department_ids)):
            raise HTTPException(status_code=400, detail="One or more mentioned departments are invalid")

    # Validate attachment_ids belong to same entity if provided
    if payload.attachment_ids:
        att_count = await db.attachments.count_documents({
            "id": {"$in": payload.attachment_ids},
            "entity_type": payload.entity_type,
            "entity_id": payload.entity_id,
            "deleted_at": None,
        })
        if att_count != len(set(payload.attachment_ids)):
            raise HTTPException(status_code=400, detail="One or more attachments are invalid")

    comment_id = str(uuid.uuid4())
    doc = {
        "id": comment_id,
        "entity_type": payload.entity_type,
        "entity_id": payload.entity_id,
        "parent_comment_id": payload.parent_comment_id,
        "thread_root_id": thread_root_id or comment_id,
        "user_id": current_user["id"],
        "body": payload.body,
        "visibility": payload.visibility,
        "status": "Active",
        "resolved_by": None,
        "resolved_at": None,
        "created_at": _now_iso(),
        "edited_at": None,
        "mention_user_ids": list(payload.mention_user_ids or []),
        "mention_department_ids": list(payload.mention_department_ids or []),
        "attachment_ids": list(payload.attachment_ids or []),
    }
    await db.comments.insert_one(doc)

    # Persist mentions and attach comment_id back onto attachments
    await persist_mentions(
        comment_id=comment_id,
        user_ids=payload.mention_user_ids,
        department_ids=payload.mention_department_ids,
    )
    if payload.attachment_ids:
        await db.attachments.update_many(
            {"id": {"$in": payload.attachment_ids}},
            {"$set": {"comment_id": comment_id}},
        )

    # Bump thread root's activity marker so newest-activity ordering works
    if payload.parent_comment_id and thread_root_id:
        await db.comments.update_one(
            {"id": thread_root_id},
            {"$set": {"last_activity_at": doc["created_at"]}},
        )

    # Audit
    await write_audit(
        user_id=current_user["id"],
        entity_type="comment",
        entity_id=comment_id,
        action="create",
        after=doc,
        parent_entity_type=doc["entity_type"],
        parent_entity_id=doc["entity_id"],
    )

    # Notification fan-out
    await _fanout_new_comment(comment=doc, actor=current_user, parent=parent)

    return _serialize(doc)


@router.get("")
async def list_comments(
    entity_type: str = Query(...),
    entity_id: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    # Phase 9 read guard — 404 if out of scope
    await require_entity_access_soft(current_user, entity_type, entity_id)
    # Pull all non-deleted comments for this entity
    docs = await db.comments.find(
        {"entity_type": entity_type, "entity_id": entity_id, "status": {"$ne": "Deleted"}},
        {"_id": 0},
    ).sort("created_at", 1).to_list(2000)

    # Group into threads
    threads: dict[str, dict] = {}
    replies: list[dict] = []
    for c in docs:
        if not c.get("parent_comment_id"):
            c["replies"] = []
            threads[c["id"]] = c
        else:
            replies.append(c)
    for r in replies:
        root = threads.get(r["parent_comment_id"])
        if root:
            root["replies"].append(r)

    # Sort threads by last activity (most recent first). last_activity_at falls back to created_at.
    def _key(t):
        return t.get("last_activity_at") or t.get("created_at") or ""

    ordered = sorted(threads.values(), key=_key, reverse=True)
    # Replies within a thread stay chronological (already sorted by created_at ascending above)
    return ordered


@router.patch("/{comment_id}")
async def edit_comment(
    comment_id: str,
    payload: CommentUpdate,
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    doc = await db.comments.find_one({"id": comment_id}, {"_id": 0})
    if not doc or doc.get("status") == "Deleted":
        raise HTTPException(status_code=404, detail="Comment not found")
    if doc["user_id"] != current_user["id"] and not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only the author can edit this comment")
    if not payload.body or not payload.body.strip():
        raise HTTPException(status_code=400, detail="Comment body cannot be empty")
    # 30-minute edit window (skipped for super admin)
    if not is_super_admin(current_user):
        try:
            created = datetime.fromisoformat(doc["created_at"])
        except ValueError:
            created = datetime.now(timezone.utc)
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - created > timedelta(minutes=EDIT_WINDOW_MINUTES):
            raise HTTPException(status_code=400, detail=f"Edit window ({EDIT_WINDOW_MINUTES} minutes) has closed")
    before = dict(doc)
    await db.comments.update_one(
        {"id": comment_id},
        {"$set": {"body": payload.body, "edited_at": _now_iso()}},
    )
    after = await db.comments.find_one({"id": comment_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="comment",
        entity_id=comment_id,
        action="update",
        before=before,
        after=after,
        parent_entity_type=doc["entity_type"],
        parent_entity_id=doc["entity_id"],
    )
    return _serialize(after)


@router.post("/{comment_id}/resolve")
async def resolve_comment(
    comment_id: str,
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    doc = await db.comments.find_one({"id": comment_id}, {"_id": 0})
    if not doc or doc.get("status") == "Deleted":
        raise HTTPException(status_code=404, detail="Comment not found")
    if doc.get("parent_comment_id"):
        raise HTTPException(status_code=400, detail="Only top-level threads can be resolved")
    now = _now_iso()
    new_status = "Active" if doc.get("status") == "Resolved" else "Resolved"
    await db.comments.update_one(
        {"id": comment_id},
        {"$set": {
            "status": new_status,
            "resolved_by": current_user["id"] if new_status == "Resolved" else None,
            "resolved_at": now if new_status == "Resolved" else None,
        }},
    )
    after = await db.comments.find_one({"id": comment_id}, {"_id": 0})
    await write_audit(
        user_id=current_user["id"],
        entity_type="comment",
        entity_id=comment_id,
        action="update",
        before=doc,
        after=after,
        parent_entity_type=doc["entity_type"],
        parent_entity_id=doc["entity_id"],
    )
    return _serialize(after)


@router.delete("/{comment_id}")
async def delete_comment(
    comment_id: str,
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    doc = await db.comments.find_one({"id": comment_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Comment not found")
    if doc["user_id"] != current_user["id"] and not is_super_admin(current_user):
        raise HTTPException(status_code=403, detail="Only the author or a Super Admin can delete this comment")
    if doc.get("status") == "Deleted":
        return {"ok": True}
    await db.comments.update_one(
        {"id": comment_id},
        {"$set": {"status": "Deleted", "body": "[deleted]"}},
    )
    await write_audit(
        user_id=current_user["id"],
        entity_type="comment",
        entity_id=comment_id,
        action="delete",
        before=doc,
        parent_entity_type=doc["entity_type"],
        parent_entity_id=doc["entity_id"],
    )
    return {"ok": True}
