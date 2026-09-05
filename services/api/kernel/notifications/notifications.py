"""Notifications API — per-recipient inbox with unread badge + deep-link data."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from kernel.identity.auth_utils import get_current_user
from kernel.mongo import get_db


router = APIRouter(prefix="/notifications", tags=["notifications"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("")
async def list_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q: dict = {"user_id": current_user["id"]}
    if unread_only:
        q["read_at"] = None
    docs = await db.notifications.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)

    # Enrich with actor name + short label for the target
    actor_ids = {d["actor_user_id"] for d in docs if d.get("actor_user_id")}
    actors: dict[str, dict] = {}
    if actor_ids:
        async for u in db.users.find({"id": {"$in": list(actor_ids)}}, {"_id": 0, "id": 1, "name": 1, "email": 1}):
            actors[u["id"]] = u
    for d in docs:
        a = actors.get(d.get("actor_user_id") or "")
        if a:
            d["actor_name"] = a.get("name") or a.get("email")
        else:
            d["actor_name"] = None
    return docs


@router.get("/unread-count")
async def unread_count(current_user: dict = Depends(get_current_user)):
    db = get_db()
    count = await db.notifications.count_documents({"user_id": current_user["id"], "read_at": None})
    return {"count": count}


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    doc = await db.notifications.find_one({"id": notification_id, "user_id": current_user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Notification not found")
    if not doc.get("read_at"):
        await db.notifications.update_one({"id": notification_id}, {"$set": {"read_at": _now_iso()}})
    after = await db.notifications.find_one({"id": notification_id}, {"_id": 0})
    return after


@router.post("/read-all")
async def mark_all_read(current_user: dict = Depends(get_current_user)):
    db = get_db()
    now = _now_iso()
    res = await db.notifications.update_many(
        {"user_id": current_user["id"], "read_at": None},
        {"$set": {"read_at": now}},
    )
    return {"updated": res.modified_count}
