"""One-shot audit_logs backfill.

Runs on backend boot. Two responsibilities:

1. Populate ``parent_entity_type`` / ``parent_entity_id`` on child-entity rows
   (``comment``, ``attachment``) written before the Phase 2 fix pass.
2. Synthesise missing ``create`` audit rows for any comment/attachment that has
   *no* corresponding audit_logs entry (typically seed data).

Idempotent.
"""
from __future__ import annotations

import logging
import uuid

from kernel.mongo import get_db

logger = logging.getLogger("audit_backfill")


async def backfill_parent_links() -> dict[str, int]:
    db = get_db()
    stats = {"parent_linked": 0, "synthesised_creates": 0}

    # ---- 1. Parent-link existing child rows ----
    query = {
        "entity_type": {"$in": ["comment", "attachment"]},
        "$or": [
            {"parent_entity_type": {"$exists": False}},
            {"parent_entity_type": None},
        ],
    }
    async for row in db.audit_logs.find(query, {"_id": 0}):
        payload = row.get("after") or row.get("before") or {}
        parent_type = payload.get("entity_type")
        parent_id = payload.get("entity_id")
        if not parent_type or not parent_id:
            continue
        res = await db.audit_logs.update_one(
            {"id": row["id"]},
            {"$set": {"parent_entity_type": parent_type, "parent_entity_id": parent_id}},
        )
        if res.modified_count:
            stats["parent_linked"] += 1

    # ---- 2. Synthesise create rows for records that have no audit history ----
    async def _synth(child_coll: str, entity_type_name: str):
        async for doc in db[child_coll].find({}, {"_id": 0}):
            has_create = await db.audit_logs.find_one(
                {"entity_type": entity_type_name, "entity_id": doc["id"], "action": "create"},
                {"_id": 0, "id": 1},
            )
            if has_create:
                continue
            await db.audit_logs.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": doc.get("user_id") or doc.get("uploaded_by"),
                "entity_type": entity_type_name,
                "entity_id": doc["id"],
                "parent_entity_type": doc.get("entity_type"),
                "parent_entity_id": doc.get("entity_id"),
                "action": "create",
                "before": None,
                "after": doc,
                "timestamp": doc.get("created_at") or doc.get("uploaded_at"),
            })
            stats["synthesised_creates"] += 1

    await _synth("comments", "comment")
    await _synth("attachments", "attachment")

    if stats["parent_linked"] or stats["synthesised_creates"]:
        logger.info(
            "audit_logs backfill: parent-linked %d, synthesised %d.",
            stats["parent_linked"], stats["synthesised_creates"],
        )
    else:
        logger.info("audit_logs backfill: nothing to update.")
    return stats
