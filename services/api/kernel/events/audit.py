"""Read-only audit log endpoint for Super Admin + Management."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from kernel.identity.auth_utils import get_current_user
from kernel.mongo import get_db


router = APIRouter(prefix="/audit_logs", tags=["audit"])


def _authorised(user: dict) -> bool:
    role = user.get("role") or {}
    return bool(role.get("is_super_admin")) or role.get("code") == "MANAGEMENT"


@router.get("")
async def list_audit_logs(
    entity_type: Optional[str] = Query(None),
    entity_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    before_ts: Optional[str] = Query(None, description="ISO timestamp; return only entries older than this"),
    current_user: dict = Depends(get_current_user),
):
    if not _authorised(current_user):
        raise HTTPException(status_code=403, detail="Only Super Admin or Management can read audit logs")

    db = get_db()
    q: dict = {}
    if entity_type and entity_id:
        # Return direct rows on this entity AND rows on children that name this entity as parent.
        q["$or"] = [
            {"entity_type": entity_type, "entity_id": entity_id},
            {"parent_entity_type": entity_type, "parent_entity_id": entity_id},
        ]
    elif entity_type:
        q["$or"] = [
            {"entity_type": entity_type},
            {"parent_entity_type": entity_type},
        ]
    elif entity_id:
        q["$or"] = [
            {"entity_id": entity_id},
            {"parent_entity_id": entity_id},
        ]
    if before_ts:
        q["timestamp"] = {"$lt": before_ts}

    docs = await db.audit_logs.find(q, {"_id": 0}).sort("timestamp", -1).limit(limit).to_list(limit)

    # Clean out any legacy ObjectId nested inside before/after payloads (defensive).
    def _clean(v):
        if isinstance(v, dict):
            return {k: _clean(x) for k, x in v.items() if k != "_id"}
        if isinstance(v, list):
            return [_clean(x) for x in v]
        try:
            from bson import ObjectId  # noqa: WPS433 (local import to avoid hard dep)
            if isinstance(v, ObjectId):
                return str(v)
        except Exception:  # noqa: BLE001
            pass
        return v

    docs = [_clean(d) for d in docs]

    # Enrich with actor names
    user_ids = {d["user_id"] for d in docs if d.get("user_id")}
    actors: dict[str, str] = {}
    if user_ids:
        async for u in db.users.find({"id": {"$in": list(user_ids)}}, {"_id": 0, "id": 1, "name": 1}):
            actors[u["id"]] = u.get("name")
    for d in docs:
        d["actor_name"] = actors.get(d.get("user_id") or "")
    return docs
