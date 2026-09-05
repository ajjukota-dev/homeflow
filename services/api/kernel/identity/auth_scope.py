"""Phase 9 — Project-scope RBAC helper.

Contract:
- All-projects users (Super Admin, Management) bypass all scoping.
- Everyone else is limited to `users.assigned_project_ids`.
- Read filters: attach a Mongo `$match` fragment to the query. `[]` (scoped user
  with no assignments) short-circuits to empty result — no DB round-trip.
- Write guards: resolve entity → project_id, then call `require_project_access`
  which raises 403 with a leak-safe message.
- Read-by-id: use `require_project_access_soft` which raises 404 (not 403) when
  the entity is out of scope — matches "leak-safe" convention.
"""
from __future__ import annotations

from typing import Iterable, Optional

from fastapi import HTTPException, Request

from kernel.mongo import get_db
from kernel.identity.rbac_matrix import can as rbac_can, canonical_role, get_permission


ALL_PROJECTS_ROLES = {"SUPER_ADMIN", "MANAGEMENT"}


def _role_code(user: dict) -> str:
    return (user.get("role") or {}).get("code", "")


def is_all_projects_user(user: dict) -> bool:
    return bool(user.get("is_super_admin")) or _role_code(user) in ALL_PROJECTS_ROLES


# ---- Phase A: module-level RBAC dependency ----
def require_module(module: str, action: str):
    """FastAPI dependency factory that enforces the RBAC matrix on a route.

    Raises 403 with a structured detail body when the user's role does not have
    ``action`` on ``module``. ``read_status_only`` / ``read_limited`` count as
    ``read`` for GET endpoints — routers apply the paired redactor themselves.
    """
    # Local import to avoid FastAPI decorator resolution during module import
    from kernel.identity.auth_utils import get_current_user
    from fastapi import Depends

    async def _dep(current_user: dict = Depends(get_current_user)) -> dict:
        raw_code = (current_user.get("role") or {}).get("code") or ""
        canon = canonical_role(raw_code)
        allowed = rbac_can(raw_code, module, action)
        if not allowed:
            raise HTTPException(
                status_code=403,
                detail={
                    "detail": "forbidden",
                    "module": module,
                    "required_action": action,
                    "your_role": canon,
                    "your_permission": get_permission(raw_code, module),
                },
            )
        # Cache the canonical role on the user for downstream redactors
        current_user["_role_code"] = raw_code
        current_user["_role_canonical"] = canon
        return current_user

    return _dep


def require_module_by_method(module: str):
    """Router-level dependency: reads → require ``read``, everything else → ``write``.

    Use as ``APIRouter(..., dependencies=[Depends(require_module_by_method("snagging"))])``.
    The same guard also stamps ``_role_code`` / ``_role_canonical`` onto the user so
    downstream redactors can look up permission modifiers without re-fetching the role.
    """
    from kernel.identity.auth_utils import get_current_user
    from fastapi import Depends

    async def _dep(request: Request, current_user: dict = Depends(get_current_user)) -> dict:
        method = (request.method or "GET").upper()
        action = "read" if method == "GET" else "write"
        raw_code = (current_user.get("role") or {}).get("code") or ""
        canon = canonical_role(raw_code)
        if not rbac_can(raw_code, module, action):
            raise HTTPException(
                status_code=403,
                detail={
                    "detail": "forbidden",
                    "module": module,
                    "required_action": action,
                    "your_role": canon,
                    "your_permission": get_permission(raw_code, module),
                },
            )
        current_user["_role_code"] = raw_code
        current_user["_role_canonical"] = canon
        return current_user

    return _dep


def get_project_scope(user: dict) -> Optional[list[str]]:
    """None → unlimited; list → limited (may be empty)."""
    if is_all_projects_user(user):
        return None
    return list(user.get("assigned_project_ids") or [])


def user_can_access_project(user: dict, project_id: Optional[str]) -> bool:
    if is_all_projects_user(user):
        return True
    if not project_id:
        return False
    return project_id in (user.get("assigned_project_ids") or [])


async def require_project_access(user: dict, project_id: Optional[str]) -> None:
    """Write-path guard — 403 if out of scope. Leak-safe generic message."""
    if not user_can_access_project(user, project_id):
        raise HTTPException(status_code=403, detail="You do not have access to this project.")


async def require_project_access_soft(user: dict, project_id: Optional[str]) -> None:
    """Read-by-id guard — 404 if out of scope (leak-safe: don't reveal existence)."""
    if not user_can_access_project(user, project_id):
        raise HTTPException(status_code=404, detail="Not found")


# ---------- Entity → project_id resolvers ----------

async def project_id_of_booking(booking_id: str) -> Optional[str]:
    if not booking_id: return None
    b = await get_db().bookings.find_one({"id": booking_id}, {"_id": 0, "project_id": 1})
    return (b or {}).get("project_id")


async def project_ids_of_customer(customer_id: str) -> list[str]:
    """A customer may span multiple bookings across projects."""
    if not customer_id: return []
    bookings = await get_db().bookings.find({"customer_id": customer_id}, {"_id": 0, "project_id": 1}).to_list(50)
    return list({b["project_id"] for b in bookings if b.get("project_id")})


async def user_can_access_customer(user: dict, customer_id: str) -> bool:
    if is_all_projects_user(user): return True
    scope = set(user.get("assigned_project_ids") or [])
    if not scope: return False
    return bool(scope & set(await project_ids_of_customer(customer_id)))


async def require_customer_access(user: dict, customer_id: str) -> None:
    if not await user_can_access_customer(user, customer_id):
        raise HTTPException(status_code=403, detail="You do not have access to this project.")


async def require_customer_access_soft(user: dict, customer_id: str) -> None:
    if not await user_can_access_customer(user, customer_id):
        raise HTTPException(status_code=404, detail="Not found")


async def require_booking_access(user: dict, booking_id: str) -> None:
    pid = await project_id_of_booking(booking_id)
    await require_project_access(user, pid)


async def require_booking_access_soft(user: dict, booking_id: str) -> None:
    pid = await project_id_of_booking(booking_id)
    await require_project_access_soft(user, pid)


async def project_id_of_journey(journey_id: str) -> Optional[str]:
    if not journey_id: return None
    j = await get_db().customer_journeys.find_one({"id": journey_id}, {"_id": 0, "booking_id": 1})
    if not j: return None
    return await project_id_of_booking(j["booking_id"])


async def project_id_of_task(task_id: str) -> Optional[str]:
    t = await get_db().tasks.find_one({"id": task_id}, {"_id": 0, "journey_id": 1})
    if not t: return None
    return await project_id_of_journey(t["journey_id"])


async def project_id_of_entity(entity_type: str, entity_id: str) -> Optional[str]:
    """Polymorphic resolver — used by comments / attachments / audit."""
    if not entity_id: return None
    db = get_db()
    et = entity_type
    if et == "customer":
        pids = await project_ids_of_customer(entity_id)
        return pids[0] if pids else None
    if et == "booking":
        return await project_id_of_booking(entity_id)
    if et == "journey":
        return await project_id_of_journey(entity_id)
    if et == "task":
        return await project_id_of_task(entity_id)
    if et == "project":
        return entity_id
    if et == "unit":
        u = await db.units.find_one({"id": entity_id}, {"_id": 0, "project_id": 1})
        return (u or {}).get("project_id")
    # Booking-scoped domain entities
    coll_map = {
        "loan_case": "loan_cases", "legal_record": "legal_records",
        "registration": "registrations", "unit_readiness": "unit_readiness",
        "snag": "snags", "handover": "handovers",
        "commitment": "customer_commitments",
        "document": "documents",  # documents keyed by customer_id
        "payment_milestone": "payment_milestones",
        "tds_record": "tds_records",
        "financial_clearance": "financial_clearances",
        "sales_handover": "sales_handovers",
        "escalation": "escalations",
        "communication": "communications",
    }
    coll = coll_map.get(et)
    if not coll: return None
    doc = await db[coll].find_one({"id": entity_id}, {"_id": 0})
    if not doc: return None
    if doc.get("booking_id"):
        return await project_id_of_booking(doc["booking_id"])
    if doc.get("customer_id"):
        pids = await project_ids_of_customer(doc["customer_id"])
        return pids[0] if pids else None
    return None


async def require_entity_access(user: dict, entity_type: str, entity_id: str) -> None:
    if is_all_projects_user(user): return
    pid = await project_id_of_entity(entity_type, entity_id)
    if not user_can_access_project(user, pid):
        raise HTTPException(status_code=403, detail="You do not have access to this project.")


async def require_entity_access_soft(user: dict, entity_type: str, entity_id: str) -> None:
    if is_all_projects_user(user): return
    pid = await project_id_of_entity(entity_type, entity_id)
    if not user_can_access_project(user, pid):
        raise HTTPException(status_code=404, detail="Not found")


# ---------- Read-filter helpers ----------

def scope_filter_direct(user: dict, field: str = "project_id") -> Optional[dict]:
    """Returns a Mongo filter fragment or None (unlimited).
    Callers must check `if fragment is None: no filter else: merge into query`.
    """
    scope = get_project_scope(user)
    if scope is None: return None
    if not scope: return {"__empty__": True}  # sentinel — caller returns [] fast
    return {field: {"$in": scope}}


async def scoped_booking_ids(user: dict) -> Optional[list[str]]:
    """Returns None (unlimited) or list of booking ids the user can access."""
    scope = get_project_scope(user)
    if scope is None: return None
    if not scope: return []
    ids = [b["id"] async for b in get_db().bookings.find({"project_id": {"$in": scope}}, {"_id": 0, "id": 1})]
    return ids


async def scoped_customer_ids(user: dict) -> Optional[list[str]]:
    scope = get_project_scope(user)
    if scope is None: return None
    if not scope: return []
    ids = list({b["customer_id"] async for b in get_db().bookings.find({"project_id": {"$in": scope}, "customer_id": {"$ne": None}}, {"_id": 0, "customer_id": 1})})
    return ids


def empty_if_out_of_scope(fragment: Optional[dict]) -> bool:
    """Returns True if the caller should short-circuit with []."""
    return isinstance(fragment, dict) and fragment.get("__empty__") is True
