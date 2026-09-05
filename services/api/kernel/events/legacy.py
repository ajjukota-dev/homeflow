"""v1's `write_audit()`, rewritten onto the event log (technical/04 §4, TASKS Vivek 6).

The thirty v1 routers call this with the same arguments they always did; what changed is
where the row lands (Postgres `event`, not Mongo `audit_logs`) and that a failure now
raises instead of being swallowed by `except: pass` — an audit that can silently not
happen is not an audit.

v1's only action names are `create`, `update` and `delete`, none of which maps to a
catalogued business event, so every row is `legacy.audit` carrying the v1 body. Each v1
router emits its real event as it is ported, and this function then loses a caller.
"""
from __future__ import annotations

from typing import Any

from kernel.db import tx
from kernel.events.append import append
from kernel.identity.principal import SYSTEM

EVENT_TYPE = "legacy.audit"


def _clean(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items() if k != "_id"}
    if isinstance(value, list):
        return [_clean(v) for v in value]
    return value


async def write_audit(
    *,
    user_id: str | None,
    entity_type: str,
    entity_id: str,
    action: str,
    before: dict | None = None,
    after: dict | None = None,
    parent_entity_type: str | None = None,
    parent_entity_id: str | None = None,
) -> None:
    subject: dict[str, Any] = {"entity_type": entity_type, "entity_id": entity_id}
    if parent_entity_type:
        subject["parent_entity_type"] = parent_entity_type
        subject["parent_entity_id"] = parent_entity_id
    async with tx(SYSTEM) as t:
        await append(
            t,
            EVENT_TYPE,
            subject=subject,
            payload={"action": action, "entity_type": entity_type},
            actor={"type": "user", "id": user_id, "name": ""},
            previous_state=_clean(before),
            new_state=_clean(after),
            source={"system": "homeflow-v1", "source_record_id": entity_id},
        )
